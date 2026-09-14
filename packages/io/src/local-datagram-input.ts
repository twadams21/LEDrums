import { createSocket, type Socket, type RemoteInfo } from 'node:dgram';

/** A small loopback-only datagram adapter. Decoding/admission belong to its consumer. */
export class LocalDatagramInput {
  private readonly socket: Socket;
  private closed = false;
  private listening = false;

  constructor(options: {
    port: number;
    maxBytes: number;
    onMessage: (text: string, peer: { port: number }) => void;
    onStatus: (status: { status: 'listening'; port: number } | { status: 'error'; error: string }) => void;
  }) {
    this.socket = createSocket('udp4');
    this.socket.on('message', (data: Buffer, peer: RemoteInfo) => {
      if (this.closed || peer.address !== '127.0.0.1' || data.length > options.maxBytes) return;
      options.onMessage(data.toString('utf8'), { port: peer.port });
    });
    this.socket.on('error', (error) => {
      if (!this.closed) options.onStatus({ status: 'error', error: error.message });
    });
    this.socket.on('listening', () => {
      if (this.closed) return;
      this.listening = true;
      options.onStatus({ status: 'listening', port: this.socket.address().port });
    });
    this.socket.bind(options.port, '127.0.0.1');
    this.socket.unref();
  }

  /** Replies can only go back to loopback, never to a client-provided host. */
  reply(port: number, message: string): void {
    if (this.closed || !this.listening) return;
    try { this.socket.send(message, port, '127.0.0.1', () => {}); }
    catch { /* A peer shutting down must not stop the engine. */ }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.close(); } catch { /* Already unavailable after a bind failure. */ }
  }
}
