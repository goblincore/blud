# Repose the reference into a SYMMETRIC rest pose, in SDF space (gargoyle-hd redo, 2026-11-17).
#
# The Meshy gargoyle is sculpted mid-stride: the right leg trails with its foot up, the right arm is raised, the tail
# curls off to the figure's right and the spine leans sideways. A body fitted to that pose bakes the asymmetry into
# its rest pose, so every animation starts from it. Instead of rigging and skinning the 83k-vertex, non-watertight
# mesh, this works on its distance field:
#
#   1. A skeleton in the reference pose (the emit_blob.py joints, plus wing and tail chains).
#   2. Each bone gets a rigid move T_b: the spine is straightened sideways (its x lean removed), the tail chain is
#      swung onto the midline (each segment's horizontal heading turned to -z, its pitch kept), and everything else
#      inherits its parent's move.
#   3. The reposed field is d(p) = min over bones b of d_mesh(T_b^-1 p), counted only where T_b^-1 p lies in b's
#      OWN region (nearest bone in the reference pose); points no bone claims are outside.
#   4. Symmetry: the field is folded about the midline plane x = MID, keeping the figure's LEFT (+x) half (the
#      hanging arm, the planted leg, the folded wing) and mirroring it.
#
# Outputs (reference engine frame, same as sample_sdf.py / grid6.npz):
#   <out>/samples.npz   surf, surf_n, q, d     (fit.py input)
#   <out>/grid6.npz     d, lo, h               (medial init + bake input)
#   <out>/sym.ply       marching cubes of the grid, for a render check
#
# Usage: repose.py samples.npz grid6.npz outdir
import sys, os, time, numpy as np, torch, igl
from skimage import measure

dev = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
smp, grf, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
sys.path.insert(0, os.path.dirname(__file__))
from skel import MID, J, BONES, NB, H0, T0, R, t  # noqa: E402
Rm = torch.tensor(np.stack([R[b[0]] for b in BONES]), device=dev, dtype=torch.float32)
tm = torch.tensor(np.stack([t[b[0]] for b in BONES]), device=dev, dtype=torch.float32)
Hs = torch.tensor(H0, device=dev, dtype=torch.float32); Ts = torch.tensor(T0, device=dev, dtype=torch.float32)

SLACK = 0.025  # a bone claims points up to this much past its region, so neighbours OVERLAP at a joint (no crack)

def owns(Qs):  # Qs [n, NB, 3]: T_b^-1 p for every bone b -> [n, NB] does b claim its own pre-image?
    ab = Ts - Hs
    ap = Qs[:, :, None, :] - Hs[None, None]                       # [n, NB(pre-image), NB(bone), 3]
    u = ((ap * ab).sum(-1) / (ab * ab).sum(-1)).clamp(0, 1)
    dist = (ap - ab * u[..., None]).norm(dim=-1)                   # [n, NB, NB]
    own = dist.diagonal(dim1=1, dim2=2)                            # bone b's distance to its own pre-image
    return own <= dist.min(2).values + SLACK

Z = np.load(smp); V, F = Z['V'].astype(np.float64), Z['F'].astype(np.int64)
G = np.load(grf); Gd = torch.tensor(G['d'], device=dev)[None, None]; glo = torch.tensor(G['lo'], device=dev, dtype=torch.float32); gh = float(G['h'])
gn = torch.tensor(G['d'].shape, device=dev, dtype=torch.float32)

def coarse(Q):  # trilinear of the reference grid (outside: +0.1)
    u = (Q - glo) / gh; g = (u / (gn - 1)) * 2 - 1
    v = torch.nn.functional.grid_sample(Gd, g[:, [2, 1, 0]].view(1, -1, 1, 1, 3), mode='bilinear', align_corners=True, padding_mode='border').view(-1)
    inside = ((u >= 0) & (u <= gn - 1)).all(1)
    return torch.where(inside, v, torch.full_like(v, 0.1))

def fold(P): return torch.cat([MID + (P[:, :1] - MID).abs(), P[:, 1:]], 1)

def field(P, exact, chunk=40000):
    """Reposed + folded field at rest-pose points P [N,3] (np). exact: igl on the mesh, else trilinear grid."""
    out = np.empty(len(P), np.float32)
    for s in range(0, len(P), chunk):
        Pt = fold(torch.tensor(P[s:s + chunk], device=dev, dtype=torch.float32))
        best = torch.full((len(Pt),), 0.1, device=dev)
        Qs = torch.einsum('bij,nbj->nbi', Rm.transpose(1, 2), Pt[:, None, :] - tm[None])  # [n, NB, 3] T_b^-1 p
        ok = owns(Qs)
        if exact:
            # coarse first: only pairs that could be near the surface go to igl
            dc = coarse(Qs.reshape(-1, 3)).view(len(Pt), NB)
            sel = ok & (dc < 0.05)
            idx = sel.nonzero()
            if len(idx):
                q = Qs[idx[:, 0], idx[:, 1]].cpu().numpy().astype(np.float64)
                de = torch.tensor(igl.signed_distance(q, V, F)[0], device=dev, dtype=torch.float32)
                D = torch.full((len(Pt), NB), 1e9, device=dev); D[idx[:, 0], idx[:, 1]] = de
                D = torch.where(ok & ~sel, dc, D)
            else:
                D = torch.where(ok, dc, torch.full_like(dc, 1e9))
        else:
            D = torch.where(ok, coarse(Qs.reshape(-1, 3)).view(len(Pt), NB), torch.full((len(Pt), NB), 1e9, device=dev))
        m = D.min(1).values
        out[s:s + chunk] = torch.where(m > 1e8, best, m).cpu().numpy()
    return out

t0 = time.time()
# ---- grid (6 mm, the reference grid's lattice, widened to fit the swung tail) ----
lo = G['lo'].copy(); n = np.array(G['d'].shape)
hi = lo + (n - 1) * gh
lo[2] -= 0.30  # the tail now runs straight back
n = np.ceil((hi - lo) / gh).astype(int) + 1
ii, jj, kk = [np.arange(k) for k in n]
Dg = np.full(n, 0.1, np.float32)
for i0 in range(0, n[0], 16):
    X = np.stack(np.meshgrid(ii[i0:i0 + 16], jj, kk, indexing='ij'), -1).reshape(-1, 3) * gh + lo
    dc = field(X, exact=False)
    near = np.abs(dc) < 0.05
    if near.any(): dc[near] = field(X[near], exact=True)
    Dg[i0:i0 + 16] = dc.reshape(-1, n[1], n[2])
    print(f'grid x {i0}/{n[0]} {time.time() - t0:.0f}s', flush=True)
# ---- CLEANUP (owner: "it's a bit messy since it was a converted mesh") ----
from scipy import ndimage as ndi
lab, nl = ndi.label(Dg < 0)
size = ndi.sum(np.ones_like(Dg), lab, index=np.arange(1, nl + 1))
drop = np.isin(lab, 1 + np.nonzero(size < 400)[0])           # floating fragments (< ~0.09 l)
Dg[drop] = np.maximum(Dg[drop], gh)
labo, no = ndi.label(Dg >= 0)                                 # sealed voids: outside pockets that never reach the edge
edge = set(np.unique(np.concatenate([labo[0].ravel(), labo[-1].ravel(), labo[:, 0].ravel(), labo[:, -1].ravel(), labo[:, :, 0].ravel(), labo[:, :, -1].ravel()])))
void = (labo > 0) & ~np.isin(labo, list(edge))
Dg[void] = -gh
Dg = ndi.grey_dilation(ndi.grey_erosion(Dg, size=(3, 3, 3)), size=(3, 3, 3))  # close pinholes and sub-voxel cracks
Dg = ndi.gaussian_filter(Dg, 0.6).astype(np.float32)                          # take the scan noise off
print(f'cleanup: dropped {int((size < 400).sum())} fragments, filled {int(void.sum())} void voxels', flush=True)
np.savez_compressed(f'{out}/grid6.npz', d=Dg, lo=lo, h=gh)
v, f, _, _ = measure.marching_cubes(Dg, 0.0, spacing=(gh,) * 3); v += lo
with open(f'{out}/sym.ply', 'w') as fh:
    fh.write(f'ply\nformat ascii 1.0\nelement vertex {len(v)}\nproperty float x\nproperty float y\nproperty float z\nelement face {len(f)}\nproperty list uchar int vertex_indices\nend_header\n')
    np.savetxt(fh, v, fmt='%.5f'); np.savetxt(fh, np.hstack([np.full((len(f), 1), 3), f[:, ::-1]]), fmt='%d')

# ---- fit samples: surface points from the new grid's isosurface, then jittered queries with exact distances ----
rng = np.random.default_rng(2)
tri = v[f]; area = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
fi = rng.choice(len(f), 400000, p=area / area.sum()); w = rng.dirichlet([1, 1, 1], 400000)
surf = (tri[fi] * w[..., None]).sum(1)
nrm = np.cross(tri[fi, 1] - tri[fi, 0], tri[fi, 2] - tri[fi, 0]); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
P = []
for s, k in [(0.002, 200000), (0.006, 250000), (0.015, 250000), (0.04, 150000)]:
    idx = rng.integers(0, len(surf), k); P.append(surf[idx] + rng.normal(0, s, (k, 3)))
P.append(rng.uniform(v.min(0) - 0.08, v.max(0) + 0.08, (200000, 3)))
Q = np.concatenate(P)
from scipy.ndimage import map_coordinates
d = map_coordinates(Dg, ((Q - lo) / gh).T, order=1, cval=0.1).astype(np.float32)  # the CLEANED field, not raw igl
np.savez_compressed(f'{out}/samples.npz', surf=surf.astype(np.float32), surf_n=nrm.astype(np.float32), q=Q.astype(np.float32), d=d)
print('done', time.time() - t0, 's; inside frac', (d < 0).mean(), 'bbox', v.min(0), v.max(0))
