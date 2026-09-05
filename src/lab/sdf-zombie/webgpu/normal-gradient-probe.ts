import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial, WebGPURenderer } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { qFromAxisAngle, qRotate } from '../vec';
import { sdPrimitive, smax, smin } from '../validate';
import {
  capsuleGradient,
  finiteGradient,
  smoothMaxGradient,
  smoothMinGradient,
  type CapsuleInput,
  type Dg,
  type NgReason,
  type V3,
} from './normal-gradient-reference';
import { buildNormalGradientFn, NORMAL_GRADIENT_PROBE } from './normal-gradient.wgsl';

type V4 = [number, number, number, number];

interface ProbeFixture {
  name: string;
  kind: number;
  p: V3;
  a: V3;
  b: V3;
  r: number;
  scale: V3;
  quat: V4;
  dgA: V4;
  dgB: V4;
  kIn: number;
  expected: V4;
  oracle: V4 | null;
  expectedReason: NgReason;
}

interface ProbeResult {
  name: string;
  actual: number[];
  reasonCode: number;
  expected: V4;
  oracle: V4 | null;
  expectedReason: NgReason;
}

const REASON_CODE: Record<NgReason, number> = {
  ok: 0,
  unsupported: 1,
  degenerate: 2,
  'hard-boundary': 3,
  'owner-unstable': 4,
  'wound-pending': 5,
  'sampled-cache': 6,
  inactive: 7,
};

const ZERO3: V3 = [0, 0, 0];
const UNIT_SCALE: V3 = [1, 1, 1];
const IDENTITY_QUAT: V4 = [0, 0, 0, 1];
const ZERO4: V4 = [0, 0, 0, 0];

function asV4(x: Dg): V4 {
  return [x.d, x.g[0], x.g[1], x.g[2]];
}

function capsuleScalar(p: V3, shape: CapsuleInput, orient?: V4): number {
  return sdPrimitive(p, {
    a: shape.a,
    b: shape.b,
    radius: shape.r,
    scale: shape.scale,
    blendK: 0,
    limb: 'torso',
    cluster: 0,
    ...(orient ? { orient } : {}),
  });
}

function capsuleFixture(
  name: string,
  p: V3,
  shape: CapsuleInput,
  quat: V4 = IDENTITY_QUAT,
): ProbeFixture {
  let expected: Dg;
  if (quat === IDENTITY_QUAT) {
    expected = capsuleGradient(p, shape);
  } else {
    const mid: V3 = [
      (shape.a[0] + shape.b[0]) * 0.5,
      (shape.a[1] + shape.b[1]) * 0.5,
      (shape.a[2] + shape.b[2]) * 0.5,
    ];
    const invQuat: V4 = [-quat[0], -quat[1], -quat[2], quat[3]];
    const toLocal = (v: V3): V3 => {
      const d: V3 = [v[0] - mid[0], v[1] - mid[1], v[2] - mid[2]];
      const q = qRotate(invQuat, d);
      return [q[0] + mid[0], q[1] + mid[1], q[2] + mid[2]];
    };
    const local = capsuleGradient(toLocal(p), {
      a: toLocal(shape.a), b: toLocal(shape.b), r: shape.r, scale: shape.scale,
    });
    expected = { d: local.d, g: qRotate(quat, local.g), reason: local.reason };
  }
  const scalar = (q: V3) => capsuleScalar(q, shape, quat === IDENTITY_QUAT ? undefined : quat);
  return {
    name,
    kind: quat === IDENTITY_QUAT ? 0 : 1,
    p, a: shape.a, b: shape.b, r: shape.r, scale: shape.scale, quat,
    dgA: ZERO4, dgB: ZERO4, kIn: 0,
    expected: asV4(expected),
    oracle: [scalar(p), ...finiteGradient(scalar, p, 1e-5)],
    expectedReason: expected.reason,
  };
}

function blendFixture(name: string, kind: 2 | 3, a: Dg, b: Dg, kIn: number): ProbeFixture {
  const expected = kind === 2 ? smoothMinGradient(a, b, kIn) : smoothMaxGradient(a, b, kIn);
  const scalar = ([x, y, z]: V3): number => {
    const da = a.d + a.g[0] * x + a.g[1] * y + a.g[2] * z;
    const db = b.d + b.g[0] * x + b.g[1] * y + b.g[2] * z;
    return kind === 2 ? smin(da, db, kIn) : smax(da, db, kIn);
  };
  return {
    name, kind, p: ZERO3, a: ZERO3, b: ZERO3, r: 0, scale: UNIT_SCALE,
    quat: IDENTITY_QUAT, dgA: asV4(a), dgB: asV4(b), kIn,
    expected: asV4(expected),
    oracle: [scalar(ZERO3), ...finiteGradient(scalar, ZERO3, 1e-5)],
    expectedReason: expected.reason,
  };
}

function fixtures(): ProbeFixture[] {
  const blendA: Dg = { d: -0.04, g: [0.35, -0.8, 0.1], reason: 'ok' };
  const blendB: Dg = { d: 0.02, g: [-0.25, 0.2, 0.6], reason: 'ok' };
  const rot = qFromAxisAngle([0.3, 0.8, -0.2], 0.73) as V4;
  const axisShape = { a: [0, -1, 0], b: [0, 1, 0], r: 0.2, scale: UNIT_SCALE } as const;
  return [
    capsuleFixture('sphere-known', [2, 0, 0], { a: ZERO3, b: ZERO3, r: 1, scale: UNIT_SCALE }),
    capsuleFixture('capsule-interior', [0.3, 0.4, 0.2], {
      a: [0, 0, 0], b: [0, 1, 0], r: 0.2, scale: UNIT_SCALE,
    }),
    capsuleFixture('capsule-endcap', [0.65, 0.86, -0.18], {
      a: [-0.25, -0.1, 0], b: [0.35, 0.65, 0.1], r: 0.14, scale: [1.5, 0.75, 1.2],
    }),
    capsuleFixture('nonuniform-scale', [0.41, 0.32, 0.37], {
      a: [-0.3, -0.1, 0.2], b: [0.5, 0.8, -0.1], r: 0.18, scale: [1.8, 0.65, 1.25],
    }),
    capsuleFixture('rotated-nonuniform', [0.52, 0.43, 0.31], {
      a: [-0.15, 0.2, 0.1], b: [0.45, 0.7, -0.05], r: 0.16, scale: [1.65, 0.7, 1.2],
    }, rot),
    blendFixture('smooth-min', 2, blendA, blendB, 0.03),
    blendFixture('smooth-max', 3, blendA, blendB, 0.03),
    blendFixture(
      'anisotropic-blend', 2,
      capsuleGradient([1, 0.5, 0], { a: ZERO3, b: ZERO3, r: 0.3, scale: [2, 1, 1] }),
      capsuleGradient([1, 0.5, 0], { a: [0.3, 0, 0], b: [0.3, 0, 0], r: 0.3, scale: [1, 2, 1] }),
      0.05,
    ),
    capsuleFixture('degenerate-axis', ZERO3, axisShape),
    {
      ...blendFixture(
        'hard-min-boundary', 2,
        { d: 0, g: [1, 0, 0], reason: 'ok' },
        { d: 0, g: [0, 1, 0], reason: 'ok' },
        0,
      ),
      oracle: null,
    },
    {
      name: 'excluded-invalid-fallback', kind: 4, p: ZERO3, a: ZERO3, b: [0, 1, 0], r: 0.2,
      scale: [1, 0, 1], quat: IDENTITY_QUAT, dgA: ZERO4, dgB: [-10, 0, 1, 0], kIn: 0.1,
      expected: [-10, 0, 1, 0], oracle: null, expectedReason: 'unsupported',
    },
  ];
}

const api = {
  phase: 'booting' as 'booting' | 'ready' | 'failed',
  backend: 'unknown',
  error: null as string | null,
  count: 0,
  async run(_opts: { negateX?: boolean } = {}): Promise<ProbeResult[]> {
    throw new Error('probe is not ready');
  },
  status() {
    return { phase: this.phase, backend: this.backend, error: this.error, count: this.count };
  },
};
(window as unknown as { __zombieNormalGradient: typeof api }).__zombieNormalGradient = api;

function showResults(results: ProbeResult[]): void {
  const host = document.getElementById('results');
  if (!host) return;
  host.replaceChildren();
  for (const x of results) {
    const row = document.createElement('div');
    row.className = `result ${x.reasonCode === REASON_CODE[x.expectedReason] ? 'ok' : 'bad'}`;
    const actual = x.actual.map(v => v.toFixed(6)).join(', ');
    row.textContent = `${x.name}  [${actual}]  reason ${x.reasonCode}`;
    host.appendChild(row);
  }
}

async function main(): Promise<void> {
  const mount = document.getElementById('gpu');
  if (!mount) throw new Error('#gpu not found');

  const renderer = new WebGPURenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(16, 16, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.NoColorSpace;
  mount.appendChild(renderer.domElement);
  await renderer.init();
  api.backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'webgpu' : 'other';
  if (api.backend !== 'webgpu') throw new Error(`WebGPU backend required, got ${api.backend}`);

  const uP = uniform(new THREE.Vector3());
  const uA = uniform(new THREE.Vector3());
  const uB = uniform(new THREE.Vector3());
  const uR = uniform(0);
  const uScale = uniform(new THREE.Vector3(1, 1, 1));
  const uQuat = uniform(new THREE.Vector4(0, 0, 0, 1));
  const uDgA = uniform(new THREE.Vector4());
  const uDgB = uniform(new THREE.Vector4());
  const uK = uniform(0);
  const uKind = uniform(0);
  const uReasonPass = uniform(0);
  const uNegateX = uniform(0);
  const probe = buildNormalGradientFn(NORMAL_GRADIENT_PROBE);
  const output = probe({
    p: uP, a: uA, b: uB, r: uR, scale: uScale, quat: uQuat,
    dgA: uDgA, dgB: uDgB, kIn: uK, kind: uKind,
    reasonPass: uReasonPass, negateX: uNegateX,
  });

  const material = new MeshBasicNodeMaterial();
  material.outputNode = output;
  material.depthTest = false;
  material.depthWrite = false;
  material.blending = THREE.NoBlending;
  material.toneMapped = false;
  const scene = new THREE.Scene();
  scene.fog = null;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const target = new THREE.RenderTarget(1, 1, {
    depthBuffer: false,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  target.texture.colorSpace = THREE.NoColorSpace;

  const setV3 = (dst: { value: THREE.Vector3 }, src: V3) => dst.value.set(src[0], src[1], src[2]);
  const setV4 = (dst: { value: THREE.Vector4 }, src: V4) => dst.value.set(src[0], src[1], src[2], src[3]);
  const readPass = async (): Promise<number[]> => {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const raw = new Float32Array(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1));
    renderer.setRenderTarget(null);
    if (raw.length < 4) throw new Error(`empty RGBA32F readback length ${raw.length}`);
    return [raw[0]!, raw[1]!, raw[2]!, raw[3]!];
  };

  api.run = async ({ negateX = false } = {}): Promise<ProbeResult[]> => {
    const out: ProbeResult[] = [];
    for (const x of fixtures()) {
      setV3(uP as unknown as { value: THREE.Vector3 }, x.p);
      setV3(uA as unknown as { value: THREE.Vector3 }, x.a);
      setV3(uB as unknown as { value: THREE.Vector3 }, x.b);
      setV3(uScale as unknown as { value: THREE.Vector3 }, x.scale);
      setV4(uQuat as unknown as { value: THREE.Vector4 }, x.quat);
      setV4(uDgA as unknown as { value: THREE.Vector4 }, x.dgA);
      setV4(uDgB as unknown as { value: THREE.Vector4 }, x.dgB);
      uR.value = x.r;
      uK.value = x.kIn;
      uKind.value = x.kind;
      uNegateX.value = negateX ? 1 : 0;
      uReasonPass.value = 0;
      const actual = await readPass();
      uReasonPass.value = 1;
      const reason = await readPass();
      out.push({
        name: x.name,
        actual,
        reasonCode: Math.round(reason[0]!),
        expected: x.expected,
        oracle: x.oracle,
        expectedReason: x.expectedReason,
      });
    }
    if (out.length === 0) throw new Error('probe returned no fixtures');
    showResults(out);
    return out;
  };
  api.count = fixtures().length;
  api.phase = 'ready';
  document.body.dataset.ready = 'true';
}

void main().catch(error => {
  api.phase = 'failed';
  api.error = error instanceof Error ? error.stack ?? error.message : String(error);
  const status = document.getElementById('status');
  if (status) status.textContent = api.error;
  console.error(error);
});
