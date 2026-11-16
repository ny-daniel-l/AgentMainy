//! Reads Claude Code transcripts (JSONL) , a port of the macOS app's
//! TranscriptReader + QuestionDetector. Used to (1) name sessions after the
//! conversation, and (2) detect when Claude ended its turn by ASKING the user
//! something, so a `Stop` that looks "done" is corrected to "waiting".

use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::sync::{Mutex, OnceLock};

// Summary-based titles are final; first-user-message titles are provisional
// (a later summary supersedes them), so only summaries are cached.
static SUMMARY_CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
// Byte offset already consumed by `new_usage_tokens` per transcript path, so
// repeated reads only sum the freshly-appended usage (a port of the macOS
// TranscriptReader.usageOffsets).
static USAGE_OFFSETS: Mutex<Option<HashMap<String, u64>>> = Mutex::new(None);
// Claude message keys already counted (a message's usage repeats on its lines).
static SEEN: Mutex<Option<HashSet<String>>> = Mutex::new(None);
// When this run started (Unix secs); see `mark_start`.
static STARTED: OnceLock<i64> = OnceLock::new();
// Resolved Codex rollout path per session, so we don't re-walk ~/.codex/sessions
// on every event (it fires on each tool use).
static CODEX_PATHS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// Cached wrapper around `codex_rollout_path`, keyed by session id.
pub fn codex_rollout_path_cached(session_id: &str, cwd: Option<&str>) -> Option<String> {
    if let Some(hit) = CODEX_PATHS
        .lock()
        .ok()
        .and_then(|g| g.as_ref().and_then(|m| m.get(session_id).cloned()))
    {
        return Some(hit);
    }
    let path = codex_rollout_path(session_id, cwd)?;
    if let Ok(mut g) = CODEX_PATHS.lock() {
        g.get_or_insert_with(HashMap::new).insert(session_id.to_string(), path.clone());
    }
    Some(path)
}

/// Anthropic API list price in USD per million tokens (input, output, cache read)
/// for a Claude model; cache writes cost 1.25x input (5-minute) or 2x (1-hour).
/// `None` for non-Claude models (e.g. GLM through Claude Code): no Anthropic price.
fn claude_rates(model: &str, prompt: i64) -> Option<(f64, f64, f64)> {
    let m = model.to_lowercase();
    let has = |names: &[&str]| names.iter().any(|n| m.contains(n));
    Some(if has(&["fable", "mythos"]) {
        (10.0, 50.0, if m.contains("5-1") { 0.25 } else { 1.0 })
    } else if m.contains("opus") {
        if m.contains("opus-5-5") {
            (4.0, 20.0, 0.2)
        } else if has(&["opus-4-0", "opus-4-1", "opus-4-2025", "3-opus"]) {
            (15.0, 75.0, 1.5)
        } else {
            (5.0, 25.0, 0.5) // Opus 4.5 through 5
        }
    } else if m.contains("sonnet") {
        if m.contains("sonnet-5") { (2.0, 10.0, 0.2) } else { (3.0, 15.0, 0.3) }
    } else if m.contains("haiku") {
        if m.contains("haiku-5") {
            // Haiku 5.5 bills more once the prompt passes 100K tokens.
            if prompt > 100_000 { (0.5, 2.5, 0.05) } else { (0.1, 0.5, 0.01) }
        } else if m.contains("haiku-4") {
            (1.0, 5.0, 0.1)
        } else if m.contains("3-5-haiku") {
            (0.8, 4.0, 0.08)
        } else {
            (0.25, 1.25, 0.03)
        }
    } else {
        return None;
    })
}

/// Seconds since the Unix epoch for an ISO-8601 UTC time ("2026-10-23T08:12:34.5Z").
fn iso_secs(t: &str) -> Option<i64> {
    let num = |a: usize, b: usize| -> Option<i64> { t.get(a..b)?.parse().ok() };
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi, s) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    // Days from the civil date (Howard Hinnant's algorithm).
    let y = if mo <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((mo + 9) % 12) + 2) / 5 + d - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    Some(days * 86_400 + h * 3600 + mi * 60 + s)
}

/// One assistant message's usage on a transcript line: (dedup key, input+output
/// tokens, API-priced USD cost, Unix secs). Claude Code repeats a message's usage
/// on each of its content-block lines, so callers count every key once.
fn line_usage(v: &Value) -> Option<(String, i64, f64, i64)> {
    let msg = v.get("message")?;
    let u = msg.get("usage")?;
    let n = |o: &Value, k: &str| o.get(k).and_then(|x| x.as_i64()).unwrap_or(0);
    let (input, output, read) = (n(u, "input_tokens"), n(u, "output_tokens"), n(u, "cache_read_input_tokens"));
    let write = n(u, "cache_creation_input_tokens");
    let write_1h = u.get("cache_creation").map_or(0, |c| n(c, "ephemeral_1h_input_tokens")).min(write);
    let model = msg.get("model").and_then(|x| x.as_str()).unwrap_or("");
    let cost = claude_rates(model, input + read + write).map_or(0.0, |(i, o, r)| {
        let usd = (input as f64 * i
            + output as f64 * o
            + read as f64 * r
            + (write - write_1h) as f64 * i * 1.25
            + write_1h as f64 * i * 2.0)
            / 1_000_000.0;
        // Fast mode bills twice the standard rate.
        if u.get("speed").and_then(|x| x.as_str()) == Some("fast") { usd * 2.0 } else { usd }
    });
    let key = format!("{}|{}", msg.get("id")?.as_str()?, v.get("requestId").and_then(|x| x.as_str()).unwrap_or(""));
    let ts = v.get("timestamp").and_then(|x| x.as_str()).and_then(iso_secs).unwrap_or(0);
    Some((key, input + output, cost, ts))
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// Note when this run started: a transcript's first read in a run skips older
/// lines, which an earlier run already counted (or which AgentPet slept through).
pub fn mark_start() {
    STARTED.get_or_init(now_secs);
}

/// Sums Claude model usage tokens (input + output) AND estimates their USD cost
/// at API list prices, for lines appended to the transcript since the previous
/// call for the same path, each message once. `None` if unreadable, `(0, 0.0)` if
/// no new usage lines appeared. Feeds the pet + cost.
pub fn new_usage_delta(path: &str) -> Option<(i64, f64)> {
    // Hold the offsets lock across the whole read + advance, so two events for
    // the same session firing at once can't both consume the same bytes (which
    // would double-feed the pet). Reads are small deltas, so serialising is fine.
    let mut guard = USAGE_OFFSETS.lock().ok()?;
    let offsets = guard.get_or_insert_with(HashMap::new);
    let first = !offsets.contains_key(path);

    let mut f = std::fs::File::open(path).ok()?;
    let size = f.seek(SeekFrom::End(0)).ok()?;
    let mut start = offsets.get(path).copied().unwrap_or(0);
    if start > size {
        start = 0; // file truncated/replaced: start over
    }
    if size <= start {
        return Some((0, 0.0));
    }
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    // Consume up to the last full line; a partial trailing line stays for later.
    let nl = buf.iter().rposition(|&b| b == b'\n')?;
    let consumable = &buf[..=nl];
    offsets.insert(path.to_string(), start + consumable.len() as u64);
    let text = String::from_utf8_lossy(consumable);
    let started = *STARTED.get_or_init(now_secs);
    let mut seen = SEEN.lock().ok()?;
    let seen = seen.get_or_insert_with(HashSet::new);
    if seen.len() > 20_000 {
        seen.clear(); // repeats of one message sit together, so old keys can go
    }
    let mut total: i64 = 0;
    let mut cost = 0.0;
    for line in text.lines() {
        if !line.contains("\"usage\"") {
            continue; // fast reject: most lines carry no usage object
        }
        let Ok(json) = serde_json::from_str::<Value>(line.trim()) else { continue };
        let Some((key, tokens, usd, ts)) = line_usage(&json) else { continue };
        if seen.insert(key) && !(first && ts < started) {
            total += tokens;
            cost += usd;
        }
    }
    Some((total, cost))
}

/// Every Claude Code transcript re-totalled per project and UTC hour, each message
/// once at current API prices. The frontend runs it once to correct the usage
/// older builds recorded (repeats counted, every Opus priced at $15/$75).
#[tauri::command]
pub async fn rescan_claude_usage() -> Vec<Value> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut seen = HashSet::new();
        let mut totals: HashMap<(String, String), (i64, f64)> = HashMap::new();
        let mut stack: Vec<std::path::PathBuf> =
            dirs::home_dir().map(|h| h.join(".claude").join("projects")).into_iter().collect();
        while let Some(dir) = stack.pop() {
            for path in std::fs::read_dir(&dir).into_iter().flatten().flatten().map(|e| e.path()) {
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                if path.extension().map_or(true, |x| x != "jsonl") {
                    continue;
                }
                let Ok(text) = std::fs::read_to_string(&path) else { continue };
                for line in text.lines().filter(|l| l.contains("\"usage\"")) {
                    let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
                    let (Some((key, tokens, usd, _)), Some(cwd), Some(hour)) = (
                        line_usage(&v),
                        v.get("cwd").and_then(|x| x.as_str()),
                        v.get("timestamp").and_then(|x| x.as_str()).and_then(|t| t.get(..13)),
                    ) else {
                        continue;
                    };
                    if seen.insert(key) {
                        let t = totals.entry((cwd.to_string(), hour.to_string())).or_default();
                        t.0 += tokens;
                        t.1 += usd;
                    }
                }
            }
        }
        totals
            .into_iter()
            .map(|((project, hour), (tokens, cost))| {
                serde_json::json!({ "project": project, "hour": hour, "tokens": tokens, "cost": cost })
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// Expected transcript path for a Claude Code session when the hook payload
/// didn't carry `transcript_path`: `~/.claude/projects/<sanitized-cwd>/<id>.jsonl`
/// where the sanitized cwd replaces every separator with `-`.
pub fn inferred_path(session_id: &str, cwd: &str) -> Option<String> {
    let home = dirs::home_dir()?;
    let sanitized: String = cwd
        .chars()
        .map(|c| if c == '/' || c == '\\' || c == ':' { '-' } else { c })
        .collect();
    Some(format!(
        "{}/.claude/projects/{}/{}.jsonl",
        home.to_string_lossy(),
        sanitized,
        session_id
    ))
}

/// Sums new Codex token usage (fresh input minus cached, plus output) appended
/// to a rollout JSONL since the previous call, so Codex earns token XP like
/// Claude. Offset-based + serialised, like `new_usage_tokens`.
pub fn new_codex_usage_tokens(path: &str) -> Option<i64> {
    let mut guard = USAGE_OFFSETS.lock().ok()?;
    let offsets = guard.get_or_insert_with(HashMap::new);

    let mut f = std::fs::File::open(path).ok()?;
    let size = f.seek(SeekFrom::End(0)).ok()?;
    let mut start = offsets.get(path).copied().unwrap_or(0);
    if start > size {
        start = 0;
    }
    if size <= start {
        return Some(0);
    }
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    let nl = buf.iter().rposition(|&b| b == b'\n')?;
    let consumable = &buf[..=nl];
    offsets.insert(path.to_string(), start + consumable.len() as u64);
    let text = String::from_utf8_lossy(consumable);
    let mut total: i64 = 0;
    for line in text.lines() {
        if !line.contains("\"last_token_usage\"") {
            continue;
        }
        let Ok(json) = serde_json::from_str::<Value>(line.trim()) else { continue };
        if let Some(last) = json
            .get("payload")
            .and_then(|p| p.get("info"))
            .and_then(|i| i.get("last_token_usage"))
        {
            let input = last.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
            let cached = last.get("cached_input_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
            let output = last.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
            total += (input - cached).max(0) + output;
        }
    }
    Some(total)
}

/// Locates a Codex session's rollout file under ~/.codex/sessions. Primary: a
/// filename containing the session id. Fallback: the newest rollout whose first
/// line's `payload.cwd` matches `cwd`.
pub fn codex_rollout_path(session_id: &str, cwd: Option<&str>) -> Option<String> {
    fn norm(p: &str) -> String {
        p.trim_end_matches(['/', '\\']).to_lowercase()
    }
    fn walk(
        dir: &std::path::Path,
        session_id: &str,
        out: &mut Vec<(std::path::PathBuf, std::time::SystemTime)>,
    ) -> Option<std::path::PathBuf> {
        for entry in std::fs::read_dir(dir).ok()?.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if let Some(hit) = walk(&p, session_id, out) {
                    return Some(hit);
                }
            } else if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if name.ends_with(".jsonl") && name.contains("rollout-") {
                    if name.contains(session_id) {
                        return Some(p);
                    }
                    let m = entry
                        .metadata()
                        .ok()
                        .and_then(|md| md.modified().ok())
                        .unwrap_or(std::time::UNIX_EPOCH);
                    out.push((p, m));
                }
            }
        }
        None
    }
    let root = dirs::home_dir()?.join(".codex").join("sessions");
    let mut candidates: Vec<(std::path::PathBuf, std::time::SystemTime)> = Vec::new();
    if let Some(hit) = walk(&root, session_id, &mut candidates) {
        return Some(hit.to_string_lossy().into_owned());
    }
    let cwd = cwd?;
    if cwd.trim().is_empty() {
        return None;
    }
    let target = norm(cwd);
    candidates.sort_by(|a, b| b.1.cmp(&a.1));
    for (p, _) in candidates.iter().take(40) {
        let Some(line) = first_line(p) else { continue };
        let Ok(json) = serde_json::from_str::<Value>(line.trim()) else { continue };
        if let Some(c) = json.get("payload").and_then(|pl| pl.get("cwd")).and_then(|v| v.as_str()) {
            if norm(c) == target {
                return Some(p.to_string_lossy().into_owned());
            }
        }
    }
    None
}

fn first_line(path: &std::path::Path) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut buf = vec![0u8; 4096];
    let n = f.read(&mut buf).ok()?;
    buf.truncate(n);
    String::from_utf8_lossy(&buf).lines().next().map(|l| l.to_string())
}

/// Path to a subagent's transcript for a Claude/Droid `SubagentStop`. Claude
/// stores them at `<parent-without-.jsonl>/subagents/<agent-id>.jsonl`.
pub fn subagent_transcript_path(parent: &str, agent_id: &str) -> String {
    let dir = std::path::Path::new(parent).with_extension("");
    dir.join("subagents")
        .join(format!("{}.jsonl", agent_id))
        .to_string_lossy()
        .into_owned()
}

/// Conversation title: a Claude "summary" event (cached), else the first human
/// user message (≤60 chars, provisional).
pub fn title(path: &str) -> Option<String> {
    {
        let cache = SUMMARY_CACHE.lock().ok()?;
        if let Some(hit) = cache.as_ref().and_then(|m| m.get(path)) {
            return Some(hit.clone());
        }
    }
    let (result, is_summary) = read_title(path)?;
    if is_summary {
        if let Ok(mut cache) = SUMMARY_CACHE.lock() {
            cache.get_or_insert_with(HashMap::new).insert(path.to_string(), result.clone());
        }
    }
    Some(result)
}

fn read_title(path: &str) -> Option<(String, bool)> {
    // First 32 KB covers the summary event, which appears early.
    let mut f = std::fs::File::open(path).ok()?;
    let mut buf = vec![0u8; 32_768];
    let n = f.read(&mut buf).ok()?;
    buf.truncate(n);
    // Truncate to the last newline so we never split a multi-byte char.
    if n == 32_768 {
        if let Some(nl) = buf.iter().rposition(|&b| b == b'\n') {
            buf.truncate(nl + 1);
        }
    }
    let text = String::from_utf8_lossy(&buf);

    let mut first_user: Option<String> = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(json) = serde_json::from_str::<Value>(trimmed) else { continue };
        match json.get("type").and_then(|t| t.as_str()) {
            Some("summary") => {
                if let Some(s) = json.get("summary").and_then(|s| s.as_str()) {
                    if !s.trim().is_empty() {
                        return Some((s.trim().to_string(), true));
                    }
                }
            }
            Some("user") if first_user.is_none() => {
                first_user = extract_user_text(&json);
            }
            _ => {}
        }
    }
    first_user.map(|t| (t, false))
}

fn extract_user_text(json: &Value) -> Option<String> {
    let message = json.get("message")?;
    if let Some(blocks) = message.get("content").and_then(|c| c.as_array()) {
        for block in blocks {
            if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(raw) = block.get("text").and_then(|t| t.as_str()) {
                    if let Some(clean) = human_readable(raw) {
                        return Some(clean);
                    }
                }
            }
        }
        return None;
    }
    message.get("content").and_then(|c| c.as_str()).and_then(human_readable)
}

/// Trimmed + capped at 60 chars; rejects XML-style system injections.
fn human_readable(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.starts_with('<') {
        return None;
    }
    Some(trimmed.chars().take(60).collect())
}

/// Raw text of the most recent assistant message (last 128 KB, capped 400 chars).
pub fn latest_assistant_text(path: &str) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let size = f.seek(SeekFrom::End(0)).ok()?;
    let max: u64 = 131_072;
    let start = size.saturating_sub(max);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);

    for line in text.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(json) = serde_json::from_str::<Value>(trimmed) else { continue };
        if json.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }
        if let Some(t) = extract_assistant_text(&json) {
            return Some(t.trim().chars().take(400).collect());
        }
    }
    None
}

fn extract_assistant_text(json: &Value) -> Option<String> {
    let message = json.get("message")?;
    if let Some(blocks) = message.get("content").and_then(|c| c.as_array()) {
        let text: Vec<&str> = blocks
            .iter()
            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
            .collect();
        let joined = text.join("\n");
        if joined.trim().is_empty() {
            return None;
        }
        return Some(joined);
    }
    message.get("content").and_then(|c| c.as_str()).map(String::from)
}

// ---- QuestionDetector ------------------------------------------------------

const QUESTION_STARTERS: &[&str] = &[
    "which ", "what ", "how ", "should i", "do you", "want me to",
    "shall i", "would you", "can you", "could you", "are you",
];

const OPTIONAL_FOLLOW_UPS: &[&str] = &[
    "let me know if",
    "let me know when",
    "feel free to",
    "if you'd like any",
    "if you want any",
    "if you want to",
    "if you'd like to",
    "if you need any",
    "say which one",
    "say the word",
    "if anything else",
    "happy to help",
    "happy to make",
    "don't hesitate",
    "just let me know",
];

/// True when the LAST sentence is a direct question or request for direction.
/// Completion summaries with an optional "let me know if…" tail count as done.
pub fn looks_like_question(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let last = last_sentence(trimmed).to_lowercase();
    if last.is_empty() {
        return false;
    }
    if OPTIONAL_FOLLOW_UPS.iter().any(|p| last.contains(p)) {
        return false;
    }
    last.ends_with('?') || QUESTION_STARTERS.iter().any(|s| last.starts_with(s))
}

fn last_sentence(text: &str) -> String {
    let normalized = text.replace('\n', " ");
    let normalized = normalized.trim();
    let mut segments: Vec<String> = Vec::new();
    let mut current = String::new();
    for ch in normalized.chars() {
        current.push(ch);
        if ch == '.' || ch == '!' || ch == '?' {
            let s = current.trim().to_string();
            if !s.is_empty() {
                segments.push(s);
            }
            current.clear();
        }
    }
    let rest = current.trim();
    if !rest.is_empty() {
        segments.push(rest.to_string());
    }
    segments.pop().unwrap_or_else(|| normalized.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prices_current_and_old_models() {
        assert_eq!(claude_rates("claude-opus-5-5", 0), Some((4.0, 20.0, 0.2)));
        assert_eq!(claude_rates("claude-opus-4-8", 0), Some((5.0, 25.0, 0.5)));
        assert_eq!(claude_rates("claude-opus-4-1-20250805", 0), Some((15.0, 75.0, 1.5)));
        assert_eq!(claude_rates("claude-sonnet-5-5", 0), Some((2.0, 10.0, 0.2)));
        assert_eq!(claude_rates("claude-haiku-5-5", 200_000), Some((0.5, 2.5, 0.05)));
        assert_eq!(claude_rates("claude-fable-5-1", 0), Some((10.0, 50.0, 0.25)));
        assert_eq!(claude_rates("glm-4.6", 0), None);
    }

    #[test]
    fn parses_utc_timestamps() {
        assert_eq!(iso_secs("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(iso_secs("2026-10-23T08:12:34.567Z"), Some(1_792_743_154));
    }

    #[test]
    fn prices_one_usage_line() {
        let line = json!({
            "requestId": "req_1", "timestamp": "2026-10-23T08:12:34Z",
            "message": { "id": "msg_1", "model": "claude-opus-5-5", "usage": {
                "input_tokens": 1_000_000, "output_tokens": 1_000_000,
                "cache_read_input_tokens": 1_000_000, "cache_creation_input_tokens": 2_000_000,
                "cache_creation": { "ephemeral_1h_input_tokens": 1_000_000 }, "speed": "standard" } }
        });
        let (key, tokens, usd, ts) = line_usage(&line).unwrap();
        assert_eq!((key.as_str(), tokens, ts), ("msg_1|req_1", 2_000_000, 1_792_743_154));
        // 4 in + 20 out + 0.2 read + 5 (5m write, 1.25x) + 8 (1h write, 2x)
        assert!((usd - 37.2).abs() < 1e-9, "{usd}");
    }
}