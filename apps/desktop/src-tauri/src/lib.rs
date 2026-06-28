// LEDrums desktop shell (Tauri 2).
//
// Responsibilities (S4 Phase 1):
//   1. Spawn the bundled server SIDECAR on a fixed local port, pointing its persistence at the
//      OS app-data dir and its web root + cloudflared at bundled resources.
//   2. Capture the sidecar's stdout/stderr, parse the boot banner for the tunnel URL + room
//      PIN + local URL, and surface them in a small native "share" window (the in-webview
//      ShareInfo is gated, so the host needs an out-of-band PIN-discovery surface).
//   3. Open the FULL app in a second webview window pointed at the local origin — single origin
//      means the UI + WebSocket share the tunnel and reuse the web PinGate/ShareInfo.
//   4. On exit, send the sidecar SIGTERM (graceful: it stops cloudflared + flushes autosaves),
//      then guarantee it's gone — no orphaned processes.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Default local port for the embedded server — distinct from dev's 4321 so a running `pnpm dev`
/// never collides with the packaged app. Overridable via `LEDRUMS_DESKTOP_PORT`.
const DEFAULT_PORT: u16 = 4178;

/// Holds the live sidecar child so shutdown can terminate it. `None` once taken/terminated.
#[derive(Default)]
struct SidecarState(Mutex<Option<CommandChild>>);

/// Boot status pushed to the native share window as the banner is parsed. Field names match the
/// keys the share page (`shell/index.html`) reads.
#[derive(Default, Clone, Serialize)]
struct BootStatus {
    /// "starting" | "running" | "no-tunnel"
    stage: String,
    #[serde(rename = "localUrl")]
    local_url: Option<String>,
    #[serde(rename = "tunnelUrl")]
    tunnel_url: Option<String>,
    pin: Option<String>,
}

fn resolve_port() -> u16 {
    std::env::var("LEDRUMS_DESKTOP_PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT)
}

/// Extract the first `https://*.trycloudflare.com` URL from a line (mirrors the server's regex).
fn parse_tunnel_url(line: &str) -> Option<String> {
    let re = regex::Regex::new(r"https://[A-Za-z0-9][A-Za-z0-9-]*\.trycloudflare\.com").unwrap();
    re.find(line).map(|m| m.as_str().to_string())
}

/// Extract the room PIN — the banner prints it both as `(PIN <digits>)` on the tunnel line and as
/// `Room PIN: <digits>` (the latter prints even if the tunnel later fails, so it is the reliable
/// source).
fn parse_pin(line: &str) -> Option<String> {
    let re = regex::Regex::new(r"(?:\(PIN |Room PIN: )(\d{4,})").unwrap();
    re.captures(line)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

/// Open the full-app webview window at the local origin (idempotent).
fn open_app_window(app: &AppHandle, port: u16) {
    if app.get_webview_window("app").is_some() {
        return;
    }
    let url = format!("http://127.0.0.1:{port}");
    match url.parse() {
        Ok(parsed) => {
            let _ = WebviewWindowBuilder::new(app, "app", WebviewUrl::External(parsed))
                .title("LEDrums")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .build();
        }
        Err(e) => eprintln!("[desktop] bad app url {url}: {e}"),
    }
}

/// Send SIGTERM to the sidecar for a graceful shutdown (stops cloudflared + flushes autosaves),
/// then ensure it is gone. Idempotent — the child handle is taken on first call.
fn terminate_sidecar(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    let child = state.0.lock().ok().and_then(|mut g| g.take());
    let Some(child) = child else { return };

    #[cfg(unix)]
    {
        // SIGTERM → the server's idempotent graceful shutdown (boot.ts) runs: tunnel stop, IO
        // close, autosave flush, exit(0). Give it a moment, then SIGKILL as a backstop so a
        // wedged process (or its cloudflared child) can never orphan.
        let pid = child.pid() as i32;
        unsafe {
            libc::kill(pid, libc::SIGTERM);
        }
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let _ = child.kill(); // no-op if already exited; SIGKILL backstop otherwise
    }
    #[cfg(not(unix))]
    {
        // No POSIX signals on Windows — the shell plugin's kill() terminates the process tree.
        let _ = child.kill();
    }
}

/// Spawn the server sidecar and wire its banner output to the native share surface + app window.
fn spawn_sidecar(app: &AppHandle, port: u16) -> Result<(), String> {
    // App-data projects dir (where a sandboxed binary can actually write); created if missing.
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let projects_dir = app_data.join("projects");
    std::fs::create_dir_all(&projects_dir).map_err(|e| format!("create projects dir: {e}"))?;

    // Bundled web UI + cloudflared resources.
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?;
    let web_root = resource_dir.join("web-dist");
    let cloudflared_name = if cfg!(windows) { "cloudflared.exe" } else { "cloudflared" };
    let cloudflared = resource_dir.join("cloudflared").join(cloudflared_name);
    let has_cloudflared = cloudflared.exists();

    let mut cmd = app
        .shell()
        .sidecar("ledrums-server")
        .map_err(|e| format!("sidecar: {e}"))?
        .env("PORT", port.to_string())
        .env("LEDRUMS_PROJECTS_DIR", projects_dir.to_string_lossy().to_string())
        .env("LEDRUMS_WEB_ROOT", web_root.to_string_lossy().to_string());

    // Only enable the tunnel when a cloudflared binary was actually bundled — otherwise the app
    // degrades gracefully to local/LAN access (and no PIN is generated).
    if has_cloudflared {
        cmd = cmd
            .env("LEDRUMS_TUNNEL", "quick")
            .env("LEDRUMS_TUNNEL_BIN", cloudflared.to_string_lossy().to_string());
    }

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn sidecar: {e}"))?;
    *app.state::<SidecarState>().0.lock().unwrap() = Some(child);

    // Seed + emit the initial status.
    let mut status = BootStatus {
        stage: if has_cloudflared { "starting".into() } else { "no-tunnel".into() },
        ..Default::default()
    };
    let _ = app.emit("boot://status", status.clone());

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut app_window_opened = false;
        while let Some(event) = rx.recv().await {
            let line = match &event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    String::from_utf8_lossy(bytes).to_string()
                }
                _ => continue,
            };
            // Mirror the sidecar's logs to our console for debugging.
            print!("[sidecar] {line}");

            let mut changed = false;

            if !app_window_opened && line.contains("listening on") {
                status.stage = if has_cloudflared { "running".into() } else { "no-tunnel".into() };
                status.local_url = Some(format!("http://127.0.0.1:{port}"));
                open_app_window(&app_handle, port);
                app_window_opened = true;
                changed = true;
            }
            if status.tunnel_url.is_none() {
                if let Some(url) = parse_tunnel_url(&line) {
                    status.tunnel_url = Some(url);
                    changed = true;
                }
            }
            if status.pin.is_none() {
                if let Some(pin) = parse_pin(&line) {
                    status.pin = Some(pin);
                    changed = true;
                }
            }
            // The server reports a tunnel start failure but keeps serving locally — reflect that.
            if has_cloudflared && line.contains("[tunnel] failed to start") {
                status.stage = "no-tunnel".into();
                changed = true;
            }

            if changed {
                let _ = app_handle.emit("boot://status", status.clone());
            }
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = resolve_port();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(SidecarState::default())
        .setup(move |app| {
            if let Err(e) = spawn_sidecar(app.handle(), port) {
                // A failed sidecar is fatal to the app's purpose — surface it loudly. The share
                // window stays up showing "Starting…" so the failure is visible, not silent.
                eprintln!("[desktop] failed to start server sidecar: {e}");
            }
            Ok(())
        })
        // Closing any window quits the whole app — this makes the macOS "window closed but app
        // lives" case truly stop everything (the Exit handler below SIGTERMs the sidecar).
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building LEDrums desktop app");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            terminate_sidecar(app_handle);
        }
    });
}
