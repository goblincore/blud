// src/lab/sdf-zombie/webgpu/earlyz/seed-gate.ts
//
// WHEN MAY THE LEVEL-DEPTH SEED DRAW? (spec 2026-10-01 D6.) A pure decision, plain data in and a
// reason string (or null = draw) out; sdf-layer.ts only fills the input from its own state and
// shows/hides the quad accordingly. No `three` import.
//
// The refusals, in the order they are checked (the first one that applies is the reason):
//   1. not requested            setEarlyzSeed was never called (flag off).
//   2. no level depth           the post-aa capture target (and its sampleable depth) does not exist.
//   3. field style              the interleaved / woven field march writes a different target layout.
//   4. block wider than 4 px    the seed's 4x4 block cap is exact only when seedScaleSupported holds
//                               for (level depth size, march size); a truncated block is NOT
//                               conservative, so bodies could vanish.
//   5. march MRT boot           more than one march attachment: the seed material writes no colour
//                               and the MRT layout is not its business.
//   6. temporal accumulation    the march is sub-pixel jittered, the seed is not.
//   7. capture jitter           same, for the training-capture jitter.
//   8. per-body depth gates     the front-to-back per-body branch clears and re-renders per body.
import { seedScaleSupported } from './seed-depth.wgsl';

export interface SeedGateInput {
  /** `setEarlyzSeed` has a scene. */
  requested: boolean;
  /** The output (post-aa capture) target has a sampleable depth texture. */
  levelDepth: boolean;
  fieldStyle: string;
  /** Level depth texture size in pixels. Only read once `levelDepth` is true. */
  levelSize: [number, number];
  /** March target size in whole pixels (the seed's block maths truncates). */
  marchSize: [number, number];
  /** Colour attachments of the march target. */
  marchAttachments: number;
  accumOn: boolean;
  captureJitter: boolean;
  /** The per-body front-to-back depth-gate branch will run this frame. */
  perBodyGate: boolean;
}

/** Memo of everything that costs a loop or a string: the scale test per (level, march) size and the
 *  field-style reason per style. The first call always misses (NaN never equals a size). */
interface GateMemo {
  lw: number; lh: number; mw: number; mh: number;
  /** null = the scale is supported; otherwise the refusal. */
  scale: string | null;
  fieldStyle: string;
  fieldReason: string;
}

const freshMemo = (): GateMemo => ({ lw: NaN, lh: NaN, mw: NaN, mh: NaN, scale: null, fieldStyle: '', fieldReason: '' });

function reasonWith(s: SeedGateInput, memo: GateMemo): string | null {
  if (!s.requested) return 'not requested';
  if (!s.levelDepth) return 'no sampleable level depth (post-aa capture off)';
  if (s.fieldStyle !== 'off') {
    if (s.fieldStyle !== memo.fieldStyle) {
      memo.fieldStyle = s.fieldStyle;
      memo.fieldReason = `field style '${s.fieldStyle}'`;
    }
    return memo.fieldReason;
  }
  const lw = s.levelSize[0], lh = s.levelSize[1], mw = s.marchSize[0], mh = s.marchSize[1];
  if (lw !== memo.lw || lh !== memo.lh || mw !== memo.mw || mh !== memo.mh) {
    memo.lw = lw; memo.lh = lh; memo.mw = mw; memo.mh = mh;
    memo.scale = seedScaleSupported([lw, lh], [mw, mh])
      ? null
      : `march ${mw}x${mh} over ${lw}x${lh}: seed block wider than 4 px`;
  }
  if (memo.scale !== null) return memo.scale;
  if (s.marchAttachments !== 1) return 'march MRT boot';
  if (s.accumOn) return 'temporal accumulation (jittered march)';
  if (s.captureJitter) return 'capture jitter';
  if (s.perBodyGate) return 'per-body depth-gate passes';
  return null;
}

/** null = the seed may draw this frame; otherwise why it may not. Stateless: runs the O(march size)
 *  scale test on every call, so a per-frame caller uses `createSeedGate` instead. */
export function seedBlockReasonFor(s: SeedGateInput): string | null {
  return reasonWith(s, freshMemo());
}

/** The same decision for a per-frame caller: the scale test and the reason strings are rebuilt only
 *  when the sizes (or the field style) actually change, so a steady frame allocates nothing. */
export function createSeedGate(): { reason(s: SeedGateInput): string | null } {
  const memo = freshMemo();
  return { reason: (s) => reasonWith(s, memo) };
}
