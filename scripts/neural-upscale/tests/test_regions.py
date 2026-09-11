import torch

from nupscale.regions import dilate, disc_mask, region_masks, weight_map


def test_disc_mask_uses_pixel_centres():
    m = disc_mask(4, 4, [(2.0, 2.0, 1.0)])
    assert int(m.sum()) == 4 and bool(m[1:3, 1:3].all())


def test_tiny_circles_still_mark_pixels():
    m = disc_mask(4, 4, [(1.5, 1.5, 0.2)])
    assert bool(m[1, 1]) and int(m.sum()) == 5


def test_dilate_does_not_wrap():
    m = torch.zeros(5, 6, dtype=torch.bool)
    m[2, 0] = True
    d = dilate(m, 2)
    assert bool(d[0:5, 0:3].all()) and int(d.sum()) == 15


def test_edge_band_and_max_weight_rule():
    target_alpha = torch.ones(8, 8)
    target_alpha[2:6, 2:6] = 0.5
    input_alpha = torch.ones(4, 4)
    input_alpha[1:3, 1:3] = 0.5
    masks = region_masks(target_alpha, input_alpha, heads=[(4.0, 4.0, 1.0)], wounds=[])
    flesh = masks["flesh"]
    assert int(flesh.sum()) == 16
    assert torch.equal(masks["edge"] & flesh, flesh)  # a 4x4 block is all within 2 px of background
    assert int(masks["interior"].sum()) == 0
    w = weight_map(masks)
    assert w.shape == (1, 8, 8)
    assert w[0, 3, 3] == 2.0  # face and edge: the max, not the product
    assert w[0, 2, 5] == 1.5  # edge only
    assert w[0, 0, 0] == 1.0  # background


def test_interior_is_flesh_in_no_other_region():
    target_alpha = torch.ones(16, 16)
    target_alpha[2:14, 2:14] = 0.5
    input_alpha = torch.ones(8, 8)
    input_alpha[1:7, 1:7] = 0.5
    masks = region_masks(target_alpha, input_alpha, heads=[], wounds=[(10.5, 10.5, 1.0)])
    assert bool(masks["interior"][7, 7]) and not bool(masks["interior"][3, 3]) and not bool(masks["interior"][10, 10])
    assert torch.equal(masks["interior"] | (masks["edge"] & masks["flesh"]) | masks["wound"], masks["flesh"] | masks["wound"])


def test_input_target_disagreement_is_edge_even_off_flesh():
    target_alpha = torch.ones(8, 8)
    input_alpha = torch.ones(4, 4)
    input_alpha[0, 0] = 0.5
    masks = region_masks(target_alpha, input_alpha, [], [])
    assert bool(masks["edge"][:2, :2].all()) and int(masks["edge"].sum()) == 4
