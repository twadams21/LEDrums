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
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

/// Fallback local port if free-port allocation fails. Overridable via `LEDRUMS_DESKTOP_PORT`.
const DEFAULT_PORT: u16 = 4178;
const UPDATER_ENDPOINT: &str = "https://pub-6ba98981a8804912b9551135ba976ef4.r2.dev/latest.json";

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
    /// Structured download progress (0–100) while `stage == "updating"`; `None` otherwise.
    /// Populated directly from the updater's byte callbacks — the web bridge reads this instead
    /// of parsing a percentage out of `message`.
    #[serde(rename = "progressPct")]
    progress_pct: Option<u8>,
    /// Set by the startup OTA check when a newer build is available — this is how availability
    /// reaches the in-app badge now that the native dialog is gone (S07). Skip-serialized when
    /// `None` so an ordinary boot event never touches the web-side `updateAvailable` flag.
    #[serde(rename = "updateAvailable", skip_serializing_if = "Option::is_none")]
    update_available: Option<bool>,
    #[serde(rename = "updateVersion", skip_serializing_if = "Option::is_none")]
    update_version: Option<String>,
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

/// Merge OTA availability (found by the startup check) into the stored boot status and emit it.
/// Startup runs concurrently with the sidecar, so we fold into whatever stage/url/pin is already
/// known instead of publishing a bare status that would clobber them — this is the sole channel
/// by which startup availability reaches the in-app badge (the native dialog is gone, S07).
fn publish_update_available(app: &AppHandle, version: String) {
    if let Some(state) = app.try_state::<BootState>() {
        if let Ok(mut g) = state.0.lock() {
            g.update_available = Some(true);
            g.update_version = Some(version);
            let _ = app.emit("boot://status", g.clone());
        }
    }
}

/// The share page calls this once after registering its event listener, to recover any status that
/// was published before the listener existed.
#[tauri::command]
fn get_boot_status(state: State<'_, BootState>) -> BootStatus {
    state.0.lock().map(|g| g.clone()).unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckResult {
    available: bool,
    version: Option<String>,
}

#[tauri::command]
async fn check_for_update_now(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => Ok(UpdateCheckResult {
            available: true,
            version: Some(update.version),
        }),
        None => Ok(UpdateCheckResult {
            available: false,
            version: None,
        }),
    }
}

/// User-triggered, in-app update: download with real progress (published to `boot://status` so the
/// settings dialog's progress bar tracks it), then restart. Install ONLY ever runs from here (a user
/// action in the web UI) — the startup check never downloads (S07). `on_chunk` is an immutable `Fn`,
/// so the running byte count is accumulated through an atomic.
#[tauri::command]
async fn install_update_now(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(());
    };

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
    update
        .download_and_install(
            move |chunk_len, content_len| {
                let total =
                    downloaded.fetch_add(chunk_len as u64, Ordering::Relaxed) + chunk_len as u64;
                let (message, progress_pct) = match content_len {
                    Some(len) if len > 0 => {
                        let pct = (total as f64 / len as f64 * 100.0).round().clamp(0.0, 100.0);
                        (format!("Downloading update… {pct}%"), Some(pct as u8))
                    }
                    // Unknown total length — no meaningful percentage, only a byte count.
                    _ => (format!("Downloading update… {total} bytes"), None),
                };
                publish(
                    &progress_app,
                    &BootStatus {
                        stage: "updating".into(),
                        message: Some(message),
                        progress_pct,
                        ..Default::default()
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    println!("[updater] update installed — restarting");
    app.restart();
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

/// Navigate the full-app webview window to the local origin.
/// The shareable URL/PIN live in the app's own UI (the host auto-connects, see the PIN gate bypass).
fn open_app_window(app: &AppHandle, port: u16, host_token: Option<&str>) {
    // The host token rides the URL *fragment* (`#hostToken=…`), which the webview keeps client-side
    // and never sends to the server as part of any HTTP request — the web app reads it from
    // `location.hash`, presents it on the WebSocket connect URL, then strips it from the address bar.
    let url = match host_token {
        Some(token) => format!("http://127.0.0.1:{port}/#hostToken={token}"),
        None => format!("http://127.0.0.1:{port}"),
    };
    match url.parse() {
        Ok(parsed) => {
            if let Some(window) = app.get_webview_window("app") {
                if let Err(e) = window.navigate(parsed) {
                    eprintln!("[desktop] could not navigate app window to {url}: {e}");
                }
            } else {
                eprintln!("[desktop] app window missing; could not navigate to {url}");
            }
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
        )
        .env("LEDRUMS_APP_VERSION", env!("CARGO_PKG_VERSION"))
        .env("LEDRUMS_OTA_ENDPOINT", UPDATER_ENDPOINT);

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

    // Fully in-app now (LOCKED, doc 02): the native dialog is gone. Startup only *publishes*
    // availability into the boot status — the web app renders the in-app badge and the user chooses
    // to install (which routes through `install_update_now`). Startup never downloads or restarts.
    publish_update_available(&app, update.version.clone());
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
        .invoke_handler(tauri::generate_handler![
            get_boot_status,
            check_for_update_now,
            install_update_now
        ])
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
        // Quit when the app window closes (the macOS "window closed but app lives" case → the Exit
        // handler below SIGTERMs the sidecar).
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                if window.label() == "app" {
                    window.app_handle().exit(0);
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
