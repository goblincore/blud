# Tracers as gathered lights (lighting P4, small)

**Status:** planned 2026-09-09; one dispatchable task. Base branch
`claude/level-probe-lighting` (the level reads the gather layer there).

**Goal:** Every live tracer (player pellets/slugs and soldier pellets) becomes
a small moving point light in the GPU probe gather's light list, so a round
throws a faint travelling glow on the walls, floor and bodies it passes.
Behind `?tracerlight=0` (bit-identical off: no light packed). Capped so the
gather's 8-light allocation is never exceeded; the brightest-by-proximity
tracers win.

**Architecture:** The gather (`webgpu/probe-gather-compute.ts`, packed each
frame in `game-main.ts` ~L1076–1102 as `gatherLights: DynLightInput[]`)
already takes point lights `{ pos, color, intensity }` (`probe-dynamic.ts`
`DynLightInput`; `packLights` writes `count` then three vec4 per light and is
given `f.lights.slice(0, caps.maxLights)` — `maxLights` is 8 at game-main
~L1841). Bodies read the layer at `probeDynCfg.x`; the level reads it through
`ProbeLightingNode`. Tracers are `Projectile`s (`webgpu/game-weapon.ts`
L117: `pos`, `vel`, `ageSec`, `radius`) living in `pellets` (game-main
~L2984) and `soldierPellets` (~L2996), drawn by `placeTracer` (~L3062).
**Tech Stack:** TypeScript, vitest; no WGSL changes.

## Facts pinned for the implementer

- `pellets` / `soldierPellets` are declared at ~L2984/2996, AFTER the draw
  callback that packs the gather (~L1041–1102) and after an `await` (the gun
  GLTF load ~L2550). A frame CAN render between — the file's `cullCounts`
  comment describes exactly this race — so the gather block must NOT
  reference those consts directly. Use a provider declared next to
  `probeGather` (~L528): `let liveTracers: (() => readonly Projectile[]) | null = null;`
  assigned right after `soldierPellets` is declared:
  `liveTracers = () => [...pellets, ...soldierPellets];`. The gather block
  reads `liveTracers?.() ?? []`.
- The existing lights in order: player flash (if burning), soldier flashes
  in the room, the flashlight beam (a spot). Tracers go LAST and only fill
  the slots left: `8 - gatherLights.length`.
- Room gate: the gather serves one room (`dynRoom`); a tracer outside it
  (use `nearRoom`'s rule with a 1.5 m margin on `p.pos`) is dropped — its
  light would be gathered against the wrong enclosure.
- `probeLastLights = gatherLights.length` (~L1102) is the diagnostic the
  owner reads via `__sdfGame.probeDynamic.gates.lights`; leave it counting
  the total including tracers.
- Colour: the pellet tracer is warm — use `[1.0, 0.78, 0.45]`, the ember's
  hue. Intensity: a tracer is a tiny hot point, far dimmer than a muzzle
  flash (35 at peak, boosted 4x). Start at `tracerLightGain = 2.0` (raw
  intensity per tracer, in the same units as the flash entries) with a
  console seam; the owner tunes by eye. Slugs (radius larger than pellets)
  get `intensity * 2`.

## Tasks

### Task 1: `src/lab/sdf-zombie/tracer-lights.ts` + tests + wiring (dispatchable)

**Files:**
- Create: `src/lab/sdf-zombie/tracer-lights.ts`
- Create: `src/lab/sdf-zombie/tracer-lights.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

- [ ] Export `tracerGatherLights(projectiles: readonly Projectile[], opts: { eye: Vec3; room: { minX, maxX, minZ, maxZ }; margin: number; gain: number; slugRadius: number; cap: number }): DynLightInput[]`
  — pure. Drop projectiles outside the room + margin (x/z only). Sort the
  rest by squared distance to `eye`, ascending, take `cap`. Each becomes
  `{ pos: [...p.pos], color: [1.0, 0.78, 0.45], intensity: gain * (p.radius >= slugRadius ? 2 : 1) }`.
  `cap <= 0` or `gain <= 0` returns `[]` (no allocation). Import `Projectile`
  from `./webgpu/game-weapon` and `DynLightInput`, `Vec3` from
  `./probe-dynamic` / `./ambient` (check the actual export sites).
- [ ] Tests (vitest, same style as `probe-dynamic.test.ts`): empty in → empty
  out; gain 0 → empty; cap 0 → empty; room filter drops an outside pellet
  and keeps one inside the margin; nearest-first ordering with cap 2 keeps
  the two closest; slug doubles intensity; the returned `pos` is a copy (mutating
  the projectile after the call does not change the light).
- [ ] Wire in `game-main.ts`: the `liveTracers` provider (see facts); a
  `tracerLightGain` state next to `probeFlashBoost` (~L532), default 2.0,
  `?tracerlight=0` (or `off`) → 0; in the gather block after the beam entry
  and before `probeLastLights = ...`:
  `const room = 8 - gatherLights.length; if (room > 0 && tracerLightGain > 0) gatherLights.push(...tracerGatherLights(liveTracers?.() ?? [], { eye: player.pos, room: dynRoom, margin: 1.5, gain: tracerLightGain, slugRadius: <the slug radius constant used by fireSlug — find it, do not guess>, cap: room }));`
- [ ] Seam on `__sdfGame` next to `setProbeDynamic` (~L5361):
  `setTracerLight: (gain: number) => { tracerLightGain = Math.max(0, gain); return tracerLightGain; }`
  and `get tracerLight() { return tracerLightGain; }`.
- [ ] Verify: `npx vitest run src/lab/sdf-zombie/tracer-lights.test.ts`,
  `npx tsc --noEmit -p .`, and the full `npx vitest run` (the ONE known red
  is `surface-nets.wgsl.test.ts`, pre-existing — anything else red is yours).
  No GPU check is possible headless; note in the report what the owner
  should look for: fire down a dark corridor with `?levelprobes` default ON,
  a faint moving glow on the walls along the round's path; `__sdfGame.setTracerLight(6)`
  to exaggerate; `__sdfGame.probeDynamic.gates.lights` rises while rounds fly.

### Risks

- Referencing `pellets` from the gather block directly is a boot race
  (facts above). Use the provider.
- Over the 8-light cap the gather silently truncates (`slice`) — the cap
  arithmetic must leave the flashes and the beam in front.
- A tracer light with the beam's spot cone omitted is a point light: leave
  `axis`/`cosInner`/`cosOuter` undefined.
