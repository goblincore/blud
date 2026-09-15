# Mesher comparison — measured summary

worktree HEAD `c9258e211a3ea0d62f0475424972d7db3f7cbc4d` (DIRTY WORKING TREE), comparison source fingerprint `998abe46e618d2d7`, 2026-09-15T17:07:52.999Z, node v22.22.1
cells (mm): 20, 10, 5; repeats: 3; warmups: 1

`med` = median extraction ms; `resid` = median |field|/|grad| over mesh VERTICES (first-order, metres); `surf resid` = median |field| sampled at vertices + triangle centroids (exact distance only where the fixture is analytic); `off>10%` = vertices more than 0.1 cell from the field zero set; `fallbacks` = benign finite fallbacks (e.g. singular QEF); `dropped` = unconnected intended geometry (nonzero + not explained by a clipped domain -> invalid).

Residuals are vertex/surface-sampling diagnostics: dividing by |grad| does not remove sampling bias or account for triangle-interior error. Cross-method reference distances are sampled and approximate; because the reference resolution varies per ladder step, matched-ERROR extraction cost is NOT established.

## control-sphere @ 20 mm

| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |
| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |
| surface-nets | ok | 1868 | 3732 | 0 | 0 | 1 | yes | + | 0.527/0.688/0.717 | 0.688 | 1856/12 | 0 | 0 | 0 | 27734 | 13 (7–13) |  |
| marching-cubes | ok | 1866 | 3728 | 0 | 0 | 1 | yes | + | 0.060/0.198/0.218 | 0.360 | 1848/18 | 0 | 0 | 0 | 47133 | 3 (3–13) |  |
| dual-contouring | ok | 1868 | 3732 | 0 | 0 | 1 | yes | + | 0.470/0.599/0.688 | 0.094 | 24/1844 | 0 | 0 | 0 | 98841 | 10 (10–24) |  |

Reference: marching-cubes @ 10 mm (approximate; resolution varies by ladder step), tolerance 20.00 mm.
| method | mesh→ref med/p95/max mm | ref→mesh med/p95/max mm | coverage mesh→ref |
| --- | ---: | ---: | ---: |
| surface-nets | 0.597/0.915/1.07 | 0.704/1.00/1.29 | 100.0% |
| marching-cubes | 0.244/0.488/0.600 | 0.295/0.545/0.717 | 100.0% |
| dual-contouring | 0.200/0.618/0.718 | 0.248/0.493/0.670 | 100.0% |

## control-sphere @ 10 mm

| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |
| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |
| surface-nets | ok | 7508 | 15012 | 0 | 0 | 1 | yes | + | 0.127/0.168/0.180 | 0.171 | 7496/12 | 0 | 0 | 0 | 108645 | 21 (21–21) |  |
| marching-cubes | ok | 7506 | 15008 | 0 | 0 | 1 | yes | + | 0.017/0.051/0.059 | 0.092 | 7488/18 | 0 | 0 | 0 | 272017 | 17 (17–18) |  |
| dual-contouring | ok | 7508 | 15012 | 0 | 0 | 1 | yes | + | 0.103/0.147/0.166 | 0.022 | 24/7484 | 0 | 0 | 0 | 469693 | 31 (31–35) |  |

Reference: marching-cubes @ 5 mm (approximate; resolution varies by ladder step), tolerance 10.00 mm.
| method | mesh→ref med/p95/max mm | ref→mesh med/p95/max mm | coverage mesh→ref |
| --- | ---: | ---: | ---: |
| surface-nets | 0.150/0.226/0.261 | 0.171/0.247/0.294 | 100.0% |
| marching-cubes | 0.062/0.119/0.153 | 0.074/0.136/0.182 | 100.0% |
| dual-contouring | 0.049/0.148/0.181 | 0.062/0.113/0.171 | 100.0% |

## control-sphere @ 5 mm

| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |
| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |
| surface-nets | ok | 30116 | 60228 | 0 | 0 | 1 | yes | + | 0.032/0.042/0.045 | 0.043 | 30104/12 | 0 | 0 | 0 | 449190 | 91 (89–91) |  |
| marching-cubes | ok | 30114 | 60224 | 0 | 0 | 1 | yes | + | 0.004/0.013/0.015 | 0.023 | 30072/42 | 0 | 0 | 0 | 1952245 | 122 (122–122) |  |
| dual-contouring | ok | 30116 | 60228 | 0 | 0 | 1 | yes | + | 0.026/0.036/0.041 | 0.006 | 600/29516 | 0 | 0 | 0 | 2716801 | 197 (196–197) |  |

## control-sharp-box @ 20 mm

| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |
| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |
| surface-nets | ok | 1178 | 2352 | 0 | 0 | 1 | yes | + | 0.000/14.14/15.40 | 0.000 | 164/1014 | 164 | 0 | 0 | 23615 | 8 (8–8) |  |
| marching-cubes | ok | 1176 | 2348 | 0 | 0 | 1 | yes | + | 0.000/0.000/0.000 | 0.000 | 0/1176 | 0 | 0 | 0 | 31445 | 8 (7–9) |  |
| dual-contouring | ok | 1178 | 2352 | 0 | 0 | 1 | yes | + | 0.000/0.070/0.152 | 0.000 | 164/1014 | 0 | 0 | 0 | 57317 | 13 (13–15) |  |

Reference: marching-cubes @ 10 mm (approximate; resolution varies by ladder step), tolerance 20.00 mm.
| method | mesh→ref med/p95/max mm | ref→mesh med/p95/max mm | coverage mesh→ref |
| --- | ---: | ---: | ---: |
| surface-nets | 0.000/7.07/11.55 | 0.000/8.94/14.14 | 100.0% |
| marching-cubes | 0.000/6.67/11.55 | 0.000/7.07/11.55 | 100.0% |
| dual-contouring | 0.000/0.061/11.32 | 0.000/0.061/6.56 | 100.0% |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| corner-+++ | 19v/100% | 27v/100% | 19v/100% |
| face-+x | 25v/100% | 16v/100% | 25v/100% |

Sharp crease probes — nearest TRIANGLE SURFACE distance to the designated point (mm; vertex-only distance in parentheses):
| probe | surface-nets | marching-cubes | dual-contouring |
| --- | ---: | ---: | ---: |
| corner-+++ | 23.09 (23.09) | 23.09 (28.28) | 0.229 (0.229) |
| corner-+-- | 23.09 (23.09) | 23.09 (28.28) | 0.229 (0.229) |
| corner--+- | 23.09 (23.09) | 23.09 (28.28) | 0.229 (0.229) |
| corner---+ | 23.09 (23.09) | 23.09 (28.28) | 0.229 (0.229) |

## control-sharp-box @ 10 mm

| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |
| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |
| surface-nets | ok | 5048 | 10092 | 0 | 0 | 1 | yes | + | 0.000/7.07/7.70 | 0.000 | 344/4704 | 344 | 0 | 0 | 94395 | 31 (31–31) |  |
| marching-cubes | ok | 5046 | 10088 | 0 | 0 | 1 | yes | + | 0.000/0.000/0.000 | 0.000 | 0/5046 | 0 | 0 | 0 | 179153 | 41 (40–42) |  |
| dual-contouring | ok | 5048 | 10092 | 0 | 0 | 1 | yes | + | 0.000/0.035/0.076 | 0.000 | 344/4704 | 0 | 0 | 0 | 290165 | 67 (67–71) |  |

Reference: marching-cubes @ 5 mm (approximate; resolution varies by ladder step), tolerance 10.00 mm.
| method | mesh→ref med/p95/max mm | ref→mesh med/p95/max mm | coverage mesh→ref |
| --- | ---: | ---: | ---: |
| surface-nets | 0.000/3.33/5.77 | 0.000/3.73/7.07 | 100.0% |
| marching-cubes | 0.000/0.000/5.77 | 0.000/2.36/5.77 | 100.0% |
| dual-contouring | 0.000/0.017/5.66 | 0.000/0.017/3.28 | 100.0% |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| corner-+++ | 91v/100% | 108v/100% | 91v/100% |
| face-+x | 64v/100% | 81v/100% | 64v/100% |

Sharp crease probes — nearest TRIANGLE SURFACE distance to the designated point (mm; vertex-only distance in parentheses):
| probe | surface-nets | marching-cubes | dual-contouring |
| --- | ---: | ---: | ---: |
| corner-+++ | 11.55 (11.55) | 11.55 (14.14) | 0.114 (0.114) |
| corner-+-- | 11.55 (11.55) | 11.55 (14.14) | 0.114 (0.114) |
| corner--+- | 11.55 (11.55) | 11.55 (14.14) | 0.114 (0.114) |
| corner---+ | 11.55 (11.55) | 11.55 (14.14) | 0.114 (0.114) |

## control-sharp-box @ 5 mm

| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |
| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |
| surface-nets | ok | 20888 | 41772 | 0 | 0 | 1 | yes | + | 0.000/0.000/3.85 | 0.000 | 704/20184 | 704 | 0 | 0 | 357699 | 122 (121–122) |  |
| marching-cubes | ok | 20886 | 41768 | 0 | 0 | 1 | yes | + | 0.000/0.000/0.000 | 0.000 | 0/20886 | 0 | 0 | 0 | 1155617 | 266 (264–266) |  |
| dual-contouring | ok | 20888 | 41772 | 0 | 0 | 1 | yes | + | 0.000/0.000/0.038 | 0.000 | 704/20184 | 0 | 0 | 0 | 1615109 | 381 (380–381) |  |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| corner-+++ | 397v | 432v | 397v |
| face-+x | 256v | 289v | 256v |

Sharp crease probes — nearest TRIANGLE SURFACE distance to the designated point (mm; vertex-only distance in parentheses):
| probe | surface-nets | marching-cubes | dual-contouring |
| --- | ---: | ---: | ---: |
| corner-+++ | 5.77 (5.77) | 5.77 (7.07) | 0.057 (0.057) |
| corner-+-- | 5.77 (5.77) | 5.77 (7.07) | 0.057 (0.057) |
| corner--+- | 5.77 (5.77) | 5.77 (7.07) | 0.057 (0.057) |
| corner---+ | 5.77 (5.77) | 5.77 (7.07) | 0.057 (0.057) |

## chamfer-groove @ 20 mm

| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |
| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |
| surface-nets | ok | 968 | 1932 | 0 | 0 | 1 | yes | + | 0.552/1.80/6.33 | 1.18 | 968/0 | 32 | 0 | 0 | 13115 | 8 (8–8) |  |
| marching-cubes | ok | 966 | 1928 | 0 | 0 | 1 | yes | + | 0.088/0.776/6.42 | 0.465 | 954/12 | 12 | 0 | 0 | 15057 | 7 (7–7) |  |
| dual-contouring | ok | 968 | 1932 | 0 | 0 | 1 | yes | + | 0.393/1.21/12.87 | 0.154 | 2/966 | 12 | 0 | 0 | 43617 | 20 (20–21) |  |

Reference: marching-cubes @ 10 mm (approximate; resolution varies by ladder step), tolerance 20.00 mm.
| method | mesh→ref med/p95/max mm | ref→mesh med/p95/max mm | coverage mesh→ref |
| --- | ---: | ---: | ---: |
| surface-nets | 0.756/2.04/4.51 | 0.898/2.25/6.05 | 100.0% |
| marching-cubes | 0.258/1.23/6.58 | 0.363/1.57/7.74 | 100.0% |
| dual-contouring | 0.274/1.16/8.31 | 0.247/0.977/9.15 | 100.0% |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| chamfer-seam | 128v/100% | 158v/100% | 128v/100% |
| groove-channel | 64v/100% | 44v/100% | 34v/100% |

## chamfer-groove @ 10 mm

| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |
| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |
| surface-nets | ok | 3914 | 7824 | 0 | 0 | 1 | yes | + | 0.129/0.404/3.95 | 0.282 | 3868/46 | 42 | 0 | 0 | 51452 | 31 (29–32) |  |
| marching-cubes | ok | 3912 | 7820 | 0 | 0 | 1 | yes | + | 0.022/0.145/4.33 | 0.113 | 3844/68 | 30 | 0 | 0 | 92393 | 42 (42–43) |  |
| dual-contouring | ok | 3914 | 7824 | 0 | 0 | 1 | yes | + | 0.101/0.329/6.98 | 0.045 | 38/3876 | 20 | 0 | 0 | 200025 | 91 (91–94) |  |

Reference: marching-cubes @ 5 mm (approximate; resolution varies by ladder step), tolerance 10.00 mm.
| method | mesh→ref med/p95/max mm | ref→mesh med/p95/max mm | coverage mesh→ref |
| --- | ---: | ---: | ---: |
| surface-nets | 0.179/0.538/3.80 | 0.213/0.707/4.66 | 100.0% |
| marching-cubes | 0.062/0.286/3.14 | 0.086/0.391/4.49 | 100.0% |
| dual-contouring | 0.073/0.325/3.31 | 0.066/0.274/5.26 | 100.0% |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| chamfer-seam | 562v/100% | 624v/100% | 562v/100% |
| groove-channel | 200v/100% | 230v/100% | 200v/100% |

## chamfer-groove @ 5 mm

| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |
| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |
| surface-nets | ok | 15714 | 31424 | 0 | 0 | 1 | yes | + | 0.031/0.099/2.46 | 0.068 | 15458/256 | 86 | 0 | 0 | 208344 | 123 (122–124) |  |
| marching-cubes | ok | 15712 | 31420 | 0 | 0 | 1 | yes | + | 0.005/0.033/3.49 | 0.028 | 15432/280 | 132 | 0 | 0 | 599469 | 272 (271–273) |  |
| dual-contouring | ok | 15714 | 31424 | 0 | 0 | 1 | yes | + | 0.023/0.084/2.84 | 0.011 | 310/15404 | 68 | 0 | 0 | 1009189 | 463 (459–464) |  |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| chamfer-seam | 2334v | 2458v | 2336v |
| groove-channel | 778v | 840v | 778v |

## character-head @ 20 mm

| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |
| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |
| surface-nets | ok | 1115 | 2176 | 52 | 0 | 1 | no | + | 0.648/3.05/32.81 | 0.952 | 896/219 | 138 | 0 | 52 | 22249 | 150 (150–154) |  |
| marching-cubes | ok | 1140 | 2226 | 52 | 0 | 1 | no | + | 0.171/1.34/12.61 | 0.438 | 870/270 | 42 | 0 | 0 | 26937 | 178 (178–179) |  |
| dual-contouring | ok | 1115 | 2176 | 52 | 0 | 1 | no | + | 0.702/2.60/16.68 | 0.269 | 141/974 | 117 | 0 | 0 | 60609 | 400 (400–401) |  |

Reference: marching-cubes @ 10 mm (approximate; resolution varies by ladder step), tolerance 20.00 mm.
| method | mesh→ref med/p95/max mm | ref→mesh med/p95/max mm | coverage mesh→ref |
| --- | ---: | ---: | ---: |
| surface-nets | 1.02/3.46/8.93 | 1.26/5.28/26.93 | 100.0% |
| marching-cubes | 0.373/2.06/9.36 | 0.605/3.02/27.82 | 100.0% |
| dual-contouring | 0.448/2.19/13.78 | 0.484/2.71/19.26 | 100.0% |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| ear-l | 80v/100% | 80v/100% | 76v/100% |
| ear-r | 80v/100% | 80v/100% | 76v/100% |
| mouth-groove | 60v/100% | 76v/100% | 54v/100% |

## character-head @ 10 mm

| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |
| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |
| surface-nets | ok | 4550 | 8992 | 106 | 0 | 1 | no | + | 0.196/0.797/8.07 | 0.264 | 3722/828 | 184 | 0 | 106 | 80448 | 542 (540–558) |  |
| marching-cubes | ok | 4602 | 9096 | 106 | 0 | 1 | no | + | 0.043/0.310/8.60 | 0.125 | 3550/1052 | 104 | 0 | 0 | 160165 | 1060 (1059–1062) |  |
| dual-contouring | ok | 4550 | 8992 | 106 | 0 | 1 | no | + | 0.185/0.672/10.89 | 0.060 | 766/3784 | 112 | 0 | 0 | 287593 | 1910 (1906–1923) |  |

Reference: marching-cubes @ 5 mm (approximate; resolution varies by ladder step), tolerance 10.00 mm.
| method | mesh→ref med/p95/max mm | ref→mesh med/p95/max mm | coverage mesh→ref |
| --- | ---: | ---: | ---: |
| surface-nets | 0.271/1.07/3.60 | 0.326/1.62/15.97 | 100.0% |
| marching-cubes | 0.109/0.743/4.08 | 0.163/0.946/15.90 | 100.0% |
| dual-contouring | 0.119/0.637/3.64 | 0.125/0.664/10.55 | 100.0% |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| ear-l | 307v/99% | 308v/99% | 307v/100% |
| ear-r | 307v/99% | 308v/99% | 307v/100% |
| mouth-groove | 244v/100% | 291v/100% | 248v/100% |

## character-head @ 5 mm

| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |
| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |
| surface-nets | ok | 18640 | 37052 | 230 | 0 | 1 | no | + | 0.059/0.195/3.46 | 0.070 | 15164/3476 | 260 | 0 | 230 | 307441 | 2078 (2072–2099) |  |
| marching-cubes | ok | 18756 | 37284 | 230 | 0 | 1 | no | + | 0.011/0.078/5.74 | 0.033 | 14472/4284 | 205 | 0 | 0 | 1069713 | 7091 (7049–7129) |  |
| dual-contouring | ok | 18640 | 37052 | 230 | 0 | 1 | no | + | 0.047/0.206/7.24 | 0.015 | 3164/15476 | 256 | 0 | 0 | 1563017 | 10344 (10313–10362) |  |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| ear-l | 1243v | 1245v | 1243v |
| ear-r | 1243v | 1245v | 1243v |
| mouth-groove | 1008v | 1109v | 1008v |

## torn-chunk @ 20 mm

| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |
| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |
| surface-nets | ok | 184 | 364 | 0 | 0 | 1 | yes | + | 1.57/3.29/7.50 | 2.18 | 160/24 | 64 | 0 | 0 | 3958 | 2 (2–2) |  |
| marching-cubes | ok | 182 | 360 | 0 | 0 | 1 | yes | + | 0.236/1.08/5.28 | 0.937 | 152/30 | 4 | 0 | 0 | 4641 | 2 (2–2) |  |
| dual-contouring | ok | 184 | 364 | 0 | 0 | 1 | yes | + | 1.29/3.33/6.91 | 0.351 | 16/168 | 44 | 0 | 0 | 10437 | 5 (4–5) |  |

Reference: marching-cubes @ 10 mm (approximate; resolution varies by ladder step), tolerance 20.00 mm.
| method | mesh→ref med/p95/max mm | ref→mesh med/p95/max mm | coverage mesh→ref |
| --- | ---: | ---: | ---: |
| surface-nets | 1.92/4.00/5.10 | 2.18/4.43/8.00 | 100.0% |
| marching-cubes | 0.727/2.36/2.95 | 1.11/2.61/3.84 | 100.0% |
| dual-contouring | 0.840/3.23/9.62 | 0.773/2.79/7.63 | 100.0% |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| crater-rim | 8v/100% | 9v/100% | 8v/100% |

## torn-chunk @ 10 mm

| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |
| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |
| surface-nets | ok | 656 | 1308 | 0 | 0 | 1 | yes | + | 0.439/1.04/3.84 | 0.572 | 620/36 | 56 | 0 | 0 | 11713 | 6 (6–6) |  |
| marching-cubes | ok | 654 | 1304 | 0 | 0 | 1 | yes | + | 0.090/0.919/2.35 | 0.263 | 608/46 | 8 | 0 | 0 | 27049 | 11 (11–11) |  |
| dual-contouring | ok | 656 | 1308 | 0 | 0 | 1 | yes | + | 0.352/0.757/2.76 | 0.078 | 28/628 | 4 | 0 | 0 | 45853 | 19 (18–19) |  |

Reference: marching-cubes @ 5 mm (approximate; resolution varies by ladder step), tolerance 10.00 mm.
| method | mesh→ref med/p95/max mm | ref→mesh med/p95/max mm | coverage mesh→ref |
| --- | ---: | ---: | ---: |
| surface-nets | 0.521/1.15/3.79 | 0.591/1.32/3.83 | 100.0% |
| marching-cubes | 0.211/0.746/2.57 | 0.286/0.865/2.79 | 100.0% |
| dual-contouring | 0.204/0.758/3.27 | 0.200/0.556/2.29 | 100.0% |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| crater-rim | 40v/100% | 45v/100% | 40v/100% |

## torn-chunk @ 5 mm

| method | status | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | surf resid mm (med) | in/out | off>10% | fallbacks | dropped | evals | med ms (min–max) | invalid reason |
| --- | :--: | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | ---: | ---: | ---: | :--: | ---: |
| surface-nets | ok | 2688 | 5372 | 0 | 0 | 1 | yes | + | 0.098/0.251/0.766 | 0.141 | 2624/64 | 28 | 0 | 0 | 43078 | 24 (24–24) |  |
| marching-cubes | ok | 2686 | 5368 | 0 | 0 | 1 | yes | + | 0.021/0.082/0.437 | 0.063 | 2496/190 | 0 | 0 | 0 | 181785 | 71 (71–73) |  |
| dual-contouring | ok | 2688 | 5372 | 0 | 0 | 1 | yes | + | 0.076/0.191/0.696 | 0.019 | 108/2580 | 20 | 0 | 0 | 253293 | 102 (102–106) |  |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| crater-rim | 144v | 153v | 144v |
