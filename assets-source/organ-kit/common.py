# Organ kit: joints. exec()'d by ../gorehound-kit/build.py after hound_common.py (whose helpers this kit shares:
# on_skin, finish, drop, thicken...), overriding the joint table with organ.blob's rest skeleton (blob coords; refresh
# from `buildBody(compileBlob(...)).bones` if the skeleton moves). The legs reuse make_legs.py from the gorehound kit
# (found by build.py's script search), at its default HEAVY weights. skin.json is the bellows seen from above
# (scripts/organ-skin.ts).
#   Blender -b assets-source/organ-kit/organ-kit.blend --python assets-source/gorehound-kit/build.py -- \
#       make_legs.py make_pipes.py make_head.py make_teeth.py --export --preview .lab-tmp/organ-kit
J = {
    'hip': (0.250, 0.900, 0.000), 'knee': (0.301, 0.613, 0.228), 'hock': (0.301, 0.372, -0.040), 'toe': (0.301, 0.027, 0.021),
    'shoulder': (0.245, 0.799, 0.854), 'elbow': (0.296, 0.512, 0.699), 'wrist': (0.296, 0.197, 0.826), 'paw': (0.296, 0.012, 1.062),
    'pelvis': (0.0, 0.800, 0.0), 'hips': (0.0, 0.900, 0.0), 'withers': (0.0, 1.005, 0.854), 'neckBase': (0.0, 0.937, 1.020),
    'atlas': (0.0, 0.913, 1.158), 'muzzle': (0.0, 0.840, 1.449), 'chin': (0.0, 0.782, 1.406),
}
JV = {k: bv(*v) for k, v in J.items()}
TOE_STYLE = 'paw'
WIRE_MATS = ('red', 'cable')
# Looks this kit needs beyond the gibbet .blend's (kit-overlay.ts LOOK picks the finish by material NAME).
for _name, _c in (('void', (0.012, 0.004, 0.004)), ('tooth', (0.78, 0.72, 0.58))):
    _m = bpy.data.materials.get(_name) or bpy.data.materials.new(_name)
    _m.use_fake_user = True; _m.diffuse_color = (*_c, 1.0)
