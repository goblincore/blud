// src/lab/sdf-zombie/webgpu/wound-panel.ts
//
// ONE key table drives the sliders, the setter and the COPY text. That is not
// tidiness: a panel emitting keys the setter ignores has shipped twice in this
// project (the beam panel's setBeam keys, and the goo panel before it), and
// both times the symptom was a tuning that looked applied and was not. Deriving
// all three from this array makes the drift impossible rather than unlikely.

export interface WoundKey<K extends string = string> {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /**
   * Which DOM event applies the value. 'input' (default) applies on every
   * drag tick — right for the four ramp knobs, which write a uniform.
   * 'change' applies on release: boneRatio REBUILDS the whole cast (bones
   * are derived at build time and packed into the prim texture), and doing
   * that per tick would churn a dozen body builds per drag.
   */
  commit?: 'input' | 'change';
}

/** The key union, then the table checked against it BOTH ways:
 *  `satisfies` makes a row key outside the union a compile error (the
 *  setBeam bug's shape — a key the setter never heard of), and the
 *  _TABLE_COMPLETE assert makes a union key with no row a compile error
 *  (a COPY that silently omits a knob). The exported WOUND_KEYS is the
 *  widened `WoundKey[]` view — plain `key: string` — which is what keeps
 *  this module's consumers (and the test) simple. */
export type WoundTuningKey = 'woundDepthAmp' | 'fatDepth' | 'muscleDepth' | 'boneRatio';
export type WoundTuningValues = Record<WoundTuningKey, number>;

const _WOUND_KEYS = [
  { key: 'woundDepthAmp', label: 'depth ramp', min: 0, max: 1, step: 0.01, value: 1 },
  { key: 'fatDepth', label: 'fat knee (m)', min: 0, max: 0.03, step: 0.0005, value: 0.004 },
  { key: 'muscleDepth', label: 'muscle knee (m)', min: 0, max: 0.06, step: 0.0005, value: 0.014 },
  { key: 'boneRatio', label: 'bone ratio', min: 0, max: 1, step: 0.01, value: 0.38, commit: 'change' },
] as const satisfies readonly WoundKey<WoundTuningKey>[];

type TableKeys = (typeof _WOUND_KEYS)[number]['key'];
type AssertTableComplete = [WoundTuningKey] extends [TableKeys] ? true : never;
const _TABLE_COMPLETE: AssertTableComplete = true;
void _TABLE_COMPLETE;

/** The consumer view of the table (plain string keys). A fresh copy, so
 *  callers cannot mutate the checked literals. */
export const WOUND_KEYS: WoundKey[] = _WOUND_KEYS.map(k => ({ ...k }));

export function defaultsFrom(keys: readonly WoundKey[]): Record<string, number> {
  return Object.fromEntries(keys.map(k => [k.key, k.value]));
}

/** The exact console call that reproduces the current panel state. */
export function copyText(values: Record<string, number>): string {
  const body = _WOUND_KEYS
    .map(k => `  ${k.key}: ${values[k.key] ?? k.value}`)
    .join(',\n');
  return `__sdfGame.setWoundTuning({\n${body}\n});`;
}

// ---------------------------------------------------------------------------
// The DOM panel. Same structure, styling and button layout as goo-panel.ts —
// the two panels sit side by side on the game page and should read as one
// instrument. Difference of necessity: goo-panel is GENERIC (the caller owns
// the knob list, so wiring lives beside everything else the page owns), while
// THIS panel owns its key table — the table IS the module, and the seam
// consumes it, which is the anti-drift point of the whole file.
// ---------------------------------------------------------------------------

const PANEL_CSS = `
  position:fixed; top:8px; right:266px; width:250px; z-index:40;
  background:rgba(20,16,15,0.93); color:#e8ddd8; border:1px solid #3a2f2d;
  border-radius:3px; padding:9px 10px 10px;
  font:11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  max-height:calc(100vh - 16px); overflow-y:auto;
`;

export interface WoundPanel {
  readonly el: HTMLElement;
  readonly visible: boolean;
  setVisible(on: boolean): void;
  /** Pull every slider back into line with the live values (after a preset). */
  refresh(): void;
  dispose(): void;
}

export function createWoundPanel(opts: {
  /** Live values — the read-back source, so what the row shows is what the
   *  setter APPLIED, not what the slider requested (clamps hide otherwise;
   *  see goo-panel's note — that exact bug hid for three rounds). */
  get(): WoundTuningValues;
  /** Apply one key. Same key names as the table, verified by the test. */
  set(key: keyof WoundTuningValues, v: number): void;
  presets?: { label: string; values: Partial<WoundTuningValues> }[];
  onCopy?: (text: string) => void;
}): WoundPanel {
  const el = document.createElement('div');
  el.setAttribute('style', PANEL_CSS);
  el.style.display = 'none';

  const title = document.createElement('div');
  title.textContent = 'WOUND TUNING';
  title.setAttribute('style',
    'font-size:10px; letter-spacing:.12em; color:#9a8b86; margin-bottom:7px;');
  el.appendChild(title);

  const rows: { k: WoundKey; input: HTMLInputElement; out: HTMLSpanElement }[] = [];

  for (const k of _WOUND_KEYS) {
    const row = document.createElement('div');
    row.setAttribute('style', 'display:flex; align-items:center; gap:6px; margin-bottom:3px;');
    if (k.key === 'boneRatio') {
      row.title = 'Derived-bone radius as a fraction of its flesh prim. '
        + 'Rebuilds the cast on release — wounds on screen are lost.';
    }

    const name = document.createElement('span');
    name.textContent = k.label;
    name.setAttribute('style', 'width:80px; flex:none;');

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(k.min);
    input.max = String(k.max);
    input.step = String(k.step);
    input.value = String(opts.get()[k.key] ?? k.value);
    input.setAttribute('style', 'flex:1; min-width:0; accent-color:#d8402f;');

    const out = document.createElement('span');
    out.textContent = fmt(opts.get()[k.key] ?? k.value);
    out.setAttribute('style', 'width:42px; flex:none; text-align:right; color:#d8402f;');

    const apply = () => {
      const v = parseFloat(input.value);
      opts.set(k.key, v);
      // Read BACK rather than echoing the slider — see the get() note above.
      out.textContent = fmt(opts.get()[k.key] ?? v);
    };
    // The literal table only carries `commit` on the rows that set it, so
    // probe with `in` rather than a cast.
    input.addEventListener('commit' in k ? k.commit : 'input', apply);

    row.append(name, input, out);
    el.appendChild(row);
    rows.push({ k, input, out });
  }

  function refresh(): void {
    const live = opts.get();
    for (const r of rows) {
      r.input.value = String(live[r.k.key as keyof WoundTuningValues] ?? r.k.value);
      r.out.textContent = fmt(live[r.k.key as keyof WoundTuningValues] ?? r.k.value);
    }
  }

  const btnRow = document.createElement('div');
  btnRow.setAttribute('style', 'display:flex; gap:5px; flex-wrap:wrap; margin-top:8px;');

  for (const preset of opts.presets ?? []) {
    btnRow.appendChild(button(preset.label, () => {
      for (const [key, v] of Object.entries(preset.values)) opts.set(key as WoundTuningKey, v!);
      refresh();
    }));
  }

  btnRow.appendChild(button('copy', () => {
    const text = copyText({ ...opts.get() });
    void navigator.clipboard?.writeText(text).catch(() => { /* non-secure origin */ });
    // Logged as well as copied: clipboard writes fail silently on a
    // non-secure origin, and losing a tuning pass to that would be galling.
    // eslint-disable-next-line no-console
    console.log(text);
    opts.onCopy?.(text);
  }));

  el.appendChild(btnRow);

  const note = document.createElement('div');
  note.textContent = 'copy → clipboard + console · bone ratio rebuilds the cast';
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
