# Soldier visual damage trace

## Scope and current shipped paths

This is a read-only trace of the default **forward** game renderer. No GPU work was run here. The parent-owned QA session is on Vite/CDP `5274/9274`, with baseline `/tmp/soldier-reactions-qa/before.png`.

The forward game now resolves skeleton mode to `mesh` by default in both dev and production (`skeleton-spike/selector.ts:1-11`). `?skeleton=procedural` restores the SDF reference; `?skeleton=volume` is dev-only; deferred always forces procedural. At actor spawn, every character, including Soldier, gets contract sources and `view.setPackBones(false)` (`game-main.ts:1113-1125, 1142-1150, 1660-1668`). Thus Soldier bones are already extracted meshes; there is no current `bindSkeletonMesh` Zombie-only gate. The Zombie-only gate applies to the *head sculpt and eye behavior*, not mesh skeleton binding.

Both actors use the same wound ring, SDF carve, flesh material ramp, bleed, and depth-composition exposure mechanism (`game-actor.ts`, `character-view.ts`, `mesh-renderer.ts:12-22`). The body march carries wounded flesh without bone rows; skeleton meshes render in the polygon pass and become visible only where the flesh depth has been carved away. Bounded torso wound ownership remains a dev-only `?bounded-wounds` preview (`game-main.ts:206, 1637`), so it is not a safe dependency for the requested shipped look. Wound shadows are separately off by default and are irrelevant to this appearance change.

## Exact Soldier versus Zombie differences

### Bone source and skull shape

- Zombie authors a detailed `bones` block at ratio `0.38`, including a measured cranium, separate jaw, six rib pairs, spine, clavicles, and pelvis (`characters/zombie.blob:46-125` and following generated torso rows).
- Soldier has no authored `bones` block. Its skeleton is auto-derived from its flesh primitives. The resulting head field is intentionally described as "different, sparse" by `mesh-skull.ts:10`.
- `meshBoneSource()` applies the angular jaw, deep eye sockets, nasal aperture, and mouth slit only when `source.character === 'zombie' && source.segment === 'head'` (`mesh-skull.ts:12-46`). Soldier returns unchanged before any sculpting.
- The mesh material's generic `headFlag` is set for every character head (`mesh-renderer.ts:187-196`), so generic cavity/tooth/socket shading math can affect a Soldier head if its geometry intersects those normalized regions. However, the actual geometry that creates the strong angular Zombie read comes from `meshBoneSource`, and Soldier does not receive it.
- `syncEyes()` currently creates eye meshes for every head source (`mesh-renderer.ts:167-179`), but shot ejection is explicitly Zombie-only (`impact()` searches for a live head with `s.character === 'zombie'`, lines 217-238). The requested evil Soldier reveal should make an explicit decision about whether seated/ejected eyes belong to Soldier rather than inheriting this accidental half-state.

### Face and flesh

- Soldier uses its own baked `soldier-face.png`, measured mean, decal/replace projection, red-only eye glow, and lighter/drier palette (`character-registry.ts:201-207`, `characters/soldier.blob:224-258`, `game-main.ts:1555, 1573-1599`). Zombie uses the shared flat mask and Zombie material.
- These are flesh-surface settings. They disappear where the wound carve exposes the mesh skeleton; they do not provide a damaged-face layer or metal underlay.
- Existing wounds use the same circular/profile-based SDF carve for both actors. There is no Soldier-specific ragged rim, secondary tear, exposed-bone multiplier, or face reveal mask in the forward path.

### Armor shedding and sparks

- Only Soldier loads its kit as breakable (`character-view.ts:479-486` passes `entry.name === 'soldier'`). `KitOverlay.pose()` calls `createKitDamage.update()` every frame with the posed body and cumulative wound list (`character-view.ts:505-516`, `kit-overlay.ts:288-312`).
- `kit-damage.ts` splits each skinned mesh/material into disconnected triangle islands, labels an island armor only when `material.name === 'plate'`, maps its dominant skin bone to a limb, and releases it after nearby cumulative impact weight reaches 2 (limbs) or 3 (torso). A blast counts 3. Missing flesh anatomy also releases attached equipment (`kit-damage.ts:21-60, 74-145`). Released armor is baked at its current skinned world pose and gets simple gravity/spin/floor bounce.
- No armor hit or shedding spark effect exists. `character-effects.ts` contains only actor muzzle flashes. Repository `spark` hits are dynamite/fuse effects or material prose, not Soldier hit feedback.

### Coordinate correctness risk in current armor hit test

The release bake is pose-correct: it skins each island vertex and applies `source.matrixWorld` before spawning debris (`kit-damage.ts:91-123`). The *damage proximity test is not equivalently pose-correct*. `piece.centre` and radius are computed once from bind-space geometry. On update, the wound is evaluated in the posed body's world coordinates, then only the current pelvis X/Z is subtracted; it is compared directly with the bind-space center (`kit-damage.ts:125-142`). There is no inverse body yaw and no current bone transform. This can assign or miss armor damage when the Soldier is rotated or articulated. Any spark anchored to that test would visibly spark at the wrong plate.

## Minimal safe Soldier-specific seams

1. **Soldier skull source adapter:** extend `skeleton-spike/mesh-skull.ts` with a Soldier-only head adapter (or dispatch by character to separate helpers) and a distinct revision suffix. Keep it subtractive so every surviving point remains inside the authored auto-derived bone field. This is the smallest geometry seam for an angular evil skull. Add Soldier cases to `mesh-skull.test.ts`; preserve all Zombie assertions.

2. **Metal understructure:** add a per-vertex material-class/metal mask in `mesh-renderer.ts` for `source.character === 'soldier' && segment === 'head'`, ideally derived in a pure helper beside `mesh-appearance.ts`. A localized normalized-coordinate patch behind selected face zones can feed a steel color/high metal gloss while the rest remains wet bone. Do not make the whole shared head material metallic. Tests belong in `mesh-appearance.test.ts` (pure mask and color/gloss classification) plus a renderer wiring assertion if needed.

3. **Ragged, bloodier holes:** avoid changing shared wound SDF defaults globally. The narrow seam is Soldier-specific visual wounds before `WoundRing.refresh()` uploads them, or a character-specific wound-style channel in `character-view.ts`/`zombie-gpu.ts` consumed by `march.wgsl.ts`. Prefer deterministic secondary lobes/edge modulation keyed by wound identity rather than extra gameplay wounds, so injury thresholds and the other agent's Soldier damage/provenance work remain untouched. This likely requires `game-actor.ts` only if a character visual-wound mapper must be passed in; do not edit `soldier-damage.ts` or projectile provenance. Tests: `character-view.test.ts` or a focused Soldier wound-style test, `write-wounds.test.ts`, and `march-wound-list.test.ts`/`march.wgsl.test.ts` for the upload/shader contract.

4. **Armor sparks:** create a small reusable additive sprite/particle effect beside `character-effects.ts` and add it to the existing post-SDF effects scene. Trigger it from a *fresh hit event*, not the cumulative wound scan. The cleanest ownership seam is for `createKitDamage.update()` to expose newly impacted/released plate events with a current skinned world contact/center, then `CharacterView.pose()` emits once. Alternatively, route exact projectile hit point/provenance through an actor hit callback to the character view. The latter overlaps the other agent's hit/provenance work and should be coordinated by the parent. Tests: extend `kit-damage.test.ts` to assert one event per new impact/release and its world-space location; extend `character-effects.test.ts` for lifetime/additive material; add a game actor/view wiring test.

5. **Fix coordinates before relying on sparks:** compute current plate world bounds/center from skinned vertices (or retain a representative dominant-bone local center and transform it by the live bone world matrix). Compare the world wound point against that world center. The existing debris bake code is a correctness reference. Add yaw and articulated-arm cases to `kit-damage.test.ts`.

Likely implementation files are `skeleton-spike/mesh-skull.ts`, `skeleton-spike/mesh-appearance.ts`, `skeleton-spike/mesh-renderer.ts`, `character-view.ts`, `kit-damage.ts`, and `character-effects.ts`, with corresponding focused tests. A Soldier-specific wound shader style may additionally touch `zombie-gpu.ts` and `march.wgsl.ts`. `characters/soldier.blob` only needs editing if the chosen design authors a fuller Soldier skeleton instead of applying a conservative mesh-only sculpt.

## Existing browser QA and capture seams

- `__sdfGame.cast()` identifies actors as `kind: 'soldier' | 'zombie'` with IDs; `__sdfGame.zombie(id)` exposes posed/body/view state despite the generic historical name (`game-main.ts:4412-4429, 4524-4530`).
- `freeze(true)`, `setPose(x,z,yaw,pitch,y)`, `teleport(roomId)`, fixed `step(n)`, and light-clock controls support repeatable framing.
- `aimSurface(limb, actorId)` can target a specific Soldier limb; `predictSlugHit()`, `fire()`/`fireSlug()`, `debugWounds(id)`, `placeMarker()`, and `refreshHull()` support pre-shot prediction and post-shot crater proof (`game-main.ts:4540+, 4593+, 4729+, 5025+, 6489+`).
- `hitMeshSkull(id)` is a deterministic direct head-slug fixture, but today its eye ejection succeeds only for Zombie because of the renderer gate. It still stamps the Soldier wound through `actor.hitSlug`, so it is useful for Soldier skull reveal after the sculpt is added (`game-main.ts:5202-5217`).
- `skeletonDiagnostics()`, `skeletonMesh()`, and `meshEyeState(id)` prove the active mesh path and exposed/ejected-eye state (`game-main.ts:5219-5238`).
- `scripts/skeleton-compare.mjs`, `scripts/sdf-game-skeleton-capture.mjs`, and `scripts/bone-tubes-reel.sh` are the existing game skeleton capture patterns. `scripts/verify-soldier-wound.mjs` is a real WebGPU Soldier wound regression and lab capture pattern, while `scripts/verify-mixed-soldiers.mjs` covers a mixed game cast. For this task, reuse the parent's already-running CDP/Vite pair rather than starting another GPU process.

Recommended evidence set after implementation: same frozen Soldier before/after a plate hit, head wound revealing the new skull/metal, repeated torso or shoulder hits showing one-shot sparks and a shed plate, a Zombie control frame proving its accepted skull is unchanged, `skeletonDiagnostics()` showing mesh active, and `debugWounds()` proving each visible crater corresponds to the intended shot.

## Task 3 follow-up: make the Soldier skull actually expose

The current Soldier cannot get the requested reveal from a mesh-only sculpt. A CPU inspection of the built body shows why:

- Soldier's face cranium is an ellipsoid centered near `(0, 1.7987, -0.0028)` with semi-axes about `(0.0882, 0.1035, 0.0945)` metres.
- Its face jaw is centered near `(0, 1.7267, 0.0416)` with semi-axes about `(0.0573, 0.0632, 0.0708)` metres.
- Auto-derivation deliberately removes flesh scaling. It emits only a **34.2 mm sphere** for the cranium and a **26.7 mm sphere** for the jaw (`bone-derive.ts:42-99`). The hair/crown primitives are rejected by the structural-mass/containment filters. This is the sparse field called out by `mesh-skull.ts`.

`meshBoneSource()` is subtractive by contract: the adapted distance must always be greater than or equal to the original field. It can cut angular sockets and planes into those spheres, but cannot expand a 34 mm ball into a face-sized skull. Doing only that would preserve the current "small marble" problem and likely remain invisible through an ordinary face wound.

The existing `hitMeshSkull()` fixture compounds this. It chooses `z = head.bounds.max[2]`, the front of the **bone source**, and sends that point to `actor.hitSlug()` (`game-main.ts:5202-5217`). For Soldier this is approximately `z = 0.068`, while the front cranium flesh at the same band is around `z = 0.092`: the helper starts roughly **24 mm inside the flesh**, not on its surface. `worldHitToWound()` expects a surface hit and computes its depth-slab cap by probing flesh inward from that anchor (`damage.ts:293-347`). This helper therefore cannot be used as visual proof until it targets the flesh surface.

### Safest concrete Task 3 plan

1. **Author Soldier skull bones in `characters/soldier.blob`.** Add a `bones` block with `ratio 0.38` plus explicit `head on skull` cranium and jaw primitives. Authored rows replace auto-derived rows for the concrete `skull` bone while leaving limb bones auto-derived (`build-body.ts:84-100`). Start from the Soldier's own face dimensions rather than copying Zombie numbers: a broad cranium around 75–80 mm half-width, 88–94 mm half-height, and 82–88 mm half-depth; a separate jaw around 48–52 mm half-width, 42–48 mm half-height, and 52–58 mm half-depth. Preserve at least the existing 3 mm containment margin everywhere; final values must come from `boneBreach`/surface sampling, not these suggested starting ranges.

2. **Then apply a Soldier-only subtractive sculpt in `mesh-skull.ts`.** With a face-sized contained source, cut the sloped brow, angular sockets, narrow nasal gap, cheek cuts, flat mandibular plane, and metal-reveal recess. Give it a distinct revision such as `soldier-skull-sculpt-1`. Keep the Zombie adapter byte-for-byte behaviorally unchanged. This produces an evil angular silhouette while preserving the hard invariant that no skeleton vertex breaches intact flesh.

3. **Fix the deterministic fixture to resolve a real flesh surface.** Keep the desired local X/Y staging from the head source, but trace from outside along local `-Z` against the actor's posed flesh field and stamp at the first surface crossing. Pass that same world point to `segMeshRenderer.impact()` and `actor.hitSlug()`. A simpler existing alternative for capture is `aimSurface('head', soldierId)` plus `predictSlugHit()` and `fireSlug()`, but Task 3 should make `hitMeshSkull()` honest because it is the direct regression seam.

4. **Do not deepen all gameplay head wounds globally.** The stock slug radius is already 130 mm, while its depth slab intentionally limits penetration to 45% of measured flesh thickness to prevent far-side holes (`damage.ts:20-29, 207, 329-345`). Once the skull fills the head, a correctly surface-anchored slug should reach it. If a measured surface hit still stops short, add a Soldier/head-only visual cap policy at wound upload, with a containment/far-side test; do not change `WOUND_CARVE_DEPTH_FRAC` globally.

### Required focused tests

- Add a Soldier character test parallel to `zombie-blob.test.ts:52-77`: at least two authored head bones; cranium is not a marble; jaw is distinct; built body reports no containment error.
- Update `mesh-skull.test.ts`: Soldier now receives a new adapted source; every sampled adapted distance remains `>=` its authored source; extracted vertices remain at least 3 mm inside Soldier flesh; angular feature probes move inward by meaningful amounts.
- Add a `hitMeshSkull` math/helper unit test, preferably by extracting the local front-surface resolver: returned point is near `sdBody == 0`, outside-before and inside-after along the shot ray. The browser gate should assert `debugWounds(id)` records that surface point and capture visible exposed skull.
- Preserve the Zombie sculpt tests and capture one Zombie control frame.

This order is load-bearing: fuller authored contained bones first, sculpt second, honest surface-hit fixture third. Changing wound depth first would mask the undersized skeleton and risk see-through wounds across every actor.

## Task 3 implementation-ready TDD sequence

### 1. Authored Soldier anatomy

Write failing structure/containment tests before changing `soldier.blob`:

- New `characters/soldier-blob.test.ts` should build the real Soldier and assert two or more `head` bone prims, cranium effective half-width above 70 mm, a smaller/lower/forward jaw, and no build errors.
- Assert torso anatomy is not the current three auto-derived central plugs: at least three left/right rib levels, a sternum, and a rear spine path; require bilateral X reach and forbid any single wide torso slab. Use intent assertions like `zombie-blob.test.ts`, not exact snapshots.
- Sample every authored Soldier bone with the existing containment machinery and require `boneBreach(...) === null`. Keep the extracted-mesh 3 mm inside-flesh test in `mesh-skull.test.ts` as the stricter render-path gate.

Then add a `bones` block to `soldier.blob` with `ratio 0.38`. Author the cranium and jaw on `skull`, which suppresses only auto-derived skull rows. Author a modest cage on the torso carriers: three rib levels built as back-half and front-half bars per side, a sternum, and a rear spine line. Use the Zombie two-bar hoop idiom but fit it to Soldier chest measurements. Avoid copying the full Zombie cage or pelvis: the visual target is useful bone exposure under armor holes, with a restrained primitive count. Because authored rows suppress derivation per concrete bone name, confirm that authoring `chest`/`spine1` does not accidentally remove a needed plug without replacing its coverage.

RED commands:

```sh
npx vitest run src/lab/sdf-zombie/characters/soldier-blob.test.ts
npx vitest run src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-skull.test.ts
```

### 2. Soldier skull sculpt and localized steel

First extend `mesh-skull.test.ts` so Soldier must receive a revision-changing adapter, remain subtractive at every sample, retain the 3 mm flesh clearance after extraction, and show measurable recesses at brow/socket/nose/mouth probes. Then implement a Soldier branch in `mesh-skull.ts`; leave the Zombie branch and revision unchanged.

The mesh renderer uses one shared material and one uniform set seeded from `actors[0]` (`game-main.ts:1728-1755`), so a per-actor steel uniform would be incorrect. Reuse the existing cached geometry attribute. Encode `meshFeature.w` as `0 = non-head`, `1 = ordinary/Zombie head`, `2 = Soldier head`; inside all existing appearance functions normalize this to `headFlag = min(feature.w, 1)` and derive `soldierHead = step(1.5, feature.w)`. This adds no renderer pass, texture, or global uniform. Add CPU/WGSL pure helpers for a small asymmetric steel reinforcement mask behind one temple/cheek and part of the brow. Mix a dark gunmetal color into the existing `boneColor` result only within that mask and raise gloss locally; keep sockets matte and keep most of the skull bone/tissue colored.

Tests in `mesh-appearance.test.ts` should prove: Zombie inputs are unchanged at `w=1`; Soldier steel is localized and front/head-only; non-head segments never become steel; steel gloss exceeds dry bone but remains below a mirror-like full value; cavity darkness still wins over steel.

### 3. Soldier-only ragged visual wounds using existing rows

There is no safe spare global wound uniform (`woundCfg`, `woundCfg2`, `surfCfg`, and `lodCfg` channels are already consumed), and `applyWoundRamp()` deliberately reapplies panel tissue settings to every actor. Avoid a new shader channel and preserve panel overrides.

Implement a pure `soldierVisualWounds()` mapper near `character-view.ts` or in a small `soldier-wounds.ts`. For each real Soldier projectile wound, return the original row plus one deterministic, smaller tangential tear lobe using the same primitive-local frame, cap normal/depth, type, age, and ownership. Mark the synthetic lobe `injuryIgnored: true`; never insert it into the gameplay wound ring, Soldier injury ledger, sever checks, bleed registry, or projectile provenance. Feed this visual list only to `WoundRing.refresh()` and `segMeshRenderer.setWounds()`. Bound it to the existing 16-row render limit by preserving newest original wounds first, then filling remaining slots with lobes; a cosmetic lobe must never evict its owning real crater. Use existing `rimSplayScale`/`rimOffsetScale` on the lobe for torn lips and the current Soldier palette's `deepColor`/`charColor` for blood, so wound-panel tissue thresholds remain authoritative.

Pure tests should assert determinism, Soldier-only expansion, no mutation, same owner/prim and cap transport, bounded row count, original-row priority, and no extra gameplay injury when the mapped list is displayed. Extend `write-wounds.test.ts` only if the mapper changes upload ordering; no shader-default assertion should change.

### 4. Honest skull-hit fixture

Extract a CPU helper used by `hitMeshSkull()` that takes the posed body/head source, starts outside the local front, and finds the first flesh surface along local `-Z` using `traceProjectile` or a small bracket/bisection. RED test: returned point has `abs(sdBody(point, posed))` within hit tolerance, a preceding sample is outside, and a following sample is inside for both Zombie and Soldier. Then pass exactly that point to mesh impact and actor damage.

### 5. World-space armor hit events and bounded sparks

Refactor `kit-damage.ts` behind tests before adding visuals:

- Replace bind-space `piece.centre` proximity with current skinned world-space piece bounds or a current dominant-bone transformed center/radius. Do this **only when processing newly seen wounds**, never for every plate on every frame. Prefer a helper that skins the candidate island's unique vertices on that fresh-hit path, since `bake()` already proves the transform; cache its world sphere for all comparisons in that update. A dominant-bone center is cheaper still, but use it only for islands proven rigidly weighted in tests.
- Track processed wound identity/reference per damage view so cumulative wound arrays emit an impact only once. `update()` should return events such as `{ kind: 'armor-hit' | 'armor-shed', point, normal?, limb }`; reset clears processed state. A shed event uses the freshly baked piece world center, while a hit event uses the actual wound world point after confirming it overlaps the current plate.
- Add translated, yawed, and articulated-arm tests proving the intended plate is hit in world space and the opposite plate is not. Retain existing detach/rest/reset tests.

Add `createArmorSparks()` beside `createMuzzleFlash()` in `character-effects.ts`, using a fixed-size pool rather than allocating per hit. A small pool (for example 32 streak meshes/sprites) with a hard cap per event is sufficient. Use additive blending, depth test on, depth write off, deterministic seeded directions, a 100–180 ms lifetime, and explicit `reset()`/`dispose()` that hides/removes objects and disposes shared geometry/material once. The Soldier character view owns the instance and adds it to the existing post-SDF `effectsScene`; it consumes `kit.pose()` events once per frame. No Soldier kit means no spark system.

Tests in `character-effects.test.ts` should assert pool bounds after many events, additive/depth flags, expiry, reuse, reset, removal, and disposal. A character-view or kit integration test should prove one armor wound creates sparks, a repeated cumulative update does not, flesh-only hits do not spark, and shedding can emit a larger burst without exceeding the pool.

### 6. Focused verification before visual QA

Run in this order so failures identify the layer:

```sh
npx vitest run src/lab/sdf-zombie/characters/soldier-blob.test.ts src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-skull.test.ts src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-appearance.test.ts
npx vitest run src/lab/sdf-zombie/webgpu/kit-damage.test.ts src/lab/sdf-zombie/webgpu/character-effects.test.ts src/lab/sdf-zombie/webgpu/character-view.test.ts src/lab/sdf-zombie/webgpu/write-wounds.test.ts
npx tsc --noEmit
npm run build
```

Only after these pass, use the parent-owned WebGPU session for controlled Soldier head, torso/plate, and arm shots, followed by a Zombie control. Required visual evidence remains: intact silhouette unchanged; skull/bone visible through an honest surface wound; localized metal readable without chrome takeover; ragged lobes bloodier without far-side perforation; sparks originate on the struck moving plate and disappear promptly; no browser errors or unbounded effect children.
