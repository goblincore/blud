// scripts/integrate-seams.ts
//
// Replaces the members of game-main.ts's `window.__sdfGame` object literal that
// now live in game-seams-*.ts with spreads of their factory calls.
//
//   npx tsx scripts/integrate-seams.ts [--write]
//
// The literal is 4,577 lines — 31% of game-main.ts — and the members below were
// extracted verbatim by the 2026-09-17 dispatch batch. Removing them here and
// spreading the factories back in is the only edit game-main.ts needs.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md
import * as ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';

const GAME_MAIN = 'src/lab/sdf-zombie/webgpu/game-main.ts';

interface SeamModule {
  /** Module basename, e.g. `game-seams-bench`. */
  module: string;
  /** Factory export, e.g. `createBenchSeams`. */
  factory: string;
  /** Members this module now owns, as they appear in the literal. */
  members: readonly string[];
  /** Dependency object source, e.g. `{ awaitBakes, bodiesOnScreen }`. */
  deps: string;
}

export const SEAMS: readonly SeamModule[] = [
  { module: 'game-seams-debug-probe', factory: 'createDebugProbeSeams',
    members: ['installDebugProbe', 'debugRegisteredTree', 'occluderWorldCheck',
              'syntheticSphereCheck', 'spawnDepthProbes'],
    deps: '{ clearDepthProbes, countDescendants, nodeDepth, round2 }' },
  { module: 'game-seams-bench', factory: 'createBenchSeams',
    members: ['bench', 'demoScenario'],
    deps: '{ awaitBakes, bodiesOnScreen, demoScenarioOf, performBenchAction }' },
  { module: 'game-seams-render-diag', factory: 'createRenderDiagSeams',
    members: ['texRoundTrip', 'temporalDiag', 'occupancy', 'boneEvals'],
    deps: '{ bodiesOnScreen, camera }' },
  { module: 'game-seams-shell-diag', factory: 'createShellDiagSeams',
    members: ['shellDiag', 'chunkCensus', 'hullCoverage'],
    deps: '{ bodiesOnScreen, shellAmpOf, camera }' },
  { module: 'game-seams-spawn-goo', factory: 'createSpawnGooSeams',
    members: ['dynamite', 'gooProbe', 'spawnCrowd', 'bakedAlbedoStats',
              'spawnTestChunk', 'goreLook', 'spawnSpinFixture', 'setGooPerf'],
    deps: '{ BUNDLE_CEIL_M, playerRoomId, spawnChunkPiece }' },
];

export interface IntegrationResult {
  main: string;
  removed: number;
  linesRemoved: number;
  missing: string[];
}

export function integrate(source: string, seams: readonly SeamModule[]): IntegrationResult {
  const sf = ts.createSourceFile('game-main.ts', source, ts.ScriptTarget.ES2022, true);
  let main: ts.FunctionDeclaration | undefined;
  sf.forEachChild(n => { if (ts.isFunctionDeclaration(n) && n.name?.text === 'main') main = n; });
  if (!main?.body) throw new Error('main() not found');

  const cands = main.body.statements.filter(
    s => ts.isExpressionStatement(s) && s.getText(sf).includes('__sdfGame'));
  const target = cands.sort(
    (a, b) => (b.getEnd() - b.getStart(sf)) - (a.getEnd() - a.getStart(sf)))[0] as ts.ExpressionStatement;
  const obj = (target.expression as ts.BinaryExpression).right as ts.ObjectLiteralExpression;

  const owned = new Map<string, SeamModule>();
  for (const s of seams) for (const m of s.members) owned.set(m, s);

  const edits: Array<{ start: number; end: number; text: string }> = [];
  const found = new Set<string>();
  let linesRemoved = 0;

  for (const m of obj.properties) {
    const name = m.name && ts.isIdentifier(m.name) ? m.name.text : undefined;
    if (!name || !owned.has(name)) continue;
    found.add(name);
    const a = sf.getLineAndCharacterOfPosition(m.getFullStart()).line;
    const b = sf.getLineAndCharacterOfPosition(m.getEnd()).line;
    linesRemoved += b - a + 1;
    // Remove the member AND its trailing comma.
    let end = m.getEnd();
    while (end < source.length && /[\s,]/.test(source[end])) {
      if (source[end] === ',') { end++; break; }
      end++;
    }
    edits.push({ start: m.getFullStart(), end, text: '' });
  }

  const missing = [...owned.keys()].filter(k => !found.has(k));
  if (missing.length) return { main: source, removed: found.size, linesRemoved, missing };

  // Spread the factories in at the top of the literal.
  const spreads = seams.map(s => `\n    ...${s.factory}(ctx, ${s.deps}),`).join('');
  edits.push({ start: obj.getStart(sf) + 1, end: obj.getStart(sf) + 1, text: spreads });

  // Import the factories.
  const lastImport = [...source.matchAll(/^import .*?;$/gms)].at(-1);
  if (!lastImport) throw new Error('no import block found');
  const at = lastImport.index! + lastImport[0].length + 1;
  const imports = seams.map(s => `import { ${s.factory} } from './${s.module}';\n`).join('');
  edits.push({ start: at, end: at, text: imports });

  let out = source;
  for (const e of edits.sort((x, y) => y.start - x.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return { main: out, removed: found.size, linesRemoved, missing: [] };
}

if (process.argv[1]?.endsWith('integrate-seams.ts')) {
  const src = readFileSync(GAME_MAIN, 'utf8');
  const r = integrate(src, SEAMS);
  if (r.missing.length) {
    console.error(`REFUSING: ${r.missing.length} member(s) not found in the literal:`);
    for (const m of r.missing) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log(`members replaced : ${r.removed}`);
  console.log(`lines removed    : ${r.linesRemoved}`);
  console.log(`game-main        : ${src.split('\n').length} -> ${r.main.split('\n').length}`);
  if (process.argv.includes('--write')) {
    writeFileSync(GAME_MAIN, r.main);
    console.log('\nwrote ' + GAME_MAIN);
  } else {
    console.log('\ndry run — pass --write to apply');
  }
}
