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

export function applyCodemod(source: string, map: BindingMap): string {
  const sf = ts.createSourceFile('game-main.ts', source, ts.ScriptTarget.ES2022, true);
  const main = findMain(sf);
  if (!main?.body) return source;

  const edits: Edit[] = [];
  const owned = new Set<string>();

  // Pass 1 — declarations in the immediate main() body scope.
  for (const stmt of main.body.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const decls = stmt.declarationList.declarations;
    for (const decl of decls) {
      if (!ts.isIdentifier(decl.name)) continue;
      const path = map[decl.name.text];
      if (!path) continue;
      owned.add(decl.name.text);
      if (decls.length !== 1) {
        throw new Error(`multi-declarator statement for '${decl.name.text}' — split it by hand first`);
      }
      const init = decl.initializer?.getText(sf);
      edits.push({
        start: stmt.getStart(sf),
        end: stmt.getEnd(),
        text: init === undefined ? '' : `ctx.${path} = ${init};`,
      });
    }
  }

  return applyEdits(source, edits);
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
