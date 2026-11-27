import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_STORAGE_KEY,
  cleanEvent,
  readOptOut,
  readyBucket,
  shouldLoad,
  type LoadContext,
} from '../src/ux/analytics';

const base: LoadContext = {
  id: 'G-B6LC4ZYSC6',
  hostname: 'ldhbenecia.github.io',
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
