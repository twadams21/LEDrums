// Native "share" window logic. Bundled by prepare-bundle.mjs (esbuild) into main.bundle.js so it
// can import the Tauri APIs as modules — no `withGlobalTauri`, so the full-app window never gets
// Tauri APIs injected. Talks to the Rust shell via the boot:// status event + the get_boot_status
// command (the pull covers status published before this listener registered).

import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

const $ = (id) => document.getElementById(id);

async function copy(text, btn) {
  try {
    await writeText(text);
    const prev = btn.textContent;
    btn.textContent = 'Copied';
    btn.classList.add('done');
    setTimeout(() => {
      btn.textContent = prev;
      btn.classList.remove('done');
    }, 1200);
  } catch (e) {
    console.error('copy failed', e);
  }
}

let state = { stage: 'starting', localUrl: null, tunnelUrl: null, pin: null, message: null };

function render() {
  const dot = $('dot');
  const statusText = $('statusText');

  if (state.stage === 'error') {
    dot.className = 'dot error';
    statusText.textContent = 'Error';
    $('hint').textContent =
      state.message ?? 'The server failed to start. Quit and reopen the app; if it persists, check the logs.';
    $('tunnelUrl').textContent = 'Unavailable';
    return;
  }

  // OTA: an update was accepted and is downloading; the app restarts when it finishes.
  if (state.stage === 'updating') {
    dot.className = 'dot work';
    statusText.textContent = 'Updating…';
    $('hint').textContent =
      state.message ?? 'Downloading the latest version. The app will restart automatically.';
    $('tunnelUrl').textContent = 'Updating…';
    return;
  }

  if (state.localUrl) {
    $('localUrl').textContent = state.localUrl;
    $('localUrl').classList.remove('dim');
    $('copyLocal').classList.remove('hidden');
  }

  if (state.pin) {
    $('pinField').classList.remove('hidden');
    $('pin').textContent = state.pin;
  }

  if (state.tunnelUrl) {
    $('tunnelUrl').textContent = state.tunnelUrl;
    $('tunnelUrl').classList.remove('dim');
    $('copyUrl').classList.remove('hidden');
    dot.className = 'dot live';
    statusText.textContent = 'Live';
  } else if (state.stage === 'running' || state.localUrl) {
    dot.className = 'dot work';
    statusText.textContent = 'Local only — waiting for tunnel…';
  } else {
    dot.className = 'dot work';
    statusText.textContent = 'Starting…';
  }

  if (state.stage === 'no-tunnel') {
    $('tunnelUrl').textContent = 'No tunnel (local/LAN access only)';
    dot.className = 'dot live';
    statusText.textContent = 'Local only';
    $('hint').textContent =
      'No cloudflared binary was bundled, so there is no public share link. ' +
      'The app is reachable on this machine and the LAN.';
  }
}

$('copyUrl').addEventListener('click', () => state.tunnelUrl && copy(state.tunnelUrl, $('copyUrl')));
$('copyPin').addEventListener('click', () => state.pin && copy(state.pin, $('copyPin')));
$('copyLocal').addEventListener('click', () => state.localUrl && copy(state.localUrl, $('copyLocal')));

// Register the listener FIRST, then pull the current snapshot — so a status published before the
// page (or this script) loaded is never missed.
listen('boot://status', (evt) => {
  state = { ...state, ...evt.payload };
  render();
}).catch((e) => console.error('listen failed', e));

invoke('get_boot_status')
  .then((snapshot) => {
    if (snapshot) {
      state = { ...state, ...snapshot };
      render();
    }
  })
  .catch((e) => console.error('get_boot_status failed', e));

render();
