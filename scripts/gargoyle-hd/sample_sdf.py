# Sample the reference mesh into an SDF point set, in ENGINE frame:
# glTF y-up/+z-front kept, feet moved to y=0, scaled x1.103 (gargoyle.blob convention).
import sys, numpy as np, trimesh, igl
glb, out = sys.argv[1], sys.argv[2]
sc = trimesh.load(glb, force='scene')
m = trimesh.util.concatenate([g for g in sc.dump()])
S = 1.103
V = np.asarray(m.vertices, dtype=np.float64); F = np.asarray(m.faces, dtype=np.int64)
V[:,1] -= V[:,1].min(); V *= S
m = trimesh.Trimesh(V, F, process=True)
print('verts', len(m.vertices), 'faces', len(m.faces), 'watertight', m.is_watertight, 'bbox', m.bounds.tolist())
rng = np.random.default_rng(1)
surf, fi = trimesh.sample.sample_surface_even(m, 400000, seed=1) if hasattr(trimesh.sample,'sample_surface_even') else trimesh.sample.sample_surface(m, 400000)
nrm = m.face_normals[fi]
P = [surf]
for s, n in [(0.002,200000),(0.006,250000),(0.015,250000),(0.04,150000)]:
    idx = rng.integers(0, len(surf), n)
    P.append(surf[idx] + rng.normal(0, s, (n,3)))
lo, hi = m.bounds[0]-0.08, m.bounds[1]+0.08
P.append(rng.uniform(lo, hi, (200000,3)))
Q = np.concatenate(P[1:])
d, _, _ = igl.signed_distance(Q, m.vertices, m.faces, sign_type=igl.SIGNED_DISTANCE_TYPE_FAST_WINDING_NUMBER)[:3] if False else igl.signed_distance(Q, np.asarray(m.vertices), np.asarray(m.faces, dtype=np.int64))[:3]
np.savez_compressed(out, surf=surf.astype(np.float32), surf_n=nrm.astype(np.float32), q=Q.astype(np.float32), d=d.astype(np.float32), V=np.asarray(m.vertices,np.float32), F=np.asarray(m.faces,np.int32))
print('inside frac', (d<0).mean(), 'd range', d.min(), d.max())
