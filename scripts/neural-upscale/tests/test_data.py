import json

import pytest
import torch

from nupscale.constants import DATASET_FORMAT
from nupscale.data import CropSampler, load_dataset, paste
from tests.helpers import write_v2_dataset


def test_load_dataset_shapes_splits_and_regions(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=6))
    assert ds.name == "ds" and ds.near == 0.1 and ds.far == 200.0 and len(ds.manifest_hash) == 16
    assert [p.split for p in ds.pairs].count("val") == 2
    p = ds.pairs[0]
    assert p.inp.shape == (4, 12, 16) and p.target.shape == (4, 24, 32) and p.weight.shape == (1, 24, 32)
    assert p.native is None and ds.split("val")[0].native.shape == (4, 24, 32)
    assert p.centres == [(16.0, 12.0), pytest.approx((22.4, 14.4))]
    assert set(p.masks) == {"flesh", "face", "wound", "edge", "interior"}
    assert bool(p.masks["face"][12, 16]) and p.weight[0, 12, 16] == 2.0


def test_format_and_shapes_are_validated(tmp_path):
    root = write_v2_dataset(tmp_path / "ds", pairs=3)
    manifest = json.loads((root / "manifest.json").read_text())
    manifest["format"] = "blud-upscale-dataset/1"
    (root / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="format"):
        load_dataset(root)
    manifest["format"] = DATASET_FORMAT
    manifest["pairs"][0]["crop"]["w"] = 15
    (root / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="expected float32"):
        load_dataset(root)


def test_paste_fills_outside_with_the_sentinel():
    src = torch.arange(2 * 3 * 4, dtype=torch.float32).view(2, 3, 4)
    out = paste(src, -1, 1, 3, torch.tensor([7.0, 9.0]))
    assert out[:, 0, 0].tolist() == [7.0, 9.0]            # column -1 is outside
    assert out[:, 0, 1].tolist() == src[:, 1, 0].tolist()
    assert out[:, 2, 2].tolist() == [7.0, 9.0]            # row 3 is outside


def test_sampler_shapes_padding_and_determinism(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=4, size=(10, 12)))
    march, target, weight = CropSampler(ds.split("train"), crop=16, seed=3).sample(5)
    assert march.shape == (5, 4, 16, 16) and target.shape == (5, 4, 32, 32) and weight.shape == (5, 1, 32, 32)
    # every pair crop (10x12) is smaller than the window, so every window is padded with the sentinel
    assert bool((march[:, 3] == 1).flatten(1).any(dim=1).all())
    pad = target[:, 3] == 1
    assert bool((target[:, :3].abs().sum(dim=1)[pad] == 0).all())
    assert bool((weight[:, 0][pad] >= 1).all())
    again = CropSampler(ds.split("train"), crop=16, seed=3).sample(5)
    assert torch.equal(again[0], march) and torch.equal(again[1], target)


def test_region_centred_windows_contain_a_region(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=3, size=(40, 48)))
    pairs = ds.split("train")
    sampler = CropSampler(pairs, crop=16, seed=1, region_share=1.0)
    for k in range(len(pairs)):
        for _ in range(10):
            ox, oy = sampler.window(k)
            assert any(ox <= x / 2 < ox + 16 and oy <= y / 2 < oy + 16 for x, y in pairs[k].centres)
