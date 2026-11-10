"""Read the shipped t16 upscaler's weights and ask: how much of what it does is a plain algorithm?

Data-free probe (the training pairs are not on this machine): synthetic smooth-shaded capsule
bodies with hard silhouettes stand in for march frames. Reported as a proxy, not a benchmark.
"""
import base64, json, sys
import numpy as np

MODEL = sys.argv[1]
rng = np.random.default_rng(7)


def load(path):
    j = json.load(open(path))
    layers = []
    for L in j["layers"]:
        w = np.frombuffer(base64.b64decode(L["weights"]), dtype="<f4").reshape(L["outC"], L["inC"], 3, 3)
        b = np.frombuffer(base64.b64decode(L["bias"]), dtype="<f4")
        layers.append((w.astype(np.float64), b.astype(np.float64), bool(L["relu"]), int(L.get("dilation", 1))))
    return layers, np.array(j["inScale"], dtype=np.float64), np.array(j["inOffset"], dtype=np.float64)


def conv(x, w, b, relu, d):
    # x: H,W,C ; replicate pad ; cross-correlation, PyTorch layout
    H, W, C = x.shape
    xp = np.pad(x, ((d, d), (d, d), (0, 0)), mode="edge")
    out = np.zeros((H, W, w.shape[0])) + b
    for ky in range(3):
        for kx in range(3):
            out += xp[ky * d:ky * d + H, kx * d:kx * d + W, :] @ w[:, :, ky, kx].T
    return np.maximum(out, 0) if relu else out


def net_residual(march, layers, sc, off):
    hit = (march[..., 3] < 1).astype(np.float64)
    x = np.concatenate([march[..., :3] * hit[..., None], hit[..., None]], -1) * sc + off
    for (w, b, relu, d) in layers:
        x = conv(x, w, b, relu, d)
    return x  # H,W,16 : ch = c*4 + i*2 + j


def reconstruct(march, res):
    """upscale-reference.ts reconstructPixel: nearest anchor + residual, coverage = ownHit + res_cov > .5"""
    H, W, _ = march.shape
    out = np.zeros((2 * H, 2 * W, 4))
    hit = march[..., 3] < 1
    mp = np.pad(march, ((1, 1), (1, 1), (0, 0)), mode="edge")
    hp = np.pad(hit, ((1, 1), (1, 1)), mode="edge")
    for i in range(2):
        for j in range(2):
            sy, sx = (1 if i else -1), (1 if j else -1)
            r = np.stack([res[..., c * 4 + i * 2 + j] for c in range(4)], -1)
            cov = (hit.astype(float) + r[..., 3]) > 0.5
            src = np.zeros((H, W, 4)); found = np.zeros((H, W), bool)
            for (dy, dx) in [(0, 0), (0, sx), (sy, 0), (sy, sx)]:
                cand = mp[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
                ch = hp[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
                take = ch & ~found
                src[take] = cand[take]; found |= take
            ok = cov & found
            px = np.zeros((H, W, 4)); px[..., 3] = 1
            px[ok, :3] = np.maximum(0, src[ok, :3] + r[ok, :3]); px[ok, 3] = 0
            out[i::2, j::2] = px
    return out  # alpha 0 = covered (premult rgb below), 1 = miss


# ---------- synthetic "march frames": smooth-union capsule bodies, lit, hard silhouettes ----------
def scene(seed, n=14):
    r = np.random.default_rng(seed)
    caps = []
    for _ in range(n):
        a = r.uniform([40, 40], [760, 560]); ang = r.uniform(0, np.pi); ln = r.uniform(30, 260)
        b = a + ln * np.array([np.cos(ang), np.sin(ang)])
        caps.append((a, b, r.uniform(14, 70), r.uniform(0, 300)))
    L = np.array([r.uniform(-.6, .6), r.uniform(-.8, -.2), 0.7]); L /= np.linalg.norm(L)
    tint = np.array([0.62, 0.50, 0.42]) * r.uniform(0.8, 1.15, 3)
    k = 18.0

    def f(X, Y):
        P = np.stack([X, Y], -1)
        z = np.full(X.shape, -1e9); cover = np.zeros(X.shape, bool)
        for (a, b, rad, z0) in caps:
            ab = b - a
            t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
            s = np.linalg.norm(P - (a + t[..., None] * ab), axis=-1)
            inside = s < rad
            h = z0 + np.sqrt(np.maximum(rad * rad - s * s, 0))
            h = np.where(inside, h, -1e9)
            # smooth max of heights (the smooth-union look where limbs meet)
            m = np.maximum(z, h); d = np.abs(z - h)
            z = np.where(inside & cover, m + np.maximum(k - d, 0) ** 2 / (4 * k), m)
            cover |= inside
        e = 0.5
        zx = (f_h(X + e, Y) - f_h(X - e, Y)) / (2 * e); zy = (f_h(X, Y + e) - f_h(X, Y - e)) / (2 * e)
        N = np.stack([-zx, -zy, np.ones_like(zx)], -1); N /= np.linalg.norm(N, axis=-1, keepdims=True)
        lam = np.clip(N @ L, 0, 1); Hh = L + np.array([0, 0, 1.0]); Hh /= np.linalg.norm(Hh)
        spec = np.clip(N @ Hh, 0, 1) ** 40; rim = (1 - N[..., 2]) ** 3
        col = tint * (0.12 + 0.85 * lam[..., None]) + 0.35 * spec[..., None] + 0.10 * rim[..., None]
        return np.clip(col, 0, 1.5) * cover[..., None], cover

    def f_h(X, Y):
        P = np.stack([X, Y], -1)
        z = np.full(X.shape, -1e9); cover = np.zeros(X.shape, bool)
        for (a, b, rad, z0) in caps:
            ab = b - a
            t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
            s = np.linalg.norm(P - (a + t[..., None] * ab), axis=-1)
            inside = s < rad
            h = np.where(inside, z0 + np.sqrt(np.maximum(rad * rad - s * s, 0)), -1e9)
            m = np.maximum(z, h); d = np.abs(z - h)
            z = np.where(inside & cover, m + np.maximum(k - d, 0) ** 2 / (4 * k), m)
            cover |= inside
        return np.where(cover, z, 0.0)

    return f


def render(f, W, H, step, ss):
    acc = None; cov = None
    for sy in range(ss):
        for sx in range(ss):
            xs = (np.arange(W) + (sx + 0.5) / ss) * step; ys = (np.arange(H) + (sy + 0.5) / ss) * step
            X, Y = np.meshgrid(xs, ys)
            c, m = f(X, Y)
            acc = c if acc is None else acc + c; cov = m.astype(float) if cov is None else cov + m
    return acc / ss ** 2, cov / ss ** 2


def as_march(col, cov):
    m = np.zeros(col.shape[:2] + (4,)); m[..., :3] = col; m[..., 3] = np.where(cov > 0.5, 0.5, 1.0)
    return m


def up_nearest(m):
    return np.repeat(np.repeat(m[..., :3], 2, 0), 2, 1)


def up_kernel(img, kern):
    """separable 2x upsample of H,W,C with a 1D kernel function k(distance in low-res texels)"""
    H, W, C = img.shape
    def axis(a, n, ax):
        out_pos = (np.arange(2 * n) + 0.5) / 2 - 0.5
        base = np.floor(out_pos).astype(int)
        res = 0
        for o in range(-1, 3):
            idx = np.clip(base + o, 0, n - 1); wgt = kern(out_pos - (base + o))
            sl = np.take(a, idx, axis=ax)
            shape = [1, 1, 1]; shape[ax] = -1
            res = res + sl * wgt.reshape(shape)
        return res
    return axis(axis(img, H, 0), W, 1)


def k_lin(d):
    return np.maximum(1 - np.abs(d), 0)


def k_cr(d):
    a = np.abs(d)
    return np.where(a < 1, 1.5 * a ** 3 - 2.5 * a ** 2 + 1, np.where(a < 2, -0.5 * a ** 3 + 2.5 * a ** 2 - 4 * a + 2, 0))


def feats(march, rad=2):
    """per low-res texel: the (2rad+1)^2 x 4 neighbourhood of [rgb*hit, hit], flattened"""
    hit = (march[..., 3] < 1).astype(float)
    x = np.concatenate([march[..., :3] * hit[..., None], hit[..., None]], -1)
    H, W, _ = x.shape
    xp = np.pad(x, ((rad, rad), (rad, rad), (0, 0)), mode="edge")
    cols = [xp[dy:dy + H, dx:dx + W] for dy in range(2 * rad + 1) for dx in range(2 * rad + 1)]
    return np.concatenate(cols, -1).reshape(H * W, -1)


def buckets(march, nang=8):
    """RAISR-style key from the low-res luma+hit gradient: angle bucket x strength bucket"""
    hit = (march[..., 3] < 1).astype(float)
    l = (march[..., :3] * hit[..., None]).mean(-1) + 0.5 * hit
    lp = np.pad(l, 1, mode="edge")
    gx = (lp[1:-1, 2:] - lp[1:-1, :-2]) / 2; gy = (lp[2:, 1:-1] - lp[:-2, 1:-1]) / 2
    # 3x3 structure tensor
    def box(a):
        ap = np.pad(a, 1, mode="edge"); return sum(ap[dy:dy + a.shape[0], dx:dx + a.shape[1]] for dy in range(3) for dx in range(3))
    jxx, jyy, jxy = box(gx * gx), box(gy * gy), box(gx * gy)
    ang = 0.5 * np.arctan2(2 * jxy, jxx - jyy) % np.pi
    lam = 0.5 * (jxx + jyy + np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2))
    s = np.digitize(np.sqrt(lam), [0.02, 0.12])
    a = np.minimum((ang / np.pi * nang).astype(int), nang - 1)
    return (np.where(s == 0, 0, 1 + (s - 1) * nang + a)).reshape(-1), 1 + 2 * nang


layers, sc, off = load(MODEL)
nparam = sum(w.size + b.size for (w, b, _, _) in layers)
print(f"model: {len(layers)} conv layers, {nparam} parameters")

# ---- 1. what do the first-layer filters look like? (reading the weights) ----
w0 = layers[0][0]  # 16,4,3,3
print("\nfirst layer, per filter: [rgb DC gain | rgb energy outside DC | hit-channel DC | hit-channel energy outside DC]")
for o in range(w0.shape[0]):
    rgb = w0[o, :3]; h = w0[o, 3]
    dc = rgb.sum(); ac = np.sqrt(((rgb - rgb.mean(axis=(1, 2), keepdims=True)) ** 2).sum())
    hdc = h.sum(); hac = np.sqrt(((h - h.mean()) ** 2).sum())
    kind = "blur/DC" if abs(dc) > 2 * ac else ("edge/derivative" if ac > 2 * abs(dc) else "mixed")
    print(f"  f{o:02d}  {dc:+6.2f} {ac:5.2f} | {hdc:+6.2f} {hac:5.2f}   {kind}")

# ---- 2. behaviour on synthetic frames ----
train_seeds, test_seeds = range(1, 9), range(101, 107)
def make(seed):
    f = scene(seed)
    lo_c, lo_m = render(f, 400, 300, 2.0, 1)       # the march: one ray per low-res texel
    hi_c, hi_m = render(f, 800, 600, 1.0, 4)       # target: 4x4 supersampled output
    na_c, na_m = render(f, 800, 600, 1.0, 1)       # a native march (one ray per output pixel)
    return as_march(lo_c, lo_m), hi_c, hi_m, na_c * (na_m > .5)[..., None]

def score(pred, tgt, tm, lo):
    err = np.abs(pred - tgt).mean(-1)
    hitlo = np.repeat(np.repeat(lo[..., 3] < 1, 2, 0), 2, 1)
    hp = np.pad(hitlo, 2, mode="edge")
    near = np.zeros_like(hitlo); far = np.ones_like(hitlo)
    for dy in range(5):
        for dx in range(5):
            s = hp[dy:dy + hitlo.shape[0], dx:dx + hitlo.shape[1]]
            near |= s; far &= s
    edge = near & ~far; interior = far
    return err[near].mean(), err[edge].mean(), err[interior].mean()

rows = {}
def add(name, vals):
    rows.setdefault(name, []).append(vals)

# gather training data for the distilled algorithms (targets = the NET's own residual, and the true residual)
Xs, Rnet, Rtrue, Ks = [], [], [], []
for s in train_seeds:
    lo, hi_c, hi_m, _ = make(s)
    res = net_residual(lo, layers, sc, off)
    Xs.append(feats(lo)); Rnet.append(res.reshape(-1, 16)); Ks.append(buckets(lo)[0])
    # true residual over the same nearest anchor the net uses (rgb only; coverage residual from the net)
    anchor = reconstruct(lo, np.zeros_like(res))[..., :3]
    tr = hi_c - anchor
    t16 = np.zeros_like(res)
    for i in range(2):
        for j in range(2):
            for c in range(3):
                t16[..., c * 4 + i * 2 + j] = tr[i::2, j::2, c]
            t16[..., 12 + i * 2 + j] = (hi_m[i::2, j::2] > .5).astype(float) - (lo[..., 3] < 1)
    Rtrue.append(t16.reshape(-1, 16))
X = np.concatenate(Xs); Rn = np.concatenate(Rnet); Rt = np.concatenate(Rtrue); K = np.concatenate(Ks)
X1 = np.concatenate([X, np.ones((len(X), 1))], 1)
nb = buckets(make(1)[0])[1]

def fit(Xm, Y, lam=1e-3):
    A = Xm.T @ Xm + lam * np.eye(Xm.shape[1]); return np.linalg.solve(A, Xm.T @ Y)

W_lin_net = fit(X1, Rn)            # ONE linear filter imitating the net
W_lin_true = fit(X1, Rt)           # ONE linear filter fitted to the truth (the best purely linear upscaler)
W_b_net, W_b_true = [], []
for b in range(nb):
    m = K == b
    if m.sum() < 400:
        W_b_net.append(W_lin_net); W_b_true.append(W_lin_true)
    else:
        W_b_net.append(fit(X1[m], Rn[m])); W_b_true.append(fit(X1[m], Rt[m]))

def apply_b(Xm, Kq, Ws):
    out = np.zeros((len(Xm), 16))
    for b in range(nb):
        m = Kq == b
        if m.any(): out[m] = Xm[m] @ Ws[b]
    return out

lin_expl, b_expl = [], []
for s in test_seeds:
    lo, hi_c, hi_m, native = make(s)
    res = net_residual(lo, layers, sc, off)
    add("nearest (the net's anchor)", score(up_nearest(lo), hi_c, hi_m, lo))
    add("bilinear", score(up_kernel(lo[..., :3], k_lin), hi_c, hi_m, lo))
    add("bicubic (Catmull-Rom)", score(up_kernel(lo[..., :3], k_cr), hi_c, hi_m, lo))
    add("shipped t16 net", score(reconstruct(lo, res)[..., :3], hi_c, hi_m, lo))
    Xq = feats(lo); Xq1 = np.concatenate([Xq, np.ones((len(Xq), 1))], 1); Kq = buckets(lo)[0]
    r_lin = (Xq1 @ W_lin_net).reshape(res.shape); r_b = apply_b(Xq1, Kq, W_b_net).reshape(res.shape)
    add("1 linear 5x5 filter imitating the net", score(reconstruct(lo, r_lin)[..., :3], hi_c, hi_m, lo))
    add("17 bucketed linear filters imitating the net (RAISR-style)", score(reconstruct(lo, r_b)[..., :3], hi_c, hi_m, lo))
    add("1 linear 5x5 filter fitted to truth", score(reconstruct(lo, (Xq1 @ W_lin_true).reshape(res.shape))[..., :3], hi_c, hi_m, lo))
    add("17 bucketed linear filters fitted to truth (RAISR-style)", score(reconstruct(lo, apply_b(Xq1, Kq, W_b_true).reshape(res.shape))[..., :3], hi_c, hi_m, lo))
    add("native march, 1 ray per output pixel (the ceiling)", score(native, hi_c, hi_m, lo))
    v = ((res - res.mean((0, 1))) ** 2).sum()
    lin_expl.append(1 - ((res - r_lin) ** 2).sum() / v); b_expl.append(1 - ((res - r_b) ** 2).sum() / v)

print("\nL1 vs a 4x4-supersampled target, mean over 6 unseen synthetic frames (lower is better)")
print(f"{'method':62s} {'near body':>10s} {'edge band':>10s} {'interior':>10s}")
for k, v in rows.items():
    a = np.mean(v, 0); print(f"{k:62s} {a[0]:10.5f} {a[1]:10.5f} {a[2]:10.5f}")
print(f"\nvariance of the net's residual explained by ONE linear filter: {np.mean(lin_expl):.3f}")
print(f"variance of the net's residual explained by 17 bucketed filters: {np.mean(b_expl):.3f}")
