// src/lab/sdf-zombie/webgpu/game-zap-fx.ts
//
// THE ZAP'S OVERLAY (look spike 2026-11-18, docs/dev-notes/2026-11-18-zap-look-spike/NOTES.md). What the look
// variants b and c (zap-look.ts) add ROUND the body, which the march and the bone meshes cannot draw:
//   crawl arcs  jagged arcs over the body and forks leaping off it (zap-arcs.ts paths, drawn through the brain
//               arcs' ribbons, character-effects.ts createBrainArcs); one pool for every zapped body;
//   kit flash   the polygon kit takes the strobe with the flesh (kit-overlay.ts zap): glowing on the positive
//               frame, blacked out on the negative;
//   halo        look c: an additive billboard behind the body (zap-halo.wgsl.ts).
// The baseline look (a) creates and touches none of it. Called from stepZapLook once a tick.
import * as THREE from 'three/webgpu';
import { uniform, uv, wgslFn } from 'three/tsl';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import { createBrainArcs } from './character-effects';
import { ZAP_ARCS, strikeZapArcs, zapPartsBox, type ZapArcPart } from '../zap-arcs';
import { zapLook } from '../zap-look';
import { ZAP_HALO, ZAP_HALO_WGSL, zapHaloAmount } from './zap-halo.wgsl';
import type { Vec3 } from '../types';
import { ARC_POINTS } from '../brain-arcs';

/** The most arcs drawn at once, over every zapped body. */
const MAX_ARCS = 28;
/** The ribbons' width against the brain arcs' (the cerebrax's are sized for a boss's brain). */
const ARC_WIDTH = 0.3;

interface Fx {
  arcs: ReturnType<typeof createBrainArcs>;
  clock: number;
  next: number;
  seed: number;
  halos: Map<ZombieActor, Halo>;
  /** Halos not on a body: kept (never disposed), so a later zap draws a billboard whose pipeline is already built. */
  spareHalos: Halo[];
  flashed: Set<ZombieActor>;
}
type Halo = { sprite: THREE.Sprite; amount: { value: number } };
let fx: Fx | null = null;
/** Capture seam: the crawl arcs off, so a measurement of the bones under them is not a measurement of the arcs. */
let arcsShown = true;
export function setZapFxArcs(on: boolean): boolean { arcsShown = on; if (!on) fx?.arcs.show([], []); return arcsShown; }
/** Capture seam: the box round a body's live parts (what the halo is sized to, and what a capture frames). */
export const zapBodyBox = (a: ZombieActor) => zapPartsBox(partsOf(a));

/** The body's live flesh as arc parts: every posed primitive of a live cluster that adds flesh. */
const partsOf = (a: ZombieActor): ZapArcPart[] => {
  const body = a.posed(), out: ZapArcPart[] = [];
  for (const p of body.prims) {
    if (!(p.radius > 0.015) || (p.op !== undefined && p.op !== 'add') || body.clusters[p.cluster]?.alive === false) continue;
    out.push({ a: p.a, b: p.b, radius: p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]) });
  }
  return out;
};

function makeHalo(scene: THREE.Object3D) {
  const amount = uniform(0);
  const material = new THREE.SpriteNodeMaterial();
  material.name = 'zap-halo';
  // Alpha in colorNode.w (the project's WebGPU rule), additive, never written to depth.
  material.colorNode = wgslFn(ZAP_HALO_WGSL)({ uv: uv(), amount }) as unknown as THREE.Node<'vec4'>;
  material.transparent = true;
  material.blending = THREE.AdditiveBlending;
  material.depthWrite = false;
  material.depthTest = true;
  material.toneMapped = false;
  const sprite = new THREE.Sprite(material as unknown as THREE.SpriteMaterial);
  sprite.name = 'ZapHalo';
  sprite.frustumCulled = false;
  scene.add(sprite);
  return { sprite, amount: amount as unknown as { value: number } };
}

const makeFx = (scene: THREE.Object3D): Fx => {
  const f: Fx = { arcs: createBrainArcs(MAX_ARCS, ARC_WIDTH, true), clock: 0, next: 0, seed: 1, halos: new Map(), spareHalos: [], flashed: new Set() };
  f.arcs.object.name = 'ZapArcs';
  scene.add(f.arcs.object);
  return f;
};
const sceneOf = (ctx: GameContext) => (ctx as Partial<GameContext>).vfx?.characterEffects?.scene as THREE.Object3D | undefined;

/**
 * PRE-WARM (game-tick.ts, beside the tracers'): the crawl arcs' two ribbon layers and the halo are pipelines no
 * other effect builds, and the first zap of a session built them in its own frame. This draws them once, far under
 * the floor and at no strength, on a step nothing else is building; the step after takes them down again. The
 * baseline look draws none of it and warms nothing. True on the step it put them up (a build is due this frame).
 */
let warm: 'shown' | 'done' | null = null;
export function prewarmZapFx(ctx: GameContext): boolean {
  if (warm === 'done') return false;
  const scene = sceneOf(ctx);
  if (!scene || zapLook().code === 0) return false;
  if (!fx) fx = makeFx(scene);
  const f = fx;
  if (warm === 'shown') {
    if (f.halos.size === 0) for (const h of f.spareHalos) h.sprite.removeFromParent();
    if (f.flashed.size === 0 && f.halos.size === 0) f.arcs.show([], []);
    warm = 'done';
    return false;
  }
  if (f.halos.size > 0 || f.arcs.visible) { warm = 'done'; return false; }   // a live zap is drawing (and building) them itself
  const under: Vec3 = [0, -1000, 0];
  f.arcs.show([Array.from({ length: ARC_POINTS }, (_, i): Vec3 => [0, -1000, i * 1e-4])], [0]);
  const h = makeHalo(scene);
  h.sprite.position.set(under[0], under[1], under[2]);
  h.sprite.scale.set(1e-3, 1e-3, 1);
  h.amount.value = 0;
  f.spareHalos.push(h);
  warm = 'shown';
  return true;
}

/**
 * Step the overlay. `zapped`: the bodies whose view carries a glow this tick. With the baseline look live, or
 * nothing zapped, it only takes down what an earlier tick put up.
 */
export function stepZapFx(ctx: GameContext, zapped: ReadonlySet<ZombieActor>, dt: number): void {
  const look = zapLook();
  const scene = sceneOf(ctx);
  const live = look.code > 0 && zapped.size > 0 && !!scene;
  if (!fx) {
    if (!live) return;
    fx = makeFx(scene!);
  }
  const f = fx;
  // The kit: every zapped body's kit takes this tick's strobe state; a body no longer zapped gets its kit back.
  for (const a of f.flashed) {
    if (live && look.kitFlash && zapped.has(a)) continue;
    a.character?.kit?.zap(0);
    f.flashed.delete(a);
  }
  // The halo: one billboard a body, taken down with its zap.
  for (const [a, h] of f.halos) {
    if (live && look.halo && zapped.has(a)) continue;
    h.sprite.removeFromParent();
    f.spareHalos.push(h);
    f.halos.delete(a);
  }
  if (!live) { f.arcs.show([], []); return; }

  f.clock += Math.max(0, dt);
  const strike = f.clock >= f.next;
  if (strike) f.next = f.clock + 1 / ZAP_ARCS.hz;
  const paths: Vec3[][] = [], bright: number[] = [];
  const each = Math.max(1, Math.min(look.arcs, Math.floor(MAX_ARCS / zapped.size)));
  for (const a of zapped) {
    const z = a.zapLook();
    if (!z || !(z.glow > 0)) continue;
    // The kit takes the flesh's state; on a body whose kit plays the skeleton (ZapTier.xray false) the opposite.
    if (look.kitFlash && a.character?.kit) { a.character.kit.zap((z.invert ? -1 : 1) * (a.zapXray() ? 1 : -1)); f.flashed.add(a); }
    const parts = look.halo || (strike && look.arcs > 0) ? partsOf(a) : [];
    if (look.halo) {
      const box = zapPartsBox(parts);
      if (box) {
        let h = f.halos.get(a);
        if (!h) {
          h = f.spareHalos.pop() ?? makeHalo(scene!);
          if (!h.sprite.parent) scene!.add(h.sprite);
          f.halos.set(a, h);
        }
        h.sprite.position.set(box.center[0], box.center[1], box.center[2]);
        const wide = 2 * (Math.max(box.half[0], box.half[2]) * ZAP_HALO.fit + ZAP_HALO.padM), tall = 2 * (box.half[1] * ZAP_HALO.fit + ZAP_HALO.padM);
        h.sprite.scale.set(wide, tall, 1);
        // Fainter up close, where the billboard would fill the view and grey the room (zap-halo.wgsl.ts).
        const eye = (ctx as Partial<GameContext>).boot?.handle?.camera?.position;
        const dist = eye ? Math.hypot(box.center[0] - eye.x, box.center[1] - eye.y, box.center[2] - eye.z) : Infinity;
        h.amount.value = zapHaloAmount(z.invert, dist);
      }
    }
    if (strike && look.arcs > 0 && arcsShown) {
      const struck = strikeZapArcs(f.seed * 7919 + a.id, parts, each);
      for (let k = 0; k < struck.length; k++) {
        paths.push(struck[k]!);
        // Each strike flickers: some arcs flare, some are dim afterimages. Brighter on the negative frame.
        bright.push((z.invert ? 1.4 : 1.0) * (0.4 + 0.6 * (((f.seed * 31 + k * 17 + a.id) % 13) / 12)));
      }
    }
  }
  if (strike) { f.seed++; f.arcs.show(paths, bright); }
}

/** Diagnostic (the capture script): what the overlay is drawing. */
export function zapFxDebug(): { arcsVisible: boolean; halos: number; flashedKits: number } {
  return { arcsVisible: fx?.arcs.visible ?? false, halos: fx?.halos.size ?? 0, flashedKits: fx?.flashed.size ?? 0 };
}
