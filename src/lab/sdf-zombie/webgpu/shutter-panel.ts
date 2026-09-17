// src/lab/sdf-zombie/webgpu/shutter-panel.ts
//
// FOCUSED PLAYER/DEV CONTROLS for the selective shutter blur (2026-09-17).
//
// Three controls only, in the order a player thinks about them:
//   • Blood motion blur  — on / off (the exposed shader is on by default)
//   • Exposure (ms)      — longer = longer trails, with the accepted 44.44 ms
//                          default and the stronger presets one click away
//   • Max trail length   — content pixels, the explicit finite streak cap
//
// Algorithm/debug settings (seed scale, depth bias, tap count, the
// goo selection partition) are DELIBERATELY absent: they live on
// __sdfGame.setBloodBlurSeedScale / setBloodBlurDepthBias so they cannot leak
// into ordinary play. The panel reads every applied value BACK from the layer
// so a clamp is never displayed as the value you asked for.

import { createPanelShell } from './panel-chrome';
import {
  SHUTTER_GAME_PRESETS, SHUTTER_GAME_MAX_STREAK_PX, SHUTTER_GAME_MAX_EXPOSURE_SECONDS,
  type ShutterGameLayer,
} from './shutter-game-layer';

export interface ShutterPanelHost {
  readonly enabled: boolean;
  readonly exposureMs: number;
  readonly maxStreakPx: number;
  setEnabled(on: boolean): boolean;
  setExposureMs(ms: number): number;
  setMaxStreakPx(px: number): number;
}

export interface ShutterPanel {
  readonly el: HTMLElement;
  readonly visible: boolean;
  readonly collapsed: boolean;
  setVisible(on: boolean): void;
  setCollapsed(on: boolean): void;
  refresh(): void;
  dispose(): void;
}

function smallButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.setAttribute('style',
    'background:#241d1c; color:#e8ddd8; border:1px solid #3a2f2d; border-radius:3px;'
    + ' padding:2px 6px; cursor:pointer; font:inherit;');
  b.addEventListener('click', onClick);
  return b;
}

export function createShutterPanel(
  host: ShutterPanelHost,
  opts: { right?: number } = {},
): ShutterPanel {
  const shell = createPanelShell('BLOOD MOTION BLUR', { right: opts.right ?? 782 });
  const body = shell.body;

  // ON/OFF
  const onRow = document.createElement('label');
  onRow.setAttribute('style', 'display:flex; align-items:center; gap:6px; margin-bottom:6px; cursor:pointer;');
  const onBox = document.createElement('input');
  onBox.type = 'checkbox';
  onBox.checked = host.enabled;
  const onText = document.createElement('span');
  onText.textContent = 'Blood motion blur';
  onRow.append(onBox, onText);
  body.appendChild(onRow);

  // Exposure presets + slider.
  const presetRow = document.createElement('div');
  presetRow.setAttribute('style', 'display:flex; gap:4px; flex-wrap:wrap; margin-bottom:5px;');
  body.appendChild(presetRow);

  const exposureRow = document.createElement('div');
  exposureRow.setAttribute('style', 'display:flex; align-items:center; gap:6px; margin-bottom:3px;');
  const exposureName = document.createElement('span');
  exposureName.textContent = 'Exposure';
  exposureName.setAttribute('style', 'width:88px; flex:none;');
  exposureName.title = 'Shutter interval in milliseconds. Longer = longer trails.';
  const exposureInput = document.createElement('input');
  exposureInput.type = 'range';
  exposureInput.min = '0';
  exposureInput.max = String(SHUTTER_GAME_MAX_EXPOSURE_SECONDS * 1000);
  exposureInput.step = '0.5';
  exposureInput.setAttribute('style', 'flex:1; min-width:0; accent-color:#c85a4a;');
  const exposureOut = document.createElement('span');
  exposureOut.setAttribute('style', 'width:60px; flex:none; text-align:right; color:#e0917f;');
  exposureRow.append(exposureName, exposureInput, exposureOut);
  body.appendChild(exposureRow);

  // Max trail length.
  const streakRow = document.createElement('div');
  streakRow.setAttribute('style', 'display:flex; align-items:center; gap:6px; margin-bottom:3px;');
  const streakName = document.createElement('span');
  streakName.textContent = 'Max trail';
  streakName.setAttribute('style', 'width:88px; flex:none;');
  streakName.title = 'Streak cap in content pixels. Bounds the drawn sweep and the seed cost.';
  const streakInput = document.createElement('input');
  streakInput.type = 'range';
  streakInput.min = '1';
  streakInput.max = String(SHUTTER_GAME_MAX_STREAK_PX);
  streakInput.step = '1';
  streakInput.setAttribute('style', 'flex:1; min-width:0; accent-color:#c85a4a;');
  const streakOut = document.createElement('span');
  streakOut.setAttribute('style', 'width:60px; flex:none; text-align:right; color:#e0917f;');
  streakRow.append(streakName, streakInput, streakOut);
  body.appendChild(streakRow);

  const note = document.createElement('div');
  note.setAttribute('style', 'color:#6f625e; margin-top:6px; font-size:10px;');
  body.appendChild(note);

  function refresh(): void {
    onBox.checked = host.enabled;
    exposureInput.value = String(host.exposureMs);
    exposureOut.textContent = host.enabled ? `${host.exposureMs.toFixed(2)} ms` : 'off';
    streakInput.value = String(host.maxStreakPx);
    streakOut.textContent = `${host.maxStreakPx} px`;
    // Preset highlight: nearest preset within half a step.
    for (const p of presetBtns) {
      const active = Math.abs(host.exposureMs - p.preset.seconds * 1000) < 0.26;
      p.btn.style.borderColor = active ? '#c85a4a' : '#3a2f2d';
      p.btn.style.color = active ? '#e0917f' : '#e8ddd8';
    }
    note.textContent = host.enabled
      ? 'effective exposure shown; physics is untouched'
      : 'blur off — the fused sharp goo is restored';
  }

  const presetBtns: { preset: (typeof SHUTTER_GAME_PRESETS)[number]; btn: HTMLButtonElement }[] = [];
  for (const preset of SHUTTER_GAME_PRESETS) {
    const btn = smallButton(preset.label.split(' ')[0]!, () => {
      host.setExposureMs(preset.seconds * 1000);
      if (preset.seconds > 0 && !host.enabled) host.setEnabled(true);
      refresh();
    });
    btn.title = preset.label;
    presetRow.appendChild(btn);
    presetBtns.push({ preset, btn });
  }

  onBox.addEventListener('change', () => { host.setEnabled(onBox.checked); refresh(); });
  exposureInput.addEventListener('input', () => {
    host.setExposureMs(parseFloat(exposureInput.value));
    refresh();
  });
  streakInput.addEventListener('input', () => {
    host.setMaxStreakPx(parseFloat(streakInput.value));
    refresh();
  });

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

/** The layer doubles as the panel host — same read-back contract. */
export function shutterPanelHost(layer: ShutterGameLayer): ShutterPanelHost {
  return {
    get enabled() { return layer.enabled; },
    get exposureMs() { return layer.exposureMs; },
    get maxStreakPx() { return layer.maxStreakPx; },
    setEnabled: (on) => layer.setEnabled(on),
    setExposureMs: (ms) => layer.setExposureMs(ms),
    setMaxStreakPx: (px) => layer.setMaxStreakPx(px),
  };
}
