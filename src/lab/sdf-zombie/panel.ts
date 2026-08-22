// src/lab/sdf-zombie/panel.ts
import type { BodyOverride } from './build-body';
import type { FleshMaterial } from './material';
import type { FaceParams } from './face';

/**
 * Panel overrides are stored PER CHARACTER, with the character's name in the
 * key. Every field of BodyOverride is character-specific and none of them
 * survives being carried across: primRadius/primBlendK are keyed by
 * built-array prim INDEX, which addresses an unrelated primitive on a
 * different body, and faceParams simply IS the character's head.
 *
 * A single shared key therefore leaked whatever was tuned last onto the whole
 * cast — and silently WON, because the panel's override is spread after the
 * .blob's own `face` block (see webgpu/lab-main.ts). Tuning the clown's 0.235
 * cranium left the goblin and the zombie wearing it, across reloads, with
 * nothing on screen to explain the sudden big-head mode.
 *
 * v2, not a migration: the v1 entry is one global blob with no character
 * attached, so there is no character to migrate it TO. It is dropped on sight
 * so the poisoned value cannot come back on the next load.
 */
export const STORAGE_PREFIX = 'blud.sdf-lab.override.v2';
const LEGACY_GLOBAL_KEY = 'blud.sdf-lab.override.v1';

export function overrideKey(character: string): string {
  return `${STORAGE_PREFIX}:${character}`;
}

/** Applies the debug-panel's collapsed state while keeping its external
 * toggle usable and screen-reader legible. The caller owns event wiring so
 * the same state can be driven by the button and the FPV-safe H shortcut. */
export function applyDebugPanelVisibility(
  panel: HTMLElement,
  toggle: HTMLButtonElement,
  hidden: boolean,
): void {
  panel.hidden = hidden;
  toggle.textContent = hidden ? 'debug: show (H)' : 'debug: hide (H)';
  toggle.setAttribute('aria-expanded', String(!hidden));
}

export function loadOverride(character: string): BodyOverride {
  try {
    localStorage.removeItem(LEGACY_GLOBAL_KEY);
    const raw = localStorage.getItem(overrideKey(character));
    return raw ? (JSON.parse(raw) as BodyOverride) : {};
  } catch {
    return {}; // corrupt storage must never brick the lab
  }
}

export function saveOverride(character: string, o: BodyOverride): void {
  try { localStorage.setItem(overrideKey(character), JSON.stringify(o)); } catch { /* quota — ignore */ }
}

export function clearOverride(character: string): void {
  try { localStorage.removeItem(overrideKey(character)); } catch { /* ignore */ }
}

/** Pretty JSON for pasting a tuned override into body.ts. */
export function serializeOverride(o: BodyOverride): string {
  return JSON.stringify(o, null, 2);
}

export interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  get(): number;
  set(v: number): void;
}

/** Builds a labelled range input and appends it to `parent`. */
export function addSlider(parent: HTMLElement, spec: SliderSpec): HTMLInputElement {
  const label = document.createElement('label');
  const text = document.createElement('span');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(spec.get());

  const render = () => { text.textContent = `${spec.label}: ${Number(input.value).toFixed(3)}`; };
  render();
  input.addEventListener('input', () => { spec.set(Number(input.value)); render(); });

  label.append(text, input);
  parent.appendChild(label);
  return input;
}

export function addSection(parent: HTMLElement, title: string): HTMLElement {
  const h = document.createElement('h2');
  h.textContent = title;
  parent.appendChild(h);
  const box = document.createElement('div');
  parent.appendChild(box);
  return box;
}

export function addSelect(
  parent: HTMLElement, label: string, options: string[], initial: string, onChange: (v: string) => void,
): HTMLSelectElement {
  const wrap = document.createElement('label');
  wrap.textContent = label + ' ';
  const sel = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o;
    sel.appendChild(opt);
  }
  sel.value = initial;
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.appendChild(sel);
  parent.appendChild(wrap);
  return sel;
}

export function addButton(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'display:block;width:100%;margin:4px 0;font:11px monospace;';
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

/** Field list used to build the material section — keeps panel and shader in step. */
export const MATERIAL_SLIDERS: { key: keyof FleshMaterial; min: number; max: number }[] = [
  { key: 'specIntensity', min: 0, max: 2 },
  { key: 'specRoughness', min: 0.02, max: 1 },
  { key: 'fresnelBoost', min: 0, max: 2 },
  { key: 'translucency', min: 0, max: 1.5 },
  { key: 'surfaceNoiseAmp', min: 0, max: 0.6 },
  { key: 'silhouetteNoiseAmp', min: 0, max: 0.2 },
  { key: 'wetness', min: 0, max: 2 },
];

/** Face sliders, mirroring MATERIAL_SLIDERS. Ranges are authoring judgement. */
export const FACE_SLIDERS: { key: keyof FaceParams; min: number; max: number }[] = [
  { key: 'headRadius', min: 0.07, max: 0.20 },
  { key: 'headWidth', min: 0.6, max: 1.6 },
  { key: 'headHeight', min: 0.6, max: 2.0 },
  { key: 'headDepth', min: 0.6, max: 1.8 },
  { key: 'jawWidth', min: 0.4, max: 1.3 },
  { key: 'jawHeight', min: 0.4, max: 1.4 },
  { key: 'jawDrop', min: 0, max: 0.16 },
  { key: 'jawJut', min: -0.03, max: 0.06 },
  { key: 'noseLength', min: 0, max: 0.05 },
  { key: 'noseWidth', min: 0.3, max: 1.2 },
  { key: 'noseDrop', min: -0.02, max: 0.06 },
  { key: 'browHeavy', min: 0, max: 0.035 },
  { key: 'browRise', min: 0, max: 0.07 },
  { key: 'headBlend', min: 0, max: 0.02 },
];
