# Wound red-interior — root cause, fix, gates (2026-08-27)

The owner, three times: wounds read as pale/transparent holes, not craters.
*"it should look more red inside like in the lab."* This note records what the
pale actually was (two stacked defects, one deeper than the brief's finding),
the fix, and the gate evidence.

## Root cause — two stacked defects

**1. The trace returned hits ~1 cm OUTSIDE the skin (the deeper one).**
`traceProjectile` bisected to `field(p) <= GRAPESHOT.hitEps` (hitEps = 0.01 m),
and since the SDF gradient is ≈ 1, that shell sits up to 1 cm in FRONT of the
true surface. `worldHitToWound`'s `probeFlesh` then marches inward from the
"hit" in 4 mm steps — the first sample was still in the air, `field > 0`, and
the measured flesh thickness came back **zero on every projectile wound**. The
thickness cap then shifted the carve sphere by `radius − 0.45·0 = radius` —
the FULL radius — so the carve sphere was **tangent to the body**: a
zero-depth smudge with `rimScale = 0` (no lip either). That is the pale dot
the owner saw, and why "eight barely-visible 5.5 cm craters gave no signal at
all" (the slug-mode comment) — the calibre was never the problem.

The blast path never had this: `explosion-aoe.ts`'s `traceSurface` bisects to
eps 0.002 (on-skin, like the lab's `raycastBody`).

**2. The thickness cap worked by shifting the sphere CENTRE (finding 3, in
its degenerate form).** The brief's finding 3 was right that the two pages
uploaded different positions (`woundCarveWorldPos` vs `woundWorldPos`), and
the experiment confirmed the mechanism dramatically — with the surface anchor
uploaded, the 0.16 slug sphere carves a proper bowl *and punches a
see-through hole through the hip* (`EXPERIMENT-anchor-upload-perforates.png`).
But the upload difference alone doesn't explain pale: a shifted sphere carves
a dish whose visible wall is always the sphere's outer shell
(`woundMask` reads `1 - smoothstep(0, 1.6r, r) ≈ 0.32` there — same as the
lab's bowl wall). The pale was cause 1 (tangent ⇒ nothing shows at all);
finding 3's real content is the tension it exposed: anchor-centred spheres
are deep AND perforating; centre-shifted spheres are safe AND shallow.

## The fix

1. `traceProjectile` bisects to the TRUE surface (`field <= 0`); grazes that
   never penetrate keep the eps-shell point (game-weapon.ts).
2. The carve cap now caps **DEPTH, not position**: the carve sphere stays
   centred ON the surface anchor — the lab's deep-bowl look — and is clipped
   by a slab through the anchor along the measured inward normal, at most
   `WOUND_CARVE_DEPTH_FRAC` (0.45) of the local flesh. In the shader:
   `smax(d, max(-(r - depth), dot(p - w.xyz, capN) - cap), k)` — max of two
   SDF bounds is exact for the convex intersection. `Wound.carveLocal`
   (shifted centre) is replaced by `carveN` + `carveDepth`; the game uploads
   anchor + caps; the lab keeps its 6-arg upload.
3. Uncapped wounds read `cap = 0` → `select(1e5, …)` makes the slab term
   lose the max **bit-exactly** → the lab renders identically. Measured:
   before-vs-after lab frames (holdStill canonical pose, one fixed
   `stampWoundAt`, fixed `setCam`, main-repo vite as the pre-fix side)
   differ on 0.08% of pixels >4/255 vs a 0.025–0.06% same-code floor — at
   the noise floor.
4. `probeFlesh` seeks the surface when a hit sits outside the skin
   (defence in depth; value-neutral for hits that already measure flesh —
   the loop is byte-identical on that path).
5. Game occluder hull now passes wound exclusions (anchor spheres, the lab's
   superset contract) — real craters had started exposing hull spheres as
   pale discs; tangent craters never reached the hull, which is why the game
   never needed this before.

## Gate evidence (docs/dev-notes/2026-08-27-wound-red-interior/)

| Gate | Game | Lab reference | Verdict |
| --- | --- | --- | --- |
| Slug, torso | `game-slug-torso-red.png` — deep bowl, red interior + specular | `lab-blast-reference.png` | **reads RED like the lab** |
| Slug, forearm | `game-slug-forearm-severed.png` + `…-back-no-hole.png` — capped stump, no see-through | n/a (lab has no slug) | no perforation; punch-through is the sever system's job (severRadius 0.13 on an 11 cm limb severs by design) |
| Buckshot, torso | `game-buckshot-pocks.png` — staged pocks, red interiors | `lab-pellets-reference.png` | red reads; framing weaker (see staging note) |
| Blast class | `game-blast-class-craters.png` (0.16 blast-profile via stampWoundAt) + the slug crater above (same rim family) | `lab-blast-reference.png` | red reads |
| BEFORE | `BEFORE-tangent-speck.png` — the pale dot | — | the defect, for the record |

Staging notes (cost real time — recorded here so the next driver doesn't
re-derive them): a full grapeshot volley kills + death-gibs at ANY range
(2–6 m tried), and `resolveExplosion` stamps ~16 wounds whose summed damage
crosses the gib threshold — a pocked STANDING torso only exists through
`__sdfGame.stampWoundAt` (new dev seam, the lab's `stampWoundAt` twin).
Blast bodies fly if even one live step consumes the wound-fed collapse meter;
stay frozen through the stamp.

## Perf

Third textureLoad in `applyWounds`' per-wound loop (cache-resident rows):
wounded close-up bench (bench-wound-shadow.mjs, shadow OFF medians) pre-fix
~37.5 ms vs post-fix ~34.0 ms across four interleaved-ish runs — within the
±15% thermal spread, no regression signal.

## Left open / honest caveats

- Two opposing capped craters on one limb can leave as little as ~1 mm of
  wall (each slab floors at 45% of the local chord). No worse than the old
  cap's geometry; punch-through remains the sever system's job.
- The placement gate (sdf-game-slug-gate.mjs) never went green before this
  session; `predictSlugHit` traced a straight ray while the slug drops under
  gravity (~4 cm at 3 m). It now integrates the arc; gate passes at 1.70 cm.
- The lab CAN still perforate thin limbs with big wounds (it caps nothing) —
  unchanged on purpose: it is the owner's reference. If the lab ever grows
  slug-mode, the cap plumbing is already in the shader; it only needs the
  upload to pass caps.
