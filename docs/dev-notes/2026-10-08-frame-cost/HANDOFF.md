# Frame-cost pass: hand-off (2026-10-08)

Read [`NOTES.md`](NOTES.md) for the measurements and the ranking. This file is where the work stands and how to pick
it up.

## State

- **PR goblincore/blud#41** (draft), branch `claude/quizzical-williams-66ec4e`, on `main` at `06f2ef12` (the skull
  stack, PR 39, and PR 40 are in). Merged up with `main` at `030d9120` (PR 43) in `3560302e`.
- **Built and verified:** `scripts/frame-cost.mjs` and the notes; the held weapons' near-light list
  (`near-light-pick.ts`, `near-lights.ts`, `viewmodel-lights.ts`; `?nearlights=0`); the exact wound reach as the
  shipped default (`zombie-gpu.ts` `SHIP_COUNTS2_Z`; `__sdfGame.setWoundExact(false)`).
- **CI:** green on the lights commit. On `9de3f337` typecheck passed; the four test shards were still running when
  this was written. Read with `gh pr checks 41`.
- **Waiting on the owner:** a playtest of both changes (the list of what to look at is at the end), and a pick from
  the ranking for what to build next.
- **The goal:** the heavy scenes at a stable 30 fps (33.3 ms). **Met with margin after PR 43** (the quad crowd
  dispatch as the default, merged into this branch at `3560302e`): Boiler Room after a fight 28.5 ms, the bare arena
  after a fight 24.8 ms, the chopped and split close-up 23.3 ms. On boxes (`?crowddispatch=boxes`) the same branch
  reads 31.7, 36.8 and 32.4 ms. NOTES has the table at its top.

## Next, in the ranking's order (none started)

After PR 43 nothing below is needed to reach 33.3 ms in the measured scenes; it is margin and smoothness. Items 1, 4,
6 and 7 do not depend on the crowd dispatch. Items 2, 3 and 5 were sized on boxes: re-measure on the quad first (the
owner re-fold, item 3, already reads as no gain there).

1. The props (light fixtures, pickups, spent shells) and the soldiers' kit on their room's lights: about 1 to 1.5 ms
   on Night Train. They still use three's default list (69 lights) or `kit-lights.ts`'s mirror of it. They do not
   change rooms, so a fixed list per room rebuilds nothing. Careful: the level's own per-room list also carries the
   room's probe node, which would brighten props; a list of the same real lights filtered by room does not.
2. PR 35 (`claude/open-head-cost`): merges onto `06f2ef12` with text conflicts in `TASKS.md` and
   `docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md` only. Needs those resolved, then its gates on
   the skull stack (head-split, axe, cut-wound, head-burst), `march-golden -u`, `march-hash`, `compile-census`. Its
   branch was not touched by this pass.
3. The owner re-fold under cuts and the split (`march/map-body.wgsl.ts`): about 8 ms of the split close-up.
4. A doorway (portal) test for the level's meshes: 165 to 192 of 425 draw calls in third class are other carriages.
5. The arena: a wound index per region, or craters baked into a rest-space volume.
6. CPU: pose, pack and upload only bodies in the visual set. `game-actor.ts` `step()` ends with
   `posed = repose(); view.update(...); refreshWounds()` for every actor; `posed` has about 30 readers in that file,
   so the safe form is a lazy re-pose behind the actor's public methods, checked with a demo replay's frame hash.
7. The first shot's 28 to 37 pipelines.

## Open, not mine to close here

- The light gate fails one check on pristine `main` since the sculpted skull merged ("skull glows in the dark",
  1.56x against 1.5x). Spawned as its own task; a separate session is on it.
- `scripts/head-burst-gate.mjs` failed one check in one of two full runs ("FS: nothing floats over the stump": its
  front view read 13,594 px once, 0 in every other run, on `main` too). A flaky capture; the gate was not changed.

## How to measure again

```bash
until mkdir /tmp/blud-gpu-timing.lock 2>/dev/null; do sleep 10; done
bash -c 'export LAB_TMP=.lab-tmp LAB_VITE_PORT=5261 LAB_CDP_PORT=9261; . scripts/lab-servers.sh
  trap "lab_servers_down; rm -rf /tmp/blud-gpu-timing.lock" EXIT; lab_servers_up
  node scripts/frame-cost.mjs 5261 9261'
```

- Two trees side by side: a second checkout with its own `npx vite --port 5267 --strictPort`, then
  `SCENES=train-third@5261,train-third@5267 ABLATE=0 node scripts/frame-cost.mjs 5261 9261`. Give a second checkout
  its own `node_modules` directory of symlinks, not one symlink to the first's: two dev servers sharing
  `node_modules/.vite` re-optimise each other's dependencies.
- Scenes: `train-van`, `train-third`, `train-dining`, `train-sleeper`, `train-boiler`, `ring-room4`, `ring-arena`,
  `closeup`, `closeup-pellets`, `closeup-chop`. `LIGHTS=1` adds the light-hiding legs (last, in a pass of their own).
- The raw runs of this pass are under `.lab-tmp/frame-cost-*` in the worktree (not tracked).

## Traps this pass fell into (all guarded in the driver now)

- **A killed driver leaves its game page open and drawing.** Later runs then read like a regression. Check
  `curl -s localhost:<cdp>/json/list` for `sdf-game` pages.
- **One sequential `timeDraws` read is not a measurement on this machine.** Two wrong conclusions were drawn from
  such reads and retracted the same day (NOTES §3.3). Use the alternation legs.
- **The load average misses slowdowns** (the page's thread on the efficiency cores reads 2.8 times slower at the same
  load). The driver's speed loop catches it.
- **A fresh browser profile is not a cold boot**: the system keeps compiled shaders outside it.
- **Never edit `src/` in a tree a dev server is serving to a running measurement.**

## What the owner should look at in play

- Night Train with the shotgun, the flail and the axe: the gun and arms in each carriage, through the doorways (the
  proxies change hands there), in the Boiler Room under the beacons and the strobe, on a firing frame.
- The torch after the coat-check pickup (not verified: the captures did not light it), and an outdoor level.
- Wounds up close: they should look exactly as before.
- A/B: `?nearlights=0`, and `__sdfGame.setWoundExact(false)` in the console.
