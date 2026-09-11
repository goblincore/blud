import base64
import json

import numpy as np
import pytest

from nupscale.constants import MODEL_FORMAT
from nupscale.data import load_dataset
from nupscale.export import export_model, export_parity_fixture, f32_bytes, fnv1a32, weight_hash
from nupscale.model import Upscaler
from nupscale.reconstruct import reconstruct
from tests.helpers import write_v2_dataset


def test_fnv_matches_the_typescript_tiny_vector():
    chunks = [f32_bytes([0.5, -1.25, 3, 0, 0, 0, 0, 0, 0.001]), f32_bytes([0.25]), f32_bytes([1, 0.1]), f32_bytes([0, 0.5])]
    assert fnv1a32(chunks) == "21f3e5c5"


@pytest.mark.parametrize("inputs,expected", [("rgb", "3d86dba5"), ("rgbd", "55870aa7")])
def test_zero_model_hash_matches_typescript(inputs, expected):
    assert weight_hash(Upscaler("zero", inputs)) == expected


def test_export_model_json(tmp_path):
    m = Upscaler("s8", "rgbd", seed=2)
    doc = export_model(m, tmp_path / "e", run="s8-rgbd", step=500, dataset="ds",
                       manifest_hash="0123456789abcdef", metrics={"overall": 0.1, "face": None})
    saved = json.loads((tmp_path / "e" / "model.json").read_text())
    assert saved == doc
    assert (saved["format"], saved["id"], saved["inputs"], saved["source"], saved["run"], saved["step"]) == \
        (MODEL_FORMAT, "s8", "rgbd", "trained", "s8-rgbd", 500)
    assert [(l["inC"], l["outC"], l["relu"]) for l in saved["layers"]] == [(5, 8, True), (8, 8, True), (8, 16, False)]
    w0 = np.frombuffer(base64.b64decode(saved["layers"][0]["weights"]), dtype="<f4")
    assert np.array_equal(w0, m.convs[0].weight.detach().numpy().reshape(-1))
    assert saved["inScale"] == [1.0, 1.0, 1.0, 1.0, 0.10000000149011612] and saved["inOffset"] == [0.0] * 5
    assert saved["trainedOn"] == {"dataset": "ds", "manifestHash": "0123456789abcdef"}
    # recomputable from the JSON alone, as parseUpscaleModelJson does
    chunks = []
    for layer in saved["layers"]:
        chunks += [base64.b64decode(layer["weights"]), base64.b64decode(layer["bias"])]
    chunks += [f32_bytes(saved["inScale"]), f32_bytes(saved["inOffset"])]
    assert fnv1a32(chunks) == saved["weightHash"] == weight_hash(m)


def test_parity_fixture(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=3))
    m = Upscaler("s8", "rgb", seed=4)
    pairs = ds.split("val") + ds.split("train")
    fixtures = export_parity_fixture(m, pairs, ds.near, ds.far, tmp_path / "parity")
    meta = json.loads((tmp_path / "parity" / "meta.json").read_text())
    assert meta == {"near": 0.1, "far": 200.0, "fixtures": fixtures} and len(fixtures) == 2
    assert [f["pair"] for f in fixtures] == [pairs[0].id, pairs[1].id]
    for k, name in enumerate(["input-0.npy", "output-sp-0.npy"]):
        with open(tmp_path / "parity" / name, "rb") as f:
            assert np.lib.format.read_magic(f) == (1, 0)
            shape, fortran, dtype = np.lib.format.read_array_header_1_0(f)
            assert not fortran and dtype == np.dtype("<f4") and shape == [(12, 16, 4), (24, 32, 4)][k]
    out = np.load(tmp_path / "parity" / "output-sp-0.npy")
    p = pairs[0]
    want = reconstruct(p.inp[None], m(p.inp[None], 0.1, 200.0)).march()[0].permute(1, 2, 0).detach().numpy()
    assert np.array_equal(out, want)
    assert np.array_equal(np.load(tmp_path / "parity" / "input-0.npy"), p.inp.permute(1, 2, 0).numpy())
