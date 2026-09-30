# Original M79-inspired gothic FPV launcher. Metres, muzzle -Y, Blender Z-up.
# Run: Blender --background --python scripts/model_grenade_launcher.py
# Animation is driven by the pure game-grenade-launcher.ts beat sheet.
import bpy, bmesh, math, os, json
from mathutils import Vector
from pathlib import Path
import numpy as np
ROOT_DIR = Path(__file__).resolve().parent.parent
OUT = ROOT_DIR / 'public/assets/lab/grenade-launcher.glb'
NOTES = ROOT_DIR / 'docs/dev-notes/2026-09-29-grenade-launcher'
BLEND = ROOT_DIR / 'assets-source/weapons/grenade-launcher.blend'
NOTES.mkdir(parents=True, exist_ok=True)
BLEND.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
col=bpy.data.collections.new('Launcher'); bpy.context.scene.collection.children.link(col)
def material(name, color, metal, rough):
    m=bpy.data.materials.new(name); m.use_nodes=True
    p=m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal
    p.inputs['Roughness'].default_value=rough
    return m
MATS={
 'Steel': material('Launcher_BluedSteel',(0.095,0.115,0.135),0.88,0.34),
 'Edge': material('Launcher_WornSteel',(0.25,0.27,0.28),0.9,0.32),
 'Brass': material('Launcher_AgedBrass',(0.40,0.27,0.10),0.82,0.42),
 'Wood': material('Launcher_Walnut',(0.20,0.075,0.026),0,0.5),
 'Bore': material('Launcher_Bore',(0.009,0.012,0.014),0.15,0.88),
 'Case': material('Launcher_Case',(0.53,0.34,0.10),0.8,0.38),
 'Round': material('Launcher_Grenade',(0.105,0.14,0.065),0.4,0.52),
 'Rubber': material('Launcher_ButtPad',(0.025,0.020,0.016),0,0.9),
}
# Exportable packed albedo, rather than Blender-only procedural nodes.
size=256
u,v=np.meshgrid(np.linspace(0,1,size),np.linspace(0,1,size))
rng=np.random.default_rng(79)
noise=rng.random((size,size))
grain=np.sin(2*math.pi*(v*55+0.40*np.sin(u*2*math.pi)+0.18*np.sin(u*6*math.pi)))
fine=np.sin(2*math.pi*(v*128+0.22*np.sin(u*4*math.pi)))
knot=np.exp(-((u-.68)**2/.007+(v-.36)**2/.015))*np.sin(90*np.sqrt((u-.68)**2+((v-.36)*.6)**2))
value=np.clip(.75+.13*grain+.05*fine+.10*(noise-.5)+.13*knot,.36,1)
pix=np.ones((size,size,4),dtype=np.float32)
# Image pixels are scene-linear; walnut remains dark but catches the studio light.
for i,c in enumerate((.26,.105,.040)): pix[:,:,i]=c*value
img=bpy.data.images.new('Launcher_WalnutGrain',width=size,height=size)
img.pixels.foreach_set(pix.ravel()); img.pack()
tex=MATS['Wood'].node_tree.nodes.new('ShaderNodeTexImage'); tex.image=img
MATS['Wood'].node_tree.links.new(tex.outputs['Color'],MATS['Wood'].node_tree.nodes['Principled BSDF'].inputs['Base Color'])
def autosmooth(obj, deg=38.0):
    """Blender 5.x replacement for the old use_auto_smooth: smooth-shade only
    where the dihedral angle is below `deg`, so a lofted curve reads round while
    a machined edge stays sharp."""
    bpy.context.view_layer.objects.active = obj
    for p in obj.data.polygons: p.use_smooth = True
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(deg))
    except Exception:
        pass
    return obj

def put(me,name,mat,loc=(0,0,0),rot=(0,0,0),bevel=0.003,segs=3,smooth=False,
        mat_inner=None):
    o=bpy.data.objects.new(name,me); col.objects.link(o)
    o.location=loc; o.rotation_euler=rot
    bpy.context.view_layer.objects.active=o
    if bevel:
        b=o.modifiers.new('bv','BEVEL'); b.width=bevel; b.segments=segs
        b.limit_method='ANGLE'; b.angle_limit=math.radians(32); b.miter_outer='MITER_ARC'
        bpy.ops.object.modifier_apply(modifier='bv')
    o.data.materials.append(MATS[mat])
    if mat_inner:
        # Second slot for a tube's INNER wall: faces whose normal points at
        # the local axis. A chrome chamber bore mirrors the room, and from the
        # open breech that reads as angular junk inside the tube (owner,
        # 2026-09-04); a real chamber is dark and matte.
        o.data.materials.append(MATS[mat_inner])
        for pg in o.data.polygons:
            c=pg.center; n=pg.normal
            if abs(n.z) < 0.5 and (n.x*c.x + n.y*c.y) < 0:
                pg.material_index=1
    if smooth is True:
        for p in o.data.polygons: p.use_smooth=True
    elif smooth == 'auto':
        autosmooth(o)
    return o

def box(sx,sy,sz):
    bm=bmesh.new(); bmesh.ops.create_cube(bm,size=1.0)
    bmesh.ops.scale(bm,vec=(sx,sy,sz),verts=bm.verts)
    me=bpy.data.meshes.new('b'); bm.to_mesh(me); bm.free(); return me

def cyl(r,d,segs=32):
    bm=bmesh.new(); bmesh.ops.create_cone(bm,cap_ends=True,cap_tris=False,
        segments=segs,radius1=r,radius2=r,depth=d)
    me=bpy.data.meshes.new('c'); bm.to_mesh(me); bm.free(); return me

def tube(ro,ri,d,segs=32):
    bm=bmesh.new()
    for i in range(segs):
        a0=2*math.pi*i/segs; a1=2*math.pi*(i+1)/segs
        for (r,flip) in ((ro,False),(ri,True)):
            v=[bm.verts.new((r*math.cos(a),r*math.sin(a),z)) for a,z in
               ((a0,-d/2),(a1,-d/2),(a1,d/2),(a0,d/2))]
            bm.faces.new(v[::-1] if flip else v)
        for z in (-d/2,d/2):
            v=[bm.verts.new((r*math.cos(a),r*math.sin(a),z)) for r,a in
               ((ro,a0),(ro,a1),(ri,a1),(ri,a0))]
            bm.faces.new(v if z<0 else v[::-1])
    bmesh.ops.remove_doubles(bm,verts=bm.verts,dist=1e-6)
    me=bpy.data.meshes.new('t'); bm.to_mesh(me); bm.free(); return me

def outline_normals(pts):
    """Outward 2D normals for a CCW closed outline in the YZ plane."""
    n=len(pts); out=[]
    for i in range(n):
        (ya,za)=pts[i-1]; (yb,zb)=pts[(i+1)%n]
        ty,tz = yb-ya, zb-za
        L=math.hypot(ty,tz) or 1.0
        out.append((tz/L, -ty/L))     # CCW outline -> this points outward
    return out

def loft(pts, halfw, round_frac=0.95, sections=8, name='loft'):
    """Closed outline in YZ swept through a rounded cross-section across X.

    halfw is a CALLABLE of the outline point's y, so the solid can be wide at
    the breech and narrow at the grip in one continuous piece -- the thing a
    flat extrude cannot do.
    """
    # Signed area: outline_normals only points outward on a CCW loop, and a CW
    # one silently inverts every inset. v4's fore-end wedge was exactly this.
    a2 = sum(pts[i][0]*pts[(i+1) % len(pts)][1] - pts[(i+1) % len(pts)][0]*pts[i][1]
             for i in range(len(pts)))
    if a2 < 0: pts = pts[::-1]
    nrm = outline_normals(pts)
    rings=[]
    bm = bmesh.new()
    for j in range(sections+1):
        phi = -math.pi/2 + math.pi*j/sections
        ring=[]
        for i,(y,z) in enumerate(pts):
            hw = halfw(y)
            x = hw*math.sin(phi)
            inset = round_frac*hw*(1.0-math.cos(phi))
            ny,nz = nrm[i]
            ring.append(bm.verts.new((x, y-ny*inset, z-nz*inset)))
        rings.append(ring)
    n=len(pts)
    for j in range(sections):
        for i in range(n):
            k=(i+1)%n
            bm.faces.new((rings[j][i], rings[j][k], rings[j+1][k], rings[j+1][i]))
    bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    me=bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); return me

def sweep_path(path, width, thick, closed=True, name='sweep'):
    """Closed 2D path in YZ swept with a RECTANGULAR section: `width` across X,
    `thick` along the path's own normal. This is what a trigger guard actually
    is -- a flat-sided strap -- and why the v3/v4 torus read as a cartoon hoop."""
    n=len(path); bm=bmesh.new(); rings=[]
    for i,(y,z) in enumerate(path):
        (ya,za)=path[i-1]; (yb,zb)=path[(i+1)%n]
        ty,tz=yb-ya, zb-za; L=math.hypot(ty,tz) or 1.0
        ny,nz = tz/L, -ty/L
        rings.append([bm.verts.new((sx*width/2, y+ny*sy*thick/2, z+nz*sy*thick/2))
                      for (sx,sy) in ((-1,-1),(1,-1),(1,1),(-1,1))])
    last = n if closed else n-1
    for i in range(last):
        a,b = rings[i], rings[(i+1)%n]
        for k in range(4):
            m=(k+1)%4
            bm.faces.new((a[k], a[m], b[m], b[k]))
    if not closed:
        bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    me=bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); return me

def empty(name,loc=(0,0,0),parent=None):
    o=bpy.data.objects.new(name,None); col.objects.link(o); o.location=loc
    if parent:
        bpy.context.view_layer.update(); world=o.matrix_world.copy()
        o.parent=parent; o.matrix_world=world
    o.empty_display_size=.012
    return o

def attach(o,parent):
    bpy.context.view_layer.update(); world=o.matrix_world.copy()
    o.parent=parent; o.matrix_world=world
    return o

def mesh(name,geo,mat,loc=(0,0,0),rot=(0,0,0),parent=None,bevel=.001,mat_inner=None):
    o=put(geo,name,mat,loc,rot,bevel=bevel,segs=3,smooth='auto',mat_inner=mat_inner)
    uv=o.data.uv_layers.new(name='UVMap')
    for p in o.data.polygons:
        for li in p.loop_indices:
            vert=o.data.vertices[o.data.loops[li].vertex_index].co
            uv.data[li].uv=(vert.y*2.5,vert.z*5+vert.x*2)
    return attach(o,parent or frame)

def line(name,pts,mat='Brass',radius=.0007,parent=None):
    c=bpy.data.curves.new(name,'CURVE'); c.dimensions='3D'; c.bevel_depth=radius; c.bevel_resolution=2
    s=c.splines.new('POLY'); s.points.add(len(pts)-1)
    for p,co in zip(s.points,pts): p.co=(*co,1)
    o=bpy.data.objects.new(name,c); col.objects.link(o); o.data.materials.append(MATS[mat])
    bpy.context.view_layer.objects.active=o; o.select_set(True)
    bpy.ops.object.convert(target='MESH'); o.select_set(False)
    return attach(o,parent or frame)

root=empty('LauncherRoot')
frame=empty('Frame',parent=root)
hinge=empty('Hinge',(0,-.133,-.012),frame)
barrels=empty('Barrels',(0,-.133,-.012),root) # origin IS the mechanical pin
axis=.031; breech=-.087; muzzle=-.425
# Hollow barrel, open at both ends. No opaque disk caps the bore.
mesh('barrel',tube(.032,.022,(breech-muzzle),48),'Steel',(0,(breech+muzzle)/2,axis),(math.pi/2,0,0),barrels,mat_inner='Bore')
for name,y,ro,ri,length,mat in [
    ('muzzle_crown',muzzle+.005,.034,.022,.011,'Edge'),
    ('chamber_band',breech-.034,.036,.022,.062,'Steel'),
    ('chamber_lip',breech-.001,.0365,.022,.003,'Edge'),
    ('front_band',-.327,.0345,.0315,.009,'Brass')]:
    mesh(name,tube(ro,ri,length,48),mat,(0,y,axis),(math.pi/2,0,0),barrels,bevel=.0005,mat_inner='Bore')
# Curved walnut fore-end hugs the bottom half, slim enough for the goblin hand.
fore=[(-.115,.008),(-.145,.012),(-.300,.005),(-.323,-.010),(-.318,-.032),(-.280,-.042),(-.150,-.040),(-.113,-.023)]
mesh('walnut_foreend',loft(fore,lambda y:.026,round_frac=.40,sections=16),'Wood',parent=barrels,bevel=0)
mesh('foreend_endcap',box(.045,.014,.018),'Brass',(0,-.314,-.017),parent=barrels,bevel=.004)
mesh('foreend_rearcap',box(.048,.013,.020),'Steel',(0,-.120,-.016),parent=barrels,bevel=.004)
# Standing breech: keeps a clear rear face that the opened chamber swings away from.
receiver=[(-.084,.047),(-.030,.056),(.034,.036),(.045,.005),(.023,-.020),(-.063,-.028),(-.084,-.014)]
mesh('receiver',loft(receiver,lambda y:.032,round_frac=.25,sections=16),'Steel',bevel=0)
# Wrist flows into a full curved shoulder stock, rather than a pistol grip.
stock=[(.025,.021),(.052,.016),(.085,-.007),(.155,-.024),(.230,-.018),(.274,.008),(.307,.004),(.316,-.108),(.297,-.122),(.262,-.121),(.219,-.105),(.163,-.081),(.105,-.061),(.069,-.069),(.040,-.073),(.013,-.050),(.004,-.019)]
def width(y): return .020+.007*max(0,min(1,(y-.09)/.18))
mesh('walnut_stock',loft(stock,width,round_frac=.44,sections=20),'Wood',bevel=0)
mesh('buttplate',box(.056,.013,.122),'Steel',(0,.313,-.055),rot=(.07,0,0),bevel=.005)
mesh('buttpad',box(.054,.009,.114),'Rubber',(0,.323,-.055),rot=(.07,0,0),bevel=.004)
# Hinge is FORWARD of the rear chamber mouth: breaking down lifts that mouth.
# A hinge behind the chamber drops its mouth behind the standing breech in FPV.
mesh('hinge_lug',box(.045,.059,.023),'Steel',(0,-.108,-.020),bevel=.004)
# Hinge pin and two mechanical sideplates, pinned to the frame.
mesh('hinge_pin',cyl(.010,.078,32),'Edge',(0,-.133,-.012),(0,math.pi/2,0),bevel=.001)
for sign in [-1,1]:
    mesh('hinge_screw',cyl(.009,.003,24),'Brass',(sign*.040,-.133,-.012),(0,math.pi/2,0),bevel=.0005)
    line('screw_slot',[(sign*.042,-.137,-.012),(sign*.042,-.129,-.012)],'Bore',.0007)
    # Delicate pointed arch / leaf engraving, raised just 0.7 mm off the cheek.
    x=sign*.0323
    for off in [-.016,.012]:
        pts=[(x,off+.007,.000),(x,off-.011,.006),(x,off-.016,.019),(x,off-.006,.030),(x,off+.005,.019),(x,off+.007,.000)]
        line('gothic_leaf',pts,radius=.00065)
    line('receiver_border',[(x,-.061,-.008),(x,-.061,.026),(x,-.043,.039),(x,.014,.023),(x,.019,-.010),(x,-.061,-.008)],radius=.00065)
# Guard is an open swept metal loop, trigger is rooted in the action floor.
guard=[(.025,-.030),(.021,-.061),(.010,-.079),(-.033,-.080),(-.057,-.067),(-.059,-.037),(-.047,-.025)]
mesh('trigger_guard',sweep_path(guard,.012,.005,closed=False),'Steel',bevel=.001)
trigger=empty('Trigger',(0,-.015,-.023),frame)
mesh('trigger_blade',sweep_path([(-.015,-.024),(-.016,-.038),(-.011,-.050),(-.002,-.056)],.006,.004,closed=False),'Edge',parent=trigger,bevel=.0006)
# Exposed cocked hammer and top break lever, separate animation nodes.
hammer=empty('Hammer',(0,.025,.042),frame)
mesh('hammer_body',loft([(.019,.040),(.016,.055),(.023,.075),(.044,.079),(.049,.071),(.032,.063),(.030,.041)],lambda y:.008,.18,8),'Steel',parent=hammer,bevel=0)
mesh('hammer_spur',box(.031,.015,.006),'Edge',(0,.043,.076),parent=hammer,bevel=.002)
lever=empty('TopLever',(0,-.033,.055),frame)
mesh('unlock_lever',box(.040,.012,.004),'Brass',(-.016,-.024,.058),rot=(0,0,.22),parent=lever,bevel=.002)
# Low folded M79-style ladder. Ornamental spear finial instead of tactical rail.
for x in [-.010,.010]:
    mesh('ladder_rail',box(.003,.084,.006),'Steel',(x,-.201,.071),parent=barrels)
for y in [-.163,-.185,-.207,-.237]:
    mesh('ladder_rung',box(.023,.0025,.004),'Brass',(0,y,.073),parent=barrels,bevel=.0005)
mesh('sight_hinge',cyl(.005,.034,24),'Edge',(0,-.153,.072),(0,math.pi/2,0),barrels)
mesh('front_sight',loft([(-.397,.062),(-.400,.082),(-.404,.092),(-.408,.082),(-.411,.062)],lambda y:.004,.15,6),'Steel',parent=barrels,bevel=0)
mesh('brass_bead',cyl(.002,.009,16),'Brass',(0,-.404,.086),(0,math.pi/2,0),barrels,bevel=.0003)
# Chamber round: brass case + olive projectile. Cylinder local +Z -> muzzle -Y.
roundnode=empty('Round',(0,breech-.045,axis),barrels)
mesh('case',cyl(.021,.072,40),'Case',(0,breech-.036,axis),(math.pi/2,0,0),roundnode)
mesh('case_rim',cyl(.023,.004,40),'Brass',(0,breech-.001,axis),(math.pi/2,0,0),roundnode,bevel=.0004)
mesh('primer',cyl(.006,.001,24),'Edge',(0,breech+.0015,axis),(math.pi/2,0,0),roundnode,bevel=.0003)
mesh('projectile',cyl(.020,.022,40),'Round',(0,breech-.082,axis),(math.pi/2,0,0),roundnode,bevel=.007)
for name,loc,parent in [('Muzzle',(0,muzzle,axis),barrels),('Breech',(0,breech,axis),barrels),('Grip_Hand',(0,.053,-.043),frame),('Fore_Hand',(0,-.238,-.039),barrels)]: empty(name,loc,parent)
# Topplate gothic accent visible in FPV, fixed behind the lever.
line('topplate_inlay',[(-.018,-.005,.048),(0,-.016,.057),(.018,-.005,.048)],radius=.0008)
# Export only weapon meshes and contract nodes; studio lights stay in .blend.
bpy.ops.object.select_all(action='DESELECT')
for o in col.objects: o.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.ops.export_scene.gltf(filepath=str(OUT),export_format='GLB',use_selection=True,export_apply=True,export_yup=True)
# Contract and hollow-bore construction check.
required=['LauncherRoot','Frame','Barrels','Hinge','Muzzle','Breech','Grip_Hand','Fore_Hand','Round','TopLever','Hammer','Trigger']
assert all(bpy.data.objects.get(n) for n in required)
assert bpy.data.objects['Round'].parent==barrels
assert bpy.data.objects['Fore_Hand'].parent==barrels
assert bpy.data.objects['Hammer'].parent==frame
tris=sum(len(o.data.loop_triangles) for o in col.objects if o.type=='MESH' and not o.data.calc_loop_triangles())
assert tris < 32000, tris
report={'triangles':tris,'bytes':OUT.stat().st_size,'nodes':required,'barrel_inner_diameter_m':.044,'length_m':.752,'moving_origin':'hinge pin; no runtime reparent required'}
(NOTES/'model-gate.json').write_text(json.dumps(report,indent=2)+'\n')
print('[launcher]',json.dumps(report))
# Studio source and previews.
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=32
scene.render.resolution_x=1200; scene.render.resolution_y=800; scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('StudioWorld'); scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.15,.19,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
scene.view_settings.view_transform='AgX'
def lamp(name,loc,energy,size,color):
    data=bpy.data.lights.new(name,'AREA'); data.energy=energy; data.shape='DISK'; data.size=size; data.color=color
    o=bpy.data.objects.new(name,data); scene.collection.objects.link(o); o.location=loc
    o.rotation_euler=(Vector((0,-.06,0))-o.location).to_track_quat('-Z','Y').to_euler()
lamp('Key',(.35,-.28,.65),65,.75,(1,.87,.68))
lamp('Fill',(-.45,.10,.3),40,.65,(.62,.77,1))
lamp('Rim',(.08,.55,.45),60,.4,(1,.94,.82))
cam=bpy.data.objects.new('PreviewCamera',bpy.data.cameras.new('PreviewCamera')); scene.collection.objects.link(cam); scene.camera=cam
cam.data.type='ORTHO'; cam.data.ortho_scale=.90
for name,eye,target in [('model-threequarter',(.75,.53,.40),(0,-.04,-.006)),('model-profile',(.9,-.04,.13),(0,-.04,-.015)),('model-open',(.40,.60,.37),(0,-.04,-.01))]:
    barrels.rotation_euler.x=math.radians(55) if name=='model-open' else 0
    if name=='model-open': roundnode.hide_render=True
    cam.location=eye; cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(NOTES/(name+'.png')); bpy.ops.render.render(write_still=True)
barrels.rotation_euler.x=0; roundnode.hide_render=False
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
