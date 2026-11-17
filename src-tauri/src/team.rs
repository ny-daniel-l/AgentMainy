//! The team engine: UltraClaude (vendored in `engine/ultraclaude`), a Node.js
//! server that runs a team of Claude Code agents for one project folder, with
//! roles, shared Obsidian memory, a task board and real terminals.
//!
//! We only drive its own CLI in the chosen folder (`ultraclaude --no-open`,
//! `stop`, `status`) and hand the dashboard the private URL it prints
//! (`http://127.0.0.1:<port>/?t=<token>`); the Team page shows that in a frame.

use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

/// Bundled next to the installed app, or the repo's `engine/ultraclaude` in dev.
fn engine_script(app: &tauri::AppHandle) -> Option<PathBuf> {
    let bundled = app.path().resource_dir().ok().map(|d| d.join("engine").join("ultraclaude"));
    let dev = Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("engine").join("ultraclaude"));
    [bundled, dev]
        .into_iter()
        .flatten()
        .map(|d| d.join("bin").join("ultraclaude.js"))
        .find(|p| p.exists())
        .map(plain_path)
}

/// Node cannot run a script from a verbatim Windows path (`\\?\C:\...`, which
/// resource_dir returns): it fails with "EISDIR: illegal operation on a directory, lstat 'C:'".
fn plain_path(p: PathBuf) -> PathBuf {
    match p.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => p,
    }
}

/// Runs `node ultraclaude.js <args>` in `folder` and returns its stdout.
async fn run_cli(app: tauri::AppHandle, folder: String, args: Vec<&'static str>) -> Result<String, String> {
    let dir = PathBuf::from(&folder);
    if !dir.is_dir() {
        return Err(format!("Folder not found: {folder}"));
    }
    let script = engine_script(&app)
        .ok_or("Team engine missing: run `npm install` in engine/ultraclaude.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("node");
        cmd.arg(script).args(args).current_dir(dir);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash
        }
        let out = cmd
            .output()
            .map_err(|e| format!("Could not start Node.js ({e}). Install Node 20+ from nodejs.org."))?;
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        if out.status.success() {
            Ok(text)
        } else {
            Err(format!("{}{}", text.trim(), String::from_utf8_lossy(&out.stderr).trim()))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn find_url(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|w| w.starts_with("http://127.0.0.1:"))
        .map(str::to_string)
}

/// Starts (or reuses) the team server for `folder`; returns its private URL.
#[tauri::command]
pub async fn team_open(app: tauri::AppHandle, folder: String) -> Result<String, String> {
    let out = run_cli(app, folder, vec!["--no-open"]).await?;
    find_url(&out).ok_or_else(|| format!("The team engine did not start: {}", out.trim()))
}

/// The running team server's URL for `folder`, or None.
#[tauri::command]
pub async fn team_status(app: tauri::AppHandle, folder: String) -> Result<Option<String>, String> {
    Ok(find_url(&run_cli(app, folder, vec!["status"]).await?))
}

/// Stops the team server and all its agents for `folder`.
#[tauri::command]
pub async fn team_stop(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    run_cli(app, folder, vec!["stop"]).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::{find_url, plain_path};
    use std::path::PathBuf;

    #[test]
    fn drops_the_verbatim_prefix_node_cannot_handle() {
        let plain = |s: &str| plain_path(PathBuf::from(s)).to_string_lossy().into_owned();
        assert_eq!(plain(r"\\?\C:\Users\x\engine\ultraclaude\bin\ultraclaude.js"), r"C:\Users\x\engine\ultraclaude\bin\ultraclaude.js");
        assert_eq!(plain(r"C:\Users\x\a.js"), r"C:\Users\x\a.js");
        assert_eq!(plain(r"\\?\UNC\server\share\a.js"), r"\\?\UNC\server\share\a.js"); // not a drive path: unchanged
    }

    #[test]
    fn finds_the_private_url_in_cli_output() {
        let out = "UltraClaude is running for C:\\p\nhttp://127.0.0.1:51234/?t=abc123\n";
        assert_eq!(find_url(out).as_deref(), Some("http://127.0.0.1:51234/?t=abc123"));
        assert_eq!(find_url("Running: http://127.0.0.1:9/?t=x").as_deref(), Some("http://127.0.0.1:9/?t=x"));
        assert_eq!(find_url("UltraClaude is not running for this folder."), None);
    }
}
