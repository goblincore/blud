import { describe, it, expect } from 'vitest';
import {
  aggregatePassSamples, attributePassSamples, beginPassFrame, installPassTiming, makePassUid, parsePassUid,
  setPassLabel, withPassLabel, UNLABELLED_PASS, type PassSample,
} from './gpu-pass-timing';

describe('pass uid', () => {
  it('round-trips a label and frame around three\'s own uid', () => {
    const uid = makePassUid('sdf:march', 42, 'r:7:3:f0');
    expect(parsePassUid(uid)).toEqual({ label: 'sdf:march', frame: 42 });
    // The pool's parser is anchored on the END: `:f<n>` must still be last.
    expect(uid.match(/^(.*):f(\d+)$/)?.[2]).toBe('0');
  });

  it('rejects uids recorded before the wrap was installed', () => {
    expect(parsePassUid('r:7:3:f0')).toBeNull();
    expect(parsePassUid('p|broken')).toBeNull();
  });
});

describe('aggregatePassSamples', () => {
  it('sums render and compute samples per frame per label', () => {
    const s: PassSample[] = [
      { frame: 1, label: 'a', kind: 'render', ms: 1 },
      { frame: 1, label: 'a', kind: 'compute', ms: 2 },
      { frame: 1, label: 'b', kind: 'render', ms: 5 },
      { frame: 2, label: 'a', kind: 'render', ms: 7 },
    ];
    const m = aggregatePassSamples(s);
    expect([...m.get(1)!.entries()]).toEqual([['a', 3], ['b', 5]]);
    expect([...m.get(2)!.entries()]).toEqual([['a', 7]]);
  });
});

/** A fake of the three internals install() reaches into. */
function fakeRenderer() {
  const pools = {
    render: { trackTimestamp: true, timestamps: new Map<string, number>() },
    compute: { trackTimestamp: true, timestamps: new Map<string, number>() },
  };
  let calls = 0;
  const backend = {
    trackTimestamp: true,
    timestampQueryPool: pools,
    getTimestampUID: (_ctx: unknown) => `r:${calls++}:1:f0`,
  };
  const resolved: string[] = [];
  const renderer = {
    backend,
    async resolveTimestampsAsync(kind = 'render') { resolved.push(kind); },
  };
  return { renderer, backend, pools, resolved };
}

describe('installPassTiming', () => {
  it('prefixes the current label and frame onto three\'s uid', () => {
    const { renderer, backend } = fakeRenderer();
    const t = installPassTiming(renderer as never);
    expect(t.installed).toBe(true);
    const f = beginPassFrame();
    setPassLabel('sdf:polys');
    expect(parsePassUid(backend.getTimestampUID({}))).toEqual({ label: 'sdf:polys', frame: f });
    withPassLabel('compute:tile-bin', () => {
      expect(parsePassUid(backend.getTimestampUID({}))!.label).toBe('compute:tile-bin');
    });
    expect(parsePassUid(backend.getTimestampUID({}))!.label).toBe('sdf:polys');
  });

  it('a new frame resets the label so unclaimed passes are visible as such', () => {
    const { renderer, backend } = fakeRenderer();
    installPassTiming(renderer as never);
    setPassLabel('x');
    beginPassFrame();
    expect(parsePassUid(backend.getTimestampUID({}))!.label).toBe(UNLABELLED_PASS);
  });

  it('collect resolves both pools, drains only labelled entries, and empties the maps', async () => {
    const { renderer, pools, resolved } = fakeRenderer();
    const t = installPassTiming(renderer as never);
    pools.render.timestamps.set(makePassUid('sdf:march', 3, 'r:0:1:f0'), 4.5);
    pools.render.timestamps.set('r:9:9:f0', 100); // pre-install, dropped
    pools.compute.timestamps.set(makePassUid('compute:tile-bin', 3, 'c:0:2:f0'), 0.25);
    const out = await t.collect();
    expect(resolved).toEqual(['render', 'compute']);
    expect(out).toEqual([
      { frame: 3, label: 'sdf:march', kind: 'render', ms: 4.5 },
      { frame: 3, label: 'compute:tile-bin', kind: 'compute', ms: 0.25 },
    ]);
    expect(pools.render.timestamps.size).toBe(0);
    expect(pools.compute.timestamps.size).toBe(0);
    expect(await t.collect()).toEqual([]);
  });

  it('drops a sample whose raw end precedes its start (an empty pass) instead of poisoning the batch', async () => {
    const { renderer, pools, backend } = fakeRenderer();
    // Wire a resolve buffer path: the fake device copies from the pool's
    // resolveBuffer, which here is a plain object holding the values.
    const times = new BigUint64Array(8);
    times[0] = 1000n; times[1] = 500n;        // empty pass: end < start
    times[2] = 1200n; times[3] = 3_200_000n;   // real pass: 3.2 ms after
    const staging = {
      mapState: 'unmapped',
      async mapAsync() { this.mapState = 'mapped'; },
      getMappedRange() { return times.buffer; },
      unmap() { this.mapState = 'unmapped'; },
      destroy() {},
    };
    (backend as unknown as { device: unknown }).device = {
      createBuffer: () => staging,
      createCommandEncoder: () => ({ copyBufferToBuffer() {}, finish() { return {}; } }),
      queue: { submit() {} },
    };
    Object.assign(pools.render, { queryOffsets: new Map(), currentQueryIndex: 4, resolveBuffer: {}, maxQueries: 4 });
    (backend as unknown as { resolveTimestampsAsync: () => Promise<void> }).resolveTimestampsAsync = async () => {};
    const t = installPassTiming(renderer as never);
    const uidEmpty = makePassUid('goo:density', 1, 'r:0:1:f0');
    const uidReal = makePassUid('sdf:march', 1, 'r:1:2:f0');
    const offsets = (pools.render as unknown as { queryOffsets: Map<string, number> }).queryOffsets;
    offsets.set(uidEmpty, 0);
    offsets.set(uidReal, 2);
    await (backend as unknown as { resolveTimestampsAsync: () => Promise<void> }).resolveTimestampsAsync();
    pools.render.timestamps.set(uidEmpty, -0.0005);
    pools.render.timestamps.set(uidReal, 3.2);
    const out = await t.collect();
    expect(out.map((s) => s.label)).toEqual(['sdf:march']);
    expect(out[0]!.end! - out[0]!.start!).toBeCloseTo(3.1988, 3);
  });

  it('degrades to not-installed without timestamp tracking, never throws', async () => {
    const t = installPassTiming({ backend: { trackTimestamp: false, getTimestampUID: () => 'x' } } as never);
    expect(t.installed).toBe(false);
    expect(await t.collect()).toEqual([]);
    const u = installPassTiming({} as never);
    expect(u.installed).toBe(false);
  });
});

describe('attributePassSamples', () => {
  it('charges overlapping passes by completion order so charges sum to the span', () => {
    // A: 0-4. B: vertex starts at 1 (overlap), fragments end at 6.
    // C: 6-7. Wall sums to 4+5+1 = 10 over a 7 ms span.
    const s: PassSample[] = [
      { frame: 1, label: 'a', kind: 'render', ms: 4, start: 0, end: 4 },
      { frame: 1, label: 'b', kind: 'render', ms: 5, start: 1, end: 6 },
      { frame: 1, label: 'c', kind: 'render', ms: 1, start: 6, end: 7 },
    ];
    const { exclusive, span } = attributePassSamples(s);
    expect([...exclusive.get(1)!.entries()]).toEqual([['a', 4], ['b', 2], ['c', 1]]);
    expect(span.get(1)).toBe(7);
  });

  it('charges a gap before a pass starts to gpu:idle, not to the pass', () => {
    // A ends at 4; B does not START until 9 (CPU-bound bubble); B runs 9-10.
    const s: PassSample[] = [
      { frame: 1, label: 'a', kind: 'render', ms: 4, start: 0, end: 4 },
      { frame: 1, label: 'b', kind: 'render', ms: 1, start: 9, end: 10 },
    ];
    const { exclusive, span } = attributePassSamples(s);
    expect(exclusive.get(1)!.get('a')).toBe(4);
    expect(exclusive.get(1)!.get('b')).toBe(1);
    expect(exclusive.get(1)!.get('gpu:idle')).toBe(5);
    expect(span.get(1)).toBe(10);
  });

  it('carries the cursor across frames so a pipelined first pass is not charged the previous tail', () => {
    // Frame 1: a 0-10. Frame 2's first pass b starts at 4 (overlapping) and
    // ends at 12; c 12-13. b must be charged 2, not 8.
    const s: PassSample[] = [
      { frame: 1, label: 'a', kind: 'render', ms: 10, start: 0, end: 10 },
      { frame: 2, label: 'b', kind: 'render', ms: 8, start: 4, end: 12 },
      { frame: 2, label: 'c', kind: 'render', ms: 1, start: 12, end: 13 },
    ];
    const { exclusive, span } = attributePassSamples(s);
    expect(exclusive.get(1)!.get('a')).toBe(10);
    expect(exclusive.get(2)!.get('b')).toBe(2);
    expect(exclusive.get(2)!.get('c')).toBe(1);
    expect(span.get(1)! + span.get(2)!).toBe(13);
  });

  it('falls back to wall durations when any sample lacks raw boundaries', () => {
    const s: PassSample[] = [
      { frame: 2, label: 'a', kind: 'render', ms: 3 },
      { frame: 2, label: 'a', kind: 'compute', ms: 1, start: 0, end: 1 },
    ];
    const { exclusive, span } = attributePassSamples(s);
    expect(exclusive.get(2)!.get('a')).toBe(4);
    expect(span.get(2)).toBe(4);
  });
});
