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
import shutil
import struct
import subprocess
import sys
import tempfile
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
    rows = np.repeat(np.arange(len(f), dtype=np.int64), 3)[order]
    same = (keys[1:] == keys[:-1]).all(axis=1)
    return rows[:-1][same], rows[1:][same]


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
    """Deterministic golden-angle HSV palette, one distinct color/partition."""
    import colorsys
    out = np.zeros((n, 3), dtype=np.uint8)
    for i in range(n):
        r, g, b = colorsys.hsv_to_rgb((i * 0.618033988749895) % 1.0,
                                      0.72, 0.95)
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


def parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="Humanoid bone-local SDF spike baker (Task 1: source "
                    "export + weight-derived partitions)")
    ap.add_argument("--inspect-only", action="store_true",
                    help="export via Blender, verify, write source-report.json")
    ap.add_argument("--render-partitions", action="store_true",
                    help="write partition-preview.png (front + side)")
    ap.add_argument("--blender-export", type=Path, metavar="NPZ",
                    help=argparse.SUPPRESS)      # internal: re-entry in Blender
    ap.add_argument("--blender-render-preview", type=Path, nargs=2,
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
    if args.inspect_only:
        return run_inspect_only()
    if args.render_partitions:
        return run_render_partitions()
    print(__doc__.splitlines()[0], file=sys.stderr)
    print("choose --inspect-only or --render-partitions "
          "(the Task 2 atlas bake arrives in the next task)", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
