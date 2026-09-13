"""One training run (spec §2), plus a CLI for a single run.

Usage: python -m nupscale.train --data <dataset> --root <run root> --model s16 --inputs rgbd
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

import torch

from . import constants as C
from .dashboard import Dashboard
from .data import CropSampler, Dataset, Pair, load_dataset
from .evaluate import beats, evaluate, predict_bicubic, predict_model, predict_nearest
from .export import export_model, export_parity_fixture
from .images import save_march_png
from .losses import upscale_loss
from .model import Upscaler
from .reconstruct import predict


@dataclass
class RunConfig:
    model_id: str
    inputs: str
    max_steps: int = C.MAX_STEPS
    time_cap_s: float = C.TIME_CAP_S
    val_every: int = C.VAL_EVERY
    log_every: int = C.LOG_EVERY
    batch: int = C.BATCH
    lr: float = C.LR
    crop: int = C.CROP_IN
    seed: int = 1
    region_share: float = C.REGION_CENTRED_SHARE
    coverage_margin: float = C.COVERAGE_MARGIN
    detail_weight: float = C.DETAIL_WEIGHT
    coverage_weight: float = C.COVERAGE_WEIGHT
    compile: bool = False
    reparam: bool = False
    """Run-4 full-res head (needs detail.npy in every pair)."""
    head: bool = False
    """Head input set (constants.HEAD_INPUT_CHANNELS): "detail" (run-4, default) or "detail+refine"
    (run-5, needs refine_n.npy/refine_c.npy in every pair too)."""
    head_inputs: str = "detail"
    """Region weight overrides (spec §2 REGION_WEIGHTS), e.g. {"interior": 2.0} — run 4 weights the
    interior up because the edge band is solved."""
    region_weights: dict | None = None
    """Run-name suffix so variants of one (model, inputs) coexist in a root, e.g. '-dw1.0' or '-rep'."""
    tag: str = ""

    @property
    def name(self) -> str:
        return f"{self.model_id}-{self.inputs}{self.tag}"

    @property
    def weights(self) -> dict[str, float]:
        return {**C.REGION_WEIGHTS, **(self.region_weights or {})}

    def record(self) -> dict:
        return {**asdict(self), "regionWeights": dict(self.weights), "edgeBandPx": C.EDGE_BAND_PX,
                "icnrScale": C.ICNR_SCALE, "optimizer": "adam", "schedule": "cosine"}


def pick_device(name: str = "auto") -> torch.device:
    if name != "auto":
        return torch.device(name)
    if torch.cuda.is_available():
        return torch.device("cuda")
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def showcase_pairs(dataset: Dataset) -> list[Pair]:
    val = dataset.split("val")
    return [p for p in val if p.showcase] or val[:C.SHOWCASE_FALLBACK]


def compute_baselines(dataset: Dataset) -> dict:
    val = dataset.split("val")
    if not val:
        raise ValueError(f"dataset {dataset.name} has no validation pairs")
    native = [p for p in val if p.native is not None]
    return {
        "nearest": evaluate(predict_nearest, val),
        "bicubic": evaluate(predict_bicubic, val),
        "native": evaluate(lambda p: p.native, native) if native else None,
    }


def prepare_dashboard(dashboard: Dashboard, dataset: Dataset) -> dict:
    """Baseline metrics and showcase baseline crops, computed once per session."""
    baselines = compute_baselines(dataset)
    dashboard.state["baselines"] = baselines
    entries = []
    for p in showcase_pairs(dataset):
        kinds = {"nearest": predict_nearest(p), "bicubic": predict_bicubic(p), "target": p.target}
        if p.native is not None:
            kinds["native"] = p.native
        base = {}
        for kind, image in kinds.items():
            rel = f"img/base-{p.id}-{kind}.png"
            save_march_png(image, dashboard.root / rel)
            base[kind] = rel
        entries.append({"id": p.id, "class": p.cls, "base": base})
    dashboard.state["showcase"]["pairs"] = entries
    dashboard.save()
    return baselines


def _atomic_save(obj: dict, path: Path) -> None:
    tmp = path.with_name(path.name + ".tmp")
    torch.save(obj, tmp)
    os.replace(tmp, path)


def train_run(cfg: RunConfig, dataset: Dataset, root: Path | str, *, device: torch.device, dashboard: Dashboard,
              baselines: dict, should_stop: Callable[[], bool] = lambda: False,
              clock: Callable[[], float] = time.monotonic) -> dict:
    """Trains one run with validation, checkpoints and exports. Resumes from ckpt-latest.pt; a run
    with RUN_DONE.json is not re-trained. Stops at max_steps ("done"), the time cap ("time-cap") or
    when should_stop() is true ("stopped"), and always validates and exports before returning."""
    root = Path(root)
    run_dir = root / cfg.name
    run_dir.mkdir(parents=True, exist_ok=True)
    done_path = run_dir / "RUN_DONE.json"
    if done_path.exists():
        return json.loads(done_path.read_text())
    val = dataset.split("val")
    if not val:
        raise ValueError(f"dataset {dataset.name} has no validation pairs")
    near, far = dataset.near, dataset.far

    torch.manual_seed(cfg.seed)
    model = Upscaler(cfg.model_id, cfg.inputs, seed=cfg.seed, reparam=cfg.reparam, head=cfg.head,
                     head_inputs=cfg.head_inputs).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=cfg.lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=max(cfg.max_steps, 1))
    latest_path, best_path = run_dir / "ckpt-latest.pt", run_dir / "ckpt-best.pt"
    step, best_step, best_score, best_metrics = 0, None, None, None
    if latest_path.exists():
        ck = torch.load(latest_path, map_location=device, weights_only=True)
        model.load_state_dict(ck["model"])
        opt.load_state_dict(ck["opt"])
        sched.load_state_dict(ck["sched"])
        step, best_step, best_score, best_metrics = ck["step"], ck["best_step"], ck["best_score"], ck["best_metrics"]
    validated_at = step if latest_path.exists() else -1

    # A step is ~100 tiny elementwise kernels over 16 MB tensors, so it is launch-bound, not
    # compute-bound: fusing them measured 2.0x on MPS (56.0 -> 28.3 ms/step, s32-rgbd, batch 64).
    def loss_of(march, target, weight, detail=None, refine=None):
        rec = predict(model, march, near, far, detail, refine)
        return upscale_loss(rec, target, weight, margin=cfg.coverage_margin,
                            detail_weight=cfg.detail_weight, coverage_weight=cfg.coverage_weight)

    compute = loss_of
    if cfg.compile:
        try:
            compute = torch.compile(loss_of)
        except Exception as e:  # a backend that cannot compile must not lose the run
            print(f"[{cfg.name}] torch.compile unavailable, running eager: {e}")

    sampler = CropSampler(dataset.split("train"), crop=cfg.crop, seed=cfg.seed + step, region_share=cfg.region_share)
    showcase = showcase_pairs(dataset)
    entry = dashboard.run(cfg.name)
    entry.update(state="running", maxSteps=cfg.max_steps, config=cfg.record())
    entry["train"] = [t for t in entry["train"] if t[0] <= step]
    entry["val"] = [v for v in entry["val"] if v["step"] <= step]

    def validate() -> None:
        nonlocal best_step, best_score, best_metrics
        model.eval()
        metrics = evaluate(lambda p: predict_model(model, p, near, far, device), val)
        latest = dashboard.showcase_images(cfg.name, "latest")
        for p in showcase:
            rel = f"img/{cfg.name}-{p.id}-latest.png"
            save_march_png(predict_model(model, p, near, far, device), root / rel)
            latest[p.id] = rel
        model.train()
        entry["val"] = [v for v in entry["val"] if v["step"] < step] + [{"step": step, "metrics": metrics}]
        score = metrics["overall"]
        if score is not None and (best_score is None or score < best_score):
            best_step, best_score, best_metrics = step, score, metrics
            _atomic_save({"model": model.state_dict(), "step": step, "metrics": metrics}, best_path)
            best = dashboard.showcase_images(cfg.name, "best")
            for p in showcase:
                rel = f"img/{cfg.name}-{p.id}-best.png"
                shutil.copyfile(root / latest[p.id], root / rel)
                best[p.id] = rel
        _atomic_save({"model": model.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(),
                      "step": step, "best_step": best_step, "best_score": best_score,
                      "best_metrics": best_metrics}, latest_path)
        entry.update(step=step, bestStep=best_step, best=best_metrics,
                     g4=beats(best_metrics, baselines["bicubic"]) if best_metrics else None)
        dashboard.save()

    start = clock()
    elapsed = 0.0
    model.train()
    while True:
        if step >= cfg.max_steps:
            state = "done"
            break
        if should_stop():
            state = "stopped"
            break
        elapsed = clock() - start
        if elapsed >= cfg.time_cap_s:
            state = "time-cap"
            break
        march, target, weight, detail, refine = sampler.sample_with_extras(cfg.batch)
        march, target, weight = march.to(device), target.to(device), weight.to(device)
        detail = detail.to(device) if detail is not None else None
        refine = refine.to(device) if refine is not None else None
        loss, parts = compute(march, target, weight, detail, refine)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
        sched.step()
        step += 1
        if step == 1 or step % cfg.log_every == 0:
            entry["train"].append([step, float(loss.detach()), float(parts["colour"]), float(parts["detail"]), float(parts["coverage"])])
            entry.update(step=step, seconds=elapsed)
        if step % cfg.val_every == 0:
            validate()
            validated_at = step
    if validated_at != step:
        validate()

    exports = run_dir / "exports"
    fixture_pairs = showcase + [p for p in val if p not in showcase]
    final_dir = exports / f"{cfg.name}-final"
    export_model(model, final_dir, run=cfg.name, step=step, dataset=dataset.name,
                 manifest_hash=dataset.manifest_hash, metrics=entry["val"][-1]["metrics"])
    export_parity_fixture(model, fixture_pairs, near, far, final_dir / "parity")
    if best_path.exists():
        ck = torch.load(best_path, map_location="cpu", weights_only=True)
        best_model = Upscaler(cfg.model_id, cfg.inputs, reparam=cfg.reparam, head=cfg.head, head_inputs=cfg.head_inputs)
        best_model.load_state_dict(ck["model"])
        best_dir = exports / f"{cfg.name}-best"
        export_model(best_model, best_dir, run=cfg.name, step=ck["step"], dataset=dataset.name,
                     manifest_hash=dataset.manifest_hash, metrics=ck["metrics"])
        export_parity_fixture(best_model, fixture_pairs, near, far, best_dir / "parity")

    result = {"name": cfg.name, "state": state, "step": step, "bestStep": best_step, "best": best_metrics,
              "g4": entry["g4"], "seconds": elapsed}
    entry.update(state=state, step=step, seconds=elapsed)
    dashboard.save()
    done_path.write_text(json.dumps(result, indent=1))
    return result


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Train one neural upscale run (P3b).")
    ap.add_argument("--data", required=True, help="dataset v2 directory")
    ap.add_argument("--root", required=True, help="run root (dashboard + run directories)")
    ap.add_argument("--model", default="s16", choices=["s8", "s16", "s32"])
    ap.add_argument("--inputs", default="rgbd", choices=["rgb", "rgbd"])
    ap.add_argument("--max-steps", type=int, default=C.MAX_STEPS)
    ap.add_argument("--time-cap-min", type=float, default=C.TIME_CAP_S / 60)
    ap.add_argument("--val-every", type=int, default=C.VAL_EVERY)
    ap.add_argument("--batch", type=int, default=C.BATCH)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--compile", action="store_true", help="fuse the step with torch.compile (~2x)")
    args = ap.parse_args(argv)
    dataset = load_dataset(args.data)
    dashboard = Dashboard(args.root, dataset)
    baselines = prepare_dashboard(dashboard, dataset)
    cfg = RunConfig(args.model, args.inputs, max_steps=args.max_steps, time_cap_s=args.time_cap_min * 60,
                    val_every=args.val_every, batch=args.batch, compile=args.compile)
    result = train_run(cfg, dataset, args.root, device=pick_device(args.device), dashboard=dashboard, baselines=baselines)
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
