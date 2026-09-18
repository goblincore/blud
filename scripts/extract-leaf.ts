// scripts/extract-leaf.ts
//
// Moves main()-scope LEAF functions out of game-main.ts into a module, giving
// each an explicit `ctx: GameContext` first parameter in place of the closure
// capture, and rewriting every call site.
//
//   npx tsx scripts/extract-leaf.ts <module-basename> <fn>[,<fn>...] [--consts A,B] [--write]
//
// A leaf is a function with no free main()-scope functions or vars (see
// `npx tsx scripts/slice-extract.ts --functions`). Anything else needs its
// dependencies extracted first — this is a bottom-up process.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md
import * as ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';

const GAME_MAIN = 'src/lab/sdf-zombie/webgpu/game-main.ts';

export interface Extraction {
  /** New module source. */
  module: string;
  /** Rewritten game-main.ts. */
  main: string;
  linesMoved: number;
  callSites: number;
  /** References passed as values, wrapped to keep their ctx. */
  bareRefs: number;
}

function findMain(sf: ts.SourceFile): ts.FunctionDeclaration {
  let found: ts.FunctionDeclaration | undefined;
  sf.forEachChild(n => { if (ts.isFunctionDeclaration(n) && n.name?.text === 'main') found = n; });
  if (!found) throw new Error('main() not found');
  return found;
}

export function extractLeaves(
  source: string, fnNames: readonly string[], constNames: readonly string[], moduleName: string,
  extraImports: readonly string[] = [],
): Extraction {
  const sf = ts.createSourceFile('game-main.ts', source, ts.ScriptTarget.ES2022, true);
  const main = findMain(sf);
  const want = new Set(fnNames);
  const wantConst = new Set(constNames);

  const cuts: Array<{ start: number; end: number }> = [];
  const bodies: string[] = [];
  const consts: string[] = [];
  let linesMoved = 0;

  for (const st of main.body!.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && want.has(st.name.text)) {
      const a = sf.getLineAndCharacterOfPosition(st.getFullStart()).line;
      const b = sf.getLineAndCharacterOfPosition(st.getEnd()).line;
      linesMoved += b - a + 1;
      // De-indent two spaces and give it ctx explicitly. Take the FULL span so
      // the declaration's leading doc comment moves with it rather than being
      // deleted along with the statement.
      const raw = source.slice(st.getFullStart(), st.getEnd()).replace(/^\n+/, '');
      const text = raw.split('\n').map(l => l.startsWith('  ') ? l.slice(2) : l).join('\n');
      // NOTE the `m` flag: the text starts with the declaration's doc comment,
      // so an unanchored-to-line `^` would never reach the `function` line and
      // ctx would silently not be added.
      const withCtx = text.replace(
        new RegExp(`^(\\s*)(async )?function ${st.name.text}\\(`, 'm'),
        (_m: string, ind: string, asy?: string) => `${ind}export ${asy ?? ''}function ${st.name!.text}(ctx: GameContext, `,
      ).replace(`(ctx: GameContext, )`, `(ctx: GameContext)`);
      bodies.push(withCtx);
      cuts.push({ start: st.getFullStart(), end: st.getEnd() });
      continue;
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !wantConst.has(d.name.text)) continue;
        const raw = source.slice(st.getFullStart(), st.getEnd()).replace(/^\n+/, '');
        const text = raw.split('\n').map(l => l.startsWith('  ') ? l.slice(2) : l).join('\n');
        // `export` must precede the declaration, after any doc comment.
        const nl = text.lastIndexOf('\n');
        consts.push(nl >= 0 ? `${text.slice(0, nl + 1)}export ${text.slice(nl + 1)}` : `export ${text}`);
        const a = sf.getLineAndCharacterOfPosition(st.getFullStart()).line;
        const b = sf.getLineAndCharacterOfPosition(st.getEnd()).line;
        linesMoved += b - a + 1;
        cuts.push({ start: st.getFullStart(), end: st.getEnd() });
      }
    }
  }

  if (bodies.length !== fnNames.length) {
    throw new Error(`expected ${fnNames.length} functions, matched ${bodies.length}`);
  }

  // Rewrite call sites: f(a) -> f(ctx, a), f() -> f(ctx).
  const edits: Array<{ start: number; end: number; text: string }> = [];
  let callSites = 0;
  const inCut = (p: number) => cuts.some(c => p >= c.start && p < c.end);
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && want.has(n.expression.text)
      && !inCut(n.getStart(sf))) {
      callSites++;
      const open = n.expression.getEnd();
      if (n.arguments.length) {
        // f(a, b) -> f(ctx, a, b): replace up to the first argument.
        edits.push({ start: open, end: n.arguments[0].getStart(sf), text: '(ctx, ' });
      } else {
        // f() -> f(ctx): replace the WHOLE `()`, not just the `(`, or the
        // original closing paren is left behind as `f(ctx))`.
        edits.push({ start: open, end: n.getEnd(), text: '(ctx)' });
      }
    }
    // A BARE reference (passed as a value, not called) must be wrapped, or it
    // silently loses its ctx and its arity no longer matches the target.
    // `(...a) => f(ctx, ...a)` is fine unannotated: these appear in
    // contextually-typed positions, so TS infers `a` from the target signature.
    if (ts.isIdentifier(n) && want.has(n.text) && !inCut(n.getStart(sf))) {
      const par = n.parent as ts.Node & { name?: ts.Node; expression?: ts.Node };
      const isCallee = ts.isCallExpression(par) && par.expression === n;
      const isNamePos = par.name === n;
      const isMember = ts.isPropertyAccessExpression(par) && par.name === n;
      if (!isCallee && !isNamePos && !isMember) {
        bareRefs++;
        edits.push({ start: n.getStart(sf), end: n.getEnd(),
                     text: `(...a) => ${n.text}(ctx, ...a)` });
      }
    }
    n.forEachChild(visit);
  };
  let bareRefs = 0;
  visit(main);

  // game-main.ts must import back everything that just left it.
  const back = [...fnNames, ...constNames].sort();
  const importBack = `import { ${back.join(', ')} } from './${moduleName}';\n`;
  const lastImport = [...source.matchAll(/^import .*?;$/gms)].at(-1);
  if (!lastImport) throw new Error('no import block found in game-main.ts');
  const insertAt = lastImport.index! + lastImport[0].length + 1;

  let out = source;
  const all = [...edits, ...cuts.map(c => ({ ...c, text: '' })),
               { start: insertAt, end: insertAt, text: importBack }];
  for (const e of all.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + (e as { text: string }).text + out.slice(e.end);
  }

  const module = [
    `// src/lab/sdf-zombie/webgpu/${moduleName}.ts`,
    `//`,
    `// Extracted from game-main.ts's main() closure. Each function takes the`,
    `// GameContext explicitly instead of capturing main()'s scope.`,
    `//`,
    `// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md`,
    ``,
    `import type { GameContext } from './game-context';`,
    ...extraImports,
    ``,
    ...consts, consts.length ? '' : '',
    ...bodies.map(b => b + '\n'),
  ].join('\n');

  return { module, main: out, linesMoved, callSites, bareRefs };
}

if (process.argv[1]?.endsWith('extract-leaf.ts')) {
  const [moduleName, fnCsv] = process.argv.slice(2);
  const ci = process.argv.indexOf('--consts');
  const constNames = ci > 0 ? process.argv[ci + 1].split(',') : [];
  const fnNames = fnCsv.split(',');
  const src = readFileSync(GAME_MAIN, 'utf8');
  const ii = process.argv.indexOf('--imports');
  const extraImports = ii > 0 ? process.argv[ii + 1].split(';') : [];
  const r = extractLeaves(src, fnNames, constNames, moduleName, extraImports);
  console.log(`module     : src/lab/sdf-zombie/webgpu/${moduleName}.ts`);
  console.log(`functions  : ${fnNames.join(', ')}`);
  console.log(`consts     : ${constNames.join(', ') || '(none)'}`);
  console.log(`lines moved: ${r.linesMoved}`);
  console.log(`call sites : ${r.callSites}`);
  console.log(`bare refs  : ${r.bareRefs}`);
  console.log(`game-main  : ${src.split('\n').length} -> ${r.main.split('\n').length}`);
  if (process.argv.includes('--write')) {
    writeFileSync(`src/lab/sdf-zombie/webgpu/${moduleName}.ts`, r.module);
    writeFileSync(GAME_MAIN, r.main);
    console.log('\nwrote both files');
  } else {
    console.log('\ndry run — pass --write to apply');
  }
}
