// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLazyHost, lazyComponent, type LazyEnvironment, type ResourceTiming } from './lazy-component';

/* Counterexamples from the independent review of 6655f24a. Vite retains every
   attempted preload for the page's lifetime, so a stylesheet that failed under
   one boundary is silently skipped for the next; and a boundary's failure
   evidence must be about its own exact request, not a same-path lookalike. */

const origin = 'http://localhost:4412';
const field = `${origin}/assets/Field-CvCM.css`;
const sections = `${origin}/assets/SectionsView-YSht.css`;
const objects = `${origin}/assets/ObjectsView-B96n.css`;
const trigger = `${origin}/assets/TriggerGraphView-BrLA.js`;

function fakeEnvironment() {
  const timings: ResourceTiming[] = [];
  const listeners: ((error: unknown) => void)[] = [];
  let clock = 1000;
  const env: LazyEnvironment & { fail(error: unknown): void; probed: string[]; reachable: boolean; onLine: boolean | undefined } = {
    origin,
    document,
    timings: () => timings,
    now: () => (clock += 10),
    online: () => env.onLine,
    onLine: undefined,
    reachable: true,
    probed: [],
    probe: async (url) => { env.probed.push(url); return env.reachable; },
    onPreloadError: (listener) => { listeners.push(listener); },
    fail: (error) => { for (const listener of listeners) listener(error); },
  };
  return env;
}

function witness(env: ReturnType<typeof fakeEnvironment>, name: string, responseStatus: number, initiatorType = 'link') {
  (env.timings() as ResourceTiming[]).push({ name, responseStatus, initiatorType, startTime: env.now() });
}

/** Vite-style first attempt: append the preload link Vite would have created, then fail it. */
function vitePreloadFailure(env: ReturnType<typeof fakeEnvironment>, href: string, responseStatus: number) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
  witness(env, href, responseStatus, 'link');
  const error = new Error(`Unable to preload CSS for ${new URL(href).pathname}`);
  env.fail(error);
  return error;
}

function retryLinks(pathname: string) {
  return [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
    .filter((link) => new URL(link.href).pathname === pathname && link.href.includes('load-retry='));
}

async function settleRetryLink(env: ReturnType<typeof fakeEnvironment>, href: string, responseStatus: number) {
  const pathname = new URL(href).pathname;
  await vi.waitFor(() => { expect(retryLinks(pathname).length).toBeGreaterThan(0); });
  const link = retryLinks(pathname).at(-1)!;
  witness(env, link.href, responseStatus, 'link');
  link.dispatchEvent(new Event(responseStatus >= 200 && responseStatus < 400 ? 'load' : 'error'));
}

afterEach(() => { document.head.innerHTML = ''; });

describe('shared stylesheet ownership', () => {
  it('repairs a shared stylesheet that failed under another boundary before a sibling is ready', async () => {
    const env = fakeEnvironment();
    const host = createLazyHost(env);
    const sectionsView = lazyComponent('SectionsView', async () => { throw vitePreloadFailure(env, field, 503); }, host);
    const inputPane = lazyComponent('InputPane', async () => ({ default: 'Input' }), host);
    await sectionsView.load();
    expect(sectionsView.state).toEqual({ status: 'error', retryable: true });

    const pending = inputPane.load();
    await settleRetryLink(env, field, 200);
    await pending;
    expect(inputPane.state).toEqual({ status: 'ready', value: 'Input' });
    expect(retryLinks('/assets/Field-CvCM.css')).toHaveLength(1);
    expect(document.querySelectorAll(`link[href="${field}"]`)).toHaveLength(0);

    // Sections shares the repaired stylesheet: its retry needs no second repair.
    const retried = sectionsView.retry();
    await retried;
    expect(sectionsView.state.status).toBe('error');
    expect(retryLinks('/assets/Field-CvCM.css')).toHaveLength(1);
  });

  it('fails a sibling closed, retryably, while the shared stylesheet it needs still cannot load', async () => {
    const env = fakeEnvironment();
    const host = createLazyHost(env);
    const sectionsView = lazyComponent('SectionsView', async () => { throw vitePreloadFailure(env, field, 503); }, host);
    const inputPane = lazyComponent('InputPane', async () => ({ default: 'Input' }), host);
    await sectionsView.load();
    const pending = inputPane.load();
    await settleRetryLink(env, field, 503);
    await pending;
    expect(inputPane.state).toEqual({ status: 'error', retryable: true });
    const again = inputPane.retry();
    await settleRetryLink(env, field, 200);
    await again;
    expect(inputPane.state).toEqual({ status: 'ready', value: 'Input' });
  });

  it('gates readiness on a shared stylesheet that fails during a concurrent attempt', async () => {
    const env = fakeEnvironment();
    const host = createLazyHost(env);
    let release!: () => void;
    const inputPane = lazyComponent('InputPane', () => new Promise<{ default: string }>((resolve) => { release = () => resolve({ default: 'Input' }); }), host);
    const pending = inputPane.load();
    await vi.waitFor(() => { expect(release).toBeDefined(); });
    vitePreloadFailure(env, field, 503);
    release();
    await settleRetryLink(env, field, 200);
    await pending;
    expect(inputPane.state).toEqual({ status: 'ready', value: 'Input' });
  });

  it('keeps recovery boundary-scoped: another route’s own stylesheet never blocks this one', async () => {
    const env = fakeEnvironment();
    const host = createLazyHost(env);
    const objectsView = lazyComponent('ObjectsView', async () => { throw vitePreloadFailure(env, objects, 503); }, host);
    const sectionsView = lazyComponent('SectionsView', async () => { throw vitePreloadFailure(env, sections, 503); }, host);
    await objectsView.load();
    await sectionsView.load();
    const retried = sectionsView.retry();
    await settleRetryLink(env, sections, 200);
    await retried;
    expect(sectionsView.state.status).toBe('error');
    expect(retryLinks('/assets/ObjectsView-B96n.css')).toHaveLength(0);
    expect(retryLinks('/assets/SectionsView-YSht.css')).toHaveLength(1);
    // The other route still owns its own recovery.
    const objectsRetry = objectsView.retry();
    await settleRetryLink(env, objects, 200);
    await objectsRetry;
    expect(retryLinks('/assets/ObjectsView-B96n.css')).toHaveLength(1);
  });

  it('witnesses a second failed stylesheet Vite left unreported, and repairs both on retry', async () => {
    const env = fakeEnvironment();
    const host = createLazyHost(env);
    const sectionsView = lazyComponent('SectionsView', async () => {
      // Vite throws at its first rejection: only Field gets the event.
      const first = vitePreloadFailure(env, field, 0);
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = sections;
      document.head.append(link);
      witness(env, sections, 0, 'link');
      throw first;
    }, host);
    env.reachable = false;
    await sectionsView.load();
    expect(sectionsView.state).toEqual({ status: 'error', retryable: true });
    expect([...host.styles.keys()].sort()).toEqual([field, sections].sort());
    env.reachable = true;
    const retried = sectionsView.retry();
    await settleRetryLink(env, field, 200);
    await settleRetryLink(env, sections, 200);
    await retried;
    expect(sectionsView.state.status).toBe('error');
    expect(retryLinks('/assets/Field-CvCM.css')).toHaveLength(1);
    expect(retryLinks('/assets/SectionsView-YSht.css')).toHaveLength(1);
  });

  it('dedupes one in-flight repair across boundaries', async () => {
    const env = fakeEnvironment();
    const host = createLazyHost(env);
    lazyComponent('SectionsView', async () => { throw vitePreloadFailure(env, field, 503); }, host);
    vitePreloadFailure(env, field, 503);
    const a = lazyComponent('InputPane', async () => ({ default: 'Input' }), host);
    const b = lazyComponent('SystemPane', async () => ({ default: 'System' }), host);
    const both = Promise.all([a.load(), b.load()]);
    await settleRetryLink(env, field, 200);
    await both;
    expect(retryLinks('/assets/Field-CvCM.css')).toHaveLength(1);
    expect(a.state.status).toBe('ready');
    expect(b.state.status).toBe('ready');
  });
});

describe('entry failure provenance', () => {
  function fetchFailure(url: string) {
    return new TypeError(`Failed to fetch dynamically imported module: ${url}`);
  }

  it('does not treat a same-path icon probe as this boundary’s failed download', async () => {
    const env = fakeEnvironment();
    const host = createLazyHost(env);
    const view = lazyComponent('TriggerGraphView', async () => {
      witness(env, trigger, 200, 'script');
      witness(env, `${trigger}?favicon-probe`, 0, 'other');
      throw fetchFailure(trigger); // Chrome names the entry when a shared dependency failed
    }, host);
    await view.load();
    expect(view.state).toEqual({ status: 'error', retryable: false });
    expect(env.probed).toEqual([]);
  });

  it('treats a status-0 failure as recoverable only when the network refused the probe or the app is offline', async () => {
    const env = fakeEnvironment();
    const host = createLazyHost(env);
    const blocked = lazyComponent('TriggerGraphView', async () => { witness(env, trigger, 0, 'script'); throw fetchFailure(trigger); }, host);
    await blocked.load();
    expect(blocked.state).toEqual({ status: 'error', retryable: false });
    expect(env.probed).toEqual([trigger]);

    env.reachable = false;
    const aborted = lazyComponent('TriggerGraphView', async () => { witness(env, trigger, 0, 'script'); throw fetchFailure(trigger); }, host);
    await aborted.load();
    expect(aborted.state).toEqual({ status: 'error', retryable: true });

    env.reachable = true;
    env.onLine = false;
    const offline = lazyComponent('TriggerGraphView', async () => { witness(env, trigger, 0, 'script'); throw fetchFailure(trigger); }, host);
    await offline.load();
    expect(offline.state).toEqual({ status: 'error', retryable: true });
    expect(env.probed).toEqual([trigger, trigger]);
  });

  it('licenses recovery from a witnessed HTTP failure without a probe', async () => {
    const env = fakeEnvironment();
    const host = createLazyHost(env);
    const http = lazyComponent('TriggerGraphView', async () => { witness(env, trigger, 503, 'script'); throw fetchFailure(trigger); }, host);
    await http.load();
    expect(http.state).toEqual({ status: 'error', retryable: true });
    expect(env.probed).toEqual([]);
  });

  it('ignores an entry download that predates this attempt', async () => {
    const env = fakeEnvironment();
    const host = createLazyHost(env);
    witness(env, trigger, 503, 'script');
    const view = lazyComponent('TriggerGraphView', async () => { throw fetchFailure(trigger); }, host);
    await view.load();
    expect(view.state).toEqual({ status: 'error', retryable: false });
  });
});
