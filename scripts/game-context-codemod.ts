// scripts/game-context-codemod.ts
//
// Rewrites game-main.ts's main()-scope bindings into ctx.<slice>.<field>.
//
// SCOPE-AWARE, NOT TEXTUAL. A regex rename would corrupt shadowed identifiers,
// property names, string contents and comment text. This walks the AST and only
// rewrites identifiers that resolve to the main()-scope declaration.
//
// THE RULE: lines do not move, lines are only rewritten. A declaration becomes
// an assignment AT ITS ORIGINAL LINE, so initialization order is preserved by
// construction and no binding can be read before it was written.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md
import * as ts from 'typescript';

export type BindingMap = Readonly<Record<string, string>>;

interface Edit { start: number; end: number; text: string; }

/** Declarations whose inline TYPE ANNOTATION spanned several lines. The
 *  annotation cannot survive the rewrite (an assignment carries no type), so
 *  those lines collapse and the file gets shorter. That type belongs in the
 *  slice interface instead — these are reported so the drop is auditable
 *  rather than silent, and so each one can be checked against its slice. */
export interface CollapsedDecl {
  name: string;
  line: number;
  linesLost: number;
}

export interface CodemodReport {
  collapsed: CollapsedDecl[];
  /** Total lines the rewrite removes. Expected line delta for the file. */
  linesLost: number;
}

export function applyCodemod(source: string, map: BindingMap, report?: CodemodReport): string {
  const sf = ts.createSourceFile('game-main.ts', source, ts.ScriptTarget.ES2022, true);
  const main = findMain(sf);
  if (!main?.body) return source;

  const edits: Edit[] = [];
  const owned = new Set<string>();
  /** Spans rewritten by pass 1. Pass 2 must not edit inside one, or the two
   *  edits overlap and corrupt each other. */
  const covered: Array<[number, number]> = [];

  // Pass 1 — declarations in the immediate main() body scope.
  //
  // Replace only the DECLARATION PREFIX (`let foo`, or `let foo: Bar`), never
  // the whole statement: the initializer may itself reference another owned
  // binding, and pass 2 has to be able to rewrite inside it.
  for (const stmt of main.body.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const decls = stmt.declarationList.declarations;

    const named = decls.filter(ts.isVariableDeclaration).filter(d => ts.isIdentifier(d.name));
    const hits = named.filter(d => map[(d.name as ts.Identifier).text]);
    if (hits.length === 0) continue;

    // A MIXED statement (`let a = 0, b = 1;` where only `a` is mapped) cannot be
    // rewritten: dropping the keyword would leave `b` undeclared, and keeping it
    // would leave `a` declared. Split it by hand. All-mapped is fine — the
    // result is a comma expression statement, which is valid.
    if (hits.length !== decls.length) {
      const names = named.map(d => (d.name as ts.Identifier).text).join(', ');
      throw new Error(`mixed multi-declarator statement [${names}] — only some are mapped; split it by hand first`);
    }

    decls.forEach((decl, i) => {
      if (!ts.isIdentifier(decl.name)) return;
      const path = map[decl.name.text];
      owned.add(decl.name.text);
      // The first declarator's span starts at the statement, which swallows the
      // `let`/`const` keyword; later ones start at their own name.
      const start = i === 0 ? stmt.getStart(sf) : decl.getStart(sf);
      const end = decl.type ? decl.type.getEnd() : decl.name.getEnd();

      if (report) {
        const a = sf.getLineAndCharacterOfPosition(start).line;
        const b = sf.getLineAndCharacterOfPosition(end).line;
        if (b > a) {
          report.collapsed.push({ name: decl.name.text, line: a + 1, linesLost: b - a });
          report.linesLost += b - a;
        }
      }

      edits.push({ start, end, text: `ctx.${path}` });
      covered.push([start, end]);
    });
  }

  // Pass 2 — references. Walk main(), tracking scopes that redeclare an owned
  // name so shadowed uses are left alone.
  const shadowed: Array<Set<string>> = [];
  const isShadowed = (name: string) => shadowed.some(s => s.has(name));
  const isCovered = (pos: number) => covered.some(([a, b]) => pos >= a && pos < b);

  const collectShadows = (node: ts.Node): Set<string> => {
    const names = new Set<string>();
    // A declaration's `name` is an Identifier OR a binding pattern. Missing the
    // pattern case let `const { target, coverage } = ...` shadow nothing, so an
    // inner `coverage` was rewritten to ctx.world.coverage — a silently wrong
    // value of an entirely different type.
    const addName = (n: ts.BindingName): void => {
      if (ts.isIdentifier(n)) {
        if (owned.has(n.text)) names.add(n.text);
        return;
      }
      // ObjectBindingPattern | ArrayBindingPattern
      for (const el of n.elements) {
        if (ts.isBindingElement(el)) addName(el.name);
      }
    };

    const scan = (child: ts.Node): void => {
      if (ts.isVariableDeclaration(child)) addName(child.name);
      if (ts.isParameter(child)) addName(child.name);
      // Do not descend into nested functions; they get their own scope frame.
      if (!isFunctionLike(child)) child.forEachChild(scan);
    };
    node.forEachChild(scan);
    return names;
  };

  const visit = (node: ts.Node): void => {
    const opensScope = isFunctionLike(node) && node !== main;
    if (opensScope) shadowed.push(collectShadows(node));

    if (ts.isIdentifier(node) && owned.has(node.text)
      && !isShadowed(node.text) && !isCovered(node.getStart(sf))) {
      const path = map[node.text];
      const p = node.parent;

      // Only rewrite identifiers in EXPRESSION position. Enumerating the
      // name positions one by one is how this goes wrong: the first version
      // listed PropertyAssignment / PropertyAccessExpression / MethodDeclaration
      // and still corrupted `get demoSeed() {...}` into `get ctx.demo.seed()`,
      // because accessors were not on the list. So the rule is general: if the
      // parent node points at this identifier as its NAME, it is a declaration
      // or member name, not a reference.
      const named = p as unknown as { name?: ts.Node; propertyName?: ts.Node };
      const isNamePosition = named.name === node || named.propertyName === node;
      // Type positions: `Foo` in `let x: Foo` / `A.B` / `typeof x`.
      const isTypePosition = ts.isTypeReferenceNode(p) || ts.isQualifiedName(p)
        || ts.isTypeQueryNode(p) || ts.isTypePredicateNode(p);
      // import/export bindings and labels are never expressions either.
      const isSpecifier = ts.isImportSpecifier(p) || ts.isExportSpecifier(p)
        || ts.isImportClause(p) || ts.isNamespaceImport(p);
      const isLabel = ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p);

      if (ts.isShorthandPropertyAssignment(p)) {
        // { probeWeight } -> { probeWeight: ctx.probes.weight }
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `${node.text}: ctx.${path}` });
      } else if (!isNamePosition && !isTypePosition && !isSpecifier && !isLabel) {
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `ctx.${path}` });
      }
    }

    node.forEachChild(visit);
    if (opensScope) shadowed.pop();
  };

  visit(main);

  return applyEdits(source, edits);
}

function isFunctionLike(n: ts.Node): boolean {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)
    || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
}

function findMain(sf: ts.SourceFile): ts.FunctionDeclaration | undefined {
  let found: ts.FunctionDeclaration | undefined;
  sf.forEachChild(n => { if (ts.isFunctionDeclaration(n) && n.name?.text === 'main') found = n; });
  return found;
}

function applyEdits(source: string, edits: Edit[]): string {
  let out = source;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/**
 * NARROWING REPAIRS.
 *
 * TypeScript narrows a `const x: T | null` after `if (x)` or `x ? … : …` and
 * keeps that narrowing inside closures, because a const cannot change. It will
 * NOT do the same for `ctx.a.b`: a property could be reassigned by any call, so
 * narrowing is discarded at every function boundary.
 *
 * These sites are inside a proven-non-null branch in the ORIGINAL code, and the
 * runtime behaviour is unchanged — only TypeScript's ability to prove it is.
 * The `!` restores the original guarantee. Applied here, after the AST rewrite,
 * so `--write` stays reproducible from a clean checkout instead of needing a
 * hand-edit that the next run would silently drop.
 *
 * Each entry MUST be justified by a narrowing guard in game-main.ts. Do not add
 * one to silence an error you have not traced back to such a guard.
 */
const NARROWING_REPAIRS: ReadonlyArray<readonly [string, string, string]> = [
  // guarded by `if (deferredApi) {` (original line 1143), used in a closure
  ['ctx.boot.deferredApi.render(camera)', 'ctx.boot.deferredApi!.render(camera)',
   'inside if (deferredApi) at original 1143'],
  // guarded by the `telemetryControls ? { … }` ternary (original line 10214)
  ['ctx.telemetry.controls.start()', 'ctx.telemetry.controls!.start()',
   'inside telemetryControls ? at original 10214'],
  ['ctx.telemetry.controls.stop()', 'ctx.telemetry.controls!.stop()',
   'inside telemetryControls ? at original 10214'],
  ['ctx.telemetry.controls.mark()', 'ctx.telemetry.controls!.mark()',
   'inside telemetryControls ? at original 10214'],
  ['ctx.telemetry.controls.lastCapture()', 'ctx.telemetry.controls!.lastCapture()',
   'inside telemetryControls ? at original 10214'],
];

/** Apply the repairs above, failing loudly if one no longer matches — a stale
 *  repair means the code moved and the justification needs rechecking. */
export function applyNarrowingRepairs(source: string): string {
  let out = source;
  for (const [from, to, why] of NARROWING_REPAIRS) {
    if (!out.includes(from)) {
      throw new Error(`stale narrowing repair (${why}): '${from}' not found — recheck the guard`);
    }
    out = out.split(from).join(to);
  }
  return out;
}

if (process.argv[1]?.endsWith('game-context-codemod.ts')) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const slices = await import('../src/lab/sdf-zombie/webgpu/game-context-bindings');
  const map: Record<string, string> = Object.assign({}, ...Object.values(slices));
  const PATH = 'src/lab/sdf-zombie/webgpu/game-main.ts';
  const src = readFileSync(PATH, 'utf8');
  const report: CodemodReport = { collapsed: [], linesLost: 0 };
  const out = applyNarrowingRepairs(applyCodemod(src, map, report));

  const a = src.split('\n').length;
  const b = out.split('\n').length;
  console.log(`bindings mapped   : ${Object.keys(map).length}`);
  console.log(`lines ${a} -> ${b}   (delta ${b - a})`);
  console.log(`reported linesLost: ${report.linesLost}`);
  console.log(`accounted exactly : ${a - b === report.linesLost}`);
  for (const c of report.collapsed) {
    console.log(`  collapsed ${c.name} @${c.line} (-${c.linesLost})`);
  }
  console.log(`ctx. references   : ${(out.match(/\bctx\./g) ?? []).length}`);

  if (a - b !== report.linesLost) {
    console.error('REFUSING: line delta is not fully explained by reported collapses.');
    process.exit(1);
  }

  if (process.argv.includes('--write')) {
    writeFileSync(PATH, out);
    console.log(`\nwrote ${PATH}`);
  } else {
    console.log('\ndry run — pass --write to apply');
  }
}
