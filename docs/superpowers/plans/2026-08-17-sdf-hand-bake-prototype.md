# X1.26 Baked 3D-SDF Hand Prototype Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not dispatch or begin implementation until the owner explicitly approves execution.

**Goal:** Prove that one relaxed CC-BY hand baked into an anisotropic R16F 3D signed-distance texture reads as a proper first-person hand in the existing WebGPU hands view.

**Architecture:** Reuse the verified inverse-bind skinning in `pose_measure_hands.py`, preserve the dirty triangle soup, cap only a deliberate wrist cut, then combine libigl's exact unsigned closest-triangle distance with a fast-winding-number inside mask. Load one `Data3DTexture`; add a disabled-by-default volume branch to the shared marcher so wounds and flesh shading stay common; render only the right hand in a dedicated baked A/B mode and apply Verlet residue as a small distal domain warp.

**Tech Stack:** Blender 5.2 Python, PEP 723/uv, `libigl==2.6.2`, `numpy==2.5.2`, TypeScript, Three.js r185 WebGPU/TSL, WGSL, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-17-sdf-hand-bake-design.md`

**Execution target after approval:** Dispatch UI, `pi` harness, `GLM-5.3`, `xhigh`. The three serial dispatch tasks below are not queued yet.

---

## Global constraints

- Work only in `/Users/donny/Projects/blud/.claude/worktrees/gib-wound-bugs-b8c728` on `claude/gib-wound-bugs-b8c728`.
- Never copy the downloaded `.gltf`, `.bin`, nails, textures, or temporary meshes into the repository.
- Never open `free-fps-hands`; its licence is unknown. Use only the credited DavidFischer CC-BY-4.0 model.
- Reuse inverse-bind skinning. Blender's imported armature rest pose is known-bad.
- Do not globally fill holes, voxel-remesh, or require watertight input.
- Do not add another pose, a left volume, props, pose blending, or WebGL work.
- Primitive mode stays the default and remains behaviorally unchanged.
- Gate the static/unwarped hand before enabling warp.
- Reject browser benchmark results when `hiddenSteps > 0`.
- Run each dispatch task's verification and commit only that task before the next task starts.

## Dispatch chain

| Task | Scope | Depends on | Stop condition |
|---|---|---|---|
| A | posed-mesh export, winding-number baker, checked-in R16F asset | none | asset validates and mesh preview retains finger gaps |
| B | volume loader, shared WGSL field branch, volume-capable hands view | A | tests/build green; primitive path unchanged |
| C | lab A/B wiring, domain warp, captures, benchmark, notes | B | four captures ready for owner judgment |

---

## Dispatch task A — bake a trustworthy hand volume

### Task A1: Make pose helpers import-safe

**Files:**
- Modify: `scripts/pose_measure_hands.py:1577`
- Create: `scripts/test_bake_hand_sdf.py`

- [ ] Write a failing import regression that executes the module with a fake `__name__` and asserts `Gltf`, `Hand`, `add_rot`, and `flex_sign` become available without calling `main()` or `write_manifest()`.
- [ ] Change the current plain-Python early-exit block from `if not IN_BLENDER` to `if not IN_BLENDER and __name__ == "__main__"`; this preserves the documented manifest command while allowing imports in tests and in the outer baker.
- [ ] Replace the unconditional final call with:

```python
if __name__ == "__main__":
    main()
```

- [ ] Run `uv run python -m unittest scripts/test_bake_hand_sdf.py -v`.

Expected: import succeeds without Blender and without checking the downloaded source path.

### Task A2: Build the two-stage baker

**Files:**
- Create: `scripts/bake_hand_sdf.py`
- Modify: `scripts/test_bake_hand_sdf.py`

- [ ] Add PEP 723 metadata:

```python
# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["libigl==2.6.2", "numpy==2.5.2"]
# ///
```

- [ ] Implement and unit-test a frozen `GridSpec` carrying dimensions, metric min/max bounds, and measured voxel sizes; pure helpers named `grid_spec`, `grid_points`, `validate_field`, `write_r16f`, and `write_manifest`; and explicit NumPy array/type annotations on every boundary.

- [ ] Make `grid_points` X-fastest/Y/Z with `np.meshgrid(z, y, x, indexing="ij")` arranged as:

```python
zz, yy, xx = np.meshgrid(z, y, x, indexing="ij")
points = np.column_stack((xx.ravel(), yy.ravel(), zz.ravel()))
```

- [ ] Default CLI: 1.5 mm pitch, 12 mm margin, 262,144 query points per chunk, output `public/assets/lab/hand-sdf-relaxed-r.{r16f,json}`.
- [ ] Use `tempfile.TemporaryDirectory()` and an argument-list `subprocess.run` to launch the same script under Blender with `--blender-export <mesh.npz>`. Never use a shell string.
- [ ] In Blender, import `Gltf`, `Hand`, `add_rot`, `flex_sign`, and `splay_sign` from `pose_measure_hands.py`.
- [ ] Author the exact pose in the spec: index `9°;12/18/8`, middle `0°;15/22/10`, ring `5°;19/27/13`, pinky `11°;24/32/16`; thumb stays at rest.
- [ ] Select whole connected non-nail face components by aggregate right-versus-left skin weight. Do not threshold individual vertices.
- [ ] Apply existing inverse-bind LBS to every retained vertex.
- [ ] Derive +X thumbward, +Y wrist-to-fingertips, +Z dorsal; assert the frame is orthonormal/right-handed; transform vertices to metres.
- [ ] Bisect 35 mm proximal to the wrist. Pass only new boundary edges from `result["geom_cut"]` to `holes_fill`. Leave every pre-existing source seam alone. Do not voxel-remesh.
- [ ] Export float64 vertices, int64 faces, frame/topology diagnostics, and source SHA-256 to temporary NPZ.
- [ ] In the outer stage, query each grid chunk with separate magnitude and sign operations:

```python
unsigned_kind = igl.SignedDistanceType.SIGNED_DISTANCE_TYPE_UNSIGNED
unsigned, _, _, _ = igl.signed_distance(points, vertices, faces, unsigned_kind)
winding = igl.fast_winding_number(vertices, faces, points)
distance = np.where(np.abs(winding) > 0.5, -unsigned, unsigned)
```

- [ ] Use palm-interior and far-corner winding probes to diagnose inconsistent orientation or an invalid threshold. `abs(winding)` deliberately makes globally reversed orientation harmless; do not blindly negate a completed field.
- [ ] Store into `field[z0:z1, :, :]`, validate, and write `field.astype("<f2", copy=False).tobytes(order="C")`.

### Task A3: Prove sign, ordering, and dirty-soup behavior

**Files:**
- Modify: `scripts/test_bake_hand_sdf.py`

- [ ] Closed cube: center negative, point 0.25 m outside positive, zero crossing within one pitch.
- [ ] Dirty cube: remove two triangles and assert winding is above 0.5 at the center and the combined signed distance remains exactly the unsigned magnitude (approximately −1.0, not libigl's combined-mode −0.667). This prevents parity-ray regression and fractional-distance regression.
- [ ] X-fastest sentinel: dimensions `(3,2,2)` decode with X changing across the first three half values, then Y, then Z.
- [ ] Manifest: exact version/encoding/order/axis, finite ordered bounds, measured voxel sizes, SHA-256, and byte length `2 * nx * ny * nz`.
- [ ] Add `--self-test` and `--validate-only`; validation must not need Blender or the downloaded model.
- [ ] Run:

```bash
uv run python -m unittest scripts/test_bake_hand_sdf.py -v
uv run scripts/bake_hand_sdf.py --self-test
```

Expected: output names fast-winding sign and X-fastest R16F as passing.

### Task A4: Bake and inspect the derived asset

**Files:**
- Create: `public/assets/lab/hand-sdf-relaxed-r.r16f`
- Create: `public/assets/lab/hand-sdf-relaxed-r.json`
- Create: `docs/dev-notes/2026-08-17-sdf-hand-bake/mesh-preview.png`
- Modify: `ATTRIBUTIONS.md`
- Modify: `docs/dev-notes/2026-08-17-hand-detail-bake.md`

- [ ] Run `uv run scripts/bake_hand_sdf.py` and then `uv run scripts/bake_hand_sdf.py --validate-only`.
- [ ] Render a neutral 768×768 preview of the exact posed/extracted/cut soup before libigl. It must show five digits and open web spaces. If it is a mitten, stop task A.
- [ ] Confirm pitch is about 1.5 mm, field contains finite negative and positive values, the AABB boundary is positive, and size is plausibly 1–6 MiB (expected 2–3 MiB).
- [ ] Extend the existing DavidFischer attribution to cover the derived volume/preview with the exact source and licence links.
- [ ] Append measured topology, pose, dimensions, voxel sizes, min/max, hashes, duration, and the no-global-repair decision to the existing dev note.
- [ ] Inspect `git diff --stat`; ensure no source `.gltf`, source `.bin`, `.npz`, or repaired temp mesh entered git.
- [ ] Commit task A:

```bash
git add scripts/pose_measure_hands.py scripts/bake_hand_sdf.py scripts/test_bake_hand_sdf.py \
  public/assets/lab/hand-sdf-relaxed-r.r16f public/assets/lab/hand-sdf-relaxed-r.json \
  docs/dev-notes/2026-08-17-sdf-hand-bake/mesh-preview.png \
  docs/dev-notes/2026-08-17-hand-detail-bake.md ATTRIBUTIONS.md
git commit -m "feat(lab): bake relaxed hand signed-distance volume"
```

---

## Dispatch task B — sample the volume in the shared marcher

### Task B1: Add strict loading and Data3DTexture ownership

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/hand-volume.ts`
- Create: `src/lab/sdf-zombie/webgpu/hand-volume.test.ts`

- [ ] Write failing tests for valid checked-in JSON and rejection of wrong version, encoding, order, axis, dimensions, bounds, voxel size, byte length, and host byte order.
- [ ] Define `HandVolumeManifest`, `HandVolume`, `validateHandVolumeManifest`, `loadHandVolume`, and `createFallbackHandVolumeTexture`.
- [ ] Fetch JSON then resolve binary relative to the manifest URL. Validate before texture allocation.
- [ ] Construct:

```ts
const texture = new THREE.Data3DTexture(new Uint16Array(buffer), nx, ny, nz);
texture.format = THREE.RedFormat;
texture.type = THREE.HalfFloatType;
texture.minFilter = texture.magFilter = THREE.NearestFilter;
texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
texture.generateMipmaps = false;
texture.unpackAlignment = 1;
texture.needsUpdate = true;
```

- [ ] The 1³ fallback stores a positive half-float distance and is shared by all non-volume views; the lab renderer owns/disposes it.
- [ ] Run `npx vitest run src/lab/sdf-zombie/webgpu/hand-volume.test.ts`.

### Task B2: Add explicit trilinear sampling to WGSL

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts`
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

- [ ] Add failing tests for exported `SAMPLE_VOLUME`, eight 3D `textureLoad` corner reads, helper order, volume branch before wounds, and argument forwarding at every `mapBody` call.
- [ ] Add `sampleHandVolume(pWorld, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp)` before `MAP_BODY` in `HELPERS`.
- [ ] Transform world to local with the conjugate of the local-to-world quaternion. Apply the clamped 12 mm distal warp with `smoothstep(0.15, 0.9, uv.y)`.
- [ ] Reconstruct trilinearly on the baker's endpoint-inclusive lattice:
  `q = clamp(uv * (dims - 1), 0, dims - 1)`, floor/ceil indices, eight loads,
  nested `mix`. Do not use `uv*dims-0.5`; that is the normalized-sampler texel
  convention and would shift a grid whose first/last samples sit exactly on the
  manifest bounds.
- [ ] Outside the volume, sample the clamped boundary and add metric distance to the AABB so edge clamping cannot extrude a slab.
- [ ] Extend `MAP_BODY`: volume enabled supplies `d` and skips the primitive loop; disabled retains the existing fold. Apply carves/wounds/noise after either field.
- [ ] Thread the texture and five volume uniforms through `mapBody`, `calcNormal`, `MARCH_BODY`, march, shell, translucency, and AO calls.
- [ ] Use dominant index `-1` in volume mode; do not fake a primitive index.
- [ ] Run `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`.

### Task B3: Bind the shared field parameters

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts`

- [ ] Extend `defaultUniforms` with disabled `volumePose0`, identity quaternion `volumePose1`, bounds min, inverse extent, and zero warp.
- [ ] Insert required `volumeTex` after `dataTex` in `createMarchMaterial`; import `texture3D` from `three/tsl`; pass `texture3D(volumeTex)` and every volume uniform to the WGSL entry while retaining the existing march/cone/occluder arguments after `u`.
- [ ] Update body, chunk, and hands call sites to bind the shared fallback. Add a call-site test so none can omit it.
- [ ] Assert defaults select primitive mode.
- [ ] Run:

```bash
npx vitest run src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts \
  src/lab/sdf-zombie/webgpu/march.wgsl.test.ts
npm test
npm run build
```

Expected: no TSL node-type error around `texture3D`; the pre-existing suite remains green.

### Task B4: Make one hands view volume-capable

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/fpv-view.ts`
- Create: `src/lab/sdf-zombie/webgpu/fpv-view.test.ts`

- [ ] Extend `HandsGpuView` with `setField('prims'|'volume', volume?)`, `setVolumePose({centre, quaternion, warpLocal, warpEnabled})`, and `setClay(boolean)`.
- [ ] In volume mode, keep uploading wound rows but set primitive/cluster counts to zero and enable `volumePose0.w`.
- [ ] Copy manifest bounds/inverse extent and bind the loaded texture. Use relaxation 1.0, step multiplier 0.75, at least 128 steps, and hit epsilon at least half the largest voxel pitch. Restore all template values in primitive mode.
- [ ] Size the proxy from the transformed eight manifest AABB corners plus max voxel pitch, wound margin, and 12 mm warp margin. Do not use prim bounds in volume mode.
- [ ] Clay mode saves/restores flesh settings; use neutral `0x9a8177`, specular 0.15, roughness 0.7.
- [ ] Test switching, counts, settings restoration, transformed proxy bounds, clay restoration, wound upload, and disposal ownership.
- [ ] Run focused tests, `npm test`, and `npm run build`.
- [ ] Commit task B:

```bash
git add src/lab/sdf-zombie/webgpu/hand-volume.ts \
  src/lab/sdf-zombie/webgpu/hand-volume.test.ts \
  src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts \
  src/lab/sdf-zombie/webgpu/fpv-view.ts src/lab/sdf-zombie/webgpu/fpv-view.test.ts
git commit -m "feat(lab): march baked hand volume"
```

---

## Dispatch task C — wire and judge the look gate

### Task C1: Derive rigid pose and distal warp

**Files:**
- Create: `src/lab/sdf-zombie/hand-volume-pose.ts`
- Create: `src/lab/sdf-zombie/hand-volume-pose.test.ts`

- [ ] Write tests for rest identity, 10 mm distal lag, pinned wrist, basis conversion, 12 mm clamp, and input immutability.
- [ ] Export `bakedHandPose(unjiggled, jiggled, projection)`: wrist/forearm mean supplies rigid translation; finger-group residual after removing it supplies warp; project into the anatomical basis and clamp.
- [ ] Apply the same determinant repair already documented by `setProjection` before making a quaternion.
- [ ] Run `npx vitest run src/lab/sdf-zombie/hand-volume-pose.test.ts`.

### Task C2: Add loading, controls, and isolated baked mode

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`
- Modify: `src/lab/sdf-zombie/fpv-mode.test.ts`

- [ ] Add `handField: 'prims'|'baked'` (default prims), `handWarpEnabled` (false), `handClay` (false), and `handVolumeState: 'loading'|'ready'|'error'`.
- [ ] Load once beside hand sheets. Bind on success without switching modes. On error, expose the message, force prims, and avoid unhandled rejection.
- [ ] Add panel buttons `hand field`, `hand warp`, and `hand clay`. Baked selection is refused until ready.
- [ ] Primitive mode executes the existing frame block unchanged.
- [ ] Baked mode hides the left hand, stick, and cigarette; shows the right view in volume mode; uploads right wounds; sends rigid pose and optional warp.
- [ ] Switching back restores both views, props, sheets, and primitive march settings immediately.
- [ ] Expose `setHandField`, `setHandWarp`, `setHandClay`; include mode/warp/clay/load state in `__sdfLab.fpv`.
- [ ] Dispose loaded and fallback volumes exactly once.
- [ ] Test defaults, failed-load fallback, switching/prop visibility, and public state; run focused tests, full suite, and build.

### Task C3: Capture the static gate before warp

**Files:**
- Create: `docs/dev-notes/2026-08-17-sdf-hand-bake/primitive-flesh.png`
- Create: `docs/dev-notes/2026-08-17-sdf-hand-bake/baked-clay-static.png`
- Create: `docs/dev-notes/2026-08-17-sdf-hand-bake/baked-flesh-static.png`
- Create: `docs/dev-notes/2026-08-17-sdf-hand-bake/baked-flesh-warp.png`
- Create: `docs/dev-notes/2026-08-17-sdf-hand-bake/notes.md`

- [ ] Pin one FPV eye/yaw/pitch. Capture primitive/flesh control.
- [ ] Capture baked/clay with warp off. Compare against task A's exact mesh preview. If preview and march disagree, diagnose transform/boundary/hit epsilon before increasing resolution.
- [ ] Capture baked/flesh with warp off. Verify flesh family, normals, legacy gamma, and one test wound.
- [ ] Only now enable warp; excite jiggle and capture a readable settled frame. Reject swimming, finger merging, or wrist tearing.
- [ ] Record this checklist with `Owner verdict: PENDING`:

```text
[ ] five digits separable at normal FPV size
[ ] thumb root/opposition reads
[ ] web spaces open; no mitten bridges
[ ] knuckle and palm structure read
[ ] no objectionable voxel stair-step
[ ] wounds/material match the primitive flesh family
[ ] warp adds weight without collapse or swimming
```

### Task C4: Benchmark and hand off for owner verdict

**Files:**
- Modify: `docs/dev-notes/2026-08-17-sdf-hand-bake/notes.md`
- Modify: `TASKS.md`

- [ ] On a visible page with identical settings, press B in alternating order: primitive 1, baked 1, baked 2, primitive 2. Reject any hidden step.
- [ ] Record median/p05/p95, body count, SDF scale, cone state, ordering, and mean median. Gate: regression no greater than `max(0.5 ms, primitive * 5%)`.
- [ ] Final verification:

```bash
uv run python -m unittest scripts/test_bake_hand_sdf.py -v
uv run scripts/bake_hand_sdf.py --validate-only
npm test
npm run build
git status --short
```

- [ ] Update X1.26 to `owner visual gate pending`, linking design, plan, and notes. Do not mark complete.
- [ ] Commit task C:

```bash
git add src/lab/sdf-zombie/hand-volume-pose.ts \
  src/lab/sdf-zombie/hand-volume-pose.test.ts \
  src/lab/sdf-zombie/webgpu/lab-main.ts src/lab/sdf-zombie/fpv-mode.test.ts \
  docs/dev-notes/2026-08-17-sdf-hand-bake TASKS.md
git commit -m "feat(lab): add baked hand visual gate"
```

## Owner decision after dispatch

- **PASS:** keep primitive mode default until a separate pose/deformation design is approved; consider Jin-style wrist blending later.
- **FAIL — diagnosed bake/runtime defect:** fix only that defect and repeat the four captures.
- **FAIL — representation/direction:** stop SDF-hand work and resume the third-person pivot discussion. Do not dispatch pose blending.
