# scripts/levels/flat/shell.py
"""The stone shell: walls, vault, ribs, window, floor (Task 5 and 6 replace this skeleton)."""
import bmesh

import flat_layout as L
from flat import common as C


def quad(bm, a, b, c, d):
    return bm.faces.new([bm.verts.new(v) for v in (a, b, c, d)])


def build(M):
    x0, x1, y0, y1, z1 = L.X0, L.X1, L.Y0, L.Y1, L.CROWN
    for key, mat, face in (("n", M.STONE_N, lambda b: quad(b, (x0, y1, 0), (x1, y1, 0), (x1, y1, z1), (x0, y1, z1))),
                           ("s", M.STONE_S, lambda b: quad(b, (x1, y0, 0), (x0, y0, 0), (x0, y0, z1), (x1, y0, z1))),
                           ("e", M.STONE_E, lambda b: quad(b, (x1, y1, 0), (x1, y0, 0), (x1, y0, z1), (x1, y1, z1))),
                           ("w", M.STONE_W, lambda b: quad(b, (x0, y0, 0), (x0, y1, 0), (x0, y1, z1), (x0, y0, z1)))):
        bm = bmesh.new()
        face(bm)
        C.planar_uv(bm, "x" if key in "ns" else "y", L.WALL_U0[key], L.WALL_W[key], L.WALL_H)
        C.obj_from_bm(f"wall_{key}", bm, mat, uv_size=0)
    bm = bmesh.new()
    quad(bm, (x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0))
    C.obj_from_bm("floor", bm, M.FLAG, uv_size=1.8)
    bm = bmesh.new()
    quad(bm, (x0, y0, z1), (x0, y1, z1), (x1, y1, z1), (x1, y0, z1))
    C.obj_from_bm("ceiling", bm, M.VAULT, uv_size=1.0)
