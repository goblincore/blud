# Equipment environment lifetime after dynamite

User report: intermittent screen smearing after a dynamite explosion and camera
movement, alongside repeated `Destroyed texture "PMREM.cubeUv" used in a submit`
validation warnings. Investigated from main ec0cef61.

## Confirmed defect

Three 0.185.1's WebGPU EnvironmentNode captures a material's envMap in a PMREM
node during shader building. RenderObject's material cache key includes texture
mapping/sampler properties but not texture identity. Structurally identical
materials with different privately owned PMREMs can share the first material's
node builder state, including its environment texture binding.

A real WebGPU scene with two identical boxes and independent RoomEnvironment
PMREMs confirms both builders use the first texture. Retiring the first box and
its PMREM changes all 8,040 lit RGB values in a crop of the surviving box. This
particular reproduction silently recreates an empty texture rather than raising
a GPU validation error.

Armor and held weapons both own such PMREMs; retireActor calls
character.retireEquipment after gib spawning, which disposes them.

## Change

Include the owned environment UUID in each equipment material's program cache
key so node builders cannot capture a different owner's texture. Compiled GPU
shader programs can still be shared. Kit cleanup now disposes the complete PMREM
render target and the temporary RoomEnvironment, rather than only its texture.
No shading settings or reflection intensities change.

## Verification

- Focused Vitest: 4 files, 11 tests pass (environment ownership for both real
  loader paths, equipment retirement, held prop reset, kit damage).
- `npm run build`: TypeScript and Vite pass; existing large-chunk warning.
- `scripts/sdf-equipment-environment-gate.mjs`: real WebGPU, 256-square target;
  unisolated controls change 8,040 values for both texture-only and target
  disposal; isolated variants change zero values, with no GPU errors.
- Same gate boots the default game, waits for warm-up/probes, renders soldiers,
  detonates at torso centers, and moves the camera around each aftermath using
  the real RAF loop. All four soldiers retire; four gibbed; zero GPU errors.
- The gameplay sequence also passes with the original equipment loaders. Thus
  the lifetime defect and its correction are demonstrated, but the user's exact
  intermittent smearing/validation-warning sequence has NOT been reproduced.
  Manual gameplay confirmation remains necessary. No performance claim.

Run from the worktree root with unused ports; only owned servers are stopped:

```sh
LAB_VITE_PORT=5494 LAB_CDP_PORT=9494 LAB_TMP=/tmp/blud-env-gate bash -c '
  source scripts/lab-servers.sh
  trap lab_servers_down EXIT
  lab_servers_up
  node scripts/sdf-equipment-environment-gate.mjs
'
```
