import json

from nupscale.preflight import run_preflight
from tests.helpers import write_v2_dataset


def test_preflight_report(tmp_path):
    root = tmp_path / "pre"
    report = run_preflight(write_v2_dataset(tmp_path / "ds", pairs=6), root, steps=20, batch=4, val_every=10,
                           budget_s=600, device="cpu")
    assert set(report["checks"]) == {"trainingFinished", "lossFell", "beatsNearestOnTrain", "exportsWritten", "withinBudget"}
    assert report["checks"]["trainingFinished"] and report["checks"]["exportsWritten"] and report["checks"]["withinBudget"]
    assert json.loads((root / "PREFLIGHT.json").read_text()) == report
    assert (root / "index.html").exists() and (root / "dashboard.json").exists()
