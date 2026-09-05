# 2026-05-13 perf audit bench — empirical results

Bench artifacts from the four-way head-to-head probe run after the 3-agent GLM-5.1 audit of `TheTom-llama-cpp-turboquant @ feature/turboquant-kv-cache`.

## Setup

- **Hardware**: Apple M3 base, unified memory
- **Model**: `Qwen3.6-35B-A3B-REAM-192-heretic-APEX-Mini-IQ2_S.gguf` (10 GB, mixed quant: 35.5% Q3_K + 22.4% Q4_K + 35.0% IQ2_S + 6.6% other)
- **Wrapper**: `/opt/homebrew/bin/llama-serve-lil` (production defaults: turbo3 V, q8_0 K, ngram-simple spec decode, cache-reuse=256, mmproj loaded for vision, 65K ctx)
- **Probe**: identical `/v1/chat/completions` request — TypeScript linked-list reversal task, `max_tokens: 250`, `temperature: 0.0`. Warmup discarded.
- **Methodology limitation**: single-shot probes. Variance band ~3% from background system noise. Multi-run averaging recommended for sub-5% effect detection.

## Results

| Variant | tok/s decode | Δ baseline | Notes |
|---|---|---|---|
| **baseline** (production) | **24.06** | — | `bench-baseline.json` |
| F1 prototype (`N_R0_Q3_K`+`N_R0_Q4_K`: 2→4) | 23.94 | -0.5% | `bench-f1.json` — built from `perf/f1-q4k-q3k-nr0-bump` worktree |
| `LIL_CTV=turbo2` | 23.63 | -1.8% | `bench-t02.json` — KV buffer 450 MiB (vs ~520 MiB at turbo3) |
| `TURBO_FLASH=1` | 23.44 | -2.6% | `bench-t03.json` — activation unconfirmed in log |

All four within the ~3% single-shot variance band. **No clear win from the audit's predicted kernel/cache-type optimizations on this specific workload + quant.**

## MTP smoke test (separate)

Same hardware, different model — `havenoammo/Qwen3.6-35B-A3B-MTP-UD-Q2_K_XL.gguf` (12 GB, vanilla 256-expert + MTP layer), built `am17an/mtp-clean` branch (PR #22673 source).

| Variant | tok/s | Acceptance | File |
|---|---|---|---|
| `--spec-type none` (baseline) | 23.11 | — | `baseline-run.json` |
| `--spec-type draft-mtp --spec-draft-n-max 3` | 24.85 | 98.8% (165/167) | `mtp-run1.json` |

**MTP works on Metal architecturally (+7.5% wall-clock)** but bottlenecked by full KV checkpoint on Metal (per server log: `common_context_can_seq_rm: the context does not support partial sequence removal`). Real Metal-MTP unlock requires PR #22400 (GDN partial rollback) porting to Metal.

**Important caveat**: smoke test was at 8K ctx. Checkpoint overhead scales linearly with ctx — at 65K production ctx, MTP may regress.

## Decisions ratified by these results

- **DON'T merge F1 into daily.** Within noise; possibly regressing due to register pressure on the changed kernels. Worktree at `~/Projects/TheTom-llama-cpp-turboquant-perf-f1/` kept for future bench on Q4_K_M-only models.
- **DON'T flip TURBO_FLASH=1 by default.** No measurable win + activation unconfirmed + quality risk (Apple10 corruption history).
- **DON'T graft 256-expert MTP onto REAM-192.** Expert-count mismatch is structural; would need MTP-block re-pruning.
- **DO keep waiting** for PR #22400 to port to Metal — that's the real spec-decode unlock for Qwen 3.6.
- **DO investigate expert pre-fetch** (Task 3 M1) — the only remaining high-impact lever (+30-40% predicted, multi-day project).

## Related notes

- Planning: [[2026-05-13-llama-cpp-perf-test-plan]] (3 revisions, all empirical updates folded in)
- Audit findings: [[2026-05-13-llama-cpp-perf-audit-metal-kernels]], [[2026-05-13-llama-cpp-perf-audit-kv-cache]], [[2026-05-13-llama-cpp-perf-audit-specdec-moe]]
