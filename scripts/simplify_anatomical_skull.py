"""Simplify and bake the anatomical skull; editable source stays in ignored scratch.

Blender -b --factory-startup -P scripts/simplify_anatomical_skull.py --
  --source ~/Downloads/detailed_exploding_skull.glb [--skip-bake] [--publish]

Frame 1 is assembled. Preserve world transforms before deleting the animation.
Each piece is decimated separately, so simplification cannot weld two bones.
The source license/provenance is copied to GLB extras and the manifest.
"""
import argparse
import json
import math
import os
from pathlib import Path
import struct
import shutil
import sys
import time

import bpy
import bmesh
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.scratch/anatomical-skull'
GROUPS = {
    'frontal': (850, ['frontal']),
    'parietal-left': (650, ['left_parietal']),
    'parietal-right': (650, ['right_parietal']),
    'occipital': (800, ['occipital']),
    'temporal-left': (600, ['left_temporal']),
    'temporal-right': (600, ['right_temporal']),
    'zygomatic-left': (350, ['left_zygomatic']),
    'zygomatic-right': (350, ['right_zygomatic']),
    'maxilla-left': (650, ['left_maxilla', 'left_palatine', 'left_lacrimal']),
    'maxilla-right': (650, ['right_max', 'right_palatine', 'right_lacrimal']),
    'upper-teeth': (800, ['teeth']),
    'mandible': (1400, ['mandible', 'lower_teeth']),
    'cranial-base': (1000, ['sphenoid']),
    'nasal-core': (250, ['right_nasal', 'left_nasal', 'vomer', 'ethmoid', 'inferior_conchae']),
}


def select(objects, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active or objects[0]


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def bounds(obj):
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return ([min(p[i] for p in pts) for i in range(3)],
            [max(p[i] for p in pts) for i in range(3)])


def material(name, image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (0.63, 0.57, 0.43, 1)
    bsdf.inputs['Roughness'].default_value = 0.67
    if image:
        tex = m.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        normal = m.node_tree.nodes.new('ShaderNodeNormalMap')
        m.node_tree.links.new(tex.outputs['Color'], normal.inputs['Color'])
        m.node_tree.links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
        m.node_tree.nodes.active = tex
    return m


def camera_at(position, target):
    cam = bpy.context.scene.camera
    cam.location = position
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat('-Z', 'Y').to_euler()


def preview(pieces):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 4
    scene.render.resolution_x = 960
    scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100
    scene.world = bpy.data.worlds.new('studio')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.045, 0.055, 0.07, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.5
    for position, energy, size in [((0.3, -0.4, 0.45), 35, 0.35), ((-0.3, -0.1, 0.15), 12, 0.25), ((0, 0.3, 0.35), 25, 0.25)]:
        d = bpy.data.lights.new('studio-area', 'AREA')
        d.energy, d.shape, d.size = energy * 0.3, 'DISK', size
        o = bpy.data.objects.new(d.name, d)
        scene.collection.objects.link(o)
        o.location = position
        o.rotation_euler = (-o.location).to_track_quat('-Z', 'Y').to_euler()
    d = bpy.data.cameras.new('review-camera')
    c = bpy.data.objects.new(d.name, d)
    scene.collection.objects.link(c)
    scene.camera = c
    d.type = 'ORTHO'
    d.ortho_scale = 0.32
    for label, position in [('front', (0, -0.7, 0.025)), ('three-quarter', (0.4, -0.65, 0.15)), ('side', (0.7, 0, 0.03))]:
        camera_at(position, (0, 0, 0))
        scene.render.filepath = str(OUT / f'{label}.png')
        bpy.ops.render.render(write_still=True)
    original = [o.location.copy() for o in pieces]
    for o in pieces:
        lo, hi = bounds(o)
        direction = Vector([(lo[i]+hi[i])/2 for i in range(3)])
        if o.name == 'mandible':
            direction = Vector((0, -0.1, -1))
        if direction.length:
            o.location += direction.normalized() * 0.055
    d.ortho_scale = 0.48
    camera_at((0.4, -0.65, 0.2), (0, 0, 0))
    scene.render.filepath = str(OUT / 'exploded.png')
    bpy.ops.render.render(write_still=True)
    for o, p in zip(pieces, original):
        o.location = p
    d.ortho_scale = 0.32
    camera_at((0.4, -0.65, 0.15), (0, 0, 0))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--skip-bake', action='store_true')
    parser.add_argument('--publish', action='store_true', help='Copy the finished baked GLB and manifest into public/assets/lab')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    if args.publish and args.skip_bake:
        parser.error('--publish requires the normal bake')
    source = Path(args.source).expanduser().resolve()
    with source.open('rb') as f:
        f.read(12)
        size, _ = struct.unpack('<II', f.read(8))
        gltf = json.loads(f.read(size))
    provenance = gltf['asset'].get('extras', {})
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    scene = bpy.context.scene
    scene.frame_set(1)
    bpy.context.view_layer.update()
    meshes = [o for o in scene.objects if o.type == 'MESH']
    source_tris = sum(tris(o) for o in meshes)
    # Preserve the evaluated assembled transforms, then remove parent animation.
    for o in meshes:
        matrix = o.matrix_world.copy()
        o.parent = None
        o.animation_data_clear()
        o.matrix_world = matrix
        select([o])
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    # Input is centimetres. Recenter around the assembled anatomical envelope.
    bb = [bounds(o) for o in meshes]
    lo = [min(b[0][i] for b in bb) for i in range(3)]
    hi = [max(b[1][i] for b in bb) for i in range(3)]
    centre = Vector([(lo[i]+hi[i])/2 for i in range(3)])
    for o in meshes:
        for v in o.data.vertices:
            v.co = (v.co - centre) * 0.01
    high, low = [], []
    source_groups = {name: [o for o in meshes if o.name.split(':')[0].lower() in tokens]
                     for name, (_, tokens) in GROUPS.items()}
    assert sum(len(v) for v in source_groups.values()) == len(meshes), 'Unassigned input mesh'
    for name, (budget, tokens) in GROUPS.items():
        members = source_groups[name]
        assert members, name
        select(members)
        bpy.ops.object.join()
        h = bpy.context.object
        h.name = 'high-' + name
        h.data.materials.clear()
        h.data.materials.append(material(h.name))
        high.append(h)
        l = h.copy()
        l.data = h.data.copy()
        scene.collection.objects.link(l)
        l.name = name
        select([l])
        bm = bmesh.new()
        bm.from_mesh(l.data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.000001)
        bm.to_mesh(l.data)
        bm.free()
        mod = l.modifiers.new('budget', 'DECIMATE')
        mod.ratio = min(1, budget / tris(l))
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = l.modifiers.new('triangulate', 'TRIANGULATE')
        bpy.ops.object.modifier_apply(modifier=mod.name)
        l.data.validate(verbose=True)
        l.data.update()
        for p in l.data.polygons:
            p.use_smooth = True
        low.append(l)
        print('PIECE', name, tris(h), '->', tris(l), flush=True)
    # A single shared atlas. Multi-object unwrap packs all pieces together.
    select(low)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.006)
    bpy.ops.object.mode_set(mode='OBJECT')
    atlas = bpy.data.images.new('skull-normal', width=1024, height=1024)
    atlas.generated_color = (0.5, 0.5, 1, 1)
    atlas.colorspace_settings.name = 'Non-Color'
    mat = material('anatomical-bone', atlas if not args.skip_bake else None)
    for l in low:
        l.data.materials.clear()
        l.data.materials.append(mat)
    if not args.skip_bake:
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 1
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = 4
        scene.render.bake.use_selected_to_active = True
        scene.render.bake.use_clear = False
        scene.render.bake.cage_extrusion = 0.003
        scene.render.bake.max_ray_distance = 0.006
        scene.render.bake.margin = 4
        for h in high:
            h.hide_render = True
        for h, l in zip(high, low):
            h.hide_render = False
            select([h, l], l)
            bpy.ops.object.bake(type='NORMAL')
            h.hide_render = True
            print('BAKED', l.name, flush=True)
        atlas.filepath_raw = str(OUT / 'normal.png')
        atlas.file_format = 'PNG'
        atlas.save()
        atlas.pack()
    manifest = {'schema': 1, 'provenance': provenance, 'sourceTriangles': source_tris,
                'triangles': sum(tris(o) for o in low), 'normalAtlas': None if args.skip_bake else [1024, 1024],
                'coordinates': 'glTF metres, +Y up; orientation verified by preview', 'pieces': []}
    for o in low:
        lo, hi = bounds(o)
        pivot = Vector([(lo[i]+hi[i])/2 for i in range(3)])
        for v in o.data.vertices:
            v.co -= pivot
        o.location = pivot
        o['pieceId'] = o.name
        o['sourceLicense'] = provenance.get('license', '')
        o['sourceAuthor'] = provenance.get('author', '')
        o['sourceDerived'] = True
        manifest['pieces'].append({'id': o.name, 'triangles': tris(o),
            'pivot': [pivot.x, pivot.z, -pivot.y],
            'bounds': {'min': [lo[0], lo[2], -hi[1]], 'max': [hi[0], hi[2], -lo[1]]}})
    assert manifest['triangles'] <= 10000
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    select(low)
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'skull.glb'), export_format='GLB',
        use_selection=True, export_animations=False, export_extras=True,
        export_yup=True, export_image_format='AUTO')
    # Keep the editable high source in a hidden collection for rebaking.
    col = bpy.data.collections.new('SOURCE - hidden, local reference only')
    scene.collection.children.link(col)
    for h in high:
        for c in list(h.users_collection):
            c.objects.unlink(h)
        col.objects.link(h)
    col.hide_render = True
    col.hide_viewport = True
    preview(low)
    select(low)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'skull.blend'))
    if args.publish:
        shutil.copyfile(OUT / 'skull.glb', ROOT / 'public/assets/lab/anatomical-skull.glb')
        shutil.copyfile(OUT / 'manifest.json', ROOT / 'public/assets/lab/anatomical-skull.json')
    print('RESULT', json.dumps({'triangles':manifest['triangles'], 'sourceTriangles':source_tris,
                               'pieces':len(low), 'output':str(OUT)}), flush=True)


if __name__ == '__main__':
    main()
