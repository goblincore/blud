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


def test_flips_mirror_input_target_and_weight_together(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2, size=(40, 48)))
    pairs = ds.split("train")
    plain = CropSampler(pairs, crop=16, seed=5, flip_x=0.0, flip_y=0.0).sample(6)
    fx = CropSampler(pairs, crop=16, seed=5, flip_x=1.0, flip_y=0.0).sample(6)
    fy = CropSampler(pairs, crop=16, seed=5, flip_x=0.0, flip_y=1.0, negate_y=(1,)).sample(6)
    # same windows (same rng draws for the window), mirrored along one axis
    assert torch.equal(fx[0], plain[0].flip(3)) and torch.equal(fx[1], plain[1].flip(3)) and torch.equal(fx[2], plain[2].flip(3))
    assert torch.equal(fy[1], plain[1].flip(2)) and torch.equal(fy[2], plain[2].flip(2))
    expect = plain[0].flip(2).clone()
    expect[:, 1] = -expect[:, 1]
    assert torch.equal(fy[0], expect)
    # a mirrored batch is not the plain one (the flip actually happened)
    assert not torch.equal(fx[0], plain[0])


def test_flip_rate_zero_is_the_old_sampler(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2, size=(40, 48)))
    a = CropSampler(ds.split("train"), crop=16, seed=7, flip_x=0.0, flip_y=0.0).sample(4)
    b = CropSampler(ds.split("train"), crop=16, seed=7, flip_x=0.0, flip_y=0.0).sample(4)
    assert torch.equal(a[0], b[0]) and torch.equal(a[1], b[1]) and torch.equal(a[2], b[2])


def test_normals_load_as_channels_4_to_6_and_flip_as_vectors(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2, size=(40, 48), normals=True))
    pairs = ds.split("train")
    assert pairs[0].inp.shape[0] == 7
    hit = pairs[0].inp[3] < 1
    assert bool((pairs[0].inp[4:][:, ~hit] == 0).all())
    assert torch.allclose(pairs[0].inp[4:][:, hit].norm(dim=0), torch.ones(int(hit.sum())), atol=1e-5)
    plain = CropSampler(pairs, crop=16, seed=5, flip_x=0.0, flip_y=0.0).sample(4)
    fx = CropSampler(pairs, crop=16, seed=5, flip_x=1.0, flip_y=0.0).sample(4)
    fy = CropSampler(pairs, crop=16, seed=5, flip_x=0.0, flip_y=1.0).sample(4)
    assert plain[0].shape == (4, 7, 16, 16)
    ex = plain[0].flip(3).clone(); ex[:, 4] = -ex[:, 4]
    ey = plain[0].flip(2).clone(); ey[:, 5] = -ey[:, 5]
    assert torch.equal(fx[0], ex) and torch.equal(fy[0], ey)
    # padding outside the pair is the 7-channel sentinel: depth 1, everything else 0
    pad = plain[0][:, 3] == 1
    assert bool((plain[0][:, 4:].permute(0, 2, 3, 1)[pad] == 0).all())


def test_region_weight_override_reaches_the_weight_map(tmp_path):
    from nupscale.constants import REGION_WEIGHTS
    root = write_v2_dataset(tmp_path / "ds", pairs=2, size=(24, 32))
    base = load_dataset(root)
    boosted = load_dataset(root, weights={**REGION_WEIGHTS, "interior": 2.0})
    p0, p1 = base.pairs[0], boosted.pairs[0]
    interior = p0.masks["interior"] & ~p0.masks["face"] & ~p0.masks["wound"] & ~p0.masks["edge"]
    assert bool(interior.any())
    assert torch.equal(p1.weight[0][interior], p0.weight[0][interior] * 2)


def test_refine_loads_as_8_channels_and_crops_with_the_target(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2, size=(12, 16), normals=True, detail=True, refine=True))
    p = ds.pairs[0]
    assert p.refine is not None and p.refine.shape == (8, 24, 32)
    assert torch.equal(p.refine[7] < 1, p.target[3] < 1)          # accept gate == target flesh in the synthetic set
    march, target, weight, detail, refine = CropSampler(ds.split("train"), crop=8, seed=1, flip_x=1.0, flip_y=0.0).sample_with_extras(2)
    assert refine.shape == (2, 8, 16, 16) and detail.shape == (2, 4, 16, 16)
    assert torch.equal(refine[:, 7] < 1, target[:, 3] < 1)        # flipped together


def test_refine_drop_forces_the_gate_off_on_a_fraction_of_crops(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=3, size=(12, 16), normals=True, detail=True, refine=True))
    s = CropSampler(ds.split("train"), crop=8, seed=1, flip_x=0.0, flip_y=0.0)
    _, _, _, _, r0 = s.sample_with_extras(16, refine_drop=0.0)
    assert (r0[:, 7] < 1).any()                       # gate on somewhere
    _, _, _, _, r1 = s.sample_with_extras(16, refine_drop=1.0)
    assert not (r1[:, 7] < 1).any()                   # every crop's gate forced off
    assert r1.shape == r0.shape and (r1[:, 7] >= 1).all()   # only the gate moves, shapes match
    _, _, _, _, r5 = CropSampler(ds.split("train"), crop=8, seed=1, flip_x=0.0, flip_y=0.0).sample_with_extras(64, refine_drop=0.5)
    off = sum(1 for k in range(64) if not (r5[k, 7] < 1).any())
    assert 16 <= off <= 48                            # ~half, seeded
