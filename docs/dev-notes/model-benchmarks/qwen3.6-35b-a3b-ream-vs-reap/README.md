# Qwen3.6-35B-A3B-REAM-192 vs REAP-26B GGUF — local agentic bench

Date: 2026-05-04

## Models

- **REAM-192**: [keithnull/Qwen3.6-35B-A3B-REAM-192-GGUF](https://huggingface.co/keithnull/Qwen3.6-35B-A3B-REAM-192-GGUF) — Qwen3.6-35B-A3B with 256→192 routed experts via REAM expert merging (35.11B → 27.05B params, vision tower + MTP preserved)
- **REAP-26B (baseline)**: [atbender/Qwen3.6-VL-REAP-26B-A3B](https://huggingface.co/atbender/Qwen3.6-VL-REAP-26B-A3B) — same source model with REAP expert pruning at the same 256→192 ratio. Existing daily-driver.

## Bench harness

`scripts/model-benchmark-lil-quick.sh` — 2 standalone code-gen tasks:
1. **SeededRng** — implement Mulberry32 PRNG class with util methods + tests
2. **LRU cache** — generic `LRUCache<K,V>` with O(1) get/set + MRU iteration + tests

## Results

| Run | Mode | Task 1 (SeededRng) | Task 5 (LRU) | Total | Files Task 1 | Files Task 5 |
|---|---|---:|---:|---:|---:|---:|
| **REAP Q4_K_M** (Apr-27 baseline) | FSM-think | 322s | 284s | **606s** | 7 | 7 |
| REAM Q3_K_S (today) | thinking-off | 490s | ~770s | ~1260s | 2 | 4 |
| **REAM Q4_K_M** (today) | free-form + budget=1500 | 644s | 792s | **1436s** | 6 | 6 |

REAP-IQ4_XS and other prior data points: see [../qwen3.6-vl-reap-26b-headtohead/README.md](../qwen3.6-vl-reap-26b-headtohead/README.md).

## Bench config (REAM today)

| | REAP head-to-head (Apr-27) | REAM Q3_K_S | REAM Q4_K_M |
|---|---|---|---|
| Server | TheTom-llama-cpp-turboquant | TheTom (-ngl 35 fallback) | TheTom (with reasoning-budget fix) |
| ctx | 65536 | 32768 | 32768 |
| KV | q8_0 / turbo3 | q8_0 / turbo3 | q8_0 / turbo3 |
| Spec decode | ngram-simple (8/2/0.75) | ngram-simple | ngram-simple |
| Thinking mode | FSM-think (TRIPLET) | thinking-off | free-form + reasoning-budget=1500 |
| `-ngl` | 99 | 35 (then 99 once stable) | 99 |

## Key takeaways

### REAM Q4_K_M produces noticeably more thorough output

Both Task 1 and Task 5 generated **full TypeScript projects** (package.json, tsconfig, vitest config, implementation, comprehensive test files). Task 1's `seeded-rng.test.ts` is a 32-test file across 7 groups (Determinism, nextInt, nextFloat, nextBool, pick, shuffle, fork). Task 5 covered MRU iteration, FIFO eviction, capacity edge cases, zero/negative capacity throws, number keys + object reference identity. Quality is high.

By comparison the REAM-Q3_K_S-thinking-off Task 1 produced 2 files (impl + tests, no project setup). The thinking budget here is being used to plan more complete deliverables.

### REAM is ~2.4× slower than REAP-FSM-think on this bench

Most of that gap is **mode**, not the merge. Free-form thinking with a 1500-token budget generates substantially more tokens than FSM-think's ~50-200 cap. For a true mode-matched comparison we'd need to run REAP with `--reasoning-budget 1500` and free-form thinking — that's the next experiment if we want to isolate merge effects from mode effects.

### Findings out of the investigation (worth noting standalone)

1. **REAM + FSM-think: incompatible.** Structured-CoT autoparser grammar requires non-empty 1-5 GOAL/APPROACH/EDGE triplets. REAM's expert merging dilutes the thinking-specialized experts → emits empty/short blocks → 500 server error.
2. **Free-form thinking + V-quant KV: termination broken on Qwen3.6 in general.** Q8_0 V (and turbo3 V) corrupts attention's ability to recognize "I already wrote the answer," causing infinite reasoning loops on simple prompts. Confirmed on both REAM and REAP — not merge-specific. FP16 KV terminates correctly. FSM-think masks this entirely (grammar enforces structure).
3. **TheTom fork's `--reasoning-budget` was broken under spec decoding.** Clone bug in `common_reasoning_budget_clone` reset `remaining` to full budget every spec batch → never exhausted. **Fixed** in [goblincore/llama-cpp-turboquant#1](https://github.com/goblincore/llama-cpp-turboquant/pull/1). Working stack now: q8_0/turbo3 KV + ngram-simple spec + reasoning-budget enforcement = bounded free-form thinking.
4. **Metal OOM on REAM Q3_K_S at ctx=65536.** Slight 1GB delta over REAP-26B Q3_K_S pushes over the 24GB unified memory limit at full GPU offload. Drop to ctx=32768 (still well above bench task needs).

## What's still open

- **REAP-Q4_K_M re-run with free-form + budget=1500** (mode-matched control — would isolate merge effects vs mode effects in the timing delta)
- **REAM agentic bench** (`model-benchmark-blud.sh`, 3 agentic tasks against blud worktree) — couldn't run today; thinking-mode behavior on long agentic loops is unknown
- **Academic eval** (MMLU + GSM8K + HumanEval) — still deferred from the REAM port session
- **REAM Q4_K_M as daily-driver candidate** — quality looks good by inspection but 2.4× slower vs REAP-FSM means longer agentic sessions; may need budget tuning down (e.g. 800?) to find the speed/quality sweet spot
- **PPL + KL-divergence vs bf16 reference** for both REAM quants (matches the REAP head-to-head methodology)

## Artefacts

- `ream-q3ks-2026-05-04-timings.json` — Q3_K_S thinking-off timings (task5 partially reconstructed)
- `ream-q3ks-2026-05-04-task{1,5}/` — Q3_K_S workdirs + lil stdout/stderr
- `ream-q4km-2026-05-04-timings.json` — Q4_K_M timings (canonical)
- `ream-q4km-2026-05-04-task{1,5}/` — Q4_K_M workdirs + lil stdout/stderr

## Cross-references

- Runbook + lessons (Obsidian): `Claude Notes/Research/2026-05-04-ream-gguf-quant-runbook.md`
- REAM port findings (Obsidian): `Claude Notes/Research/2026-05-02-ream-port-findings.md`
- Local stack config (Obsidian): `Claude Notes/Infra/2026-05-01-lil-pi-localllm-config.md`
- Prior REAP head-to-head: `../qwen3.6-vl-reap-26b-headtohead/README.md`
