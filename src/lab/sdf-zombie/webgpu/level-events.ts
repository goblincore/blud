// src/lab/sdf-zombie/webgpu/level-events.ts
//
// LEVEL EVENTS. Triggers fire string events when the player walks in; gates
// open on events; a small vocabulary of events turns into commands the game
// carries out. Pure: game-main feeds positions and applies commands.

import type { Vec3 } from '../types';
import type { CueDef, GateDef, TriggerDef } from './level-def';

export interface TriggerState {
  /** Triggers the player was inside last step (edge detection). */
  inside: ReadonlySet<string>;
  /** Once-triggers that have fired. */
  spent: ReadonlySet<string>;
}

export function makeTriggerState(): TriggerState {
  return { inside: new Set(), spent: new Set() };
}

export function stepTriggers(defs: readonly TriggerDef[], state: TriggerState, feet: Vec3): { state: TriggerState; events: string[] } {
  const inside = new Set<string>();
  const spent = new Set(state.spent);
  const events: string[] = [];
  for (const t of defs) {
    const b = t.box;
    const inBox = feet[0] >= b.min[0] && feet[0] <= b.max[0]
      && feet[1] >= b.min[1] - 0.1 && feet[1] <= b.max[1]
      && feet[2] >= b.min[2] && feet[2] <= b.max[2];
    if (!inBox) continue;
    inside.add(t.id);
    if (state.inside.has(t.id) || spent.has(t.id)) continue;
    events.push(t.event);
    if (t.once) spent.add(t.id);
  }
  return { state: { inside, spent }, events };
}

export function gatesOpenedBy(gates: readonly GateDef[], open: ReadonlySet<string>, events: readonly string[]): Set<string> {
  const next = new Set(open);
  for (const g of gates) if (events.includes(g.opensOn)) next.add(g.id);
  return next;
}

export type LevelCommand =
  | { kind: 'wave'; wave: number }
  | { kind: 'alert-room'; room: number }
  | { kind: 'complete' }
  | { kind: 'light'; mode: LightMode; room: number };

/** Dynamic light §3: scripted lamp events, `light.<mode>.room.<n>`. */
export type LightMode = 'die' | 'blackout' | 'strobe';

/** What an event asks the game to do. `bell.toll.<n>` also calls wave n. */
export function commandsFor(event: string, completeOn: string): LevelCommand[] {
  const out: LevelCommand[] = [];
  if (event === completeOn) out.push({ kind: 'complete' });
  const wave = /^(?:wave|bell\.toll)\.(\d+)$/.exec(event);
  if (wave) out.push({ kind: 'wave', wave: Number(wave[1]) });
  const alert = /^alert\.room\.(\d+)$/.exec(event);
  if (alert) out.push({ kind: 'alert-room', room: Number(alert[1]) });
  const light = /^light\.(die|blackout|strobe)\.room\.(\d+)$/.exec(event);
  if (light) out.push({ kind: 'light', mode: light[1] as LightMode, room: Number(light[2]) });
  return out;
}

/** The events plus what their cues emit, one level deep (a cue's output is not expanded
 *  again, so an authoring cycle cannot loop). */
export function expandCues(events: readonly string[], cues: readonly CueDef[]): string[] {
  const out = [...events];
  for (const ev of events) for (const c of cues) if (c.on === ev) out.push(...c.emit);
  return out;
}
