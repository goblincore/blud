# Find THIN SHEET regions (wing membrane, ears, fins) on the reference: surface
# points whose local thickness is small AND whose mid-surface neighbourhood is
# planar (2 big PCA axes), as opposed to thin RODS (fingers, claws, wing bones).
# Writes fit/sheets.npz: mid-surface points + thickness.
import sys, numpy as np, igl
from scipy.spatial import cKDTree
Z = np.load(sys.argv[1]); out = sys.argv[2]
V = Z['V'].astype(np.float64); F = Z['F'].astype(np.int64)
rng = np.random.default_rng(3)
pick = rng.choice(len(Z['surf']), 120000, replace=False)
s, n = Z['surf'][pick].astype(np.float64), Z['surf_n'][pick].astype(np.float64)
steps = np.arange(0.002, 0.052, 0.002)
Q = (s[:, None, :] - n[:, None, :] * steps[None, :, None]).reshape(-1, 3)
d = igl.signed_distance(Q, V, F)[0].reshape(len(s), len(steps))
exit_ = (d >= 0)  # back outside -> passed through the sheet
has = exit_.any(1)
t = np.where(has, steps[np.argmax(exit_, 1)], np.inf)
thin = t <= 0.05
mid = s[thin] - n[thin] * (t[thin] / 2)[:, None]; tt = t[thin]
print('thin surface fraction', thin.mean(), 'thin pts', len(mid))
# planar vs rod: PCA of mid points within 25 mm
tree = cKDTree(mid); planar = np.zeros(len(mid), bool)
for i in range(len(mid)):
    nb = tree.query_ball_point(mid[i], 0.045)
    if len(nb) < 12: continue
    X = mid[nb] - mid[nb].mean(0)
    ev = np.sort(np.linalg.eigvalsh(X.T @ X / len(nb)))[::-1]
    planar[i] = ev[1] > 0.25 * ev[0] and ev[2] < 0.15 * ev[1]
print('sheet pts', planar.sum())
np.savez(out, mid=mid[planar].astype(np.float32), t=tt[planar].astype(np.float32))
