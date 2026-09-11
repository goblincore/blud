import torch

from nupscale.reconstruct import reconstruct
from tests.helpers import random_march, scalar_reconstruct, upsample_nearest


def test_matches_the_scalar_typescript_twin():
    march = random_march(6, 7, seed=3, cover=0.35).double()
    g = torch.Generator().manual_seed(9)
    last = (torch.rand((16, 6, 7), generator=g, dtype=torch.float64) - 0.5) * 1.6
    rec = reconstruct(march[None], last[None])
    want = scalar_reconstruct(march, last)
    assert torch.allclose(rec.march()[0], want, rtol=0, atol=1e-12)
    covered = want[3] < 1
    assert torch.equal(rec.covered[0, 0], covered)
    own_hit = upsample_nearest(march)[3] < 1
    # the case mix is real: some pixels gain coverage off their own texel, some lose it
    assert bool((covered & ~own_hit).any()) and bool((~covered & own_hit).any())


def test_zero_residual_is_nearest():
    march = random_march(5, 6, seed=4)
    rec = reconstruct(march[None], torch.zeros(1, 16, 5, 6))
    up = upsample_nearest(march)
    hit = up[3] < 1
    assert torch.equal(rec.covered[0, 0], hit)
    assert torch.equal(rec.rgb[0], torch.where(hit, up[:3], torch.zeros_like(up[:3])))
    assert torch.equal(rec.depth[0, 0], torch.where(hit, up[3], torch.ones_like(up[3])))
    assert torch.equal(rec.margin[0, 0], hit.float() - 0.5)


def test_source_priority_is_own_horizontal_vertical_diagonal():
    # 2x2 march; texel (x, y): (0,0) and (1,0) miss, (0,1) hits with rgb 1, (1,1) hits with rgb 2.
    march = torch.zeros(1, 4, 2, 2)
    march[0, 3] = torch.tensor([[1.0, 1.0], [0.5, 0.6]])
    march[0, 0] = torch.tensor([[0.0, 0.0], [1.0, 2.0]])
    last = torch.zeros(1, 16, 2, 2)
    last[0, 15, 0, 0] = 1.0  # coverage residual of sub-pixel (i=1, j=1) of texel (0, 0)
    rec = reconstruct(march, last)
    # output (X=1, Y=1) looks right and down: own misses, horizontal misses, vertical hits
    assert rec.covered[0, 0, 1, 1] and rec.rgb[0, 0, 1, 1] == 1.0 and rec.depth[0, 0, 1, 1] == 0.5
    march[0, 3, 1, 0] = 1.0  # the vertical neighbour now misses too: the diagonal is used
    rec = reconstruct(march, last)
    assert rec.covered[0, 0, 1, 1] and rec.rgb[0, 0, 1, 1] == 2.0 and rec.depth[0, 0, 1, 1] == torch.tensor(0.6)
    march[0, 3, 1, 1] = 1.0  # no source at all: never covered, whatever the residual says
    rec = reconstruct(march, last)
    assert not rec.covered[0, 0, 1, 1] and not rec.src_exists[0, 0, 1, 1] and rec.depth[0, 0, 1, 1] == 1.0
