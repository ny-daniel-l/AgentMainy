//! Windows click-to-focus. The hook records the window hosting its agent plus
//! its ancestor process ids as `hwnd:<n>;pids:<a,b,...>`. On click we find the
//! agent's console from those pids: a Windows Terminal tab is selected through
//! UI Automation (matched by briefly retitling its console), a classic console
//! window is raised directly, and desktop apps fall back to the recorded window.

use windows_sys::Win32::Foundation::{CloseHandle, BOOL, HWND, INVALID_HANDLE_VALUE, LPARAM};
use windows_sys::Win32::System::Console::{
    AttachConsole, FreeConsole, GetConsoleTitleW, GetConsoleWindow, SetConsoleTitleW,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    KEYEVENTF_UNICODE, VK_MENU, VK_RETURN,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, EnumWindows, GetAncestor, GetClassNameW, GetForegroundWindow, GetWindow,
    GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow,
    ShowWindow, SwitchToThisWindow, GA_ROOTOWNER, GW_OWNER, SW_RESTORE, SW_SHOW,
};

/// (pid, parent pid, lowercase exe name) for every running process.
fn processes() -> Vec<(u32, u32, String)> {
    let mut out = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return out;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                let exe = String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase();
                out.push((e.th32ProcessID, e.th32ParentProcessID, exe));
                if Process32NextW(snap, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }
    out
}

unsafe extern "system" fn collect(h: HWND, l: LPARAM) -> BOOL {
    let v = &mut *(l as *mut Vec<(isize, u32)>);
    if IsWindowVisible(h) != 0 && GetWindow(h, GW_OWNER).is_null() && GetWindowTextLengthW(h) > 0 {
        let mut pid = 0u32;
        GetWindowThreadProcessId(h, &mut pid);
        v.push((h as isize, pid));
    }
    1
}

/// Visible, unowned, titled top-level windows as (hwnd, pid).
fn windows() -> Vec<(isize, u32)> {
    let mut v: Vec<(isize, u32)> = Vec::new();
    unsafe { EnumWindows(Some(collect), &mut v as *mut _ as LPARAM) };
    v
}

/// The focus target for this hook, as `hwnd:<n>;pids:<a,b,...>`. The window is
/// the nearest ancestor that owns one (Windows Terminal, VS Code, ...), else the
/// agent's desktop app by exe name (desktop apps run agents from a detached
/// server process). The pids let the click find the exact console tab.
pub fn focus_target(agent: &str) -> String {
    target_for(std::process::id(), agent, &processes(), &windows())
}

fn target_for(start: u32, agent: &str, procs: &[(u32, u32, String)], wins: &[(isize, u32)]) -> String {
    let mut pids = Vec::new();
    let mut host = None;
    let mut pid = start;
    for _ in 0..32 {
        let exe = procs.iter().find(|(p, _, _)| *p == pid).map(|(_, _, e)| e.as_str()).unwrap_or("");
        // Explorer owns the desktop and folder windows, never an agent's window.
        if exe == "explorer.exe" {
            break;
        }
        if let Some(&(h, _)) = wins.iter().find(|(_, p)| *p == pid) {
            host = Some(h);
            break;
        }
        pids.push(pid);
        match procs.iter().find(|(p, _, _)| *p == pid) {
            Some(&(_, parent, _)) if parent != 0 && parent != pid => pid = parent,
            _ => break,
        }
    }
    let apps: &[&str] = match agent {
        "codex" => &["chatgpt.exe", "codex.exe"],
        "claude" => &["claude.exe"],
        "cursor" => &["cursor.exe"],
        "windsurf" => &["windsurf.exe"],
        "antigravity" => &["antigravity.exe"],
        _ => &[],
    };
    let host = host.or_else(|| {
        wins.iter()
            .find(|(_, p)| procs.iter().any(|(pp, _, exe)| pp == p && apps.contains(&exe.as_str())))
            .map(|&(h, _)| h)
    });
    let pids: Vec<String> = pids.iter().map(|p| p.to_string()).collect();
    format!("hwnd:{};pids:{}", host.unwrap_or(0), pids.join(","))
}

/// AI command-line tools, by exe name.
const CLIS: &[(&str, &str, &str)] = &[
    ("claude.exe", "claude", "Claude Code"),
    ("codex.exe", "codex", "Codex CLI"),
    ("opencode.exe", "opencode", "OpenCode"),
    ("agy.exe", "antigravity", "Antigravity CLI"),
    ("copilot.exe", "copilot", "Copilot CLI"),
    ("gemini.exe", "gemini", "Gemini CLI"),
    ("cursor-agent.exe", "cursor", "Cursor CLI"),
    ("kiro-cli.exe", "kiro", "Kiro CLI"),
    ("grok.exe", "grok", "Grok CLI"),
];
/// AI desktop apps, by exe name (the Codex app ships as ChatGPT.exe).
const APPS: &[(&str, &str, &str)] = &[
    ("chatgpt.exe", "codex", "ChatGPT / Codex"),
    ("claude.exe", "claude", "Claude"),
    ("antigravity.exe", "antigravity", "Antigravity"),
    ("cursor.exe", "cursor", "Cursor"),
    ("windsurf.exe", "windsurf", "Windsurf"),
];

/// The pet attaches to one console at a time (listing and clicking both do).
static CONSOLE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// The console window and title of process `pid`, if it has a visible console
/// (a terminal tab or a classic console window , background helpers don't).
fn console_of(pid: u32) -> Option<(isize, String)> {
    unsafe {
        FreeConsole();
        if AttachConsole(pid) == 0 {
            return None;
        }
        let w = GetConsoleWindow();
        let ok = !w.is_null() && (class_name(w) == "PseudoConsoleWindow" || IsWindowVisible(w) != 0);
        let mut buf = [0u16; 512];
        let n = GetConsoleTitleW(buf.as_mut_ptr(), buf.len() as u32) as usize;
        FreeConsole();
        ok.then(|| (w as isize, String::from_utf16_lossy(&buf[..n.min(buf.len())])))
    }
}

fn window_title(h: isize) -> String {
    let mut buf = [0u16; 256];
    let n = unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::GetWindowTextW(h as HWND, buf.as_mut_ptr(), buf.len() as i32)
    };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

/// Every AI tool open right now, busy or idle: CLIs (one per console) and
/// desktop apps (one per window). Each carries a click-to-focus target.
pub fn list_open() -> Vec<serde_json::Value> {
    let _g = CONSOLE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let procs = processes();
    let wins = windows();
    let mut out = Vec::new();
    let mut seen_consoles = Vec::new();
    for (pid, _, exe) in &procs {
        if let Some(&(_, kind, name)) = APPS.iter().find(|(e, _, _)| e == exe) {
            for &(h, _) in wins.iter().filter(|(_, p)| p == pid) {
                out.push(serde_json::json!({
                    "kind": kind, "name": name, "title": window_title(h), "target": format!("hwnd:{h};pids:"),
                }));
            }
            if wins.iter().any(|(_, p)| p == pid) {
                continue; // claude.exe with a window is the desktop app, not the CLI
            }
        }
        let Some(&(_, kind, name)) = CLIS.iter().find(|(e, _, _)| e == exe) else { continue };
        let Some((console, title)) = console_of(*pid) else { continue };
        // Children of a CLI (sandboxes, helpers) share its console: list it once.
        if seen_consoles.contains(&(console, kind)) {
            continue;
        }
        seen_consoles.push((console, kind));
        out.push(serde_json::json!({
            "kind": kind, "name": name, "title": title, "target": target_for(*pid, kind, &procs, &wins),
        }));
    }
    out
}

fn class_name(h: HWND) -> String {
    let mut buf = [0u16; 64];
    let n = unsafe { GetClassNameW(h, buf.as_mut_ptr(), buf.len() as i32) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

/// Restore and bring a top-level window to the foreground. Windows refuses a
/// foreground change from a background process, so we lift the lock with a
/// synthetic Alt tap, then BringWindowToTop + SetForegroundWindow, and fall back
/// to SwitchToThisWindow (the Alt-Tab path) which ignores that restriction.
fn raise(hwnd: HWND) {
    unsafe {
        if IsWindow(hwnd) == 0 {
            crate::dlog(&format!("raise: hwnd {} is not a window", hwnd as isize));
            return;
        }
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, SW_RESTORE);
        } else {
            ShowWindow(hwnd, SW_SHOW);
        }
        keybd_event(VK_MENU as u8, 0, 0, 0);
        keybd_event(VK_MENU as u8, 0, KEYEVENTF_KEYUP, 0);
        BringWindowToTop(hwnd);
        let ok = SetForegroundWindow(hwnd);
        if ok == 0 {
            SwitchToThisWindow(hwnd, 1);
        }
        let fg = GetForegroundWindow();
        crate::dlog(&format!(
            "raise: hwnd={} setfg={} fg_now={} ({})",
            hwnd as isize, ok, fg as isize, window_title(fg as isize)
        ));
    }
}

/// Select the Windows Terminal tab whose console the process `pid` uses: give
/// that console a unique title, find the tab showing it, select it, restore.
/// Returns the terminal window on success.
fn select_terminal_tab(pid: u32) -> Option<HWND> {
    unsafe {
        FreeConsole();
        if AttachConsole(pid) == 0 {
            return None;
        }
        let pseudo = GetConsoleWindow();
        let result = (|| {
            if pseudo.is_null() {
                return None;
            }
            if class_name(pseudo) != "PseudoConsoleWindow" {
                // A classic console window: raising it is enough (hidden ones
                // belong to background helpers, not a tab).
                return (IsWindowVisible(pseudo) != 0).then_some(pseudo);
            }
            let terminal = GetAncestor(pseudo, GA_ROOTOWNER);
            let mut old = [0u16; 1024];
            let n = GetConsoleTitleW(old.as_mut_ptr(), old.len() as u32) as usize;
            let marker = format!("agentpet-focus-{pid}");
            let wide: Vec<u16> = marker.encode_utf16().chain(Some(0)).collect();
            SetConsoleTitleW(wide.as_ptr());
            // The terminal repaints the tab title asynchronously. If the user
            // renamed the tab the marker never shows; we still raise the window.
            for _ in 0..10 {
                std::thread::sleep(std::time::Duration::from_millis(50));
                if uia_select(terminal, &marker) {
                    break;
                }
            }
            let restore: Vec<u16> = old[..n.min(old.len())].iter().copied().chain(Some(0)).collect();
            SetConsoleTitleW(restore.as_ptr());
            Some(terminal)
        })();
        FreeConsole();
        result
    }
}

/// Select the tab named `name` inside `terminal` via UI Automation.
fn uia_select(terminal: HWND, name: &str) -> bool {
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationSelectionItemPattern, TreeScope_Subtree, UIA_NamePropertyId,
        UIA_SelectionItemPatternId,
    };
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let run = || -> windows::core::Result<()> {
            let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
            let root = uia.ElementFromHandle(windows::Win32::Foundation::HWND(terminal))?;
            let cond = uia.CreatePropertyCondition(UIA_NamePropertyId, &VARIANT::from(name))?;
            let tab = root.FindFirst(TreeScope_Subtree, &cond)?;
            let sel: IUIAutomationSelectionItemPattern = tab.GetCurrentPatternAs(UIA_SelectionItemPatternId)?;
            sel.Select()
        };
        run().is_ok()
    }
}

/// Type `text` into the foreground window as Unicode keystrokes, then Enter
/// (for `agentpet send`). The caller focuses the agent's terminal first; this
/// has no handle to the pane, so it is best-effort , keystrokes go wherever
/// focus landed. shortcut: raw SendInput, no bracketed paste; a terminal that
/// isn't at its prompt, or a non-BMP glyph, may not receive it cleanly.
pub fn type_text(text: &str) {
    fn key(scan: u16, vk: u16, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 },
            },
        }
    }
    let mut inputs: Vec<INPUT> = Vec::with_capacity(text.len() * 2 + 2);
    for u in text.encode_utf16() {
        inputs.push(key(u, 0, KEYEVENTF_UNICODE));
        inputs.push(key(u, 0, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
    }
    inputs.push(key(0, VK_RETURN, 0));
    inputs.push(key(0, VK_RETURN, KEYEVENTF_KEYUP));
    unsafe {
        SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
    }
}

/// Handle a click on a session row: `target` is what `focus_target` produced.
pub fn focus(target: &str) {
    let _g = CONSOLE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut hwnd: isize = 0;
    let mut pids: Vec<u32> = Vec::new();
    for part in target.split(';') {
        if let Some(h) = part.strip_prefix("hwnd:") {
            hwnd = h.parse().unwrap_or(0);
        } else if let Some(p) = part.strip_prefix("pids:") {
            pids = p.split(',').filter_map(|s| s.parse().ok()).collect();
        }
    }
    crate::dlog(&format!("focus: target={target}"));
    // Nearest process to the host first: that's the agent or its shell, which
    // own the tab's console (the hook itself runs in a hidden one).
    for &pid in pids.iter().rev() {
        if let Some(w) = select_terminal_tab(pid) {
            crate::dlog(&format!("focus: selected tab via pid {pid} -> hwnd {}", w as isize));
            raise(w);
            return;
        }
    }
    if hwnd != 0 {
        crate::dlog(&format!("focus: no tab matched; raising recorded hwnd {hwnd}"));
        raise(hwnd as HWND);
    } else {
        crate::dlog("focus: no tab and no recorded hwnd , nothing to focus");
    }
}
