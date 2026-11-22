"""Build the imp's exposed skull: the twinhead's demon skull as a 14-piece anatomical skull asset.

Blender -b --factory-startup -P scripts/build_imp_skull.py -- [--skip-bake] [--publish]

The imp's head bone, shot open, draws this asset through the anatomical skull path (anatomical-skull.ts): the same
contract as public/assets/lab/anatomical-skull.glb (14 pieces named as SKULL_PIECES, each a node at its pivot, glTF
metres, +Y up, the face toward +Z, one material with a baked normal atlas, <= 10,000 triangles). The source is the
twinhead kit's sculpted demon skull (assets-source/twinhead-kit/twinhead-kit.blend, skull|demonskull, 28k triangles),
its horns cut off at the temples (the imp's own horns are flesh kit). Unlike the human skull it is ONE sculpt, so the
pieces are regions cut from it: the whole skull is decimated, unwrapped and baked as one, and only then split, so the
pieces meet without cracks. A shot that breaks a piece off shows the inside of the shell (the material is two-sided).
Scratch output (the .blend, previews) goes to .scratch/imp-skull; --publish copies the GLB and manifest to
public/assets/lab/imp-skull.{glb,json}.
"""
import argparse
import json
import math
from pathlib import Path
import shutil
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.scratch/imp-skull'
SOURCE = ROOT / 'assets-source/twinhead-kit/twinhead-kit.blend'
# The source's own frame (twinhead world, Blender, metres): its centre line, and the cut that takes the horns off.
CX = 0.1789
HORN_CUT = lambda co: abs(co.x - CX) > 0.096 and co.z > 2.035
# Scaled toward the human asset's size (113 mm wide); the fit sizes it to the head either way.
SCALE = 0.6
BUDGET = 9900
# How far the cavity bake looks for bone (m, after SCALE): the sockets, the nasal pit and the sutures, not the face.
AO_REACH = 0.06
# THE SNOUT (2026-11-02, owner: the imp's flesh has a long muzzle the skull had none of, so a shot across it could
# leave the muzzle's tip floating). The face below the orbits is drawn forward this far (m, after SCALE) at its
# front, nothing at the skull's middle, and narrowed as it goes: the maxilla, the nasal pit, the teeth and the jaw's
# front ride out into a snout under the hide's.
SNOUT = 0.055
# Barely narrowed at the front, so the kit's upper teeth (assets-source/imp-kit/make_head.py, set on the hide's mouth)
# root on the maxilla across the whole row: at 0.30 the outer ones stood 2 cm off it.
SNOUT_TAPER = 0.10
# THE TOOTH ROW rides out further than the face above it (m), to meet the kit's upper teeth; the pull fades out over
# the 16 mm above ROW_TOP (the row's top, centred and scaled). The whole snout drawn out that far broke the nasal
# bridge through the hide's.
SNOUT_ROW = 0.015
ROW_TOP = -0.012
# And dropped (m): the hide's muzzle slopes down from the brow; level, the snout's bridge broke through its top.
SNOUT_DROP = 0.038
# THE GAPE (2026-11-02, owner: shot open, the skull's teeth and the kit's never met). The hide's mouth hangs open
# (imp.blob's dark slot) and the kit's lower teeth root under it, 4 cm below and ahead of this skull's short shut jaw.
# The mandible (with the teeth on its ridge) swings open about its condyles by JAW_OPEN (radians) and is thrust forward
# by JAW_THRUST (m, after SCALE), before the snout draws the face out, so the kit's lower row stands on its front. It
# is narrowed to JAW_WIDTH round the centre line: full width, its sides broke the hide at the mouth's corners.
JAW_OPEN = 0.85
JAW_THRUST = 0.035
JAW_WIDTH = 0.75
PIECES = ['frontal', 'parietal-left', 'parietal-right', 'occipital', 'temporal-left', 'temporal-right',
          'zygomatic-left', 'zygomatic-right', 'maxilla-left', 'maxilla-right', 'upper-teeth', 'mandible',
          'cranial-base', 'nasal-core']


def region(c):
    """The piece a face belongs to, by its centre in the source frame. The skull faces -y; its own left is +x."""
    x, y, z = c.x - CX, c.y, c.z
    side = 'left' if x > 0 else 'right'
    if z < 1.995 and y < -0.13: return 'mandible'
    # The jaw's own teeth and alveolar ridge, on top of it behind the upper row: they open with it (JAW_OPEN).
    if z < 2.022 and -0.222 < y < -0.13: return 'mandible'
    if z < 2.03 and y < -0.21: return 'upper-teeth'
    if abs(x) < 0.022 and 2.03 <= z < 2.085 and y < -0.22: return 'nasal-core'
    if z < 2.075 and y < -0.17: return f'maxilla-{side}'
    if 2.03 <= z < 2.10 and abs(x) > 0.06 and y < -0.12: return f'zygomatic-{side}'
    if z >= 2.095 and y < -0.15: return 'frontal'
    if y > -0.08 and z < 2.17: return 'occipital'
    if z >= 2.10: return f'parietal-{side}'
    if abs(x) > 0.06: return f'temporal-{side}'
    return 'cranial-base'


def smoothstep(a, b, v):
    t = min(1.0, max(0.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)


def snout(co):
    """The point drawn into the snout. Blender frame, centred and scaled: the face is -y, up is +z."""
    ahead, up = -co.y, co.z
    w = smoothstep(0.015, 0.075, ahead) * (1 - smoothstep(-0.005, 0.05, up))
    # The jaw's front starts further back (its chin sits under the orbits' line), so it rides out with the snout.
    w = max(w, smoothstep(-0.03, 0.05, ahead) * (1 - smoothstep(-0.045, -0.02, up)))
    # The tooth row rides further out than the bridge above it (SNOUT_ROW), so the kit's upper teeth root on bone and
    # the nasal bridge stays under the hide.
    row = w * (1 - smoothstep(ROW_TOP - 0.016, ROW_TOP, up))
    return Vector((co.x * (1 - SNOUT_TAPER * w), co.y - SNOUT * w - SNOUT_ROW * row, co.z - SNOUT_DROP * w))


def open_jaw(obj, region_of):
    """Swings the mandible open about its condyles by JAW_OPEN and thrusts it forward by JAW_THRUST; returns the faces'
    regions (some are dropped). The sculpt is one shut mesh, so the mandible is cut free along its border first: a
    vertex shared with the cheek or the teeth, moved with only some of its faces, stretched those faces into streaks
    across the gape. Jaw specks the cut leaves (bone joined to the rest only through the upper face) are dropped: moved
    with the jaw they hung in the air in front of it."""
    mand = PIECES.index('mandible')
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.faces.ensure_lookup_table()
    for f in bm.faces: f.tag = region_of[f.index] == mand
    is_jaw = lambda f: f.tag
    bmesh.ops.split_edges(bm, edges=[e for e in bm.edges if len({is_jaw(f) for f in e.link_faces}) > 1])
    seen, specks = set(), []
    for f in bm.faces:
        if not f.tag or f in seen: continue
        island, stack = [], [f]; seen.add(f)
        while stack:
            g = stack.pop(); island.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.tag and h not in seen: seen.add(h); stack.append(h)
        if len(island) < 40: specks += island
    dropped = set(specks)
    regions = [r for f, r in zip(bm.faces, region_of) if f not in dropped]
    bmesh.ops.delete(bm, geom=specks, context='FACES')
    jaw = [v for v in bm.verts if v.link_faces and all(is_jaw(f) for f in v.link_faces)]
    lo = Vector([min(v.co[i] for v in jaw) for i in range(3)]); hi = Vector([max(v.co[i] for v in jaw) for i in range(3)])
    # The condyles: the top of the jaw's rearmost centimetre (its lowest rear point is the jaw's angle, not the hinge).
    rear = [v.co for v in jaw if v.co.y > hi.y - 0.01]
    top = max(c.z for c in rear)
    cond = [c for c in rear if c.z > top - 0.01]
    hinge = sum(cond, Vector()) / len(cond)
    turn = Matrix.Rotation(JAW_OPEN, 3, 'X')   # the face is -y: a positive turn about +x takes it down
    for v in jaw:
        v.co = hinge + turn @ (v.co - hinge) - Vector((0, JAW_THRUST, 0))
        v.co.x *= JAW_WIDTH
    bm.to_mesh(obj.data); bm.free()
    print('JAW', len(jaw), 'specks', len(specks), 'bounds', tuple(round(c, 3) for c in lo), tuple(round(c, 3) for c in hi),
          'hinge', tuple(round(c, 4) for c in hinge), flush=True)
    return regions


def select(objects, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.context.view_layer.objects.active = active or objects[0]


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def bounds(obj):
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return ([min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)])


def material(name, image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (0.63, 0.57, 0.43, 1)
    bsdf.inputs['Roughness'].default_value = 0.67
    m.use_backface_culling = False
    if image:
        tex = m.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        normal = m.node_tree.nodes.new('ShaderNodeNormalMap')
        m.node_tree.links.new(tex.outputs['Color'], normal.inputs['Color'])
        m.node_tree.links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
        m.node_tree.nodes.active = tex
    return m


def keep_biggest_island(bm):
    bm.verts.ensure_lookup_table()
    seen, islands = set(), []
    for v in bm.verts:
        if v in seen: continue
        stack, island = [v], []
        seen.add(v)
        while stack:
            a = stack.pop(); island.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b not in seen: seen.add(b); stack.append(b)
        islands.append(island)
    biggest = max(islands, key=len)
    bmesh.ops.delete(bm, geom=[v for i in islands if i is not biggest for v in i], context='VERTS')


def preview(pieces, size):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'MATCAP'
    scene.render.resolution_x = scene.render.resolution_y = 700
    d = bpy.data.cameras.new('review-camera'); c = bpy.data.objects.new(d.name, d)
    scene.collection.objects.link(c); scene.camera = c
    d.type = 'ORTHO'; d.ortho_scale = size * 1.25

    def shoot(label, position):
        c.location = position
        c.rotation_euler = (-Vector(position)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(OUT / f'{label}.png')
        bpy.ops.render.render(write_still=True)
    for label, position in [('front', (0, -0.7, 0.02)), ('three-quarter', (0.45, -0.6, 0.15)), ('side', (0.7, 0, 0.03))]:
        shoot(label, position)
    # Exploded, coloured by piece, to check the regions.
    scene.display.shading.light = 'STUDIO'; scene.display.shading.color_type = 'OBJECT'
    original = [o.location.copy() for o in pieces]
    for k, o in enumerate(pieces):
        o.color = ((k * 0.37) % 1, (k * 0.61 + 0.3) % 1, (k * 0.13 + 0.5) % 1, 1)
        direction = o.location.copy()
        if o.name == 'mandible': direction = Vector((0, -0.1, -1))
        if direction.length: o.location += direction.normalized() * size * 0.35
    d.ortho_scale = size * 1.9
    shoot('exploded', (0.45, -0.6, 0.2))
    for o, p in zip(pieces, original): o.location = p
    scene.display.shading.color_type = 'MATERIAL'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--skip-bake', action='store_true')
    parser.add_argument('--publish', action='store_true', help='Copy the finished GLB and manifest into public/assets/lab')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if args.publish and args.skip_bake: parser.error('--publish requires the normal bake')
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    with bpy.data.libraries.load(str(SOURCE)) as (src, dst):
        dst.objects = ['skull|demonskull', 'skull|eyeL', 'skull|eyeR']
    skull, eye_a, eye_b = dst.objects
    for o in dst.objects: scene.collection.objects.link(o); o.data = o.data.copy()
    eyes = [sum((o.matrix_world @ v.co for v in o.data.vertices), Vector()) / len(o.data.vertices) for o in (eye_a, eye_b)]
    # The eyeballs the skull was modelled with: the game seats its eyes where these sat, at their size.
    eye_radius = sum(max((o.matrix_world @ v.co - e).length for v in o.data.vertices) for o, e in zip((eye_a, eye_b), eyes)) / 2
    for o in (eye_a, eye_b): bpy.data.objects.remove(o, do_unlink=True)
    skull.data.transform(skull.matrix_world); skull.matrix_world.identity()
    source_tris = tris(skull)

    # The horns off, down to the temples; the specks their S-curves leave behind with them.
    bm = bmesh.new(); bm.from_mesh(skull.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if HORN_CUT(v.co)], context='VERTS')
    keep_biggest_island(bm)
    # Close the temples where the horns came off (a hole there showed straight into the skull).
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(skull.data); bm.free()
    skull.data.materials.clear()
    for a in [a.name for a in skull.data.attributes if a.name in ('Col', '_glow')]: skull.data.attributes.remove(skull.data.attributes[a])

    # Regions from the source frame, before it is moved: a face attribute every copy keeps.
    region_of = [PIECES.index(region(p.center)) for p in skull.data.polygons]

    # Centre on the skull's box and scale toward the human asset's size.
    lo, hi = bounds(skull)
    centre = Vector([(lo[i] + hi[i]) / 2 for i in range(3)])
    for v in skull.data.vertices: v.co = (v.co - centre) * SCALE
    eyes = [snout((e - centre) * SCALE) for e in eyes]
    region_of = open_jaw(skull, region_of)
    eye_radius *= SCALE
    for v in skull.data.vertices: v.co = snout(v.co)
    size = max(hi[i] - lo[i] for i in range(3)) * SCALE
    attr = skull.data.attributes.new('piece', 'INT', 'FACE')
    for p, r in zip(attr.data, region_of): p.value = r

    high = skull
    high.name = 'high-skull'
    low = high.copy(); low.data = high.data.copy(); scene.collection.objects.link(low); low.name = 'low-skull'
    select([low])
    mod = low.modifiers.new('budget', 'DECIMATE'); mod.ratio = min(1, BUDGET / tris(low))
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod = low.modifiers.new('triangulate', 'TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=mod.name)
    low.data.validate(verbose=True)
    for p in low.data.polygons: p.use_smooth = True
    for p in high.data.polygons: p.use_smooth = True
    print('DECIMATED', tris(high), '->', tris(low), flush=True)

    select([low])
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.006)
    bpy.ops.object.mode_set(mode='OBJECT')
    atlas = bpy.data.images.new('imp-skull-normal', width=1024, height=1024, alpha=True)
    atlas.generated_color = (0.5, 0.5, 1, 1)
    atlas.colorspace_settings.name = 'Non-Color'
    mat = material('imp-skull-bone', atlas if not args.skip_bake else None)
    low.data.materials.append(mat)
    high.data.materials.append(material('high'))
    if not args.skip_bake:
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 1
        scene.render.bake.use_selected_to_active = True
        scene.render.bake.use_clear = True
        scene.render.bake.cage_extrusion = 0.003
        scene.render.bake.max_ray_distance = 0.008
        scene.render.bake.margin = 4
        select([high, low], low)
        bpy.ops.object.bake(type='NORMAL')
        # The hollows into the atlas's alpha (1 open bone, 0 deep in a socket): the game darkens and dirties the
        # skull by it (anatomical-skull.wgsl.ts, `grime`). Read off the source mesh like the normals: baked on the low
        # mesh itself, the rays leaving its smooth normals hit the next flat triangle and crackle every face black.
        hollow = bpy.data.images.new('imp-skull-ao', width=1024, height=1024)
        hollow.colorspace_settings.name = 'Non-Color'
        tex = next(n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE')
        tex.image = hollow
        if scene.world is None: scene.world = bpy.data.worlds.new('bake')
        scene.world.light_settings.distance = AO_REACH
        scene.cycles.samples = 128
        select([high, low], low)
        bpy.ops.object.bake(type='AO')
        tex.image = atlas
        px = list(atlas.pixels); ao = hollow.pixels[:]
        px[3::4] = ao[0::4]
        atlas.alpha_mode = 'STRAIGHT'
        atlas.pixels[:] = px
        atlas.filepath_raw = str(OUT / 'normal.png'); atlas.file_format = 'PNG'
        atlas.save(); atlas.pack()
        print('BAKED', flush=True)

    # Split into the pieces, by the face attribute (decimation carries it).
    pieces = []
    for k, name in enumerate(PIECES):
        o = low.copy(); o.data = low.data.copy(); scene.collection.objects.link(o)
        bm = bmesh.new(); bm.from_mesh(o.data)
        layer = bm.faces.layers.int.get('piece')
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[layer] != k], context='FACES')
        bm.to_mesh(o.data); bm.free()
        o.data.attributes.remove(o.data.attributes['piece'])
        assert len(o.data.polygons) > 0, f'empty piece {name}'
        o.name = name; o.data.name = name
        pieces.append(o)
        print('PIECE', name, tris(o), flush=True)
    bpy.data.objects.remove(low, do_unlink=True)

    # glTF frame: (x, y, z) Blender -> (x, z, -y).
    g = lambda v: [v[0], v[2], -v[1]]
    left = max(eyes, key=lambda e: e.x); right = min(eyes, key=lambda e: e.x)
    # The nasal opening: on the centre line under the orbits, at the face (nasal-core's front).
    nasal_piece = next(o for o in pieces if o.name == 'nasal-core')
    nlo, nhi = bounds(nasal_piece)
    nasal = Vector((0, nlo[1] + 0.006, (nlo[2] + nhi[2]) / 2))
    manifest = {'schema': 1,
                'provenance': {'author': 'Blud (twinhead kit demon skull, assets-source/twinhead-kit)', 'license': 'project',
                               'source': 'assets-source/twinhead-kit/twinhead-kit.blend skull|demonskull',
                               'title': 'Imp demon skull'},
                'sourceTriangles': source_tris, 'triangles': sum(tris(o) for o in pieces),
                'normalAtlas': None if args.skip_bake else [1024, 1024],
                'coordinates': 'glTF metres, +Y up, face +Z; orientation verified by preview',
                'openings': {'orbitLeft': g(left), 'orbitRight': g(right), 'nasal': g(nasal)},
                'eyes': {'radius': eye_radius},
                'pieces': []}
    for o in pieces:
        lo, hi = bounds(o)
        pivot = Vector([(lo[i] + hi[i]) / 2 for i in range(3)])
        for v in o.data.vertices: v.co -= pivot
        o.location = pivot
        o['pieceId'] = o.name
        manifest['pieces'].append({'id': o.name, 'triangles': tris(o), 'pivot': g(pivot),
                                   'bounds': {'min': [lo[0], lo[2], -hi[1]], 'max': [hi[0], hi[2], -lo[1]]}})
    assert manifest['triangles'] <= 10000, manifest['triangles']
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    select(pieces)
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'skull.glb'), export_format='GLB', use_selection=True,
                              export_animations=False, export_extras=True, export_yup=True, export_image_format='AUTO')
    col = bpy.data.collections.new('SOURCE - hidden, local reference only')
    scene.collection.children.link(col)
    for c in list(high.users_collection): c.objects.unlink(high)
    col.objects.link(high)
    col.hide_render = True; col.hide_viewport = True
    preview(pieces, size)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'skull.blend'))
    if args.publish:
        shutil.copyfile(OUT / 'skull.glb', ROOT / 'public/assets/lab/imp-skull.glb')
        shutil.copyfile(OUT / 'manifest.json', ROOT / 'public/assets/lab/imp-skull.json')
    print('RESULT', json.dumps({'triangles': manifest['triangles'], 'sourceTriangles': source_tris,
                               'pieces': len(pieces), 'output': str(OUT)}), flush=True)


if __name__ == '__main__':
    main()
