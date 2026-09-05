# Snippet for [keithnull/Qwen3.6-35B-A3B-REAM-192-GGUF](https://huggingface.co/keithnull/Qwen3.6-35B-A3B-REAM-192-GGUF) model card

Insert this section between the **Files** and **Method** sections of the existing README. The Files table can be merged into the new comparison table since it now serves both purposes.

---

## Preliminary HumanEval comparison

> ⚠️ **Read the caveats below before drawing conclusions.** This is a *relative* quant-quality reference, not an absolute capability benchmark. Numbers do not directly compare to published Qwen3.6-35B-A3B HumanEval scores (which use chat template + thinking enabled).

### Results (HumanEval pass@1, raw completion, greedy, thinking off)

| Model | Compression | Disk | pass@1 | ± SE | Notes |
|---|---|---:|---:|---:|---|
| **Qwen3.6-35B-A3B-REAM-192 bf16** (reference) | 256→192 experts (REAM merge) | ~52 GB | **0.7134** | 0.0354 | Our bf16 source; reference for quant degradation |
| **Qwen3.6-35B-A3B-REAM-192 Q4_K_M** *(this repo)* | + Q4_K_M quant | **16 GB** | **0.6768** | 0.0366 | Daily-driver candidate |
| **Qwen3.6-35B-A3B-REAM-192 Q3_K_S** *(this repo)* | + Q3_K_S quant | **11 GB** | **0.6768** | 0.0366 | Same pass@1 as Q4_K_M; ~30% smaller |
| **REAP-26B Q4_K_M** ([atbender prune](https://huggingface.co/atbender/Qwen3.6-VL-REAP-26B-A3B), same 256→192 ratio) | 256→192 experts (REAP prune) | ~15 GB | **0.6646** | 0.0370 | Direct merge-vs-prune comparison at same compression |
| **Bartowski Q4_K_M** (unmerged base, community gold-standard) | None + Q4_K_M | ~17 GB | **0.6463** | 0.0374 | Reference for "vanilla quant of full unmerged model" |
| Unsloth Qwen3.6-35B-A3B UD-Q4_K_M (unmerged base) | None + UD-Q4 | ~21 GB | 0.6280 | 0.0379 | Unsloth's dynamic-quant variant of the full unmerged model |

### Headline reads

1. **Q3_K_S = Q4_K_M on this benchmark.** Both passed exactly 111/164 problems. At ~30% smaller disk footprint (11 GB vs 16 GB), Q3_K_S is a viable memory-constrained alternative for code work.
2. **Ordering on this benchmark: REAM > REAP > unmerged base.** REAM Q4 (67.68%) edged out REAP Q4 at the same compression ratio (66.46%) by 1.22 pp — directionally consistent with the [REAM paper's claim](https://bknyaz.github.io/blog/2026/moe/) that "merging > pruning at the same expert reduction ratio," but well within statistical noise on a single 164-problem run. Both expert-reduction techniques outperformed Bartowski's gold-standard vanilla Q4_K_M of the unmerged base (64.63%) by 2-3 pp.

3. **Calibration data likely did real work.** Both REAM and REAP used [atbender's code-heavy recipe](https://huggingface.co/atbender/Qwen3.6-VL-REAP-26B-A3B) (SWE-smith, xLAM, evol-codealpaca, mix-of-thoughts). Plausible that this concentrated code-relevant capability into the kept 192 experts, partially offsetting the parameter-count loss. A non-code-calibrated REAM/REAP variant would likely score lower on HumanEval but better elsewhere.

4. **REAM Q4_K_M reaches the unmerged-base's quality floor at notably smaller disk** — 16 GB vs 17 GB (Bartowski) or 21 GB (Unsloth UD). For memory-constrained users, REAM Q4 (or even Q3) is a quality-preserving size win.

**Caveats**: confidence intervals overlap substantially (REAM 64.0-71.3% vs REAP 62.8-70.2% vs Bartowski 60.9-68.4%), so all of the above is *directional* on this single benchmark. Ranking could shift on broader code benchmarks or with multi-seed sampling.
3. **bf16 → Q4_K_M loses ~3.7 pp**; **Q4_K_M → Q3_K_S loses 0 pp** on this benchmark.

### Methodology (what's being measured)

- **Task**: lm-eval-harness `humaneval` (164 problems, OpenAI 2021)
- **Decoding**: greedy (`temperature=0`), `max_gen_toks=1024`
- **Mode**: **raw completion** (no `--apply_chat_template`), thinking off
- **Stop sequences**: lm-eval default (`'\nclass', '\ndef', '\n#', '\nif', '\nprint'`)
- **Inference engines**: vLLM 0.6+ for bf16, upstream `llama-server` (b9020-era, CUDA build) for GGUFs
- **Tokenizer**: shared (`/workspace/REAM-192-bf16` HF dir) across all GGUF runs to ensure consistent tokenization client-side
- **Hardware**: RunPod A100 SXM (80 GB VRAM), one model at a time

### Why these numbers don't match published Qwen3.6 HumanEval (~85%)

- **No chat template applied.** Qwen3.6 is instruct-tuned and benefits substantially from its chat formatting (typically +5-10 pp). We dropped `--apply_chat_template` because lm-eval 0.4.x's `local-completions` adapter has a known bug with chat-formatted `generate_until` requests (sends malformed `prompt` array → server returns 400). A chat-template-aware variant of this eval is on the follow-up list.
- **Thinking off.** Qwen's headline 85% number assumes CoT/thinking enabled. Disabling thinking for this eval costs ~10-15 pp.
- **Default lm-eval task config.** The `humaneval` task's stop sequences and prompt format are designed for *base models doing raw code completion*. Instruct models like Qwen3.6 lose points by emitting natural-language preamble before the function body that doesn't match these stops.

### Caveats — don't over-claim from this single benchmark

1. **One narrow code metric.** HumanEval pass@1 is one of many code-quality benchmarks. Broader coverage (BigCodeBench, LiveCodeBench, real agentic tasks like Aider) may show different patterns.
2. **Small sample size.** 164 problems means standard error is ±3.5-3.8 pp. Some inter-model gaps are barely outside the confidence-interval overlap.
3. **Single-run, no multi-seed variance.** With greedy decoding the run is deterministic, but minor prompt-formatting differences (max length, BOS handling, stop sequences) between engines can introduce noise we haven't measured.
4. **Methodology biases against published numbers.** This eval doesn't measure "how good is REAM in real chat usage" — it measures "did the GGUF quants preserve the bf16's behavior in raw-completion mode." Different question, different answer.
5. **Untested in other tasks.** No MMLU yet (deferred — needs `num_concurrent=8` to be tractable on lm-eval's `local-completions`). No GSM8K (CoT generation slow). No comparison vs unmerged Qwen3.6 BF16 (separate, larger eval).

### What this is good for

- **Choosing between REAM Q4_K_M and Q3_K_S** for your own setup: they're equivalent on the HumanEval pass@1 metric, so pick by disk/memory headroom — *but with a caveat from local agentic-bench observations*. On our `lil-quick` agent-loop bench (2 standalone code-gen tasks against `lil`/`pi` with the daily-driver `llama-server` stack), **Q3_K_S took ~26% longer than Q4_K_M with thinking enabled (~1810s vs ~1440s total) and produced visibly less thorough project scaffolding** — Q4_K_M tended to set up a full TypeScript project (package.json + tsconfig + vitest config + impl + tests, 6 files), while Q3_K_S more often produced just impl + tests (2-4 files) and skipped the surrounding infra. The code itself was usually correct in both cases, but Q3 used more thinking iterations to arrive there. So:
  - **Q4_K_M** if you can spare the 5 GB and want fuller, faster agent loops.
  - **Q3_K_S** if you're memory-constrained and don't mind slightly tighter outputs / longer think loops on agentic tasks. Single-shot completion (HumanEval-style "fill in the function") is unaffected.
- **Sanity-checking that the REAM merge didn't damage code reasoning** at a level a code agent would notice: it didn't.
- **Comparing quant pipelines** (REAM merge → vanilla Q4_K_M vs unmerged base → Unsloth UD-Q4): vanilla Q4 of merged scored higher than UD-Q4 of unmerged here. Surprising; deserves more eval coverage.

### What this is *not* good for

- Claiming REAM-192 is "as good as" the unmerged Qwen3.6-35B-A3B in production use. Need broader benchmarks + real-world bench to support that.
- Citing as a leaderboard number alongside Qwen's published 85%. Different methodology, different number; the comparison is invalid.
- Evaluating REAM vs REAP definitively. Pending the REAP-26B-Q4_K_M run (same bench, same config); will update once that lands.

### Reproducing / extending

The full eval recipe + lm-eval gotchas is in our [bench dir](https://github.com/<your-blud-repo>/docs/dev-notes/model-benchmarks/qwen3.6-35b-a3b-ream-vs-reap/eval-2026-05-05/) (or local `~/Projects/blud/docs/dev-notes/model-benchmarks/qwen3.6-35b-a3b-ream-vs-reap/eval-2026-05-05/`). Cost was ~$3 on RunPod A100 SXM for all four runs. Re-running with chat template + thinking on (closer to real-world quality) would be ~$5-6.

---

## Future work to tighten the conclusions

- **Chat-template + thinking-on variant** of HumanEval — would land much closer to Qwen's published 85% absolute numbers and resolve "did the methodology choice flatter or hurt REAM relative to others?" (~$5-6, ~3-4h on A100 SXM)
- **Broader code benchmarks** — BigCodeBench, LiveCodeBench, Aider-style real-codebase eval. HumanEval pass@1 is widely considered saturated; broader coverage would discriminate models more meaningfully
- **MMLU + GSM8K** for general capability + math reasoning — deferred from this session due to time
- **Multi-seed runs** — single greedy pass is deterministic but vulnerable to small-sample noise; n=3 with different temperatures/seeds would tighten standard errors
- **Comparison vs unmerged Qwen3.6 BF16** (not just Q4 quants of it) — would isolate the "merge improved capability" hypothesis from "merge plus quantization happened to align well"

Treat current readings as **directional**, not definitive. Encouraging but single-benchmark.
