# Cut wounds M1: measurement notes

Plan: `docs/superpowers/plans/` (cut wounds M1). Spec: `docs/superpowers/specs/2026-10-03-cut-wounds-design.md`.
Base for every "before" number: `a66c1c4a` (Task 1 merged). Machine: the owner's Mac, headless Chrome 154,
fresh profile per boot. Its timers are noisy, so each number comes with its spread.

## Task 2: wound limit 16 -> 32 (2026-10-03)

`MAX_WOUNDS = 32` (`damage.ts`). Every WGSL wound loop bound, the per-ray list's `min(count, N)` clamp and
`gWoundList: array<i32, N>` are now `${MAX_WOUNDS}` (`fields/wounds.wgsl.ts` applyWounds and woundMask,
`fields/tissue.wgsl.ts` charMask, `fields/groups.wgsl.ts`, `body/blocks/setup/wound-list.wgsl.ts`,
`normal-gradient.wgsl.ts` ngWounds), so the shader and the CPU ring cannot disagree again.

### Cold-boot `drawOnce` (`scripts/boot-time.mjs`, the gate)

| run set | drawOnce ms | warmMs |
| --- | --- | --- |
| base, 5 runs | 1627.3, 1644.9, 1632.3, 1631.5, 1630.6 (median 1631.5, spread 17.6) | 2907, 2448, 2396, 2396, 2428 |
| 32, 5 runs straight after | 1633.0, 1669.6, 1691.8, 1696.8, 1731.3 (median 1691.8) | 2398-2568 |
| interleaved, MAX_WOUNDS 16 | 1637.3, 1748.9, 1712.0, 1750.8, 1750.3 (median 1748.9) | 2425-2632 |
| interleaved, MAX_WOUNDS 32 | 1639.3, 1709.0, 1683.8, 1711.8, 1735.4 (median 1709.0) | 2399-2536 |

The straight-after set climbs run by run (load average was around 10 at the time). The interleaved pairs
(16 then 32, five times, same minutes) show the climb is machine-wide: 32 is no slower than 16 in any
pair but the first, where they tie. The interleaved 16 build compiles the same WGSL as the base (the loop
bounds interpolate back to `16`; only stripped comments differ). **Acceptance (within the base spread +
10%, about 1810 ms against the base max of 1645): met.** The 24 fallback was not needed.

### Compile census (`scripts/compile-census.mjs 3`)

All boots `phase=ready`, no uncaptured GPU errors, no device loss.

| build | warmMs | drawOnce | march-family module | median march compile ms |
| --- | --- | --- | --- | --- |
| base | 2448 / 2392 / 2403 | 1673.6 / 1623.2 / 1619.0 | 295616 B (+ gib 293881 B, crowd 295184 B) | 39.2 / 39.2 / 39.8 |
| 32 | 38105 / 2474 / 2480 | 1603.3 / 1680.2 / 1693.8 | 295624 B | 39.8 / 40.5 / 39.8 |

Two traps here.

- **The OS Metal shader cache outlives the fresh Chrome profile.** The base text was already in it, so
  the base boots were warm. The first 32 boot paid the real compile (asyncFirst 36.2 s, two march
  pipelines about 18 s each); later boots hit the cache.
- **Missing gib and crowd entries.** The 32 census shows 9 march-family entries per boot, not 13: the gib
  and crowd march variants compile in the background after the loader, and the census snapshots at
  `ready`. The base had them cached, so they landed by frame 11. A 40 s probe of the 32 build showed the
  gib variant (293889 B) landing about 11 s in and the crowd job still compiling at 40 s, with no console
  or GPU errors. Once compiled, the crowd job is `ready` (march-hash waits for it and hashed the crowd
  path).

**A like-for-like true-cold comparison.** I nudged `hash13`'s `0.1031` constant (the 2026-09-19 cold-cache
method; a comment is stripped and does not miss the cache) to a unique value per boot, interleaved, and
reverted it afterwards (`math.wgsl.ts` is unchanged in the commit):

| build | nonce | warmMs | asyncFirst | drawOnce |
| --- | --- | --- | --- | --- |
| 32 | 0.103171 | 38352 | 36177 | 1611.9 |
| 16 | 0.103172 | 38844 | 36711 | 1603.6 |
| 32 | 0.103173 | 37414 | 35299 | 1586.3 |
| 16 | 0.103174 | 37331 | 35207 | 1609.3 |

At 32, a truly cold compile costs the same as at 16.

### march-hash (`scripts/march-hash.mjs`)

Base: default `d7392d52…`, wounded `76bd51aa…`. At 32: default `d7392d52…` on 2/2 boots, crowd quad
`0c71e712…` and per-body `470ff0b3…` on 1/1 each, and the wounded variants unchanged. No pin moved. The
header records the re-verification.
