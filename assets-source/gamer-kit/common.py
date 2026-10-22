# Gamer kit: joints. exec()'d by ../gorehound-kit/build.py after hound_common.py, overriding the joint table with
# gamer.blob's rest skeleton IN COMPILED METRES (the .blob has `scale 1.30`; blender-kit.ts skins to the compiled
# body, so every coordinate in this kit is the compiled one, from a buildBody dump). The legs reuse the gorehound's
# make_legs.py and the back legs' femur carapace is ../chair-kit/make_throne.py's `upper`.
J = {
    'hip': (0.273, 0.689, 0.000), 'knee': (0.308, 0.438, 0.102), 'hock': (0.308, 0.179, -0.047), 'toe': (0.308, 0.000, -0.022),
    'shoulder': (0.247, 0.754, 0.541), 'elbow': (0.287, 0.377, 0.447), 'wrist': (0.287, 0.102, 0.526), 'paw': (0.287, 0.020, 0.643),
    'hips': (0.0, 0.689, 0.0), 'lumbar': (0.0, 0.936, 0.013), 'neckBase': (0.0, 1.399, 0.078), 'atlas': (0.0, 1.523, 0.150),
    # the generated cranium (centre; semi-axes in HEAD_R), from the built body's face prims
    'headC': (0.0, 1.622, 0.153),
}
JV = {k: bv(*v) for k, v in J.items()}
HEAD_R = (0.126, 0.161, 0.134)
# the slung legs' sculpts are the butcher's slim-zombie sizes; at 1.3x they want more weight
HEAVY = {'fore': 1.45, 'hind': 1.5}
WIRE_MATS = ('cable', 'red')
