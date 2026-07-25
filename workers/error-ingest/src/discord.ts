import type { ReportRow } from './types';

/** Posts a one-line Discord ping for a newly-seen error. Fire-and-forget; failures are swallowed
 * (a webhook outage must never fail ingestion). `fetch` is injected so tests never hit the network. */
export type DiscordNotifier = (row: ReportRow) => Promise<void>;

export function createDiscordNotifier(webhookUrl: string | undefined, fetchFn: typeof fetch = fetch): DiscordNotifier {
  return async (row: ReportRow): Promise<void> => {
    if (!webhookUrl) return;
    const firstLine = row.message.split('\n')[0]?.slice(0, 300) ?? '(no message)';
    const content = [
      `🚨 **New error** on \`${row.machine}\` (v${row.version}, ${row.engineMode}/${row.origin})`,
      `> ${firstLine}`,
      `dedup: \`${row.dedupKey.slice(0, 200)}\``,
    ].join('\n');
    try {
      await fetchFn(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      });
    } catch {
      /* webhook outage must never affect ingestion */
    }
  };
}
