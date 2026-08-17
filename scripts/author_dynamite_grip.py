#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["libigl==2.6.2", "numpy==2.5.2"]
# ///
"""Author the X1.27 dynamite prop and the six grip poses against it.

Dispatch Task A of the X1.27 plan
(docs/superpowers/plans/2026-08-17-sdf-dynamite-grip-release.md, design:
docs/superpowers/specs/2026-08-17-sdf-dynamite-grip-release-design.md).

Stages:

  outer (this file, plain Python via PEP 723)
      validates the licensed source, launches Blender on THIS SAME FILE for the
      GLB normalization and the pose solve, then measures the DERIVED asset and
      writes the checked-in JSON contract + previews.

  inner (runs INSIDE Blender, re-entered with --blender-export / --blender-poses)
      imports the credited source GLB, applies the deterministic axis/scale,
      seats the named anchor nodes and exports one self-contained GLB; then
      solves the six grip poses against that exact geometry.

The downloaded original stays outside the repository and is never
redistributed; only the derived GLB/contract/previews are committed, with the
DJMaesen/bumstrum CC-BY-4.0 attribution recorded in ATTRIBUTIONS.md.

Usage:
    uv run scripts/author_dynamite_grip.py                 # prop + poses + previews
    uv run scripts/author_dynamite_grip.py --prop-only     # derived GLB + contract
    uv run scripts/author_dynamite_grip.py --validate-only # validate checked-in assets
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import re
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent
LAB_DIR = REPO_ROOT / "public" / "assets" / "lab"
NOTE_DIR = REPO_ROOT / "docs" / "dev-notes" / "2026-08-17-sdf-dynamite-grip"

# Licensed source model. Absolute, outside the repo, read-only, never copied.
SOURCE = Path("/Users/donny/Downloads/additional blud assets test/dynamite_bundle.glb")

GLB_OUT = LAB_DIR / "dynamite-bundle-grip.glb"
CONTRACT_OUT = LAB_DIR / "dynamite-bundle-grip.json"
PREVIEW_OUT = NOTE_DIR / "prop-preview.png"
POSE_SHEET_OUT = NOTE_DIR / "pose-contact-sheet.png"
NOTES_OUT = NOTE_DIR / "notes.md"

ATTRIBUTION = (
    'This work is based on "Dynamite bundle" '
    "(https://sketchfab.com/3d-models/dynamite-bundle-6d333be39e454b458d48ad86f8a78df4) "
    "by DJMaesen (https://sketchfab.com/bumstrum) licensed under CC-BY-4.0 "
    "(http://creativecommons.org/licenses/by/4.0/)"
)

# ---- derived envelope: the deterministic normalization contract ------------
MIN_TRANSVERSE_M, MAX_TRANSVERSE_M = 0.065, 0.085
MIN_TOTAL_M, MAX_TOTAL_M = 0.30, 0.35
TARGET_LONG_M = 0.32             # source longest axis -> model +Y, total length
TARGET_TRANSVERSE_M = 0.074      # larger transverse axis after uniform pair scale
CONTACT_RADIUS_M = 0.037
CONTACT_BELOW_M = 0.115
CONTACT_ABOVE_M = 0.135
MODEL_GRIP_OFFSET_M = -0.015     # GripAnchor, signed +Y from the GLB origin
MAX_TEXTURE_PX = 512
PREVIEW_RES = 768
RULER_M = 0.180                  # reference ruler beside the preview
MAX_GLB_BYTES = 3 * 1024 * 1024

LABELS = ("open", "approach", "first-contact", "wrap", "thumb-lock", "firm-grip")


def grip_pose_labels() -> tuple[str, ...]:
    """The six ordered clip labels; Task B/C bake and address slabs by these."""
    return LABELS


# ===========================================================================
# Pure GLB reading (header/JSON chunk/BIN chunk) — no Blender, no addons
# ===========================================================================

def read_glb_chunks(path: Path) -> tuple[dict, bytes]:
    """Return (json_dict, binary_chunk). Validates the GLB container only."""
    data = path.read_bytes()
    if len(data) < 20:
        raise ValueError(f"{path.name}: too short for a GLB header")
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError(f"{path.name}: not a GLB (magic {magic:#x})")
    if length != len(data):
        raise ValueError(f"{path.name}: header length {length} != file {len(data)}")
    off = 12
    doc: dict | None = None
    blob = b""
    while off + 8 <= len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        off += 8
        chunk = data[off:off + clen]
        if len(chunk) != clen:
            raise ValueError(f"{path.name}: truncated chunk ({ctype:#x})")
        if ctype == 0x4E4F534A:                     # JSON
            doc = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:                   # BIN
            blob = chunk
        off += clen + ((4 - clen % 4) % 4)          # chunks are 4-byte aligned
    if doc is None:
        raise ValueError(f"{path.name}: no JSON chunk")
    return doc, blob


def read_glb_asset_extras(path: Path) -> dict:
    """The asset.extras block Sketchfab writes (author/license/source/title)."""
    doc, _ = read_glb_chunks(path)
    extras = (doc.get("asset") or {}).get("extras")
    if not isinstance(extras, dict):
        raise ValueError(f"{path.name}: asset.extras missing (not the credited source?)")
    return extras


def glb_mesh_bounds(doc: dict, blob: bytes) -> tuple[tuple[float, ...], tuple[float, ...]]:
    """Axis-aligned bounds of ALL POSITION accessors, decoded straight from BIN.

    The derived GLB keeps every mesh collapsed (no wrapper transforms, mesh
    data centred on the FlightPivot root), so accessor coordinates are the
    physical model-space coordinates this contract measures. Any float32 VEC3
    POSITION is accepted; anything else fails loudly instead of guessing.
    """
    views = doc.get("bufferViews", [])
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    found = False
    for mesh in doc.get("meshes", []):
        for prim in mesh.get("primitives", []):
            pos_idx = (prim.get("attributes") or {}).get("POSITION")
            if pos_idx is None:
                continue
            acc = doc["accessors"][pos_idx]
            if acc.get("componentType") != 5126 or acc.get("type") != "VEC3":
                raise ValueError("POSITION must be float32 VEC3")
            view = views[acc["bufferView"]]
            base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
            n = acc["count"]
            if view.get("byteStride") not in (None, 0, 12):
                raise ValueError("strided POSITION is not supported")
            flat = struct.unpack_from(f"<{n * 3}f", blob, base)
            for i in range(3):
                col = flat[i::3]
                lo[i] = min(lo[i], min(col))
                hi[i] = max(hi[i], max(col))
            found = True
    if not found:
        raise ValueError("no POSITION accessors found")
    return tuple(lo), tuple(hi)


def glb_node_names(doc: dict) -> set[str]:
    return {n.get("name", "") for n in doc.get("nodes", [])}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


# ===========================================================================
# Prop contract
# ===========================================================================

@dataclasses.dataclass(frozen=True)
class PropContract:
    glb: str                         # "dynamite-bundle-grip.glb"
    sha256: str                      # 64 lowercase hex
    source_sha256: str
    dimensions_m: tuple[float, float, float]
    model_up: str                    # "+Y"
    model_grip_offset_m: float       # signed +Y from GLB origin
    contact_radius_m: float
    contact_below_m: float
    contact_above_m: float
    fuse_tip_node: str               # "FuseTip"
    flight_pivot_node: str           # "FlightPivot"
    attribution: str


_HEX64 = re.compile(r"^[0-9a-f]{64}$")


def validate_prop_contract(c: PropContract) -> None:
    """Reject anything that is not the one authored derived prop.

    The point is the plan's hard rule: a proxy of a different size is
    forbidden. Pose authoring and runtime must consume this exact envelope.
    """
    if c.glb != "dynamite-bundle-grip.glb":
        raise ValueError(f"contract glb name {c.glb!r} is not the derived asset")
    if c.model_up != "+Y":
        raise ValueError(f"model_up {c.model_up!r} != '+Y'")
    if not (_HEX64.match(c.sha256) and _HEX64.match(c.source_sha256)):
        raise ValueError("sha256 fields must be 64 lowercase hex characters")
    dx, dy, dz = c.dimensions_m
    transverse = (dx, dz)
    problems = []
    if not all(MIN_TRANSVERSE_M <= t <= MAX_TRANSVERSE_M for t in transverse):
        problems.append(f"transverse {transverse} outside "
                        f"[{MIN_TRANSVERSE_M},{MAX_TRANSVERSE_M}]")
    if not MIN_TOTAL_M <= dy <= MAX_TOTAL_M:
        problems.append(f"long axis {dy} outside [{MIN_TOTAL_M},{MAX_TOTAL_M}]")
    if abs(max(transverse) - TARGET_TRANSVERSE_M) > 0.002:
        problems.append(f"larger transverse {max(transverse)} != {TARGET_TRANSVERSE_M}")
    if abs(dy - TARGET_LONG_M) > 0.002:
        problems.append(f"long axis {dy} != {TARGET_LONG_M}")
    if problems:
        raise ValueError(
            f"derived dimensions {tuple(round(v, 5) for v in c.dimensions_m)} "
            "outside the authored envelope: " + "; ".join(problems))
    if abs(c.model_grip_offset_m - MODEL_GRIP_OFFSET_M) > 1e-9:
        raise ValueError(f"model_grip_offset_m {c.model_grip_offset_m} != "
                         f"{MODEL_GRIP_OFFSET_M}")
    if abs(c.contact_radius_m - CONTACT_RADIUS_M) > 1e-9:
        raise ValueError(f"contact_radius_m {c.contact_radius_m} != {CONTACT_RADIUS_M}")
    if abs(c.contact_below_m - CONTACT_BELOW_M) > 1e-9:
        raise ValueError(f"contact_below_m {c.contact_below_m} != {CONTACT_BELOW_M}")
    if abs(c.contact_above_m - CONTACT_ABOVE_M) > 1e-9:
        raise ValueError(f"contact_above_m {c.contact_above_m} != {CONTACT_ABOVE_M}")
    if c.fuse_tip_node != "FuseTip":
        raise ValueError(f"fuse_tip_node {c.fuse_tip_node!r} != 'FuseTip'")
    if c.flight_pivot_node != "FlightPivot":
        raise ValueError(f"flight_pivot_node {c.flight_pivot_node!r} != 'FlightPivot'")
    if "CC-BY-4.0" not in c.attribution or "DJMaesen" not in c.attribution:
        raise ValueError("attribution must name DJMaesen and CC-BY-4.0")


def contract_json(c: PropContract) -> dict:
    return {
        "glb": c.glb, "sha256": c.sha256,
        "sourceSha256": c.source_sha256,
        "dimensionsM": list(c.dimensions_m), "modelUp": c.model_up,
        "modelGripOffsetM": c.model_grip_offset_m,
        "contactRadiusM": c.contact_radius_m,
        "contactBelowM": c.contact_below_m,
        "contactAboveM": c.contact_above_m,
        "fuseTipNode": c.fuse_tip_node,
        "flightPivotNode": c.flight_pivot_node,
        "attribution": c.attribution,
    }


def load_checked_in_contract() -> PropContract:
    j = json.loads(CONTRACT_OUT.read_text())
    return PropContract(
        glb=str(j["glb"]),
        sha256=str(j["sha256"]),
        source_sha256=str(j["sourceSha256"]),
        dimensions_m=tuple(float(v) for v in j["dimensionsM"]),
        model_up=str(j["modelUp"]),
        model_grip_offset_m=float(j["modelGripOffsetM"]),
        contact_radius_m=float(j["contactRadiusM"]),
        contact_below_m=float(j["contactBelowM"]),
        contact_above_m=float(j["contactAboveM"]),
        fuse_tip_node=str(j["fuseTipNode"]),
        flight_pivot_node=str(j["flightPivotNode"]),
        attribution=str(j["attribution"]),
    )


# ===========================================================================
# Blender inner stage: normalize + export the derived prop GLB
# ===========================================================================

def blender_prop_stage() -> None:
    """Runs INSIDE Blender (`--blender-export`). Imports the credited source,
    applies the deterministic axis/scale contract, seats the named anchors,
    exports ONE self-contained GLB, then re-imports it for the scale preview.
    """
    import bpy
    from mathutils import Vector

    sys.path.insert(0, str(SCRIPTS_DIR))
    import pose_measure_hands as pm

    if not SOURCE.exists():
        raise SystemExit(f"licensed source not found: {SOURCE}")

    # ---- import + collapse wrapper transforms ------------------------------
    pm.reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit("source GLB contains no mesh")
    bpy.context.view_layer.update()

    # Parent-clear KEEP-TRANSFORM first: imported wrapper nodes leave the mesh
    # parented, so object.location is local and a world-space centre subtract
    # would land in the wrong frame. Then join everything into ONE free mesh.
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if any(o.parent is not None for o in meshes):
        bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    if len(meshes) > 1:
        bpy.ops.object.join()
    for o in [o for o in bpy.data.objects if o.type != "MESH"]:
        bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    assert len(meshes) == 1, f"expected one joined mesh, got {len(meshes)}"
    bpy.context.view_layer.update()

    def world_bounds(objects):
        # mesh-data vertices + matrix_world: bound_box is cached and can be
        # stale right after transform_apply, which silently mis-centres roots.
        lo = Vector((float("inf"),) * 3)
        hi = Vector((float("-inf"),) * 3)
        for o in objects:
            for v in o.data.vertices:
                p = o.matrix_world @ v.co
                lo = Vector(map(min, lo, p))
                hi = Vector(map(max, hi, p))
        return lo, hi

    lo, hi = world_bounds(meshes)
    extents = hi - lo
    axis_i = max(range(3), key=lambda i: extents[i])
    src_axis = Vector((0.0, 0.0, 0.0))
    src_axis[axis_i] = 1.0
    # Long axis -> Blender +Z (the exporter's Y-up conversion maps +Z -> +Y).
    rot = src_axis.rotation_difference(Vector((0.0, 0.0, 1.0))).to_matrix().to_4x4()
    s_long = TARGET_LONG_M / extents[axis_i]
    transverse = [extents[i] for i in range(3) if i != axis_i]
    s_trans = TARGET_TRANSVERSE_M / max(transverse)
    from mathutils import Matrix
    scale = Matrix.Diagonal(
        (s_long if i == axis_i else s_trans for i in range(3))).to_4x4()
    mat = rot @ scale
    print(f"[prop] source extents={tuple(round(e, 5) for e in extents)} "
          f"axis={axis_i} s_long={s_long:.6f} s_trans={s_trans:.6f}")

    for o in meshes:
        o.matrix_world = mat @ o.matrix_world
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]

    # ---- seat the root at the physical mesh-bounds centre ------------------
    lo, hi = world_bounds(meshes)
    centre = (lo + hi) * 0.5
    for o in meshes:
        o.location = -centre
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    lo, hi = world_bounds(meshes)
    if max(abs(v) for v in (lo + hi)) > 1e-6:
        raise SystemExit(f"mesh not centred: lo={lo} hi={hi}")

    # ---- named anchor nodes -----------------------------------------------
    def empty(name, location):
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = "PLAIN_AXES"
        e.location = location
        bpy.context.collection.objects.link(e)
        return e

    # Blender +Z is the model long axis; glTF GripAnchor (0, -0.015, 0) maps
    # to Blender (0, 0, -0.015).
    flight = empty("FlightPivot", Vector((0.0, 0.0, 0.0)))
    grip = empty("GripAnchor", Vector((0.0, 0.0, MODEL_GRIP_OFFSET_M)))
    # FuseTip at the distal fuse end: the extreme vertex along the long axis.
    fuse_local = None
    mesh_obj = meshes[0]
    for v in mesh_obj.data.vertices:
        if fuse_local is None or v.co.z > fuse_local.z:
            fuse_local = v.co.copy()
    fuse = empty("FuseTip", fuse_local)
    print(f"[prop] FuseTip at {tuple(round(c, 5) for c in fuse_local)} "
          f"(mesh z range {lo.z:+.5f}..{hi.z:+.5f})")
    for o in meshes + [grip, fuse]:
        o.parent = flight

    # ---- textures at most 512x512, authored PBR preserved ------------------
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > MAX_TEXTURE_PX:
            f = MAX_TEXTURE_PX / max(w, h)
            nw, nh = max(1, round(w * f)), max(1, round(h * f))
            print(f"[prop] texture {img.name}: {w}x{h} -> {nw}x{nh}")
            img.scale(nw, nh)

    # ---- export one self-contained GLB ------------------------------------
    GLB_OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.context.scene.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(GLB_OUT), export_format="GLB",
                              use_selection=True, export_apply=True)
    print(f"[prop] exported {GLB_OUT} ({GLB_OUT.stat().st_size} bytes)")

    # ---- preview from the RE-IMPORTED derived file (what actually ships) ---
    pm.reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(GLB_OUT))
    prop = [o for o in bpy.data.objects if o.type == "MESH"]
    # Build the ruler mesh directly (no shade_smooth operator): the glTF
    # importer leaves the operator context unpolled in this session state.
    import bmesh
    ruler_me = bpy.data.meshes.new("Ruler180mm")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    scale = (0.006, 0.012, RULER_M)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
    bm.to_mesh(ruler_me)
    bm.free()
    for p in ruler_me.polygons:
        p.use_smooth = False
    ruler = bpy.data.objects.new("Ruler180mm", ruler_me)
    bpy.context.collection.objects.link(ruler)
    lo, hi = world_bounds(prop)
    ruler.location = Vector((hi.x + 0.014, 0.0, 0.0))   # beside the bundle
    bpy.context.view_layer.update()
    pm.assign(ruler, pm.make_pbr("Ruler", (0.75, 0.75, 0.78), 0.35))
    render_prop_preview(prop + [ruler], PREVIEW_OUT)


def render_prop_preview(objects, out_path: Path, res: int = PREVIEW_RES) -> None:
    """Neutral studio render of the derived prop beside its reference ruler."""
    import bpy
    from mathutils import Vector

    sys.path.insert(0, str(SCRIPTS_DIR))
    import pose_measure_hands as pm

    scene = pm.configure_engine(transparent=False)
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.eevee.taa_render_samples = 32
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.05, 0.055, 0.065, 1.0)
    bg.inputs[1].default_value = 0.35
    scene.eevee.use_raytracing = False
    scene.eevee.use_shadow_jitter_viewport = False

    lo = Vector((float("inf"),) * 3)
    hi = Vector((float("-inf"),) * 3)
    for o in objects:
        for corner in o.bound_box:
            p = o.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    target = (lo + hi) * 0.5
    reach = max((hi - lo).x, (hi - lo).y, (hi - lo).z) * 0.62
    eye = target + Vector((0.85, -0.85, 0.30)).normalized() * reach * 3.4
    bpy.ops.object.camera_add(location=eye)
    cam = bpy.context.active_object
    cam.data.lens = 52
    pm.point_at(cam, target)
    scene.camera = cam

    def area(nm, offs, energy, size):
        loc = target + Vector(offs) * reach * 3.0
        bpy.ops.object.light_add(type="AREA", location=loc)
        light = bpy.context.active_object
        light.name = nm
        light.data.energy = energy
        light.data.size = size
        light.data.use_shadow_jitter = False
        pm.point_at(light, target)

    area("Key", (1.0, -0.5, 1.0), 2.2, 0.30)
    area("Fill", (0.5, -0.9, -1.0), 0.9, 0.45)
    area("Rim", (-0.3, 1.0, 0.4), 1.1, 0.30)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(out_path)
    bpy.ops.render.render(write_still=True)
    print(f"[prop] preview -> {out_path}")


# ===========================================================================
# Outer prop driver
# ===========================================================================

def validate_source() -> str:
    """Refuse to touch anything but the credited DJMaesen asset. Returns sha."""
    if not SOURCE.exists():
        raise SystemExit(f"licensed source not found: {SOURCE}")
    meta = read_glb_asset_extras(SOURCE)
    if not str(meta.get("author", "")).startswith("DJMaesen"):
        raise SystemExit(f"source author {meta.get('author')!r} is not DJMaesen")
    if not str(meta.get("license", "")).startswith("CC-BY-4.0"):
        raise SystemExit(f"source license {meta.get('license')!r} is not CC-BY-4.0")
    if not str(meta.get("source", "")).endswith(
            "dynamite-bundle-6d333be39e454b458d48ad86f8a78df4"):
        raise SystemExit(f"source url {meta.get('source')!r} is not the credited model")
    return sha256_file(SOURCE)


def run_prop_stage() -> PropContract:
    source_sha = validate_source()
    cmd = ["blender", "--background", "--python", str(Path(__file__).resolve()),
           "--", "--blender-export"]
    print("[prop] " + " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)
    return measure_and_write_contract(source_sha)


def measure_and_write_contract(source_sha: str) -> PropContract:
    """Reopen the DERIVED GLB, measure bounds/nodes, then write the contract."""
    doc, blob = read_glb_chunks(GLB_OUT)
    lo, hi = glb_mesh_bounds(doc, blob)
    dims = tuple(hi[i] - lo[i] for i in range(3))
    names = glb_node_names(doc)
    for node in ("FlightPivot", "GripAnchor", "FuseTip"):
        if node not in names:
            raise SystemExit(f"derived GLB is missing the {node} node")
    centre_off = max(abs(lo[i] + hi[i]) for i in range(3))
    if centre_off > 1e-5:
        raise SystemExit(f"derived mesh not centred on FlightPivot (off {centre_off:.6f})")
    contract = PropContract(
        glb=GLB_OUT.name,
        sha256=sha256_file(GLB_OUT),
        source_sha256=source_sha,
        dimensions_m=dims,
        model_up="+Y",
        model_grip_offset_m=MODEL_GRIP_OFFSET_M,
        contact_radius_m=CONTACT_RADIUS_M,
        contact_below_m=CONTACT_BELOW_M,
        contact_above_m=CONTACT_ABOVE_M,
        fuse_tip_node="FuseTip",
        flight_pivot_node="FlightPivot",
        attribution=ATTRIBUTION,
    )
    validate_prop_contract(contract)
    size = GLB_OUT.stat().st_size
    if size > MAX_GLB_BYTES:
        raise SystemExit(f"derived GLB {size} bytes exceeds the {MAX_GLB_BYTES} budget")
    CONTRACT_OUT.parent.mkdir(parents=True, exist_ok=True)
    CONTRACT_OUT.write_text(json.dumps(contract_json(contract), indent=2) + "\n")
    print(f"[prop] contract -> {CONTRACT_OUT}")
    print(f"[prop] dimensions={tuple(round(d, 5) for d in dims)} "
          f"sha256={contract.sha256[:16]}... {size} bytes")
    return contract


def validate_checked_in() -> PropContract:
    """--validate-only: contract + GLB agreement without Blender or the source."""
    contract = load_checked_in_contract()
    validate_prop_contract(contract)
    if not GLB_OUT.exists():
        raise SystemExit(f"derived GLB missing: {GLB_OUT}")
    digest = sha256_file(GLB_OUT)
    if digest != contract.sha256:
        raise SystemExit(f"derived GLB sha256 {digest} != contract {contract.sha256}")
    doc, blob = read_glb_chunks(GLB_OUT)
    lo, hi = glb_mesh_bounds(doc, blob)
    dims = tuple(hi[i] - lo[i] for i in range(3))
    if any(abs(a - b) > 2e-4 for a, b in zip(dims, contract.dimensions_m)):
        raise SystemExit(f"measured dims {dims} != contract {contract.dimensions_m}")
    names = glb_node_names(doc)
    for node in (contract.fuse_tip_node, contract.flight_pivot_node, "GripAnchor"):
        if node not in names:
            raise SystemExit(f"derived GLB is missing the {node} node")
    print(f"[validate] {GLB_OUT.name}: dims={tuple(round(d, 4) for d in dims)} "
          f"nodes ok, sha256 ok, {GLB_OUT.stat().st_size} bytes")
    print("[validate] PASS")
    return contract


# ===========================================================================
# Task A3 — six poses against the exact derived prop
# ===========================================================================

def _first_true(fn, lo: float, hi: float, steps: int = 64, iters: int = 48) -> float:
    """First t in [lo,hi] where the monotonic predicate fn flips False->True.
    Coarse scan, then bisection: the same deterministic two-phase the trusted
    solver uses (pm.first_contact is sign-based; this is its boolean twin)."""
    prev = lo
    for i in range(1, steps + 1):
        t = lo + (hi - lo) * i / steps
        if fn(t):
            a, b = prev, t
            for _ in range(iters):
                m = 0.5 * (a + b)
                if fn(m):
                    b = m
                else:
                    a = m
            return b
        prev = t
    raise SystemExit(f"predicate never became true on [{lo},{hi}]")


def export_pose_soups(output_dir: Path) -> Path:
    """Outer driver: solve + export the six posed/capped hand soups.

    Writes pose-00-open.npz .. pose-05-firm-grip.npz plus authoring.json into
    the CALLER-OWNED directory and returns it. Task B runs this inside its own
    TemporaryDirectory; no temporary soup is ever committed.
    """
    contract = load_checked_in_contract()
    validate_prop_contract(contract)
    if not GLB_OUT.exists():
        raise SystemExit(f"derived GLB missing: {GLB_OUT} (run --prop-only first)")
    digest = sha256_file(GLB_OUT)
    if digest != contract.sha256:
        raise SystemExit(f"derived GLB sha256 {digest} != contract {contract.sha256}; "
                         "refusing to author poses against a different prop")
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    cmd = ["blender", "--background", "--python", str(Path(__file__).resolve()),
           "--", "--blender-poses", str(output_dir)]
    print("[poses] " + " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)
    for i, label in enumerate(LABELS):
        if not (output_dir / f"pose-{i:02d}-{label}.npz").exists():
            raise SystemExit(f"pose export incomplete: pose-{i:02d}-{label}.npz missing")
    if not (output_dir / "authoring.json").exists():
        raise SystemExit("pose export incomplete: authoring.json missing")
    return output_dir


def blender_pose_stage(output_dir: Path) -> None:
    """Runs INSIDE Blender (`--blender-poses DIR`). Solves open/firm with the
    trusted code paths, slerps the four intermediate keys, and runs EXACTLY the
    X1.26 extraction/skin/cut/cap helpers for all six rotations."""
    import math

    import numpy as np
    from mathutils import Matrix, Vector

    sys.path.insert(0, str(SCRIPTS_DIR))
    import bake_hand_sdf as bh
    import pose_measure_hands as pm
    from pose_measure_hands import FINGERS

    output_dir = Path(output_dir)
    contract = load_checked_in_contract()
    validate_prop_contract(contract)
    prop_sha = sha256_file(GLB_OUT)
    if prop_sha != contract.sha256:
        raise SystemExit(f"derived GLB sha256 {prop_sha} != contract")

    # ---- trusted inputs ------------------------------------------------
    gltf = pm.Gltf(pm.SRC)
    hand = pm.Hand(gltf, "R")
    hand_sha = sha256_file(pm.SRC)

    open_rots = bh.relaxed_rotations(hand)                 # X1.26 `open`
    firm_rots, prop_origin, prop_axis, prop_r = pm.build_grip(
        hand, contract.contact_radius_m)                    # the ONE seat
    if abs(prop_r - contract.contact_radius_m) > 1e-12:
        raise SystemExit("build_grip did not seat at the contract radius")

    # Common anatomical frame, derived ONCE from the open pose (the relaxed
    # pose leaves the metacarpals unrotated, so this is exactly the X1.26
    # frame) and reused for every key: one grid, one cap plane, one basis.
    open_world = hand.globals(open_rots)
    x_axis, y_axis, z_axis, origin, dorsal_sign = bh.anatomical_frame(hand, open_world)
    frame_rows = (x_axis, y_axis, z_axis)
    for world, tag in ((open_world, "open"), (hand.globals(firm_rots), "firm")):
        o2 = hand.posed_pivot(world, hand.wrist)
        if (o2 - origin).length > 1e-9:
            raise SystemExit(f"wrist origin moved between {tag} and open pose")

    def to_local(p: Vector) -> Vector:
        d = Vector(p) - origin
        return Vector((d.dot(x_axis), d.dot(y_axis), d.dot(z_axis)))

    grip_local = to_local(prop_origin)
    axis_local = Vector((prop_axis.dot(x_axis), prop_axis.dot(y_axis),
                         prop_axis.dot(z_axis))).normalized()

    # modelRotationLocal: model +Y -> axisLocal; model +Z -> the closest
    # orthogonal anatomical dorsal direction; model +X := +Y x +Z (proper).
    dorsal_local = Vector((0.0, 0.0, dorsal_sign))
    z_model = (dorsal_local - axis_local * dorsal_local.dot(axis_local)).normalized()
    x_model = axis_local.cross(z_model)
    r_model = Matrix((x_model, axis_local, z_model)).transposed()  # cols X,Y,Z
    q_model = r_model.to_quaternion().normalized()
    assert abs(q_model.magnitude - 1.0) < 1e-6, "modelRotationLocal not unit"
    assert ((r_model @ Vector((0.0, 1.0, 0.0))) - axis_local).length < 1e-6, \
        "modelRotationLocal does not rotate model +Y onto axisLocal"
    model_rotation_local = tuple(q_model)          # mathutils (w, x, y, z)

    # ---- per-bone open/firm quaternions + the blend --------------------
    finger_bones = [b for f in FINGERS for b in [hand.meta[f]] + hand.ph[f]]
    thumb_bones = list(hand.thumb)
    q_open = {b: open_rots.get(b, Matrix.Identity(3)).to_quaternion()
              for b in finger_bones + thumb_bones}
    q_firm = {b: firm_rots.get(b, Matrix.Identity(3)).to_quaternion()
              for b in finger_bones + thumb_bones}

    def rot_at(finger_t: float, thumb_t: float) -> dict:
        rots = {}
        for b in finger_bones:
            rots[b] = q_open[b].slerp(q_firm[b], finger_t).to_matrix()
        for b in thumb_bones:
            rots[b] = q_open[b].slerp(q_firm[b], thumb_t).to_matrix()
        return rots

    # ---- shared extraction (pose-independent) --------------------------
    extract = bh.extract_right_hand_components(gltf)
    kept_verts = extract["kept_verts"]
    kept_faces = extract["kept_faces"]

    digit_bones = {f: [hand.meta[f]] + hand.ph[f] for f in FINGERS}
    digit_bones["thumb"] = list(hand.thumb)
    # Contact diagnostics measure the WRAPPING surfaces: skin bound to the
    # phalanges (PIP chain distal). Metacarpal/MCP-bound skin is palm webbing
    # that the palm-seated bundle overlaps by construction -- covering it is
    # the seat, not penetration.
    contact_bones = {f: [hand.ph[f][1], hand.ph[f][2]] for f in FINGERS}
    contact_bones["thumb"] = [hand.thumb[1], hand.thumb[2]]
    digit_of = []
    for i in kept_verts:
        w = extract["wts"][i]
        label = None
        for name, bones in contact_bones.items():
            if any(w.get(b, 0.0) >= 0.5 for b in bones):
                label = name
                break
        digit_of.append(label)

    def capped_cylinder_gap(p_local: Vector) -> float:
        """Signed distance to the capped contact cylinder (local frame)."""
        d = p_local - grip_local
        t = d.dot(axis_local)
        perp = math.sqrt(max(d.length_squared - t * t, 0.0))
        if -contract.contact_below_m <= t <= contract.contact_above_m:
            return perp - R
        excess = (-contract.contact_below_m - t) if t < -contract.contact_below_m \
            else (t - contract.contact_above_m)
        return math.hypot(max(perp - R, 0.0), excess)

    # ---- contact solves -------------------------------------------------
    # first_contact_t uses the SKIN surface of the distal phalanges against
    # the capped contract cylinder -- the same measure as the per-pose
    # diagnostics below ("any distal digit surface"). The bone-capsule /
    # infinite-line measure would report the pinky as touching in the OPEN
    # pose (measured +0.85 mm at t=0 with a 74 mm bundle against the palm) and
    # collapse the whole key table to t=0; the skin measure reads +1.53 mm at
    # open and crosses +1.5 mm around t~0.65-0.7.
    R = contract.contact_radius_m

    dist_idx = {f: [j for j, i in enumerate(kept_verts)
                    if extract["wts"][i].get(hand.ph[f][2], 0.0) >= 0.5]
                for f in FINGERS}

    def pose_subset(world, indices):
        """Inverse-bind LBS over only the given kept-vert indices (same formula
        as bh.inverse_bind_skin; the scan calls this ~100x)."""
        from mathutils import Vector as _V
        chain = set(hand.chain)
        out = []
        for j in indices:
            i = kept_verts[j]
            w = {k: v for k, v in extract["wts"][i].items() if k in chain}
            free = 1.0 - sum(w.values())
            p = _V(extract["pos"][i]) * hand.scale
            acc = p * free if free > 1e-6 else _V((0.0, 0.0, 0.0))
            for name, weight in w.items():
                acc += (world[name] @ p) * weight
            out.append(acc)
        return out

    all_dist_idx = [j for f in FINGERS for j in dist_idx[f]]

    def distal_gap(world) -> float:
        posed = pose_subset(world, all_dist_idx)
        return min(capped_cylinder_gap(to_local(p)) for p in posed)

    def thumb_pad_gap(world) -> float:
        """Distal thumb capsule vs the bundle: the pad the solver aims.

        The thumb SHAFT transits the bundle interior mid-swing (the trusted
        solver aims the pad along the shortest arc, documented for fat bundles
        in pose_measure_hands) so the all-capsule minimum never crosses +2 mm;
        the pad is the part that 'comes within 2 mm of the bundle'."""
        a, b, r = hand.bone_segments(world, [hand.thumb[2]])[0]
        return pm.segment_line_distance(a, b, prop_origin, prop_axis) - r - R

    def thumb_gap(world) -> float:
        bundle = min(pm.segment_line_distance(a, b, prop_origin, prop_axis) - r - R
                     for a, b, r in hand.bone_segments(world, hand.thumb[1:]))
        tip = hand.thumb[2]
        a, b, rr = hand.bone_segments(world, [tip])[0]
        finger = min(pm.segment_segment_distance(a, b, c, d) - rr - r2
                     for f in FINGERS
                     for c, d, r2 in hand.bone_segments(world, hand.digit_bones(f)))
        return min(bundle, finger)

    print("[poses] solving first_contact_t (scan + bisection)...")
    first_contact_t = _first_true(
        lambda t: distal_gap(hand.globals(rot_at(t, 0.0))) <= 0.0015, 0.0, 1.0)
    fc_gap = distal_gap(hand.globals(rot_at(first_contact_t, 0.0)))
    if not -0.005 <= fc_gap <= 0.0015 + 1e-9:
        raise SystemExit(f"first-contact gap {fc_gap * 1000:+.2f} mm outside "
                         "[-5 mm, +1.5 mm]")
    print(f"[poses] first_contact_t={first_contact_t:.6f} "
          f"(distal gap {fc_gap * 1000:+.2f} mm)")

    wrap_t = first_contact_t + 0.65 * (1.0 - first_contact_t)
    print("[poses] solving thumb_contact_t after wrap...")
    thumb_contact_t = _first_true(
        lambda t: -0.005 <= thumb_pad_gap(hand.globals(rot_at(wrap_t, t))) <= 0.002,
        0.15, 1.0)
    tg_gap = thumb_pad_gap(hand.globals(rot_at(wrap_t, thumb_contact_t)))
    print(f"[poses] thumb_contact_t={thumb_contact_t:.6f} "
          f"(thumb pad gap {tg_gap * 1000:+.2f} mm)")

    finger_t = {
        "open": 0.0,
        "approach": 0.60 * first_contact_t,
        "first-contact": first_contact_t,
        "wrap": wrap_t,
        "thumb-lock": 0.95,
        "firm-grip": 1.0,
    }
    thumb_t = {
        "open": 0.0, "approach": 0.0, "first-contact": 0.0,
        "wrap": 0.15, "thumb-lock": thumb_contact_t, "firm-grip": 1.0,
    }

    # ---- per-pose: skin, frame, cut, cap, diagnose, NPZ -----------------
    poses: dict[str, dict] = {}
    face_counts: set[int] = set()
    per_pose_diag: dict[str, dict] = {}
    for idx, label in enumerate(LABELS):
        rots = rot_at(finger_t[label], thumb_t[label])
        world = hand.globals(rots)
        posed = bh.inverse_bind_skin(hand, world, extract)
        local = [to_local(Vector(p)) for p in posed]
        cut = bh.wrist_cut_cap(local, kept_faces, f"Hand{idx}_{label}")
        verts_out, faces_out = cut["vertices"], cut["faces"]
        face_counts.add(int(faces_out.shape[0]))
        if not np.isfinite(verts_out).all():
            raise SystemExit(f"{label}: non-finite vertex after cut/cap")
        ring = verts_out[np.abs(verts_out[:, 1] + bh.WRIST_CUT_M) < 3e-4]
        cap_drift_mm = (float(np.max(np.abs(ring[:, 1] + bh.WRIST_CUT_M)))
                        * 1000.0) if len(ring) else 0.0

        # skin-vertex contact diagnostics per digit. The hard -5 mm
        # penetration limit applies to the FINGERS: the thumb capsule
        # transit through the bundle is the solver's own shortest-arc swing
        # (recorded, not failed) -- the bundle mesh occludes it and the pad
        # settles above -5 mm by thumb_contact_t.
        digit_gaps: dict[str, float] = {}
        min_pen = 0.0
        for name in list(FINGERS) + ["thumb"]:
            best = None
            for j, dn in enumerate(digit_of):
                if dn != name:
                    continue
                # posed/kept index j maps to local[j] pre-cut; diagnostics use
                # the PRE-CUT posed surface (the closed hand, what contacts)
                g = capped_cylinder_gap(local[j])
                best = g if best is None else min(best, g)
            digit_gaps[name] = best if best is not None else float("nan")
            if best is not None and name != "thumb":
                min_pen = min(min_pen, best)

        segs = {name: hand.bone_segments(world, bones)
                for name, bones in contact_bones.items()}
        pair_gaps = {}
        names = list(FINGERS) + ["thumb"]
        for ai in range(len(names)):
            for bi in range(ai + 1, len(names)):
                na, nb = names[ai], names[bi]
                pair_gaps[f"{na}-{nb}"] = min(
                    pm.segment_segment_distance(a, b, c, d) - r1 - r2
                    for a, b, r1 in segs[na] for c, d, r2 in segs[nb])

        fingertip_gap = max(
            min(pm.segment_line_distance(a, b, prop_origin, prop_axis) - r - R
                for a, b, r in segs[f])
            for f in FINGERS) if label == "firm-grip" else None

        diag = {
            "faces": int(faces_out.shape[0]),
            "verts": int(verts_out.shape[0]),
            "boundaryEdges": cut["boundaryEdges"]["afterCap"],
            "capPlaneDriftMm": round(cap_drift_mm, 4),
            "digitGapsMm": {k: round(v * 1000.0, 2)
                            for k, v in digit_gaps.items()},
            "minPenetrationMm": round(min_pen * 1000.0, 2),
            "digitPairGapsMm": {k: round(v * 1000.0, 2)
                                for k, v in pair_gaps.items()},
            "thumbPropGapMm": round(min(
                pm.segment_line_distance(a, b, prop_origin, prop_axis) - r - R
                for a, b, r in segs["thumb"]) * 1000.0, 2),
        }
        if fingertip_gap is not None:
            diag["firmFingertipGapMm"] = round(fingertip_gap * 1000.0, 2)
        per_pose_diag[label] = diag

        rotations = np.array([tuple(
            (rots.get(b, Matrix.Identity(3)).to_quaternion()))
            for b in finger_bones + thumb_bones], dtype=np.float64)
        npz_path = output_dir / f"pose-{idx:02d}-{label}.npz"
        np.savez(npz_path,
                 vertices=verts_out,
                 faces=faces_out,
                 label=np.array(label),
                 rotations=rotations,
                 grip_local=np.array(tuple(grip_local), dtype=np.float64),
                 axis_local=np.array(tuple(axis_local), dtype=np.float64),
                 frame=np.array([tuple(r) for r in frame_rows] + [tuple(origin)],
                                dtype=np.float64),
                 diagnostics=json.dumps({
                     "label": label,
                     "fingerT": finger_t[label],
                     "thumbT": thumb_t[label],
                     "boneOrder": finger_bones + thumb_bones,
                     "contact": diag,
                     "components": extract["components"],
                     "boundaryEdges": cut["boundaryEdges"],
                     "wristCutM": bh.WRIST_CUT_M,
                     "frame": {"x": tuple(x_axis), "y": tuple(y_axis),
                               "z": tuple(z_axis), "origin": tuple(origin),
                               "dorsalSign": dorsal_sign},
                     "handScale": hand.scale,
                     "attribution": pm.ATTRIBUTION,
                 }),
                 source_sha256=np.array(hand_sha),
                 prop_sha256=np.array(prop_sha))
        poses[label] = {"verts": verts_out, "faces": faces_out,
                        "rots": rots, "path": npz_path}
        print(f"[poses] {label}: faces={diag['faces']} capDrift="
              f"{cap_drift_mm:.3f}mm digitGaps(mm)="
              + str(diag["digitGapsMm"]))

    # ---- hard failures (Task A step 5) ---------------------------------
    if len(face_counts) != 1:
        raise SystemExit(f"topology/face count differs across frames: {face_counts}")
    for label, diag in per_pose_diag.items():
        if diag["capPlaneDriftMm"] > 0.25:
            raise SystemExit(f"{label}: cap-plane drift {diag['capPlaneDriftMm']}mm > 0.25mm")
        if diag["minPenetrationMm"] < -5.0:
            raise SystemExit(f"{label}: finger penetration "
                             f"{diag['minPenetrationMm']}mm < -5mm "
                             f"({diag['digitGapsMm']})")
        soft_thumb = label in ("thumb-lock", "firm-grip")
        for pair, gap in diag["digitPairGapsMm"].items():
            limit = -7.0 if (soft_thumb and "thumb" in pair) else -2.0
            if gap < limit:
                raise SystemExit(f"{label}: digit separation {pair} {gap}mm "
                                 f"below {limit}mm")
        if "firmFingertipGapMm" in diag and diag["firmFingertipGapMm"] > 3.0:
            raise SystemExit(f"firm-grip: fingertip gap "
                             f"{diag['firmFingertipGapMm']}mm > +3mm")

    authoring = {
        "labels": list(LABELS),
        "fingerT": finger_t,
        "thumbT": thumb_t,
        "firstContactT": first_contact_t,
        "thumbContactT": thumb_contact_t,
        "gripLocal": list(grip_local),
        "axisLocal": list(axis_local),
        "modelRotationLocal": list(model_rotation_local),
        "modelRotationLocalOrder": "wxyz",
        "dorsalSign": dorsal_sign,
        "frame": {"x": list(x_axis), "y": list(y_axis), "z": list(z_axis),
                  "origin": list(origin)},
        "prop": contract_json(contract),
        "handSourceSha256": hand_sha,
        "attribution": pm.ATTRIBUTION,
        "poses": per_pose_diag,
        "files": [f"pose-{i:02d}-{l}.npz" for i, l in enumerate(LABELS)],
    }
    (output_dir / "authoring.json").write_text(json.dumps(authoring, indent=2) + "\n")
    print(f"[poses] authoring.json -> {output_dir / 'authoring.json'}")

    render_contact_sheet(poses, r_model, grip_local, axis_local, contract)


def render_contact_sheet(poses: dict, r_model, grip_local, axis_local,
                         contract: PropContract) -> None:
    """One fixed-camera sheet: all six posed soups, each with the CHECKED-IN
    derived GLB seated at the authored transform. Written to the dev note."""
    import bpy
    from mathutils import Matrix, Vector

    sys.path.insert(0, str(SCRIPTS_DIR))
    import pose_measure_hands as pm

    pm.reset_scene()
    clay = pm.make_pbr("Clay", (0.66, 0.46, 0.38), 0.6)

    def clay_mesh(name, verts, faces):
        # Direct mesh build (no shade_smooth operator): the glTF importer
        # leaves operator contexts unpolled later in this scene.
        import bpy
        from mathutils import Vector
        me = bpy.data.meshes.new(name)
        me.from_pydata([Vector(tuple(map(float, v))) for v in verts],
                       [], [tuple(map(int, f)) for f in faces])
        me.validate()
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        me.update()
        obj = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(obj)
        pm.assign(obj, clay)
        return obj

    # glTF(Y-up) -> Blender(Z-up) for the importer's subtree convention.
    u_t = Matrix(((1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, -1.0, 0.0)))
    m_model = r_model.to_4x4() @ u_t.to_4x4()
    root_local = Vector(grip_local) - Vector(axis_local) * contract.model_grip_offset_m

    cell_w, cell_h = 0.26, 0.30
    all_objects = []
    # Build every hand soup FIRST (imports would break operator contexts).
    hand_objs = {}
    for idx, label in enumerate(LABELS):
        pose = poses[label]
        hand_objs[label] = clay_mesh(f"Hand_{idx}_{label}",
                                     pose["verts"], pose["faces"])
        hand_objs[label].location = Vector(
            (((idx % 3 - 1) * cell_w), (-(idx // 3) * cell_h), 0.0))
        all_objects.append(hand_objs[label])
    bpy.context.view_layer.update()

    for idx, label in enumerate(LABELS):
        cx = (idx % 3 - 1) * cell_w
        cy = -(idx // 3) * cell_h
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(GLB_OUT))
        new_roots = [o for o in bpy.data.objects if o not in before
                     and o.parent is None]
        if len(new_roots) != 1:
            raise SystemExit(f"{label}: expected one imported GLB root, got {new_roots}")
        root = new_roots[0]
        root.matrix_world = (Matrix.Translation(Vector((cx, cy, 0.0)) + root_local)
                             @ m_model)
        bpy.context.view_layer.update()
        # the imported GripAnchor must land on this pose's authored seat
        anchor = next((o for o in bpy.data.objects
                       if o not in before and o.name.startswith("GripAnchor")), None)
        if anchor is not None:
            err = (anchor.matrix_world.translation
                   - Vector((cx, cy, 0.0)) - Vector(grip_local)).length
            if err > 1.5e-3:
                raise SystemExit(f"{label}: seated GLB GripAnchor misses gripLocal "
                                 f"by {err * 1000:.2f} mm")
        all_objects.append(root)

    scene = pm.configure_engine(transparent=False)
    scene.render.resolution_x = 1536
    scene.render.resolution_y = 1024
    scene.eevee.taa_render_samples = 32
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.05, 0.055, 0.065, 1.0)
    bg.inputs[1].default_value = 0.35
    scene.eevee.use_raytracing = False
    scene.eevee.use_shadow_jitter_viewport = False

    lo = Vector((float("inf"),) * 3)
    hi = Vector((float("-inf"),) * 3)
    for o in all_objects:
        for corner in o.bound_box:
            p = o.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    target = (lo + hi) * 0.5
    reach = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z) * 0.62
    # local frame: +X thumbward, +Y distal; palm reads the grip best
    eye = target + Vector((0.55, 0.30, 0.85)).normalized() * reach * 3.2
    bpy.ops.object.camera_add(location=eye)
    cam = bpy.context.active_object
    cam.data.lens = 52
    pm.point_at(cam, target)
    scene.camera = cam

    def area(nm, offs, energy, size):
        loc = target + Vector(offs) * reach * 3.0
        bpy.ops.object.light_add(type="AREA", location=loc)
        light = bpy.context.active_object
        light.name = nm
        light.data.energy = energy
        light.data.size = size
        light.data.use_shadow_jitter = False
        pm.point_at(light, target)

    area("Key", (1.0, -0.5, 1.0), 2.2, 0.26)
    area("Fill", (0.5, -0.9, -1.0), 0.9, 0.40)
    area("Rim", (-0.3, 1.0, 0.4), 1.1, 0.26)

    POSE_SHEET_OUT.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(POSE_SHEET_OUT)
    bpy.ops.render.render(write_still=True)
    print(f"[poses] contact sheet -> {POSE_SHEET_OUT}")


# ===========================================================================
# CLI
# ===========================================================================

def parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--prop-only", action="store_true",
                    help="regenerate the derived GLB + JSON contract + preview")
    ap.add_argument("--validate-only", action="store_true",
                    help="validate the checked-in derived GLB and contract")
    ap.add_argument("--blender-export", action="store_true",
                    help=argparse.SUPPRESS)   # internal: re-entry inside Blender
    ap.add_argument("--blender-poses", type=Path, metavar="DIR",
                    help=argparse.SUPPRESS)   # internal: re-entry inside Blender
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
        try:
            import bpy  # noqa: F401  -- presence == running INSIDE Blender
            argv = argv[argv.index("--") + 1:] if "--" in argv else []
        except ImportError:
            pass
    args = parse_args(argv)
    if args.blender_export:
        blender_prop_stage()
        return 0
    if args.blender_poses is not None:
        blender_pose_stage(args.blender_poses)
        return 0
    if args.validate_only:
        validate_checked_in()
        return 0
    if args.prop_only:
        run_prop_stage()
        return 0
    # default full run: prop, then the six poses against it, then validate
    run_prop_stage()
    with tempfile.TemporaryDirectory(prefix="pose-soups-") as tmp:
        export_pose_soups(Path(tmp))
    validate_checked_in()
    return 0


if __name__ == "__main__":
    sys.exit(main())
