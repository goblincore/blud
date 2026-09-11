"""dashboard.json writer. index.html is static and polls it (spec §4 Dashboard)."""
from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

INDEX_HTML = Path(__file__).with_name("dashboard_index.html")
DASHBOARD_FORMAT = "blud-upscale-dashboard/1"


def new_run(name: str) -> dict:
    return {"name": name, "state": "pending", "step": 0, "maxSteps": 0, "seconds": 0.0, "bestStep": None,
            "best": None, "g4": None, "config": None, "train": [], "val": []}


class Dashboard:
    """In-memory dashboard state, reloaded from <root>/dashboard.json when present (resume)."""

    def __init__(self, root: Path | str, dataset=None, meter=None) -> None:
        self.root = Path(root)
        (self.root / "img").mkdir(parents=True, exist_ok=True)
        path = self.root / "dashboard.json"
        if path.exists():
            self.state = json.loads(path.read_text())
        else:
            self.state = {"format": DASHBOARD_FORMAT, "updated": None, "dataset": None, "spend": None,
                          "baselines": {}, "runs": [], "showcase": {"pairs": [], "runs": {}}}
        if dataset is not None:
            self.state["dataset"] = {"name": dataset.name, "manifestHash": dataset.manifest_hash,
                                     "train": len(dataset.split("train")), "val": len(dataset.split("val"))}
        self.meter = meter
        shutil.copyfile(INDEX_HTML, self.root / "index.html")

    def run(self, name: str) -> dict:
        for r in self.state["runs"]:
            if r["name"] == name:
                return r
        r = new_run(name)
        self.state["runs"].append(r)
        return r

    def showcase_images(self, run: str, which: str) -> dict:
        return self.state["showcase"]["runs"].setdefault(run, {}).setdefault(which, {})

    def save(self) -> None:
        self.state["updated"] = datetime.now(timezone.utc).isoformat()
        if self.meter is not None:
            self.state["spend"] = self.meter.snapshot()
        tmp = self.root / "dashboard.json.tmp"
        tmp.write_text(json.dumps(self.state))
        os.replace(tmp, self.root / "dashboard.json")
