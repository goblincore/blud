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

# The player starts at the south end, facing the window (yaw 0 faces +y here, -z in game space).
START = (0.12, 0.55, 0.0)                       # x, y, z (z is the floor)

# Collision boxes ("furniture"): name -> ((minx, miny, minz), (maxx, maxy, maxz)).
ROOM_BOX = ((X0, Y0, 0.0), (X1, Y1, round(CROWN, 3)))
COLLISION = {
    # The engine's capsule steps up onto a box lower than about 0.5 m (least-penetration push-out), so the kotatsu's collider is
    # taller than its board: the player cannot climb the table. The futon stays low on purpose: a cushion you walk over.
    "kotatsu": ((KX - 0.41, KY - 0.41, 0.0), (KX + 0.41, KY + 0.41, 0.9)),
    "futon": ((-1.325, 0.3, 0.0), (-0.475, 2.2, 0.15)),
    "fridge": ((-1.29, 3.04, 0.0), (-0.79, 3.56, 0.92)),
    "counter": ((0.79, 3.07, 0.0), (1.35, 3.59, 0.83)),
    "shelf": ((SH_X0, SH_Y0, 0.0), (X1, SH_Y1, SH_H)),
}

# Point lights: (name, position, colour, power, extra custom properties). Powers are starting values, tuned in Task 8.
# fixture "none": the engine draws no bulb (the room's art is the lamp: the lantern, the candle, the iMac, the window).
LIGHTS = [
    ("window", (WX, Y1 - 0.25, 1.4), (0.62, 0.74, 0.90), 3.0, {"fixture": "none"}),         # the only cool light (no shadow: the format allows it on tube fixtures only)
    ("lantern", (0.0, 1.05, CROWN - 0.62), (1.0, 0.36, 0.20), 2.0, {"fixture": "none"}),
    ("candle", (X0 + 0.14, 2.05, 1.53), (1.0, 0.65, 0.35), 1.0, {"fixture": "none"}),
    ("amber", (KX, KY + 0.14, 0.75), (1.0, 0.62, 0.20), 1.6, {"fixture": "none"}),                    # where the iMac will sit
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
    for name, pos, col, power, _ in LIGHTS:
        assert inside(pos, ROOM_BOX), f"light {name} outside the room"
        assert all(0 <= c <= 1 for c in col) and power > 0
    for k, w in WALL_W.items():
        assert 1.0 < w <= 4.0
        for u, z, spread, length, strength in STAINS[k]:
            assert 0 <= u <= w and 0 <= z <= WALL_H, (k, u, z)
    print("flat_layout: ok")


if __name__ == "__main__":
    check()
