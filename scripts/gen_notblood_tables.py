#!/usr/bin/env python3
"""gen_notblood_tables.py — codegen foundation for the NotBlood core port.

Parses NotBlood's C headers (``common_game.h``, ``actor.h``) into a generated
TypeScript module ``src/game/notblood/notblood-tables.gen.ts``.

Task 2 shipped the foundation (comment stripping, C ``enum`` resolution,
brace-aware aggregate tokenizer, enum emission). This task (Task 3) adds
**struct-field binding with arity guards** and parses the ``dudeInfo`` /
``explodeInfo`` / ``thingInfo`` aggregate tables from the C source, emitting
them verbatim in native Build units. Each row's scalar count is checked against
the struct's field list — the guard that would have caught the original
``explodeInfo`` column-misread. Later tasks append ``gibList`` and friends.

Values are kept verbatim in native Build units (no unit conversion here) so a
future deterministic 120-tic netcode core is a clean swap.

Source dir resolves from the ``NOTBLOOD_SRC`` env var, defaulting to::

    /Users/donny/Documents/Raze/NotBlood/source/blood/src
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence

DEFAULT_NOTBLOOD_SRC = "/Users/donny/Documents/Raze/NotBlood/source/blood/src"

# Repo root = parent of this scripts/ dir. Output is always relative to it.
REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "src" / "game" / "notblood" / "notblood-tables.gen.ts"


# ---------------------------------------------------------------------------
# Comment stripping
# ---------------------------------------------------------------------------
def strip_comments(src: str) -> str:
    """Remove C ``//`` line comments and ``/* ... */`` block comments.

    Comment text is replaced with a single space so adjacent tokens on either
    side of a comment never get accidentally joined (``a/* */b`` -> ``a b``).
    Block comments may span newlines; the newline structure of the file is
    otherwise preserved.
    """
    out: List[str] = []
    i = 0
    n = len(src)
    while i < n:
        two = src[i : i + 2]
        if two == "//":
            # Skip to end of line (do not consume the newline).
            j = src.find("\n", i)
            if j == -1:
                i = n
            else:
                i = j
            out.append(" ")
        elif two == "/*":
            # Skip to the closing */.
            j = src.find("*/", i + 2)
            if j == -1:
                i = n
            else:
                i = j + 2
            out.append(" ")
        else:
            out.append(src[i])
            i += 1
    return "".join(out)


# ---------------------------------------------------------------------------
# Enum parsing
# ---------------------------------------------------------------------------
def _resolve_enum_value(expr: str, symbols: Dict[str, int]) -> int:
    """Resolve an enum ``=`` expression to an int.

    Handles decimal (``200``), hex (``0xC8``), unary minus, and named
    references to constants already seen (e.g. ``kMissileBase``).
    """
    t = expr.strip()
    neg = False
    while t.startswith("+"):
        t = t[1:].strip()
    while t.startswith("-"):
        neg = not neg
        t = t[1:].strip()
    if re.fullmatch(r"0[xX][0-9a-fA-F]+", t):
        v = int(t, 16)
    elif re.fullmatch(r"\d+", t):
        v = int(t, 10)
    elif t in symbols:
        v = symbols[t]
    else:
        raise ValueError(f"cannot resolve enum value expression: {expr!r}")
    return -v if neg else v


def parse_enum(src: str, anchor: str) -> Dict[str, int]:
    """Parse a C ``enum`` body starting at ``anchor`` and return ``{name: int}``.

    The anchor names the first member of interest (e.g. ``"kDudeBase"``). From
    that point the parser walks forward through ``name [= expr]`` entries
    separated by commas, assigning explicit values from ``=`` and implicit
    values by incrementing the previous entry (C semantics; the first member
    defaults to 0 when it has no explicit value). Parsing stops at the first
    ``}`` (the enum's closing brace). Comments are stripped defensively first.

    The returned dict contains every member from ``anchor`` up to (but not
    including) the closing brace — callers filter by prefix when they only want
    a section of a shared enum.
    """
    src = strip_comments(src)
    m = re.search(r"\b" + re.escape(anchor) + r"\b", src)
    if m is None:
        raise ValueError(f"enum anchor {anchor!r} not found in source")

    # Slice from the anchor (inclusive — the anchor is itself the first
    # member) to the first '}' that closes the enum.
    end = src.find("}", m.end())
    if end == -1:
        raise ValueError(f"no closing '}}' after enum anchor {anchor!r}")
    body = src[m.start() : end]

    # Top-level comma split (enum members don't nest braces, but be safe).
    result: Dict[str, int] = {}
    next_implicit = 0
    for raw in _split_top_level_commas(body):
        entry = raw.strip()
        if not entry:
            continue
        if "=" in entry:
            name_part, val_part = entry.split("=", 1)
            name = name_part.strip()
            if not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", name):
                # Not a plain identifier (e.g. a stray token); skip defensively.
                continue
            value = _resolve_enum_value(val_part, result)
        else:
            name = entry.strip()
            if not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", name):
                continue
            value = next_implicit
        result[name] = value
        next_implicit = value + 1
    return result


# ---------------------------------------------------------------------------
# Aggregate tokenizer
# ---------------------------------------------------------------------------
def _split_top_level_commas(s: str) -> List[str]:
    """Split ``s`` on commas that sit at brace depth 0 and paren depth 0.

    Used both by :func:`split_top_level_aggregates` (returns the brace groups
    verbatim) and internally by :func:`flatten_scalars` (after stripping one
    outer brace pair).
    """
    parts: List[str] = []
    cur: List[str] = []
    brace = 0
    paren = 0
    for ch in s:
        if ch == "{":
            brace += 1
            cur.append(ch)
        elif ch == "}":
            brace -= 1
            cur.append(ch)
        elif ch == "(":
            paren += 1
            cur.append(ch)
        elif ch == ")":
            paren -= 1
            cur.append(ch)
        elif ch == "," and brace == 0 and paren == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    tail = "".join(cur)
    if tail.strip():
        parts.append(tail)
    return parts


def split_top_level_aggregates(body: str) -> List[str]:
    """Split a ``{...}, {...}`` aggregate-init body into top-level brace groups.

    Each returned item keeps its own braces and any nested groups/casts intact.
    Trailing commas / empty items are dropped.
    """
    return [p for p in _split_top_level_commas(body) if p.strip()]


_CAST_RE = re.compile(r"^\s*\(\s*(?:unsigned\s+|signed\s+)?[A-Za-z_][A-Za-z_0-9]*\s*\)\s*")


def _resolve_scalar(token: str, symbols: Dict[str, int]) -> int:
    """Resolve a single scalar token to an int.

    Handles ``(char)``/``(unsigned char)``/``(int)``/… casts, unary ``-``/``+``,
    decimal and hex literals, and named enum constants from ``symbols``.
    """
    t = _CAST_RE.sub("", token).strip()
    neg = False
    while t.startswith("+"):
        t = t[1:].strip()
    while t.startswith("-"):
        neg = not neg
        t = t[1:].strip()
    if re.fullmatch(r"0[xX][0-9a-fA-F]+", t):
        v = int(t, 16)
    elif re.fullmatch(r"\d+", t):
        v = int(t, 10)
    elif t in symbols:
        v = symbols[t]
    else:
        raise ValueError(f"cannot resolve scalar: {token!r}")
    return -v if neg else v


def flatten_scalars(group: str, symbols: Optional[Dict[str, int]] = None) -> List[int]:
    """Recursively extract integer scalars from an aggregate group string.

    Strips one outer ``{ }`` pair, splits on top-level commas, recurses into any
    nested ``{ }``, and resolves casts / unary minus / named constants.
    """
    syms = symbols or {}
    s = group.strip()
    # Peel a single balanced outer brace pair.
    if s.startswith("{") and s.endswith("}"):
        inner = s[1:-1]
    else:
        inner = s
    out: List[int] = []
    for piece in _split_top_level_commas(inner):
        piece = piece.strip()
        if not piece:
            continue
        if "{" in piece:
            out.extend(flatten_scalars(piece, syms))
        else:
            out.append(_resolve_scalar(piece, syms))
    return out


# ---------------------------------------------------------------------------
# Struct field binding + data tables
# ---------------------------------------------------------------------------
# kDamageMax = 7 (KDamage.kDamageMax). The DUDEINFO/THINGINFO structs size
# several fixed arrays by it (dude.h:51-52, actor.h:86); we hardcode 7 to
# match the struct layout rather than depend on a parsed constant.
_KDAMAGE_MAX = 7

# Each table's ordered field list. A plain ``str`` consumes one scalar; a
# ``(name, length)`` tuple consumes ``length`` scalars into a list (the nested
# fixed arrays in DUDEINFO: nGibType[3], startDamage[7], curDamage[7]).
FIELD_SPECS = {
    "explodeInfo": [
        "repeat", "dmg", "dmgRng", "radius", "dmgType", "burnTime",
        "ticks", "quakeEffect", "flashEffect",
    ],
    "thingInfo": [
        "startHealth", "mass", "clipdist", "flags", "elastic", "dmgResist",
        "cstat", "picnum", "shade", "pal", "xrepeat", "yrepeat",
        ("dmgControl", _KDAMAGE_MAX),
    ],
    "dudeInfo": [
        "seqStartID", "startHealth", "mass", "at6", "clipdist", "eyeHeight",
        "aimHeight", "hearDist", "seeDist", "periphery", "meleeDist",
        "fleeHealth", "hinderDamage", "changeTarget", "changeTargetKin",
        "alertChance", "lockOut", "frontSpeed", "sideSpeed", "backSpeed",
        "angSpeed",
        ("nGibType", 3),
        ("startDamage", _KDAMAGE_MAX),
        ("curDamage", _KDAMAGE_MAX),
        "at8c", "at90",
    ],
}

# table name -> (relative source path, C array symbol to anchor on).
TABLE_SOURCES = {
    "explodeInfo": ("actor.cpp", "explodeInfo"),
    "thingInfo": ("actor.cpp", "thingInfo"),
    "dudeInfo": ("dude.cpp", "dudeInfo"),
}

# Populated by build_tables(); lowercase enum-name keys for programmatic access
# (e.g. ``ENUMS["kDude"]["kDudeZombieAxeNormal"]``). build_enum_payload keeps
# the capitalized keys used for TS const emission.
ENUMS: Dict[str, Dict[str, int]] = {}


class ArityError(Exception):
    """Raised when a row's scalar count != its struct's expected field count."""


_DEFINE_RE = re.compile(
    r"^\s*#\s*define\s+([A-Za-z_][A-Za-z_0-9]*)\s+(.+?)\s*$", re.MULTILINE
)


def parse_numeric_defines(src: str) -> Dict[str, int]:
    """Parse simple ``#define NAME <int>`` macros into ``{name: int}``.

    Handles decimal / hex literals and an optional unary minus and a single
    surrounding paren pair. Macro-function defines (``#define F(x) ...``) and
    non-numeric values are skipped. Used to resolve preprocessor constants the
    data tables reference (e.g. ``kAng90`` = 512) that are not enum members.
    """
    out: Dict[str, int] = {}
    for name, expr in _DEFINE_RE.findall(src):
        value = expr.strip()
        if value.startswith("(") and value.endswith(")"):
            value = value[1:-1].strip()
        if not re.fullmatch(r"-?(?:0[xX][0-9a-fA-F]+|\d+)", value):
            continue
        try:
            out[name] = _resolve_enum_value(value, {})
        except ValueError:
            continue
    return out


def bind_struct(field_specs, scalars):
    """Bind a flat list of scalars to ordered struct fields, packing arrays.

    ``field_specs`` entries are either a plain field name (consumes one scalar)
    or a ``(name, length)`` tuple (consumes ``length`` scalars into a list).
    Raises :class:`ArityError` if the scalar count does not match the total
    expected — this is the guard that catches a column-misread (e.g. an
    explodeInfo row parsed with the wrong field list).
    """
    expected = 0
    for spec in field_specs:
        expected += spec[1] if isinstance(spec, tuple) else 1
    values = list(scalars)
    if len(values) != expected:
        raise ArityError(
            f"arity mismatch: expected {expected} scalars for {field_specs!r}, "
            f"got {len(values)}"
        )
    result: Dict[str, object] = {}
    i = 0
    for spec in field_specs:
        if isinstance(spec, tuple):
            name, length = spec
            result[name] = values[i : i + length]
            i += length
        else:
            result[spec] = values[i]
            i += 1
    return result


def extract_array_body(src: str, name: str) -> str:
    """Return the inner aggregate body of a ``name[...] = { ... }`` initializer.

    ``src`` should already be comment-stripped. Anchors on the array's
    ``name[...] =`` assignment (the ``[...]`` may be empty, a literal size, or a
    constant expression such as ``kDudeMax-kDudeBase``), then balances braces
    from the following ``{`` to its matching ``}`` and returns the text between.
    """
    m = re.search(r"\b" + re.escape(name) + r"\b\s*\[[^\]]*\]\s*=", src)
    if m is None:
        raise ValueError(f"array initializer {name!r} not found in source")
    brace_open = src.find("{", m.end())
    if brace_open == -1:
        raise ValueError(f"no '{{' after array initializer {name!r}")
    depth = 0
    for j in range(brace_open, len(src)):
        ch = src[j]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return src[brace_open + 1 : j]
    raise ValueError(f"unbalanced braces in array initializer {name!r}")


# ---------------------------------------------------------------------------
# TS emission
# ---------------------------------------------------------------------------
def _emit_const(name: str, mapping: Dict[str, int]) -> str:
    """Emit a ``name`` -> value map as ``export const <Name> = {...} as const;``."""
    width = max((len(k) for k in mapping), default=1)
    lines = [f"export const {name} = {{"]
    for key, value in mapping.items():
        lines.append(f"  {key + ':':<{width + 1}} {value},")
    lines.append("} as const;")
    return "\n".join(lines)


def build_enum_payload(notblood_src: Path) -> Dict[str, Dict[str, int]]:
    """Read the headers and return the three emitted enum maps.

    ``DAMAGE_TYPE`` lives in ``actor.h``. The ``kDude*`` and ``kThing*``
    sections share one big enum block in ``common_game.h`` (kDude → kMissile →
    kThing → kTrap → kGen → kSound); anchoring at each base and filtering by
    prefix yields the two clean maps regardless of the shared block.
    """
    actor_h = (notblood_src / "actor.h").read_text()
    common_h = (notblood_src / "common_game.h").read_text()

    kdamage = {
        k: v
        for k, v in parse_enum(actor_h, anchor="kDamageFall").items()
        if k.startswith("kDamage")
    }
    big_enum = parse_enum(common_h, anchor="kDudeBase")  # spans the whole block
    if not any(k.startswith("kThing") for k in big_enum):
        # Defensive: kThing sits in its own block in some forks.
        big_enum.update(parse_enum(common_h, anchor="kThingBase"))
    kdude = {k: v for k, v in big_enum.items() if k.startswith("kDude")}
    kthing = {k: v for k, v in big_enum.items() if k.startswith("kThing")}
    return {"KDamage": kdamage, "KDude": kdude, "KThing": kthing}


def build_tables(notblood_src: Optional[Path] = None) -> Dict[str, List[dict]]:
    """Parse the dudeInfo / explodeInfo / thingInfo aggregate tables.

    Parses the enums first (storing them in the module-level :data:`ENUMS` with
    lowercase keys), then locates each array initializer, splits it into rows,
    and binds each row via :func:`bind_struct` against its :data:`FIELD_SPECS`
    entry (raising :class:`ArityError` on any scalar-count mismatch). Returns the
    three bound tables keyed by name. Values are kept verbatim in native Build
    units — no conversion happens here.
    """
    src_dir = notblood_src or resolve_src_dir()
    enum_payload = build_enum_payload(src_dir)
    ENUMS.clear()
    ENUMS.update({
        "kDamage": enum_payload["KDamage"],
        "kDude": enum_payload["KDude"],
        "kThing": enum_payload["KThing"],
    })
    # Merged symbol table for scalar resolution. The tables mostly use
    # literals/casts, but a few rows reference enum members or preprocessor
    # constants (e.g. dudeInfo's last row uses ``kAng90`` = 512). Pull every
    # enum member plus the numeric ``#define``s from the data-bearing headers.
    merged_symbols: Dict[str, int] = {}
    for section in ENUMS.values():
        merged_symbols.update(section)
    for rel_path in ("common_game.h", "actor.h", "blood.h"):
        header = src_dir / rel_path
        if header.is_file():
            merged_symbols.update(parse_numeric_defines(strip_comments(header.read_text())))

    tables: Dict[str, List[dict]] = {}
    for table_name, (rel_path, array_name) in TABLE_SOURCES.items():
        raw = strip_comments((src_dir / rel_path).read_text())
        body = extract_array_body(raw, array_name)
        rows = []
        for group in split_top_level_aggregates(body):
            scalars = flatten_scalars(group, merged_symbols)
            rows.append(bind_struct(FIELD_SPECS[table_name], scalars))
        tables[table_name] = rows
    return tables


def _emit_table(name: str, rows: List[dict]) -> str:
    """Emit a list-of-dict table as ``export const <Name> = [...] as const;``.

    Array fields render as inline ``key: [v1, v2, ...]``; scalars as
    ``key: v``. Field order follows struct layout (Python dicts preserve
    insertion order from :func:`bind_struct`).
    """
    lines = [f"export const {name} = ["]
    for row in rows:
        parts = []
        for key, value in row.items():
            if isinstance(value, list):
                parts.append(f"{key}: [{', '.join(str(x) for x in value)}]")
            else:
                parts.append(f"{key}: {value}")
        lines.append("    { " + ", ".join(parts) + " },")
    lines.append("] as const;")
    return "\n".join(lines)


def _emit_get_dude_info() -> str:
    """Emit the typed accessor mirroring C ``getDudeInfo`` (index ``type - kDudeBase``)."""
    return (
        "export function getDudeInfo(type: number) {\n"
        "  return dudeInfo[type - KDude.kDudeBase];\n"
        "}"
    )


# TODO(Task 4): append gibList (GIBFX/GIBTHING symbol linking) here.

_TS_HEADER = """\
// Auto-generated by scripts/gen_notblood_tables.py — DO NOT EDIT BY HAND.
// Source: NotBlood blood/src (common_game.h, actor.h).
// Regenerate: python scripts/gen_notblood_tables.py
"""


def render_ts(payload: Dict[str, Dict[str, int]],
              tables: Optional[Dict[str, List[dict]]] = None) -> str:
    """Render the full generated TS module text.

    Enums are always emitted. When ``tables`` is provided, the dudeInfo /
    explodeInfo / thingInfo aggregates and the ``getDudeInfo`` accessor are
    appended (Task 3+); otherwise a TODO marker is left for later gen tasks.
    """
    blocks = [_TS_HEADER]
    for name in ("KDamage", "KDude", "KThing"):
        blocks.append(_emit_const(name, payload[name]))
    if tables:
        blocks.append(_emit_table("explodeInfo", tables["explodeInfo"]))
        blocks.append(_emit_table("dudeInfo", tables["dudeInfo"]))
        blocks.append(_emit_table("thingInfo", tables["thingInfo"]))
        blocks.append(_emit_get_dude_info())
        blocks.append("\n// TODO(Task 4): gibList table appended here by a later gen task.")
    else:
        blocks.append(
            "\n// TODO(Task 3/4): dudeInfo / explodeInfo / thingInfo / gibList "
            "tables appended here by later gen tasks."
        )
    return "\n\n".join(blocks) + "\n"


def resolve_src_dir() -> Path:
    """Resolve the NotBlood source dir from ``NOTBLOOD_SRC`` or the default."""
    return Path(os.environ.get("NOTBLOOD_SRC", DEFAULT_NOTBLOOD_SRC))


def main(argv: Optional[Sequence[str]] = None) -> int:
    notblood_src = resolve_src_dir()
    if not notblood_src.is_dir():
        print(f"error: NotBlood source dir not found: {notblood_src}", file=sys.stderr)
        return 1
    tables = build_tables(notblood_src)
    enum_payload = {
        "KDamage": ENUMS["kDamage"],
        "KDude": ENUMS["kDude"],
        "KThing": ENUMS["kThing"],
    }
    text = render_ts(enum_payload, tables)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(text)
    print(f"wrote {OUT_PATH}  (KDamage={len(enum_payload['KDamage'])} "
          f"KDude={len(enum_payload['KDude'])} KThing={len(enum_payload['KThing'])} "
          f"explodeInfo={len(tables['explodeInfo'])} "
          f"dudeInfo={len(tables['dudeInfo'])} "
          f"thingInfo={len(tables['thingInfo'])})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
