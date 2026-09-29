// src/lab/sdf-zombie/webgpu/light-layers-panel.ts
//
// The LIGHT LAYERS panel (owner 2026-09-28): one checkbox per body-lighting layer added since the
// melee branch (light-layers.ts), all off by default, toggled live. "all off" is the melee branch's
// body lighting; "all on" is the look shipped before the switches. The URL line reproduces the
// current state in a fresh boot (?layers=...). Ships visible and collapsed, like its siblings,
// top-left under the HUD line.

import { createPanelShell, type PanelShell } from './panel-chrome';
import { DEFAULT_LAYERS, LIGHT_LAYERS, layerState, onLayerChange, setLayer, type LightLayerKey } from './light-layers';

export interface LightLayersPanel {
  readonly shell: PanelShell;
  setVisible(on: boolean): void;
  refresh(): void;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.setAttribute('style',
    'background:#2b2321; color:#e8ddd8; border:1px solid #4a3c39; border-radius:2px;'
    + ' font:inherit; padding:2px 7px; cursor:pointer;');
  b.addEventListener('click', onClick);
  return b;
}

export function createLightLayersPanel(opts: { left?: number; top?: number } = {}): LightLayersPanel {
  // Top-left, under the HUD line: the top-right row is full (GOO, WOUND, VHS, DYNAMITE).
  const shell = createPanelShell('LIGHT LAYERS', { left: opts.left ?? 8, top: opts.top ?? 44 });
  const body = shell.body;

  const note = document.createElement('div');
  note.textContent = 'body lighting added since the melee branch; all off = the melee look';
  note.setAttribute('style', 'color:#9a8b86; margin-bottom:7px;');
  body.appendChild(note);

  const presets = document.createElement('div');
  presets.setAttribute('style', 'display:flex; gap:5px; margin-bottom:8px;');
  const setAll = (v: boolean) => { for (const l of LIGHT_LAYERS) setLayer(l.key, v); };
  const setDefault = () => { for (const l of LIGHT_LAYERS) setLayer(l.key, DEFAULT_LAYERS.includes(l.key)); };
  presets.append(button('all off (melee)', () => setAll(false)), button('default', setDefault), button('all on', () => setAll(true)));
  body.appendChild(presets);

  const rows: { key: LightLayerKey; box: HTMLInputElement; flag: HTMLSpanElement }[] = [];
  const bootState = layerState();
  for (const l of LIGHT_LAYERS) {
    const row = document.createElement('label');
    row.setAttribute('style', 'display:flex; align-items:flex-start; gap:6px; margin-bottom:4px; cursor:pointer;');
    row.title = `${l.help}\nsince ${l.since}${l.reload ? '\n(applies on reload)' : ''}`;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.setAttribute('style', 'margin:1px 0 0; accent-color:#7f6fd8; flex:none;');
    box.addEventListener('change', () => setLayer(l.key, box.checked));
    const text = document.createElement('span');
    text.textContent = l.label;
    const flag = document.createElement('span');
    flag.setAttribute('style', 'color:#d8a86f; margin-left:auto; flex:none;');
    row.append(box, text, flag);
    body.appendChild(row);
    rows.push({ key: l.key, box, flag });
  }

  const url = document.createElement('div');
  url.setAttribute('style', 'margin-top:7px; color:#9a8b86; word-break:break-all; user-select:all;');
  body.appendChild(url);

  function refresh(): void {
    const s = layerState();
    for (const r of rows) {
      r.box.checked = s[r.key];
      const l = LIGHT_LAYERS.find(x => x.key === r.key)!;
      r.flag.textContent = l.reload && s[r.key] !== bootState[r.key] ? 'reload' : '';
    }
    const on = LIGHT_LAYERS.filter(l => s[l.key]).map(l => l.key);
    const isDefault = on.length === DEFAULT_LAYERS.length && DEFAULT_LAYERS.every(k => s[k]);
    url.textContent = isDefault ? '(default: no ?layers= param)' : `?layers=${on.length === 0 ? 'none' : on.length === LIGHT_LAYERS.length ? 'all' : on.join(',')}`;
  }
  onLayerChange(() => refresh());
  shell.onReveal(refresh);
  refresh();

  return { shell, setVisible: (v) => shell.setVisible(v), refresh };
}
