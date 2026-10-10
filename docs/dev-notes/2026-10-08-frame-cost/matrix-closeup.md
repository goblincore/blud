### Frame by stage (each cell: repeat 1 / repeat 2; ms per frame)

| Scene, segment | bodies, wounds | Frame p50 | GPU span | march | shell hull | level polys | upscale | composite, late fx | goo, gibs | post | compute | idle | CPU tick | CPU draw |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| closeup, closeup | 2, 32 / 2, 32 | 36.5 / 35.9 | 35.7 / 34.9 | 31.7 / 30.6 | 0.4 / 0.4 | 1.1 / 1.1 | 0.6 / 0.6 | 0.1 / 0.1 | 0.3 / 0.3 | 0.5 / 0.5 | 0.1 / 0.1 | 1.0 / 1.3 | 1.3 / 1.5 | 4.9 / 5.4 |

### CPU phases, walk segment (p50 ms, repeat 1 / repeat 2; phases nest)

| Scene | tick | tick:ai-separation | body-step | tick:occluder-hull | encounter | blood-simulation-and-sync | draw | draw:uniforms-cull-crowd | crowd-sdf-inner | skeleton-mesh | crowd-sync | draw:probe-gather-lights |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| closeup | 1.3 / 1.5 | n/a / n/a | n/a / n/a | n/a / n/a | n/a / n/a | 0.8 / 0.9 | 4.9 / 5.4 | 3.0 / 3.4 | 2.5 / 2.7 | 0.4 / 0.5 | 0.2 / 0.2 | 0.5 / 0.6 |

### Counters and hitches

| Scene | draws, live frame | triangles | polys pass draws | entry: pipelines, first frame ms, worst | fight: pipelines built, worst fire frame ms |
| --- | --- | --- | --- | --- | --- |
| closeup | 117 / 117 | 414271 / 414271 | 364 / 346 | - / - | 0, 42.4 / 0, 42.0 |

### Ablations on the frame the fight ends on, frozen (median ms of 8 alternations, with the interquartile range; repeat 1 / repeat 2)

| Leg | closeup |
| --- | --- |
| A/A control | +0.88 (-0.20..+3.00) / -2.27 (-4.60..-0.70) |
| post: VHS off | -1.95 (-2.10..-1.15) / +0.67 (-1.20..+3.95) |
| post: FXAA off | +0.53 (-0.70..+0.85) / -0.27 (-1.60..+0.45) |
| mesh: bones, eyes, organs hidden | +1.50 (-1.40..+4.05) / -3.83 (-4.65..-1.35) |
| mesh: eyes hidden | -0.18 (-2.25..+2.10) / +2.02 (-1.40..+2.90) |
| level: all level meshes hidden | -1.50 (-2.45..-0.70) / -2.48 (-3.00..-1.15) |
| level: art hidden | +2.80 (+0.80..+3.75) / +1.43 (-0.70..+2.10) |
| viewmodel hidden | -0.93 (-3.50..-0.05) / +1.80 (+1.20..+2.25) |
| viewmodel: meshes hidden, its light kept | +0.32 (-0.25..+0.90) / -2.33 (-3.05..-1.10) |
| gib chunks hidden | +1.20 (-1.50..+2.65) / +0.90 (-2.00..+3.45) |
| goo off | +0.02 (-3.00..+1.40) / +2.40 (+0.95..+3.15) |
| bodies: level shadows off | -2.82 (-3.80..-0.40) / +0.58 (-1.00..+1.95) |
| bodies: light list off | +1.35 (-0.85..+2.25) / -1.45 (-3.10..+1.10) |
| march: wound cull off | +0.15 (-0.75..+0.60) / -2.60 (-4.10..-1.85) |
| march: miss cull off | +0.45 (-3.05..+2.60) / -0.28 (-1.25..+3.05) |
| march: outer shell off | +20.02 (+15.25..+22.35) / +18.00 (+17.60..+20.10) |
| march: occluder off | -3.03 (-3.30..-1.85) / -0.40 (-1.85..-0.20) |
| base frame | 40.2 / 42.5 |
