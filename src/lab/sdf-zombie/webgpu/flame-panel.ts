// src/lab/sdf-zombie/webgpu/flame-panel.ts
//
// The flame lab's tuning panel. The KEY TABLE is the contract: it names every
// BurnTuning field exactly once, its test pins that both ways, and COPY emits a
// setter call whose keys are the same names -- which is what stops a tuning
// session ending in numbers nothing reads (dynamite-panel.ts:190 has the scars).
import { createPanelShell, type PanelShell } from './panel-chrome';
import { BURN_BOUNDS, burnPresets, type BurnTuning } from './burn-profiles';

export interface FlameKey {
  key: keyof BurnTuning;
  label: string;
  /** Read from BURN_BOUNDS, never restated — the clamp is the authority. */
  min: number;
  max: number;
  step: number;
}

/** Label and slider step per field; the RANGE comes from BURN_BOUNDS, so a
 *  retuned clamp moves the slider with it and the two cannot drift. */
const LABELS: Record<keyof BurnTuning, { label: string; step: number }> = {
  igniteSec: { label: 'ignite s', step: 0.05 },
  extinguishSec: { label: 'out s', step: 0.05 },
  charRate: { label: 'char /s', step: 0.02 },
  fireGain: { label: 'fire gain', step: 0.05 },
  noiseScale: { label: 'noise scale', step: 0.5 },
  riseSpeed: { label: 'rise', step: 0.1 },
  charPatch: { label: 'char patch', step: 0.02 },
  lightPeak: { label: 'light', step: 1 },
  lightFlicker: { label: 'flicker', step: 0.02 },
  glowGain: { label: 'glow', step: 0.02 },
  glowThreshold: { label: 'glow thr', step: 0.05 },
  distortStrength: { label: 'heat warp', step: 0.001 },
};

export const FLAME_KEYS: readonly FlameKey[] = Object.freeze(
  (Object.keys(LABELS) as (keyof BurnTuning)[]).map((key) => ({
    key, ...LABELS[key], min: BURN_BOUNDS[key][0], max: BURN_BOUNDS[key][1],
  })),
);

export function copyText(t: BurnTuning): string {
  const body = FLAME_KEYS.map(k => `${k.key}: ${Number(t[k.key].toFixed(4))}`).join(', ');
  return `__sdfGame.setBurnTuning({${body}})`;
}

export interface FlamePanelOpts {
  read(): BurnTuning;
  apply(patch: Partial<BurnTuning>): BurnTuning;
  preset(name: keyof typeof burnPresets): BurnTuning;
  onCopy?(text: string): void;
}

export function createFlamePanel(opts: FlamePanelOpts): PanelShell {
  const shell = createPanelShell('FLAME', { right: 8 });
  for (const k of FLAME_KEYS) {
    const row = document.createElement('div');
    const label = document.createElement('span');
    label.textContent = k.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(k.min); input.max = String(k.max); input.step = String(k.step);
    input.value = String(opts.read()[k.key]);
    const out = document.createElement('span');
    const show = () => { out.textContent = String(Number(opts.read()[k.key].toFixed(4))); };
    input.addEventListener('input', () => {
      opts.apply({ [k.key]: Number(input.value) } as Partial<BurnTuning>);
      show();                           // read BACK, never echo the slider
    });
    show();
    row.append(label, input, out);
    shell.body.append(row);
  }
  for (const name of Object.keys(burnPresets) as (keyof typeof burnPresets)[]) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = name;
    b.addEventListener('click', () => { opts.preset(name); shell.el.dispatchEvent(new Event('flame:preset')); });
    shell.body.append(b);
  }
  const copy = document.createElement('button');
  copy.type = 'button'; copy.textContent = 'COPY';
  copy.addEventListener('click', () => {
    const text = copyText(opts.read());
    // Caught: a clipboard write rejects loudly on a denied/non-secure origin
    // (measured in headless Chrome) and the console line below is the copy
    // that always lands -- dynamite-panel.ts's reason for logging as well.
    void navigator.clipboard?.writeText(text).catch(() => { /* non-secure origin */ });
    console.log(text);
    opts.onCopy?.(text);
  });
  shell.body.append(copy);
  const note = document.createElement('div');
  note.textContent = 'sliders apply LIVE · copy → clipboard + console · H hides the panel';
  shell.body.append(note);
  return shell;
}
