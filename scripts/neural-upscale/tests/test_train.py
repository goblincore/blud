import json

import pytest
import torch

from nupscale.dashboard import Dashboard
from nupscale.data import load_dataset
from nupscale.train import RunConfig, prepare_dashboard, train_run
from tests.helpers import write_v2_dataset

CPU = torch.device("cpu")


def _cfg(**overrides):
    base = dict(max_steps=12, time_cap_s=600, val_every=6, log_every=3, batch=4, crop=8)
    base.update(overrides)
    return RunConfig("s8", "rgbd", **base)


def _setup(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=6))
    root = tmp_path / "runs"
    dash = Dashboard(root, ds)
    return ds, root, dash, prepare_dashboard(dash, ds)


def test_run_writes_checkpoints_exports_and_dashboard(tmp_path):
    ds, root, dash, baselines = _setup(tmp_path)
    res = train_run(_cfg(), ds, root, device=CPU, dashboard=dash, baselines=baselines)
    assert res["state"] == "done" and res["step"] == 12 and res["bestStep"] in (6, 12)
    run = root / "s8-rgbd"
    for rel in ["ckpt-latest.pt", "ckpt-best.pt", "RUN_DONE.json",
                "exports/s8-rgbd-final/model.json", "exports/s8-rgbd-final/parity/meta.json",
                "exports/s8-rgbd-best/model.json", "exports/s8-rgbd-best/parity/output-sp-1.npy"]:
        assert (run / rel).exists(), rel
    best = json.loads((run / "exports/s8-rgbd-best/model.json").read_text())
    assert best["step"] == res["bestStep"] and best["trainedOn"] == {"dataset": "ds", "manifestHash": ds.manifest_hash}
    saved = json.loads((root / "dashboard.json").read_text())
    entry = saved["runs"][0]
    assert entry["state"] == "done" and [v["step"] for v in entry["val"]] == [6, 12]
    assert [t[0] for t in entry["train"]] == [1, 3, 6, 9, 12] and entry["g4"] is not None
    assert entry["config"]["regionWeights"]["face"] == 2.0
    assert set(saved["baselines"]) == {"nearest", "bicubic", "native"}
    pair = saved["showcase"]["pairs"][0]
    assert set(pair["base"]) == {"nearest", "bicubic", "native", "target"}
    assert (root / pair["base"]["bicubic"]).exists()
    assert (root / saved["showcase"]["runs"]["s8-rgbd"]["best"][pair["id"]]).exists()
    # a finished run is not trained again
    assert train_run(_cfg(), ds, root, device=CPU, dashboard=dash, baselines=baselines) == res


def test_resume_continues_from_the_latest_checkpoint(tmp_path):
    ds, root, dash, baselines = _setup(tmp_path)
    calls = {"n": 0}

    def crash():
        calls["n"] += 1
        if calls["n"] > 8:
            raise RuntimeError("pod died")
        return False

    with pytest.raises(RuntimeError, match="pod died"):
        train_run(_cfg(), ds, root, device=CPU, dashboard=dash, baselines=baselines, should_stop=crash)
    assert torch.load(root / "s8-rgbd" / "ckpt-latest.pt", weights_only=True)["step"] == 6
    res = train_run(_cfg(), ds, root, device=CPU, dashboard=Dashboard(root, ds), baselines=baselines)
    assert res["state"] == "done" and res["step"] == 12
    entry = json.loads((root / "dashboard.json").read_text())["runs"][0]
    assert [v["step"] for v in entry["val"]] == [6, 12]
    assert [t[0] for t in entry["train"]] == [1, 3, 6, 9, 12]


def test_time_cap_and_stop_still_validate_and_export(tmp_path):
    ds, root, dash, baselines = _setup(tmp_path)
    now = {"t": 0.0}

    def clock():
        now["t"] += 10.0
        return now["t"]

    res = train_run(_cfg(time_cap_s=45), ds, root, device=CPU, dashboard=dash, baselines=baselines, clock=clock)
    assert res["state"] == "time-cap" and 0 < res["step"] < 12
    assert (root / "s8-rgbd" / "exports" / "s8-rgbd-final" / "model.json").exists()
    stopped = train_run(RunConfig("s8", "rgb", max_steps=12, val_every=6, log_every=3, batch=4, crop=8),
                        ds, root, device=CPU, dashboard=dash, baselines=baselines, should_stop=lambda: True)
    assert stopped["state"] == "stopped" and stopped["step"] == 0
    assert json.loads((root / "s8-rgb" / "exports" / "s8-rgb-final" / "model.json").read_text())["step"] == 0
