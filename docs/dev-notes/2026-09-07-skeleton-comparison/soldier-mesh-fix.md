# Soldier mesh protrusion fix

Status: CPU fix and regression coverage complete; coordinator-owned GPU visual
acceptance pending.

## Diagnosis

The pink protrusions were extracted bone meshes. `buildBody` puts only bone and
organ primitives in `body.bonePrims`; the skeleton contract excludes organs,
and soldier has no authored inside primitives, so its mesh sources are all
auto-derived bone from additive structural flesh. Subtractive, groove and shell
primitives do not enter bone derivation.

The extraction itself was contained: every vertex from every soldier segment at
the 1 cm mesh cell size remained at least 4 mm behind the authored rest-flesh
surface. A normal 60-step settle also measured only 0.731 mm worst limb endpoint
error. Neither result can explain the long arm and boot strips.

The actual failure was delayed source creation after soldier motion had rewritten
`rig.restPose` for weapon IK and footwork. `createSkeletonSources` used that live
motion target to construct segment-local B endpoints, despite extracting geometry
from stable `actor.body`. The resulting cache revision and geometry depended on
the pose at first use, and the live pose transform then applied the arm/leg motion
again. The large protrusions appeared only after stepping the soldier, matching
that double application.

## Fix

Limb-local endpoints now come entirely from stable rest-body geometry and stable
bind offsets: the bind-time A anchor is `p.a - bind.a.offset`, and local B is
`p.b - restJointA`. Live `rig` and body yaw remain pose-only inputs. This keeps
the existing default renderer, zombie and volume paths, `actor.body` cache
identity, sever liveness and bounded cache lifecycle unchanged.

## Regression evidence

The soldier regression rewrites the left elbow in `rig.restPose` before a delayed
source build. Before the fix, two arm segment revisions changed:

- `51341acb` to `c09066b`
- `e42223a8` to `cd0d96a8`

After the fix all 21 soldier source revisions match the pristine build. The mesh
containment regression independently checks every extracted soldier vertex
against the actual CPU flesh field with the required 4 mm margin.

Focused verification:

```text
npx vitest run src/lab/sdf-zombie/webgpu/skeleton-spike/contract.test.ts src/lab/sdf-zombie/webgpu/skeleton-spike/mesh.test.ts --reporter=verbose
Test Files  2 passed (2)
Tests       31 passed (31)
npx tsc --noEmit
exit 0
```

No browser or GPU job was run in this task. The coordinator owns the serial
post-fix soldier capture and visual acceptance.

## Coordinator verification

Source review approved. Final shared volume/volume-GPU tests: 24/24 passed; production build passed (chunk-size warning). Implementer contract/mesh tests: 31/31; appearance/mesh tests: 19/19; TypeScript passed.

GPU captures in `/tmp/soldier-mesh-fixed` and `/tmp/skull-mesh-close-fixed` render the new material and stable-bind fix. Soldier was advanced one live simulation step before freezing; inspected boots show no pink side strips. This is a bounded pose check, not exhaustive moving-combat acceptance. Exposed zombie skull shows front-facing socket/nose/teeth material cues, not newly sculpted cavities.

Harness exits nonzero because repeated frozen frames differ, including procedural baseline; no parity or performance verdict. Captures include an empty-draw warning and favicon warning, with no shader compilation/runtime error. Captures started while the soldier fix was uncommitted, so recorded HEAD is df700f4b; tested source was subsequently committed as 20b9b887. Owned CDP ports 9396/9397 released; user preview remains on 5396.
