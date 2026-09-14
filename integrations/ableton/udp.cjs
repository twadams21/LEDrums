'use strict';

const { assertPort, MAX_BYTES } = require('./packets.cjs');
const MAX_PENDING_SENDS = 64;
const DRAIN_TIMEOUT_MS = 250;

/** The only socket owner. Literal loopback only; no broadcasts, scans or npm.
 * dgram still performs async lookup for literal addresses: send admission is NOT completion.
 * Socket/timeout dependencies are injectable; tests never open an OS socket. */
function createUdpTransport({
  onMessage, onError, socketFactory = () => require('node:dgram').createSocket('udp4'),
  setTimeout: delay = setTimeout, clearTimeout: cancel = clearTimeout,
}) {
  const socket = socketFactory();
  let bound = false;
  let closing = false;
  let socketClosed = false;
  let closeRequested = false;
  let pending = 0;
  let drain;
  let finishDrain;
  let deadline;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Disposal/bind failure can precede a caller awaiting ready. Keep the original rejection
  // observable to awaiters without making ignored readiness an unhandled rejection.
  ready.catch(() => {});

  function finish() {
    if (deadline !== undefined) cancel(deadline);
    deadline = undefined;
    finishDrain?.();
  }
  function closeSocket() {
    if (socketClosed || closeRequested) return;
    closeRequested = true;
    try { socket.close(); }
    catch {
      // A bind-pending socket may refuse close. Retry on listening/error, even if it arrives
      // after the join deadline; never let late readiness resurrect admission or leak a bind.
      closeRequested = false;
    }
  }
  function drainCompleted() {
    if (closing && pending === 0) closeSocket();
  }
  socket.on('message', (data, peer) => {
    if (!closing && peer.address === '127.0.0.1' && data.length <= MAX_BYTES) onMessage(data, peer);
  });
  socket.on('listening', () => {
    if (closing) { drainCompleted(); return; }
    bound = true;
    resolveReady();
  });
  function socketError(error) {
    if (closing) { drainCompleted(); return; }
    rejectReady(error);
    onError(error);
  }
  socket.on('error', socketError);
  socket.on('close', () => {
    socketClosed = closing = true;
    bound = false;
    rejectReady(new Error('Transport closed'));
    finish();
  });
  try { socket.bind(0, '127.0.0.1'); }
  catch (error) { socketError(error); }
  return {
    ready,
    send(data, port) {
      assertPort(port);
      if (!bound || closing || pending >= MAX_PENDING_SENDS || !Buffer.isBuffer(data) || data.length > MAX_BYTES) return false;
      pending += 1;
      let completed = false;
      const complete = (error) => {
        if (completed) return;
        completed = true;
        pending -= 1;
        try { if (error && !closing) onError(error); }
        finally { drainCompleted(); }
      };
      try {
        socket.send(data, port, '127.0.0.1', complete);
        return true;
      } catch (error) {
        complete(error);
        return false;
      }
    },
    close() {
      if (drain) return drain;
      closing = true; // Stop admission/replies now, not after a promise continuation.
      bound = false;
      drain = new Promise((resolve) => { finishDrain = resolve; });
      rejectReady(new Error('Transport closed'));
      if (socketClosed) finish();
      else {
        // One referenced deadline covers missing send AND close callbacks. Ignoring this
        // non-rejecting join must not let natural process exit cancel an accepted bye.
        deadline = delay(() => {
          closeSocket();
          // Only after the full drain budget: a broken/bind-pending socket must not hold
          // the process forever. Its late listening/error handler still retries disposal.
          try { socket.unref?.(); } catch { /* Already unavailable. */ }
          finish();
        }, DRAIN_TIMEOUT_MS);
        drainCompleted();
      }
      // Local completion (or timeout) only; never a promise of UDP receipt/lease removal.
      return drain;
    },
  };
}

module.exports = { createUdpTransport, MAX_PENDING_SENDS, DRAIN_TIMEOUT_MS };
