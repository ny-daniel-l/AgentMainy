//! Subscription limits, shown as meters under the pet. Each source returns
//! `{ main: {used, resets}, sub, main_label, sub_label }` (used = % spent):
//! - Claude: the OAuth usage endpoint Claude Code's /usage reads (undocumented).
//! - Codex: the `rate_limits` block Codex writes into its newest rollout file.
//! - Copilot: GitHub's `copilot_internal/user` quota, via the gh CLI's login.
//! DeepSeek has no percentage, only a prepaid balance: `{ balance, currency }`.
//! Also the dock's GitHub history (last year of contributions), via the same gh login.

use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};

fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// GET a JSON URL with curl. Headers go via stdin (-H @-) so tokens never
/// appear on a command line.
fn get_json(url: &str, headers: &str) -> Option<Value> {
    let mut child = hidden(
        Command::new("curl")
            .args(["-s", "-m", "10", "-H", "@-", url])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null()),
    )
    .spawn()
    .ok()?;
    child.stdin.take()?.write_all(headers.as_bytes()).ok()?;
    serde_json::from_slice(&child.wait_with_output().ok()?.stdout).ok()
}

fn read_json_file(p: std::path::PathBuf) -> Option<Value> {
    let s = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()
}

/// Claude Code hands its status line the account's rate limits; our status line
/// script (~/.claude/agentpet-statusline.js) saves them. Used while recent, since
/// the usage endpoint rate-limits hard. Usage made outside Claude Code (desktop
/// app, web) only shows up once the file goes stale and the endpoint answers.
fn claude() -> Option<Value> {
    let p = dirs::home_dir()?.join(".claude").join("agentpet-status.json");
    let recent = std::fs::metadata(&p)
        .and_then(|m| m.modified())
        .map(|t| t.elapsed().map_or(false, |e| e.as_secs() < 600))
        .unwrap_or(false);
    let from_file = || {
        let rl = read_json_file(p.clone())?.get("rate_limits")?.clone();
        let win = |k: &str| {
            let w = rl.get(k)?;
            Some(json!({ "used": w.get("used_percentage")?.as_f64()?, "resets": w.get("resets_at")?.as_i64()? }))
        };
        Some(json!({ "main": win("five_hour")?, "sub": win("seven_day"), "main_label": "5-hour", "sub_label": "Weekly" }))
    };
    if recent {
        if let Some(v) = from_file() {
            return Some(v);
        }
    }
    Some(cached("claude_api", 180, claude_api)).filter(|v| !v.is_null()).or_else(from_file)
}

fn claude_api() -> Option<Value> {
    let creds = read_json_file(dirs::home_dir()?.join(".claude").join(".credentials.json"))?;
    let token = creds.get("claudeAiOauth")?.get("accessToken")?.as_str()?;
    let v = get_json(
        "https://api.anthropic.com/api/oauth/usage",
        &format!("Authorization: Bearer {token}\nanthropic-beta: oauth-2025-04-20\n"),
    )?;
    let win = |k: &str| {
        let w = v.get(k)?;
        Some(json!({ "used": w.get("utilization")?.as_f64()?, "resets": w.get("resets_at")?.as_str()? }))
    };
    Some(json!({ "main": win("five_hour")?, "sub": win("seven_day"), "main_label": "5-hour", "sub_label": "Weekly" }))
}

fn sorted_desc(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut v: Vec<_> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).collect();
    v.sort();
    v.reverse();
    v
}

/// Live numbers from the endpoint the Codex app's usage panel reads, signed in
/// with the CLI's saved ChatGPT login. Falls back to the newest rollout file.
fn codex() -> Option<Value> {
    codex_live().or_else(codex_rollout)
}

fn codex_live() -> Option<Value> {
    let auth = read_json_file(dirs::home_dir()?.join(".codex").join("auth.json"))?;
    let t = auth.get("tokens")?;
    let v = get_json(
        "https://chatgpt.com/backend-api/wham/usage",
        &format!(
            "Authorization: Bearer {}\nchatgpt-account-id: {}\nUser-Agent: codex-cli\n",
            t.get("access_token")?.as_str()?,
            t.get("account_id")?.as_str()?
        ),
    )?;
    let rl = v.get("rate_limit")?;
    let win = |k: &str| {
        let w = rl.get(k)?;
        Some(json!({ "used": w.get("used_percent")?.as_f64()?, "resets": w.get("reset_at")?.as_i64()? }))
    };
    Some(json!({ "main": win("primary_window")?, "sub": win("secondary_window"), "main_label": "5-hour", "sub_label": "Weekly" }))
}

fn codex_rollout() -> Option<Value> {
    let root = dirs::home_dir()?.join(".codex").join("sessions");
    // sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl , zero-padded, so
    // lexical order is chronological.
    let mut checked = 0;
    for y in sorted_desc(&root) {
        for m in sorted_desc(&y) {
            for d in sorted_desc(&m) {
                for f in sorted_desc(&d) {
                    checked += 1;
                    if checked > 30 {
                        return None;
                    }
                    let Ok(text) = std::fs::read_to_string(&f) else { continue };
                    for line in text.lines().rev().filter(|l| l.contains("\"rate_limits\"")) {
                        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
                        let Some(rl) = v.get("payload").and_then(|p| p.get("rate_limits")) else { continue };
                        let win = |k: &str| {
                            let w = rl.get(k)?;
                            Some(json!({ "used": w.get("used_percent")?.as_f64()?, "resets": w.get("resets_at")?.as_i64()? }))
                        };
                        if let Some(p) = win("primary") {
                            return Some(json!({ "main": p, "sub": win("secondary"), "main_label": "5-hour", "sub_label": "Weekly" }));
                        }
                    }
                }
            }
        }
    }
    None
}

fn copilot() -> Option<Value> {
    let out = hidden(Command::new("gh").args(["api", "copilot_internal/user"]).stderr(Stdio::null()))
        .output()
        .ok()?;
    let v: Value = serde_json::from_slice(&out.stdout).ok()?;
    let resets = v.get("quota_reset_date")?.as_str()?;
    let q = v.get("quota_snapshots")?;
    let win = |k: &str| {
        let w = q.get(k)?;
        // Unlimited, or not part of the plan (free tier: 0 premium requests).
        if w.get("unlimited")?.as_bool()? || w.get("entitlement")?.as_f64()? <= 0.0 {
            return None;
        }
        Some(json!({ "used": 100.0 - w.get("percent_remaining")?.as_f64()?, "resets": resets }))
    };
    Some(json!({ "main": win("chat")?, "sub": win("premium_interactions"), "main_label": "Monthly chat", "sub_label": "Premium requests" }))
}

fn deepseek() -> Option<Value> {
    // OpenCode's saved key, else the usual env var.
    let key = read_json_file(dirs::home_dir()?.join(".local").join("share").join("opencode").join("auth.json"))
        .and_then(|a| a.get("deepseek")?.get("key")?.as_str().map(String::from))
        .or_else(|| std::env::var("DEEPSEEK_API_KEY").ok().filter(|k| !k.is_empty()))?;
    let v = get_json("https://api.deepseek.com/user/balance", &format!("Authorization: Bearer {key}\nAccept: application/json\n"))?;
    let b = v.get("balance_infos")?.as_array()?.first()?;
    Some(json!({ "balance": b.get("total_balance")?.as_str()?, "currency": b.get("currency")?.as_str()? }))
}

/// Last good reading per source. Each source is fetched at most every
/// `min_secs`; a failed fetch (Claude's endpoint rate-limits with 429s) keeps
/// showing the last good value instead of making the meter vanish.
fn cached(name: &'static str, min_secs: u64, fetch: fn() -> Option<Value>) -> Value {
    use std::collections::HashMap;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    // name -> (last attempt, last good value)
    static CACHE: Mutex<Option<HashMap<&'static str, (Instant, Value)>>> = Mutex::new(None);
    {
        let mut g = CACHE.lock().unwrap();
        if let Some((at, v)) = g.get_or_insert_with(HashMap::new).get(name) {
            if at.elapsed() < Duration::from_secs(min_secs) {
                return v.clone();
            }
        }
    }
    let got = fetch();
    let mut g = CACHE.lock().unwrap();
    let map = g.as_mut().unwrap();
    let keep = map.get(name).map(|(_, v)| v.clone()).unwrap_or(Value::Null);
    let v = got.unwrap_or(keep);
    // Nothing good yet: don't start the back-off, retry on the next poll.
    if !v.is_null() {
        map.insert(name, (Instant::now(), v.clone()));
    }
    v
}

/// The signed-in user's contribution calendar, totals and busiest repos for the
/// last year (GitHub's GraphQL API through the gh CLI's login).
fn github() -> Option<Value> {
    let q = "query{viewer{login contributionsCollection{totalCommitContributions \
        totalPullRequestContributions totalPullRequestReviewContributions totalIssueContributions \
        contributionCalendar{totalContributions weeks{contributionDays{date contributionCount contributionLevel}}} \
        commitContributionsByRepository(maxRepositories:3){repository{name} contributions{totalCount}}}}}";
    let out = hidden(Command::new("gh").args(["api", "graphql", "-f", &format!("query={q}")]).stderr(Stdio::null()))
        .output()
        .ok()?;
    let v: Value = serde_json::from_slice(&out.stdout).ok()?;
    v.get("data")?.get("viewer").cloned()
}

#[tauri::command]
pub async fn get_github() -> Value {
    tauri::async_runtime::spawn_blocking(|| cached("github", 1800, github))
        .await
        .unwrap_or(Value::Null)
}

#[tauri::command]
pub async fn get_limits() -> Value {
    tauri::async_runtime::spawn_blocking(|| {
        json!({
            "claude": cached("claude", 30, claude),
            "codex": cached("codex", 30, codex),
            "copilot": cached("copilot", 120, copilot),
            "deepseek": cached("deepseek", 300, deepseek),
        })
    })
    .await
    .unwrap_or(Value::Null)
}
