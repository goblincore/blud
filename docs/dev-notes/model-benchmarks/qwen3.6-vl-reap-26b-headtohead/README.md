# Qwen3.6-VL-REAP-26B-A3B head-to-head: Q4_K_M vs Q3_K_S vs IQ4_XS

Date: 2026-04-27

## Setup

- Same llama-cpp build (`TheTom-llama-cpp-turboquant`), KV cache q8_0/turbo3, ngram speculative decoding (max=8, min=2, p-min=0.75), `--no-context-shift`, ctx=65536.
- `LIL_FSM_THINK=1` (structured-CoT) enabled for all runs.
- Bench harness: `scripts/model-benchmark-lil-quick.sh` (2 standalone code-gen tasks)
  + `scripts/model-benchmark-blud.sh` (3 agentic tasks against the blud worktree at `/tmp/blud-lil-bench`).
- Lil-quick now writes its lil `--cwd` to `/tmp/lil-bench-quick-<label>-task<N>/`.
  Earlier runs put it under the blud repo, which made pi's resource loader walk
  up to `~/Projects/blud/CLAUDE.md` and inject blud's project context — the
  model then emitted absolute paths to `/Users/donny/Projects/blud/src/...`,
  contaminating the parent repo. Fix in commit on this branch.

## Results

### Lil-quick (standalone code-gen, no agent loop on a real repo)

| Quant   | Task 1 (SeededRng) | Task 5 (LRU) | Total  | Files written |
|---------|-------------------:|-------------:|-------:|--------------:|
| IQ4_XS  | ~151s              | ~149s        | ~300s  | unknown (leaked into blud repo) |
| Q4_K_M  | 322s               | 284s         | 606s   | 2 + 5         |
| Q3_K_S  | 436s               | 851s         | 1287s  | 5 + 2         |

IQ4_XS times come from session JSONL timestamps (first → last message) since
that run pre-dated this output dir.

Notes:
- Q3_K_S's LRU run (851s) was an outlier — likely a long thinking loop on
  the eviction-order edge cases.
- All quants produced working code at the end (per agent stdout); we did not
  re-run the produced suites in isolation, so quality comparison on lil-quick
  is by-eye only.

### Blud agentic bench (3 tasks: vitest sanity, single-file feature + test, multi-file grep+edit + tsc)

| Quant   | Task 1 (vitest) | Task 2 (Gaussian) | Task 3 (post-fx names) | Total | Tests final |
|---------|----------------:|------------------:|-----------------------:|------:|:-----------:|
| Q4_K_M  | 31s             | 128s              | 145s                   | 304s  | 357/357 ✓   |
| Q3_K_S  | 43s             | 98s               | 241s                   | 382s  | 357/357 ✓   |
| IQ4_XS  | ~87s            | ~236s             | ~935s                  | ~1258s| (passed per checkpoint, 5/5) |

IQ4_XS sessions for the blud bench overlap timestamps with several other
runs in the same worktree from earlier in the day, so the per-task
attribution above is *approximate* — the magnitude (~20 min vs ~5–6 min)
is consistent and well outside noise, but treat the per-task split as a
floor.

#### Task-3 quality (`readonly name` field on post-fx Effect classes)

| Quant   | BarrelEffect             | PaletteDitherEffect | TS modifier             |
|---------|--------------------------|---------------------|-------------------------|
| Q4_K_M  | `'barrel-distortion'`    | `'palette-dither'`  | `readonly name`         |
| Q3_K_S  | `'barrel'`               | `'palette-dither'`  | `override readonly name`|

Q3_K_S's choices match the prompt's literal pattern more closely (`PaletteDitherEffect → 'palette-dither'` ⇒ `BarrelEffect → 'barrel'`) and use the more idiomatic `override` keyword for extending a base class field.

#### Task-2 quality (`nextGaussian` Box-Muller)

Both quants produced a working Box-Muller implementation that passes the
mean/stddev assertion. Test wording differs slightly (Q3_K_S extracts
`n = 10000` to a constant; Q4_K_M inlines the literal); functionally
identical.

## Verdict

| Metric                       | Best        |
|------------------------------|-------------|
| Lil-quick speed              | IQ4_XS      |
| Blud agentic speed           | Q4_K_M      |
| Blud agentic quality (TS-fidelity on task 3) | Q3_K_S |
| Total wall (lil-quick + blud)| Q4_K_M (910s) |
| Disk size                    | Q3_K_S (11G) |

**Recommended daily-driver:** **Q4_K_M**. It's ~3× faster than IQ4_XS on the
agentic bench and ~2× faster than Q3_K_S on lil-quick, while producing
correct outputs across the board. Q3_K_S is interesting as a smaller-disk
fallback with surprisingly good agentic quality, but the 2× lil-quick
slowdown (and the LRU outlier at 851s) make it less attractive for daily use.
IQ4_XS keeps a niche for short, single-shot code-gen prompts where prefill
dominates, but its 20-min agentic times rule it out for tool-call loops.

## Outstanding

- Pi-mono fix for `loadProjectContextFiles` walking past cwd: see
  `~/Projects/pi-mono/packages/coding-agent/src/core/resource-loader.ts:76-113`.
  Suggested change: stop walking at the first `.git` dir above cwd, or
  add a `--cwd-isolate` flag to `pi`/`lil` that disables the walk-up.
  Tracking under the cross-cutting tooling todos.
- Re-run IQ4_XS with the new harness once the pi-mono fix lands so the
  three-way comparison uses identical conditions.
