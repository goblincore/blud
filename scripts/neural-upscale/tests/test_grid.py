import json

import pytest
import torch

from nupscale.constants import GRID
from nupscale.data import load_dataset
from nupscale.grid import SpendMeter, parse_runs, run_grid
from nupscale.train import RunConfig
from tests.helpers import write_v2_dataset

CPU = torch.device("cpu")


def _tiny(model_id, inputs):
    return RunConfig(model_id, inputs, max_steps=6, time_cap_s=1800, val_every=3, log_every=3, batch=2, crop=8)


class FakeMeter:
    def __init__(self, start_ok=True, over_after=None):
        self.start_ok, self.over_after, self.calls = start_ok, over_after, 0

    def can_start(self, seconds):
        return self.start_ok

    def over_cap(self):
        self.calls += 1
        return self.over_after is not None and self.calls > self.over_after

    def snapshot(self):
        return {"hourlyUsd": 1.0, "capUsd": 10.0, "spentUsd": 0.0}


def test_spend_meter():
    now = {"t": 1000.0}
    m = SpendMeter(0.6, 1.0, started_at=1000.0, spent_before=0.1, clock=lambda: now["t"])
    assert m.spent() == pytest.approx(0.1)
    now["t"] += 3600
    assert m.spent() == pytest.approx(0.7) and not m.over_cap()
    assert m.can_start(1700) and not m.can_start(1900)
    now["t"] += 3000
    assert m.over_cap() and m.snapshot() == {"hourlyUsd": 0.6, "capUsd": 1.0, "spentUsd": pytest.approx(1.2)}
    with pytest.raises(ValueError):
        SpendMeter(0, 10)


def test_parse_runs():
    assert parse_runs("") == list(GRID)
    assert parse_runs("s16-rgbd, s8-rgb") == [("s16", "rgbd"), ("s8", "rgb")]
    with pytest.raises(ValueError, match="unknown run"):
        parse_runs("s64-rgb")


def test_grid_runs_everything_and_resumes(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=6))
    root = tmp_path / "runs"
    runs = [("s8", "rgb"), ("s8", "rgbd")]
    summary = run_grid(ds, root, meter=FakeMeter(), device=CPU, runs=runs, make_config=_tiny)
    assert not summary["stoppedAtCap"] and [r["state"] for r in summary["results"]] == ["done", "done"]
    assert (root / "GRID_DONE.json").exists() and not (root / "STOPPED_AT_CAP").exists()
    assert json.loads((root / "dashboard.json").read_text())["spend"]["capUsd"] == 10.0
    again = run_grid(ds, root, meter=FakeMeter(), device=CPU, runs=runs, make_config=_tiny)
    assert again["results"] == summary["results"]


def test_grid_stops_mid_run_at_the_cap(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=6))
    root = tmp_path / "runs"
    summary = run_grid(ds, root, meter=FakeMeter(over_after=4), device=CPU,
                       runs=[("s8", "rgb"), ("s8", "rgbd")], make_config=_tiny)
    assert summary["stoppedAtCap"] and len(summary["results"]) == 1
    assert summary["results"][0]["state"] == "stopped" and summary["results"][0]["step"] == 4
    assert (root / "STOPPED_AT_CAP").exists()
    assert (root / "s8-rgb" / "exports" / "s8-rgb-final" / "model.json").exists()
    states = {r["name"]: r["state"] for r in json.loads((root / "dashboard.json").read_text())["runs"]}
    assert states == {"s8-rgb": "stopped", "s8-rgbd": "skipped-cap"}


def test_grid_does_not_start_an_unaffordable_run(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=6))
    root = tmp_path / "runs"
    meter = SpendMeter(1.0, 1.0, started_at=0.0, spent_before=0.5, clock=lambda: 0.0)
    summary = run_grid(ds, root, meter=meter, device=CPU, runs=[("s8", "rgb")], reserve_s=600, make_config=_tiny)
    assert summary["stoppedAtCap"] and summary["results"] == []
    assert not (root / "s8-rgb").exists()
    assert json.loads((root / "STOPPED_AT_CAP").read_text())["spentUsd"] == 0.5
