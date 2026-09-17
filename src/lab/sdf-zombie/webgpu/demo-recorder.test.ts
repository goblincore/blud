import { describe, it, expect } from 'vitest';
import { createDemoRecorder, createDemoPlayer, DEMO_VERSION, type DemoFrame } from './demo-recorder';

describe('demo recorder', () => {
  it('round-trips frames and header', () => {
    const rec = createDemoRecorder({ seed: 7, query: 'crowd=1', room: 2, dt: 1 / 60 });
    const f: DemoFrame = { keys: ['KeyW', 'ShiftLeft'], dx: 3.5, dy: -1, fire: 2, reload: false, look: [0.4, -0.05] };
    rec.push(f); rec.push({ ...f, keys: [], fire: 0 });
    const file = rec.stop();
    expect(file.version).toBe(DEMO_VERSION); expect(file.seed).toBe(7); expect(file.frames.length).toBe(2);
    const p = createDemoPlayer(file);
    expect(p.next()).toEqual(f); expect(p.next()!.fire).toBe(0); expect(p.next()).toBeNull(); expect(p.done).toBe(true);
  });

  it('is a pure snapshot: later mutation of a pushed frame or a returned frame does not rewrite history', () => {
    const rec = createDemoRecorder({ seed: 1, query: '', room: 1, dt: 1 / 60 });
    const f: DemoFrame = { keys: ['KeyW'], dx: 1, dy: 2, fire: 0, reload: false, look: [0, 0] };
    rec.push(f);
    f.keys.push('KeyD'); f.look[0] = 9;
    const file = rec.stop();
    expect(file.frames[0]!.keys).toEqual(['KeyW']);
    expect(file.frames[0]!.look).toEqual([0, 0]);
    const p = createDemoPlayer(file);
    const out = p.next()!;
    out.keys.push('KeyA'); out.look[1] = 5;
    expect(file.frames[0]!.keys).toEqual(['KeyW']);
    expect(file.frames[0]!.look).toEqual([0, 0]);
  });

  it('counts frames, defaults startedAt, and refuses a version it does not know', () => {
    const rec = createDemoRecorder({ seed: 2, query: 'seed=2', room: 3, dt: 1 / 60, meta: { label: 'x' } });
    rec.push({ keys: [], dx: 0, dy: 0, fire: 0, reload: false, look: [0, 0] });
    expect(rec.frames).toBe(1);
    const file = rec.stop();
    expect(typeof file.startedAt).toBe('string');
    expect(file.meta.label).toBe('x');
    expect(() => createDemoPlayer({ ...file, version: 999 })).toThrow(/version/);
  });
});
