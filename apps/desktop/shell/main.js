// Dumb bootstrap shell. Bundled by prepare-bundle.mjs (esbuild) into main.bundle.js so it can
// import the Tauri APIs as modules — no `withGlobalTauri`, so the full-app window never gets Tauri
// APIs injected.
//
// This window is intentionally minimal: a spinner while the server boots, and a fatal-error message
// if boot fails. The full share surface (URL / PIN / invite) and update progress now live in the
// web app itself (the boot overlay + ShareInfo popover, S08) — the shell renders none of it.
// Navigation to the server URL when it is ready is handled by the Rust shell
// (`open_app_window` → `window.navigate`); this page never navigates itself.

import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

const $ = (id) => document.getElementById(id);

let stage = 'starting';
let message = null;

function render() {
  const fatal = stage === 'error';
  document.body.dataset.state = fatal ? 'error' : 'starting';
  if (fatal) {
    $('statusText').textContent = 'Unable to start';
    $('hint').textContent =
      message ??
      'The server failed to start. Quit and reopen the app; if it persists, check the logs.';
    return;
  }
  $('statusText').textContent = message ?? 'Starting…';
  $('hint').textContent = 'Bringing the lighting engine online…';
}

function apply(payload) {
  if (!payload) return;
  if (payload.stage) stage = payload.stage;
  if (payload.message !== undefined) message = payload.message;
  render();
}

// Register the listener FIRST, then pull the current snapshot — so a status published before this
// script loaded is never missed.
listen('boot://status', (evt) => apply(evt.payload)).catch((e) => console.error('listen failed', e));

invoke('get_boot_status')
  .then((snapshot) => apply(snapshot))
  .catch((e) => console.error('get_boot_status failed', e));

render();
