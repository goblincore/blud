# scripts/levels/flat_layout.py
"""The Flat's room: every number the build script, the texture script and the tests share.

Blender space (x, y, z), z up. North (the window wall) is +y. Game space is (x, z, -y).
Pure python: importable from Blender and from plain python3. `python3 scripts/levels/flat_layout.py` runs the self-check.
Dimensions are the 2026-10-01 look-dev's (docs/dev-notes/2026-10-01-flat-room-lookdev/room.py, lines 213-224).
"""
import math

X0, X1, Y0, Y1 = -1.35, 1.35, 0.0, 3.6          # six tatami: 2.7 m wide, 3.6 m long
SPRING = 1.95                                   # the vault springs from the side walls here
RV = 1.8                                        # the vault's radius
CZ = SPRING - math.sqrt(RV * RV - X1 * X1)      # the vault circle's centre height
CROWN = CZ + RV                                 # about 2.56 m
FLOOR = 0.055                                   # top of the tatami (the room box's floor is z 0)
RIBS = (0.9, 1.8, 2.7)                          # transverse ribs; the middle one is the vertebral (Giger) rib

WX, WH, WS, WSP, WDEPTH = 0.12, 0.36, 0.62, 1.42, 0.62   # window: centre x, half width, sill z, springing z, wall thickness
KX, KY, KTOP = 0.12, 2.36, 0.44                 # kotatsu: centre and board top
# The front door: a closed arched oak door in a stone surround, in the south wall on the window's axis (the end walls rise to the vault; the side walls stop
# at the spring line, too low for an arch). Nothing is outside yet. DHW: half width; DSP: where the arch springs; the arch's crown is DSP + DHW.
DX, DHW, DSP = WX, 0.40, 1.65

# --- The apartment (spec 2026-10-11-flat-apartment-design.md): the flat grows south (an entry hall) and east (a bathroom) of the room.
HY0 = -2.0                                       # the hall's south wall: the front door's plane
BX1 = 3.1                                        # the bathroom's east wall
PX, PHW, PSP = DX, 0.60, 1.55                    # the passage: the room's old south wall (y 0) opens through an arch 1.2 m wide, springing at 1.55 m
BDY, BDHW, BDH = -1.1, 0.40, 1.90                # the bathroom doorway in the hall's east wall: centre y, half width, height (the player's capsule is 1.75 m tall and
                                                 # stands 8 cm up on the genkan step: 1.75 hit the lintel; the impost course above, at about 1.9 m, is the lintel)
GENKAN_Y, GENKAN_H = -1.3, 0.08                  # the hall's floor is stepped up 8 cm north of this line
PART_T = 0.20                                    # the partition's thickness (the stone blocks are 0.16 deep; the bathroom's lining sits on the far side)
TUB = (2.66, -1.075, 0.74, 1.54)                 # the claw-foot tub: centre x, centre y, width, length

# The Giger iMac (machine stage 3), on the kotatsu (room.py 881-885). Its face looks south, toward the player; the cranium sweeps north and up.
IM_FRONT = KY - 0.06                            # the face's plane (y)
IM_Z = KTOP + 0.235                             # the face's centre height
IM_LEN = 0.56                                   # the face to the tip of the cranium
IM_W, IM_H = 0.185, 0.18                        # half width, half height at the face
NICHE = (2.42, 3.12, 0.92, 1.62)                # west wall niche: y0, y1, z0, z1
SH_X0, SH_Y0, SH_Y1, SH_H = X1 - 0.27, 1.55, 2.95, 1.55   # the bookshelf (east wall)


def vault_z(x):
    return CZ + math.sqrt(max(0.0, RV * RV - x * x))


# Each wall's texture covers WALL_W[name] x WALL_H metres, starting at WALL_U0[name] along the wall (x for n/s, y for e/w).
WALL_H = 2.7
WALL_W = {"n": X1 - X0 + 0.2, "s": X1 - X0 + 0.2, "e": Y1 + 0.2, "w": Y1 + 0.2}
WALL_U0 = {"n": X0 - 0.1, "s": X0 - 0.1, "e": Y0 - 0.1, "w": Y0 - 0.1}
# Wet and rust runs (room.py 432-446): (u along the wall in metres from the texture's left edge, z, spread, length, strength).
STAINS = {
    "n": [(WX - 0.32 - X0 + 0.1, WS - 0.08, 0.05, 0.55, 0.9), (WX + 0.32 - X0 + 0.1, WS - 0.08, 0.05, 0.5, 0.8),
          (-1.0 - X0 + 0.1, 1.6, 0.06, 0.75, 0.9), (0.74 - X0 + 0.1, 0.5, 0.04, 0.4, 0.8),
          (X1 - 0.12 - X0 + 0.1, 2.2, 0.08, 1.5, 1.0), (0.0 - X0 + 0.1, 2.42, 0.1, 1.0, 0.9)],
    "e": [(3.3 + 0.1, 1.15, 0.07, 0.4, 1.0), (3.2 + 0.1, 1.9, 0.05, 0.6, 0.8), (Y1 - 0.12 + 0.1, 2.0, 0.07, 1.4, 1.0),
          (0.5 + 0.1, 1.9, 0.05, 0.9, 0.6)],
    "w": [(2.3 + 0.1, 1.8, 0.06, 1.7, 1.0), (2.77 + 0.1, 0.88, 0.1, 0.5, 0.6), (1.0 + 0.1, 1.9, 0.05, 0.8, 0.5)],
    "s": [],
}
WALL_W["eh"] = WALL_W["wh"] = 2.0               # the hall segments of the west and east walls: y from HY0 - 0.1 to -0.1 (they meet the room segments there)
WALL_U0["eh"] = WALL_U0["wh"] = HY0 - 0.1
STAINS["eh"] = [(0.8, 1.7, 0.05, 0.6, 0.7), (1.5, 0.45, 0.04, 0.4, 0.6)]
STAINS["wh"] = [(1.3, 1.9, 0.06, 0.9, 0.8)]

# The player starts in the entry hall by the front door, facing north (yaw 0 faces +y here, -z in game space).
START = (0.12, -1.55, 0.0)                      # x, y, z (z is the floor)

# Collision boxes ("furniture"): name -> ((minx, miny, minz), (maxx, maxy, maxz)).
ROOM_BOX = ((X0, HY0, 0.0), (BX1, Y1, round(CROWN, 3)))
COLLISION = {
    # The engine's capsule steps up onto a box lower than about 0.5 m (least-penetration push-out), so the kotatsu's collider is
    # taller than its board: the player cannot climb the table. The futon stays low on purpose: a cushion you walk over.
    "kotatsu": ((KX - 0.41, KY - 0.41, 0.0), (KX + 0.41, KY + 0.41, 0.9)),
    "futon": ((-1.325, 0.3, 0.0), (-0.475, 2.2, 0.15)),
    "fridge": ((-1.29, 3.04, 0.0), (-0.79, 3.56, 0.92)),
    "counter": ((0.79, 3.07, 0.0), (1.35, 3.59, 0.83)),
    "shelf": ((SH_X0, SH_Y0, 0.0), (X1, SH_Y1, SH_H)),
    # the apartment (fixtures are at least 0.6 m high so the player cannot climb them; the genkan step is meant to be stepped onto)
    "genkan": ((X0, GENKAN_Y, 0.0), (X1, -0.16, GENKAN_H)),
    "cubby": ((X0, -1.75, 0.0), (X0 + 0.32, -0.85, 0.6)),
    "tub": ((TUB[0] - TUB[2] / 2, TUB[1] - TUB[3] / 2, 0.0), (TUB[0] + TUB[2] / 2, TUB[1] + TUB[3] / 2, 0.75)),
    "toilet": ((1.64, -0.72, 0.0), (2.06, 0.0, 0.85)),
    "sink": ((1.60, -2.0, 0.0), (2.12, -1.68, 0.90)),
}

# Solids: the walls inside the room box (collision only; the art draws them). The filler is the block east of the room (never seen); the partition is the
# hall's east wall with the bathroom doorway cut out; the passage's two halves and its lintel are the room's old south wall.
SOLIDS = {
    "filler": ((X1 - 0.02, 0.0, 0.0), (BX1, Y1, round(CROWN, 3))),
    "partition_s": ((X1 - 0.02, HY0, 0.0), (X1 + PART_T, BDY - BDHW, round(CROWN, 3))),
    "partition_n": ((X1 - 0.02, BDY + BDHW, 0.0), (X1 + PART_T, 0.0, round(CROWN, 3))),
    "partition_lintel": ((X1 - 0.02, BDY - BDHW, BDH), (X1 + PART_T, BDY + BDHW, round(CROWN, 3))),
    "passage_w": ((X0, -0.16, 0.0), (PX - PHW, 0.02, round(CROWN, 3))),
    "passage_e": ((PX + PHW, -0.16, 0.0), (X1, 0.02, round(CROWN, 3))),
    "passage_lintel": ((PX - PHW, -0.16, PSP + PHW), (PX + PHW, 0.02, round(CROWN, 3))),
}

# Point lights: (name, position, colour, power, extra custom properties). Powers are starting values, tuned in Task 8.
# fixture "none": the engine draws no bulb (the room's art is the lamp: the lantern, the candle, the iMac, the window).
LIGHTS = [
    ("window", (WX, Y1 - 0.25, 1.4), (0.62, 0.74, 0.90), 3.0, {"fixture": "none"}),         # the only cool light (no shadow: the format allows it on tube fixtures only)
    ("lantern", (0.0, 1.05, CROWN - 0.62), (1.0, 0.36, 0.20), 2.0, {"fixture": "none"}),
    ("candle", (X0 + 0.14, 2.05, 1.53), (1.0, 0.65, 0.35), 1.0, {"fixture": "none"}),
    ("amber", (KX + 0.03, IM_FRONT + 0.36, IM_Z - 0.06), (1.0, 0.50, 0.20), 0.35, {"fixture": "none"}),   # in the iMac's guts, behind the creature
    ("amber2", (KX - 0.04, IM_FRONT + 0.14, IM_Z - 0.10), (1.0, 0.45, 0.20), 0.15, {"fixture": "none"}),   # in the guts, nearer the face
    ("screen", (KX, IM_FRONT - 0.05, IM_Z + 0.05), (0.75, 0.80, 1.0), 0.25, {"fixture": "none"}),          # the screen's light into the room
    ("hall", (X1 - 0.2, -0.45, 1.97), (1.0, 0.72, 0.42), 0.9, {"fixture": "none"}),                       # the sconce by the bathroom doorway
    ("bath", (2.0, -1.0, 2.12), (0.85, 1.0, 0.82), 0.9, {"fixture": "none"}),                             # a bare bulb on the bathroom ceiling
]


def inside(p, box, pad=0.0):
    (a, b) = box
    return all(a[i] - pad <= p[i] <= b[i] + pad for i in range(3))


def check():
    assert abs(CROWN - 2.559) < 0.005, CROWN
    assert inside(START, ROOM_BOX), "start outside the room"
    for name, box in COLLISION.items():
        assert inside(box[0], ROOM_BOX, 1e-6) and inside(box[1], ROOM_BOX, 1e-6), f"{name} leaves the room"
        assert not inside(START, box), f"start is inside {name}"
    assert WX - WH > X0 and WX + WH < X1, "window outside the north wall"
    assert WSP + WH < vault_z(WX), "window arch hits the vault"
    assert DSP + DHW + 0.2 < vault_z(DX), "the door's arch and its surround hit the vault"
    assert X0 + 0.3 < DX - DHW - 0.22 and DX + DHW + 0.22 < X1 - 0.3, "the door's surround leaves the south wall"
    for name, pos, col, power, _ in LIGHTS:
        assert inside(pos, ROOM_BOX), f"light {name} outside the room"
        assert all(0 <= c <= 1 for c in col) and power > 0
    for k, w in WALL_W.items():
        assert 1.0 < w <= 4.0
        for u, z, spread, length, strength in STAINS[k]:
            assert 0 <= u <= w and 0 <= z <= WALL_H, (k, u, z)
    def overlaps(a, b):
        return all(a[0][i] < b[1][i] and b[0][i] < a[1][i] for i in range(3))
    for name, box in SOLIDS.items():
        assert inside(box[0], ROOM_BOX, 1e-6) and inside(box[1], ROOM_BOX, 1e-6), f"solid {name} leaves the room"
        assert not inside(START, box), f"start is inside {name}"
    bath_door = ((X1, BDY - BDHW + 0.02, 0.0), (X1 + PART_T, BDY + BDHW - 0.02, BDH - 0.02))
    passage = ((PX - PHW + 0.02, -0.16, 0.0), (PX + PHW - 0.02, 0.02, PSP))
    for name, box in {**COLLISION, **SOLIDS}.items():
        if name != "genkan":
            assert not overlaps(box, bath_door), f"{name} blocks the bathroom doorway"
            assert not overlaps(box, passage), f"{name} blocks the passage"
    assert PSP + PHW + 0.2 < vault_z(PX), "the passage's arch and its surround hit the vault"
    assert -0.16 > BDY + BDHW and BDY - BDHW > HY0 + 0.2, "the bathroom doorway runs off the hall's wall"
    assert TUB[0] + TUB[2] / 2 < BX1 and TUB[1] - TUB[3] / 2 > HY0, "the tub leaves the bathroom"
    assert X1 + PART_T < TUB[0] - TUB[2] / 2 - 0.5, "the tub is too close to the doorway"
    print("flat_layout: ok")


if __name__ == "__main__":
    check()
