import { createSocket } from 'node:dgram';
import type { PixelOutputStatus, PixelSendCallback } from './interfaces';

/** Narrow OS boundary, also usable by deterministic fake sockets. */
export interface OutputSocket {
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'listening' | 'close', listener: () => void): this;
  removeListener(event: 'error', listener: (error: Error) => void): this;
  removeListener(event: 'listening' | 'close', listener: () => void): this;
  bind(options: { address?: string }): void;
  send(packet: Uint8Array, port: number, host: string, done: PixelSendCallback): void;
  setBroadcast(value: boolean): void;
  setMulticastInterface(address: string): void;
  setMulticastTTL(ttl: number): void;
  close(): void;
}
export type OutputSocketFactory = () => OutputSocket;
export const createOutputSocket: OutputSocketFactory = () => createSocket('udp4');

/** Shared UDP lifecycle; protocol encoders and frame sequence ownership stay in the adapters. */
export class UdpOutput {
  private status: PixelOutputStatus = { state: 'binding' };
  private readonly listeners = new Set<(status: PixelOutputStatus) => void>();
  private bound = false;
  private closed = false;
  private failureRevision = 0;
  private readonly socket: OutputSocket;
  private readonly pending = new Set<{ done?: PixelSendCallback }>();
  private closeDone?: PixelSendCallback;
  private closeError: Error | null = null;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private readonly onBound: () => void;

  constructor(factory: OutputSocketFactory, address: string | undefined, setup: (socket: OutputSocket) => void) {
    this.socket = factory();
    this.socket.on('error', this.onError);
    this.onBound = () => {
      if (this.closed) return;
      try {
        setup(this.socket);
        this.bound = true;
        this.publish({ state: 'ready' });
      } catch (error) {
        this.fail('setup', error);
      }
    };
    this.socket.on('listening', this.onBound);
    this.socket.on('close', this.onClosed);
    try { this.socket.bind({ address }); }
    catch (error) { this.fail('bind', error); }
  }

  onStatus(handler: (status: PixelOutputStatus) => void): () => void {
    if (!this.closed) this.listeners.add(handler);
    handler(this.status);
    return () => { this.listeners.delete(handler); };
  }

  send(packet: Uint8Array, port: number, host: string, done?: PixelSendCallback): boolean {
    if (!this.bound || this.closed) return false;
    // Never let a stalled socket/DNS callback accumulate unbounded render-frame closures.
    if (this.pending.size >= 1024) {
      this.fail('send', Object.assign(new Error('UDP pending packet limit (1024) reached'), { code: 'EOUTPUTBACKPRESSURE' }));
      return false;
    }
    const revision = this.failureRevision;
    const pending = { done };
    this.pending.add(pending);
    const complete = (error: Error | null): void => {
      if (!this.pending.delete(pending)) return;
      const callback = pending.done;
      pending.done = undefined;
      if (this.closed) {
        this.closeError ??= error;
        if (this.pending.size === 0) this.dispose();
        return;
      }
      if (error) this.fail('send', error);
      else if (revision === this.failureRevision && this.status.state === 'error') this.publish({ state: 'ready' });
      callback?.(error);
    };
    try { this.socket.send(packet, port, host, complete); }
    catch (error) {
      complete(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
    return true;
  }

  close(done?: PixelSendCallback): void {
    if (this.closed) return;
    this.closed = true;
    this.closeDone = done;
    this.publish({ state: 'closed' });
    this.listeners.clear();
    this.socket.removeListener('listening', this.onBound);
    // Release callers immediately; only the bounded drain owns a completion callback now.
    for (const pending of this.pending) pending.done = undefined;
    if (this.pending.size === 0) this.dispose();
    else {
      this.closeTimer = setTimeout(() => {
        this.closeError ??= new Error('UDP close drain timed out after 250ms; acceptance unknown');
        this.pending.clear();
        this.dispose();
      }, 250);
      this.closeTimer.unref();
    }
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.closeTimer);
    try { this.socket.close(); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ERR_SOCKET_DGRAM_NOT_RUNNING')) {
        this.closeError ??= error instanceof Error ? error : new Error(String(error));
      }
      this.onClosed();
    }
  }

  private readonly onClosed = (): void => {
    if (!this.closed) {
      this.closed = true;
      this.disposed = true;
      this.publish({ state: 'closed' });
      this.listeners.clear();
    }
    clearTimeout(this.closeTimer);
    if (this.pending.size > 0) this.closeError ??= new Error('UDP socket closed before pending sends completed; acceptance unknown');
    for (const pending of this.pending) pending.done = undefined;
    this.pending.clear();
    this.socket.removeListener('listening', this.onBound);
    this.socket.removeListener('error', this.onError);
    this.socket.removeListener('close', this.onClosed);
    const done = this.closeDone;
    this.closeDone = undefined;
    done?.(this.closeError);
  };

  private readonly onError = (error: Error): void => {
    if (this.closed) this.closeError ??= error;
    else this.fail(this.bound ? 'socket' : 'bind', error);
  };

  private fail(phase: Extract<PixelOutputStatus, { state: 'error' }>['phase'], error: unknown): void {
    this.failureRevision++;
    this.publish({ state: 'error', phase, message: String(error),
      code: error instanceof Error && 'code' in error ? String(error.code) : undefined });
  }

  private publish(status: PixelOutputStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}
