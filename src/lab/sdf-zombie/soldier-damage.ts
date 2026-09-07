import type { BuildResult } from './build-body';
import type { MissingLimbs } from './collapse';
import { woundWorldPos, type Wound } from './damage';
import type { LimbId } from './types';
import { dot, len, normalize, sub } from './vec';

export interface SoldierInjury {
  sever: LimbId[];
  fatal: boolean;
  downed: boolean;
  missing: MissingLimbs;
  wounded: MissingLimbs;
  legHurt: boolean;
}

/** Provisional regional injury thresholds, separate from any future HP system.
 * Pellet = 1; torso survives one scattered volley. Knee/leg failure disables
 * locomotion before the focused hits required to tear a limb away. */
export const SOLDIER_INJURY_TUNING = { legDowned: 4, limbSever: 8, torsoFatal: 16 } as const;

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
  let fatal = !body.clusters.find(c => c.limb === 'head')?.alive;
  let downed = missing.legL || missing.legR || missing.armL || missing.armR;
  for (const wound of wounds) {
    if (wound.injuryIgnored) continue;
    const prim = body.prims[wound.primIdx];
    if (!prim || prim.dead || !body.clusters.find(c => c.limb === prim.limb)?.alive) continue;
    const limb = prim.limb;
    if (limb in wounded) wounded[limb as keyof MissingLimbs] = true;
    if (wound.type === 'burn') continue;
    if (limb === 'head') {
      fatal = true;
      if (wound.type === 'blast' && wound.radius >= 0.10 && !sever.includes(limb)) sever.push(limb);
      continue;
    }
    // Eight focused pellets overcome girth even when repeated impacts cover
    // the same section. This does not enlarge the visible crater. A slug in
    // the middle of a limb hurts first; one centered on a joint can remove it.
    let injury = wound.type === 'pellet' ? 1 : Math.min(3, 3 * wound.radius / 0.13);
    const bone = prim.bone ? body.bones.get(prim.bone) : undefined;
    if (limb !== 'torso' && bone && wound.type === 'blast' && wound.radius >= 0.10) {
      const axis = sub(bone.tail, bone.head), size = len(axis);
      const along = dot(sub(woundWorldPos(body.prims, wound), bone.head), normalize(axis));
      if (Math.min(Math.abs(along), Math.abs(size - along)) <= 0.065) injury = SOLDIER_INJURY_TUNING.limbSever;
    }
    points[limb] += injury;
  }
  for (const limb of Object.keys(intact) as (keyof MissingLimbs)[]) {
    if (!missing[limb] && points[limb] >= SOLDIER_INJURY_TUNING.limbSever) sever.push(limb);
  }
  fatal ||= points.torso >= SOLDIER_INJURY_TUNING.torsoFatal;
  downed ||= points.legL >= SOLDIER_INJURY_TUNING.legDowned || points.legR >= SOLDIER_INJURY_TUNING.legDowned;
  return { sever, fatal, downed, missing, wounded, legHurt: wounded.legL || wounded.legR };
}
