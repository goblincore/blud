#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["libigl==2.6.2", "numpy==2.5.2"]
# ///
"""Bone-local SDF bake pipeline for the textured rigged humanoid (spike).

Plan: docs/superpowers/plans/2026-08-17-humanoid-sdf-sever-spike.md
Spec: docs/superpowers/specs/2026-08-17-humanoid-sdf-sever-spike-design.md

Task 1 scope: canonical Blender export of the owner's rigged zombie and
weight-derived planar bone partitions. Task 2 (same file) adds the distance/
color atlases; nothing here bakes volumes yet.

Process split (bake_hand_sdf.py pattern):

  outer (this file, plain Python + numpy/libigl via PEP 723)
      drives `blender --background --python THIS_FILE -- --blender-export X`,
      verifies the exported soup against a stdlib GLB read of the source,
      derives partitions/bands/reports/previews.

  inner (runs INSIDE Blender, no libigl)
      imports the canonical GLB into a clean scene, extracts bind-pose
      geometry, face-corner UVs, skin weights, skeleton, and the decoded
      base-color texture into one deterministic NPZ.

Coordinate convention: all exported spatial data is in the GLB MESH-ACCESSOR
frame (Y up, metres, right-handed) -- the frame the POSITION/TEXCOORD/JOINTS
accessors and the inverse binds live in, and the frame where this asset's
skinning composes to identity at bind (a 1.66 m character; the source's
scene root carries an inert-for-skinning uniform 0.01 node scale, recorded
as scene_from_mesh in every report). The Blender import is verified against
the accessor frame by multiset parity before any soup is used.

Skin-weight convention: joints/weights are the top-4 GLB slots, rows
normalized to sum 1. UV convention: GLB (v=0 at the image's top row).
Support planes: `inside when dot(n, p) + w <= 0`, in BONE-LOCAL bind frames.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import zlib
from pathlib import Path

import numpy as np
import numpy.typing as npt

REPO_ROOT = Path(__file__).resolve().parent.parent

SOURCE_GLB = REPO_ROOT / "assets-source/humanoid-sdf/zombie-rigged.glb"
OUT_DIR = REPO_ROOT / "public/assets/lab/humanoid-sdf"
SPIKE_NOTES_DIR = REPO_ROOT / "docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike"
REPORT_PATH = SPIKE_NOTES_DIR / "source-report.json"
PREVIEW_PATH = SPIKE_NOTES_DIR / "partition-preview.png"

# The canonical owner-created input this spike is built from. The checked-in
# copy must stay byte-identical (name, length and hash travel to the manifest).
ORIGINAL_GLB_PATH = ("/Users/donny/Downloads/zombietest2/Meshy_AI_zombie_biped/"
                     "Meshy_AI_zombie_biped_Character_output.glb")
EXPECTED_SOURCE_SHA256 = "2b23530a64466ca650ead74e49feaf54b6463c254ecccc9b3d56ba993a33cd28"

ELBOW_OVERLAP_M = 0.030
LIMB_PITCH_M = 0.006
DETAIL_PITCH_M = 0.003
MARGIN_M = 0.012

# Weight-difference below which a vertex counts as equal-influence for a
# parent/child pair (design: boundary centre from the blend cross-section).
EQUAL_INFLUENCE_MAX_DIFF = 0.15
# A face is "strongly owned" when its dominant bone holds at least this much
# of the summed corner weight; weaker faces go to the strongest ADJACENT
# partition (lowest joint index breaks ties).
STRONG_FACE_WEIGHT = 0.5
# Bones whose total skin weight is below this fold into their nearest
# deforming ancestor (deterministic named rule, recorded in every report).
FOLD_WEIGHT_EPS = 1e-6
FOLD_RULE_NAME = "zero-skin-fold-to-nearest-deforming-ancestor"

# Detail-pitch bones (spec: 3 mm for head and hands).
DETAIL_NAME_TOKENS = ("Head", "Hand")

UV_CONVENTION = "glb"          # v = 0 at the image's top row

# -- Task 2 atlas / manifest constants ---------------------------------------
MANIFEST_VERSION = 1
MANIFEST_KIND = "humanoid-bone-sdf"
ATLAS_ORDER = "x-fastest-y-z"
ATLAS_PADDING = 2
ATLAS_PAGE_COUNT = 1
MAX_ATLAS_DIM = 2048            # WebGPU maxTextureDimension3D minimum
MAX_TRANSPORT_PART_BYTES = 64 * 1024 * 1024
COARSE_MAX_DIM = 16             # per-bone coarse CPU brick, per axis
EMPTY_DISTANCE_M = 1.0          # positive distance for empty atlas texels
EMPTY_COLOR = (0, 0, 0, 0)      # transparent black for empty atlas texels

# Sever parameters (Tasks 4-7 consume these values and may not invent
# replacements).
SEVER_CUT_SEED = 12648430
SEVER_IRREGULARITY_M = 0.004
SEVER_RIM_WIDTH_M = 0.008

# Selected SDF route + pinned Blender version, from the shared qualification
# (docs/dev-notes/2026-08-18-blender-sdf-grid/qualification.json).
SELECTED_ROUTE = "direct-vdb"
EXPECTED_BLENDER_VERSION = "5.2.0 LTS"
SDF_THRESHOLD = 0.0
SDF_ADAPTIVITY = 0.0

# Conservative sweep bound for cluster proxy boxes: the documented maximum
# bone-local surface-warp amplitude plus a margin for the 0-100 deg elbow
# sweep discretisation (see build_clusters).
MAX_WARP_M = 0.010
MAX_SAMPLED_BONES_PER_CLUSTER = 4


# ===========================================================================
# Import-safe types (no Blender, no libigl)
# ===========================================================================

@dataclasses.dataclass(frozen=True)
class SourceInfo:
    vertex_count: int
    triangle_count: int
    joint_count: int
    bone_names: tuple[str, ...]
    texture_size: tuple[int, int]
    source_sha256: str
    texture_sha256: str


@dataclasses.dataclass(frozen=True)
class SourceSoup:
    vertices: np.ndarray       # (V,3) model metres
    faces: np.ndarray          # (F,3) uint32
    face_uvs: np.ndarray       # (F,3,2), GLB UV convention recorded
    joints: np.ndarray         # (V,4) joint slots
    weights: np.ndarray        # (V,4), normalized
    bone_names: tuple[str, ...]
    parents: tuple[int, ...]
    inverse_bind: np.ndarray   # (B,4,4)
    albedo_rgba: np.ndarray    # (H,W,4) uint8
    base_color_factor: np.ndarray  # (4,) float64
    texture_transform: np.ndarray  # (3,3) homogeneous UV transform


@dataclasses.dataclass(frozen=True)
class JointBand:
    parent: str
    child: str
    center: np.ndarray
    axis: np.ndarray
    width_m: float


@dataclasses.dataclass(frozen=True)
class BonePartition:
    name: str
    joint_index: int
    parent_index: int
    bind_to_model: np.ndarray
    model_to_bind: np.ndarray
    support_planes: np.ndarray  # (N,4), inside when dot(n,p)+w <= 0
    pitch_m: float


@dataclasses.dataclass(frozen=True)
class PartitionResult:
    partitions: tuple[BonePartition, ...]
    face_owners: np.ndarray            # (F,) partition row index, -1 = unowned
    unowned_face_indices: np.ndarray   # (U,) int64, expected empty
    bands: tuple[JointBand, ...]
    coverage: dict                     # per-joint + global diagnostics


# -- Task 2 atlas packing / transport types ----------------------------------

@dataclasses.dataclass(frozen=True)
class BrickRequest:
    bone: str
    dims: tuple[int, int, int]


@dataclasses.dataclass(frozen=True)
class AtlasBrick:
    bone: str
    dims: tuple[int, int, int]
    offset: tuple[int, int, int]
    bounds_min: tuple[float, float, float]
    bounds_max: tuple[float, float, float]
    voxel: tuple[float, float, float]


@dataclasses.dataclass(frozen=True)
class AtlasLayout:
    dimensions: tuple[int, int, int]
    padding: int
    bricks: tuple[AtlasBrick, ...]

    def to_json(self) -> dict:
        return {
            "dimensions": list(self.dimensions),
            "padding": int(self.padding),
            "bricks": [{
                "bone": b.bone,
                "dims": list(b.dims),
                "offset": list(b.offset),
                "boundsMin": list(b.bounds_min),
                "boundsMax": list(b.bounds_max),
                "voxel": list(b.voxel),
            } for b in self.bricks],
        }


# ===========================================================================
# Lazy loader for the shared qualified Blender backend (import-safe; bpy and
# libigl stay function-local there, so importing under uv or inside Blender
# never touches them).
# ===========================================================================

_SDF_MODULE = None


def _sdf_module():
    """The shared blender_sdf_grid module, loaded once (import-safe)."""
    global _SDF_MODULE
    if _SDF_MODULE is None:
        import importlib.util
        path = Path(__file__).resolve().parent / "blender_sdf_grid.py"
        spec = importlib.util.spec_from_file_location("blender_sdf_grid_for_hum",
                                                      path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        _SDF_MODULE = module
    return _SDF_MODULE


# ===========================================================================
# Stdlib GLB reader (used by the outer verifier and the in-Blender stage for
# joint order / material metadata; never a substitute for the Blender import)
# ===========================================================================

_GLTF_COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
_GLTF_DTYPES = {5120: "i1", 5121: "u1", 5122: "<i2", 5123: "<u2",
                5125: "<u4", 5126: "<f4"}


def _node_matrix(node: dict) -> npt.NDArray[np.float64]:
    """A glTF node's local TRS as a column-vector 4x4."""
    t = np.asarray(node.get("translation", [0.0, 0.0, 0.0]), dtype=np.float64)
    q = np.asarray(node.get("rotation", [0.0, 0.0, 0.0, 1.0]), dtype=np.float64)
    s = np.asarray(node.get("scale", [1.0, 1.0, 1.0]), dtype=np.float64)
    x, y, z, w = q
    r = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    m = np.eye(4)
    m[:3, :3] = s[:, None] * r
    m[:3, 3] = t
    return m


def read_glb(path: Path) -> dict:
    """Deterministic stdlib read of the canonical GLB: JSON, binary chunk,
    and decoded accessors/images needed for export parity verification."""
    raw = path.read_bytes()
    if len(raw) < 20 or raw[:4] != b"glTF":
        raise ValueError(f"{path}: not a GLB")
    json_len, _ = struct.unpack_from("<II", raw, 12)
    gltf = json.loads(raw[20:20 + json_len])
    bin_off = 20 + json_len
    bin_len, _ = struct.unpack_from("<II", raw, bin_off)
    bin_off += 8
    bindata = raw[bin_off:bin_off + bin_len]
    if len(bindata) != bin_len:
        raise ValueError(f"{path}: truncated BIN chunk")

    def accessor(ai: int) -> npt.NDArray:
        a = gltf["accessors"][ai]
        dtype = _GLTF_DTYPES[a["componentType"]]
        ncomp = _GLTF_COMPONENTS[a["type"]]
        bv = gltf["bufferViews"][a["bufferView"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride", 0) or np.dtype(dtype).itemsize * ncomp
        if stride != np.dtype(dtype).itemsize * ncomp:
            arr = np.frombuffer(bindata, dtype=np.uint8,
                                count=a["count"] * stride, offset=off)
            arr = arr.reshape(a["count"], stride)[
                :, :np.dtype(dtype).itemsize * ncomp].copy()
            return arr.view(np.dtype(dtype)).reshape(a["count"], ncomp)
        return np.frombuffer(bindata, dtype=np.dtype(dtype),
                             count=a["count"] * ncomp, offset=off).reshape(
                                 a["count"], ncomp)

    out = {
        "json": gltf,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "byteLength": len(raw),
        "filename": Path(ORIGINAL_GLB_PATH).name,
        "accessor": accessor,
        "bindata": bindata,
    }

    skin = gltf.get("skins", [])
    if len(skin) != 1:
        raise ValueError(f"{path}: expected exactly one skin, got {len(skin)}")
    skin = skin[0]
    joints = skin["joints"]
    out["bone_names"] = tuple(gltf["nodes"][j].get("name", f"node{j}")
                              for j in joints)
    node_parent: dict[int, int] = {}
    for ni, node in enumerate(gltf["nodes"]):
        for child in node.get("children", []):
            node_parent[child] = ni
    name_to_joint = {n: i for i, n in enumerate(out["bone_names"])}
    parents: list[int] = []
    for j in joints:
        p = node_parent.get(j)
        pn = gltf["nodes"][p].get("name") if p is not None else None
        parents.append(name_to_joint[pn] if pn in name_to_joint else -1)
    out["parents"] = tuple(parents)
    if skin.get("inverseBindMatrices") is None:
        raise ValueError(f"{path}: skin has no inverseBindMatrices")
    # glTF matrices are column-major: transpose the row-major reshape.
    ibm = accessor(skin["inverseBindMatrices"]).reshape(-1, 4, 4)
    out["inverse_bind"] = np.ascontiguousarray(ibm.transpose(0, 2, 1)).astype(
        np.float64)

    meshes = [n for n in gltf.get("nodes", []) if "mesh" in n]
    skinned = [n for n in meshes if n.get("skin") is not None]
    if len(skinned) != 1:
        raise ValueError(f"{path}: expected one skinned mesh node, got {len(skinned)}")
    node = skinned[0]
    prims = gltf["meshes"][node["mesh"]]["primitives"]
    if len(prims) != 1:
        raise ValueError(f"{path}: expected one mesh primitive, got {len(prims)}")
    attrs = prims[0]["attributes"]
    for want in ("POSITION", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"):
        if want not in attrs:
            raise ValueError(f"{path}: mesh primitive missing {want}")
    if prims[0].get("targets"):
        raise ValueError(f"{path}: morph targets are unsupported")
    out["position"] = accessor(attrs["POSITION"]).astype(np.float64)
    out["texcoord"] = accessor(attrs["TEXCOORD_0"]).astype(np.float64)
    out["joints"] = accessor(attrs["JOINTS_0"]).astype(np.int64)
    out["weights"] = accessor(attrs["WEIGHTS_0"]).astype(np.float64)
    out["indices"] = accessor(prims[0]["indices"]).reshape(-1).astype(np.int64)

    # Static scene placement of the mesh node (composed parent-chain TRS).
    # Inert for skinning per the glTF spec (skinned mesh node transforms are
    # ignored), but recorded as the source basis and used to assert the
    # Blender import placed the object identically.
    ni = gltf["nodes"].index(node)
    chain: list[dict] = []
    while ni is not None:
        chain.append(gltf["nodes"][ni])
        ni = node_parent.get(ni)
    scene_from_mesh = np.eye(4)
    for n in reversed(chain):
        if "matrix" in n:
            raise ValueError(f"{path}: node {n.get('name')!r} uses a raw matrix "
                             "TRS; TRS-only sources expected for this spike")
        scene_from_mesh = scene_from_mesh @ _node_matrix(n)
    out["scene_from_mesh"] = scene_from_mesh

    mats = gltf.get("materials", [])
    if len(mats) != 1:
        raise ValueError(f"{path}: expected one material, got {len(mats)}")
    pbr = mats[0].get("pbrMetallicRoughness", {})
    bct = pbr.get("baseColorTexture")
    if bct is None:
        raise ValueError(f"{path}: material has no baseColorTexture")
    out["base_color_factor"] = np.asarray(
        pbr.get("baseColorFactor", [1.0, 1.0, 1.0, 1.0]), dtype=np.float64)
    ext = mats[0].get("extensions", {}).get("KHR_texture_transform", {})
    tt = np.eye(3)
    if ext:
        scale = ext.get("scale", [1.0, 1.0])
        rot = ext.get("rotation", 0.0)
        offset = ext.get("offset", [0.0, 0.0])
        c, s = math.cos(rot), math.sin(rot)
        tt = np.array([[scale[0] * c, scale[1] * s, 0.0],
                       [-scale[0] * s, scale[1] * c, 0.0],
                       [offset[0], offset[1], 1.0]])
    out["texture_transform"] = tt
    image = gltf["images"][gltf["textures"][bct["index"]]["source"]]
    bv = gltf["bufferViews"][image["bufferView"]]
    off = bv.get("byteOffset", 0)
    out["image_bytes"] = bindata[off:off + bv["byteLength"]]
    out["image_name"] = image.get("name")
    return out


# ===========================================================================
# Stdlib PNG codec (deterministic, no Pillow: the baker stays numpy-only)
# ===========================================================================

def decode_png_rgba(data: bytes) -> npt.NDArray[np.uint8]:
    """Decode an 8-bit non-interlaced PNG into a top-first (H,W,4) RGBA8 array."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, chunks, palette, trns = 8, {}, None, None
    while pos < len(data):
        (length,) = struct.unpack_from(">I", data, pos)
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        if ctype == b"IHDR":
            w, h, depth, color = struct.unpack_from(">IIBB", body, 0)
            if depth != 8 or body[12] != 0:      # depth, interlace
                raise ValueError(f"PNG: depth {depth}/interlace unsupported")
        elif ctype == b"PLTE":
            palette = np.frombuffer(body, dtype=np.uint8).reshape(-1, 3)
        elif ctype == b"tRNS":
            trns = np.frombuffer(body, dtype=np.uint8)
        elif ctype == b"IDAT":
            chunks.setdefault("IDAT", []).append(body)
        elif ctype == b"IEND":
            break
        pos += 12 + length
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    raw = zlib.decompress(b"".join(chunks["IDAT"]))
    stride = w * channels
    out = np.empty((h, stride), dtype=np.uint8)
    prev = np.zeros(stride, dtype=np.uint8)
    src = 0
    for y in range(h):
        filt = raw[src]
        src += 1
        line = np.frombuffer(raw, dtype=np.uint8, count=stride, offset=src).copy()
        src += stride
        if filt == 0:
            pass
        elif filt == 1:      # Sub
            for i in range(channels, stride):
                line[i] = (int(line[i]) + int(line[i - channels])) & 0xFF
        elif filt == 2:      # Up
            line = (line.astype(np.int32) + prev).astype(np.uint8)
        elif filt == 3:      # Average
            for i in range(stride):
                left = int(line[i - channels]) if i >= channels else 0
                line[i] = (int(line[i]) + ((left + int(prev[i])) >> 1)) & 0xFF
        elif filt == 4:      # Paeth
            for i in range(stride):
                a = int(line[i - channels]) if i >= channels else 0
                b = int(prev[i])
                c = int(prev[i - channels]) if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (int(line[i]) + pred) & 0xFF
        else:
            raise ValueError(f"PNG: filter {filt} unsupported")
        out[y] = line
        prev = line
    img = out.reshape(h, w, channels)
    if color == 6:
        return np.ascontiguousarray(img)
    if color == 2:
        return np.ascontiguousarray(
            np.dstack([img, np.full((h, w, 1), 255, dtype=np.uint8)]))
    if color == 3:
        if palette is None:
            raise ValueError("PNG: palette missing")
        rgb = palette[img[:, :, 0]]
        alpha = (trns[img[:, :, 0]].reshape(h, w, 1) if trns is not None
                 else np.full((h, w, 1), 255, dtype=np.uint8))
        return np.ascontiguousarray(np.dstack([rgb, alpha]))
    if color == 0:
        return np.ascontiguousarray(
            np.dstack(3 * [img] + [np.full((h, w, 1), 255, dtype=np.uint8)]))
    if color == 4:
        return np.ascontiguousarray(
            np.dstack([img[:, :, 0:1], img[:, :, 0:1], img[:, :, 0:1],
                       img[:, :, 1:2]]))
    raise ValueError(f"PNG: color type {color} unsupported")


def encode_png_rgb(img: npt.NDArray[np.uint8]) -> bytes:
    """Encode (H,W,3) uint8 as a deterministic filter-0 RGB8 PNG."""
    h, w, _ = img.shape
    raw = b"".join(b"\x00" + row.tobytes() for row in img)
    def chunk(tag: bytes, body: bytes) -> bytes:
        return (struct.pack(">I", len(body)) + tag + body
                + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


# ===========================================================================
# Weight-derived planar joint math (pure numpy; Task 2 imports these)
# ===========================================================================

def _rigid_bind_pair(inverse_bind_i: npt.NDArray[np.floating]
                     ) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
    """Normalize one inverse bind to a RIGID metre-scale bind pair.

    The source's scene chain carries a uniform 0.01 node scale, so the raw
    bind's linear part is rotation x 0.01 and bone-local coordinates come out
    in centimetres. Brick grids, pitches, and the runtime's quaternion posing
    all want rigid metres: divide the uniform scale out and verify the
    remainder is orthonormal (non-uniform scale is a hard error).
    """
    ibm = np.asarray(inverse_bind_i, dtype=np.float64)
    b2m = np.linalg.inv(ibm)
    det = float(np.linalg.det(b2m[:3, :3]))
    if det <= 0.0:
        raise ValueError(f"bind determinant {det!r} is not positive")
    s = det ** (1.0 / 3.0)
    linear = b2m[:3, :3] / s
    # Snap to the nearest rotation (polar decomposition): the float32
    # accessor for this asset stores the rotation at x100 scale, so raw
    # orthonormality is only good to ~1e-3. Anything beyond 1e-2 off SO(3)
    # is a genuinely broken bind, not rounding.
    u, _, vt = np.linalg.svd(linear)
    R = u @ vt
    if float(np.abs(R - linear).max()) > 1e-2:
        raise ValueError(f"bind is far from a rotation (worst snap delta "
                         f"{float(np.abs(R - linear).max()):.3e}); "
                         "non-uniform scale or shear in the source bind")
    if float(np.abs(R @ R.T - np.eye(3)).max()) > 1e-9:
        raise ValueError("polar snap failed to produce a rotation")
    bind_to_model = np.eye(4)
    bind_to_model[:3, :3] = R
    bind_to_model[:3, 3] = b2m[:3, 3]
    return bind_to_model, np.linalg.inv(bind_to_model)


def derive_joint_band(
    parent: str,
    child: str,
    points: npt.NDArray[np.floating],
    parent_w: npt.NDArray[np.floating],
    child_w: npt.NDArray[np.floating],
    axis: npt.NDArray[np.floating],
    width_m: float,
) -> JointBand:
    """The one pure operation that places a parent/child boundary plane.

    Selects the equal-influence samples (|parentWeight - childWeight| <=
    EQUAL_INFLUENCE_MAX_DIFF) that also carry at least half their weight on
    the pair, and returns their centroid as the band centre. The centroid of
    the blend cross-section is already the axial mid-point of the band; the
    plane through it with the supplied normal IS the boundary, and the axial
    coordinate dot(axis, centre) is what joint_halfspaces turns into the
    plane offset. Nothing here may invent a spherical or capsule mask.
    """
    axis = np.asarray(axis, dtype=np.float64).reshape(3)
    if abs(float(np.linalg.norm(axis)) - 1.0) > 1e-9:
        raise ValueError(f"joint band axis must be unit length, got "
                         f"{np.linalg.norm(axis)!r}")
    if float(width_m) <= 0.0:
        raise ValueError(f"joint band width must be positive, got {width_m!r}")
    points = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    pw = np.asarray(parent_w, dtype=np.float64).reshape(-1)
    cw = np.asarray(child_w, dtype=np.float64).reshape(-1)
    if points.shape[0] != pw.shape[0] or pw.shape[0] != cw.shape[0]:
        raise ValueError("points/parent_w/child_w length mismatch: "
                         f"{points.shape[0]}/{pw.shape[0]}/{cw.shape[0]}")
    sel = ((np.abs(pw - cw) <= EQUAL_INFLUENCE_MAX_DIFF)
           & ((pw + cw) >= 0.5))
    if not sel.any():
        raise ValueError(
            f"no equal-influence samples for {parent} -> {child} (|dw| <= "
            f"{EQUAL_INFLUENCE_MAX_DIFF}, pair weight >= 0.5): the pair has no "
            "weight-derived boundary")
    center = points[sel].mean(axis=0)
    return JointBand(parent=parent, child=child, center=center,
                     axis=axis.copy(), width_m=float(width_m))


def joint_halfspaces(
    center: npt.NDArray[np.floating],
    axis: npt.NDArray[np.floating],
    width_m: float,
) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
    """Parent and child plane sets for one band, expanded by half the width.

    Inside is dot(n, p) + w <= 0 (BakePartition.support_planes convention).
    The parent keeps everything on its own side of the boundary PLUS width/2
    into child territory; the child keeps everything distal PLUS width/2 back
    into parent territory. These two planes are the ONLY place the declared
    overlap is created -- no endcaps, no spheres.
    """
    axis = np.asarray(axis, dtype=np.float64).reshape(3)
    center = np.asarray(center, dtype=np.float64).reshape(3)
    if abs(float(np.linalg.norm(axis)) - 1.0) > 1e-9:
        raise ValueError(f"joint axis must be unit length, got "
                         f"{np.linalg.norm(axis)!r}")
    half = float(width_m) / 2.0
    d = float(np.dot(axis, center))
    parent = np.array([[axis[0], axis[1], axis[2], -d - half]], dtype=np.float64)
    child = np.array([[-axis[0], -axis[1], -axis[2], d - half]], dtype=np.float64)
    return parent, child


def inside_support(point: npt.NDArray[np.floating],
                   partition: "BonePartition | npt.NDArray[np.floating]") -> bool:
    """True when the bone-local point satisfies every support half-space."""
    planes = getattr(partition, "support_planes", partition)
    planes = np.asarray(planes, dtype=np.float64).reshape(-1, 4)
    p = np.asarray(point, dtype=np.float64).reshape(3)
    return bool(np.max(p @ planes[:, :3].T + planes[:, 3]) <= 0.0)


def _plane_to_local(planes_model: npt.NDArray[np.floating],
                    bind_to_model: npt.NDArray[np.floating]
                    ) -> npt.NDArray[np.float64]:
    """Express model-space half-spaces in a partition's bone-local bind frame.

    p_model = R @ p_local + t  =>  n_local = R^T @ n_model,
    w_local = w_model + n_model . t. The bind must be rigid (orthonormal R):
    a scaled bind would silently distort the 30 mm overlap.
    """
    planes = np.asarray(planes_model, dtype=np.float64).reshape(-1, 4)
    B = np.asarray(bind_to_model, dtype=np.float64)
    R, t = B[:3, :3], B[:3, 3]
    if not np.allclose(R @ R.T, np.eye(3), atol=1e-6):
        raise ValueError(f"bind transform is not rigid (R @ R^T != I):\n{R}")
    out = np.empty_like(planes)
    out[:, :3] = planes[:, :3] @ R
    out[:, 3] = planes[:, 3] + planes[:, :3] @ t
    return out


def _leading_bones(joints: npt.NDArray[np.integer],
                   weights: npt.NDArray[np.floating]
                   ) -> tuple[npt.NDArray[np.int64], npt.NDArray[np.float64],
                              npt.NDArray[np.int64], npt.NDArray[np.float64]]:
    """Dominant and runner-up bone index/weight per vertex (weights sorted
    descending; slot ties resolve to the lower joint index)."""
    order = np.lexsort((joints, -weights), axis=1)   # -w, then joint index
    dom = np.take_along_axis(joints, order[:, :1], axis=1)[:, 0]
    domw = np.take_along_axis(weights, order[:, :1], axis=1)[:, 0]
    run = np.take_along_axis(joints, order[:, 1:2], axis=1)[:, 0]
    runw = np.take_along_axis(weights, order[:, 1:2], axis=1)[:, 0]
    return dom.astype(np.int64), domw, run.astype(np.int64), runw


def _sparse_weight(weights: npt.NDArray[np.floating],
                   joints: npt.NDArray[np.integer], bone: int
                   ) -> npt.NDArray[np.float64]:
    """Per-vertex weight of one bone from the (V,4) skin slots."""
    return np.where(joints == bone, weights, 0.0).sum(axis=1)


def _edge_adjacency(faces: npt.NDArray[np.integer]
                    ) -> tuple[npt.NDArray[np.int64], npt.NDArray[np.int64]]:
    """Undirected face pairs sharing an edge (each pair once, vectorized).

    Edges shared by 3+ faces contribute consecutive pairs only; the flood
    fill just needs connectivity, not every combination.
    """
    f = np.asarray(faces, dtype=np.int64)
    edges = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    keys = np.sort(edges, axis=1)
    order = np.lexsort((keys[:, 1], keys[:, 0]))
    keys = keys[order]
    # np.tile, NOT np.repeat: concatenate stacks the three edge slots as
    # BLOCKS ([all 0-1], [all 1-2], [all 2-0]), so entry i belongs to face
    # i % F. np.repeat assumes an interleaved layout and mislabels almost
    # every edge -- measured on this source, only 2 of the first 4,000 pairs
    # genuinely shared an edge, which fed the weak-face flood fill noise.
    rows = np.tile(np.arange(len(f), dtype=np.int64), 3)[order]
    same = (keys[1:] == keys[:-1]).all(axis=1)
    return rows[:-1][same], rows[1:][same]


# ===========================================================================
# Task 2: support volume, color projection helpers, packing, transport, field
# encodings. Everything here is pure numpy + stdlib (no Blender, no libigl).
# ===========================================================================

_IT = None


def _combinations():
    global _IT
    if _IT is None:
        from itertools import combinations as _comb
        _IT = _comb
    return _IT


def _convex_polytope_mesh(planes: npt.NDArray[np.floating],
                          box_min: Sequence[float],
                          box_max: Sequence[float]
                          ) -> tuple[npt.NDArray[np.float64],
                                     npt.NDArray[np.int64]]:
    """Triangulate `box ∩ {dot(n,p)+w <= 0 for each plane}` as a closed,
    outward-wound, manifold triangle mesh.

    The polytope is the intersection of the box (6 half-spaces) and the
    support planes. Every vertex is the solution of three active half-space
    equalities; every face is the polygon of vertices lying on one plane,
    fanned and oriented outward. Fully deterministic (numpy-only).
    """
    planes = np.asarray(planes, dtype=np.float64).reshape(-1, 4)
    if planes.shape[0] and not np.all(np.abs(planes[:, :3].sum(axis=1)) > 0.0):
        raise ValueError("support planes must have non-zero normals")
    lo = np.asarray(box_min, dtype=np.float64).reshape(3)
    hi = np.asarray(box_max, dtype=np.float64).reshape(3)
    if not np.all(hi > lo):
        raise ValueError(f"box bounds not strictly ordered: {lo} .. {hi}")
    box = np.array([
        [-1.0, 0.0, 0.0, lo[0]], [1.0, 0.0, 0.0, -hi[0]],
        [0.0, -1.0, 0.0, lo[1]], [0.0, 1.0, 0.0, -hi[1]],
        [0.0, 0.0, -1.0, lo[2]], [0.0, 0.0, 1.0, -hi[2]],
    ], dtype=np.float64)
    all_planes = np.vstack([box, planes]) if len(planes) else box
    n = all_planes[:, :3]
    w = all_planes[:, 3]
    m = len(all_planes)

    # 1. vertices: solve every triple of plane equalities, keep feasible ones.
    verts: list[npt.NDArray[np.float64]] = []
    for i, j, k in _combinations()(range(m), 3):
        a = np.stack([n[i], n[j], n[k]])
        if abs(float(np.linalg.det(a))) < 1e-12:
            continue
        p = np.linalg.solve(a, -np.stack([w[i], w[j], w[k]]))
        if bool((n @ p + w <= 1e-9).all()):
            verts.append(p)
    if not verts:
        return _sdf_module().closed_box_mesh(lo, hi)  # planes cull the box away
    verts = np.array(verts)
    keys = np.round(verts / 1e-9).astype(np.int64)
    _, first = np.unique(keys, axis=0, return_index=True)
    verts = verts[np.sort(first)]

    # 2. faces: one polygon per plane, fan-triangulated and outward-oriented.
    faces: list[npt.NDArray[np.int64]] = []
    for i in range(m):
        on = np.abs(verts @ n[i] + w[i]) <= 1e-7
        idx = np.flatnonzero(on)
        if len(idx) < 3:
            continue
        centre = verts[idx].mean(axis=0)
        e1 = np.cross(n[i], np.array([1.0, 0.0, 0.0]))
        if float(np.linalg.norm(e1)) < 1e-9:
            e1 = np.cross(n[i], np.array([0.0, 1.0, 0.0]))
        e1 = e1 / np.linalg.norm(e1)
        e2 = np.cross(n[i], e1)
        rel = verts[idx] - centre
        ang = np.arctan2(rel @ e2, rel @ e1)
        idx = idx[np.argsort(ang)]
        for a in range(1, len(idx) - 1):
            tri = np.array([idx[0], idx[a], idx[a + 1]], dtype=np.int64)
            v0, v1, v2 = verts[tri]
            if float(np.dot(np.cross(v1 - v0, v2 - v0), n[i])) < 0.0:
                tri = tri[[0, 2, 1]]
            faces.append(tri)
    return verts, np.array(faces, dtype=np.int64)


def support_mesh(partition: "BonePartition | npt.NDArray[np.floating]",
                 bounds: Sequence[Sequence[float]]
                 ) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.int64]]:
    """A GEOMETRICALLY closed, outward-wound support volume for one bone.

    The convex polytope of the partition's recorded `supportPlanes` (inside
    when dot(n,p)+w <= 0, bone-local) intersected with the brick bounds box.
    Blender's Mesh to SDF Grid needs a closed operand to sign an interior, so
    this mesh must survive `welded_mesh_info()` with zero boundary edges; the
    baker fails loudly otherwise. No planes -> the full box.
    """
    planes = getattr(partition, "support_planes", partition)
    planes = np.asarray(planes, dtype=np.float64).reshape(-1, 4)
    bounds = np.asarray(bounds, dtype=np.float64).reshape(2, 3)
    vertices, faces = _convex_polytope_mesh(planes, bounds[0], bounds[1])
    SDF = _sdf_module()
    info = SDF.welded_mesh_info(vertices, faces)
    if info["boundaryEdges"] != 0 or not info["closed"]:
        raise ValueError(
            f"support_mesh is not a closed manifold: {info['boundaryEdges']} "
            f"boundary edges after a 1 um weld; the support volume would bake "
            "as an unsigned shell")
    if info["signedVolumeM3"] <= 0.0:
        raise ValueError(
            f"support_mesh signed volume {info['signedVolumeM3']:.3e} is not "
            "positive (inward winding)")
    return vertices, faces


def barycentric_uv(bary: npt.NDArray[np.floating],
                   face_uvs: npt.NDArray[np.floating]) -> npt.NDArray[np.float64]:
    """Interpolate triangle UVs with barycentric weights: (N,3) @ (N,3,2)."""
    bary = np.asarray(bary, dtype=np.float64).reshape(-1, 3)
    face_uvs = np.asarray(face_uvs, dtype=np.float64).reshape(-1, 3, 2)
    if bary.shape[0] != face_uvs.shape[0]:
        raise ValueError("bary/face_uvs row count mismatch")
    return np.einsum("ij,ijk->ik", bary, face_uvs)


def sample_rgba_bilinear(tex: npt.NDArray[np.uint8],
                         uvs: npt.NDArray[np.floating]
                         ) -> npt.NDArray[np.uint8]:
    """Bilinear RGBA8 sampling in the recorded GLB convention (v=0 at the
    image's top row; tex is stored top-first (H,W,4)). Clamps to edges."""
    tex = np.asarray(tex, dtype=np.float64)
    h, w = tex.shape[0], tex.shape[1]
    uvs = np.asarray(uvs, dtype=np.float64).reshape(-1, 2)
    u = np.clip(uvs[:, 0], 0.0, 1.0) * (w - 1)
    v = np.clip(uvs[:, 1], 0.0, 1.0) * (h - 1)
    x0 = np.floor(u).astype(np.int64)
    y0 = np.floor(v).astype(np.int64)
    x1 = np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    fx = (u - x0)[:, None]
    fy = (v - y0)[:, None]
    top = tex[y0, x0] * (1.0 - fx) + tex[y0, x1] * fx
    bot = tex[y1, x0] * (1.0 - fx) + tex[y1, x1] * fx
    out = top * (1.0 - fy) + bot * fy
    return np.rint(out).astype(np.uint8)


def sample_bone_brick(field: npt.NDArray[np.floating],
                      bounds_min: Sequence[float],
                      voxel: Sequence[float],
                      point: Sequence[float]) -> float:
    """Trilinear sample of a dense brick (field[z,y,x]) at a bone-local point,
    clamped to the brick bounds (distance outside the window is undefined)."""
    field = np.asarray(field, dtype=np.float64)
    lo = np.asarray(bounds_min, dtype=np.float64)
    vx = np.asarray(voxel, dtype=np.float64)
    p = np.asarray(point, dtype=np.float64)
    nz, ny, nx = field.shape
    f = (p - lo) / vx
    cx = min(max(f[0], 0.0), nx - 1.0)
    cy = min(max(f[1], 0.0), ny - 1.0)
    cz = min(max(f[2], 0.0), nz - 1.0)
    x0, y0, z0 = int(math.floor(cx)), int(math.floor(cy)), int(math.floor(cz))
    x1, y1, z1 = min(x0 + 1, nx - 1), min(y0 + 1, ny - 1), min(z0 + 1, nz - 1)
    ax, ay, az = cx - x0, cy - y0, cz - z0
    g = field
    c000 = g[z0, y0, x0]; c100 = g[z0, y0, x1]
    c010 = g[z0, y1, x0]; c110 = g[z0, y1, x1]
    c001 = g[z1, y0, x0]; c101 = g[z1, y0, x1]
    c011 = g[z1, y1, x0]; c111 = g[z1, y1, x1]
    return float(
        c000 * (1 - ax) * (1 - ay) * (1 - az) + c100 * ax * (1 - ay) * (1 - az) +
        c010 * (1 - ax) * ay * (1 - az) + c110 * ax * ay * (1 - az) +
        c001 * (1 - ax) * (1 - ay) * az + c101 * ax * (1 - ay) * az +
        c011 * (1 - ax) * ay * az + c111 * ax * ay * az)


def resample_coarse_brick(dense_f32: npt.NDArray[np.floating],
                          dims: Sequence[int],
                          max_dim: int = COARSE_MAX_DIM
                          ) -> tuple[npt.NDArray[np.float32],
                                     tuple[int, int, int]]:
    """Trilinear resample a bone's dense field to at most `max_dim` per axis,
    preserving aspect ratio (a short axis is never up-sampled)."""
    dense = np.asarray(dense_f32, dtype=np.float32)
    dims = tuple(int(n) for n in dims)
    if dense.shape != (dims[2], dims[1], dims[0]):
        raise ValueError(f"dense shape {dense.shape} != (z,y,x) of dims {dims}")
    scale = 1.0
    if max(dims) > max_dim:
        scale = max_dim / float(max(dims))
    cdims = tuple(int(math.floor(n * scale)) for n in dims)
    cdims = tuple(min(max(n, 1), max_dim) for n in cdims)
    # endpoint-inclusive grid coordinates in the dense frame
    xs = np.linspace(0.0, dims[0] - 1.0, cdims[0])
    ys = np.linspace(0.0, dims[1] - 1.0, cdims[1])
    zs = np.linspace(0.0, dims[2] - 1.0, cdims[2])
    x0 = np.floor(xs).astype(np.int64)
    y0 = np.floor(ys).astype(np.int64)
    z0 = np.floor(zs).astype(np.int64)
    fx = (xs - x0).astype(np.float32)
    fy = (ys - y0).astype(np.float32)
    fz = (zs - z0).astype(np.float32)
    x1 = np.minimum(x0 + 1, dims[0] - 1)
    y1 = np.minimum(y0 + 1, dims[1] - 1)
    z1 = np.minimum(z0 + 1, dims[2] - 1)
    # interpolate x
    ix = dense[:, :, x0] * (1 - fx) + dense[:, :, x1] * fx     # (z,y,cx)
    # interpolate y
    iy = ix[:, y0, :] * (1 - fy[None, :, None]) + ix[:, y1, :] * fy[None, :, None]
    # interpolate z
    iz = iy[z0, :, :] * (1 - fz[:, None, None]) + iy[z1, :, :] * fz[:, None, None]
    return iz.astype(np.float32), cdims


def encode_r16f_field(field: npt.NDArray[np.floating]) -> bytes:
    """Little-endian float16, x-fastest C order (Blud's R16F encoding)."""
    return np.ascontiguousarray(field, dtype=np.float32).astype("<f2").tobytes("C")


def encode_rgba8_field(color: npt.NDArray[np.integer]) -> bytes:
    """RGBA8 in x-fastest-y-z order (C order of the (z,y,x,4) array)."""
    return np.ascontiguousarray(color, dtype=np.uint8).tobytes("C")


def split_transport_parts(data: bytes, max_bytes: int) -> list[bytes]:
    """Split a logical byte stream at `max_bytes` boundaries, never changing
    the concatenated stream."""
    if not data:
        return [b""]
    return [data[i:i + max_bytes] for i in range(0, len(data), max_bytes)]


def build_transport_contract(parts: Sequence[bytes],
                             urls: Sequence[str]) -> dict:
    """Per-part + combined hashes; the identical hash contract the atlases and
    the coarse pack use."""
    parts = list(parts)
    urls = list(urls)
    if len(parts) != len(urls):
        raise ValueError("parts/urls count mismatch")
    combined = b"".join(parts)
    return {
        "parts": [{"url": u, "byteLength": len(p),
                   "sha256": hashlib.sha256(p).hexdigest()}
                  for u, p in zip(urls, parts)],
        "combinedByteLength": len(combined),
        "combinedSha256": hashlib.sha256(combined).hexdigest(),
    }


def verify_transport_contract(parts: Sequence[bytes], contract: dict) -> None:
    """Reject a reordered, truncated, or padded transport part stream."""
    parts = list(parts)
    listed = list(contract["parts"])
    if len(parts) != len(listed):
        raise ValueError(f"part count {len(parts)} != contract {len(listed)}")
    for p, entry in zip(parts, listed):
        if len(p) != int(entry["byteLength"]):
            raise ValueError(f"part byteLength {len(p)} != "
                             f"{entry['byteLength']}")
        if hashlib.sha256(p).hexdigest() != entry["sha256"]:
            raise ValueError("part sha256 mismatch")
    combined = b"".join(parts)
    if len(combined) != int(contract["combinedByteLength"]):
        raise ValueError("combined byteLength mismatch")
    if hashlib.sha256(combined).hexdigest() != contract["combinedSha256"]:
        raise ValueError("combined sha256 mismatch")


def _try_pack(ordered: Sequence[BrickRequest], dims: Sequence[int],
              padding: int) -> list[tuple[tuple[int, int, int],
                                          tuple[int, int, int], str]] | None:
    """Extreme-point first-fit 3D placement; deterministic and non-overlapping."""
    W, H, D = (int(n) for n in dims)
    placed: list[tuple[int, int, int, int, int, int]] = []
    # leading padding border on the (0,0,0) corner so every brick starts at
    # offset >= padding in every axis (atlas edge halo, plan-pinned test).
    points = [(padding, padding, padding)]

    def fits(p: tuple[int, int, int], bw: int, bh: int, bd: int) -> bool:
        x, y, z = p
        if x + bw > W or y + bh > H or z + bd > D:
            return False
        for (px, py, pz, pw, ph, pd) in placed:
            if (x < px + pw + padding and px < x + bw + padding
                    and y < py + ph + padding and py < y + bh + padding
                    and z < pz + pd + padding and pz < z + bd + padding):
                return False
        return True

    for req in ordered:
        bw, bh, bd = req.dims
        best = None
        for p in sorted(set(points)):
            if fits(p, bw, bh, bd):
                best = p
                break
        if best is None:
            return None
        x, y, z = best
        placed.append((x, y, z, bw, bh, bd))
        for cand in ((x + bw + padding, y, z), (x, y + bh + padding, z),
                     (x, y, z + bd + padding),
                     (x + bw + padding, y + bh + padding, z),
                     (x + bw + padding, y, z + bd + padding),
                     (x, y + bh + padding, z + bd + padding),
                     (x + bw + padding, y + bh + padding, z + bd + padding)):
            points.append(cand)
    return [((p[0], p[1], p[2]), (p[3], p[4], p[5]), req.bone)
            for p, req in zip(placed, ordered)]


def pack_bricks(requests: Sequence[BrickRequest], max_dim: int = 256,
                padding: int = ATLAS_PADDING) -> AtlasLayout:
    """Deterministic first-fit 3D packing into the smallest power-of-two-ish
    container (each axis a power of two <= max_dim) that holds every brick."""
    ordered = sorted(requests,
                     key=lambda r: (-(r.dims[0] * r.dims[1] * r.dims[2]), r.bone))
    min_vol = sum(r.dims[0] * r.dims[1] * r.dims[2] for r in ordered)
    powers = [2 ** k for k in range(1, 21) if 2 ** k <= max_dim]
    candidates: list[tuple[int, tuple[int, int, int]]] = []
    for x in powers:
        for y in powers:
            for z in powers:
                if x * y * z >= min_vol:
                    candidates.append((x * y * z, (x, y, z)))
    candidates.sort()
    for _, dims in candidates:
        placed = _try_pack(ordered, dims, padding)
        if placed is not None:
            bricks = tuple(AtlasBrick(
                bone=bone, dims=bd, offset=off,
                bounds_min=(0.0, 0.0, 0.0), bounds_max=(0.0, 0.0, 0.0),
                voxel=(0.0, 0.0, 0.0)) for off, bd, bone in placed)
            return AtlasLayout(dims, padding, bricks)
    raise ValueError(
        f"no power-of-two container up to {max_dim} fits {len(ordered)} bricks")


def layout_has_overlap(layout: AtlasLayout) -> bool:
    """True when any two bricks' voxel ranges intersect."""
    bricks = list(layout.bricks)
    for i in range(len(bricks)):
        for j in range(i + 1, len(bricks)):
            a, b = bricks[i], bricks[j]
            if all(a.offset[k] < b.offset[k] + b.dims[k]
                   and b.offset[k] < a.offset[k] + a.dims[k] for k in range(3)):
                return True
    return False


def _canonical_node_contract_sha256() -> str:
    """Hash of the FIXED node-graph contract (per-spec fields excluded), the
    value the manifest pins so a Blender node or sign-convention change is a
    blocking mutation rather than a silent atlas difference."""
    SDF = _sdf_module()
    full = SDF.build_node_contract(SDF.SdfGridSpec())
    fixed = {k: full[k] for k in (
        "blenderVersionConstraint", "operationNodes", "composition",
        "units", "basis", "signConvention", "gridName", "bandWidth",
        "threshold", "adaptivity", "interpolation", "bake")}
    return SDF.sha256_text(SDF.canonical_json(fixed))


def derive_partitions(source: SourceSoup) -> PartitionResult:
    """Weight-derived planar bone partitions for the whole visible body.

    1. dominant/runner-up bones per vertex from normalized weights;
    2. parent/child boundary centres from equal-influence vertices of that
       exact skeleton edge (pair must lead the vertex, |dw| <= 0.15);
    3. plane axis = measured parent-joint -> child-joint bind direction;
    4. local oriented bounds from dominant-weight surface points;
    5. bounds expand by half the 30 mm overlap into each neighbour (only the
       joint_halfspaces planes may create that overlap);
    6. planar half-spaces at every parent/child boundary, never endcaps;
    7. weak faces go to the strongest adjacent partition, lowest joint index
       breaking ties;
    8. unowned face indices + per-joint coverage diagnostics emitted.
    """
    vertices = np.asarray(source.vertices, dtype=np.float64)
    faces = np.asarray(source.faces, dtype=np.int64)
    joints = np.asarray(source.joints, dtype=np.int64)
    weights = np.asarray(source.weights, dtype=np.float64)
    bone_names = tuple(source.bone_names)
    parents = tuple(int(p) for p in source.parents)
    B = len(bone_names)
    V, F = vertices.shape[0], faces.shape[0]

    row_sums = weights.sum(axis=1)
    if not np.all(np.isfinite(weights)) or not np.all(np.isfinite(vertices)):
        raise ValueError("non-finite weights or vertices in the source soup")
    if float(np.abs(row_sums - 1.0).max()) > 1e-3:
        raise ValueError(f"skin weights not normalized: worst row sum "
                         f"{row_sums.min()}..{row_sums.max()}")
    wn = weights / row_sums[:, None]
    dom, domw, run, runw = _leading_bones(joints, wn)

    totals = np.zeros(B)
    np.add.at(totals, joints.ravel(), wn.ravel())
    retained = totals > FOLD_WEIGHT_EPS
    if not retained.any():
        raise ValueError("no bone carries skin weight")

    # -- fold zero-skin bones into their nearest deforming ancestor ----------
    folded: list[dict] = []
    joint_fold_target = np.arange(B)
    for i in range(B):
        if retained[i]:
            continue
        j = parents[i]
        while j != -1 and not retained[j]:
            j = parents[j]
        if j == -1:
            raise ValueError(f"bone {bone_names[i]} has no deforming ancestor")
        joint_fold_target[i] = j
        folded.append({"bone": bone_names[i], "into": bone_names[j],
                       "rule": FOLD_RULE_NAME})

    # Rigid metre-scale bind frames per bone (the raw inverse binds carry the
    # source's uniform 0.01 scene scale; see _rigid_bind_pair).
    bind_to_model = np.stack([_rigid_bind_pair(source.inverse_bind[i])[0]
                              for i in range(B)])
    model_to_bind = np.stack([np.linalg.inv(bind_to_model[i]) for i in range(B)])
    bind_heads = bind_to_model[:, :3, 3]

    # -- joint bands on real skeleton edges ----------------------------------
    bands: list[JointBand] = []
    band_sel: list[int] = []
    band_of_parent: dict[int, list[int]] = {}
    band_of_child: dict[int, list[int]] = {}
    sharp: list[dict] = []
    for c in range(B):
        p = parents[c]
        if p == -1 or not retained[p] or not retained[c]:
            continue
        pw = _sparse_weight(wn, joints, p)
        cw = _sparse_weight(wn, joints, c)
        leads = (((dom == p) & (run == c)) | ((dom == c) & (run == p)))
        sel = leads & (np.abs(domw - runw) <= EQUAL_INFLUENCE_MAX_DIFF)
        if not sel.any():
            sharp.append({"parent": bone_names[p], "child": bone_names[c]})
            continue
        direction = bind_heads[c] - bind_heads[p]
        norm = float(np.linalg.norm(direction))
        if norm < 1e-9:
            raise ValueError(f"degenerate bind direction {bone_names[p]} -> "
                             f"{bone_names[c]}")
        band = derive_joint_band(bone_names[p], bone_names[c],
                                 vertices[sel], pw[sel], cw[sel],
                                 axis=direction / norm, width_m=ELBOW_OVERLAP_M)
        bands.append(band)
        band_sel.append(int(sel.sum()))
        band_of_parent.setdefault(p, []).append(len(bands) - 1)
        band_of_child.setdefault(c, []).append(len(bands) - 1)

    # -- per-partition planes (model space -> bone local) --------------------
    planes_by_bone: dict[int, list[npt.NDArray[np.float64]]] = {}
    for bi, band in enumerate(bands):
        p = bone_names.index(band.parent)
        c = bone_names.index(band.child)
        parent_plane, child_plane = joint_halfspaces(band.center, band.axis,
                                                     band.width_m)
        planes_by_bone.setdefault(p, []).append(parent_plane)
        planes_by_bone.setdefault(c, []).append(child_plane)

    retained_idx = [i for i in range(B) if retained[i]]
    row_of_joint = {j: r for r, j in enumerate(retained_idx)}

    def local_points(mask: npt.NDArray[np.bool_],
                     model_to_bind: npt.NDArray[np.float64]
                     ) -> npt.NDArray[np.float64]:
        pts = vertices[mask]
        return pts @ model_to_bind[:3, :3].T + model_to_bind[:3, 3]

    partitions: list[BonePartition] = []
    bound_masks: dict[str, npt.NDArray[np.bool_]] = {}
    for i in retained_idx:
        m2b = model_to_bind[i]
        b2m = bind_to_model[i]
        planes_model = (np.concatenate(planes_by_bone[i])
                        if i in planes_by_bone else np.zeros((0, 4)))
        planes_local = (_plane_to_local(planes_model, b2m)
                        if planes_model.size else np.zeros((0, 4)))
        lp = local_points(np.ones(V, dtype=bool), m2b)
        inside = ((lp @ planes_local[:, :3].T + planes_local[:, 3]) <= 0.0).all(
            axis=1) if planes_local.size else np.ones(V, dtype=bool)
        own = (dom == i)
        # Neighbours across my bands: if I am a band's parent my neighbour is
        # that band's child, and vice versa.
        neighbours = [bone_names.index(bands[bi].child) for bi in
                      band_of_parent.get(i, [])]
        neighbours += [bone_names.index(bands[bi].parent) for bi in
                       band_of_child.get(i, [])]
        adj = np.zeros(V, dtype=bool)
        for n in set(neighbours):
            adj |= (dom == n)
        mask = (own | adj) & inside
        bound_masks[bone_names[i]] = mask
        pitch = (DETAIL_PITCH_M
                 if any(tok in bone_names[i] for tok in DETAIL_NAME_TOKENS)
                 else LIMB_PITCH_M)
        partitions.append(BonePartition(
            name=bone_names[i], joint_index=i, parent_index=parents[i],
            bind_to_model=b2m, model_to_bind=m2b,
            support_planes=planes_local, pitch_m=pitch))

    # -- face ownership -------------------------------------------------------
    fw = np.zeros((F, B))
    flat_idx = (np.arange(F)[:, None, None] * B + joints[faces]).ravel()
    np.add.at(fw.ravel(), flat_idx, wn[faces].ravel())
    fw[:, ~retained] = 0.0                       # folded bones never win
    face_joint = fw.argmax(axis=1)               # ties: lowest joint index
    strong = fw.max(axis=1) >= 3.0 * STRONG_FACE_WEIGHT
    face_joint = np.where(strong, face_joint, -1)

    fa, fb = _edge_adjacency(faces)
    if fa.size:
        while True:
            if not (face_joint < 0).any():
                break
            votes = np.zeros((F, B))
            for src, dst in ((fa, fb), (fb, fa)):
                assigned = face_joint[src] >= 0
                np.add.at(votes, (dst[assigned], face_joint[src][assigned]), 1.0)
            take = (face_joint < 0) & (votes.sum(axis=1) > 0)
            if not take.any():
                break
            face_joint[take] = votes.argmax(axis=1)[take]   # ties: lowest index
    # Isolated islands (this source has 236 floating 1-7-face components)
    # have no adjacency to flood through: they fall back to their own
    # strongest bone, argmax with lowest joint index breaking ties.
    isolated = int((face_joint < 0).sum())
    if isolated:
        face_joint[face_joint < 0] = fw.argmax(axis=1)[face_joint < 0]
    row_of_joint_arr = np.full(B, -1, dtype=np.int64)
    for j, r in row_of_joint.items():
        row_of_joint_arr[j] = r
    face_owners = row_of_joint_arr[face_joint]
    unowned = np.flatnonzero(face_owners < 0).astype(np.int64)

    # -- coverage diagnostics -------------------------------------------------
    part_names = [p.name for p in partitions]
    coverage: dict = {
        "facesPerPartition": {n: int((face_owners == r).sum())
                              for r, n in enumerate(part_names)},
        "weakFaces": int((~strong).sum()),
        "unownedFaces": int(unowned.size),
        "isolatedFacesAssignedByOwnWeight": isolated,
        "foldedBones": folded,
        "sharpBoundaries": sharp,
        "partitions": [],
        "jointBands": [],
    }
    for r, part in enumerate(partitions):
        mask = bound_masks[part.name]
        lp = local_points(mask, part.model_to_bind)
        coverage["partitions"].append({
            "name": part.name,
            "jointIndex": part.joint_index,
            "parentIndex": part.parent_index,
            "pitchM": part.pitch_m,
            "supportPlanes": int(part.support_planes.shape[0]),
            "dominantVertices": int((dom == part.joint_index).sum()),
            "boundVertices": int(mask.sum()),
            "boundsLocalMin": [float(v) for v in lp.min(axis=0)] if len(lp) else None,
            "boundsLocalMax": [float(v) for v in lp.max(axis=0)] if len(lp) else None,
            "faces": int((face_owners == r).sum()),
        })
    for bi, band in enumerate(bands):
        p, c = bone_names.index(band.parent), bone_names.index(band.child)
        axis, center, half = band.axis, band.center, band.width_m / 2.0
        axial = (vertices - center) @ axis
        face_axial = (vertices[faces].mean(axis=1) - center) @ axis
        in_band_faces = np.abs(face_axial) <= half
        # Extension of each side's BOUND set past the boundary plane: the
        # borrowed neighbour-dominant samples inside the support cap make this
        # exactly the 15 mm half-overlap (regression tripwire: a bounds or
        # plane regression would let it exceed the declared width).
        pmask = bound_masks[band.parent]
        cmask = bound_masks[band.child]
        parent_ext = float(max(0.0, axial[pmask].max())) if pmask.any() else 0.0
        child_ext = float(max(0.0, -axial[cmask].min())) if cmask.any() else 0.0
        in_band = np.abs(axial) <= half
        owners = {partitions[row_of_joint[p]].name: int((face_owners[in_band_faces]
                        == row_of_joint[p]).sum()),
                  partitions[row_of_joint[c]].name: int((face_owners[in_band_faces]
                        == row_of_joint[c]).sum())}
        coverage["jointBands"].append({
            "parent": band.parent, "child": band.child,
            "centerModel": [float(v) for v in center],
            "axisModel": [float(v) for v in axis],
            "widthM": band.width_m,
            "equalInfluenceVertices": int(band_sel[bi]),
            "verticesInBand": int(in_band.sum()),
            "parentExtensionM": parent_ext,
            "childExtensionM": child_ext,
            "facesInBandByOwner": owners,
        })
    return PartitionResult(partitions=tuple(partitions),
                           face_owners=face_owners.astype(np.int64),
                           unowned_face_indices=unowned,
                           bands=tuple(bands), coverage=coverage)


# ===========================================================================
# Outer driver: launch Blender, load + verify the exported soup
# ===========================================================================

def _run_blender(inner_args: list[str]) -> None:
    """Run this same file inside `blender --background`. Argument list only,
    never a shell. Fails with the exact attempted command if blender is
    missing from PATH."""
    exe = shutil.which("blender")
    cmd = [exe or "blender", "--background", "--python",
           str(Path(__file__).resolve()), "--", *inner_args]
    if exe is None:
        raise SystemExit(
            "blender was not found on PATH; attempted command:\n  "
            + " ".join(cmd))
    print("[bake] " + " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def load_source_npz(path: Path) -> tuple[SourceSoup, dict]:
    """Load a Blender-stage NPZ into a SourceSoup plus its diagnostics."""
    with np.load(path) as data:
        soup = SourceSoup(
            vertices=np.asarray(data["vertices"], dtype=np.float64),
            faces=np.asarray(data["faces"], dtype=np.uint32),
            face_uvs=np.asarray(data["face_uvs"], dtype=np.float64),
            joints=np.asarray(data["joints"], dtype=np.int64),
            weights=np.asarray(data["weights"], dtype=np.float64),
            bone_names=tuple(str(n) for n in json.loads(str(data["bone_names"]))),
            parents=tuple(int(p) for p in data["parents"]),
            inverse_bind=np.asarray(data["inverse_bind"], dtype=np.float64),
            albedo_rgba=np.asarray(data["albedo_rgba"], dtype=np.uint8),
            base_color_factor=np.asarray(data["base_color_factor"], dtype=np.float64),
            texture_transform=np.asarray(data["texture_transform"], dtype=np.float64),
        )
        diagnostics = json.loads(str(data["diagnostics"]))
    if soup.vertices.ndim != 2 or soup.vertices.shape[1] != 3:
        raise ValueError(f"{path}: vertices must be (V,3), got {soup.vertices.shape}")
    if soup.face_uvs.shape != (soup.faces.shape[0], 3, 2):
        raise ValueError(f"{path}: face_uvs must be (F,3,2), got {soup.face_uvs.shape}")
    if soup.joints.shape != (soup.vertices.shape[0], 4) \
            or soup.weights.shape != soup.joints.shape:
        raise ValueError(f"{path}: joints/weights must be (V,4)")
    if soup.inverse_bind.shape != (len(soup.bone_names), 4, 4):
        raise ValueError(f"{path}: inverse_bind must be (B,4,4)")
    return soup, diagnostics


def _sorted_rows(arr: npt.NDArray[np.floating],
                 quantum: float | None = None) -> npt.NDArray[np.floating]:
    """Lexicographic row sort for order-invariant comparisons.

    With `quantum`, rows are keyed on a rounded grid so float noise cannot
    flip the relative order of near-equal rows between the two arrays; rows
    that share a key are interchangeable within `quantum`.
    """
    keys = (np.floor(arr / quantum + 0.5).astype(np.int64)
            if quantum else arr)
    order = np.lexsort(tuple(keys[:, i] for i in range(keys.shape[1] - 1, -1, -1)))
    return arr[order]


def _canonical_skin(joints: npt.NDArray[np.integer],
                    weights: npt.NDArray[np.floating]) -> npt.NDArray[np.float64]:
    """Per-vertex (joint, weight) pairs, zero-weight slots dropped, sorted
    joint-major, one row/vertex, rows sorted lexicographically for multiset
    comparison (the importer drops zero-weight groups; accessors may pad)."""
    jf = joints.astype(np.float64)
    wf = weights.astype(np.float64)
    jf = np.where(wf > 0.0, jf, np.inf)      # dropped slots sort last
    order = np.lexsort((wf, jf), axis=1)
    js = np.take_along_axis(jf, order, axis=1)
    ws = np.take_along_axis(wf, order, axis=1)
    js = np.where(np.isfinite(js), js, -1.0)             # tag dropped as -1
    return _sorted_rows(np.concatenate([js, ws], axis=1))


def _match_bijection(got: npt.NDArray[np.floating],
                     want: npt.NDArray[np.floating], tol: float) -> tuple[int, int]:
    """Greedy nearest-match bijection via a 3D bucket hash.

    Blender's import path (float32 data at x100 scale for this asset) leaves
    ~20 um noise on a few percent of vertices, which defeats any sort-based
    multiset comparison: near-ties reorder and pair centimeters apart. Here
    every `got` point must claim a distinct `want` point within `tol`, so the
    check is immune to ordering while still catching unit/frame/split drift.
    Returns (unmatched got, unmatched want).
    """
    cell = tol * 10.0

    def key(p: npt.NDArray[np.floating]) -> tuple[int, int, int]:
        return (int(np.floor(p[0] / cell)), int(np.floor(p[1] / cell)),
                int(np.floor(p[2] / cell)))

    buckets: dict[tuple[int, int, int], list[int]] = {}
    for i, p in enumerate(want):
        buckets.setdefault(key(p), []).append(i)
    unmatched = 0
    for p in got:
        cx, cy, cz = key(p)
        best, best_d = -1, tol
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for j in buckets.get((cx + dx, cy + dy, cz + dz), ()):
                        d = float(np.linalg.norm(want[j] - p))
                        if d <= best_d:
                            best, best_d = j, d
        if best < 0:
            unmatched += 1
        else:
            buckets[key(want[best])].remove(best)
    return unmatched, sum(len(v) for v in buckets.values())


def verify_against_glb(soup: SourceSoup, glb: dict, label: str = "soup") -> None:
    """Hard-fail when the Blender export disagrees with the GLB accessors.

    Everything is order-invariant (the importer may reorder vertices/faces):
    multisets of vertices, per-vertex skin rows, (vertex, uv) pairs, per-bone
    inverse binds by NAME, total area/centroid, and the byte-exact texture.
    """
    def fail(msg: str) -> None:
        raise SystemExit(f"[verify] {label}: {msg}")

    V, F = soup.vertices.shape[0], soup.faces.shape[0]
    if V != glb["position"].shape[0] or F != glb["indices"].shape[0] // 3:
        fail(f"counts {V}v/{F}f != GLB {glb['position'].shape[0]}v/"
             f"{glb['indices'].shape[0] // 3}f")
    for name, arr in (("vertices", soup.vertices), ("face_uvs", soup.face_uvs),
                      ("weights", soup.weights),
                      ("inverse_bind", soup.inverse_bind),
                      ("base_color_factor", soup.base_color_factor)):
        if not np.isfinite(arr).all():
            fail(f"non-finite values in {name}")

    got_unmatched, want_unmatched = _match_bijection(
        soup.vertices, glb["position"], tol=1e-4)
    if got_unmatched or want_unmatched:
        fail(f"vertex bijection mismatch within 100 um: {got_unmatched} "
             f"exported and {want_unmatched} accessor vertices unmatched "
             "(importer transform, split, or precision drift)")

    tri = soup.vertices[soup.faces.astype(np.int64)]
    area_got = float(0.5 * np.linalg.norm(
        np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1).sum())
    gtri = glb["position"][glb["indices"]].reshape(-1, 3, 3)
    area_want = float(0.5 * np.linalg.norm(
        np.cross(gtri[:, 1] - gtri[:, 0], gtri[:, 2] - gtri[:, 0]), axis=1).sum())
    if abs(area_got - area_want) > 1e-6 * area_want:
        fail(f"surface area {area_got:.9f} != GLB {area_want:.9f}")
    if not np.allclose(tri.reshape(-1, 3).mean(axis=0),
                       gtri.reshape(-1, 3).mean(axis=0), atol=1e-5):
        fail("triangle centroid mismatch (10 um envelope)")

    skin_got = _canonical_skin(soup.joints, soup.weights)
    skin_want = _canonical_skin(glb["joints"], glb["weights"])
    if not np.array_equal(skin_got[:, :2], skin_want[:, :2]) \
            or not np.allclose(skin_got[:, 2:], skin_want[:, 2:], atol=1e-6):
        fail("per-vertex skin (joint, weight) multiset mismatch")

    # UV parity: each face corner must carry its vertex's TEXCOORD_0 value.
    want_uv = glb["texcoord"][soup.faces.astype(np.int64)]      # (F,3,2)
    if not np.allclose(soup.face_uvs, want_uv, atol=5e-7):
        worst = float(np.abs(soup.face_uvs - want_uv).max())
        fail(f"face-corner UVs disagree with per-vertex TEXCOORD_0 (worst "
             f"{worst:.3e}; convention or seam handling changed)")

    if soup.bone_names != tuple(glb["bone_names"]):
        fail(f"bone names/order drifted: {soup.bone_names}")
    if tuple(soup.parents) != tuple(glb["parents"]):
        fail(f"bone parents drifted: {soup.parents}")
    if not np.allclose(soup.inverse_bind, glb["inverse_bind"], atol=1e-6):
        worst = float(np.abs(soup.inverse_bind - glb["inverse_bind"]).max())
        fail(f"inverse bind matrices mismatch (worst {worst:.3e})")

    want_albedo = decode_png_rgba(glb["image_bytes"])
    if soup.albedo_rgba.shape != want_albedo.shape:
        fail(f"albedo {soup.albedo_rgba.shape} != PNG {want_albedo.shape}")
    if not np.array_equal(soup.albedo_rgba, want_albedo):
        diff = int((soup.albedo_rgba != want_albedo).any(axis=2).sum())
        fail(f"albedo bytes differ from the GLB-embedded PNG in {diff} texels")
    if not np.allclose(soup.base_color_factor, glb["base_color_factor"],
                       atol=1e-9):
        fail("base color factor mismatch")
    if not np.allclose(soup.texture_transform, glb["texture_transform"],
                       atol=1e-12):
        fail("KHR_texture_transform mismatch")
    print(f"[verify] {label}: parity with GLB accessors OK "
          f"({V} verts, {F} tris, {len(soup.bone_names)} joints)")


def export_source_npz(path: Path | str) -> SourceSoup:
    """Run the Blender export stage to `path` and return the verified soup.

    The canonical source hash is re-checked (fatal on drift) and the exported
    soup must agree with the GLB accessors before it is returned."""
    path = Path(path)
    glb = read_glb(SOURCE_GLB)
    if glb["sha256"] != EXPECTED_SOURCE_SHA256:
        raise SystemExit(
            f"[bake] source hash drift: {SOURCE_GLB} is {glb['sha256']}, "
            f"expected {EXPECTED_SOURCE_SHA256}. Re-pin only after owner "
            "review; never edit Downloads.")
    _run_blender(["--blender-export", str(path)])
    soup, diagnostics = load_source_npz(path)
    if diagnostics.get("source_sha256") != glb["sha256"]:
        raise SystemExit("[bake] NPZ source hash disagrees with the GLB read")
    verify_against_glb(soup, glb)
    return soup


def inspect_source(path: Path | str | None = None) -> SourceInfo:
    """Blender-backed inspection of the canonical GLB (temp NPZ, never kept)."""
    if path is not None and Path(path) != SOURCE_GLB:
        raise ValueError(f"inspect_source is pinned to the canonical asset "
                         f"{SOURCE_GLB}, got {path}")
    glb = read_glb(SOURCE_GLB)
    with tempfile.TemporaryDirectory(prefix="humanoid-sdf-") as tmp:
        soup = export_source_npz(Path(tmp) / "source.npz")
        texture_sha = hashlib.sha256(
            np.ascontiguousarray(soup.albedo_rgba).tobytes()).hexdigest()
    return SourceInfo(
        vertex_count=int(soup.vertices.shape[0]),
        triangle_count=int(soup.faces.shape[0]),
        joint_count=len(soup.bone_names),
        bone_names=soup.bone_names,
        texture_size=(int(soup.albedo_rgba.shape[1]),
                      int(soup.albedo_rgba.shape[0])),
        source_sha256=glb["sha256"],
        texture_sha256=texture_sha,
    )


# ===========================================================================
# Blender inner stages (run INSIDE Blender via --blender-export /
# --blender-render-preview; `import bpy` stays function-local so importing
# this module under uv never touches Blender)
# ===========================================================================

def blender_export_stage(npz_path: Path) -> None:
    """Import the canonical GLB into a clean scene and export the soup NPZ.

    Hard-fails (named mesh/primitive/bone/image in the message) on missing
    UV, texture, skin, inverse bind, non-finite value, or inconsistent
    skeleton. Bind pose only: animations are not imported, no pose is applied.
    """
    import bpy                                   # noqa: F401  (inner stage)
    from mathutils import Matrix

    glb = read_glb(SOURCE_GLB)
    if glb["sha256"] != EXPECTED_SOURCE_SHA256:
        raise SystemExit(f"[blender] source hash drift: {glb['sha256']}")
    bone_index = {n: i for i, n in enumerate(glb["bone_names"])}

    bpy.ops.wm.read_factory_settings(use_empty=True)
    kwargs = dict(filepath=str(SOURCE_GLB), import_pack_images=True,
                  import_animations=False)
    try:
        bpy.ops.import_scene.gltf(**kwargs)
    except TypeError:
        kwargs.pop("import_animations", None)
        bpy.ops.import_scene.gltf(**kwargs)

    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if len(armatures) != 1:
        raise SystemExit(f"[blender] expected one armature, found "
                         f"{[a.name for a in armatures]}")
    armature = armatures[0]
    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"
                 and any(m.type == "ARMATURE" and m.object == armature
                         for m in o.modifiers)]
    if not mesh_objs:
        raise SystemExit("[blender] no mesh object is skinned to the armature")

    # Blender world == the GLB accessor frame rotated Y-up->Z-up (X+90) at
    # accessor scale, no matter how the importer splits that between object
    # matrices and baked mesh data. TO_GLB un-rotates it; the outer multiset
    # parity plus the sampled basis check below verify the convention.
    TO_GLB = Matrix.Rotation(-1.5707963267948966, 4, "X")
    scene_from_mesh = glb["scene_from_mesh"]

    verts_glb: list[list[float]] = []
    faces_glb: list[tuple[int, int, int]] = []
    uvs_glb: list[tuple[float, float, float, float, float, float]] = []
    joint_slots: list[list[tuple[int, float]]] = []
    base = 0
    for obj in mesh_objs:
        mesh = obj.data
        if mesh.shape_keys is not None:
            raise SystemExit(f"[blender] {obj.name}: shape keys present; the "
                             "spike has no morph-target contract")
        if not mesh.uv_layers:
            raise SystemExit(f"[blender] {obj.name}: no UV layer (TEXCOORD_0)")
        uv_layer = mesh.uv_layers[0]
        mesh.calc_loop_triangles()
        loops = mesh.loop_triangles
        for v in mesh.vertices:
            co = TO_GLB @ (obj.matrix_world @ v.co)
            verts_glb.append([co.x, co.y, co.z])
            slots: list[tuple[int, float]] = []
            for g in v.groups:
                name = obj.vertex_groups[g.group].name
                if name not in bone_index:
                    raise SystemExit(f"[blender] {obj.name}: vertex group "
                                     f"{name!r} is not a skeleton joint")
                slots.append((bone_index[name], float(g.weight)))
            slots.sort(key=lambda s: (-s[1], s[0]))
            joint_slots.append(slots[:4])
        for tri in loops:
            idx = []
            uvs = []
            for li in tri.loops:
                loop = mesh.loops[li]
                idx.append(base + loop.vertex_index)
                uv = uv_layer.data[li].uv
                uvs.extend((uv.x, 1.0 - uv.y))     # GLB: v=0 at image top
            faces_glb.append(tuple(idx))
            uvs_glb.append(tuple(uvs))
        base += len(mesh.vertices)

    V = len(verts_glb)
    joints = np.zeros((V, 4), dtype=np.int64)
    weights = np.zeros((V, 4), dtype=np.float64)
    for i, slots in enumerate(joint_slots):
        row = np.array(slots, dtype=np.float64).reshape(-1, 2) if slots \
            else np.zeros((0, 2))
        for k in range(min(4, len(slots))):
            joints[i, k] = int(slots[k][0])
            weights[i, k] = slots[k][1]
        total = float(weights[i].sum())
        if total <= 0.0:
            raise SystemExit(f"[blender] vertex {i} has zero skin weight")
        weights[i] /= total

    arm_bones = {b.name for b in armature.data.bones}
    missing = set(glb["bone_names"]) - arm_bones
    extra = arm_bones - set(glb["bone_names"])
    if missing or extra:
        raise SystemExit(f"[blender] skeleton mismatch: missing={sorted(missing)} "
                         f"extra={sorted(extra)}")
    # Inverse binds are taken from the GLB inverseBindMatrices accessor
    # (bit-exact, stable across Blender versions -- required for the Task 2
    # byte-determinism gate). Blender's heuristic bone reconstruction rolls
    # bones about their axes (preserving joints, rotating local frames), so
    # it is VERIFIED, not trusted: names, parents, and the roll-invariant
    # bind HEAD positions must agree with the accessor-derived binds.
    inverse_bind = glb["inverse_bind"]
    bind_heads_glb = np.linalg.inv(inverse_bind)[:, :3, 3]
    for n in glb["bone_names"]:
        head = (TO_GLB @ armature.matrix_world
                @ armature.data.bones[n].matrix_local).translation
        i = glb["bone_names"].index(n)
        if not np.allclose(np.array([head.x, head.y, head.z]),
                           bind_heads_glb[i], atol=1e-4):
            raise SystemExit(
                f"[blender] bone {n}: bind head {tuple(head)} != GLB "
                f"{bind_heads_glb[i]} (skeleton reconstruction drift)")

    image = bpy.data.images.get(glb["image_name"])
    if image is None:
        by_size = [i for i in bpy.data.images
                   if i.size[0] == 2048 and i.size[1] == 2048]
        if len(by_size) != 1:
            raise SystemExit(f"[blender] base-color image {glb['image_name']!r} "
                             "not imported (and no unique 2048x2048 stand-in)")
        image = by_size[0]
    w_img, h_img = int(image.size[0]), int(image.size[1])
    px = np.empty(w_img * h_img * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    albedo = np.flipud(np.rint(px.astype(np.float64).reshape(
        h_img, w_img, 4) * 255.0)).astype(np.uint8)
    albedo = np.ascontiguousarray(albedo)

    vertices = np.asarray(verts_glb, dtype=np.float64)
    # Sampled basis check BEFORE the heavy work: every 997th exported vertex
    # must land within 1e-6 m of SOME accessor vertex (fails fast with the
    # convention named when an importer change breaks the frame).
    probe = vertices[::997]
    acc = glb["position"]
    d = np.linalg.norm(probe[:, None, :] - acc[None, :, :], axis=2).min(axis=1)
    if float(d.max()) > 1e-6:
        raise SystemExit(
            f"[blender] accessor-frame basis drift: sample vertex off by "
            f"{float(d.max()):.3e} m (Y-up/Z-up or unit-scale convention "
            "changed in the importer)")
    faces = np.asarray(faces_glb, dtype=np.uint32)
    face_uvs = np.asarray(uvs_glb, dtype=np.float64).reshape(-1, 3, 2)
    base_color_factor = glb["base_color_factor"]
    texture_transform = glb["texture_transform"]
    for name, arr in (("vertices", vertices), ("face_uvs", face_uvs),
                      ("weights", weights), ("inverse_bind", inverse_bind),
                      ("base_color_factor", base_color_factor),
                      ("texture_transform", texture_transform)):
        if not np.isfinite(arr).all():
            raise SystemExit(f"[blender] non-finite values in {name}")

    diagnostics = {
        "uvConvention": UV_CONVENTION,
        "blenderVersion": bpy.app.version_string,
        "importer": kwargs,
        "modelFrame": "glb-mesh-accessor-y-up",
        "sceneFromMesh": [[float(v) for v in row] for row in scene_from_mesh],
        "image": {"name": image.name, "width": w_img, "height": h_img},
        "meshObjects": [o.name for o in mesh_objs],
        "source_filename": glb["filename"],
        "source_byte_length": glb["byteLength"],
        "source_sha256": glb["sha256"],
        "texture_sha256": hashlib.sha256(albedo.tobytes()).hexdigest(),
    }
    npz_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(npz_path,
             vertices=vertices,
             faces=faces,
             face_uvs=face_uvs,
             joints=joints,
             weights=weights,
             bone_names=json.dumps(list(glb["bone_names"])),
             parents=np.asarray(glb["parents"], dtype=np.int64),
             inverse_bind=inverse_bind,
             albedo_rgba=albedo,
             base_color_factor=base_color_factor,
             texture_transform=texture_transform,
             diagnostics=json.dumps(diagnostics))
    print(f"[blender] exported {V} verts / {faces.shape[0]} tris / "
          f"{len(glb['bone_names'])} joints / {w_img}x{h_img} albedo -> {npz_path}")


def blender_render_preview_stage(preview_npz: Path, out_prefix: Path) -> None:
    """Render partition-preview panels (front + side) inside Blender.

    The preview NPZ is authored by the outer stage (GLB-space vertices,
    per-face partition palette indices, elbow band geometry). The GLB Y-up
    frame is baked to Blender Z-up with one +X90 rotation at load so every
    camera/light lives in one world space.
    """
    import bpy
    from mathutils import Vector

    with np.load(preview_npz) as data:
        verts = np.asarray(data["vertices"], dtype=np.float64)
        faces = np.asarray(data["faces"], dtype=np.int64)
        face_part = np.asarray(data["face_part"], dtype=np.int64)
        palette = np.asarray(data["palette"], dtype=np.float64) / 255.0
        accent = np.asarray(data["accent"], dtype=np.float64) / 255.0
        band_center = np.asarray(data["band_center"], dtype=np.float64)
        band_axis = np.asarray(data["band_axis"], dtype=np.float64)
        band_half = float(data["band_half"])
        band_parts = np.asarray(data["band_parts"], dtype=np.int64)
        front_dir = np.asarray(data["front_dir"], dtype=np.float64)
        side_dir = np.asarray(data["side_dir"], dtype=np.float64)

    rx90 = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]])
    verts = verts @ rx90.T                          # GLB Y-up -> Blender Z-up
    band_center = rx90 @ band_center
    band_axis = rx90 @ band_axis
    front3 = rx90 @ front_dir
    side3 = rx90 @ side_dir

    bpy.ops.wm.read_factory_settings(use_empty=True)
    mesh = bpy.data.meshes.new("HumanoidPartitions")
    mesh.from_pydata([tuple(map(float, v)) for v in verts],
                     [], [tuple(map(int, f)) for f in faces])
    mesh.validate()
    mesh.calc_loop_triangles()
    centroids = verts[faces].mean(axis=1)
    in_band = (np.abs((centroids - band_center) @ band_axis) <= band_half) \
        & np.isin(face_part, band_parts)
    attr = mesh.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    for tri in mesh.loop_triangles:
        color = accent if in_band[tri.index] else palette[face_part[tri.index]]
        for li in tri.loops:
            attr.data[li].color = (*color, 1.0)

    mat = bpy.data.materials.new("PartitionColors")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    attr_node = nodes.new("ShaderNodeAttribute")
    attr_node.attribute_name = "Col"
    principled = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    principled.inputs["Roughness"].default_value = 0.65
    links.new(attr_node.outputs["Color"], principled.inputs["Base Color"])
    band_mat = bpy.data.materials.new("ElbowBand")
    band_mat.use_nodes = True
    bn = band_mat.node_tree.nodes
    emission = bn.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (*accent, 1.0)   # NPZ accent
    emission.inputs["Strength"].default_value = 2.0
    bn.remove(next(n for n in bn if n.type == "BSDF_PRINCIPLED"))
    band_mat.node_tree.links.new(emission.outputs["Emission"],
                                 bn["Material Output"].inputs["Surface"])
    mesh.materials.append(mat)
    mesh.materials.append(band_mat)
    for poly in mesh.polygons:
        poly.material_index = 1 if in_band[poly.index] else 0
    obj = bpy.data.objects.new("HumanoidPartitions", mesh)
    bpy.context.scene.collection.objects.link(obj)
    up = Vector((0.0, 0.0, 1.0))
    side = Vector((side3[0], side3[1], 0.0))
    if side.length < 1e-9:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()                                 # along the right arm
    front = Vector((front3[0], front3[1], 0.0))
    if front.length < 1e-9:
        front = side.cross(up)
    front.normalize()                                # data-derived facing
    target = Vector(tuple(map(float, verts.mean(axis=0))))
    reach = max((Vector(tuple(map(float, v))) - target).length for v in verts)

    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    if scene.world is None:
        scene.world = bpy.data.worlds.new("PreviewWorld")
        scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.09, 0.095, 0.11, 1.0)
    bg.inputs[1].default_value = 1.0
    scene.render.resolution_x = 880
    scene.render.resolution_y = 1320
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = "Standard"   # keep palette hues
    except AttributeError:
        pass
    try:
        scene.eevee.taa_render_samples = 32
        scene.eevee.use_raytracing = False
    except AttributeError:
        pass

    def aim_at(ob: bpy.types.Object, at: Vector) -> None:
        direction = (at - ob.location).normalized()
        ob.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    light_dist = reach * 2.2

    def add_light(name: str, direction: Vector, power: float, size: float) -> None:
        d = direction.normalized() * light_dist
        bpy.ops.object.light_add(type="AREA", location=target + d)
        light = bpy.context.active_object
        light.name = name
        light.data.energy = power * light_dist ** 2
        light.data.size = max(size, reach * 0.4)
        aim_at(light, target)

    for label, direction in (("front", front), ("side", side)):
        bpy.ops.object.camera_add(location=target + direction * reach * 3.4)
        cam = bpy.context.active_object
        cam.name = f"Cam{label}"
        cam.data.lens = 50
        aim_at(cam, target)
        scene.camera = cam
        add_light("Key", front + up * 0.6, 4.0, reach * 0.5)
        add_light("Fill", -front + up * 0.2 - side * 0.5, 1.6, reach * 0.8)
        add_light("Rim", -front + up * 0.5 + side * 0.8, 2.2, reach * 0.5)
        out = Path(str(out_prefix) + f"-{label}.png")
        scene.render.filepath = str(out)
        bpy.ops.render.render(write_still=True)
        for ob in list(scene.objects):               # next panel: fresh camera
            if ob.type == "CAMERA":
                bpy.data.objects.remove(ob, do_unlink=True)
        print(f"[blender] preview panel -> {out}")


# ===========================================================================
# Reports, preview composition, CLI
# ===========================================================================

def _edge_diagnostics(faces: npt.NDArray[np.integer]) -> dict:
    """Boundary (1 incident face) and non-manifold (3+) edge counts, plus
    connected face-component counts (this source carries floating islands)."""
    f = np.asarray(faces, dtype=np.int64)
    edges = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    keys = np.sort(edges, axis=1)
    _, counts = np.unique(keys, axis=0, return_counts=True)
    fa, fb = _edge_adjacency(f)
    parent = np.arange(len(f))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b in zip(fa.tolist(), fb.tolist()):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra
    roots = np.array([find(i) for i in range(len(f))])
    sizes = np.bincount(roots)
    return {"boundaryEdges": int((counts == 1).sum()),
            "nonManifoldEdges": int((counts > 2).sum()),
            "interiorEdges": int((counts == 2).sum()),
            "faceComponents": int((sizes > 0).sum()),
            "floatingIslandFaces": int(sizes[sizes < 64].sum()) if len(sizes) else 0,
            "largestComponentFaces": int(sizes.max()) if len(sizes) else 0}


def build_source_report(soup: SourceSoup, result: PartitionResult,
                        glb: dict) -> dict:
    bind_to_model = np.stack([_rigid_bind_pair(ib)[0] for ib in soup.inverse_bind])
    bind_heads = bind_to_model[:, :3, 3]
    names = soup.bone_names
    retained = {p.name for p in result.partitions}
    fold_map = {f["bone"]: f["into"] for f in result.coverage["foldedBones"]}
    texture_sha = hashlib.sha256(
        np.ascontiguousarray(soup.albedo_rgba).tobytes()).hexdigest()

    def band_entry(b: JointBand) -> dict:
        return next(e for e in result.coverage["jointBands"]
                    if e["parent"] == b.parent and e["child"] == b.child)

    chain = ["RightArm", "RightForeArm", "RightHand"]
    chain_bands = [b for b in result.bands
                   if {b.parent, b.child} <= set(chain)
                   and b.parent != b.child
                   and (b.parent, b.child) in {("RightArm", "RightForeArm"),
                                               ("RightForeArm", "RightHand")}]
    return {
        "kind": "humanoid-sdf-source-report",
        "task": "2026-08-17-humanoid-sdf-sever-spike/1",
        "constants": {
            "elbowOverlapM": ELBOW_OVERLAP_M,
            "limbPitchM": LIMB_PITCH_M,
            "detailPitchM": DETAIL_PITCH_M,
            "marginM": MARGIN_M,
            "equalInfluenceMaxDiff": EQUAL_INFLUENCE_MAX_DIFF,
            "strongFaceWeight": STRONG_FACE_WEIGHT,
            "foldRule": FOLD_RULE_NAME,
        },
        "source": {
            "checkedIn": str(SOURCE_GLB.relative_to(REPO_ROOT)),
            "originalFilename": glb["filename"],
            "originalPath": ORIGINAL_GLB_PATH,
            "byteLength": glb["byteLength"],
            "sha256": glb["sha256"],
            "expectedSha256": EXPECTED_SOURCE_SHA256,
        },
        "topology": {
            "vertexCount": int(soup.vertices.shape[0]),
            "triangleCount": int(soup.faces.shape[0]),
            **_edge_diagnostics(soup.faces),
        },
        "texture": {
            "width": int(soup.albedo_rgba.shape[1]),
            "height": int(soup.albedo_rgba.shape[0]),
            "sha256": texture_sha,
            "uvConvention": UV_CONVENTION,
            "baseColorFactor": [float(v) for v in soup.base_color_factor],
            "textureTransform": [[float(v) for v in row]
                                 for row in soup.texture_transform],
        },
        "skeleton": {
            "jointCount": len(names),
            "bindFrame": "rigid metres (uniform source scene scale 0.01 "
                          "divided out of bone-local coordinates)",
            "bones": [{
                "index": i,
                "name": n,
                "parent": names[p] if p >= 0 else None,
                "parentIndex": p,
                "bindPositionModel": [float(v) for v in bind_heads[i]],
                "retained": n in retained,
                "foldedInto": fold_map.get(n),
            } for i, (n, p) in enumerate(zip(names, soup.parents))],
        },
        "faceOwnership": {
            "facesPerPartition": result.coverage["facesPerPartition"],
            "weakFaces": result.coverage["weakFaces"],
            "unownedFaces": result.coverage["unownedFaces"],
            "isolatedFacesAssignedByOwnWeight":
                result.coverage["isolatedFacesAssignedByOwnWeight"],
        },
        "foldedBones": result.coverage["foldedBones"],
        "sharpBoundaries": result.coverage["sharpBoundaries"],
        "partitions": result.coverage["partitions"],
        "jointBands": result.coverage["jointBands"],
        "rightArmChain": {
            "chain": "RightArm -> RightForeArm -> RightHand",
            "bones": chain,
            "bands": [band_entry(b) for b in chain_bands],
        },
    }


def _check_report_gates(report: dict) -> None:
    """Reject partitionings that violate the spike's overlap contract."""
    if report["faceOwnership"]["unownedFaces"] != 0:
        raise SystemExit(
            f"[report] {report['faceOwnership']['unownedFaces']} unowned "
            "faces: the partition assignment is incomplete")
    for e in report["jointBands"]:
        total = e["parentExtensionM"] + e["childExtensionM"]
        if total > e["widthM"] + 1e-6:
            raise SystemExit(
                f"[report] {e['parent']} -> {e['child']}: overlap extends "
                f"{total * 1000:.1f} mm > the declared {e['widthM'] * 1000:.0f} "
                "mm band (forearm impaling upper arm or vice versa)")
        for key in ("parentExtensionM", "childExtensionM"):
            if e[key] > e["widthM"] / 2.0 + 1e-6:
                raise SystemExit(
                    f"[report] {e['parent']} -> {e['child']}: {key} "
                    f"{e[key] * 1000:.1f} mm exceeds the 15 mm half-band")
    chain = report["rightArmChain"]
    got = {(b["parent"], b["child"]) for b in chain["bands"]}
    want = {("RightArm", "RightForeArm"), ("RightForeArm", "RightHand")}
    if got != want:
        raise SystemExit(f"[report] right-arm chain bands {sorted(got)} != "
                         f"{sorted(want)}")
    print("[report] gates: 0 unowned faces, all bands inside the 30 mm "
          "planar overlap, right-arm chain intact")


def _partition_palette(n: int) -> npt.NDArray[np.uint8]:
    """Deterministic HSV palette, one readably distinct color per partition.

    Golden-angle hue stepping is the right choice when n is unknown, but n is
    known here and the angle is WORSE than even spacing for a fixed count: at
    22 partitions it collapsed the minimum gap to 7.7 deg (Hips vs Head both
    read dusty red; RightHand vs RightLeg both read purple, 12.4 deg apart).
    Space hues evenly instead, interleave the ring so neighbouring partition
    rows are never adjacent hues, and modulate saturation/value on a 3-cycle
    so even a residual hue clash separates by lightness.
    """
    import colorsys
    out = np.zeros((n, 3), dtype=np.uint8)
    if n <= 0:
        return out
    half = (n + 1) // 2
    for i in range(n):
        # interleave: 0, half, 1, half+1, ... keeps consecutive rows apart
        slot = (i % 2) * half + i // 2
        hue = (slot / float(n)) % 1.0
        saturation = (0.85, 0.62, 0.95)[i % 3]
        value = (0.95, 0.99, 0.72)[i % 3]
        r, g, b = colorsys.hsv_to_rgb(hue, saturation, value)
        out[i] = (int(r * 255), int(g * 255), int(b * 255))
    return out


def run_inspect_only() -> int:
    glb = read_glb(SOURCE_GLB)
    with tempfile.TemporaryDirectory(prefix="humanoid-sdf-") as tmp:
        soup = export_source_npz(Path(tmp) / "source.npz")
    result = derive_partitions(soup)
    report = build_source_report(soup, result, glb)
    _check_report_gates(report)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n")
    print(f"[report] {REPORT_PATH.relative_to(REPO_ROOT)}: "
          f"{report['topology']['vertexCount']} verts / "
          f"{report['topology']['triangleCount']} tris / "
          f"{len(result.partitions)} partitions / {len(result.bands)} bands")
    return 0


def run_render_partitions() -> int:
    with tempfile.TemporaryDirectory(prefix="humanoid-sdf-") as tmp:
        tmpdir = Path(tmp)
        soup = export_source_npz(tmpdir / "source.npz")
        result = derive_partitions(soup)
        _check_report_gates(build_source_report(soup, result, read_glb(SOURCE_GLB)))
        elbow = next(b for b in result.bands
                     if b.parent == "RightArm" and b.child == "RightForeArm")
        names = soup.bone_names

        def bind_head(name: str) -> npt.NDArray[np.float64]:
            return _rigid_bind_pair(
                soup.inverse_bind[names.index(name)])[0][:3, 3]

        # Data-derived view directions: the character's facing from the
        # toe-vs-foot bind direction, the side from the measured elbow axis
        # (points toward the right hand).
        toe = 0.5 * (bind_head("LeftToeBase") + bind_head("RightToeBase"))
        foot = 0.5 * (bind_head("LeftFoot") + bind_head("RightFoot"))
        facing = toe - foot
        facing[1] = 0.0
        facing = facing / float(np.linalg.norm(facing))
        side_dir = elbow.axis.copy()
        side_dir[1] = 0.0
        side_dir = side_dir / float(np.linalg.norm(side_dir))
        palette = _partition_palette(len(result.partitions))
        band_parts = np.array(sorted(
            {r for r, p in enumerate(result.partitions)
             if p.name in (elbow.parent, elbow.child)}), dtype=np.int64)
        preview_npz = tmpdir / "preview.npz"
        np.savez(preview_npz,
                 vertices=soup.vertices,
                 faces=np.asarray(soup.faces, dtype=np.int64),
                 face_part=result.face_owners.astype(np.int64),
                 palette=palette,
                 accent=np.array([255, 13, 255], dtype=np.uint8),
                 band_center=elbow.center,
                 band_axis=elbow.axis,
                 band_half=np.float64(elbow.width_m / 2.0),
                 band_parts=band_parts,
                 front_dir=facing,
                 side_dir=side_dir)
        _run_blender(["--blender-render-preview", str(preview_npz),
                      str(tmpdir / "panel")])
        panels = []
        for label in ("front", "side"):
            rgba = decode_png_rgba((tmpdir / f"panel-{label}.png").read_bytes())
            panels.append(np.ascontiguousarray(rgba[:, :, :3]))
        composed = np.ascontiguousarray(np.concatenate(panels, axis=1))
    PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW_PATH.write_bytes(encode_png_rgb(composed))
    print(f"[preview] {PREVIEW_PATH.relative_to(REPO_ROOT)}: "
          f"{composed.shape[1]}x{composed.shape[0]} front+side")
    return 0


# ===========================================================================
# Task 2: color projection, per-bone bake, atlas packing, manifest, validation
# ===========================================================================

BAKE_REPORT_PATH = SPIKE_NOTES_DIR / "bake-report.json"
PREVIEW_TEXTURED_PATH = SPIKE_NOTES_DIR / "bind-textured-preview.png"
MANIFEST_PATH = OUT_DIR / "zombie-humanoid.json"


def sample_surface_color(query_points_model: npt.NDArray[np.floating],
                         soup: SourceSoup,
                         *, chunk_points: int = 250_000
                         ) -> npt.NDArray[np.uint8]:
    """Source-texture color for query points via libigl closest-triangle.

    For every query point (model space) find the closest surface point on the
    ORIGINAL source mesh, compute its barycentric coordinates on that triangle,
    interpolate the three face-corner UVs, apply the exported texture transform
    and base-color factor, and bilinearly sample the RGBA8 base color. This is
    color projection only; the SDF never comes from libigl.
    """
    import igl
    vertices = np.asarray(soup.vertices, dtype=np.float64)
    faces = np.asarray(soup.faces, dtype=np.int64)
    pts = np.asarray(query_points_model, dtype=np.float64).reshape(-1, 3)
    albedo = np.asarray(soup.albedo_rgba, dtype=np.uint8)
    tt = np.asarray(soup.texture_transform, dtype=np.float64)
    factor = np.asarray(soup.base_color_factor, dtype=np.float64)
    out = np.empty((len(pts), 4), dtype=np.uint8)
    for s in range(0, len(pts), chunk_points):
        e = min(s + chunk_points, len(pts))
        q = np.ascontiguousarray(pts[s:e])
        _, idx, closest, _ = igl.signed_distance(
            q, vertices, faces,
            igl.SignedDistanceType.SIGNED_DISTANCE_TYPE_UNSIGNED)
        idx = np.asarray(idx, dtype=np.int64)
        closest = np.asarray(closest, dtype=np.float64)
        a = vertices[faces[idx, 0]]
        b = vertices[faces[idx, 1]]
        c = vertices[faces[idx, 2]]
        v0 = b - a
        v1 = c - a
        v2 = closest - a
        d00 = np.einsum("ij,ij->i", v0, v0)
        d01 = np.einsum("ij,ij->i", v0, v1)
        d11 = np.einsum("ij,ij->i", v1, v1)
        d20 = np.einsum("ij,ij->i", v2, v0)
        d21 = np.einsum("ij,ij->i", v2, v1)
        denom = d00 * d11 - d01 * d01
        denom = np.where(np.abs(denom) < 1e-30, 1.0, denom)
        w = (d11 * d20 - d01 * d21) / denom
        v = (d00 * d21 - d01 * d20) / denom
        u = 1.0 - v - w
        bary = np.stack([u, v, w], axis=1)
        uv = barycentric_uv(bary, np.asarray(soup.face_uvs, dtype=np.float64)[idx])
        uv3 = np.column_stack([uv, np.ones(len(uv))])
        uv_t = uv3 @ tt
        rgba = sample_rgba_bilinear(albedo, uv_t[:, :2]).astype(np.float64)
        rgba[:, :3] *= factor[:3]
        rgba[:, 3] *= factor[3]
        out[s:e] = np.rint(rgba).astype(np.uint8)
    return out


def _brick_spec(occupied_min: Sequence[float], occupied_max: Sequence[float],
                pitch_m: float) -> tuple[npt.NDArray[np.float64],
                                         npt.NDArray[np.float64],
                                         tuple[int, int, int]]:
    """Endpoint-inclusive lattice: occupied bounds + 12 mm margin snapped
    OUTWARD to pitch multiples (voxel is exactly the declared pitch)."""
    lo = np.asarray(occupied_min, dtype=np.float64)
    hi = np.asarray(occupied_max, dtype=np.float64)
    if not np.all(hi > lo):
        raise ValueError(f"occupied bounds not strictly ordered: {lo} .. {hi}")
    lo = np.floor((lo - MARGIN_M) / pitch_m - 1e-9) * pitch_m
    hi = np.ceil((hi + MARGIN_M) / pitch_m + 1e-9) * pitch_m
    dims = tuple(int(round((hi[i] - lo[i]) / pitch_m)) + 1 for i in range(3))
    hi = lo + (np.array(dims, dtype=np.float64) - 1.0) * pitch_m
    return lo, hi, dims


def _support_analytic_negatives(partition: BonePartition,
                                occupied_min: Sequence[float],
                                occupied_max: Sequence[float],
                                grid_lo: Sequence[float], grid_hi: Sequence[float],
                                dims: Sequence[int]) -> int:
    """Exact negative-voxel count of the convex support polytope over the brick
    lattice (a convex polytope's signed distance is the max of its half-space
    distances, so the analytic count matches a Mesh-to-SDF bake of the closed
    support mesh to within grid resolution). The support polytope is the
    support planes intersected with the TIGHT occupied box, evaluated over the
    12 mm-padded grid lattice."""
    SDF = _sdf_module()
    points = SDF.lattice_points(grid_lo, grid_hi, dims)
    lo = np.asarray(occupied_min, dtype=np.float64)
    hi = np.asarray(occupied_max, dtype=np.float64)
    box = np.array([
        [-1.0, 0.0, 0.0, lo[0]], [1.0, 0.0, 0.0, -hi[0]],
        [0.0, -1.0, 0.0, lo[1]], [0.0, 1.0, 0.0, -hi[1]],
        [0.0, 0.0, -1.0, lo[2]], [0.0, 0.0, 1.0, -hi[2]],
    ], dtype=np.float64)
    planes = np.asarray(partition.support_planes, dtype=np.float64).reshape(-1, 4)
    all_planes = np.vstack([box, planes]) if len(planes) else box
    d = points @ all_planes[:, :3].T + all_planes[:, 3]
    return int((d <= 0.0).all(axis=1).sum())


def _bake_one_bone(soup: SourceSoup, partition: BonePartition,
                   occupied_min: Sequence[float], occupied_max: Sequence[float]
                   ) -> dict:
    """Bake one bone's dense SDF (body ∩ support), its color brick, its coarse
    brick, and the per-operand interior gate, all in bind-local metres."""
    SDF = _sdf_module()
    lo, hi, dims = _brick_spec(occupied_min, occupied_max, partition.pitch_m)
    spec = SDF.SdfGridSpec(
        voxel_size_m=float(partition.pitch_m), band_width=SDF.DEFAULT_BAND_WIDTH,
        bounds_min_m=tuple(float(v) for v in lo),
        bounds_max_m=tuple(float(v) for v in hi),
        dimensions=dims)

    m2b = np.asarray(partition.model_to_bind, dtype=np.float64)
    source_local = (np.asarray(soup.vertices, dtype=np.float64)
                    @ m2b[:3, :3].T + m2b[:3, 3])
    body_sha = SDF.sha256_bytes(
        np.ascontiguousarray(source_local, dtype="<f8").tobytes("C")
        + np.ascontiguousarray(soup.faces, dtype="<u4").tobytes("C"))
    source = SDF.MeshArrayInput(
        label="humanoid-body", vertices_m=source_local,
        triangles=np.asarray(soup.faces, dtype=np.int64),
        source_sha256=body_sha, source_to_grid_m=SDF.IDENTITY_4X4)

    # The support volume is the support planes intersected with the TIGHT
    # occupied box (NOT the 12 mm-padded grid). The grid extends MARGIN_M beyond
    # the occupied box so the support SDF is strictly positive at the grid
    # boundary -- otherwise max(body, support) is exactly 0 on the box faces
    # and the boundary gate fails (the torso body extends past its own brick).
    sv, sf = support_mesh(partition, (occupied_min, occupied_max))
    support_sha = SDF.sha256_bytes(
        np.ascontiguousarray(sv, dtype="<f8").tobytes("C")
        + np.ascontiguousarray(sf, dtype="<u4").tobytes("C"))
    support = SDF.MeshArrayInput(
        label=f"{partition.name}-support", vertices_m=sv,
        triangles=np.asarray(sf, dtype=np.int64),
        source_sha256=support_sha, source_to_grid_m=SDF.IDENTITY_4X4)

    diag: dict = {}
    dense = SDF.bake_mesh_intersection_to_dense(
        source, support, spec, route=SELECTED_ROUTE, diagnostics=diag)
    metrics = SDF.validate_dense_sdf(dense)

    # per-operand interior gate: the body alone (clipped by the full box, so
    # the intersection equals the body inside the brick) must contribute a
    # negative core of its own -- a holed body bakes as an unsigned shell with
    # zero negatives here.
    box_v, box_f = SDF.closed_box_mesh(lo, hi)
    full_box = SDF.MeshArrayInput(
        label="full-box", vertices_m=box_v,
        triangles=np.asarray(box_f, dtype=np.int64),
        source_sha256=SDF.sha256_bytes(
            np.ascontiguousarray(box_v, dtype="<f8").tobytes("C")),
        source_to_grid_m=SDF.IDENTITY_4X4)
    body_only = SDF.bake_mesh_intersection_to_dense(
        source, full_box, spec, route=SELECTED_ROUTE)
    source_interior = int((np.asarray(body_only.values_f32) < 0.0).sum())
    support_interior = _support_analytic_negatives(
        partition, occupied_min, occupied_max, lo, hi, dims)
    if source_interior == 0:
        raise ValueError(
            f"{partition.name}: the source body contributed no interior over "
            "its own brick (0 negative voxels); it would bake as an unsigned "
            "shell")
    if support_interior == 0:
        raise ValueError(
            f"{partition.name}: the support volume contributed no interior "
            "(0 negative voxels); the support mesh is degenerate")

    # color projection: every brick lattice point gets its closest-surface color
    b2m = np.asarray(partition.bind_to_model, dtype=np.float64)
    lattice = SDF.lattice_points(lo, hi, dims)
    lattice_model = lattice @ b2m[:3, :3].T + b2m[:3, 3]
    color = sample_surface_color(lattice_model, soup).reshape(
        dims[2], dims[1], dims[0], 4)

    coarse, coarse_dims = resample_coarse_brick(dense.values_f32, dims)
    return {
        "name": partition.name,
        "dense": dense,
        "color": color,
        "coarse": coarse,
        "coarse_dims": coarse_dims,
        "dims": dims,
        "bounds_min": lo,
        "bounds_max": hi,
        "occupied_min": np.asarray(occupied_min, dtype=np.float64),
        "occupied_max": np.asarray(occupied_max, dtype=np.float64),
        "pitch_m": partition.pitch_m,
        "field_stats": {**metrics, "valueMinM": float(np.asarray(
            dense.values_f32).min()), "valueMaxM": float(np.asarray(
            dense.values_f32).max())},
        "negativeComponents": SDF.count_negative_components(dense),
        "support_mesh_sha256": support_sha,
        "support_interior": support_interior,
        "source_interior": source_interior,
        "node_contract_sha256": dense.node_contract_sha256,
        "operation_source_sha256": diag.get("operationSourceSha256"),
    }


_CLUSTER_NAMES = {
    "LeftToeBase": "left-leg", "RightToeBase": "right-leg",
    "LeftHand": "left-arm", "RightHand": "right-arm", "Head": "head",
}


def build_clusters(result: PartitionResult) -> list[dict]:
    """Skeleton-chain clusters: every retained bone is primary in exactly one
    cluster, helpers are directly adjacent (parent/child) bones, and each
    cluster samples at most four bones. Deterministic (joint-index ordered)."""
    by_joint = {p.joint_index: p for p in result.partitions}
    children: dict[int, list[int]] = {j: [] for j in by_joint}
    for p in result.partitions:
        if p.parent_index in by_joint:
            children[p.parent_index].append(p.joint_index)
    leaves = sorted(j for j in by_joint if not children[j])
    chains: list[list[int]] = []
    assigned: set[int] = set()
    for leaf in leaves:
        chain = [leaf]
        assigned.add(leaf)
        cur = leaf
        while True:
            par = by_joint[cur].parent_index
            if par not in by_joint or len(children[par]) != 1:
                break
            chain.append(par)
            assigned.add(par)
            cur = par
        chains.append(chain[::-1])            # proximal -> distal

    def depth(j: int) -> int:
        d, cur = 0, j
        while by_joint[cur].parent_index in by_joint:
            d += 1
            cur = by_joint[cur].parent_index
        return d

    remaining = sorted((j for j in by_joint if j not in assigned), key=depth)
    chains.append(remaining)                   # the spine (branch-to-branch) chain
    chains.sort(key=lambda c: min(c))
    clusters: list[dict] = []
    for chain in chains:
        primaries = [by_joint[j].name for j in chain]
        helpers: list[str] = []
        root_par = by_joint[chain[0]].parent_index
        if root_par in by_joint and root_par not in chain:
            helpers.append(by_joint[root_par].name)
        for cj in sorted(children[chain[-1]]):
            if cj not in chain:
                helpers.append(by_joint[cj].name)
        sampled = primaries + [h for h in helpers if h not in primaries]
        sampled = sampled[:MAX_SAMPLED_BONES_PER_CLUSTER]
        clusters.append({
            "name": _CLUSTER_NAMES.get(by_joint[chain[-1]].name, "spine"),
            "primaryBones": primaries,
            "sampleBones": sampled,
        })
    return clusters


def _occupied_corners_model(partition: BonePartition,
                            occ_min: Sequence[float],
                            occ_max: Sequence[float]) -> npt.NDArray[np.float64]:
    b2m = np.asarray(partition.bind_to_model, dtype=np.float64)
    lo = np.asarray(occ_min, dtype=np.float64)
    hi = np.asarray(occ_max, dtype=np.float64)
    corners = np.array([[x, y, z]
                        for x in (lo[0], hi[0]) for y in (lo[1], hi[1])
                        for z in (lo[2], hi[2])], dtype=np.float64)
    return corners @ b2m[:3, :3].T + b2m[:3, 3]


def _derive_sever_plane(result: PartitionResult) -> tuple[list[float], list[float]]:
    """The mid-forearm cut plane in RightForeArm bind-local space.

    Normal = normalized proximal-to-distal forearm axis (the RightArm ->
    RightForeArm band axis, rotated into forearm bind-local). The plane passes
    through the mid-point of the forearm's occupied bounds projected onto that
    axis; stored as normalized [nx, ny, nz, w] (inside dot(n,p)+w <= 0)."""
    band = next(b for b in result.bands
                if b.parent == "RightArm" and b.child == "RightForeArm")
    forearm = next(p for p in result.partitions if p.name == "RightForeArm")
    entry = next(e for e in result.coverage["partitions"]
                 if e["name"] == "RightForeArm")
    m2b = np.asarray(forearm.model_to_bind, dtype=np.float64)
    axis_local = band.axis @ m2b[:3, :3].T
    axis_local = axis_local / float(np.linalg.norm(axis_local))
    lo = np.asarray(entry["boundsLocalMin"], dtype=np.float64)
    hi = np.asarray(entry["boundsLocalMax"], dtype=np.float64)
    t_lo = float(np.dot(axis_local, lo))
    t_hi = float(np.dot(axis_local, hi))
    mid = 0.5 * (t_lo + t_hi)
    w = -mid
    plane = [float(axis_local[0]), float(axis_local[1]), float(axis_local[2]),
             float(w)]
    return plane, [float(v) for v in axis_local]


def _joint_probe(soup: SourceSoup, bones: dict, result: PartitionResult) -> list[dict]:
    """Probe every declared joint: both bones must cover the equal-influence
    surface (no gap) across the 30 mm overlap, and NOT 50 mm across the
    boundary (a capsule-like support would). The torso is a hollow shell, so
    the probe points are the equal-influence SURFACE vertices, never the band
    centroid (which sits in the hollow interior)."""
    by_name = {p.name: p for p in result.partitions}
    joints = np.asarray(soup.joints, dtype=np.int64)
    weights = np.asarray(soup.weights, dtype=np.float64)
    order = np.lexsort((joints, -weights), axis=1)
    dom = np.take_along_axis(joints, order[:, :1], axis=1)[:, 0].astype(np.int64)
    domw = np.take_along_axis(weights, order[:, :1], axis=1)[:, 0]
    run = np.take_along_axis(joints, order[:, 1:2], axis=1)[:, 0].astype(np.int64)
    runw = np.take_along_axis(weights, order[:, 1:2], axis=1)[:, 0]
    name_to_idx = {n: i for i, n in enumerate(soup.bone_names)}
    probes: list[dict] = []
    for band in result.bands:
        p = name_to_idx[band.parent]
        c = name_to_idx[band.child]
        leads = (((dom == p) & (run == c)) | ((dom == c) & (run == p)))
        sel = leads & (np.abs(domw - runw) <= EQUAL_INFLUENCE_MAX_DIFF)
        surface = np.asarray(soup.vertices, dtype=np.float64)[sel]
        if surface.shape[0] == 0:
            raise ValueError(
                f"joint {band.parent}->{band.child}: no equal-influence "
                "surface vertices to probe")
        # Restrict to the boundary cross-section: the equal-influence selection
        # spreads over a broad blend region, but the overlap is only the 30 mm
        # band around the boundary centre along the joint axis.
        axial = (surface - np.asarray(band.center)) @ np.asarray(band.axis)
        in_band = np.abs(axial) <= band.width_m / 2.0 - 1e-6
        surface = surface[in_band]
        if surface.shape[0] == 0:
            raise ValueError(
                f"joint {band.parent}->{band.child}: no equal-influence "
                "vertices inside the 30 mm overlap band")
        step = max(1, surface.shape[0] // 48)
        sample = surface[::step]
        ppart = by_name[band.parent]
        cpart = by_name[band.child]
        pvox = float(np.asarray(bones[band.parent]["dense"].voxel_size_m).max())
        cvox = float(np.asarray(bones[band.child]["dense"].voxel_size_m).max())
        worst_parent = -math.inf
        worst_child = -math.inf
        for model_pt in sample:
            p_local = (model_pt @ ppart.model_to_bind[:3, :3].T
                       + ppart.model_to_bind[:3, 3])
            c_local = (model_pt @ cpart.model_to_bind[:3, :3].T
                       + cpart.model_to_bind[:3, 3])
            pv = sample_bone_brick(bones[band.parent]["dense"].values_f32,
                                   bones[band.parent]["bounds_min"],
                                   bones[band.parent]["dense"].voxel_size_m,
                                   p_local)
            cv = sample_bone_brick(bones[band.child]["dense"].values_f32,
                                   bones[band.child]["bounds_min"],
                                   bones[band.child]["dense"].voxel_size_m,
                                   c_local)
            worst_parent = max(worst_parent, float(pv))
            worst_child = max(worst_child, float(cv))
        overlap_ok = worst_parent <= 0.75 * pvox and worst_child <= 0.75 * cvox
        # capsule gate: 50 mm across the boundary, the non-owning bone must be
        # OUTSIDE (its support ends at +-15 mm) regardless of the hollow shell.
        across = {}
        for off_m in (-0.050, 0.050):
            model_pt = np.asarray(band.center) + np.asarray(band.axis) * off_m
            p_local = (model_pt @ ppart.model_to_bind[:3, :3].T
                       + ppart.model_to_bind[:3, 3])
            c_local = (model_pt @ cpart.model_to_bind[:3, :3].T
                       + cpart.model_to_bind[:3, 3])
            pv = sample_bone_brick(bones[band.parent]["dense"].values_f32,
                                   bones[band.parent]["bounds_min"],
                                   bones[band.parent]["dense"].voxel_size_m,
                                   p_local)
            cv = sample_bone_brick(bones[band.child]["dense"].values_f32,
                                   bones[band.child]["bounds_min"],
                                   bones[band.child]["dense"].voxel_size_m,
                                   c_local)
            across[f"{int(off_m * 1000):+d}mm"] = {"parent": float(pv),
                                                    "child": float(cv)}
        across_ok = across["+50mm"]["parent"] >= 0.0 \
            and across["-50mm"]["child"] >= 0.0
        if not overlap_ok:
            raise ValueError(
                f"joint {band.parent}->{band.child}: a bone does not cover the "
                f"equal-influence surface (gap): parent worst "
                f"{worst_parent:.4f}, child worst {worst_child:.4f}")
        if not across_ok:
            raise ValueError(
                f"joint {band.parent}->{band.child}: overlap extends 50 mm "
                f"across the boundary (capsule-like support): {across}")
        probes.append({"parent": band.parent, "child": band.child,
                       "surfaceVertices": int(surface.shape[0]),
                       "worstParentM": float(worst_parent),
                       "worstChildM": float(worst_child),
                       "across": across,
                       "overlapOk": overlap_ok,
                       "acrossBoundaryOk": across_ok})
    return probes


def _bake_input_sha256(manifest: dict) -> str:
    """Self-checksum over every mutation-sensitive manifest field (everything
    except this hash itself and the on-disk transport contracts, which are
    checked against the files separately)."""
    SDF = _sdf_module()
    payload = {k: v for k, v in manifest.items() if k != "bakeInputSha256"}
    return SDF.sha256_text(SDF.canonical_json(payload))


def bake_distance_and_color(soup: SourceSoup, result: PartitionResult) -> dict:
    """Bake every bone's dense/colour/coarse brick and assemble the atlases."""
    bones: dict[str, dict] = {}
    ordered_names: list[str] = []
    for part in result.partitions:
        entry = next(e for e in result.coverage["partitions"]
                     if e["name"] == part.name)
        rec = _bake_one_bone(soup, part, entry["boundsLocalMin"],
                             entry["boundsLocalMax"])
        bones[part.name] = rec
        ordered_names.append(part.name)

    requests = [BrickRequest(name, bones[name]["dims"]) for name in ordered_names]
    layout = pack_bricks(requests, max_dim=MAX_ATLAS_DIM, padding=ATLAS_PADDING)
    offset_by_name = {b.bone: b.offset for b in layout.bricks}

    adx, ady, adz = layout.dimensions
    atlas_dist = np.full((adz, ady, adx), EMPTY_DISTANCE_M, dtype=np.float32)
    atlas_color = np.zeros((adz, ady, adx, 4), dtype=np.uint8)
    for name in ordered_names:
        rec = bones[name]
        ox, oy, oz = offset_by_name[name]
        dx, dy, dz = rec["dims"]
        atlas_dist[oz:oz + dz, oy:oy + dy, ox:ox + dx] = rec["dense"].values_f32
        atlas_color[oz:oz + dz, oy:oy + dy, ox:ox + dx] = rec["color"]

    clusters = build_clusters(result)
    by_name = {p.name: p for p in result.partitions}
    elbow = next(b for b in result.bands
                 if b.parent == "RightArm" and b.child == "RightForeArm")
    for cl in clusters:
        mins, maxs = [], []
        for name in cl["sampleBones"]:
            part = by_name[name]
            rec = bones[name]
            corners = _occupied_corners_model(part, rec["occupied_min"],
                                              rec["occupied_max"])
            mins.append(corners.min(axis=0))
            maxs.append(corners.max(axis=0))
        lo = np.min(np.stack(mins), axis=0)
        hi = np.max(np.stack(maxs), axis=0)
        if cl["name"] == "right-arm":
            pivot = np.asarray(elbow.center, dtype=np.float64)
            distal_names = ["RightForeArm", "RightHand"]
            radius = 0.0
            for name in distal_names:
                corners = _occupied_corners_model(
                    by_name[name], bones[name]["occupied_min"],
                    bones[name]["occupied_max"])
                radius = max(radius,
                             float(np.linalg.norm(corners - pivot, axis=1).max()))
            lo = np.minimum(lo, pivot - radius)
            hi = np.maximum(hi, pivot + radius)
        lo = lo - MAX_WARP_M
        hi = hi + MAX_WARP_M
        cl["sweepBoundsMin"] = [float(v) for v in lo]
        cl["sweepBoundsMax"] = [float(v) for v in hi]

    cut_plane, cut_axis = _derive_sever_plane(result)
    joints = [{
        "parent": b.parent, "child": b.child,
        "centerModel": [float(v) for v in b.center],
        "axisModel": [float(v) for v in b.axis],
        "overlapM": float(b.width_m),
    } for b in result.bands]
    return {
        "bones": {n: bones[n] for n in ordered_names},
        "ordered_names": ordered_names,
        "layout": layout,
        "atlas_distance_f32": atlas_dist,
        "atlas_color_rgba8": atlas_color,
        "clusters": clusters,
        "joints": joints,
        "joint_probes": _joint_probe(soup, bones, result),
        "cut_plane_local": cut_plane,
        "cut_axis_local": cut_axis,
    }


def _mat16_col_major(m: npt.NDArray[np.floating]) -> list[float]:
    """A 4x4 as 16 column-major floats (the runtime matrix convention)."""
    return [float(v) for v in np.asarray(m, dtype=np.float64).flatten(order="F")]


_IDENTITY_16 = _mat16_col_major(np.eye(4))


def _texture_sha256(soup: SourceSoup) -> str:
    return hashlib.sha256(
        np.ascontiguousarray(soup.albedo_rgba).tobytes()).hexdigest()


def build_manifest_dict(record: dict, soup: SourceSoup, glb: dict,
                        distance_contract: dict, color_contract: dict,
                        coarse_contract: dict) -> dict:
    """The version-1 `humanoid-bone-sdf` manifest (deterministic; no timing)."""
    SDF = _sdf_module()
    by_name = {p.name: p for p in record["source_partitions"].partitions}
    offset_by_name = {b.bone: b.offset for b in record["layout"].bricks}
    bones = []
    for name in record["ordered_names"]:
        rec = record["bones"][name]
        part = by_name[name]
        bones.append({
            "bone": name,
            "jointIndex": int(part.joint_index),
            "parentIndex": int(part.parent_index),
            "offset": list(offset_by_name[name]),
            "dimensions": list(rec["dims"]),
            "boundsMin": [float(v) for v in rec["bounds_min"]],
            "boundsMax": [float(v) for v in rec["bounds_max"]],
            "voxelSize": [float(v) for v in rec["dense"].voxel_size_m],
            "padding": ATLAS_PADDING,
            "pageIndex": 0,
            "occupiedBoundsMin": [float(v) for v in rec["occupied_min"]],
            "occupiedBoundsMax": [float(v) for v in rec["occupied_max"]],
            "fieldStats": {
                "min": float(rec["field_stats"]["min"]),
                "max": float(rec["field_stats"]["max"]),
                "negativeCount": int(rec["field_stats"]["negatives"]),
                "positiveCount": int(rec["field_stats"]["positives"]),
                "boundaryMin": float(rec["field_stats"]["boundaryMin"]),
            },
            "bindToModel": _mat16_col_major(part.bind_to_model),
            "modelToBind": _mat16_col_major(part.model_to_bind),
            "supportMeshSha256": rec["support_mesh_sha256"],
            "pitchM": float(rec["pitch_m"]),
            "sourceInterior": int(rec["source_interior"]),
            "supportInterior": int(rec["support_interior"]),
            "negativeComponents": int(rec["negativeComponents"]),
        })
    manifest = {
        "version": MANIFEST_VERSION,
        "kind": MANIFEST_KIND,
        "order": ATLAS_ORDER,
        "boneCount": int(len(soup.bone_names)),
        "pageCount": ATLAS_PAGE_COUNT,
        "maxLimbPitchM": LIMB_PITCH_M,
        "maxDetailPitchM": DETAIL_PITCH_M,
        "unownedFaces": int(record["source_partitions"].unowned_face_indices.size),
        "sourceTextureSha256": _texture_sha256(soup),
        "source": {
            "url": os.path.relpath(SOURCE_GLB, OUT_DIR),
            "originalFilename": glb["filename"],
            "byteLength": int(glb["byteLength"]),
            "sha256": glb["sha256"],
            "textureSha256": _texture_sha256(soup),
        },
        "sourceToRuntime": _IDENTITY_16,
        "runtimeToSource": _IDENTITY_16,
        "bake": {
            "limbPitchM": LIMB_PITCH_M,
            "detailPitchM": DETAIL_PITCH_M,
            "marginM": MARGIN_M,
            "jointOverlapM": ELBOW_OVERLAP_M,
            "atlasPadding": ATLAS_PADDING,
            "maxTransportPartBytes": MAX_TRANSPORT_PART_BYTES,
            "route": SELECTED_ROUTE,
            "blenderVersion": EXPECTED_BLENDER_VERSION,
            "nodeContractSha256": _canonical_node_contract_sha256(),
            "threshold": SDF_THRESHOLD,
            "adaptivity": SDF_ADAPTIVITY,
            "bandWidth": SDF.DEFAULT_BAND_WIDTH,
            "maxAtlasDimension": MAX_ATLAS_DIM,
        },
        "atlasDimensions": list(record["layout"].dimensions),
        "distance": {"encoding": "r16f-le", **distance_contract},
        "color": {"encoding": "rgba8", **color_contract},
        "coarse": {"encoding": "f32-le", **coarse_contract},
        "bones": bones,
        "joints": record["joints"],
        "clusters": record["clusters"],
        "rightArm": {
            "upperArm": "RightArm",
            "forearm": "RightForeArm",
            "hand": "RightHand",
            "cutPlaneLocal": record["cut_plane_local"],
            "cutSeed": SEVER_CUT_SEED,
            "irregularityM": SEVER_IRREGULARITY_M,
            "rimWidthM": SEVER_RIM_WIDTH_M,
        },
    }
    manifest["bakeInputSha256"] = _bake_input_sha256(manifest)
    return manifest


def _expect_hex64(value, what: str) -> str:
    value = str(value)
    if len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
        raise ValueError(f"{what} is not a lowercase hex sha256: {value!r}")
    return value


def _reject(msg: str) -> None:
    raise ValueError(f"[manifest] {msg}")


def validate_manifest(manifest: dict) -> dict:
    """Reject a manifest that breaks the pinned bake contract or was tampered
    (self-checksum). Pure dict validation; does not touch disk."""
    if manifest.get("kind") != MANIFEST_KIND:
        _reject(f"kind {manifest.get('kind')!r} != {MANIFEST_KIND!r}")
    if manifest.get("version") != MANIFEST_VERSION:
        _reject(f"version {manifest.get('version')!r} != {MANIFEST_VERSION}")
    if manifest.get("order") != ATLAS_ORDER:
        _reject(f"order {manifest.get('order')!r} != {ATLAS_ORDER!r}")
    bake = manifest.get("bake") or {}
    if bake.get("route") != SELECTED_ROUTE:
        _reject(f"route {bake.get('route')!r} != {SELECTED_ROUTE!r}")
    if bake.get("blenderVersion") != EXPECTED_BLENDER_VERSION:
        _reject(f"blenderVersion {bake.get('blenderVersion')!r} != "
                f"{EXPECTED_BLENDER_VERSION!r}")
    if bake.get("nodeContractSha256") != _canonical_node_contract_sha256():
        _reject("nodeContractSha256 drifted from the canonical contract")
    if bake.get("threshold") != SDF_THRESHOLD:
        _reject(f"threshold {bake.get('threshold')!r} != {SDF_THRESHOLD}")
    if bake.get("adaptivity") != SDF_ADAPTIVITY:
        _reject(f"adaptivity {bake.get('adaptivity')!r} != {SDF_ADAPTIVITY}")
    if bake.get("limbPitchM") != LIMB_PITCH_M \
            or bake.get("detailPitchM") != DETAIL_PITCH_M:
        _reject("pitch caps drifted")
    if bake.get("jointOverlapM") != ELBOW_OVERLAP_M:
        _reject("joint overlap drifted")
    if manifest.get("pageCount") != ATLAS_PAGE_COUNT:
        _reject("pageCount != 1")
    if manifest.get("source", {}).get("sha256") != EXPECTED_SOURCE_SHA256:
        _reject("source sha256 drifted from the canonical owner asset")
    ra = manifest.get("rightArm") or {}
    for key, want in (("upperArm", "RightArm"), ("forearm", "RightForeArm"),
                      ("hand", "RightHand")):
        if ra.get(key) != want:
            _reject(f"rightArm.{key} {ra.get(key)!r} != {want!r}")
    if ra.get("cutSeed") != SEVER_CUT_SEED:
        _reject("cutSeed drifted")
    if ra.get("irregularityM") != SEVER_IRREGULARITY_M:
        _reject("irregularityM drifted")
    if ra.get("rimWidthM") != SEVER_RIM_WIDTH_M:
        _reject("rimWidthM drifted")
    n = ra.get("cutPlaneLocal")
    if n is None or len(n) != 4 or not all(math.isfinite(float(v)) for v in n):
        _reject("cutPlaneLocal is not a finite 4-vector")
    if abs(math.hypot(float(n[0]), float(n[1]), float(n[2])) - 1.0) > 1e-6:
        _reject("cutPlaneLocal normal is not unit length")

    # structural checks
    bones = manifest.get("bones") or []
    if not bones or len(bones) >= int(manifest.get("boneCount", 0)):
        _reject(f"bones length {len(bones)} invalid vs boneCount "
                f"{manifest.get('boneCount')}")
    dims = tuple(int(v) for v in manifest.get("atlasDimensions", (0, 0, 0)))
    if len(dims) != 3 or min(dims) < 2:
        _reject(f"atlasDimensions {dims} invalid")
    seen_names: set[str] = set()
    for b in bones:
        name = b.get("bone")
        if not name or name in seen_names:
            _reject(f"duplicate/missing bone name {name!r}")
        seen_names.add(name)
        off = b.get("offset")
        bd = b.get("dimensions")
        if len(off) != 3 or len(bd) != 3:
            _reject(f"bone {name} offset/dimensions not 3-vectors")
        for o, d, m in zip(off, bd, dims):
            if int(o) < 0 or int(o) + int(d) > m:
                _reject(f"bone {name} brick {off}+{bd} exceeds atlas {dims}")
        if b.get("padding") != ATLAS_PADDING or b.get("pageIndex") != 0:
            _reject(f"bone {name} padding/pageIndex drifted")
        _expect_hex64(b.get("supportMeshSha256"), f"bone {name} supportMeshSha256")
        # voxel consistency (an SDF grid transform change breaks this)
        bmin = np.asarray(b["boundsMin"], dtype=np.float64)
        bmax = np.asarray(b["boundsMax"], dtype=np.float64)
        vox = np.asarray(b["voxelSize"], dtype=np.float64)
        want_vox = (bmax - bmin) / (np.asarray(bd, dtype=np.float64) - 1.0)
        if not np.allclose(vox, want_vox, atol=1e-9):
            _reject(f"bone {name} voxelSize {vox} != bounds/dims {want_vox}")
        pitch = float(b["pitchM"])
        if not np.allclose(vox, pitch, atol=1e-9):
            _reject(f"bone {name} voxelSize {vox} != pitch {pitch}")
        # bind matrices are finite inverses
        b2m = np.asarray(b["bindToModel"], dtype=np.float64).reshape(4, 4, order="F")
        m2b = np.asarray(b["modelToBind"], dtype=np.float64).reshape(4, 4, order="F")
        if not np.isfinite(b2m).all() or not np.isfinite(m2b).all():
            _reject(f"bone {name} bind matrices are not finite")
        if not np.allclose(b2m @ m2b, np.eye(4), atol=1e-4):
            _reject(f"bone {name} bindToModel/modelToBind are not inverses")
    # no overlap
    from dataclasses import replace as _replace
    layout = AtlasLayout(dims, ATLAS_PADDING, tuple(
        AtlasBrick(b["bone"], tuple(b["dimensions"]), tuple(b["offset"]),
                   (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
        for b in bones))
    if layout_has_overlap(layout):
        _reject("atlas bricks overlap")
    # clusters
    clusters = manifest.get("clusters") or []
    primaries: set[str] = set()
    for c in clusters:
        for name in c.get("sampleBones", []):
            if name not in seen_names:
                _reject(f"cluster {c.get('name')} samples unknown bone {name!r}")
        if len(c.get("sampleBones", [])) > MAX_SAMPLED_BONES_PER_CLUSTER:
            _reject(f"cluster {c.get('name')} samples > "
                    f"{MAX_SAMPLED_BONES_PER_CLUSTER} bones")
        primaries.update(c.get("primaryBones", []))
    if primaries != seen_names:
        _reject("cluster primaries do not partition the retained bones exactly")
    right_arm = next((c for c in clusters if c.get("name") == "right-arm"), None)
    if right_arm is None:
        _reject("no right-arm cluster")
    for want in ("RightArm", "RightForeArm", "RightHand"):
        if want not in right_arm.get("sampleBones", []):
            _reject(f"right-arm cluster missing {want}")
    # coarse pack structural checks
    coarse = manifest.get("coarse") or {}
    _expect_hex64(coarse.get("combinedSha256"), "coarse combinedSha256")
    total = int(coarse.get("combinedByteLength", 0))
    if total <= 0:
        _reject("coarse combinedByteLength is not positive")
    for cb in coarse.get("bones", []):
        cd = cb.get("dims")
        if len(cd) != 3 or any(int(n) > COARSE_MAX_DIM or int(n) < 1 for n in cd):
            _reject(f"coarse dims {cd} exceed {COARSE_MAX_DIM}")
        if int(cb.get("offset", -1)) < 0 \
                or int(cb.get("offset", 0)) + int(cb.get("byteLength", 0)) > total:
            _reject("coarse bone offset/byteLength overruns the pack")
    # transport hash formats
    for which in ("distance", "color"):
        c = manifest.get(which) or {}
        _expect_hex64(c.get("combinedSha256"), f"{which} combinedSha256")
        for p in c.get("parts", []):
            _expect_hex64(p.get("sha256"), f"{which} part sha256")
            if not isinstance(p.get("url"), str) or not p.get("url"):
                _reject(f"{which} part url invalid")
    # self-checksum last: any tampered field (support mesh hash, grid bounds,
    # bind matrices, etc.) changes the recomputed hash.
    if manifest.get("bakeInputSha256") != _bake_input_sha256(manifest):
        _reject("bakeInputSha256 mismatch (a bake input field was tampered)")
    return manifest


def _read_transport_contract(contract: dict, base: Path) -> bytes:
    parts = [(base / p["url"]).read_bytes() for p in contract["parts"]]
    verify_transport_contract(parts, contract)
    return b"".join(parts)


def validate_checked_in() -> dict:
    """Read + validate the checked-in manifest, then verify every on-disk
    transport file (distance parts, color parts, coarse pack) byte-for-byte."""
    if not MANIFEST_PATH.exists():
        raise FileNotFoundError(
            f"checked-in manifest missing: {MANIFEST_PATH} (run the bake first)")
    manifest = json.loads(MANIFEST_PATH.read_text())
    validate_manifest(manifest)
    _read_transport_contract(manifest["distance"], OUT_DIR)
    _read_transport_contract(manifest["color"], OUT_DIR)
    coarse = manifest["coarse"]
    blob = (OUT_DIR / COARSE_FILENAME).read_bytes()
    if len(blob) != int(coarse["combinedByteLength"]):
        _reject("coarse pack byteLength mismatch on disk")
    if hashlib.sha256(blob).hexdigest() != coarse["combinedSha256"]:
        _reject("coarse pack sha256 mismatch on disk")
    for cb in coarse["bones"]:
        lo = int(cb["offset"])
        hi = lo + int(cb["byteLength"])
        if hi > len(blob):
            _reject("coarse bone overruns the on-disk pack")
        if hashlib.sha256(blob[lo:hi]).hexdigest() != cb["sha256"]:
            _reject("coarse bone sha256 mismatch on disk")
    return manifest


COARSE_FILENAME = "zombie-coarse.f32"


def _split_and_write(data: bytes, prefix: str, suffix: str) -> dict:
    parts = split_transport_parts(data, MAX_TRANSPORT_PART_BYTES)
    urls = [f"{prefix}-{i:03d}.{suffix}" for i in range(len(parts))]
    for url, blob in zip(urls, parts):
        (OUT_DIR / url).write_bytes(blob)
    return build_transport_contract(parts, urls)


def build_coarse_contract(record: dict) -> tuple[bytes, dict]:
    blobs: list[bytes] = []
    bone_entries: list[dict] = []
    offset = 0
    for name in record["ordered_names"]:
        rec = record["bones"][name]
        blob = np.ascontiguousarray(rec["coarse"], dtype=np.float32).tobytes("C")
        blobs.append(blob)
        bone_entries.append({
            "offset": offset,
            "dims": list(rec["coarse_dims"]),
            "byteLength": len(blob),
            "sha256": hashlib.sha256(blob).hexdigest(),
        })
        offset += len(blob)
    combined = b"".join(blobs)
    return combined, {
        "combinedByteLength": len(combined),
        "combinedSha256": hashlib.sha256(combined).hexdigest(),
        "bones": bone_entries,
    }


def run_bake(*, render_preview: bool = True) -> dict:
    """The full Task 2 bake: export -> partitions -> per-bone bake -> pack ->
    write atlases/manifest/coarse/report -> optional bind-textured preview."""
    t0 = time.monotonic()
    glb = read_glb(SOURCE_GLB)
    with tempfile.TemporaryDirectory(prefix="humanoid-sdf-") as tmp:
        soup = export_source_npz(Path(tmp) / "source.npz")
    result = derive_partitions(soup)
    _check_report_gates(build_source_report(soup, result, glb))
    record = bake_distance_and_color(soup, result)
    record["source_partitions"] = result

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dist_data = encode_r16f_field(record["atlas_distance_f32"])
    color_data = encode_rgba8_field(record["atlas_color_rgba8"])
    dist_contract = _split_and_write(dist_data, "zombie-distance", "r16f")
    color_contract = _split_and_write(color_data, "zombie-color", "rgba8")
    coarse_blob, coarse_contract = build_coarse_contract(record)
    (OUT_DIR / COARSE_FILENAME).write_bytes(coarse_blob)

    manifest = build_manifest_dict(record, soup, glb, dist_contract,
                                   color_contract, coarse_contract)
    MANIFEST_PATH.write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
    validate_manifest(manifest)

    report = write_bake_report(record, soup, glb, manifest, t0)
    print(f"[bake] atlas {record['layout'].dimensions} "
          f"({len(dist_data) // (1024 * 1024)} MiB dist, "
          f"{len(color_data) // (1024 * 1024)} MiB colour), "
          f"coarse {len(coarse_blob)} B, manifest {MANIFEST_PATH.name}")
    if render_preview:
        render_bind_textured_preview(record)
    report["bindTexturedPreview"] = str(PREVIEW_TEXTURED_PATH.relative_to(REPO_ROOT))
    return report


def write_bake_report(record: dict, soup: SourceSoup, glb: dict,
                      manifest: dict, t0: float) -> dict:
    """Measured evidence (wall-clock lives HERE, never in the manifest)."""
    duration = time.monotonic() - t0
    coarse = manifest["coarse"]
    coarse_by_index = {i: b["sha256"] for i, b in enumerate(coarse["bones"])}
    bones = []
    for i, name in enumerate(record["ordered_names"]):
        rec = record["bones"][name]
        lo, hi = rec["bounds_min"], rec["bounds_max"]
        cd = rec["coarse_dims"]
        achieved_pitch = [float((hi[i] - lo[i]) / (cd[i] - 1)) for i in range(3)]
        bones.append({
            "bone": name,
            "pitchM": rec["pitch_m"],
            "dimensions": list(rec["dims"]),
            "coarseDims": list(cd),
            "coarseAchievedPitchM": achieved_pitch,
            "fieldStats": rec["field_stats"],
            "negativeComponents": rec["negativeComponents"],
            "sourceInterior": rec["source_interior"],
            "supportInterior": rec["support_interior"],
            "supportMeshSha256": rec["support_mesh_sha256"],
            "coarseSha256": coarse_by_index[i],
        })
    report = {
        "task": "2026-08-17-humanoid-sdf-sever-spike/2",
        "kind": "humanoid-bone-sdf-bake-report",
        "durationS": round(duration, 3),
        "source": {
            "sha256": glb["sha256"],
            "byteLength": glb["byteLength"],
            "textureSha256": _texture_sha256(soup),
        },
        "atlas": {
            "dimensions": list(record["layout"].dimensions),
            "distanceBytes": manifest["distance"]["combinedByteLength"],
            "colorBytes": manifest["color"]["combinedByteLength"],
            "coarseBytes": manifest["coarse"]["combinedByteLength"],
            "distanceParts": len(manifest["distance"]["parts"]),
            "colorParts": len(manifest["color"]["parts"]),
        },
        "hashes": {
            "distanceCombined": manifest["distance"]["combinedSha256"],
            "colorCombined": manifest["color"]["combinedSha256"],
            "coarseCombined": manifest["coarse"]["combinedSha256"],
            "manifestInput": manifest["bakeInputSha256"],
            "nodeContract": manifest["bake"]["nodeContractSha256"],
        },
        "rightArm": {
            "cutPlaneLocal": manifest["rightArm"]["cutPlaneLocal"],
            "cutAxisLocal": record["cut_axis_local"],
            "cutSeed": SEVER_CUT_SEED,
            "irregularityM": SEVER_IRREGULARITY_M,
            "rimWidthM": SEVER_RIM_WIDTH_M,
        },
        "jointProbes": record["joint_probes"],
        "clusters": record["clusters"],
        "bones": bones,
    }
    BAKE_REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    BAKE_REPORT_PATH.write_text(json.dumps(report, sort_keys=True, indent=2) + "\n")
    print(f"[report] {BAKE_REPORT_PATH.relative_to(REPO_ROOT)} "
          f"({duration:.1f}s, {len(bones)} bones)")
    return report


# ===========================================================================
# Bind-textured preview: marching-tetrahedra isosurface + Blender EEVEE render
# ===========================================================================

_TET_CORNERS = np.array([(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0),
                         (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)])
_TETS = ((0, 1, 2, 6), (0, 2, 3, 6), (0, 3, 7, 6),
         (0, 7, 4, 6), (0, 4, 5, 6), (0, 5, 1, 6))


def _tet_triangles(pos: npt.NDArray[np.float64], vals: npt.NDArray[np.float64],
                   iso: float) -> list[npt.NDArray[np.float64]]:
    inside = vals < iso
    n_inside = int(inside.sum())
    if n_inside == 0 or n_inside == 4:
        return []

    def interp(i: int, j: int) -> npt.NDArray[np.float64]:
        t = (iso - vals[i]) / (vals[j] - vals[i])
        return pos[i] + t * (pos[j] - pos[i])

    if n_inside == 1:
        a = int(np.argmax(inside))
        others = [k for k in range(4) if k != a]
        return [[interp(a, others[0]), interp(a, others[1]), interp(a, others[2])]]
    if n_inside == 3:
        d = int(np.argmin(inside))
        others = [k for k in range(4) if k != d]
        return [[interp(d, others[0]), interp(d, others[1]), interp(d, others[2])]]
    in_v = [k for k in range(4) if inside[k]]
    out_v = [k for k in range(4) if not inside[k]]
    a, b = in_v
    c, d = out_v
    p = [interp(a, c), interp(a, d), interp(b, d), interp(b, c)]
    return [[p[0], p[1], p[2]], [p[0], p[2], p[3]]]


def _marching_tetrahedra(field: npt.NDArray[np.floating],
                         bounds_min: Sequence[float], voxel: Sequence[float],
                         iso: float = 0.0) -> npt.NDArray[np.float64]:
    f = np.asarray(field, dtype=np.float64) - iso
    nz, ny, nx = f.shape
    lo = np.asarray(bounds_min, dtype=np.float64)
    vx = np.asarray(voxel, dtype=np.float64)
    corners = [f[:-1, :-1, :-1], f[:-1, :-1, 1:], f[:-1, 1:, 1:], f[:-1, 1:, :-1],
               f[1:, :-1, :-1], f[1:, :-1, 1:], f[1:, 1:, 1:], f[1:, 1:, :-1]]
    stack = np.stack(corners)
    crossing = (stack.min(axis=0) < 0.0) & (stack.max(axis=0) >= 0.0)
    zs, ys, xs = np.nonzero(crossing)
    tris: list[npt.NDArray[np.float64]] = []
    for x, y, z in zip(xs.tolist(), ys.tolist(), zs.tolist()):
        pos = np.array([lo + np.array([(x + dx) * vx[0], (y + dy) * vx[1],
                                       (z + dz) * vx[2]])
                        for (dx, dy, dz) in _TET_CORNERS], dtype=np.float64)
        vals = np.array([f[z + dz, y + dy, x + dx]
                         for (dx, dy, dz) in _TET_CORNERS], dtype=np.float64)
        for tet in _TETS:
            for tri in _tet_triangles(pos[list(tet)], vals[list(tet)], iso):
                tris.append(np.asarray(tri))
    if not tris:
        return np.zeros((0, 3), dtype=np.float64)
    return np.vstack(tris)


def _trilinear_rgba(color: npt.NDArray[np.uint8], bounds_min: Sequence[float],
                    voxel: Sequence[float],
                    points: npt.NDArray[np.floating]) -> npt.NDArray[np.uint8]:
    color = np.asarray(color, dtype=np.float64)
    nz, ny, nx = color.shape[:3]
    lo = np.asarray(bounds_min, dtype=np.float64)
    vx = np.asarray(voxel, dtype=np.float64)
    f = (np.asarray(points, dtype=np.float64) - lo) / vx
    fx = np.clip(f[:, 0], 0.0, nx - 1.0)
    fy = np.clip(f[:, 1], 0.0, ny - 1.0)
    fz = np.clip(f[:, 2], 0.0, nz - 1.0)
    x0 = np.floor(fx).astype(np.int64)
    y0 = np.floor(fy).astype(np.int64)
    z0 = np.floor(fz).astype(np.int64)
    x1 = np.minimum(x0 + 1, nx - 1)
    y1 = np.minimum(y0 + 1, ny - 1)
    z1 = np.minimum(z0 + 1, nz - 1)
    ax = (fx - x0)[:, None]
    ay = (fy - y0)[:, None]
    az = (fz - z0)[:, None]
    c000 = color[z0, y0, x0]; c100 = color[z0, y0, x1]
    c010 = color[z0, y1, x0]; c110 = color[z0, y1, x1]
    c001 = color[z1, y0, x0]; c101 = color[z1, y0, x1]
    c011 = color[z1, y1, x0]; c111 = color[z1, y1, x1]
    t = c000 * (1 - ax) + c100 * ax
    b = c010 * (1 - ax) + c110 * ax
    ty = t * (1 - ay) + b * ay
    t2 = c001 * (1 - ax) + c101 * ax
    b2 = c011 * (1 - ax) + c111 * ax
    by = t2 * (1 - ay) + b2 * ay
    return np.rint(ty * (1 - az) + by * az).astype(np.uint8)


def _write_textured_preview_npz(record: dict, path: Path) -> None:
    by_name = {p.name: p for p in record["source_partitions"].partitions}
    verts: list[npt.NDArray[np.float64]] = []
    cols: list[npt.NDArray[np.uint8]] = []
    for name in record["ordered_names"]:
        rec = record["bones"][name]
        part = by_name[name]
        local = _marching_tetrahedra(rec["dense"].values_f32, rec["bounds_min"],
                                     rec["dense"].voxel_size_m)
        if local.shape[0] == 0:
            continue
        color = _trilinear_rgba(rec["color"], rec["bounds_min"],
                                rec["dense"].voxel_size_m, local)
        b2m = np.asarray(part.bind_to_model, dtype=np.float64)
        model = local @ b2m[:3, :3].T + b2m[:3, 3]
        # one flat color per triangle (average of its 3 corner colors)
        face_color = np.rint(
            color.reshape(-1, 3, 4)[:, :, :3].astype(np.float64).mean(axis=1)
        ).astype(np.uint8)
        verts.append(model)
        cols.append(face_color)
    verts = np.vstack(verts) if verts else np.zeros((0, 3), dtype=np.float64)
    cols = np.vstack(cols) if cols else np.zeros((0, 3), dtype=np.uint8)
    faces = np.arange(len(verts), dtype=np.int64).reshape(-1, 3)
    np.savez(path, vertices=verts, faces=faces, colors=cols)


def blender_render_textured_preview_stage(preview_npz: Path,
                                          out_prefix: Path) -> None:
    import bpy
    from mathutils import Vector
    with np.load(preview_npz) as data:
        verts = np.asarray(data["vertices"], dtype=np.float64)
        faces = np.asarray(data["faces"], dtype=np.int64)
        cols = np.asarray(data["colors"], dtype=np.float64) / 255.0
    rx90 = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]])
    verts = verts @ rx90.T
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mesh = bpy.data.meshes.new("HumanoidTextured")
    mesh.from_pydata([tuple(map(float, v)) for v in verts], [],
                     [tuple(map(int, f)) for f in faces])
    mesh.validate()
    mesh.calc_loop_triangles()
    attr = mesh.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    for tri in mesh.loop_triangles:
        c = cols[tri.index]
        for li in tri.loops:
            attr.data[li].color = (*c, 1.0)
    mat = bpy.data.materials.new("TexColors")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    attr_node = nodes.new("ShaderNodeAttribute")
    attr_node.attribute_name = "Col"
    principled = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    principled.inputs["Roughness"].default_value = 0.8
    links.new(attr_node.outputs["Color"], principled.inputs["Base Color"])
    mesh.materials.append(mat)
    obj = bpy.data.objects.new("HumanoidTextured", mesh)
    bpy.context.scene.collection.objects.link(obj)
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    if scene.world is None:
        scene.world = bpy.data.worlds.new("PreviewWorld")
        scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.11, 0.115, 0.13, 1.0)
    bg.inputs[1].default_value = 1.0
    scene.render.resolution_x = 880
    scene.render.resolution_y = 1320
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = "Standard"
        scene.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    target = Vector(tuple(map(float, verts.mean(axis=0))))
    reach = max((Vector(tuple(map(float, v))) - target).length for v in verts)
    up = Vector((0.0, 0.0, 1.0))

    def aim_at(ob: bpy.types.Object, at: Vector) -> None:
        ob.rotation_euler = (at - ob.location).normalized().to_track_quat(
            "-Z", "Y").to_euler()

    for label, direction in (("front", Vector((0.0, -1.0, 0.0))),
                             ("side", Vector((1.0, 0.0, 0.0)))):
        bpy.ops.object.camera_add(location=target + direction * reach * 4.0)
        cam = bpy.context.active_object
        cam.name = f"Cam{label}"
        cam.data.lens = 42
        aim_at(cam, target)
        scene.camera = cam
        for d, power in ((direction + up * 0.6, 4.0),
                         (-direction + up * 0.2 - Vector((0.0, 1.0, 0.0)) * 0.4, 1.6),
                         (-direction + up * 0.5 + Vector((0.0, 1.0, 0.0)) * 0.8, 2.2)):
            bpy.ops.object.light_add(
                type="AREA", location=target + d.normalized() * reach * 3.0)
            light = bpy.context.active_object
            light.data.energy = power * (reach * 3.0) ** 2
            light.data.size = max(reach * 0.4, 0.2)
            aim_at(light, target)
        out = Path(str(out_prefix) + "-" + label + ".png")
        scene.render.filepath = str(out)
        bpy.ops.render.render(write_still=True)
        for ob in list(scene.objects):
            if ob.type in ("CAMERA", "LIGHT"):
                bpy.data.objects.remove(ob, do_unlink=True)
        print(f"[preview] panel -> {out}")


def render_bind_textured_preview(record: dict) -> None:
    with tempfile.TemporaryDirectory(prefix="humanoid-sdf-preview-") as tmp:
        tmpdir = Path(tmp)
        _write_textured_preview_npz(record, tmpdir / "textured.npz")
        _run_blender(["--blender-render-textured", str(tmpdir / "textured.npz"),
                      str(tmpdir / "panel")])
        panels = []
        for label in ("front", "side"):
            rgba = decode_png_rgba((tmpdir / f"panel-{label}.png").read_bytes())
            panels.append(np.ascontiguousarray(rgba[:, :, :3]))
        composed = np.ascontiguousarray(np.concatenate(panels, axis=1))
    PREVIEW_TEXTURED_PATH.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW_TEXTURED_PATH.write_bytes(encode_png_rgb(composed))
    print(f"[preview] {PREVIEW_TEXTURED_PATH.relative_to(REPO_ROOT)}: "
          f"{composed.shape[1]}x{composed.shape[0]} bind-textured")


def parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="Humanoid bone-local SDF spike baker (Task 1: source "
                    "export + weight-derived partitions; Task 2: distance/colour "
                    "atlases)")
    ap.add_argument("--inspect-only", action="store_true",
                    help="export via Blender, verify, write source-report.json")
    ap.add_argument("--render-partitions", action="store_true",
                    help="write partition-preview.png (front + side)")
    ap.add_argument("--validate-only", action="store_true",
                    help="re-read and validate the checked-in manifest + atlases")
    ap.add_argument("--print-coarse-hash", action="store_true",
                    help=argparse.SUPPRESS)
    ap.add_argument("--no-preview", action="store_true",
                    help="skip the bind-textured preview render")
    ap.add_argument("--blender-export", type=Path, metavar="NPZ",
                    help=argparse.SUPPRESS)      # internal: re-entry in Blender
    ap.add_argument("--blender-render-preview", type=Path, nargs=2,
                    metavar=("NPZ", "PREFIX"), help=argparse.SUPPRESS)
    ap.add_argument("--blender-render-textured", type=Path, nargs=2,
                    metavar=("NPZ", "PREFIX"), help=argparse.SUPPRESS)
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
        try:
            import bpy                                   # noqa: F401
            argv = argv[argv.index("--") + 1:] if "--" in argv else []
        except ImportError:
            pass
    args = parse_args(argv)
    if args.blender_export is not None:
        blender_export_stage(args.blender_export)
        return 0
    if args.blender_render_preview is not None:
        npz, prefix = args.blender_render_preview
        blender_render_preview_stage(npz, prefix)
        return 0
    if args.blender_render_textured is not None:
        npz, prefix = args.blender_render_textured
        blender_render_textured_preview_stage(npz, prefix)
        return 0
    if args.inspect_only:
        return run_inspect_only()
    if args.render_partitions:
        return run_render_partitions()
    if args.validate_only:
        manifest = validate_checked_in()
        print(f"[validate] {MANIFEST_PATH.relative_to(REPO_ROOT)} OK: "
              f"{len(manifest['bones'])} bones, atlas "
              f"{manifest['atlasDimensions']}, coarse "
              f"{manifest['coarse']['combinedByteLength']} B")
        return 0
    if args.print_coarse_hash:
        manifest = json.loads(MANIFEST_PATH.read_text())
        print(manifest["coarse"]["combinedSha256"])
        return 0
    # default: run the full Task 2 bake
    run_bake(render_preview=not args.no_preview)
    return 0


if __name__ == "__main__":
    sys.exit(main())
