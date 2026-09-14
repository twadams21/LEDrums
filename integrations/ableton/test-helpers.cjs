'use strict';

const { EventEmitter } = require('node:events');

// Test-only scheduling/socket boundaries. No wall-clock waits or OS handles.
class FakeClock {
  time = 0;
  jobs = new Set();
  now = () => this.time;
  schedule(fn, ms, repeat = false) {
    const job = { fn, at: this.time + ms, ms, repeat, referenced: true,
      unref() { this.referenced = false; return this; } };
    this.jobs.add(job);
    return job;
  }
  setTimeout = (fn, ms) => this.schedule(fn, ms);
  clearTimeout = (job) => this.jobs.delete(job);
  every = (fn, ms) => this.schedule(fn, ms, true);
  cancel = (job) => this.jobs.delete(job);
  advance(ms) {
    const end = this.time + ms;
    for (;;) {
      const job = [...this.jobs].filter((item) => item.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!job) break;
      this.time = job.at;
      if (job.repeat) job.at += job.ms;
      else this.jobs.delete(job);
      job.fn();
    }
    this.time = end;
  }
}

class FakeSocket extends EventEmitter {
  sent = [];
  completed = [];
  cancelled = [];
  closeCalls = 0;
  closed = false;
  listening = false;
  deferClose = false;
  refuseCloseWhileBinding = false;
  bind(port, address) { this.binding = { port, address }; }
  listen() {
    if (this.closed) return;
    this.listening = true;
    this.emit('listening');
  }
  send(data, port, address, callback) { this.sent.push({ data, port, address, callback }); }
  complete(index, error) {
    const packet = this.sent[index];
    if (packet.finished) return;
    packet.finished = true;
    if (this.closed) {
      // dgram's deferred doSend abandons lookup work once close clears the handle.
      this.cancelled.push(packet);
      return;
    }
    if (!error) this.completed.push(packet);
    packet.callback(error);
  }
  close() {
    this.closeCalls += 1;
    if (this.refuseCloseWhileBinding && !this.listening) throw new Error('Socket is still binding');
    this.closed = true;
    if (!this.deferClose) this.emit('close');
  }
  unref() { this.unreferenced = true; }
}

// Flush only promise continuations; never sleep or advance the fake deadline implicitly.
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

module.exports = { FakeClock, FakeSocket, flush };
