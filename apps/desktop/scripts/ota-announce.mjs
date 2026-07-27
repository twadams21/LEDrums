/**
 * Announce a published OTA release to Discord.
 *
 * Called by publish-ota.mjs AFTER the artifact + manifest are uploaded, so a post here means the
 * update is genuinely installable — never "about to be". Announcing is best-effort: the release has
 * already landed by the time we post, so a webhook outage must WARN, never fail the publish (and
 * never throw). Nothing is ever silently skipped — a missing webhook or a failed post says so.
 *
 * The first platform published for a version gets the @everyone announcement. Subsequent platforms
 * of the SAME version (a multi-arch release built on several machines) get a quiet follow-up with no
 * ping, so one release pings the channel exactly once.
 *
 * Webhook URL comes from LEDRUMS_OTA_UPDATES_DISCORD_WEBHOOK (Infisical, prod env) — the
 * #ledrums-updates channel. Distinct from the error-report webhook the ingest Worker uses.
 * `fetch` is injected so tests never hit the network.
 */

/** Where a user goes to install, once the manifest is live (desktop update badge → Settings). */
const INSTALL_HINT =
  'Open LEDrums and click the update badge in the top bar (or Settings → Updates) to install.';

/**
 * Build the Discord webhook payload for a published release.
 *
 * @param {object} args
 * @param {string} args.version            the published version (e.g. "0.4.3")
 * @param {string[]} args.platforms        every platform key in the manifest after this publish
 * @param {string} [args.notes]            release notes (omitted when it's the default "LEDrums <v>")
 * @param {string} args.target             the platform key this run published
 * @param {boolean} args.firstAnnouncement true → @everyone release post; false → quiet follow-up
 * @returns {{content: string, allowed_mentions: {parse: string[]}}}
 */
export function buildReleaseAnnouncement({ version, platforms, notes, target, firstAnnouncement }) {
  if (!firstAnnouncement) {
    return {
      content: `🥁 **LEDrums v${version}** is now also available for \`${target}\`.`,
      // No ping: the release itself was already announced when its first platform published.
      allowed_mentions: { parse: [] },
    };
  }

  const lines = [
    '@everyone',
    `🥁 **LEDrums v${version} is available to install.**`,
  ];
  // Only surface notes an operator actually wrote — publish-ota defaults them to "LEDrums <version>",
  // which would just repeat the headline.
  const trimmedNotes = notes?.trim();
  if (trimmedNotes && trimmedNotes !== `LEDrums ${version}`) {
    for (const line of trimmedNotes.split(/\r?\n/)) lines.push(`> ${line}`);
  }
  lines.push(`Platforms: ${platforms.map((p) => `\`${p}\``).join(', ')}`);
  lines.push(INSTALL_HINT);

  return {
    content: lines.join('\n'),
    // Let @everyone through (that's the point) but neutralise any user/role mention that wandered in
    // via OTA_NOTES.
    allowed_mentions: { parse: ['everyone'] },
  };
}

/**
 * Post the release announcement. Resolves to a result — it never throws and never rejects.
 *
 * @param {object} args
 * @param {string|undefined} args.webhookUrl
 * @param {string} args.version
 * @param {string[]} args.platforms
 * @param {string} args.target
 * @param {boolean} args.firstAnnouncement
 * @param {string} [args.notes]
 * @param {typeof fetch} [args.fetchFn]
 * @returns {Promise<{posted: boolean, reason?: string}>}
 */
export async function announceRelease({
  webhookUrl,
  version,
  platforms,
  target,
  firstAnnouncement,
  notes,
  fetchFn = fetch,
}) {
  if (!webhookUrl) {
    return {
      posted: false,
      reason:
        'LEDRUMS_OTA_UPDATES_DISCORD_WEBHOOK is not set — no Discord announcement was posted. ' +
        'Run the release under `infisical run --env=prod` to announce.',
    };
  }

  const payload = buildReleaseAnnouncement({ version, platforms, notes, target, firstAnnouncement });
  try {
    const res = await fetchFn(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        posted: false,
        reason: `Discord webhook returned ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`,
      };
    }
    return { posted: true };
  } catch (err) {
    return { posted: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
