// src/lab/sdf-zombie/connectivity-toughness.test.ts
//
// JOINT TOUGHNESS (spec 2026-11-02 §3): an arm or leg comes off at the elbow
// or knee, and the shoulder or hip resists. Measured on the zombie with
// jittered hits along each limb at the shipped pellet and slug sever calibres
// (game-weapon.ts), counting hits until the first cut and where it lands.
import { afterEach, describe, expect, it } from 'vitest';
import { chainOrder, cutChains, cutLimbs, JOINT_TOUGHNESS, jointClass, setJointToughness } from './connectivity';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { characterEntry, characterNames } from './character-registry';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { worldHitToWound, type Wound } from './damage';
import type { LimbId, Vec3 } from './types';

const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
const torso = body.clusters.find(c => c.limb === 'torso')!;
const PELLET = 0.10, SLUG = 0.13;
const SHIPPED = { ...JOINT_TOUGHNESS };
afterEach(() => setJointToughness(SHIPPED));

function chain(limb: LimbId): number[] {
  return chainOrder(body, body.clusters.find(c => c.limb === limb)!);
}

/** Where along the limb, root ball centre (0) to tip ball centre (1). */
function along(limb: LimbId, t: number): Vec3 {
  const o = chain(limb);
  const a = body.prims[o[0]!]!.a, b = body.prims[o[o.length - 1]!]!.b;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** The arm's elbow / the leg's knee, as a fraction along the limb. */
function midT(limb: LimbId): number {
  const o = chain(limb);
  const a = body.prims[o[0]!]!.a, b = body.prims[o[o.length - 1]!]!.b;
  const j = o.findIndex((_, k) => k > 0 && jointClass(limb, body.prims[o[k - 1]!]!, body.prims[o[k]!]!) === 'mid');
  const m = body.prims[o[j]!]!.a;
  const d = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  return d(a, m) / d(a, b);
}

type Outcome = 'root' | 'mid' | 'other' | 'none';

/** Hits (jittered ±3 cm, from the front) until the first cut; which class. */
function shoot(limb: LimbId, t: number, sever: number, maxHits: number, seed = 1): { hits: number; at: Outcome } {
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const at = along(limb, t);
  const o = chain(limb);
  const wounds: Wound[] = [];
  for (let n = 1; n <= maxHits; n++) {
    const p: Vec3 = [at[0] + (rnd() - 0.5) * 0.06, at[1] + (rnd() - 0.5) * 0.06, at[2] - 0.03 + (rnd() - 0.5) * 0.02];
    wounds.push({ ...worldHitToWound(body.prims, p, 0.055, 'blast'), severRadius: sever });
    if (cutLimbs(body, wounds, torso.center).includes(limb)) return { hits: n, at: 'root' };
    const c = cutChains(body, wounds).find(x => x.limb === limb);
    if (c) {
      const k = o.indexOf(c.fromPrim);
      return { hits: n, at: jointClass(limb, body.prims[o[k - 1]!]!, body.prims[c.fromPrim]!) };
    }
  }
  return { hits: maxHits, at: 'none' };
}

const LIMBS: LimbId[] = ['armL', 'armR', 'legL', 'legR'];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

describe('joint classes', () => {
  it('classes the zombie arm root → elbow → wrist and leg root → knee → ankle', () => {
    for (const limb of LIMBS) {
      const o = chain(limb);
      const classes = o.slice(1).map((p, k) => jointClass(limb, body.prims[o[k]!]!, body.prims[p]!));
      // An arm opens with its shoulder ball (a root joint); a leg has no hip
      // ball, so its first chain joint IS the knee and its root is the neck.
      expect(classes.filter(c => c === 'mid'), limb).toHaveLength(1);
      if (limb.startsWith('arm')) expect(classes[0], limb).toBe('root');
    }
  });

  it('never scales the head', () => {
    const o = chain('head');
    for (let k = 1; k < o.length; k++) expect(jointClass('head', body.prims[o[k - 1]!]!, body.prims[o[k]!]!)).toBe('other');
  });
});

describe('joint toughness', () => {
  // Measured at the shipped factors (root 0.6, mid 1.7) over 4 limbs x 8 seeds:
  // pellets never take the root in 12 hits; a first slug takes a shoulder in
  // 1 of 32; the hip never goes from the front (it is the thickest neck).
  it('the shoulder and hip shrug off a dozen pellets, and a first slug almost always', () => {
    let slugCuts = 0;
    for (const limb of LIMBS) for (const seed of SEEDS) {
      expect(shoot(limb, 0, PELLET, 12, seed).at, `${limb} pellet seed ${seed}`).toBe('none');
      if (shoot(limb, 0, SLUG, 1, seed).at !== 'none') slugCuts++;
    }
    expect(slugCuts).toBeLessThanOrEqual(2);
  });

  it('sustained slugs can still take a shoulder', () => {
    expect(SEEDS.some(seed => shoot('armL', 0, SLUG, 30, seed).at === 'root')).toBe(true);
  });

  it('the elbow and knee come off within two pellets or one slug', () => {
    for (const limb of LIMBS) for (const seed of SEEDS) {
      const p = shoot(limb, midT(limb), PELLET, 2, seed);
      expect(p.at, `${limb} pellet seed ${seed}`).toBe('mid');
      expect(shoot(limb, midT(limb), SLUG, 1, seed).at, `${limb} slug seed ${seed}`).toBe('mid');
    }
  });

  // Before: mid upper arm / mid thigh was a dead zone (0 of 32 in 30 hits).
  // Now about half reach the elbow or knee within 6 pellets, and none ever
  // take the root.
  it('hits on the upper arm or thigh reach the elbow or knee, never the root', () => {
    let mid = 0;
    for (const limb of LIMBS) for (const seed of SEEDS) {
      const r = shoot(limb, midT(limb) * 0.55, PELLET, 6, seed);
      expect(r.at, `${limb} seed ${seed}`).not.toBe('root');
      if (r.at === 'mid') mid++;
    }
    expect(mid).toBeGreaterThanOrEqual(LIMBS.length * SEEDS.length / 2);
  });

  it('a shot on the hand still takes just the hand', () => {
    for (const seed of SEEDS) expect(shoot('armL', 1, SLUG, 1, seed).at, `seed ${seed}`).toBe('other');
  });

  it('a big blast on the root still takes the whole limb', () => {
    const at = along('armL', 0);
    expect(cutLimbs(body, [worldHitToWound(body.prims, at, 0.16, 'blast')], torso.center)).toContain('armL');
  });

  it('severRadius 0 never cuts, however tough the joint', () => {
    setJointToughness({ mid: 3 });
    const w = { ...worldHitToWound(body.prims, along('armL', midT('armL')), 0.2, 'blast'), severRadius: 0 };
    expect(cutChains(body, [w])).toHaveLength(0);
  });

  it('factors of 1 restore the old one-slug shoulder cut', () => {
    setJointToughness({ root: 1, mid: 1 });
    expect(shoot('armL', 0, SLUG, 1).at).toBe('root');
  });
});

// THE CAST (spec §3): every character's arms and legs, classed by bone name.
// A limb with no `mid` joint keeps the old rule (no elbow/knee to widen), so it
// must be listed here with its reason rather than missed silently.
describe('joint classes across the cast', () => {
  // Limbs that do not have exactly one elbow/knee. Several authored-order
  // chains revisit a bone after a DECORATION prim (a garter, a cuff, a lace
  // ruff), which chainOrder reads as an extra joint -- the known bride issue
  // (docs/tasks/characters.md, "decoration prims act as fake joints"). Each
  // extra thigh->shin step is widened too; a fake joint INTO a root bone is
  // toughened, which only makes it harder to cut there.
  const DECOR = 'decoration prims revisit the bone (fake joints, known bride issue)';
  const NO_MID_JOINT: Record<string, string> = {
    'goblin-home legL': DECOR, 'goblin-home legR': DECOR,
    'goblin-cinematic-home legL': DECOR, 'goblin-cinematic-home legR': DECOR,
    'minotaur legR': DECOR,
    'bride armR': DECOR, 'bride legL': DECOR, 'bride legR': DECOR,
    'cyberdemon armL': 'a gun arm: upper arm only, no forearm bone to cut at',
    'broodmother legL': 'four legs share one cluster: four knees', 'broodmother legR': 'four legs share one cluster: four knees',
  };
  it('every arm and leg has exactly one elbow/knee, or is a listed exception', () => {
    const report: string[] = [];
    const missing: string[] = [];
    for (const name of characterNames()) {
      const doc = parseBlob(characterEntry(name).src);
      const b = buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS);
      for (const limb of LIMBS) {
        const cl = b.clusters.find(c => c.limb === limb);
        if (!cl) continue;
        const o = chainOrder(b, cl);
        const classes = o.slice(1).map((p, k) => jointClass(limb, b.prims[o[k]!]!, b.prims[p]!));
        const mids = classes.filter(c => c === 'mid').length;
        report.push(`${name} ${limb}: ${classes.join(' ')}`);
        if (mids !== 1 && !NO_MID_JOINT[`${name} ${limb}`]) missing.push(`${name} ${limb} (${mids} mid; bones ${o.map(i => b.prims[i]!.bone).join(',')})`);
      }
    }
    expect(missing, report.join('\n')).toEqual([]);
  });
});
