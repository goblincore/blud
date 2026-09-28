// src/lab/sdf-zombie/webgpu/light-layers.ts
//
// LIGHT LAYERS (owner 2026-09-28): "roll back to the lighting on the melee branch and re-apply the
// changes step by step". Every change to how BODIES are lit since claude/melee-weapon-design-7d1423
// branched (40619045) sits behind one switch here, and ALL DEFAULT OFF: the game then lights bodies
// the way the melee branch did, over the new level lighting. The LIGHT LAYERS panel toggles them
// live (one needs a reload), so each can be judged on its own and kept or dropped.
//
// ?layers=all turns every layer on (the look shipped before this switch set: capture gates that
// pin that look boot with it); ?layers=list,sCurve turns on just those; ?layers=none is the default.
// Pure: no DOM, no three.js. The panel is light-layers-panel.ts; the call sites read layerOn().

export type LightLayerKey =
  | 'list' | 'listTorch' | 'presentKey' | 'roomFill' | 'stormKey' | 'bodyFog' | 'sCurve' | 'skinDetail';

export interface LightLayer {
  key: LightLayerKey;
  label: string;
  /** What it does, for the panel's tooltip. */
  help: string;
  /** The commits that introduced it. */
  since: string;
  /** Only takes effect after a reload (set once when a body is built). */
  reload?: boolean;
}

export const LIGHT_LAYERS: readonly LightLayer[] = [
  { key: 'list', label: 'shared light list',
    help: 'Each body lit by its own 4 strongest lights (lamps, window, torch, flashes) with presentation profiles. Off: the old single key.',
    since: '6540bd05 (plan 1)' },
  { key: 'listTorch', label: 'torch through the list',
    help: 'With the list on: the torch is one of the 4 lights, judged at the chest, pink hue-preserving tail + white clip. Off: the old per-pixel beam (falloff across the body, whitening shoulder) with the list adding the other lights.',
    since: '83dcd38c, d88c7bb7, 2742f5c8' },
  { key: 'presentKey', label: 'lamps present the bodies',
    help: 'Old path: the room\'s lamp gives each body a three-quarter key from the viewer\'s side, a back rim, and the lightning side rim during strikes.',
    since: 'deba3ea3, 108f697c, 57294595, dd79658e, 29a26e8c, 2b6761cb' },
  { key: 'roomFill', label: 'fill follows the lamps',
    help: 'Doom 3 dark: a body\'s ambient fill and probe light scale with its room\'s live lamps (25% floor when they die).',
    since: 'fafdc730' },
  { key: 'stormKey', label: 'cold key on storm levels',
    help: 'Storm levels (Night Train) give every body a cold blue base key.',
    since: 'ee87176d', reload: true },
  { key: 'bodyFog', label: 'bodies take the fog',
    help: 'Bodies fade into the scene\'s range fog like the level does.',
    since: '5ba4e40d' },
  { key: 'sCurve', label: 'final S-curve',
    help: 'The gentle 0.25 contrast curve at the final blit (pivot 0.18).',
    since: '80946978, 3a49f1eb' },
  { key: 'skinDetail', label: 'skin detail (soldier)',
    help: 'Detail-preserving highlight compression, k 1 on the soldier.',
    since: '032f3878, 8aeb57a7' },
];

const KEYS = new Set<string>(LIGHT_LAYERS.map(l => l.key));

/** The layers a `?layers=` value turns on: 'all', 'none' (or absent), or a comma list. */
export function parseLayers(param: string | null): Set<LightLayerKey> {
  if (param === null || param === '' || param === 'none') return new Set();
  if (param === 'all') return new Set(LIGHT_LAYERS.map(l => l.key));
  return new Set(param.split(',').map(s => s.trim()).filter((s): s is LightLayerKey => KEYS.has(s)));
}

const on = parseLayers(typeof location !== 'undefined' ? new URLSearchParams(location.search).get('layers') : null);
const listeners: ((key: LightLayerKey, value: boolean) => void)[] = [];

export const layerOn = (key: LightLayerKey): boolean => on.has(key);

export function setLayer(key: LightLayerKey, value: boolean): void {
  if (value === on.has(key)) return;
  if (value) on.add(key); else on.delete(key);
  for (const fn of listeners) fn(key, value);
}

/** Called after every change (the game re-applies live state; the panel refreshes). */
export function onLayerChange(fn: (key: LightLayerKey, value: boolean) => void): void {
  listeners.push(fn);
}

/** The current state, for seams and the panel's copy line. */
export function layerState(): Record<LightLayerKey, boolean> {
  return Object.fromEntries(LIGHT_LAYERS.map(l => [l.key, on.has(l.key)])) as Record<LightLayerKey, boolean>;
}
