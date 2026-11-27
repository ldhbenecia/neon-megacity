import { describe, expect, it, vi } from 'vitest';
import {
  ANALYTICS_STORAGE_KEY,
  PAGES_HOST,
  cleanEvent,
  configParams,
  readOptOut,
  readyBucket,
  shouldLoad,
  type LoadContext,
} from '../src/ux/analytics';

const base: LoadContext = {
  id: 'G-B6LC4ZYSC6',
  hostname: PAGES_HOST,
  search: '',
  webdriver: false,
  doNotTrack: false,
  optedOut: false,
};

describe('analytics load conditions', () => {
  it('loads only on the deployed site for a real visitor', () => {
    expect(shouldLoad(base)).toBe(true);
  });

  it.each([
    ['no measurement id', { id: undefined }],
    ['a malformed id', { id: 'UA-123' }],
    ['localhost', { hostname: 'localhost' }],
    ['a preview host', { hostname: '127.0.0.1' }],
    ['a copy on another github.io account', { hostname: 'someone.github.io' }],
    ['automation (e2e, shots, perf)', { webdriver: true }],
    ['Do Not Track', { doNotTrack: true }],
    ['the panel opt-out', { optedOut: true }],
    ['?debug', { search: '?debug' }],
    ['?notrack', { search: '?cam=banpo&notrack' }],
    ['?quality=ci', { search: '?quality=ci' }],
  ] as const)('stays off with %s', (_label, patch) => {
    expect(shouldLoad({ ...base, ...patch })).toBe(false);
  });

  it('reads the stored opt-out and survives blocked storage', () => {
    const store = (v: string | null) => ({
      getItem: (k: string) => (k === ANALYTICS_STORAGE_KEY ? v : null),
    });
    expect(readOptOut(store('off'))).toBe(true);
    expect(readOptOut(store('on'))).toBe(false);
    expect(readOptOut(store(null))).toBe(false);
    expect(readOptOut(null)).toBe(false);
    const broken = {
      getItem: (): string | null => {
        throw new Error('SecurityError');
      },
    };
    expect(readOptOut(broken)).toBe(false);
  });
});

describe('analytics config', () => {
  it('turns ad features off and sends the page without its query or referrer', () => {
    const c = configParams({ origin: 'https://ldhbenecia.github.io', pathname: '/neon-megacity/' });
    expect(c).toEqual({
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: 'https://ldhbenecia.github.io/neon-megacity/',
      page_referrer: '',
    });
    expect(JSON.stringify(c)).not.toContain('?');
  });
});

describe('analytics events', () => {
  it('drops events that are not on the allow-list', () => {
    expect(cleanEvent('click_position', { x: '12' })).toBeNull();
    expect(cleanEvent('toString', {})).toBeNull();
  });

  it('keeps only listed parameters with listed or label-like values', () => {
    expect(cleanEvent('mode_entered', { mode: 'fly', x: '1' })).toEqual({ mode: 'fly' });
    expect(cleanEvent('mode_entered', { mode: 'walk' })).toEqual({});
    expect(cleanEvent('boot_result', { result: 'ready', ready_bucket: '2-5s' })).toEqual({
      result: 'ready',
      ready_bucket: '2-5s',
    });
    expect(cleanEvent('preset_used', { preset: '반포대교 남단' })).toEqual({
      preset: '반포대교 남단',
    });
    expect(cleanEvent('district_used', { district: 'x'.repeat(41) })).toEqual({});
    expect(cleanEvent('district_used', { district: 'a\nb' })).toEqual({});
  });

  it('reports the ready time only as a coarse bucket', () => {
    expect(readyBucket(1500)).toBe('<2s');
    expect(readyBucket(2000)).toBe('2-5s');
    expect(readyBucket(7000)).toBe('5-10s');
    expect(readyBucket(30000)).toBe('>10s');
  });
});

describe('analytics loading', () => {
  it('loads nothing when the visitor opts out before the idle callback runs', async () => {
    vi.resetModules();
    let idle: (() => void) | undefined;
    const created: string[] = [];
    const win: Record<string, unknown> = {
      requestIdleCallback: (fn: () => void) => {
        idle = fn;
      },
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('location', {
      hostname: 'ldhbenecia.github.io',
      search: '',
      origin: 'https://ldhbenecia.github.io',
      pathname: '/neon-megacity/',
    });
    vi.stubGlobal('navigator', { webdriver: false, doNotTrack: '0' });
    vi.stubGlobal('document', {
      documentElement: { dataset: {} },
      createElement: (tag: string) => {
        created.push(tag);
        return {};
      },
      head: { append: () => undefined },
    });
    try {
      const a = await import('../src/ux/analytics');
      a.startAnalytics({ result: 'ready', readyMs: 1000 }, 'G-B6LC4ZYSC6');
      expect(idle).toBeDefined();
      a.setAnalyticsOptOut(true, 'G-B6LC4ZYSC6');
      idle?.();
      expect(created).toEqual([]);
      expect(win['ga-disable-G-B6LC4ZYSC6']).toBe(true);
      expect(win.gtag).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
