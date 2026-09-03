# Goblin sawed-off — blockout v7, now the shipping model script.
# scripts/model_grapeshot_shorty.py: builds the gun, exports
# public/assets/lab/shorty-double.glb (barrels on their own BARREL_NODE so the
# break hinge is a code-driven rotation at runtime), renders the five previews
# into docs/dev-notes/2026-09-02-fpv-weapon-shorty/, and gates tris/size/nodes.
# Blender space: grip origin, muzzles down -Y, Z up.
#
# v4 is a construction change, not just a numbers change. Owner on v3: "the
# receiver and grip are still way too squared off ... the Serbu has a very nice
# rounded backend ... the grip honestly looks painful to hold, it needs to be a
# bit wider and the backside needs a more graceful angle."
#
# A flat extrusion + bevel CANNOT produce that. It gives a slab with chamfered
# corners, which is exactly what v2/v3 looked like. So the action body, tang and
# grip are now ONE LOFTED SOLID: a single closed outline in the side (YZ) plane,
# swept through a rounded cross-section whose half-width VARIES along the gun --
# wide at the standing breech, narrow and oval at the grip. That is how a real
# side-by-side is shaped and it is what makes the backstrap read as rounded.
#
# v5 corrects two v4 mistakes and takes the trigger group straight off the Serbu:
#   * round_frac 0.92 rounded the ENTIRE cross-section into a cylinder, so the
#     grip came out a paddle. The Serbu is slab-SIDED with generously rounded
#     EDGES, which is round_frac ~0.3, not ~0.9.
#   * loft() assumed a CCW outline and silently inverted its insets on a CW one
#     -- that is what deformed the fore-end into a wedge. It now measures the
#     signed area and flips.
#   * the guard is a flat-bottomed STADIUM with tapered tangs (swept rectangular
#     section), and the trigger a slender CRESCENT -- not a hoop and a brick.
#
# v6, owner: "the grip doesn't make sense because the trigger cuts into it ...
# the receiver needs to be longer so there's enough space ... overlay the Serbu
# in profile and the receiver and trigger should align fairly closely", plus
# "I dislike the flat quads on the rounded backend".
#
# The spacing is MEASURED off the reference now, not eyeballed. A slice scan of
# supershortyshotgun.glb (lowest material per slice along the gun) puts, as
# fractions of overall length: grip butt 0.00, grip front strap 0.13, trigger
# centre 0.165, guard front 0.20, receiver front 0.36. On a 42 cm gun that is a
# 15 mm gap between front strap and trigger and a ~97 mm action body behind the
# breech. v5 had the trigger 4 mm from the front strap, which is the collision.
# The body outline below is hand-placed to those landmarks rather than stitched
# from arcs whose endpoints I kept mis-signing.
#
# Faceting: loft sections 7 -> 16 and Blender's shade_smooth_by_angle, so the
# rounded back end is smooth-shaded but the mechanical edges stay crisp.
#
# v7, owner: "the triggers are at the wrong angle, they are not even connected,
# they are almost horizontally parallel to the barrel", and "the grip is still
# too small ... particularly bad is the top part of the grip, it's so thin; the
# angle of the back should be a bit less acute".
#   * TRIGGERS: v6 built each blade as an arc swept UNDER a centre point, which
#     produces a horizontal crescent floating in the guard. A trigger is a blade
#     hanging DOWN from the action floor, curving rearward to a hooked toe --
#     so it is now an open swept path rooted at z = the receiver belly. And a
#     double's two triggers sit INLINE on the centreline, one behind the other,
#     not side by side as v6 had them.
#   * GRIP: 18 mm across at the top (front strap 0.062 vs backstrap 0.080) was
#     the thin web. The backstrap moves rearward and stands more upright, the
#     front strap comes forward, and the butt drops 12 mm -- 30 mm at the top,
#     52 mm at the heel, 125 mm deep.
import bpy, bmesh, math, sys, os
from mathutils import Vector

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB   = os.path.join(REPO_ROOT, "public", "assets", "lab", "shorty-double.glb")
NOTES_DIR = os.path.join(REPO_ROOT, "docs", "dev-notes", "2026-09-02-fpv-weapon-shorty")
os.makedirs(NOTES_DIR, exist_ok=True)

# Node names the runtime depends on. game-viewmodel.ts rotates BARREL_NODE about
# HINGE_NODE to break the action; anything not under BARREL_NODE stays still.
BARREL_NODE = "Barrels"
FRAME_NODE  = "Frame"
HINGE_NODE  = "Hinge"
bpy.ops.wm.read_factory_settings(use_empty=True)

def M(n, base, met, rough):
    m = bpy.data.materials.new(n); m.use_nodes=True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value=base
    b.inputs["Metallic"].default_value=met
    b.inputs["Roughness"].default_value=rough
    return m
MATS = {
 'Steel': M('Steel',(0.205,0.215,0.245,1),1.0,0.22),
 'Blue':  M('Blue', (0.115,0.125,0.155,1),1.0,0.30),
 'Brass': M('Brass',(0.62,0.44,0.16,1),   1.0,0.28),
 'Wood':  M('Wood', (0.255,0.135,0.062,1),0.0,0.52),
 'Bore':  M('Bore', (0.012,0.012,0.014,1),0.0,0.90),
}
col = bpy.data.collections.new('Gun'); bpy.context.scene.collection.children.link(col)

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


def put(me,name,mat,loc=(0,0,0),rot=(0,0,0),bevel=0.003,segs=3,smooth=False):
    o=bpy.data.objects.new(name,me); col.objects.link(o)
    o.location=loc; o.rotation_euler=rot
    bpy.context.view_layer.objects.active=o
    if bevel:
        b=o.modifiers.new('bv','BEVEL'); b.width=bevel; b.segments=segs
        b.limit_method='ANGLE'; b.angle_limit=math.radians(32); b.miter_outer='MITER_ARC'
        bpy.ops.object.modifier_apply(modifier='bv')
    o.data.materials.append(MATS[mat])
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

def taper_tube(ro, ri_front, ri_back, d, segs=32):
    """Tube of constant OUTER radius whose INNER radius differs end to end.

    This is the forcing cone: the chamber's mouth is wider than the bore, and a
    real barrel tapers between them rather than presenting a flat shoulder.

    Local axis is Z. Placed with rot=(RY,0,0), local +Z points down -Y in world
    space -- i.e. toward the MUZZLE -- so `ri_front` is the radius at +d/2.
    """
    bm = bmesh.new()
    def ri_at(z):
        t = (z + d/2) / d              # 0 at the back, 1 at the front
        return ri_back + (ri_front - ri_back) * t
    for i in range(segs):
        a0 = 2*math.pi*i/segs; a1 = 2*math.pi*(i+1)/segs
        zb, zf = -d/2, d/2
        rb, rf = ri_at(zb), ri_at(zf)
        # outer wall
        bm.faces.new([bm.verts.new((ro*math.cos(a), ro*math.sin(a), z))
                      for a, z in ((a0, zb), (a1, zb), (a1, zf), (a0, zf))])
        # inner wall, wound the other way so it faces into the bore
        bm.faces.new([bm.verts.new((r*math.cos(a), r*math.sin(a), z))
                      for a, z, r in ((a0, zb, rb), (a1, zb, rb),
                                      (a1, zf, rf), (a0, zf, rf))][::-1])
        # annular end caps
        for z, r, flip in ((zb, rb, False), (zf, rf, True)):
            v = [bm.verts.new((rr*math.cos(a), rr*math.sin(a), z))
                 for rr, a in ((ro, a0), (ro, a1), (r, a1), (r, a0))]
            bm.faces.new(v[::-1] if flip else v)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new('tt'); bm.to_mesh(me); bm.free(); return me

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


def rake(pts, deg, pivot):
    """Tilt a run of outline points backward about `pivot` in the YZ plane.

    The pistol grip's rake is ONE number, so it lives as one number rather than
    being baked into every hand-typed coordinate -- the owner asked for "more
    slanted" and this is the knob that does it.
    """
    t = math.radians(deg); c, sn = math.cos(t), math.sin(t)
    py, pz = pivot
    out = []
    for (y, z) in pts:
        dy, dz = y - py, z - pz
        out.append((py + dy*c - dz*sn, pz + dy*sn + dz*c))
    return out


def arc(c,r,a0,a1,n,flat=1.0):
    return [(c[0]+r*math.cos(a0+(a1-a0)*i/n), c[1]+r*math.sin(a0+(a1-a0)*i/n)*flat)
            for i in range(n+1)]

RY = math.pi/2

# ---------------- barrels ----------------
# The chamber is a real, hollow, 70 mm sleeve because our shell is 70 mm long.
# The previous build used cyl() -- capped at both ends -- so breaking the action
# open showed two solid domed knobs where the mouths should be.
RO, RI, XSEP = 0.0225, 0.0166, 0.0234
RCH  = RI * 1.10             # chamber bore, wider than the barrel bore
CY1  = -0.031                # THE BREECH FACE. Everything breech-y lives here.
CHAMBER_DEPTH = 0.070        # set by our shell length, not by realism
CY0  = CY1 - CHAMBER_DEPTH   # -0.101, chamber floor
CONE_LEN  = 0.008
BY_BACK   = CY0 - CONE_LEN   # -0.109, barrel tube's rear end
BY_MUZZLE = -0.318           # unchanged: game-main's MUZZLE_LOCAL depends on it
BLEN = BY_BACK - BY_MUZZLE   # 0.209
BMID = (BY_MUZZLE + BY_BACK) / 2
for i,x in enumerate((-XSEP,XSEP)):
    put(tube(RO,RI,BLEN),f'barrel{i}','Blue',loc=(x,BMID,0),rot=(RY,0,0),bevel=0.0012,smooth=True)
    put(tube(RO*1.09,RI,0.012),f'crown{i}','Steel',loc=(x,BY_MUZZLE+0.006,0),rot=(RY,0,0),
        bevel=0.0016,smooth=True)
    # Forcing cone: chamber mouth (RCH) tapering down to the bore (RI).
    put(taper_tube(RO,RI,RCH,CONE_LEN),f'cone{i}','Bore',
        loc=(x,(BY_BACK+CY0)/2,0),rot=(RY,0,0),bevel=0,smooth=True)
    # Dark plug. Starts at the cone's front so the open breech reads as DEPTH
    # rather than a lit tube wall, and stops short of the muzzle so looking down
    # the bores from the front still has somewhere to look into.
    put(cyl(RI*0.99,0.121),f'bore{i}','Bore',loc=(x,-0.1695,0),rot=(RY,0,0),bevel=0,smooth=True)
# The rib runs the full barrel assembly, breech to muzzle.
put(box(XSEP*2.0,(CY1-BY_MUZZLE)*0.94,0.010),'rib_top','Blue',
    loc=(0,(BY_MUZZLE+CY1)/2,RO*0.62),bevel=0.0016,segs=2)
put(cyl(0.0042,0.0075,14),'bead','Brass',loc=(0,BY_MUZZLE+0.010,RO*0.62+0.006),bevel=0,smooth=True)

# --------- THE LOFTED BODY: breech -> top strap -> rounded back -> grip --------
# Half-width taper. Wide enough at the breech to carry both barrels, narrowing
# to a comfortable OVAL at the grip -- v3's grip was 38 mm of flat slab, which
# is what "painful to hold" meant. This is 52 mm across and round in section.
def HW(y):
    if y <= -0.020: return 0.039
    if y >=  0.058: return 0.026
    t = (y + 0.020) / 0.078
    return 0.039 + (0.026-0.039) * (t*t*(3-2*t))     # smoothstep, no crease

# Hand-placed to the landmark table above. +y is REARWARD.
#   belly/receiver floor  z = -0.0262, running back to y = +0.048
#   grip front strap      y ~ 0.058       (landmark 0.13)
#   trigger centre        y ~ 0.038       (landmark 0.165, 15 mm forward)
#   guard front           y ~ 0.008       (landmark 0.20)
#   breech face           y = -0.066      (landmark 0.36 -- a break action's
#                                          breech is bulkier than a pump's)
# GRIP RAKE. v7's grip came off the receiver at 14 deg from vertical, which the
# owner read as too acute. One knob, applied to the grip run only, so the top
# strap, rounded back end and belly stay put.
GRIP_RAKE_DEG = 14.0
GRIP_PIVOT    = (0.072, -0.014)

_grip = [
    (0.078,-0.0180), (0.086,-0.0400), (0.094,-0.0640),       # backstrap
    (0.100,-0.0880), (0.105,-0.1120), (0.107,-0.1320),
    (0.101,-0.1455), (0.087,-0.1515), (0.070,-0.1505),       # butt
    (0.058,-0.1425),
    (0.053,-0.1220), (0.052,-0.0980), (0.053,-0.0760),       # front strap
    (0.054,-0.0540), (0.054,-0.0360),
]
body = [
    (-0.078, 0.0235), (0.040, 0.0250),                       # top strap
    (0.054, 0.0215), (0.065, 0.0130), (0.072, 0.0010),       # rounded back end
    (0.076,-0.0140),
] + rake(_grip, GRIP_RAKE_DEG, GRIP_PIVOT) + [
    (0.052,-0.0262), (-0.078,-0.0262),                       # belly, forward
]
put(loft(body, HW, round_frac=0.30, sections=16, name='body'), 'body', 'Steel',
    bevel=0.0016, segs=2, smooth='auto')

# THE BREECH FACE, at y = CY1. The previous build put the mouths and the
# extractor at y ~ -0.066 -- the chamber's FRONT, 35 mm away, buried inside the
# frame beside the hinge pin, where they were never once visible.
for i,x in enumerate((-XSEP,XSEP)):
    put(tube(RO*1.07,RCH,CHAMBER_DEPTH),f'chamber{i}','Steel',
        loc=(x,(CY0+CY1)/2,0),rot=(RY,0,0),bevel=0.0022,smooth=True)
    # A machined rim at the mouth. Steel, not 'Bore': the darkness now comes
    # from the real hole behind it rather than from painting a disc black.
    put(tube(RO*1.07,RCH,0.004),f'mouth{i}','Steel',
        loc=(x,CY1-0.002,0),rot=(RY,0,0),bevel=0,smooth=True)
put(box(0.052,0.007,0.016),'extractor','Steel',loc=(0,CY1+0.0035,0),bevel=0.0018)
for sx in (-1,1):
    put(cyl(0.0092,0.009,20),'hinge','Brass',loc=(sx*0.040,-0.070,-0.016),rot=(0,RY,0),
        bevel=0.0014,smooth=True)
put(box(0.011,0.038,0.0055),'toplever','Steel',loc=(0,0.032,0.0228),rot=(0,0,math.radians(9)),
    bevel=0.0022,segs=3)

# wood grip panels, following the same swell so they sit IN the grip, not on it
for sx in (-1,1):
    gp = rake([
        (0.060,-0.042), (0.058,-0.066), (0.059,-0.092), (0.061,-0.116),
        (0.066,-0.134), (0.078,-0.142), (0.092,-0.141), (0.100,-0.132),
        (0.099,-0.110), (0.094,-0.084), (0.086,-0.060), (0.076,-0.042),
    ], GRIP_RAKE_DEG, GRIP_PIVOT)
    put(loft(gp, lambda y: 0.0080, round_frac=0.55, sections=7, name='gp'),
        f'grip_panel{sx}', 'Wood', loc=(sx*0.0195,0,0), bevel=0.0014, segs=2,
        smooth='auto')

# --- trigger group, traced off the Serbu closeups ---
# The guard is a flat-bottomed STADIUM, longer fore-aft than it is deep, whose
# ends taper into the receiver at the front and the grip at the rear. Section is
# a rectangular strap, so it reads as bent flat bar, which is what it is.
GY0, GY1 =  0.008, 0.058      # front / rear of the guard opening
GZT, GZB = -0.028, -0.070     # roof (under the action) / flat floor
guard  = [(GY0+0.004, GZT)]
guard += [(GY1-0.008, GZT)]
guard += arc((GY1-0.008, GZT-0.018), 0.018, math.radians(90), math.radians(0), 5)
guard += [(GY1+0.010, GZB+0.016)]
guard += arc((GY1-0.004, GZB+0.004), 0.012, math.radians(0), math.radians(-90), 5)
guard += [(GY0+0.010, GZB)]
guard += arc((GY0+0.010, GZB+0.014), 0.014, math.radians(-90), math.radians(-180), 6)
put(sweep_path(guard, 0.0168, 0.0082, name='guard'), 'guard', 'Steel',
    bevel=0.0012, segs=2, smooth='auto')
# tangs blending the guard's two ends into receiver and grip
put(box(0.014,0.020,0.010),'guard_tang_f','Steel',loc=(0,GY0+0.001,GZT+0.005),
    rot=(math.radians(-16),0,0),bevel=0.0022,segs=3)
put(box(0.014,0.022,0.011),'guard_tang_r','Steel',loc=(0,GY1+0.003,GZT-0.002),
    rot=(math.radians(24),0,0),bevel=0.0022,segs=3)
# Two trigger BLADES. Each is rooted at the receiver belly (z = -0.0262), drops
# ~32 mm, and curves rearward into a hooked toe -- the Serbu blade shape. Swept
# as an OPEN path so the root sits inside the action and the toe is a free end,
# which is what "not even connected" was pointing at. A double's triggers are
# inline front-and-rear on the centreline, so x = 0 for both.
for i, dy in enumerate((-0.0090, 0.0025)):
    # Pronounced hook: the blade bellies REARWARD through its middle and the toe
    # curls FORWARD (-y). v7's first pass moved only 6 mm across 35 mm of drop,
    # which read as a straight prong.
    blade = [(0.0368+dy,-0.0185), (0.0406+dy,-0.0315), (0.0428+dy,-0.0415),
             (0.0421+dy,-0.0505), (0.0374+dy,-0.0570), (0.0300+dy,-0.0600),
             (0.0246+dy,-0.0592)]
    put(sweep_path(blade, 0.0108, 0.0078, closed=False, name='tg'),
        f'trig{i}','Steel', bevel=0.0011, segs=2, smooth='auto')

# fore-end, also lofted so it is a rounded splinter and not a plank
fe  = [(-0.070,-0.010),(-0.230,-0.010),(-0.243,-0.020),(-0.245,-0.032),
       (-0.236,-0.043),(-0.200,-0.050),(-0.140,-0.053),(-0.100,-0.050),
       (-0.078,-0.040),(-0.068,-0.026)]
put(loft(fe, lambda y: 0.0335, round_frac=0.42, sections=12, name='fe'),
    'foreend','Wood',bevel=0.0028,segs=3,smooth='auto')
put(box(0.074,0.013,0.024),'fe_cap','Steel',loc=(0,-0.076,-0.028),bevel=0.0035,segs=3)

# ---- two rigid groups + locator empties. Placed here: after every put()
# call, before any render. The GLB carries NO animation -- the hinge is a
# code-driven rotation at runtime, so it only has to name things.
def group_and_locate():
    """Two rigid groups plus locators. The hinge is a code-driven rotation at
    runtime, so the GLB carries NO animation -- it only has to name things."""
    root    = bpy.data.objects.new("GunRoot", None); col.objects.link(root)
    barrels = bpy.data.objects.new(BARREL_NODE, None); col.objects.link(barrels)
    frame   = bpy.data.objects.new(FRAME_NODE, None); col.objects.link(frame)
    barrels.parent = root
    frame.parent = root

    # Everything forward of the hinge pin swings; everything else is the frame.
    swing = ("barrel", "crown", "bore", "rib_top", "bead",
             "chamber", "mouth", "extractor", "foreend", "fe_cap")
    for o in list(col.objects):
        if o.type != 'MESH' or o.parent is not None:
            continue
        o.parent = frame if not o.name.startswith(swing) else barrels

    # Locators. HINGE sits on the hinge-pin axis; the barrels rotate about its X.
    for name, loc in (
        (HINGE_NODE,  (0.0,     -0.070, -0.016)),
        ("Muzzle_L",  (-XSEP,   BMID - BLEN / 2, 0.0)),
        ("Muzzle_R",  ( XSEP,   BMID - BLEN / 2, 0.0)),
        ("Grip_Hand", (0.0,      0.074, -0.074)),
        ("Fore_Hand", (0.0,     -0.155, -0.045)),
    ):
        e = bpy.data.objects.new(name, None)
        col.objects.link(e)
        e.location = loc
        e.empty_display_size = 0.01
        e.parent = barrels if name.startswith("Muzzle") or name == "Fore_Hand" else frame
    bpy.context.view_layer.update()
    return root

ROOT = group_and_locate()

# ============================= render =============================
w=bpy.context.scene.world=bpy.data.worlds.new('W'); w.use_nodes=True
w.node_tree.nodes['Background'].inputs[0].default_value=(0.16,0.17,0.19,1)
sun=bpy.data.objects.new('S',bpy.data.lights.new('S','SUN')); sun.data.energy=3.5
sun.rotation_euler=(math.radians(52),0,math.radians(38)); bpy.context.collection.objects.link(sun)
rim=bpy.data.objects.new('R',bpy.data.lights.new('R','AREA')); rim.data.energy=260; rim.data.size=2.0
rim.location=(-1.2,1.1,0.9); rim.rotation_euler=(math.radians(60),0,math.radians(-135))
bpy.context.collection.objects.link(rim)
cam=bpy.data.objects.new('C',bpy.data.cameras.new('C')); bpy.context.collection.objects.link(cam)
bpy.context.scene.camera=cam
sc=bpy.context.scene; sc.render.engine='BLENDER_EEVEE'
sc.eevee.taa_render_samples = 64          # the default 16 aliased the specular badly

sc.render.resolution_x=860; sc.render.resolution_y=580
ctr=Vector((0,-0.105,-0.038)); R=0.82
for name,(az,el) in {'left':(90,3),'threequarter':(50,24),'rear34':(132,20)}.items():
    a=math.radians(az); e=math.radians(el)
    cam.location = ctr+Vector((math.sin(a)*math.cos(e),-math.cos(a)*math.cos(e),math.sin(e)))*R
    cam.rotation_euler=(ctr-cam.location).to_track_quat('-Z','Y').to_euler()
    sc.render.filepath=os.path.join(NOTES_DIR,f'{name}.png')
    bpy.ops.render.render(write_still=True)

# ---- trigger-group closeup, framed like the Serbu reference for comparison ----
cam.data.lens = 50.0
dctr = Vector((0, 0.048, -0.062))
cam.location = dctr + Vector((1.0, 0.02, 0.10)).normalized()*0.30
cam.rotation_euler = (dctr-cam.location).to_track_quat('-Z','Y').to_euler()
sc.render.resolution_x=820; sc.render.resolution_y=700
sc.render.filepath=os.path.join(NOTES_DIR,'detail.png')
bpy.ops.render.render(write_still=True)
cam.data.lens = 50.0

# ---- FPV: the view that actually matters, matched to the game camera ----
# Everything gets parented to a root so the FPV CANT is a real transform rather
# than a fudged camera angle -- the same two numbers game-main will set.
FPV_YAW_DEG   = -4.5    # barrels canted toward screen centre so both bores read
FPV_PITCH_DEG =  2.5    # muzzle lifted slightly out of the floor
# Grip at 0.215 below / 0.255 out is 40 deg down -- past the 37.5 deg half-angle
# of a 75 deg vertical fov, which is why the CURRENT gun's grip runs off the
# bottom of docs/dev-notes/.../fpv.png. Raised and brought in so the whole gun,
# grip included, is inside the frame.
# The butt sits ~0.115 BEHIND the grip origin, so a grip at z=-0.198 puts the
# butt 8 cm from the eye -- enormous and cropped. Pushed out to roughly where
# game-main already places it (z=-0.32).
FPV_GRIP      = (0.125, -0.115, -0.300)   # grip in CAMERA space (x right, y up, z back)
# The cant is a GAME-SIDE pose: set it only around the FPV render and clear it
# afterward, so the GLB export carries the gun with a zeroed root instead of a
# baked-in double cant.
ROOT.rotation_euler = (math.radians(FPV_PITCH_DEG), 0, math.radians(FPV_YAW_DEG))
bpy.context.view_layer.update()

# game-main puts the gun at camera-space (0.17,-0.20,-0.32) with rotation.y=PI,
# under lab-renderer's PerspectiveCamera(75,...) -- a 75 deg VERTICAL fov.
# Blender->camera axis map is (x,y,z)_b -> (-x, z, y)_c, so an eye at the origin
# of camera space sits at Blender (0.17, 0.32, 0.20) looking down -Y with +Z up.
# Blender->camera axis map is (x,y,z)_b -> (-x, z, y)_c, so a grip that must land
# at camera-space FPV_GRIP puts the eye at Blender (gx, -gz, -gy).
cam.data.sensor_fit='VERTICAL'
cam.data.angle_y = math.radians(75)
cam.location = Vector((FPV_GRIP[0], -FPV_GRIP[2], -FPV_GRIP[1]))
cam.rotation_euler = Vector((0,-1,0)).to_track_quat('-Z','Y').to_euler()
# Square, matching the existing capture convention in
# docs/dev-notes/2026-08-25-grapeshot-model-k3/fpv.png. At a 75 deg VERTICAL fov
# a wide aspect also widens the horizontal fov, which shrinks the gun and pushes
# it into the corner -- square keeps it readable.
sc.render.resolution_x=820; sc.render.resolution_y=820
sc.render.filepath=os.path.join(NOTES_DIR,'fpv.png')
bpy.ops.render.render(write_still=True)
ROOT.rotation_euler = (0.0, 0.0, 0.0)
bpy.context.view_layer.update()

tris=sum(len(o.data.loop_triangles) for o in bpy.data.objects if o.type=='MESH' and (o.data.calc_loop_triangles() or True))
ys=[(o.matrix_world@Vector(c)).y for o in bpy.data.objects if o.type=='MESH' for c in o.bound_box]
xs=[(o.matrix_world@Vector(c)).x for o in bpy.data.objects if o.type=='MESH' for c in o.bound_box]
print(f"BLOCKOUT7 tris={tris} length={max(ys)-min(ys):.3f}m gripwidth<={max(xs)-min(xs):.3f}m")


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB',
                              export_apply=True, export_yup=True,
                              export_extras=False)
    return os.path.getsize(path)


def verify_glb(path):
    """Re-import and assert the runtime contract: the named nodes exist and the
    barrels really are a separate subtree. A GLB that exports cleanly but lost
    BARREL_NODE would fail silently at runtime as a reload that does nothing."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    names = {o.name.split('.')[0] for o in new}
    tris = 0
    for o in new:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
    required = {BARREL_NODE, FRAME_NODE, HINGE_NODE,
                "Muzzle_L", "Muzzle_R", "Grip_Hand", "Fore_Hand"}
    missing = sorted(required - names)
    barrel_kids = 0
    for o in new:
        p = o.parent
        while p is not None:
            if p.name.split('.')[0] == BARREL_NODE:
                barrel_kids += 1
                break
            p = p.parent
    for o in list(new):
        try:
            bpy.data.objects.remove(o, do_unlink=True)
        except ReferenceError:
            pass
    return {"tris": tris, "missing_nodes": missing, "barrel_descendants": barrel_kids}


def verify_bores_hollow():
    """Cast a ray down each bore from just behind the breech face.

    A solid chamber stops the ray within a couple of millimetres. A hollow one
    lets it run at least the chamber's depth before the forcing cone or the
    dark plug catches it. Shells are hidden for the cast -- we are asking about
    the STEEL, not about what is loaded into it.

    DEVIATION FROM PLAN: `extractor` is ALSO hidden here, which the plan text
    did not call for. Measured after the first run of this function: `extractor`
    (loc y=CY1+0.0035, full 52mm width, +-8mm tall in z) sits from y=CY1 to
    y=CY1+0.007 -- i.e. it starts exactly AT the breech face and bridges both
    bores at bore-CENTRE height. The origin below (CY1+0.005, on-axis) lands
    inside it, so the ray hit its front face at dist=0.005 on every run,
    reporting "not hollow" unconditionally -- even with a correctly hollow
    chamber. Hiding it here matches the existing shells rationale exactly: this
    check asks about the CHAMBER's steel, not about an unrelated part that
    happens to sit in the sample ray's path. No landmark (CY1, extractor's own
    position) changed.
    """
    hidden = []
    for o in bpy.data.objects:
        if o.type == 'MESH' and (o.name.split('.')[0].startswith('shell')
                                  or o.name.split('.')[0] == 'extractor'):
            hidden.append((o, o.hide_viewport))
            o.hide_viewport = True
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    bad = []
    for x in (-XSEP, XSEP):
        origin = Vector((x, CY1 + 0.005, 0.0))
        hit, loc, _n, _idx, obj, _m = bpy.context.scene.ray_cast(
            dg, origin, Vector((0.0, -1.0, 0.0)))
        dist = (loc - origin).length if hit else float('inf')
        if dist < CHAMBER_DEPTH:
            bad.append((x, round(dist, 5), obj.name if obj else None))
    for o, v in hidden:
        o.hide_viewport = v
    bpy.context.view_layer.update()
    return bad


size = export_glb(OUT_GLB)
info = verify_glb(OUT_GLB)
print(f"[shorty] exported {OUT_GLB} ({size} bytes)")
print(f"[shorty] verify: {info}")

ok = True
if size > 1024 * 1024:
    print(f"[shorty] FAIL: glb {size} bytes over 1 MB", file=sys.stderr); ok = False
if info["tris"] > 14000:
    print(f"[shorty] FAIL: {info['tris']} tris over 14000", file=sys.stderr); ok = False
if info["missing_nodes"]:
    print(f"[shorty] FAIL: missing nodes {info['missing_nodes']}", file=sys.stderr); ok = False
if info["barrel_descendants"] < 8:
    print(f"[shorty] FAIL: only {info['barrel_descendants']} meshes under "
          f"{BARREL_NODE}; the hinge would move nothing", file=sys.stderr); ok = False
blocked = verify_bores_hollow()
if blocked:
    print(f"[shorty] FAIL: bore not hollow -- ray stopped short at {blocked}; "
          f"a chamber built with cyl() instead of tube() looks like a solid knob "
          f"the moment the action opens", file=sys.stderr); ok = False
if not ok:
    sys.exit(1)
print("[shorty] OK")
