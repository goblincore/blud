# Neural Upscale P3c — Trained Models In-Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load trained model exports into the game so the owner can judge them in motion:
- a validated JSON parser;
- trained weights through the stage, the layer and the self-check;
- a dev-server model store;
- `?upscale=trained&upscalemodel=<name>`, and an async `setUpscale({ trained })` seam;
- the **U** A/B key with an on-screen label;
- G3 parity tooling against PyTorch's fixtures.

**Architecture:**
- **`upscale-model.ts`** gains `UPSCALE_MODEL_FORMAT`, `serializeUpscaleModel` and `parseUpscaleModelJson`. The parser validates every shape and recomputes `weightHash`.
- **Trained weights through the stage:**
  - `createUpscaleStage(config, texture, flipY, trained?)` and `SdfLayer.setUpscale(config, model?)` accept trained weights.
  - `UpscaleInfo` reports `source`, `run` and `step`.
  - The self-check re-creates stages with the same weights.
- **Model store:** `scripts/lib/upscale-model-store.ts` plus two `GET /__lab/` routes in `vite.config.ts` serve `.upscale-models/<name>/model.json`, dev only.
- **`game-main.ts`:** the boot flag, the A/B state with its label and U key, and the seams.
- **Tooling:**
  - `scripts/upscale-trained-parity.ts` (G3);
  - `scripts/upscale-make-test-model.ts`;
  - `scripts/upscale-trained-smoke.mjs` (GPU).

**Tech Stack:** TypeScript, three r185 WebGPU, vitest, tsx, Node ESM scripts over CDP (`scripts/lib/sdf-closeup-stage.mjs`).

**Read first:** `docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md` §0, §2, §3, §4. Spec: `docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md` §3 and §5.

**Harness:** Tasks 1–5 run anywhere. Task 6 needs Chrome and the GPU, so run it on `pi`.

**Independent of P3a and P3b.** Nothing here reads a capture or needs Python. Task 6 smoke-tests with seeded random weights written as a model file. A real trained export is checked in P3d.

**Verified while writing this plan:**
- The touched vitest suites pass (83 tests), `npx tsc --noEmit` is clean, and `npm run build` succeeds.
- `scripts/upscale-trained-smoke.mjs` passes on a real pre-flight export (s8-rgb, 600 steps):
  - self-check GPU vs CPU max relative rgb is 1.28e-3 in both layouts (gate 2e-3), with 0 coverage and 0 depth mismatches;
  - sp vs dc is 2.4e-4;
  - the A/B key and the missing-model handling both work.
- `upscale-trained-parity.ts` on that export: G3 PASS at 2.4e-7.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/lab/sdf-zombie/webgpu/upscale/upscale-model.ts` (+ new `upscale-model.test.ts`) | 1 | Model JSON format, serialize, validate + parse |
| `src/lab/sdf-zombie/webgpu/upscale/upscale-stage.ts` (+ test) | 2 | Optional trained weights; `source/run/step` in `UpscaleInfo` |
| `src/lab/sdf-zombie/webgpu/sdf-layer.ts` (+ test) | 2 | `setUpscale(config, model?)`; a mismatch keeps the old stage |
| `src/lab/sdf-zombie/webgpu/upscale/upscale-selfcheck.ts` | 2 | Re-create stages with the same weights |
| `scripts/lib/upscale-model-store.ts` (+ test), `vite.config.ts`, `.gitignore` | 3 | Dev model store and its routes |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | 4 | Boot flag, A/B key and label, seams |
| `scripts/lib/upscale-parity-compare.ts` (+ test), `scripts/upscale-trained-parity.ts`, `scripts/upscale-make-test-model.ts` | 5 | G3 parity, test model writer |
| `scripts/upscale-trained-smoke.mjs`, `docs/dev-notes/2026-09-11-neural-upscale/p3c-ingame.md`, `TASKS.md` | 6 | GPU smoke and results |

---

### Task 1: Model JSON

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/upscale/upscale-model.ts`
- Create: `src/lab/sdf-zombie/webgpu/upscale/upscale-model.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lab/sdf-zombie/webgpu/upscale/upscale-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createUpscaleModel, parseUpscaleModelJson, serializeUpscaleModel, UPSCALE_MODEL_FORMAT, type UpscaleModelJson,
} from './upscale-model';

const b64 = (values: number[]) => btoa(String.fromCharCode(...new Uint8Array(new Float32Array(values).buffer)));

function trainedJson(): UpscaleModelJson {
  const m = { ...createUpscaleModel('s16', 'rgbd', 7), source: 'trained' as const, run: 's16-rgbd', step: 500 };
  return JSON.parse(JSON.stringify(serializeUpscaleModel(m, { metrics: { overall: 0.1, face: null } })));
}

describe('upscale model JSON (contracts §2)', () => {
  it('round-trips a model bit-exactly and keeps its hash and provenance', () => {
    const m = { ...createUpscaleModel('s16', 'rgbd', 7), source: 'trained' as const, run: 's16-rgbd', step: 500 };
    const json = trainedJson();
    expect(json.format).toBe(UPSCALE_MODEL_FORMAT);
    expect(json.inScale[4]).toBe(Math.fround(0.1));
    const back = parseUpscaleModelJson(json);
    expect(back.weightHash).toBe(m.weightHash);
    expect(back).toMatchObject({ id: 's16', inputs: 'rgbd', source: 'trained', run: 's16-rgbd', step: 500 });
    back.layers.forEach((l, k) => {
      expect(l.weights).toEqual(m.layers[k]!.weights);
      expect(l.bias).toEqual(m.layers[k]!.bias);
      expect(l.relu).toBe(m.layers[k]!.relu);
    });
    expect(Array.from(back.inScale)).toEqual(Array.from(m.inScale));
  });

  it('matches the cross-language hash vectors (the Python exporter asserts the same)', () => {
    expect(parseUpscaleModelJson(serializeUpscaleModel(createUpscaleModel('zero', 'rgb', 1))).weightHash).toBe('3d86dba5');
    expect(parseUpscaleModelJson(serializeUpscaleModel(createUpscaleModel('zero', 'rgbd', 1))).weightHash).toBe('55870aa7');
  });

  it('serializes seeded weights as random and defaults a missing source to trained', () => {
    const json = serializeUpscaleModel(createUpscaleModel('s8', 'rgb', 2));
    expect(json.source).toBe('random');
    expect(parseUpscaleModelJson(json).source).toBe('random');
    const { source: _drop, ...noSource } = json;
    expect(parseUpscaleModelJson(noSource).source).toBe('trained');
  });

  const cases: Array<[string, (j: UpscaleModelJson) => unknown, RegExp]> = [
    ['not an object', () => null, /not a JSON object/],
    ['format', (j) => ({ ...j, format: 'blud-upscale-model/0' }), /format/],
    ['id', (j) => ({ ...j, id: 's64' }), /unknown id/],
    ['inputs', (j) => ({ ...j, inputs: 'rgba' }), /unknown inputs/],
    ['layer count', (j) => ({ ...j, layers: j.layers.slice(0, 2) }), /needs 3 layers/],
    ['chain shape', (j) => ({ ...j, id: 's8' }), /layer 0 is 5->16, expected 5->8/],
    ['relu flag', (j) => ({ ...j, layers: j.layers.map((l, k) => (k === 2 ? { ...l, relu: true } : l)) }), /relu must be false/],
    ['weights length', (j) => ({ ...j, layers: j.layers.map((l, k) => (k === 0 ? { ...l, weights: b64([1, 2]) } : l)) }), /has 2 weights/],
    ['partial float', (j) => ({ ...j, layers: j.layers.map((l, k) => (k === 0 ? { ...l, bias: 'AAA=' } : l)) }), /not whole float32s/],
    ['non-finite', (j) => ({ ...j, layers: j.layers.map((l, k) => (k === 1 ? { ...l, bias: b64(new Array(16).fill(Number.NaN)) } : l)) }), /non-finite/],
    ['inScale length', (j) => ({ ...j, inScale: [1, 1, 1, 1] }), /inScale must be 5 finite numbers/],
    ['step', (j) => ({ ...j, step: 1.5 }), /step must be an integer/],
    ['hash mismatch', (j) => ({ ...j, weightHash: '00000000' }), /does not match the weights/],
    ['tampered weights', (j) => ({ ...j, inOffset: [0, 0, 0, 0, 0.5] }), /does not match the weights/],
  ];
  it.each(cases)('rejects: %s', (_name, mutate, message) => {
    expect(() => parseUpscaleModelJson(mutate(trainedJson()))).toThrow(message);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/upscale-model.test.ts`
Expected: FAIL. `serializeUpscaleModel` / `parseUpscaleModelJson` are not exported.

- [ ] **Step 3: Provenance fields on `UpscaleModel`**

In `upscale-model.ts`, replace:

```ts
  /** FNV-1a 32 of every weight, bias and normalization value, hex. */
  weightHash: string;
}
```

with:

```ts
  /** FNV-1a 32 of every weight, bias and normalization value, hex. */
  weightHash: string;
  /** 'trained' for a loaded export (parseUpscaleModelJson); absent means seeded random weights. */
  source?: UpscaleModelSource;
  /** Training run and step of a trained export. */
  run?: string;
  step?: number;
}

/** Where a model's weights came from. Random weights are a cost/parity probe, never a look. */
export type UpscaleModelSource = 'random' | 'trained';
```

- [ ] **Step 4: Serialize and parse**

At the end of `upscale-model.ts` (after `parseUpscaleConfig`), replace:

```ts
  return { model, layout, inputs, seed };
}
```

with:

````ts
  return { model, layout, inputs, seed };
}

/**
 * MODEL JSON (docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §2) — what the
 * PyTorch trainer exports and the game loads. Arrays are base64 float32; this code assumes a
 * little-endian host, which every WebGPU browser platform is.
 */
export const UPSCALE_MODEL_FORMAT = 'blud-upscale-model/1';

export interface UpscaleModelLayerJson {
  inC: number;
  outC: number;
  relu: boolean;
  weights: string;
  bias: string;
}

export interface UpscaleModelJson {
  format: typeof UPSCALE_MODEL_FORMAT;
  id: UpscaleModelId;
  inputs: UpscaleInputSet;
  source: UpscaleModelSource;
  run?: string;
  step?: number;
  layers: UpscaleModelLayerJson[];
  inScale: number[];
  inOffset: number[];
  weightHash: string;
  trainedOn?: { dataset: string; manifestHash: string };
  metrics?: Record<string, number | null> | null;
}

function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return btoa(s);
}

function base64ToFloat32(b64: string, what: string): Float32Array {
  let s: string;
  try {
    s = atob(b64);
  } catch {
    throw new Error(`upscale model: ${what} is not base64`);
  }
  if (s.length % 4 !== 0) throw new Error(`upscale model: ${what} has ${s.length} bytes, not whole float32s`);
  const bytes = new Uint8Array(s.length);
  for (let k = 0; k < s.length; k++) bytes[k] = s.charCodeAt(k);
  return new Float32Array(bytes.buffer);
}

export function serializeUpscaleModel(
  model: UpscaleModel,
  extra: Pick<UpscaleModelJson, 'trainedOn' | 'metrics'> = {},
): UpscaleModelJson {
  return {
    format: UPSCALE_MODEL_FORMAT,
    id: model.id,
    inputs: model.inputs,
    source: model.source ?? 'random',
    ...(model.run !== undefined ? { run: model.run } : {}),
    ...(model.step !== undefined ? { step: model.step } : {}),
    layers: model.layers.map((l) => ({
      inC: l.inC, outC: l.outC, relu: l.relu, weights: float32ToBase64(l.weights), bias: float32ToBase64(l.bias),
    })),
    inScale: Array.from(model.inScale),
    inOffset: Array.from(model.inOffset),
    weightHash: hashModel(model),
    ...extra,
  };
}

/**
 * Validates a model JSON and returns the model. Checks the format, id, inputs, the layer chain
 * against INPUT_CHANNELS/HIDDEN_WIDTHS, relu flags, array lengths and finiteness, then recomputes
 * weightHash; any mismatch throws. `source` defaults to 'trained'.
 */
export function parseUpscaleModelJson(json: unknown): UpscaleModel {
  if (typeof json !== 'object' || json === null) throw new Error('upscale model: not a JSON object');
  const j = json as Partial<Record<keyof UpscaleModelJson, unknown>>;
  if (j.format !== UPSCALE_MODEL_FORMAT) {
    throw new Error(`upscale model: format ${String(j.format)}, expected ${UPSCALE_MODEL_FORMAT}`);
  }
  const id = j.id as UpscaleModelId;
  if (!UPSCALE_MODEL_IDS.includes(id)) throw new Error(`upscale model: unknown id ${String(j.id)}`);
  const inputs = j.inputs as UpscaleInputSet;
  if (!UPSCALE_INPUT_SETS.includes(inputs)) throw new Error(`upscale model: unknown inputs ${String(j.inputs)}`);
  const source = (j.source ?? 'trained') as UpscaleModelSource;
  if (source !== 'trained' && source !== 'random') throw new Error(`upscale model: unknown source ${String(j.source)}`);
  if (j.run !== undefined && typeof j.run !== 'string') throw new Error('upscale model: run must be a string');
  if (j.step !== undefined && !Number.isInteger(j.step)) throw new Error('upscale model: step must be an integer');

  const widths = [INPUT_CHANNELS[inputs], ...HIDDEN_WIDTHS[id], LAST_CHANNELS];
  const layerCount = widths.length - 1;
  if (!Array.isArray(j.layers) || j.layers.length !== layerCount) {
    throw new Error(`upscale model: ${id} needs ${layerCount} layers, got ${Array.isArray(j.layers) ? j.layers.length : 'none'}`);
  }
  const layers: ConvLayer[] = j.layers.map((raw: unknown, k: number) => {
    const l = (raw ?? {}) as Partial<UpscaleModelLayerJson>;
    const inC = widths[k]!;
    const outC = widths[k + 1]!;
    if (l.inC !== inC || l.outC !== outC) {
      throw new Error(`upscale model: layer ${k} is ${String(l.inC)}->${String(l.outC)}, expected ${inC}->${outC}`);
    }
    const relu = k < layerCount - 1;
    if (l.relu !== relu) throw new Error(`upscale model: layer ${k} relu must be ${relu}`);
    if (typeof l.weights !== 'string' || typeof l.bias !== 'string') {
      throw new Error(`upscale model: layer ${k} weights and bias must be base64 strings`);
    }
    const weights = base64ToFloat32(l.weights, `layer ${k} weights`);
    const bias = base64ToFloat32(l.bias, `layer ${k} bias`);
    if (weights.length !== outC * inC * 9) {
      throw new Error(`upscale model: layer ${k} has ${weights.length} weights, expected ${outC * inC * 9}`);
    }
    if (bias.length !== outC) throw new Error(`upscale model: layer ${k} has ${bias.length} biases, expected ${outC}`);
    if (!weights.every((v) => Number.isFinite(v)) || !bias.every((v) => Number.isFinite(v))) {
      throw new Error(`upscale model: layer ${k} has non-finite values`);
    }
    return { inC, outC, relu, weights, bias };
  });
  const norm = (v: unknown, name: string): Float32Array => {
    if (!Array.isArray(v) || v.length !== widths[0] || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      throw new Error(`upscale model: ${name} must be ${widths[0]} finite numbers`);
    }
    return Float32Array.from(v as number[]);
  };
  const model: UpscaleModel = {
    id, inputs, seed: 0, layers,
    inScale: norm(j.inScale, 'inScale'),
    inOffset: norm(j.inOffset, 'inOffset'),
    weightHash: '',
    source,
    ...(j.run !== undefined ? { run: j.run as string } : {}),
    ...(j.step !== undefined ? { step: j.step as number } : {}),
  };
  model.weightHash = hashModel(model);
  if (j.weightHash !== model.weightHash) {
    throw new Error(`upscale model: weightHash ${String(j.weightHash)} does not match the weights (${model.weightHash})`);
  }
  return model;
}
````

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/upscale-model.test.ts`
Expected: `17 passed`. The hash vectors `3d86dba5` / `55870aa7` are the same ones the Python exporter asserts (contracts §2).

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/upscale/upscale-model.ts src/lab/sdf-zombie/webgpu/upscale/upscale-model.test.ts
git commit -m "feat(upscale P3c): blud-upscale-model/1 JSON — serialize, validate, recompute weightHash"
```

---

### Task 2: The stage, the layer and the self-check take trained weights

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/upscale/upscale-stage.ts`, `src/lab/sdf-zombie/webgpu/upscale/upscale-stage.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/sdf-layer.ts`, `src/lab/sdf-zombie/webgpu/sdf-layer.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/upscale/upscale-selfcheck.ts`

- [ ] **Step 1: Stage test**

In `upscale-stage.test.ts`, replace `import { createUpscaleStage, upscaleInfoOf } from './upscale-stage';` with:

```ts
import { createUpscaleStage, upscaleInfoOf } from './upscale-stage';
import { createUpscaleModel } from './upscale-model';
```

Then replace the file's last lines:

```ts
    for (const s of spies) expect(s).toHaveBeenCalled();
  });
});
```

with:

```ts
    for (const s of spies) expect(s).toHaveBeenCalled();
  });

  it('uses trained weights when given, reports their provenance, and refuses a mismatched model', () => {
    const trained = { ...createUpscaleModel('s16', 'rgbd', 4), source: 'trained' as const, run: 's16-rgbd', step: 1200 };
    const stage = createUpscaleStage({ model: 's16', layout: 'sp', inputs: 'rgbd', seed: 1 }, new THREE.Texture(), uniform(1), trained);
    expect(stage.model).toBe(trained);
    expect(upscaleInfoOf(stage)).toMatchObject({ source: 'trained', run: 's16-rgbd', step: 1200, weightHash: trained.weightHash });
    stage.dispose();
    const random = createUpscaleStage({ model: 's8', layout: 'sp', inputs: 'rgb', seed: 1 }, new THREE.Texture(), uniform(1));
    expect(upscaleInfoOf(random)).toMatchObject({ source: 'random', run: null, step: null });
    random.dispose();
    expect(upscaleInfoOf(null)).toMatchObject({ source: null, run: null, step: null });
    expect(() => createUpscaleStage({ model: 's16', layout: 'sp', inputs: 'rgb', seed: 1 }, new THREE.Texture(), uniform(1), trained))
      .toThrow(/does not match/);
  });
});
```

- [ ] **Step 2: Layer test**

In `sdf-layer.test.ts`, directly after the line that imports from `'./sdf-layer'` (it starts `import { createSdfLayer, isHoldFrame,`), add:

```ts
import { createUpscaleModel } from './upscale/upscale-model';
```

Then, in the `describe('neural upscale stage in the layer …')` block, replace:

```ts
    layer.setUpscale(null);
    expect(layer.compositeSource).toBe('march');
    layer.dispose();
  });
```

with:

```ts
    layer.setUpscale(null);
    expect(layer.compositeSource).toBe('march');
    layer.dispose();
  });

  it('uses given trained weights; a mismatched model throws and keeps the running stage', () => {
    const { renderer } = fakeRenderer();
    const layer = createSdfLayer(renderer);
    layer.setSize(800, 600);
    layer.setScale(0.5);
    const trained = { ...createUpscaleModel('s8', 'rgb', 9), source: 'trained' as const, run: 's8-rgb', step: 100 };
    const info = layer.setUpscale(cfg, trained);
    const stage = layer.upscaleStage!;
    expect(stage.model).toBe(trained);
    expect(info).toMatchObject({ on: true, source: 'trained', run: 's8-rgb', step: 100, weightHash: trained.weightHash });
    expect(() => layer.setUpscale({ ...cfg, inputs: 'rgbd' }, trained)).toThrow(/does not match/);
    expect(layer.upscaleStage).toBe(stage);
    expect(layer.upscaleInfo.weightHash).toBe(trained.weightHash);
    layer.dispose();
  });
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/upscale-stage.test.ts src/lab/sdf-zombie/webgpu/sdf-layer.test.ts`
Expected: the two new tests FAIL (the 4th argument is ignored, and `source` is undefined).

- [ ] **Step 4: Stage**

In `upscale-stage.ts`, replace:

```ts
  type UpscaleModel, type UpscaleModelId,
} from './upscale-model';
```

with:

```ts
  type UpscaleModel, type UpscaleModelId, type UpscaleModelSource,
} from './upscale-model';
```

Replace:

```ts
  seed: number | null;
  weightHash: string | null;
  passes: string[];
  inSize: { width: number; height: number } | null;
  outSize: { width: number; height: number } | null;
}

export function upscaleInfoOf(stage: UpscaleStage | null): UpscaleInfo {
  if (!stage) {
    return { on: false, model: null, layout: null, inputs: null, seed: null, weightHash: null, passes: [], inSize: null, outSize: null };
  }
  return {
    on: true,
    model: stage.config.model,
    layout: stage.config.layout,
    inputs: stage.config.inputs,
    seed: stage.config.seed,
    weightHash: stage.model.weightHash,
```

with:

```ts
  seed: number | null;
  weightHash: string | null;
  /** 'trained' for loaded weights, 'random' for seeded cost/parity weights. */
  source: UpscaleModelSource | null;
  run: string | null;
  step: number | null;
  passes: string[];
  inSize: { width: number; height: number } | null;
  outSize: { width: number; height: number } | null;
}

export function upscaleInfoOf(stage: UpscaleStage | null): UpscaleInfo {
  if (!stage) {
    return {
      on: false, model: null, layout: null, inputs: null, seed: null, weightHash: null,
      source: null, run: null, step: null, passes: [], inSize: null, outSize: null,
    };
  }
  return {
    on: true,
    model: stage.config.model,
    layout: stage.config.layout,
    inputs: stage.config.inputs,
    seed: stage.config.seed,
    weightHash: stage.model.weightHash,
    source: stage.model.source ?? 'random',
    run: stage.model.run ?? null,
    step: stage.model.step ?? null,
```

Replace:

```ts
 * @param flipY the layer's shared flipY uniform node (sdf-layer.ts `uFlipY`).
 */
export function createUpscaleStage(config: UpscaleConfig, marchTexture: THREE.Texture, flipY: unknown): UpscaleStage {
  const model = createUpscaleModel(config.model, config.inputs, config.seed);
```

with:

```ts
 * @param flipY the layer's shared flipY uniform node (sdf-layer.ts `uFlipY`).
 * @param trained weights from parseUpscaleModelJson; absent = seeded random weights from `config`.
 *   Its id and inputs must match `config`.
 */
export function createUpscaleStage(
  config: UpscaleConfig, marchTexture: THREE.Texture, flipY: unknown, trained?: UpscaleModel,
): UpscaleStage {
  if (trained && (trained.id !== config.model || trained.inputs !== config.inputs)) {
    throw new Error(`upscale: model ${trained.id}/${trained.inputs} does not match config ${config.model}/${config.inputs}`);
  }
  const model = trained ?? createUpscaleModel(config.model, config.inputs, config.seed);
```

- [ ] **Step 5: Layer**

In `sdf-layer.ts`, replace `import type { UpscaleConfig } from './upscale/upscale-model';` with:

```ts
import type { UpscaleConfig, UpscaleModel } from './upscale/upscale-model';
```

In the `SdfLayer` interface, replace:

```ts
   *  the stage's output-resolution flesh. The caller sets the march scale. */
  setUpscale(config: UpscaleConfig | null): UpscaleInfo;
```

with:

```ts
   *  the stage's output-resolution flesh. The caller sets the march scale.
   *  `model` = trained weights (parseUpscaleModelJson), matching config's model and
   *  inputs; absent = seeded random weights. A mismatch throws and keeps the old stage. */
  setUpscale(config: UpscaleConfig | null, model?: UpscaleModel): UpscaleInfo;
```

In the implementation, replace `    setUpscale(config) {` with `    setUpscale(config, model) {`, and replace:

```ts
      upscale?.dispose();
      upscale = createUpscaleStage(config, target.texture, uFlipY);
```

with:

```ts
      // Build first: a model/config mismatch throws here and leaves the old stage intact.
      const next = createUpscaleStage(config, target.texture, uFlipY, model);
      upscale?.dispose();
      upscale = next;
```

- [ ] **Step 6: Self-check keeps the weights**

In `upscale-selfcheck.ts`, replace `  const original = { ...initial.config };` with:

```ts
  const original = { ...initial.config };
  // Re-created stages must keep the SAME weights (a trained model is not reproducible from config).
  const weights = initial.model;
```

Then change all three `setUpscale` calls in `runUpscaleSelfCheck` to pass `weights`:
- `deps.layer.setUpscale(original);` → `deps.layer.setUpscale(original, weights);`
- `deps.layer.setUpscale({ ...original, layout });` → `deps.layer.setUpscale({ ...original, layout }, weights);`
- the last one, after the loop, `deps.layer.setUpscale(original);` → `deps.layer.setUpscale(original, weights);`

Check with `grep -n "setUpscale(" src/lab/sdf-zombie/webgpu/upscale/upscale-selfcheck.ts`: every call ends in `weights)`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/ src/lab/sdf-zombie/webgpu/sdf-layer.test.ts`
Expected: PASS. `upscale-stage.test.ts` has 5 tests; `sdf-layer.test.ts` has 26.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/upscale/upscale-stage.ts src/lab/sdf-zombie/webgpu/upscale/upscale-stage.test.ts src/lab/sdf-zombie/webgpu/sdf-layer.ts src/lab/sdf-zombie/webgpu/sdf-layer.test.ts src/lab/sdf-zombie/webgpu/upscale/upscale-selfcheck.ts
git commit -m "feat(upscale P3c): trained weights through the stage, layer and self-check; provenance in UpscaleInfo"
```

---

### Task 3: Dev model store and routes

**Files:**
- Create: `scripts/lib/upscale-model-store.ts`, `scripts/lib/upscale-model-store.test.ts`
- Modify: `vite.config.ts`, `.gitignore`

- [ ] **Step 1: Write the failing tests**

`scripts/lib/upscale-model-store.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listModels, modelStoreRoot, readModelText } from './upscale-model-store';

describe('upscale model store (contracts §4)', () => {
  const root = mkdtempSync(join(tmpdir(), 'upscale-models-'));
  const put = (name: string, text: string) => {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, 'model.json'), text);
  };
  put('s16-rgbd-best', JSON.stringify({
    id: 's16', inputs: 'rgbd', source: 'trained', run: 's16-rgbd', step: 1200, weightHash: 'a1b2c3d4', metrics: { overall: 0.02 },
  }));
  put('broken', '{nope');
  put('_hidden', '{}');
  mkdirSync(join(root, 'empty'));

  it('lists valid names with summaries, and reports bad JSON', () => {
    const list = listModels(root);
    expect(list.map((m) => m.name)).toEqual(['broken', 's16-rgbd-best']);
    expect(list[0]!.error).toMatch(/bad JSON/);
    expect(list[1]).toEqual({
      name: 's16-rgbd-best', id: 's16', inputs: 'rgbd', source: 'trained', run: 's16-rgbd', step: 1200,
      weightHash: 'a1b2c3d4', overall: 0.02,
    });
    expect(listModels(join(root, 'nope'))).toEqual([]);
  });

  it('reads by name and refuses anything that could leave the store', () => {
    expect(JSON.parse(readModelText(root, 's16-rgbd-best')!).id).toBe('s16');
    for (const bad of ['../s16-rgbd-best', 'a/b', '.hidden', '_hidden', '', 'x'.repeat(65), 'S16']) {
      expect(readModelText(root, bad)).toBeNull();
    }
    expect(readModelText(root, 'missing')).toBeNull();
  });

  it('honours UPSCALE_MODELS_DIR', () => {
    expect(modelStoreRoot('/repo', {})).toBe(join('/repo', '.upscale-models'));
    expect(modelStoreRoot('/repo', { UPSCALE_MODELS_DIR: '/data/models' })).toBe('/data/models');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run scripts/lib/upscale-model-store.test.ts`
Expected: FAIL, because the module does not exist yet.

- [ ] **Step 3: Implement**

`scripts/lib/upscale-model-store.ts`:

```ts
/**
 * DEV-ONLY store of trained neural upscale models, served by the vite dev middleware
 * (docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §4). Never part of a build.
 * Layout: <root>/<name>/model.json, root = $UPSCALE_MODELS_DIR or <repo>/.upscale-models.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** No path separators, no leading dot: a name can never leave the store. */
export const MODEL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface ModelSummary {
  name: string;
  id: string | null;
  inputs: string | null;
  source: string | null;
  run: string | null;
  step: number | null;
  weightHash: string | null;
  /** metrics.overall from the export, when present. */
  overall: number | null;
  error?: string;
}

export function modelStoreRoot(repoRoot: string, env: Record<string, string | undefined> = process.env): string {
  return env.UPSCALE_MODELS_DIR ? resolve(env.UPSCALE_MODELS_DIR) : join(repoRoot, '.upscale-models');
}

/** The raw model.json text, or null for an invalid name or a missing model. */
export function readModelText(root: string, name: string): string | null {
  if (!MODEL_NAME_RE.test(name)) return null;
  const file = join(root, name, 'model.json');
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** Summaries sorted by name. The weights are NOT validated here; the game's parser does that. */
export function listModels(root: string): ModelSummary[] {
  if (!existsSync(root)) return [];
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && MODEL_NAME_RE.test(d.name))
    .map((d) => d.name)
    .sort()
    .flatMap((name): ModelSummary[] => {
      const text = readModelText(root, name);
      if (text === null) return [];
      try {
        const j = JSON.parse(text) as Record<string, unknown>;
        const metrics = (j.metrics ?? {}) as Record<string, unknown>;
        return [{
          name, id: str(j.id), inputs: str(j.inputs), source: str(j.source), run: str(j.run),
          step: num(j.step), weightHash: str(j.weightHash), overall: num(metrics.overall),
        }];
      } catch (e) {
        return [{
          name, id: null, inputs: null, source: null, run: null, step: null, weightHash: null, overall: null,
          error: `bad JSON: ${String(e)}`,
        }];
      }
    });
}
```

- [ ] **Step 4: Routes**

In `vite.config.ts`, replace `import { saveGameplayCapture } from './scripts/lib/game-telemetry-save';` with:

```ts
import { saveGameplayCapture } from './scripts/lib/game-telemetry-save';
import { listModels, modelStoreRoot, readModelText } from './scripts/lib/upscale-model-store';
```

Then replace `        if (!url.pathname.startsWith('/__lab/save-')) return next();` with:

```ts
        // Trained neural upscale models (docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §4).
        if (url.pathname === '/__lab/upscale-models' || url.pathname.startsWith('/__lab/upscale-model/')) {
          if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
          const store = modelStoreRoot(server.config.root);
          res.setHeader('content-type', 'application/json');
          res.setHeader('cache-control', 'no-store');
          if (url.pathname === '/__lab/upscale-models') { res.end(JSON.stringify(listModels(store))); return; }
          const text = readModelText(store, url.pathname.slice('/__lab/upscale-model/'.length));
          if (text === null) { res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: 'no such model' })); return; }
          res.end(text);
          return;
        }
        if (!url.pathname.startsWith('/__lab/save-')) return next();
```

- [ ] **Step 5: Ignore the store**

In `.gitignore`, replace:

```
.superpowers/
.vite/
```

with:

```
.superpowers/
.vite/
# Trained neural upscale models pulled from training runs (dev-only; accepted models get committed elsewhere)
.upscale-models/
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run scripts/lib/upscale-model-store.test.ts` — Expected: `3 passed`.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/upscale-model-store.ts scripts/lib/upscale-model-store.test.ts vite.config.ts .gitignore
git commit -m "feat(upscale P3c): dev model store (.upscale-models) with /__lab/upscale-models routes"
```

---

### Task 4: Game — boot flag, A/B key, label, seams

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

`main()` is `async`, and the upscale boot block runs inside it. The trained path `await`s its fetch there, so the page's seams install only after the model has loaded (or failed to).

- [ ] **Step 1: Imports**

Replace:

```ts
import { parseUpscaleConfig, UPSCALE_SCALE } from './upscale/upscale-model';
import { runUpscaleSelfCheck } from './upscale/upscale-selfcheck';
```

with:

```ts
import {
  parseUpscaleConfig, parseUpscaleModelJson, UPSCALE_SCALE, type UpscaleConfig, type UpscaleModel,
} from './upscale/upscale-model';
import { runUpscaleSelfCheck } from './upscale/upscale-selfcheck';
import type { UpscaleInfo } from './upscale/upscale-stage';
```

If P3a's Task 6 added a `supersample` import between those two lines, keep it; only the `upscale-model` import changes, plus the new `UpscaleInfo` line.

- [ ] **Step 2: Boot block, A/B state and label**

Replace this block (it follows the `?accum` block):

```ts
  // `?upscalelayout=<sp|dc>`, `?upscaleinputs=<rgb|rgbd>`, `?upscaleseed=<int>`.
  // Dev-only; absent = the shipped path. The scale goes through the game's own
  // sdfScale state, exactly like the ?accum block above (b9fad129).
  {
    const upSearch = new URLSearchParams(location.search);
    const upRaw = upSearch.get('upscale');
    if (upRaw !== null && upRaw !== '0') {
      const cfg = parseUpscaleConfig({
        model: upRaw,
        layout: upSearch.get('upscalelayout') ?? undefined,
        inputs: upSearch.get('upscaleinputs') ?? undefined,
        seed: parseIntParam(upSearch.get('upscaleseed'), { min: 0, max: 2 ** 31 - 1 }) ?? undefined,
      });
      sdfScale = UPSCALE_SCALE;
      sdfLayer.setScale(sdfScale);
      deferredApi?.setScale(sdfScale);
      sdfLayer.setUpscale(cfg);
    }
  }
```

with:

```ts
  // `?upscalelayout=<sp|dc>`, `?upscaleinputs=<rgb|rgbd>`, `?upscaleseed=<int>`.
  // `?upscale=trained&upscalemodel=<name>` loads a TRAINED export from the dev model
  // store instead (P3, docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §4);
  // a missing or invalid model leaves the stage off with a console error.
  // Dev-only; absent = the shipped path. The scale goes through the game's own
  // sdfScale state, exactly like the ?accum block above (b9fad129).
  //
  // A/B KEY (P3 spec §5): while an upscale config is active, U cycles
  // native (march 1.0, the field style from before the stage) -> nearest (zero model) -> model.
  // A label bottom-left names the mode. Switching reallocates targets; a hitch is expected.
  const upscaleAb: {
    mode: 'native' | 'nearest' | 'model';
    config: UpscaleConfig | null;
    model: UpscaleModel | null;
    modelName: string | null;
    fieldStyle: typeof sdfLayer.fieldStyle;
  } = { mode: 'model', config: null, model: null, modelName: null, fieldStyle: sdfLayer.fieldStyle };
  let upscaleAbLabel: HTMLDivElement | null = null;
  function updateUpscaleAbLabel() {
    const c = upscaleAb.config;
    if (!c) {
      if (upscaleAbLabel) upscaleAbLabel.hidden = true;
      return;
    }
    if (!upscaleAbLabel) {
      upscaleAbLabel = document.createElement('div');
      upscaleAbLabel.id = 'upscale-ab';
      upscaleAbLabel.setAttribute('style',
        'position:fixed; left:8px; bottom:8px; z-index:40; pointer-events:none;'
        + ' font:12px/1.3 monospace; color:#ffd98a; background:rgba(0,0,0,0.6); padding:3px 6px; border-radius:3px;');
      document.body.appendChild(upscaleAbLabel);
    }
    const m = upscaleAb.model;
    const what = upscaleAb.mode === 'native' ? 'native (march 1.0, no upscale)'
      : upscaleAb.mode === 'nearest' ? 'nearest 2x (zero model)'
      : m ? `model ${upscaleAb.modelName ?? m.id} (${m.id} ${m.inputs}${m.step !== undefined ? `, step ${m.step}` : ''})`
      : `random ${c.model} ${c.inputs} (untrained weights)`;
    upscaleAbLabel.textContent = `upscale [U]: ${what} · ${c.layout}`;
    upscaleAbLabel.hidden = false;
  }
  /** `booted` = false during main()'s boot, which sets the scale the way the ?accum block does. */
  function applyUpscaleAbMode(mode: 'native' | 'nearest' | 'model', booted = true): UpscaleInfo {
    const c = upscaleAb.config;
    if (!c) throw new Error('upscale A/B: no upscale config is active');
    const scaleTo = (v: number) => {
      if (booted) { applySdfScale(v); return; }
      sdfScale = v;
      sdfLayer.setScale(sdfScale);
      deferredApi?.setScale(sdfScale);
    };
    let info: UpscaleInfo;
    if (mode === 'native') {
      info = sdfLayer.setUpscale(null);
      scaleTo(1);
      sdfLayer.setFieldStyle(upscaleAb.fieldStyle);
    } else {
      scaleTo(UPSCALE_SCALE);
      info = mode === 'nearest'
        ? sdfLayer.setUpscale({ model: 'zero', layout: c.layout, inputs: 'rgb', seed: 1 })
        : sdfLayer.setUpscale(c, upscaleAb.model ?? undefined);
    }
    upscaleAb.mode = mode;
    updateUpscaleAbLabel();
    return info;
  }
  async function enableTrainedUpscale(name: string, layout?: string, booted = true): Promise<UpscaleInfo> {
    const r = await fetch(`/__lab/upscale-model/${encodeURIComponent(name)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`upscale model ${name}: HTTP ${r.status} (expected .upscale-models/${name}/model.json)`);
    const model = parseUpscaleModelJson(await r.json());
    const config = parseUpscaleConfig({ model: model.id, inputs: model.inputs, layout, seed: 1 });
    upscaleAb.config = config;
    upscaleAb.model = model;
    upscaleAb.modelName = name;
    return applyUpscaleAbMode('model', booted);
  }
  {
    const upSearch = new URLSearchParams(location.search);
    const upRaw = upSearch.get('upscale');
    if (upRaw === 'trained') {
      const name = upSearch.get('upscalemodel');
      if (!name) {
        console.error('[upscale] ?upscale=trained needs &upscalemodel=<name> — the stage stays off');
      } else {
        try {
          await enableTrainedUpscale(name, upSearch.get('upscalelayout') ?? undefined, false);
        } catch (err) {
          console.error(`[upscale] trained model ${name} not loaded — the stage stays off: ${String(err)}`);
        }
      }
    } else if (upRaw !== null && upRaw !== '0') {
      const cfg = parseUpscaleConfig({
        model: upRaw,
        layout: upSearch.get('upscalelayout') ?? undefined,
        inputs: upSearch.get('upscaleinputs') ?? undefined,
        seed: parseIntParam(upSearch.get('upscaleseed'), { min: 0, max: 2 ** 31 - 1 }) ?? undefined,
      });
      sdfScale = UPSCALE_SCALE;
      sdfLayer.setScale(sdfScale);
      deferredApi?.setScale(sdfScale);
      sdfLayer.setUpscale(cfg);
      upscaleAb.config = cfg;
      updateUpscaleAbLabel();
    }
  }
```

- [ ] **Step 3: The U key**

In the main `window.addEventListener('keydown', …)` handler, replace:

```ts
    if (e.code === 'KeyE') { slugMode = !slugMode; updateHud(); }
```

with:

```ts
    if (e.code === 'KeyE') { slugMode = !slugMode; updateHud(); }
    // Neural upscale A/B (dev-only, P3): native -> nearest -> model while an upscale config is active.
    if (e.code === 'KeyU' && !e.repeat && upscaleAb.config) {
      applyUpscaleAbMode(upscaleAb.mode === 'native' ? 'nearest' : upscaleAb.mode === 'nearest' ? 'model' : 'native');
    }
```

Check first that nothing else binds `KeyU`: `grep -n "'KeyU'" src/lab/sdf-zombie/webgpu/game-main.ts` should show only your new line.

- [ ] **Step 4: Seams**

In the `__sdfGame` seams, replace:

```ts
     *  leaves the scale alone — callers restore it. Random weights: cost/parity only. */
    setUpscale: (raw: { model: string; layout?: string; inputs?: string; seed?: number } | null) => {
      if (raw === null) return sdfLayer.setUpscale(null);
      const cfg = parseUpscaleConfig(raw);
      applySdfScale(UPSCALE_SCALE);
      return sdfLayer.setUpscale(cfg);
    },
```

with:

```ts
     *  leaves the scale alone — callers restore it. `{ model }` = random weights (cost/parity
     *  only) and returns the info. `{ trained: '<name>' }` loads a trained export from the dev
     *  model store and returns a PROMISE of the info (P3); it rejects if the model is missing or invalid. */
    setUpscale: (
      raw: { model?: string; layout?: string; inputs?: string; seed?: number; trained?: string } | null,
    ): UpscaleInfo | Promise<UpscaleInfo> => {
      if (raw === null) {
        upscaleAb.config = null;
        upscaleAb.model = null;
        upscaleAb.modelName = null;
        updateUpscaleAbLabel();
        return sdfLayer.setUpscale(null);
      }
      if (raw.trained !== undefined) return enableTrainedUpscale(raw.trained, raw.layout);
      const cfg = parseUpscaleConfig(raw);
      applySdfScale(UPSCALE_SCALE);
      const info = sdfLayer.setUpscale(cfg);
      upscaleAb.config = cfg;
      upscaleAb.model = null;
      upscaleAb.modelName = null;
      upscaleAb.mode = 'model';
      updateUpscaleAbLabel();
      return info;
    },
    /** P3: the trained models in the dev store (GET /__lab/upscale-models). */
    upscaleModels: async () => {
      const r = await fetch('/__lab/upscale-models', { cache: 'no-store' });
      if (!r.ok) throw new Error(`upscaleModels: HTTP ${r.status}`);
      return r.json();
    },
    /** P3 A/B state: the mode U last selected, and the loaded model's store name. */
    upscaleAb: () => ({ active: upscaleAb.config !== null, mode: upscaleAb.mode, model: upscaleAb.modelName }),
```

The non-trained forms still return synchronously, so existing scripts that call `__sdfGame.setUpscale(...)` inside a synchronous IIFE keep working.

- [ ] **Step 5: Typecheck and tests**

Run: `npx tsc --noEmit` — Expected: no errors.
Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/ src/lab/sdf-zombie/webgpu/sdf-layer.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "feat(upscale P3c): ?upscale=trained, async setUpscale({ trained }), U key A/B with label"
```

---

### Task 5: G3 parity tooling and a test model writer

**Files:**
- Create: `scripts/lib/upscale-parity-compare.ts`, `scripts/lib/upscale-parity-compare.test.ts`
- Create: `scripts/upscale-trained-parity.ts`, `scripts/upscale-make-test-model.ts`

- [ ] **Step 1: Write the failing tests**

`scripts/lib/upscale-parity-compare.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { FloatImage } from '../../src/lab/sdf-zombie/webgpu/upscale/upscale-reference';
import { compareReconstruction } from './upscale-parity-compare';

const img = (values: number[][]): FloatImage => ({ w: values.length, h: 1, c: 4, data: Float32Array.from(values.flat()) });

describe('G3 parity comparison', () => {
  const theirs = img([[1, 2, 3, 0.5], [0, 0, 0, 1], [10, 0, 0, 0.25]]);
  const margins = Float32Array.from([0.5, -0.5, 0.5]);

  it('passes identical reconstructions', () => {
    expect(compareReconstruction(img([[1, 2, 3, 0.5], [0, 0, 0, 1], [10, 0, 0, 0.25]]), theirs, margins))
      .toEqual({ pixels: 3, covered: 2, maxRelRgb: 0, depthMismatch: 0, coverageMismatch: 0, coverageMismatchFar: 0, pass: true });
  });

  it('measures colour relative to max(1, |theirs|)', () => {
    const r = compareReconstruction(img([[1, 2, 3, 0.5], [0, 0, 0, 1], [10.002, 0, 0, 0.25]]), theirs, margins);
    expect(r.maxRelRgb).toBeCloseTo(2e-4, 6);
    expect(r.pass).toBe(false);
  });

  it('requires exact depth', () => {
    const r = compareReconstruction(img([[1, 2, 3, 0.5000001], [0, 0, 0, 1], [10, 0, 0, 0.25]]), theirs, margins);
    expect(r.depthMismatch).toBe(1);
    expect(r.pass).toBe(false);
  });

  it('tolerates coverage flips only inside the band', () => {
    const flipped = img([[1, 2, 3, 0.5], [5, 5, 5, 0.3], [10, 0, 0, 0.25]]);
    expect(compareReconstruction(flipped, theirs, Float32Array.from([0.5, 5e-4, 0.5])).pass).toBe(true);
    const far = compareReconstruction(flipped, theirs, Float32Array.from([0.5, -0.2, 0.5]));
    expect(far).toMatchObject({ coverageMismatch: 1, coverageMismatchFar: 1, pass: false });
  });

  it('refuses mismatched sizes', () => {
    expect(() => compareReconstruction(img([[0, 0, 0, 1]]), theirs, margins)).toThrow(/vs/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run scripts/lib/upscale-parity-compare.test.ts` — Expected: FAIL (the module does not exist).

- [ ] **Step 3: Implement the comparison**

`scripts/lib/upscale-parity-compare.ts`:

```ts
/**
 * G3 parity (spec docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md §3): the
 * TypeScript twin's reconstruction against PyTorch's, both float32 RGBA with clip depth in alpha.
 */
import type { FloatImage } from '../../src/lab/sdf-zombie/webgpu/upscale/upscale-reference';

/** Colour: max |ours - theirs| / max(1, |theirs|). */
export const G3_RGB_TOL = 1e-4;
/** Coverage must agree wherever the decision is at least this far from its threshold. */
export const G3_COVERAGE_BAND = 1e-3;

export interface ParityResult {
  pixels: number;
  covered: number;
  maxRelRgb: number;
  depthMismatch: number;
  coverageMismatch: number;
  coverageMismatchFar: number;
  pass: boolean;
}

/** `margin` is ours: ownHit + coverage residual - 0.5 per output pixel (upscaleReference marginOut). */
export function compareReconstruction(ours: FloatImage, theirs: FloatImage, margin: Float32Array,
  rgbTol = G3_RGB_TOL, band = G3_COVERAGE_BAND): ParityResult {
  if (ours.w !== theirs.w || ours.h !== theirs.h || ours.c !== 4 || theirs.c !== 4) {
    throw new Error(`compareReconstruction: ${ours.w}x${ours.h}x${ours.c} vs ${theirs.w}x${theirs.h}x${theirs.c}`);
  }
  const pixels = ours.w * ours.h;
  if (margin.length !== pixels) throw new Error(`compareReconstruction: margin has ${margin.length} values for ${pixels} pixels`);
  let covered = 0, maxRelRgb = 0, depthMismatch = 0, coverageMismatch = 0, coverageMismatchFar = 0;
  for (let p = 0; p < pixels; p++) {
    const b = p * 4;
    const oc = ours.data[b + 3]! < 1;
    const tc = theirs.data[b + 3]! < 1;
    if (oc !== tc) {
      coverageMismatch++;
      if (Math.abs(margin[p]!) >= band) coverageMismatchFar++;
      continue;
    }
    if (!oc) continue;
    covered++;
    if (ours.data[b + 3] !== theirs.data[b + 3]) depthMismatch++;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(ours.data[b + c]! - theirs.data[b + c]!) / Math.max(1, Math.abs(theirs.data[b + c]!));
      if (d > maxRelRgb) maxRelRgb = d;
    }
  }
  return {
    pixels, covered, maxRelRgb, depthMismatch, coverageMismatch, coverageMismatchFar,
    pass: maxRelRgb <= rgbTol && depthMismatch === 0 && coverageMismatchFar === 0,
  };
}
```

- [ ] **Step 4: The G3 script**

`scripts/upscale-trained-parity.ts`:

```ts
// scripts/upscale-trained-parity.ts — G3 parity for a trained export: the TypeScript twin (both
// layouts, no float16 emulation) against PyTorch's reconstruction in <export>/parity
// (docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §3).
// Usage: npx tsx scripts/upscale-trained-parity.ts <export dir with model.json and parity/>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeNpy } from './lib/npy.mjs';
import { compareReconstruction } from './lib/upscale-parity-compare';
import { parseUpscaleModelJson } from '../src/lab/sdf-zombie/webgpu/upscale/upscale-model';
import { upscaleReference, type FloatImage } from '../src/lab/sdf-zombie/webgpu/upscale/upscale-reference';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: npx tsx scripts/upscale-trained-parity.ts <export dir>');
  process.exit(2);
}
const model = parseUpscaleModelJson(JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8')));
const meta = JSON.parse(readFileSync(join(dir, 'parity', 'meta.json'), 'utf8')) as {
  near: number; far: number; fixtures: Array<{ pair: string; input: string; output: string }>;
};
const image = (file: string): FloatImage => {
  const { shape, data } = decodeNpy(readFileSync(join(dir, 'parity', file)));
  if (shape.length !== 3 || shape[2] !== 4) throw new Error(`${file}: shape (${shape.join(', ')}), expected (h, w, 4)`);
  return { h: shape[0]!, w: shape[1]!, c: 4, data };
};

console.log(`model ${model.id} ${model.inputs} source ${model.source} run ${model.run ?? '-'} step ${model.step ?? '-'} weightHash ${model.weightHash}`);
let ok = meta.fixtures.length > 0;
for (const f of meta.fixtures) {
  const input = image(f.input);
  const expected = image(f.output);
  if (expected.w !== input.w * 2 || expected.h !== input.h * 2) throw new Error(`${f.pair}: output is not 2x the input`);
  for (const layout of ['sp', 'dc'] as const) {
    const margin = new Float32Array(expected.w * expected.h);
    const ours = upscaleReference(input, model, layout, meta.near, meta.far, expected.w, expected.h, { marginOut: margin });
    const r = compareReconstruction(ours, expected, margin);
    ok = ok && r.pass;
    console.log(`${f.pair} ${layout}: covered ${r.covered}/${r.pixels} maxRelRgb ${r.maxRelRgb.toExponential(2)} `
      + `depthMismatch ${r.depthMismatch} coverageMismatch ${r.coverageMismatch} (outside band ${r.coverageMismatchFar}) ${r.pass ? 'PASS' : 'FAIL'}`);
  }
}
console.log(ok ? 'G3: PASS' : 'G3: FAIL');
process.exit(ok ? 0 : 1);
```

- [ ] **Step 5: The test model writer**

`scripts/upscale-make-test-model.ts`:

```ts
// scripts/upscale-make-test-model.ts — writes SEEDED RANDOM weights in the trained-model JSON format
// into the dev model store, so the in-game loader can be smoke-tested before any real export exists.
// It is labelled source "trained" only so the loader path runs; it is not a trained model.
// Usage: npx tsx scripts/upscale-make-test-model.ts [name=test-s8-rgbd] [id=s8] [inputs=rgbd]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createUpscaleModel, parseUpscaleConfig, serializeUpscaleModel } from '../src/lab/sdf-zombie/webgpu/upscale/upscale-model';
import { MODEL_NAME_RE, modelStoreRoot } from './lib/upscale-model-store';

const [name = 'test-s8-rgbd', id = 's8', inputs = 'rgbd'] = process.argv.slice(2);
if (!MODEL_NAME_RE.test(name)) throw new Error(`bad model name ${name} (expected ${MODEL_NAME_RE})`);
const cfg = parseUpscaleConfig({ model: id, inputs });
// SEED 1, the same seed the G1-parity reference fixtures use: seed 3's worst sp pixel sits just
// outside the 2e-3 self-check gate on Metal (docs/dev-notes/2026-09-11-neural-upscale/p3c-ingame.md).
const model = { ...createUpscaleModel(cfg.model, cfg.inputs, 1), source: 'trained' as const, run: 'test-random-weights', step: 0 };
const dir = join(modelStoreRoot(process.cwd()), name);
mkdirSync(dir, { recursive: true });
const json = serializeUpscaleModel(model, { trainedOn: { dataset: 'none (seeded random weights)', manifestHash: '0000000000000000' } });
writeFileSync(join(dir, 'model.json'), JSON.stringify(json, null, 1));
console.log(`wrote ${join(dir, 'model.json')} (${cfg.model} ${cfg.inputs}, weightHash ${json.weightHash})`);
```

- [ ] **Step 6: Run the tests and the writer**

Run: `npx vitest run scripts/lib/upscale-parity-compare.test.ts` — Expected: `5 passed`.
Run: `UPSCALE_MODELS_DIR=/tmp/p3c-models npx tsx scripts/upscale-make-test-model.ts`
Expected: `wrote /tmp/p3c-models/test-s8-rgbd/model.json (s8 rgbd, weightHash e9f4faf6)`. The weights are seeded, so the hash is fixed.

If `/tmp/blud-upscale-runs/preflight/s8-rgb/exports/s8-rgb-best/model.json` exists (a P3b or P3d pre-flight ran on this machine), also run `npx tsx scripts/upscale-trained-parity.ts /tmp/blud-upscale-runs/preflight/s8-rgb/exports/s8-rgb-best`. Expected: four `PASS` lines and `G3: PASS`.

- [ ] **Step 7: Build once**

Run: `npm run build` — Expected: success.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/upscale-parity-compare.ts scripts/lib/upscale-parity-compare.test.ts scripts/upscale-trained-parity.ts scripts/upscale-make-test-model.ts
git commit -m "feat(upscale P3c): G3 parity against PyTorch fixtures, and a seeded test-model writer"
```

---

### Task 6: GPU smoke — trained loading, self-check, A/B key

**Files:**
- Create: `scripts/upscale-trained-smoke.mjs`, `docs/dev-notes/2026-09-11-neural-upscale/p3c-ingame.md`
- Modify: `TASKS.md`

Harness: `pi` (Chrome + GPU).

- [ ] **Step 1: Write the smoke**

`scripts/upscale-trained-smoke.mjs`:

```js
// scripts/upscale-trained-smoke.mjs — GPU smoke for trained-model loading, G1 parity on trained
// weights, and the in-game A/B key (docs/superpowers/plans/2026-09-11-neural-upscale-p3c-ingame.md).
// Needs a model in the dev store first:
//   npx tsx scripts/upscale-make-test-model.ts          (seeded random weights, for the plumbing)
//   or copy a real export directory to .upscale-models/<name>/
// Usage:
//   UPSCALE_SMOKE_MODEL=test-s8-rgbd LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-trained-smoke.mjs'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyShipDefaults, bootCloseupPage, connectGame, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5323);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9323);
const NAME = process.env.UPSCALE_SMOKE_MODEL ?? 'test-s8-rgbd';
const STORE = process.env.UPSCALE_MODELS_DIR ?? join(process.cwd(), '.upscale-models');
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => fail('watchdog 20 min'), 20 * 60_000).unref();
const expected = JSON.parse(readFileSync(join(STORE, NAME, 'model.json'), 'utf8'));
const problems = [];
const page = (q) => `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&${q}`;

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__upErrs = [];
    const e = console.error, w = console.warn;
    console.error = (...a) => { window.__upErrs.push(a.map(String).join(' ')); e(...a); };
    console.warn = (...a) => { window.__upErrs.push(a.map(String).join(' ')); w(...a); };
  })()`,
});
const label = () => evaluate(`document.getElementById('upscale-ab')?.textContent ?? ''`);
const pressU = async () => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, code: 'KeyU', key: 'u', windowsVirtualKeyCode: 85, nativeVirtualKeyCode: 85 });
  }
  await evaluate('(() => { __sdfGame.step(6); return 1; })()');
  await evaluate('__sdfGame.resolveGpu()');
  return { info: await evaluate('__sdfGame.upscaleInfo()'), ab: await evaluate('__sdfGame.upscaleAb()'), scale: await evaluate('__sdfGame.sdfScale'), text: await label() };
};

// 1. boot with ?upscale=trained
await bootCloseupPage({ send, evaluate, fail, url: page(`upscale=trained&upscalemodel=${NAME}`) });
let info = await evaluate('__sdfGame.upscaleInfo()');
if (!info.on) fail(`the trained model did not enable at boot: ${JSON.stringify(info)}; console: ${JSON.stringify(await evaluate('window.__upErrs'))}`);
const matches = (i) => i.on && i.source === 'trained' && i.model === expected.id && i.inputs === expected.inputs && i.weightHash === expected.weightHash;
if (!matches(info)) problems.push(`boot info does not match ${NAME}/model.json: ${JSON.stringify(info)}`);
if (!(info.inSize?.width === 400 && info.inSize?.height === 300 && info.outSize?.width === 800 && info.outSize?.height === 600)) {
  problems.push(`sizes: ${JSON.stringify(info)}`);
}
if (!(await label()).includes(NAME)) problems.push(`label does not name the model: "${await label()}"`);
const listed = await evaluate('__sdfGame.upscaleModels()');
if (!listed.some((m) => m.name === NAME && m.weightHash === expected.weightHash)) problems.push(`upscaleModels() does not list ${NAME}`);

// 2. G1 parity on the trained weights (thresholds and staging from scripts/upscale-parity.mjs)
await applyShipDefaults(evaluate);
await evaluate('(() => { __sdfGame.setOccluder(false); __sdfGame.setHullExitBound(true); __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); return 1; })()');
await evaluate('(() => { performance.now = () => 100000; return 1; })()');
let baked = false;
for (let i = 0; i < 240 && !baked; i++) {
  baked = (await evaluate('(() => __sdfGame.roomProbesReady())()')) === true;
  if (!baked) await sleep(500);
}
if (!baked) fail('roomProbesReady never landed');
info = await evaluate(`__sdfGame.setUpscale({ trained: ${JSON.stringify(NAME)} })`);
if (!matches(info)) problems.push(`async setUpscale({ trained }) info: ${JSON.stringify(info)}`);
const staged = await evaluate(`(() => {
  __sdfGame.teleport(1);
  const z = __sdfGame.zombies().find((q) => q.room === 1);
  if (!z) return { error: 'no body in room 1' };
  __sdfGame.freeze(true);
  const ex = z.pos[0], ez = z.pos[2] + 2.5;
  const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
  __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.atan2(1.0 - 1.62, Math.hypot(dx, dz)), 0);
  __sdfGame.step(30);
  __sdfGame.setRenderLock(true);
  return { body: z.id };
})()`);
if (staged?.error) fail(staged.error);
const r = await evaluate('__sdfGame.upscaleSelfCheck({ compareLayouts: true })', 600_000);
if (r.weightHash !== expected.weightHash) problems.push(`self-check ran on ${r.weightHash}, not the trained ${expected.weightHash}`);
if (!r.marchStable) problems.push('march target changed between renders (render lock not holding)');
for (const g of r.gpuVsCpu) {
  if (g.covered < 1000) problems.push(`${g.layout}: only ${g.covered} covered pixels — the body is not in frame`);
  if (g.maxRelRgb > 2e-3) problems.push(`${g.layout}: GPU vs CPU rgb ${g.maxRelRgb.toExponential(2)} > 2e-3`);
  if (g.coverageMismatchFar > 0) problems.push(`${g.layout}: ${g.coverageMismatchFar} coverage mismatches outside the band`);
  if (g.depthMismatch > 0) problems.push(`${g.layout}: ${g.depthMismatch} depth mismatches`);
}
if (r.layouts.maxRelRgb > 2e-3) problems.push(`sp vs dc rgb ${r.layouts.maxRelRgb.toExponential(2)} > 2e-3`);
console.log(`self-check: ${JSON.stringify(r.gpuVsCpu)} sp-vs-dc ${JSON.stringify(r.layouts)}`);

// 3. the A/B key: model -> native -> nearest -> model
const native = await pressU();
if (native.ab.mode !== 'native' || native.info.on || native.scale !== 1 || !native.text.includes('native')) problems.push(`U #1 (native): ${JSON.stringify(native)}`);
const nearest = await pressU();
if (nearest.ab.mode !== 'nearest' || nearest.info.model !== 'zero' || nearest.scale !== 0.5 || !nearest.text.includes('nearest')) problems.push(`U #2 (nearest): ${JSON.stringify(nearest)}`);
const back = await pressU();
if (back.ab.mode !== 'model' || !matches(back.info) || back.scale !== 0.5 || !back.text.includes(NAME)) problems.push(`U #3 (model): ${JSON.stringify(back)}`);

// 4. a missing model: the seam rejects; at boot the stage stays off with a console error
let rejected = false;
try { await evaluate(`__sdfGame.setUpscale({ trained: 'no-such-model' })`); } catch { rejected = true; }
if (!rejected) problems.push('setUpscale({ trained: "no-such-model" }) did not reject');
const shaderErrors = (await evaluate('window.__upErrs')).filter((t) => /TSL|WGSL|Tint|pipeline|not found in Fn/i.test(t));
if (shaderErrors.length) problems.push(`${shaderErrors.length} shader console errors: ${shaderErrors[0].slice(0, 200)}`);
await bootCloseupPage({ send, evaluate, fail, url: page('upscale=trained&upscalemodel=no-such-model') });
const off = await evaluate('__sdfGame.upscaleInfo()');
const errs = await evaluate('window.__upErrs');
if (off.on) problems.push('a missing model at boot left the stage on');
if (!errs.some((t) => t.includes('not loaded'))) problems.push(`a missing model at boot logged no "not loaded" error: ${JSON.stringify(errs.slice(0, 3))}`);

for (const p of problems) console.log(`PROBLEM: ${p}`);
console.log(problems.length ? 'SMOKE: FAIL' : 'SMOKE: PASS');
process.exit(problems.length ? 1 : 0);
```

- [ ] **Step 2: Put the test model in this worktree's store**

Run: `npx tsx scripts/upscale-make-test-model.ts`
Expected: it writes `.upscale-models/test-s8-rgbd/model.json`. `git status` must not list it, because `.upscale-models/` is ignored.

- [ ] **Step 3: Run the smoke**

```bash
UPSCALE_SMOKE_MODEL=test-s8-rgbd LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-trained-smoke.mjs' 2>&1 | tee /tmp/p3c-task6.log | tail -30
```

Expected: `SMOKE: PASS`. Debugging facts:
- **"did not enable at boot" with a 404 in the console:** vite did not load the new routes. Kill and restart the servers; a reused vite has the old config.
- **"did not enable at boot" with `parseUpscaleModelJson` in the console:** the file doesn't validate. Regenerate it with Step 2.
- **U presses change nothing:** CDP key events reach the page only while it has focus. `connectGame` calls `Page.bringToFront`. Check that `window.addEventListener('keydown', …)` still has no early return before the new `KeyU` line.
- **Self-check rgb above 2e-3:** a trained model's weights are not the random ones `upscale-parity.mjs` used. Report the numbers; never raise the threshold. The reference run recorded 1.28e-3 on a real export.

- [ ] **Step 4: Notes and TASKS**

Create `docs/dev-notes/2026-09-11-neural-upscale/p3c-ingame.md` with:
- date, checkout SHA and the smoke command;
- the `self-check:` line;
- the three A/B results (mode, `info.on`/model, scale, label);
- the missing-model behaviour;
- anything surprising.

In `TASKS.md`, in the `## Neural upscale (ESPCN family)` section, add this line after the P3 spec line:

```
- [x] P3c in-game loader: `?upscale=trained&upscalemodel=<name>`, U key A/B, G3 parity script — smoke PASS (`p3c-ingame.md`).
```

- [ ] **Step 5: Commit**

```bash
git add scripts/upscale-trained-smoke.mjs docs/dev-notes/2026-09-11-neural-upscale/p3c-ingame.md TASKS.md
git commit -m "test(upscale P3c): GPU smoke for trained loading, self-check on trained weights, and the A/B key"
```
