// src/lab/sdf-zombie/webgpu/level-bridge.test.ts
import { describe, expect, it } from 'vitest';
import { bridgeHoldS, isLevelId, parseBridge, parseOnComplete, stepBridge, targetUrl } from './level-bridge';

const CARD = { kind: 'card', rgb: [0, 0, 0], text: 'NIGHT TRAIN', holdS: 2.5 };

describe('isLevelId', () => {
  it('accepts the level id alphabet and nothing else', () => {
    expect(isLevelId('flat-early')).toBe(true);
    expect(isLevelId('night-train')).toBe(true);
    for (const bad of ['', 'Flat', 'a b', 'a/b', '../x', 'a?b', 'a&b=c']) expect(isLevelId(bad), bad).toBe(false);
  });
});

describe('parseBridge / parseOnComplete', () => {
  it('parses a card and defaults its colour, text and hold', () => {
    const e: string[] = [];
    expect(parseBridge(CARD, e)).toEqual(CARD);
    expect(parseBridge({ kind: 'card' }, e)).toEqual({ kind: 'card', rgb: [0, 0, 0], text: '', holdS: 2 });
    expect(e).toEqual([]);
  });
  it('refuses an unknown kind, a bad colour, a negative or huge hold', () => {
    for (const bad of [{ kind: 'movie' }, { kind: 'card', rgb: [2, 0, 0] }, { kind: 'card', rgb: [0, 0] }, { kind: 'card', holdS: -1 }, { kind: 'card', holdS: 99 }, { kind: 'card', text: 4 }, 'card', null]) {
      const e: string[] = [];
      expect(parseBridge(bad, e), JSON.stringify(bad)).toBeNull();
      expect(e.length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
  it('parses onComplete, keeping its parts and refusing a bad goto or an unknown key', () => {
    const e: string[] = [];
    expect(parseOnComplete({ goto: 'flat-early', params: 'emergence=1&from=night-train', bridge: CARD }, e))
      .toEqual({ goto: 'flat-early', params: 'emergence=1&from=night-train', bridge: CARD });
    expect(parseOnComplete({ goto: 'flat-early' }, e)).toEqual({ goto: 'flat-early', params: '', bridge: null });
    expect(parseOnComplete(undefined, e)).toBeNull();
    expect(e).toEqual([]);
    for (const bad of [{ goto: '../x' }, { goto: 'a', extra: 1 }, { params: 'x=1' }, [], 'flat']) {
      const e2: string[] = [];
      parseOnComplete(bad, e2);
      expect(e2.length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
});

describe('targetUrl', () => {
  const onc = { goto: 'flat-early', params: 'emergence=1&from=night-train' };
  it('goes to the level with its own params and keeps the others the player booted with', () => {
    const u = new URL(targetUrl('/sdf-game.html', onc, '?level=night-train&res=320&upscale=0&graphics=high')!, 'http://x');
    expect(u.pathname).toBe('/sdf-game.html');
    expect(Object.fromEntries(u.searchParams)).toEqual({ level: 'flat-early', emergence: '1', from: 'night-train', res: '320', upscale: '0', graphics: 'high' });
  });
  it("drops the old level's own params (level, emergence, from) so nothing is duplicated", () => {
    const u = new URL(targetUrl('/sdf-game.html', onc, '?level=night-train&emergence=0&from=x&res=640')!, 'http://x');
    expect(u.searchParams.getAll('level')).toEqual(['flat-early']);
    expect(u.searchParams.getAll('emergence')).toEqual(['1']);
    expect(u.searchParams.getAll('from')).toEqual(['night-train']);
    expect(u.searchParams.get('res')).toBe('640');
  });
  it('is null for a goto that is not a level id', () => {
    expect(targetUrl('/sdf-game.html', { goto: '../x', params: '' }, '')).toBeNull();
  });
});

describe('the bridge clock', () => {
  it('holds the spec\'s seconds (capped), 0 without a bridge', () => {
    expect(bridgeHoldS(CARD as never)).toBe(2.5);
    expect(bridgeHoldS(null)).toBe(0);
  });
  it('navigates once, on the step that reaches the hold', () => {
    let s = { t: 0, holdS: 1, navigated: false };
    const navs: boolean[] = [];
    for (let i = 0; i < 90; i++) { const r = stepBridge(s, 1 / 60); s = r.state; navs.push(r.navigate); }
    expect(navs.filter(Boolean)).toHaveLength(1);
    expect(navs.indexOf(true)).toBe(59);
    expect(s.navigated).toBe(true);
  });
  it('a zero hold navigates on the first step', () => {
    expect(stepBridge({ t: 0, holdS: 0, navigated: false }, 1 / 60).navigate).toBe(true);
  });
});
