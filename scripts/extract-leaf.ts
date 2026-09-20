// scripts/extract-leaf.ts
//
// Moves main()-scope LEAF functions out of game-main.ts into a module, giving
// each an explicit `ctx: GameContext` first parameter in place of the closure
// capture, and rewriting every call site.
//
//   npx tsx scripts/extract-leaf.ts <module-basename> <fn>[,<fn>...] [--consts A,B] [--write]
//   npx tsx scripts/extract-leaf.ts --leaves      # plan a wave: leaves, and what blocks the rest
//   ... --rebind scene=ctx.boot.handle.scene,camera=ctx.boot.handle.camera
//
// --rebind rewrites a free name inside the MOVED body to a ctx path, for names
// main() only destructured out of ctx (`const { scene, camera } = ctx.boot.handle`).
// Such a name does not block the move; without this most of game-main's
// functions are permanently "blocked" on scene/camera. main()'s own uses of the
// name are untouched. --leaves takes the same flag, to plan against it.
//
// A leaf is a function with no free main()-scope functions or vars (see
// `npx tsx scripts/slice-extract.ts --functions`). Anything else needs its
// dependencies extracted first — this is a bottom-up process, and the tool now
// REFUSES a non-leaf by name rather than leaving it to `tsc` (leaves wave 1:
// the header claimed it refused and it did not). `--consts` moves a const along
// with the function; `--force` overrides the refusal for a case you have
// reasoned about.
//
// Rewrites, all driven off AST positions rather than text patterns:
//   f(a)        -> f(ctx, a)          calls, including between co-moved functions
//   { f }       -> { f: withCtx(ctx, f) }   shorthand property
//   g(f)        -> g(withCtx(ctx, f))       any other reference passed as a value
// `withCtx` (game-context.ts) keeps the wrapper's parameter types, which a bare
// `(...a) => f(ctx, ...a)` loses wherever the receiver is typed `unknown`.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md
import * as ts from 'typescript';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const GAME_MAIN = 'src/lab/sdf-zombie/webgpu/game-main.ts';

export interface Extraction {
  /** New module source. */
  module: string;
  /** Rewritten game-main.ts. */
  main: string;
  linesMoved: number;
  callSites: number;
  /** References passed as values, wrapped in withCtx to keep their ctx. */
  bareRefs: number;
}

interface Edit { start: number; end: number; text: string }

function findMain(sf: ts.SourceFile): ts.FunctionDeclaration {
  let found: ts.FunctionDeclaration | undefined;
  sf.forEachChild(n => { if (ts.isFunctionDeclaration(n) && n.name?.text === 'main') found = n; });
  if (!found) throw new Error('main() not found');
  return found;
}

/** Every name main() declares at its own top level — the closure the extracted
 *  functions must no longer reach into. */
function mainScopeNames(main: ts.FunctionDeclaration): Set<string> {
  const names = new Set<string>();
  const addBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) { names.add(name.text); return; }
    for (const el of name.elements) {
      if (ts.isBindingElement(el)) addBinding(el.name);
    }
  };
  for (const st of main.body!.statements) {
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) addBinding(d.name);
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) names.add(st.name.text);
    if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) names.add(st.name.text);
  }
  return names;
}

/** Names bound INSIDE a node: parameters, locals, nested functions, type
 *  parameters, catch clauses. Approximate but conservative in the safe
 *  direction — a name we wrongly think is local only ever hides a refusal we
 *  would have raised, and `tsc` still backs the move. */
function localNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const addBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) { names.add(name.text); return; }
    for (const el of name.elements) if (ts.isBindingElement(el)) addBinding(el.name);
  };
  const walk = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) addBinding(n.name as ts.BindingName);
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name) names.add(n.name.text);
    if (ts.isTypeParameterDeclaration(n)) names.add(n.name.text);
    if (ts.isCatchClause(n) && n.variableDeclaration) addBinding(n.variableDeclaration.name);
    n.forEachChild(walk);
  };
  walk(node);
  return names;
}

/** Free references from `node` into `scope`, ignoring anything bound locally,
 *  the moved set itself, and `ctx`. */
function freeNames(node: ts.Node, sf: ts.SourceFile, scope: Set<string>, moved: Set<string>): string[] {
  const local = localNames(node);
  const free = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      const p = n.parent as ts.Node & { name?: ts.Node; propertyName?: ts.Node };
      const isDeclName = p.name === n || p.propertyName === n;
      const isMember = ts.isPropertyAccessExpression(p) && p.name === n;
      if (!isDeclName && !isMember && n.text !== 'ctx'
        && scope.has(n.text) && !local.has(n.text) && !moved.has(n.text)) free.add(n.text);
    }
    n.forEachChild(walk);
  };
  walk(node);
  return [...free].sort();
}

function applyEdits(text: string, edits: readonly Edit[], offset = 0): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start - offset) + e.text + out.slice(e.end - offset);
  }
  return out;
}

export function extractLeaves(
  source: string, fnNames: readonly string[], constNames: readonly string[], moduleName: string,
  extraImports: readonly string[] = [],
  opts: { force?: boolean; rebind?: Record<string, string>; existing?: string } = {},
): Extraction {
  const sf = ts.createSourceFile('game-main.ts', source, ts.ScriptTarget.ES2022, true);
  const main = findMain(sf);
  const want = new Set(fnNames);
  const wantConst = new Set(constNames);
  const rebind = opts.rebind ?? {};
  // A REBOUND name is reachable from ctx, just spelled differently in main()
  // (`const { scene, camera } = ctx.boot.handle`). It is not a closure escape,
  // so it does not block the move — the body is rewritten to the ctx path.
  const moved = new Set([...fnNames, ...constNames, ...Object.keys(rebind)]);
  const scope = mainScopeNames(main);

  const cuts: Array<{ start: number; end: number }> = [];
  const decls: Array<{ node: ts.FunctionDeclaration; name: string }> = [];
  const consts: string[] = [];
  let linesMoved = 0;

  const lineSpan = (st: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(st.getEnd()).line - sf.getLineAndCharacterOfPosition(st.getFullStart()).line + 1;

  for (const st of main.body!.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && want.has(st.name.text)) {
      decls.push({ node: st, name: st.name.text });
      linesMoved += lineSpan(st);
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
        linesMoved += lineSpan(st);
        cuts.push({ start: st.getFullStart(), end: st.getEnd() });
      }
    }
  }

  if (decls.length !== fnNames.length) {
    throw new Error(`expected ${fnNames.length} functions, matched ${decls.length}`);
  }

  // THE LEAF CHECK. Report every offender of every function in one message: the
  // point is to plan the next wave, not to bisect one name per run.
  if (!opts.force) {
    const offenders = decls
      .map(d => ({ name: d.name, free: freeNames(d.node, sf, scope, moved) }))
      .filter(o => o.free.length);
    if (offenders.length) {
      throw new Error(
        'not a leaf — still closes over main() scope:\n'
        + offenders.map(o => `  ${o.name} -> ${o.free.join(', ')}`).join('\n')
        + '\nExtract those first, move a const with --consts, or --force if you have reasoned about it.',
      );
    }
  }

  // Reference rewrites, collected for the WHOLE of main() — including inside the
  // functions being moved, so co-moved functions calling each other pass ctx on.
  const edits: Edit[] = [];
  let callSites = 0;
  let bareRefs = 0;
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && want.has(n.expression.text)) {
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
      n.forEachChild(visit);
      return;
    }
    // A reference passed as a VALUE loses its ctx and its arity unless it is
    // bound. `{ f }` is such a reference even though the identifier is also the
    // property name — the shape leaves wave 1 missed.
    if (ts.isIdentifier(n) && want.has(n.text)) {
      const par = n.parent as ts.Node & { name?: ts.Node; expression?: ts.Node };
      if (ts.isShorthandPropertyAssignment(par) && par.name === n) {
        bareRefs++;
        edits.push({ start: n.getStart(sf), end: n.getEnd(), text: `${n.text}: withCtx(ctx, ${n.text})` });
      } else {
        const isCallee = ts.isCallExpression(par) && par.expression === n;
        const isNamePos = par.name === n;
        const isMember = ts.isPropertyAccessExpression(par) && par.name === n;
        if (!isCallee && !isNamePos && !isMember) {
          bareRefs++;
          edits.push({ start: n.getStart(sf), end: n.getEnd(), text: `withCtx(ctx, ${n.text})` });
        }
      }
    }
    n.forEachChild(visit);
  };
  visit(main);

  // Bodies: take the raw span, apply the edits that fall INSIDE it, then
  // de-indent and insert `export` + the ctx parameter at AST positions (a text
  // pattern misses `function f<T>(`, which is how registerLitChunkMaterial was
  // silently left without ctx).
  // Rebind edits are body-local: main()'s own `scene` references stay as they are.
  const rebindEdits = (node: ts.Node): Edit[] => {
    const out: Edit[] = [];
    const local = localNames(node);
    const walk = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && rebind[n.text] && !local.has(n.text)) {
        const p = n.parent as ts.Node & { name?: ts.Node; propertyName?: ts.Node };
        const isDeclName = p.name === n || p.propertyName === n;
        const isMember = ts.isPropertyAccessExpression(p) && p.name === n;
        if (!isDeclName && !isMember) out.push({ start: n.getStart(sf), end: n.getEnd(), text: rebind[n.text] });
      }
      n.forEachChild(walk);
    };
    walk(node);
    return out;
  };

  const inside = (c: { start: number; end: number }) => edits.filter(e => e.start >= c.start && e.end <= c.end);
  const bodies = decls.map(({ node }, i) => {
    const c = cuts.find(x => x.start === node.getFullStart())!;
    const declStart = (node.modifiers?.[0] ?? node).getStart(sf);
    const local: Edit[] = [
      ...inside(c),
      ...rebindEdits(node),
      { start: declStart, end: declStart, text: 'export ' },
      // parameters.pos is just after `(`, so this lands after any <T> list.
      { start: node.parameters.pos, end: node.parameters.pos,
        text: node.parameters.length ? 'ctx: GameContext, ' : 'ctx: GameContext' },
    ];
    void i;
    const raw = applyEdits(source.slice(c.start, c.end), local, c.start).replace(/^\n+/, '');
    return raw.split('\n').map(l => l.startsWith('  ') ? l.slice(2) : l).join('\n');
  });

  // game-main.ts must import back everything that just left it, plus withCtx if
  // anything is now wrapped.
  const back = [...fnNames, ...constNames].sort();
  const needsWithCtx = bareRefs > 0 && !/^import \{ withCtx \} from '\.\/game-context';$/m.test(source);
  const importBack = `import { ${back.join(', ')} } from './${moduleName}';\n`
    + (needsWithCtx ? `import { withCtx } from './game-context';\n` : '');
  const lastImport = [...source.matchAll(/^import .*?;$/gms)].at(-1);
  if (!lastImport) throw new Error('no import block found in game-main.ts');
  const insertAt = lastImport.index! + lastImport[0].length + 1;

  const outside = edits.filter(e => !cuts.some(c => e.start >= c.start && e.end <= c.end));
  const out = applyEdits(source, [
    ...outside,
    ...cuts.map(c => ({ ...c, text: '' })),
    { start: insertAt, end: insertAt, text: importBack },
  ]);

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

  return {
    module: opts.existing ? mergeModule(opts.existing, module) : module,
    main: out, linesMoved, callSites, bareRefs,
  };
}

/** Append a freshly generated module onto an existing one: one header, one set
 *  of imports (named imports from the same specifier merged), bodies in order.
 *  Wave 1 spawned game-render-leaves2 / game-world-leaves3 only because the
 *  writer could not do this. */
export function mergeModule(existing: string, generated: string): string {
  const split = (src: string): { imports: string[]; body: string } => {
    const lines = src.split('\n');
    const imports: string[] = [];
    const keep: string[] = [];
    for (const l of lines) {
      if (/^import .*;$/.test(l)) imports.push(l); else keep.push(l);
    }
    return { imports, body: keep.join('\n') };
  };
  const a = split(existing);
  const b = split(generated);

  // Merge named imports per specifier; keep everything else verbatim, in order.
  const named = new Map<string, { typeOnly: boolean; names: string[] }>();
  const other: string[] = [];
  for (const line of [...a.imports, ...b.imports]) {
    const m = /^import (type )?\{ (.*) \} from '(.*)';$/.exec(line);
    if (!m) { if (!other.includes(line)) other.push(line); continue; }
    const key = `${m[1] ? 'type ' : ''}${m[3]}`;
    const e = named.get(key) ?? { typeOnly: !!m[1], names: [] };
    for (const n of m[2].split(',').map(x => x.trim()).filter(Boolean)) if (!e.names.includes(n)) e.names.push(n);
    named.set(key, e);
  }
  const importLines = [
    ...[...named].map(([key, e]) =>
      `import ${e.typeOnly ? 'type ' : ''}{ ${e.names.join(', ')} } from '${key.replace(/^type /, '')}';`),
    ...other,
  ];

  // The generated body carries its own header comment; drop it on append.
  const bodyB = b.body.replace(/^(\/\/[^\n]*\n)+/, '');
  const head = a.body.replace(/\s+$/, '');
  const tail = bodyB.replace(/^\s+/, '');
  // Skip a body that is already present (re-running a wave must be idempotent).
  const fnName = /export (?:async )?function (\w+)/.exec(tail)?.[1];
  if (fnName && new RegExp(`export (?:async )?function ${fnName}\\b`).test(head)) return existing;

  const headLines = head.split('\n');
  const firstImport = importLines.length;
  void firstImport;
  // Rebuild: header comment of the EXISTING module, then merged imports, then bodies.
  const headerEnd = headLines.findIndex(l => l.trim() && !l.startsWith('//'));
  const header = headLines.slice(0, headerEnd < 0 ? headLines.length : headerEnd);
  const rest = headLines.slice(headerEnd < 0 ? headLines.length : headerEnd).join('\n').replace(/^\s+/, '');
  return [...header, '', ...importLines, '', rest, '', tail, ''].join('\n');
}

if (process.argv[1]?.endsWith('extract-leaf.ts')) {
  // --leaves: which main()-scope functions pass the leaf check, and what blocks
  // the rest. This is the wave planner — it answers the question the old
  // workflow answered by running the tool and reading tsc's fallout.
  if (process.argv[2] === '--leaves') {
    const src = readFileSync(GAME_MAIN, 'utf8');
    const sf = ts.createSourceFile('game-main.ts', src, ts.ScriptTarget.ES2022, true);
    const main = findMain(sf);
    const scope = mainScopeNames(main);
    const li = process.argv.indexOf('--rebind');
    const reboundNames = li > 0 ? process.argv[li + 1].split(',').map(kv => kv.split('=')[0]) : [];
    const leaves: string[] = [];
    const blocked: Array<[string, string[]]> = [];
    for (const st of main.body!.statements) {
      if (!ts.isFunctionDeclaration(st) || !st.name) continue;
      const free = freeNames(st, sf, scope, new Set([st.name.text, ...reboundNames]));
      if (free.length) blocked.push([st.name.text, free]); else leaves.push(st.name.text);
    }
    console.log(`leaves (${leaves.length}):`);
    for (const n of leaves) console.log(`   ${n}`);
    console.log(`\nblocked (${blocked.length}):`);
    for (const [n, free] of blocked) console.log(`   ${n.padEnd(28)} ${free.join(', ')}`);
    process.exit(0);
  }
  const [moduleName, fnCsv] = process.argv.slice(2);
  const ci = process.argv.indexOf('--consts');
  const constNames = ci > 0 ? process.argv[ci + 1].split(',') : [];
  const fnNames = fnCsv.split(',');
  const src = readFileSync(GAME_MAIN, 'utf8');
  const ii = process.argv.indexOf('--imports');
  const extraImports = ii > 0 ? process.argv[ii + 1].split(';') : [];
  const ri = process.argv.indexOf('--rebind');
  const rebind = ri > 0 ? Object.fromEntries(process.argv[ri + 1].split(',').map(kv => {
    const [k, ...v] = kv.split('=');
    return [k, v.join('=')] as const;
  })) : undefined;
  // Append when the module already exists — one file per slice, not leaves2/3.
  const modPath = `src/lab/sdf-zombie/webgpu/${moduleName}.ts`;
  const existing = existsSync(modPath) ? readFileSync(modPath, 'utf8') : undefined;
  const r = extractLeaves(src, fnNames, constNames, moduleName, extraImports,
                          { force: process.argv.includes('--force'), rebind, existing });
  console.log(`module     : ${modPath}${existing ? ' (append)' : ' (new)'}`);
  console.log(`functions  : ${fnNames.join(', ')}`);
  console.log(`consts     : ${constNames.join(', ') || '(none)'}`);
  console.log(`lines moved: ${r.linesMoved}`);
  console.log(`call sites : ${r.callSites}`);
  console.log(`bare refs  : ${r.bareRefs}`);
  console.log(`game-main  : ${src.split('\n').length} -> ${r.main.split('\n').length}`);
  if (process.argv.includes('--write')) {
    writeFileSync(modPath, r.module);
    writeFileSync(GAME_MAIN, r.main);
    console.log('\nwrote both files');
  } else {
    console.log('\ndry run — pass --write to apply');
  }
}
