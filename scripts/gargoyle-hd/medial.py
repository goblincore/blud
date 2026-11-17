# Medial-axis cover spheres for fit.py's init: interior local minima of a grid SDF (grid6.npz: d, lo, h).
# Usage: medial.py grid6.npz medial.npz     -> C [n,3] centres, R [n] radii
import sys, numpy as np
from scipy.ndimage import minimum_filter
G = np.load(sys.argv[1]); d, lo, h = G['d'], G['lo'], float(G['h'])
m = (d < -0.004) & (d <= minimum_filter(d, size=3, mode='nearest'))
ijk = np.argwhere(m)
np.savez(sys.argv[2], C=(ijk * h + lo).astype(np.float32), R=(-d[m]).astype(np.float32))
print('medial spheres', len(ijk))
