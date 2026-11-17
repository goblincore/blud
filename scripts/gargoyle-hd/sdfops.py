import torch

def round_cone(p, A, B, r1, r2):
    """iq's exact round cone, batched: p [N,K,3], A/B [N,K,3], r [N,K]."""
    ba = B - A
    l2 = (ba * ba).sum(-1).clamp_min(1e-10)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = p - A
    y = (pa * ba).sum(-1)
    z = y - l2
    xv = pa * l2.unsqueeze(-1) - ba * y.unsqueeze(-1)
    x2 = (xv * xv).sum(-1)
    y2 = y * y * l2
    z2 = z * z * l2
    k = torch.sign(rr) * rr * rr * x2
    s1 = torch.sqrt((x2 + z2).clamp_min(1e-12)) * il2 - r2
    s2 = torch.sqrt((x2 + y2).clamp_min(1e-12)) * il2 - r1
    s3 = (torch.sqrt((x2 * a2 * il2).clamp_min(1e-12)) + y * rr) * il2 - r1
    out = torch.where(torch.sign(z) * a2 * z2 > k, s1, torch.where(torch.sign(y) * a2 * y2 < k, s2, s3))
    # degenerate (one cone swallows the other): fall back to sphere of the bigger end
    deg = a2 <= 1e-9
    sph = torch.minimum((pa * pa).sum(-1).clamp_min(1e-12).sqrt() - r1, ((p - B) ** 2).sum(-1).clamp_min(1e-12).sqrt() - r2)
    return torch.where(deg, sph, out)


def smin_fold(D, Kb):
    """Engine fold: d = smin(d, d_i, kIn_i) in order. kIn = blend*0.5, k = 4*kIn."""
    k = Kb * 2.0
    d = D[:, 0]
    for i in range(1, D.shape[1]):
        a, b, kk = d, D[:, i], k[:, i]
        h = (kk - (a - b).abs()).clamp_min(0) / kk
        d = torch.minimum(a, b) - h * h * kk * 0.25
    return d


