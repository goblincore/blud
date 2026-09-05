# Froggeric Qwen 3.6 chat-template A/B (2026-05-02)

**Question**: Does `froggeric/Qwen-Fixed-Chat-Templates` (commit `01225b6`) fix Qwen 3.6 template bugs we've been hitting, particularly on the Q2_K_S-mixed quant?

**TL;DR**: Mixed.
- **Q4_K_M (daily driver)**: small win — both tasks pass, **15% faster overall** (1212s vs 1424s), task 1 alone 36% faster.
- **Q2_K_S-mixed**: clean regression — froggeric eliminates the raw-`<tool_call>`-text bug we were hoping to fix, but introduces a thinking-loop pathology that *both* tasks fail to: model thinks until generation budget is exhausted and never produces any content / tool calls. **0/2 pass** vs baseline's 1/2.

## Setup

- **Server**: `llama-serve-lil` (TheTom-llama-cpp-turboquant fork, b3-5fe88a0)
- **Template (control)**: GGUF-embedded official Qwen 3.6 template
- **Template (treatment)**: `~/.local/share/llama-templates/qwen3.6-froggeric.jinja` — HF commit `01225b61088a1d9feb6a0836a024b304dbffeb8f`, 210 lines, fetched from <https://huggingface.co/froggeric/Qwen-Fixed-Chat-Templates/raw/main/qwen3.6/chat_template.jinja>
- **Bench**: `scripts/model-benchmark-lil-quick.sh` — 2 tasks (SeededRng, LRUCache), `lil --cwd /tmp/...` to keep cwd isolated from blud's CLAUDE.md
- **Server flags**: kv `q8_0`/`turbo3`, `-fa on`, ctx 65536, ngram-simple speculation, `--chat-template-kwargs '{"enable_thinking":true,"preserve_thinking":true}'`, `--reasoning auto`

## Smoke test (Q4_K_M + froggeric)

Before kicking off the bench I ran a 2-turn tool-calling smoke against the new template via raw curl:

- Turn 1 (one user message + 1 tool definition): clean `tool_calls` JSON, separated `reasoning_content`, no `|items` filter error in log, no `</thinking>` hallucination, `finish_reason: tool_calls`
- Turn 2 (continued conversation with tool result): same, model called the tool again correctly with a new expression

Server log scan: zero template-related errors, zero `|items` errors, zero exceptions. The only warning was a llama-server-side deprecation notice for `--chat-template-kwargs enable_thinking` (suggesting `--reasoning on` instead), unrelated to the template.

## Results

| Cell | Task 1 (SeededRng) | Task 5 (LRU cache) | Pass | Wall |
|---|---|---|---|---|
| q2mixed-baseline | 67s, 0 files — emitted raw `<tool_call>` text into stdout (broken-template bug) | 897s, 6 files ✓ | 1/2 | 964s |
| q2mixed-froggeric | 219s, 0 files — thinking loop, 0 stdout | 217s, 0 files — thinking loop (15.5KB of thinking, no content/tool_calls) | **0/2** | 436s |
| q4-baseline | 1135s, 6 files ✓ — 18 assistant turns, 17 tool calls, healthy agentic loop | 289s, 5 files ✓ | 2/2 | 1424s |
| q4-froggeric | 722s, 5 files ✓ | 490s, 5 files ✓ | 2/2 | **1212s** |

### Q2_K_S-mixed: failure modes

- **Baseline task 1** (broken-template bug, 67s): model reasoned, then emitted the file as raw XML in `content`:
  ```
  <tool_call><function=write>
  <parameter=path>/tmp/seeded-rng.ts</parameter>
  <parameter=content>...code...</parameter>
  </function></tool_call>
  ```
  This is the `|items` filter symptom from froggeric's README — tool-call arguments don't serialize via `chat_template`, so the model's JSON-tool-call output gets routed into `content` as raw text instead of into the OpenAI `tool_calls` array. Lil sees no tool calls, exits.

- **Froggeric task 1 + task 5** (thinking-loop bug, ~218s each): model produces a `thinking` block of 15.5KB, no `content` and no `toolCalls`. Thinking trace ends mid-sentence (`"this gives [min, max) - half"`) — generation hit the reasoning budget cap. Model never committed to a code response.

  Likely cause: the new template removes some accidental termination behavior in the broken template that — combined with `preserve_thinking=true` — was helping smaller quants stop thinking. Once removed, Q2_K_S has no natural stop and just chains thoughts until budget exhausted.

### Q4_K_M: clean win

- Baseline task 1 had a healthy 18-turn agentic loop (17 tool calls + thinking + content) — confirms the embedded template is *functional* on Q4 even though it's "broken" by froggeric's criteria. The known-bug filter doesn't trigger reliably on this stronger quant.
- Froggeric matched on pass rate (2/2) and beat on speed (1212s vs 1424s = **-15%**, with task 1 alone -36%). Most likely contribution: cleaner `tool_calls` JSON serialization shaves a small amount off each agentic turn × ~18 turns adds up.

## Verdict

**Daily driver (Q4_K_M)**: opt-in. Keep `LIL_TEMPLATE_FILE` *off* by default but recommend it for users running Q4 — small, free speedup, no quality regression observed in 2/2 tasks.

**Q2_K_S-mixed**: avoid the new template. The embedded template's known broken-tool-call bug is preferable to a thinking-loop that produces no output at all. If we ever want to actually use Q2_K_S as a memory-tight fallback, we'd need to either (a) cap the reasoning budget very aggressively (`max_tokens` or a `<|think_off|>` toggle in the system prompt), or (b) disable thinking entirely (`enable_thinking=false`) and trade away CoT.

**Caveat**: n=1 per cell. Variance on this M3 setup is real (memory shows previous Q4_K_M lil-quick was 606s; today's baseline was 1424s — 2.4x slower than that prior run, likely background-load variance). Treat the deltas as directional, not load-bearing.

## Files

- `q2mixed-baseline-*.json/log` — 2× task artefacts + bench-timings + server log
- `q2mixed-froggeric-*.json/log`
- `q4-baseline-*.json/log`
- `q4-froggeric-*.json/log`
- `qwen3.6-froggeric.jinja` lives at `~/.local/share/llama-templates/`, sidecar `.meta` records source URL + commit hash

## Reproduce

```bash
# Q4 + froggeric (recommended for daily driver if you want the speedup)
LIL_TEMPLATE_FILE=~/.local/share/llama-templates/qwen3.6-froggeric.jinja llama-serve-lil

# Re-run the bench:
~/Projects/blud/scripts/model-benchmark-lil-quick.sh <label> ~/Projects/blud/docs/dev-notes/model-benchmarks/2026-05-02-froggeric-template-ab
```

Helper script `/tmp/run-bench-cell.sh` wraps server-start + bench + log-snapshot per cell — preserved on disk for re-runs.
