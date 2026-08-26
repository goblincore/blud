# Grapeshot gun model (k3 rematch run) — construction notes

**Date:** 2026-08-25
**Script:** `scripts/model_grapeshot_gun_k3.py` (deterministic, standalone)
**Output:** `public/assets/lab/grapeshot-gun-k3.glb` (new file; the glm and
k1 bake-off models are untouched)
**Spec:** `docs/superpowers/specs/2026-08-16-sdf-lab-grapeshot-design.md` §1

Reproduce: `blender --background --python scripts/model_grapeshot_gun_k3.py`
(from repo root; writes the .glb and the review PNGs in this folder).

## Numbers

| Metric | Value | Budget |
|---|---|---|
| Triangles (scene / exported glb) | **3,948 / 3,948** | < 8,000 |
| .glb size | **195 KB** (199,288 B) | < 1 MB |
| Length (Y, muzzle→butt) | 0.760 m | ~0.75 m |
| Width / height | 0.102 m / 0.261 m | — |
| Mesh objects | 43 (+ GunRoot empty) | — |

Determinism: two clean runs produce a **byte-identical .glb**
(md5 `e1b1521a…`). Fixed seed `random.Random(20260825)` drives all hand-cut
jitter and wrap skew.

Origin is the **grip point**; muzzle points down **−Y** in Blender; the glTF
exporter's default axis conversion handles the rest. `GunRoot` empty parents
every part — identical convention to the glm model, so the runtime can swap
the two freely.

## Why this run exists

The 2026-08-16 bake-off compared glm-5.3's model against a k3 model built
while k3's image input was misconfigured (`input: ["text"]` in
`~/.pi/agent/models.json`) — it modelled blind. This run is the rematch with
working vision: every round below was rendered, looked at, and judged.

## Honest read of the two existing models

**glm's (the winner):** proportions and silhouette are genuinely good —
plank + twin pipes + crooked tape reads "homemade" instantly, the steel is
properly dark, and the angled grip works. Its weakness is exactly where the
player looks: from FPV (behind/above) the top of the gun is barren — flat
tape-band plates, a big empty plank top, no breech detail at all, and the
wires (its best idea) are routed on the sides where the player never sees
them. Muzzle-on, the "bores" read as two rounded blobs — the recessed bore
discs don't survive the smooth shading.

**k1 (my blind attempt):** worse in almost every way that shows. Chrome-bright
steel (albedo 0.17 @ 0.85 metallic) reads manufactured, not improvised; an
oversized silver trigger ring dangles like a pendant; a loud red wire runs
the full length of the top and dominates every angle; the breech is a
shapeless cluster of grey boxes; the tape looks like floating shards. The
one thing it got right — genuinely hollow-reading muzzle bores — k3 keeps
and improves.

## What k3 does differently

Same overall layout as glm (it won on silhouette; don't fix what works),
with the tri budget spent where a first-person camera actually looks:

- **Real pipe walls** — each barrel is a true open tube (outer wall, inner
  wall, front/back annulus rings, 18 seg), not a capped cylinder. Inner
  walls use the near-black bore material so the muzzles read *deep*, and a
  dark bore-bottom disc sits 55 mm inside. Front view: two actual holes.
- **Barrel asymmetry** — left pipe Ø 38 mm / right Ø 40 mm; left muzzle
  15 mm longer with a slanted hacksaw-cut rim (`cut_skew` shears the front
  ring by sin θ); left gets a muzzle tape wrap, right gets a hose clamp with
  a screw blob. No two ends match.
- **Breech detail (the FPV money shot)** — welded breech plugs with
  firing-pin dots, a bent sheet-steel strap screwed down over the pipe rears
  with four mismatched tilted screw heads, and two solid bent-striker
  hammers (post + arm + knob), left tall/half-cocked, right reclined.
- **Grip wrap** — four crooked tape bands plus a twine band spiral the grip
  (what the player's hand covers), instead of glm's bare peg.
- **A wire you can actually see** — one run goes over the top in the groove
  between the pipes (igniter → breech strap), tan cloth so it reads against
  the dark steel; two side runs + a trigger run keep the profile views busy.
- **Small dark trigger loop** (Ø 52 mm → Ø 48 mm, near-black steel) — the
  k1 silver pendant is gone.
- Front sight: a bent nail on the longer pipe only.
- Underside/butt kept cheap (plain stock slab + taped butt plate) — barely
  visible in FPV, not worth triangles.

## Iteration rounds (render → look → fix)

- **Round 1 → 2:** hammers were bezier wire curves and read as floating
  candy-cane hooks with detached knobs; rebuilt as solid connected strikers.
  The cloth tape band was the brightest object on the gun (read as a pale
  balsa slab); darkened 0.30→0.16 albedo and narrowed. Grip wraps were thin
  and sparse, reading as a detached ladder from some angles; widened 24→30 mm
  and respaced into a continuous wrap. Top groove wire went invisible
  (dark-on-dark); switched to tan cloth.
- **Round 2 → 3:** muzzle bores read as flat dark discs head-on because the
  inner pipe walls were lit steel; assigned the near-black bore material to
  the inner-wall faces — the bores now read as holes with depth. Swapped the
  FPV-facing right side wire to cloth so it catches the eye.

Final judgement call: `fpv.png` (30 mm lens, behind-right-above the grip) is
the view that matters — breech, hammers, strap, plugs, groove wire and muzzle
tape all read there. Turntables are for silhouette.

## Files in this folder

- `turntable_{front,back,left,threequarter,top}.png`, `fpv.png` — this model.
- `compare_{front,back,left,threequarter,top,fpv}_{glm,k1,k3}.png` — all
  three models rendered in one Blender session from identical cameras/lights
  for side-by-side review.

## Caveats

- No textures; flat PBR materials only (keeps the glb tiny, matches lab
  style). If the art pass wants more separation, the cloth tape can go a
  shade lighter without touching geometry.
- Turntable PNGs are not byte-stable between runs (EEVEE noise seed is not
  exposed); geometry and the .glb are.
