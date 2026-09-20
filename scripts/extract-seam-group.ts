// scripts/extract-seam-group.ts
//
// Lifts a GROUP of members out of game-main.ts's `window.__sdfGame` literal into
// a new module, verbatim, and spreads the factory back in.
//
//   npx tsx scripts/extract-seam-group.ts <module> <Factory> --slices world,render [--write]
//   npx tsx scripts/extract-seam-group.ts <module> <Factory> --members a,b,c     [--write]
//   npx tsx scripts/extract-seam-group.ts <module> <Factory> --all               [--write]
//
// --slices cannot express "member that reads no ctx slice at all": its pick
// required at least one slice, which silently skipped 88 eligible ctx-only
// members before leaves wave 1 noticed. --all takes every free-name-clean
// member, which is the honest way to ask for the remainder.
//
// WHY A SCRIPT AND NOT AN AGENT. The remaining members are small and almost all
// need nothing but `ctx`. The work is a verbatim move, so the failure mode of a
// hand-copy — a silently altered numeric literal that still type-checks — is the
// one thing the pixel gate cannot localise. A cut-and-paste at the AST level
// cannot make that mistake.
//
// Only members whose FREE NAMES are empty are eligible: anything still closing
// over a main()-scope function or const is skipped and reported, so it can be
// handled deliberately with an explicit deps object.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md
import * as ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
// Import/type inference is shared with extract-leaf.ts — one implementation.
import { importTable, importsFor, localTypes, usedLocalTypes } from './lib/game-main-deps';

const GAME_MAIN = 'src/lab/sdf-zombie/webgpu/game-main.ts';

interface Member {
  name: string;
  text: string;
  slices: string[];
  free: string[];
  fullStart: number;
  end: number;
  lines: number;
}

function mainOf(sf: ts.SourceFile): ts.FunctionDeclaration {
  let m: ts.FunctionDeclaration | undefined;
  sf.forEachChild(n => { if (ts.isFunctionDeclaration(n) && n.name?.text === 'main') m = n; });
  if (!m) throw new Error('main() not found');
  return m;
}

export function readMembers(source: string): { obj: ts.ObjectLiteralExpression; sf: ts.SourceFile; members: Member[] } {
  const sf = ts.createSourceFile('game-main.ts', source, ts.ScriptTarget.ES2022, true);
  const main = mainOf(sf);
  const scope = new Set<string>();
  for (const st of main.body!.statements) {
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) scope.add(d.name.text);
    if (ts.isFunctionDeclaration(st) && st.name) scope.add(st.name.text);
  }
  // Select by SHAPE, not by size: the assignment whose right-hand side is an
  // object literal and whose left-hand side names __sdfGame. The old heuristic
  // took the longest statement mentioning __sdfGame, which became game-main's
  // setDrawFn closure the moment the literal shrank past it (leaves wave 1) —
  // and then crashed reading `.properties` of a non-literal.
  const cands = main.body!.statements.filter((s): s is ts.ExpressionStatement =>
    ts.isExpressionStatement(s)
    && ts.isBinaryExpression(s.expression)
    && s.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isObjectLiteralExpression(s.expression.right)
    && s.expression.left.getText(sf).includes('__sdfGame'));
  if (cands.length !== 1) {
    throw new Error(`expected exactly one __sdfGame = { … } assignment in main(), found ${cands.length}`);
  }
  const obj = (cands[0].expression as ts.BinaryExpression).right as ts.ObjectLiteralExpression;

  const members: Member[] = [];
  for (const m of obj.properties) {
    if (ts.isSpreadAssignment(m) || !m.name || !ts.isIdentifier(m.name)) continue;
    const local = new Set<string>(); const free = new Set<string>(); const slices = new Set<string>();
    const col = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) local.add(n.name.text);
      if (ts.isParameter(n) && ts.isIdentifier(n.name)) local.add(n.name.text);
      n.forEachChild(col);
    };
    col(m);
    const sc = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'ctx') slices.add(n.name.text);
      if (ts.isIdentifier(n)) {
        const p = n.parent as ts.Node & { name?: ts.Node; propertyName?: ts.Node };
        const isName = p.name === n || p.propertyName === n;
        const isMem = ts.isPropertyAccessExpression(p) && p.name === n;
        if (!isName && !isMem && scope.has(n.text) && !local.has(n.text) && n.text !== 'ctx') free.add(n.text);
      }
      n.forEachChild(sc);
    };
    sc(m);
    const a = sf.getLineAndCharacterOfPosition(m.getFullStart()).line;
    const b = sf.getLineAndCharacterOfPosition(m.getEnd()).line;
    members.push({
      name: m.name.text, text: source.slice(m.getFullStart(), m.getEnd()).replace(/^\n+/, ''),
      slices: [...slices].sort(), free: [...free].sort(),
      fullStart: m.getFullStart(), end: m.getEnd(), lines: b - a + 1,
    });
  }
  return { obj, sf, members };
}

export interface GroupResult {
  module: string;
  main: string;
  picked: Member[];
  skipped: Member[];
}

export function extractGroup(
  source: string, moduleName: string, factory: string,
  pick: (m: Member) => boolean, extraImports: readonly string[],
): GroupResult {
  const { obj, sf, members } = readMembers(source);
  const wanted = members.filter(pick);
  const picked = wanted.filter(m => m.free.length === 0);
  const skipped = wanted.filter(m => m.free.length > 0);
  if (!picked.length) return { module: '', main: source, picked, skipped };

  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const m of picked) {
    let end = m.end;
    while (end < source.length && /[\s,]/.test(source[end])) {
      if (source[end] === ',') { end++; break; }
      end++;
    }
    edits.push({ start: m.fullStart, end, text: '' });
  }
  edits.push({ start: obj.getStart(sf) + 1, end: obj.getStart(sf) + 1, text: `\n    ...${factory}(ctx),` });
  const lastImport = [...source.matchAll(/^import .*?;$/gms)].at(-1);
  if (!lastImport) throw new Error('no import block');
  const at = lastImport.index! + lastImport[0].length + 1;
  edits.push({ start: at, end: at, text: `import { ${factory} } from './${moduleName}';\n` });

  let main = source;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    main = main.slice(0, e.start) + e.text + main.slice(e.end);
  }

  // De-indent one level (members sat at 4 spaces inside the literal; they sit at
  // 4 inside the returned object here too, so the text is reused as-is).
  // Each slice ends at the member node, which EXCLUDES its trailing comma, so
  // the object literal needs one put back between members.
  const body = picked.map(m => m.text).join(',\n');
  const frags = picked.map(m => `const o = {${m.text}};`);
  const autoImports = importsFor(frags, importTable(sf));
  const carriedTypes = usedLocalTypes(frags, localTypes(source, sf));
  // main() does `const { scene, camera } = ctx.boot.handle`. Members that use
  // those names are not closing over a main()-scope DECLARATION, so the
  // free-name scan does not flag them. Re-create the destructure here rather
  // than substituting inside the bodies, which must stay byte-identical.
  const handleNames = ['scene', 'camera'].filter(
    n => picked.some(m => new RegExp(`(^|[^A-Za-z0-9_.])${n}([^A-Za-z0-9_]|$)`).test(m.text)));
  const handleLine = handleNames.length
    ? `  const { ${handleNames.join(', ')} } = ctx.boot.handle;\n` : '';
  const module = [
    `// src/lab/sdf-zombie/webgpu/${moduleName}.ts`,
    `//`,
    `// Members lifted verbatim out of game-main.ts's \`window.__sdfGame\` literal.`,
    `// Every one needed nothing but the GameContext, so this factory takes no deps.`,
    `//`,
    `// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md`,
    ``,
    `import type { GameContext } from './game-context';`,
    ...autoImports,
    ...extraImports,
    ``,
    ...(carriedTypes.length
      ? ['// Type aliases copied from game-main.ts, where they are module-scope and',
         '// not exported.', ...carriedTypes, '']
      : []),
    `export function ${factory}(ctx: GameContext) {`,
    ...(handleLine ? [handleLine.replace(/\n$/, '')] : []),
    `  return {`,
    body,
    `  };`,
    `}`,
    ``,
  ].join('\n');

  return { module, main, picked, skipped };
}

if (process.argv[1]?.endsWith('extract-seam-group.ts')) {
  const [moduleName, factory] = process.argv.slice(2, 4);
  const all = process.argv.includes('--all');
  const si = process.argv.indexOf('--slices');
  const mi = process.argv.indexOf('--members');
  const ii = process.argv.indexOf('--imports');
  const slices = si > 0 ? new Set(process.argv[si + 1].split(',')) : null;
  const names = mi > 0 ? new Set(process.argv[mi + 1].split(',')) : null;
  const extraImports = ii > 0 ? process.argv[ii + 1].split(';') : [];
  if (!slices && !names && !all) throw new Error('pass --slices, --members or --all');

  const src = readFileSync(GAME_MAIN, 'utf8');
  const pick = (m: Member) =>
    all ? true
        : names ? names.has(m.name)
                : m.slices.length > 0 && m.slices.every(s => slices!.has(s));

  const r = extractGroup(src, moduleName, factory, pick, extraImports);
  console.log(`module  : src/lab/sdf-zombie/webgpu/${moduleName}.ts`);
  console.log(`picked  : ${r.picked.length} members, ${r.picked.reduce((s, m) => s + m.lines, 0)} lines`);
  if (r.skipped.length) {
    console.log(`skipped : ${r.skipped.length} (still have free names)`);
    for (const m of r.skipped) console.log(`   ${m.name} [${m.free.join(', ')}]`);
  }
  console.log(`game-main: ${src.split('\n').length} -> ${r.main.split('\n').length}`);
  if (process.argv.includes('--write') && r.picked.length) {
    writeFileSync(`src/lab/sdf-zombie/webgpu/${moduleName}.ts`, r.module);
    writeFileSync(GAME_MAIN, r.main);
    console.log('\nwrote both files');
  } else {
    console.log('\ndry run — pass --write to apply');
  }
}
