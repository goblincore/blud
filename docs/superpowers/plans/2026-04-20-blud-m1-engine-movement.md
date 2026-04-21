# Blud — M1 Implementation Plan (Engine & Movement)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a web page where you can walk around a simple 3D test arena with FPS controls, physics-driven collision, jump, and a debug HUD. No enemies, no weapons, no levels — just the engine spine that M2 onward builds on.

**Architecture:** Vite + TypeScript project. Three.js renders the scene; Rapier3D-compat simulates physics with a fixed 60 Hz timestep decoupled from render rate. Pure-logic modules (scheduler, input aggregator, movement math) are unit-tested with Vitest; rendering and physics-visual integration are verified manually against the spec's M1 verification gate. Engine, physics, and game code live in distinct directories with no cross-layer leakage.

**Tech Stack:** TypeScript 5, Vite 5, Three.js ^0.170, @dimforge/rapier3d-compat ^0.14, Vitest ^2, happy-dom (for input tests).

**Reference spec:** `docs/superpowers/specs/2026-04-20-blud-design.md` — especially §3 (rendering), §7 (project structure), §10 (M1 scope), §11 (M1 verification).

---

## File Structure

```
blud/
├── .gitignore
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── public/
├── src/
│   ├── main.ts                   # entry: async boot, wires everything
│   ├── engine/
│   │   ├── renderer.ts           # Three.js renderer + scene + camera setup
│   │   ├── loop.ts               # fixed-timestep scheduler (pure)
│   │   ├── loop.test.ts
│   │   ├── input.ts              # keyboard/mouse state aggregator + DOM wiring
│   │   └── input.test.ts
│   ├── physics/
│   │   └── world.ts              # Rapier world bootstrap + step
│   ├── game/
│   │   ├── arena.ts              # test arena geometry + static colliders
│   │   ├── player.ts             # character controller + camera mount
│   │   ├── player-motion.ts      # pure movement math
│   │   └── player-motion.test.ts
│   └── ui/
│       └── debug-hud.ts          # DOM overlay: fps, position
└── docs/
    └── superpowers/{specs,plans}/
```

**Unit boundaries:**
- `engine/*` knows nothing about gameplay — renders a given scene, runs a loop, reports input.
- `physics/*` owns Rapier world lifetime. Exposes `step(dt)` and access to `RAPIER.World`.
- `game/*` is gameplay. For M1 that's `arena` (geometry + static colliders) and `player` (character controller + camera).
- Pure functions (`loop`, `input` aggregator, `player-motion`) are TDD'd. Rendering/physics integration is manual-verified — graphics unit tests are low-value vs the time they cost.

---

## Tasks

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `.gitignore`
- Create: `index.html`
- Create: `src/main.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "blud",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@dimforge/rapier3d-compat": "^0.14.0",
    "three": "^0.170.0"
  },
  "devDependencies": {
    "@types/three": "^0.170.0",
    "happy-dom": "^15.0.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'happy-dom',
  },
});
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
.DS_Store
*.log
.superpowers/
.vite/
```

- [ ] **Step 5: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Blud</title>
    <style>
      html, body { margin: 0; padding: 0; overflow: hidden; background: #111; color: #eee;
        font-family: ui-monospace, monospace; }
      #app { position: fixed; inset: 0; }
      #hud { position: fixed; top: 8px; left: 8px; pointer-events: none;
        font-size: 12px; line-height: 1.4; text-shadow: 0 1px 0 #000; }
      #prompt { position: fixed; inset: 0; display: flex; align-items: center;
        justify-content: center; pointer-events: none; font-size: 14px; }
      #prompt.hidden { display: none; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <div id="hud"></div>
    <div id="prompt">click to play</div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Write minimal `src/main.ts` placeholder**

```ts
console.log('[blud] boot');
```

- [ ] **Step 7: Install deps**

Run: `npm install`
Expected: packages install without error. `node_modules/` and `package-lock.json` appear.

- [ ] **Step 8: Verify dev server boots**

Run: `npm run dev`
Expected: Vite prints a `Local:` URL. Open it — page shows "click to play" over a dark background. Browser console logs `[blud] boot`. Kill the server (Ctrl-C).

- [ ] **Step 9: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.json vite.config.ts index.html src/main.ts
git commit -m "scaffold vite + ts project"
```

---

### Task 2: Render a scene

**Files:**
- Create: `src/engine/renderer.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/engine/renderer.ts`**

```ts
import * as THREE from 'three';

export interface RendererHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  setRenderCallback(cb: (dtSec: number) => void): void;
}

export function createRenderer(mount: HTMLElement): RendererHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x1a1116);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a1116, 10, 60);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  );
  camera.position.set(0, 1.7, 6);

  const sun = new THREE.DirectionalLight(0xffeccd, 1.1);
  sun.position.set(4, 10, 6);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x4a3a40, 0.6));

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  let lastTime = performance.now();
  let cb: (dtSec: number) => void = () => {};
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    cb(dt);
    renderer.render(scene, camera);
  });

  return {
    renderer,
    scene,
    camera,
    canvas: renderer.domElement,
    setRenderCallback(fn) { cb = fn; },
  };
}
```

- [ ] **Step 2: Replace `src/main.ts`**

```ts
import * as THREE from 'three';
import { createRenderer } from './engine/renderer';

const mount = document.getElementById('app')!;
const { scene } = createRenderer(mount);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x3a2a2a }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

console.log('[blud] boot');
```

- [ ] **Step 3: Manual verify**

Run: `npm run dev`
Expected: open URL in browser → a dirty-red plane visible receding into fog against a dark background. Resizing the window reflows correctly.

- [ ] **Step 4: Commit**

```bash
git add src/engine/renderer.ts src/main.ts
git commit -m "render a ground plane"
```

---

### Task 3: Fixed-timestep scheduler (TDD)

**Files:**
- Create: `src/engine/loop.ts`
- Create: `src/engine/loop.test.ts`

- [ ] **Step 1: Write the failing tests at `src/engine/loop.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createScheduler } from './loop';

describe('createScheduler', () => {
  it('fires one step when exactly one step of time passes', () => {
    const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
    const step = vi.fn();
    const n = scheduler.tick(1 / 60, step);
    expect(n).toBe(1);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('fires zero steps when less than one step passes', () => {
    const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
    const step = vi.fn();
    const n = scheduler.tick(1 / 120, step);
    expect(n).toBe(0);
    expect(step).toHaveBeenCalledTimes(0);
  });

  it('preserves the accumulator across ticks', () => {
    const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
    const step = vi.fn();
    scheduler.tick(1 / 120, step);
    const n = scheduler.tick(1 / 120, step);
    expect(n).toBe(1);
  });

  it('fires multiple steps when multiple steps of time pass', () => {
    const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
    const step = vi.fn();
    const n = scheduler.tick((1 / 60) * 3, step);
    expect(n).toBe(3);
  });

  it('caps the number of steps per tick to avoid spiral of death', () => {
    const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
    const step = vi.fn();
    const n = scheduler.tick((1 / 60) * 100, step);
    expect(n).toBe(5);
  });

  it('passes the fixed step duration to the callback', () => {
    const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
    const step = vi.fn();
    scheduler.tick(1 / 60, step);
    expect(step).toHaveBeenCalledWith(1 / 60);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm run test -- loop`
Expected: FAIL — `Cannot find module './loop'` (module does not exist yet).

- [ ] **Step 3: Implement `src/engine/loop.ts`**

```ts
export interface SchedulerOptions {
  stepSec: number;
  maxStepsPerTick: number;
}

export interface Scheduler {
  tick(realDtSec: number, step: (stepDtSec: number) => void): number;
}

export function createScheduler(opts: SchedulerOptions): Scheduler {
  let accumulator = 0;
  return {
    tick(realDtSec, step) {
      accumulator += realDtSec;
      let fired = 0;
      while (accumulator >= opts.stepSec && fired < opts.maxStepsPerTick) {
        step(opts.stepSec);
        accumulator -= opts.stepSec;
        fired++;
      }
      if (fired >= opts.maxStepsPerTick) {
        accumulator = 0;
      }
      return fired;
    },
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npm run test -- loop`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/engine/loop.ts src/engine/loop.test.ts
git commit -m "add fixed-timestep scheduler"
```

---

### Task 4: Wire scheduler into render loop

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Update `src/main.ts` to use the scheduler**

```ts
import * as THREE from 'three';
import { createRenderer } from './engine/renderer';
import { createScheduler } from './engine/loop';

const mount = document.getElementById('app')!;
const { scene, setRenderCallback } = createRenderer(mount);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x3a2a2a }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });

function fixedStep(_dt: number) {
  // placeholder for physics/game step
}

setRenderCallback((realDt) => {
  scheduler.tick(realDt, fixedStep);
});

console.log('[blud] boot');
```

- [ ] **Step 2: Manual verify**

Run: `npm run dev`
Expected: scene still renders. Temporarily add `console.log('step')` inside `fixedStep`, reload, confirm ~60 logs/sec in console, remove the log.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "wire fixed-step scheduler into render loop"
```

---

### Task 5: Keyboard/mouse input aggregator (TDD)

**Files:**
- Create: `src/engine/input.ts`
- Create: `src/engine/input.test.ts`

- [ ] **Step 1: Write failing tests at `src/engine/input.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createInputState } from './input';

describe('createInputState', () => {
  it('reports isDown as false by default', () => {
    const s = createInputState();
    expect(s.isDown('KeyW')).toBe(false);
  });

  it('tracks keydown and keyup', () => {
    const s = createInputState();
    s.onKeyDown('KeyW');
    expect(s.isDown('KeyW')).toBe(true);
    s.onKeyUp('KeyW');
    expect(s.isDown('KeyW')).toBe(false);
  });

  it('accumulates mouse delta and consumes it atomically', () => {
    const s = createInputState();
    s.addMouseDelta(3, -2);
    s.addMouseDelta(1, 1);
    const delta = s.consumeMouseDelta();
    expect(delta).toEqual({ dx: 4, dy: -1 });
    expect(s.consumeMouseDelta()).toEqual({ dx: 0, dy: 0 });
  });

  it('reports justPressed for a single frame after a keydown', () => {
    const s = createInputState();
    s.onKeyDown('Space');
    expect(s.justPressed('Space')).toBe(true);
    expect(s.justPressed('Space')).toBe(false);
  });

  it('justPressed resets on keyup and re-arms on next keydown', () => {
    const s = createInputState();
    s.onKeyDown('Space');
    s.justPressed('Space');
    s.onKeyUp('Space');
    s.onKeyDown('Space');
    expect(s.justPressed('Space')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm run test -- input`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/engine/input.ts`**

```ts
export interface InputState {
  onKeyDown(code: string): void;
  onKeyUp(code: string): void;
  isDown(code: string): boolean;
  justPressed(code: string): boolean;
  addMouseDelta(dx: number, dy: number): void;
  consumeMouseDelta(): { dx: number; dy: number };
}

export function createInputState(): InputState {
  const down = new Set<string>();
  const freshPress = new Set<string>();
  let mx = 0;
  let my = 0;
  return {
    onKeyDown(code) {
      if (!down.has(code)) {
        down.add(code);
        freshPress.add(code);
      }
    },
    onKeyUp(code) {
      down.delete(code);
      freshPress.delete(code);
    },
    isDown(code) { return down.has(code); },
    justPressed(code) {
      if (freshPress.has(code)) {
        freshPress.delete(code);
        return true;
      }
      return false;
    },
    addMouseDelta(dx, dy) { mx += dx; my += dy; },
    consumeMouseDelta() {
      const r = { dx: mx, dy: my };
      mx = 0; my = 0;
      return r;
    },
  };
}

export interface InputAttachment {
  detach(): void;
  isLocked(): boolean;
}

export function attachInput(canvas: HTMLCanvasElement, state: InputState): InputAttachment {
  let locked = false;

  const onKeyDown = (e: KeyboardEvent) => state.onKeyDown(e.code);
  const onKeyUp = (e: KeyboardEvent) => state.onKeyUp(e.code);
  const onClick = () => {
    if (!locked) canvas.requestPointerLock();
  };
  const onLockChange = () => {
    locked = document.pointerLockElement === canvas;
    const prompt = document.getElementById('prompt');
    if (prompt) prompt.classList.toggle('hidden', locked);
  };
  const onMouseMove = (e: MouseEvent) => {
    if (locked) state.addMouseDelta(e.movementX, e.movementY);
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('click', onClick);
  document.addEventListener('pointerlockchange', onLockChange);
  window.addEventListener('mousemove', onMouseMove);

  return {
    detach() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('pointerlockchange', onLockChange);
      window.removeEventListener('mousemove', onMouseMove);
    },
    isLocked() { return locked; },
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npm run test -- input`
Expected: PASS (5/5).

- [ ] **Step 5: Wire it into `src/main.ts`**

```ts
import * as THREE from 'three';
import { createRenderer } from './engine/renderer';
import { createScheduler } from './engine/loop';
import { createInputState, attachInput } from './engine/input';

const mount = document.getElementById('app')!;
const { scene, canvas, setRenderCallback } = createRenderer(mount);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x3a2a2a }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const input = createInputState();
attachInput(canvas, input);

const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });

function fixedStep(_dt: number) {}

setRenderCallback((realDt) => scheduler.tick(realDt, fixedStep));

console.log('[blud] boot');
```

- [ ] **Step 6: Manual verify**

Run: `npm run dev`
Expected: page still renders. Click the canvas → "click to play" prompt disappears, pointer locks. Pressing Escape releases it and the prompt returns.

- [ ] **Step 7: Commit**

```bash
git add src/engine/input.ts src/engine/input.test.ts src/main.ts
git commit -m "add input aggregator + pointer-lock attachment"
```

---

### Task 6: Rapier world bootstrap

**Files:**
- Create: `src/physics/world.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/physics/world.ts`**

```ts
import RAPIER from '@dimforge/rapier3d-compat';

export interface PhysicsWorld {
  rapier: typeof RAPIER;
  world: RAPIER.World;
  step(dtSec: number): void;
}

export async function initPhysics(): Promise<PhysicsWorld> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -25, z: 0 });
  world.timestep = 1 / 60;

  return {
    rapier: RAPIER,
    world,
    step(_dtSec: number) {
      world.step();
    },
  };
}
```

Note: gravity of y=-25 m/s² is intentionally stronger than Earth's -9.81. FPS platformers feel sluggish with real gravity; shooters like Quake/Blood historically use ~2-3× Earth gravity. Tune in M3.

- [ ] **Step 2: Update `src/main.ts` to await physics init**

```ts
import * as THREE from 'three';
import { createRenderer } from './engine/renderer';
import { createScheduler } from './engine/loop';
import { createInputState, attachInput } from './engine/input';
import { initPhysics } from './physics/world';

async function main() {
  const mount = document.getElementById('app')!;
  const { scene, canvas, setRenderCallback } = createRenderer(mount);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x3a2a2a }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const physics = await initPhysics();
  console.log('[blud] physics ready');

  const input = createInputState();
  attachInput(canvas, input);

  const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
  function fixedStep(dt: number) {
    physics.step(dt);
  }

  setRenderCallback((realDt) => scheduler.tick(realDt, fixedStep));

  console.log('[blud] boot');
}

main().catch((err) => {
  console.error('[blud] boot failed', err);
});
```

- [ ] **Step 3: Manual verify**

Run: `npm run dev`
Expected: page loads, console shows `[blud] physics ready` before `[blud] boot`. No errors.

- [ ] **Step 4: Commit**

```bash
git add src/physics/world.ts src/main.ts
git commit -m "bootstrap rapier3d physics world"
```

---

### Task 7: Test arena geometry + static colliders

**Files:**
- Create: `src/game/arena.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/game/arena.ts`**

```ts
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export function buildArena(scene: THREE.Scene, world: RAPIER.World): void {
  const floorSize = 40;
  const wallHeight = 4;
  const wallThick = 0.5;

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a2a });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x5a3a36 });
  const obstacleMat = new THREE.MeshStandardMaterial({ color: 0x7a4a2a });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(floorSize, 0.5, floorSize), floorMat);
  floor.position.y = -0.25;
  scene.add(floor);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(floorSize / 2, 0.25, floorSize / 2)
      .setTranslation(0, -0.25, 0),
  );

  const walls: Array<[number, number, number, number, number, number]> = [
    [floorSize + wallThick, wallHeight, wallThick, 0, wallHeight / 2, -floorSize / 2],
    [floorSize + wallThick, wallHeight, wallThick, 0, wallHeight / 2,  floorSize / 2],
    [wallThick, wallHeight, floorSize + wallThick, -floorSize / 2, wallHeight / 2, 0],
    [wallThick, wallHeight, floorSize + wallThick,  floorSize / 2, wallHeight / 2, 0],
  ];
  for (const [sx, sy, sz, px, py, pz] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMat);
    m.position.set(px, py, pz);
    scene.add(m);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(px, py, pz),
    );
  }

  const obstacles: Array<[number, number, number, number, number, number]> = [
    [2, 1, 2, -4, 0.5, -3],
    [3, 2, 1, 5, 1, 2],
    [1, 0.5, 4, -6, 0.25, 4],
  ];
  for (const [sx, sy, sz, px, py, pz] of obstacles) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), obstacleMat);
    m.position.set(px, py, pz);
    scene.add(m);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(px, py, pz),
    );
  }
}
```

- [ ] **Step 2: Update `src/main.ts` to use the arena (drop the placeholder ground)**

```ts
import { createRenderer } from './engine/renderer';
import { createScheduler } from './engine/loop';
import { createInputState, attachInput } from './engine/input';
import { initPhysics } from './physics/world';
import { buildArena } from './game/arena';

async function main() {
  const mount = document.getElementById('app')!;
  const { scene, canvas, setRenderCallback } = createRenderer(mount);

  const physics = await initPhysics();
  buildArena(scene, physics.world);

  const input = createInputState();
  attachInput(canvas, input);

  const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
  function fixedStep(dt: number) {
    physics.step(dt);
  }

  setRenderCallback((realDt) => scheduler.tick(realDt, fixedStep));

  console.log('[blud] boot');
}

main().catch((err) => console.error('[blud] boot failed', err));
```

- [ ] **Step 3: Manual verify**

Run: `npm run dev`
Expected: arena visible — floor, four enclosing walls, three obstacles of varying size. No errors.

- [ ] **Step 4: Commit**

```bash
git add src/game/arena.ts src/main.ts
git commit -m "build static test arena with matching colliders"
```

---

### Task 8: Pure player movement math (TDD)

**Files:**
- Create: `src/game/player-motion.ts`
- Create: `src/game/player-motion.test.ts`

- [ ] **Step 1: Write failing tests at `src/game/player-motion.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { movementDirection } from './player-motion';

const EPS = 1e-6;
function near(a: number, b: number) {
  expect(Math.abs(a - b)).toBeLessThan(EPS);
}

describe('movementDirection', () => {
  it('returns zero vector for no input', () => {
    const v = movementDirection({ forward: false, back: false, left: false, right: false }, 0);
    expect(v).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('maps forward at yaw=0 to -Z', () => {
    const v = movementDirection({ forward: true, back: false, left: false, right: false }, 0);
    near(v.x, 0); near(v.y, 0); near(v.z, -1);
  });

  it('maps back at yaw=0 to +Z', () => {
    const v = movementDirection({ forward: false, back: true, left: false, right: false }, 0);
    near(v.x, 0); near(v.z, 1);
  });

  it('maps left at yaw=0 to -X', () => {
    const v = movementDirection({ forward: false, back: false, left: true, right: false }, 0);
    near(v.x, -1); near(v.z, 0);
  });

  it('maps right at yaw=0 to +X', () => {
    const v = movementDirection({ forward: false, back: false, left: false, right: true }, 0);
    near(v.x, 1); near(v.z, 0);
  });

  it('normalizes forward+right to unit length', () => {
    const v = movementDirection({ forward: true, back: false, left: false, right: true }, 0);
    const len = Math.hypot(v.x, v.z);
    near(len, 1);
  });

  it('cancels opposing inputs', () => {
    const v = movementDirection({ forward: true, back: true, left: true, right: true }, 0);
    expect(v).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('rotates by yaw: forward at yaw=π/2 points to -X', () => {
    const v = movementDirection({ forward: true, back: false, left: false, right: false }, Math.PI / 2);
    near(v.x, -1); near(v.z, 0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm run test -- player-motion`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/game/player-motion.ts`**

```ts
export interface MovementInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

export interface Vec3 { x: number; y: number; z: number; }

export function movementDirection(input: MovementInput, yawRad: number): Vec3 {
  const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
  const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (fwd === 0 && strafe === 0) return { x: 0, y: 0, z: 0 };

  // local-space: +X right, -Z forward (Three.js convention for default camera)
  const lx = strafe;
  const lz = -fwd;
  const len = Math.hypot(lx, lz);
  const nx = lx / len;
  const nz = lz / len;

  // rotate around Y by yawRad. yaw=0 keeps local axes; yaw=π/2 rotates the
  // local forward (-Z) to world -X.
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);
  return {
    x: nx * cos + nz * sin,
    y: 0,
    z: -nx * sin + nz * cos,
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npm run test -- player-motion`
Expected: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
git add src/game/player-motion.ts src/game/player-motion.test.ts
git commit -m "add pure player movement direction math"
```

---

### Task 9: Player — kinematic character controller

**Files:**
- Create: `src/game/player.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/game/player.ts`**

```ts
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { InputState } from '../engine/input';
import { movementDirection } from './player-motion';

export interface Player {
  update(dtSec: number, input: InputState): void;
  position(): THREE.Vector3;
}

export interface PlayerOptions {
  world: RAPIER.World;
  camera: THREE.PerspectiveCamera;
  spawn: THREE.Vector3Like;
}

const WALK_SPEED = 6;
const RUN_SPEED = 9;
const JUMP_VELOCITY = 8.5;
const MOUSE_SENSITIVITY = 0.0022;
const EYE_HEIGHT = 1.55;
const BODY_RADIUS = 0.3;
const BODY_HALF_HEIGHT = 0.7; // total capsule height = 2*(radius + halfHeight) = 2

export function createPlayer(opts: PlayerOptions): Player {
  const { world, camera, spawn } = opts;

  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(spawn.x, spawn.y, spawn.z);
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.capsule(BODY_HALF_HEIGHT, BODY_RADIUS);
  world.createCollider(colliderDesc, body);

  const controller = world.createCharacterController(0.02);
  controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
  controller.setApplyImpulsesToDynamicBodies(true);
  controller.enableAutostep(0.3, 0.2, true);
  controller.enableSnapToGround(0.3);

  let yaw = 0;
  let pitch = 0;
  let verticalVel = 0;
  const GRAVITY = 25;
  const PITCH_LIMIT = Math.PI / 2 - 0.05;

  function update(dtSec: number, input: InputState) {
    const { dx, dy } = input.consumeMouseDelta();
    yaw -= dx * MOUSE_SENSITIVITY;
    pitch -= dy * MOUSE_SENSITIVITY;
    if (pitch > PITCH_LIMIT) pitch = PITCH_LIMIT;
    if (pitch < -PITCH_LIMIT) pitch = -PITCH_LIMIT;

    const movement = {
      forward: input.isDown('KeyW'),
      back: input.isDown('KeyS'),
      left: input.isDown('KeyA'),
      right: input.isDown('KeyD'),
    };
    const dir = movementDirection(movement, yaw);
    const sprinting = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const speed = sprinting ? RUN_SPEED : WALK_SPEED;

    const grounded = controller.computedGrounded();
    if (grounded && verticalVel < 0) verticalVel = 0;
    if (grounded && input.justPressed('Space')) verticalVel = JUMP_VELOCITY;
    verticalVel -= GRAVITY * dtSec;

    const desired = {
      x: dir.x * speed * dtSec,
      y: verticalVel * dtSec,
      z: dir.z * speed * dtSec,
    };

    const collider = body.collider(0);
    controller.computeColliderMovement(collider, desired);
    const applied = controller.computedMovement();
    const pos = body.translation();
    body.setNextKinematicTranslation({
      x: pos.x + applied.x,
      y: pos.y + applied.y,
      z: pos.z + applied.z,
    });

    const newPos = {
      x: pos.x + applied.x,
      y: pos.y + applied.y,
      z: pos.z + applied.z,
    };
    camera.position.set(newPos.x, newPos.y + EYE_HEIGHT, newPos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch, yaw, 0);
  }

  function position() {
    const p = body.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  return { update, position };
}
```

- [ ] **Step 2: Update `src/main.ts` to spawn the player**

```ts
import * as THREE from 'three';
import { createRenderer } from './engine/renderer';
import { createScheduler } from './engine/loop';
import { createInputState, attachInput } from './engine/input';
import { initPhysics } from './physics/world';
import { buildArena } from './game/arena';
import { createPlayer } from './game/player';

async function main() {
  const mount = document.getElementById('app')!;
  const { scene, camera, canvas, setRenderCallback } = createRenderer(mount);

  const physics = await initPhysics();
  buildArena(scene, physics.world);

  const input = createInputState();
  attachInput(canvas, input);

  const player = createPlayer({
    world: physics.world,
    camera,
    spawn: new THREE.Vector3(0, 2, 0),
  });

  const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
  function fixedStep(dt: number) {
    physics.step(dt);
    player.update(dt, input);
  }

  setRenderCallback((realDt) => scheduler.tick(realDt, fixedStep));

  console.log('[blud] boot');
}

main().catch((err) => console.error('[blud] boot failed', err));
```

- [ ] **Step 3: Manual verify**

Run: `npm run dev`
- Click canvas → pointer lock engages, "click to play" disappears.
- Mouse moves camera left/right (yaw) and up/down (pitch), pitch clamps at ~90°.
- WASD walks; diagonal movement isn't faster than cardinal.
- Left-Shift sprints.
- Cannot walk through walls or obstacles; slides along them naturally.
- Can walk up onto the smaller obstacle (auto-step).
- Spacebar jumps once while grounded; cannot double-jump; falls back to floor.
- Escape releases pointer lock.

- [ ] **Step 4: Commit**

```bash
git add src/game/player.ts src/main.ts
git commit -m "add player: kinematic character controller + mouse-look + jump"
```

---

### Task 10: Debug HUD

**Files:**
- Create: `src/ui/debug-hud.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/ui/debug-hud.ts`**

```ts
export interface DebugHud {
  update(realDtSec: number, pos: { x: number; y: number; z: number }): void;
}

export function createDebugHud(el: HTMLElement): DebugHud {
  let sampleAccum = 0;
  let sampleCount = 0;
  let lastFps = 0;
  const SAMPLE_WINDOW_SEC = 0.5;

  return {
    update(realDtSec, pos) {
      sampleAccum += realDtSec;
      sampleCount += 1;
      if (sampleAccum >= SAMPLE_WINDOW_SEC) {
        lastFps = sampleCount / sampleAccum;
        sampleAccum = 0;
        sampleCount = 0;
      }
      el.textContent =
        `fps ${lastFps.toFixed(0).padStart(3)}  ` +
        `pos ${pos.x.toFixed(2)} ${pos.y.toFixed(2)} ${pos.z.toFixed(2)}`;
    },
  };
}
```

- [ ] **Step 2: Wire the HUD into `src/main.ts`**

Add the import and two lines:

```ts
import { createDebugHud } from './ui/debug-hud';
```

Inside `main()` after `attachInput(...)`:

```ts
  const hud = createDebugHud(document.getElementById('hud')!);
```

Replace the `setRenderCallback` line with:

```ts
  setRenderCallback((realDt) => {
    scheduler.tick(realDt, fixedStep);
    hud.update(realDt, player.position());
  });
```

- [ ] **Step 3: Manual verify**

Run: `npm run dev`
Expected: top-left shows `fps 60 pos X.XX Y.YY Z.ZZ`, updating smoothly. FPS stays near monitor refresh; position changes as you walk.

- [ ] **Step 4: Commit**

```bash
git add src/ui/debug-hud.ts src/main.ts
git commit -m "add debug hud (fps + position)"
```

---

### Task 11: M1 verification & final sanity pass

**Files:**
- *(no code changes — verification only)*

- [ ] **Step 1: Run unit tests**

Run: `npm run test`
Expected: all tests across `loop`, `input`, `player-motion` pass. Count should be in the high teens.

- [ ] **Step 2: Run a production build**

Run: `npm run build`
Expected: type-check passes; Vite emits `dist/` with hashed JS + HTML. No errors.

- [ ] **Step 3: Preview the build**

Run: `npm run preview`
Expected: same behaviour as dev — arena walkable, jump works, HUD present.

- [ ] **Step 4: Verification checklist (spec §11 M1)**

Confirm each:
- FPS camera moves via mouse-look (yaw + pitch, pitch clamped).
- WASD walk responds immediately, diagonal movement is not faster.
- Shift sprints.
- Collision with walls and obstacles is solid (no tunneling at walk or sprint speed).
- Space jumps exactly once per press; cannot double-jump.
- Gravity pulls the player down after stepping off an obstacle.
- Rapier steps at fixed 60 Hz regardless of render rate (can verify by temporarily capping `setAnimationLoop` to 30 fps via throttling and confirming physics still feels normal — optional, skip if not easy).
- HUD shows plausible FPS + position.

- [ ] **Step 5: Commit a "close M1" marker**

```bash
git commit --allow-empty -m "m1: engine & movement verified"
```

- [ ] **Step 6: Note follow-ups for M2**

Open `docs/superpowers/specs/2026-04-20-blud-design.md` and confirm M2 ("First kill") is the next plan target. The M2 plan will depend on:
- A way to spawn a sprite billboard (placeholder enemy).
- A voxel gib MVP — probably `.vox` loader + instanced-mesh per chunk.
- A revolver: projectile or hitscan + impact.
- The `tuning-sources.md` doc the background agent produced (for HP/damage starting values).

No code yet — these are for the M2 plan.

---

## Deferred / non-goals for M1 (explicit)

Do **not** add in M1. They belong to later milestones:

- Enemies, weapons, projectiles, gibs.
- Sprite pipeline, voxel loader, clay shader.
- Level chunks or run structure.
- Audio (engine, SFX, music).
- Menus, settings, save state.
- Controller support.
- Post-processing (dither, chromatic aberration, pixelation).

---

## Open items surfaced during planning

1. **Three.js version:** plan assumes ^0.170. If the latest is newer, use it — the APIs used here (`WebGLRenderer`, `PerspectiveCamera`, `Scene`, `setAnimationLoop`, `MeshStandardMaterial`) have been stable for years.
2. **Rapier mouse wheel / scroll:** we don't wire scroll input here. When weapons land we'll add weapon-switch scroll in the M3 plan.
3. **Fullscreen:** not included. Pointer lock alone is enough for M1.
4. **Mobile / touch:** deliberately unsupported in M1 and likely entirely.
