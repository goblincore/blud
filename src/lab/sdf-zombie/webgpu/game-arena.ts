// src/lab/sdf-zombie/webgpu/game-arena.ts
//
// THE TEST ARENA (owner: "there isn't a proper way for me to see enemies in testing ... should just be a big room with
// one enemy that I can respawn"). `/sdf-game.html?level=arena&spawn=<character>` loads public/assets/levels/arena.level.json:
// one big lit room, one enemy, god mode on (game-loop.ts; `&god=0` lets it hurt), every weapon, infinite ammo. A level opts
// in with `"arena": true` (level-json.ts). In an arena:
//   `   (Backquote) respawns the enemy fresh (rebuildCast: wounds, gore and gibs cleared),
//   -/= steps to the previous / next character in the registry and spawns it,
// and a label at the top of the screen names the enemy and the keys. The keys are rising edges in applyInputEdges
// (game-player-input.ts), like every other key side effect, so a recorded run replays them.
//
// NO FREEZE ON A NEW CHARACTER. A character the session has not drawn yet needs its march pipelines built, and the
// first DRAW builds them synchronously: tens of seconds with a cold shader cache (any edit to the march WGSL empties
// it), with the whole game stopped. So a first visit holds the new enemy out of the draw (arenaPending), compiles its
// meshes with the boot warm-up's own background routine (sdf-layer precompileInBackground), and only then shows it;
// the label says "compiling" meanwhile. A character already drawn this session respawns at once.

import type { GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { arenaCharacters, arenaPending, arenaStep } from './arena-cycle';
import { PRECOMPILE_COLD_PASS_TIMEOUT_MS } from './sdf-layer';
import { rebuildCast } from './game-spawn';

let label: HTMLDivElement | null = null;
/** Characters whose pipelines are built this session (the boot character's by the warm-up). */
const compiled = new Set<string>();
/** Bumped by every respawn, so a compile that a newer press overtook does not reveal its stale cast. */
let generation = 0;
let compiling = false;

function show(ctx: GameContext): void {
  if (!ctx.world.level.def?.arena) return;
  if (!label) {
    label = document.createElement('div');
    // Top centre, just under the row of tuning panels (the bottom of the screen has the HUD and the status line).
    label.setAttribute('style', 'position:fixed; left:50%; transform:translateX(-50%); top:64px; z-index:33; pointer-events:none;'
      + ' font:700 15px/1.4 ui-monospace,Menlo,monospace; color:#f2e6d0; text-shadow:0 2px 0 #000; letter-spacing:.04em; white-space:nowrap;');
    document.body.appendChild(label);
  }
  const name = ctx.boot.spawnOverride ?? 'zombie';
  label.textContent = compiling
    ? `ARENA · compiling ${name}… (first time this session)`
    : `ARENA · ${name} · \` respawn · - / = enemy`;
}

/** Boot: the label, when the level is an arena. */
export function installArena(ctx: GameContext): void {
  if (!ctx.world.level.def?.arena) return;
  compiled.add(ctx.boot.spawnOverride ?? 'zombie');   // the boot warm-up compiles the first cast
  show(ctx);
}

/** Respawn the arena's enemy, stepping `step` characters through the registry first (0 respawns the same one). */
export function arenaRespawn(ctx: GameContext, step: number): void {
  if (!ctx.world.level.def?.arena) return;
  if (step !== 0) ctx.boot.spawnOverride = arenaStep(arenaCharacters(), ctx.boot.spawnOverride ?? 'zombie', step);
  const name = ctx.boot.spawnOverride ?? 'zombie';
  const gen = ++generation;
  arenaPending.clear();
  rebuildCast(ctx);
  if (compiled.has(name) || !ctx.boot.backgroundMode) { compiling = false; show(ctx); return; }
  for (const a of ctx.world.actors) arenaPending.add(a.id);
  compiling = true;
  show(ctx);
  void compileCast(ctx).then(ok => {
    if (gen !== generation) return;   // a newer press owns the cast now
    if (ok) compiled.add(name);
    arenaPending.clear();
    compiling = false;
    show(ctx);
  });
}

/** Every mesh the new cast can draw with, compiled in the background one at a time, each flipped visible only across
 *  its compile's synchronous prologue (the boot's compileCrowdInBackground pattern). A new crowd type stays hidden until
 *  it is built; its members are already out of the draw (arenaPending). */
async function compileCast(ctx: GameContext): Promise<boolean> {
  const { scene, camera } = ctx.boot.handle;
  const objects = new Set<THREE.Object3D>();
  const types = new Set<NonNullable<(typeof ctx.world.actors)[number]['crowd']>['type']>();
  for (const a of ctx.world.actors) {
    for (const o of [a.view.object, a.view.depthPreObject, a.view.refineObject]) if (o) objects.add(o);
    if (a.crowd) types.add(a.crowd.type);
  }
  for (const t of types) {
    objects.add(t.mesh);
    if (t.frontMesh && t.dispatch !== 'quad') objects.add(t.frontMesh);
    t.mesh.visible = false; t.depthPreMesh.visible = false;
    if (t.frontMesh) t.frontMesh.visible = false;
  }
  let ok = true;
  for (const o of objects) {
    const was = o.visible;
    o.visible = true;
    const p = ctx.render.sdfLayer.precompileInBackground(o, scene, camera, { timeoutMs: PRECOMPILE_COLD_PASS_TIMEOUT_MS });
    o.visible = was;
    ok = (await p) && ok;
  }
  for (const t of types) {
    t.mesh.visible = true;
    if (t.frontMesh) t.frontMesh.visible = t.dispatch === 'boxes';
  }
  return ok;
}
