# Bloatmaw r2 — correction report

## The one job
`characters/bloatmaw.blob` existed on the base branch as a floating flesh ball,
mostly mouth, with tiny shackled arms. The owner wanted it CORRECTED: remove
the googly orb eyes, and make the body far more complex/grotesque. This pass
kept the float, the maw, the teeth, the throat-core and the tiny arms.

## Vision without Chrome (the sandbox constraint)
`npm run blob:shot` cannot run here. Chrome's crashpad and process-singleton
resolve macOS system paths (`~/Library/Application Support/...`,
`/var/folders/.../T`) that the DSH file sandbox denies, and it ignores
`HOME`/`TMPDIR` overrides for those, so Chrome aborts on its singleton.
Escalation to `danger-full-access` has no approval channel, so the WebGPU
turntable is unavailable.

Workaround: `scripts/blob-silview.ts` raycasts the CPU field
`compileBlob -> buildBody -> sdBody`, computes finite-difference normals,
shades with per-prim `color`/`glow` (falling back to the palette for raw flesh)
and writes per-yaw PNG frames. `scripts/blob-inspect.ts` prints the packed
prims/clusters. This is a geometry-only look (no wetness/fresnel/mottle/AO),
but it is exactly the signal needed here: is the silhouette irregular, do the
eyes sit IN flesh, does the maw dominate. Verified by `read_image` before and
after every edit group.

## git commit is also blocked
The worktree's git metadata lives at `/Users/donny/Projects/blud/.git` (outside
the session workspace). The sandbox denies all writes there, and escalation has
no approval channel, so `git commit`/`git add`/`git push` are unavailable. File
edits persist on disk (the durable, crash-safe deliverable). A `--shared` clone
into /tmp shares nothing writable either (the shared store lives in the same
blocked dir). So: edits are on disk and the full changed-file diff is saved as
`bloatmaw-r2.patch` in the workspace. Use that to reconstruct the commit.

## Correction 1 — eyes: from googly orbs to seated embers
Before: a big pale-BLUE sphere (`bfe8ff`) and a small sick-GREEN sphere
(`a8c24a`) stuck proud of the ball, bulging ~0.16 m. They read as bright
saturated toy eyes — the single worst thing in the frame.
After: two small, dim, warm embers — a burnt-crimson big eye (`7a1c08`) and a
smoke-amber small eye (`7a5c14`) — each seated in a flesh socket crater (a
wider non-glowing prim whose surface sits BEHIND the eye) under a continuous
shelving brow ridge (a `both`-free single ridge spanning both sockets). The
flesh, not the eye, carries the silhouette; the eye only fills a window.
Asymmetry kept: different sizes, different heights, small eye half-lidded by a
flesh lid. Glow allowlist stays at 4 prims (2 eyes + throat haze + core), so
`pack.test.ts`'s `bloatmaw.blob: 4` count is unchanged.

## Correction 2 — body: from a sphere to anatomy
Added (all off-centre/uneven so no yaw reads as a circle):
- a jutting mandible plus two cheek jowls under the maw;
- a broad nasal bridge with two dark naris slits above the maw's top lip;
- fat fleshy ear-frills off the upper flanks (one broad lobe, one thin frill,
  plus a nub), raked back;
- a heavy back hump mass pushed to -z/+x;
- a ragged raked crown crest (replacing the old barely-there spurs);
- asymmetric lumpy boils/folds on the flanks and underbelly; a couple painted
  dark so they read against the flesh.
Kept under the declared `height 1.83` (tallest crest tip y ~1.81) and the
0.302 m hover gap (measured: top 1.829, bottom 0.302). Head cluster = 44
prims (MAX_CLUSTER_PRIMS 64), torso 13 — safe.

## Floor vs. arms
The first anatomy pass swallowed the shoulder (armL clearOf went negative, the
goblin regression). Pulled the flank/boil masses in past x 0.40 so they stop
short of the shoulder at 0.633. Re-checked: armL daylightOf 0.111, armR 0.101
(> 0.037 threshold), both fused (negative) and clear (positive); armL/armR
clearOf 1.074.

## Verification
- `npx tsc --noEmit`: CLEAN.
- `npx vitest run src/lab/sdf-zombie/characters/ src/lab/sdf-zombie/pack.test.ts`:
  278 passed (18 files), including the exact-glow-count allowlist and the
  updated bloatmaw pins. (surface-nets.wgsl.test.ts already fails on main; not
  touched.)
- bloatmaw-blob.test.ts now pins: seated-in-flesh ember eyes (no blue/green, a
  flesh socket behind each), anatomy on every axis (jaw, ear-frills/back hump,
  brow ridge, torso asymmetry), plus all the original float/stance/maw/arm pins.

## Not finished / caveats
- The palette was left as-is (baseColor 0.30/0.15/0.12 etc.). The flesh reads
  as dark wet meat in the CPU renderer, but a real GPU look (translucency,
  mottle, wetness) is unverified because Chrome couldn't launch. Worth a
  look once a browser can run.
- The silhouette is judged from the CPU raymarch, not the lab. It is clearly
  irregular from every yaw, but the authoring skill's turntable is the
  ground truth when it runs.
