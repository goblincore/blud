# Emit src/lab/sdf-zombie/characters/gargoyle-hd.blob from a SYMMETRIC fit (fit.py --mirror, on repose.py's
# field) and the rest-pose skeleton in skel.py.
#
# Usage: emit_blob.py prims-half.npz out.blob      (GHD_EYE=x,y,z overrides the eye centre, shifted frame)
#
# The fit holds only the +x half; every prim is written once and expanded by the engine: `mirror` on a .l/.r bone
# pair, `both` on a centreline bone (its offset reflected across the bone). Frame: the reference engine frame
# (feet y 0, x1.103) shifted by SHIFT so the midline is x = 0 and the root sits at z = 0; bake-residual.ts reads
# the same SHIFT.
import os, sys, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from skel import MID, J, rest  # noqa: E402

SHIFT = np.array([-MID, 0.0, -0.40])

def jr(joint, bone):  # a joint in the rest pose, shifted; centreline joints snapped to x = 0
    p = rest(J[joint], bone) + SHIFT
    if not joint.endswith(('.l', '.r')): p[0] = 0.0
    return p

# The rest skeleton: (name, parent, head, tail) as rest-pose points. Mirrored bones are given on the .l side; the
# engine reflects them in x. Every chain is CONNECTED (head == parent's tail, or a named joint): gait.ts names rig
# points by coincident bone ends, and a nameless point fails makeMotionJoints in the game.
P0, P1 = jr('pelvis0', 'pelvis'), jr('pelvis1', 'pelvis')
CENTRE = [
    ('spine', 'pelvis', P1, jr('spine', 'spine')),
    ('chest', 'spine', jr('spine', 'spine'), jr('chest', 'chest')),
    ('neck', 'chest', jr('chest', 'chest'), jr('neck', 'neck')),
    ('skull', 'neck', jr('neck', 'neck'), jr('skull', 'skull')),
    # THE TAIL is the hem pendulum chain (gait.ts 'hem'/'hem2'/'hem3'): it rides the hips and swings on the rig.
    ('hem', 'pelvis', P1, jr('tail2', 'tail2')),
    ('hem2', 'hem', jr('tail2', 'tail2'), jr('tail4', 'tail4')),
    ('hem3', 'hem2', jr('tail4', 'tail4'), jr('tail5', 'tail5')),
]
CH = jr('chest', 'chest')
SIDE = [
    ('clavicle', 'chest', CH, jr('shoulder.l', 'clavicle.l')),
    ('upperarm', 'clavicle', jr('shoulder.l', 'clavicle.l'), jr('elbow.l', 'upperarm.l')),
    ('forearm', 'upperarm', jr('elbow.l', 'upperarm.l'), jr('wrist.l', 'forearm.l')),
    ('hand', 'forearm', jr('wrist.l', 'forearm.l'), jr('hand.l', 'hand.l')),
    ('thigh', 'pelvis', jr('hip.l', 'thigh.l'), jr('knee.l', 'thigh.l')),
    ('shin', 'thigh', jr('knee.l', 'thigh.l'), jr('hock.l', 'shin.l')),
    ('foot', 'shin', jr('hock.l', 'shin.l'), jr('toe.l', 'foot.l')),
    # WINGS (gait.ts 'wingL'/'wingTipL'): rooted AT the chest joint so the root is a named point, out to the
    # elbow and the wrist spur.
    ('wing1', 'chest', CH, jr('welbow.l', 'wing1.l')),
    ('wing2', 'wing1', jr('welbow.l', 'wing1.l'), jr('wwrist.l', 'wing2.l')),
]
LIMB = {'pelvis': 'torso', 'spine': 'torso', 'chest': 'torso', 'neck': 'head', 'skull': 'head',
        'hem': 'torso', 'hem2': 'torso', 'hem3': 'torso',
        'clavicle': 'arm', 'upperarm': 'arm', 'forearm': 'arm', 'hand': 'arm', 'wing1': 'arm', 'wing2': 'arm',
        'thigh': 'leg', 'shin': 'leg', 'foot': 'leg'}
f3 = lambda v: f'({v[0]:.4f},{v[1]:.4f},{v[2]:.4f})'

bones = {'pelvis': (P0, P1)}
lines = []
for name, parent, H, T in CENTRE:
    bones[name] = (H, T)
    lines.append(f'  bone {name} parent={parent} vec={f3(T - H)} off={f3(H - bones[parent][1])} len={np.linalg.norm(T - H):.4f}')
lines.append('  mirror')
for name, parent, H, T in SIDE:
    pt = bones[parent][1] if parent in bones else bones[f'{parent}.l'][1]
    bones[f'{name}.l'] = (H, T)
    lines.append(f'  bone {name} parent={parent} vec={f3(T - H)} off={f3(H - pt)} len={np.linalg.norm(T - H):.4f}')
lines.append('  end')

# ---- prims (the free half) ----
Z = np.load(sys.argv[1])
A, B = Z['A'] + SHIFT, Z['B'] + SHIFT
rA, rB, bl = Z['rA'], Z['rB'], Z['blend']

def seg_dist(p, a, b):
    ab = b - a; t = np.clip(np.dot(p - a, ab) / max(np.dot(ab, ab), 1e-12), 0, 1)
    return np.linalg.norm(p - (a + ab * t)), t

rows = []
for i in range(len(A)):
    mid = (A[i] + B[i]) / 2
    q = np.array([abs(mid[0]), mid[1], mid[2]])  # a prim just across the midline belongs to the .l side's bones
    bn = min(bones, key=lambda n: seg_dist(q, *bones[n])[0])
    h, tl = bones[bn]
    _, at = seg_dist(A[i], h, tl)
    anchor = h + (tl - h) * at
    base = bn.split('.')[0]
    rows.append((LIMB[base], base, bn.endswith('.l'), at, A[i] - anchor, B[i] - A[i], rA[i], rB[i], bl[i], mid))

# FOLD ORDER = compact spatial runs inside each limb. pack.ts cuts a bound group wherever the run's bounding sphere
# passes GROUP_RADIUS_MAX (0.16 m), so the order decides the group count, and the crowd path holds at most 256 groups a
# body (the tile reference's 8-bit index) and 64 a tile. A Morton walk on a 4 cm lattice jumps at every power-of-two
# seam and gave 288 groups of < 2 prims (perf pass, 2026-11-17). Instead: split each limb's prims recursively along
# their widest axis until a part's bounding sphere (prim extents included) is under LEAF_R, and emit leaf by leaf.
LEAF_R = 0.13
def extent(r):  # bounding sphere of a prim's capsule about its midpoint
    return np.linalg.norm(r[5]) / 2 + max(r[6], r[7])
def bisect(rs):
    if len(rs) <= 1: return [rs]
    M = np.stack([r[9] for r in rs])
    c = M.mean(0)
    if max(np.linalg.norm(r[9] - c) + extent(r) for r in rs) <= LEAF_R and len(rs) <= 48: return [rs]
    ax = int(np.argmax(M.max(0) - M.min(0)))
    o = np.argsort(M[:, ax], kind='stable'); h = len(rs) // 2
    return bisect([rs[i] for i in o[:h]]) + bisect([rs[i] for i in o[h:]])
ordered = []
for lb in ('torso', 'head', 'arm', 'leg'):
    for leaf in bisect([r for r in rows if r[0] == lb]): ordered += leaf
assert len(ordered) == len(rows)
rows = ordered

# `core` (validate.ts clusterCore): each limb's fattest prim near its root joint; torso and head their fattest overall.
ROOT = {'arm': bones['clavicle.l'][1], 'leg': bones['thigh.l'][0], 'head': bones['neck'][0], 'torso': bones['spine'][0]}
core = set()
for lb, jp in ROOT.items():
    idx = [i for i, r in enumerate(rows) if r[0] == lb]
    if not idx: continue
    near = [i for i in idx if np.linalg.norm(rows[i][9] - jp) < 0.18] or idx
    core.add(max(near, key=lambda i: max(rows[i][6], rows[i][7])))
body = []
for ri, (limb, base, sided, at, off, tip, ra, rb, b, _) in enumerate(rows):
    body.append(f'  blob {limb} on {base} at={at:.4f} r={ra:.4f} r2={rb:.4f} blend={b:.4f} '
                f'offset={f3(off)} tip={f3(tip)} {"mirror" if sided else "both"} rigid skinned' + (' core' if ri in core else ''))

# THE EYES (owner request, 2026-11-17): two glowing beads in the sockets, mirrored across the skull.
eyes = ''
if os.environ.get('GHD_EYE'):
    E = np.array([float(x) for x in os.environ['GHD_EYE'].split(',')])
    eh, et = bones['skull']
    _, eat = seg_dist(E, eh, et)
    eanc = eh + (et - eh) * eat
    eyes = (f'\n  blob head on skull at={eat:.4f} r={float(os.environ.get("GHD_EYE_R", "0.011")):.4f} blend=0.003 '
            f'offset={f3(E - eanc)} both rigid color=ff2a10 glow=1')

src = f"""# GENERATED by scripts/gargoyle-hd/emit_blob.py — do not hand-edit; re-run repose, fit and emitter.
#
# Gargoyle HD spike (docs/dev-notes/2026-11-17-gargoyle-hd-spike/notes.md): {2 * len(rows)} round cones FITTED by
# scripts/gargoyle-hd/fit.py --mirror to the Meshy "upscale and enhance" gargoyle, REPOSED into a symmetric rest pose
# (repose.py: spine straightened, tail swung onto the midline, the +x half mirrored), plus a baked mesh-SDF RESIDUAL
# layer (bake-residual.ts) carrying the detail the cones miss. The tail is the hem pendulum chain; the wings have
# their own two-bone chains. Frame: reference x1.103, feet at y 0, shifted by {f3(SHIFT)} so the midline is x = 0.
model gargoyle-hd
  height 2.05

skeleton
  root pelvis at {P0[1]:.4f} len={np.linalg.norm(P1 - P0):.4f}
""" + '\n'.join(lines) + """

body
""" + '\n'.join(body) + eyes + """

sheet
  # No face sheet: the face is the fitted head plus the residual (the gorehound precedent).
  enabled 0

# Face block shrunk to a nub (the gargoyle.blob precedent): the head is fitted prims + residual, not facePrims.
face
  headRadius 0.001
  headWidth  1.0
  headHeight 1.0
  headDepth  1.0
  jawWidth   1.0
  jawHeight  1.0
  jawDrop    0
  jawJut     0
  noseLength 0
  noseWidth  1.0
  noseDrop   0
  browHeavy  0
  browRise   0
  headBlend  0.006
  headRise   0
  headLead   0

palette
  # STONE-FLESH (owner skin pass, 2026-11-17): a warm weathered grey blotched toward moss/soot, a soft leathery normal
  # grain, matte-ish highlight. `grain` (albedo speckle) stays 0: it hashes per cell and read as compression noise at
  # the close range this body is meant to be seen at. Crevices darken through the residual's cavity term.
  baseColor     0.235 0.225 0.215
  deepColor     0.50 0.08 0.08
  charColor     0.09 0.08 0.08
  specIntensity 0.30
  specRoughness 0.55
  fresnelBoost  0.30
  translucency  0.03
  wetness       0.08
  surfaceNoiseAmp    0.05
  silhouetteNoiseAmp 0.0
  mottleAmp     0.60
  mottleScale   1.6
  mottleColor   0.085 0.090 0.075
"""
open(sys.argv[2], 'w').write(src)
from collections import Counter
print('half prims', len(rows), Counter((r[0], r[2]) for r in rows))
