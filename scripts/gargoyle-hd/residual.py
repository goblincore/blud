# Approach C preview: final = prims(x) + residual(x), residual = mesh_sdf - prims_sdf
# stored on a COARSE grid (h_res), clamped to +-CLAMP and only in a narrow band;
# the prim field is evaluated at the fine meshing resolution. Shows how much
# detail a cheap low-res residual layer buys on top of the primitives.
# Usage: residual.py prims.npz grid.npz out.ply [h_fine] [clamp]
import sys, os, numpy as np, torch, importlib.util
from skimage import measure
dev = torch.device('mps')
pr, gridf, out = sys.argv[1], sys.argv[2], sys.argv[3]
h = float(sys.argv[4]) if len(sys.argv) > 4 else 0.004
CLAMP = float(sys.argv[5]) if len(sys.argv) > 5 else 0.025
spec = importlib.util.spec_from_file_location('ops', os.path.join(os.path.dirname(__file__), 'sdfops.py'))
ops = importlib.util.module_from_spec(spec); spec.loader.exec_module(ops)
Z = np.load(pr)
A, B = torch.tensor(Z['A'], device=dev), torch.tensor(Z['B'], device=dev)
rA, rB, bl = torch.tensor(Z['rA'], device=dev), torch.tensor(Z['rB'], device=dev), torch.tensor(Z['blend'], device=dev)
R = torch.maximum(rA, rB)

def prim_field(P):
    """block-culled prim field at points P [N,3] (P assumed compact)."""
    c = P.mean(0); rad = (P - c).norm(dim=-1).max()
    ba = B - A; t = (((c - A) * ba).sum(-1) / (ba * ba).sum(-1).clamp_min(1e-10)).clamp(0, 1)
    dc = (c - A - ba * t.unsqueeze(-1)).norm(dim=-1) - R
    sel = (dc < rad + 0.03).nonzero().squeeze(1)
    if len(sel) == 0: return torch.full((len(P),), 0.05, device=dev)
    p = P.unsqueeze(1).expand(-1, len(sel), -1)
    D = ops.round_cone(p, A[sel].expand(len(P), -1, -1), B[sel].expand(len(P), -1, -1), rA[sel].expand(len(P), -1), rB[sel].expand(len(P), -1))
    return ops.smin_fold(D, bl[sel].expand(len(P), -1))

def grid_eval(lo, n, hh, fn, BS=32):
    G = np.zeros(n, np.float32)
    for i in range(0, n[0], BS):
        for j in range(0, n[1], BS):
            for k in range(0, n[2], BS):
                ii = torch.arange(i, min(i + BS, n[0]), device=dev); jj = torch.arange(j, min(j + BS, n[1]), device=dev); kk = torch.arange(k, min(k + BS, n[2]), device=dev)
                X = torch.stack(torch.meshgrid(ii, jj, kk, indexing='ij'), -1).float() * hh + lo
                G[i:i + len(ii), j:j + len(jj), k:k + len(kk)] = fn(X.reshape(-1, 3)).reshape(X.shape[:3]).cpu().numpy()
    return G

# 1) residual on the coarse mesh-SDF grid
M = np.load(gridf); Dm = M['d']; lo_r = torch.tensor(M['lo'], device=dev, dtype=torch.float32); hr = float(M['h'])
Dp = grid_eval(lo_r, Dm.shape, hr, prim_field)
res = np.clip(Dm - Dp, -CLAMP, CLAMP).astype(np.float32)
band = np.abs(Dm) < 0.04
res[~band] = 0.0
print('residual |r| mean in band (mm)', np.abs(res[band]).mean() * 1000, 'nonzero voxels', band.sum())
resT = torch.tensor(res, device=dev)[None, None]  # [1,1,X,Y,Z]
nr = torch.tensor(Dm.shape, device=dev, dtype=torch.float32)

def full_field(P):
    d = prim_field(P)
    u = (P - lo_r) / hr  # voxel coords
    g = (u / (nr - 1)) * 2 - 1  # grid_sample wants (z,y,x) order in last dim for 5D
    g = g[:, [2, 1, 0]].view(1, -1, 1, 1, 3)
    r = torch.nn.functional.grid_sample(resT, g, mode='bilinear', align_corners=True).view(-1)
    return d + r

lo = lo_r; hi = lo_r + (nr - 1) * hr
n = (((hi - lo) / h).ceil().long() + 1).tolist()
G = grid_eval(lo, n, h, full_field)
v, f, _, _ = measure.marching_cubes(G, 0.0, spacing=(h, h, h))
v += lo.cpu().numpy()
with open(out, 'w') as fh:
    fh.write(f'ply\nformat ascii 1.0\nelement vertex {len(v)}\nproperty float x\nproperty float y\nproperty float z\nelement face {len(f)}\nproperty list uchar int vertex_indices\nend_header\n')
    np.savetxt(fh, v, fmt='%.5f'); np.savetxt(fh, np.hstack([np.full((len(f), 1), 3), f[:, ::-1]]), fmt='%d')
print('verts', len(v))
