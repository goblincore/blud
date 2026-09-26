// src/lab/sdf-zombie/webgpu/level-events.test.ts
import { describe, expect, it } from 'vitest';
import type { GateDef, TriggerDef } from './level-def';
import { commandsFor, gatesOpenedBy, makeTriggerState, stepTriggers } from './level-events';

const trig = (id: string, event: string, once = true): TriggerDef =>
  ({ id, event, once, box: { min: [0, 0, 0], max: [2, 2, 2] } });

describe('stepTriggers', () => {
  it('fires on entering, not while standing inside', () => {
    const defs = [trig('t', 'wave.0', false)];
    let s = makeTriggerState();
    let r = stepTriggers(defs, s, [5, 0, 5]);
    expect(r.events).toEqual([]);
    r = stepTriggers(defs, r.state, [1, 0, 1]);
    expect(r.events).toEqual(['wave.0']);
    r = stepTriggers(defs, r.state, [1.2, 0, 1]);
    expect(r.events).toEqual([]);
    r = stepTriggers(defs, r.state, [5, 0, 5]);
    r = stepTriggers(defs, r.state, [1, 0, 1]);
    expect(r.events).toEqual(['wave.0']); // not once: re-entering fires again
    s = r.state;
    expect(s.spent.size).toBe(0);
  });

  it('fires a once-trigger a single time', () => {
    const defs = [trig('t', 'alert.room.4')];
    let r = stepTriggers(defs, makeTriggerState(), [1, 0, 1]);
    expect(r.events).toEqual(['alert.room.4']);
    r = stepTriggers(defs, r.state, [5, 0, 5]);
    r = stepTriggers(defs, r.state, [1, 0, 1]);
    expect(r.events).toEqual([]);
  });
});

describe('gatesOpenedBy', () => {
  const gates: GateDef[] = [{ id: 'slab', opensOn: 'bell.toll.1', box: { min: [0, 0, 0], max: [1, 1, 1] } }];
  it('opens a gate on its event and keeps earlier ones open', () => {
    expect([...gatesOpenedBy(gates, new Set(), ['wave.0'])]).toEqual([]);
    const open = gatesOpenedBy(gates, new Set(['other']), ['bell.toll.1']);
    expect([...open].sort()).toEqual(['other', 'slab']);
  });
});

describe('commandsFor', () => {
  it('maps the event vocabulary to commands', () => {
    expect(commandsFor('wave.2', 'pickup.cd')).toEqual([{ kind: 'wave', wave: 2 }]);
    expect(commandsFor('bell.toll.1', 'pickup.cd')).toEqual([{ kind: 'wave', wave: 1 }]);
    expect(commandsFor('alert.room.4', 'pickup.cd')).toEqual([{ kind: 'alert-room', room: 4 }]);
    expect(commandsFor('pickup.cd', 'pickup.cd')).toEqual([{ kind: 'complete' }]);
    expect(commandsFor('pickup.shells', 'pickup.cd')).toEqual([]);
    expect(commandsFor('wave.x', 'pickup.cd')).toEqual([]);
  });
});
