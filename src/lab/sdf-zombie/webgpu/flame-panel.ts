// src/lab/sdf-zombie/webgpu/flame-panel.ts
//
// The flame lab's tuning panel. The KEY TABLE is the contract: it names every
// BurnTuning field exactly once, its test pins that both ways, and COPY emits a
// setter call whose keys are the same names -- which is what stops a tuning
// session ending in numbers nothing reads (dynamite-panel.ts:190 has the scars).
// The TONGUE keys (plan 2026-09-18 flame-tongues task 1) ride the same contract
// one table down: TONGUE_KEYS names every TongueTuning field, ranges come from
// TONGUE_BOUNDS, and COPY emits the technique plus the tongue values alongside
// the burn values.
import { createPanelShell, type PanelShell } from './panel-chrome';
import { BURN_BOUNDS, burnPresets, type BurnTuning } from './burn-profiles';
import {
  TONGUE_BOUNDS, TONGUE_TECHNIQUES, type TongueTechnique, type TongueTuning,
} from './tongue-tuning';
import {
  FIRE_VOLUME_BOUNDS, FIRE_VOLUME_TUNING, type FireVolumeTuning,
} from './fire-volume-tuning';

export interface FlameKey {
  key: keyof BurnTuning;
  label: string;
  /** Read from BURN_BOUNDS, never restated — the clamp is the authority. */
  min: number;
  max: number;
  step: number;
}

export interface TongueKey {
  key: keyof TongueTuning;
  label: string;
  /** Read from TONGUE_BOUNDS, never restated — the clamp is the authority. */
  min: number;
  max: number;
  step: number;
}

export interface VolumeKey {
  key: keyof FireVolumeTuning;
  label: string;
  /** Read from FIRE_VOLUME_BOUNDS, never restated — the clamp is the authority. */
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
  lightGatherPeak: { label: 'room fire light', step: 1 },
  lightMeshPeak: { label: 'prop fire light', step: 1 },
  glowGain: { label: 'glow', step: 0.02 },
  glowThreshold: { label: 'glow thr', step: 0.05 },
  distortStrength: { label: 'heat warp', step: 0.001 },
  fireCoverage: { label: 'coverage', step: 0.02 },
  skeletonShow: { label: 'skeleton', step: 0.02 },
  skeletonDepth: { label: 'skeleton depth', step: 0.005 },
  cardSoftFade: { label: 'card soft fade', step: 0.01 },
  flameFlow: { label: 'flame flow', step: 0.02 },
  corpseBurnSec: { label: 'corpse burn s', step: 0.1 },
};

export const FLAME_KEYS: readonly FlameKey[] = Object.freeze(
  (Object.keys(LABELS) as (keyof BurnTuning)[]).map((key) => ({
    key, ...LABELS[key], min: BURN_BOUNDS[key][0], max: BURN_BOUNDS[key][1],
  })),
);

/** Label and slider step per tongue field; the RANGE comes from TONGUE_BOUNDS. */
const TONGUE_LABELS: Record<keyof TongueTuning, { label: string; step: number }> = {
  length: { label: 'tongue len', step: 0.02 },
  ragged: { label: 'ragged', step: 0.02 },
  rise: { label: 'tongue rise', step: 0.1 },
  gain: { label: 'tongue gain', step: 0.05 },
  lean: { label: 'lean', step: 0.02 },
};

export const TONGUE_KEYS: readonly TongueKey[] = Object.freeze(
  (Object.keys(TONGUE_LABELS) as (keyof TongueTuning)[]).map((key) => ({
    key, ...TONGUE_LABELS[key], min: TONGUE_BOUNDS[key][0], max: TONGUE_BOUNDS[key][1],
  })),
);

/** Label and slider step per fire-volume field; the RANGE comes from
 *  FIRE_VOLUME_BOUNDS. The keys test pins this names every tuning field. */
const VOLUME_LABELS: Record<keyof FireVolumeTuning, { label: string; step: number }> = {
  resolutionScale: { label: 'vol scale', step: 0.05 },
  steps: { label: 'vol steps', step: 1 },
  tempGain: { label: 'vol temp', step: 0.05 },
  rise: { label: 'vol rise', step: 0.05 },
  curlStrength: { label: 'vol curl', step: 0.02 },
  curlScale: { label: 'curl scale', step: 0.05 },
  lag: { label: 'vol lag', step: 0.02 },
  lagMaxM: { label: 'lag max m', step: 0.02 },
  history: { label: 'vol history', step: 0.02 },
  cardsPerBody: { label: 'cards/body', step: 1 },
  maxBodies: { label: 'vol bodies', step: 1 },
  noiseScale: { label: 'flame noise', step: 0.05 },
  noiseStretch: { label: 'noise stretch', step: 0.02 },
  erode: { label: 'erode', step: 0.02 },
  erodeRise: { label: 'erode rise', step: 0.02 },
  edgeSharp: { label: 'edge sharp', step: 0.1 },
  coreR: { label: 'core radius', step: 0.005 },
  density: { label: 'flame density', step: 0.05 },
  skin: { label: 'flame skin', step: 0.05 },
};

export const VOLUME_KEYS: readonly VolumeKey[] = Object.freeze(
  (Object.keys(VOLUME_LABELS) as (keyof FireVolumeTuning)[]).map((key) => ({
    key, ...VOLUME_LABELS[key], min: FIRE_VOLUME_BOUNDS[key][0], max: FIRE_VOLUME_BOUNDS[key][1],
  })),
);

export function copyText(
  t: BurnTuning, technique: TongueTechnique, tongue: TongueTuning,
  volume: FireVolumeTuning = FIRE_VOLUME_TUNING,
): string {
  const tongueBody = TONGUE_KEYS.map(k => `${k.key}: ${Number(tongue[k.key].toFixed(4))}`).join(', ');
  const body = FLAME_KEYS.map(k => `${k.key}: ${Number(t[k.key].toFixed(4))}`).join(', ');
  const volumeBody = VOLUME_KEYS.map(k => `${k.key}: ${Number(volume[k.key].toFixed(4))}`).join(', ');
  return [
    `__sdfGame.setTechnique('${technique}')`,
    `__sdfGame.setTongueTuning({${tongueBody}})`,
    `__sdfGame.setVolume({${volumeBody}})`,
    `__sdfGame.setBurnTuning({${body}})`,
  ].join(';');
}

export interface FlamePanelOpts {
  read(): BurnTuning;
  apply(patch: Partial<BurnTuning>): BurnTuning;
  preset(name: keyof typeof burnPresets): BurnTuning;
  /** The live technique — which technique button is the marked one. */
  technique(): TongueTechnique;
  setTechnique(name: TongueTechnique): void;
  readTongue(): TongueTuning;
  applyTongue(patch: Partial<TongueTuning>): TongueTuning;
  readVolume(): FireVolumeTuning;
  applyVolume(patch: Partial<FireVolumeTuning>): FireVolumeTuning;
  onCopy?(text: string): void;
}

/** One slider row per key, ranges from the keys table, output reading BACK
 *  from the live record so a clamp behind a slider shows itself. Shared by the
 *  burn rows and the tongue rows so the two cannot drift. */
function sliderRows<K extends string>(
  body: HTMLElement,
  keys: readonly { key: K; label: string; min: number; max: number; step: number }[],
  read: () => Record<K, number>,
  apply: (patch: { [P in K]?: number }) => unknown,
): void {
  for (const k of keys) {
    const row = document.createElement('div');
    const label = document.createElement('span');
    label.textContent = k.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(k.min); input.max = String(k.max); input.step = String(k.step);
    input.value = String(read()[k.key]);
    const out = document.createElement('span');
    const show = () => { out.textContent = String(Number(read()[k.key].toFixed(4))); };
    input.addEventListener('input', () => {
      apply({ [k.key]: Number(input.value) } as { [P in K]?: number });
      show();                           // read BACK, never echo the slider
    });
    show();
    row.append(label, input, out);
    body.append(row);
  }
}

export function createFlamePanel(opts: FlamePanelOpts): PanelShell {
  const shell = createPanelShell('FLAME', { right: 8 });
  // The technique row: one button per TongueTechnique, the ACTIVE one marked
  // with brackets (panel buttons have no CSS to style a class with). The
  // marking re-renders on a `flame:technique` event on the shell element, so
  // key-t and the console API flip the marking too — the panel is not the
  // only writer of the technique, it only shows whoever won.
  const techRow = document.createElement('div');
  const techButtons = new Map<TongueTechnique, HTMLButtonElement>();
  for (const name of TONGUE_TECHNIQUES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.technique = name;
    b.addEventListener('click', () => {
      opts.setTechnique(name);
      shell.el.dispatchEvent(new Event('flame:technique'));
    });
    techButtons.set(name, b);
    techRow.append(b);
  }
  const markTechnique = () => {
    const cur = opts.technique();
    for (const [name, b] of techButtons) b.textContent = name === cur ? `[${name}]` : name;
  };
  markTechnique();
  shell.el.addEventListener('flame:technique', markTechnique);
  shell.body.append(techRow);
  sliderRows(shell.body, FLAME_KEYS, () => opts.read(), (p) => opts.apply(p));
  sliderRows(shell.body, TONGUE_KEYS, () => opts.readTongue(), (p) => opts.applyTongue(p));
  // VOLUME (burning-feedback round 2, task 4d): the fire-volume record's own
  // section, one slider per field, ranges from FIRE_VOLUME_BOUNDS.
  const volumeHeader = document.createElement('div');
  volumeHeader.textContent = 'VOLUME';
  volumeHeader.style.marginTop = '4px';
  volumeHeader.style.opacity = '0.75';
  shell.body.append(volumeHeader);
  sliderRows(shell.body, VOLUME_KEYS, () => opts.readVolume(), (p) => opts.applyVolume(p));
  for (const name of Object.keys(burnPresets) as (keyof typeof burnPresets)[]) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = name;
    b.addEventListener('click', () => { opts.preset(name); shell.el.dispatchEvent(new Event('flame:preset')); });
    shell.body.append(b);
  }
  const copy = document.createElement('button');
  copy.type = 'button'; copy.textContent = 'COPY';
  copy.addEventListener('click', () => {
    const text = copyText(opts.read(), opts.technique(), opts.readTongue());
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
