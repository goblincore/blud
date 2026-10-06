import bpy,json,math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
root=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(root/'.scratch/anatomical-skull/skull.blend'))
pieces=[o for o in bpy.context.scene.objects if o.type=='MESH' and not o.name.startswith('high-')]
measure=[]
for lo in pieces:
 hi=bpy.data.objects.get('high-'+lo.name)
 vertices=[lo.matrix_world@v.co for v in lo.data.vertices]
 tree=BVHTree.FromPolygons(vertices,[list(p.vertices) for p in lo.data.polygons],all_triangles=True)
 distances=[]
 stride=max(1,len(hi.data.vertices)//3000)
 for v in list(hi.data.vertices)[::stride]:
  hit=tree.find_nearest(hi.matrix_world@v.co)
  if hit[0] is not None: distances.append(hit[3]*1000)
 distances.sort()
 measure.append({'piece':lo.name,'samples':len(distances),'rmsMm':math.sqrt(sum(v*v for v in distances)/len(distances)),'p95Mm':distances[int(.95*(len(distances)-1))],'maxMm':max(distances)})
(root/'docs/dev-notes/2026-10-06-anatomical-skull/surface-error.json').write_text(json.dumps(measure,indent=2)+'\n')
mat=pieces[0].active_material
nodes=mat.node_tree.nodes
bsdf=nodes.get('Principled BSDF')
wire=nodes.new('ShaderNodeWireframe');wire.use_pixel_size=True;wire.inputs[0].default_value=.8
mix=nodes.new('ShaderNodeMixRGB');mix.inputs[1].default_value=(.63,.57,.43,1);mix.inputs[2].default_value=(.003,.004,.005,1)
mat.node_tree.links.new(wire.outputs[0],mix.inputs[0]);mat.node_tree.links.new(mix.outputs[0],bsdf.inputs['Base Color'])
s=bpy.context.scene;s.cycles.samples=8;s.render.threads_mode='FIXED';s.render.threads=4
s.render.filepath=str(root/'.scratch/anatomical-skull/wireframe.png')
bpy.ops.render.render(write_still=True)
print('SURFACE_ERROR',json.dumps(measure),flush=True)
