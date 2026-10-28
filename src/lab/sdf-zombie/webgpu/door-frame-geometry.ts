// src/lab/sdf-zombie/webgpu/door-frame-geometry.ts
//
// DOOR READABILITY CUES (owner playtest 2026-10-28: the shut doors "sometimes just look like wall panels" under fog and
// the flashlight). Four cues, each switched on its own by `?doorcues=` (doorCues below; all on by default):
//   frame  — a dark heavy-metal surround on each face: two posts and a chunky header beam standing proud of the wall,
//            the reveal (the doorway's jamb sides and soffit between the face and the leaves) lined in the same metal,
//            and a threshold plate on the floor. The outline breaks the wall plane.
//   light  — a status lamp on each side, a small emissive bar centred on the header (or beside the door where the
//            ceiling leaves no header room). Its colour is the door's status (game-doors.ts: red shut, green opening /
//            open, amber closing), plus a faint status-coloured spill on the header round it. Baked weights, no light.
//   recess — the leaves stand RECESS_INSET_M back from each face plane instead of flush (door-leaf-geometry.ts).
//   tone   — the leaves wear cleaner, colder, lighter steel than the grimy walls (game-doors.ts).
//
// This module builds the frame + lamp mesh data for one side of a door (game-doors.ts draws it, lit by that side's
// zone like the leaves). Every vertex carries `lamp` (1 on the lamp's faces) and `spill` (the lamp's glow weight on
// the frame round it, 1 at the lamp's ends, 0 SPILL_M away). Nothing here touches the leaves' travel: the frame lies
// outside the doorway (posts, header) or outside the leaves' slab (the reveal lining spans only the gap between a
// recessed leaf face and the face plane), so a leaf sliding into its jamb never meets it.
//
// Pure: no three.js, no DOM.

import type { SectorDoorDef } from './sector-def';

export type DoorCue = 'frame' | 'light' | 'recess' | 'tone';
export const DOOR_CUES: readonly DoorCue[] = ['frame', 'light', 'recess', 'tone'];
export type DoorCues = Readonly<Record<DoorCue, boolean>>;

/** `?doorcues=`: absent = all on; `none` / `0` / empty = all off; otherwise the listed cues (comma-separated) only,
 *  and `all,-light` style removal from everything. Unknown names are ignored. */
export function doorCues(param: string | null): DoorCues {
  const all = Object.fromEntries(DOOR_CUES.map(c => [c, true])) as Record<DoorCue, boolean>;
  if (param === null) return all;
  const words = param.split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
  const out = Object.fromEntries(DOOR_CUES.map(c => [c, false])) as Record<DoorCue, boolean>;
  if (words.length === 0 || words.includes('none') || words.includes('0') || words.includes('off')) return out;
  for (const w of words) {
    if (w === 'all' || w === '1' || w === 'on') DOOR_CUES.forEach(c => { out[c] = true; });
    else if (w.startsWith('-') && (DOOR_CUES as readonly string[]).includes(w.slice(1))) out[w.slice(1) as DoorCue] = false;
    else if ((DOOR_CUES as readonly string[]).includes(w)) out[w as DoorCue] = true;
  }
  return out;
}

/** How far a recessed leaf face sits inside its face plane (metres); clamped so a leaf stays RECESS_MIN_HALF_M thick each side. */
export const RECESS_INSET_M = 0.12;
const RECESS_MIN_HALF_M = 0.06;
/** The leaves' inset for door `def` under the cues (door-leaf-geometry.ts LEAF_INSET_M when not recessed). */
export function leafInset(def: SectorDoorDef, recess: boolean, flush: number): number {
  if (!recess) return flush;
  return Math.max(flush, Math.min(RECESS_INSET_M, def.depth / 2 - RECESS_MIN_HALF_M));
}

/** The frame's proportions (metres). */
export const FRAME = {
  /** How far the posts and header stand out of the wall plane. */
  proud: 0.07,
  /** Post width beside the doorway. */
  post: 0.17,
  /** Header beam height over the doorway (less where the room's ceiling is lower). */
  header: 0.24,
  /** The threshold plate's lift off the floor and its overhang beyond each face. */
  plateLift: 0.008, plateOver: 0.12,
  /** The reveal lining's offset into the doorway off the jamb sides and soffit (no z-fight with the sector walls). */
  reveal: 0.003,
};
/** The status lamp: a bar this wide (at most a third of the doorway), tall and proud of its mount. */
export const LAMP = { width: 0.42, height: 0.07, proud: 0.03, sideHeight: 0.32, sideWidth: 0.07 };
/** The lamp's spill on the header falls to 0 this far from the lamp's ends. */
export const SPILL_M = 0.55;
const UV_TILE_M = 4;

export interface FrameMeshData {
  position: number[];
  normal: number[];
  uv: number[];
  mottleUv: number[];
  /** 1 on the lamp's faces. */
  lamp: number[];
  /** The lamp's glow weight on the frame (0..1). */
  spill: number[];
  count: number;
}

export interface FrameSideOptions {
  frame: boolean;
  light: boolean;
  /** The leaves' inset from each face plane (leafInset). */
  inset: number;
  /** The doorway sector's floor. */
  floor: number;
  /** The room beyond this side's face: its floor and ceiling. */
  roomFloor: number;
  roomCeil: number;
  /** This side's face sign (doorFaceSigns). */
  sign: number;
  /** The threshold plate (side 0 holds it): its overhang past this side's face (+w) and past the far face (-w), metres
   *  (0 where that room's floor is not the doorway's: no plate hanging over a step). Null: no plate. */
  plate: { near: number; far: number } | null;
}

type V3 = [number, number, number];

/** Side `side`'s frame + lamp data: empty when neither cue is on. */
export function doorFrameMesh(def: SectorDoorDef, o: FrameSideOptions): FrameMeshData {
  const out: FrameMeshData = { position: [], normal: [], uv: [], mottleUv: [], lamp: [], spill: [], count: 0 };
  if (!o.frame && !o.light) return out;
  const W = def.width;
  const tx = (def.b[0] - def.a[0]) / W, tz = (def.b[1] - def.a[1]) / W;
  const nx = -tz, nz = tx;                                   // left of a -> b
  const s = o.sign;
  const D2 = def.depth / 2;
  const top = o.floor + def.height;
  const bottom = Math.min(o.floor, o.roomFloor);
  const headroom = o.roomCeil - top;
  const headerH = Math.min(FRAME.header, headroom - 0.005);
  const hasHeader = headerH >= 0.08;
  // Local frame: m along a -> b in metres (0 at a), w across (+ toward this side's room), y up.
  const at = (m: number, w: number, y: number): V3 => [def.a[0] + tx * m + nx * s * w, y, def.a[1] + tz * m + nz * s * w];
  const T: V3 = [tx, 0, tz], N: V3 = [nx * s, 0, nz * s], UP: V3 = [0, 1, 0];
  const neg = (v: V3): V3 => [-v[0], -v[1], -v[2]];
  const lampL = W / 2 - Math.min(LAMP.width, W / 3) / 2, lampR = W - lampL;
  const spillAt = (m: number): number => (m >= lampL && m <= lampR ? 1 : Math.max(0, 1 - Math.min(Math.abs(m - lampL), Math.abs(m - lampR)) / SPILL_M));
  /** One quad (corners in order round it), flipped to face `n`; uv from the two world axes it spans. */
  const quad = (p: V3[], n: V3, lamp: number, spill: readonly number[] = [0, 0, 0, 0]) => {
    const [a, b, c] = p as [V3, V3, V3];
    const cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const tris = cx * n[0] + cy * n[1] + cz * n[2] >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    const vertical = Math.abs(n[1]) < 0.5;
    for (const i of tris) {
      const q = p[i]!;
      // Walls: along the face (x·t + z·t) by height; flats: world x/z.
      const u = vertical ? (Math.abs(n[0]) > Math.abs(n[2]) ? q[2] : q[0]) : q[0];
      const v = vertical ? q[1] : q[2];
      out.position.push(...q); out.normal.push(...n);
      out.uv.push(u / UV_TILE_M, v / UV_TILE_M); out.mottleUv.push(u / UV_TILE_M, v / UV_TILE_M);
      out.lamp.push(lamp); out.spill.push(spill[i]!);
      out.count++;
    }
  };
  /** An axis-aligned box in local (m, w, y) without the faces listed in `skip` ('-m', '+m', '-w', '+w', '-y', '+y'). */
  const box = (m0: number, m1: number, w0: number, w1: number, y0: number, y1: number, lamp: number, skip: string[] = [], spill?: (m: number) => number) => {
    const sp = (ms: number[]) => (spill ? ms.map(spill) : [0, 0, 0, 0]);
    if (!skip.includes('+w')) quad([at(m0, w1, y0), at(m1, w1, y0), at(m1, w1, y1), at(m0, w1, y1)], N, lamp, sp([m0, m1, m1, m0]));
    if (!skip.includes('-w')) quad([at(m0, w0, y0), at(m1, w0, y0), at(m1, w0, y1), at(m0, w0, y1)], neg(N), lamp, sp([m0, m1, m1, m0]));
    if (!skip.includes('-m')) quad([at(m0, w0, y0), at(m0, w1, y0), at(m0, w1, y1), at(m0, w0, y1)], neg(T), lamp, sp([m0, m0, m0, m0]));
    if (!skip.includes('+m')) quad([at(m1, w0, y0), at(m1, w1, y0), at(m1, w1, y1), at(m1, w0, y1)], T, lamp, sp([m1, m1, m1, m1]));
    if (!skip.includes('+y')) quad([at(m0, w0, y1), at(m1, w0, y1), at(m1, w1, y1), at(m0, w1, y1)], UP, lamp, sp([m0, m1, m1, m0]));
    if (!skip.includes('-y')) quad([at(m0, w0, y0), at(m1, w0, y0), at(m1, w1, y0), at(m0, w1, y0)], neg(UP), lamp, sp([m0, m1, m1, m0]));
  };
  const face = D2 + FRAME.proud;                             // the frame's front plane (w)
  const P = FRAME.post;
  const postTop = hasHeader ? top : Math.min(top + Math.max(0, headroom - 0.005), o.roomCeil - 0.005);
  if (o.frame) {
    // Posts: beside the doorway, floor to the header (the wall face is behind them: no back face).
    box(-P, 0, D2, face, bottom, postTop, 0, ['-w', '-y', ...(hasHeader ? ['+y'] : [])]);
    box(W, W + P, D2, face, bottom, postTop, 0, ['-w', '-y', ...(hasHeader ? ['+y'] : [])]);
    if (hasHeader) {
      // Header: across the posts; its front split at the lamp and the spill's ends, so the spill has vertices.
      const cuts = [-P, lampL - SPILL_M, lampL, lampR, lampR + SPILL_M, W + P].filter((m, i, a) => i === 0 || m > a[i - 1]! + 1e-6)
        .map(m => Math.min(W + P, Math.max(-P, m)));
      const y0 = top, y1 = top + headerH;
      for (let i = 0; i + 1 < cuts.length; i++) {
        const m0 = cuts[i]!, m1 = cuts[i + 1]!;
        if (m1 - m0 < 1e-6) continue;
        quad([at(m0, face, y0), at(m1, face, y0), at(m1, face, y1), at(m0, face, y1)], N, 0,
          [spillAt(m0), spillAt(m1), spillAt(m1), spillAt(m0)].map(v => (o.light ? v : 0)));
      }
      box(-P, W + P, D2, face, y0, y1, 0, ['-w', '+w']);    // its ends, top and underside
    }
    // The reveal: the doorway's jamb sides and soffit from the leaves' face to the face plane, lined in the metal.
    const wLeaf = D2 - o.inset, r = FRAME.reveal;
    if (o.inset > 0.03) {
      quad([at(r, wLeaf, o.floor), at(r, D2, o.floor), at(r, D2, top - r), at(r, wLeaf, top - r)], T, 0);
      quad([at(W - r, wLeaf, o.floor), at(W - r, D2, o.floor), at(W - r, D2, top - r), at(W - r, wLeaf, top - r)], neg(T), 0);
      quad([at(r, wLeaf, top - r), at(W - r, wLeaf, top - r), at(W - r, D2, top - r), at(r, D2, top - r)], neg(UP), 0);
    }
    if (o.plate) {
      // The threshold plate across the doorway, under the leaves, overhanging both faces.
      const y = o.floor + FRAME.plateLift;
      box(0, W, -D2 - o.plate.far, D2 + o.plate.near, o.floor, y, 0, ['-y']);
    }
  }
  if (o.light) {
    const mount = o.frame ? face : D2;
    if (hasHeader) {
      const yc = top + headerH / 2, h = Math.min(LAMP.height, headerH * 0.5);
      box(lampL, lampR, mount, mount + LAMP.proud, yc - h / 2, yc + h / 2, 1, ['-w']);
    } else {
      // No header room: a vertical lamp on each post (or the wall beside the doorway), just under the top.
      const y1 = top - 0.06, y0 = y1 - LAMP.sideHeight, lw = LAMP.sideWidth;
      box(-P / 2 - lw / 2, -P / 2 + lw / 2, mount, mount + LAMP.proud, y0, y1, 1, ['-w']);
      box(W + P / 2 - lw / 2, W + P / 2 + lw / 2, mount, mount + LAMP.proud, y0, y1, 1, ['-w']);
    }
  }
  return out;
}

/** The status lamp's colour for a door phase: red shut, green opening or open, amber closing (linear RGB, 0..1). */
export type LampPhase = 'closed' | 'opening' | 'open' | 'closing';
export const LAMP_RGB: Readonly<Record<LampPhase, readonly [number, number, number]>> = {
  closed: [1, 0.06, 0.03],
  opening: [0.12, 1, 0.28],
  open: [0.12, 1, 0.28],
  closing: [1, 0.5, 0.04],
};
