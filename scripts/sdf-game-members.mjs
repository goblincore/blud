// scripts/sdf-game-members.mjs
//
// AST dump of the window.__sdfGame member set for the seam-split tasks:
//   npx tsx scripts/sdf-game-members.mjs dump          # final member set, in spread order + sorted
//   npx tsx scripts/sdf-game-members.mjs census <file> # per-member: line span + ctx slices touched
//   npx tsx scripts/sdf-game-members.mjs               # both
//
// The `dump` mode simulates the OBJECT-LITERAL semantics of the __sdfGame
// literal: properties are applied in source order, later spreads overwrite
// earlier same-named members. The final sorted key list is what a
// `Object.keys(__sdfGame).sort()` in the page would see.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md
import * as ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const WEBGPU = 'src/lab/sdf-zombie/webgpu';
const MAIN = join(WEBGPU, 'game-main.ts');

function parse(path) {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

function lineOf(sf, pos) {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/** The object literal assigned to `window.__sdfGame` in game-main.ts. */
function findSdfGameLiteral(sf) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (ts.isPropertyAccessExpression(node) && node.name.text === '__sdfGame' && ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      found = node.parent.right;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Map factory name -> file path, from game-main.ts's imports. */
function factoryImportMap(sf) {
  const map = new Map();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings) continue;
    if (!ts.isNamedImports(st.importClause.namedBindings)) continue;
    const spec = st.moduleSpecifier.text;
    for (const el of st.importClause.namedBindings.elements) {
      if (/create\w+Seams$/.test(el.name.text)) {
        if (spec.startsWith('.')) map.set(el.name.text, spec);
      }
    }
  }
  return map;
}

function resolveModule(fromImport) {
  // seam imports in game-main.ts are relative to webgpu/
  const p = join(WEBGPU, fromImport);
  for (const ext of ['', '.ts']) {
    try {
      readFileSync(p + ext);
      return p + ext;
    } catch { /* try next */ }
  }
  return null;
}

/** The object literal a `create*Seams` function returns. */
function factoryReturnLiteral(sf) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && /^create\w+Seams$/.test(node.name?.text ?? '')) {
      const ret = node.body?.statements.find((s) => ts.isReturnStatement(s));
      if (ret && ret.expression && ts.isObjectLiteralExpression(ret.expression)) { found = ret.expression; return; }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function memberName(prop) {
  if (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop) || ts.isGetAccessorDeclaration(prop) || ts.isSetAccessorDeclaration(prop) || ts.isShorthandPropertyAssignment(prop)) {
    const n = prop.name;
    if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  }
  return null;
}

/** Apply properties of `lit` onto `state` (Map key->origin) in order. */
function applyLiteral(lit, sf, state) {
  for (const prop of lit.properties) {
    if (ts.isSpreadElement(prop) || (prop.kind === ts.SyntaxKind.SpreadAssignment)) {
      const expr = prop.expression;
      let fname = null;
      if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) fname = expr.expression.text;
      else if (ts.isIdentifier(expr)) fname = expr.text;
      if (!fname || !fname.endsWith('Seams')) {
        state.set(`<unknown-spread@${lineOf(sf, prop.getStart())}>`, `<spread ${expr.getText().slice(0, 60)}>`);
        continue;
      }
      const modPath = resolveModule(factoryImportMap(sf).get(fname) ?? '');
      if (!modPath) throw new Error(`cannot resolve module for ${fname}`);
      const msf = parse(modPath);
      const mlit = factoryReturnLiteral(msf);
      if (!mlit) throw new Error(`no return literal in ${modPath}`);
      applyLiteral(mlit, msf, state);
    } else {
      const name = memberName(prop);
      if (name === null) { state.set(`<computed@${lineOf(sf, prop.getStart())}>`, 'computed'); continue; }
      state.set(name, `${sf.fileName.split('/').pop()}:${lineOf(sf, prop.getStart())}`);
    }
  }
}

function dump() {
  const sf = parse(MAIN);
  const lit = findSdfGameLiteral(sf);
  if (!lit) throw new Error('__sdfGame literal not found');
  const state = new Map();
  applyLiteral(lit, sf, state);
  const entries = [...state.entries()];
  console.log(`# members: ${entries.length} (final object, spreads applied in order)`);
  console.log('# by origin:');
  const byOrigin = new Map();
  for (const [name, origin] of entries) {
    const file = origin.split(':')[0];
    if (!byOrigin.has(file)) byOrigin.set(file, []);
    byOrigin.get(file).push(name);
  }
  for (const [file, names] of byOrigin) console.log(`# ${file}: ${names.length}`);
  console.log('# sorted final keys:');
  for (const name of [...state.keys()].sort()) console.log(name);
}

/** Census of one seam module: member name, line span, ctx paths touched. */
function census(file) {
  const sf = parse(file);
  const lit = factoryReturnLiteral(sf);
  if (!lit) throw new Error(`no create*Seams return literal in ${file}`);
  console.log(`# census of ${file} — ${lit.properties.length} members`);
  for (const prop of lit.properties) {
    const start = lineOf(sf, prop.getStart());
    const end = lineOf(sf, prop.getEnd());
    const name = memberName(prop) ?? `<computed@${start}>`;
    const ctxPaths = new Set();
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node) && node.expression.getText(sf).match(/^ctx$/)) ctxPaths.add(node.getText(sf));
      ts.forEachChild(node, visit);
    };
    if (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop) || ts.isGetAccessorDeclaration(prop)) visit(prop.initializer ?? prop.body ?? prop);
    else visit(prop);
    console.log(`${String(start).padStart(4)}-${String(end).padStart(4)} (${String(end - start + 1).padStart(3)}L)  ${name}  [${[...ctxPaths].sort().join(', ')}]`);
  }
}

const [mode, file] = process.argv.slice(2);
if (mode === 'dump') dump();
else if (mode === 'census' && file) census(file);
else { dump(); console.log('\n' + '='.repeat(72) + '\n'); census(join(WEBGPU, 'game-seams-leftover.ts')); }
