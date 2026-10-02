# Make wiry goblin body variants from goblin.blob: replace the torso, neck, arms and legs; keep the head features,
# the skeleton, the bones pass, the face and the palette. usage: python3 variants.py REPO OUTDIR
import sys, os, re
REPO, OUT = sys.argv[1], sys.argv[2]
src = open(os.path.join(REPO, 'src/lab/sdf-zombie/characters/goblin.blob')).read()
os.makedirs(OUT, exist_ok=True)

lines = src.split('\n')
def drop(pred):
    return [l for l in lines if not pred(l.strip())]
# Lines that are torso/neck/arm/leg prims in the body block (not head features, not the bones pass).
body_start = lines.index('body'); bones_start = next(i for i, l in enumerate(lines) if l.strip() == 'bones')
def is_limb_prim(i, l):
    s = l.strip()
    return body_start < i < bones_start and re.match(r'^(blob|bar)\s+(torso|arm|leg)\s', s) or \
           (body_start < i < bones_start and s.startswith('bar head on neck'))

def spine(s1, c, n, r=0.012):
    """Vertebrae knuckling through the back; offsets put each bead just proud of that variant's own back surface."""
    out = '\n  # Spine: vertebrae knuckling through the back (offsets are world axes; -z is the back).\n'
    for at, z in zip((0.15, 0.55, 0.95), s1): out += f'  blob torso on spine1 at={at:.2f} r={r:.3f} offset=(0,0,{z:.3f}) blend=0.005\n'
    for at, z in zip((0.30, 0.65, 0.98), c): out += f'  blob torso on chest  at={at:.2f} r={r:.3f} offset=(0,0,{z:.3f}) blend=0.005\n'
    out += f'  blob head  on neck   at=0.30 r={r * 0.85:.3f} offset=(0,0,{n:.3f}) blend=0.005\n'
    return out

def ribs(n, r, out):
    """Ribs as raised hoops round the chest's sides: back (near the spine) to front, sloping down, bowed out."""
    s = '\n  # Ribs: one bent prim each side per rib, from the spine round the flank to the front.\n'
    for k in range(n):
        at = 0.15 + k * (0.75 / max(1, n - 1))
        s += f'  blob torso on chest at={at:.2f} r={r:.4f} offset=(0.030,0.000,-0.050) tip=(0.030,-0.040,0.098) bend=({out:.3f},0,0) blend=0.004 both\n'
    return s

VARIANTS = {
'a-sinew': """
  # VARIANT A, SINEW: one continuous taper from hip to collar; no ball joints but the hands.
  bar  torso on pelvis from=0.00 to=1.00 r=0.068 r2=0.078 deep=1.28 blend=0.014
  bar  torso on spine1 from=0.00 to=1.00 r=0.076 r2=0.068 deep=1.20 blend=0.016
  bar  torso on chest  from=0.00 to=0.95 r=0.068 r2=0.056 wide=1.06 deep=1.06 blend=0.016
  bar  head  on neck   from=0.00 to=1.00 r=0.040 r2=0.033 blend=0.010
  # neck cords: collarbone notch up to behind the ear
  blob head on neck at=0.05 r=0.009 r2=0.007 offset=(0.026,0.000,0.018) tip=(-0.012,0.120,-0.030) blend=0.006 both
""" + spine((-0.086, -0.084, -0.080), (-0.068, -0.062, -0.056), -0.036) + """
  blob arm on clavicle at=1.00 r=0.038 blend=0.010 mirror
  bar  arm on upperarm from=0.00 to=1.00 r=0.031 r2=0.024 blend=0.010 mirror
  bar  arm on forearm  from=0.00 to=1.00 r=0.027 r2=0.018 blend=0.010 mirror
  blob arm on hand at=0.55 r=0.046 deep=0.90 blend=0.008 mirror

  bar  leg on thigh from=0.00 to=1.00 r=0.046 r2=0.031 blend=0.014 mirror
  bar  leg on shin  from=0.00 to=1.00 r=0.034 r2=0.021 blend=0.012 mirror
  blob leg on shin  at=1.00 r=0.026 blend=0.008 mirror
  bar  leg on foot  from=0.05 to=0.80 r=0.028 r2=0.024 tall=0.80 blend=0.010 mirror
  blob leg on foot  at=0.92 r=0.034 wide=1.15 tall=0.70 deep=0.95 blend=0.008 mirror
""",
'b-knuckle': """
  # VARIANT B, KNUCKLE: wiry shafts with modest round joints (the early-3D look), ribs, spine, a small pot gut.
  bar  torso on pelvis from=0.00 to=1.00 r=0.064 r2=0.070 deep=1.20 blend=0.012
  blob torso on pelvis at=0.55 r=0.050 offset=(0,-0.012,0.030) wide=1.05 blend=0.016
  bar  torso on spine1 from=0.00 to=1.00 r=0.064 r2=0.068 deep=1.12 blend=0.014
  bar  torso on chest  from=0.00 to=1.00 r=0.070 r2=0.056 wide=1.06 deep=1.08 blend=0.014
  # shoulder blades
  blob torso on chest at=0.60 r=0.030 wide=1.10 tall=1.30 deep=0.40 offset=(0.040,0.000,-0.056) blend=0.006 both
  bar  head  on neck   from=0.00 to=1.00 r=0.036 r2=0.031 blend=0.008
  blob head on neck at=0.05 r=0.008 r2=0.006 offset=(0.024,0.000,0.018) tip=(-0.012,0.120,-0.030) blend=0.005 both
""" + spine((-0.070, -0.072, -0.072), (-0.068, -0.062, -0.054), -0.032) + ribs(4, 0.0075, 0.060) + """
  blob arm on clavicle at=1.00 r=0.045 blend=0.008 mirror
  bar  arm on upperarm from=0.03 to=0.97 r=0.025 r2=0.020 blend=0.007 mirror
  blob arm on forearm  at=0.00 r=0.031 blend=0.006 mirror
  bar  arm on forearm  from=0.04 to=0.96 r=0.025 r2=0.016 blend=0.007 mirror
  blob arm on forearm  at=1.00 r=0.021 blend=0.006 mirror
  blob arm on hand at=0.55 r=0.046 deep=0.90 blend=0.006 mirror

  blob leg on thigh at=0.00 r=0.042 blend=0.008 mirror
  bar  leg on thigh from=0.03 to=0.97 r=0.036 r2=0.025 blend=0.008 mirror
  blob leg on shin  at=0.00 r=0.037 blend=0.007 mirror
  bar  leg on shin  from=0.04 to=0.96 r=0.029 r2=0.018 blend=0.007 mirror
  blob leg on shin  at=1.00 r=0.026 blend=0.006 mirror
  bar  leg on foot  from=0.05 to=0.75 r=0.025 r2=0.021 tall=0.80 blend=0.008 mirror
  blob leg on foot  at=0.88 r=0.020 offset=(0.012,-0.006,0.012) blend=0.005 mirror
  blob leg on foot  at=0.88 r=0.020 offset=(-0.012,-0.006,0.014) blend=0.005 mirror
""",
'c-gnarled': """
  # VARIANT C, GNARLED: skeletal shafts, knobbly joints, a deep keel of a chest over a sunken belly and a pot gut,
  # spurs at the elbows, a hunch of vertebrae.
  bar  torso on pelvis from=0.00 to=1.00 r=0.058 r2=0.056 deep=1.15 blend=0.010
  blob torso on pelvis at=0.45 r=0.056 offset=(0,-0.016,0.034) wide=1.00 tall=0.95 blend=0.014
  bar  torso on spine1 from=0.00 to=1.00 r=0.054 r2=0.066 deep=1.05 blend=0.012
  bar  torso on chest  from=0.00 to=0.92 r=0.074 r2=0.052 wide=1.00 deep=1.16 blend=0.012
  blob torso on chest at=0.40 r=0.020 r2=0.012 offset=(0,0.000,0.070) tip=(0,0.070,0.006) blend=0.006
  blob torso on chest at=0.60 r=0.032 wide=1.15 tall=1.35 deep=0.40 offset=(0.040,0.000,-0.060) blend=0.005 both
  bar  head  on neck   from=0.00 to=1.00 r=0.032 r2=0.029 blend=0.006
  blob head on neck at=0.05 r=0.009 r2=0.006 offset=(0.022,0.000,0.016) tip=(-0.012,0.122,-0.030) blend=0.004 both
""" + spine((-0.056, -0.062, -0.066), (-0.078, -0.068, -0.056), -0.028, r=0.015) + ribs(5, 0.0085, 0.070) + """
  blob arm on clavicle at=1.00 r=0.044 blend=0.004 mirror
  bar  arm on upperarm from=0.04 to=0.96 r=0.021 r2=0.018 blend=0.005 mirror
  blob arm on forearm  at=0.00 r=0.033 blend=0.004 mirror
  blob arm on forearm  at=0.00 r=0.014 r2=0.002 offset=(0,0,-0.020) tip=(0,0.020,-0.030) blend=0.003 mirror
  bar  arm on forearm  from=0.05 to=0.95 r=0.022 r2=0.014 blend=0.005 mirror
  blob arm on forearm  at=1.00 r=0.022 blend=0.004 mirror
  blob arm on hand at=0.55 r=0.046 deep=0.90 blend=0.005 mirror

  blob leg on thigh at=0.00 r=0.044 blend=0.005 mirror
  bar  leg on thigh from=0.05 to=0.95 r=0.031 r2=0.022 blend=0.006 mirror
  blob leg on shin  at=0.00 r=0.041 blend=0.004 mirror
  bar  leg on shin  from=0.05 to=0.95 r=0.025 r2=0.016 blend=0.005 mirror
  blob leg on shin  at=1.00 r=0.027 blend=0.004 mirror
  bar  leg on foot  from=0.05 to=0.72 r=0.023 r2=0.020 tall=0.80 blend=0.006 mirror
  blob leg on foot  at=0.86 r=0.019 offset=(0.014,-0.006,0.014) blend=0.004 mirror
  blob leg on foot  at=0.86 r=0.019 offset=(-0.012,-0.006,0.018) blend=0.004 mirror
  blob leg on foot  at=0.86 r=0.016 offset=(0.034,-0.008,0.000) blend=0.004 mirror
""",
}

for name, block in VARIANTS.items():
    out = []
    inserted = False
    for i, l in enumerate(lines):
        if is_limb_prim(i, l):
            if not inserted:
                out.append(block.rstrip('\n')); inserted = True
            continue
        out.append(l)
    open(os.path.join(OUT, f'goblin-{name}.blob'), 'w').write('\n'.join(out))
    print('wrote', name)
