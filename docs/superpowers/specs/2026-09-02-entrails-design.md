# Entrails — cavity viscera, and guts that spill

**Date:** 2026-09-02 · **Status:** approved (brainstormed with owner)
**Scope:** `src/lab/sdf-zombie/` — the wound shading ramp, a new `entrails.ts`
chain module, `blood-sim.ts`, and the CPU damage paths. WebGPU only.
**Owner intent:** "a lot of body shots should actually expose like entrails and
organ type stuff rather than just the flesh and bone", and — asked whether that
means the cavity interior or things coming out — "stuff should come out tbh".

## Where this came from

Wound pass r2 (`X1.wound-r2`) gave wounds a tissue-depth ramp:
`skin → fat → muscle → clot`, keyed to `carved`, the depth beneath the original
skin. That is a **wall model**. It is correct for a limb — a thigh really is a
wall of meat — and wrong for a torso, which is mostly cavity. A slug to the gut
currently reveals more red meat where it should reveal a hole with things in it.

### The constraint that shapes everything here

The rib pass immediately before this one is the reason this spec keeps
insisting on gross contrast over detail. Ribs were rebuilt from straight bars
into six strongly curved pairs (bends up to 0.162, visibly different in 5x lab
crops) and the owner's verdict in game was **"i dont notice the rib changes
lol"**.

At combat range the wound window is small and fine internal structure does not
resolve — only large value and colour blocks do. So:

- viscera must separate from muscle by **value** (darker), not by hue;
- the gut rope must read by **silhouette and motion**, not by modelled form;
- rope-versus-body collision is not worth paying for, because nobody can see a
  gut clipping a shin at 3 m under a flashlight.

A related trap, also recorded: judging this from max-exposure diagnostic
captures (20+ stacked wounds at 5x zoom) made the fat band look dominant when
at gameplay range the owner finds it subtle. **Judge at combat range.**

## Design decisions (owner-selected)

| Fork | Choice |
|---|---|
| Cavity, or things coming out | **Both** — things come out, and the cavity is what they come out of |
| Attached, detached, or both | **Attached first, then tears free**; some hits only reveal |
| Render path | **Goo chain**, reusing the existing material; a distinct tint only if it fails to read |
| What decides the outcome | **Damage type**, tunable per type — not random |

## §1 — Cavity viscera (shading)

The ramp gains a fifth stop, **torso only**: past `visceraDepth` (default
**0.045 m**, scaled by the model's `height` like the other knees), colour goes
to a dark wet purple-red — around linear `[0.28, 0.06, 0.10]`, roughly half the
value of `deepColor` — and wetness rises.

Lumpiness reuses the **existing `fbm` at the rest-space `anchor`**, the same
call the mottle already makes, at a LOW frequency (`anchor * 2.5`) so it reads
as organs rather than as noise. Low frequency is the point: high-frequency
variation is precisely the detail that does not survive combat range.

Separated from muscle by **value, not hue** — darker — so the hole reads as a
hole at 3 m under a beam instead of as more red meat. This is the direct
consequence of the rib lesson.

### How the shader knows it is a torso

**Not** by looking up the hit prim's cluster at shade time; the shading path has
no such lookup. Instead a **per-wound cavity flag, set on the CPU at stamp
time**, where cluster membership is already known and free. It rides the wound
rows beside the existing `wMeta` type/age.

This is better than a per-pixel test on two counts. It makes the gate *per
wound*, which is what is actually wanted — a slug to the gut opens a cavity, a
pellet to the same spot does not, and the flag records which. And it is the
**shared hinge with §2**: a wound that opened a cavity is a wound a gut can come
out of. That shared hinge is the reason this half is built first.

Amplitude-guarded like every other quality lever here: `visceraAmp 0` shades
bit-for-bit as before this existed.

## §2 — The gut rope (sim)

### A new pure module, `entrails.ts`

A small verlet chain: nodes (position + previous position), a rest length, an
anchor. Step = integrate, gravity, satisfy distance constraints over a few
iterations, collide with the floor plane, damp. No rendering and no three.js, so
it unit-tests without a GPU exactly as `gait.ts` and `collapse.ts` do.

**`humanoid-verlet.ts` cannot be reused.** It is bound to the baked-humanoid
manifest (`makeHumanoidVerlet(manifest)`), not a generic chain solver. This was
misremembered during the brainstorm and corrected by reading it; the new module
is small enough that this is a minor cost, but do not go looking for a shortcut
that is not there.

### Anchoring

Node 0 is pinned each frame to the wound's emit point via
`woundEmitAnchorAndNormal` (`bleed-registry.ts`) — the same seam the bleed
emitters use, which is what already makes blood ride the animated body. The rope
therefore swings with the gait for free and needs to know nothing about rigs or
poses.

### Rendering, and the one wrinkle

Each node contributes a droplet so the **existing goo pass** draws it, at a
large `size` so the metaballs fuse into a rope rather than beads.
`GooLayer.sync(sim: BloodSim)` renders whatever droplets are in the sim, and
goo-layer's own tuning note records that `sizeScale` 0.22 gives "thin connected
strands" and 0.4 reads as "thick hose-water ropes" — the renderer is already the
one we want, at a setting it already knows how to hit.

**The wrinkle:** `BloodSim` droplets are ballistic — `stepBlood` integrates
them — but the chain owns gut positions. So guts need a `kind: 'gut'` that the
stepper **skips**, with the chain writing positions instead. `blood-sim.ts`
already distinguishes `drop` / `scrap` / `mist` behaviours, so the pattern
exists. Guts also carry effectively infinite `life` (they persist) and stamp no
floor splats.

### Tearing free

Unpinning node 0. The chain keeps its momentum, falls, lands, settles. Once
settled it **freezes** — stops stepping entirely — so a room of spilled guts
costs nothing but the goo particles they contribute.

### Bounded by construction

**10 nodes** per rope over a **0.55 m** rest length (defaults; both tunable),
and **at most one rope per body**. A second disembowelling
hit tears the existing one free rather than growing a second. This caps sim and
particle count regardless of how a fight goes, which matters because goo cost
scales with particle count (see §4).

### Explicitly out of scope

Rope-to-body and rope-to-rope collision. Both are expensive and neither is
visible at the range this is played at.

## §3 — Triggers and tuning

Implemented where the damage already branches — `woundFromSlug`,
`woundFromPellet` and `resolveExplosion` all run on the CPU with cluster
membership in hand.

| damage | cavity flag | rope |
| --- | --- | --- |
| pellet | no | no |
| slug, torso | yes | on a roll (`spillChance`) |
| blast / explosion, torso | yes | yes |
| hit on an already-spilled body, or collapse | — | tears free |
| gib / death | — | full spill |

A pellet does not reach a cavity, and that is already the distinction the game
draws between pellet and slug. It also means disembowelment is something the
player *achieves* rather than something that happens to every corpse — which is
what stops it going stale by room three.

`spillChance` defaults: **0.35 slug, 1.0 blast**. Rolled from the **existing
seeded stream** (`mulberry32`, the convention `bleedRng` already uses), never
`Math.random` — captures must stay reproducible.

Panel knobs on the same one-table pattern as the wound panel: `visceraAmp`,
`visceraDepth`, `spillChance`, rope length, node count, and the gut particle
size. That last one decides beads-versus-rope, so it must be reachable.

## §4 — Cost and gates

### Cost

The viscera stop is a few `mix`es inside a branch that already runs — free. The
rope is 8–12 verlet nodes plus 8–12 goo particles per disembowelled body, and
freezes once settled.

**The honest exposure:** goo cost scales with particle count, and **the goo
layer's own per-frame cost has never been measured** — the outstanding item
still recorded against `X1.blood-viscosity`, where goo shipped ON with its cost
unmeasured. We would be adding particles to an unknown baseline. Measure goo's
baseline as part of this rather than inherit that gap a second time.

### Gates

1. **Off-state parity** — `visceraAmp 0` and `spillChance 0` shade and simulate
   bit-for-bit as today.
2. **Pure-module tests** on the chain: constraints converge, the anchor stays
   pinned through a posed frame, the chain comes to rest on the floor, detaching
   preserves momentum.
3. **Determinism** — same seed, same spills.
4. **Rope cap holds** under sustained fighting: never more than one per body,
   never leaked on death.
5. **Combat-range read** — capture at 2–3 m under the beam and judge by looking.
   **Never a pixel diff:** this harness has 52–82k pixels of same-build flicker
   (measured, wound-r2 task 5), larger than anything this spec changes.
6. **Bench** — goo particle count is the cost driver: baseline goo, then N
   disembowelled bodies, as alternating legs **inside one run**. Cross-run
   comparison drifts ~45% on machine state. Reported, **not blocking** (owner
   call, carried forward from wound r2).

### Risks on the record

- **Guts may read as heavy bleeding rather than as guts.** This is the known
  cost of reusing goo's single blood material. The bet is that a coherent rope
  that hangs and swings is unmistakably not a spray. If it loses that bet, the
  fallback is a second tint channel in the density target — a targeted
  follow-up, not a rewrite.
- **The goo baseline is unknown** (above).
- **A rope anchored near a shoulder or hip may emerge at an odd angle**, since
  the anchor follows the wound rather than anatomy.

## Explicitly out of scope

- **Entrails on limbs.** A thigh is genuinely a wall of meat and the existing
  ramp is already correct there. This whole feature is torso-only, gated on the
  wound's cluster.
- **A distinct gut tint.** Deliberately deferred until the shape-only version
  has been judged (§4 risks).
- **Organ-specific shapes** — a heart, lungs, a liver as identifiable forms.
  The rib lesson says modelled internal detail does not survive combat range,
  and nothing here should spend on it before the gross version reads.
