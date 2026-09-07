# Task 6 core gate — direct recovery

The owner retired polygonal bone tubes from the intended gameplay path on 2026-09-07 because their appearance is unsuitable. The mandatory gate now keeps current SDF field bones active and excludes tubes explicitly. Bone sphere culling is a separate agent's work and is not integrated or claimed here. Baked geometry, detached chunks and their normal/depth/lifecycle checks remain mandatory in the full gate.

The general readback repairs from `222019a9` are retained. The direct recovery also corrects the driver and diagnostic seams:

- `screenPosOf` uses the live WebGPU camera, whose projected depth is already [0,1]. The former OpenGL remap moved behind-surface probes in front. Three-camera CPU reconstruction checks and real front/behind GPU checks verify the correction.
- Brackets now test the same verified surface pixel sequentially and assert its producer class. The former sideways spread could sample a wall while calling the result flesh.
- Diagnostic sprites can use a fixed screen footprint; tiny far-depth world-size sprites were not measurable. Palette probes bypass fog and tone mapping so color classification tests depth alone. The existing numeric world-size argument remains supported.
- Redirected depth checks inspect linear composed pixels before FXAA; evidence also retains the displayed color. The gun probe was pure red in the composed target while FXAA reduced its displayed red channel to 123. Canvas-path checks still use the screenshot with postprocessing off.
- Empty-space testing only hides/restores the level with camera and simulation locked. Teleporting away and settling back changed camera-dependent normal/depth bits despite identical class/albedo.
- Single and batch readbacks select the containing pixel with floor. Rounding mapped half-pixel centers to adjacent texels and made the deepest-pixel probe miss its recorded depth.
- Core evidence remains separate from full acceptance. Evidence is saved after every check, and a failure writes an honest core report. Full acceptance is only set after a successful full run.

Verification is recorded in `game-validation-core.json` and `task-6-core.md`. The private wrapper runs on ports 5336/9336 with a ten-minute outer deadline and owned server/browser cleanup. No production FPS or visual parity is inferred from this functional gate.
