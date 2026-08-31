import { describe, it, expect } from 'vitest';
import {
  buildFirefight, actionsAt, segmentAt, validateScenario,
} from './game-bench-scenario';

describe('buildFirefight', () => {
  it('covers every frame with exactly one segment', () => {
    const s = buildFirefight({ room: 4 });
    for (let f = 0; f < s.frames; f++) {
      expect(segmentAt(s, f), `frame ${f}`).not.toBeNull();
    }
    expect(validateScenario(s)).toEqual([]);
  });

  it('names the three segments the report is built around', () => {
    const s = buildFirefight({ room: 4 });
    expect(s.segments.map(x => x.name)).toEqual(['walk', 'fire', 'gib']);
  });

  it('teleports to the requested room on frame 0', () => {
    const s = buildFirefight({ room: 2 });
    expect(actionsAt(s, 0)).toContainEqual({ kind: 'teleport', room: 2 });
  });

  it('never aims by cluster centre — every shot is preceded by aimSurface', () => {
    const s = buildFirefight({ room: 4 });
    const shots = s.steps.filter(x => x.action.kind === 'fire' || x.action.kind === 'fireSlug');
    expect(shots.length).toBeGreaterThan(0);
    for (const shot of shots) {
      const aims = s.steps.filter(
        x => x.action.kind === 'aimSurface' && x.at < shot.at && x.at >= shot.at - 30,
      );
      expect(aims.length, `shot at ${shot.at} has no aimSurface within 30 frames`).toBeGreaterThan(0);
    }
  });

  it('is deterministic — same options give an identical script', () => {
    expect(buildFirefight({ room: 3 })).toEqual(buildFirefight({ room: 3 }));
  });

  it('flags a scenario whose segments leave a gap', () => {
    const broken = {
      frames: 100,
      steps: [],
      segments: [{ name: 'a', from: 0, to: 40 }, { name: 'b', from: 50, to: 100 }],
    };
    expect(validateScenario(broken)).toContain('gap before frame 50');
  });

  it('flags a step scheduled past the end', () => {
    const broken = {
      frames: 10,
      steps: [{ at: 99, action: { kind: 'fire', barrels: 1 } as const }],
      segments: [{ name: 'a', from: 0, to: 10 }],
    };
    expect(validateScenario(broken)).toContain('step at frame 99 is past frames=10');
  });
});
