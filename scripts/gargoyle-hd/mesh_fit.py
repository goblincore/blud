# Evaluate a fitted prim set on a grid (block-culled) and marching-cube it to a PLY
# for side-by-side Blender renders with the reference. Usage: mesh_fit.py prims.npz out.ply [h]
import sys, numpy as np, torch
from skimage import measure
sys.argv += []
sp = sys.argv
dev = torch.device('mps')
Z = np.load(sp[1]); out = sp[2]; h = float(sp[3]) if len(sp) > 3 else 0.004
A, B = torch.tensor(Z['A'], device=dev), torch.tensor(Z['B'], device=dev)
rA, rB, bl = torch.tensor(Z['rA'], device=dev), torch.tensor(Z['rB'], device=dev), torch.tensor(Z['blend'], device=dev)
import importlib.util, os
spec = importlib.util.spec_from_file_location('rc', os.path.join(os.path.dirname(__file__), 'sdfops.py'))
ops = importlib.util.module_from_spec(spec); spec.loader.exec_module(ops)
lo = torch.minimum(A, B).min(0).values - 0.05; hi = torch.maximum(A, B).max(0).values + 0.05
n = ((hi - lo) / h).ceil().long() + 1
print('grid', n.tolist())
G = np.full(n.tolist(), 0.05, np.float32)
BS = 32
R = torch.maximum(rA, rB)
for i in range(0, n[0], BS):
    for j in range(0, n[1], BS):
        for k in range(0, n[2], BS):
            ii = torch.arange(i, min(i + BS, n[0]), device=dev); jj = torch.arange(j, min(j + BS, n[1]), device=dev); kk = torch.arange(k, min(k + BS, n[2]), device=dev)
            X = torch.stack(torch.meshgrid(ii, jj, kk, indexing='ij'), -1).float() * h + lo
            shp = X.shape[:3]; P = X.reshape(-1, 3)
            c = P.mean(0); rad = (P - c).norm(dim=-1).max()
            # prims whose capsule bound comes within rad+5cm of the block centre
            ba = B - A; t = (((c - A) * ba).sum(-1) / (ba * ba).sum(-1).clamp_min(1e-10)).clamp(0, 1)
            dc = (c - A - ba * t.unsqueeze(-1)).norm(dim=-1) - R
            sel = (dc < rad + 0.03).nonzero().squeeze(1)
            if len(sel) == 0: continue
            p = P.unsqueeze(1).expand(-1, len(sel), -1)
            D = ops.round_cone(p, A[sel].expand(len(P), -1, -1), B[sel].expand(len(P), -1, -1), rA[sel].expand(len(P), -1), rB[sel].expand(len(P), -1))
            d = ops.smin_fold(D, bl[sel].expand(len(P), -1))
            G[i:i + len(ii), j:j + len(jj), k:k + len(kk)] = d.reshape(shp).cpu().numpy()
v, f, nn, _ = measure.marching_cubes(G, 0.0, spacing=(h, h, h))
v += lo.cpu().numpy()
with open(out, 'w') as fh:
    fh.write(f'ply\nformat ascii 1.0\nelement vertex {len(v)}\nproperty float x\nproperty float y\nproperty float z\nelement face {len(f)}\nproperty list uchar int vertex_indices\nend_header\n')
    np.savetxt(fh, v, fmt='%.5f')
    np.savetxt(fh, np.hstack([np.full((len(f), 1), 3), f[:, ::-1]]), fmt='%d')
print('verts', len(v))
