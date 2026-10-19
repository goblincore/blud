// src/lab/sdf-zombie/webgpu/screen-pass.ts
//
// THE SCREEN PASS, shared by the lab page (screen-lab-main.ts) and the game (plan 2026-10-16-emergence-in-the-flat.md Task 2): the march
// (screen-emergence.wgsl.ts) on a proxy box in THE SCREEN'S frame (origin at the glass centre, +x right, +y up, +z out of the glass toward
// the room, metres; emergence-field.ts), drawn in the SDF layer's late scene with its own depth. `createScreenPass(pictureTex, opts)` builds
// the proxy and its material; `updateScreenPass(pass, t, cfg)` is the per-frame update: the timeline's parameters at `t` (paramsAt), the
// field's derived values (the egg centre, the lip opening, the tear's tip, the sac's extent), the picture table, the goo (goo-strands.ts
// gooAt(t), cached per t, from GOO_FROM on) and the time. The keyboard, its coat and the board the slick lies on are the field's constants
// in the screen frame, baked into the WGSL: a set built in the screen frame (as the lab page's and the game's are) needs nothing more about
// them; the one thing about the set the pass takes is its lamp (`opts.lampBulb`, in the screen frame, and its strength).
//
// The host places the proxy: copy the screen group's world position and rotation onto `pass.proxy` (unscaled: the march's depth assumes
// the local frame has the world's scale) and add it to the SDF layer's late scene.
import * as THREE from 'three/webgpu';
import {
  cameraPosition, cameraProjectionMatrix, cameraViewMatrix, float, floor, modelWorldMatrixInverse, normalize, positionLocal, positionWorld,
  texture, uniform, vec4, wgslFn,
} from 'three/tsl';
import { GLASS, PICTURE_TABLE_N, eggCentre, lipOpening, pictureTable, sacExtent, smooth, tearTip } from './emergence-field';
import {
  DEPTH_Q, GOO_K, SCREEN_PROXY, SCR_CAPSULE, SCR_ELLIPSOID, SCR_GOO, SCR_LIGHT, SCR_LIP, SCR_MAP, SCR_MARCH, SCR_NORMAL, SCR_OPENING,
  SCR_PICTURE, SCR_POOL, SCR_POOL_SHADE, SCR_ROUNDCONE, SCR_ROUNDRECT, SCR_SAC, SCR_SHADE, SCR_SHADOW, SCR_SHEET, SCR_SMAX, SCR_SMIN, SCR_SURFACE,
  SCR_TEAR, SCR_VEINS, SCR_WRINKLE, SCR_WRINKLE_PAT, SCR_GAUSS, SCR_FIGURE, SCR_FIG_TAU, SCR_SPOTS, SCR_SHELL, SCR_EGG_INNER, SCR_GOO_SHADE,
  SCR_GOO_EGG_L, SCR_COAT, SCR_COAT_H, SCR_CAPILLARY, SCR_FLESH, SCR_LIP_PULSE,
} from './screen-emergence.wgsl';
import { GOO_BOUND0, GOO_TEXELS, gooAt, gooTexels } from './goo-strands';
import { paramsAt } from './emergence-timeline';
import type { Vec3 } from '../types';

type Include = NonNullable<Parameters<typeof wgslFn>[1]>[number];
/** The goo exists from the tear's first strand (7.2 s); before this the pass uploads nothing and never runs the sim. */
export const GOO_FROM = 7;
/** The lab set's lamp strength in the pass (the set's PointLight is 1.6 at the bulb; the pass's falloff is its own, tuned by eye). */
export const PASS_LAMP = 1.4;

/** What the pass needs about the set it sits in. */
export interface ScreenPassOptions {
  /** The lamp's bulb, in the screen frame: the pass's key light on the egg, the goo, the sheet and the slick. */
  lampBulb: Vec3;
  /** The lamp's strength in the pass (default PASS_LAMP). */
  lampStrength?: number;
}

/** The per-frame inputs besides the clock: the camera the pass is drawn with, and the switches the lab page toggles. */
export interface ScreenPassFrame {
  /** The camera drawing the pass: its vertical fov (degrees) sizes the march's pixel footprint. */
  camera: { fov: number };
  /** The drawing buffer's height in pixels (the footprint's other half). */
  heightPx: number;
  /** The march's debug view (steps red, hit green, material blue); default off. */
  debug?: boolean;
  /** The egg's light's hard shadow (scrShadow) on the goo, the sheet and the slick; default on. */
  gooShadow?: boolean;
  /** The goo at all (off: nothing uploaded, the bound empty, so its cost can be read); default on. */
  goo?: boolean;
}

export interface ScreenPass {
  /** The proxy box (its geometry in the screen frame) carrying the pass's material: the host places it as the screen and adds it to the
   *  SDF layer's late scene. */
  readonly proxy: THREE.Mesh;
}

/** The pass's per-frame state, kept off the public handle. */
const updaters = new WeakMap<ScreenPass, (t: number, cfg: ScreenPassFrame) => void>();

/** The proxy box and its material. The box's geometry is built in the screen frame (its local space IS the screen's), so the mesh only has
 *  to copy the screen group's place; the march runs in local space (modelWorldMatrixInverse brings the eye in), so the CRT may turn. Back
 *  faces, so the eye may be inside the box (the close shots are). Premultiplied blending (three multiplies the straight colour by alpha),
 *  and the first hit's REAL depth through depthNode, so the goblin, the desk and the CRT housing occlude it and are occluded by it. */
export function createScreenPass(pictureTex: THREE.Texture, opts: ScreenPassOptions): ScreenPass {
  const fn = (src: string, deps: ReturnType<typeof wgslFn>[] = []) => wgslFn(src, deps.map(x => x as unknown as Include));
  const smaxF = fn(SCR_SMAX), sminF = fn(SCR_SMIN);
  const wrinkleF = fn(SCR_WRINKLE, [fn(SCR_WRINKLE_PAT)]);
  const sacF = fn(SCR_SAC, [smaxF, wrinkleF]);
  const ellipsoidF = fn(SCR_ELLIPSOID);
  const roundRectF = fn(SCR_ROUNDRECT);
  const openingF = fn(SCR_OPENING, [roundRectF]);
  const lipPulseF = fn(SCR_LIP_PULSE);
  const lipF = fn(SCR_LIP, [openingF, lipPulseF]);
  const tearF = fn(SCR_TEAR);
  const capsuleF = fn(SCR_CAPSULE), roundConeF = fn(SCR_ROUNDCONE);
  const gooF = fn(SCR_GOO, [capsuleF, roundConeF, sminF]);
  const mapF = fn(SCR_MAP, [sacF, openingF, lipF, ellipsoidF, sminF, smaxF, tearF, gooF]);
  const normalF = fn(SCR_NORMAL, [mapF]);
  const marchF = fn(SCR_MARCH, [mapF]);
  const veinsF = fn(SCR_VEINS);
  const capillaryF = fn(SCR_CAPILLARY);
  const gooEggLF = fn(SCR_GOO_EGG_L);
  const coatHF = fn(SCR_COAT_H);
  const coatF = fn(SCR_COAT, [coatHF]);
  const pictureF = fn(SCR_PICTURE);
  const lightF = fn(SCR_LIGHT);
  const figTauF = fn(SCR_FIG_TAU, [fn(SCR_FIGURE), fn(SCR_GAUSS)]);
  const shellF = fn(SCR_SHELL, [fn(SCR_SPOTS), figTauF]);
  const eggInnerF = fn(SCR_EGG_INNER);
  const gooShadeF = fn(SCR_GOO_SHADE, [lightF, ellipsoidF]);
  const fleshF = fn(SCR_FLESH, [lightF]);
  const surfaceF = fn(SCR_SURFACE, [lightF, tearF, shellF, eggInnerF, gooShadeF, gooEggLF, fleshF, veinsF, capillaryF, lipPulseF, roundRectF]);
  const sheetF = fn(SCR_SHEET, [sacF, pictureF, veinsF, capillaryF, fleshF, lightF, wrinkleF]);
  const shadowF = fn(SCR_SHADOW, [mapF, ellipsoidF]);
  const poolF = fn(SCR_POOL);
  const poolShadeF = fn(SCR_POOL_SHADE, [gooShadeF]);
  const shade = fn(SCR_SHADE, [marchF, normalF, sheetF, surfaceF, openingF, pictureF, shadowF, poolF, poolShadeF, eggInnerF, gooEggLF, coatF, coatHF, gooShadeF]);

  const table = new Float32Array(PICTURE_TABLE_N);
  const tableTex = new THREE.DataTexture(table, PICTURE_TABLE_N, 1, THREE.RedFormat, THREE.FloatType);
  tableTex.magFilter = THREE.NearestFilter; tableTex.minFilter = THREE.NearestFilter; tableTex.generateMipmaps = false;
  tableTex.needsUpdate = true;

  // The goo: gooTexels(gooAt(t)) as a GOO_TEXELS x 1 RGBA32F row (textureLoad), and its bounding sphere (radius <= 0: none).
  const gooData = new Float32Array(GOO_TEXELS * 4);
  const gooTex = new THREE.DataTexture(gooData, GOO_TEXELS, 1, THREE.RGBAFormat, THREE.FloatType);
  gooTex.magFilter = THREE.NearestFilter; gooTex.minFilter = THREE.NearestFilter; gooTex.generateMipmaps = false;
  gooTex.needsUpdate = true;
  const uGoo = uniform(new THREE.Vector4(0, 0, 0, -1));

  const uP0 = uniform(new THREE.Vector4()), uP1 = uniform(new THREE.Vector4());
  const uD = uniform(new THREE.Vector4()), uLip = uniform(new THREE.Vector4(GLASS.hw, GLASS.hh, 0, 0));
  const uTime = uniform(0);
  const uLamp = uniform(new THREE.Vector4(...opts.lampBulb, opts.lampStrength ?? PASS_LAMP));
  const uCfg = uniform(new THREE.Vector4(0.001, 0, 0, 0));
  const pic = texture(pictureTex);
  const res = shade({
    eye: modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz, pos: positionLocal,
    p0: uP0, p1: uP1, d: uD, lip: uLip, tm: uTime, lamp: uLamp, cfg: uCfg,
    picTab: texture(tableTex), scrTex: pic, scrSamp: pic, gooTex: texture(gooTex), goo: uGoo,
  }) as unknown as { xyz: never; w: ReturnType<typeof float> };
  // The packed hit: floor(t * DEPTH_Q) + coverage. t is in the local frame, which has the world's scale (the screen group is unscaled).
  const tq = floor(res.w);
  const alpha = res.w.sub(tq);
  const hitW = cameraPosition.add(normalize(positionWorld.sub(cameraPosition)).mul(tq.div(DEPTH_Q)));
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(hitW, 1.0)));
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = vec4(res.xyz, alpha);
  mat.depthNode = alpha.greaterThan(0.0).select(clip.z.div(clip.w), float(1.0));
  mat.transparent = true;
  mat.premultipliedAlpha = true;
  mat.blending = THREE.NormalBlending;
  mat.depthWrite = true;
  mat.depthTest = true;
  mat.side = THREE.BackSide;
  mat.fog = false;
  mat.name = 'screen-emergence-pass';

  const [x0, y0, z0] = SCREEN_PROXY.min, [x1, y1, z1] = SCREEN_PROXY.max;
  const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const proxy = new THREE.Mesh(geo, mat);
  proxy.name = 'screen-emergence-proxy';
  proxy.frustumCulled = false;

  /** gooAt replays the sim from t = 0 (about 7 ms warm): only from GOO_FROM on (nothing exists before), and once per distinct t, so a
   *  paused scrub does not recompute. The key is -1 while the goo is off or not yet born, so switching it off and on re-uploads. */
  let gooT = NaN;
  const setGoo = (t: number, gooOn: boolean) => {
    const live = gooOn && t >= GOO_FROM;
    const key = live ? t : -1;
    if (key === gooT) return;
    gooT = key;
    if (live) gooData.set(gooTexels(gooAt(t))); else gooData.fill(0);
    gooTex.needsUpdate = true;
    // The bound: the texels' box grown by their radii, then the blends' reach.
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let any = false;
    for (let i = 0; i < GOO_BOUND0; i++) {
      const w = gooData[i * 4 + 3]!;
      if (w <= 0) continue;
      any = true;
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, gooData[i * 4 + k]! - w); hi[k] = Math.max(hi[k]!, gooData[i * 4 + k]! + w); }
    }
    if (!any) { uGoo.value.set(0, 0, 0, -1); return; }
    const half = Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2;
    uGoo.value.set((lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2, half + GOO_K.self * 0.25 + GOO_K.scene);
  };
  const pass: ScreenPass = { proxy };
  updaters.set(pass, (t, cfg) => {
    const p = paramsAt(t);
    uP0.value.set(p.ripple, p.push, p.thin, p.lipBow);
    uP1.value.set(p.tear, p.slump, p.heal, p.glow);
    const c = eggCentre(p), lo = lipOpening(p);
    uD.value.set(sacExtent(p), c[2], c[1], lo.z);
    uLip.value.set(lo.hw, lo.hh, smooth(p.lipBow), tearTip(p, t)[2]);
    (uTime as unknown as { value: number }).value = t;
    table.set(pictureTable(p));
    tableTex.needsUpdate = true;
    setGoo(t, cfg.goo ?? true);
    uCfg.value.x = (2 * Math.tan((cfg.camera.fov * Math.PI) / 360)) / Math.max(1, cfg.heightPx);
    uCfg.value.y = cfg.debug ? 1 : 0;
    uCfg.value.z = (cfg.gooShadow ?? true) ? 1 : 0;
  });
  return pass;
}

/** The pass's per-frame update: the timeline's parameters at `t` and the field's derived values, the picture table, the goo (cached per
 *  `t`), the time, the pixel footprint and the switches. Call it each frame the proxy is drawn. */
export function updateScreenPass(pass: ScreenPass, t: number, cfg: ScreenPassFrame): void {
  const update = updaters.get(pass);
  if (!update) throw new Error('updateScreenPass: not a pass from createScreenPass');
  update(t, cfg);
}
