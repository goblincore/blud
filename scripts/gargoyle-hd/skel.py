# The gargoyle-hd skeleton, shared by repose.py and emit_blob.py: joints read off the reference's medial axis
# (reference engine frame: x1.103, feet y 0; L = +x), and the rigid per-bone moves (FK) from that pose to the
# symmetric REST pose. See repose.py for what each move is for.
import numpy as np

MID = 0.12

J = {
    'pelvis0': (0.12, 0.90, 0.40), 'pelvis1': (0.12, 1.02, 0.40),
    'spine': (0.15, 1.16, 0.50), 'chest': (0.16, 1.30, 0.64),
    'neck': (0.20, 1.40, 0.80), 'skull': (0.21, 1.52, 1.00),
    # the tail centreline traced through the reference's interior voxels (geodesic from the root, 6 even stops)
    'tail0': (0.128, 1.002, 0.298), 'tail': (0.02, 0.96, -0.008), 'tail2': (-0.196, 0.798, -0.20),
    'tail3': (-0.346, 0.54, -0.338), 'tail4': (-0.544, 0.432, -0.572), 'tail5': (-0.646, 0.684, -0.722),
    'shoulder.l': (0.38, 1.28, 0.58), 'elbow.l': (0.56, 1.12, 0.46), 'wrist.l': (0.64, 0.92, 0.45), 'hand.l': (0.74, 0.55, 0.45),
    'shoulder.r': (-0.22, 1.28, 0.50), 'elbow.r': (-0.40, 1.16, 0.44), 'wrist.r': (-0.58, 1.00, 0.45), 'hand.r': (-0.78, 0.74, 0.45),
    'hip.l': (0.26, 0.92, 0.44), 'knee.l': (0.255, 0.55, 0.70), 'hock.l': (0.19, 0.15, 0.42), 'toe.l': (0.20, 0.08, 0.66),
    'hip.r': (-0.06, 0.92, 0.44), 'knee.r': (-0.06, 0.52, 0.54), 'hock.r': (-0.13, 0.46, 0.12), 'toe.r': (-0.14, 0.17, 0.08),
    'wroot.l': (0.30, 1.32, 0.48), 'welbow.l': (0.53, 1.47, 0.00), 'wwrist.l': (0.52, 1.66, -0.62),
    'wroot.r': (-0.10, 1.42, 0.42), 'welbow.r': (-0.24, 1.70, 0.18), 'wwrist.r': (-0.53, 1.87, -0.32),
}
J = {k: np.array(v, float) for k, v in J.items()}

# (name, head, tail, parent, mode) — mode: 'flat' removes the x lean, 'mid' swings the heading to -z, None inherits.
BONES = [('pelvis', 'pelvis0', 'pelvis1', None, None),
         ('spine', 'pelvis1', 'spine', 'pelvis', 'flat'), ('chest', 'spine', 'chest', 'spine', 'flat'),
         ('neck', 'chest', 'neck', 'chest', 'flat'), ('skull', 'neck', 'skull', 'neck', 'flat'),
         ('tail1', 'tail0', 'tail', 'pelvis', 'mid'), ('tail2', 'tail', 'tail2', 'tail1', 'mid'),
         ('tail3', 'tail2', 'tail3', 'tail2', 'mid'), ('tail4', 'tail3', 'tail4', 'tail3', 'mid'),
         ('tail5', 'tail4', 'tail5', 'tail4', 'mid')]
for s in 'lr':
    BONES += [(f'clavicle.{s}', 'chest', f'shoulder.{s}', 'chest', None),
              (f'upperarm.{s}', f'shoulder.{s}', f'elbow.{s}', f'clavicle.{s}', None),
              (f'forearm.{s}', f'elbow.{s}', f'wrist.{s}', f'upperarm.{s}', None),
              (f'hand.{s}', f'wrist.{s}', f'hand.{s}', f'forearm.{s}', None),
              (f'thigh.{s}', f'hip.{s}', f'knee.{s}', 'pelvis', None),
              (f'shin.{s}', f'knee.{s}', f'hock.{s}', f'thigh.{s}', None),
              (f'foot.{s}', f'hock.{s}', f'toe.{s}', f'shin.{s}', None),
              (f'wing1.{s}', f'wroot.{s}', f'welbow.{s}', 'chest', None),
              (f'wing2.{s}', f'welbow.{s}', f'wwrist.{s}', f'wing1.{s}', None)]
NB = len(BONES)
H0 = np.array([J[b[1]] for b in BONES]); T0 = np.array([J[b[2]] for b in BONES])

def swing(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v = np.cross(a, b); c = np.dot(a, b)
    if np.linalg.norm(v) < 1e-9: return np.eye(3)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K * (1 / (1 + c))

# SYMMETRY PLANES (fit_planes.py -> planes.json): the trunk is turned and shifted so ITS plane is x = MID before
# anything else moves, and the skull gets its own plane (the head sits turned on the neck). Without the file (or
# under GHD_NO_PLANES, which fit_planes.py itself sets) every region folds about x = MID as before.
import json, os
_pf = os.path.join(os.path.dirname(__file__), 'planes.json')
PLANES = json.load(open(_pf)) if os.path.exists(_pf) and not os.environ.get('GHD_NO_PLANES') else {}
X = np.array([1.0, 0.0, 0.0])

# FK: T_b(p) = R_b p + t_b  (reference pose -> rest pose)
R = {}; t = {}
if 'torso' in PLANES:
    n0, c0 = np.array(PLANES['torso']['normal']), np.array(PLANES['torso']['point'])
    R0 = swing(n0 if n0[0] > 0 else -n0, X)
    t0 = np.array([MID, c0[1], c0[2]]) - R0 @ c0  # the plane's point lands on x = MID
else:
    R0, t0 = np.eye(3), np.zeros(3)
for i, (n, h, tl, par, mode) in enumerate(BONES):
    Rp, tp = (R[par], t[par]) if par else (R0, t0)
    newH = Rp @ J[h] + tp
    d0 = J[tl] - J[h]; dp = Rp @ d0
    if n == 'skull' and 'head' in PLANES:
        nh = Rp @ np.array(PLANES['head']['normal']); nh = nh if nh[0] > 0 else -nh
        Rb = swing(nh, X) @ Rp
        c = newH + Rb @ (np.array(PLANES['head']['point']) - J[h])
        R[n] = Rb; t[n] = newH - Rb @ J[h] + np.array([MID - c[0], 0.0, 0.0])  # slide the head onto the midline
        continue
    if n.startswith('thigh.'):
        # The legs keep their own orientation and only follow the hip: the trunk's ~9 deg roll would otherwise tilt
        # the planted leg and slide the foot 15 cm sideways.
        # SPLAY (owner: "the feet got merged together"): the planted foot's inner toes reach 6 cm past the midline, so
        # the fold overlapped them with their own mirror. 7 deg of abduction at the hip moves the foot ~10 cm out.
        a = np.radians(7.0)
        Rz = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
        R[n] = Rz; t[n] = newH - Rz @ J[h]
        continue
    if mode == 'flat': tgt = np.array([0.0, dp[1], dp[2]])
    elif mode == 'mid': tgt = np.array([0.0, dp[1], -np.hypot(dp[0], dp[2])])
    else: tgt = None
    Rb = (swing(dp, tgt) @ Rp) if tgt is not None else Rp
    R[n] = Rb; t[n] = newH - Rb @ J[h]

# Keep the planted foot ON the floor: the trunk's plane correction and the splay both lift it slightly.
_dy = (R['foot.l'] @ J['toe.l'] + t['foot.l'])[1] - J['toe.l'][1]
for _b in t: t[_b] = t[_b] - np.array([0.0, _dy, 0.0])

def rest(p, bone):
    """A reference-pose point carried by `bone`'s move into the rest pose."""
    return R[bone] @ np.asarray(p, float) + t[bone]
