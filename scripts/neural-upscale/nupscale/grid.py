"""The 6-run grid under the spend meter (spec §4 Grid, §6 stop rules).

Usage (on the pod): python -m nupscale.grid --data /workspace/data/<name> --root /workspace/runs/p3 \
    --hourly-usd 0.69 --cap-usd 10 --started-at <epoch seconds the pod started>
"""
from __future__ import annotations

import argparse
import json
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from . import constants as C
from .dashboard import Dashboard
from .data import Dataset, load_dataset
from .train import RunConfig, pick_device, prepare_dashboard, train_run


class SpendMeter:
    """Estimated spend = spent_before + hourly price x hours since started_at (wall clock)."""

    def __init__(self, hourly_usd: float, cap_usd: float, *, started_at: float | None = None,
                 spent_before: float = 0.0, clock: Callable[[], float] = time.time) -> None:
        if hourly_usd <= 0:
            raise ValueError("hourly_usd must be > 0")
        self.hourly_usd = float(hourly_usd)
        self.cap_usd = float(cap_usd)
        self.spent_before = float(spent_before)
        self.clock = clock
        self.started_at = clock() if started_at is None else float(started_at)

    def spent(self) -> float:
        return self.spent_before + max(0.0, self.clock() - self.started_at) / 3600 * self.hourly_usd

    def cost_of(self, seconds: float) -> float:
        return seconds / 3600 * self.hourly_usd

    def can_start(self, seconds: float) -> bool:
        return self.spent() + self.cost_of(seconds) <= self.cap_usd

    def over_cap(self) -> bool:
        return self.spent() >= self.cap_usd

    def snapshot(self) -> dict:
        return {"hourlyUsd": self.hourly_usd, "capUsd": self.cap_usd, "spentUsd": round(self.spent(), 4)}


def parse_runs(text: str | None) -> list[tuple[str, str]]:
    if not text:
        return list(C.GRID)
    runs = []
    for name in text.split(","):
        model_id, _, inputs = name.strip().partition("-")
        if (model_id, inputs) not in C.GRID:
            raise ValueError(f"unknown run {name.strip()!r} (expected one of {', '.join(f'{m}-{i}' for m, i in C.GRID)})")
        runs.append((model_id, inputs))
    return runs


def run_grid(dataset: Dataset, root: Path | str, *, meter, device, runs=C.GRID, reserve_s: float = C.RESERVE_S,
             make_config: Callable[[str, str], RunConfig] = RunConfig,
             clock: Callable[[], float] = time.monotonic) -> dict:
    """Runs in order. Before each run: if its estimated cost (time cap x RUN_OVERHEAD + reserve)
    would cross the cap, the grid stops. During a run the meter's over_cap stops it at the next
    step; the run still validates and exports. Either way STOPPED_AT_CAP is written."""
    root = Path(root)
    dashboard = Dashboard(root, dataset, meter=meter)
    baselines = prepare_dashboard(dashboard, dataset)
    for model_id, inputs in runs:
        dashboard.run(f"{model_id}-{inputs}")
    dashboard.save()
    results, stopped = [], False
    for model_id, inputs in runs:
        cfg = make_config(model_id, inputs)
        finished = (root / cfg.name / "RUN_DONE.json").exists()
        if not finished and not meter.can_start(cfg.time_cap_s * C.RUN_OVERHEAD + reserve_s):
            stopped = True
            break
        result = train_run(cfg, dataset, root, device=device, dashboard=dashboard, baselines=baselines,
                           should_stop=meter.over_cap, clock=clock)
        results.append(result)
        if result["state"] == "stopped":
            stopped = True
            break
    if stopped:
        (root / "STOPPED_AT_CAP").write_text(json.dumps(meter.snapshot()))
        for r in dashboard.state["runs"]:
            if r["state"] == "pending":
                r["state"] = "skipped-cap"
    summary = {"finished": datetime.now(timezone.utc).isoformat(), "stoppedAtCap": stopped,
               "spend": meter.snapshot(), "results": results}
    (root / "GRID_DONE.json").write_text(json.dumps(summary, indent=1))
    dashboard.save()
    return summary


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Run the neural upscale training grid under a spend cap (P3b).")
    ap.add_argument("--data", required=True)
    ap.add_argument("--root", required=True)
    ap.add_argument("--hourly-usd", type=float, required=True, help="the pod's hourly price")
    ap.add_argument("--cap-usd", type=float, default=10.0)
    ap.add_argument("--started-at", type=float, default=None, help="epoch seconds the pod started billing (default: now)")
    ap.add_argument("--spent-before", type=float, default=0.0, help="USD already spent outside this pod session")
    ap.add_argument("--reserve-min", type=float, default=C.RESERVE_S / 60, help="minutes kept back for pulling exports")
    ap.add_argument("--runs", default="", help="comma list, e.g. s16-rgbd,s8-rgb (default: the full grid)")
    ap.add_argument("--max-steps", type=int, default=C.MAX_STEPS)
    ap.add_argument("--time-cap-min", type=float, default=C.TIME_CAP_S / 60)
    ap.add_argument("--val-every", type=int, default=C.VAL_EVERY)
    ap.add_argument("--batch", type=int, default=C.BATCH)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--compile", action="store_true", help="fuse the step with torch.compile (~2x)")
    args = ap.parse_args(argv)
    root = Path(args.root)
    root.mkdir(parents=True, exist_ok=True)
    meter = SpendMeter(args.hourly_usd, args.cap_usd, started_at=args.started_at, spent_before=args.spent_before)

    def make_config(model_id: str, inputs: str) -> RunConfig:
        return RunConfig(model_id, inputs, max_steps=args.max_steps, time_cap_s=args.time_cap_min * 60,
                         val_every=args.val_every, batch=args.batch, compile=args.compile)

    try:
        summary = run_grid(load_dataset(args.data), root, meter=meter, device=pick_device(args.device),
                           runs=parse_runs(args.runs), reserve_s=args.reserve_min * 60, make_config=make_config)
    except Exception:
        (root / "GRID_FAILED.txt").write_text(traceback.format_exc())
        raise
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
