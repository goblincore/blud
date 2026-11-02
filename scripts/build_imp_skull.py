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
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.scratch/imp-skull'
SOURCE = ROOT / 'assets-source/twinhead-kit/twinhead-kit.blend'
# The source's own frame (twinhead world, Blender, metres): its centre line, and the cut that takes the horns off.
CX = 0.1789
HORN_CUT = lambda co: abs(co.x - CX) > 0.096 and co.z > 2.035
# Scaled toward the human asset's size (113 mm wide); the fit sizes it to the head either way.
SCALE = 0.6
BUDGET = 9900
PIECES = ['frontal', 'parietal-left', 'parietal-right', 'occipital', 'temporal-left', 'temporal-right',
          'zygomatic-left', 'zygomatic-right', 'maxilla-left', 'maxilla-right', 'upper-teeth', 'mandible',
          'cranial-base', 'nasal-core']


def region(c):
    """The piece a face belongs to, by its centre in the source frame. The skull faces -y; its own left is +x."""
    x, y, z = c.x - CX, c.y, c.z
    side = 'left' if x > 0 else 'right'
    if z < 1.995 and y < -0.13: return 'mandible'
    if z < 2.03 and y < -0.21: return 'upper-teeth'
    if abs(x) < 0.022 and 2.03 <= z < 2.085 and y < -0.22: return 'nasal-core'
    if z < 2.075 and y < -0.17: return f'maxilla-{side}'
    if 2.03 <= z < 2.10 and abs(x) > 0.06 and y < -0.12: return f'zygomatic-{side}'
    if z >= 2.095 and y < -0.15: return 'frontal'
    if y > -0.08 and z < 2.17: return 'occipital'
    if z >= 2.10: return f'parietal-{side}'
    if abs(x) > 0.06: return f'temporal-{side}'
    return 'cranial-base'


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
    eyes = [(e - centre) * SCALE for e in eyes]
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
    atlas = bpy.data.images.new('imp-skull-normal', width=1024, height=1024)
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
