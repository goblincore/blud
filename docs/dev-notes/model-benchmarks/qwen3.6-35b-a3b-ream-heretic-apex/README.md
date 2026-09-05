# Heretic-APEX-ICompact-Q3_K_L — local code-gen smoke test

**Bundle date:** 2026-05-09
**Model under test:** [`keithnull/Qwen3.6-35B-A3B-REAM-192-heretic-APEX-GGUF`](https://huggingface.co/keithnull/Qwen3.6-35B-A3B-REAM-192-heretic-APEX-GGUF) — file `Qwen3.6-35B-A3B-REAM-192-heretic-APEX-ICompact-Q3_K_L.gguf` (12.4 GB).

## What this is

A small-scale single-run shakedown of the APEX **I-Compact** tier against
a real coding workload. **Not a benchmark** — sample sizes are tiny,
n=1 per task, single by-eye rater. The point is to confirm the recipe
survives an agentic workload without obvious breakage, ahead of the
real evals (PPL/KLD vs the bf16 reference, and academic suites
MMLU/GSM8K/IFEval/HumanEval) that are still on the validation TODO list
for this model card.

## What this can support saying

The I-Compact recipe runs end-to-end through Read/Grep/Edit/Bash + self-
verify loops on a real ~360-test TypeScript repo and produces diffs
that pass `vitest` and `tsc --noEmit` on every task tried (5/5).
Pre-bench probes (no-think + thinking with a reasoning budget)
terminated cleanly — no V-quant attention loops despite running on a
KV configuration (`q8_0` keys / `turbo3` values) that historically
caused vanilla REAM-192 to loop without the
[reasoning-budget clone fix](https://github.com/goblincore/llama-cpp-turboquant/pull/1)
for free-form thinking.

## What this cannot support saying

- Quality vs other APEX tiers (IBalanced / IQuality / Mini / Compact
  not benched here).
- Quality vs vanilla REAM-192 Q4_K_M on agentic loops — that comparison
  has never been run on this harness; it's still on the deferred list
  for the parent REAM-192 release.
- Anything about academic-eval scores or PPL/KLD vs the bf16 reference.
- Anything about consistency. n=1 per task.

## Setup

- **Inference**: `llama-server` from
  [goblincore/llama-cpp-turboquant](https://github.com/goblincore/llama-cpp-turboquant)
  (a fork of upstream llama.cpp with asymmetric K/V cache quantization,
  ngram speculative decoding, and a reasoning-budget sampler).
- **KV cache**: `--ctk q8_0 --ctv turbo3`.
- **Speculative decode**: `--spec-type ngram-simple --draft-max 8 --draft-min 2 --draft-p-min 0.75`.
- **Context**: 32768 tokens.
- **Reasoning**: free-form (`<think>…</think>`) with `--reasoning-budget 1500`.
  REAM-family Qwen3.6 is incompatible with the FSM-think 3-line grammar
  variant of this fork (the merged thinking experts produce empty/short
  blocks that fail the GOAL/APPROACH/EDGE grammar) so free-form is the
  workaround.
- **Bench harness**: a 5-task split between (a) two standalone
  TypeScript code-gen tasks (no agent loop, no real repo) and (b) three
  agentic tasks running the `lil` coding agent against a checked-out
  game repo's worktree with ~360 vitest tests as the integrity check.

GGUF metadata reports `general.name="Heretic Out"`, `n_expert=192`,
`file_type=Q4_K_Medium` dominant, BPW 4.02. The `Q3_K_L` filename
suffix is a UX hint for HF's parser; the actual content is mixed-
precision per the APEX recipe (Q4_K edge / Q3_K middle routed experts
+ Q6_K shared expert + Q4_K attention + imatrix scales).

## Pre-bench probes

| Probe | Mode | Outcome |
|---|---|---|
| `"The capital of France is"` | no-think | `"The capital of France is **Paris**."` ✓ |
| `"What is 17 * 23? Reason briefly then answer."` | thinking, budget=1500 | 1804-char reasoning → `"391"`, `finish_reason=stop` ✓ |

## Standalone code-gen (lil-quick)

The agent is given a single coding prompt with no tools, no repo, no
self-verify loop. It writes source + a vitest suite into a fresh tmp
directory.

| Task | Prompt summary | Time | Files written | Tests passed (run after) |
|---|---|---:|---:|:---|
| 1 | `SeededRng` class with mulberry32 PRNG, `next/nextInt/nextFloat/nextBool/pick/shuffle/fork`, plus a vitest suite covering each method | 670 s | 6 | **19 / 19** ✓ |
| 5 | `LRUCache<K,V>` generic with `get/set/has/delete/size/entries`, MRU-ordered iteration, eviction on capacity overflow, plus a vitest suite | 315 s | 5 | **14 / 14** ✓ |
| | **Total** | **985 s** | | **33 / 33** ✓ |

(Tasks 2–4 of the lil-quick suite aren't run by `model-benchmark-lil-quick.sh`;
the "5" label is preserved from the larger 5-task suite for cross-run continuity.)

Source snapshots in [`heretic-apex-q3kl-task1/workdir/`](./heretic-apex-q3kl-task1/workdir)
and [`heretic-apex-q3kl-task5/workdir/`](./heretic-apex-q3kl-task5/workdir).

## Agentic (blud bench)

The agent uses `lil` (a Read/Grep/Edit/Bash coding agent) against a
worktree of a real TypeScript game repo. The worktree has 26 test
files / 356 vitest tests at baseline. After each task the script
captures `git diff`, the post-task vitest run, and the agent's
stdout. The worktree is reset between tasks.

| # | Task | Time | Files chg | Diff | Final test result |
|---|---|---:|---:|---:|:---|
| 1 | **Tool-use sanity** — run `npx vitest run` and report (a) pass count and (b) the 3 longest test files. Read-only. | 28 s | 0 | — | 356 / 356 untouched; pass count + file ranking reported correctly |
| 2 | **`SeededRng.nextGaussian`** — add a Box-Muller `nextGaussian()` method to `src/engine/rng.ts`, write a stats test asserting 10 000 samples have `\|mean\| < 0.1` and `\|stddev − 1\| < 0.1`, run vitest, fix and rerun if it fails | 313 s | 2 | +37 / −1 | **357 / 357** ✓ |
| 3 | **Post-fx names** — find every `Effect` subclass in `src/vfx/post-fx/`, add `readonly name: string` initialised to a kebab-case form of the class name, confirm `npx tsc --noEmit` is clean | 138 s | 2 | +4 / −0 | 356 / 356 ✓ + tsc clean |
| | **Total** | **479 s** | | | **3 / 3 clean** |

Per-task raw artefacts:

- `heretic-apex-q3kl-task{1,2,3}-stdout.log` — the agent's
  user-facing output (markdown summaries it produced).
- `heretic-apex-q3kl-task{1,2,3}-stderr.log` — agent tool-use trace.
- `heretic-apex-q3kl-task{1,2,3}-diff.patch` — full unified diff of
  the worktree post-task.
- `heretic-apex-q3kl-task{1,2,3}-diffstat.txt` — diffstat summary.
- `heretic-apex-q3kl-task{1,2,3}-gitstatus.txt` — `git status -s` post-task.
- `heretic-apex-q3kl-task{1,2,3}-test.log` — `npx vitest run` output post-task.

`heretic-apex-q3kl-timings.json` is the machine-readable summary of
the lil-quick wall-times.

### Code-quality observations (single-rater, by-eye)

**Task 2** — Box-Muller. The agent wrote more than the prompt asked for:

```ts
private _gaussianCache: number | null = null;

nextGaussian(): number {
  if (this._gaussianCache !== null) {
    const val = this._gaussianCache;
    this._gaussianCache = null;
    return val;
  }
  let u1: number, u2: number;
  do { u1 = this.mulberry32(); u2 = this.mulberry32(); } while (u1 === 0);
  const r = Math.sqrt(-2.0 * Math.log(u1));
  const theta = 2.0 * Math.PI * u2;
  this._gaussianCache = r * Math.cos(theta);
  return r * Math.sin(theta);
}

fork(): SeededRng {
  const copy = new SeededRng(this.state);
  copy._gaussianCache = this._gaussianCache;
  return copy;
}
```

The cached-second-sample is library-grade Box-Muller (numpy / Boost do
this); textbook pseudocode usually returns one of the pair and discards
the other. The agent also patched `fork()` to copy `_gaussianCache` —
without that, a forked RNG mid-pair would silently diverge from its
parent on the next `nextGaussian()` call. None of this was prompted.
The `do…while (u1 === 0)` `log(0)` guard is also unprompted.

**Task 3** — found exactly the two `Effect` subclasses
(`BarrelEffect`, `PaletteDitherEffect`) in the post-fx directory,
skipped the helpers (`composer`, `config`, `dev-panel`, `bus`), used
the TypeScript `override` modifier because the base `Effect` class
already declares a `name` field. Chosen names are kebab-case
(`'barrel-distortion'`, `'palette-dither'`); `'barrel-distortion'`
is a slight liberty over the prompt's strict template (which would
suggest plain `'barrel'`).

### Anomaly worth noting

Task 2 spent ~80 s at the start reading `~/.pi/agent/AGENTS.md` →
`~/Projects/pi-mono/packages/coding-agent/README.md` (twice; ~5 k
tokens of context burn) before settling on the actual task files.
This is a pre-existing bug in the `lil`/`pi` resource-loader that
walks past the worktree's `.git` boundary and pulls in unrelated
parent-repo context. Not a model issue; same behaviour was logged on
prior REAP-26B runs.

Strip that wandering and the actual coding-loop time on Task 2 drops
to ~230 s.

## Comparison points (with caveats)

|  | Heretic-APEX I-Compact (this) | Vanilla REAM-192 Q4_K_M | REAP-26B Q4_K_M (prior daily driver) |
|---|---|---|---|
| Disk size | 12.4 GB | 15 GB | 15 GB |
| Lil-quick total | **985 s · 33 / 33** | 1436 s · ?/? | 606 s · 5 / 5 |
| Agentic total | **479 s · 3 / 3** | not yet run | 304 s · 3 / 3 |

**Caveats:**

- Vanilla REAM Q4_K_M lil-quick (1436 s) was run under the same
  free-form + `reasoning-budget=1500` config as this run, so that
  cell is apples-to-apples on configuration (different model, same
  harness mode).
- Vanilla REAM Q4_K_M was **never run on the agentic harness** — that
  cell is a real gap in our data, not an oversight of this bundle.
- REAP-26B is a different recipe (REAP expert pruning vs REAM expert
  merging), a smaller effective model at the same disk footprint, and
  was benched in FSM-think mode (REAM is incompatible with FSM-think,
  hence free-form here). Treat the comparison as "what does a
  daily-driver-class model look like at this size on this hardware"
  rather than as a recipe-vs-recipe judgement.

---

## Update 2026-05-12 — three-tier APEX recipe comparison

Same harness as the 2026-05-09 single-run, same prompts, same worktree
(`HEAD = 1972c9f`, 26 test files / 356 vitest tests at reset), same
config (`-ctk q8_0 -ctv turbo3 -fa on`, `--spec-type ngram-simple
--draft-max 8 --draft-p-min 0.75`, free-form thinking with
`--reasoning-budget 1500`, ctx 32768). Two new tiers added:

- **Mini-IQ2_S** (10.31 GiB, **3.33 BPW** — most aggressive: IQ2_S
  routed experts + higher-precision shared/attn per the APEX recipe).
- **IQuality-Q5_K_M** (16.40 GiB, **5.30 BPW** — least aggressive of
  the released tiers).
- I-Compact-Q3_K_L (12.4 GiB, ~4.02 BPW) is the 2026-05-09 baseline,
  unchanged.

Same n=1, single-rater caveats as the original bundle apply.

### Lil-quick (standalone code-gen)

| Task | Mini-IQ2_S | I-Compact-Q3_K_L | IQuality-Q5_K_M |
|---|---|---|---|
| T1 SeededRng | **509 s · 25/25 ✓** | 670 s · 19/19 ✓ | 576 s · 13/13 ✓ |
| T5 LRUCache | **164 s · 8/8 ✓** | 315 s · 14/14 ✓ | 235 s · 12/12 ✓ |
| **Total** | **673 s · 33/33** | 985 s · 33/33 | 811 s · 25/25 |

### Blud agentic (3 tasks against blud worktree)

| # | Task | Mini-IQ2_S | I-Compact-Q3_K_L | IQuality-Q5_K_M |
|---|---|---|---|---|
| 1 | Tool-use sanity | 39 s · 356/356 untouched | 28 s · 356/356 untouched | 26 s · 356/356 untouched |
| 2 | `nextGaussian` | 152 s · 357/357 ✓ | 313 s · 357/357 ✓ | **87 s · 357/357 ✓** |
| 3 | post-fx names | 154 s · 356/356 ✓ + tsc clean | 138 s · 356/356 ✓ + tsc clean | 246 s · 356/356 ✓ + tsc clean |
|   | **Total** | **345 s · 3/3** | 479 s · 3/3 | 359 s · 3/3 |

### Grand total wall-time

| | Mini-IQ2_S | I-Compact-Q3_K_L | IQuality-Q5_K_M |
|---|---|---|---|
| Combined lil-quick + agentic | **1018 s** | 1464 s | 1170 s |
| vs I-Compact baseline | −30 % | — | −20 % |

**Mini is the fastest tier despite the most aggressive quantization.**
Larger weights don't translate linearly into longer wall-times here —
the bigger-recipe models often need fewer reasoning tokens to settle,
and that effect more than offsets the higher per-token cost on M3.

### Code-quality deltas (single-rater eye-pass)

**T1 SeededRng test breadth** — counterintuitive ordering by test count:
*Mini wrote the most* (25 tests, incl. statistical checks for
`p=0.5 returns ~half`, negative-range handling, multi-fork
independence), I-Compact 19, IQuality 13. IQuality went minimum-viable;
Mini and I-Compact were thorough. Mini's `pick(empty)` returns
`undefined` rather than throwing — both reasonable readings of the
prompt; I-Compact and IQuality threw.

**T5 LRUCache test breadth** — opposite ordering: I-Compact 14,
IQuality 12, **Mini 8**. Mini covers the core semantics
(get/set, eviction, MRU promote, delete, has, access-order) but
skips `size`, `clear`, repeated-set-on-existing-key, and post-delete
behavior. Adequate; lightest of the three.

**T2 Box-Muller fork-state regression** — only I-Compact patched
`fork()` to copy the cached-Gaussian state. Both Mini and IQuality
implemented the cached-pair correctly but left a silent-correctness
hole: a forked RNG mid-pair will diverge from its parent on the next
`nextGaussian()` call. Not caught by their own tests (they all spawn
fresh RNGs). Real-game flake risk if `fork()` is called between paired
draws. **I-Compact is the only tier that caught this without being
prompted.**

Mini's Box-Muller cleverly caches **magnitude + angle** rather than the
spare scalar, then alternates `cos`/`sin` from the same `(u1, u2)`
pair — slightly more compact in state than the canonical `hasSpare`
pattern, mathematically equivalent.

**T3 post-fx names** — Mini and IQuality produced **byte-identical**
diffs (`override readonly name = 'barrel'` and `'palette-dither'`).
Both diverge from baseline I-Compact, which chose `'barrel-distortion'`
— Mini/IQuality's reading hews closer to the prompt's literal
"kebab-case form of the class name" (`BarrelEffect` → `barrel`).

### What this can and cannot support saying

**Can:**

- All three APEX tiers complete the same lil-quick + agentic harness
  with zero V-quant attention loops, zero hung tool calls, and 100 %
  test-pass on every emitted suite under the asymmetric
  `q8_0` / `turbo3` KV.
- Mini-IQ2_S is the fastest of the three on this hardware (M3 Metal,
  32 K ctx) despite the most aggressive quantization.
- I-Compact is the only tier whose Box-Muller implementation handled
  `fork`-state propagation without being asked.

**Cannot:**

- Quality vs Compact-Q3_K_L (the *non-imatrix* counterpart) — not
  benched.
- Quality vs IBalanced-Q5_K_M — not benched.
- Long-context behavior (>30 K agent history) — bench prompts are
  small.
- Long-loop agentic recovery — bench tasks are 1-3 tool calls each;
  multi-turn debug-and-iterate behavior is untested.
- Math-heavy structured reasoning — bench tasks are mostly mechanical.
- Anything about PPL/KLD vs the bf16 reference. Still on the TODO list.
- Anything about consistency — n=1 per cell.

### Per-tier artefacts (this update)

- `heretic-apex-mini-iq2s-timings.json` + per-task workdirs/diffs
- `heretic-apex-iquality-q5km-timings.json` + per-task workdirs/diffs

(Naming pattern matches the 2026-05-09 baseline:
`heretic-apex-<tier>-{lil-quick,task1-3}-*`.)

### Suggested daily-driver position (subjective)

| Tier | Best for | Watch-outs |
|---|---|---|
| **Mini-IQ2_S** | "Fast tier" for quick iteration on simple agent loops. ~30 % faster than I-Compact, no observed test failures. | Untested on long agentic loops and high-context attention. 2-bit routed experts may compound errors over many tool calls. |
| **I-Compact-Q3_K_L** | Conservative daily driver. Only tier that caught the `fork`-state subtlety unprompted. | Slowest of the three. |
| **IQuality-Q5_K_M** | Maximum-quality safety margin, only 13 % slower than Mini. | 16 GB on disk; needs ctx ≤32 K to stay comfortable on 24 GB M3. Box-Muller `fork`-state still missed. |
