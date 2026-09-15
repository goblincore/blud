// src/lab/sdf-zombie/webgpu/gib-sprites.ts
//
// BILLBOARDED GIB SPRITES — the reference game's own approach.
//
// The owner, after three passes at procedural mesh gore: "generate spritesheets
// based on the rendered SDF and then cut those up randomly and use them in the
// gibs. this makes it more like the original blud source and is easier to reason
// about in a way. sure you trade 3d but its not important in this case tbh", and
// then "the placeholder atlas is fine to see how it feels then we can generate
// our own sheet".
//
// He is right about the reference: Blood's gibs ARE cut-up renders of the enemy,
// and the retired game in this repo already renders them as billboards —
// `src/game/gibs/chunks.ts` spawns a `PlaneGeometry` with an atlas texture,
// `transparent`, `depthWrite: false`, plus a trail and a decal. This module is
// that shape for the active game, minus Rapier (the active game's chunk stepper
// owns the physics and already collides with walls, floors and ceilings).
//
// THE PLACEHOLDER ATLAS IS DEV-ONLY. `public/assets/gibs-placeholder/` is
// gitignored (extracted Blood assets: never commit, never ship), so this path is
// for LOOKING at the approach, and a generated sheet is what would ship. The
// manifest carries each frame's native size, which matters: these are Blood's
// real resolutions — a blood chunk is 24x10, the torso is 10x5 — so at gib scale
// they are aggressively pixelated. That is the authentic read and also the reason
// to render our OWN sheet at a resolution of our choosing.
import * as THREE from 'three/webgpu';

export interface GibSpriteFrame {
  picnum: number;
  texture: THREE.Texture;
  /** Native sprite size in texels — drives the quad's aspect. */
  w: number;
  h: number;
}

export interface GibSpriteAtlas {
  frames: readonly GibSpriteFrame[];
  get(picnum: number): GibSpriteFrame;
  dispose(): void;
}

interface ManifestFrame { picnum: number; file: string; w?: number; h?: number }

/**
 * Load the atlas. `manifestUrl` is like `/assets/gibs-placeholder/manifest.json`.
 * Throws when the manifest or any frame is missing — the caller decides what a
 * missing dev-only asset means, rather than getting a silently empty bench.
 */
export async function loadGibSpriteAtlas(manifestUrl: string): Promise<GibSpriteAtlas> {
  const base = manifestUrl.replace(/\/manifest\.json$/, '/');
  const manifest = await fetch(manifestUrl).then(r => {
    if (!r.ok) throw new Error(`gib atlas manifest ${manifestUrl}: HTTP ${r.status}`);
    return r.json() as Promise<{ frames: ManifestFrame[] }>;
  });
  const loader = new THREE.TextureLoader();
  const frames = await Promise.all(manifest.frames.map(async (f) => {
    const texture = await loader.loadAsync(base + f.file);
    // NEAREST magnification keeps the pixel-art read the sprites were drawn for;
    // mipmaps still help at distance, where the piece is a few pixels across.
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return {
      picnum: f.picnum, texture,
      w: f.w ?? (texture.image as { width?: number })?.width ?? 1,
      h: f.h ?? (texture.image as { height?: number })?.height ?? 1,
    };
  }));
  const byId = new Map(frames.map(f => [f.picnum, f]));
  return {
    frames,
    get: (picnum: number) => byId.get(picnum) ?? frames[0]!,
    dispose: () => { for (const f of frames) f.texture.dispose(); },
  };
}

/**
 * ONE billboarded gib. The quad is sized so the sprite's own aspect is preserved
 * — a leg gib is a long thin rectangle and a head is square, and forcing both
 * into one quad throws away the silhouette that distinguishes them.
 *
 * `transparent` + `depthWrite: false`: these are cut-out sprites with alpha, and
 * a piece writing depth would punch a rectangle-shaped hole in the pieces behind
 * it that its own alpha does not cover. `alphaTest` keeps the fully transparent
 * texels out of the draw entirely, which is what stops the bench from turning
 * into an overdraw test.
 */
export function makeGibSprite(
  frame: GibSpriteFrame, sizeM: number, opacity = 1,
): THREE.Mesh {
  const aspect = frame.h > 0 ? frame.w / frame.h : 1;
  const h = sizeM;
  const w = sizeM * aspect;
  const geo = new THREE.PlaneGeometry(w, h);
  const tex = frame.texture.clone();
  tex.needsUpdate = true;
  const mat = new THREE.MeshBasicNodeMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    opacity,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `gib-sprite-${frame.picnum}`;
  return mesh;
}

/** Face the camera. CPU-side because the pieces are few and the alternative —
 *  a billboard node in the material — would put the quads off the same material
 *  path the rest of the gore uses. */
export function billboardGib(mesh: THREE.Object3D, camera: THREE.Camera): void {
  mesh.quaternion.copy(camera.quaternion);
}

/**
 * Load a GENERATED sheet: one PNG plus a rect manifest, which is what
 * `scripts/gib-sheet.mjs` writes and what can ship (the placeholder atlas is
 * extracted Blood art, gitignored, never commit).
 *
 * Each frame becomes a texture cloned from the sheet with `offset`/`repeat` set
 * to its rect, so N pieces cost ONE upload and the material path is identical to
 * the per-file atlas — the bench, the runtime and the loader do not care which
 * kind they were given.
 *
 * THE UV ORIGIN TRAP: PNG row 0 is the TOP of the image, while three's texture
 * origin is the BOTTOM-left, so a rect's y has to be flipped (`1 - (y + h) / H`)
 * or every piece samples the vertically mirrored region — which looks plausible
 * enough on a symmetric chunk to waste an afternoon on.
 */
export async function loadGibSheet(manifestUrl: string): Promise<GibSpriteAtlas> {
  const base = manifestUrl.replace(/\/[^/]*$/, '/');
  const manifest = await fetch(manifestUrl).then(r => {
    if (!r.ok) throw new Error(`gib sheet manifest ${manifestUrl}: HTTP ${r.status}`);
    return r.json() as Promise<{
      sheet: string;
      sheetSize: [number, number];
      frames: { picnum: number; x: number; y: number; w: number; h: number }[];
    }>;
  });
  const loader = new THREE.TextureLoader();
  const sheet = await loader.loadAsync(base + manifest.sheet);
  const [W, H] = manifest.sheetSize;
  sheet.colorSpace = THREE.SRGBColorSpace;
  sheet.magFilter = THREE.NearestFilter;
  sheet.minFilter = THREE.LinearMipmapLinearFilter;
  sheet.generateMipmaps = true;
  const frames: GibSpriteFrame[] = manifest.frames.map((f) => {
    const t = sheet.clone();
    t.offset.set(f.x / W, 1 - (f.y + f.h) / H);
    t.repeat.set(f.w / W, f.h / H);
    t.needsUpdate = true;
    return { picnum: f.picnum, texture: t, w: f.w, h: f.h };
  });
  const byId = new Map(frames.map(f => [f.picnum, f]));
  return {
    frames,
    get: (picnum: number) => byId.get(picnum) ?? frames[0]!,
    dispose: () => { for (const f of frames) f.texture.dispose(); sheet.dispose(); },
  };
}

/** A blue-noise-free but deterministic pick, so a bench is reproducible. */
export function pickFrame(atlas: GibSpriteAtlas, seed: number): GibSpriteFrame {
  const i = Math.abs(Math.round(seed * 2654435761)) % atlas.frames.length;
  return atlas.frames[i]!;
}
