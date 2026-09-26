# scripts/model_censer.py — the censer flail (spec docs/superpowers/specs/2026-09-26-censer-flail-design.md §4.4).
#
# A funeral thurible knotted to a snapped brass altar candlestick. Exports
# public/assets/lab/censer.glb with the nodes game-censer.ts reads:
#   Haft (grip at origin), ChainAnchor (empty under Haft, the knot), Head (bowl
#   centred on its origin, ring up), CoalGlow (under Head), ChainLink (one link).
# Renders docs/dev-notes/2026-09-26-censer/censer-model.png (haft + head),
# haft-closeup.png (haft alone, 3/4 view) and head-closeup.png (head alone,
# 3/4 view from slightly above), and re-imports the GLB to assert the node
# contract.
#
# The haft is a lathe-turned "gothic mourning" candlestick (owner's combined
# pick of the Gothic and Worn/mourning options explored earlier):
#   - hexagonal-section stem sections, a flattened knop with 6 lozenge bosses
#     (Gothic), and a spiky crenellated broken socket over a flared drip pan.
#   - a black mourning ribbon wound helically round the grip with a short
#     trailing tail, and pale wax drips running from the broken socket down
#     over the pan and a little way onto the stem (Worn/mourning).
#   - brass with a darker patina in the recesses.
#
# The head is a rusted, pitted iron thurible studded with spikes and a band
# of small skulls, brass only on the rim trim and finial:
#   - RustIron main shell; brass rim band + finial tie it to the haft.
#   - a band of small skull beads round the equator (cranium + jaw + inset
#     eye-socket spheres), with a matching pair of small holes pierced
#     through the shell right behind each skull's eyes so CoalGlow shows.
#   - gothic-arch piercings around the upper lid, short spikes studding the
#     lower bowl.
#
# Run:  blender -b --factory-startup -P scripts/model_censer.py
# Metres. Blender space: Z up (glTF export turns it into +Y up).
import bpy, bmesh, math, os
from mathutils import Vector

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB = os.path.join(REPO_ROOT, "public", "assets", "lab", "censer.glb")
NOTES_DIR = os.path.join(REPO_ROOT, "docs", "dev-notes", "2026-09-26-censer")
os.makedirs(NOTES_DIR, exist_ok=True)

HAFT_TOP = 0.30
HEAD_R = 0.065
REQUIRED = {"Haft", "ChainAnchor", "Head", "CoalGlow", "ChainLink"}
MAX_TRIS = 12000

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, metal, rough, emit=None, strength=0.0):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    # Workbench's MATERIAL color mode (used for the preview renders) reads
    # diffuse_color, not the Principled BSDF nodes — set both so the preview
    # actually shows brass/iron/glow instead of flat gray.
    m.diffuse_color = (*(emit if emit else color), 1)
    m.metallic = metal
    m.roughness = rough
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        key = "Emission Color" if "Emission Color" in b.inputs else "Emission"
        b.inputs[key].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


BRASS = mat("Brass", (0.62, 0.45, 0.18), 1.0, 0.35)
PATINA = mat("BrassPatina", (0.16, 0.28, 0.19), 0.7, 0.55)   # tarnished green-brass, recessed collars
IRON = mat("Iron", (0.09, 0.085, 0.08), 0.9, 0.55)
GLOW = mat("CoalGlow", (0.05, 0.01, 0.0), 0.0, 0.9, emit=(1.0, 0.38, 0.08), strength=6.0)
RIBBON = mat("Ribbon", (0.02, 0.015, 0.018), 0.0, 0.8)
WAX = mat("Wax", (0.85, 0.80, 0.68), 0.0, 0.4)
RUST = mat("RustIron", (0.30, 0.13, 0.07), 0.15, 0.9)         # main censer head shell — dark rusted iron
RUST_DARK = mat("RustIronDark", (0.17, 0.08, 0.05), 0.1, 0.95)  # pitted variant for tonal variety
BONE = mat("Bone", (0.80, 0.75, 0.63), 0.0, 0.65)


def assign(o, m):
    o.data.materials.clear()
    o.data.materials.append(m)


def smooth(o, angle_deg=40):
    # Shade curved surfaces smooth while keeping hard edges (collars, teeth,
    # bosses, slot cuts) crisp — split by face angle, not a blanket smooth.
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    return o


def cone(name, r1, r2, depth, z, verts=16, m=BRASS, loc_xy=(0.0, 0.0), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth,
                                    location=(loc_xy[0], loc_xy[1], z), rotation=rot)
    o = bpy.context.object
    o.name = name
    assign(o, m)
    return o


def torus(name, major, minor, z, m=BRASS, rot=(0, 0, 0), segs=20):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=segs,
                                     minor_segments=8, location=(0, 0, z), rotation=rot)
    o = bpy.context.object
    o.name = name
    assign(o, m)
    return o


def join(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o


def lathe(name, profile, segments=32, m=BRASS):
    """Revolve a (r, z) polyline profile (bottom -> top) around Z into a solid
    of revolution — how a real turned candlestick is actually made. Any r=0
    end collapses to a single point (self-capping); a genuinely open ring
    (nonzero r at an end) is filled so the mesh stays closed."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0.0, z)) for r, z in profile]
    for i in range(len(verts) - 1):
        bm.edges.new((verts[i], verts[i + 1]))
    bmesh.ops.spin(bm, geom=list(bm.verts) + list(bm.edges), axis=(0, 0, 1),
                   angle=math.radians(360), steps=segments, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    boundary = [e for e in bm.edges if e.is_boundary]
    if boundary:
        bmesh.ops.edgeloop_fill(bm, edges=boundary)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    assign(o, m)
    return o


def boss(name, loc, r, depth, m=PATINA, rot=(0, 0, 0)):
    # A small lozenge/diamond boss: two 4-sided cones glued base-to-base.
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=r, radius2=0.0, depth=depth, location=loc, rotation=rot)
    a = bpy.context.object
    a.name = name + "_a"
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=r, radius2=0.0, depth=depth, location=loc,
                                    rotation=(rot[0] + math.pi, rot[1], rot[2]))
    b = bpy.context.object
    b.name = name + "_b"
    o = join(name, [a, b])
    assign(o, m)
    return o


def helix_strip(name, radius, z0, turns, height, width=0.011, thickness=0.0012, m=RIBBON):
    # A ribbon's width runs crosswise to its direction of travel, not along
    # it — offsetting by the tangent (as an earlier version of this did)
    # collapses the two rails onto nearly the same point, rendering as a
    # thin wire instead of a flat strip. Use normal x travel instead.
    segs_per_turn = 20
    steps = max(2, int(turns * segs_per_turn))
    dt = (2 * math.pi) / segs_per_turn
    dz = height / steps
    bm = bmesh.new()
    top_v, bot_v = [], []
    for i in range(steps + 1):
        t = i * dt
        z = z0 + height * (i / steps)
        center = Vector((math.cos(t) * radius, math.sin(t) * radius, z))
        normal = Vector((math.cos(t), math.sin(t), 0.0))
        travel = Vector((-math.sin(t) * radius * dt, math.cos(t) * radius * dt, dz)).normalized()
        width_dir = normal.cross(travel).normalized()
        top_v.append(bm.verts.new(center + width_dir * (width / 2)))
        bot_v.append(bm.verts.new(center - width_dir * (width / 2)))
    for i in range(steps):
        bm.faces.new((top_v[i], top_v[i + 1], bot_v[i + 1], bot_v[i]))
    bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=thickness)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    assign(o, m)
    return o


def broken_teeth(name, r, z, n, m=BRASS):
    # Spiky crenellated broken socket rim: alternating tall/short blocky
    # teeth (crenellation), with a couple deliberately uneven to read as
    # snapped rather than machine-regular.
    parts = []
    for i in range(n):
        a = i * 2 * math.pi / n + 0.2
        tall = (i % 2 == 0)
        h = (0.026 if tall else 0.014) + (0.006 if i in (1, 5) else 0.0)
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.0075, radius2=0.004, depth=h,
                                        location=(math.cos(a) * r, math.sin(a) * r, z + h / 2),
                                        rotation=(0, 0, a))
        t = bpy.context.object
        t.name = f"{name}_{i}"
        assign(t, m)
        parts.append(t)
    return join(name, parts)


def wax_drip(name, r, a, z_top, length, m=WAX):
    bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=0.0038, radius2=0.0006, depth=length,
                                    location=(math.cos(a) * r, math.sin(a) * r, z_top - length / 2))
    d = bpy.context.object
    d.name = name
    assign(d, m)
    return d


# ================================================================================
# --- The haft: gothic hexagonal stem + mourning ribbon --------------------------
# ================================================================================
def build_haft(haft_name="Haft", anchor_name="ChainAnchor"):
    foot = [(0.000, -0.020), (0.027, -0.013), (0.024, -0.004), (0.014, 0.002)]
    stem1 = [(0.013, 0.002), (0.012, 0.030), (0.012, 0.075), (0.014, 0.093)]
    knop = [(0.014, 0.093), (0.030, 0.104), (0.031, 0.116), (0.030, 0.128), (0.014, 0.139)]
    stem2 = [(0.013, 0.139), (0.013, 0.175), (0.013, 0.225), (0.014, 0.245)]
    pan = [(0.014, 0.245), (0.018, 0.258), (0.033, 0.270), (0.027, 0.276), (0.019, 0.283)]

    p_foot = lathe(haft_name + "_foot", foot, segments=32, m=BRASS)
    p_stem1 = lathe(haft_name + "_stem1", stem1, segments=6, m=BRASS)
    p_knop = lathe(haft_name + "_knop", knop, segments=32, m=BRASS)
    p_stem2 = lathe(haft_name + "_stem2", stem2, segments=6, m=BRASS)
    p_pan = lathe(haft_name + "_pan", pan, segments=32, m=BRASS)

    bosses = []
    for i in range(6):
        a = i * math.pi / 3 + math.pi / 6   # offset to sit on the hex flats
        bosses.append(boss(f"{haft_name}_boss{i}", (math.cos(a) * 0.031, math.sin(a) * 0.031, 0.116),
                            0.0075, 0.009, m=PATINA, rot=(math.pi / 2, 0, a)))

    teeth = broken_teeth(haft_name + "_teeth", 0.016, 0.283, 8, m=BRASS)
    knot = torus(haft_name + "_knot", 0.016, 0.005, 0.256, m=IRON)   # chain tied just under the pan

    # Tarnish: dark patina collars in the recessed fillets between sections.
    collars = [
        torus(haft_name + "_pc1", 0.0135, 0.0022, 0.093, m=PATINA),
        torus(haft_name + "_pc2", 0.0135, 0.0022, 0.139, m=PATINA),
        torus(haft_name + "_pc3", 0.0135, 0.0022, 0.245, m=PATINA),
    ]

    # Mourning ribbon: helical wrap around the grip zone (z 0.0-0.10), plus a
    # short trailing tail hanging past the wrap toward the foot.
    ribbon = helix_strip(haft_name + "_ribbon", 0.0155, 0.010, 3.4, 0.075, width=0.012, m=RIBBON)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0.0155, 0.0, -0.006))
    tail = bpy.context.object
    tail.name = haft_name + "_tail"
    tail.scale = (0.0015, 0.0105, 0.032)
    tail.rotation_euler = (math.radians(10), 0, 0.35)
    assign(tail, RIBBON)

    # Wax drips: running from the broken socket down over the pan and a
    # little way onto the stem below it.
    drips = [
        wax_drip(f"{haft_name}_drip0", 0.030, 0.5, 0.281, 0.034),
        wax_drip(f"{haft_name}_drip1", 0.025, 1.9, 0.278, 0.028),
        wax_drip(f"{haft_name}_drip2", 0.017, 3.3, 0.272, 0.045),   # reaches onto the stem
        wax_drip(f"{haft_name}_drip3", 0.029, 4.4, 0.280, 0.024),
        wax_drip(f"{haft_name}_drip4", 0.014, 5.6, 0.262, 0.030),
    ]

    haft = join(haft_name, [p_foot, p_stem1, p_knop, p_stem2, p_pan, teeth, knot] + collars + drips
                + [ribbon, tail] + bosses)
    smooth(haft)
    anchor = bpy.data.objects.new(anchor_name, None)
    bpy.context.collection.objects.link(anchor)
    anchor.parent = haft
    anchor.location = (0, 0, 0.256)
    return haft, anchor


haft, anchor = build_haft("Haft", "ChainAnchor")

# --- Head: rusted iron thurible, skulls + spikes, centred on the origin -------
bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=HEAD_R, location=(0, 0, 0))
bowl = bpy.context.object
bowl.name = "h_bowl"
assign(bowl, RUST)

N_ARCH = 6
N_SKULL = 5
SKULL_Z = -HEAD_R * 0.12
SKULL_R = HEAD_R * 0.97

def radial_box(a, z, width_y, height_z, r_out=None, r_in=-0.010):
    # A cutter box reaching from well outside the shell to just past the
    # sphere's centre. The boolean solver treats the closed sphere mesh as a
    # SOLID ball (everything its surface encloses counts as solid) — a box
    # that only grazes the outer surface just carves a shallow pocket with a
    # floor, not a hole into the hollow interior where CoalGlow sits. Going
    # past the centre (but not far enough to reach the antipodal surface)
    # opens a genuine channel without punching an unwanted second hole
    # through the far side.
    r_out = HEAD_R + 0.015 if r_out is None else r_out
    center_r = (r_out + r_in) / 2
    depth = r_out - r_in
    bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(a) * center_r, math.sin(a) * center_r, z))
    o = bpy.context.object
    o.scale = (depth, width_y, height_z)
    o.rotation_euler = (0, 0, a)
    return o


def boolean_cut(target, cutter_objs, mod_name):
    # Two smaller, single-purpose boolean passes (rather than one giant
    # multi-piece cutter) proved much more reliable — a single mega-cutter
    # combining arches + eye-holes left some cuts incomplete (confirmed by
    # raycasting through the "holes" and hitting solid RustIron instead of
    # passing through to CoalGlow).
    cutter = join(mod_name + "_cutter", cutter_objs)
    mod = target.modifiers.new(mod_name, 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cutter
    bpy.ops.object.select_all(action='DESELECT')
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod_name)
    bpy.data.objects.remove(cutter, do_unlink=True)


# Gothic-arch piercings around the upper lid: a tall narrow box topped with a
# pyramid point, so the coal shows through pointed lancet windows.
arch_cutters = []
for i in range(N_ARCH):
    a = i * 2 * math.pi / N_ARCH
    box = radial_box(a, HEAD_R * 0.42, 0.017, 0.046)
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.018, radius2=0.0, depth=0.022,
                                    location=(math.cos(a) * HEAD_R, math.sin(a) * HEAD_R, HEAD_R * 0.42 + 0.032))
    cap = bpy.context.object
    cap.rotation_euler = (0, 0, a + math.pi / 4)
    arch_cutters += [box, cap]
boolean_cut(bowl, arch_cutters, "arches")

# A matching pair of small eye-holes pierced through the shell behind each
# skull, so CoalGlow shows through the skulls' eyes.
EYE_DELTA = 0.0038 / HEAD_R   # angular half-spacing matching the skull's eye offset
eye_cutters_bowl = []
for i in range(N_SKULL):
    a = i * 2 * math.pi / N_SKULL
    for side in (-1, 1):
        ea = a + side * EYE_DELTA
        eye_cutters_bowl.append(radial_box(ea, SKULL_Z, 0.0036, 0.0036))
boolean_cut(bowl, eye_cutters_bowl, "eyeholes")

rim = torus("h_rim", HEAD_R * 0.98, 0.004, 0.0, m=BRASS)               # brass trim
foot = cone("h_foot_ring", HEAD_R * 0.45, HEAD_R * 0.5, 0.012, -HEAD_R * 0.98, m=RUST_DARK)
finial = cone("h_finial", 0.008, 0.002, 0.03, HEAD_R + 0.012, m=BRASS)  # brass trim
ring = torus("h_ring", 0.014, 0.003, HEAD_R + 0.07, rot=(math.pi / 2, 0, 0), m=IRON)
chains = []
for i in range(3):
    a = i * 2 * math.pi / 3 + math.radians(30)   # offset off the arch/eye-hole angles so no chain blocks a piercing
    p0 = Vector((math.cos(a) * HEAD_R * 0.95, math.sin(a) * HEAD_R * 0.95, 0.0))
    p1 = Vector((0, 0, HEAD_R + 0.058))
    d = p1 - p0
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.0022, depth=d.length, location=(p0 + p1) / 2)
    s = bpy.context.object
    s.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    assign(s, IRON)
    chains.append(s)

# Short spikes studding the lower bowl.
spikes = []
SPIKE_LAT = -HEAD_R * 0.55
for i in range(8):
    a = i * 2 * math.pi / 8 + math.pi / 8
    base = Vector((math.cos(a) * HEAD_R * 0.94, math.sin(a) * HEAD_R * 0.94, SPIKE_LAT))
    outward = base.normalized()
    bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.006, radius2=0.0, depth=0.020,
                                    location=base + outward * 0.010)
    sp = bpy.context.object
    sp.rotation_euler = outward.to_track_quat('Z', 'Y').to_euler()
    assign(sp, RUST)
    spikes.append(sp)

# A band of small skull beads round the equator: cranium (with two eye
# sockets actually punched through it, so CoalGlow shows through for real,
# not a dark sphere sitting in front of the light) + jaw, each pointing
# outward, sitting over the matching eye-holes cut into the bowl above.
bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.0095, location=(0, 0, 0))
cranium = bpy.context.object
cranium.name = "sk_cranium"
cranium.scale = (0.95, 1.0, 0.92)
assign(cranium, BONE)
eye_cutters = []
for s in (-1, 1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.0032,
                                         location=(0.0082, s * 0.0038, 0.001))
    ec = bpy.context.object
    ec.name = "sk_eyecut"
    eye_cutters.append(ec)
eye_cutter = join("sk_eyecut_joined", eye_cutters)
eye_mod = cranium.modifiers.new("eyes", 'BOOLEAN')
eye_mod.operation = 'DIFFERENCE'
eye_mod.object = eye_cutter
bpy.ops.object.select_all(action='DESELECT')
cranium.select_set(True)
bpy.context.view_layer.objects.active = cranium
bpy.ops.object.modifier_apply(modifier="eyes")
bpy.data.objects.remove(eye_cutter, do_unlink=True)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0.0045, 0.0, -0.006))
jaw = bpy.context.object
jaw.name = "sk_jaw"
jaw.scale = (0.011, 0.013, 0.0075)
assign(jaw, BONE)
skull_tpl = join("sk_tpl", [cranium, jaw])

skulls = [skull_tpl]
skull_tpl.location = (SKULL_R, 0, SKULL_Z)
skull_tpl.rotation_euler = (0, 0, 0)
for i in range(1, N_SKULL):
    a = i * 2 * math.pi / N_SKULL
    dup = skull_tpl.copy()
    dup.data = skull_tpl.data
    dup.name = f"sk_tpl{i}"
    bpy.context.collection.objects.link(dup)
    dup.location = (math.cos(a) * SKULL_R, math.sin(a) * SKULL_R, SKULL_Z)
    dup.rotation_euler = (0, 0, a)
    skulls.append(dup)

head = join("Head", [bowl, rim, foot, finial, ring] + chains + spikes + skulls)
smooth(head)

bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=HEAD_R * 0.55, location=(0, 0, 0))
coal = bpy.context.object
coal.name = "CoalGlow"
assign(coal, GLOW)
smooth(coal)
coal.parent = head
head.location = (0.3, 0, 0)          # beside the haft in the file; the runtime zeroes it

# --- One chain link: an oval ring, long axis +Z here (+Y in glTF) ---------------
bpy.ops.mesh.primitive_torus_add(major_radius=0.010, minor_radius=0.0025, major_segments=12,
                                 minor_segments=6, location=(0.5, 0, 0), rotation=(math.pi / 2, 0, 0))
link = bpy.context.object
link.name = "ChainLink"
link.scale = (1.0, 1.6, 1.0)
assign(link, IRON)
bpy.ops.object.select_all(action='DESELECT')
link.select_set(True)
bpy.context.view_layer.objects.active = link
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
print(f"[censer] ChainLink bbox dims (Blender space, Z=long axis): {tuple(round(d, 5) for d in link.dimensions)}")
smooth(link)

# --- Preview render: real materials (EEVEE), workbench only as a fallback ------
WORLD = bpy.data.worlds.new("PreviewWorld")
WORLD.use_nodes = True
WORLD.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.03, 0.03, 1)
WORLD.node_tree.nodes["Background"].inputs[1].default_value = 1.0
bpy.context.scene.world = WORLD


def light_rig(target):
    # Simple three-point rig (key / fill / rim) around the subject.
    specs = [
        ("key", 4.5, (1.0, 0.97, 0.9), (target[0] + 0.22, target[1] - 0.30, target[2] + 0.28)),
        ("fill", 1.8, (0.75, 0.8, 0.95), (target[0] - 0.28, target[1] - 0.18, target[2] + 0.10)),
        ("rim", 2.8, (1.0, 0.55, 0.25), (target[0] - 0.05, target[1] + 0.32, target[2] + 0.22)),
    ]
    lights = []
    for name, power, color, loc in specs:
        ld = bpy.data.lights.new(name, type='POINT')
        ld.energy = power
        ld.color = color
        ld.shadow_soft_size = 0.05
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        bpy.context.collection.objects.link(lo)
        lights.append(lo)
    return lights


def render(path, loc, target, res=(1000, 750), ortho=False, ortho_scale=0.4):
    # Aim the camera at `target` exactly via look-at math (manually guessed
    # euler angles left the subject badly off-centre) — direction is target
    # minus camera location, camera -Z looks forward, +Y is up.
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = loc
    direction = (Vector(target) - Vector(loc)).normalized()
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = ortho_scale
    bpy.context.scene.camera = cam
    lights = light_rig(target)
    bpy.context.scene.render.resolution_x = res[0]
    bpy.context.scene.render.resolution_y = res[1]
    bpy.context.scene.render.filepath = path
    try:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE'
        bpy.context.scene.eevee.taa_render_samples = 32
        bpy.ops.render.render(write_still=True)
    except Exception as e:
        print(f"[censer] EEVEE render failed ({e}); falling back to Workbench.")
        bpy.context.scene.render.engine = 'BLENDER_WORKBENCH'
        bpy.context.scene.display.shading.color_type = 'MATERIAL'
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    for lo in lights:
        bpy.data.objects.remove(lo, do_unlink=True)


render(os.path.join(NOTES_DIR, "censer-model.png"), (0.25, -0.9, 0.25), target=(0.15, 0, 0.15))

# Close-up 3/4 view of the haft alone (whole 0.30 m height, not just the knop) —
# hide the head so it doesn't creep into the corner of a haft-only shot.
head.hide_render = True
coal.hide_render = True
render(os.path.join(NOTES_DIR, "haft-closeup.png"), (0.50, -0.72, 0.42), target=(0, 0, 0.15))
head.hide_render = False
coal.hide_render = False

# Close-up 3/4 view of the head alone, slightly from above — hide the haft.
haft.hide_render = True
render(os.path.join(NOTES_DIR, "head-closeup.png"), (0.30 + 0.22, -0.26, 0.15), target=(0.3, 0, 0.0))
haft.hide_render = False

# --- Export + verify -------------------------------------------------------------
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', export_apply=True, export_yup=True)
size = os.path.getsize(OUT_GLB)

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=OUT_GLB)
new = [o for o in bpy.data.objects if o not in before]
names = {o.name.split('.')[0] for o in new}
tris = 0
for o in new:
    if o.type == 'MESH':
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
missing = sorted(REQUIRED - names)
print(f"[censer] exported {OUT_GLB} ({size} bytes, {tris} tris); nodes {sorted(names)}")
if missing:
    raise SystemExit(f"[censer] FAIL: missing nodes {missing}")
if tris > MAX_TRIS:
    raise SystemExit(f"[censer] FAIL: {tris} tris > {MAX_TRIS}")
print("[censer] PASS")
