// scripts/lib/game-main-deps.ts
//
// What a chunk of game-main.ts needs in order to compile somewhere else:
// its import lines, the module-scope TYPES it references (copied, since they are
// not exported), and the module-scope VALUES it references (which cannot be
// copied and must be moved deliberately — the tools refuse instead).
//
// Shared by scripts/extract-leaf.ts and scripts/extract-seam-group.ts. The
// import inference lived only in the latter, which is why extract-leaf needed
// every import spelled out by hand (`--imports`) and produced modules that did
// not compile when one was forgotten.
import * as ts from 'typescript';

export interface ImportEntry {
  mod: string;
  typeOnly: boolean;
  star?: boolean;
  /** `import X from '…'` rather than `import { X } from '…'`. */
  isDefault?: boolean;
  /** Original export name when the import is aliased: `{ X as Y }`. */
  propertyName?: string;
}

/** name -> import entry for every top-level import in the file. Moved code
 *  references these freely; they are NOT "free names" in the closure sense,
 *  which is why a free-name scan never sees them. */
export function importTable(sf: ts.SourceFile): Map<string, ImportEntry> {
  const t = new Map<string, ImportEntry>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    const mod = (st.moduleSpecifier as ts.StringLiteral).text;
    const clause = st.importClause;
    const blanket = clause.isTypeOnly;
    if (clause.name) t.set(clause.name.text, { mod, typeOnly: blanket, isDefault: true });
    const b = clause.namedBindings;
    if (b && ts.isNamedImports(b)) {
      for (const el of b.elements) {
        t.set(el.name.text, { mod, typeOnly: blanket || el.isTypeOnly, propertyName: el.propertyName?.text });
      }
    } else if (b && ts.isNamespaceImport(b)) {
      t.set(b.name.text, { mod, typeOnly: blanket, star: true });
    }
  }
  return t;
}

/** Identifiers a fragment references that are not property names. The fragment
 *  is parsed, so a name inside a string or comment cannot match — the reason
 *  this is an AST walk and not a regex. */
export function referencedNames(fragment: string): Set<string> {
  const sf = ts.createSourceFile('frag.ts', fragment, ts.ScriptTarget.ES2022, true);
  const out = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      const p = n.parent as ts.Node & { name?: ts.Node; propertyName?: ts.Node };
      const isName = p.name === n || p.propertyName === n;
      const isMem = ts.isPropertyAccessExpression(p) && p.name === n;
      if (!isName && !isMem) out.add(n.text);
    }
    n.forEachChild(walk);
  };
  walk(sf);
  return out;
}

/** Import statements covering every imported name the fragments use, one line
 *  per specifier, aliases re-emitted as `{ X as Y }` (a bare `{ Y }` would not
 *  resolve). `skip` drops names the caller provides another way. */
export function importsFor(
  fragments: readonly string[], table: Map<string, ImportEntry>, skip: ReadonlySet<string> = new Set(),
): string[] {
  const used = new Set<string>();
  for (const f of fragments) {
    for (const n of referencedNames(f)) if (table.has(n) && !skip.has(n)) used.add(n);
  }
  const byMod = new Map<string, { def?: string; value: string[]; type: string[] }>();
  const out: string[] = [];
  for (const name of [...used].sort()) {
    const e = table.get(name)!;
    if (e.star) { out.push(`import * as ${name} from '${e.mod}';`); continue; }
    const g = byMod.get(e.mod) ?? { value: [], type: [] };
    if (e.isDefault) { g.def = name; byMod.set(e.mod, g); continue; }
    const spec = e.propertyName ? `${e.propertyName} as ${name}` : name;
    (e.typeOnly ? g.type : g.value).push(spec);
    byMod.set(e.mod, g);
  }
  for (const [mod, g] of [...byMod].sort()) {
    const named = [...g.value, ...g.type.map(t => `type ${t}`)];
    // A default import is its own clause: `import def, { named } from '…'`.
    const parts = [...(g.def ? [g.def] : []), ...(named.length ? [`{ ${named.join(', ')} }`] : [])];
    out.push(`import ${parts.join(', ')} from '${mod}';`);
  }
  return out;
}

/** Module-scope `type X = …` / `interface X {}`, which are not exported and so
 *  must be COPIED into the new module. */
export function localTypes(source: string, sf: ts.SourceFile): Map<string, string> {
  const t = new Map<string, string>();
  for (const st of sf.statements) {
    if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) {
      t.set(st.name.text, source.slice(st.getStart(sf), st.getEnd()));
    }
  }
  return t;
}

export function usedLocalTypes(fragments: readonly string[], types: Map<string, string>): string[] {
  const used = new Set<string>();
  for (const f of fragments) {
    const names = referencedNames(f);
    for (const [name] of types) if (names.has(name)) used.add(name);
  }
  return [...used].sort().map(n => types.get(n)!);
}

/** Module-scope VALUES (const/let/function/class/enum) declared in the file and
 *  not exported. Copying one would fork it; importing it from game-main makes a
 *  cycle. So a tool that finds a moved chunk referencing one must refuse and
 *  name it: the fix is to move that declaration to its own module first. */
export function localValues(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const exported = (st: ts.Statement): boolean =>
    !!(ts.canHaveModifiers(st) && ts.getModifiers(st)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
  for (const st of sf.statements) {
    if (exported(st)) continue;
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
    }
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) {
      names.add(st.name.text);
    }
  }
  return names;
}

/** Which module-scope values the fragments reference, ignoring names the caller
 *  already accounts for (the moved set, locals, ctx, …). */
export function missingLocalValues(
  fragments: readonly string[], sf: ts.SourceFile, accounted: ReadonlySet<string>,
): string[] {
  const vals = localValues(sf);
  const hits = new Set<string>();
  for (const f of fragments) {
    for (const n of referencedNames(f)) if (vals.has(n) && !accounted.has(n)) hits.add(n);
  }
  return [...hits].sort();
}
