// src/sim/arenagen/index.ts
// Greenfield dynamite-first arena generator: generate → grade → retry.
// Determinism firewall: plain data only. Geometry derives from seed ONLY.
import {
  GRID_W, GRID_H, CELL_M,
  type Cell, type Room, type SpawnPoint,
} from '../floorplan';
import { createRng, randomInt, type SimRng } from '../rng';
import { placeCenterCover, placeMidClusters, assignMidHeights } from './cover';
import { gradePlan } from './grade';
import { getTheme, DEFAULT_THEME, type ThemeId, type ThemeRecord } from './themes';
import type { ArenaPlan, ArenaProp, GradeReport } from './types';

export type { ArenaPlan } from './types';

export const MAX_ATTEMPTS = 8;
const ENEMY_SPAWNS = 8;
const SPAWN_CLEAR = 4; // cells kept between player start and enemy spawns

const idx = (cx: number, cz: number) => cz * GRID_W + cx;

/** Blood facing angle (0..2047) pointing from cell A toward cell B.
 *  (Local copy — floorplan.ts retires once arenagen is proven.) */
function bloodAngleToward(from: Cell, to: Cell): number {
  const dx = to.cx - from.cx, dz = to.cz - from.cz;
  const theta = Math.atan2(-dx, -dz);
  return Math.round((((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * 2048 / (Math.PI * 2)) % 2048;
}

/** Player start: midpoint of a random edge, inside the perimeter lane,
 *  facing the center stage. */
function chooseStart(rng: SimRng): { cell: Cell; angBlood: number } {
  const ccx = GRID_W >> 1, ccz = GRID_H >> 1;
  const edge = randomInt(rng, 4);
  const cell: Cell =
    edge === 0 ? { cx: ccx, cz: 2 } :
    edge === 1 ? { cx: ccx, cz: GRID_H - 3 } :
    edge === 2 ? { cx: 2, cz: ccz } :
                 { cx: GRID_W - 3, cz: ccz };
  return { cell, angBlood: bloodAngleToward(cell, { cx: ccx, cz: ccz }) };
}

/** Enemy spawns on open floor, away from the player start. */
function placeSpawns(rng: SimRng, open: Uint8Array, start: Cell): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  for (let attempt = 0; spawns.length < ENEMY_SPAWNS && attempt < ENEMY_SPAWNS * 30; attempt++) {
    const cx = 2 + randomInt(rng, GRID_W - 4);
    const cz = 2 + randomInt(rng, GRID_H - 4);
    if (open[idx(cx, cz)] !== 1) continue;
    if (Math.abs(cx - start.cx) + Math.abs(cz - start.cz) < SPAWN_CLEAR + 2) continue;
    spawns.push({ cell: { cx, cz }, roomId: 0 });
  }
  return spawns;
}

/** Cosmetic prop scatter — separate RNG stream forked by theme index so theme
 *  choice NEVER perturbs geometry, spawns, or the sim-step stream. */
function scatterProps(crng: SimRng, open: Uint8Array, theme: ThemeRecord): ArenaProp[] {
  let openCount = 0;
  for (let i = 0; i < open.length; i++) if (open[i] === 1) openCount++;
  const nProps = Math.round((openCount * theme.propPer100Cells) / 100);
  const nRubble = Math.round((openCount * theme.rubblePer100Cells) / 100);
  const props: ArenaProp[] = [];
  const taken = new Set<number>();
  const place = (kind: ArenaProp['kind'], n: number) => {
    for (let attempt = 0; props.filter((p) => p.kind === kind).length < n && attempt < n * 20; attempt++) {
      const cx = 1 + randomInt(crng, GRID_W - 2);
      const cz = 1 + randomInt(crng, GRID_H - 2);
      const k = idx(cx, cz);
      if (open[k] !== 1 || taken.has(k)) continue;
      taken.add(k);
      props.push({ cell: { cx, cz }, kind });
    }
  };
  place('prop', nProps);
  place('rubble', nRubble);
  return props;
}

function buildCandidate(seed: number, attempt: number, themeId: ThemeId): ArenaPlan {
  // Geometry stream: seed + attempt ONLY — never theme. XOR-mixed away from
  // both the sim-step stream and floorplan.ts's stream.
  const rng = createRng((seed ^ 0x51ed270b ^ Math.imul(attempt + 1, 0x9e3779b9)) >>> 0);
  const open = new Uint8Array(GRID_W * GRID_H);
  for (let z = 1; z < GRID_H - 1; z++)
    for (let x = 1; x < GRID_W - 1; x++) open[idx(x, z)] = 1;

  const arena: Room = { id: 0, cx: 1, cz: 1, w: GRID_W - 2, h: GRID_H - 2, kind: 'arena' };
  const start = chooseStart(rng);
  const centerPieces = placeCenterCover(rng, open);
  const { pieces, pockets } = placeMidClusters(rng, open);
  assignMidHeights(rng, pieces);
  const cover = [...centerPieces, ...pieces];
  open[idx(start.cell.cx, start.cell.cz)] = 1; // guarantee the start cell
  const spawns = placeSpawns(rng, open, start.cell);
  const grade = gradePlan(open, cover, pockets);
  const theme = getTheme(themeId);
  const crng = createRng((seed ^ Math.imul(theme.index + 1, 0x85ebca6b)) >>> 0);
  const props = scatterProps(crng, open, theme);

  return {
    seed, gridW: GRID_W, gridH: GRID_H, cellMeters: CELL_M,
    open, rooms: [arena], spawns, start, arenaRoomId: 0,
    cover, pockets, themeId, props, grade, attempt,
  };
}

/** Comparable scalar for fallback-to-best when no attempt passes. */
function gradeScore(g: GradeReport): number {
  return g.sightline
    + Math.min(g.pocketCount, 4) * 0.25
    + (g.laneConnected ? 1 : 0)
    + (g.lowMidRatioOk ? 1 : 0)
    + (g.centerClean ? 1 : 0);
}

/** Generation is total: every seed yields a plan (best candidate if none pass).
 *  Deterministic: retry index folds into the RNG stream. */
export function generateArena(seed: number, themeId: ThemeId = DEFAULT_THEME): ArenaPlan {
  let best: ArenaPlan | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const plan = buildCandidate(seed, attempt, themeId);
    if (plan.grade.pass) return plan;
    if (!best || gradeScore(plan.grade) > gradeScore(best.grade)) best = plan;
  }
  return best!;
}
