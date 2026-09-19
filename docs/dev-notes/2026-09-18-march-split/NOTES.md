# march.wgsl.ts split — Task 1 (golden gate + leaf modules)

Plan: `docs/superpowers/plans/2026-09-18-march-wgsl-split.md`
Spec: `docs/superpowers/specs/2026-09-18-march-wgsl-refactor-design.md` (phase 1)

This is a MOVE-ONLY refactor: every export keeps its exact name and exact
string value; `march.wgsl.ts` becomes a barrel. The sha1 golden snapshot
(`src/lab/sdf-zombie/webgpu/march/__snapshots__/march-golden.test.ts.snap`)
was written at `11fffe13` before the first move and must never change.

## Step 2 — baselines (base commit `11fffe13`, shader text unmodified)

`scripts/march-hash.mjs` (headless Chrome + vite on 5323/9323, fresh
`.lab-tmp` profile). Exact-float readback of the march target:

```json
{"room1":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-repeat":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-wounded":"1381a866703b827745486a1062240a46bee5c73f"}
```

`room1` matches the script's pinned `DEFAULT_HASH`; `room1-repeat == room1`
(determinism proof holds); `room1-wounded != room1` (the gate sees the wound).

Room 2 (crowd-parity diagnostic, `MARCH_HASH_ROOM=2`):

```json
{"room2":"76ada45a56821888ced2259be7845b762f8a107b","room2-repeat":"76ada45a56821888ced2259be7845b762f8a107b"}
```

NOTE: `march-hash.mjs` runs its shipped-default canonical pin even under
`MARCH_HASH_ROOM=2`, where the captured hash is room 2's and cannot equal the
room-1 pin. That is a script limitation, not a scene difference. Room 2 was
therefore run with `MARCH_HASH_QUERY=upscale=0`, which appends a duplicate of
an already-present query param (no scene change) and is the script's documented
way to bypass the pin. Do not read this as a loosened gate: room 1 keeps the
exact pinned canonical.

Cold-boot (`scripts/boot-time.mjs`, own vite + headless Chrome, FRESH
`--user-data-dir` per run, waits for `__warmGate.phase === 'ready'`):

| run | drawOnce (ms) | warmMs |
| --- | ---: | ---: |
| 1 | 1261.6 | 2579 |
| 2 | 1242.5 | 2549 |

`drawOnce` is `__warmDone.phases.drawOnce`; `warmMs` is `__warmDone.ms`.

## Sizes before

| file | bytes | lines |
| --- | ---: | ---: |
| `webgpu/march.wgsl.ts` | 277753 | 4800 |

## After

(filled in at Step 7)
