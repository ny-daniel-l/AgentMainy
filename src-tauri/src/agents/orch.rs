//! `agentpet ls | peek | wait | send` , a read-only orchestration CLI over the
//! running app's session registry (GET http://127.0.0.1:HOOK_PORT/sessions),
//! plus `send`, which focuses an agent's terminal and types a line into it.
//! Ported from agent-control's `ac ls/peek/wait/send`, but AgentPet observes
//! agents via hooks rather than owning their sessions, so it lists every hooked
//! agent (not only ones it launched) and `send` is best-effort keystrokes.

use crate::server::{SessionRow, HOOK_PORT};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};

const USAGE: &str = "\
agentpet ls                      list the agents the pet sees (agent, state, project, activity)
agentpet peek <agent>            show one agent's state, project, title and activity
agentpet wait <agent> [-t SECS]  block until it stops working (default 600s); prints its state
agentpet send <agent> <text>     focus that agent's terminal and type a line into it
                                 <agent> matches an agent kind, session-id prefix, project or title";

pub fn run(args: &[String]) -> i32 {
    match args.first().map(String::as_str) {
        Some("ls") => ls(),
        Some("peek") => one(args.get(1), |row| {
            println!(
                "{} [{}]  {}\n{}",
                row.agent,
                row.state,
                basename(&row.project),
                if row.title.is_empty() { row.live.clone() } else { format!("{} — {}", row.title, row.live) }
            );
            0
        }),
        Some("wait") => wait(args),
        Some("send") => send(args),
        _ => {
            eprintln!("{USAGE}");
            2
        }
    }
}

/// A row matches a selector when the selector (lowercased) is the agent kind, a
/// prefix of the session id, or a substring of the project basename or title.
fn matches(row: &SessionRow, sel: &str) -> bool {
    let sel = sel.to_lowercase();
    row.agent.to_lowercase().contains(&sel)
        || row.session.to_lowercase().starts_with(&sel)
        || basename(&row.project).to_lowercase().contains(&sel)
        || row.title.to_lowercase().contains(&sel)
}

/// `wait` returns as soon as the agent is no longer actively working.
fn settled(state: &str) -> bool {
    state != "working"
}

fn basename(p: &str) -> &str {
    p.rsplit(|c| c == '/' || c == '\\').find(|s| !s.is_empty()).unwrap_or(p)
}

fn ls() -> i32 {
    let rows = match fetch() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("agentpet: {e}");
            return 1;
        }
    };
    if rows.is_empty() {
        println!("no agents");
        return 0;
    }
    for r in &rows {
        let activity = if r.live.is_empty() { r.title.as_str() } else { r.live.as_str() };
        println!("{:<10} {:<8} {:<22} {}", r.agent, r.state, truncate(basename(&r.project), 22), activity);
    }
    0
}

/// Resolve the selector to exactly one row and run `f`; else report candidates.
fn one(sel: Option<&String>, f: impl FnOnce(&SessionRow) -> i32) -> i32 {
    let Some(sel) = sel else {
        eprintln!("{USAGE}");
        return 2;
    };
    let rows = match fetch() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("agentpet: {e}");
            return 1;
        }
    };
    let hits: Vec<&SessionRow> = rows.iter().filter(|r| matches(r, sel)).collect();
    match hits.len() {
        0 => {
            eprintln!("agentpet: no agent matches {sel:?}");
            1
        }
        1 => f(hits[0]),
        _ => {
            eprintln!("agentpet: {sel:?} matches {} agents , be more specific:", hits.len());
            for r in hits {
                eprintln!("  {} [{}] {}", r.agent, r.state, basename(&r.project));
            }
            1
        }
    }
}

fn wait(args: &[String]) -> i32 {
    let timeout = flag(args, "-t")
        .or_else(|| flag(args, "--timeout"))
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(600.0);
    // Resolve the session once so a later poll can't jump to a different match.
    let mut key: Option<(String, String)> = None;
    let rc = one(args.get(1), |row| {
        key = Some((row.agent.clone(), row.session.clone()));
        0
    });
    if rc != 0 {
        return rc;
    }
    let (agent, session) = key.unwrap();
    let deadline = Instant::now() + Duration::from_secs_f64(timeout);
    loop {
        match fetch() {
            Ok(rows) => match rows.iter().find(|r| r.agent == agent && r.session == session) {
                None => {
                    println!("ended");
                    return 0;
                }
                Some(r) if settled(&r.state) => {
                    println!("{}", r.state);
                    return 0;
                }
                _ => {}
            },
            Err(e) => {
                eprintln!("agentpet: {e}");
                return 1;
            }
        }
        if Instant::now() >= deadline {
            println!("timeout");
            return 1;
        }
        std::thread::sleep(Duration::from_secs(1));
    }
}

fn send(args: &[String]) -> i32 {
    let text = args.get(2..).map(|a| a.join(" ")).unwrap_or_default();
    if text.trim().is_empty() {
        eprintln!("usage: agentpet send <agent> <text>");
        return 2;
    }
    one(args.get(1), |row| {
        if row.target.is_empty() {
            eprintln!("agentpet: no terminal known for {} (can't send)", row.agent);
            return 1;
        }
        #[cfg(windows)]
        {
            crate::winfocus::focus(&row.target);
            // Let the terminal take focus before the keystrokes land.
            std::thread::sleep(Duration::from_millis(450));
            crate::winfocus::type_text(&text);
            println!("sent to {} [{}]", row.agent, basename(&row.project));
            0
        }
        #[cfg(not(windows))]
        {
            let _ = &text;
            eprintln!("agentpet send is only implemented on Windows");
            1
        }
    })
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n.saturating_sub(1)).collect::<String>() + "…"
    }
}

/// GET the running app's session list.
fn fetch() -> Result<Vec<SessionRow>, String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], HOOK_PORT));
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_millis(600))
        .map_err(|_| "AgentPet isn't running (start the pet first)".to_string())?;
    let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = s.set_write_timeout(Some(Duration::from_millis(600)));
    s.write_all(b"GET /sessions HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .map_err(|e| e.to_string())?;
    let mut resp = String::new();
    s.read_to_string(&mut resp).map_err(|e| e.to_string())?;
    let body = resp.split("\r\n\r\n").nth(1).unwrap_or("");
    serde_json::from_str(body).map_err(|e| format!("bad response from app: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(agent: &str, session: &str, state: &str, project: &str, title: &str) -> SessionRow {
        SessionRow {
            agent: agent.into(),
            session: session.into(),
            state: state.into(),
            project: project.into(),
            live: String::new(),
            title: title.into(),
            target: String::new(),
            updated_at: 0,
        }
    }

    #[test]
    fn matches_agent_kind() {
        let r = row("claude", "abc123", "working", "/home/me/app", "");
        assert!(matches(&r, "claude"));
        assert!(matches(&r, "Claude")); // case-insensitive
        assert!(!matches(&r, "codex"));
    }

    #[test]
    fn matches_session_prefix_project_and_title() {
        let r = row("codex", "abc123def", "working", "C:\\code\\my-app", "Fix the login bug");
        assert!(matches(&r, "abc12")); // session prefix
        assert!(matches(&r, "my-app")); // project basename
        assert!(matches(&r, "login")); // title substring
        assert!(!matches(&r, "zzz"));
    }

    #[test]
    fn settled_only_when_not_working() {
        assert!(!settled("working"));
        assert!(settled("done"));
        assert!(settled("waiting"));
        assert!(settled("registered"));
        assert!(settled("idle"));
    }

    #[test]
    fn truncate_adds_ellipsis() {
        assert_eq!(truncate("short", 22), "short");
        assert_eq!(truncate("a-very-long-project-name-here", 10), "a-very-lo…");
    }

    #[test]
    fn basename_handles_both_separators() {
        assert_eq!(basename("C:\\code\\my-app"), "my-app");
        assert_eq!(basename("/home/me/app/"), "app");
    }
}
