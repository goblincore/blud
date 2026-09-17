import pytest
import torch

from nupscale.losses import upscale_loss
from nupscale.reconstruct import reconstruct
from tests.helpers import random_march, upsample_nearest


def test_zero_residual_on_a_nearest_target_has_zero_loss():
    march = random_march(6, 8, seed=2)[None]
    rec = reconstruct(march, torch.zeros(1, 16, 6, 8))
    total, parts = upscale_loss(rec, upsample_nearest(march), torch.ones(1, 1, 12, 16))
    assert float(total) == 0.0 and all(float(v) == 0.0 for v in parts.values())


def test_colour_ignores_background_and_uses_log1p():
    march = random_march(6, 8, seed=2)[None]
    rec = reconstruct(march, torch.zeros(1, 16, 6, 8))
    ones = torch.ones(1, 1, 12, 16)
    target = upsample_nearest(march).clone()
    background = target[:, 3:4] >= 1
    target[:, :3] = torch.where(background, torch.full_like(target[:, :3], 50.0), target[:, :3])
    assert float(upscale_loss(rec, target, ones)[1]["colour"]) == 0.0
    up = upsample_nearest(march)
    flesh = up[:, 3:4] < 1
    brighter = up.clone()
    brighter[:, :3] += flesh.float()
    expect = (torch.log1p(up[:, :3] + 1) - torch.log1p(up[:, :3])).expand(1, 3, 12, 16)[flesh.expand(1, 3, 12, 16)].mean()
    assert float(upscale_loss(rec, brighter, ones)[1]["colour"]) == pytest.approx(float(expect), rel=1e-5)


def _one_texel_case():
    march = torch.tensor([0.5, 0.5, 0.5, 0.5]).view(1, 4, 1, 1)
    target = torch.tensor([0.0, 0.0, 0.0, 1.0]).view(1, 4, 1, 1).repeat(1, 1, 2, 2)
    target[0, :, 0, 0] = torch.tensor([0.5, 0.5, 0.5, 0.5])  # only output (0, 0) is flesh
    last = torch.zeros(1, 16, 1, 1)
    last[0, 13] = -0.6  # (0, 1): margin -0.1 on background -> hinge 0.15
    last[0, 14] = -1.0  # (1, 0): margin -0.5 on background -> 0
    # (0, 0): margin +0.5 on flesh -> 0;  (1, 1): margin +0.5 on background -> 0.75
    return reconstruct(march, last), target


def test_coverage_hinge_uses_the_margin():
    rec, target = _one_texel_case()
    _, parts = upscale_loss(rec, target, torch.ones(1, 1, 2, 2))
    assert float(parts["coverage"]) == pytest.approx((0.15 + 0.75) / 4)
    assert float(parts["colour"]) == 0.0


def test_region_weight_scales_its_pixel():
    rec, target = _one_texel_case()
    weight = torch.ones(1, 1, 2, 2)
    weight[0, 0, 1, 1] = 2.0
    _, parts = upscale_loss(rec, target, weight)
    assert float(parts["coverage"]) == pytest.approx((0.15 + 2 * 0.75) / 5)


def test_gradients_reach_every_residual_channel():
    march = random_march(6, 8, seed=2)[None]
    last = torch.zeros(1, 16, 6, 8, requires_grad=True)
    target = upsample_nearest(march).clone()
    target[:, :3] *= 1.5
    # flip coverage on every third column, so the hinge is active (a zero residual's ±0.5 margins are past it)
    col = target[:, 3:4, :, ::3]
    target[:, 3:4, :, ::3] = torch.where(col < 1, torch.ones_like(col), torch.full_like(col, 0.5))
    total, _ = upscale_loss(reconstruct(march, last), target, torch.ones(1, 1, 12, 16))
    total.backward()
    assert float(last.grad[:, :12].abs().sum()) > 0 and float(last.grad[:, 12:].abs().sum()) > 0
