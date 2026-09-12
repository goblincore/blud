"""Pre-flight (spec §6): a local smoke training that must pass before any pod launch.

Usage: python -m nupscale.preflight --data /tmp/blud-upscale-data/preflight-v2 --root /tmp/blud-upscale-runs/preflight
Checks: training loss falls; the model beats nearest on its own training pairs (an overfit sanity
check, not a quality result); best and final exports exist; the run fits in the time budget.
Writes <root>/PREFLIGHT.json and exits 1 when a check fails.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import torch

from .dashboard import Dashboard
from .data import load_dataset
from .evaluate import evaluate, predict_model, predict_nearest
from .model import Upscaler
from .train import RunConfig, pick_device, prepare_dashboard, train_run


def run_preflight(data: str | Path, root: str | Path, *, model_id: str = "s8", inputs: str = "rgb", steps: int = 600,
                  batch: int = 16, val_every: int = 200, budget_s: float = 600, device: str = "auto") -> dict:
    root = Path(root)
    dev = pick_device(device)
    t0 = time.monotonic()
    ds = load_dataset(data)
    dash = Dashboard(root, ds)
    baselines = prepare_dashboard(dash, ds)
    cfg = RunConfig(model_id, inputs, max_steps=steps, time_cap_s=budget_s, val_every=val_every, log_every=10, batch=batch)
    result = train_run(cfg, ds, root, device=dev, dashboard=dash, baselines=baselines)
    losses = [t[1] for t in dash.run(cfg.name)["train"]]
    head, tail = losses[:3], losses[-3:]

    ck = torch.load(root / cfg.name / "ckpt-latest.pt", map_location="cpu", weights_only=True)
    model = Upscaler(model_id, inputs)
    model.load_state_dict(ck["model"])
    train = ds.split("train")
    model_train = evaluate(lambda p: predict_model(model, p, ds.near, ds.far, torch.device("cpu")), train)
    nearest_train = evaluate(predict_nearest, train)
    exports = root / cfg.name / "exports"
    seconds = time.monotonic() - t0
    checks = {
        "trainingFinished": result["state"] == "done",
        "lossFell": bool(head and tail and sum(tail) / len(tail) < sum(head) / len(head)),
        "beatsNearestOnTrain": model_train["overall"] is not None and nearest_train["overall"] is not None
        and model_train["overall"] < nearest_train["overall"],
        "exportsWritten": all((exports / f"{cfg.name}-{k}" / "model.json").exists() for k in ("best", "final")),
        "withinBudget": seconds <= budget_s,
    }
    report = {
        "pass": all(checks.values()), "checks": checks, "device": str(dev), "seconds": round(seconds, 1),
        "run": result, "lossHead": head, "lossTail": tail,
        "train": {"model": model_train["overall"], "nearest": nearest_train["overall"]},
        "val": {"model": (result["best"] or {}).get("overall"), "nearest": baselines["nearest"]["overall"],
                "bicubic": baselines["bicubic"]["overall"]},
        "exports": {k: str(exports / f"{cfg.name}-{k}") for k in ("best", "final")},
    }
    (root / "PREFLIGHT.json").write_text(json.dumps(report, indent=1))
    return report


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Neural upscale pre-flight: local smoke training (spec §6).")
    ap.add_argument("--data", required=True)
    ap.add_argument("--root", required=True)
    ap.add_argument("--model", default="s8", choices=["s8", "s16", "s32"])
    ap.add_argument("--inputs", default="rgb", choices=["rgb", "rgbd"])
    ap.add_argument("--steps", type=int, default=600)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--val-every", type=int, default=200)
    ap.add_argument("--budget-min", type=float, default=10.0)
    ap.add_argument("--device", default="auto")
    args = ap.parse_args(argv)
    report = run_preflight(args.data, args.root, model_id=args.model, inputs=args.inputs, steps=args.steps,
                           batch=args.batch, val_every=args.val_every, budget_s=args.budget_min * 60, device=args.device)
    print(json.dumps(report, indent=1))
    print("PREFLIGHT: PASS" if report["pass"] else "PREFLIGHT: FAIL")
    sys.exit(0 if report["pass"] else 1)


if __name__ == "__main__":
    main()
