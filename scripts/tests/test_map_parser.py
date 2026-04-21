#!/usr/bin/env python3
"""Tests for map_parser.py — hand-crafted minimal .MAP blob + real-map smoke test."""

import struct
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from map_parser import (
    parse_map, db_crypt, BitReader,
    SECTOR_FMT, SECTOR_SIZE, SECTOR_FIELDS,
    WALL_FMT, WALL_SIZE, WALL_FIELDS,
    SPRITE_FMT, SPRITE_SIZE, SPRITE_FIELDS,
    MAPSIG_FMT, MAPSIG_SIZE, MAPHEADER_FMT, MAPHEADER_SIZE,
    MAPHEADER2_SIZE, MAP_MAGIC,
    N_XSECTOR_SIZE, N_XWALL_SIZE, N_XSPRITE_SIZE,
)


def _build_v7_map(
    num_sectors=1, num_walls=4, num_sprites=1,
    sectors=None, walls=None, sprites=None,
    pskybits=0, visibility=128, map_rev=1,
) -> bytes:
    """Build a minimal Blood v7 .MAP blob for testing."""
    buf = bytearray()

    # ---- MAPSIGNATURE (6 bytes) ----
    buf += struct.pack(MAPSIG_FMT, MAP_MAGIC, 0x0701)

    # ---- MAPHEADER (37 bytes) ----
    # We want songId=0 so no decryption is attempted on the header
    hdr = struct.pack(
        MAPHEADER_FMT,
        0, 0, 100,       # x, y, z
        0, 0,             # ang, sect
        pskybits,         # pskybits
        visibility,       # visibility
        0,                # songId = 0 (no crypt)
        0,                # parallaxtype
        map_rev,
        num_sectors,
        num_walls,
        num_sprites,
    )
    buf += hdr

    # ---- MAPHEADER2 (128 bytes, v7) ----
    hdr2 = bytearray(MAPHEADER2_SIZE)
    # xspriteSize at offset 64
    struct.pack_into("<i", hdr2, 64, N_XSPRITE_SIZE)
    # xwallSize at offset 68
    struct.pack_into("<i", hdr2, 68, N_XWALL_SIZE)
    # xsectorSize at offset 72
    struct.pack_into("<i", hdr2, 72, N_XSECTOR_SIZE)
    # Encrypt with dbCrypt(key=numwalls)
    db_crypt(hdr2, num_walls)
    buf += hdr2

    # ---- PSKYOFF ----
    num_sky = 1 << pskybits
    pskyoff = struct.pack(f"<{num_sky}h", *([0] * num_sky))
    # Encrypt with key = num_sky * 2
    pskyoff = bytearray(pskyoff)
    db_crypt(pskyoff, num_sky * 2)
    buf += pskyoff

    # ---- Sectors ----
    crypt_key_sector = map_rev * SECTOR_SIZE
    for i in range(num_sectors):
        if sectors and i < len(sectors):
            sec = sectors[i]
        else:
            sec = dict(
                wallptr=i * 4, wallnum=4,
                ceilingz=1000, floorz=-1000,
                ceilingstat=0, floorstat=0,
                ceilingpicnum=253, ceilingheinum=0,
                ceilingshade=0, ceilingpal=0, ceilingxpanning=0, ceilingypanning=0,
                floorpicnum=1006, floorheinum=0,
                floorshade=0, floorpal=0, floorxpanning=0, floorypanning=0,
                visibility=16, fogpal=0,
                lotag=0, hitag=0, extra=0,
            )
        sec_raw = bytearray(struct.pack(SECTOR_FMT, *[sec[f] for f in SECTOR_FIELDS]))
        db_crypt(sec_raw, crypt_key_sector)
        buf += sec_raw
        # No XSECTOR (extra=0)

    # ---- Walls ----
    crypt_key_wall = (map_rev * SECTOR_SIZE) | 0x7474614D  # kMapHeaderNew
    for i in range(num_walls):
        if walls and i < len(walls):
            wal = walls[i]
        else:
            # Default: 4 walls forming a square around origin
            corners = [(0, 0), (1024, 0), (1024, 1024), (0, 1024)]
            x, y = corners[i % 4]
            wal = dict(
                x=x, y=y,
                point2=(i + 1) % 4,
                nextwall=-1 if i < 2 else i - 2,  # two sectors connected
                nextsector=-1 if i < 2 else 0,
                cstat=1,
                picnum=34,
                overpicnum=-1,
                shade=0,
                pal=0, xrepeat=8, yrepeat=8, xpanning=0, ypanning=0,
                lotag=0, hitag=0, extra=0,
            )
        wal_raw = bytearray(struct.pack(WALL_FMT, *[wal[f] for f in WALL_FIELDS]))
        db_crypt(wal_raw, crypt_key_wall)
        buf += wal_raw
        # No XWALL (extra=0)

    # ---- Sprites ----
    crypt_key_spr = (map_rev * SPRITE_SIZE) | 0x7474614D
    for i in range(num_sprites):
        if sprites and i < len(sprites):
            spr = sprites[i]
        else:
            spr = dict(
                x=512, y=512, z=0,
                cstat=0,
                picnum=600,
                shade=0,
                pal=0, clipdist=32,
                blend=0, xrepeat=64,
                yrepeat=64,
                xoffset=0, yoffset=0,
                sectnum=0, statnum=0,
                ang=0, owner=-1,
                xvel=0, yvel=0, zvel=0,
                lotag=0, hitag=0, extra=0,
            )
        spr_raw = bytearray(struct.pack(SPRITE_FMT, *[spr[f] for f in SPRITE_FIELDS]))
        db_crypt(spr_raw, crypt_key_spr)
        buf += spr_raw
        # No XSPRITE (extra=0)

    # ---- CRC-32 (dummy) ----
    buf += struct.pack("<I", 0xDEADBEEF)

    return bytes(buf)


class TestDbCrypt:
    def test_identity(self):
        """Double application of dbCrypt restores original."""
        original = bytearray(b"Hello, Blood!")
        encrypted = bytearray(original)
        db_crypt(encrypted, 42)
        assert encrypted != original
        db_crypt(encrypted, 42)
        assert encrypted == original

    def test_zero_key(self):
        data = bytearray(b"\x00\x00\x00\x00")
        db_crypt(data, 0)
        # With key=0, byte 0 XOR 0 = 0, byte 1 XOR 1 = 1, etc
        assert data == bytearray(bytes([0, 1, 2, 3]))


class TestBitReader:
    def test_unsigned(self):
        # Byte 0: 0b10110100
        # bit0=0, bit1=0, bit2=1, bit3=0, bit4=1, bit5=1, bit6=0, bit7=1
        br = BitReader(bytes([0b10110100, 0b01100010]))
        assert br.read_unsigned(3) == 0b100   # bits 0,1,2 → 0,0,1 = 4
        assert br.read_unsigned(5) == 0b10110  # bits 3,4,5,6,7 → 0,1,1,0,1 = 22
        # Byte 1: 0b01100010
        # bit8=0, bit9=1
        assert br.read_unsigned(2) == 0b10     # bits 8,9 → 0,1 = 2
        # bit10=0, bit11=0, bit12=0, bit13=1
        assert br.read_unsigned(4) == 0b1000   # bits 10,11,12,13 → 0,0,0,1 = 8

    def test_signed(self):
        br = BitReader(bytes([0xFF]))
        assert br.read_signed(8) == -1

    def test_skip(self):
        br = BitReader(bytes([0xFF, 0x00]))
        br.skip_bits(4)
        assert br.read_unsigned(4) == 0xF


class TestParseMinimalMap:
    def test_basic_counts(self):
        data = _build_v7_map(num_sectors=1, num_walls=4, num_sprites=1)
        result = parse_map(data)
        assert result["numSectors"] == 1
        assert result["numWalls"] == 4
        assert result["numSprites"] == 1
        assert result["version"] == 0x0701

    def test_player_start(self):
        data = _build_v7_map()
        result = parse_map(data)
        assert result["pos"]["x"] == 0
        assert result["pos"]["y"] == 0
        assert result["pos"]["z"] == 100
        assert result["pos"]["ang"] == 0
        assert result["pos"]["cursectnum"] == 0

    def test_sector_fields(self):
        data = _build_v7_map(num_sectors=1)
        result = parse_map(data)
        sec = result["sectors"][0]
        assert sec["wallptr"] == 0
        assert sec["wallnum"] == 4
        assert sec["ceilingpicnum"] == 253
        assert sec["floorpicnum"] == 1006

    def test_wall_fields(self):
        data = _build_v7_map(num_sectors=1, num_walls=4)
        result = parse_map(data)
        w = result["walls"][0]
        assert w["x"] == 0
        assert w["y"] == 0
        assert w["point2"] == 1
        assert w["picnum"] == 34

    def test_sprite_fields(self):
        data = _build_v7_map(num_sectors=1, num_walls=4, num_sprites=1)
        result = parse_map(data)
        spr = result["sprites"][0]
        assert spr["x"] == 512
        assert spr["y"] == 512
        assert spr["picnum"] == 600
        assert spr["statnum"] == 0

    def test_visibility(self):
        data = _build_v7_map(visibility=200)
        result = parse_map(data)
        assert result["visibility"] == 200

    def test_no_xstructs_when_extra_zero(self):
        data = _build_v7_map()
        result = parse_map(data)
        assert len(result["xsectors"]) == 0
        assert len(result["xwalls"]) == 0
        assert len(result["xsprites"]) == 0

    def test_multiple_sectors(self):
        data = _build_v7_map(num_sectors=3, num_walls=12, num_sprites=2)
        result = parse_map(data)
        assert result["numSectors"] == 3
        assert result["numWalls"] == 12
        assert result["numSprites"] == 2

    def test_struct_sizes(self):
        """Verify our format strings match the expected C struct sizes."""
        assert SECTOR_SIZE == 40
        assert WALL_SIZE == 32
        assert SPRITE_SIZE == 44


class TestRealMapSmoke:
    """Smoke test against actual Blood map files."""

    @pytest.fixture
    def blood_dir(self):
        p = Path("/Users/donny/Documents/Raze/blood")
        if not p.exists():
            pytest.skip("Blood data directory not found")
        return p

    def test_e1m1(self, blood_dir):
        data = (blood_dir / "DWE1M1.MAP").read_bytes()
        result = parse_map(data)
        assert result["version"] & 0xFF00 == 0x0700
        assert result["numSectors"] > 100
        assert result["numWalls"] > result["numSectors"]
        assert result["numSprites"] > 0
        # E1M1 ("Cradle to Grave") should have reasonable size
        assert 500 < result["numSectors"] < 2000

    def test_multiple_maps(self, blood_dir):
        """Parse every .MAP in the blood directory without crashing."""
        maps = sorted(blood_dir.glob("*.MAP"))
        assert len(maps) >= 10, f"Expected at least 10 maps, found {len(maps)}"
        for map_path in maps:
            data = map_path.read_bytes()
            result = parse_map(data)
            assert result["numSectors"] > 0, f"{map_path.name}: 0 sectors"
            assert result["numWalls"] > 0, f"{map_path.name}: 0 walls"
            print(f"  {map_path.name}: {result['numSectors']}s {result['numWalls']}w {result['numSprites']}sp")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
