# Mesher comparison — measured summary

commit `2b396068b9e33ab24bf94e55f294f0ebc6f1323a`, 2026-09-15T16:36:43.763Z, node v22.22.1
cells (mm): 20, 10, 5; repeats: 3; warmups: 1

`med` = median extraction ms; `resid` = median |field|/|grad| (metres, first-order); `off>10%` = vertices more than 0.1 cell from the field zero set.

## control-sphere @ 20 mm

| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |
| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |
| surface-nets | 1868 | 3732 | 0 | 0 | 1 | yes | + | 0.527/0.688/0.717 | 1856/12 | 0 | 27734 | 13 (7–13) |  |
| marching-cubes | 1866 | 3728 | 0 | 0 | 1 | yes | + | 0.060/0.198/0.218 | 1848/18 | 0 | 47133 | 11 (6–11) |  |
| dual-contouring | 1868 | 3732 | 0 | 0 | 1 | yes | + | 0.470/0.599/0.688 | 24/1844 | 0 | 98841 | 10 (10–23) |  |

Reference: marching-cubes @ 10 mm (approximate), tolerance 20.00 mm.
| method | mesh→ref med/p95/max mm | ref→mesh med/p95/max mm | coverage mesh→ref |
| --- | ---: | ---: | ---: |
| surface-nets | 0.597/0.915/1.07 | 0.704/1.00/1.29 | 100.0% |
| marching-cubes | 0.244/0.488/0.600 | 0.295/0.545/0.717 | 100.0% |
| dual-contouring | 0.200/0.618/0.718 | 0.248/0.493/0.670 | 100.0% |

## control-sphere @ 10 mm

| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |
| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |
| surface-nets | 7508 | 15012 | 0 | 0 | 1 | yes | + | 0.127/0.168/0.180 | 7496/12 | 0 | 108645 | 21 (21–23) |  |
| marching-cubes | 7506 | 15008 | 0 | 0 | 1 | yes | + | 0.017/0.051/0.059 | 7488/18 | 0 | 272017 | 18 (17–19) |  |
| dual-contouring | 7508 | 15012 | 0 | 0 | 1 | yes | + | 0.103/0.147/0.166 | 24/7484 | 0 | 469693 | 32 (32–35) |  |

Reference: marching-cubes @ 5 mm (approximate), tolerance 10.00 mm.
| method | mesh→ref med/p95/max mm | ref→mesh med/p95/max mm | coverage mesh→ref |
| --- | ---: | ---: | ---: |
| surface-nets | 0.150/0.226/0.261 | 0.171/0.247/0.294 | 100.0% |
| marching-cubes | 0.062/0.119/0.153 | 0.074/0.136/0.182 | 100.0% |
| dual-contouring | 0.049/0.148/0.181 | 0.062/0.113/0.171 | 100.0% |

## control-sphere @ 5 mm

| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |
| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |
| surface-nets | 30116 | 60228 | 0 | 0 | 1 | yes | + | 0.032/0.042/0.045 | 30104/12 | 0 | 449190 | 90 (90–97) |  |
| marching-cubes | 30114 | 60224 | 0 | 0 | 1 | yes | + | 0.004/0.013/0.015 | 30072/42 | 0 | 1952245 | 124 (124–131) |  |
| dual-contouring | 30116 | 60228 | 0 | 0 | 1 | yes | + | 0.026/0.036/0.041 | 600/29516 | 0 | 2716801 | 200 (199–201) |  |

## control-sharp-box @ 20 mm

| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |
| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |
| surface-nets | 1178 | 2352 | 0 | 0 | 1 | yes | + | 0.000/14.14/15.40 | 164/1014 | 164 | 23615 | 7 (7–7) |  |
| marching-cubes | 1176 | 2348 | 0 | 0 | 1 | yes | + | 0.000/0.000/0.000 | 0/1176 | 0 | 31445 | 6 (6–6) |  |
| dual-contouring | 1178 | 2352 | 0 | 0 | 1 | yes | + | 0.000/0.070/0.152 | 164/1014 | 0 | 57317 | 11 (10–12) |  |

Reference: marching-cubes @ 10 mm (approximate), tolerance 20.00 mm.
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

Sharp crease probes (nearest mesh vertex to the designated point, mm):
| probe | surface-nets | marching-cubes | dual-contouring |
| --- | ---: | ---: | ---: |
| corner-+++ | 23.09 | 28.28 | 0.229 |
| corner-+-- | 23.09 | 28.28 | 0.229 |
| corner--+- | 23.09 | 28.28 | 0.229 |
| corner---+ | 23.09 | 28.28 | 0.229 |

## control-sharp-box @ 10 mm

| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |
| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |
| surface-nets | 5048 | 10092 | 0 | 0 | 1 | yes | + | 0.000/7.07/7.70 | 344/4704 | 344 | 94395 | 29 (25–33) |  |
| marching-cubes | 5046 | 10088 | 0 | 0 | 1 | yes | + | 0.000/0.000/0.000 | 0/5046 | 0 | 179153 | 33 (32–34) |  |
| dual-contouring | 5048 | 10092 | 0 | 0 | 1 | yes | + | 0.000/0.035/0.076 | 344/4704 | 0 | 290165 | 55 (53–56) |  |

Reference: marching-cubes @ 5 mm (approximate), tolerance 10.00 mm.
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

Sharp crease probes (nearest mesh vertex to the designated point, mm):
| probe | surface-nets | marching-cubes | dual-contouring |
| --- | ---: | ---: | ---: |
| corner-+++ | 11.55 | 14.14 | 0.114 |
| corner-+-- | 11.55 | 14.14 | 0.114 |
| corner--+- | 11.55 | 14.14 | 0.114 |
| corner---+ | 11.55 | 14.14 | 0.114 |

## control-sharp-box @ 5 mm

| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |
| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |
| surface-nets | 20888 | 41772 | 0 | 0 | 1 | yes | + | 0.000/0.000/3.85 | 704/20184 | 704 | 357699 | 104 (104–105) |  |
| marching-cubes | 20886 | 41768 | 0 | 0 | 1 | yes | + | 0.000/0.000/0.000 | 0/20886 | 0 | 1155617 | 202 (202–218) |  |
| dual-contouring | 20888 | 41772 | 0 | 0 | 1 | yes | + | 0.000/0.000/0.038 | 704/20184 | 0 | 1615109 | 297 (297–303) |  |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| corner-+++ | 397v | 432v | 397v |
| face-+x | 256v | 289v | 256v |

Sharp crease probes (nearest mesh vertex to the designated point, mm):
| probe | surface-nets | marching-cubes | dual-contouring |
| --- | ---: | ---: | ---: |
| corner-+++ | 5.77 | 7.07 | 0.057 |
| corner-+-- | 5.77 | 7.07 | 0.057 |
| corner--+- | 5.77 | 7.07 | 0.057 |
| corner---+ | 5.77 | 7.07 | 0.057 |

## chamfer-groove @ 20 mm

| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |
| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |
| surface-nets | 968 | 1932 | 0 | 0 | 1 | yes | + | 0.552/1.80/6.33 | 968/0 | 32 | 13115 | 5 (5–8) |  |
| marching-cubes | 966 | 1928 | 0 | 0 | 1 | yes | + | 0.088/0.776/6.42 | 954/12 | 12 | 15057 | 4 (3–4) |  |
| dual-contouring | 968 | 1932 | 0 | 0 | 1 | yes | + | 0.393/1.21/12.87 | 2/966 | 12 | 43617 | 10 (10–10) |  |

Reference: marching-cubes @ 10 mm (approximate), tolerance 20.00 mm.
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

| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |
| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |
| surface-nets | 3914 | 7824 | 0 | 0 | 1 | yes | + | 0.129/0.404/3.95 | 3868/46 | 42 | 51452 | 17 (17–20) |  |
| marching-cubes | 3912 | 7820 | 0 | 0 | 1 | yes | + | 0.022/0.145/4.33 | 3844/68 | 30 | 92393 | 21 (21–22) |  |
| dual-contouring | 3914 | 7824 | 0 | 0 | 1 | yes | + | 0.101/0.329/6.98 | 38/3876 | 20 | 200025 | 46 (45–46) |  |

Reference: marching-cubes @ 5 mm (approximate), tolerance 10.00 mm.
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

| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |
| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |
| surface-nets | 15714 | 31424 | 0 | 0 | 1 | yes | + | 0.031/0.099/2.46 | 15458/256 | 86 | 208344 | 74 (73–75) |  |
| marching-cubes | 15712 | 31420 | 0 | 0 | 1 | yes | + | 0.005/0.033/3.49 | 15432/280 | 132 | 599469 | 137 (137–138) |  |
| dual-contouring | 15714 | 31424 | 0 | 0 | 1 | yes | + | 0.023/0.084/2.84 | 310/15404 | 68 | 1009189 | 235 (233–237) |  |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| chamfer-seam | 2334v | 2458v | 2336v |
| groove-channel | 778v | 840v | 778v |

## character-head @ 20 mm

| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |
| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |
| surface-nets | 1115 | 2176 | 52 | 0 | 1 | no | + | 0.648/3.05/32.81 | 896/219 | 138 | 22249 | 148 (148–149) |  |
| marching-cubes | 1140 | 2226 | 52 | 0 | 1 | no | + | 0.171/1.34/12.61 | 870/270 | 42 | 26937 | 175 (174–176) |  |
| dual-contouring | 1115 | 2176 | 52 | 0 | 1 | no | + | 0.702/2.60/16.68 | 141/974 | 117 | 60609 | 406 (393–408) |  |

Reference: marching-cubes @ 10 mm (approximate), tolerance 20.00 mm.
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

| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |
| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |
| surface-nets | 4550 | 8992 | 106 | 0 | 1 | no | + | 0.196/0.797/8.07 | 3722/828 | 184 | 80448 | 530 (528–536) |  |
| marching-cubes | 4602 | 9096 | 106 | 0 | 1 | no | + | 0.043/0.310/8.60 | 3550/1052 | 104 | 160165 | 1036 (1035–1038) |  |
| dual-contouring | 4550 | 8992 | 106 | 0 | 1 | no | + | 0.185/0.672/10.89 | 766/3784 | 112 | 287593 | 1897 (1876–1897) |  |

Reference: marching-cubes @ 5 mm (approximate), tolerance 10.00 mm.
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

| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |
| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |
| surface-nets | 18640 | 37052 | 230 | 0 | 1 | no | + | 0.059/0.195/3.46 | 15164/3476 | 260 | 307441 | 2059 (2034–2069) |  |
| marching-cubes | 18756 | 37284 | 230 | 0 | 1 | no | + | 0.011/0.078/5.74 | 14472/4284 | 205 | 1069713 | 6914 (6894–7047) |  |
| dual-contouring | 18640 | 37052 | 230 | 0 | 1 | no | + | 0.047/0.206/7.24 | 3164/15476 | 256 | 1563017 | 10298 (10109–10370) |  |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| ear-l | 1243v | 1245v | 1243v |
| ear-r | 1243v | 1245v | 1243v |
| mouth-groove | 1008v | 1109v | 1008v |

## torn-chunk @ 20 mm

| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |
| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |
| surface-nets | 184 | 364 | 0 | 0 | 1 | yes | + | 1.57/3.29/7.50 | 160/24 | 64 | 3958 | 2 (2–2) |  |
| marching-cubes | 182 | 360 | 0 | 0 | 1 | yes | + | 0.236/1.08/5.28 | 152/30 | 4 | 4641 | 2 (2–2) |  |
| dual-contouring | 184 | 364 | 0 | 0 | 1 | yes | + | 1.29/3.33/6.91 | 16/168 | 44 | 10437 | 5 (4–5) |  |

Reference: marching-cubes @ 10 mm (approximate), tolerance 20.00 mm.
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

| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |
| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |
| surface-nets | 656 | 1308 | 0 | 0 | 1 | yes | + | 0.439/1.04/3.84 | 620/36 | 56 | 11713 | 7 (6–8) |  |
| marching-cubes | 654 | 1304 | 0 | 0 | 1 | yes | + | 0.090/0.919/2.35 | 608/46 | 8 | 27049 | 11 (11–11) |  |
| dual-contouring | 656 | 1308 | 0 | 0 | 1 | yes | + | 0.352/0.757/2.76 | 28/628 | 4 | 45853 | 19 (19–20) |  |

Reference: marching-cubes @ 5 mm (approximate), tolerance 10.00 mm.
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

| method | verts | tris | bnd edges | non-mf edges | comps | closed | vol sign | resid mm (med/p95/max) | in/out | off>10% | evals | med ms (min–max) | invalid |
| --- | ---: | ---: | ---: | ---: | ---: | :--: | :--: | ---: | ---: | ---: | :--: |
| surface-nets | 2688 | 5372 | 0 | 0 | 1 | yes | + | 0.098/0.251/0.766 | 2624/64 | 28 | 43078 | 25 (23–26) |  |
| marching-cubes | 2686 | 5368 | 0 | 0 | 1 | yes | + | 0.021/0.082/0.437 | 2496/190 | 0 | 181785 | 73 (73–73) |  |
| dual-contouring | 2688 | 5372 | 0 | 0 | 1 | yes | + | 0.076/0.191/0.696 | 108/2580 | 20 | 253293 | 105 (104–107) |  |

Feature presence (mesh verts inside box / reference coverage):
| region | surface-nets | marching-cubes | dual-contouring |
| --- | --- | --- | --- |
| crater-rim | 144v | 153v | 144v |
