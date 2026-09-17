// scripts/slice-extract.ts
//
// Dumps the bindings declared directly in `main()`'s body in game-main.ts, so
// slice authors curate a GENERATED list instead of hand-typing ~493 names into
// a plan document that would go stale the moment the file grows.
//
//   npx tsx scripts/slice-extract.ts            # all bindings, as a table
//   npx tsx scripts/slice-extract.ts probes     # just one slice
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md
import * as ts from 'typescript';
import { readFileSync } from 'node:fs';

export interface Binding {
  name: string;
  kind: 'let' | 'const';
  initializer: string;
  line: number;
  /** What this binding IS, which decides whether it becomes a slice field:
   *   state   - mutable, or a boot handle extracted functions will need -> SLICE
   *   fn      - a function in const clothing -> extraction target (tasks 9-12)
   *   const   - never reassigned, SCREAMING_CASE -> stays a local
   *   scratch - reused `_`-prefixed temporary -> stays a local */
  role: 'state' | 'fn' | 'const' | 'scratch';
  reassigned: boolean;
}

/** Prefix -> slice. Order matters: the first match wins, so a longer prefix
 *  must precede any shorter one that would also match. */
const PREFIX_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // Panels first: `dynamitePanel` is a panel, not dynamite.
  [/Panel$|^panelsHidden$|^(shutterGame|impactSplash(Enabled|Layer))$/, 'panels'],

  // World / level / entities -> ctx.world, not a resource slice.
  [/^(actors|colliders|surfaces|levelGroup|levelLightLists|levelNodeMaterials|litChunkMaterials|accentGroup|encounter|encounterHomes|encounterNav|coverage|cullCounts|frustum|projScreen|bodySphere|sightA|lastSeenMs|roomProbes|soldierCorpses|soldierCorpseGroup|outerHull|stoneSet)$/, 'world'],

  // Boot: DOM handles, URL params, loader, warm-up, one-shot ids.
  [/^(boot|doc|canvas|mount|handle|hud|hudEl|loader|loopControl|rawSetLoopRunning|resKey|seedSearch|errors|graphics|graphicsHighUpscale|deferredApi|deferredMode|fieldsBoot|shadowMapParam|spotShadowParam|sscs|vhsParam|gameTiles|tilesButton|tilesPlaytest|marchNormalsWanted|frameHashDeps|frameEma|drawReady|nextEmitterStream|nextId|onSeverDispatch|warmPromise|warmRequested|passTiming)/, 'boot'],

  [/^(probe|pendingGather)/i, 'probes'],
  [/^(gib|pendingGib)/i, 'gibs'],
  [/^goo/i, 'goo'],
  [/^crowd/i, 'crowd'],
  [/^dyn/i, 'dynamite'],

  // Weapon / viewmodel: the largest slice.
  [/^(aim|arms|breech|burst(Cursor|Slots)|cooldown|ejectedShells|extractor|fire(Age|Barrels)|flash(Age|Group|Light|Material|Textures)|foreHand|gripHand|gun|handMaterial|heldProp|hingePivot|infiniteAmmo|lastEjectOrigin|loadShells|muzzle|pellet|pendingFire|pendingReload|pinnedReloadSeed|recoilPitch|reload|shell|shotAlert|slotState|slugMode|soldierPellet|topLeverNode|viewModelAnchor|weapon)/, 'weapon'],

  // Player / camera / input.
  [/^(autopilot|bob(Amount|Distance)|centerFovDeg|currentInputFrame|freeAimOn|holdPlayerPose|keys|lastWalkPos|marker|parked|pendingD[xy]|player|prevInputKeys|prevPlayerPos|reticleEl|strafe\w*|stuckT)$/, 'player'],

  [/^(bake|baked|chunk|carved|lastBake|maxChunks|nextChunkId|totalBakes|bundle|liveBundles|liveChunks|spareBundles|spareChunkViews)/i, 'bake'],

  // Render, incl. the skeleton/segment caches.
  [/^(adaptive|sdfScale|sdfLayer|postAa|refine|bone|occluder|hull|actorCull|visibleActors|frozenHull|meshSync|texProbe|upscale|seg(Mesh|Volume)|sharedVolumeAtlases|skeleton|depthProbes)/i, 'render'],

  [/^(hemi|levelProbe|levelShadow|light|flicker|tracerLight|bodyFlash|bounceSpot|dungeonOn|fxLight|liveTracers|flashlight)/i, 'lighting'],

  // VFX: blood, gore, explosions, smoke, wounds.
  [/^(beamTuning|blastDistort|bleed|blood|burst(Layer|Tex)|cook|ember|explosion|flesh|fx|gore|gutRopes|slough|smoke|sprite(Bench|Pieces)|tearShape|tracerTex|wound|boundedWoundPreview|lastSplashShot)/i, 'vfx'],

  [/^(demo|replay|simFrame|simLocked|frameCount|wanderFrozen|recorder)/i, 'demo'],
  [/^(telemetry|firstTelemetry|normalGradient|volumeAtlasBuilds)/i, 'telemetry'],

  // Character assets used by the march.
  [/^(face|characterEffects|aoe(LaunchFloor|RadiusScale))/i, 'vfx'],
];

export function sliceFor(name: string): string | null {
  for (const [re, slice] of PREFIX_RULES) if (re.test(name)) return slice;
  return null;
}

export function extractBindings(source: string): Binding[] {
  const sf = ts.createSourceFile('game-main.ts', source, ts.ScriptTarget.ES2022, true);
  const out: Binding[] = [];

  const main = findMain(sf);
  if (!main?.body) return out;

  const reassignedNames = collectReassigned(main);

  // Only the IMMEDIATE body scope. Anything nested inside a further block or
  // function belongs to a different scope and is not ours to migrate.
  for (const stmt of main.body.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const kind = stmt.declarationList.flags & ts.NodeFlags.Const ? 'const' : 'let';
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;   // skip destructuring
      const name = decl.name.text;
      const initializer = decl.initializer?.getText(sf) ?? '';
      const reassigned = reassignedNames.has(name);
      out.push({
        name,
        kind,
        initializer,
        line: sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1,
        reassigned,
        role: roleOf(name, decl.initializer, reassigned),
      });
    }
  }
  return out;
}

/** Per main()-scope function, which ctx slices its body touches. A function
 *  touching exactly one slice is extractable as-is; one touching several stays
 *  in main() until its extra dependencies are made parameters. Used by the
 *  extraction waves (tasks 9-12), after the codemod has run. */
export function functionSlices(source: string): Array<{ name: string; slices: string[]; line: number }> {
  const sf = ts.createSourceFile('game-main.ts', source, ts.ScriptTarget.ES2022, true);
  const main = findMain(sf);
  if (!main?.body) return [];
  const out: Array<{ name: string; slices: string[]; line: number }> = [];

  for (const stmt of main.body.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name) continue;
    const slices = new Set<string>();
    const walk = (n: ts.Node): void => {
      // Match ctx.<slice> in a ctx.<slice>.<field> access.
      if (ts.isPropertyAccessExpression(n)
        && ts.isIdentifier(n.expression)
        && n.expression.text === 'ctx') {
        slices.add(n.name.text);
      }
      n.forEachChild(walk);
    };
    walk(stmt);
    out.push({
      name: stmt.name.text,
      slices: [...slices].sort(),
      line: sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1,
    });
  }
  return out;
}

/** Names assigned to (or ++/--'d) anywhere inside main(), at any depth. The
 *  objective signal that a binding is mutable state rather than a constant. */
function collectReassigned(main: ts.FunctionDeclaration): Set<string> {
  const names = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n)
      && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      && ts.isIdentifier(n.left)) {
      names.add(n.left.text);
    }
    if ((ts.isPostfixUnaryExpression(n) || ts.isPrefixUnaryExpression(n))
      && ts.isIdentifier(n.operand)
      && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) {
      names.add(n.operand.text);
    }
    n.forEachChild(walk);
  };
  walk(main);
  return names;
}

function roleOf(name: string, init: ts.Expression | undefined, reassigned: boolean): Binding['role'] {
  if (name.startsWith('_')) return 'scratch';
  // A function in const clothing belongs to an extraction wave, not a slice —
  // even though it is never reassigned.
  if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return 'fn';
  if (reassigned) return 'state';
  // Never reassigned and SCREAMING_CASE: a genuine constant, leave it local.
  if (/^[A-Z][A-Z0-9_]*$/.test(name)) return 'const';
  // Never reassigned but lowercase: a boot handle (canvas, sdfLayer, actors,
  // colliders). Extracted functions still need to reach it, so it is state.
  return 'state';
}

function findMain(sf: ts.SourceFile): ts.FunctionDeclaration | undefined {
  let found: ts.FunctionDeclaration | undefined;
  sf.forEachChild(n => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'main') found = n;
  });
  return found;
}

const GAME_MAIN = 'src/lab/sdf-zombie/webgpu/game-main.ts';

if (process.argv[1]?.endsWith('slice-extract.ts')) {
  const src = readFileSync(GAME_MAIN, 'utf8');

  if (process.argv[2] === '--functions') {
    const want = process.argv[3];
    for (const f of functionSlices(src)) {
      if (want && !f.slices.includes(want)) continue;
      const mark = f.slices.length === 1 ? 'EXTRACTABLE' : `touches ${f.slices.length}`;
      console.log(`${String(f.line).padStart(5)}  ${mark.padEnd(12)} ${f.name}  [${f.slices.join(', ')}]`);
    }
    process.exit(0);
  }

  const target = process.argv[2];
  const all = extractBindings(src);
  const state = all.filter(b => b.role === 'state');
  const rows = target ? state.filter(b => sliceFor(b.name) === target) : state;

  for (const b of rows) {
    const mut = b.reassigned ? 'mut ' : 'once';
    console.log(`${String(b.line).padStart(5)}  ${(sliceFor(b.name) ?? '?').padEnd(10)} ${mut} ${b.name} = ${b.initializer.slice(0, 54)}`);
  }

  if (target) {
    console.log(`\n${rows.length} state bindings in slice '${target}'`);
  } else {
    const byRole = (r: Binding['role']) => all.filter(b => b.role === r).length;
    console.log(`\n${all.length} bindings total`);
    console.log(`  state   ${byRole('state')}  -> slice fields`);
    console.log(`  fn      ${byRole('fn')}  -> extraction targets (tasks 9-12)`);
    console.log(`  const   ${byRole('const')}  -> stay local`);
    console.log(`  scratch ${byRole('scratch')}  -> stay local`);
    console.log(`\nunclassified state (need a slice): ${state.filter(b => !sliceFor(b.name)).length}`);
  }
}
