"""Doom names and numbers -> Blud sector-level names (spec 2026-10-24-doom-sector-levels-design.md §5).

Committed: these are our names for Doom's categories, not Doom data. No texture name from a WAD
appears in a generated level; it is mapped to one of ours here.
"""
from __future__ import annotations

# (prefix, ours), first match wins.
FLAT_FAMILIES = [
    ("F_SKY", "sky"), ("NUKAGE", "nukage"), ("LAVA", "lava"), ("SLIME", "acid"), ("FWATER", "acid"),
    ("BLOOD", "tile"),  # no blood glow material yet: plain tile, not a glow kind
    ("FLOOR", "metal-plate"), ("FLAT", "tile"), ("CEIL", "concrete"),
    ("TLITE", "light-panel"), ("GRNLITE", "light-panel"), ("STEP", "metal-plate"), ("DEM", "tile"),
]
TEXTURE_FAMILIES = [
    ("STAR", "tech"), ("TEK", "tech"), ("COMP", "tech"), ("BROWN", "rust"), ("BRN", "rust"),
    ("DOORTRAK", "metal"), ("BIGDOOR", "door"), ("DOOR", "door"), ("EXIT", "door"), ("STEP", "metal-plate"), ("SUPPORT", "metal"), ("METAL", "metal"), ("LITE", "light-panel"),
    ("STONE", "concrete"), ("GRAY", "concrete"), ("ICKW", "concrete"), ("PIPE", "metal"), ("SW1", "tech"),
]
GLOW_MATERIALS = {"nukage", "lava", "acid"}

# Linedef specials: manual doors (locked ones treated as plain in step 1-2: E1M1 has none) and exits.
DOOR_SPECIALS = {1, 26, 27, 28, 31, 32, 33, 34, 117, 118}
EXIT_SPECIALS = {11, 51, 52, 124}

# Remotely triggered line specials (the line's tag names the target sectors). Step 1 is static, so each
# class is applied once when converting; moving them is plan 2.
# Doors (raise / open / close variants alike): the target sector is written OPEN.
REMOTE_DOOR_SPECIALS = {2, 4, 16, 29, 46, 61, 63, 86, 90, 103, 105, 106, 108, 109, 111, 112, 114, 115}
# Floor lowers: written LOWERED to the lowest neighbouring floor (also for the "to highest / next" variants).
FLOOR_LOWER_SPECIALS = {19, 23, 36, 37, 38, 45, 60, 70, 71, 82, 83, 84, 98, 102}
# Reserved: lifts are static until the doors/lifts plan (a lift at its top is a known gap).
LIFT_SPECIALS = {10, 21, 62, 88, 120, 121, 122, 123}

# Sector types -> (special, hurtPerSec). Doom hurts every 32 tics (~0.91 s); we use per second.
SECTOR_TYPES = {
    1: ("flicker", 0), 2: ("strobe", 0), 3: ("strobe", 0), 4: ("hurt", 20), 5: ("hurt", 10),
    7: ("hurt", 5), 8: ("pulse", 0), 12: ("strobe", 0), 13: ("strobe", 0), 16: ("hurt", 20), 17: ("flicker", 0),
}


def _family(name: str, table: list[tuple[str, str]], default: str) -> str:
    for prefix, ours in table:
        if name.startswith(prefix):
            return ours
    return default


def material_for_flat(name: str) -> str:
    return _family(name.upper(), FLAT_FAMILIES, "concrete")


def material_for_texture(name: str) -> str:
    return _family(name.upper(), TEXTURE_FAMILIES, "tech")


def sector_special(kind: int) -> tuple[str, float]:
    return SECTOR_TYPES.get(kind, ("none", 0))
