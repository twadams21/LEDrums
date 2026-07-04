import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpPixliteClient, probe, type HttpTransport } from './client';

const VER_BODY =
  '{"resp":"version","result":{"fwVer":"1.2.3","prodName":"PixLite A4-S Mk3","nickname":"Test Kit","apiVer":[{"maj":"v1","min":[0,7]}],"authReqd":false}}';
const STAT_BODY =
  '{"resp":"statisticRead","id":1,"result":{"statistic":{"pixData":{"inFrmRate":44,"outFrmRate":44},"ethProt":{"inUni":{"artNet":{"uniNum":[0,1],"timedOut":[false,true],"inGood":[500,0],"inBadSeq":[0,0]}}}}}}';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('HttpPixliteClient (injected transport)', () => {
  it('serializes statisticRead, posts to an authed mgmt URL, and parses the result', async () => {
    const seen: { url: string; body?: string }[] = [];
    const transport: HttpTransport = async (spec) => {
      seen.push({ url: spec.url, body: spec.body });
      return { status: 200, body: STAT_BODY };
    };
    const c = new HttpPixliteClient({ host: '10.0.0.5', transport });
    const stats = await c.statisticRead(['']);

    expect(stats.rates).toEqual({ inFrmRate: 44, outFrmRate: 44 });
    expect(stats.universes.artNet[1]?.timedOut).toBe(true);
    expect(seen[0]?.url).toBe(
      'http://10.0.0.5:80/v1.7/?user=admin&auth=47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU',
    );
    expect(seen[0]?.body).toBe('{"req":"statisticRead","id":1,"params":{"path":[""]}}');
  });

  it('hashes a password into the auth query param', async () => {
    let url = '';
    const transport: HttpTransport = async (spec) => {
      url = spec.url;
      return { status: 200, body: '{"resp":"identify","id":1,"result":{}}' };
    };
    const c = new HttpPixliteClient({ host: 'h', password: 'hunter2', transport });
    await c.identify(30);
    expect(url).toContain('user=admin&auth=');
    expect(url).not.toContain('hunter2'); // plaintext never on the wire
  });

  it('throws on a non-200 management response', async () => {
    const transport: HttpTransport = async () => ({ status: 403, body: '' });
    const c = new HttpPixliteClient({ host: 'h', transport });
    await expect(c.identify(1)).rejects.toThrow(/HTTP 403/);
  });

  it('serializes concurrent calls through one queue (never overlaps) with incrementing ids', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const ids: number[] = [];
    const transport: HttpTransport = async (spec) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      ids.push(JSON.parse(spec.body!).id as number);
      await delay(10);
      inFlight--;
      return { status: 200, body: STAT_BODY };
    };
    const c = new HttpPixliteClient({ host: 'h', transport });
    await Promise.all([c.statisticRead(['']), c.statisticRead(['']), c.statisticRead([''])]);

    expect(maxInFlight).toBe(1); // the API forbids concurrent requests
    expect(ids).toEqual([1, 2, 3]); // in enqueue order
  });

  it('a failed call does not wedge the queue', async () => {
    let call = 0;
    const transport: HttpTransport = async () => {
      call++;
      if (call === 1) throw new Error('boom (e.g. timeout)');
      return { status: 200, body: STAT_BODY };
    };
    const c = new HttpPixliteClient({ host: 'h', transport });
    await expect(c.statisticRead([''])).rejects.toThrow(/boom/);
    // The next call still runs and succeeds.
    await expect(c.statisticRead([''])).resolves.toBeDefined();
  });
});

describe('HttpPixliteClient / probe over the real node:http transport', () => {
  const servers: Server[] = [];
  const start = (handler: RequestListener): Promise<number> => {
    const server = createServer(handler);
    servers.push(server);
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });
  };
  afterEach(async () => {
    for (const s of servers.splice(0)) {
      s.closeAllConnections?.();
      await new Promise((r) => s.close(r));
    }
  });

  it('probes /ver and reads statistics end-to-end', async () => {
    const port = await start((req, res) => {
      if (req.url === '/ver') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(VER_BODY);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(STAT_BODY);
      }
    });
    const c = new HttpPixliteClient({ host: '127.0.0.1', port });
    const id = await c.probe();
    expect(id?.prodName).toBe('PixLite A4-S Mk3');
    expect(id?.host).toBe('127.0.0.1');
    const stats = await c.statisticRead(['']);
    expect(stats.rates.inFrmRate).toBe(44);
  });

  it('returns null on probe timeout (server never responds)', async () => {
    const port = await start(() => {
      /* hang: never respond */
    });
    const id = await probe('127.0.0.1', 60, { port });
    expect(id).toBeNull();
  });

  it('returns null when the host refuses the connection', async () => {
    // Nothing listening on this port → ECONNREFUSED → treated as "no controller".
    const id = await probe('127.0.0.1', 200, { port: 1 });
    expect(id).toBeNull();
  });
});
