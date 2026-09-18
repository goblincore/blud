// src/lab/sdf-zombie/webgpu/blood-compare-main.test.ts
//
// Mock-ordered tests for the page's per-variant render path plus source
// tripwires for the page shell. Nothing here starts a GPU: importing the
// module runs bootstrap(), which bails out before createLabRenderer because
// the test DOM has no #app, and the module-level catch swallows that. What
// the import DOES prove is that the page's imports resolve and its top-level
// syntax is valid.

import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import {
  renderVariantFrame, VARIANTS, COMPARE_OUTPUT, COMPARE_SOURCE_PRESETS,
  SHAPES, SPLASH_ORIGIN, SPLASH_DIRECTION, SPLASH_CROWN_SEC,
} from './blood-compare-main';
import type { BloodSim } from '../blood-sim';
import type { GooLayer, GooDensityBlob } from './goo-layer';

const PAGE = 'src/lab/sdf-zombie/webgpu/blood-compare-main.ts';
const src = readFileSync(PAGE, 'utf8');
const html = readFileSync('sdf-blood-compare.html', 'utf8');
const vite = readFileSync('vite.config.ts', 'utf8');

describe('blood comparison page', () => {
  it('imports without throwing (module syntax + import resolution)', async () => {
    // The test DOM has no #app, so bootstrap rejects before it can construct a
    // renderer; the module-level catch logs it. Silence that expected log so
    // the suite output stays readable.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(import('./blood-compare-main')).resolves.toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('the html shell mounts the page module and the UI slots', () => {
    expect(html).toContain('/src/lab/sdf-zombie/webgpu/blood-compare-main.ts');
    expect(html).toContain('id="app"');
    expect(html).toContain('id="controls"');
    expect(html).toContain('id="diag"');
    expect(html).toContain('id="errors"');
  });

  it('vite registers the page as a build entry', () => {
    expect(vite).toContain("sdfBloodCompare: resolve(__dirname, 'sdf-blood-compare.html')");
  });
});

describe('blood comparison page — per-variant render order (mock, no GPU)', () => {
  it('sets state, refreshes the camera, syncs the SAME sim/camera, then renders', () => {
    const calls: string[] = [];
    const sim = { droplets: [], splats: [], clocks: {} } as unknown as BloodSim;
    const camera = {
      updateMatrixWorld: () => calls.push('camera.updateMatrixWorld'),
    };
    const gooLayer = {
      setReconstruction: (m: string) => calls.push(`setReconstruction:${m}`),
      setExtraBlobs: (b: readonly unknown[]) => calls.push(`setExtraBlobs:${b.length}`),
      setOutputTarget: (t: unknown) => calls.push(`setOutputTarget:${t === null ? 'canvas' : 'rt'}`),
      sync: (s: unknown, c: unknown) => {
        calls.push('sync');
        // The SAME sim and camera objects, and no simulation advance between
        // the extras and the render.
        expect(s).toBe(sim);
        expect(c).toBe(camera);
      },
      render: (_c: unknown, between: () => void) => {
        calls.push('render:enter'); between(); calls.push('render:exit');
      },
    };
    const extras: GooDensityBlob[] = [{ x: 0, y: 1, z: 0, halfW: 0.1, halfH: 0.1, roll: 0 }];
    const deps = {
      gooLayer: gooLayer as unknown as GooLayer,
      sim,
      camera: camera as never,
      renderScene: (t: unknown) => calls.push(`scene:${t === null ? 'canvas' : 'rt'}`),
    } as unknown as Parameters<typeof renderVariantFrame>[0];

    renderVariantFrame(deps, VARIANTS[0]!, extras, null);

    // This exact order is the blocker fix: without the sync the density
    // instancer count stays zero and no blood is drawn for ANY variant.
    expect(calls).toEqual([
      'setReconstruction:original',
      'setExtraBlobs:1',
      'setOutputTarget:canvas',
      'camera.updateMatrixWorld',
      'sync',
      'render:enter',
      'scene:canvas',
      'render:exit',
    ]);
  });

  it('syncs again for the second wipe variant (per-variant, no advance)', () => {
    const syncs: string[] = [];
    const sim = { droplets: [], splats: [], clocks: {} } as unknown as BloodSim;
    const camera = { updateMatrixWorld: () => {} };
    const gooLayer = {
      setReconstruction: () => {},
      setExtraBlobs: () => {},
      setOutputTarget: () => {},
      sync: () => { syncs.push('sync'); },
      render: (_c: unknown, between: () => void) => between(),
    };
    const deps = {
      gooLayer: gooLayer as unknown as GooLayer,
      sim, camera: camera as never, renderScene: () => {},
    } as unknown as Parameters<typeof renderVariantFrame>[0];
    renderVariantFrame(deps, VARIANTS[0]!, [], null);
    renderVariantFrame(deps, VARIANTS[2]!, [], null);
    expect(syncs.length).toBe(2);
  });

  it('the page actually calls the exported ordering function for every variant', () => {
    expect(src).toContain('renderVariantFrame({');
    // One BloodSim only; the two wipe variants re-render the SAME frame.
    expect((src.match(/createBloodSim\(/g) ?? []).length).toBe(1);
  });
});

describe('blood comparison page — production reuse and candidates', () => {
  it('uses the shared production blood + goo + view functions', () => {
    for (const fn of [
      'createGooLayer', 'createBloodSim', 'burst', 'spawnWoundDroplets',
      'spawnImpactGout', 'stepBlood', 'connectionBlobsForSim', 'applyGameGooDefaults',
      'createBloodView',
    ]) {
      expect(src, `${fn} must be used`).toContain(fn);
    }
  });

  it('uses the game blood view options and visibility (mist + splats on, beads off)', () => {
    expect(src).toContain('dropletDepthWrite: true');
    expect(src).toContain('dropletViewScale: 0.5');
    expect(src).toContain('stretch: { k: 0.5, max: 3.5, thin: true }');
    expect(src).toContain('mist: true');
    expect(src).toContain('ribbons: true');
    expect(src).toContain('bloodView.setBeadsVisible(false)');
    expect(src).toContain('bloodView.setMistVisible(true)');
    expect(src).toContain('bloodView.dispose()');
    expect(src).toContain('bloodView.sync(sim, camera)');
    // Per-layer attribution toggles.
    expect(src).toContain('gooVisible');
    expect(src).toContain('mistVisible');
  });

  it('exposes the four variants including the baseline original', () => {
    expect(src).toContain("id: 'original'");
    expect(src).toContain("id: 'smooth'");
    expect(src).toContain("id: 'original-connections'");
    expect(src).toContain("id: 'smooth-connections'");
    expect(VARIANTS.length).toBe(4);
  });

  it('separates the 400x300 source grid from the fixed 800x600 output', () => {
    expect(COMPARE_OUTPUT).toEqual({ width: 800, height: 600 });
    expect(COMPARE_SOURCE_PRESETS[0]).toMatchObject({ width: 400, height: 300 });
    expect(src).toContain('gooLayer.setSize(sourceW, sourceH)');
    expect(src).toContain("mode: 'fixed', width: COMPARE_OUTPUT.width, height: COMPARE_OUTPUT.height");
  });

  it('labels the split a full-size wipe, not a squashed side-by-side', () => {
    expect(src).toContain('wipe');
    expect(src).toContain('wipe at ');
    // The old half-canvas squashed blit must be gone.
    expect(src).not.toContain('const halfW = Math.max(1, Math.floor(w / 2));');
    expect(src).toContain('const cut = Math.max(1, Math.min(w - 1, Math.round(w * wipePos)));');
  });

  it('starts paused: the loop is stopped after one present', () => {
    expect(src).toContain('handle.setLoopRunning(false);');
    // The loop restarts only from the two explicit play paths (the Play button
    // and the __bloodCompare.play API), never during bootstrap.
    const startCalls = src.match(/setLoopRunning\(true\)/g) ?? [];
    expect(startCalls.length).toBe(2);
    const playSets = src.match(/playing = true; handle\.setLoopRunning\(true\)/g) ?? [];
    expect(playSets.length).toBe(2);
  });

  it('seeds the simulation deterministically (no Math.random anywhere)', () => {
    expect(src).not.toContain('Math.random');
    expect(src).toContain('makeSeededRng(seed)');
    expect(src).toContain('seed, frame, scenario');
  });

  it('tags every emission site with a stable stream id', () => {
    expect(src).toContain('streamSeq++');
    expect(src).toContain('scenarioStream');
    // No proximity-derived tagging helper remains.
    expect(src).not.toContain('tagNew');
  });

  it('offers replay, pause/step, speed, orbit, background, obstacle, source and density', () => {
    for (const needle of [
      "'Replay'", "'Play'", "'Pause'", "'Step'", 'speedInput', 'attachOrbit',
      'bgNeutral', 'obstacle', 'densityInput', 'setDensityScale', 'sourceSelect',
    ]) {
      expect(src, `${needle} must be present`).toContain(needle);
    }
  });

  it('reports source, density and output separately and exposes a capture API', () => {
    expect(src).toContain('gooLayer.densityDiagnostics');
    expect(src).toContain('source: { width: sourceW, height: sourceH }');
    expect(src).toContain('output: { width: renderer.domElement.width, height: renderer.domElement.height }');
    expect(src).toContain('captureInstructions');
    expect(src).toContain('__bloodCompare');
  });

  it('never claims visual success in source (deferred acceptance)', () => {
    expect(src).toContain('Visual acceptance is PENDING');
    expect(src).toContain('NOT verified');
  });
});

describe('blood comparison page — Current slug vs Impact splash shape axis', () => {
  it('exposes exactly two shapes, separate from the filter variants', () => {
    expect(SHAPES.map(s => s.id)).toEqual(['current', 'splash']);
    expect(SHAPES.map(s => s.id)).not.toEqual(VARIANTS.map(v => v.id));
    // Shape and filter are distinct controls, and the filter row says so.
    expect(src).toContain("row('shape'");
    expect(src).toContain("row('filter (Current only)'");
    expect(src).toContain('applies to Current only');
  });

  it('defaults to the new Impact splash frozen at its representative crown moment', () => {
    // The review default is the candidate, not the shipped slug.
    expect(src).toContain("let shape: ShapeId = 'splash';");
    expect(src).toContain("setShape('splash');");
    expect(SPLASH_CROWN_SEC).toBeGreaterThan(0);
    expect(SPLASH_CROWN_SEC).toBeLessThan(1.15);
    expect(src).toContain('let splashFrozen = true;');
  });

  it('puts the splash at the SAME wound origin as the current slug burst, spraying outward', () => {
    // The current burst fires spawnImpactGout at [0, 1.35, 0.55].
    expect(SPLASH_ORIGIN).toEqual([0, 1.35, 0.55]);
    // +Z is the OUTWARD wound normal toward the default camera, not world-up.
    expect(SPLASH_DIRECTION[2]).toBeGreaterThan(0);
    expect(SPLASH_DIRECTION[1]).toBe(0);
    expect(src).toContain('splashLayer.emit(SPLASH_ORIGIN, SPLASH_DIRECTION, seed,');
  });

  it('uses the production impact-splash module and preserves the shared seed', () => {
    for (const needle of ['createImpactSplashLayer', 'IMPACT_SPLASH_TUNING']) {
      expect(src, `${needle} must be used`).toContain(needle);
    }
    // No second seed source: the splash emits with the page's `seed`.
    expect(src).toContain('splashLayer.emit(SPLASH_ORIGIN, SPLASH_DIRECTION, seed,');
  });

  it('compares the shapes at the SAME elapsed event time (one shared clock)', () => {
    // One clock, used by both branches.
    expect(src).toContain('let eventTime = SPLASH_CROWN_SEC;');
    expect(src).toContain('simulateCurrentTo(eventTime)');
    expect(src).toContain('function simulateCurrentTo(seconds: number)');
    // The Current side is rebuilt from t=0 at a fixed 1/60 s, so a seek is
    // exact and reproducible (never a drifting live frame count). The curl
    // (blood-curl-spike) is threaded through the SAME fixed-step rebuild, so
    // the baseline and flow sims reach the event time on identical steps.
    expect(src).toContain('advanceScenarioState(st, 1 / 60, flowBase)');
    // Splash is posed from the same clock.
    expect(src).toContain('splashEvent.time = Math.min(splashEvent.lifetime, eventTime)');
    // Both shapes loop through one shared event clock while playing.
    expect(src).toContain('function advanceEvent(dt: number)');
  });

  it('prefers the one-shot burst scenario when switching to the Current shape', () => {
    expect(src).toContain("let scenario: ScenarioId = 'burst';");
    const m = src.match(/SHAPE COMPARISON PREFERS THE BURST[\s\S]{0,400}?simulateCurrentTo\(eventTime\)/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("scenario = 'burst'");
  });

  it('states the filter explicitly and disables it for the splash shape', () => {
    expect(src).toContain('filterSelect.disabled');
    expect(src).toContain('applies to Current only');
    expect(src).toContain("filterApplies: shape === 'current'");
    expect(src).toContain('filter ${v.id} INACTIVE');
  });

  it('freezes at the crown moment, loops, and has a reset', () => {
    expect(src).toContain('splashFrozen');
    expect(src).toContain('resetSplash');
    expect(src).toContain('freeze at crown');
    expect(src).toContain('Reset to crown t');
    // One elapsed-time scrubber drives both shapes.
    expect(src).toContain('event t (both shapes)');
  });

  it('renders the splash without the current sim/goo so shapes cannot be confused', () => {
    // The splash branch runs before the variant render and returns.
    expect(src).toContain("if (shape === 'splash') {");
    expect(src).toContain('splashLayer.sync(camera)');
    expect(src).toContain('splashLayer.setVisible(shape === \'splash\')');
    // Entering splash clears the sim, so no stale slug droplets/splats leak in.
    expect(src).toContain('clearSim();');
  });

  it('leaves a status legend and time indicator on the page', () => {
    expect(html).toContain('id="status"');
    expect(src).toContain('splashLegend');
    expect(src).toContain('phase ');
    expect(src).toContain('FROZEN (crown)');
  });

  it('exposes splash controls on the global API (Current stays accessible)', () => {
    for (const needle of [
      'setShape', 'setSplashTime', 'setSplashFrozen', 'resetSplash', 'splashState',
    ]) {
      expect(src, `${needle} must be exposed`).toContain(needle);
    }
    // Both shapes remain selectable.
    expect(SHAPES.map(s => s.id)).toContain('current');
  });
});

describe('blood comparison page — shutter mode (task 1)', () => {
  it('adds a mode axis and RETAINS the surface/shape controls', () => {
    expect(src).toContain("row('mode'");
    expect(src).toContain("'Surface / shape (existing)'");
    expect(src).toContain("'Shutter (exposure)'");
    // The existing axes must still be present and independent.
    expect(src).toContain("row('shape'");
    expect(src).toContain("row('filter (Current only)'");
    expect(src).toContain('renderVariantFrame({');
    expect(VARIANTS.length).toBe(4);
  });

  it('lists sharp + sampled + the efficient candidate and dispatches on the id (no alias)', () => {
    expect(src).toContain('SHUTTER_REFERENCES');
    expect(src).toContain('candidateAvailable: true');
    // The candidate is now selectable; draw() branches on the reference id.
    expect(src).toContain("shutterRef === 'efficient'");
    expect(src).toContain('renderCandidateReference');
    // No stale "disabled until task 2" tripwire remains.
    expect(src).not.toContain('unavailable until task 2');
  });

  it('uses the fixed-second presets and shows milliseconds', () => {
    expect(src).toContain('SHUTTER_PRESETS');
    expect(src).toContain('exposureMs');
    expect(src).toContain('resolveExposureSeconds');
    expect(src).toContain('clampSampleCount');
    // Angle math needs the EXPLICIT reference fps; never the measured frame rate.
    expect(src).toContain('referenceFps: shutterReferenceFps');
    expect(src).toContain("row('reference fps'");
    expect(src).toContain("row('shutter angle'");
  });

  it('records one deterministic timeline and never re-steps the live sim', () => {
    expect(src).toContain('recordTimeline');
    expect(src).toContain('timelineForCurrentEvent');
    expect(src).toContain('const scratch: BloodSim = { droplets: [], splats: [], clocks: {} };');
    expect(src).toContain('timelineCache');
    expect(src).toContain('advanceScenarioState');
    expect(src).toContain('freshState');
  });

  it('shades each sample separately as premultiplied colour+coverage', () => {
    expect(src).toContain('planShutterSamples');
    expect(src).toContain('movingSimAt');
    expect(src).toContain('splitSimForShutter');
    expect(src).toContain('renderLayer');
    expect(src).toContain('scene.overrideMaterial = depthOnly');
    expect(src).toContain('renderSampledReference');
    expect(src).toContain('colorWrite: false');
    // Never accumulate density across times then threshold once.
    expect(src).not.toContain('accumulateDensity');
  });

  it('keeps static pools/guts sharp and the background normalized', () => {
    // Static half comes from splitSimForShutter; moving half has no splats.
    expect(src).toContain('staticSim');
    expect(src).toContain('refScene');
    expect(src).toContain('refAccum');
    expect(src).toContain('oneMinus');
    expect(src).toContain('refScale');
  });

  it('shows sample/radius limits and the trailing interval in diagnostics', () => {
    expect(src).toContain("row('samples (oracle)'");
    expect(src).toContain("row('max streak px'");
    expect(src).toContain('trailing box');
    expect(src).toContain('streak @600 px/s');
  });

  it('adds the three repeatable shutter fixtures via production emitters', () => {
    expect(src).toContain("label: 'bleed (slow wound dribble)'");
    expect(src).toContain("label: 'trail (fast gib-like 6 m/s)'");
    expect(src).toContain("label: 'crossing (opposed streams)'");
    expect(src).toContain('emitTrails');
    expect(src).toContain('spawnWoundDroplets');
  });

  it('reuses the wipe view for reference vs sharp and keeps pause/step/replay', () => {
    expect(src).toContain('renderSharpReference(rtA)');
    expect(src).toContain('renderReference(rtB)');
    expect(src).toContain('renderSampledReference');
    expect(src).toContain('renderCandidateReference');
    expect(src).toContain('blitWipe');
    // The transport rows are unchanged and shared by both modes.
    expect(src).toContain("'Play'");
    expect(src).toContain("'Pause'");
    expect(src).toContain("'Step'");
    expect(src).toContain("'Replay'");
  });

  it('implements the task-2 candidate as a bounded velocity-streak resolve', () => {
    // The pure module owns the motion plan, seed raster and single resolve.
    for (const needle of [
      'planSweepStamps', 'rasterizeSweepSeed', 'createShutterResolve',
      'seedDimsForOutput', 'SHUTTER_CANDIDATE_TAPS', 'EMPTY_SEED_STATS',
    ]) {
      expect(src, `${needle} must be used`).toContain(needle);
    }
    // Lazily built: no candidate allocation while the reference is not active.
    expect(src).toContain('function ensureCandidate');
    expect(src).toContain('function disposeCandidate');
    expect(src).toContain('disposeCandidate();');
    // Selecting the candidate with exposure OFF stays allocation-free.
    expect(src).toContain("shutterRef === 'efficient' && currentExposureSeconds() > 0");
    // The clean half has a SAMPLEABLE depth for the per-pixel occlusion test.
    expect(src).toContain('refScene.depthTexture = new THREE.DepthTexture(1, 1)');
    // Bounded work, named in the diagnostics.
    expect(src).toContain('candidateDiag');
    expect(src).toContain('conflict');
  });

  it('exposes the shutter API and reports the efficient candidate as unavailable', () => {
    for (const needle of ['setMode', 'setShutter', 'shutterState', 'exposureSeconds', 'last: lastRefStats']) {
      expect(src, `${needle} must be exposed`).toContain(needle);
    }
    expect(src).toContain("mode: compareMode");
  });
});

describe('blood comparison page — flow axis (blood-curl-spike)', () => {
  it('ships the flow OFF so the baseline look is unchanged', () => {
    // Every switch defaults to the shipped look; the game never sets them.
    expect(src).toContain('let curlOn = false;');
    expect(src).toContain('let softFadeM = 0;');
    expect(src).toContain("let wipeAxis: WipeAxis = 'variant';");
  });

  it('builds a SECOND sim for the flow side without a second factory call', () => {
    // The page's one-factory invariant still holds; the flow A/B needs a
    // literal second sim at the same seed/scenario/event time.
    expect((src.match(/createBloodSim\(/g) ?? []).length).toBe(1);
    expect(src).toContain('const flowSim: BloodSim = { droplets: [], splats: [], clocks: {} };');
    expect(src).toContain('function simulateFlowTo');
    expect(src).toContain('simulateStateInto(st, seconds, curlBase(false))');
  });

  it('threads the shared curl volume into stepBlood through the API', () => {
    expect(src).toContain('getCurlVolumeData');
    expect(src).toContain('function curlBase');
    expect(src).toContain('setFlow');
    expect(src).toContain('flow: {');
  });

  it('wipes baseline against flow with the SAME filter variant on both sides', () => {
    expect(src).toContain("wipeAxis === 'flow'");
    expect(src).toContain('renderVariant(variantById(variant), rtA, flowSim, softFadeM)');
    expect(src).toContain('renderVariant(variantById(variant), rtB, sim, 0)');
    expect(src).toContain("label: 'flow A/B (baseline | flow)'");
  });

  it('applies the soft fade to both translucent element families', () => {
    expect(src).toContain('bloodView.setSoftFade');
    expect(src).toContain('splashLayer.setSoftFade');
    // The flow panel exposes all four knobs plus the on/off switch.
    for (const needle of ['curl on (sim advection)', "'strength m/s²'", "'scale m/cell'", "'drift /s'", "'soft fade m'"]) {
      expect(src, `${needle} must be present`).toContain(needle);
    }
  });
});

describe('blood comparison page — density axis (blood-density spike)', () => {
  it('ships the packing OFF so the baseline look is unchanged', () => {
    // Every knob defaults to the shipped game look: neutral emission
    // multipliers and GAME_GOO_DEFAULTS. A page boot is the baseline frame.
    expect(src).toContain('const density = { ...DENSITY_DEFAULTS };');
    expect(src).toContain('coneScale: 1, countMul: 1, sizeMul: 1,');
    expect(src).toContain('gooSizeScale: SHIPPED_GOO.sizeScale,');
    expect(src).toContain('gooThreshold: SHIPPED_GOO.threshold,');
    expect(src).toContain('gooBlurPx: SHIPPED_GOO.blurPx,');
    expect(src).toContain('GAME_GOO_DEFAULTS');
  });

  it('threads the emission pack through every spawn site of the second sim', () => {
    // The pack rides the ScenarioState, so the baseline sim never carries one.
    expect(src).toContain('pack?: DensityPack;');
    expect(src).toContain('st.pack');
    expect(src).toContain('spawnWoundDroplets(');
    expect(src).toContain('spawnImpactGout(st.sim, \'slug\', [0, 1.35, 0.55], [0, 0, -1], st.rng, stream, st.pack)');
    // The pack must be set BEFORE the t=0 prime.
    const m = src.match(/st\.pack = pack;[\s\S]{0,200}?primeScenarioInto\(st\)/);
    expect(m).not.toBeNull();
  });

  it('rebuilds the second sim with the current packing (and curl only when on)', () => {
    expect(src).toContain('function densityEmission()');
    expect(src).toContain('simulateStateInto(flowState, seconds, curlBase(curlOn)');
    expect(src).toContain('densityActive()');
    expect(src).toContain('function flowUseDensity()');
  });

  it('wipes baseline against dense on the SAME filter variant', () => {
    expect(src).toContain("wipeAxis === 'density'");
    expect(src).toContain('renderVariant(variantById(variant), rtA, flowSim, softFadeM, densityGoo())');
    expect(src).toContain('renderVariant(variantById(variant), rtB, sim, 0, SHIPPED_GOO)');
    expect(src).toContain("label: 'density A/B (baseline | dense)'");
    // The flow axis keeps its isolated-curl semantics (shipped packing).
    expect(src).toContain('applyGooDensity(SHIPPED_GOO);');
  });

  it('applies the goo half of the pack to the layer and exposes both halves', () => {
    expect(src).toContain('function applyGooDensity');
    expect(src).toContain('gooLayer.setSizeScale(p.sizeScale)');
    expect(src).toContain('gooLayer.setThreshold(p.threshold)');
    expect(src).toContain('gooLayer.setBlurPx(p.blurPx)');
    for (const needle of [
      "'spread ×'", "'count ×'", "'size ×'", "'goo radius'", "'goo threshold'", "'goo blur px'",
    ]) {
      expect(src, `${needle} must be present`).toContain(needle);
    }
  });

  it('records the packing in state() and exposes setDensity beside setFlow', () => {
    expect(src).toContain('packing: {');
    expect(src).toContain('shipped: { ...DENSITY_DEFAULTS }');
    expect(src).toContain('setDensity:');
    expect(src).toContain('gooRadius');
    expect(src).toContain('gooThreshold');
    expect(src).toContain('gooBlur');
  });
});

describe('blood comparison page — task 3 bench + pass labels', () => {  it('installs labeled pass timing and labels the candidate passes', () => {
    for (const needle of ['installPassTiming', 'beginPassFrame', 'setPassLabel', 'attributePassSamples']) {
      expect(src, `${needle} must be imported/used`).toContain(needle);
    }
    // The candidate's passes are individually attributable.
    for (const label of ['cand:static-scene', 'cand:selected-goo', 'cand:resolve']) {
      expect(src, `${label} must be labeled`).toContain(label);
    }
    for (const label of ['oracle:static-scene', 'oracle:depth', 'oracle:sample', 'oracle:composite']) {
      expect(src, `${label} must be labeled`).toContain(label);
    }
  });

  it('drives the frozen frame by hand and never advances the sim in the bench', () => {
    expect(src).toContain('async function benchShutter');
    expect(src).toContain('handle.setLoopRunning(false)');
    expect(src).toContain('handle.resolveGpu()');
    // The bench reports the frozen state, not a live frame count.
    expect(src).toContain('warmupFencedMs');
    expect(src).toContain('coldFencedMs');
    expect(src).toContain('cpuPrep');
  });

  it('separates presentation cadence from the fixed shutter interval', () => {
    expect(src).toContain('driveSteps: (dtSec: number, count: number)');
    expect(src).toContain('handle.step(dtSec)');
    for (const needle of ['benchShutter', 'passTimingInstalled', 'present:']) {
      expect(src, `${needle} must be exposed`).toContain(needle);
    }
  });
});
