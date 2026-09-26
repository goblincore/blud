# Night Train art direction v2: a grimy industrial prison train — Design

**Date:** 2026-09-25 · **Status:** approved (owner, 2026-09-25)
**Part 1 of 3** of the Night Train look revision (below). **Replaces** the old-timey wood direction of
the [carriage kit spec](2026-09-25-train-carriage-kit-design.md) §1 and §3 (materials and pieces);
its structure (bays, sized shells, partitions, the layout-driven build, window scenery, sway) stays.
**Layout:** [layout.md](../../game/levels/01-night-train/layout.md) (draft 1, unchanged).

## 1. Why

After playing the first build, the owner's verdict (2026-09-25): the interior is **too
representational**. It tries to be a real period train, and this isn't a normal train: it is "some
mind-flesh prison on a trip to some godforsaken planet". It should be **darker, metal, grimy**. That
fits the vision better than wood panelling did: the Stoker's fire runs on bodies, and the train is
carrying its cargo toward the Party.

**The three parts** (owner-approved, in this order):

1. **This spec:** the restyle, a grimy industrial prison train (kit materials and pieces).
2. **Dynamic light and the flashlight:** the flashlight becomes a pickup (the level starts dark;
   it hangs by a dying lamp in the baggage hold, and picking it up wakes the trunk zombie; no
   battery); failing lamps; light sweeping past the windows; furnace and firebox glow.
   **Owner addition (2026-09-25): the view outside becomes a thunderstorm** (a `storm` window
   preset: roiling clouds, rain on the glass, lightning bolts), and **lightning lights the
   interior** through the windows, timed with the bolts in the glass. Open for that spec: does
   lightning replace the passing-light sweeps, or join them?
3. **Haze and volumetric light:** drifting smoke; raymarched light for **every** light. Occluded
   shafts where a light has a shadow map (the flashlight; a moon-style directional light through the
   windows), glow in the haze for lamps and furnaces; reduced resolution plus temporal smoothing.

Parked, independent of all three: keys and locked doors (coloured placeholders), a longer train
(layout draft 2).

## 2. Direction (owner decisions)

- **A party train inside an industrial prison train.** The approved layout and its carriage program
  stay (van, dining car, sleeper, party carriage, cab). The guests are cargo, not passengers: party
  remnants sit inside something caged, industrial and filthy.
- **Keep train elements:** chairs, booths, benches, bunks, luggage racks, but worn and industrial.
- **Industrial, grimy, dirty:** brushed and scratched grey steel, shiny and specular; soot, rust,
  grime; **pipes, gears, valve wheels**, gauges, grilles, rivets, cages.
- **Dark.** The palette is greys, rust, soot black; the party's colours and fire are the only warmth.

## 3. Materials (baked from Blender procedurals, at most 1024 px)

Each material bakes **base colour**, **roughness** and **normal** (from a procedural bump), so the
steel reads as scratched and specular under the flashlight. glTF carries them as the base colour,
metallic-roughness and normal textures.

| Material | Look | Metallic / roughness |
| --- | --- | --- |
| `train.steel` | brushed grey steel, fine streaks along one axis, faint scratches | 1.0 / 0.30–0.45 (from the map) |
| `train.steel-scratched` | darker steel, heavy scratches and dents, grime in the scratches | 1.0 / 0.4–0.65 |
| `train.plate` | riveted steel plate: a rivet grid in the normal map, soot toward the bottom of each tile | 1.0 / 0.45 |
| `train.grate` | floor grating over a dark void (normal-mapped bars, dark in the gaps) | 1.0 / 0.5 |
| `train.rust` | rust and grime streaks, dull | 0.3 / 0.85 |
| `train.pipe` | oxidised painted pipe (dull green-grey), chipped to steel | 0.6 / 0.55 |
| `train.brass-old` | tarnished brass for gauges, valve wheels, fittings | 1.0 / 0.4 |
| `train.leather` | cracked dark oxblood leather | 0.0 / 0.6 |
| `train.soot` | a soot gradient for grime decals (alpha) | 0.0 / 1.0 |
| `train.party` | party remnants: saturated reds, golds, teal (streamers, hats, favours) | 0.0 / 0.7 |

Unchanged: `train.lamp`, `train.firebox` (emissive), `window:night` (the scenery shader). The wood,
panel, velvet and runner materials leave the kit.

## 4. Pieces (the same kit names where the role is the same)

**Shell (bays, sized per carriage as now):**

- **Walls:** riveted steel plates below (0.95 m), brushed steel panels above, with a heavy bolted
  steel window frame; **two pipe runs** along each wall (about 0.3 m and 2.1 m up, bracketed every
  bay); at every other bay a **valve wheel** or **gauge cluster** on the lower pipe.
- **Pillars:** I-beam steel ribs between bays, rivets on the flanges.
- **Ceilings:** a steel arch with a **rib** at every bay and a clerestory channel carrying a **large
  pipe** down the centre; the round lamp becomes a caged industrial lamp.
- **Floors:** steel plate with a **grating** strip down the aisle (replacing the runner).
- **End walls:** a riveted bulkhead with a heavy door frame (the opening stays 1.4 m).
- **Partitions:** riveted steel sheet; the **sleeper's compartment fronts become cages** (bars between
  the doorway and the corridor wall, so you can see into the compartments), and the van's **mail
  cage** is literally caged (bar partitions).
- **Vestibule:** iron bellows, grating floor, a pipe run.
- **Grime:** soot decals (`train.soot`) along the base of every wall, around furnaces and under
  pipes; rust streaks under valves.

**Props:**

- **Dining car:** **booths** (facing leather benches with a steel table between, replacing the
  table-and-chairs pairs), a steel buffet island, galley stoves and counter in steel.
- **Sleeper:** bunks as steel racks with thin grey mattresses.
- **Van:** iron-mesh luggage racks, battered trunks and coffins, a steel desk, a stove.
- **Party carriage:** a steel bar, riveted steel columns for the pillars, a battered jukebox, steel
  favour tables.
- **New, industrial:** a **wall boiler/furnace** (a cylinder with a glowing grate; the lighting spec
  gives it light), **gear housings** (exposed gears on bulkheads), **grilles**.
- **Party remnants:** streamers hanging from pipes, party hats and favours on tables, bunting sagging
  across ceiling pipes. The only colour.

**The cab:** the same shell, blackened steel, more pipes and gauges; the firebox is the brightest
thing in the train.

## 5. Light, for now

This spec only darkens and restyles; lighting behaviour is part 2. Level lights drop in power (the
carriages read dark; the flashlight carries the view), and lamp emissives dim. The window scenery
and sway are unchanged.

## 6. Build and review

- `build_train_kit.py` rebuilds the kit with the new materials (baked colour, roughness, normal) and
  pieces; `build_night_train.py` places them from the same layout tables (booths replace the
  `table` prop's chairs; cage partitions for the sleeper and the mail cage; boilers, gears, grilles
  and remnants from a small dressing table per carriage).
- **Review:** Blender eye-height renders of every room, then in-game screenshots, for the owner.
- **Checks:** the level tests (the layout is unchanged), the train gate (windows, sway, the walk
  through every room, cost within **+200 draws / +10 ms**; raised by the owner to **+350 / +12 ms**
  after the build measured +229..+332 draws, +8.7..+11.4 ms, 2026-09-26), the other gates; textures at most 1024 px.

## 7. Out of scope

Haze, volumetric light, the flashlight pickup, dynamic lights (parts 2 and 3); keys; a longer train;
the Stoker.
