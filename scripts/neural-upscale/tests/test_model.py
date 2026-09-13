import pytest
import torch

from nupscale.model import Upscaler, linear_depth
from tests.helpers import random_march, scalar_forward


def test_layer_chain_matches_the_typescript_model():
    m = Upscaler("s8", "rgb")
    assert [(c.in_channels, c.out_channels) for c in m.convs] == [(4, 8), (8, 8), (8, 16)]
    m = Upscaler("s32", "rgbd")
    assert [(c.in_channels, c.out_channels) for c in m.convs] == [(5, 32), (32, 32), (32, 16)]
    assert all(c.padding_mode == "replicate" and c.kernel_size == (3, 3) and c.padding == (1, 1) for c in m.convs)


def test_input_normalization_buffers():
    m = Upscaler("s16", "rgbd")
    assert m.in_scale.dtype == torch.float32
    assert m.in_scale[:4].tolist() == [1.0, 1.0, 1.0, 1.0]
    assert m.in_scale[4].item() == 0.10000000149011612
    assert float(m.in_offset.abs().sum()) == 0.0
    assert Upscaler("s16", "rgb").in_scale.tolist() == [1.0, 1.0, 1.0, 1.0]


def test_unknown_ids_raise():
    with pytest.raises(ValueError, match="model id"):
        Upscaler("s128", "rgb")
    with pytest.raises(ValueError, match="input set"):
        Upscaler("s8", "rgba")


def test_zero_model_is_all_zero():
    m = Upscaler("zero", "rgbd")
    assert all(int(torch.count_nonzero(c.weight.detach())) == 0 and int(torch.count_nonzero(c.bias.detach())) == 0 for c in m.convs)


def test_icnr_last_layer_shares_one_kernel_per_channel():
    last = Upscaler("s16", "rgb", seed=3).convs[-1]
    w = last.weight.detach()
    for c in range(4):
        for s in range(1, 4):
            assert torch.equal(w[c * 4 + s], w[c * 4])
    assert int(torch.count_nonzero(last.bias.detach())) == 0
    assert 0 < float(w.abs().max()) < 0.1


def test_seeded_init_is_deterministic():
    a, b, c = Upscaler("s8", "rgb", seed=5), Upscaler("s8", "rgb", seed=5), Upscaler("s8", "rgb", seed=6)
    assert all(torch.equal(x, y) for x, y in zip(a.state_dict().values(), b.state_dict().values()))
    assert not torch.equal(a.convs[0].weight, c.convs[0].weight)


def test_linear_depth_matches_the_reference_formula():
    near, far = 0.1, 200.0
    d = torch.tensor([0.0, 0.5, 0.999], dtype=torch.float64)
    expect = [near * far / (far - v * (far - near)) for v in d.tolist()]
    assert linear_depth(d, near, far).tolist() == pytest.approx(expect, rel=1e-12)


@pytest.mark.parametrize("inputs", ["rgb", "rgbd"])
def test_forward_matches_the_scalar_typescript_twin(inputs):
    torch.manual_seed(0)
    m = Upscaler("s8", inputs, seed=7).double()
    with torch.no_grad():
        for conv in m.convs:
            conv.bias.uniform_(-0.2, 0.2)
        # Break ICNR's shared kernels so a sub-pixel channel-order mistake cannot hide.
        m.convs[-1].weight.add_(torch.randn_like(m.convs[-1].weight) * 0.1)
    march = random_march(4, 5, seed=11).double()
    got = m(march[None], 0.1, 200.0)[0]
    want = torch.tensor(scalar_forward(m, march, 0.1, 200.0), dtype=torch.float64)
    assert got.shape == (16, 4, 5)
    assert torch.allclose(got, want, rtol=1e-9, atol=1e-9)


def test_rgbn_assembles_hit_masked_normals_after_hit():
    from tests.helpers import random_march
    m = Upscaler("s8", "rgbn")
    march = random_march(6, 8, seed=3)
    nrm = torch.rand((3, 6, 8)) * 2 - 1
    x = m.assemble(torch.cat([march, nrm], dim=0).unsqueeze(0), 0.1, 200.0)[0]
    hit = (march[3] < 1).to(torch.float32)
    assert x.shape[0] == 7
    assert torch.equal(x[4:], nrm * hit)
    assert torch.equal(x[3], hit)
    with pytest.raises(ValueError, match="needs normals"):
        m.assemble(march.unsqueeze(0), 0.1, 200.0)
    d = Upscaler("s8", "rgbdn")
    assert d.in_scale[4].item() == pytest.approx(0.1) and d.in_scale.shape[0] == 8
    assert d.assemble(torch.cat([march, nrm], dim=0).unsqueeze(0), 0.1, 200.0).shape[1] == 8


def test_dilated_ladder_matches_the_scalar_twin_and_reparam_fuses_exactly():
    from nupscale.constants import HIDDEN_DILATIONS
    assert HIDDEN_DILATIONS["t24"] == (1, 2, 1) and HIDDEN_DILATIONS["t16"] == (1, 2, 1)
    march = random_march(7, 9, seed=5)
    m = Upscaler("t16", "rgb", seed=2)
    assert [int(c.dilation[0]) for c in m.convs] == [1, 2, 1, 1]
    torch_out = m(march.unsqueeze(0), 0.1, 200.0)[0]
    ref = torch.tensor(scalar_forward(m, march, 0.1, 200.0), dtype=torch.float32)
    assert torch.allclose(torch_out, ref, atol=1e-4)

    rep = Upscaler("t16", "rgb", seed=3, reparam=True)
    with torch.no_grad():
        for conv in rep.convs[:-1]:
            conv.conv1.weight.normal_(); conv.conv1.bias.normal_()
    x = march.unsqueeze(0)
    fused = rep.fused()
    assert not fused.reparam and all(type(c).__name__ == "Conv2d" for c in fused.convs)
    assert torch.allclose(rep(x, 0.1, 200.0), fused(x, 0.1, 200.0), atol=1e-4)
    assert [int(c.dilation[0]) for c in fused.convs] == [1, 2, 1, 1]


def test_head_starts_as_a_no_op_then_adds_a_covered_only_residual(tmp_path):
    from nupscale.data import load_dataset, CropSampler
    from nupscale.reconstruct import predict, reconstruct
    from tests.helpers import write_v2_dataset
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2, size=(12, 16), normals=True, detail=True))
    march, target, weight, detail = CropSampler(ds.split("train"), crop=8, seed=1, flip_x=0.0, flip_y=0.0).sample_with_detail(3)
    assert detail is not None and detail.shape == (3, 4, 16, 16)
    m = Upscaler("s8", "rgbn", seed=2, head=True)
    plain = reconstruct(march, m(march, 0.1, 200.0)).march()
    assert torch.allclose(predict(m, march, 0.1, 200.0, detail).march(), plain)   # zero-init last head layer
    with torch.no_grad():
        m.head[1].weight.normal_(); m.head[1].bias.fill_(0.2)
    out = predict(m, march, 0.1, 200.0, detail)
    assert not torch.allclose(out.march()[:, :3], plain[:, :3])
    assert bool((out.rgb[~out.covered.expand_as(out.rgb)] == 0).all())
    assert torch.equal(out.depth, reconstruct(march, m(march, 0.1, 200.0)).depth)
    import pytest as _p
    with _p.raises(ValueError, match="detail"):
        predict(m, march, 0.1, 200.0, None)
    fused = Upscaler("s8", "rgbn", seed=2, reparam=True, head=True).fused()
    assert fused.head is not None
