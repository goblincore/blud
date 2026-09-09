import type { BuildResult } from './build-body';
import type { MissingLimbs } from './collapse';
import { woundWorldPos, type Wound } from './damage';
import type { LimbId, Vec3 } from './types';
import { dot, len, normalize, sub } from './vec';

export interface SoldierInjury {
  sever: LimbId[];
  fatal: boolean;
  downed: boolean;
  missing: MissingLimbs;
  wounded: MissingLimbs;
  legHurt: boolean;
  mobilityInjury?: { severity: number; side: 'L' | 'R' | 'both' };
}

/** Provisional regional injury thresholds, separate from any future HP system.
 * Pellet = 1; torso survives one scattered volley. Knee/leg failure disables
 * locomotion before the focused hits required to tear a limb away. */
export const SOLDIER_INJURY_TUNING = { legDowned: 6, limbSever: 8, armScatteredSever: 16, armFocusedSever: 8, armCutPoints: 4, armFocusRadius: .12, torsoFatal: 24, headFatal: 12, directHeadPellets: 4 } as const;

interface ArmHit { wound: Wound; limb: 'armL' | 'armR'; point: Vec3; points: number; joint: boolean }
const injuryPoints = (wound: Wound) => wound.type === 'pellet' ? 1
  : wound.shot?.weapon === 'slug' ? 3 : Math.min(3, 3 * wound.radius / .13);
function armHits(body: BuildResult, wounds: readonly Wound[]): ArmHit[] {
  const hits: ArmHit[] = [];
  for (const wound of wounds) {
    const prim = body.prims[wound.primIdx];
    if (wound.injuryIgnored || wound.type === 'burn' || !prim || prim.dead
      || (prim.limb !== 'armL' && prim.limb !== 'armR') || !body.clusters[prim.cluster]?.alive) continue;
    const point = woundWorldPos(body.prims, wound);
    const bone = prim.bone ? body.bones.get(prim.bone) : undefined;
    const axis = bone ? sub(bone.tail, bone.head) : [0, 0, 0] as Vec3;
    const along = bone ? dot(sub(point, bone.head), normalize(axis)) : Infinity;
    hits.push({ wound, limb: prim.limb, point, points: injuryPoints(wound),
      joint: !!bone && Math.min(Math.abs(along), Math.abs(len(axis) - along)) <= .065 });
  }
  return hits;
}

/** Geometry alone uses an enlarged sever calibre. Require multiple impacts
 * near THIS cut before allowing it to remove a Soldier arm. */
export function soldierArmCutAllowed(body: BuildResult, wounds: readonly Wound[], limb: LimbId, at: Vec3): boolean {
  return armHits(body, wounds).filter(h => h.limb === limb
    && len(sub(h.point, at)) <= SOLDIER_INJURY_TUNING.armFocusRadius)
    .reduce((sum, h) => sum + h.points, 0) >= SOLDIER_INJURY_TUNING.armCutPoints;
}

/** Soldier injury policy. Callers keep the zombie's existing damage path. */
export function soldierInjury(body: BuildResult, wounds: readonly Wound[]): SoldierInjury {
  const intact = { armL: false, armR: false, legL: false, legR: false };
  const missing = { ...intact }, wounded = { ...intact };
  const sever: LimbId[] = [];
  const points: Record<LimbId, number> = { torso: 0, head: 0, armL: 0, armR: 0, legL: 0, legR: 0 };
  for (const limb of Object.keys(intact) as (keyof MissingLimbs)[]) {
    missing[limb] = !body.clusters.find(c => c.limb === limb)?.alive
      || body.prims.some(p => p.limb === limb && p.op !== 'sub' && p.dead);
  }
  const mobility = { pelvis: 0, L: 0, R: 0 };
  const headShots = new Map<number, { hits: number; barrels: number }>();
  let fatal = !body.clusters.find(c => c.limb === 'head')?.alive;
  let downed = missing.legL || missing.legR;
  for (const wound of wounds) {
    if (wound.injuryIgnored) continue;
    const prim = body.prims[wound.primIdx];
    if (!prim || prim.dead || !body.clusters.find(c => c.limb === prim.limb)?.alive) continue;
    const limb = prim.limb;
    if (limb in wounded) wounded[limb as keyof MissingLimbs] = true;
    if (wound.type === 'burn') continue;
    if (limb === 'head' && wound.shot?.weapon === 'shotgun' && wound.shot.barrels === 2) {
      const volley = headShots.get(wound.shot.shotId) ?? { hits: 0, barrels: 0 };
      volley.hits++;
      volley.barrels |= 1 << wound.shot.barrel;
      headShots.set(wound.shot.shotId, volley);
      // A direct hit requires a concentrated group from BOTH barrels, not
      // a stray head pellet in a body volley or two unrelated trigger pulls.
      if (volley.hits >= SOLDIER_INJURY_TUNING.directHeadPellets && volley.barrels === 3) {
        fatal = true;
        if (!sever.includes('head')) sever.push('head');
      }
    }
    if (limb === 'head' && wound.shot?.weapon === 'explosion' && wound.type === 'blast') {
      fatal = true;
      if (wound.radius >= 0.10 && !sever.includes('head')) sever.push('head');
    }
    const injury = injuryPoints(wound);
    points[limb] += injury;
    if (prim.bone === 'pelvis') mobility.pelvis += injury;
    else if (prim.bone === 'thigh.l') mobility.L += injury;
    else if (prim.bone === 'thigh.r') mobility.R += injury;
  }
  const arms = armHits(body, wounds);
  for (const limb of Object.keys(intact) as (keyof MissingLimbs)[]) {
    if (missing[limb]) continue;
    if (limb === 'legL' || limb === 'legR') {
      if (points[limb] >= SOLDIER_INJURY_TUNING.limbSever) sever.push(limb);
      continue;
    }
    const hits = arms.filter(h => h.limb === limb);
    const focused = hits.some(anchor => {
      const local = hits.filter(h => len(sub(h.point, anchor.point)) <= SOLDIER_INJURY_TUNING.armFocusRadius);
      if (local.reduce((sum, h) => sum + h.points, 0) >= SOLDIER_INJURY_TUNING.armFocusedSever) return true;
      const volleys = new Map<number, { hits: number; barrels: number }>();
      for (const h of local) {
        const shot = h.wound.shot;
        if (!h.joint || h.wound.type !== 'pellet' || shot?.weapon !== 'shotgun' || shot.barrels !== 2) continue;
        const volley = volleys.get(shot.shotId) ?? { hits: 0, barrels: 0 };
        volley.hits++; volley.barrels |= 1 << shot.barrel;
        volleys.set(shot.shotId, volley);
        if (volley.hits >= 4 && volley.barrels === 3) return true;
      }
      return false;
    });
    if (focused || points[limb] >= SOLDIER_INJURY_TUNING.armScatteredSever) sever.push(limb);
  }
  fatal ||= points.torso >= SOLDIER_INJURY_TUNING.torsoFatal || points.head >= SOLDIER_INJURY_TUNING.headFatal;
  downed ||= points.legL >= SOLDIER_INJURY_TUNING.legDowned || points.legR >= SOLDIER_INJURY_TUNING.legDowned
    || mobility.pelvis >= SOLDIER_INJURY_TUNING.legDowned;
  const severity = Math.min(1, Math.max(mobility.pelvis, mobility.L, mobility.R) / 3);
  const side = mobility.pelvis > 0 || (mobility.L > 0 && mobility.R > 0) ? 'both' as const
    : mobility.L > 0 ? 'L' as const : 'R' as const;
  return { sever, fatal, downed, missing, wounded, legHurt: wounded.legL || wounded.legR,
    ...(severity > 0 ? { mobilityInjury: { severity, side } } : {}) };
}
