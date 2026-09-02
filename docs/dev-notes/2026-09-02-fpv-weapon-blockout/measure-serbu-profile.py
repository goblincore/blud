# Measure the Serbu's side profile: for each slice along the gun, how far down
# does material reach? That gives receiver extent, grip position and trigger
# location as NUMBERS instead of eyeballed pixels.
import bpy, sys, math, os
from mathutils import Vector
argv=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
# keep only the gun body; drop the shell set and the charm
for o in list(bpy.data.objects):
    if o.type=='MESH':
        names={s.material.name for s in o.material_slots if s.material}
        if not any('serbu' in n.lower() for n in names):
            bpy.data.objects.remove(o, do_unlink=True)
meshes=[o for o in bpy.data.objects if o.type=='MESH']
pts=[]
for o in meshes:
    o.data.calc_loop_triangles()
    for v in o.data.vertices:
        pts.append(o.matrix_world @ v.co)
ys=[p.y for p in pts]; zs=[p.z for p in pts]; xs=[p.x for p in pts]
y0,y1=min(ys),max(ys); z0,z1=min(zs),max(zs)
L=y1-y0
print(f"SERBU verts={len(pts)} ylen={L:.3f} zspan={z1-z0:.3f} xspan={max(xs)-min(xs):.3f}")
# 40 slices along Y; report the z-extent of each as a fraction of overall length
N=40
print("slice  y_frac   z_lo     z_hi    (normalised by overall length L)")
for i in range(N):
    a=y0+L*i/N; b=y0+L*(i+1)/N
    sl=[p.z for p in pts if a<=p.y<b]
    if not sl: continue
    print(f"{i:5d} {(a-y0)/L:7.3f} {(min(sl)-z0)/L:8.4f} {(max(sl)-z0)/L:8.4f}")
