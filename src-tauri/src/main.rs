// Prevents an extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Fix a blank/white WebView on some Linux setups: newer WebKitGTK (2.42+)
    // uses a DMABUF renderer that fails to composite on certain GPU/compositor
    // combos (notably KDE + Wayland), leaving the window blank. Disable it unless
    // the user set their own value. Set before the webview initializes. (#52)
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let args: Vec<String> = std::env::args().collect();
    // Invoked by an agent's hook: `agentpet hook --agent <kind>` (reads stdin).
    if args.get(1).map(String::as_str) == Some("hook") {
        agentpet_lib::cli::run_hook(&args[2..]);
        return;
    }
    // `agentpet install <kind>...`: connect agents without opening Settings.
    // Writes results to a file next to the exe since release builds have no console.
    if args.get(1).map(String::as_str) == Some("install") {
        let report: Vec<String> = args[2..].iter()
            .map(|k| format!("{k}: {:?}", agentpet_lib::hooks::ensure_installed(k)))
            .collect();
        let _ = std::fs::write(std::env::temp_dir().join("agentpet-install.txt"), report.join("\n"));
        return;
    }
    // `agentpet focus [agent]`: debug click-to-focus from a terminal , computes
    // this process's focus target like a hook would and focuses it.
    #[cfg(windows)]
    if args.get(1).map(String::as_str) == Some("focus") {
        let target = agentpet_lib::winfocus::focus_target(args.get(2).map(String::as_str).unwrap_or(""));
        let _ = std::fs::write(std::env::temp_dir().join("agentpet-focus.txt"), &target);
        agentpet_lib::winfocus::focus(&target);
        return;
    }
    // `agentpet focusraw "<target>"`: focus an exact target string (as a click
    // would), for debugging the focus path without the overlay.
    #[cfg(windows)]
    if args.get(1).map(String::as_str) == Some("focusraw") {
        if let Some(target) = args.get(2) {
            agentpet_lib::winfocus::focus(target);
        }
        return;
    }
    // `agentpet list`: debug the open-AIs list (written next to the focus file).
    #[cfg(windows)]
    if args.get(1).map(String::as_str) == Some("list") {
        let list = serde_json::to_string_pretty(&agentpet_lib::winfocus::list_open()).unwrap_or_default();
        let _ = std::fs::write(std::env::temp_dir().join("agentpet-list.json"), list);
        return;
    }
    // `agentpet run [--session id] [--project path] [--agent kind] -- <cmd...>`:
    // wraps any CLI agent , working while it runs, done when it exits.
    if args.get(1).map(String::as_str) == Some("run") {
        agentpet_lib::cli::run_wrapper(&args[2..]);
    }
    // `agentpet ls|peek|wait|send`: read/await/message the agents the pet sees
    // (talks to the running app over its localhost port).
    if matches!(args.get(1).map(String::as_str), Some("ls" | "peek" | "wait" | "send")) {
        std::process::exit(agentpet_lib::orch::run(&args[1..]));
    }
    agentpet_lib::run();
}
