# Chair kit: joints. exec()'d by ../gorehound-kit/build.py after hound_common.py (whose helpers this kit shares),
# overriding the joint table with chair.blob's rest skeleton (blob coords; refresh from a buildBody dump if the
# skeleton moves). The legs reuse make_legs.py from the gorehound kit: the front limb starts at the sitter's ANKLE
# (`elbow`), so its "knee" cap is his ankle bone gone to bone-metal and everything below is his foot grown into the
# chair's front leg. skin.json is an empty stub: nothing here seats on a probed skin.
J = {
    'hip': (0.210, 0.530, 0.000), 'knee': (0.237, 0.337, 0.079), 'hock': (0.237, 0.138, -0.036), 'toe': (0.237, 0.000, -0.017),
    'shoulder': (0.190, 0.580, 0.417), 'elbow': (0.220, 0.290, 0.344), 'wrist': (0.220, 0.079, 0.405), 'paw': (0.220, 0.016, 0.495),
    'hips': (0.0, 0.530, 0.0), 'lumbar': (0.0, 0.720, 0.010), 'neckBase': (0.0, 1.076, 0.060), 'atlas': (0.0, 1.175, 0.108),
    'crown': (0.0, 1.345, 0.120),
    # the generated head's ellipsoid (centre, semi-axes), from the built body's face prims
    'headC': (0.0, 1.251, 0.114),
}
JV = {k: bv(*v) for k, v in J.items()}
HEAD_R = (0.086, 0.128, 0.099)
# the sitter's forearm in the armrest (chair.blob: x 0.215, y 0.80, z -0.01 .. 0.24, r 0.034) and his fist at its end
ARM_X, ARM_Y, ARM_Z0, ARM_Z1, ARM_R = 0.215, 0.800, -0.010, 0.255, 0.034
HEAVY = {'fore': 1.15, 'hind': 1.2}
WIRE_MATS = ('cable', 'red')
