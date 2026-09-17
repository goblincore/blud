from types import SimpleNamespace

import pytest
import torch
import torch.nn.functional as F

from nupscale.constants import CLASSES
from nupscale.data import load_dataset
from nupscale.evaluate import aggregate, beats, g4_pass, pair_errors, predict_bicubic, predict_model, predict_nearest
from nupscale.model import Upscaler
from nupscale.reconstruct import predict
from tests.helpers import random_march, upsample_nearest, write_v2_dataset


def test_nearest_is_the_zero_model(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2))
    p = ds.pairs[0]
    assert torch.equal(predict_nearest(p), predict_model(Upscaler("zero", "rgb"), p, ds.near, ds.far))


def test_bicubic_reproduces_a_constant_and_keeps_nearest_coverage():
    march = random_march(8, 10, seed=5)
    march[:3] = torch.where(march[3] < 1, 0.7, 0.0)
    out = predict_bicubic(SimpleNamespace(inp=march))
    hit = upsample_nearest(march)[3] < 1
    assert torch.equal(out[3] < 1, hit)
    assert torch.allclose(out[:3][:, hit], torch.full_like(out[:3][:, hit], 0.7), atol=1e-6)
    assert bool((out[:3][:, ~hit] == 0).all())


def test_bicubic_on_full_coverage_is_plain_bicubic():
    g = torch.Generator().manual_seed(8)
    march = torch.cat([torch.rand((3, 6, 7), generator=g), torch.full((1, 6, 7), 0.5)])
    ours = predict_bicubic(SimpleNamespace(inp=march), a=-0.75)
    torch_bicubic = F.interpolate(march[None, :3], scale_factor=2, mode="bicubic", align_corners=False)[0]
    assert torch.allclose(ours[:3], torch_bicubic.clamp(min=0), atol=1e-5)


def test_pair_errors_are_zero_for_the_target(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2))
    p = ds.pairs[0]
    m = aggregate([pair_errors(p.target, p)])
    assert m["overall"] == 0.0 and m["coverage_error_rate"] == 0.0 and m["face"] == 0.0
    assert m[f"class:{p.cls}"] == 0.0
    assert all(m[f"class:{c}"] is None for c in CLASSES if c != p.cls)


def test_uncovered_flesh_counts_as_black(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2))
    p = ds.pairs[0]
    pred = torch.zeros_like(p.target)
    pred[3] = 1.0
    m = aggregate([pair_errors(pred, p)])
    flesh = p.masks["flesh"]
    expect = torch.log1p(p.target[:3].clamp(min=0)).mean(dim=0)[flesh].mean()
    assert m["overall"] == pytest.approx(float(expect), rel=1e-5)
    assert m["coverage_error_rate"] == pytest.approx(float(flesh.float().mean()))


def test_aggregate_is_pixel_weighted():
    m = aggregate([{"overall": (1.0, 1)}, {"overall": (3.0, 3)}, {"overall": (0.0, 0)}])
    assert m["overall"] == 1.0 and m["face"] is None


def test_predict_model_refine_modes(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2, size=(12, 16), normals=True, detail=True, refine=True))
    m = Upscaler("s8", "rgbn", seed=2, head=True, head_inputs="detail+refine")
    with torch.no_grad(): m.head[1].weight.normal_(); m.head[1].bias.fill_(0.2)
    p = ds.pairs[0]
    on = predict_model(m, p, 0.1, 200.0, refine_mode="on")
    off = predict_model(m, p, 0.1, 200.0, refine_mode="off")
    no = predict_model(m, p, 0.1, 200.0, refine_mode="normal_only")
    assert not torch.equal(on, off) and not torch.equal(on, no) and not torch.equal(off, no)
    with pytest.raises(ValueError):
        predict_model(m, p, 0.1, 200.0, refine_mode="bogus")
    # 'off' == the same head fed a fully-closed accept gate everywhere: the refine columns
    # contribute nothing beyond that.
    refine_off = p.refine.clone()
    refine_off[7] = 1.0
    expect = predict(m, p.inp.unsqueeze(0), 0.1, 200.0, p.detail.unsqueeze(0), refine_off.unsqueeze(0)).march()[0]
    assert torch.allclose(off, expect)


def test_beats_and_g4():
    bicubic = {"overall": 0.5, "face": 0.5, "wound": 0.5, "edge": 0.5, "class:medium": 0.5, "class:far": 0.5}
    good = {k: 0.4 for k in bicubic}
    assert all(v is True for v in beats(good, bicubic).values()) and g4_pass(good, bicubic)
    assert beats({**good, "wound": None}, bicubic)["wound"] is None
    assert not g4_pass({**good, "wound": None}, bicubic)
    assert not g4_pass({**good, "class:far": 0.6}, bicubic)
