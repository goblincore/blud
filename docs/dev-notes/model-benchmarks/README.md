# Local Model Benchmarks for blud Delegate Tool

Testing Qwen3.6-35B-A3B MoE quants for the pi `delegate` tool (local "little brother" LLM).

## Hardware
- Apple M3 MacBook Air, 24GB unified memory
- llama.cpp (TurboQuant build) on port 8888
- `--reasoning off` / `/no_think` prefix for all runs

## Models Tested

| Model | Size | Quant | Speed (tok/s) | Note |
|-------|------|-------|---------------|------|
| Qwen3.6-35B-A3B-APEX-I-Mini.gguf | 13GB | TurboQuant Mini | ~5 | Turquoise variant |
| Qwen3.6-35B-A3B-APEX-I-Compact.gguf | 16GB | TurboQuant Compact | ~6 | Turquoise variant |
| Qwen3.6-35B-A3B-UD-Q3_K_S.gguf | 14GB | Unsloth Dynamic Q3_K_S | ~20 | Best so far |
| Qwen3.6-35B-A3B-UD-Q3_K_XL.gguf | 14.5GB | Unsloth Dynamic Q3_K_XL | ~14 | Current test |
| Qwen3.6-27B-Q4_K_M.gguf | 16.8GB | Unsloth Q4_K_M | ~7 | Dense 27B, OOM at 64K ctx |

## Benchmark Tasks

Each model runs the same 5 tasks. Scoring rubric per task:

- **Algo**: ✅ Follows spec exactly, ⚠️ Minor deviation, ❌ Wrong algorithm
- **Tests**: ✅ All compile/run, ⚠️ Minor issues, ❌ Major errors or missing
- **Edge cases**: ✅ Good coverage, ⚠️ Some missing, ❌ None
- **Code quality**: ✅ Clean TS, ⚠️ Works but messy, ❌ Bugs

### Task 1: SeededRng (mulberry32 PRNG)
Write a SeededRng class with specific methods + vitest tests.

### Task 2: Vec2 math class
Write a 2D vector class with add, sub, mul, len, normalize, dot, lerp, dist + tests.

### Task 3: Object pool utility
Write a generic ObjectPool<T> with acquire/release/drain/size + tests.

### Task 4: CSV parser
Write a CSV string parser that handles quoted fields, escaped quotes, newlines in quotes.

### Task 5: LRU cache
Write a generic LRU cache with get/set/has/delete/size/eviction + tests.

## Results

See individual model result files in this directory.
