"""Doom names and numbers -> Blud sector-level names (spec 2026-10-24-doom-sector-levels-design.md §5).

Committed: these are our names for Doom's categories, not Doom data. No texture name from a WAD
appears in a generated level; it is mapped to one of ours here.
"""
from __future__ import annotations

# (prefix, ours): the LONGEST matching prefix wins (so COMPUTE beats COMP, EXITSIGN beats EXIT), whatever
# the order. Emitters (2026-10-26, hand-off item 2g): screen-bank (computer banks), viewscreen (the big
# display wall), fluorescent (strip and ceiling lights; LITEBLU* stays a light panel), exit-sign. COMPSPAN / COMPTILE stay tech trim.
FLAT_FAMILIES = [
    # SLIME01..08 are Doom 2's liquid; SLIME09..16 are solid, rock and metal flats (MAP28 walks on them).
    ("F_SKY", "sky"), ("NUKAGE", "nukage"), ("LAVA", "lava"), ("SLIME", "acid"), ("SLIME09", "concrete"), ("SLIME1", "metal-plate"), ("FWATER", "acid"),
    ("BLOOD", "tile"),  # no blood glow material yet: plain tile, not a glow kind
    ("FLOOR", "metal-plate"), ("FLAT", "tile"), ("CEIL", "concrete"),
    ("TLITE", "fluorescent"), ("GRNLITE", "light-panel"), ("STEP", "metal-plate"), ("DEM", "tile"),
    ("SFLR", "metal-plate"), ("CRATOP", "metal-plate"), ("GATE", "metal-plate"),
]
TEXTURE_FAMILIES = [
    ("STAR", "tech"), ("TEK", "tech"), ("COMP", "tech"), ("COMPUTE", "screen-bank"), ("COMPTALL", "screen-bank"),
    ("PLANET", "viewscreen"), ("EXITSIGN", "exit-sign"), ("BROWN", "rust"), ("BRN", "rust"),
    ("DOORTRAK", "metal"), ("BIGDOOR", "door"), ("DOOR", "door"), ("EXIT", "door"), ("STEP", "metal-plate"), ("SUPPORT", "metal"), ("METAL", "metal"), ("LITE", "fluorescent"),
    ("ROCKRED", "redrock"),
    ("STONE", "concrete"), ("GRAY", "concrete"), ("ICKW", "concrete"), ("PIPE", "metal"), ("SW1", "tech"),
    ("LITEBLU", "light-panel"),  # blue-lit strips: the plain light panel, not a cold-white troffer
    # Doom 2's hell set (MAP28). Red rock, flesh and fire have their own looks (owner playtest 2026-11-01); we own no
    # wood or grey rock look yet, so those take the nearest of ours: rock and marble are concrete, wood the rusted brick.
    ("ZIMMER", "concrete"), ("ROCK", "concrete"), ("ASHWALL", "concrete"), ("TANROCK", "concrete"), ("CRACKLE", "concrete"), ("MARB", "concrete"),
    ("SK", "flesh"), ("SP_FACE", "flesh"), ("SW2SKIN", "flesh"), ("SP_HOT", "firewall"), ("WOOD", "rust"), ("SW1WOOD", "rust"),
    ("BRONZE", "metal"), ("MIDBARS", "metal"),
    ("FIRE", "firewall"), ("FIREBLU", "fireblue"), ("BFALL", "flesh"), ("SFALL", "light-panel"), ("SPCDOOR", "door"),
]
# ROOM MOODS (owner playtest 2026-11-01: "everything feels the same"). Doom's rooms differ by texture set: the mood a zone's
# wall textures vote for sets its ambient tint (`tint`, how dark included) and its fill light's colour.
MOODS = {
    "ember": {"tint": [1.15, 0.5, 0.3], "light": [1.0, 0.36, 0.18]},   # red rock: hot and dim
    "cold": {"tint": [0.62, 0.72, 1.0], "light": [0.55, 0.7, 1.0]},      # grey stone and marble
    "dust": {"tint": [0.85, 0.68, 0.44], "light": [1.0, 0.8, 0.52]},     # tan rock, brown
    "sepia": {"tint": [0.82, 0.54, 0.28], "light": [1.0, 0.62, 0.3]},    # wood
    "flesh": {"tint": [0.95, 0.42, 0.42], "light": [1.0, 0.22, 0.28]},    # meat
    "fire": {"tint": [1.0, 0.46, 0.14], "light": [1.0, 0.42, 0.1]},
    "bluefire": {"tint": [0.26, 0.4, 1.0], "light": [0.25, 0.45, 1.0]},
}
TEXTURE_MOODS = [
    ("ROCKRED", "ember"), ("ZIMMER", "cold"), ("ASHWALL", "cold"), ("MARB", "cold"), ("CRACKLE", "ember"), ("TANROCK", "dust"), ("BROWN", "dust"),
    ("WOOD", "sepia"), ("SK", "flesh"), ("SP_FACE", "flesh"), ("BFALL", "flesh"), ("FIRE", "fire"), ("SP_HOT", "fire"), ("FIREBLU", "bluefire"),
]
GLOW_MATERIALS = {"nukage", "lava", "acid"}

# Linedef specials: manual doors (locked ones treated as plain in step 1-2: E1M1 has none) and exits.
DOOR_SPECIALS = {1, 26, 27, 28, 31, 32, 33, 34, 117, 118}
EXIT_SPECIALS = {11, 51, 52, 124}
# Door entities (doors in the level file, 2026-10-28): which specials are Doom's fast ("blazing") doors,
# and which need a key (written as the door's `key`; the game has no keys yet).
BLAZE_DOOR_SPECIALS = {105, 106, 108, 109, 111, 112, 114, 115, 117, 118}
DOOR_KEY_SPECIALS = {26: "blue", 32: "blue", 27: "yellow", 34: "yellow", 28: "red", 33: "red"}
# Gun switches: a one-sided line that opens the tagged door when a player's shot hits it (written as `switches`).
GUN_DOOR_SPECIALS = {46}

# Remotely triggered line specials (the line's tag names the target sectors). Step 1 is static, so each
# class is applied once when converting; moving them is plan 2.
# Doors (raise / open / close variants alike): the target sector is written OPEN.
REMOTE_DOOR_SPECIALS = {2, 4, 16, 29, 46, 61, 63, 86, 90, 103, 105, 106, 108, 109, 111, 112, 114, 115}
# Floor lowers: written LOWERED to the lowest neighbouring floor (also for the "to highest / next" variants).
FLOOR_LOWER_SPECIALS = {19, 23, 36, 37, 38, 45, 60, 70, 71, 82, 83, 84, 98, 102}
# Floor raises: written RAISED to the next neighbouring floor up (Doom 2's "raise to next higher" family).
FLOOR_RAISE_SPECIALS = {18, 20, 22, 47, 68, 69, 95, 119, 128, 129, 130, 131, 132}
# Reserved: lifts are static until the doors/lifts plan (a lift at its top is a known gap).
LIFT_SPECIALS = {10, 21, 62, 88, 120, 121, 122, 123}
# The lifts that move (written as `lifts`): Doom's repeatable switch lift, the one MAP28's way back up uses. Walk-over
# lifts (E1M1's 88 among them) stay static at their top.
MOVING_LIFT_SPECIALS = {62}

# Sector types -> (special, hurtPerSec). Doom hurts every 32 tics (~0.91 s); we use per second.
SECTOR_TYPES = {
    1: ("flicker", 0), 2: ("strobe", 0), 3: ("strobe", 0), 4: ("hurt", 20), 5: ("hurt", 10),
    7: ("hurt", 5), 8: ("pulse", 0), 12: ("strobe", 0), 13: ("strobe", 0), 16: ("hurt", 20), 17: ("flicker", 0),
}


EMITTER_FAMILIES = {"screen-bank", "viewscreen", "fluorescent", "exit-sign"}


def _family(name: str, table: list[tuple[str, str]], default: str) -> str:
    best = None
    for prefix, ours in table:
        if name.startswith(prefix) and (best is None or len(prefix) > len(best[0])):
            best = (prefix, ours)
    return best[1] if best else default


def material_for_flat(name: str) -> str:
    return _family(name.upper(), FLAT_FAMILIES, "concrete")


def material_for_texture(name: str) -> str:
    return _family(name.upper(), TEXTURE_FAMILIES, "tech")


def mood_for_texture(name: str) -> str | None:
    return _family(name.upper(), TEXTURE_MOODS, None)


def sector_special(kind: int) -> tuple[str, float]:
    return SECTOR_TYPES.get(kind, ("none", 0))

# Doom thing types -> ours (spec 2026-10-24 §9). Zombiemen become a biomech variant (§9.1).
ZOMBIEMAN = 3004
# shotgun guy, imp (for now). Doom 2's roster on today's cast, nearest role (the gaps: hand-off "MAP28 spike"):
# chaingunner, mancubus, arachnotron, mastermind = juggernaut (chaingun); demon, spectre, hell knight, baron = butcher
# (a melee; not the warbull, whose march costs twice a butcher's: 23 of them made MAP28's worst frames); revenant = flayer;
# archvile = cultist; cyberdemon = warbull; cacodemon, pain elemental = teratoma (the floater). Lost souls (3006) stay out:
# nothing small flies.
THING_SPAWNS = {9: "soldier", 3001: "zombie", 65: "juggernaut", 67: "juggernaut", 3002: "butcher", 58: "butcher",
                66: "flayer", 69: "butcher", 3003: "butcher", 64: "cultist", 68: "juggernaut", 7: "juggernaut", 16: "warbull",
                3005: "teratoma", 71: "teratoma"}
ZOMBIEMAN_VARIANTS = ("deadeye", "butcher", "flayer")
THING_PICKUPS = {
    2001: "shotgun",
    2008: "shells", 2049: "shells", 2007: "shells", 2048: "shells",     # shells, box, clip, box of bullets
    2011: "health", 2012: "health", 2014: "health", 2015: "health", 2018: "health", 2019: "health",
    5: "key-blue", 40: "key-blue", 6: "key-yellow", 39: "key-yellow", 13: "key-red", 38: "key-red",  # cards and skulls alike
}
THING_BARRELS = {2035}  # Doom's exploding barrel -> our toxic drum (plan 3b)
SKILL_BITS = {1: 1, 2: 1, 3: 2, 4: 4, 5: 4}               # Doom skill -> THINGS flag bit
MULTIPLAYER_ONLY = 16
