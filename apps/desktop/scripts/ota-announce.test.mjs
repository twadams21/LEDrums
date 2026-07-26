// Unit tests for the OTA release Discord announcement. Uses the built-in node:test runner (no extra
// dependency) so `pnpm -r run test` picks it up in this build-script-only package. `fetch` is
// injected everywhere — these tests never touch the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { announceRelease, buildReleaseAnnouncement } from './ota-announce.mjs';

/** A stub `fetch` that records calls and returns a canned response. */
function stubFetch(response = { ok: true, status: 204 }) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (response instanceof Error) throw response;
    return { ...response, text: async () => response.body ?? '' };
  };
  return { fn, calls };
}

const base = {
  version: '1.2.3',
  platforms: ['darwin-aarch64'],
  target: 'darwin-aarch64',
  firstAnnouncement: true,
};

test('the first announcement for a version pings @everyone and says how to install', () => {
  const payload = buildReleaseAnnouncement(base);
  assert.match(payload.content, /^@everyone\n/);
  assert.match(payload.content, /LEDrums v1\.2\.3 is available to install/);
  assert.match(payload.content, /`darwin-aarch64`/);
  assert.match(payload.content, /update badge/);
  assert.deepEqual(payload.allowed_mentions, { parse: ['everyone'] });
});

test('operator release notes are quoted, but the default "LEDrums <version>" note is not repeated', () => {
  const withNotes = buildReleaseAnnouncement({ ...base, notes: 'Fixes OSC ingest.\nFaster boot.' });
  assert.match(withNotes.content, /^> Fixes OSC ingest\.$/m);
  assert.match(withNotes.content, /^> Faster boot\.$/m);

  const defaultNotes = buildReleaseAnnouncement({ ...base, notes: 'LEDrums 1.2.3' });
  assert.ok(!defaultNotes.content.includes('>'), 'default notes should not be quoted into the post');
});

test('a second platform of the same version posts a quiet follow-up with no ping', () => {
  const payload = buildReleaseAnnouncement({
    ...base,
    firstAnnouncement: false,
    target: 'windows-x86_64',
    platforms: ['darwin-aarch64', 'windows-x86_64'],
  });
  assert.ok(!payload.content.includes('@everyone'), 'follow-up must not ping the channel again');
  assert.match(payload.content, /also available for `windows-x86_64`/);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});

test('all platforms in the manifest are listed, not just the one just published', () => {
  const payload = buildReleaseAnnouncement({ ...base, platforms: ['darwin-aarch64', 'windows-x86_64'] });
  assert.match(payload.content, /Platforms: `darwin-aarch64`, `windows-x86_64`/);
});

test('announceRelease posts JSON to the webhook and reports success', async () => {
  const { fn, calls } = stubFetch();
  const result = await announceRelease({ ...base, webhookUrl: 'https://discord.test/hook', fetchFn: fn });
  assert.deepEqual(result, { posted: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://discord.test/hook');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.match(calls[0].body.content, /LEDrums v1\.2\.3/);
});

test('a missing webhook URL is reported, not silently skipped, and posts nothing', async () => {
  const { fn, calls } = stubFetch();
  const result = await announceRelease({ ...base, webhookUrl: undefined, fetchFn: fn });
  assert.equal(result.posted, false);
  assert.match(result.reason, /LEDRUMS_OTA_UPDATES_DISCORD_WEBHOOK/);
  assert.equal(calls.length, 0);
});

test('a non-2xx webhook response is reported with its status and body', async () => {
  const { fn } = stubFetch({ ok: false, status: 404, body: 'Unknown Webhook' });
  const result = await announceRelease({ ...base, webhookUrl: 'https://discord.test/hook', fetchFn: fn });
  assert.equal(result.posted, false);
  assert.match(result.reason, /404/);
  assert.match(result.reason, /Unknown Webhook/);
});

test('a webhook outage never throws — the release already succeeded', async () => {
  const { fn } = stubFetch(new Error('ECONNREFUSED'));
  const result = await announceRelease({ ...base, webhookUrl: 'https://discord.test/hook', fetchFn: fn });
  assert.equal(result.posted, false);
  assert.match(result.reason, /ECONNREFUSED/);
});
