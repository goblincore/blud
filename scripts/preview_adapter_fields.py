#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["libigl==2.6.2", "numpy==2.5.2", "scipy==1.18.0"]
# ///
"""Render the qualified array-mesh adapter fields to viewable PNGs.

There is no runtime humanoid page yet (that is Tasks 2-7 of the humanoid sever
spike), so this is the only way to LOOK at what the adapters actually produced:
a CPU sphere-trace of the dense signed field plus an orthographic slice sheet.

Diagnostic previews only. This writes no atlas and no runtime asset.

    uv run scripts/preview_adapter_fields.py --hand --humanoid
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
OUT_DIR = REPO_ROOT / "docs" / "dev-notes" / "2026-08-18-blender-sdf-grid"


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


QUAL = _load(SCRIPTS_DIR / "qualify_blender_sdf_real_sources.py",
             "qualify_real_sources_for_preview")
SDF = QUAL.SDF
HUM = QUAL.HUM


# ===========================================================================
# Dense-field sampling and sphere tracing (pure NumPy, no GPU, no libigl)
# ===========================================================================

def sample_field(result: "SDF.DenseSdfResult",
                 points: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
    """Trilinear sample of field[z, y, x] at world metre points, clamped.

    Outside the lattice the field is undefined, so coordinates clamp to the
    edge; callers mark those rays as misses by their own bounds test.
    """
    dims = result.dimensions
    lo = np.asarray(result.bounds_min_m, dtype=np.float64)
    voxel = np.asarray(result.voxel_size_m, dtype=np.float64)
    f = (points - lo) / voxel
    for axis in range(3):
        np.clip(f[:, axis], 0.0, dims[axis] - 1.0, out=f[:, axis])
    i0 = np.floor(f).astype(np.int64)
    for axis in range(3):
        np.clip(i0[:, axis], 0, dims[axis] - 2, out=i0[:, axis])
    a = f - i0
    g = result.values_f32
    x0, y0, z0 = i0[:, 0], i0[:, 1], i0[:, 2]
    ax, ay, az = a[:, 0], a[:, 1], a[:, 2]
    out = np.zeros(len(points), dtype=np.float64)
    for dz in (0, 1):
        wz = az if dz else 1.0 - az
        for dy in (0, 1):
            wy = ay if dy else 1.0 - ay
            for dx in (0, 1):
                wx = ax if dx else 1.0 - ax
                out += wx * wy * wz * g[z0 + dz, y0 + dy, x0 + dx]
    return out


def _camera(result: "SDF.DenseSdfResult", azimuth_deg: float,
            elevation_deg: float, size: int):
    lo = np.asarray(result.bounds_min_m, dtype=np.float64)
    hi = np.asarray(result.bounds_max_m, dtype=np.float64)
    centre = 0.5 * (lo + hi)
    radius = float(np.linalg.norm(hi - lo)) * 0.5
    az, el = np.radians(azimuth_deg), np.radians(elevation_deg)
    forward = np.array([np.cos(el) * np.sin(az), np.sin(el),
                        np.cos(el) * np.cos(az)])
    eye = centre + forward * radius * 2.6
    look = centre - eye
    look /= np.linalg.norm(look)
    up_hint = np.array([0.0, 1.0, 0.0])
    if abs(float(look @ up_hint)) > 0.98:
        up_hint = np.array([0.0, 0.0, 1.0])
    right = np.cross(look, up_hint)
    right /= np.linalg.norm(right)
    up = np.cross(right, look)
    span = radius * 1.15                       # orthographic half-extent
    px = (np.arange(size, dtype=np.float64) + 0.5) / size * 2.0 - 1.0
    gx, gy = np.meshgrid(px, -px)
    origins = (eye + gx.ravel()[:, None] * right * span
               + gy.ravel()[:, None] * up * span)
    directions = np.broadcast_to(look, origins.shape).copy()
    return origins, directions, look


def _ray_box(origins: npt.NDArray[np.float64], directions: npt.NDArray[np.float64],
             lo: npt.NDArray[np.float64], hi: npt.NDArray[np.float64]):
    """Slab test: entry/exit parameters and a hit mask for the lattice AABB."""
    with np.errstate(divide="ignore", invalid="ignore"):
        inv = 1.0 / directions
        t0 = (lo - origins) * inv
        t1 = (hi - origins) * inv
    near = np.minimum(t0, t1)
    far = np.maximum(t0, t1)
    t_enter = np.nanmax(near, axis=1)
    t_exit = np.nanmin(far, axis=1)
    return t_enter, t_exit, (t_exit > np.maximum(t_enter, 0.0))


def sphere_trace(result: "SDF.DenseSdfResult", *, size: int = 512,
                 azimuth_deg: float = 35.0, elevation_deg: float = 22.0,
                 steps: int | None = None) -> npt.NDArray[np.uint8]:
    """Shade the zero isosurface by SIGN CHANGE, not by a distance epsilon.

    Rays are clipped to the lattice AABB up front: outside it the field is
    undefined (sample_field clamps), so marching there is meaningless.

    A classic sphere trace with a step FLOOR is wrong here. The floor exists to
    stop grazing rays stalling, but it overrides the conservative `step <= |d|`
    guarantee, so a ray can jump clean over the surface: measured on the hand
    union, 2,585 rays passed within one voxel and never registered. Instead
    this marches half a voxel at a time near the surface, accelerating only
    through the SATURATED far field where the band-limited value really is a
    safe lower bound, and lands on the first positive->non-positive crossing,
    refined by linear interpolation between the bracketing samples.
    """
    origins, directions, look = _camera(result, azimuth_deg, elevation_deg, size)
    lo = np.asarray(result.bounds_min_m, dtype=np.float64)
    hi = np.asarray(result.bounds_max_m, dtype=np.float64)
    voxel = float(np.min(result.voxel_size_m))
    band = float(np.abs(result.values_f32).max())
    fine = voxel * 0.5

    if steps is None:
        steps = int(float(np.linalg.norm(hi - lo)) / fine) + 96

    t_enter, t_exit, enters = _ray_box(origins, directions, lo, hi)
    t = np.where(enters, np.maximum(t_enter, 0.0), 0.0)
    active = enters.copy()
    hit = np.zeros(len(origins), dtype=bool)
    t_hit = np.zeros(len(origins), dtype=np.float64)
    prev_d = np.full(len(origins), np.inf)
    prev_t = t.copy()

    for _ in range(steps):
        idx = np.flatnonzero(active)
        if idx.size == 0:
            break
        p = origins[idx] + t[idx, None] * directions[idx]
        d = sample_field(result, p)
        before = prev_d[idx]
        crossed = d <= 0.0
        # bracket the crossing; a ray already inside at entry lands where it is
        bracketed = crossed & np.isfinite(before) & (before > 0.0)
        span = np.where(bracketed, before - d, 1.0)
        frac = np.where(bracketed, before / np.where(span != 0.0, span, 1.0), 0.0)
        t_hit[idx] = np.where(
            crossed, prev_t[idx] + frac * (t[idx] - prev_t[idx]), 0.0)
        hit[idx[crossed]] = True
        prev_d[idx] = d
        prev_t[idx] = t[idx]
        # only the saturated far field may be crossed in one leap
        t[idx] += np.where(d >= band * 0.95, np.maximum(d, fine), fine)
        done = crossed | (t[idx] > t_exit[idx])
        active[idx[done]] = False

    rgb = np.zeros((len(origins), 3), dtype=np.float64)
    # background: subtle vertical gradient so the silhouette reads clearly
    gy = np.repeat(np.linspace(0.0, 1.0, size), size)
    rgb[:, 0] = 0.06 + 0.05 * gy
    rgb[:, 1] = 0.07 + 0.06 * gy
    rgb[:, 2] = 0.09 + 0.08 * gy

    if hit.any():
        ph = origins[hit] + t_hit[hit, None] * directions[hit]
        h = voxel * 0.5
        normal = np.zeros_like(ph)
        for axis in range(3):
            offset = np.zeros(3)
            offset[axis] = h
            normal[:, axis] = (sample_field(result, ph + offset)
                               - sample_field(result, ph - offset))
        norm = np.linalg.norm(normal, axis=1, keepdims=True)
        normal /= np.where(norm > 1e-12, norm, 1.0)
        key = np.array([0.45, 0.75, 0.5])
        key /= np.linalg.norm(key)
        fill = np.array([-0.6, 0.15, -0.4])
        fill /= np.linalg.norm(fill)
        lambert = np.clip(normal @ key, 0.0, 1.0)
        bounce = np.clip(normal @ fill, 0.0, 1.0)
        rim = np.clip(1.0 - np.abs(normal @ (-look)), 0.0, 1.0) ** 2.2
        base = np.array([0.80, 0.62, 0.56])            # clay/flesh
        shade = (base * (0.20 + 0.85 * lambert[:, None])
                 + np.array([0.16, 0.20, 0.30]) * bounce[:, None]
                 + np.array([0.55, 0.42, 0.40]) * rim[:, None] * 0.55)
        rgb[hit] = np.clip(shade, 0.0, 1.0)

    img = (np.clip(rgb, 0.0, 1.0) ** (1.0 / 2.2) * 255.0 + 0.5).astype(np.uint8)
    return img.reshape(size, size, 3)


def slice_sheet(result: "SDF.DenseSdfResult", *, columns: int = 6,
                rows: int = 4, cell: int = 128) -> npt.NDArray[np.uint8]:
    """Evenly spaced z slices as a signed heat map (blue inside, warm out)."""
    nz = result.dimensions[2]
    picks = np.linspace(0, nz - 1, columns * rows).round().astype(int)
    scale = float(max(abs(result.values_f32.min()), abs(result.values_f32.max())))
    scale = scale if scale > 0 else 1.0
    sheet = np.zeros((rows * cell, columns * cell, 3), dtype=np.uint8)
    for n, z in enumerate(picks):
        plane = result.values_f32[z]
        ys = np.linspace(0, plane.shape[0] - 1, cell).round().astype(int)
        xs = np.linspace(0, plane.shape[1] - 1, cell).round().astype(int)
        tile = plane[np.ix_(ys, xs)] / scale
        inside = tile < 0.0
        rgb = np.zeros((cell, cell, 3), dtype=np.float64)
        warm = np.clip(tile, 0.0, 1.0)
        rgb[..., 0] = np.where(inside, 0.15 + 0.35 * (1.0 + tile), 0.10 + 0.75 * warm)
        rgb[..., 1] = np.where(inside, 0.35 + 0.45 * (1.0 + tile), 0.10 + 0.35 * warm)
        rgb[..., 2] = np.where(inside, 0.75 - 0.25 * (1.0 + tile), 0.14 + 0.10 * warm)
        band = np.abs(tile) < (0.06)                    # highlight the surface
        rgb[band] = (0.98, 0.98, 0.92)
        r, c = divmod(n, columns)
        sheet[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell] = (
            np.clip(rgb, 0, 1) * 255.0 + 0.5).astype(np.uint8)
    return sheet


# ===========================================================================
# The two qualified sources
# ===========================================================================

def _hand_bake(blender_bin: str | None):
    import tempfile
    import json as _json
    import author_dynamite_grip as GRIP

    with tempfile.TemporaryDirectory(prefix="blud-hand-preview-") as tmp:
        GRIP.export_pose_soups(Path(tmp), contact_sheet=False)
        with np.load(Path(tmp) / QUAL.FIRM_GRIP_POSE, allow_pickle=False) as npz:
            vertices = np.asarray(npz["vertices"], dtype=np.float64)
            faces = np.asarray(npz["faces"], dtype=np.int64)
    box = QUAL.wrist_continuation_box(vertices)
    bv, bf = box.mesh()
    lo = np.minimum(vertices.min(axis=0), np.asarray(box.minimum_m))
    hi = np.maximum(vertices.max(axis=0), np.asarray(box.maximum_m))
    spec = QUAL.padded_spec(lo, hi, pitch_m=QUAL.HAND_PITCH_M,
                            margin_voxels=QUAL.HAND_MARGIN_VOXELS,
                            dimension_cap=QUAL.HAND_DIMENSION_CAP)
    meshes = (QUAL._mesh_input("firm-grip-hand", vertices, faces, "aa" * 32),
              QUAL._mesh_input("wrist-continuation", bv, bf, "bb" * 32))
    return SDF.bake_mesh_union_to_dense(meshes, spec, blender_bin=blender_bin,
                                        keep_tmp=False)


def _humanoid_bake(blender_bin: str | None):
    import tempfile

    with tempfile.TemporaryDirectory(prefix="blud-humanoid-preview-") as tmp:
        soup = HUM.export_source_npz(Path(tmp) / "source.npz")
    partitions = HUM.derive_partitions(soup)
    bounds = QUAL.partition_bind_bounds(partitions, "RightForeArm")
    matrix = np.asarray(bounds.model_to_bind, dtype=np.float64)
    body_local = (np.asarray(soup.vertices, dtype=np.float64)
                  @ matrix[:3, :3].T + matrix[:3, 3])
    faces = np.asarray(soup.faces, dtype=np.int64)
    box = QUAL.forearm_support_box(bounds)
    bv, bf = box.mesh()
    spec = QUAL.padded_spec(box.minimum_m, box.maximum_m, pitch_m=bounds.pitch_m,
                            margin_voxels=QUAL.FOREARM_MARGIN_VOXELS,
                            dimension_cap=QUAL.FOREARM_DIMENSION_CAP)
    return SDF.bake_mesh_intersection_to_dense(
        QUAL._mesh_input("humanoid-body", body_local, faces, "cc" * 32),
        QUAL._mesh_input("right-forearm-support", bv, bf, "dd" * 32),
        spec, blender_bin=blender_bin, keep_tmp=False)


SOURCES: dict[str, dict[str, Any]] = {
    "hand": {"stem": "preview-hand-union", "bake": _hand_bake,
             "azimuth": 40.0, "elevation": 18.0},
    "humanoid": {"stem": "preview-humanoid-forearm", "bake": _humanoid_bake,
                 "azimuth": 125.0, "elevation": 16.0},
}


def parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--hand", action="store_true")
    ap.add_argument("--humanoid", action="store_true")
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--out-dir", type=Path, default=OUT_DIR)
    ap.add_argument("--blender-bin", default=None)
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    picked = [k for k in SOURCES if getattr(args, k)] or list(SOURCES)
    sys.path.insert(0, str(SCRIPTS_DIR))
    args.out_dir.mkdir(parents=True, exist_ok=True)
    for key in picked:
        cfg = SOURCES[key]
        print(f"[preview] baking {key} ...", flush=True)
        result = cfg["bake"](args.blender_bin)
        print(f"[preview] {key}: dims={result.dimensions} "
              f"range=[{result.values_f32.min():.4f}, "
              f"{result.values_f32.max():.4f}] m", flush=True)
        shaded = sphere_trace(result, size=args.size,
                              azimuth_deg=cfg["azimuth"],
                              elevation_deg=cfg["elevation"])
        SDF.write_png_rgb(args.out_dir / f"{cfg['stem']}.png", shaded)
        SDF.write_png_rgb(args.out_dir / f"{cfg['stem']}-slices.png",
                          slice_sheet(result))
        print(f"[preview] -> {args.out_dir / (cfg['stem'] + '.png')}", flush=True)
        print(f"[preview] -> {args.out_dir / (cfg['stem'] + '-slices.png')}",
              flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
