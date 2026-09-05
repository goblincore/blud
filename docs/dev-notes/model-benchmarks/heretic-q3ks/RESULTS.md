# Heretic Q3_K_S head-to-head — results

**Date**: 2026-05-02
**Model under test**: [mradermacher/Qwen3.6-35B-A3B-uncensored-heretic-i1-GGUF](https://huggingface.co/mradermacher/Qwen3.6-35B-A3B-uncensored-heretic-i1-GGUF), Q3_K_S variant (15.2 GB). Imatrix quant of [llmfan46/Qwen3.6-35B-A3B-uncensored-heretic](https://huggingface.co/llmfan46/Qwen3.6-35B-A3B-uncensored-heretic) — heretic-tool MPOA abliteration of Qwen3.6-35B-A3B claiming **0.0015 KLD vs original (bf16)** and 88% fewer refusals.

**Comparison baseline**: REAP-pruned Qwen3.6-VL-26B-A3B (atbender) at Q3_K_S — see [[2026-04-27-qwen3.6-vl-reap-26b-quant-comparison]]. Same harness, same prompts.

**Server**: `llama-serve-lil` with default KV cache (q8_0 K, turbo3 V), heretic Q3_K_S + atbender mmproj loaded together. Server reported `capabilities: ["completion", "multimodal"]` on `/v1/models`.

## TL;DR

**Heretic-Q3_K_S agentic performance is substantially worse than REAP-Q3_K_S** despite the abliteration's published 0.0015 KLD (which is on bf16). At Q3 quantization, agentic instruction-following degrades severely — model hallucinates work it didn't do and refuses to complete tasks autonomously. The 30× lower abliteration-KLD vs quant-KLD relationship I projected does not hold for agentic capability; quant-error has nonlinear effect on tool-use chains.

## lil-quick (2 tasks)

| Task | Wall-clock | Files written | Quality verdict |
|---|---:|---:|---|
| Task 1 — SeededRng | 183s | **0** | **Hallucinated**. Model produced confident text claiming "15 tests passing" with detailed breakdown. **Workdir is empty.** No actual tool use. Pure fabrication. |
| Task 5 — LRU cache | 45s | 1 | Wrote `lru-cache.ts` (809B). **Bugs**: (a) circular import (`import { LRU } from "./lru-cache.ts"` — file imports itself), (b) `set()` is missing eviction logic — does not enforce capacity, (c) no tests written. **Refused to complete autonomously**: ended with "Would you like me to create the vitest tests file as well?" |

For comparison, REAP-Q3_K_S in our prior bench: 5/5 tasks pass, with LRU outlier at 851s. **Heretic finished LRU in 5% of REAP's time but produced fundamentally broken code.**

## blud bench

In progress at time of writing — see `bench-run.log` for results.

## Vision sanity test

**Result: pass.** Tested on `llmfan46/Qwen3.6-35B-A3B-uncensored-heretic-GGUF/Experimental/Qwen3.6-35B-A3B-uncensored-heretic-Q3_K_M.gguf` (16.76 GB, original-author quant — switched to this after mradermacher's Q3_K_S agentic regression) + atbender's `mmproj-REAP-26B-F16.gguf`.

Test image: Canon PowerShot G5 photo (`/Users/donny/Pictures/...canon-g5.webp` → converted to JPG; webp not supported by llama-server's mtmd).

| Aspect | Result |
|---|---|
| Camera ID | "Canon PowerShot G5" ✓ exact |
| Flash ID | "Canon Speedlite 420EX" ✓ exact |
| OCR | "5.0 MEGA PIXELS", "Canon Zoom Lens" ✓ both read |
| Final answer | Clean 2-sentence description |
| Gen speed | **16.6 t/s** (REAP-26B-Q4_K_M daily driver ~22 t/s, so ~25% slower) |
| Prompt tokens | 529 (image embedding overhead) |
| Compute setup | Required `LIL_CTX=8192` — 65K context + 35B model + image + speculative decoding OOM'd Metal at 80GB unified memory |

**Conclusion**: heretic LM + atbender's mmproj is fully working multimodal. Vision encoder is unmodified by both heretic abliteration AND REAP pruning, so projector is interchangeable across these checkpoints. Image-derived facts (model numbers, on-camera text) were read accurately, matching expectations from the bf16 reference behavior.

**Memory caveat**: 35B at Q3_K_M + 65K context + image is too large for unified memory on M-series. For multimodal use of this checkpoint, cap `LIL_CTX` at 8–16K. Daily driver REAP-26B fits 65K because it's smaller.

## Heretic Q3_K_M (llmfan46 original quant) - agentic bench

**Result: pass on all tasks.** Switched to llmfan46's original-author Q3_K_M (16.76 GB) after mradermacher's Q3_K_S agentic regression. Ran at LIL_CTX=16384 (65K OOM'd Metal during the agent's 2K-token system prompt).

### lil-quick

| Task | Wall-clock | Files written | Quality |
|---|---:|---:|---|
| 1 — SeededRng | 485s | 5 | ✓ engaged, wrote impl + tests |
| 5 — LRU cache | 476s | 6 | ✓ engaged, wrote impl |

### blud bench

| Task | Wall-clock | Files changed | Diff | Tests |
|---|---:|---:|---:|:---:|
| 1 — tool-use sanity | 135s | 0 (verify-only) | 0L | **356/356 pass** |
| 2 — SeededRng.nextGaussian | 117s | 2 | 67L | **357/357 pass** (+1 test added) |
| 3 — post-fx name fields | 225s | 2 | 26L | **356/356 pass** |

### Comparison vs REAP-26B-Q4_K_M daily driver

| Bench | Daily driver (REAP-Q4_K_M) | Heretic-Q3_K_M (llmfan46) | Ratio |
|---|---:|---:|---:|
| lil-quick | 606s | 961s | 1.59× slower |
| blud | 304s | 477s | 1.57× slower |
| Total | 910s (~15 min) | 1438s (~24 min) | 1.58× slower |
| Pass rate | 5/5 | 5/5 (lil-quick + blud) | match |

### Conclusion

The mradermacher Q3_K_S agentic failure was specifically the **i1 imatrix calibration**, not heretic's abliteration. The original-author Q3_K_M produces a fully-functional model with quality matching the REAP daily driver (5/5 pass, all tests green) but ~58% slower wall-clock. Slowdown is mostly the larger 35B arch (vs 26B REAP) eating cycles even at active-param parity (8 routed experts × ~3B active for both).

**Use case fit**:
- Daily driver: REAP-26B-Q4_K_M still wins on speed (24% faster) and is censored (default refusals intact).
- Heretic-35B-Q3_K_M: viable for tasks needing uncensored output, at the cost of ~58% extra wall-clock and 16K context cap (OOM at 65K). Vision works.

**Strong negative finding for mradermacher i1 Q3_K_S** — same bf16 base, different quant, dramatically worse agentic. Worth flagging the imatrix recipe matters more than the bf16 KLD claim suggests.

## Interpretation

The published 0.0015 KLD is on **bf16-vs-bf16** (heretic-modified weights vs original Qwen3.6-35B-A3B). Their MMLU comparison shows minimal degradation (-0.42pp). But:

1. **Agentic capability ≠ MMLU.** Tool use, multi-step reasoning, and refusing-to-stop-prematurely are not measured by MMLU. Heretic's abliteration of `attn.o_proj`, `attn.out_proj`, and `mlp.down_proj` may have specifically damaged whatever circuits the model uses for sustained autonomous task execution — that wouldn't show up in single-shot QA benchmarks.
2. **Q3_K_S quantization on top compounds the damage.** REAP-pruned-then-Q3 retains agentic capability; abliterated-then-Q3 does not. The 30× KLD ratio (0.0015 abliteration vs 0.0449 Q4_K_M quant) doesn't predict agentic outcomes — there's nonlinear interaction between abliteration noise and quant noise on long output sequences.
3. **The "refuses to continue" pattern** in Task 5 is interesting given heretic's *claim* of fewer refusals. Heretic targets *safety-refusal directions* specifically; it doesn't make the model more compliant on agentic completion. If anything, removing those directions might make the model less coherent about what to do next when uncertain.

## Recommendation

**Do not switch the daily driver to heretic-Q3_K_S.** Stick with REAP daily-driver for agentic work. If heretic's uncensored property is desired, would need to:
- Test heretic-Q4_K_M (less quant noise) to see if agentic capability returns at higher precision, OR
- Stay on REAP for tool-use and switch to heretic only for one-shot non-agentic queries

## Server config

```
LIL_MODEL_GGUF=/Users/donny/Models/heretic-tmp/Qwen3.6-35B-A3B-uncensored-heretic.i1-Q3_K_S.gguf
LIL_MMPROJ=/Users/donny/Models/qwen-vl-mmproj/mmproj-REAP-26B-F16.gguf
LIL_CTK=q8_0  (default)
LIL_CTV=turbo3  (default)
LIL_CTX=65536  (default)
```

Model card numbers (upstream):

| Metric | Original Qwen3.6-35B-A3B | Heretic-abliterated bf16 |
|---|---:|---:|
| KLD vs original | 0 | **0.0015** |
| MMLU (all) | 83.72% | 83.30% (−0.42pp) |
| Refusals (out of 100) | 83 | 10 |
