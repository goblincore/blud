#!/usr/bin/env python3
"""Rebuild public/assets/animations/index.json from on-disk manifests."""
from __future__ import annotations
import argparse
import json
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="public/assets/animations")
    args = ap.parse_args()
    root = Path(args.root)
    index: dict[str, dict[str, str]] = {"weapons": {}, "characters": {}}
    for category in ("weapons", "characters"):
        cat_dir = root / category
        if not cat_dir.exists():
            continue
        for p in sorted(cat_dir.glob("*.json")):
            manifest = json.loads(p.read_text())
            index[category][manifest["name"]] = f"{category}/{p.name}"
    (root / "index.json").write_text(json.dumps(index, indent=2))
    print(f"wrote {sum(len(v) for v in index.values())} entries → {root / 'index.json'}")


if __name__ == "__main__":
    main()
