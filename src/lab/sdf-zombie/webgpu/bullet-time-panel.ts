// src/lab/sdf-zombie/webgpu/bullet-time-panel.ts
//
// The BULLET TIME tuning panel: one slider per bullet-time.ts knob, live.
// See panel-chrome.ts for the shared shell (title bar, collapse caret, close
// button) the tuning panels sit in.
//
// Owner ask (2026-10-27: "maybe add some slider or console config for
// bullet time"): one slider per knob of bullet-time.ts's live tuning. NO SECOND
// KEY TABLE, as vhs-panel.ts: the rows are BULLET_TIME_RANGES, every write goes
// through applyBulletTimeTuning (the same validation as the console seam and
// the ?bt_* params), and the value shown is read BACK from BULLET_TIME. COPY
// emits the __sdfGame.bulletTime({...}) call that reproduces the state.
//
// Ships visible and collapsed beside LIGHT LAYERS (top-left; the top-right row
// is full).

import { createPanelShell } from './panel-chrome';
import {
  BULLET_TIME, BULLET_TIME_KNOBS, BULLET_TIME_RANGES, applyBulletTimeTuning, bulletTimeKnobs, type BulletTimeKnob,
} from '../bullet-time';

export interface BulletTimePanel {
  readonly el: HTMLElement;
  readonly visible: boolean;
  readonly collapsed: boolean;
  setVisible(on: boolean): void;
  setCollapsed(on: boolean): void;
  /** Pull every slider back into line with the live values (after a seam call). */
  refresh(): void;
  dispose(): void;
}

const HINTS: Record<BulletTimeKnob, string> = {
  worldScale: 'Everything that is not the player: actors, enemy shots, gibs, blood, the sim clock.',
  moveScale: 'The player walking, and the jump\'s pace at takeoff/landing.',
  aimScale: 'The gun\'s catch-up to the reticle and the free-aim edge turn. Mouse look is never slowed.',
  fireScale: 'Cooldown, flash, recoil, weapon switch, melee.',
  reloadScale: 'The shotgun reload and the launcher cycle.',
  shotScale: 'The player\'s own pellets in flight.',
  airScale: 'The shootdodge hang at the jump\'s apex (absolute).',
  rampSec: 'Real seconds to ease in and out of the mode.',
  wakeStrength: 'Peak distortion of a projectile\'s air wake.',
  ownWakeMul: 'The player\'s own pellets\' wake, as a fraction of wakeStrength.',
};

function stepFor(span: number): number {
  if (span <= 0.25) return 0.001;
  if (span <= 1) return 0.01;
  return 0.05;
}

/** The current tuning as the console call that reproduces it. */
export function emitBulletTime(values: Record<BulletTimeKnob, number> = bulletTimeKnobs()): string {
  const pairs = BULLET_TIME_KNOBS.map(k => `${k}: ${Math.round(values[k] * 1000) / 1000}`);
  return `__sdfGame.bulletTime({ ${pairs.join(', ')} })`;
}

export function createBulletTimePanel(opts: { left?: number; top?: number } = {}): BulletTimePanel {
  const shell = createPanelShell('BULLET TIME', { left: opts.left ?? 286, top: opts.top ?? 44 });
  const body = shell.body;

  const note = document.createElement('div');
  note.textContent = 'fraction of real time, fully in (Q toggles the mode)';
  note.setAttribute('style', 'color:#9a8b86; margin-bottom:7px;');
  body.appendChild(note);

  const rows: { key: BulletTimeKnob; input: HTMLInputElement; out: HTMLSpanElement }[] = [];
  for (const key of BULLET_TIME_KNOBS) {
    const [lo, hi] = BULLET_TIME_RANGES[key];
    const row = document.createElement('div');
    row.setAttribute('style', 'display:flex; align-items:center; gap:6px; margin-bottom:3px;');
    row.title = HINTS[key];
    const name = document.createElement('span');
    name.textContent = key;
    name.setAttribute('style', 'width:88px; flex:none; overflow:hidden; text-overflow:ellipsis;');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(lo);
    input.max = String(hi);
    input.step = String(stepFor(hi - lo));
    input.value = String(BULLET_TIME[key]);
    input.setAttribute('style', 'flex:1; min-width:0; accent-color:#4fae8f;');
    const out = document.createElement('span');
    out.setAttribute('style', 'width:38px; flex:none; text-align:right; color:#7fd8b8;');
    out.textContent = fmt(BULLET_TIME[key]);
    input.addEventListener('input', () => {
      applyBulletTimeTuning({ [key]: parseFloat(input.value) });
      out.textContent = fmt(BULLET_TIME[key]);   // read BACK (a refused value leaves the live one)
    });
    row.append(name, input, out);
    body.appendChild(row);
    rows.push({ key, input, out });
  }

  const btnRow = document.createElement('div');
  btnRow.setAttribute('style', 'display:flex; gap:5px; flex-wrap:wrap; margin-top:8px;');
  btnRow.appendChild(button('defaults', () => { applyBulletTimeTuning({ reset: true }); refresh(); }));
  btnRow.appendChild(button('copy', () => {
    const text = emitBulletTime();
    void navigator.clipboard?.writeText(text).catch(() => { /* non-secure origin */ });
    // eslint-disable-next-line no-console
    console.log(text);
  }));
  body.appendChild(btnRow);

  function refresh(): void {
    for (const r of rows) {
      r.input.value = String(BULLET_TIME[r.key]);
      r.out.textContent = fmt(BULLET_TIME[r.key]);
    }
  }

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

function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(Math.abs(v) < 0.1 ? 3 : 2);
}
