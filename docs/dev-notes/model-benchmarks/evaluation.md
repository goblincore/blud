# Model Benchmark: UD-Q3_K_XL vs UD-Q3_K_S

Date: 2026-04-23
Hardware: Apple M3 MacBook Air, 24GB
Server: llama.cpp TurboQuant build, 65K context, `--reasoning off`

## Speed Summary

| Task | XL tok/s | XL tokens | K_S tok/s | K_S tokens |
|------|----------|-----------|-----------|------------|
| 1. SeededRng | 19.8 | 1778 | 21.3 | 1382 |
| 2. Vec2 | 12.6 | 1881 | 12.1 | 1872 |
| 3. ObjectPool | 14.0 | 902 | 13.6 | 1248 |
| 4. CSV parser | 13.6 | 1588 | 11.8 | 1223 |
| 5. LRU cache | 16.4 | 478 | 11.6 | 2531 |

XL is slightly faster per token but produces fewer tokens overall (especially Task 5 where it stopped at 478 tokens — no tests generated).

## Task-by-Task Evaluation

### Task 1: SeededRng

**UD-Q3_K_XL**: ❌ Wrong mulberry32. Custom variant using `(t + (t << 1))` and shifts instead of `Math.imul`. Fork is side-effect-free (good). Tests clean and runnable (14 tests).

**UD-Q3_K_S**: ✅ Correct mulberry32 with proper `Math.imul`. Fork is side-effect-free. Tests clean and runnable (14 tests). Best edge case coverage of any run.

Winner: **K_S** (correct algorithm)

### Task 2: Vec2

**UD-Q3_K_XL**: ✅ All methods present and correct. `normalize()` handles zero-length. `equals()` uses strict equality. Good test coverage. Statics as getters.

**UD-Q3_K_S**: ✅ All methods present and correct. `normalize()` handles zero-length. Statics as `readonly` properties (better — doesn't create new instance each access). Default constructor params. More thorough tests.

Winner: **K_S** (slightly better — readonly statics, default params, more tests)

### Task 3: ObjectPool

**UD-Q3_K_XL**: ✅ Clean implementation. Factory, optional reset, drain. 20 test assertions. Handles edge cases.

**UD-Q3_K_S**: ✅ Clean implementation. Factory, optional reset, drain, initial size. 23 test assertions. Better edge case coverage (pool exhaustion, type safety).

Winner: **K_S** (more thorough, initial size support, more tests)

### Task 4: CSV parser

**UD-Q3_K_XL**: ✅ Handles quoted fields, escaped quotes, newlines in quotes. Has both parse and serialize. Good test edge cases.

**UD-Q3_K_S**: ✅ Handles quoted fields, escaped quotes, newlines in quotes. Has both parse and serialize. More detailed edge case handling (trailing newline behavior explicitly tested). Better comments explaining tricky logic.

Winner: **K_S** (more robust edge case handling)

### Task 5: LRU cache

**UD-Q3_K_XL**: ✅ Correct implementation using Map insertion order. Clean eviction logic. **BUT: no tests generated** (stopped at 478 tokens).

**UD-Q3_K_S**: ✅ Textbook doubly-linked list implementation with dummy head/tail nodes. `moveToHead`, `removeNode`, `removeTail` helpers. Full test suite with eviction order verification, capacity enforcement, iteration order.

Winner: **K_S** (actually generated tests)

## Overall

| | Algo Correctness | Tests | Edge Cases | Completeness |
|---|---|---|---|---|
| UD-Q3_K_XL | 4/5 (RNG wrong) | 4/5 (LRU cut off) | ⭐⭐⭐ | ⭐⭐⭐ |
| UD-Q3_K_S | 5/5 | 5/5 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

**UD-Q3_K_S wins 5/5 tasks.** The XL quant is slightly faster per token but produces less output, got the RNG algorithm wrong, and ran out of tokens before generating tests on Task 5.

## Recommendation

**UD-Q3_K_S** is the best delegate model for this hardware. It's:
- Consistently correct on algorithms
- Generates more thorough tests
- Better edge case coverage
- Slightly faster on some tasks
- More reliable token output (doesn't cut off)
