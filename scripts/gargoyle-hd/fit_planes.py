# Fit the reference's own SYMMETRY PLANES, so repose.py mirrors each region about the plane it is actually
# symmetric about (owner, 2026-11-17: "the mirroring is a bit off, the head looks a little weird"). One global plane
# at x = 0.12 is wrong twice over: the torso's midline is not exactly there, and the head sits turned and offset on
# the neck, so folding it about the body's plane gave a lopsided face.
#
# For each region (a set of skeleton bones, optionally clipped to a slab about the midline): take the surface band
# of the reference grid that the region owns, and find the plane (yaw, roll, x offset) that minimises
# mean |d(mirror(p))| over it — a symmetric shape maps its surface onto itself.
#
# Usage: fit_planes.py grid6.npz planes.json
import json, os, sys, numpy as np
from scipy.ndimage import map_coordinates
from scipy.optimize import minimize
sys.path.insert(0, os.path.dirname(__file__))
os.environ['GHD_NO_PLANES'] = '1'
from skel import BONES, H0, T0, MID  # noqa: E402

G = np.load(sys.argv[1]); d, lo, h = G['d'], G['lo'], float(G['h'])
names = [b[0] for b in BONES]
dist = lambda P: map_coordinates(d, ((P - lo) / h).T, order=1, cval=0.1)

ijk = np.argwhere(np.abs(d) < 0.004); P = ijk * h + lo
ab = T0 - H0
ap = P[:, None] - H0[None]; u = np.clip((ap * ab).sum(-1) / (ab * ab).sum(-1), 0, 1)
own = np.linalg.norm(ap - ab * u[..., None], axis=-1).argmin(1)

def plane(params, centre):
    yaw, roll, off = params
    n = np.array([np.cos(yaw) * np.cos(roll), np.sin(roll), -np.sin(yaw) * np.cos(roll)])
    return n, centre + n * off

def cost(params, Q, centre):
    n, c = plane(params, centre)
    M = Q - 2 * ((Q - c) @ n)[:, None] * n
    return np.abs(dist(M)).mean()

REGIONS = {
    # the trunk core only: arms, wings and legs are posed differently left and right
    'torso': (['pelvis', 'spine', 'chest'], 0.16),
    'head': (['skull'], None),
}
out = {}
for key, (bones, slab) in REGIONS.items():
    m = np.isin(own, [names.index(b) for b in bones])
    Q = P[m]
    if slab: Q = Q[np.abs(Q[:, 0] - MID) < slab]
    Q = Q[np.random.default_rng(0).permutation(len(Q))[:20000]]
    centre = np.array([MID, Q[:, 1].mean(), Q[:, 2].mean()])
    best = min((minimize(cost, x0, args=(Q, centre), method='Nelder-Mead', options={'xatol': 1e-4, 'fatol': 1e-6, 'maxiter': 800})
                for x0 in ([0, 0, 0], [0.15, 0, 0.03], [-0.15, 0, -0.03], [0, 0, 0.08], [0, 0, -0.08])), key=lambda r: r.fun)
    n, c = plane(best.x, centre)
    print(f'{key}: yaw {np.degrees(best.x[0]):+.1f} deg, roll {np.degrees(best.x[1]):+.1f} deg, point {np.round(c, 3)}, '
          f'mismatch {cost([0, 0, 0], Q, centre) * 1000:.1f} -> {best.fun * 1000:.1f} mm  ({len(Q)} pts)')
    out[key] = {'normal': n.tolist(), 'point': c.tolist(), 'mismatch_mm': best.fun * 1000}
json.dump(out, open(sys.argv[2], 'w'), indent=1)
