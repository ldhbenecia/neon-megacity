import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localPort } from './e2e/helpers';

const KEYS = ['E2E_PORT', 'SHOTS_PORT', 'PERF_PORT'] as const;

describe('localPort', () => {
  let saved: Partial<Record<(typeof KEYS)[number], string>> = {};
  beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      Reflect.deleteProperty(process.env, k);
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
      else process.env[k] = saved[k];
    }
  });

  it('is stable per worktree, distinct per tool and inside 4200–4979', () => {
    const a = '/work/neon-megacity/.claude/worktrees/perf';
    const b = '/work/neon-megacity/.claude/worktrees/arch';
    expect(localPort('e2e', a)).toBe(localPort('e2e', a));
    expect(localPort('e2e', a)).not.toBe(localPort('e2e', b));
    expect(new Set([localPort('e2e', a), localPort('shots', a), localPort('perf', a)]).size).toBe(
      3,
    );
    for (const p of [localPort('e2e', a), localPort('perf', b)]) {
      expect(p).toBeGreaterThanOrEqual(4200);
      expect(p).toBeLessThanOrEqual(4979);
    }
  });

  it('lets the env variable win', () => {
    process.env.E2E_PORT = '4555';
    expect(localPort('e2e', '/anything')).toBe(4555);
  });
});
