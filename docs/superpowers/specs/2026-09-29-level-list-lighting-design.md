# Level materials on the shared list, cheap tier — Design

**Date:** 2026-09-29 · **Status:** approach B approved by the owner (diffuse-only is fine); this spec and its plan await review.
**Context:** part 3 "plan 2" of the shared light list ([spec](2026-09-26-shared-light-list-design.md) §2 decision 2,
[optimisation strategies](../../dev-notes/2026-09-28-light-layers/optimisation-strategies.md) §2). This narrows plan 2 to a
spike-first slice; the shadow atlas stays out of scope.

## 1. Why

Measured 2026-09-29 (quiet machine, Boiler Room frame median, list off): every real three.js light in a room costs its
level materials about **1 ms a frame** (`sdf:shell-hull` pass). A full second tube row (4 spots + 4 omnis) cost +10 ms;
made list-only it costs +2 ms but then lights the level not at all. The tube system still costs ~+4 ms per carriage,
~3 ms of it the tube spots' evaluation in the level materials. Live tube shadow re-renders cost 0–1 ms (the bake that
plan 2 was meant to enable is not worth building).

three.js pays that ~1 ms per light for a full PBR direct term (GGX specular, tangent-frame work). The owner's rule is
presentation over realism, and diffuse-only level lighting from these lights is acceptable (owner, 2026-09-29).

## 2. Goal and non-goals

**Goal:** a cheap tier of level lighting — a custom `LightingNode` that shades level surfaces, diffuse-only, with the
shared list's lights that need no shadow map — with a measured per-light win over three's lights, and no visible change
where a light moves onto it.

**Non-goals (deferred):**
- The 1024² shadow atlas and level-to-body shadows.
- Moving shadow-casting lights (the four shadowed tubes per room, window lights, beacon spots, the flashlight) off three.
- Removing three's lights from level materials wholesale.

## 3. Decisions

1. **Diffuse-only** in the node: Lambert × cone × distance falloff. No specular from cheap-tier lights. Owner-approved.
2. **Cheap tier = unshadowed level lights:** fire-mood point lights, and tubes authored `shadow: false` (the Boiler
   Room's second row). Everything that casts a shadow map stays on three.
3. **The list is the source of truth.** The node reads the shared list's storage buffer (the one the bodies read), so a
   cheap-tier light shades the level and the bodies from the same record. The packed record is **unchanged**; a per-room
   uniform names which list indices the room's node shades.
4. **No 4-pick cap.** The cheap lights are cheap and the Boiler Room is 28 m long; a per-room pick of 4 would drop the far
   end. The node loops over at most 8 cheap lights per room (uniform-fed, not per-fragment selection).
5. **Falloff matches three's**, so where a light moves the look holds: the Frostbite window three uses
   (`1/max(d^decay, 0.01) × clamp(1 − (d/cutoff)^4)²`), decay 1.2 for tube spots and 2 for point lights, cutoff = the
   list range for spots and none for points (three's accent points have distance 0); spots use `smoothstep(cosOuter,
   cosInner, cosAngle)` like three's `SpotLightNode`. Lambert scaling as three's: `irradiance × diffuseColor / π`.
6. **Behind `?levellist=1`, default off**, until the owner signs off. Off is byte-identical to today, so march-hash and
   every gate pin hold.
7. **Spike first, then decide.** The first deliverable is a per-light cost number; if the node is not at least **2×
   cheaper per light** than three's for the same lights, stop and report — do not build the rest.

## 4. Architecture

```
lamps ──collectLightSources──▶ LightSource.levelCheap ──buildLightList──▶ ListLight.levelCheap
                                                                              │
writeLightList (each frame) ── cheapLevelIndices(list, room) ──▶ per-room picksA/picksB uniforms
                                                                              │
level material (room R) ── lightsNode = [ three's shadowed lights…, ProbeLightingNode, LevelListLightingNode(R) ]
                                            └── reads the list storage buffer at picksA/picksB, adds directDiffuse
```

Units:
- **`level-tier.ts`** (pure, no three): which list lights are cheap for a room (`cheapLevelIndices`), and the CPU twins
  of the node's math (`distanceAttenuation`, `spotFactor`, `levelIrradiance`). One responsibility: decide and specify.
- **`level-list-node.ts`** (three/TSL): `LEVEL_LIST_WGSL` (the evaluator) and `LevelListLightingNode`. Depends on the
  list layout constants (`LIST_LIGHTS_AT`, `LIGHT_VEC4S`) and nothing else of the game.
- **Flag plumbing:** `levelCheap` on `LightSource` / `ListLight` (light-list.ts), set from the lamp in
  `collectLightSources` / `readSourceInput`, and on the runtime `Lamp` (game-dynamic-light-leaves.ts).
- **Wiring** (game-main.ts, game-lighting-leaves.ts, game-light-list-leaves.ts): one node per room, added to the room's
  light list; three's own light for a cheap lamp is dropped from level materials (`userData.levelCheap`, honoured by
  `levelSceneLights` only when `?levellist=1`, so deferred practicals and the shared list are untouched).

## 5. Data flow and error handling

- The node adds into `builder.context.reflectedLight.directDiffuse`, exactly where three's direct diffuse lands, so
  fog, tone and every downstream stage are unchanged.
- An empty room (no cheap lights) gets `picks = -1` everywhere: the loop `continue`s on every slot, adding nothing.
- A cheap light dropped from the 32-light list (relevance cap) simply is not shaded; the far rooms it lights are not near
  the player. Acceptable and observable via the `levelListInfo()` seam.
- `?levellist=1` with `?lightlist=0` (list off) shades nothing new: the flag is only honoured when the list is on.

## 6. Testing

- **Pure:** `level-tier.test.ts` pins `cheapLevelIndices` (room mask, cap 8, order, −1 padding) and the falloff/spot/
  irradiance twins against hand-computed values and three's own formula.
- **Node:** `level-list-node.test.ts` parses `LEVEL_LIST_WGSL` with three's real `WGSLNodeFunction` (the probe node's
  pattern) and pins the parameter list; a source test pins that the WGSL constants come from `light-list.ts`.
- **Fidelity A/B:** the same lights lit by three vs by the node, Boiler Room second-row spots and a fire light; mean
  absolute difference bounded, a contact sheet for the owner.
- **Cost:** `LIGHT_GATE_COST_QUERY` variants in the light gate's cost section, Boiler Room, quiet machine: baseline (second
  row invisible to the level), node, and three spots. The decision rule is §3.7.

## 7. Risks

- **Per-fragment cost may not fall 2×.** Then the job stops at the spike, and that is the finding.
- **wgslFn and a shared storage node in a forward material:** the probe node shares `probeDyn` this way, so it is
  precedent, but the list node is bound in the march too; a pipeline rebuild on `setLights` is the trap to watch.
- **`levelGain` / `tint` overrides:** the list colour includes them (the level JSON's per-light `gain`/`tint`); Night Train
  authors none, so parity holds there. Any level that authors them needs a check before its lights move.
