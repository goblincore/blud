# Blud — NotBlood Core Port Implementation Plan (tables codegen + death/gib pipeline)

> **For dispatch workers:** Each `### Task N` is a self-contained dispatch task. Steps use `- [ ]`. Work only the files in that task's **Files:** block. Run the verification commands; commit with the given message. The tasks are a **serial chain** (each consumes the previous task's output), so build on the prior task's branch state.

**Goal:** Port NotBlood's data tables (codegen from C) and death/gib outcome pipeline (`actKillDude`) into a generated raw-table module + a pure, tested TypeScript core — eliminating hand-transcription errors and making future fidelity work transliteration instead of recreation.

**Architecture:** A Python script parses NotBlood's C aggregate tables into `src/game/notblood/notblood-tables.gen.ts` (raw Build-unit values). The existing `src/game/gibs/tuning.ts` becomes a curated overlay that imports raw values and applies Blud's deliberate deviations. A pure `resolveDeathOutcome()` module ports `actKillDude`'s decision logic, consuming the generated tables + an injectable seeded RNG, returning gib launch velocities in Build units (m/s conversion only at the GibSystem edge). Tic-clock-deferred but tic-clock-ready: the gen module stays in native Build units and the pipeline stays unit-pure so a future 120-tic deterministic core (for multiplayer) is a clean swap.

**Tech Stack:** TypeScript, Three.js, Rapier3D, vitest. Codegen in Python 3 (matches existing `scripts/extract_*.py`; pytest). NotBlood C source: `/Users/donny/Documents/Raze/NotBlood/source/blood/src/`.

**Base:** Branches from `main` @ `65f2dfd` (explosion-outcomes merged). Project root: `/Users/donny/Projects/blud`.

**Verification commands (used throughout):**
- `npx tsc --noEmit` — type check
- `npx vitest run src/` — game test suite (scope to `src/` to skip unrelated `docs/dev-notes/model-benchmarks/**` scratch tests)
- `npm run build` — production build
- `python -m pytest scripts/tests/test_gen_notblood_tables.py -q` — codegen unit tests

**Key source facts (verified):**
- `dudeInfo[]` indexed by `type - kDudeBase` (kDudeBase=200). `kDudeZombieAxeNormal=203`. Zombie `nGibType = {15,-1,-1}`.
- `explodeInfo[1]` = `kExplosionStandard` (common_game.h:226) = `{repeat:80, dmg:20, dmgRng:10, radius:150, dmgType:900, burnTime:0, ticks:60, quakeEffect:160, flashEffect:60}`. The C field named `dmgType` actually holds the **concussion impulse magnitude** (900) — this is where Blud's `impulse=900` comes from; the curated overlay documents the misnomer.
- `GIBTYPE` is an identity enum, so `nGibType` values index `gibList[]` directly. `gibList[15]` = `gibHuman` (7 GIBTHING entries). `gibList[27]` = `gibAxeZombieHead` (1 entry, tile 3405).
- `thingInfo[26]` = `kThingBloodChunks` (corpse-thing health source).
- All target tables are pure C aggregate initializers (numeric/enum/pointer), no macros — script-parseable.

---

### Task 1: Seeded RNG seam

**Files:**
- Create: `src/game/rng.ts`
- Create: `src/game/rng.test.ts`
- Modify: `src/game/gibs/chunks.test.ts` (import `mulberry32` from the new module instead of its local copy)

- [ ] **Step 1: Write the failing test**

Create `src/game/rng.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32, chance, type Rng } from './rng';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('returns values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds give different sequences', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('chance (NotBlood Chance fixed-point)', () => {
  it('0x8000 ≈ 50% over many rolls', () => {
    const r = mulberry32(99);
    let t = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (chance(r, 0x8000)) t++;
    expect(t / N).toBeGreaterThan(0.47);
    expect(t / N).toBeLessThan(0.53);
  });

  it('0x4000 ≈ 25%', () => {
    const r = mulberry32(99);
    let t = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (chance(r, 0x4000)) t++;
    expect(t / N).toBeGreaterThan(0.22);
    expect(t / N).toBeLessThan(0.28);
  });

  it('0 is never, 0x10000 is always', () => {
    const r = mulberry32(1);
    expect(chance(r, 0)).toBe(false);
    expect(chance(r, 0x10000)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run src/game/rng.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/game/rng.ts`**

```ts
/** Injectable PRNG returning a float in [0, 1). Production passes Math.random;
 *  tests pass a seeded mulberry32 for determinism. Threading this through the
 *  ported pure logic (instead of bare Math.random) is what keeps a future
 *  deterministic netcode core reachable. */
export type Rng = () => number;

/** Small, fast, well-distributed seeded PRNG. Same algorithm previously inlined
 *  in chunks.test.ts; promoted here as the single seedable source. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** NotBlood `Chance(n)`: n is a 16.16 fixed-point probability where 0x10000 = 100%,
 *  0x8000 = 50%, 0x4000 = 25%. Returns true with probability n/0x10000. */
export function chance(rng: Rng, fixed16: number): boolean {
  return rng() < fixed16 / 0x10000;
}
```

- [ ] **Step 4: Refactor chunks.test.ts to use it**

In `src/game/gibs/chunks.test.ts`, delete the local `mulberry32` definition and add `import { mulberry32 } from '../rng';` (adjust the relative path). Leave all assertions unchanged.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/game/rng.test.ts src/game/gibs/chunks.test.ts` → all pass. Then `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/game/rng.ts src/game/rng.test.ts src/game/gibs/chunks.test.ts
git commit -m "feat(rng): seeded mulberry32 + Chance() helper; chunks.test imports it"
```

---

### Task 2: Codegen script — enums + tokenizer foundation

**Files:**
- Create: `scripts/gen_notblood_tables.py`
- Create: `scripts/tests/test_gen_notblood_tables.py`
- Create: `src/game/notblood/notblood-tables.gen.ts` (enums section only this task)

**Context:** Build the parser foundation: comment stripping, C `enum` resolution (with implicit-increment), and a brace-aware aggregate tokenizer. Emit the enums to the generated TS. Later tasks add the tables. Source dir resolves from env `NOTBLOOD_SRC` or defaults to `/Users/donny/Documents/Raze/NotBlood/source/blood/src`.

- [ ] **Step 1: Write failing pytest**

Create `scripts/tests/test_gen_notblood_tables.py`:

```python
import gen_notblood_tables as g

def test_strip_comments_removes_line_and_block():
    src = "a // line\nb /* block */ c\n/* multi\nline */ d"
    out = g.strip_comments(src)
    assert "line" not in out and "block" not in out and "multi" not in out
    assert "a" in out and "b" in out and "c" in out and "d" in out

def test_parse_enum_implicit_increment():
    src = "enum { kDudeBase = 200, kDudeCultistTommy, kDudeCultistShotgun = 202, kZ };"
    e = g.parse_enum(src, anchor="kDudeBase")
    assert e["kDudeBase"] == 200
    assert e["kDudeCultistTommy"] == 201  # implicit
    assert e["kDudeCultistShotgun"] == 202
    assert e["kZ"] == 203

def test_split_aggregates_handles_nesting_and_casts():
    body = "{ 1, 2, {3, 4}, (char)5 }, { 6, 7, {8, 9}, (char)10 }"
    items = g.split_top_level_aggregates(body)
    assert len(items) == 2
    flat = g.flatten_scalars(items[0])
    assert flat == [1, 2, 3, 4, 5]
```

- [ ] **Step 2: Run pytest, confirm failure**

Run: `python -m pytest scripts/tests/test_gen_notblood_tables.py -q` → FAIL (module/functions missing).

- [ ] **Step 3: Implement the foundation in `scripts/gen_notblood_tables.py`**

Implement at least: `strip_comments(src)`, `parse_enum(src, anchor)` (resolves implicit increments; handles `= N` and bare names; stops at `}`), `split_top_level_aggregates(body)` (brace-aware split of a `{...},{...}` list into top-level brace groups), `flatten_scalars(group)` (recursively extract integer literals, resolving `(char)` / `(unsigned char)` casts and unary minus, and named enum constants via a passed symbol table). Provide a `main()` that: resolves the source dir, reads `common_game.h` + `actor.h`, parses `DAMAGE_TYPE` (actor.h), `kDude*` and `kThing*` (common_game.h), and writes `src/game/notblood/notblood-tables.gen.ts` containing those enums as `export const KDamage = {...} as const;` etc. (numeric values). Include a TODO marker where tables will be appended in Task 3/4.

Robustness notes for the implementer: tokenize on a comment-stripped string; integer literals may be decimal or hex (`0x...`); handle trailing commas; the enum bodies may span many lines.

- [ ] **Step 4: Run the script + pytest**

Run: `python scripts/gen_notblood_tables.py` then `python -m pytest scripts/tests/test_gen_notblood_tables.py -q` → pass. Confirm `src/game/notblood/notblood-tables.gen.ts` exists with `KDamage`, `KDude`, `KThing` consts and `npx tsc --noEmit` is clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen_notblood_tables.py scripts/tests/test_gen_notblood_tables.py src/game/notblood/notblood-tables.gen.ts
git commit -m "feat(codegen): NotBlood enum + aggregate-tokenizer foundation"
```

---

### Task 3: Parse dudeInfo / explodeInfo / thingInfo

**Files:**
- Modify: `scripts/gen_notblood_tables.py`
- Modify: `scripts/tests/test_gen_notblood_tables.py`
- Modify: `src/game/notblood/notblood-tables.gen.ts` (regenerated)

**Context:** Add struct-field binding with **arity guards** (raise if a row's scalar count ≠ expected field count — the guard that would have caught the original `explodeInfo` column-misread). Handle nested fixed arrays in DUDEINFO (`nGibType[3]`, `startDamage[kDamageMax=7]`, `curDamage[7]`).

- [ ] **Step 1: Add failing assertions to pytest**

Append:

```python
def test_explodeInfo_standard_row():
    tables = g.build_tables()  # parses everything; returns dict
    std = tables["explodeInfo"][1]
    assert std == {"repeat": 80, "dmg": 20, "dmgRng": 10, "radius": 150,
                   "dmgType": 900, "burnTime": 0, "ticks": 60,
                   "quakeEffect": 160, "flashEffect": 60}

def test_dudeInfo_zombie_gibtype():
    tables = g.build_tables()
    z = tables["dudeInfo"][g.ENUMS["kDude"]["kDudeZombieAxeNormal"] - 200]
    assert z["nGibType"] == [15, -1, -1]
    assert z["startHealth"] == 60

def test_arity_guard_rejects_wrong_column_count():
    import pytest
    with pytest.raises(g.ArityError):
        g.bind_struct(["repeat","dmg","dmgRng"], g.flatten_scalars("{ 1, 2 }"))
```

- [ ] **Step 2: Run, confirm failure**

`python -m pytest scripts/tests/test_gen_notblood_tables.py -q` → new tests FAIL.

- [ ] **Step 3: Implement**

Add: a `FIELD_SPECS` describing each struct's ordered fields (with array fields marked by length) for `DUDEINFO`, `EXPLOSION`, `THINGINFO` — derived from the struct definitions in `dude.h:26-53`, `actor.h:136-147` (EXPLOSION), `actor.h:71-86` (THINGINFO). Add `class ArityError(Exception)`, `bind_struct(field_specs, scalars) -> dict` (consumes scalars positionally, packing array fields; raises `ArityError` on count mismatch), and `build_tables()` that locates each array initializer (`explodeInfo[] = {...}`, `dudeInfo[...] = {...}`, `thingInfo[] = {...}`) in the source, splits rows, binds each. Emit to the gen TS: `export const explodeInfo = [...] as const;`, `export const dudeInfo = [...] as const;`, `export const thingInfo = [...] as const;` plus typed accessors `export function getDudeInfo(type: number)` (index `type - KDude.kDudeBase`). Keep raw Build-unit values verbatim.

- [ ] **Step 4: Verify**

`python scripts/gen_notblood_tables.py && python -m pytest scripts/tests/test_gen_notblood_tables.py -q` → pass; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen_notblood_tables.py scripts/tests/test_gen_notblood_tables.py src/game/notblood/notblood-tables.gen.ts
git commit -m "feat(codegen): parse dudeInfo/explodeInfo/thingInfo with arity guards"
```

---

### Task 4: Parse + link gib tables

**Files:**
- Modify: `scripts/gen_notblood_tables.py`
- Modify: `scripts/tests/test_gen_notblood_tables.py`
- Modify: `src/game/notblood/notblood-tables.gen.ts` (regenerated)

**Context:** Parse the named `GIBFX[]` / `GIBTHING[]` arrays and `gibList[]` (gib.cpp:40-259), resolving the symbol references in `gibList` (`{ NULL, 0, gibHuman, 7, 0 }`) into linked structured data.

- [ ] **Step 1: Add failing assertions**

```python
def test_gibList_human_linked():
    tables = g.build_tables()
    entry = tables["gibList"][15]
    assert entry["things"] is not None and len(entry["things"]) == 7
    assert entry["things"][0]["tile"] == 1454  # GIBTHING.at4 = picnum

def test_gibList_axezombie_head():
    tables = g.build_tables()
    entry = tables["gibList"][27]
    assert len(entry["things"]) == 1
    assert entry["things"][0]["tile"] == 3405
```

(Confirm GIBTHING field names against gib.cpp:53-57 — `at0, at4(picnum/tile), chance, atc, at10`; name the emitted field `tile` for the picnum slot. Verify gibList indices 15/27 against gib.cpp:227-259.)

- [ ] **Step 2: Run, confirm failure.** `python -m pytest ... -q` → FAIL.

- [ ] **Step 3: Implement** — parse the `GIBFX`/`GIBTHING` named arrays into a symbol table, parse `gibList[]` rows resolving `NULL` and named-array references into `{ fx: [...]|null, things: [...]|null, ... }`. Emit `export const gibList = [...] as const;`. Keep raw values.

- [ ] **Step 4: Verify** — regenerate, pytest pass, `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen_notblood_tables.py scripts/tests/test_gen_notblood_tables.py src/game/notblood/notblood-tables.gen.ts
git commit -m "feat(codegen): parse + link gib tables (gibList symbol references)"
```

---

### Task 5: Generated-file header + TS drift test

**Files:**
- Modify: `scripts/gen_notblood_tables.py` (emit header)
- Create: `src/game/notblood/notblood-tables.gen.test.ts`
- Modify: `src/game/notblood/notblood-tables.gen.ts` (regenerated with header)

- [ ] **Step 1: Header.** Make the script emit a top banner:

```
// GENERATED by scripts/gen_notblood_tables.py — DO NOT EDIT BY HAND.
// Source: NotBlood blood/src (dude.cpp/.h, actor.cpp/.h, gib.cpp, common_game.h)
// Regenerate: python scripts/gen_notblood_tables.py
```

- [ ] **Step 2: Write the TS drift test** `src/game/notblood/notblood-tables.gen.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { explodeInfo, dudeInfo, gibList, KDude } from './notblood-tables.gen';

describe('notblood-tables.gen drift guard', () => {
  it('explodeInfo[1] (kExplosionStandard) matches source', () => {
    expect(explodeInfo[1]).toMatchObject({ radius: 150, dmgType: 900, dmg: 20, ticks: 60 });
  });
  it('zombie nGibType points at gibHuman (gibList[15], 7 chunks)', () => {
    const z = dudeInfo[KDude.kDudeZombieAxeNormal - KDude.kDudeBase];
    expect(z.nGibType[0]).toBe(15);
    expect(gibList[15].things?.length).toBe(7);
  });
  it('gibList[27] is the axe-zombie head (tile 3405)', () => {
    expect(gibList[27].things?.[0].tile).toBe(3405);
  });
});
```

- [ ] **Step 3: Verify idempotency + tests**

Run: `python scripts/gen_notblood_tables.py && git diff --exit-code src/game/notblood/notblood-tables.gen.ts` (must be no diff — idempotent). Then `npx vitest run src/game/notblood/ && npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add scripts/gen_notblood_tables.py src/game/notblood/notblood-tables.gen.ts src/game/notblood/notblood-tables.gen.test.ts
git commit -m "feat(codegen): generated-file header + TS drift guard test"
```

---

### Task 6: Curated overlay — tuning.ts imports raw values

**Files:**
- Modify: `src/game/gibs/tuning.ts`
- Modify: `src/game/gibs/tuning.test.ts` (only if assertions need import adjustments)

**Context:** Re-express the hand-transcribed constants as derivations from the generated raw tables, while **keeping every deliberate Blud deviation** as a documented local constant. Do NOT change any resulting numeric values — existing tuning tests must stay green.

- [ ] **Step 1: Refactor representative blocks.** Import from the gen module and derive. Examples (apply the same pattern across blocks where a raw source exists):

```ts
import { explodeInfo, dudeInfo, gibList, KDude } from '../notblood/notblood-tables.gen';

const STD = explodeInfo[1]; // kExplosionStandard
export const EXPLOSION_STANDARD = {
  radius: STD.radius,            // 150 BU (raw)
  damage: STD.dmg,               // 20
  damageRange: STD.dmgRng,       // 10
  impulse: STD.dmgType,          // 900 — NOTE: the C field is misnamed "dmgType";
                                 // for explosions it holds the ConcussSprite impulse.
  lifetimeTics: STD.ticks,       // 60
  quake: STD.quakeEffect,        // 160
  flash: STD.flashEffect,        // 60
} as const;

const ZOMBIE = dudeInfo[KDude.kDudeZombieAxeNormal - KDude.kDudeBase];
export const AXE_ZOMBIE = {
  hp: ZOMBIE.startHealth,        // 60 (raw)
  // ...feel-tuned locals stay as literals with comments:
  speed: 3.0,                    // m/s — Blud feel value (NOT derived; deliberate)
  meleeDamage: 10, meleeRange: 1.5, attackCooldownSec: 1.0, aggroRadiusM: 40,
  gibThresholdOverride: undefined as number | undefined,
} as const;

// ZOMBIE_GIB_PROFILE.bodyPartCount derives from gibHuman length:
const gibHumanLen = gibList[ZOMBIE.nGibType[0]].things?.length ?? 7; // 7
```

Keep `RADIUS_SCALE_FACTOR`, `DAMAGE_TICK_STACK`, `DYNAMITE_COOK.fuseMaxSec=1.5`, `EXPLOSION_LAUNCH.*`, `CORPSE.*`, picnum lists, etc. exactly as-is (these are Blud deviations / feel values, not raw source) — add a one-line comment on each block noting it's a deliberate deviation, not a derivation.

- [ ] **Step 2: Verify no value drift.** Run `npx vitest run src/game/gibs/ && npx tsc --noEmit`. All existing tuning + gib tests must pass unchanged. If a derived value differs from the old literal, STOP — that's either a transcription bug being corrected (verify against source and note it) or a parse error.

- [ ] **Step 3: Commit**

```bash
git add src/game/gibs/tuning.ts src/game/gibs/tuning.test.ts
git commit -m "refactor(tuning): derive raw constants from generated tables; keep deviations as documented locals"
```

---

### Task 7: Pure death-outcome module

**Files:**
- Create: `src/game/notblood/death-outcome.ts`
- Create: `src/game/notblood/death-outcome.test.ts`

**Context:** Port `actKillDude`'s decision logic (actor.cpp ~3185-3490) + the `actDamageSprite` sub-160 conversion (~3563) into a pure function. Outputs gib launch velocities in **BU/tic** (raw Build units). Consumes the generated tables + an injectable `Rng`. This is the death/gib *decision* — entity-side effects (anim, ballistic launch, SFX) stay in the entities.

- [ ] **Step 1: Define the contract + write failing tests.** Create `death-outcome.test.ts` first:

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../rng';
import { resolveDeathOutcome, KDamage } from './death-outcome';
import { KDude } from './notblood-tables.gen';

const ZOMBIE = KDude.kDudeZombieAxeNormal;

describe('resolveDeathOutcome', () => {
  it('explosion ≥160 damage → gib with body chunks + head', () => {
    const o = resolveDeathOutcome(
      { dudeType: ZOMBIE, damageType: KDamage.kDamageExplode, damage: 240, isCorpse: false, rng: mulberry32(1) });
    expect(o.gibbed).toBe(true);
    expect(o.gibSpawns.length).toBeGreaterThan(0);     // gibHuman chunks
    expect(o.spawnsHead).toBe(true);                   // GIBTYPE_27 head
    expect(o.becomesCorpse).toBe(false);
  });

  it('explosion <160 damage → converted to fall (no gib, intact corpse)', () => {
    const o = resolveDeathOutcome(
      { dudeType: ZOMBIE, damageType: KDamage.kDamageExplode, damage: 120, isCorpse: false, rng: mulberry32(1) });
    expect(o.gibbed).toBe(false);
    expect(o.damageTypeResolved).toBe(KDamage.kDamageFall);
    expect(o.becomesCorpse).toBe(true);
  });

  it('corpse re-gib bursts unconditionally (no threshold), no head', () => {
    const o = resolveDeathOutcome(
      { dudeType: ZOMBIE, damageType: KDamage.kDamageExplode, damage: 10, isCorpse: true, rng: mulberry32(1) });
    expect(o.gibbed).toBe(true);
    expect(o.spawnsHead).toBe(false);
  });

  it('normal death head-pop fires ~25% (seeded, deterministic)', () => {
    let pops = 0;
    for (let s = 0; s < 400; s++) {
      const o = resolveDeathOutcome(
        { dudeType: ZOMBIE, damageType: KDamage.kDamageBullet, damage: 50, isCorpse: false, rng: mulberry32(s) });
      if (o.headPop) pops++;
    }
    expect(pops / 400).toBeGreaterThan(0.18);
    expect(pops / 400).toBeLessThan(0.32);
  });
});
```

- [ ] **Step 2: Run, confirm failure.** `npx vitest run src/game/notblood/death-outcome.test.ts` → FAIL.

- [ ] **Step 3: Implement `death-outcome.ts`.** Define and export:

```ts
import type { Rng } from '../rng';
import { chance } from '../rng';
import { dudeInfo, gibList, KDude } from './notblood-tables.gen';

export enum KDamage { kDamageFall = 0, kDamageBurn, kDamageBullet, kDamageExplode, kDamageDrown, kDamageSpirit, kDamageTesla }

export interface DeathInput {
  dudeType: number;            // kDude* value
  damageType: KDamage;
  damage: number;              // post-scaling damage that killed the dude
  isCorpse: boolean;           // re-gibbing an existing corpse
  rng: Rng;
}
export interface GibSpawn { tile: number; vx: number; vy: number; vz: number; } // velocities in BU/tic
export interface DeathOutcome {
  gibbed: boolean;             // body bursts into chunks now
  spawnsHead: boolean;         // kickable head gib (GIBTYPE_27)
  headPop: boolean;            // normal-death head-pop signature (Chance 0x4000)
  becomesCorpse: boolean;      // persists as re-gibbable corpse
  damageTypeResolved: KDamage; // after the <160 explode→fall conversion
  gibSpawns: GibSpawn[];       // body chunks from nGibType→gibList
}

export const GIB_DAMAGE_THRESHOLD = 160;

export function resolveDeathOutcome(input: DeathInput): DeathOutcome { /* port actKillDude */ }
```

Logic to port (faithful to source, see actor.cpp): corpse → unconditional gib (no head); else explode-damage `< 160` → resolve to `kDamageFall`, no gib, `becomesCorpse=true`; explode `≥ 160` → gib, spawn head + body chunks from `gibList[getDudeInfo(dudeType).nGibType[i]]`; bullet/fall normal death → `headPop = chance(rng, 0x4000)` (zombie only), `becomesCorpse=true`. Emit `gibSpawns` velocities in BU/tic using the gibList GIBTHING velocity fields (raw). Keep it pure — no Three/Rapier imports.

- [ ] **Step 4: Verify.** `npx vitest run src/game/notblood/ && npx tsc --noEmit` → green.

- [ ] **Step 5: Commit**

```bash
git add src/game/notblood/death-outcome.ts src/game/notblood/death-outcome.test.ts
git commit -m "feat(notblood): pure resolveDeathOutcome port of actKillDude decision logic"
```

---

### Task 8: Blud config layer + BU/tic→m/s adapter

**Files:**
- Modify: `src/game/notblood/death-outcome.ts` (add optional config param)
- Create: `src/game/notblood/outcome-adapter.ts`
- Create: `src/game/notblood/outcome-adapter.test.ts`

**Context:** Blud deviates from raw `actKillDude` (three-tier selector, head from head-height, unconditional corpse persistence, 50% burn-head, impact-gib). Carry these as an explicit `DeathOutcomeConfig` so the pure core stays faithful and a reader can't mistake the deviation for a bug. The adapter converts gib velocities BU/tic→m/s at the boundary (the only unit conversion).

- [ ] **Step 1: Add `DeathOutcomeConfig`** to `death-outcome.ts` as an optional second param with documented Blud-deviation flags (e.g. `{ burnHeadChance?: number; }`), defaulting to source-faithful behavior when omitted. Add tests pinning that the config alters only the intended outcome.

- [ ] **Step 2: Write adapter test** `outcome-adapter.test.ts`: assert `toMps({vx, vy, vz} BU/tic)` uses `buPerTicToMps` from tuning (BU/tic × 120 / 256) and that a known GIBTHING velocity converts to the expected m/s vector.

- [ ] **Step 3: Implement `outcome-adapter.ts`** — `gibSpawnToMps(spawn: GibSpawn)` returning `{ tile, vx, vy, vz }` in m/s via `buPerTicToMps`. This is where Build units leave the pure core.

- [ ] **Step 4: Verify** `npx vitest run src/game/notblood/ && npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/game/notblood/death-outcome.ts src/game/notblood/outcome-adapter.ts src/game/notblood/outcome-adapter.test.ts
git commit -m "feat(notblood): Blud deviation config layer + BU/tic→m/s gib adapter"
```

---

### Task 9: Wire AxeZombie + GibSystem to the pure pipeline

**Files:**
- Modify: `src/game/gibs/index.ts`
- Modify: `src/game/enemy/axe-zombie.ts`

**Context:** Replace the scattered ad-hoc death/gib decision logic with `resolveDeathOutcome` + adapter, **preserving current playtested behavior exactly** (this is a refactor). Map old sites: `GibSystem.spawnExplosion` three-tier branch (index.ts:146-208) and `AxeZombie.takeDamage` head-pop/death-anim selection (axe-zombie.ts:261-300) now consult the pure module for the *decision*; entities keep the *effects* (anim play, ballistic launch, SFX). Thread a seeded-or-`Math.random` Rng.

- [ ] **Step 1:** Route `GibSystem`'s gib-vs-damage decision and `popHead` gating through `resolveDeathOutcome` (config carrying Blud deviations), converting gib velocities via the adapter. Keep the existing `EXPLOSION_LAUNCH` concussion-velocity path (that's Blud physics, separate from the death decision).
- [ ] **Step 2:** In `AxeZombie.takeDamage`, replace the inline 25% head-pop roll + death-anim branch with the outcome's `headPop`/`gibbed` flags. Keep `onImpactGib`, ballistic launch, anim plays.
- [ ] **Step 3: Verify behavior parity.** `npx tsc --noEmit && npx vitest run src/` → all green. Manually sanity-check no behavior assertions changed.
- [ ] **Step 4: Commit**

```bash
git add src/game/gibs/index.ts src/game/enemy/axe-zombie.ts
git commit -m "refactor(gibs): AxeZombie + GibSystem consume pure death-outcome pipeline"
```

---

### Task 10: Wire ShotgunCultist + final verification

**Files:**
- Modify: `src/game/enemy/shotgun-cultist.ts`
- Modify: `TASKS.md`

- [ ] **Step 1:** Mirror Task 9 for `ShotgunCultist.takeDamage` (cultist gib profile, no head). Use the same outcome module + config.
- [ ] **Step 2: Full verification.** `npx tsc --noEmit`, `npx vitest run src/` (all green), `npm run build` (green), `python -m pytest scripts/tests/test_gen_notblood_tables.py -q` (green), and `python scripts/gen_notblood_tables.py && git diff --exit-code src/game/notblood/notblood-tables.gen.ts` (idempotent).
- [ ] **Step 3: Update `TASKS.md`** — add an `R7` reference row: NotBlood tables codegen + death/gib pipeline ported; note `scripts/gen_notblood_tables.py` regen command and that `tuning.ts` is now a curated overlay.
- [ ] **Step 4: Commit**

```bash
git add src/game/enemy/shotgun-cultist.ts TASKS.md
git commit -m "refactor(gibs): ShotgunCultist consumes pure pipeline; NotBlood-core port complete"
```

---

## Post-dispatch (human)

After all tasks land and the merged branch passes `npx vitest run src/` + `npm run build`: **behavior-parity playtest** (`npm run dev`) — dynamite gib/launch/corpse/head-pop must be indistinguishable from the current main (this round is a refactor, not a behavior change). Worktrees need the gitignored asset dirs symlinked from the main checkout. Then merge via `superpowers:finishing-a-development-branch`.
