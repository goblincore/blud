// src/lab/sdf-zombie/panel.ts
import type { BodyOverride } from './build-body';
import type { FleshMaterial } from './material';
import type { FaceParams } from './face';

export const STORAGE_KEY = 'blud.sdf-lab.override.v1';

export function loadOverride(): BodyOverride {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BodyOverride) : {};
  } catch {
    return {}; // corrupt storage must never brick the lab
  }
}

export function saveOverride(o: BodyOverride): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(o)); } catch { /* quota — ignore */ }
}

export function clearOverride(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
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
