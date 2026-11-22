# The soldier's grey mottling: the skin detail layer, not the analytic normal (2026-11-10)

**Answer.** The soldier's skin showed grey blotches with analytic normals and none with the original
(tap) normals. The cause was the `skin detail` light layer, which only the soldier used (k 1). The
analytic normal itself matches the taps. The soldier's k is now 0 (owner, 2026-11-10: "turn it off").

## Why the layer depended on the normal

The layer divides the lit colour by `r` before the highlight shoulder and multiplies `r^k` back after,
where `r` is the diffuse on the bumped normal over the diffuse on a smooth one
(`skin-detail-proto.ts`). The smooth normal is taken right after the shading normal:

- **Analytic pixel** (`ngValid`): `nSmooth = normalize(ng0)`, the analytic base without `ngDetail`.
  That leaves out the 20 cm shell-noise lumps, so `r` carries them and the layer restores their
  contrast. Those are the blotches.
- **Tap pixel**: `nSmooth = n`, and `n` already holds the lumps. `r` then carries only what later
  blocks add to `n` (the fine grain).

So one switch gave two looks, and the look followed whichever normal a pixel took. A wounded body's
pixels take the taps, so the blotches went away over the whole soldier at its first wounds.

## Measured

Arena, one body at 0.75 m, the 400 × 300 march target of one frozen frame, read as floats. A pixel
"changes" when any colour channel moves by more than 0.02. Two reads of the same state differ by at
most 0.0001. Raw results: `before-*.json`.

| Body | Pixels on the analytic normal | Analytic against original, layer on | Layer off |
| --- | --- | --- | --- |
| Soldier, before | 94 % | 64 % change, mean 0.09 | 4 %, mean 0.005 |
| Soldier, after (k 0) | 94 % | 4 %, mean 0.005 | 4 %, mean 0.005 |
| Zombie | 91 % | 2 %, mean 0.004 | 2 %, mean 0.004 |
| Butcher | 89 % | 5 %, mean 0.004 | 5 %, mean 0.004 |
| Twinhead | 86 % | 6 %, mean 0.005 | 6 %, mean 0.005 |

- **Wounded soldier** (five stamps): 100 % of its pixels report reason 1 (the tap fallback), and the
  two normals give the same frame. [`before-wounded.png`](before-wounded.png): clean analytic,
  wounded analytic, wounded original, the difference times 4.
- [`before-original-analytic-diff4.png`](before-original-analytic-diff4.png): original, analytic, the
  difference times 4, with the layer on, before the change.
- With original normals the layer still moved the soldier a little (mean 0.015, a fine grain over
  the skin). That is gone too.

## What changed

- `SKIN_DETAIL_BY_CHARACTER` is empty. The term, the LIGHT LAYERS switch and `?skinDetail=k` (forces
  k on every body) stay, for A/B.
- No shader text changed: k is a per-instance value.

Not verified: any level but the arena, any range but 0.75 m, the flashlight on (the case the layer
was made for, 2026-09-27).

## Running it

```bash
until mkdir /tmp/blud-gpu-timing.lock 2>/dev/null; do sleep 10; done
LAB_TMP=.lab-tmp LAB_VITE_PORT=5391 LAB_CDP_PORT=9391 scripts/native-spike/servers.sh \
  env PROBE_WOUNDS=1 node docs/dev-notes/2026-11-10-soldier-skin-detail/probe.mjs soldier
rm -rf /tmp/blud-gpu-timing.lock
```

`PROBE_QUERY=skinDetail=1` forces the layer back on to reproduce the "before" rows.
