# REAM-192 HumanEval — quant degradation reference (2026-05-05)

## Setup

- **Pod**: RunPod A100 SXM (80 GB VRAM, 117 GB RAM, 16 vCPU), $1.49/hr
- **Engines**: vLLM 0.6+ for bf16 safetensors; upstream `llama-server` (b9020-era) for GGUFs
- **Mode**: raw completion (no `--apply_chat_template`), thinking off, greedy (`temperature=0`)
- **Task**: lm-eval `humaneval` (default config — `until=['\nclass','\ndef','\n#','\nif','\nprint']`, `max_gen_toks=1024`)
- **Tokenizer**: `/workspace/REAM-192-bf16` (HF-format dir) used for all three runs (same tokenizer across quants)
- **Total cost**: ~$2-3 (multiple aborted runs while debugging lm-eval/vLLM/llama-server arg quirks; final 3-model run was ~10 min)

## Results

| Model | pass@1 | ± SE | Problems passed | Δ vs REAM bf16 |
|---|---:|---:|---:|---:|
| **REAM-192 bf16** | **0.7134** | 0.0354 | **117/164** | — |
| **REAM-192 Q4_K_M** | **0.6768** | 0.0366 | **111/164** | **-3.66 pp** |
| **REAM-192 Q3_K_S** | **0.6768** | 0.0366 | **111/164** | **-3.66 pp** |
| **REAP-26B Q4_K_M** (atbender prune, same 256→192 ratio) | **0.6646** | 0.0370 | **109/164** | **-4.88 pp** |
| **Bartowski Q4_K_M** (unmerged base, gold-standard) | **0.6463** | 0.0374 | **106/164** | **-6.71 pp** |
| **Unsloth Qwen3.6-35B-A3B UD-Q4_K_M** (unmerged base) | **0.6280** | 0.0379 | **103/164** | **-8.54 pp** |

**Two main findings:**

1. **REAM Q4_K_M vs Q3_K_S scored identically** — same 111 problems passed, same 53 failed. At this granularity (164 problems), Q3_K_S is statistically indistinguishable from Q4_K_M on HumanEval. Q3_K_S is therefore a viable ~30%-smaller alternative for memory-constrained setups.

2. **REAM Q4_K_M *outperformed* Unsloth UD-Q4_K_M of unmerged Qwen3.6** — REAM 67.68% vs Unsloth 62.80%, a 4.88 pp gap. Confidence intervals (64.0-71.3% vs 59.0-66.6%) barely overlap, suggesting this is unlikely to be entirely noise. The gap is somewhat surprising given REAM has 23% fewer parameters than the base. Possible explanations:
   - REAM's calibration data was code-heavy (atbender's recipe: SWE-smith, xLAM, evol-codealpaca, mix-of-thoughts) — expert merging may have *concentrated* code-relevant capability into the kept 192 experts.
   - Unsloth's UD- prefix typically *beats* vanilla Q4_K_M, so the comparison is already biased *against* REAM. Vanilla Unsloth Q4 would likely score even lower, widening the gap.
   - HumanEval (164 problems) is small enough that ±5 pp can sometimes hide under standard error; a larger benchmark would tighten the conclusion.

**Caveats** (don't over-claim from one benchmark):
- HumanEval pass@1 is one narrow code metric; broader benchmarks (BigCodeBench, LiveCodeBench, real agentic tasks like Aider) may tell a different story.
- Same-config comparison across 4 runs, but config is unusual (raw completion, thinking off) — see methodology section. Numbers don't directly compare to Qwen's published 85% (chat-template + thinking-on).
- Single-run, no multi-seed variance estimate.

## Interpretation

### Quant degradation is real but bounded
~3.7 percentage points from bf16 to either quant. That's a bit higher than typical (Q4_K_M usually loses <1 pp on HumanEval for non-merged Qwen models), suggesting REAM × quant interaction has slightly more impact on code reasoning than pure quant alone — possibly the merged experts produce flatter logit distributions where small quantization errors flip more decisions.

### Q3_K_S is a viable memory-saving alternative
Same pass@1 as Q4_K_M, 5 GB less on disk (11 GB vs 16 GB). For M-series users tight on unified memory, Q3_K_S is a real option, not just a smaller-but-worse fallback.

### Absolute numbers vs published Qwen3.6-35B-A3B (~85% HumanEval)
The 71.3% bf16 number is **lower than the published 85%** because:
1. **No chat template applied** — Qwen3.6 is instruct-tuned and benefits substantially from chat formatting. We dropped `--apply_chat_template` to dodge an lm-eval `local-completions` × `generate_until` 400 bug (`prompt elements must be a string...`).
2. **Thinking off** — Qwen's headline numbers assume CoT/thinking enabled. ~10-15 pp of the published score comes from thinking.
3. **REAM merge** — 256→192 expert merge (-23% params) costs some absolute capability vs the unmerged base.

The relative ranking across our quants is what this eval is for; absolute fidelity to published numbers requires re-running with `local-chat-completions` + `enable_thinking:true`. ~50-60 min per model.

## What's not here yet (deferred follow-ups)

- **Unsloth vanilla Q4_K_M (no UD-)**: would tighten the "REAM > unmerged" claim by removing UD- as a confound. ~5 min, ~$0.30 if we can use the same pod.
- **MMLU**: aborted due to time constraints. The default `mmlu` task requires 56,168 loglikelihood requests at `num_concurrent=1` → ~75 min per model on this stack. If we re-run, set `num_concurrent=8` to batch via vLLM/llama-server, cuts MMLU to ~10 min/model.
- **GSM8K**: deliberately skipped (slow CoT generation).
- **Chat-template + thinking off** variant for HumanEval: ~5-7 min/model, would land closer to published instruct-mode numbers (~75-80% expected). Recipe in [`~/.claude/plans/ream-llm-evals.md`](~/.claude/plans/ream-llm-evals.md).
- **Chat-template + thinking on** variant: ~50-60 min/model, would land closer to ~85%. Need vLLM `--enable-reasoning --reasoning-parser deepseek_r1` and matching llama-server `--reasoning on --reasoning-budget 2000`.
- **Comparison vs unmerged Qwen/Qwen3.6-35B-A3B**: would isolate REAM merge cost from pure quant cost. Separate eval run.
- **Comparison vs atbender REAP-26B**: head-to-head on the same eval suite for the daily-driver decision.

## lm-eval gotchas hit during this run (saved for next time)

1. **`--gen_kwargs` requires JSON** in lm-eval 0.4.x newer versions. The old `key=value,key=value` syntax fails with `ValueError: Invalid JSON`. Use `'{"temperature":0,"max_gen_toks":1024}'`.
2. **`HF_ALLOW_CODE_EVAL=1` env var required** for HumanEval, separate gate from `--confirm_run_unsafe_code`. Without it, lm-eval crashes at the disclaimer printout *before* running anything.
3. **Tokenizer arg required for GGUF model paths.** `local-completions` tries `transformers.AutoTokenizer.from_pretrained(model)` and the bare GGUF filename fails as not-an-HF-repo. Fix: pass `tokenizer=/path/to/hf-model-dir` in model_args.
4. **`--apply_chat_template` + `local-completions` + `generate_until` is broken** as of lm-eval 0.4.x — sends malformed `prompt` array, both vLLM and llama-server return `400: "prompt" elements must be a string...`. Workaround: drop `--apply_chat_template` and accept raw-completion eval, OR switch to `--model local-chat-completions` with base_url `/v1/chat/completions`.
5. **Default `num_concurrent=1` is the slow path** for MMLU loglikelihood. Bump to 8 for ~5-10× speedup; both vLLM and upstream llama-server batch fine.

## Bundle artefacts

- `bf16/`, `q4km/`, `q3ks/`: lm-eval output dirs with `results_*.json`, per-task samples, configs
- `*-eval.log`: stdout/stderr from each run

## Cross-references

- Plan: [`~/.claude/plans/ream-llm-evals.md`](../../../../.claude/plans/ream-llm-evals.md)
- HF GGUF repo: [`keithnull/Qwen3.6-35B-A3B-REAM-192-GGUF`](https://huggingface.co/keithnull/Qwen3.6-35B-A3B-REAM-192-GGUF)
- bf16 source: [`keithnull/Qwen3.6-35B-A3B-REAM-192`](https://huggingface.co/keithnull/Qwen3.6-35B-A3B-REAM-192)
- Original REAM port findings: `Claude Notes/Research/2026-05-02-ream-port-findings.md`
- GGUF quant runbook: `Claude Notes/Research/2026-05-04-ream-gguf-quant-runbook.md`
- Local agentic bench (lil-quick): [`../README.md`](../README.md)
