// LEDrums desktop shell (Tauri 2).
//
// Responsibilities (S4 Phase 1):
//   1. Spawn the bundled server SIDECAR on a free local port, pointing its persistence at the
//      OS app-data dir and its web root + cloudflared at bundled resources.
//   2. Capture the sidecar's stdout/stderr (line-buffered), parse the boot banner for the tunnel
//      URL + room PIN + local URL, and surface them in a small native "share" window (the
//      in-webview ShareInfo is gated, so the host needs an out-of-band PIN-discovery surface).
//   3. Open the FULL app in a second webview window pointed at the local origin — single origin
//      means the UI + WebSocket share the tunnel and reuse the web PinGate/ShareInfo.
//   4. On exit, send the sidecar SIGTERM (graceful: it stops cloudflared + flushes autosaves),
//      then guarantee it's gone — no orphaned processes.

mod native_midi;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{
    webview::PageLoadEvent, AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

/// Fallback local port if free-port allocation fails. Overridable via `LEDRUMS_DESKTOP_PORT`.
const DEFAULT_PORT: u16 = 4178;

/// Live sidecar child + an intentional-shutdown flag (so a Terminated event during quit is not
/// mis-reported as a crash to the share window).
#[derive(Default)]
struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    shutting_down: AtomicBool,
}

/// Keeps the native MIDI virtual destination alive for the app lifetime.
#[derive(Default)]
struct NativeMidiState(Mutex<Option<native_midi::NativeMidiBridge>>);

/// Boot status pushed to the native share window as the banner is parsed, and held in app state
/// so the share page can pull the latest snapshot on load (events alone are race-prone — they can
/// fire before the page registers its listener). Field names match the keys `shell/main.js` reads.
#[derive(Default, Clone, Serialize)]
struct BootStatus {
    /// "starting" | "running" | "no-tunnel" | "updating" | "error"
    stage: String,
    #[serde(rename = "localUrl")]
    local_url: Option<String>,
    #[serde(rename = "tunnelUrl")]
    tunnel_url: Option<String>,
    pin: Option<String>,
    /// Human-readable failure detail when `stage == "error"`.
    message: Option<String>,
}

/// The latest boot status, shared between the sidecar reader task and the `get_boot_status` command.
#[derive(Default)]
struct BootState(Mutex<BootStatus>);

/// Store the latest status in app state AND emit it — so both a freshly-loaded page (which pulls via
/// `get_boot_status`) and an already-listening page (which gets the event) stay current.
fn publish(app: &AppHandle, status: &BootStatus) {
    if let Some(state) = app.try_state::<BootState>() {
        if let Ok(mut g) = state.0.lock() {
            *g = status.clone();
        }
    }
    let _ = app.emit("boot://status", status.clone());
}

/// The share page calls this once after registering its event listener, to recover any status that
/// was published before the listener existed.
#[tauri::command]
fn get_boot_status(state: State<'_, BootState>) -> BootStatus {
    state.0.lock().map(|g| g.clone()).unwrap_or_default()
}

/// Pick the local port: an explicit non-zero `LEDRUMS_DESKTOP_PORT`, else an OS-allocated free port
/// (bind :0, read it back, drop the listener). A free port avoids a hard failure when the fixed
/// default is already taken; the tiny bind→spawn race is covered by the sidecar exit/error handling.
fn resolve_port() -> u16 {
    if let Ok(v) = std::env::var("LEDRUMS_DESKTOP_PORT") {
        if let Ok(n) = v.trim().parse::<u16>() {
            if n != 0 {
                return n;
            }
        }
    }
    std::net::TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .unwrap_or(DEFAULT_PORT)
}

/// Extract the first `https://*.trycloudflare.com` URL from a line (mirrors the server's regex).
fn parse_tunnel_url(line: &str) -> Option<String> {
    let re = regex::Regex::new(r"https://[A-Za-z0-9][A-Za-z0-9-]*\.trycloudflare\.com").unwrap();
    re.find(line).map(|m| m.as_str().to_string())
}

/// Extract the room PIN from the banner — printed both as `(PIN <pin>)` on the tunnel line and as
/// `Room PIN: <pin>` (the latter prints even if the tunnel later fails, so it is the reliable
/// source). The server accepts ANY non-empty `LEDRUMS_PIN`, so the token is captured up to the next
/// whitespace or `)` rather than assuming digits.
fn parse_pin(line: &str) -> Option<String> {
    let re = regex::Regex::new(r"(?:\(PIN |Room PIN: )([^\s)]+)").unwrap();
    re.captures(line)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

/// Extract the per-run host-session token from the banner (`Host token: <hex>`). The server prints it
/// to local stdout only; we inject it into the host app window URL so its WebSocket is admitted
/// without the room PIN (loopback alone is not proof of the host — see the server pin-gate).
fn parse_host_token(line: &str) -> Option<String> {
    let re = regex::Regex::new(r"Host token: ([^\s]+)").unwrap();
    re.captures(line)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

/// Open the full-app webview window at the local origin (idempotent). Once its page finishes
/// loading, the transient "splash" window is closed — so there is no lingering second window; the
/// shareable URL/PIN live in the app's own UI (the host auto-connects, see the PIN gate bypass).
fn open_app_window(app: &AppHandle, port: u16, host_token: Option<&str>) {
    if app.get_webview_window("app").is_some() {
        return;
    }
    // The host token rides the URL *fragment* (`#hostToken=…`), which the webview keeps client-side
    // and never sends to the server as part of any HTTP request — the web app reads it from
    // `location.hash`, presents it on the WebSocket connect URL, then strips it from the address bar.
    let url = match host_token {
        Some(token) => format!("http://127.0.0.1:{port}/#hostToken={token}"),
        None => format!("http://127.0.0.1:{port}"),
    };
    match url.parse() {
        Ok(parsed) => {
            let _ = WebviewWindowBuilder::new(app, "app", WebviewUrl::External(parsed))
                .title("LEDrums")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .on_page_load(|window, payload| {
                    if payload.event() == PageLoadEvent::Finished {
                        if let Some(splash) = window.app_handle().get_webview_window("splash") {
                            let _ = splash.close();
                        }
                    }
                })
                .build();
        }
        Err(e) => eprintln!("[desktop] bad app url {url}: {e}"),
    }
}

fn start_native_midi(app: &AppHandle, port: u16, host_token: &str) {
    let state = app.state::<NativeMidiState>();
    let mut guard = state.0.lock().unwrap();
    if guard.is_some() {
        return;
    }
    match native_midi::NativeMidiBridge::start(port, host_token.to_string()) {
        Ok(bridge) => {
            *guard = Some(bridge);
        }
        Err(err) => {
            eprintln!("[native-midi] failed to start: {err}");
        }
    }
}

/// Re-create the transient splash/progress window if it has already been closed (`open_app_window`
/// closes it once the app window finishes loading). An update accepted AFTER the app is up would
/// otherwise download with no visible surface — the `boot://status` progress stream would have
/// nothing to render on. Reopening reuses the same window label/url/size as `tauri.conf.json`, so the
/// existing `shell/main.js` status rendering (incl. the `stage: "updating"` branch) is reused as-is.
/// Idempotent: a no-op if the splash is still open. Closed again on update failure/cancel.
fn ensure_splash_window(app: &AppHandle) {
    if app.get_webview_window("splash").is_some() {
        return;
    }
    if let Err(e) = WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("index.html".into()))
        .title("LEDrums")
        .inner_size(460.0, 380.0)
        .resizable(false)
        .center()
        .build()
    {
        eprintln!("[updater] could not reopen progress splash: {e}");
    }
}

/// Send SIGTERM to the sidecar for a graceful shutdown (stops cloudflared + flushes autosaves),
/// then ensure it is gone. Idempotent — the child handle is taken on first call.
fn terminate_sidecar(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    state.shutting_down.store(true, Ordering::SeqCst);
    let child = state.child.lock().ok().and_then(|mut g| g.take());
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
    let cloudflared_name = if cfg!(windows) {
        "cloudflared.exe"
    } else {
        "cloudflared"
    };
    let cloudflared = resource_dir.join("cloudflared").join(cloudflared_name);
    let has_cloudflared = cloudflared.exists();

    let mut cmd = app
        .shell()
        .sidecar("ledrums-server")
        .map_err(|e| format!("sidecar: {e}"))?
        .env("PORT", port.to_string())
        .env(
            "LEDRUMS_PROJECTS_DIR",
            projects_dir.to_string_lossy().to_string(),
        )
        .env("LEDRUMS_WEB_ROOT", web_root.to_string_lossy().to_string())
        // The desktop app is the drummer's live rig, which runs the voice-bus engine. The server
        // defaults to the legacy engine unless LEDRUMS_ENGINE=voice, so set it here (matching how
        // `pnpm dev` is run) — otherwise the packaged app silently runs a different engine than
        // dev (patch-graph edits don't drive routing, triggers don't fire, etc.). Respect an
        // explicit override from the launching environment for debugging.
        .env(
            "LEDRUMS_ENGINE",
            std::env::var("LEDRUMS_ENGINE").unwrap_or_else(|_| "voice".into()),
        );

    // Only enable the tunnel when a cloudflared binary was actually bundled — otherwise the app
    // degrades gracefully to local/LAN access (and no PIN is generated).
    if has_cloudflared {
        cmd = cmd.env("LEDRUMS_TUNNEL", "quick").env(
            "LEDRUMS_TUNNEL_BIN",
            cloudflared.to_string_lossy().to_string(),
        );
    }

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn sidecar: {e}"))?;
    *app.state::<SidecarState>().child.lock().unwrap() = Some(child);

    // Seed + publish the initial status.
    let mut status = BootStatus {
        stage: if has_cloudflared {
            "starting".into()
        } else {
            "no-tunnel".into()
        },
        ..Default::default()
    };
    publish(app, &status);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut app_window_opened = false;
        // The app window and native MIDI bridge both use the host token. The token line prints a
        // beat after "listening on", so hold off until the server has printed it.
        let mut listening_seen = false;
        let mut host_token: Option<String> = None;
        let mut native_midi_started = false;
        let mut buf = String::new();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    buf.push_str(&String::from_utf8_lossy(&bytes));
                    // Process COMPLETE lines only — a raw command chunk can split a banner line
                    // across two events, which would defeat the URL/PIN regexes.
                    while let Some(nl) = buf.find('\n') {
                        let line: String = buf.drain(..=nl).collect();
                        let line = line.trim_end();
                        println!("[sidecar] {line}");

                        let mut changed = false;
                        if !listening_seen && line.contains("listening on") {
                            status.stage = if has_cloudflared {
                                "running".into()
                            } else {
                                "no-tunnel".into()
                            };
                            status.local_url = Some(format!("http://127.0.0.1:{port}"));
                            listening_seen = true;
                            changed = true;
                        }
                        if host_token.is_none() {
                            if let Some(t) = parse_host_token(line) {
                                host_token = Some(t);
                            }
                        }
                        // Open the app window once the server is up AND we have the host token — or,
                        // when no tunnel was bundled, immediately (no token/PIN will ever print).
                        if !native_midi_started && listening_seen {
                            if let Some(token) = host_token.as_deref() {
                                start_native_midi(&app_handle, port, token);
                                native_midi_started = true;
                            }
                        }
                        if !app_window_opened && listening_seen && host_token.is_some() {
                            open_app_window(&app_handle, port, host_token.as_deref());
                            app_window_opened = true;
                        }
                        if status.tunnel_url.is_none() {
                            if let Some(url) = parse_tunnel_url(line) {
                                status.tunnel_url = Some(url);
                                changed = true;
                            }
                        }
                        if status.pin.is_none() {
                            if let Some(pin) = parse_pin(line) {
                                status.pin = Some(pin);
                                changed = true;
                            }
                        }
                        // The server reports a tunnel start failure but keeps serving locally.
                        if has_cloudflared && line.contains("[tunnel] failed to start") {
                            status.stage = "no-tunnel".into();
                            changed = true;
                        }
                        if changed {
                            publish(&app_handle, &status);
                        }
                    }
                }
                CommandEvent::Error(err) if !shutting_down(&app_handle) => {
                    status.stage = "error".into();
                    status.message = Some(format!("server process error: {err}"));
                    publish(&app_handle, &status);
                }
                CommandEvent::Terminated(payload) => {
                    // A crash/early-exit (not our own quit) leaves the share window stuck otherwise —
                    // surface it as a visible error state.
                    if !shutting_down(&app_handle) {
                        status.stage = "error".into();
                        status.message = Some(format!(
                            "the server exited unexpectedly (code {:?}, signal {:?})",
                            payload.code, payload.signal
                        ));
                        publish(&app_handle, &status);
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn shutting_down(app: &AppHandle) -> bool {
    app.try_state::<SidecarState>()
        .map(|s| s.shutting_down.load(Ordering::SeqCst))
        .unwrap_or(false)
}

/// Dev escape hatch: skip the OTA check when `LEDRUMS_SKIP_UPDATE` is set to anything truthy
/// (`1`, `true`, …). Empty / `0` / `false` are treated as "don't skip".
fn skip_update_check() -> bool {
    std::env::var("LEDRUMS_SKIP_UPDATE")
        .map(|v| {
            let v = v.trim();
            !v.is_empty() && v != "0" && !v.eq_ignore_ascii_case("false")
        })
        .unwrap_or(false)
}

/// Whole-bundle OTA: check the configured endpoint for a newer SIGNED build and, if the user
/// accepts, download + install it and restart. Because the server sidecar + web UI + cloudflared
/// are all bundled INSIDE the `.app`, this updates EVERYTHING at once; after the restart the app
/// boots fresh and mints a new tunnel URL + PIN.
///
/// Runs as a background task and MUST NOT block startup. Any failure — offline, placeholder /
/// unreachable endpoint, OTA not configured yet — is logged and swallowed so the app starts
/// normally with the current version.
async fn check_for_update(app: AppHandle) {
    if skip_update_check() {
        println!("[updater] LEDRUMS_SKIP_UPDATE set — skipping update check");
        return;
    }

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            eprintln!("[updater] updater unavailable ({e}); continuing without OTA");
            return;
        }
    };

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            println!("[updater] up to date");
            return;
        }
        Err(e) => {
            // Offline, placeholder endpoint, or OTA not provisioned yet — degrade gracefully.
            eprintln!("[updater] check failed ({e}); continuing without OTA");
            return;
        }
    };

    println!("[updater] update available: v{}", update.version);

    // Ask on the Tauri-privileged splash surface. `blocking_show` dispatches to the main thread and
    // blocks the caller until answered, so run it on the blocking pool to keep the async runtime
    // free for the concurrently-booting sidecar.
    let prompt_app = app.clone();
    let version = update.version.clone();
    let accepted = tauri::async_runtime::spawn_blocking(move || {
        prompt_app
            .dialog()
            .message(format!(
                "A new version of LEDrums (v{version}) is available.\n\nDownload and restart now? \
                 The whole app updates and reconnects with a fresh share link."
            ))
            .title("Update available")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Update & Restart".to_string(),
                "Later".to_string(),
            ))
            .blocking_show()
    })
    .await
    .unwrap_or(false);

    if !accepted {
        println!("[updater] user declined the update");
        return;
    }

    // Make download progress visible. By now the splash may already be closed (open_app_window
    // closes it once the app window loads), so an update accepted mid-session would otherwise show
    // nothing until the restart. Reopen the splash so the `boot://status` progress stream has a
    // surface again; it's closed below on failure (on success the app restarts anyway).
    ensure_splash_window(&app);

    // Best-effort download progress on the splash. `publish` updates shared state and emits to the
    // (now-reopened) splash. `on_chunk` is an immutable `Fn`, so accumulate the running byte count
    // through an atomic.
    publish(
        &app,
        &BootStatus {
            stage: "updating".into(),
            message: Some("Starting download…".into()),
            ..Default::default()
        },
    );

    let progress_app = app.clone();
    let downloaded = Arc::new(AtomicU64::new(0));
    let result = update
        .download_and_install(
            move |chunk_len, content_len| {
                let total =
                    downloaded.fetch_add(chunk_len as u64, Ordering::Relaxed) + chunk_len as u64;
                let message = match content_len {
                    Some(len) if len > 0 => {
                        let pct = (total as f64 / len as f64 * 100.0).round() as u64;
                        format!("Downloading update… {pct}%")
                    }
                    _ => format!("Downloading update… {total} bytes"),
                };
                publish(
                    &progress_app,
                    &BootStatus {
                        stage: "updating".into(),
                        message: Some(message),
                        ..Default::default()
                    },
                );
            },
            || {},
        )
        .await;

    match result {
        Ok(()) => {
            println!("[updater] update installed — restarting");
            app.restart();
        }
        Err(e) => {
            // Close the progress splash we reopened above so the failed update doesn't leave a
            // stuck window, and let the current version keep running. Don't clobber the
            // (likely already-running) server's share status with an error — just log it.
            if let Some(splash) = app.get_webview_window("splash") {
                let _ = splash.close();
            }
            eprintln!("[updater] download/install failed ({e}); continuing with current version");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = resolve_port();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Whole-bundle OTA auto-update (driven from Rust; see check_for_update).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(SidecarState::default())
        .manage(NativeMidiState::default())
        .manage(BootState::default())
        .invoke_handler(tauri::generate_handler![get_boot_status])
        .setup(move |app| {
            // Kick off the OTA check early and OFF the startup path: an update can be offered (and
            // installed) before the live session really begins, but a slow/failed check never holds
            // up the server or the app window. Failures degrade to a normal start (see
            // check_for_update).
            tauri::async_runtime::spawn(check_for_update(app.handle().clone()));

            if let Err(e) = spawn_sidecar(app.handle(), port) {
                // A failed sidecar is fatal to the app's purpose — surface it in the share window
                // (stored in state so the page shows it even if it loads after this fires).
                eprintln!("[desktop] failed to start server sidecar: {e}");
                publish(
                    app.handle(),
                    &BootStatus {
                        stage: "error".into(),
                        message: Some(format!("failed to start the server: {e}")),
                        ..Default::default()
                    },
                );
            }
            Ok(())
        })
        // Quit when the main app window closes (the macOS "window closed but app lives" case →
        // the Exit handler below SIGTERMs the sidecar), or when the splash is dismissed before the
        // app window ever opened. A *programmatic* splash close (after the app window is up, see
        // open_app_window) must NOT quit the app.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle();
                if window.label() == "app" || app.get_webview_window("app").is_none() {
                    app.exit(0);
                }
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

#[cfg(test)]
mod tests {
    use super::{parse_host_token, parse_pin, parse_tunnel_url};

    #[test]
    fn extracts_tunnel_url_from_banner_line() {
        let line = "  Tunnel: https://brave-lions-run.trycloudflare.com (PIN 123456)";
        assert_eq!(
            parse_tunnel_url(line).as_deref(),
            Some("https://brave-lions-run.trycloudflare.com")
        );
    }

    #[test]
    fn ignores_lines_without_a_tunnel_url() {
        assert_eq!(
            parse_tunnel_url("LEDrums server listening on http://localhost:4178"),
            None
        );
    }

    #[test]
    fn parses_numeric_pin_from_both_banner_forms() {
        assert_eq!(
            parse_pin("  Room PIN: 481923 (required to join)").as_deref(),
            Some("481923")
        );
        assert_eq!(
            parse_pin("  Tunnel: https://x.trycloudflare.com (PIN 481923)").as_deref(),
            Some("481923")
        );
    }

    #[test]
    fn parses_non_numeric_pin_matching_server_behavior() {
        // The server accepts ANY non-empty LEDRUMS_PIN, so the parser must not assume digits.
        assert_eq!(
            parse_pin("  Room PIN: hunter2! (required to join)").as_deref(),
            Some("hunter2!")
        );
        assert_eq!(
            parse_pin("  Tunnel: https://x.trycloudflare.com (PIN s3cret)").as_deref(),
            Some("s3cret")
        );
    }

    #[test]
    fn returns_none_when_no_pin_present() {
        assert_eq!(parse_pin("OSC listening on udp:57120"), None);
    }

    #[test]
    fn parses_host_token_from_banner_line() {
        assert_eq!(
            parse_host_token("  Host token: a1b2c3d4e5f6").as_deref(),
            Some("a1b2c3d4e5f6")
        );
    }

    #[test]
    fn returns_none_when_no_host_token_present() {
        assert_eq!(
            parse_host_token("  Room PIN: 481923 (required to join)"),
            None
        );
    }
}
