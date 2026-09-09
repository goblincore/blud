// src/lab/sdf-zombie/webgpu/vhs-panel.ts
//
// See panel-chrome.ts for the shared shell (title bar, collapse caret, close
// button) the tuning panels sit in.
//
// A live tuning panel for the VHS post pass on the GAME page.
//
// WHY THIS EXISTS: VHS shipped ON at 'soft' (02261ef2) and the club-mutant
// presets are the ends of a very wide space -- 'chaotic' is far too heavy and
// 'soft' is nearly invisible, so the look the owner actually wants is a term
// sweep somewhere between them. post-aa already exposes setVhsTerm, but
// retyping thirteen console calls after every reload is not a sweep.
//
// It worked: VHS_PRESETS.blud -- now the shipped default -- is this panel's
// first output, swept here and pasted out of the COPY button.
//
// NO SECOND KEY TABLE. The rows are derived from VHS_TERM_RANGES, which is
// itself copied from the club-mutant setters, and every emitted call is keyed
// by a `keyof VhsTerms`. That is deliberate: a panel emitting keys the setter
// ignores has shipped twice in this project (setBeam's spelling, and the goo
// panel before it), and both times the tuning looked applied and was not.
// Here the key IS the parameter name, so the drift has nowhere to happen.

import { createPanelShell } from './panel-chrome';
import { VHS_TERM_RANGES } from './post-aa';
import { VHS_PRESETS, type VhsPreset, type VhsTerms } from './post-vhs';

export interface VhsPanelHost {
  /** null = stage off. Returns the resulting preset. */
  setVhs(preset: VhsPreset | null): VhsPreset | null;
  /** Clamped to VHS_TERM_RANGES by post-aa; the panel reads the value back. */
  setVhsTerm(name: keyof VhsTerms, value: number): void;
  readonly vhs: VhsPreset | null;
  readonly vhsTerms: VhsTerms;
}

export interface VhsPanel {
  readonly el: HTMLElement;
  readonly visible: boolean;
  readonly collapsed: boolean;
  setVisible(on: boolean): void;
  setCollapsed(on: boolean): void;
  /** Pull every slider back into line with the live values (after a preset). */
  refresh(): void;
  dispose(): void;
}

/** One-line explanations, shown as row tooltips. Missing keys are fine. */
const HINTS: Partial<Record<keyof VhsTerms, string>> = {
  intensity: 'Wet/dry mix of the whole pass. 0 leaves the chroma-split base only.',
  blurAmount: 'Mix toward the horizontal 1-2-1 blur. Horizontal only, so the interlace comb survives.',
  noiseAmount: 'Per-ROW luma noise (a tape dropout band, not per-pixel grain).',
  gradeAmount: 'Green-lift + desaturate mix. The knob that reads as "tape" more than any other.',
  warpAmount: 'Horizontal wobble amplitude in PIXELS at the pass resolution.',
  warpFrequency: 'Wobble cycles down the frame. High values become a vertical ripple.',
  warpSpeed: 'How fast the wobble scrolls, in cycles/second.',
  chromaAmount: 'R/B split in pixels, gated by motion or a burst. Static frames stay clean.',
  chromaJitter: 'Random per-row wander added to the split.',
  motionThreshold: 'Frame delta needed before the split opens. LOWER = split on more of the frame.',
  chromaBurstChance: 'Per-row odds of a split burst with no motion at all.',
  chromaBurstStrength: 'How hard a burst row splits.',
  chromaBurstRate: 'Burst re-rolls per second. The flicker speed of the glitch.',
};

/** Slider granularity from the range span — no third place to keep in sync. */
function stepFor(span: number): number {
  if (span <= 0.5) return 0.005;
  if (span <= 1) return 0.01;
  if (span <= 5) return 0.05;
  return 0.1;
}

export function createVhsPanel(
  host: VhsPanelHost,
  opts: { right?: number; onCopy?: (text: string) => void } = {},
): VhsPanel {
  const shell = createPanelShell('VHS TUNING', { right: opts.right ?? 524 });
  const body = shell.body;

  const keys = Object.keys(VHS_TERM_RANGES) as (keyof VhsTerms)[];

  // Preset row. 'off' is one of them rather than a separate switch: the stage
  // being off IS the fourth state of the same control, and post-aa preserves
  // the user's smear across it (effectiveSmear), so off/on is a fair A/B.
  const presetRow = document.createElement('div');
  presetRow.setAttribute('style', 'display:flex; gap:5px; flex-wrap:wrap; margin-bottom:8px;');
  const presetBtns: { preset: VhsPreset | null; btn: HTMLButtonElement }[] = [];
  for (const preset of ['blud', 'soft', 'balanced', 'chaotic', null] as (VhsPreset | null)[]) {
    const label = preset ?? 'off';
    const btn = button(label, () => { host.setVhs(preset); refresh(); });
    btn.title = preset === null
      ? 'stage off (terms are kept; a preset re-arms them)'
      : preset === 'blud'
        ? 'the shipped look — owner-tuned in this panel; overwrites every term below'
        : `club-mutant '${preset}' preset — overwrites every term below`;
    presetRow.appendChild(btn);
    presetBtns.push({ preset, btn });
  }
  body.appendChild(presetRow);

  const rows: { key: keyof VhsTerms; input: HTMLInputElement; out: HTMLSpanElement }[] = [];

  for (const key of keys) {
    const [lo, hi] = VHS_TERM_RANGES[key];
    const row = document.createElement('div');
    row.setAttribute('style', 'display:flex; align-items:center; gap:6px; margin-bottom:3px;');
    const hint = HINTS[key];
    if (hint) row.title = hint;

    const name = document.createElement('span');
    name.textContent = key;
    name.setAttribute('style', 'width:88px; flex:none; overflow:hidden; text-overflow:ellipsis;');

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(lo);
    input.max = String(hi);
    input.step = String(stepFor(hi - lo));
    input.value = String(host.vhsTerms[key]);
    input.setAttribute('style', 'flex:1; min-width:0; accent-color:#7f6fd8;');

    const out = document.createElement('span');
    out.textContent = fmt(host.vhsTerms[key]);
    out.setAttribute('style', 'width:38px; flex:none; text-align:right; color:#a99bf0;');

    input.addEventListener('input', () => {
      host.setVhsTerm(key, parseFloat(input.value));
      // Read BACK: setVhsTerm clamps to VHS_TERM_RANGES, and a panel that
      // shows the requested value rather than the applied one is how a clamp
      // hides for three rounds (same reason goo-panel reads back).
      out.textContent = fmt(host.vhsTerms[key]);
    });

    row.append(name, input, out);
    body.appendChild(row);
    rows.push({ key, input, out });
  }

  const btnRow = document.createElement('div');
  btnRow.setAttribute('style', 'display:flex; gap:5px; flex-wrap:wrap; margin-top:8px;');
  btnRow.appendChild(button('copy', () => {
    const text = emitVhs(host.vhs, host.vhsTerms);
    void navigator.clipboard?.writeText(text).catch(() => { /* non-secure origin */ });
    // Logged as well as copied: clipboard writes fail silently on a
    // non-secure origin, and losing a tuning pass to that would be galling.
    // eslint-disable-next-line no-console
    console.log(text);
    opts.onCopy?.(text);
  }));
  body.appendChild(btnRow);

  const note = document.createElement('div');
  note.setAttribute('style', 'color:#6f625e; margin-top:6px; font-size:10px;');
  body.appendChild(note);

  function refresh(): void {
    const terms = host.vhsTerms;
    for (const r of rows) {
      r.input.value = String(terms[r.key]);
      r.out.textContent = fmt(terms[r.key]);
      // While the stage is off the sliders still WRITE (the terms are kept and
      // a preset re-arms them), but nothing on screen moves — so say so rather
      // than let a dead-looking panel read as a broken one.
      r.input.disabled = false;
    }
    for (const p of presetBtns) {
      const active = p.preset === host.vhs;
      p.btn.style.borderColor = active ? '#7f6fd8' : '#3a2f2d';
      p.btn.style.color = active ? '#a99bf0' : '#e8ddd8';
    }
    note.textContent = host.vhs === null
      ? 'stage OFF — sliders stage values only'
      : 'copy → clipboard + console';
  }
  refresh();

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
  return v.toFixed(Math.abs(v) < 1 ? 3 : 2);
}

/**
 * The current state as the console calls that reproduce it.
 *
 * The preset call comes FIRST because setVhs overwrites every term; the
 * per-term lines then re-apply the sweep on top. Terms still equal to the
 * preset's are omitted, so what is pasted back is the DELTA and stays
 * readable. With the stage off there is no preset to seed from, so every term
 * is emitted after setVhs(null).
 */
export function emitVhs(preset: VhsPreset | null, terms: VhsTerms): string {
  const lines = [preset === null ? '__sdfGame.setVhs(null)' : `__sdfGame.setVhs('${preset}')`];
  const base = preset === null ? null : VHS_PRESETS[preset];
  for (const k of Object.keys(terms) as (keyof VhsTerms)[]) {
    if (base && round(base[k]) === round(terms[k])) continue;
    lines.push(`__sdfGame.setVhsTerm('${k}', ${round(terms[k])})`);
  }
  return lines.join('\n');
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
