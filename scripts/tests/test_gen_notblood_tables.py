"""Tests for scripts/gen_notblood_tables.py — enum + aggregate-tokenizer foundation."""
from __future__ import annotations

import sys
from pathlib import Path

# Match the project convention (see test_map_parser.py): put scripts/ on sys.path
# so `import gen_notblood_tables` resolves without a package qualifier.
sys.path.insert(0, str(Path(__file__).parent.parent))

import gen_notblood_tables as g  # noqa: E402


def test_strip_comments_removes_line_and_block():
    src = "a // line\nb /* block */ c\n/* multi\nline */ d"
    out = g.strip_comments(src)
    assert "line" not in out and "block" not in out and "multi" not in out
    assert "a" in out and "b" in out and "c" in out and "d" in out


def test_parse_enum_implicit_increment():
    src = "enum { kDudeBase = 200, kDudeCultistTommy, kDudeCultistShotgun = 202, kZ };"
    e = g.parse_enum(src, anchor="kDudeBase")
    assert e["kDudeBase"] == 200
    assert e["kDudeCultistTommy"] == 201  # implicit
    assert e["kDudeCultistShotgun"] == 202
    assert e["kZ"] == 203


def test_split_aggregates_handles_nesting_and_casts():
    body = "{ 1, 2, {3, 4}, (char)5 }, { 6, 7, {8, 9}, (char)10 }"
    items = g.split_top_level_aggregates(body)
    assert len(items) == 2
    flat = g.flatten_scalars(items[0])
    assert flat == [1, 2, 3, 4, 5]
