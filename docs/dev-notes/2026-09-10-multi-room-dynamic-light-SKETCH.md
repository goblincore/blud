# SKETCH — lighting one room from another (dynamic light across the room graph)

**Status: SKETCH, NOT A PLAN, NOT SCHEDULED.** Owner, 2026-09-10: *"i do think we
should at some point support lighting another room from your room (maybe some kind
of like basic is it in the line of sight algorithm)."* Recorded so the finding is
not re-derived; nothing here is costed to the point of a plan.

## The problem it solves

The dynamic probe layer is **single-room by construction** — a shot into the next
room lights nothing, at any gain. Three mechanisms each forbid it
(detailed in
[2026-09-10-tracer-light-visibility/](2026-09-10-tracer-light-visibility/README.md)):

1. `tracerGatherLights` drops any projectile outside the gather's room + 1.5 m.
2. `dynRoom` is the PLAYER'S room, so the gather packs that room's enclosure,
   furniture, capsules and grid — the probes being lit are the player's.
3. There is exactly ONE dynamic layer (`maxProbes: 10*4*10`, game-main.ts ~2107)
   and exactly one `probeDyn` storage node bound into the level lighting (~2255).

The **muzzle flash has the same gate**, so this is the architecture, not the
tracer feature: firing through a doorway does not light the far room either.

## What already exists (checked, 2026-09-10)

| piece | where | why it matters |
| --- | --- | --- |
| Room adjacency (`TUNNELS` with `.a`/`.b`) | `accentRoomsFor(roomId)`, game-main.ts ~2142-2147 | the room GRAPH is already built and already used per room — "itself plus every room it shares a tunnel with". This is the skeleton of the LOS/adjacency gate. |
| Per-room light list | `levelSceneLights(roomId)` ~2148-2162 | level lighting is ALREADY per-room (each room's walls shade its own + neighbours' accents), so per-room machinery is the existing shape rather than a new one. |
| Per-room probe grids | `roomProbes.gridOf(roomId)`, baked per room in a worker | a room other than the player's already HAS a grid. |
| An LOS primitive | `segmentHitsBox(...)` (game-actor.ts ~737, a brain's line of sight) | the basic "is anything between these two points" test exists and is already used for exactly this kind of question. |
| Per-probe occlusion | the dynamic layer's visibility channel | a lit room's own probes already handle occlusion INSIDE that room. |

## The hard constraint, and it shapes everything

**A probeDyn storage node is bound at material creation and cannot be rebound**
(game-main.ts ~2253: *"Bound at material creation like the tile binding — a
storage node cannot be rebound"*). So "swap in the other room's layer" is not
available. Each room that can receive light from another must have its OWN node
bound when its materials are built — which is plausible precisely because level
lighting is already constructed per room (`levelSceneLights`), but it is the
crux and the thing to spike first.

## Shape of a plausible implementation

1. **Decide WHICH rooms to light.** Candidates: the player's room plus every room
   it shares a tunnel with (`accentRoomsFor`), narrowed to those that actually
   contain a gathered light this frame. The owner's instinct — "basic is it in the
   line of sight" — applies at this step: a room whose light is behind a wall the
   player cannot see through should not be gathered. A cheap version: one
   `segmentHitsBox`-style ray from the eye to the light, or a room-to-room test
   through the tunnel graph (cheaper and more stable than a per-light ray, and it
   can be amortized over frames rather than run per light per frame).
2. **N dynamic layers** instead of one: `probes × 16 floats × 4 B` = 25.6 KB per
   room, so 3-4 rooms is ~100 KB. Each keeps its own afterglow history, which is
   free (it is per-probe state, not a state machine).
3. **N gathers per frame**, each packing ITS room's enclosure, furniture,
   capsules (`nearRoom(actor, thatRoom)`) and grid. Cost is the measured
   0.18 ms/gather, so the player's room + two neighbours ≈ 0.55 ms. Worth
   remembering that the gather is gated to every OTHER frame (`probeGatherRate`),
   which halves that, and that this is affordable ONLY because of R1.
4. **Assign each light to a room by POSITION** rather than "everything to the
   player's room": `roomIdAt(light.pos)` (which already exists, ~2127, and already
   handles tunnel/doorway positions by nearest room centre).
5. **Bind each room's surfaces to its own layer** (the crux above).

## Open questions a plan must answer

- **Which rooms can a light in room B actually affect that the player can SEE?**
  If the player cannot see into room B, the gather is pure waste — but "can see"
  is a portal-visibility question, and the cheap proxy (adjacency + one ray) may
  flicker at doorway edges. Decide the failure mode deliberately.
- **Frame-hash / determinism impact.** `demo-hash.ts` hashes ONE `probeDyn` layer
  key. N layers means either N keys in a defined order or a documented choice of
  one (which would make the hash blind to the others). The pass-off's discipline
  says the hash is the gate that catches what CPU tests cannot, so this needs a
  decision rather than a default.
- **Does the tracer light earn its keep afterwards?** It was reverted at gain 2 on
  2026-09-10 because in the room you shoot FROM the muzzle flash already lights
  it. In a room you are NOT in there is no competing flash — so multi-room is the
  change that would make tracer lights matter for their own sake, and the slot cap
  (the bigger of the two levers) should be revisited then.
- **Tunnels.** A light in a tunnel belongs to the nearest room by centre today
  (`roomIdAt`). A light IN the tunnel mouth arguably lights both rooms; the
  doorway-wall case is already handled for accents (`accentRoomsFor`'s own
  comment), so follow that precedent.
- **Cost ceiling.** Decide N up front (2 neighbours? 3?) and what degrades when
  more rooms have lights than slots — the nearest-to-the-eye rule the tracer path
  already uses is the precedent.
