'use strict';

// node.script entrypoint. max-api is supplied by Max: do NOT npm-install or vendor it.
// Source only: create/save/freeze an .amxd from a Live template in Max later (see README).
const max = require('max-api');
const { installDevice } = require('./device-runtime.cjs');
const device = installDevice(max);

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  // dispose owns the bounded deadline. A separate process.exit timer can cancel a bye
  // still inside dgram's lookup; explicit exit must follow that same local drain join.
  device.dispose().then(() => process.exit(0), () => process.exit(1));
}
// Keep both handlers installed while draining so repeated signals cannot force early exit.
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
// An externally forced exit cannot await anything. This is best effort only; lease expiry
// remains the fallback for process.exit(), SIGKILL, crashes or an unavailable host.
process.once('exit', () => { device.dispose(); });
