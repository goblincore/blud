// src/lab/sdf-zombie/webgpu/goo-panel.ts
//
// A live tuning panel for the goo layer on the GAME page.
//
// WHY THIS EXISTS: the lab has had sliders since X1.21, but the game page has
// only ever had console seams — and the goo's look is a five-knob family
// (size, threshold, blur, stretch, absorb) where the interesting settings are
// found by sweeping two at once and watching. Retyping setGooTuning({...})
// after every reload is not sweeping, it is guessing with extra steps, and it
// is how a whole session got spent on values that were never measured.
//
// Deliberately dependency-free and self-contained: it takes a list of knobs
// (label, range, get, set) and knows nothing about goo-layer or game-main.
// That keeps the wiring — which knob maps to which setter — in the caller,
// where it can be read next to everything else the page owns.
//
// The COPY button is the point of the whole thing: it emits the current state
// as the exact console calls that reproduce it, so a look the owner likes
// leaves the browser as something pasteable rather than as a memory.

/** One slider: a labelled range bound to a getter/setter pair. */
export interface GooPanelKnob {
  /** Property name as it appears in the emitted tuning call. */
  key: string;
  /** Which call reproduces it — the two have different shapes. */
  group: 'goo' | 'gout';
  min: number;
  max: number;
  step: number;
  get(): number;
  set(v: number): void;
  /** Optional one-line explanation, shown as a tooltip. */
  hint?: string;
}

export interface GooPanel {
  readonly el: HTMLElement;
  readonly visible: boolean;
  setVisible(on: boolean): void;
  /** Pull every slider back into line with the live values (after a preset). */
  refresh(): void;
  dispose(): void;
}

/** Presets are just named knob->value maps; unknown keys are ignored. */
export interface GooPanelPreset {
  label: string;
  values: Record<string, number>;
}

const PANEL_CSS = `
  position:fixed; top:8px; right:8px; width:250px; z-index:40;
  background:rgba(20,16,15,0.93); color:#e8ddd8; border:1px solid #3a2f2d;
  border-radius:3px; padding:9px 10px 10px;
  font:11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  max-height:calc(100vh - 16px); overflow-y:auto;
`;

export function createGooPanel(
  knobs: GooPanelKnob[],
  opts: { presets?: GooPanelPreset[]; onCopy?: (text: string) => void } = {},
): GooPanel {
  const el = document.createElement('div');
  el.setAttribute('style', PANEL_CSS);
  el.style.display = 'none';

  const title = document.createElement('div');
  title.textContent = 'GOO TUNING';
  title.setAttribute('style',
    'font-size:10px; letter-spacing:.12em; color:#9a8b86; margin-bottom:7px;');
  el.appendChild(title);

  const rows: { knob: GooPanelKnob; input: HTMLInputElement; out: HTMLSpanElement }[] = [];

  for (const knob of knobs) {
    const row = document.createElement('div');
    row.setAttribute('style', 'display:flex; align-items:center; gap:6px; margin-bottom:3px;');
    if (knob.hint) row.title = knob.hint;

    const name = document.createElement('span');
    name.textContent = knob.key;
    name.setAttribute('style', 'width:74px; flex:none;'
      + (knob.group === 'gout' ? ' color:#d8a02f;' : ''));

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(knob.min);
    input.max = String(knob.max);
    input.step = String(knob.step);
    input.value = String(knob.get());
    input.setAttribute('style', 'flex:1; min-width:0; accent-color:#d8402f;');

    const out = document.createElement('span');
    out.textContent = fmt(knob.get());
    out.setAttribute('style', 'width:38px; flex:none; text-align:right; color:#d8402f;');

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      knob.set(v);
      // Read BACK rather than echoing the slider: every setter clamps, and a
      // panel that shows the requested value instead of the applied one is
      // exactly how a clamp hides for three rounds (see setThreshold's note
      // in goo-layer.ts).
      out.textContent = fmt(knob.get());
    });

    row.append(name, input, out);
    el.appendChild(row);
    rows.push({ knob, input, out });
  }

  function refresh(): void {
    for (const r of rows) {
      r.input.value = String(r.knob.get());
      r.out.textContent = fmt(r.knob.get());
    }
  }

  const btnRow = document.createElement('div');
  btnRow.setAttribute('style', 'display:flex; gap:5px; flex-wrap:wrap; margin-top:8px;');

  for (const preset of opts.presets ?? []) {
    btnRow.appendChild(button(preset.label, () => {
      for (const r of rows) {
        const v = preset.values[r.knob.key];
        if (v !== undefined) r.knob.set(v);
      }
      refresh();
    }));
  }

  btnRow.appendChild(button('copy', () => {
    const text = emit(rows.map(r => r.knob));
    void navigator.clipboard?.writeText(text).catch(() => { /* non-secure origin */ });
    // Logged as well as copied: clipboard writes fail silently on a
    // non-secure origin, and losing a tuning pass to that would be galling.
    // eslint-disable-next-line no-console
    console.log(text);
    opts.onCopy?.(text);
  }));

  el.appendChild(btnRow);

  const note = document.createElement('div');
  note.textContent = 'copy → clipboard + console';
  note.setAttribute('style', 'color:#6f625e; margin-top:6px; font-size:10px;');
  el.appendChild(note);

  document.body.appendChild(el);

  let visible = false;
  return {
    el,
    get visible() { return visible; },
    setVisible(on) {
      visible = on;
      el.style.display = on ? 'block' : 'none';
      if (on) refresh();
    },
    refresh,
    dispose() { el.remove(); },
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

/** The current state as the console calls that reproduce it. */
export function emit(knobs: GooPanelKnob[]): string {
  const goo = knobs.filter(k => k.group === 'goo');
  const gout = knobs.filter(k => k.group === 'gout');
  const pair = (k: GooPanelKnob) => `${k.key}: ${round(k.get())}`;
  const lines: string[] = [];
  if (goo.length) {
    lines.push(`__sdfGame.setGooTuning({ ${goo.map(pair).join(', ')} })`);
  }
  if (gout.length) {
    lines.push(`__sdfGame.setGoutTuning('slug', { ${gout.map(pair).join(', ')} })`);
  }
  return lines.join('\n');
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
