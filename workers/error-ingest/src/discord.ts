import type { ReportRow } from './types';

/** One best-effort attempt. The caller must register it with ExecutionContext.waitUntil. */
export type DiscordNotifier = (row: ReportRow) => Promise<void>;

export const DISCORD_TIMEOUT_MS = 5_000;

export function createDiscordNotifier(webhookUrl: string | undefined, fetchFn: typeof fetch = fetch): DiscordNotifier {
  return async (row: ReportRow): Promise<void> => {
    if (!webhookUrl) return;
    const firstLine = row.message.split('\n')[0]?.slice(0, 300) ?? '(no message)';
    const content = [
      `🚨 **New error** on \`${row.machine}\` (v${row.version}, ${row.engineMode}/${row.origin})`,
      `> ${firstLine}`,
      `dedup: \`${row.dedupKey.slice(0, 200)}\``,
    ].join('\n');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      // Abort alone is insufficient: an injected/broken fetch may ignore the signal. The race
      // bounds our task even then, and observes any late rejection without retrying the request.
      const response = await Promise.race([
        Promise.resolve().then(() => fetchFn(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content }),
          signal: controller.signal,
          redirect: 'error',
        })),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new Error('Discord timeout'));
          }, DISCORD_TIMEOUT_MS);
        }),
      ]);
      if (!response.ok) console.warn(`[error-ingest] Discord HTTP ${response.status}`);
    } catch {
      // URLs contain credentials; exception messages and response bodies can echo them. Log only
      // fixed categories/status codes. A timeout can mean delivered-but-unacknowledged, not failure.
      console.warn(timedOut ? '[error-ingest] Discord timed out' : '[error-ingest] Discord request failed');
    } finally {
      clearTimeout(timer);
      controller.abort(); // release any unread response body; never wait for a body/cleanup promise
    }
  };
}
