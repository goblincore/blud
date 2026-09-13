"""Model JSON export and parity fixtures (contracts §2, §3)."""
from __future__ import annotations

import base64
import copy
import json
from pathlib import Path
from typing import Iterable

import numpy as np
import torch

from .constants import MODEL_FORMAT
from .data import Pair
from .reconstruct import predict


def fnv1a32(chunks: Iterable[bytes]) -> str:
    """FNV-1a 32 over the concatenated bytes, lowercase 8-digit hex (upscale-model.ts `hashModel`)."""
    h = 0x811C9DC5
    for chunk in chunks:
        for byte in chunk:
            h = ((h ^ byte) * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def f32_bytes(values) -> bytes:
    if isinstance(values, torch.Tensor):
        values = values.detach().cpu().numpy()
    return np.ascontiguousarray(values, dtype="<f4").tobytes()


def fused_for(model):
    return model.fused() if getattr(model, "reparam", False) else model


def model_layers(model) -> list[dict]:
    """Each conv as {inC, outC, relu, dilation, weights, bias} with float32 LE bytes in PyTorch order.
    A reparameterised model is fused first (the export is always plain 3x3 convs)."""
    model = model.fused() if getattr(model, "reparam", False) else model
    last = len(model.convs) - 1
    return [{"inC": c.in_channels, "outC": c.out_channels, "relu": k < last, "dilation": int(c.dilation[0]),
             "weights": f32_bytes(c.weight), "bias": f32_bytes(c.bias)} for k, c in enumerate(model.convs)]


def hash_arrays(layers: list[dict], in_scale: bytes, in_offset: bytes, head: list[dict] | None = None) -> str:
    """FNV-1a over layers, inScale, inOffset, then the head layers (run 4) — upscale-model.ts `hashModel`."""
    chunks: list[bytes] = []
    for layer in layers:
        chunks += [layer["weights"], layer["bias"]]
    chunks += [in_scale, in_offset]
    for layer in head or []:
        chunks += [layer["weights"], layer["bias"]]
    return fnv1a32(chunks)


def head_layers(model) -> list[dict] | None:
    if getattr(model, "head", None) is None:
        return None
    return [{"weights": f32_bytes(c.weight), "bias": f32_bytes(c.bias)} for c in fused_for(model).head]


def weight_hash(model) -> str:
    return hash_arrays(model_layers(model), f32_bytes(model.in_scale), f32_bytes(model.in_offset), head_layers(model))


def export_model(model, out_dir: Path | str, *, run: str, step: int, dataset: str, manifest_hash: str,
                 metrics: dict | None) -> dict:
    """Writes <out_dir>/model.json (`blud-upscale-model/1`) and returns the document."""
    layers = model_layers(model)
    in_scale = f32_bytes(model.in_scale)
    in_offset = f32_bytes(model.in_offset)

    def b64(raw: bytes) -> str:
        return base64.b64encode(raw).decode("ascii")

    doc = {
        "format": MODEL_FORMAT,
        "id": model.model_id,
        "inputs": model.inputs,
        "source": "trained",
        "run": run,
        "step": int(step),
        "layers": [{"inC": l["inC"], "outC": l["outC"], "relu": l["relu"], "dilation": l["dilation"],
                    "weights": b64(l["weights"]), "bias": b64(l["bias"])} for l in layers],
        # Run-4 head (optional): full-res convs, same layer format, applied after the §4 placement.
        "head": [{"inC": c.in_channels, "outC": c.out_channels, "relu": k == 0, "dilation": 1,
                  "weights": b64(f32_bytes(c.weight)), "bias": b64(f32_bytes(c.bias))}
                 for k, c in enumerate(fused_for(model).head)] if getattr(model, "head", None) is not None else None,
        "inScale": np.frombuffer(in_scale, dtype="<f4").astype(float).tolist(),
        "inOffset": np.frombuffer(in_offset, dtype="<f4").astype(float).tolist(),
        "weightHash": hash_arrays(layers, in_scale, in_offset, head_layers(model)),
        "trainedOn": {"dataset": dataset, "manifestHash": manifest_hash},
        "metrics": metrics,
    }
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "model.json").write_text(json.dumps(doc, indent=1))
    return doc


def _save_hwc(path: Path, chw_tensor: torch.Tensor) -> None:
    np.save(path, np.ascontiguousarray(chw_tensor.detach().cpu().permute(1, 2, 0).numpy(), dtype="<f4"))


@torch.no_grad()
def export_parity_fixture(model, pairs: list[Pair], near: float, far: float, out_dir: Path | str,
                          count: int = 2) -> list[dict]:
    """The first `count` pairs' inputs and PyTorch's float32 CPU §4 reconstruction (contracts §3)."""
    cpu = copy.deepcopy(model.fused() if getattr(model, "reparam", False) else model).to("cpu").float().eval()
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    fixtures = []
    for k, pair in enumerate(pairs[:count]):
        march = pair.inp.unsqueeze(0)
        detail = pair.detail.unsqueeze(0) if pair.detail is not None else None
        output = predict(cpu, march, near, far, detail).march()[0]
        _save_hwc(out / f"input-{k}.npy", pair.inp[:4])
        _save_hwc(out / f"output-sp-{k}.npy", output)
        fx = {"pair": pair.id, "input": f"input-{k}.npy", "output": f"output-sp-{k}.npy"}
        if pair.inp.shape[0] > 4:
            _save_hwc(out / f"normal-{k}.npy", pair.inp[4:])
            fx["normal"] = f"normal-{k}.npy"
        if pair.detail is not None:
            _save_hwc(out / f"detail-{k}.npy", pair.detail)
            fx["detail"] = f"detail-{k}.npy"
        fixtures.append(fx)
    (out / "meta.json").write_text(json.dumps({"near": near, "far": far, "fixtures": fixtures}, indent=1))
    return fixtures
