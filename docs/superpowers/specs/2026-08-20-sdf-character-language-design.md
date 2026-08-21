# SDF character language — design

> **Status:** owner-approved 2026-08-20 — all three sections, and all four open
> questions resolved. Ready for an implementation plan; none written yet.
> `MAX_PRIMS` was raised and the per-cluster truncation bug fixed as part of the
> review (`ee3d10e`); everything else here is still unbuilt.

**Goal:** make authoring SDF characters for Blud easy enough that both a human
and an LLM can do it — a terse, commented text format that compiles to the
`BodyDef` the lab already consumes, linted against the shipping SDF and
inspected through a deterministic turntable.

**Why now:** exploration has settled the aesthetic back toward the *primitive*
raymarched zombie (see `X1.humanoid-sever-spike` — baked SDF buys detail but
costs deformability, so the primitive body stays for enemies). If primitives are
the shipping art path, the authoring ergonomics of primitives become the
bottleneck for the M5 bestiary.

## Background: what already exists

Blud independently converged on WAM's founding principle. `body.ts` opens with:

> *"The lab zombie — authored as discrete, named, relative, symmetric
> decisions."*

which is near-verbatim WAM's *"the author only makes discrete, named, relative,
symmetric decisions"*. Mapping WAM's phases onto the repo:

| WAM phase | Blud today | Status |
| --- | --- | --- |
| Author | `BodyDef` (`types.ts`) — named bones with `parent`/`dir`/`length`, prims at relative `at`, `mirror: true` | exists |
| Compile | `build-body.ts` + `mirror.ts` | exists |
| Semantic lint | `validateBody` (`validate.ts:111`) — prim/cluster ceilings, fold-order contiguity, bounding-sphere escape, Lipschitz bound, cluster connectivity probe | exists, and is good |
| Render → inspect → iterate | live lab, **no turntable, no path back to source** | **missing** |

Two concrete gaps drove this design:

1. **The round trip does not close.** `face.ts` says *"bake a tuned FaceParams
   back into `DEFAULT_FACE` in face.ts once it lands"* — tuned numbers die in
   the panel and are hand-transcribed into TypeScript.
2. **`BodyDef` has authored exactly one character.** `makeZombie()` is its only
   consumer in the repo. It is a character DSL with a sample size of one.

## Prior art: WAM, and why we are not forking it

The owner has shipped an 8-character cast with WAM (`~/Projects/2026/horse/models/`:
goblin, imp, knight, lizardman, ogre, orc, skeleton, troll — 3,300 lines),
LLM-authored via a 7-task dispatch run that completed green. The workflow is
proven *for this owner*; only the geometry backend is wrong for Blud.

WAM's modules split cleanly (5,564 lines total):

```
parser.py    581  ─┐
skeleton.py  202   ├─ backend-agnostic ideas (~1,286)
lint.py      312   │
cli.py       191  ─┘
checks.py    955  ─── portable in CONCEPT only — see below
mesh.py     1276  ─┐
gltf.py      244   ├─ polygon-only, discarded (~1,843)
render.py    323  ─┘
```

**The decisive finding:** `checks.py` is triangle-soup math.
`_dist_to_surface(p, A, B, C)`, `points_inside(points, A, B, C)`,
`_crossing_depth` — 955 lines of raycasting triangles to answer *"am I inside"*
and *"how far to the surface"*. An SDF **is** that answer. `points_inside`
collapses to `sdBody(p) < 0`. Porting it would mean porting a thousand lines of
scaffolding whose only job is to fake what an SDF gives for free.

### Options considered

- **A — fork WAM to Python, swap the backend.** Inherits the `.wam` language,
  CLI and skill immediately. **Rejected:** it needs its own SDF evaluator in
  Python to run checks, creating a second source of truth that must stay in
  lockstep with the WGSL. That is exactly the hand-sync duplication `M6` killed
  when it folded `buildArenaGeometry`/`arena.ts` into one baked path.
- **B — WAM's language, implemented natively in TypeScript. CHOSEN.** Steal the
  design wholesale; implement against the shipping evaluator.
- **C — no language; skill + round-trip persistence only.** Cheapest, but
  `BodyDef` literals are noisy, and the value of `.wam` is a format terse enough
  that an LLM spends its tokens reasoning about silhouette rather than
  punctuation.

## Section 1 — Architecture *(approved)*

The language is a new **front end onto machinery that already exists**. Nothing
downstream of `BodyDef` is rewritten.

```
  character.blob                    ← new: terse, commented, LLM-friendly text
       │  parse                     ← new: blob-parse.ts (line/col errors)
       ▼
    BlobAst
       │  compile                   ← new: blob-compile.ts
       ▼
    BodyDef ─────────────────────── EXISTS (types.ts)
       │  buildBody()               ← EXISTS (build-body.ts + mirror.ts)
       ▼
  Body { prims, clusters }
       │
       ├── validateBody() ───────── EXISTS (structural lint)
       ├── fused / clear ────────── ← new: always-on, evaluated on sdBody()
       ▼
  lab raymarcher (WGSL) ─────────── EXISTS — the SHIPPING evaluator
       │
       ▼
  turntable PNG ────────────────── ← new client of the verify-*.mjs pattern
```

One SDF evaluator, and it is the one that ships. That is the whole argument for
B over a Python fork.

### Two concepts WAM has no analog for

- **`blend`** — smooth-min strength (`blendK`). In WAM, parts are meshes meeting
  at a joint; here the blend radius between a shoulder blob and a torso blob is
  the primary aesthetic dial. "Rounder and shinier" *is* `blendK`. It is
  first-class in the syntax, present on every part.
- **`carve`** — `op: 'sub'` subtraction (eye sockets, mouth, hollows). The
  syntax encodes the lesson `face.ts` already paid for across four rebuilds:
  **hard** carves (`blendK: 0`) are right for sockets and stumps; smooth carves
  smear, because smin's blend is wider than an eye socket.

### Round trip

`blob-emit.ts` runs the pipeline backward: live panel state → `.blob` text. This
closes the `face.ts` transcription hole and is what lets the owner hand-edit
*and* have an LLM author.

**Comments are part of the format, not decoration.** `troll.wam` spends half its
lines explaining why a number is what it is (*"Shrinking these is how the noclip
pair starts failing"*), and `body.ts` already writes in that voice. The emitter
**must preserve comments across a round trip**, or the first tweak-and-save
destroys the reasoning. This is a hard constraint on `blob-emit.ts`.

### Ceiling check — RESOLVED 2026-08-20

An earlier draft of this spec called `MAX_PRIMS = 48` a "dead constant worth
deleting". **That was wrong**, and the correction matters for P8:

- `MAX_PRIMS` is the **allocation width** of the prim data texture
  (`zombie-gpu.ts` creates `MAX_PRIMS x DATA_ROWS` RGBA-float) and of six
  `Float32Array`s in `pack.ts`. It cannot simply be removed; removing it means
  threading a dynamic per-body stride through pack → zombie-gpu → fpv-view.
- It is not the shader's real bound. The WGSL folds a cluster with a fixed
  `for (var i = 0; i < 64)` that breaks out on the live count, so widening the
  texture costs memory but no GPU time.

Resolution: raised to **128** (~20 KiB of texture, no GPU cost), and the
genuinely dangerous ceiling was closed. `MAX_CLUSTER_PRIMS = 64` now matches the
WGSL literal, `validateBody` rejects any single cluster over it, and a test
asserts the constant against the literal in both cluster folds. Before this, a
cluster past 64 prims **silently truncated** — the shader stopped folding and
the surface quietly lost geometry, with no error. At 48 total the case was
unreachable; at 128 it is reachable, which is exactly the risk a cast
introduces.

Remaining option, deferred: a dynamic per-body stride, which would remove the
ceiling entirely. Worth doing only if a character actually presses 128.

## Section 2 — Components and language surface *(approved)*

| Module | Job | Depends on |
| --- | --- | --- |
| `blob-parse.ts` | text → `BlobAst`; errors carry line/col | nothing |
| `blob-compile.ts` | `BlobAst` → `BodyDef`; angles → `dir` vectors | `types.ts` |
| `blob-checks.ts` | always-on `fused`/`clear` correctness checks on `sdBody()` | `validate.ts` |
| `blob-emit.ts` | `BodyDef` + panel state → `.blob` text, comments preserved | `types.ts` |
| `scripts/blob-turntable.mjs` | N-angle deterministic capture + contact sheet | `verify-*.mjs` pattern |
| `.claude/skills/authoring-sdf-characters/` | the agent loop: write → compile → check → look → revise | — |
| `characters/*.blob` | the cast, starting with `zombie.blob` | — |

### Angles, not vectors

WAM's biggest ergonomic win. Today a bone reads `dir: [0, 1, 0.12]`, which is
opaque; `dir=up pitch=7` is a decision a person or an LLM can reason about. The
compiler converts. Derived 1:1 from the real zombie numbers: `[0,1,0.12]` is a
7° forward pitch, `[0.30,-1,0]` a 17° outward tilt, `[0.05,-1,0.1]` tilt 3 /
pitch 6.

```
model zombie
  height 1.78
  style chunky

skeleton
  root pelvis at 0.92
  # The upper body hunches FORWARD. These used to lean back while the
  # forearms angled forward, which read as the head being on backwards.
  bone spine parent=pelvis dir=up pitch=7  len=0.34
  bone neck  parent=spine  dir=up pitch=19 len=0.16
  bone skull parent=neck   dir=up pitch=10 len=0.16
  mirror
    bone clavicle parent=spine    dir=side           len=0.20
    bone upperarm parent=clavicle dir=down tilt=17   len=0.30
    bone forearm  parent=upperarm dir=down tilt=3 pitch=6 len=0.30
    bone thigh    parent=pelvis   dir=down side=0.10 len=0.40
    bone shin     parent=thigh    dir=down pitch=3   len=0.42
  end

body
  # Torso — ribcage tapering into a sagging gut.
  blob torso on spine  at=0.80 r=0.150 wide=1.28 deep=0.78 blend=0.014
  blob torso on spine  at=0.50 r=0.150 wide=1.15 deep=0.80 blend=0.020
  blob torso on pelvis at=0.40 r=0.145 wide=1.10 tall=0.90 deep=0.92 blend=0.020

  # Arms — shoulder blob, then capsules, then a fist.
  blob arm on clavicle at=0.90 r=0.072 blend=0.010 mirror
  bar  arm on upperarm from=0.02 to=0.95 r=0.055 blend=0.007 mirror
  bar  arm on forearm  from=0.05 to=0.90 r=0.048 blend=0.007 mirror
  blob arm on forearm  at=1.00 r=0.062 blend=0.0125 mirror

  # Hard carve — smooth carves smear, smin's blend is wider than a socket.
  carve on skull at=0.55 r=0.022 offset=(0.035,0.01,0.06) hard both
```

Four deliberate choices:

- **`wide`/`tall`/`deep`** instead of `scale: [1.28, 1, 0.78]` — named axes,
  omitted ones default to 1.
- **`blob` vs `bar`** — point ellipsoid vs capsule spanning `from`→`to`. Today
  both are `PrimDef`, distinguished only by whether `capTo` is present.
- **`blend=` on every part** — the aesthetic dial, always visible.
- **`carve … hard both`** — `hard` is `blendK: 0`; `both` is the existing
  `mirrorOffset` (bilateral features on a non-mirrored bone, e.g. eye sockets on
  a single skull), which is distinct from `mirror`.

## Section 3 — Checks, errors, testing *(approved)*

### Checks battery *(resolved 2026-08-20)*

Two kinds of check were originally conflated, and they have different answers.

**Correctness checks — built in, always on, no syntax.** A limb not fused to the
body, or a hand intersecting a thigh, is objectively wrong and fails *silently*:
the render looks plausible while the geometry is not. `fused` already exists
inside `validateBody` as the cluster connectivity probe; `clear` is its inverse.
Because the field answers inside/outside directly, each is a handful of lines
rather than WAM's triangle raycast. These run on every compile and need no
per-character declaration.

**Intent checks — NOT in v1.** Assertions like `below(hand.l, knee.l)` encode
artistic intent ("this creature is apelike"), and a human reading a turntable
judges that better than an assertion that has to be maintained.

The case for them later is real but different from the one first proposed, and
it is worth writing down so it is not re-argued:

1. **They belong to a cast, not a character.** `troll.wam` describes itself as
   *"copied from goblin.wam (the cast template) — same bone names, same six
   animations, same checks battery"*. The value was a shared battery every
   creature satisfies, not troll-specific lines.
2. **They catch regression, which a turntable cannot.** Retune the arms months
   later and the knuckles drift above the knee; the eye may not notice on a
   turntable, an assertion does.
3. **Therefore they are a ratchet, not an authoring aid** — applied *after* a
   character is approved, to hold it still.

Revisit once a cast exists and there is something worth freezing. Cheap to add
then: the checks engine is built either way, and this is a parser addition.

### Error handling

Three failure classes, deliberately distinct:

1. **Parse errors** — line/col, one per message, never a stack trace.
2. **Compile errors** — structural impossibilities (`parent=` naming an unknown
   bone; `mirror` on a non-mirrored bone, which `mirror.ts` already throws on).
3. **Check failures** — the model compiles and renders but violates a stated
   intent. These report the *measured number* against the threshold, in the
   `troll.wam` house style, so the author learns which direction to move.

### Testing

- Parser: table-driven, one case per syntax construct plus malformed input.
- Compiler: **round-trip identity is the anchor test** — `zombie.blob` must
  compile to a `BodyDef` matching today's `makeZombie()` within float tolerance.
  That single test proves the language can express the one character known to
  work, and it is the first thing to write.
- Emitter: `parse → emit → parse` is idempotent, and comments survive.
- Checks: synthetic bodies with known-good and known-bad geometry.
- Turntable: reuses the existing headed CDP pattern; any WGSL change still
  requires a real headed WebGPU smoke (string tests and `tsc` cannot see inside
  template-literal shaders).

### Scope (YAGNI)

**In:** the language (including the `face` parameter block), compiler, always-on
correctness checks, emitter, turntable, skill, and `zombie.blob` as the proof.

**Out for now:** animation (Blud has its own animation system and a deterministic
sim — the language describes a *rest body*, not clips); palette/materials (the
lab's flesh presets and `X1.3` retune own that, and adding a second colour
authority now would fight it); a direct-manipulation GUI.

### Validation plan: port the existing WAM cast *(owner call, 2026-08-20)*

Once the language works, prove it by building a real cast — goblin, troll,
knight and friends. The strong version of this test is not to invent new
characters but to **port the eight that already exist** in
`~/Projects/2026/horse/models/` (goblin, imp, knight, lizardman, ogre, orc,
skeleton, troll — 3,300 lines of `.wam`).

Why that is the better test:

- They are known-good and owner-approved, so a bad result indicts the language
  rather than the art.
- They were authored for a POLYGON backend, so they exercise shapes `.blob` was
  not designed around — the honest way to find what the format cannot say.
- It is a direct A/B against WAM, on the same subjects.
- Eight characters is enough to answer the deferred GUI question: if authoring
  the eighth is still slow, text plus a turntable was not enough.

Expect the port to surface genuine gaps. `blend` has no `.wam` analog and will
have to be invented per character; the troll's `boulder` hand and the skeleton's
exposed ribs may not be expressible as blended primitives at all. Those findings
are the point.

**Explicitly deferred, pending 2–3 characters authored:** whether "inventing the
shape" needs a drag-a-blob GUI. Text plus a fast turntable may be enough; that
is cheaper to learn than to guess.

## Resolved questions

All four are settled as of 2026-08-20. Kept here with reasoning so they are not
re-litigated.

1. **Do intent assertions earn their keep?** *No, not in v1.* Correctness checks
   (`fused`/`clear`) ship as always-on built-ins; intent assertions are deferred
   as a post-approval ratchet belonging to a cast. See *Checks battery*.
2. **Does the face fold into the language?** *Yes — as parameters, not prims.* A
   `face` block carries `FaceParams`; the compiler calls the existing
   `facePrims()`. See *Face* below.
3. **File extension.** `.blob`, confirmed.
4. **Should `MAX_PRIMS` be lifted?** *Done* — 48 → 128, and the per-cluster
   silent-truncation hole closed. See *Ceiling check*.

## Face — a parameterised generator, not authored geometry

The face is **in** the language, but as a `FaceParams` block rather than as
primitives:

```
face
  headRadius 0.118
  headWidth  0.760
  browJut    0.021
```

`blob-compile.ts` passes these to the existing `facePrims()`. Writing the face
out as ~13 explicit prim lines was rejected: it would lose the parameterisation
*and* the live panel tuning, and it would mean hand-placing exactly the geometry
`face.ts` records four failed rebuilds trying to hand-place. The lesson there —
*geometry carries silhouette, texture carries features* — depends on the face
staying a small parameterised generator.

This block is also **the first target for `blob-emit.ts`**. Tuning `FaceParams`
in the panel and hand-copying them into `face.ts` is the exact pain the code
complains about today (*"bake a tuned FaceParams back into DEFAULT_FACE"*), so
round-tripping the `face` block is the shortest path from this work to a felt
improvement.

### Consequence: the language has generators

`.blob` now carries two kinds of content — explicit primitives
(`blob`/`bar`/`carve`) and **parameterised generators** (`face`). That is a
deliberate extension point; a `hand` generator over the baked hand volume is the
obvious next one. Build only `face` for now.
