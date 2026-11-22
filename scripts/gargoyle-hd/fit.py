# Fit N round-cone primitives (the engine's capsule/r2 prim) folded with the
# engine's sequential quadratic smin, to a mesh's SDF samples.
#
# Usage: fit.py samples.npz outdir budgets(csv) [--blend 0.004] [--mirror X]
# Writes outdir/prims-<N>.npz for each budget (A,B,rA,rB,blend), in fold order.
# --mirror X: a SYMMETRIC fit about the plane x = X (repose.py's folded field). Only the +x half's prims are free; each
# is evaluated together with its mirror copy, the samples are cut to x >= X - 3 cm, and N counts the free half (the
# body has 2N prims). The saved npz holds the half; emit_blob.py writes each one with `mirror`.
import sys, time, math, json, numpy as np, torch

dev = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
args = sys.argv[1:]
samples, outdir, budgets = args[0], args[1], [int(x) for x in args[2].split(',')]
BLEND = float(args[args.index('--blend') + 1]) if '--blend' in args else 0.004
MIRROR = float(args[args.index('--mirror') + 1]) if '--mirror' in args else None
ITERS = int(args[args.index('--iters') + 1]) if '--iters' in args else 1500
K_NEI = 24
TAU = 0.03          # clamp distance: only the near-surface band shapes the fit
RMIN = 0.0025       # 2.5 mm: thinner than this reads as nothing at game range

Z = np.load(samples)
keepS = Z['surf'][:, 0] >= MIRROR - 0.03 if MIRROR is not None else slice(None)
keepQ = Z['q'][:, 0] >= MIRROR - 0.03 if MIRROR is not None else slice(None)
surf = torch.tensor(Z['surf'][keepS], device=dev); surf_n = torch.tensor(Z['surf_n'][keepS], device=dev)
q = torch.tensor(Z['q'][keepQ], device=dev); dq = torch.tensor(Z['d'][keepQ], device=dev)
# all points used for the loss: surface (target 0) + near/volume (target d)
P_all = torch.cat([surf, q]); D_all = torch.cat([torch.zeros(len(surf), device=dev), dq])
W_all = torch.cat([torch.full((len(surf),), 2.0, device=dev), torch.ones(len(q), device=dev)])
print('points', len(P_all), 'device', dev, flush=True)


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


class Prims(torch.nn.Module):
    def __init__(self, A, B, r1, r2, blend):
        super().__init__()
        self.A = torch.nn.Parameter(A); self.B = torch.nn.Parameter(B)
        inv = lambda r: torch.log(torch.expm1((r - RMIN).clamp_min(1e-4) * 200)) / 200
        self.r1 = torch.nn.Parameter(inv(r1)); self.r2 = torch.nn.Parameter(inv(r2))
        self.blend = blend
    def radii(self):
        sp = lambda x: torch.nn.functional.softplus(x * 200) / 200 + RMIN
        return sp(self.r1), sp(self.r2)
    def __len__(self): return self.A.shape[0]
    def full(self):
        """(A, B, r1, r2, blend) of every evaluated prim: the free ones, then (--mirror) their mirror copies."""
        r1, r2 = self.radii()
        if MIRROR is None: return self.A, self.B, r1, r2, self.blend
        mir = lambda X: torch.cat([2 * MIRROR - X[:, :1], X[:, 1:]], 1)
        return (torch.cat([self.A, mir(self.A)]), torch.cat([self.B, mir(self.B)]), torch.cat([r1, r1]),
                torch.cat([r2, r2]), torch.cat([self.blend, self.blend]))


def bound_dist(P, m, chunk=40000):
    """capsule-with-max-radius distance from every point to every prim, top-K nearest (sorted by prim index = fold order)."""
    A, B, r1, r2, _ = m.full()
    A, B, R = A.detach(), B.detach(), torch.maximum(r1, r2).detach()
    ba = B - A; l2 = (ba * ba).sum(-1).clamp_min(1e-10)
    out = []
    for s in range(0, len(P), chunk):
        p = P[s:s + chunk].unsqueeze(1)
        pa = p - A
        t = ((pa * ba).sum(-1) / l2).clamp(0, 1)
        d = (pa - ba * t.unsqueeze(-1)).norm(dim=-1) - R
        k = min(K_NEI, len(A))
        idx = d.topk(k, largest=False).indices
        out.append(idx.sort(dim=1).values)
    return torch.cat(out)


def field(m, P, idx):
    A, B, r1, r2, bl = m.full()
    p = P.unsqueeze(1).expand(-1, idx.shape[1], -1)
    D = round_cone(p, A[idx], B[idx], r1[idx], r2[idx])
    return smin_fold(D, bl[idx])


def init_medial(n):
    """medial-axis cover spheres (fit/medial.npz, from the 6 mm grid), thinned to ~n
    by a coarser greedy cover so every limb still gets spheres."""
    from scipy.spatial import cKDTree
    M = np.load(samples.replace('samples.npz', 'medial.npz'))
    P, R = M['C'], M['R']
    if MIRROR is not None: P, R = P[P[:, 0] >= MIRROR - 0.005], R[P[:, 0] >= MIRROR - 0.005]
    o = np.argsort(-R); P, R = P[o], R[o]
    def cover(f):
        t = cKDTree(P); cov = np.zeros(len(P), bool); C = []
        for i in range(len(P)):
            if cov[i]: continue
            C.append(i)
            for j in t.query_ball_point(P[i], R[i] * f + 0.004 * (f - 1)): cov[j] = True
        return C
    lo_f, hi_f = 0.0, 12.0
    C = cover(1.0) if n >= len(P) else None
    if C is None:
        for _ in range(18):
            mid = (lo_f + hi_f) / 2; C = cover(mid)
            if len(C) > n: lo_f = mid
            else: hi_f = mid
        C = cover(hi_f)
    C_ = torch.tensor(P[C], device=dev, dtype=torch.float32)
    R_ = torch.tensor(R[C], device=dev, dtype=torch.float32)
    ax = torch.nn.functional.normalize(torch.randn_like(C_), dim=-1) * R_.unsqueeze(-1) * 0.3
    print(f'init {len(C_)} medial spheres, r {R_.min():.4f}..{R_.max():.4f}', flush=True)
    return C_ - ax, C_ + ax, R_, R_


def densify(m, n_add):
    """error-driven: add small cones under the worst UNDER-covered surface samples."""
    with torch.no_grad():
        idx = bound_dist(surf, m)
        f = torch.cat([field(m, surf[s:s + 50000], idx[s:s + 50000]) for s in range(0, len(surf), 50000)])
        err = f  # >0: model surface sits inside the true surface -> material missing
        cand = (err > 0.0015).nonzero().squeeze(1)
        print(f'  surface |f| mean {f.abs().mean()*1000:.2f} mm, p90 {f.abs().quantile(0.9)*1000:.2f} mm, missing>1.5mm {len(cand)/len(surf):.1%}', flush=True)
        if len(cand) == 0: return m
        # pick spread-out worst points (farthest-point-ish via random subset weighted by error)
        w = err[cand].clamp_min(0)
        pick = cand[torch.multinomial(w / w.sum(), min(n_add * 4, len(cand)), replacement=False)]
        pts = surf[pick].cpu().numpy(); nn = surf_n[pick].cpu().numpy(); e = err[pick].cpu().numpy()
        sel = []
        for i in np.argsort(-e):
            if sel and (np.linalg.norm(pts[sel] - pts[i], axis=1) < 0.02).any(): continue
            sel.append(i)
            if len(sel) >= n_add: break
        pts, nn, e = pts[sel], nn[sel], e[sel]
        r = np.clip(e * 1.2, 0.004, 0.02)
        c = pts - nn * r[:, None]
        t = np.cross(nn, np.random.default_rng(0).normal(size=nn.shape)); t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9
        C = torch.tensor(c, device=dev, dtype=torch.float32); T = torch.tensor(t * r[:, None] * 0.5, device=dev, dtype=torch.float32)
        Rr = torch.tensor(r, device=dev, dtype=torch.float32)
        r1, r2 = m.radii()
        A = torch.cat([m.A.detach(), C - T]); B = torch.cat([m.B.detach(), C + T])
        R1 = torch.cat([r1.detach(), Rr]); R2 = torch.cat([r2.detach(), Rr])
        bl = torch.cat([m.blend, torch.full((len(C),), BLEND, device=dev)])
        return Prims(A, B, R1, R2, bl)


def prune(m, P, idx_all):
    """drop prims that are never within 1 mm of the folded surface's winner."""
    with torch.no_grad():
        r1, r2 = m.radii()
        fA, fB, f1, f2, fbl = m.full()
        sub = torch.randperm(len(surf), device=dev)[:150000]
        Ps = surf[sub]; idx = bound_dist(Ps, m)
        p = Ps.unsqueeze(1).expand(-1, idx.shape[1], -1)
        D = round_cone(p, fA[idx], fB[idx], f1[idx], f2[idx])
        f = smin_fold(D, fbl[idx]).unsqueeze(1)
        near = (D - f) < 0.002
        used = torch.zeros(len(m), dtype=torch.bool, device=dev)
        used[idx[near] % len(m)] = True
        keep = used.nonzero().squeeze(1)
        print(f'  prune: {len(m)} -> {len(keep)}', flush=True)
        return Prims(m.A.detach()[keep], m.B.detach()[keep], r1.detach()[keep], r2.detach()[keep], m.blend[keep])


def train(m, iters, lr):
    opt = torch.optim.Adam(m.parameters(), lr=lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, iters, eta_min=lr * 0.05)
    idx_all = None
    BATCH = 60000
    t0 = time.time()
    for it in range(iters):
        if it % 150 == 0:
            with torch.no_grad(): idx_all = bound_dist(P_all, m)
        sel = torch.randint(0, len(P_all), (BATCH,), device=dev)
        P, Dt, W = P_all[sel], D_all[sel], W_all[sel]
        f = field(m, P, idx_all[sel])
        loss = (W * (f.clamp(-TAU, TAU) - Dt.clamp(-TAU, TAU)).abs()).mean()
        # eikonal-free regularisers: keep cones from collapsing to needles or ballooning
        r1, r2 = m.radii()
        reg = 1e-3 * ((m.B - m.A).norm(dim=-1) / (r1 + r2)).clamp_min(8).sub(8).mean()
        opt.zero_grad(); (loss + reg).backward(); opt.step(); sched.step()
        if it % 300 == 0 or it == iters - 1:
            print(f'  it {it:5d} loss {loss.item()*1000:.3f} mm  prims {len(m)}  {time.time()-t0:.0f}s', flush=True)
    return m


def save(m, path):
    r1, r2 = m.radii()
    np.savez(path, A=m.A.detach().cpu().numpy(), B=m.B.detach().cpu().numpy(),
             rA=r1.detach().cpu().numpy(), rB=r2.detach().cpu().numpy(), blend=m.blend.cpu().numpy())


for N in sorted(budgets):
    A, B, R1, R2 = init_medial(int(N * 0.8))
    m = Prims(A, B, R1, R2, torch.full((len(A),), BLEND, device=dev))
    m = train(m, ITERS, 2e-3)
    rounds = 0
    while len(m) < N and rounds < 4:
        m = densify(m, N - len(m))
        m = train(m, ITERS // 2, 1e-3)
        m = prune(m, None, None)
        rounds += 1
    m = train(m, ITERS, 7e-4)
    with torch.no_grad():
        idx = bound_dist(surf, m)
        f = torch.cat([field(m, surf[s:s + 50000], idx[s:s + 50000]) for s in range(0, len(surf), 50000)])
    stats = {'prims': len(m), 'surf_mean_mm': float(f.abs().mean() * 1000), 'surf_p90_mm': float(f.abs().quantile(0.9) * 1000),
             'surf_p99_mm': float(f.abs().quantile(0.99) * 1000)}
    print('BUDGET', N, json.dumps(stats), flush=True)
    save(m, f'{outdir}/prims-{N}.npz')
    json.dump(stats, open(f'{outdir}/stats-{N}.json', 'w'))
