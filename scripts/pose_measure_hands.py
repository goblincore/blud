"""Pose a real rigged hand mesh, MEASURE it into capsules, and bake height sheets.

SOURCE MODEL (ground truth, never redistributed)
------------------------------------------------
    "First Person hands rigged" by DavidFischer (Sketchfab)
    https://sketchfab.com/3d-models/first-person-hands-rigged-547a45535f0c4fe787948f7a7a6a88db
    Licence: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
    Author must be credited; commercial use and adaptation allowed.

Read from an absolute path OUTSIDE the repo (see SRC below). **The model, its
.bin, and its textures are NEVER copied into this repository** — not even
temporarily. What this script commits is (a) MEASUREMENTS, which are facts, and
(b) derived grayscale height sheets, which are an adaptation and therefore carry
the attribution line in `public/assets/lab/hand-detail.json` and in the dev note.
The second pack in the same download directory (`free-fps-hands/`) has NO licence
file anywhere and is deliberately never opened by this script.

WHY THIS SCRIPT DOES ITS OWN SKINNING
-------------------------------------
`bpy.ops.import_scene.gltf` loads the mesh and skin weights correctly, and the
EVALUATED rest mesh is right. But the imported armature's rest data is corrupt:
a spurious scale of 100 on the joint nodes leaves every bone below the two root
joints compressed ~100x toward its parent, and each chain's `_end_` joint has a
degenerate inverse-bind matrix. Bone heads therefore do NOT sit at the mesh's
real joints, so rotating pose bones pivots in the wrong places. The glTF's
`inverseBindMatrices` ARE self-consistent with the mesh (verified: for every real
joint, nodeGlobal @ IBM == 100*I), so this script takes joint rest frames from
inverse(IBM) and runs its own linear-blend skinning over the glTF's JOINTS_0 /
WEIGHTS_0. The importer is still invoked, for inspection and cross-checks.

MEASUREMENT FRAME (per hand — see also the header of hand-measured.ts)
---------------------------------------------------------------------
    O  = the point on the prop's axis where the hand closes on it
    +Z = along the prop axis toward its business end
         (bundle: up out of the fist; cigarette: toward the lit end)
    +X = the back-of-hand outward normal (away from the palm)
    +Y = Z x X
Right-handed by construction. Metres.

SHEET FRAME (both sheets, matching the pre-existing contract in hands.ts)
------------------------------------------------------------------------
    image +X (right) = that hand's THUMB side
    image +Y (up)    = WRIST -> KNUCKLES   (wrist at the image bottom)
    viewed down the hand's own back-normal, square orthographic camera.
Because one hand is a right hand and the other a left, forcing thumb-right on
both means exactly one sheet is a MIRROR of its true back view (the right hand's
`grip`). That is inherent to the shared convention, not a defect; the bake-space
basis determinant is printed per hand, and the mirror is applied by the basis
itself so nothing else has to know.

Height encoding: unlit Emission driven by depth along the view axis through a
clamped Map Range, so luminance IS height, nearest-to-camera brightest,
normalised per sheet over that hand's own visible depth band. The floor is
clamped so no opaque pixel is dark: the STORED (sRGB-encoded) range is
HEIGHT_FLOOR..1.0, which is why the Map Range's linear floor is
srgb_to_linear(HEIGHT_FLOOR). Alpha masks the hand (film_transparent), view
transform Standard, and the prop is excluded from the bake.

Deterministic: no randomness; every angle is either a fixed constant or the result
of a fixed-iteration bisection / fixed-step contact scan. Re-running produces
pixel-identical sheets.

Run headless:
    blender --background --python scripts/pose_measure_hands.py
    blender --background --python scripts/pose_measure_hands.py -- --debug-views

Outputs:
    src/lab/sdf-zombie/hand-measured.ts            (capsule table, data only)
    public/assets/lab/hand-detail-grip.png         (256x256 RGBA height map)
    public/assets/lab/hand-detail-pinch.png        (256x256 RGBA height map)
    public/assets/lab/hand-detail.json             (means, halfScaleM, attribution)
    docs/dev-notes/2026-08-17-hand-detail-bake/{grip,pinch}-preview.png (512px lit)

Also runnable under plain python3 to recompute just the manifest from the PNGs:
    python3 scripts/pose_measure_hands.py --manifest-only
"""

import json
import math
import shutil
import struct
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LAB_DIR = REPO_ROOT / "public" / "assets" / "lab"
NOTE_DIR = REPO_ROOT / "docs" / "dev-notes" / "2026-08-17-hand-detail-bake"
MANIFEST_PATH = LAB_DIR / "hand-detail.json"
TS_PATH = REPO_ROOT / "src" / "lab" / "sdf-zombie" / "hand-measured.ts"

# The licensed source model. Absolute, outside the repo, read-only, never copied.
SRC = Path("/Users/donny/Downloads/fps hands/first_person_hands_rigged/scene.gltf")

ATTRIBUTION = (
    'This work is based on "First Person hands rigged" '
    "(https://sketchfab.com/3d-models/first-person-hands-rigged-547a45535f0c4fe787948f7a7a6a88db) "
    "by DavidFischer (https://sketchfab.com/davidfischer) licensed under CC-BY-4.0 "
    "(http://creativecommons.org/licenses/by/4.0/)"
)

KNUCKLE_SPAN_M = 0.085      # index MCP -> pinky MCP, the normalisation target
GRIP_PROP_R = 0.030         # dynamite bundle radius
PINCH_PROP_R = 0.0045       # cigarette radius
FOREARM_LEN = 0.25          # forearm capsule stub length

HEIGHT_RES = 256
PREVIEW_RES = 512
FRAME_FILL = 0.92           # hand fills 92% of the sheet -> ~4% margin a side
HEIGHT_FLOOR = 0.35         # STORED (sRGB) floor so no opaque pixel is dark
# The interesting relief (knuckle bumps, extensor tendons) lives in ~8 mm of the
# ~50 mm the posed hand spans front-to-back, so a 5th-percentile band spent most
# of the sheet's contrast on the fingers wrapped round the far side and left the
# back of the hand a flat white plateau. Clipping hard at BOTH ends puts the range
# on the dorsal shell, which is the only part the sheet is projected onto.
FLOOR_PERCENTILE = 34.0     # depth histogram fraction allowed to clamp to floor
CEIL_PERCENTILE = 99.0      # ...and to clamp to white
HIST_BINS = 512
BISECT_ITERS = 48

SHEETS = ("grip", "pinch")

DEBUG_VIEWS = "--debug-views" in sys.argv

try:
    import bpy
    from mathutils import Matrix, Vector
    IN_BLENDER = True
except ImportError:                                   # plain python3 mode
    IN_BLENDER = False


# ===========================================================================
# Manifest mode (needs PIL, which Blender's bundled python does not have)
# ===========================================================================

def compute_sheet_stats(png_path):
    """Mean / min / max luminance (0..1) over FULLY OPAQUE pixels only."""
    from PIL import Image

    img = Image.open(png_path)
    if img.mode != "RGBA":
        raise SystemExit(f"{png_path}: expected RGBA, got {img.mode}")
    px = img.load()
    w, h = img.size
    total = 0.0
    count = 0
    lo, hi = 1.0, 0.0
    clear = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                clear += 1
            if a != 255:
                continue
            lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
            total += lum
            count += 1
            lo = min(lo, lum)
            hi = max(hi, lum)
    if count == 0:
        raise SystemExit(f"{png_path}: no opaque pixels")
    if clear == 0:
        raise SystemExit(f"{png_path}: no fully transparent pixels")
    return {"size": (w, h), "opaque": count, "clear": clear,
            "mean": total / count, "min": lo, "max": hi}


def parse_half_args(argv):
    """--half grip=0.0812 --half pinch=0.1123"""
    out = {}
    for i, a in enumerate(argv):
        if a == "--half" and i + 1 < len(argv):
            k, _, v = argv[i + 1].partition("=")
            out[k] = float(v)
    return out


def write_manifest():
    halves = parse_half_args(sys.argv)
    if not halves and MANIFEST_PATH.exists():           # preserve on a means-only rerun
        try:
            prev = json.loads(MANIFEST_PATH.read_text())
            for k, v in prev.get("sheets", {}).items():
                if "halfScaleM" in v:
                    halves[k] = v["halfScaleM"]
        except (ValueError, OSError):
            pass

    sheets = {}
    for name in SHEETS:
        rel = f"hand-detail-{name}.png"
        st = compute_sheet_stats(LAB_DIR / rel)
        if st["size"] != (HEIGHT_RES, HEIGHT_RES):
            raise SystemExit(f"{rel}: expected {HEIGHT_RES}^2, got {st['size']}")
        if st["min"] < 0.30:
            raise SystemExit(f"{rel}: opaque luminance min {st['min']:.3f} < 0.30 floor")
        entry = {"file": rel, "mean": round(st["mean"], 3)}
        if name in halves:
            entry["halfScaleM"] = round(halves[name], 5)
        sheets[name] = entry
        print(f"[hands] {rel}: {st['size'][0]}x{st['size'][1]} opaque={st['opaque']} "
              f"clear={st['clear']} mean={st['mean']:.4f} "
              f"min={st['min']:.3f} max={st['max']:.3f}")
    MANIFEST_PATH.write_text(json.dumps(
        {"sheets": sheets, "attribution": ATTRIBUTION}, indent=2) + "\n")
    print(f"[hands] manifest -> {MANIFEST_PATH}")


# Manifest mode stays a documented `python3 pose_measure_hands.py --manifest-only`
# command: only when REALLY executed as a script, never on import (the SDF
# baker and these tests import the helpers without Blender or the PNGs).
if not IN_BLENDER and __name__ == "__main__":
    write_manifest()
    sys.exit(0)


# ===========================================================================
# glTF reader (buffers only -- geometry, skin weights, inverse-bind matrices)
# ===========================================================================

COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2),
        5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class Gltf:
    def __init__(self, path):
        self.doc = json.loads(path.read_text())
        self.buf = (path.parent / self.doc["buffers"][0]["uri"]).read_bytes()

    def accessor(self, index):
        a = self.doc["accessors"][index]
        fmt, size = COMP[a["componentType"]]
        n = NCOMP[a["type"]]
        bv = self.doc["bufferViews"][a["bufferView"]]
        base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride") or size * n
        unpack = struct.Struct("<" + fmt * n).unpack_from
        return [unpack(self.buf, base + k * stride) for k in range(a["count"])]

    def joint_rest_frames(self):
        """inverse(inverseBindMatrix) per joint = its rest frame in mesh space.

        Degenerate joints (the `_end_` leaves, whose IBMs are not invertible in
        any useful sense) are dropped.
        """
        skin = self.doc["skins"][0]
        names = [self.doc["nodes"][j].get("name") for j in skin["joints"]]
        out = {}
        for name, flat in zip(names, self.accessor(skin["inverseBindMatrices"])):
            m = Matrix(((flat[0], flat[4], flat[8], flat[12]),
                        (flat[1], flat[5], flat[9], flat[13]),
                        (flat[2], flat[6], flat[10], flat[14]),
                        (flat[3], flat[7], flat[11], flat[15])))
            scale = m.to_scale()
            if min(abs(s) for s in scale) < 1e-4 or name.find("_end_") >= 0:
                continue
            out[name] = m.inverted()
        return names, out

    def parents(self):
        out = {}
        for node in self.doc["nodes"]:
            for c in node.get("children", []):
                out[self.doc["nodes"][c].get("name")] = node.get("name")
        return out

    def skinned_geometry(self):
        """Every primitive, concatenated. Returns (positions, weights, faces, nail)."""
        skin = self.doc["skins"][0]
        jnames = [self.doc["nodes"][j].get("name") for j in skin["joints"]]
        pos, wts, faces, nail = [], [], [], []
        for mi, mesh in enumerate(self.doc["meshes"]):
            for prim in mesh["primitives"]:
                off = len(pos)
                p = self.accessor(prim["attributes"]["POSITION"])
                ji = self.accessor(prim["attributes"]["JOINTS_0"])
                wt = self.accessor(prim["attributes"]["WEIGHTS_0"])
                idx = [t[0] for t in self.accessor(prim["indices"])]
                for pp, jj, ww in zip(p, ji, wt):
                    pos.append(Vector(pp))
                    total = sum(w for w in ww if w > 0.0)
                    wts.append({jnames[a]: b / total for a, b in zip(jj, ww)
                                if b > 0.0} if total > 0 else {})
                    nail.append(mi == 1)
                faces += [(idx[k] + off, idx[k + 1] + off, idx[k + 2] + off)
                          for k in range(0, len(idx), 3)]
        return pos, wts, faces, nail


# ===========================================================================
# Import + inspect (the reporting step; geometry comes from the buffers)
# ===========================================================================

def reset_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for blocks in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras,
                   bpy.data.lights, bpy.data.images, bpy.data.armatures):
        for block in list(blocks):
            blocks.remove(block)
    if bpy.data.objects:
        raise SystemExit(f"scene not empty after reset: "
                         f"{[o.name for o in bpy.data.objects]}")
    world = bpy.data.worlds.new("Void")
    world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.0
    bpy.context.scene.world = world


def inspect_import():
    """Import with Blender's own operator and report what it gives, including the
    corrupt armature rest data that forces the manual-skinning path."""
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(SRC))
    print("\n[hands] ---- bpy.ops.import_scene.gltf report ----")
    meshes, arms = [], []
    for obj in bpy.data.objects:
        kind = obj.type
        if kind == "MESH":
            meshes.append(obj)
            print(f"[hands]   MESH     {obj.name!r} verts={len(obj.data.vertices)} "
                  f"tris={len(obj.data.polygons)} vgroups={len(obj.vertex_groups)} "
                  f"mods={[m.type for m in obj.modifiers]} "
                  f"mats={[m.name for m in obj.data.materials if m]}")
        elif kind == "ARMATURE":
            arms.append(obj)
        else:
            print(f"[hands]   {kind:8s} {obj.name!r} scale={tuple(round(c, 3) for c in obj.scale)}")
    for arm in arms:
        bones = arm.data.bones
        print(f"[hands]   ARMATURE {arm.name!r} bones={len(bones)}")
        print(f"[hands]     chains: {sorted({b.name.split('.')[0] for b in bones})}")
    print(f"[hands]   images (textures) in file: {[i.name for i in bpy.data.images]}")

    dg = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e18,) * 3)
    hi = Vector((-1e18,) * 3)
    for obj in meshes:
        ev = obj.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            p = ev.matrix_world @ v.co
            for i in range(3):
                lo[i] = min(lo[i], p[i])
                hi[i] = max(hi[i], p[i])
        ev.to_mesh_clear()
    print(f"[hands]   EVALUATED rest bbox size = "
          f"{tuple(round(hi[i] - lo[i], 3) for i in range(3))} (arbitrary units)")
    print("[hands]   armature rest data is SCALE-CORRUPT (descendant bones "
          "compressed ~100x, `_end_` joints degenerate) -> pose bones unusable; "
          "using inverse(IBM) frames + own LBS.")
    print("[hands] ---- end import report ----\n")


# ===========================================================================
# Rig model: joint chains, own forward kinematics, own linear-blend skinning
# ===========================================================================

FINGERS = ("index", "middle", "ring", "pinky")


class Hand:
    """One side's posable hand: joint pivots, weights, geometry, all in metres."""

    def __init__(self, gltf, side):
        self.side = side
        names, rest = gltf.joint_rest_frames()
        self.parent_of = gltf.parents()
        pos, wts, faces, nail = gltf.skinned_geometry()

        def find(prefix):
            hits = [n for n in rest if n.startswith(prefix)]
            if len(hits) != 1:
                raise SystemExit(f"joint prefix {prefix!r} matched {hits}")
            return hits[0]

        self.wrist = find(f"hand.{side}_")
        self.elbow = find(f"forearm.{side}_")
        self.meta = {f: find(f"palm_{f}.{side}_") for f in FINGERS}
        self.ph = {f: [find(f"f_{f}.0{k}.{side}_") for k in (1, 2, 3)] for f in FINGERS}
        self.thumb = [find(f"thumb.0{k}.{side}_") for k in (1, 2, 3)]

        self.chain = [self.wrist]
        for f in FINGERS:
            self.chain += [self.meta[f]] + self.ph[f]
        self.chain += self.thumb
        chainset = set(self.chain)

        def side_weight(w):
            return sum(v for k, v in w.items() if f".{side}" in k)

        keep = [i for i, w in enumerate(wts) if side_weight(w) > 0.5]
        keepset = set(keep)
        remap = {old: new for new, old in enumerate(keep)}
        # Uniform scale so the knuckle span is exactly KNUCKLE_SPAN_M.
        span_raw = (rest[self.ph["index"][0]].to_translation()
                    - rest[self.ph["pinky"][0]].to_translation()).length
        self.scale = KNUCKLE_SPAN_M / span_raw
        self.span_raw = span_raw

        self.pivot = {n: rest[n].to_translation() * self.scale for n in rest}
        self.rest_pos = [pos[i] * self.scale for i in keep]
        self.weights_all = [wts[i] for i in keep]
        self.weights = [{k: v for k, v in wts[i].items() if k in chainset} for i in keep]
        self.free = [1.0 - sum(w.values()) for w in self.weights]   # arm-bound share
        self.nail = [nail[i] for i in keep]
        self.faces = [tuple(remap[c] for c in f) for f in faces
                      if all(c in keepset for c in f)]
        self.side_joints = [n for n in rest if f".{side}" in n]
        self.arm_joints = [n for n in self.side_joints if n not in chainset]

        # The sheet and the previews want the HAND, not the arm the model ships
        # with: anything more than half-bound to the hand chain, which cuts
        # cleanly at the wrist.
        self.is_hand = [f > 0.5 for f in (1.0 - x for x in self.free)]
        hand_idx = [i for i, h in enumerate(self.is_hand) if h]
        hand_set = set(hand_idx)
        hmap = {old: new for new, old in enumerate(hand_idx)}
        self.hand_idx = hand_idx
        self.hand_faces = [tuple(hmap[c] for c in f) for f in self.faces
                           if all(c in hand_set for c in f)]

        self._toward = {}
        self._build_axes()
        self._build_bones()

    # ---- anatomical frame -------------------------------------------------

    def _build_axes(self):
        """A = across toward the thumb/index side, K = wrist->knuckles, B = back
        normal. B's SIGN is measured, from the fact that fingernails sit on the
        dorsal side of the distal phalanges."""
        mcp = [self.pivot[self.ph[f][0]] for f in FINGERS]
        a = (self.pivot[self.ph["index"][0]] - self.pivot[self.ph["pinky"][0]]).normalized()
        mid = sum(mcp, Vector((0, 0, 0))) / 4.0
        k = mid - self.pivot[self.wrist]
        k = (k - a * k.dot(a)).normalized()
        n = a.cross(k).normalized()

        # Per distal phalanx, take the nail centroid's offset from the phalanx
        # AXIS (perpendicular component only -- the raw centroid difference is
        # dominated by the nail sitting further out along the finger, which
        # carries no dorsal information).
        dorsal = Vector((0, 0, 0))
        for f in FINGERS:
            bone = self.ph[f][2]
            base = self.pivot[bone]
            direction = (base - self.pivot[self.ph[f][1]]).normalized()
            nail_c = Vector((0, 0, 0))
            nail_w = 0.0
            for p, w, is_nail in zip(self.rest_pos, self.weights, self.nail):
                share = w.get(bone, 0.0)
                if not is_nail or share <= 0.0:
                    continue
                nail_c += p * share
                nail_w += share
            if nail_w <= 0.0:
                continue
            off = nail_c / nail_w - base
            dorsal += off - direction * off.dot(direction)
        if dorsal.length < 1e-9:
            raise SystemExit(f"{self.side}: cannot orient back-normal (no nail verts)")
        self.dorsal_proj = dorsal.dot(n) / dorsal.length
        self.A = a
        self.K = k
        self.B = n if self.dorsal_proj > 0 else -n
        self.handed = 1.0 if self.A.cross(self.K).dot(self.B) > 0 else -1.0

    # ---- bones (rest axes + measured radii) ------------------------------

    def _build_bones(self):
        """Rest axis and mean radius per posable bone, plus the measured tips."""
        self.child_of = {}
        for f in FINGERS:
            self.child_of[self.meta[f]] = self.ph[f][0]
            self.child_of[self.ph[f][0]] = self.ph[f][1]
            self.child_of[self.ph[f][1]] = self.ph[f][2]
        self.child_of[self.thumb[0]] = self.thumb[1]
        self.child_of[self.thumb[1]] = self.thumb[2]

        # Distal tips: furthest bound vertex along the distal bone's direction.
        self.tip_rest = {}
        for name in [self.ph[f][2] for f in FINGERS] + [self.thumb[2]]:
            parent = self.parent_of[name]
            direction = (self.pivot[name] - self.pivot[parent]).normalized()
            best = 0.0
            for p, w in zip(self.rest_pos, self.weights):
                if w.get(name, 0.0) < 0.5:
                    continue
                best = max(best, (p - self.pivot[name]).dot(direction))
            self.tip_rest[name] = self.pivot[name] + direction * best

        self.radius = {}
        for name in self.chain:
            end = (self.tip_rest[name] if name in self.tip_rest
                   else self.pivot.get(self.child_of.get(name, ""), None))
            if end is None:
                continue
            self.radius[name] = self._mean_radius(name, self.pivot[name], end)

    def _mean_radius(self, name, a, b):
        total = 0.0
        count = 0
        for p, w in zip(self.rest_pos, self.weights):
            if w.get(name, 0.0) < 0.5:
                continue
            total += point_segment_distance(p, a, b)
            count += 1
        if count == 0:
            return 0.006
        return total / count

    # ---- forward kinematics + skinning ------------------------------------

    def globals(self, rots):
        """Rigid FK: each rotation acts about its joint's REST pivot."""
        out = {}
        for name in self.chain:
            pivot = self.pivot[name]
            rot = rots.get(name)
            local = (Matrix.Translation(pivot) @ rot.to_4x4()
                     @ Matrix.Translation(-pivot)) if rot else Matrix.Identity(4)
            parent = self.parent_of.get(name)
            out[name] = (out[parent] @ local) if parent in out else local
        return out

    def posed_pivot(self, world, name):
        return world[name] @ self.pivot[name]

    def posed_tip(self, world, name):
        return world[name] @ self.tip_rest[name]

    def skin(self, world):
        out = []
        for p, w, free in zip(self.rest_pos, self.weights, self.free):
            acc = p * free if free > 1e-6 else Vector((0, 0, 0))
            for name, weight in w.items():
                acc += (world[name] @ p) * weight
            out.append(acc)
        return out

    # ---- posed bone segments (for contact solves + capsule fitting) -------

    def bone_segments(self, world, names):
        segs = []
        for name in names:
            a = self.posed_pivot(world, name)
            b = (self.posed_tip(world, name) if name in self.tip_rest
                 else self.posed_pivot(world, self.child_of[name]))
            segs.append((a, b, self.radius.get(name, 0.006)))
        return segs

    def digit_bones(self, finger):
        return list(self.ph[finger])

    def toward_middle(self, finger):
        """Sign of a rotation about B that swings `finger` toward the middle."""
        if finger == "middle":
            return 0.0
        if finger not in self._toward:
            self._toward[finger] = splay_sign(self, finger, "middle")
        return self._toward[finger]

    def rest_digit_tilt(self, finger):
        """Degrees the rest finger's MCP->tip axis sits out of the palm plane
        (positive = palmward). Large values are why the prop axis can end up
        badly non-perpendicular to the back normal."""
        d = (self.tip_rest[self.ph[finger][2]] - self.pivot[self.ph[finger][0]]).normalized()
        return -math.degrees(math.asin(max(-1.0, min(1.0, d.dot(self.B)))))


# ===========================================================================
# Geometry helpers
# ===========================================================================

def point_segment_distance(p, a, b):
    d = b - a
    ll = d.length_squared
    if ll < 1e-18:
        return (p - a).length
    t = max(0.0, min(1.0, (p - a).dot(d) / ll))
    return (p - (a + d * t)).length


def segment_axial_t(p, a, b):
    d = b - a
    ll = d.length_squared
    if ll < 1e-18:
        return 0.0
    return (p - a).dot(d) / ll


def point_line_distance(p, origin, axis):
    v = p - origin
    return (v - axis * v.dot(axis)).length


def segment_line_distance(a, b, origin, axis):
    """Min distance from segment ab to the infinite line (origin, axis)."""
    best = 1e18
    for i in range(41):
        t = i / 40.0
        best = min(best, point_line_distance(a + (b - a) * t, origin, axis))
    return best


def segment_segment_distance(p1, q1, p2, q2):
    d1 = q1 - p1
    d2 = q2 - p2
    r = p1 - p2
    a = d1.dot(d1)
    e = d2.dot(d2)
    f = d2.dot(r)
    if a < 1e-18 and e < 1e-18:
        return r.length
    if a < 1e-18:
        s, t = 0.0, max(0.0, min(1.0, f / e))
    else:
        c = d1.dot(r)
        if e < 1e-18:
            t, s = 0.0, max(0.0, min(1.0, -c / a))
        else:
            b = d1.dot(d2)
            denom = a * e - b * b
            s = max(0.0, min(1.0, (b * f - c * e) / denom)) if denom > 1e-18 else 0.0
            t = (b * s + f) / e
            if t < 0.0:
                t, s = 0.0, max(0.0, min(1.0, -c / a))
            elif t > 1.0:
                t, s = 1.0, max(0.0, min(1.0, (b - c) / a))
    return ((p1 + d1 * s) - (p2 + d2 * t)).length


def closest_pair_midpoint(p1, q1, p2, q2, steps=200):
    """Midpoint of the closest approach between two segments (sampled, so it is
    deterministic and needs no degenerate-case algebra)."""
    best, bp = 1e18, (p1, p2)
    for i in range(steps + 1):
        a = p1 + (q1 - p1) * (i / steps)
        for j in range(steps + 1):
            b = p2 + (q2 - p2) * (j / steps)
            d = (a - b).length_squared
            if d < best:
                best, bp = d, (a, b)
    return (bp[0] + bp[1]) * 0.5


def bisect(fn, lo, hi, iters=BISECT_ITERS):
    """Find x in [lo,hi] with fn(x) ~ 0, assuming fn(lo) and fn(hi) straddle 0.
    If they do not, return whichever end is closer to zero."""
    flo, fhi = fn(lo), fn(hi)
    if flo * fhi > 0.0:
        return lo if abs(flo) < abs(fhi) else hi
    for _ in range(iters):
        mid = (lo + hi) * 0.5
        if fn(mid) * flo > 0.0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) * 0.5


def first_contact(fn, lo, hi, steps=64):
    """Largest x reachable from `lo` with fn(x) >= 0 all the way -- i.e. close the
    joint from an OPEN pose and stop the moment it touches.

    Plain bisection is wrong for this: it needs fn(lo) and fn(hi) to straddle
    zero, and here BOTH ends can be negative (the reference thumb's rest pose
    already overlaps the wrapped fingers), in which case bisection silently
    returns an end point and the thumb slams to full fold.
    """
    span = hi - lo
    if fn(lo) < 0.0:                       # never clear: take the least-bad pose
        return max(((fn(lo + span * i / steps), lo + span * i / steps)
                    for i in range(steps + 1)), key=lambda t: t[0])[1]
    prev = lo
    for i in range(1, steps + 1):
        x = lo + span * i / steps
        if fn(x) < 0.0:
            return bisect(fn, prev, x)
        prev = x
    return hi


def aim_rotation(src, dst):
    """Minimal-arc rotation taking unit vector src to unit vector dst."""
    src = src.normalized()
    dst = dst.normalized()
    dot = max(-1.0, min(1.0, src.dot(dst)))
    if dot > 1.0 - 1e-12:
        return Matrix.Identity(3)
    if dot < -1.0 + 1e-12:
        axis = src.orthogonal().normalized()
        return Matrix.Rotation(math.pi, 3, axis)
    axis = src.cross(dst).normalized()
    return Matrix.Rotation(math.acos(dot), 3, axis)


# ===========================================================================
# Pose 1 -- grip: right hand fisted round a vertical 30 mm dynamite bundle
# ===========================================================================

GRIP_CUP = {"index": 0.0, "middle": 0.0, "ring": 5.0, "pinky": 10.0}
# Positive = TOWARD the middle finger. A fist converges; the model's rest pose
# already fans the digits, so every finger needs pulling in.
GRIP_SPLAY = {"index": 4.0, "middle": 0.0, "ring": 4.0, "pinky": 8.0}
# Thumb fold: extra curl at the MCP / IP joints once it is folding.
GRIP_THUMB_CURL = (math.radians(26.0), math.radians(18.0))
GRIP_THUMB_CLEAR = 0.012    # aim the pad this far off the prop, so the
                            # IP curl has room to close onto it
GRIP_THUMB_PRESS = 0.005    # soft-tissue press of the thumb into the prop,
                            # the same allowance the fingers get via GRIP_BITE
GRIP_MAX_JOINT = math.radians(100.0)
# Once a phalanx is tangent to the bundle, bias it a few degrees further so the
# flesh actually beds into the prop instead of kissing it.
GRIP_BITE = math.radians(4.0)


def flex_sign(hand):
    """+1 if a positive rotation about A curls the fingers toward the palm."""
    name = hand.ph["middle"][0]
    probe = {name: Matrix.Rotation(math.radians(20.0), 3, hand.A)}
    base = hand.globals({})
    moved = hand.globals(probe)
    tip = hand.ph["middle"][2]
    delta = hand.posed_tip(moved, tip) - hand.posed_tip(base, tip)
    return 1.0 if delta.dot(hand.B) < 0.0 else -1.0


def splay_sign(hand, finger, toward):
    """+1 if a positive rotation about B moves `finger` toward `toward`."""
    name = hand.ph[finger][0]
    tip = hand.ph[finger][2]
    other = hand.pivot[hand.ph[toward][2]]
    base = hand.globals({})
    moved = hand.globals({name: Matrix.Rotation(math.radians(10.0), 3, hand.B)})
    before = (hand.posed_tip(base, tip) - other).length
    after = (hand.posed_tip(moved, tip) - other).length
    return 1.0 if after < before else -1.0


def local_axis(hand, rots, bone, world_axis):
    """`world_axis` expressed so that a rotation appended to `bone`'s local
    transform turns about it in WORLD space.

    Joint rotations compose, so naming an axis in a bone's own local frame means
    every ancestor's tilt bends it. That matters here: cancelling the index's
    22 deg rest fan tilts the MCP frame by 22 deg, and the PIP/DIP flexion that
    followed then swung out of the finger's column, spreading the fist's
    fingertips wider than its knuckles. Pre-composing the inverse of everything
    upstream keeps every flexion honestly about A.
    """
    parent = hand.parent_of.get(bone)
    upstream = Matrix.Identity(3)
    if parent in hand.chain:
        upstream = hand.globals(rots)[parent].to_3x3()
    upstream = upstream @ rots.get(bone, Matrix.Identity(3))
    return (upstream.inverted() @ world_axis).normalized()


def add_rot(hand, rots, bone, world_axis, angle):
    """Append a rotation of `angle` about `world_axis` (in WORLD space) to bone."""
    axis = local_axis(hand, rots, bone, world_axis)
    rots[bone] = rots.get(bone, Matrix.Identity(3)) @ Matrix.Rotation(angle, 3, axis)


def align_splay(hand, base, finger):
    """Splay that puts a finger's own long axis PERPENDICULAR to A, i.e. into its
    own column.

    The reference hand rests with the digits fanned (measured: ~20 deg for the
    index). Flexion about the shared axis A preserves that fan exactly, so a fist
    built straight on the rest pose ends up with its fingertips spread WIDER than
    its knuckles -- the opposite of a fist. This cancels the fan first; the
    converging GRIP_SPLAY then rides on top of it.
    """
    mcp, tip = hand.ph[finger][0], hand.ph[finger][2]

    def fan(angle):
        trial = dict(base)
        add_rot(hand, trial, mcp, hand.B, angle)
        world = hand.globals(trial)
        direction = (hand.posed_tip(world, tip)
                     - hand.posed_pivot(world, mcp)).normalized()
        return direction.dot(hand.A)

    return bisect(fan, math.radians(-40.0), math.radians(40.0))


def wrap_chain(hand, bones, base_rots, fsign, origin, axis, radius):
    """Curl a digit onto a cylinder one joint at a time, proximal to distal.

    Solving a single global curl scalar stops as soon as the PROXIMAL phalanx
    kisses the cylinder, which leaves the rest of the finger sticking out
    straight -- a loose cradle, not a fist. Bisecting each joint in turn so that
    ITS OWN phalanx becomes tangent is what makes the finger hug all the way
    round.
    """
    rots = dict(base_rots)
    for bone in bones:
        pre = rots.get(bone, Matrix.Identity(3))
        flex = local_axis(hand, rots, bone, hand.A)

        def clearance(theta):
            trial = dict(rots)
            trial[bone] = pre @ Matrix.Rotation(theta * fsign, 3, flex)
            a, b, r = hand.bone_segments(hand.globals(trial), [bone])[0]
            return segment_line_distance(a, b, origin, axis) - r - radius

        theta = bisect(clearance, 0.0, GRIP_MAX_JOINT)
        theta = min(theta + GRIP_BITE, GRIP_MAX_JOINT)
        rots[bone] = pre @ Matrix.Rotation(theta * fsign, 3, flex)
    return rots


def build_grip(hand, prop_radius=GRIP_PROP_R):
    """Return rotations and the measured cylindrical seat for this radius."""
    fsign = flex_sign(hand)
    hand.splay_dir = splay_sign(hand, "index", "middle")

    # Bundle axis runs along A (parallel to the knuckle line): that is what
    # "vertical" means with the forearm level, and the fingers' flexion planes
    # are perpendicular to A, so they wrap it cleanly.
    axis = hand.A.copy()
    carpus = sum((hand.pivot[hand.meta[f]] for f in FINGERS),
                 Vector((0, 0, 0))) / 4.0
    mcp_mid = sum((hand.pivot[hand.ph[f][0]] for f in FINGERS),
                  Vector((0, 0, 0))) / 4.0
    # Sit the bundle against the palm, a little distal of the palm centre.
    centre = carpus * 0.34 + mcp_mid * 0.66
    palmar = 0.0
    for p, w in zip(hand.rest_pos, hand.weights):
        if not w:
            continue
        if (p - centre).length > 0.030:
            continue
        palmar = min(palmar, (p - centre).dot(hand.B))
    origin = centre + hand.B * (palmar - prop_radius)

    rots = {}
    for f in FINGERS:
        add_rot(hand, rots, hand.meta[f], hand.A, math.radians(GRIP_CUP[f]) * fsign)
    fans = {}
    for f in FINGERS:
        fans[f] = align_splay(hand, rots, f)
        add_rot(hand, rots, hand.ph[f][0], hand.B,
                fans[f] + math.radians(GRIP_SPLAY[f]) * hand.toward_middle(f))
    print("[hands] grip: rest fan cancelled per finger = "
          + " ".join(f"{f}={math.degrees(fans[f]):+.0f}" for f in FINGERS) + " deg")
    for f in FINGERS:
        rots = wrap_chain(hand, hand.digit_bones(f), rots, fsign,
                          origin, axis, prop_radius)
    world = hand.globals(rots)
    for f in FINGERS:
        gaps = [segment_line_distance(a, b, origin, axis) - r - prop_radius
                for a, b, r in hand.bone_segments(world, hand.digit_bones(f))]
        print(f"[hands] grip: {f:6s} phalanx gaps to bundle surface = "
              + " ".join(f"{g * 1000:+6.1f}" for g in gaps) + " mm")

    # Thumb. Two MEASURED facts drive this. (1) The reference hand's rest thumb
    # lies 32 mm INSIDE a 30 mm bundle placed against its palm -- the thumb has to
    # abduct clear of the prop before it can do anything. (2) A bundle this fat is
    # too wide for the thumb to reach over the fingers: they hug the prop ~40 mm
    # from its axis and the thumb reaches ~41 mm, so "over the fingers" would need
    # both in the same shell, 20 mm apart. So it is posed the way a hand really
    # holds something this fat: abducted dorsally clear of the prop, then folded
    # round over the TOP of the fist to clamp the bare bundle above the index.
    yhat = axis.cross(hand.B).normalized()
    tip = hand.thumb[2]
    thumb0 = hand.pivot[hand.thumb[0]]
    finger_segs = [s for f in FINGERS
                   for s in hand.bone_segments(world, hand.digit_bones(f))]

    # Solve where the thumb pad CAN land, from its own reach. Put the tip on a
    # shell just off the bundle at a swing angle round from the back-of-hand
    # side, and let the reach equation say at what height along the prop it lands. Both roots are real poses; the +Z one is the thumb
    # running up the bundle, closing the top of the fist, which is what a hand
    # does with something this fat.
    reach = (hand.tip_rest[tip] - thumb0).length
    shell = prop_radius + hand.radius[tip] + GRIP_THUMB_CLEAR
    rel = thumb0 - origin

    def aim_for(phi):
        """Rotation putting the thumb pad on the shell at swing angle phi."""
        radial = hand.B * math.cos(phi) + yhat * math.sin(phi)
        dx = shell * math.cos(phi) - rel.dot(hand.B)
        dy = shell * math.sin(phi) - rel.dot(yhat)
        dz_sq = reach * reach - dx * dx - dy * dy
        if dz_sq <= 0.0:
            return None
        target = origin + axis * (rel.dot(axis) + math.sqrt(dz_sq)) + radial * shell
        return aim_rotation(hand.tip_rest[tip] - thumb0, target - thumb0)

    def thumb_rots(phi, curl, curl_dir=1.0):
        trial = dict(rots)
        aim = aim_for(phi)
        if aim is None:
            return None
        quat = aim.to_quaternion()
        add_rot(hand, trial, hand.thumb[0], quat.axis, quat.angle)
        for i, bone in enumerate(hand.thumb[1:]):
            add_rot(hand, trial, bone, quat.axis,
                    GRIP_THUMB_CURL[i] * curl * curl_dir)
        return trial

    def gaps(trial):
        w2 = hand.globals(trial)
        bundle = min(segment_line_distance(sa, sb, origin, axis) - sr - prop_radius
                     for sa, sb, sr in hand.bone_segments(w2, hand.thumb[1:]))
        a, b, rr = hand.bone_segments(w2, [tip])[0]
        finger = min(segment_segment_distance(a, b, c, d) - rr - r2
                     for c, d, r2 in finger_segs)
        return bundle, finger

    # Swing the pad round from the thumb's OWN side of the prop (where there is
    # no finger) toward the fingers, and stop where it would touch them: that is
    # as tight as this hand can clamp a bundle this fat.
    def finger_clear(phi):
        trial = thumb_rots(phi, 0.0)
        # BOTH constraints: placing only the PAD on the shell let the thumb's
        # shaft cut 18 mm through the prop, because its IP joint swings inside.
        return (-1.0 if trial is None
                else min(gaps(trial)) + GRIP_THUMB_PRESS)

    phi = first_contact(finger_clear, math.radians(-85.0), math.radians(85.0))
    # Then curl the IP joints until the pad beds onto the prop. The curl's sign is
    # measured -- it has to bend the pad TOWARD the bundle, not away from it.
    def radius_at(curl, direction):
        trial = thumb_rots(phi, curl, direction)
        return point_line_distance(hand.posed_tip(hand.globals(trial), tip),
                                   origin, axis)

    curl_dir = -1.0 if radius_at(0.25, 1.0) > radius_at(0.0, 1.0) else 1.0
    curl = first_contact(
        lambda c: min(gaps(thumb_rots(phi, c, curl_dir))) + GRIP_THUMB_PRESS,
        0.0, 1.0)
    rots = thumb_rots(phi, curl, curl_dir)
    bundle, finger = gaps(rots)
    print(f"[hands] grip: thumb pad swing={math.degrees(phi):+.0f} deg from dorsal, "
          f"IP curl={curl * 100:.0f}%  "
          f"bundle gap={bundle * 1000:+.2f} mm finger gap={finger * 1000:+.2f} mm")

    # +Z out of the fist = the thumb side, which is "up" gripping a vertical bar.
    return rots, origin, axis, prop_radius


# ===========================================================================
# Pose 2 -- pinch: left hand, cigarette clamped between index and middle
# ===========================================================================

# Index and middle stay near-straight on purpose: a diving fingertip would tip
# the cigarette out of the palm plane, and then the frame's +X could no longer be
# the back-of-hand normal.
PINCH_FLEX = {"index": (7.0, 8.0, 5.0), "middle": (6.0, 8.0, 5.0),
              "ring": (52.0, 64.0, 30.0), "pinky": (60.0, 70.0, 34.0)}
PINCH_SPLAY = {"ring": 3.0, "pinky": 6.0}     # positive = toward the middle
PINCH_THUMB = (-14.0, 12.0, 8.0)
# The model's rest fingers sit well palmward of the palm plane. Extending the
# two holding fingers by up to this much brings the cigarette's axis back
# perpendicular to the back-of-hand normal, so the frame's +X really IS that
# normal rather than a heavily reprojected version of it.
PINCH_MAX_EXT = math.radians(30.0)


def pinch_rotations(hand, scissor, ext, fsign):
    rots = {}
    for f in FINGERS:
        # Splay first (about B), then flexion (about A) -- both in WORLD axes.
        splay = math.radians(PINCH_SPLAY.get(f, 0.0)) * hand.toward_middle(f)
        if f in ("index", "middle"):
            # Positive scissor closes BOTH holding fingers toward each other;
            # each side's sign is measured, never assumed.
            splay += scissor * (hand.splay_middle if f == "middle"
                                else hand.toward_middle(f))
        add_rot(hand, rots, hand.ph[f][0], hand.B, splay)
        for i, bone in enumerate(hand.ph[f]):
            angle = math.radians(PINCH_FLEX[f][i]) * fsign
            if i == 0 and f in ("index", "middle"):
                angle -= ext * fsign          # extend the holding fingers
            add_rot(hand, rots, bone, hand.A, angle)
    for i, bone in enumerate(hand.thumb):
        add_rot(hand, rots, bone, hand.A, math.radians(PINCH_THUMB[i]) * fsign)
    return rots


def pinch_groove(hand, world):
    """(pinch point, groove axis): the point where index and middle come closest,
    and the direction out of that V toward the fingertips."""
    ia, ib, _ = hand.bone_segments(world, [hand.ph["index"][1]])[0]
    ma, mb, _ = hand.bone_segments(world, [hand.ph["middle"][1]])[0]
    origin = closest_pair_midpoint(ia, ib, ma, mb)
    tips = (hand.posed_tip(world, hand.ph["index"][2])
            + hand.posed_tip(world, hand.ph["middle"][2])) * 0.5
    return origin, (tips - origin).normalized()


def build_pinch(hand):
    fsign = flex_sign(hand)
    hand.splay_middle = splay_sign(hand, "middle", "index")
    for f in FINGERS:
        hand.toward_middle(f)
    print("[hands] pinch: rest digit tilt out of palm plane = "
          + " ".join(f"{f}={hand.rest_digit_tilt(f):+.0f}" for f in FINGERS) + " deg")

    def axis_dot_back(ext):
        _o, axis = pinch_groove(hand, hand.globals(pinch_rotations(hand, 0.0, ext, fsign)))
        return axis.dot(hand.B)

    ext = bisect(axis_dot_back, 0.0, PINCH_MAX_EXT)

    def clamp_gap(scissor, world=None):
        world = world or hand.globals(pinch_rotations(hand, scissor, ext, fsign))
        a0, a1, ra = hand.bone_segments(world, [hand.ph["index"][1]])[0]
        b0, b1, rb = hand.bone_segments(world, [hand.ph["middle"][1]])[0]
        return (segment_segment_distance(a0, a1, b0, b1) - ra - rb
                - 2.0 * PINCH_PROP_R)

    scissor = bisect(clamp_gap, 0.0, math.radians(46.0))
    rots = pinch_rotations(hand, scissor, ext, fsign)
    world = hand.globals(rots)
    print(f"[hands] pinch: holding-finger extension={math.degrees(ext):.1f} deg  "
          f"scissor={math.degrees(scissor):+.1f} deg/finger  "
          f"clamp residual={clamp_gap(scissor, world) * 1000:+.2f} mm")

    # The cigarette lies in the V between index and middle, parallel to them and
    # protruding past the fingertips.
    origin, axis = pinch_groove(hand, world)
    return rots, origin, axis, PINCH_PROP_R


# ===========================================================================
# Measurement: the local frame and the capsule fits
# ===========================================================================

def measure_frame(hand, origin, axis):
    """O, +Z along the prop, +X the back-of-hand normal, +Y = Z x X."""
    z = axis.normalized()
    x = hand.B - z * hand.B.dot(z)
    if x.length < 1e-6:
        raise SystemExit("prop axis is parallel to the back normal")
    # How far the true back-normal is from perpendicular to the prop axis; this
    # is exactly how much +X had to be reprojected to make the frame orthonormal.
    skew = math.degrees(math.asin(max(-1.0, min(1.0, abs(hand.B.dot(z))))))
    x.normalize()
    y = z.cross(x).normalized()
    return origin.copy(), x, y, z, skew


def to_frame(p, origin, x, y, z):
    v = p - origin
    return (v.dot(x), v.dot(y), v.dot(z))


GRIP_SEGMENTS = ("forearm", "wrist", "fist", "knuckleRidge",
                 "fingerWrap", "fingerTips", "thumbBase", "thumbTip")
PINCH_SEGMENTS = ("forearm", "wrist", "palm", "index", "middle",
                  "ringPinky", "thumbBase", "thumbTip")


def segment_axes(hand, world, pose):
    """Named capsule axes, from the POSED joint pivots."""
    P = lambda n: hand.posed_pivot(world, n)
    T = lambda n: hand.posed_tip(world, n)
    wrist = P(hand.wrist)
    carpus = sum((P(hand.meta[f]) for f in FINGERS), Vector((0, 0, 0))) / 4.0
    mcp_mid = sum((P(hand.ph[f][0]) for f in FINGERS), Vector((0, 0, 0))) / 4.0
    elbow_dir = (hand.pivot[hand.elbow] - wrist).normalized()

    out = {
        "forearm": (wrist, wrist + elbow_dir * FOREARM_LEN),
        "wrist": (wrist, carpus),
        "thumbBase": (P(hand.thumb[0]), P(hand.thumb[2])),
        "thumbTip": (P(hand.thumb[2]), T(hand.thumb[2])),
    }
    if pose == "grip":
        out["fist"] = (carpus, mcp_mid)
        out["knuckleRidge"] = (P(hand.ph["index"][0]), P(hand.ph["pinky"][0]))
        out["fingerWrap"] = (
            (P(hand.ph["index"][1]) + P(hand.ph["index"][2])) * 0.5,
            (P(hand.ph["pinky"][1]) + P(hand.ph["pinky"][2])) * 0.5)
        out["fingerTips"] = (T(hand.ph["index"][2]), T(hand.ph["pinky"][2]))
    else:
        out["palm"] = (carpus, mcp_mid)
        out["index"] = (P(hand.ph["index"][0]), T(hand.ph["index"][2]))
        out["middle"] = (P(hand.ph["middle"][0]), T(hand.ph["middle"][2]))
        out["ringPinky"] = (
            (P(hand.ph["ring"][0]) + P(hand.ph["pinky"][0])) * 0.5,
            (T(hand.ph["ring"][2]) + T(hand.ph["pinky"][2])) * 0.5)
    return out


def vertex_groups(hand, pose):
    """Which posed vertices belong to which named capsule, by SKIN WEIGHT.

    An earlier version Voronoi-partitioned on distance-to-axis. That starved the
    palm: `fist`'s axis is short and buried, so the cross-hand digit rows stole
    most of the hand mass and the fist came out THINNER than the fingertips.
    Anatomical membership -- "which bone is this vertex actually bound to" -- is
    both principled and non-overlapping.
    """
    ph = {k: [hand.ph[f][k] for f in FINGERS] for k in (0, 1, 2)}
    metas = [hand.meta[f] for f in FINGERS]

    def bound(names, limit=0.5):
        names = set(names)
        return [i for i, w in enumerate(hand.weights_all)
                if sum(v for k, v in w.items() if k in names) > limit]

    groups = {
        "forearm": bound(hand.arm_joints),
        "wrist": bound([hand.wrist]),
        "thumbBase": bound(hand.thumb[0:2]),
        "thumbTip": bound([hand.thumb[2]]),
    }
    groups["fist" if pose == "grip" else "palm"] = bound(metas)
    if pose == "grip":
        # The knuckle RIDGE is the row of MCP bumps, not the whole proximal
        # phalanx: keep only the proximal end of each f_*.01.
        ridge = []
        for i in bound(ph[0]):
            w = hand.weights_all[i]
            bone = max(ph[0], key=lambda b: w.get(b, 0.0))
            child = hand.child_of[bone]
            t = segment_axial_t(hand.rest_pos[i], hand.pivot[bone], hand.pivot[child])
            if t <= 0.45:
                ridge.append(i)
        groups["knuckleRidge"] = ridge
        groups["fingerWrap"] = bound(ph[1])
        groups["fingerTips"] = bound(ph[2])
    else:
        for f in ("index", "middle"):
            groups[f] = bound(hand.ph[f])
        groups["ringPinky"] = bound(hand.ph["ring"] + hand.ph["pinky"])
    return groups


def fit_capsules(hand, posed, axes, names, pose):
    """radius = MEAN distance from the axis to the mesh surface over the segment."""
    groups = vertex_groups(hand, pose)
    out = {}
    for n in names:
        a, b = axes[n]
        direction = (b - a).normalized()
        total, count = 0.0, 0
        for i in groups[n]:
            p = posed[i]
            # The forearm capsule is a 0.25 m stub through a full-length arm, so
            # clip to the stub; every other group is local to its own segment.
            if n == "forearm" and not (0.0 <= segment_axial_t(p, a, b) <= 1.0):
                continue
            total += point_line_distance(p, a, direction)
            count += 1
        if count == 0:
            raise SystemExit(f"segment {n!r} captured no vertices")
        out[n] = (total / count, count)
    return out


# ===========================================================================
# Blender mesh construction
# ===========================================================================

def make_mesh(name, verts, faces, flip=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([Vector(v) for v in verts],
                   [], [f[::-1] if flip else f for f in faces])
    me.validate()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    with bpy.context.temp_override(object=obj, selected_editable_objects=[obj]):
        bpy.ops.object.shade_smooth()
    return obj


def make_prop(name, origin, axis, radius, length):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=length,
                                        location=origin)
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = axis.to_track_quat("Z", "Y").to_euler()
    return obj


def make_emission(name, color):
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*color, 1.0)
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def make_pbr(name, color, rough=0.55):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def configure_engine(transparent):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = transparent
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    # Enum items are OCIO-populated at runtime -- assign and catch, never
    # introspect enum_items (Blender 5.2 scripting trap).
    for attr, value in (("view_transform", "Standard"), ("look", "None")):
        try:
            setattr(scene.view_settings, attr, value)
        except (TypeError, ValueError):
            pass
    return scene


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# ===========================================================================
# Height bake
# ===========================================================================

def make_height_material(z_min, z_max, floor):
    mat = bpy.data.materials.new("HandHeight")
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 1.0
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.clamp = True
    mr.inputs["From Min"].default_value = z_min
    mr.inputs["From Max"].default_value = z_max
    mr.inputs["To Min"].default_value = floor
    mr.inputs["To Max"].default_value = 1.0
    nt.links.new(geo.outputs["Position"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat, mr


def read_opaque_levels(png_path):
    """Percentile floor + max of the STORED grey of fully-opaque pixels.

    The naive min..max band is dominated by the single deepest feature, which
    squashes the palm into a flat plateau; clipping the bottom FLOOR_PERCENTILE
    of the depth histogram spends the range on the relief the shader wants.
    """
    img = bpy.data.images.load(str(png_path), check_existing=False)
    img.colorspace_settings.name = "Non-Color"      # read raw stored values
    buf = [0.0] * len(img.pixels)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)

    hist = [0] * HIST_BINS
    total = 0
    hi = 0.0
    for i in range(0, len(buf), 4):
        if buf[i + 3] < 0.999:
            continue
        v = min(max(buf[i], 0.0), 1.0)
        hist[min(int(v * HIST_BINS), HIST_BINS - 1)] += 1
        total += 1
        hi = max(hi, v)
    if total == 0:
        raise SystemExit(f"{png_path}: no opaque pixels in calibration pass")
    def percentile(pct):
        cutoff = total * pct / 100.0
        seen = 0
        for b, n in enumerate(hist):
            seen += n
            if seen >= cutoff:
                return (b + 1) / HIST_BINS
        return hi

    return percentile(FLOOR_PERCENTILE), percentile(CEIL_PERCENTILE)


def bake_height(name, verts, faces, hand):
    """Bake the sheet from the posed mesh, in the hand's own (T, K, B) frame."""
    reset_scene()
    basis = Matrix((hand.A, hand.K, hand.B))        # rows -> maps world to sheet
    det = basis.determinant()
    baked = [basis @ Vector(v) for v in verts]
    centre = Vector((0, 0, 0))
    for v in baked:
        centre += v
    centre /= len(baked)
    baked = [v - centre for v in baked]
    hand_obj = make_mesh(f"Hand_{name}", baked, faces, flip=det < 0.0)

    lo = Vector((min(v[i] for v in baked) for i in range(3)))
    hi = Vector((max(v[i] for v in baked) for i in range(3)))
    span = max(hi.x - lo.x, hi.y - lo.y)
    ortho = span / FRAME_FILL
    cx, cy = (lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5

    floor_lin = srgb_to_linear(HEIGHT_FLOOR)
    mat, mr = make_height_material(lo.z, hi.z, floor_lin)
    assign(hand_obj, mat)

    scene = configure_engine(transparent=True)
    scene.render.resolution_x = HEIGHT_RES
    scene.render.resolution_y = HEIGHT_RES
    scene.render.resolution_percentage = 100
    scene.eevee.taa_render_samples = 24

    bpy.ops.object.camera_add(location=(cx, cy, hi.z + 0.40))
    cam = bpy.context.active_object
    cam.name = "HeightCam"
    cam.rotation_euler = (0.0, 0.0, 0.0)             # view axis -Z, up +Y, right +X
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = ortho
    cam.data.clip_start = 0.01
    cam.data.clip_end = 2.0
    scene.camera = cam

    out_path = LAB_DIR / f"hand-detail-{name}.png"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(out_path)

    # Pass 1: provisional band = the whole bbox depth; measure what is visible.
    bpy.ops.render.render(write_still=True)
    s_lo, s_hi = read_opaque_levels(out_path)
    depth = hi.z - lo.z
    # Undo the floor remap to recover the depth each stored level came from.
    t_lo = (srgb_to_linear(s_lo) - floor_lin) / (1.0 - floor_lin)
    t_hi = (srgb_to_linear(s_hi) - floor_lin) / (1.0 - floor_lin)
    z_lo = lo.z + max(0.0, min(1.0, t_lo)) * depth
    z_hi = lo.z + max(0.0, min(1.0, t_hi)) * depth
    if z_hi - z_lo < 1e-5:
        raise SystemExit(f"[{name}] degenerate visible depth range")

    # Pass 2: re-normalise over the measured visible band.
    mr.inputs["From Min"].default_value = z_lo
    mr.inputs["From Max"].default_value = z_hi
    bpy.ops.render.render(write_still=True)

    half = ortho * 0.5
    print(f"[hands] {name}: sheet basis det={det:+.3f} "
          f"({'MIRRORED back view' if det < 0 else 'true back view'})")
    print(f"[hands] {name}: ortho={ortho:.5f} m (SQUARE) halfScaleM={half:.5f} "
          f"visible z[{z_lo:+.4f},{z_hi:+.4f}] of bbox z[{lo.z:+.4f},{hi.z:+.4f}]")
    print(f"[hands] {name}: height map -> {out_path}")
    return half, det


# ===========================================================================
# Lit preview (human review; the prop IS shown so the grip reads)
# ===========================================================================

def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def render_preview(name, verts, faces, hand, origin, axis, radius, length, tag=None,
                   view=(1.0, -0.85, 0.55), prop_shift=0.0):
    reset_scene()
    hand_obj = make_mesh(f"Hand_{name}", verts, faces)
    prop = make_prop(f"Prop_{name}", origin + axis * prop_shift, axis, radius, length)
    assign(hand_obj, make_pbr(f"Flesh_{name}", (0.66, 0.46, 0.38), 0.52))
    assign(prop, make_pbr(f"Prop_{name}", (0.22, 0.11, 0.08), 0.85))

    scene = configure_engine(transparent=False)
    scene.render.resolution_x = PREVIEW_RES
    scene.render.resolution_y = PREVIEW_RES
    scene.eevee.taa_render_samples = 32
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.05, 0.055, 0.065, 1.0)
    bg.inputs[1].default_value = 0.35
    # EEVEE jitters area-light shadows stochastically; pin it off so previews are
    # reproducible byte-for-byte too.
    scene.eevee.use_raytracing = False
    scene.eevee.use_shadow_jitter_viewport = False

    pts = [Vector(v) for v in verts]
    target = sum(pts, Vector((0, 0, 0))) / len(pts)
    reach = max((p - target).length for p in pts)
    eye = target + (hand.B * view[0] + hand.K * view[1] + hand.A * view[2]).normalized() * reach * 3.2
    bpy.ops.object.camera_add(location=eye)
    cam = bpy.context.active_object
    cam.data.lens = 52
    point_at(cam, target)
    scene.camera = cam

    def area(nm, offs, energy, size):
        loc = target + (hand.B * offs[0] + hand.K * offs[1] + hand.A * offs[2]) * reach * 3.0
        bpy.ops.object.light_add(type="AREA", location=loc)
        light = bpy.context.active_object
        light.name = nm
        light.data.energy = energy
        light.data.size = size
        light.data.use_shadow_jitter = False
        point_at(light, target)

    area("Key", (1.0, -0.5, 1.0), 2.2, 0.26)
    area("Fill", (0.5, -0.9, -1.0), 0.9, 0.40)
    area("Rim", (-0.3, 1.0, 0.4), 1.1, 0.26)

    NOTE_DIR.mkdir(parents=True, exist_ok=True)
    path = NOTE_DIR / f"{name}-preview.png" if tag is None else \
        Path(f"/tmp/hands-debug-{name}-{tag}.png")
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print(f"[hands] {name}: preview -> {path}")


# ===========================================================================
# TypeScript emitter
# ===========================================================================

TS_HEADER = '''// GENERATED by scripts/pose_measure_hands.py -- do not edit by hand.
//
// MEASUREMENTS of a real posed hand mesh, in metres. These numbers are FACTS
// derived from a rigged reference model; the model itself is NOT redistributed
// and no part of it lives in this repository.
//
//   Reference: "First Person hands rigged" by DavidFischer (Sketchfab),
//   licensed CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).
//   Adaptations must credit the author; see public/assets/lab/hand-detail.json
//   for the verbatim attribution line that ships with the derived height maps.
//
// LOCAL FRAME (each hand has its own; both are right-handed):
//   O  = the point on the prop's axis where the hand closes on it
//        (for `pinch`, the pinch point between index and middle)
//   +Z = along the prop axis, toward the prop's business end
//        (`grip`: up out of the fist;  `pinch`: toward the lit end)
//   +X = the back-of-hand outward normal (pointing away from the palm)
//   +Y = Z x X
//
// Because `grip` is a RIGHT hand and `pinch` is a LEFT hand, +Y points toward
// opposite anatomical sides in the two frames -- see the dev note
// docs/dev-notes/2026-08-17-hand-detail-bake.md before mirroring anything.
//
// Each segment is a capsule: `a` and `b` are the axis endpoints and `radius` is
// the MEAN distance from that axis to the mesh surface over the segment.

export interface MeasuredSegment {
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  radius: number;
}

export interface MeasuredHand {
  propRadius: number;
  knuckleSpanM: number;
  segments: Record<string, MeasuredSegment>;
}

'''


def fmt_vec(v):
    return "[" + ", ".join(f"{c:.5f}" for c in v) + "]"


def write_ts(data):
    body = []
    for pose in ("grip", "pinch"):
        d = data[pose]
        lines = [f"  {pose}: {{",
                 f"    propRadius: {d['propRadius']:.5f},",
                 f"    knuckleSpanM: {d['knuckleSpanM']:.5f},",
                 "    segments: {"]
        for name, seg in d["segments"].items():
            lines.append(f"      {name}: {{ a: {fmt_vec(seg['a'])} as const, "
                         f"b: {fmt_vec(seg['b'])} as const, "
                         f"radius: {seg['radius']:.5f} }},")
        lines += ["    },", "  },"]
        body.append("\n".join(lines))
    text = (TS_HEADER
            + "export const MEASURED_HANDS: { grip: MeasuredHand; pinch: MeasuredHand } = {\n"
            + "\n".join(body) + "\n};\n")
    TS_PATH.write_text(text)
    print(f"[hands] measurements -> {TS_PATH}")


# ===========================================================================

POSES = {"grip": ("R", build_grip, GRIP_SEGMENTS),
         "pinch": ("L", build_pinch, PINCH_SEGMENTS)}


def main():
    if not SRC.exists():
        raise SystemExit(f"source model not found: {SRC}")
    inspect_import()
    gltf = Gltf(SRC)

    data = {}
    halves = {}
    for pose, (side, builder, names) in POSES.items():
        hand = Hand(gltf, side)
        print(f"[hands] {pose}: side={side} verts={len(hand.rest_pos)} "
              f"tris={len(hand.faces)} knuckleSpan raw={hand.span_raw:.5f} "
              f"-> scale x{hand.scale:.5f}")
        print(f"[hands] {pose}: back-normal confidence (nail dorsal proj) "
              f"= {hand.dorsal_proj:+.3f}; (A,K,B) handedness = {hand.handed:+.0f}")

        rots, origin, axis, prop_r = builder(hand)
        world = hand.globals(rots)
        posed = hand.skin(world)
        hand_only = [posed[i] for i in hand.hand_idx]
        axes = segment_axes(hand, world, pose)
        fits = fit_capsules(hand, posed, axes, names, pose)

        o, fx, fy, fz, skew = measure_frame(hand, origin, axis)
        print(f"[hands] {pose}: back-normal reprojected by {skew:.2f} deg to make "
              f"+X perpendicular to the prop axis")
        segments = {}
        for name in names:
            a, b = axes[name]
            radius, count = fits[name]
            segments[name] = {"a": to_frame(a, o, fx, fy, fz),
                              "b": to_frame(b, o, fx, fy, fz),
                              "radius": radius, "n": count}
        data[pose] = {"propRadius": prop_r, "knuckleSpanM": KNUCKLE_SPAN_M,
                      "segments": segments}

        # Report the frame's anatomical orientation so consumers are not guessing.
        thumb_dir = to_frame(hand.posed_tip(world, hand.thumb[2]), o, fx, fy, fz)
        print(f"[hands] {pose}: thumb tip in frame = "
              f"({thumb_dir[0]:+.4f},{thumb_dir[1]:+.4f},{thumb_dir[2]:+.4f}) m")
        for name in names:
            s = segments[name]
            print(f"[hands]   {name:13s} a=({s['a'][0]:+.4f},{s['a'][1]:+.4f},{s['a'][2]:+.4f}) "
                  f"b=({s['b'][0]:+.4f},{s['b'][1]:+.4f},{s['b'][2]:+.4f}) "
                  f"r={s['radius'] * 1000:5.1f} mm  n={s['n']}")

        # The measurement origin sits mid-grip; shift the PREVIEW prop along its
        # axis so the business end visibly protrudes (previews only).
        prop_len, shift = (0.115, 0.030) if pose == "grip" else (0.080, 0.030)
        # Angles chosen so the grip READS: for the fist, palmar-from-the-thumb-side
        # so every fingertip on the bundle is visible; for the pinch, palmar so
        # the cigarette in the V between index and middle is visible.
        view = (-1.00, 0.15, 0.35) if pose == "grip" else (-0.85, 0.10, 0.45)
        render_preview(pose, hand_only, hand.hand_faces, hand, origin, axis,
                       prop_r, prop_len, view=view, prop_shift=shift)
        if DEBUG_VIEWS:
            for tag, view in (("back", (1.0, 0.0, 0.0)), ("palm", (-1.0, 0.0, 0.0)),
                              ("axial", (0.0, 0.0, 1.0)), ("tip", (0.2, 1.0, 0.0)),
                              ("dorsal-thumb", (0.45, 0.30, 1.00))):
                render_preview(pose, hand_only, hand.hand_faces, hand, origin,
                               axis, prop_r, prop_len, tag=tag, view=view,
                               prop_shift=shift)
        halves[pose], _det = bake_height(pose, hand_only, hand.hand_faces, hand)

    for pose in data:
        for seg in data[pose]["segments"].values():
            seg.pop("n", None)
    write_ts(data)

    py = shutil.which("python3")
    if not py:
        raise SystemExit("python3 not found -- cannot compute manifest means")
    args = [py, str(Path(__file__).resolve()), "--manifest-only"]
    for pose, half in halves.items():
        args += ["--half", f"{pose}={half:.6f}"]
    subprocess.run(args, check=True)


if __name__ == "__main__":
    main()
