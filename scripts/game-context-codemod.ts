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
    for (const decl of decls) {
      if (!ts.isIdentifier(decl.name)) continue;
      const path = map[decl.name.text];
      if (!path) continue;
      if (decls.length !== 1) {
        throw new Error(`multi-declarator statement for '${decl.name.text}' — split it by hand first`);
      }
      owned.add(decl.name.text);
      // `let foo: Bar = x` -> `ctx.s.foo = x`: the type annotation goes too,
      // since an assignment cannot carry one.
      const end = decl.type ? decl.type.getEnd() : decl.name.getEnd();
      const start = stmt.getStart(sf);

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
    }
  }

  // Pass 2 — references. Walk main(), tracking scopes that redeclare an owned
  // name so shadowed uses are left alone.
  const shadowed: Array<Set<string>> = [];
  const isShadowed = (name: string) => shadowed.some(s => s.has(name));
  const isCovered = (pos: number) => covered.some(([a, b]) => pos >= a && pos < b);

  const collectShadows = (node: ts.Node): Set<string> => {
    const names = new Set<string>();
    const scan = (child: ts.Node): void => {
      if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && owned.has(child.name.text)) {
        names.add(child.name.text);
      }
      if (ts.isParameter(child) && ts.isIdentifier(child.name) && owned.has(child.name.text)) {
        names.add(child.name.text);
      }
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

      const isDeclName = ts.isVariableDeclaration(p) && p.name === node;
      const isPropName = (ts.isPropertyAssignment(p) && p.name === node)
        || (ts.isPropertyAccessExpression(p) && p.name === node)
        || (ts.isMethodDeclaration(p) && p.name === node);
      const isParam = ts.isParameter(p) && p.name === node;

      if (ts.isShorthandPropertyAssignment(p)) {
        // { probeWeight } -> { probeWeight: ctx.probes.weight }
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `${node.text}: ctx.${path}` });
      } else if (!isDeclName && !isPropName && !isParam) {
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
