import { describe, it, expect } from 'vitest';
import {
  buildFirefight, actionsAt, segmentAt, validateScenario, scenarioByName,
  DUNGEON_SCENARIOS,
} from './game-bench-scenario';
import { DUNGEON_RIG, GALLERY_RIG } from './dungeon-lighting';

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

describe('off-state parity', () => {
  it('dungeon-off drives the SAME rig values the gallery shipped with', () => {
    const s = scenarioByName('dungeon-off');
    expect(s.rig).toEqual(GALLERY_RIG);
    expect(s.flashlight).toBe(false);
  });
});

describe('dungeon bench legs', () => {
  it('names exactly the three legs the gate reports', () => {
    expect([...DUNGEON_SCENARIOS]).toEqual(['dungeon-off', 'dungeon-no-shadow', 'dungeon-shadow']);
  });

  it('dungeon-no-shadow and dungeon-shadow share the DUNGEON rig and differ ONLY in castShadow', () => {
    const noShadow = scenarioByName('dungeon-no-shadow');
    const shadow = scenarioByName('dungeon-shadow');
    expect(noShadow.rig).toEqual(DUNGEON_RIG);
    expect(shadow.rig).toEqual(DUNGEON_RIG);
    expect(noShadow.flashlight).toBe(true);
    expect(shadow.flashlight).toBe(true);
    expect(noShadow.castShadow).toBe(false);
    expect(shadow.castShadow).toBe(true);
  });

  it('never casts shadows with the flashlight off', () => {
    for (const name of DUNGEON_SCENARIOS) {
      const s = scenarioByName(name);
      if (!s.flashlight) expect(s.castShadow, name).toBe(false);
    }
  });

  it('runs the IDENTICAL firefight script across legs — deltas are lighting only', () => {
    const [first, ...rest] = DUNGEON_SCENARIOS.map((n) => scenarioByName(n));
    for (const s of rest) {
      expect({ frames: s.frames, steps: s.steps, segments: s.segments })
        .toEqual({ frames: first!.frames, steps: first!.steps, segments: first!.segments });
    }
  });

  it('each leg wraps a valid, fully covered firefight', () => {
    for (const name of DUNGEON_SCENARIOS) {
      const s = scenarioByName(name);
      expect(validateScenario(s), name).toEqual([]);
      for (let f = 0; f < s.frames; f++) {
        expect(segmentAt(s, f), `${name} frame ${f}`).not.toBeNull();
      }
    }
  });

  it('is deterministic — the same name rebuilds an identical leg', () => {
    for (const name of DUNGEON_SCENARIOS) {
      expect(scenarioByName(name)).toEqual(scenarioByName(name));
    }
  });
});
