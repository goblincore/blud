# The Wake: layout (draft 1)

**Date:** 2026-09-23 · **Status:** draft 1, **awaiting owner approval** (not built; draft 0 is what plays today)
· **Design:** [design.md](design.md) · **Study:** [reference-study.md](reference-study.md)
· **Guide:** [level design guide](../level-design-guide.md) §5 · **Format:** Level Format v1

Game space: metres, x right, **−z north** (the player heads north), y up. Every
floor is at y = 0 (v1). Rooms joined back to back use 0.6 m "door" tunnels (the
two 0.3 m walls). The tables are exactly what
`scripts/levels/build_the_wake_blockout.py` will build once this is approved.

## 1. Rooms

| id | Room | x | z | Height | Sky | Holds |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | gates | −6…6 | −10…0 | 5.0 | night | start, gatehouse, gate posts, lamp |
| 2 | lane | −2.5…2.5 | −26…−10.6 | 4.0 | night | hedged path, two low tombs, 2 zombies one at a time |
| 3 | graveyard | −16…16 | −58…−26.6 | 8.5 | night | open grave + sawn-off, bell tower (centre), mausoleum (NW), headstone rows, 5 zombies, 14 wave graves |
| 4 | crypt | −3…3 | −76…−62 | 2.8 | — | sarcophagi, 1 zombie, shells |
| 5 | ossuary | 3.6…11 | −74…−64 | 2.6 | — | the closet fight: 4 zombies round a pillar, **dynamite** |
| 6 | vestibule | −4…4 | −86…−80 | 3.0 | — | health + shells before the big fight (nobody here) |
| 7 | parlour | −10…10 | −110…−86.6 | 6.0 | — | 4 rows of pews, 8 mourners, coffin + CD, organ, **the train window** |
| 8 | secret | 18…22 | −44…−37 | 2.5 | — | health, shells |

## 2. Corridors

| a → b | x | z | Height | Notes |
| --- | --- | --- | --- | --- |
| 1 → 2 | −1.5…1.5 | −10.6…−10 | 3.5 | the iron gates |
| 2 → 3 | −1.5…1.5 | −26.6…−26 | 3.5 | lych gate; the bell tower is dead ahead |
| 3 → 4 | −1.2…1.2 | −62…−58 | 2.6 | crypt stairs; gate `crypt-slab` (z −59…−58.6) opens on `bell.toll.1` |
| 4 → 5 | 3…3.6 | −66.4…−64.8 | 2.2 | ossuary door A |
| 4 → 5 | 3…3.6 | −73…−71.4 | 2.2 | ossuary door B: with A, a loop round the ossuary pillar |
| 4 → 6 | −1…1 | −80…−76 | 2.4 | stairs up into the funeral home (at grade in v1) |
| 6 → 7 | −1.5…1.5 | −86.6…−86 | 2.8 | parlour doors |
| 3 → 8 | 16…18 | −41.4…−40 | 2.0 | fence gap, 1.4 m (the grid's minimum) |

## 3. Encounters

Zombies only (see §9). 20 standing + 14 from graves = 34 if all three tolls are rung
(design: 15–25 before the bell).

| Where | Spawns | Wakes on | Player is |
| --- | --- | --- | --- |
| Lane | `lane-1` (0, −17), `lane-2` (−1.5, −24.5) | seeing the player | coming through the iron gates, melee only. One at a time: `lane-2` is 7.5 m behind |
| Open grave | graves `w0-1`, `w0-2` (±3, −33) | `wave.0`: stepping onto the grave to take the sawn-off | at the grave, gun in hand |
| Graveyard | `yard-1…5`: SW, E, W, NE, and N by the slab | seeing the player | anywhere in the ring round the tower |
| Bell toll 1 | 3 graves: W, E, N of the tower | shooting the bell | wherever they shot from; the slab opens |
| Tolls 2, 3 | 4, then 5 graves on every side of the tower | shooting the bell again | their choice: they can leave after toll 1 |
| Crypt | `crypt-1` (0, −70) | seeing the player | coming down the stairs |
| Ossuary | `ossuary-1…4`, one per corner round the pillar | seeing the player | at either door. Two doors, one pillar: circle it |
| Parlour | `mourner-1…8`, seated between the pew rows, facing the coffin | `alert.room.7`: the trigger 2–4 m inside the doors | walking up the aisle |

## 4. Sightlines

| From | Sees first |
| --- | --- |
| The start (gates) | down the lane axis: the lych gate and, over it, the bell tower's fire (the level's goal) |
| The lych gate | the open grave 3 m ahead with the gun in it; the tower behind it |
| Round the tower's north side | the crypt slab in the north wall, shut |
| The crypt stairs | the crypt's green glow; the ossuary doors off to the right |
| The parlour doors | the centre aisle, the coffin on its stand and, behind it, the lit train in the window |

## 5. Loops

- **The graveyard rings the bell tower.** 5–13 m lanes on all four sides, headstone
  rows as waist-high cover with ≥ 1.4 m aisles; every wave can be circled.
- **The ossuary loop.** Two doors from the crypt, a pillar in the middle.
- **The parlour aisles.** Centre aisle 2.4 m, side aisles 1.6 m; the pew blocks
  make two loops.

## 6. Secrets

| Secret | Where | Hint | Holds |
| --- | --- | --- | --- |
| Fence gap | graveyard east wall at z −41 → room 8 | two broken fence posts and a red glow through the gap, visible from the east lane | health, shells |

Design §7's optional crypt secret is not placed yet.

## 7. Pickups

| Pickup | Where | Pays for |
| --- | --- | --- |
| sawn-off + shells | in and beside the open grave | wave 0 and the graveyard |
| shells ×2 | the far west and far east lanes | the yard fight, the waves |
| shells | crypt stairs foot | crypt, ossuary |
| dynamite + shells | ossuary | the closet fight's reward; teaches the throw before the parlour |
| health + shells | vestibule | the parlour (health near the fight room, never in it) |
| health + shells | secret | — |
| CD | on the coffin | ends the level |

## 8. Changes from draft 0, and why

| Change | Study lesson |
| --- | --- |
| The gates exit straight into a lane with two single zombies, melee only; the gun is past them | 1, 2 (first fight alone and melee, gun after it) |
| The bell tower moves to the **centre** of the graveyard and the crypt slab to the far wall behind it, so the graveyard is a ring, not an empty square | 4 (the cemetery is a loop) |
| Headstones in rows with aisles, not scattered | 4, and guide §3 (≥ 1.4 m where enemies path) |
| Wave graves on every side of the tower | 5 (rise from ground the player must cross) |
| The crypt splits into a hall and an ossuary with two doors: a small closet fight guarding the dynamite | 7 (closet fights guard loot), 9 (teach the throw early) |
| A vestibule before the parlour holds health; nobody is in it | 9 (health near, never in, the fight room) |
| The parlour grows (20 × 23 m, 6 m tall), 8 mourners, pews in blocks with aisles | 3 (one big hall), 10 (biggest fight second to last) |
| Outdoor rooms are open-sky (`sky: night`) | 3 (open vs enclosed); the format and engine support it |
| The window sits right behind the coffin, so the train is in view for the whole walk up the aisle | 10 (end outward) |

Not taken: study lesson 4's "graveyard rings the funeral home" (v1 can't wrap
an L-shaped yard round a building without many more rooms; the tower loop
does the job), and lesson 6 (a soldier on a key: the Wake has no keys).

## 9. Enemy swaps

None. The Wake is all zombies. Open question for the owner: one `soldier` by
the crypt slab, visible from the lych gate (study lesson 6, design open question 5)?

## 10. Plan drawing

`python3 scripts/levels/level_plan.py <file>` (guide §5.1). Draft 0 and draft 1
drawn side by side at the same scale: `.lab-tmp/level-plans/the-wake-draft0-vs-layout1.png`
(not committed; regenerate from the tables).

## 11. Risks to check when building

- Open-sky rooms haven't been played yet: check the fog and lighting read at night
  with no ceiling.
- The graveyard (32 × 31 × 8.5 m) and parlour (20 × 23 × 6 m) are the biggest probe
  grids so far; Task 6 measured draft 0 (28 × 28 × 8 m) at a normal boot.
