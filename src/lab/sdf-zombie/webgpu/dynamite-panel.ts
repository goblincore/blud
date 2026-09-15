// src/lab/sdf-zombie/webgpu/dynamite-panel.ts
//
// The DYNAMITE / GIB tuning panel. See panel-chrome.ts for the shared shell
// (title bar, collapse caret, close button) — this ships VISIBLE but COLLAPSED
// like the other three, at the fourth slot (right:782px) so all four title bars
// sit side by side and stay clickable.
//
// WHY IT EXISTS: the agent that built the gib could not see it. Every claim in
// the dev-notes is a measurement — the piece set is split, the skeleton is
// released, the bones are marched into the frame — and a measurement cannot say
// whether any of it READS as gore. The owner can, and the fastest way to hand
// him the levers is a panel beside the frame rather than a `?knob=` reload per
// attempt.
//
// ONE KEY TABLE DRIVES THE SLIDERS, THE SETTER AND THE COPY TEXT, which is
// wound-panel.ts's rule and it earned its place twice in this project (a panel
// emitting keys the setter ignored has shipped twice; both times the tuning
// looked applied and was not). The page's `setDynamiteTuning` maps exactly
// these names.
//
// WHAT IT DELIBERATELY DOES NOT OWN: the piece SET itself (which prims become
// which pieces, the cut planes, the bone groups). Those are structural and are
// a source change with tests, not a slider — the panel exposes the two A/B
// switches around them (`mode`, `bones`) and the cost/look levers.

import { createPanelShell } from './panel-chrome';

export interface DynamiteKey<K extends string = string> {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Names for a knob that is really a MODE: the readout prints the label and
   *  the slider still moves over integers. */
  labels?: readonly string[];
  /** Which DOM event applies the value. 'input' (default) applies on every drag
   *  tick, which is right for everything here: they are all live scalars. */
  commit?: 'input' | 'change';
}

/** The knob union, then the table checked against it BOTH ways — a row key
 *  outside the union is a compile error (the "key the setter never heard of"
 *  bug), and a union key with no row is a compile error (a COPY that silently
 *  omits a knob). */
export type DynamiteTuningKey =
  // ——— the gib
  | 'maxchunks' | 'mode' | 'bones' | 'stagger' | 'tearSec' | 'tearAmp'
  | 'tearJiggle' | 'gibvel'
  // ——— the BLAST (its own group: these are what the blast DOES to the world,
  //     as opposed to what it looks like — see the owner's report in the table)
  | 'aoesize' | 'edgekick'
  // ——— the burst
  | 'fxsize' | 'fxsmoke' | 'fxlife' | 'fxgain'
  | 'plume' | 'capflat' | 'neck' | 'cap'
  | 'ringreach' | 'ringopacity' | 'emberspeed'
  // ——— how much the blast LIGHTS the room (mesh pool + probe gather together),
  //     and how far that light REACHES
  | 'fxlight' | 'fxspread';
export type DynamiteTuningValues = Record<DynamiteTuningKey, number>;

/** Mode labels, exported so the page's setter and the COPY text agree on the
 *  NUMBER→NAME mapping as well as on the key. */
export const GIB_MODES = ['clusters', 'pieces', 'parts'] as const;
export const GIB_BONES = ['off', 'core', 'all'] as const;

const _DYNAMITE_KEYS = [
  // ——— THE GIB. `maxchunks` is first on purpose: measured, the pool is what
  // decides WHICH SHAPE a body gets. A point-blank bundle in the arena gibs five
  // bodies, and at a 24-view pool the allocation has to hand most of them the
  // cheap rung — one chunk per limb, which is the "tubes and orbs" read the
  // split piece set exists to replace. Pieces cost the frame nothing measurable
  // (16.70 ms in both arms of a shown/hidden A/B at 24 AND at 64), so this is a
  // LOOK lever, not a cost one.
  { key: 'maxchunks', label: 'piece pool', min: 1, max: 96, step: 1, value: 64 },
  { key: 'mode', label: 'piece set', min: 0, max: 2, step: 1, value: 2, labels: GIB_MODES,
    commit: 'change' },
  { key: 'bones', label: 'skeleton', min: 0, max: 2, step: 1, value: 2, labels: GIB_BONES,
    commit: 'change' },
  { key: 'stagger', label: 'release waves', min: 1, max: 8, step: 1, value: 3 },
  { key: 'tearSec', label: 'pre-tear (s)', min: 0, max: 0.4, step: 0.01, value: 0.1 },
  { key: 'tearAmp', label: 'tear bulge (m)', min: 0, max: 0.12, step: 0.005, value: 0.035 },
  { key: 'tearJiggle', label: 'tear jiggle', min: 0, max: 1, step: 0.05, value: 0.4 },
  { key: 'gibvel', label: 'piece launch', min: 0, max: 2, step: 0.05, value: 0.35 },
  // ——— THE BLAST ITSELF, first because it is the first thing to reach for. The
  // owner, playing this: "it seems the effective radius of the explosion is
  // quite large … the area of effect should be abit more focused", AND a body
  // at the far edge was being THROWN off screen. `aoesize` multiplies the whole
  // distance-gated blast (damage, wounds, launch, hand band) — 1 is the
  // reference's 4.6875 m. `edgekick` is how much of the point-blank launch
  // survives to the radius edge: at 1 every edge body is flung as hard as a
  // point-blank one, at 0 only the epicentre launches. Neither touches the
  // fireball's SIZE (`fxsize` owns that), so focusing the blast cannot
  // silently resize an explosion that was already tuned.
  { key: 'aoesize', label: 'AOE size (x)', min: 0.3, max: 1.5, step: 0.02, value: 1 },
  { key: 'edgekick', label: 'edge fling', min: 0, max: 1, step: 0.02, value: 0.45 },
  // ——— THE BURST.
  { key: 'fxsize', label: 'burst size', min: 0.1, max: 2, step: 0.02, value: 0.42 },
  { key: 'fxsmoke', label: 'smoke', min: 0, max: 1, step: 0.02, value: 0.38 },
  { key: 'fxlife', label: 'life (s)', min: 0.3, max: 3, step: 0.05, value: 1.15 },
  { key: 'fxgain', label: 'fire gain', min: 0, max: 4, step: 0.05, value: 1.25 },
  // The shape A/B: 1 is the plume, 0 is the round fireball this replaced.
  { key: 'plume', label: 'plume vs ball', min: 0, max: 1, step: 0.05, value: 1 },
  { key: 'capflat', label: 'cap flatness', min: 0, max: 1, step: 0.05, value: 0.55 },
  { key: 'neck', label: 'neck top (h)', min: 0, max: 4, step: 0.05, value: 1.35 },
  { key: 'cap', label: 'cap top (h)', min: 0, max: 4, step: 0.05, value: 2 },
  { key: 'ringreach', label: 'ring reach (h)', min: 0, max: 6, step: 0.1, value: 1.4 },
  { key: 'ringopacity', label: 'ring', min: 0, max: 1, step: 0.05, value: 1 },
  { key: 'emberspeed', label: 'sparks (h/s)', min: 0, max: 20, step: 0.5, value: 4.5 },
  // ——— THE ROOM LIGHT. The owner: "i feel the explosion needs to light up the
  // room like i said like the whole room". Measured at the shipped value, the
  // arena's whole-frame mean goes 30.16 -> 39.05 (+8.89) — the light DOES carry
  // across the room; whether that reads as "the whole room lights up" is his
  // call, so it is a slider rather than an argument. Scales the mesh pool and
  // the probe gather TOGETHER, because scaling one side only would let the
  // walls and the bodies disagree about how bright the blast was.
  { key: 'fxlight', label: 'blast light', min: 0, max: 4, step: 0.05, value: 1 },
  // ——— THE LIGHT'S REACH. A packed light is a POINT light (1/d²), so the blast
  // lit a disc of floor around the crater and left the room dark — the owner:
  // "the explosion seems to have a rather small radius of light effect", with
  // "lighting the room will fix it" for picking the gibs out. This adds the
  // SOFT component a real detonation has (the flash scattering in air, dust and
  // smoke) at `intensity · spread / (1 + d²/4²)`: still ~1 at the crater, but
  // ~0.2 at 8 m against the hard term's 1/64 — a 12.8x lift in the far field for
  // the same peak, so the room fills without the crater blowing out. 0 is the
  // old pure point light.
  { key: 'fxspread', label: 'light reach', min: 0, max: 3, step: 0.05, value: 1.2 },
] as const satisfies readonly DynamiteKey<DynamiteTuningKey>[];

type TableKeys = (typeof _DYNAMITE_KEYS)[number]['key'];
type AssertComplete = [DynamiteTuningKey] extends [TableKeys] ? true : never;
const _COMPLETE: AssertComplete = true;
void _COMPLETE;

/** The consumer view of the table (plain string keys), as a fresh copy so a
 *  caller cannot mutate the checked literals. */
export const DYNAMITE_KEYS: DynamiteKey[] = _DYNAMITE_KEYS.map(k => ({ ...k }));

export function defaultsFrom(keys: readonly DynamiteKey[] = DYNAMITE_KEYS): DynamiteTuningValues {
  return Object.fromEntries(keys.map(k => [k.key, k.value])) as DynamiteTuningValues;
}

/** The exact console call that reproduces the panel's current state. */
export function copyText(values: Record<string, number>): string {
  const body = DYNAMITE_KEYS
    .map(k => `  ${k.key}: ${values[k.key] ?? k.value}`)
    .join(',\n');
  return `__sdfGame.setDynamiteTuning({\n${body}\n});`;
}

export interface DynamitePanel {
  readonly el: HTMLElement;
  readonly visible: boolean;
  readonly collapsed: boolean;
  setVisible(on: boolean): void;
  setCollapsed(on: boolean): void;
  /** Pull every slider back into line with the live values (after a preset or
   *  a console call). */
  refresh(): void;
  dispose(): void;
}

export function createDynamitePanel(opts: {
  /** Live values — the read-back source, so a row shows what the setter
   *  APPLIED rather than what the slider requested (a clamp hidden behind a
   *  slider is the bug goo-panel.ts records). */
  get(): DynamiteTuningValues;
  /** Apply one key, by exactly the key names in the table. */
  set(key: DynamiteTuningKey, v: number): void;
  presets?: { label: string; values: Partial<DynamiteTuningValues> }[];
  onCopy?: (text: string) => void;
}): DynamitePanel {
  const shell = createPanelShell('DYNAMITE / GIB', { right: 782 });
  const body = shell.body;

  const rows: { k: DynamiteKey; input: HTMLInputElement; out: HTMLSpanElement }[] = [];
  const read = (k: DynamiteKey): number => opts.get()[k.key as DynamiteTuningKey] ?? k.value;
  const show = (k: DynamiteKey, v: number): string =>
    k.labels ? (k.labels[Math.round(v)] ?? String(v)) : fmt(v);

  for (const k of _DYNAMITE_KEYS) {
    const row = document.createElement('div');
    row.setAttribute('style', 'display:flex; align-items:center; gap:6px; margin-bottom:3px;');

    const name = document.createElement('span');
    name.textContent = k.label;
    name.setAttribute('style', 'width:80px; flex:none;');

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(k.min);
    input.max = String(k.max);
    input.step = String(k.step);
    input.value = String(read(k));
    input.setAttribute('style', 'flex:1; min-width:0; accent-color:#d8402f;');

    const out = document.createElement('span');
    out.textContent = show(k, read(k));
    out.setAttribute('style', 'width:52px; flex:none; text-align:right; color:#d8402f;');

    const apply = () => {
      const v = parseFloat(input.value);
      opts.set(k.key as DynamiteTuningKey, v);
      // Read BACK, never echo the slider.
      out.textContent = show(k, read(k));
    };
    input.addEventListener('commit' in k ? k.commit : 'input', apply);

    row.append(name, input, out);
    body.appendChild(row);
    rows.push({ k, input, out });
  }

  function refresh(): void {
    for (const r of rows) {
      const v = read(r.k);
      r.input.value = String(v);
      r.out.textContent = show(r.k, v);
    }
  }

  const btnRow = document.createElement('div');
  btnRow.setAttribute('style', 'display:flex; gap:5px; flex-wrap:wrap; margin-top:8px;');
  // THE TWO PRESETS THAT MATTER. `split` is the new piece set with the pool
  // wide enough that a crowd does not degrade it; `tubes` is the shape the
  // owner rejected, one keystroke away, so the comparison is his and not a
  // dev-note's.
  for (const preset of opts.presets ?? []) {
    btnRow.appendChild(button(preset.label, () => {
      for (const [key, v] of Object.entries(preset.values)) {
        opts.set(key as DynamiteTuningKey, v!);
      }
      refresh();
    }));
  }
  btnRow.appendChild(button('copy', () => {
    const text = copyText({ ...opts.get() });
    void navigator.clipboard?.writeText(text).catch(() => { /* non-secure origin */ });
    // Logged as well as copied: a clipboard write fails silently on a
    // non-secure origin, and losing a tuning pass to that would be galling.
    // eslint-disable-next-line no-console
    console.log(text);
    opts.onCopy?.(text);
  }));
  body.appendChild(btnRow);

  const note = document.createElement('div');
  note.textContent = 'sliders apply LIVE · copy → clipboard + console · H hides every panel';
  note.setAttribute('style', 'color:#6f625e; margin-top:6px; font-size:10px;');
  body.appendChild(note);

  shell.onReveal(refresh);
  return {
    el: shell.el,
    get visible() { return shell.visible; },
    get collapsed() { return shell.collapsed; },
    setVisible(on) { shell.setVisible(on); },
    setCollapsed(on) { shell.setCollapsed(on); },
    refresh,
    dispose() { shell.dispose(); },
  };
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.setAttribute('style',
    'background:#2b2321; color:#e8ddd8; border:1px solid #3a2f2d; border-radius:2px;'
    + 'padding:4px 7px; font:10px ui-monospace,monospace; cursor:pointer;');
  b.addEventListener('click', onClick);
  return b;
}

/** Trim to a readable width without lying about the value. */
function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(Math.abs(v) < 1 ? 2 : 1);
}
