# Blud — Bones as instanced tubes — Design

**Date:** 2026-09-02 · **Status:** design approved, plan pending
**Type:** gore/perf — takes the skeleton out of the marched field
**Builds on:** [hull-refine notes, revival path 3](../../dev-notes/2026-09-02-hull-refine-spike/notes.md) ·
[gore r3 refinements](../../dev-notes/2026-09-02-gore-r3-refinements.md) (items 2, 3, 5) ·
[organs note, boneEvals](../../dev-notes/2026-09-02-organs-guts/notes.md)

---

## 1. Why

The authored skeleton (cranium, jaw, six rib pairs, sternum, spine, pelvis ≈ 17
bones on the zombie) plus 8 organ prims live in an "inside the flesh" array that
`mapBody` folds with a hard `min` on every field evaluation inside a wound's 2×
zone — per march step, ×4 for `calcNormal`, plus the AO/scatter probes. Measured
(`scripts/sdf-game-organs-boneevals.mjs`, 12 slug wounds): **1.1–1.8 M capsule
evaluations per frame, 240–340 per wound-zone ray**; a wounded torso pixel evaluates
~2.4× the zombie's flesh. Gore r3 item 2 proposed culling that fold.

Bone is only ever visible inside a cavity, and containment (`checkBoneContainment`,
4 mm margin) guarantees it sits behind a flesh surface from every view. That makes
bone a natural for the ordinary depth test: draw it as geometry, let the march's
depth hide it where flesh is nearer and reveal it where a crater's far wall is
farther. The fold is then deleted, not culled.

## 2. Decisions

| Question | Decision |
| --- | --- |
| Scope | **Bones out of the field; organs stay in it.** Organs keep field shading, the tissue ramp and the smooth cavity look; the wound-zone fold drops from ~25 prims to 8. Organs-as-tubes is a possible follow-up after the look gate. |
| Representation | **Instanced analytic tubes posed per frame from the posed bone prims.** Not a hull extracted once: bone prims are NOT rigid today — each endpoint binds to its own verlet joint (`rig-bind.ts` boneBinding), ribs shear with the rig, only skull spheres carry a rigid quat — so a rigid mesh would detach from the field. Tubes need no extraction and no rigidity. |
| Not chosen | Per-wound fold cull (gore r3 item 2 as written): trims the cost structure the tubes remove entirely, and `calcNormal` would still pay four folds. |
| Visibility | The existing march→composite depth test. No mask, no wound gate, no new pass. |
| Gate | Look first (owner reel), cost by the bone-eval COUNTER (not frame time). |

## 3. Architecture and data flow

```
.blob bones block / bone-derive ──► BuildResult.bonePrims (unchanged)
        │  applyRig (unchanged: endpoints follow their joints; skull rigid)
        ▼
posed bone prims ──┬──► packBody: SKIPPED (organs only; counts2.x = organCount)
                   │
                   └──► BoneInstancer.update(list) ──► per-instance buffer
                                                        │
                        chunk views: posed chunk bones ─┘  (one list per frame)
                                                        ▼
                        one instanced draw of a unit tube, polygonal scene pass,
                        default layer, depth write ON
                                                        ▼
                        SDF composite depth-tests the march hit depth against it:
                        flesh nearer → bone painted over; cavity far wall farther → bone shows
```

Nothing upstream of the pack changes: authoring, derivation, containment, sever
filtering by cluster, chunk carry.

## 4. The tube

**Mesh.** One shared unit tube: 24 rings × 12 segments plus hemispherical caps;
each vertex carries `(t, theta)`. Built once.

**Per-instance attributes** (read straight from the posed `Primitive`): `a`, `b`,
bend control point `c` (from `bend`, as `bendCtrl` in `vec.ts`), `r1 = radius`,
`r2 = radiusB ?? radius`, `scale` (xyz), material code. A skull sphere is `a == b`.

**Vertex shader.** In the field's scaled space (`p * inv`, the same convention as
`sdPrim`): evaluate the quadratic curve through `a·inv, c·inv, b·inv` at `t`; build
the frame perpendicular to the tangent (parallel-transported along `t` so the ring
does not twist); place the vertex at `r(t) = mix(r1, r2, t)` along
`cos(theta)·u + sin(theta)·v`; caps use the same frame at `t = 0/1` over the
hemisphere; multiply by `scale` back to world. Normal = the offset direction,
corrected by `1/scale` and renormalised. This is the swept surface the field's
`coneBend`/`coneCap` produce; the CPU test in §8 pins the agreement.

**Fragment shader.** Its own small NodeMaterial: `boneColor`, Lambert key light
(`lightDir`, `keyColor`, `lightCfg.x`) and the flashlight cone (`spotPos`,
`spotAxis`, `spotCfg`, `spotColor`, `spotCfg2.x`) from the SAME uniform values the
march uses, a dulled specular, no wetness. The march's tissue-depth bone stain at
the cavity rim is dropped.

## 5. Visibility and render slot

- **Draw in pass 1** of `sdf-layer.ts` (the polygonal scene pass into
  `outputTarget`), default layer, `depthWrite: true`. `setOutputTarget` already
  requires a depth buffer there.
- The composite quad (`sdf-layer.ts` `quadMat.depthNode = sampled.w`) depth-tests the
  march's hit depth per pixel: bone loses under intact flesh, wins inside a cavity
  whose near hit is the far wall.
- **Soundness rests on containment.** Derived bones are filtered at 4 mm; authored
  bones are only *reported*. This design promotes an authored-bone breach to a
  build ERROR on characters with a `bones` block (zombie, goblin), because the wound
  gate no longer hides it.
- **Half-rate**: the composite's hold-frame depth is recomputed for the current
  camera and the tubes are redrawn every frame in pass 1, so they stay consistent.
- **Edge quantisation**: the flesh-to-bone edge inside a cavity is quantised to
  SDF-layer texels, exactly like the flesh-to-floor edge today.

## 6. Field and pack changes

- `packBody` skips `op === 'bone'`; organs still pack as `W_ORGAN`; `counts2.x` =
  organ count. Behind a flag (`packBones`, default false) so the kill switch can
  restore the shipped layout byte for byte.
- `march.wgsl.ts`: `applyBones` and its gate stay as the ORGAN loop (rename in
  comments only). The `isBone` shading branch (`hitMat` 4) becomes dead and is
  removed; wetness keeps only the organ select. `gDebugBones` now counts organ
  evaluations — the debug view and `__sdfGame.boneEvals()` keep their names, the
  notes say what they count.
- Cavity rays now march to the far wall instead of stopping on bone: a few extra
  wound-zone steps, visible in the step heatmap, expected ≪ the fold saving.

## 7. Chunks, stumps, pages

- **Chunks**: `createChunkGpuView` already applies the chunk transform + squash to its
  bone rows per frame; that posed list goes to the instancer instead of the chunk's
  field. Sub-limb fragments stay bone-free (unchanged).
- **Stumps**: unchanged — dead-cluster bones are dropped by the same filter the pack
  uses.
- **One instancer per page**, created beside the SDF layer, mesh on the default
  layer. Each frame after actors and chunks update, the page collects posed bone
  lists (body actors + live chunks) and calls `instancer.update(list)` once.
- **Game**: `__sdfGame.setBoneMesh(on)` — off re-enables `packBones` and hides the
  instancer. Default ON once the gate passes; ships OFF until then.
- **Lab**: same wiring behind the existing bone toggle so the reel harness can A/B
  field bones against tube bones on a frozen scene.

## 8. Gates and testing

**Look gate (owner).** Three parity-harness captures, field bones vs tube bones on
the same frozen scene: (1) slug crater on the torso (ribs, sternum), (2) head shot
(cranium, jaw), (3) severed arm chunk on the floor. Pass = indistinguishable at play
distance. **Any bone visible through intact skin fails.**

**Cost gate (counted).** `__sdfGame.boneEvals()` on the organs note's 12-slug recipe:
bone evaluations 0 (organs still counting, ~1/3 of the old total). Frame-time bench
reported alongside, not gated.

**Tests.**
- Pack: bones absent from packed rows and organs present when `packBones` is off;
  `counts2.x` = organ count; `packBones` on reproduces today's rows byte for byte.
- Instancer: a posed bone list → the expected instance records; dead clusters
  filtered; chunk bones included; capacity overflow flagged, never silent.
- Tube geometry (CPU mirror of the vertex shader): sampled tube vertices for a
  straight bone, a bent rib and a skull sphere evaluate to |sdPrimitive| < 1 mm
  against the shipped CPU prim field (`validate.ts`), including a scaled prim.
- Containment: an authored bone breaching its flesh is a build error on the zombie
  and goblin fixtures.
- WGSL parse contract for the new sources (fn-anchored, no colon-in-comment).

## 9. Risks

- **Shading mismatch** between tube bone and the march's old bone hit — only visible
  inside cavities; the look gate decides.
- **Authored bones that breach** on characters without a bones block are impossible
  (derived bones are filtered); on zombie/goblin the new build error catches them.
- **Organ-only fold** keeps the gate machinery alive for 8 prims; if organs later
  move to tubes the whole inside-flesh path can go.
