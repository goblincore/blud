// src/lab/sdf-zombie/webgpu/march/body/trace.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `trace`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { HELPERS, MARCH_BODY, CONE_MARCH } from '../../march.wgsl';
import { declaredName } from '../../march-test-support';

describe('ported features reach the entry point', () => {

  it('shell-displaces the real field only inside a thin shell (gobs-and-goo task 4)', () => {
    // The middle path between fbm at every step (too expensive) and
    // normal-warping only (loses the outline): the march runs the SMOOTH
    // field relaxed until |d| enters the shell, then the silhouette fbm
    // displaces the stepped distance itself. Same 3.0 scale as mapBody's
    // noise term, so calcNormal's warped normals match the displaced skin.
    expect(MARCH_BODY).toContain('let dres = mapBody(');
    expect(MARCH_BODY).toContain('var d = dres.x;');
    expect(MARCH_BODY).toContain('let shellAmp = woundCfg2.z;');
    // Restored to the shellAmp-only form in the 2026-09-04 merge: the melt
    // spike that had widened this band to max(shellAmp, meltAmp) is gone,
    // superseded by the shipped zombie melt, which sags the body through the
    // rig rather than by displacing the marched field here.
    expect(MARCH_BODY).toMatch(/abs\(d\) < shellAmp \* 4\.0/);
    // The shell's fbm samples the dominant prim's REST frame (task 6) — the
    // displaced silhouette rides the same flesh as the normal-warped skin.
    expect(MARCH_BODY)
      .toMatch(/d = d \+ fbm\(restPoint\(camPos \+ rd \* t, data, i32\(dres\.y\), noiseLocal\(camPos \+ rd \* t, noiseShift\), gBand\) \* 3\.0\) \* shellAmp;/);
  });

  it('anchors every noise site in REST space, so texture rides every limb (task 6)', () => {
    // The field is packed in world space, but the fbm — silhouette, shell,
    // micro surface detail, gore mottle — must sample the DOMINANT prim's
    // REST frame or a limb slides through the world-frame noise field as it
    // moves (owner playtest: "you can see the arms move but the texture
    // doesn't"). mapBody tracks the argmin prim in its fold and every noise
    // site maps through restPoint; the task-3 root-shift anchor (noiseLocal)
    // survives ONLY as the fallback for bodies without rest rows.
    expect(MARCH_BODY).toContain('let noiseShift = vec3<f32>(gInstNoiseShift.x, gInstYaw, gInstNoiseShift.z);');
    // (hard-surface task 1: the noiseAmp argument now carries the gloss
    // kill, `* (1.0 - max(gloss, metal))` — a polished or machined prim's
    // normal is not rippled. Pinned in detail by the dedicated
    // gloss-suppression describe below. The amp is a vec4 and only .x
    // carries anything: y/z/w were the parked melt spike's lanes and are
    // literal zeros since the 2026-09-04 merge removed it. The gloss/metal
    // kill this pins is unchanged.)
    expect(MARCH_BODY).toContain('calcNormal(p, data, vec4<f32>(marchCfg.z * (1.0 - max(gloss, metal)), 0.0, 0.0, 0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg)');
    expect(MARCH_BODY).toContain('let anchor = restPoint(p, data, hitBest, noiseLocal(p, noiseShift), gBand);');
    expect(MARCH_BODY).toContain('fbm(anchor * 22.0)');
    expect(MARCH_BODY).not.toContain('fbm(p * 22.0)');
    const mapBody = HELPERS.find(h => declaredName(h) === 'mapBody')!;
    // Argmin tripwire: ONE sd evaluation feeds both the fold and the tracker.
    // Same invariant, now carrying the taper radius AND the profile+bend
    // encoding: ONE sd evaluation still feeds both. `r2` is -1 for every
    // untapered prim (plain-capsule branch inside coneCap); `cpos` is zero
    // unless prof > 1.5, which is the Bezier branch inside sdPrim.
    const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    expect(foldGroup).toContain('var sd: f32;');
    expect(foldGroup).toContain('if (ori) { sd = sdPrimO(p, idx, data, r2, prof, cpos, band); }\n    else { sd = sdPrim(p, idx, data, r2, prof, cpos, band); }');
    expect(foldGroup).toContain('if (sd < gFoldBest) { gFoldBest = sd; gFoldBestIdx = f32(idx); gFoldBestDistort = grp.z; }');
    // Mask, not the old magnitude window — a chamfered BOX is prof 9 and falls
    // outside it. See the box-bit block below and pack.ts.
    expect(foldGroup).toContain('if ((i32(prof) & 7) == 1) { d = sminChamfer(d, sd, k); } else { d = smin(d, sd, k); }');
    // i32(bestIdx), not bestIdx: this branch reads gFoldBestIdx (an f32) AFTER
    // the bone fold so a bone prim can win the argmin, so the cast is needed
    // here where main's version had already narrowed it.
    expect(mapBody).toContain('let anchor = restPoint(p, data, i32(bestIdx), noiseLocal(p, noiseShift), band);');
    expect(mapBody).toContain('fbm(anchor * 3.0) * noiseCfg.x');
    // The cone pre-pass marches the SMOOTH field (amplitude 0) and stays
    // independent of the motion plumbing — zero shift, dead noise term (the
    // whole vec4, so the melt experiment's term is dead in the cone too). The
    // volume block still rides along: the cone must see the same field the
    // march does (X1.26).
    const coneMarch = CONE_MARCH;
    expect(coneMarch).toContain(
      'mapBody(camPos + rd * t, data, vec4<f32>(0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg).x');
  });

  it('steps the shell conservatively and never retracts a displaced sample', () => {
    // The fbm breaks the Lipschitz bound, so inside the shell a relaxed step
    // could tunnel — 0.6 under-relaxation pays for the noise instead. And the
    // overshoot retraction assumes the un-displaced field (it rewinds by the
    // omega excess), so it must be suppressed whenever d carries the shell.
    // The wound zone has its OWN, stricter multiplier (WOUND_STEP_MUL, since
    // 2026-09-04) and the two are combined with min, so the shell's figure is
    // still the shell's — see march-step-soundness.test.ts for why they split.
    expect(MARCH_BODY).toContain('select(omega, 0.6, conservative)');
    expect(MARCH_BODY).toMatch(/let overshot = !conservative &&/);
  });

  it('retracts an unflagged deep crossing instead of hitting inside the solid (wound-halo r2)', () => {
    // A perpendicular approach onto near-flat skin makes radius + prevRadius
    // EQUAL stepLen exactly, so the strict < overshoot test cannot see the
    // crossing and the hit registers up to (omega-1)/omega of the last step
    // INSIDE the body. Behind the wound grid that landing zone sits in the
    // carve spheres' smax/smin blend, whose gradient contaminates the shading
    // normal — the torso's far side lit up as a red/pale band at wound height
    // (owner, 2026-08-24; instrumented: band hits at z -0.17 vs skin -0.266,
    // normals sideways/up, wm ~ 0 — the shading terms were amplifier, not
    // cause). Relaxed, non-shell, non-wound-zone samples that land deeper
    // than hitEps inside must retract onto the surface instead; only the
    // shell band keeps the old contract (its retraction assumes the smooth
    // field). The crossing sample usually sits inside the near-wound zone —
    // the landing is BEHIND the wound spheres — so nearWound is not a stop
    // signal; retracting to the wall is strictly more correct than shading a
    // point inside it.
    // The epsilon is now per-step (it can grow with the ray's pixel footprint
    // when AA is on), so the guard tests against the same expression the hit
    // does rather than a loop-invariant.
    expect(MARCH_BODY).toContain(
      'if (d < -max(hitEpsBase, t * aaK / distort) && omega > 1.0 && !conservative) {');
  });
});


describe('flat-albedo seam (close-up diagnostics task 1)', () => {
  // The seam is the instrument the 2026-09-04 close-up investigation needs:
  // a gate that returns the base albedo at the hit and skips the whole
  // post-hit chain, so frame(A) - frame(flat) is the shading share of the
  // close-up frame. Its ENTIRE value depends on being inert when off — a
  // seam that perturbs the walk measures nothing. These pins hold the
  // inertness contract from text, the same way the wgslFn parse pins do.

  it('gates on debugCfg.y and that channel appears EXACTLY once in the file', () => {
    // debugCfg.y was chosen because it was the one spare channel on a
    // uniform every march variant already binds. If a second use appears,
    // the seam is no longer independently toggleable and the legs share
    // state — the exact defect the melt-literal incident warns about.
    // (Comment text is stripped first so this comment itself cannot trip
    // the count — same rule as the wgslFn parser, comments included.)
    const code = MARCH_BODY.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect((code.match(/debugCfg\.y/g) ?? []).length).toBe(1);
    expect(CONE_MARCH).not.toContain('debugCfg'); // cone keeps its own contract
  });

  it('sits between the hit-discard and calcNormal, so off == bit-identical', () => {
    const hit = MARCH_BODY.indexOf('if (!hit) { discard; }');
    const seam = MARCH_BODY.indexOf('debugCfg.y > 0.5');
    const normals = MARCH_BODY.indexOf('calcNormal(p,');
    expect(hit).toBeGreaterThan(-1);
    expect(seam).toBeGreaterThan(hit);
    expect(normals).toBeGreaterThan(seam);
  });

  it('returns the base albedo with no field call in the guarded block', () => {
    // Slice from the guard to its return: the flat path must not evaluate
    // the field, or "flat" would measure walk + some shading, not walk.
    const seam = MARCH_BODY.indexOf('if (debugCfg.y > 0.5)');
    const block = MARCH_BODY.slice(seam, seam + 120);
    expect(block).toContain('return vec4<f32>(baseColor, t)');
    expect(block).not.toMatch(/mapBody|calcNormal|woundShadow|woundMask|fbm\(/);
  });

  it('leaves the post-hit chain below the seam intact', () => {
    // The seam is a skip, not a deletion: with it off, every post-hit stage
    // must still be present in the source (scatter probe, AO probe, wound
    // shadow, level shadow, ambient).
    const seam = MARCH_BODY.indexOf('debugCfg.y > 0.5');
    const rest = MARCH_BODY.slice(seam);
    expect(rest).toContain('woundShadow(p, L,');
    expect(rest).toContain('levelShadow(p, n,');
    expect(rest).toContain('ambientAt(p, n,');
    expect(rest).toContain('calcNormal(p,');
    // Scatter + AO probes share one call site since 2026-09-21 (cold compile).
    expect(rest).toContain('mapBody(select(p + n * 0.06, p + L * 0.06, k == 0)');
  });
});
