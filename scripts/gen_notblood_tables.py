#!/usr/bin/env python3
"""gen_notblood_tables.py — codegen foundation for the NotBlood core port.

Parses NotBlood's C headers (``common_game.h``, ``actor.h``) into a generated
TypeScript module ``src/game/notblood/notblood-tables.gen.ts``.

This task (Task 2) ships only the **foundation**: comment stripping, C ``enum``
resolution (with implicit-increment + name-reference resolution), a brace-aware
aggregate tokenizer (``split_top_level_aggregates`` / ``flatten_scalars``), and
emission of the ``KDamage`` / ``KDude`` / ``KThing`` enums. Later tasks append
the data tables (``dudeInfo``, ``explodeInfo``, ``thingInfo``, ``gibList``, …)
at the ``# TABLES`` TODO marker below.

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


# TODO(Task 3/4): append dudeInfo / explodeInfo / thingInfo / gibList tables here.

_TS_HEADER = """\
// Auto-generated by scripts/gen_notblood_tables.py — DO NOT EDIT BY HAND.
// Source: NotBlood blood/src (common_game.h, actor.h).
// Regenerate: python scripts/gen_notblood_tables.py
"""


def render_ts(payload: Dict[str, Dict[str, int]]) -> str:
    """Render the full generated TS module text."""
    blocks = [_TS_HEADER]
    for name in ("KDamage", "KDude", "KThing"):
        blocks.append(_emit_const(name, payload[name]))
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
    payload = build_enum_payload(notblood_src)
    text = render_ts(payload)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(text)
    print(f"wrote {OUT_PATH}  (KDamage={len(payload['KDamage'])} "
          f"KDude={len(payload['KDude'])} KThing={len(payload['KThing'])})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
