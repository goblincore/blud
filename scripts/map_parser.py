#!/usr/bin/env python3
"""Parse Blood (Build engine) .MAP files version 7.

Blood uses its own map format distinct from Duke3D/Build standard.
The file layout is:

  1. MAPSIGNATURE (6 bytes): 4-byte magic "BLM\\x1a" + 2-byte version
  2. MAPHEADER (37 bytes): player start, sky config, visibility, etc.
  3. MAPHEADER2 (128 bytes, v7 only): revision info + x-sprite/wall/sector sizes
  4. PSKYOFF array (num_sky_tiles * 2 bytes)
  5. Sectors: sectortypev7 (40 bytes each)
  6. XSECTOR bitstream (variable, per sector with extra > 0)
  7. Walls: walltypev7 (32 bytes each)
  8. XWALL bitstream (variable, per wall with extra > 0)
  9. Sprites: spritetypev7 (44 bytes each)
  10. XSPRITE bitstream (variable, per sprite with extra > 0)
  11. CRC-32 (4 bytes)

Version detection:
  - (version & 0xff00) == 0x0700 → version 7 (encrypted data)
  - (version & 0xff00) == 0x0600 → version 6 (unencrypted)

Version 7 applies a rolling XOR cipher (dbCrypt) to the map header,
sectors, walls, and sprites. The cipher key starts at nKey and
increments by 1 each byte.

Struct layouts transcribed from NotBlood source:
  build/include/buildtypes.h  (sectortypev7, walltypev7, spritetypev7)
  blood/src/db.h              (MAPSIGNATURE, MAPHEADER, MAPHEADER2)
  blood/src/db.cpp            (dbLoadMap, dbCrypt)
"""

from __future__ import annotations
import struct
from dataclasses import dataclass, field
from typing import BinaryIO


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# MAPSIGNATURE: 4-byte magic + 2-byte little-endian version
MAP_MAGIC = b"BLM\x1a"
MAPSIG_FMT = "<4sH"  # 6 bytes
MAPSIG_SIZE = struct.calcsize(MAPSIG_FMT)

# MAPHEADER: 37 bytes (packed, named by hex offset in C)
# Offset 0x00: x(i), 0x04: y(i), 0x08: z(i), 0x0c: ang(h), 0x0e: sect(h)
# 0x10: pskybits(h), 0x12: visibility(i), 0x16: songId(i), 0x1a: parallaxtype(b)
# 0x1b: mapRev(i), 0x1f: numSectors(h), 0x21: numWalls(h), 0x23: numSprites(h)
MAPHEADER_FMT = "<iiihhhiibihhh"  # 37 bytes
MAPHEADER_SIZE = struct.calcsize(MAPHEADER_FMT)
assert MAPHEADER_SIZE == 37, f"MAPHEADER should be 37 bytes, got {MAPHEADER_SIZE}"

# MAPHEADER2 (v7 only): 128 bytes
# at0[64]=name, at40=xspriteSize, at44=xwallSize, at48=xsectorSize, pad[52]
MAPHEADER2_SIZE = 128

# sectortypev7: 40 bytes
# Source: buildtypes.h sectortypev7
SECTOR_FMT = "<hh"       # wallptr(H), wallnum(H)           = 4
SECTOR_FMT += "i"        # ceilingz(i)                       = 4
SECTOR_FMT += "i"        # floorz(i)                         = 4
SECTOR_FMT += "H"        # ceilingstat(H)                    = 2
SECTOR_FMT += "H"        # floorstat(H)                      = 2
SECTOR_FMT += "h"        # ceilingpicnum(h)                  = 2
SECTOR_FMT += "h"        # ceilingheinum(h)                  = 2
SECTOR_FMT += "b"        # ceilingshade(b)                   = 1
SECTOR_FMT += "BBB"      # ceilingpal(B), ceilingxpanning(B), ceilingypanning(B) = 3
SECTOR_FMT += "h"        # floorpicnum(h)                    = 2
SECTOR_FMT += "h"        # floorheinum(h)                    = 2
SECTOR_FMT += "b"        # floorshade(b)                     = 1
SECTOR_FMT += "BBB"      # floorpal(B), floorxpanning(B), floorypanning(B)       = 3
SECTOR_FMT += "BB"       # visibility(B), fogpal(B)          = 2
SECTOR_FMT += "h"        # lotag/type(h)                     = 2
SECTOR_FMT += "h"        # hitag(h)                          = 2
SECTOR_FMT += "h"        # extra(h)                          = 2
# Total: 4+4+4+2+2+2+2+1+3+2+2+1+3+2+2+2+2 = 40 ✓
SECTOR_SIZE = struct.calcsize(SECTOR_FMT)
assert SECTOR_SIZE == 40, f"sectortypev7 should be 40 bytes, got {SECTOR_SIZE}"

SECTOR_FIELDS = (
    "wallptr", "wallnum",
    "ceilingz", "floorz",
    "ceilingstat", "floorstat",
    "ceilingpicnum", "ceilingheinum",
    "ceilingshade", "ceilingpal", "ceilingxpanning", "ceilingypanning",
    "floorpicnum", "floorheinum",
    "floorshade", "floorpal", "floorxpanning", "floorypanning",
    "visibility", "fogpal",
    "lotag", "hitag", "extra",
)

# walltypev7: 32 bytes
WALL_FMT = "<"           #
WALL_FMT += "ii"         # x(i), y(i)                        = 8
WALL_FMT += "hhh"        # point2(h), nextwall(h), nextsector(h) = 6
WALL_FMT += "H"          # cstat(H)                          = 2
WALL_FMT += "hh"         # picnum(h), overpicnum(h)          = 4
WALL_FMT += "b"          # shade(b)                          = 1
WALL_FMT += "BBBBB"      # pal(B), xrepeat(B), yrepeat(B), xpanning(B), ypanning(B) = 5
WALL_FMT += "hhh"        # lotag/type(h), hitag(h), extra(h) = 6
# Total: 8+6+2+4+1+5+6 = 32 ✓
WALL_SIZE = struct.calcsize(WALL_FMT)
assert WALL_SIZE == 32, f"walltypev7 should be 32 bytes, got {WALL_SIZE}"

WALL_FIELDS = (
    "x", "y",
    "point2", "nextwall", "nextsector",
    "cstat",
    "picnum", "overpicnum",
    "shade",
    "pal", "xrepeat", "yrepeat", "xpanning", "ypanning",
    "lotag", "hitag", "extra",
)

# spritetypev7: 44 bytes
SPRITE_FMT = "<"          #
SPRITE_FMT += "iii"       # x(i), y(i), z(i)                 = 12
SPRITE_FMT += "H"         # cstat(H)                          = 2
SPRITE_FMT += "h"         # picnum(h)                         = 2
SPRITE_FMT += "b"         # shade(b)                          = 1
SPRITE_FMT += "BB"        # pal(B), clipdist(B)               = 2
SPRITE_FMT += "BB"        # blend(B), xrepeat(B)              = 2   # NOTE: blend is stored but overwritten to 0 on load
SPRITE_FMT += "B"         # yrepeat(B)                        = 1
SPRITE_FMT += "bb"        # xoffset(b), yoffset(b)            = 2
SPRITE_FMT += "hh"        # sectnum(h), statnum(h)            = 4
SPRITE_FMT += "hh"        # ang(h), owner(h)                  = 4
SPRITE_FMT += "hhh"       # xvel(h), yvel(h), zvel(h)         = 6
SPRITE_FMT += "hhh"       # lotag/type(h), hitag/flags(h), extra(h) = 6
# Total: 12+2+2+1+2+2+1+2+4+4+6+6 = 44 ✓
SPRITE_SIZE = struct.calcsize(SPRITE_FMT)
assert SPRITE_SIZE == 44, f"spritetypev7 should be 44 bytes, got {SPRITE_SIZE}"

SPRITE_FIELDS = (
    "x", "y", "z",
    "cstat",
    "picnum",
    "shade",
    "pal", "clipdist",
    "blend", "xrepeat",
    "yrepeat",
    "xoffset", "yoffset",
    "sectnum", "statnum",
    "ang", "owner",
    "xvel", "yvel", "zvel",
    "lotag", "hitag", "extra",
)

# X-struct bitstream sizes (vanilla v6)
N_XSECTOR_SIZE = 60
N_XWALL_SIZE = 24
N_XSPRITE_SIZE = 56


# ---------------------------------------------------------------------------
# dbCrypt — rolling XOR cipher used by Blood v7 maps
# ---------------------------------------------------------------------------

def db_crypt(data: bytearray, key: int) -> None:
    """Apply Blood's dbCrypt in-place: XOR each byte with key, then key += 1."""
    for i in range(len(data)):
        data[i] ^= (key & 0xFF)
        key += 1


# ---------------------------------------------------------------------------
# BitReader — reads bit-packed X-struct fields
# ---------------------------------------------------------------------------

class BitReader:
    """Read bit-packed fields from a byte buffer (little-endian, LSB first)."""

    def __init__(self, data: bytes):
        self._data = data
        self._pos = 0  # bit position

    def read_unsigned(self, nbits: int) -> int:
        if nbits == 0:
            return 0
        val = 0
        for i in range(nbits):
            byte_idx = self._pos >> 3
            bit_idx = self._pos & 7
            if byte_idx < len(self._data):
                val |= ((self._data[byte_idx] >> bit_idx) & 1) << i
            self._pos += 1
        return val

    def read_signed(self, nbits: int) -> int:
        val = self.read_unsigned(nbits)
        if val & (1 << (nbits - 1)):
            val -= (1 << nbits)
        return val

    def skip_bits(self, nbits: int) -> None:
        self._pos += nbits


# ---------------------------------------------------------------------------
# X-struct parsers
# ---------------------------------------------------------------------------

def parse_xsector(data: bytes) -> dict:
    """Parse an XSECTOR bitstream (nXSectorSize = 60 bytes in vanilla)."""
    br = BitReader(data)
    xs = {}
    xs["reference"] = br.read_signed(14)
    xs["state"] = br.read_unsigned(1)
    xs["busy"] = br.read_unsigned(17)
    xs["data"] = br.read_unsigned(16)
    xs["txID"] = br.read_unsigned(10)
    xs["busyWaveA"] = br.read_unsigned(3)
    xs["busyWaveB"] = br.read_unsigned(3)
    xs["rxID"] = br.read_unsigned(10)
    xs["command"] = br.read_unsigned(8)
    xs["triggerOn"] = br.read_unsigned(1)
    xs["triggerOff"] = br.read_unsigned(1)
    xs["busyTimeA"] = br.read_unsigned(12)
    xs["waitTimeA"] = br.read_unsigned(12)
    xs["restState"] = br.read_unsigned(1)
    xs["interruptable"] = br.read_unsigned(1)
    xs["amplitude"] = br.read_signed(8)
    xs["freq"] = br.read_unsigned(8)
    xs["reTriggerA"] = br.read_unsigned(1)
    xs["reTriggerB"] = br.read_unsigned(1)
    xs["phase"] = br.read_unsigned(8)
    xs["wave"] = br.read_unsigned(4)
    xs["shadeAlways"] = br.read_unsigned(1)
    xs["shadeFloor"] = br.read_unsigned(1)
    xs["shadeCeiling"] = br.read_unsigned(1)
    xs["shadeWalls"] = br.read_unsigned(1)
    xs["shade"] = br.read_signed(8)
    xs["panAlways"] = br.read_unsigned(1)
    xs["panFloor"] = br.read_unsigned(1)
    xs["panCeiling"] = br.read_unsigned(1)
    xs["Drag"] = br.read_unsigned(1)
    xs["Underwater"] = br.read_unsigned(1)
    xs["Depth"] = br.read_unsigned(3)
    xs["panVel"] = br.read_unsigned(8)
    xs["panAngle"] = br.read_unsigned(11)
    xs["unused1"] = br.read_unsigned(1)
    xs["decoupled"] = br.read_unsigned(1)
    xs["triggerOnce"] = br.read_unsigned(1)
    xs["isTriggered"] = br.read_unsigned(1)
    xs["Key"] = br.read_unsigned(3)
    xs["Push"] = br.read_unsigned(1)
    xs["Vector"] = br.read_unsigned(1)
    xs["Reserved"] = br.read_unsigned(1)
    xs["Enter"] = br.read_unsigned(1)
    xs["Exit"] = br.read_unsigned(1)
    xs["Wallpush"] = br.read_unsigned(1)
    xs["color"] = br.read_unsigned(1)
    xs["unused2"] = br.read_unsigned(1)
    xs["busyTimeB"] = br.read_unsigned(12)
    xs["waitTimeB"] = br.read_unsigned(12)
    xs["stopOn"] = br.read_unsigned(1)
    xs["stopOff"] = br.read_unsigned(1)
    xs["ceilpal"] = br.read_unsigned(4)
    xs["offCeilZ"] = br.read_signed(32)
    xs["onCeilZ"] = br.read_signed(32)
    xs["offFloorZ"] = br.read_signed(32)
    xs["onFloorZ"] = br.read_signed(32)
    xs["marker0"] = br.read_unsigned(16)
    xs["marker1"] = br.read_unsigned(16)
    xs["Crush"] = br.read_unsigned(1)
    xs["ceilXPanFrac"] = br.read_unsigned(8)
    xs["ceilYPanFrac"] = br.read_unsigned(8)
    xs["floorXPanFrac"] = br.read_unsigned(8)
    xs["damageType"] = br.read_unsigned(3)
    xs["floorpal"] = br.read_unsigned(4)
    xs["floorYPanFrac"] = br.read_unsigned(8)
    xs["locked"] = br.read_unsigned(1)
    xs["windVel"] = br.read_unsigned(10)
    xs["windAng"] = br.read_unsigned(11)
    xs["windAlways"] = br.read_unsigned(1)
    xs["dudeLockout"] = br.read_unsigned(1)
    xs["bobTheta"] = br.read_unsigned(11)
    xs["bobZRange"] = br.read_unsigned(5)
    xs["bobSpeed"] = br.read_signed(12)
    xs["bobAlways"] = br.read_unsigned(1)
    xs["bobFloor"] = br.read_unsigned(1)
    xs["bobCeiling"] = br.read_unsigned(1)
    xs["bobRotate"] = br.read_unsigned(1)
    return xs


def parse_xwall(data: bytes) -> dict:
    """Parse an XWALL bitstream (nXWallSize = 24 bytes in vanilla)."""
    br = BitReader(data)
    xw = {}
    xw["reference"] = br.read_signed(14)
    xw["state"] = br.read_unsigned(1)
    xw["busy"] = br.read_unsigned(17)
    xw["data"] = br.read_signed(16)
    xw["txID"] = br.read_unsigned(10)
    xw["unused1"] = br.read_unsigned(6)
    xw["rxID"] = br.read_unsigned(10)
    xw["command"] = br.read_unsigned(8)
    xw["triggerOn"] = br.read_unsigned(1)
    xw["triggerOff"] = br.read_unsigned(1)
    xw["busyTime"] = br.read_unsigned(12)
    xw["waitTime"] = br.read_unsigned(12)
    xw["restState"] = br.read_unsigned(1)
    xw["interruptable"] = br.read_unsigned(1)
    xw["panAlways"] = br.read_unsigned(1)
    xw["panXVel"] = br.read_signed(8)
    xw["panYVel"] = br.read_signed(8)
    xw["decoupled"] = br.read_unsigned(1)
    xw["triggerOnce"] = br.read_unsigned(1)
    xw["isTriggered"] = br.read_unsigned(1)
    xw["key"] = br.read_unsigned(3)
    xw["triggerPush"] = br.read_unsigned(1)
    xw["triggerVector"] = br.read_unsigned(1)
    xw["triggerTouch"] = br.read_unsigned(1)
    xw["unused2"] = br.read_unsigned(2)
    xw["xpanFrac"] = br.read_unsigned(8)
    xw["ypanFrac"] = br.read_unsigned(8)
    xw["locked"] = br.read_unsigned(1)
    xw["dudeLockout"] = br.read_unsigned(1)
    xw["unused3"] = br.read_unsigned(4)
    xw["unused4"] = br.read_unsigned(32)
    return xw


def parse_xsprite(data: bytes) -> dict:
    """Parse an XSPRITE bitstream (nXSpriteSize = 56 bytes in vanilla)."""
    br = BitReader(data)
    xs = {}
    xs["reference"] = br.read_signed(14)
    xs["state"] = br.read_unsigned(1)
    xs["busy"] = br.read_unsigned(17)
    xs["txID"] = br.read_unsigned(10)
    xs["rxID"] = br.read_unsigned(10)
    xs["command"] = br.read_unsigned(8)
    xs["triggerOn"] = br.read_unsigned(1)
    xs["triggerOff"] = br.read_unsigned(1)
    xs["wave"] = br.read_unsigned(2)
    xs["busyTime"] = br.read_unsigned(12)
    xs["waitTime"] = br.read_unsigned(12)
    xs["restState"] = br.read_unsigned(1)
    xs["Interrutable"] = br.read_unsigned(1)
    xs["unused1"] = br.read_unsigned(2)
    xs["respawnPending"] = br.read_unsigned(2)
    xs["unused2"] = br.read_unsigned(1)
    xs["lT"] = br.read_unsigned(1)
    xs["dropMsg"] = br.read_unsigned(8)
    xs["Decoupled"] = br.read_unsigned(1)
    xs["triggerOnce"] = br.read_unsigned(1)
    xs["isTriggered"] = br.read_unsigned(1)
    xs["key"] = br.read_unsigned(3)
    xs["Push"] = br.read_unsigned(1)
    xs["Vector"] = br.read_unsigned(1)
    xs["Impact"] = br.read_unsigned(1)
    xs["Pickup"] = br.read_unsigned(1)
    xs["Touch"] = br.read_unsigned(1)
    xs["Sight"] = br.read_unsigned(1)
    xs["Proximity"] = br.read_unsigned(1)
    xs["unused3"] = br.read_unsigned(2)
    xs["lSkill"] = br.read_unsigned(5)
    xs["lS"] = br.read_unsigned(1)
    xs["lB"] = br.read_unsigned(1)
    xs["lC"] = br.read_unsigned(1)
    xs["DudeLockout"] = br.read_unsigned(1)
    xs["data1"] = br.read_signed(16)
    xs["data2"] = br.read_signed(16)
    xs["data3"] = br.read_signed(16)
    xs["goalAng"] = br.read_unsigned(11)
    xs["dodgeDir"] = br.read_signed(2)
    xs["locked"] = br.read_unsigned(1)
    xs["medium"] = br.read_unsigned(2)
    xs["respawn"] = br.read_unsigned(2)
    xs["data4"] = br.read_unsigned(16)
    xs["unused4"] = br.read_unsigned(6)
    xs["lockMsg"] = br.read_unsigned(8)
    xs["health"] = br.read_unsigned(12)
    xs["dudeDeaf"] = br.read_unsigned(1)
    xs["dudeAmbush"] = br.read_unsigned(1)
    xs["dudeGuard"] = br.read_unsigned(1)
    xs["dudeFlag4"] = br.read_unsigned(1)
    xs["target"] = br.read_signed(16)
    xs["targetX"] = br.read_signed(32)
    xs["targetY"] = br.read_signed(32)
    xs["targetZ"] = br.read_signed(32)
    xs["burnTime"] = br.read_unsigned(16)
    xs["burnSource"] = br.read_signed(16)
    xs["height"] = br.read_unsigned(16)
    xs["stateTimer"] = br.read_unsigned(16)
    # aiState is a pointer, skip it
    br.skip_bits(32)
    return xs


# ---------------------------------------------------------------------------
# Main parser
# ---------------------------------------------------------------------------

def parse_map(data: bytes) -> dict:
    """Parse a Blood .MAP file (v6 or v7).

    Returns a dict with keys:
        version: int (6 or 7)
        pos: dict (x, y, z, ang, cursectnum)
        pskybits: int
        visibility: int
        songId: int
        parallaxtype: int
        mapRev: int
        sectors: list[dict]
        walls: list[dict]
        sprites: list[dict]
        xsectors: dict[int, dict]   (keyed by sector index)
        xwalls: dict[int, dict]     (keyed by wall index)
        xsprites: dict[int, dict]   (keyed by sprite index)
    """
    buf = memoryview(data)
    pos = 0

    # ---- MAPSIGNATURE (6 bytes) ----
    sig_raw = bytes(buf[pos:pos + MAPSIG_SIZE])
    pos += MAPSIG_SIZE
    magic, version = struct.unpack_from(MAPSIG_FMT, sig_raw)
    if magic != MAP_MAGIC:
        raise ValueError(f"Bad MAP magic: {magic!r}, expected {MAP_MAGIC!r}")

    is_v7 = (version & 0xFF00) == 0x0700
    is_v6 = (version & 0xFF00) == 0x0600
    if not (is_v7 or is_v6):
        raise ValueError(f"Unsupported MAP version: 0x{version:04x}")

    # ---- MAPHEADER (37 bytes) ----
    hdr_raw = bytearray(buf[pos:pos + MAPHEADER_SIZE])
    pos += MAPHEADER_SIZE

    # v7: may need to decrypt map header if songId field is non-zero and
    # not one of the known constants
    k_map_header_new = 0x7474614D  # 'ttaM'
    k_map_header_old = 0x4D617474  # 'Matt'

    map_rev = 0
    hdr2_xsprite_size = N_XSPRITE_SIZE
    hdr2_xwall_size = N_XWALL_SIZE
    hdr2_xsector_size = N_XSECTOR_SIZE

    if is_v7:
        # Peek at the songId field to decide if decryption is needed
        # songId is at offset 16 in the header (after x,y,z,ang,sect,pskybits,vis)
        # struct: iiii hhh i i h iihhh
        # offsets: 0,4,8,12,14,16,18,22,26,27,31,35
        # at16 = songId at byte offset 22
        peek_songid = struct.unpack_from("<i", hdr_raw, 22)[0]
        if peek_songid != 0 and peek_songid != k_map_header_new and peek_songid != k_map_header_old:
            db_crypt(hdr_raw, k_map_header_new)

    (player_x, player_y, player_z, player_ang, player_sect,
     pskybits, visibility, song_id_raw, parallaxtype,
     map_rev, num_sectors, num_walls, num_sprites) = struct.unpack_from(MAPHEADER_FMT, hdr_raw)

    # ---- MAPHEADER2 (v7 only, 128 bytes) ----
    if is_v7:
        hdr2_raw = bytearray(buf[pos:pos + MAPHEADER2_SIZE])
        pos += MAPHEADER2_SIZE
        db_crypt(hdr2_raw, num_walls)
        # at40 = xspriteSize (int32 @ offset 64)
        hdr2_xsprite_size = struct.unpack_from("<i", hdr2_raw, 64)[0]
        hdr2_xwall_size = struct.unpack_from("<i", hdr2_raw, 68)[0]
        hdr2_xsector_size = struct.unpack_from("<i", hdr2_raw, 72)[0]
        # Clamp to vanilla sizes
        hdr2_xsprite_size = min(hdr2_xsprite_size, N_XSPRITE_SIZE)
        hdr2_xwall_size = min(hdr2_xwall_size, N_XWALL_SIZE)
        hdr2_xsector_size = min(hdr2_xsector_size, N_XSECTOR_SIZE)

    # ---- PSKYOFF array ----
    num_sky_tiles = 1 << pskybits
    pskyoff_size = num_sky_tiles * 2
    pskyoff_raw = bytearray(buf[pos:pos + pskyoff_size])
    pos += pskyoff_size
    if is_v7:
        db_crypt(pskyoff_raw, num_sky_tiles * 2)
    pskyoff = list(struct.unpack_from(f"<{num_sky_tiles}h", pskyoff_raw))

    # ---- Sectors ----
    sectors = []
    xsectors = {}
    for i in range(num_sectors):
        sec_raw = bytearray(buf[pos:pos + SECTOR_SIZE])
        pos += SECTOR_SIZE
        if is_v7:
            db_crypt(sec_raw, map_rev * SECTOR_SIZE)
        vals = struct.unpack_from(SECTOR_FMT, sec_raw)
        sec = dict(zip(SECTOR_FIELDS, vals))
        sectors.append(sec)

        # XSECTOR (if extra > 0)
        if sec["extra"] > 0:
            xsec_data = bytes(buf[pos:pos + hdr2_xsector_size])
            pos += hdr2_xsector_size
            xsectors[i] = parse_xsector(xsec_data)

    # ---- Walls ----
    walls = []
    xwalls = {}
    for i in range(num_walls):
        wal_raw = bytearray(buf[pos:pos + WALL_SIZE])
        pos += WALL_SIZE
        if is_v7:
            db_crypt(wal_raw, (map_rev * SECTOR_SIZE) | k_map_header_new)
        vals = struct.unpack_from(WALL_FMT, wal_raw)
        wal = dict(zip(WALL_FIELDS, vals))
        walls.append(wal)

        # XWALL (if extra > 0)
        if wal["extra"] > 0:
            xwal_data = bytes(buf[pos:pos + hdr2_xwall_size])
            pos += hdr2_xwall_size
            xwalls[i] = parse_xwall(xwal_data)

    # ---- Sprites ----
    sprites = []
    xsprites = {}
    for i in range(num_sprites):
        spr_raw = bytearray(buf[pos:pos + SPRITE_SIZE])
        pos += SPRITE_SIZE
        if is_v7:
            db_crypt(spr_raw, (map_rev * SPRITE_SIZE) | k_map_header_new)
        vals = struct.unpack_from(SPRITE_FMT, spr_raw)
        spr = dict(zip(SPRITE_FIELDS, vals))
        # Blood stores blend in the struct but overwrites to 0 on load
        # (qsprite_filler preserves the original blend value)
        sprites.append(spr)

        # XSPRITE (if extra > 0)
        if spr["extra"] > 0:
            xspr_data = bytes(buf[pos:pos + hdr2_xsprite_size])
            pos += hdr2_xsprite_size
            xsprites[i] = parse_xsprite(xspr_data)

    # ---- CRC-32 (4 bytes) ----
    # Not validated here, but we skip it
    pos += 4

    return {
        "version": version,
        "pos": {
            "x": player_x, "y": player_y, "z": player_z,
            "ang": player_ang, "cursectnum": player_sect,
        },
        "pskybits": pskybits,
        "visibility": visibility,
        "songId": song_id_raw,
        "parallaxtype": parallaxtype,
        "mapRev": map_rev,
        "pskyoff": pskyoff,
        "numSectors": num_sectors,
        "numWalls": num_walls,
        "numSprites": num_sprites,
        "sectors": sectors,
        "walls": walls,
        "sprites": sprites,
        "xsectors": xsectors,
        "xwalls": xwalls,
        "xsprites": xsprites,
    }


# db_crypt is defined above (module-level function)
