/** Bounded torso experiment. Shared content is independent of actor lifetime. */
export type V3 = readonly [number, number, number];
export type Severity = 0 | 1 | 2;
type Cutter = Readonly<{ center: V3; radius: number }>;
const centers: readonly V3[] = [Object.freeze([-.018, 0, 0]), Object.freeze([.035, .03, 0])];
export const PRESETS: readonly (readonly Cutter[])[] = Object.freeze(
  [[0, 0], [.075, 0], [.12, .07]].map(radii => Object.freeze(
    radii.map((radius, i) => Object.freeze({ center: centers[i]!, radius })),
  )),
);
export const EXTENT = .22;
export const TRANSITION_MS = 160;
export interface FieldSample { value: number; gradient: V3 }

export function sampleAnalytic(id: Severity, p: V3): FieldSample {
  let best = Infinity;
  let gradient: V3 = [0, 0, 1];
  for (const cutter of PRESETS[id]!) {
    if (id !== 0 && cutter.radius === 0) continue;
    const q = p.map((v, axis) => v - cutter.center[axis]!) as [number, number, number];
    const length = Math.hypot(...q);
    const value = length - cutter.radius;
    if (value < best) {
      best = value;
      gradient = length > 1e-12 ? q.map(v => v / length) as [number, number, number] : [0, 0, 1];
    }
  }
  return { value: best, gradient };
}

export interface PresetLibrary {
  readonly resolution: number;
  readonly pitch: number;
  readonly byteLength: number;
  /** Global bound on the trilinear gradient and its outside-box extension. */
  readonly lipschitz: number;
  /** Analytic-to-interpolated distance error INSIDE the atlas, including f32 rounding.
   * The outside extension is defined separately and does not have this error bound. */
  readonly errorBound: number;
  /** Returns a copy for one device upload; instances never call this. */
  copyAtlas(): Float32Array;
  texel(id: 1 | 2, x: number, y: number, z: number): number;
}

export function createPresetLibrary(resolution = 32): PresetLibrary {
  if (!Number.isInteger(resolution) || resolution < 8 || resolution > 96) throw new Error('resolution must be an integer from 8 to 96');
  const pitch = 2 * EXTENT / (resolution - 1);
  const n = resolution;
  const voxels = n ** 3;
  const atlas = new Float32Array(voxels * 2);
  const index = (id: 1 | 2, x: number, y: number, z: number) => (id - 1) * voxels + (z * n + y) * n + x;
  for (const id of [1, 2] as const) for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    atlas[index(id, x, y, z)] = sampleAnalytic(id, [x * pitch - EXTENT, y * pitch - EXTENT, z * pitch - EXTENT]).value;
  }
  // Each derivative is a convex combination of four parallel edge slopes.
  // The vector of global component maxima bounds every point in every cell.
  const slopes = [0, 0, 0];
  for (const id of [1, 2] as const) for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = atlas[index(id, x, y, z)]!;
    for (let axis = 0; axis < 3; axis++) {
      const q = [x, y, z];
      if (q[axis]! + 1 >= n) continue;
      q[axis] = q[axis]! + 1;
      slopes[axis] = Math.max(slopes[axis]!, Math.abs(atlas[index(id, q[0]!, q[1]!, q[2]!)]! - a) / pitch);
    }
  }
  return Object.freeze({ resolution, pitch, byteLength: atlas.byteLength,
    // Outside, clamped axes lose their derivative and receive components of
    // a unit distance-to-box gradient. Floor each component bound at one.
    lipschitz: Math.hypot(...slopes.map(v => Math.max(1, v))) * (1 + 1e-6),
    errorBound: Math.sqrt(3) * pitch + 1e-7,
    copyAtlas: () => atlas.slice(),
    texel: (id: 1 | 2, x: number, y: number, z: number) => atlas[index(id, x, y, z)]!,
  });
}

export function sampleCached(library: PresetLibrary, id: Severity, p: V3): FieldSample {
  if (id === 0) return sampleAnalytic(0, p);
  const n = library.resolution;
  const clamped = p.map(v => Math.max(-EXTENT, Math.min(EXTENT, v)));
  const f = clamped.map(v => (v + EXTENT) / library.pitch);
  const lo = f.map(v => Math.min(n - 2, Math.floor(v)));
  const t = f.map((v, axis) => v - lo[axis]!);
  let value = 0;
  const gradient: [number, number, number] = [0, 0, 0];
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const bits = [x, y, z];
    const weight = bits.map((bit, axis) => bit ? t[axis]! : 1 - t[axis]!);
    const c = library.texel(id, lo[0]! + x, lo[1]! + y, lo[2]! + z);
    value += c * weight[0]! * weight[1]! * weight[2]!;
    for (let axis = 0; axis < 3; axis++) gradient[axis] = gradient[axis]! + c * (bits[axis] ? 1 : -1) * weight[(axis + 1) % 3]! * weight[(axis + 2) % 3]! / library.pitch;
  }
  const outside = p.map((v, axis) => v - clamped[axis]!);
  const distance = Math.hypot(...outside);
  if (distance > 0) {
    value += distance;
    for (let axis = 0; axis < 3; axis++) if (outside[axis] !== 0) gradient[axis] = outside[axis]! / distance;
  }
  return { value, gradient };
}

export interface RegionState { current: Severity; target: Severity; queued: Severity; startedAt: number }
export function createRegionState(): RegionState { return { current: 0, target: 0, queued: 0, startedAt: 0 }; }
export interface RegionBlend { from: Severity; to: Severity; blend: number }
export function advanceRegion(state: RegionState, timeMs: number): RegionBlend {
  if (!Number.isFinite(timeMs)) throw new Error('time must be finite');
  // At most two transitions can remain because severity is monotonic and capped.
  for (let i = 0; i < 2 && state.current !== state.target && timeMs >= state.startedAt + TRANSITION_MS; i++) {
    state.current = state.target;
    state.startedAt += TRANSITION_MS;
    state.target = state.queued;
  }
  const u = state.current === state.target ? 1 : Math.max(0, Math.min(1, (timeMs - state.startedAt) / TRANSITION_MS));
  return { from: state.current, to: state.target, blend: u * u * (3 - 2 * u) };
}
export function hitRegion(state: RegionState, timeMs: number): void {
  advanceRegion(state, timeMs);
  const next = Math.min(2, state.queued + 1) as Severity;
  state.queued = next;
  if (state.current === state.target && next !== state.current) {
    state.target = next;
    state.startedAt = timeMs;
  }
}
