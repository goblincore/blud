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
import { importTable, importsFor, localTypes, usedLocalTypes, missingLocalValues } from './lib/game-main-deps';

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

  // Types declared INSIDE main() (TracerView, BakedChunk, ChunkTemplate…) are
  // neither importable nor module-scope, so a function using one could never be
  // a leaf. A type is inert: it travels with the move, exported so main() can
  // keep annotating with it, and is cut from main() (which imports it back).
  const mainTypes = new Map<string, { text: string; start: number; end: number }>();
  for (const st of main.body!.statements) {
    if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) {
      mainTypes.set(st.name.text, {
        text: source.slice(st.getStart(sf), st.getEnd())
          .split('\n').map(l => l.startsWith('  ') ? l.slice(2) : l).join('\n'),
        start: st.getFullStart(), end: st.getEnd(),
      });
    }
  }

  const cuts: Array<{ start: number; end: number }> = [];
  const decls: Array<{ node: ts.FunctionDeclaration; name: string }> = [];
  const arrows: Array<{ stmt: ts.VariableStatement; decl: ts.VariableDeclaration; fn: ts.ArrowFunction; name: string }> = [];
  const consts: string[] = [];
  /** Statement rewrites in main() that are NOT cuts (a partly-moved `const` list). */
  const rewrites: Edit[] = [];
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
    // `const f = (…) => …`, which is most of what is left in main(). Hoisting
    // differs (a module function is hoisted, a const arrow is not), which is
    // safe in the direction we move it: out of a closure into module scope.
    if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
      const d = st.declarationList.declarations[0];
      if (ts.isIdentifier(d.name) && want.has(d.name.text) && d.initializer
        && ts.isArrowFunction(d.initializer)) {
        arrows.push({ stmt: st, decl: d, fn: d.initializer, name: d.name.text });
        linesMoved += lineSpan(st);
        cuts.push({ start: st.getFullStart(), end: st.getEnd() });
        continue;
      }
    }
    if (ts.isVariableStatement(st)) {
      // ONE statement can declare several names (`const _bfA = …, _bfB = …;`).
      // Handle it as a statement, not once per name: cutting per name deleted
      // overlapping ranges and left game-main.ts syntactically broken.
      const decls = st.declarationList.declarations;
      const taken = decls.filter(d => ts.isIdentifier(d.name) && wantConst.has(d.name.text));
      if (!taken.length) continue;
      const kw = st.declarationList.flags & ts.NodeFlags.Const ? 'const'
        : st.declarationList.flags & ts.NodeFlags.Let ? 'let' : 'var';
      const kept = decls.filter(d => !taken.includes(d));
      // Doc comment travels only when the whole statement does.
      const lead = kept.length ? '' : source.slice(st.getFullStart(), st.getStart(sf))
        .replace(/^\n+/, '').split('\n').map(l => l.startsWith('  ') ? l.slice(2) : l).join('\n');
      for (const d of taken) {
        const text = source.slice(d.getStart(sf), d.getEnd())
          .split('\n').map(l => l.startsWith('  ') ? l.slice(2) : l).join('\n');
        consts.push(`${lead}export ${kw} ${text};`);
      }
      linesMoved += lineSpan(st);
      if (kept.length) {
        // Rewrite the statement with the survivors; main() still needs them.
        const rest = kept.map(d => source.slice(d.getStart(sf), d.getEnd())).join(', ');
        rewrites.push({ start: st.getStart(sf), end: st.getEnd(), text: `${kw} ${rest};` });
      } else {
        cuts.push({ start: st.getFullStart(), end: st.getEnd() });
      }
    }
  }

  if (decls.length + arrows.length !== fnNames.length) {
    throw new Error(`expected ${fnNames.length} functions, matched ${decls.length + arrows.length}`);
  }

  // Which main()-scope types the moved bodies reference — they come along.
  const mentions = (text: string, name: string): boolean =>
    new RegExp(`(^|[^A-Za-z0-9_.$])${name}([^A-Za-z0-9_$]|$)`).test(text);
  const carriedNames = new Set<string>();
  // Transitive: a carried type can reference another main()-scope type
  // (BakedChunk -> ChunkTemplate), and that one must come too.
  let frontier = [...decls.map(d => d.node.getText(sf)), ...arrows.map(a => a.stmt.getText(sf))];
  while (frontier.length) {
    const next: string[] = [];
    for (const [name, t] of mainTypes) {
      if (carriedNames.has(name)) continue;
      if (frontier.some(text => mentions(text, name))) { carriedNames.add(name); next.push(t.text); }
    }
    frontier = next;
  }
  const carriedMainTypes = [...mainTypes].filter(([name]) => carriedNames.has(name));
  for (const [name] of carriedMainTypes) moved.add(name);
  // Cut them here, BEFORE main() is rebuilt below.
  for (const [, t] of carriedMainTypes) cuts.push({ start: t.start, end: t.end });

  // THE LEAF CHECK. Report every offender of every function in one message: the
  // point is to plan the next wave, not to bisect one name per run.
  if (!opts.force) {
    const offenders = [
      ...decls.map(d => ({ name: d.name, node: d.node as ts.Node })),
      ...arrows.map(a => ({ name: a.name, node: a.fn as ts.Node })),
    ].map(d => ({ name: d.name, free: freeNames(d.node, sf, scope, moved) }))
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
  /** Does an ancestor scope between `n` and main() declare `name` itself? Then
   *  this identifier is a DIFFERENT binding and must not be rewritten: game-main
   *  has `function fire(barrels)` and, in a bench loop, `let fire: 0 | 1 | 2`. */
  const shadowed = (n: ts.Node, name: string): boolean => {
    for (let p = n.parent; p && p !== main && p !== main.body; p = p.parent) {
      const declares = (node: ts.Node): boolean => {
        let hit = false;
        node.forEachChild(c => {
          if (hit) return;
          if (ts.isVariableStatement(c)) {
            for (const d of c.declarationList.declarations) {
              if (ts.isIdentifier(d.name) && d.name.text === name) hit = true;
            }
          }
          // The moved declaration itself is not a shadow of itself.
          if ((ts.isFunctionDeclaration(c) || ts.isClassDeclaration(c)) && c.name?.text === name
            && !want.has(name)) hit = true;
        });
        if (ts.isFunctionLike(node)) {
          for (const prm of node.parameters) if (ts.isIdentifier(prm.name) && prm.name.text === name) hit = true;
        }
        return hit;
      };
      if (declares(p)) return true;
    }
    return false;
  };
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && want.has(n.expression.text)
      && !shadowed(n.expression, n.expression.text)) {
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
    if (ts.isIdentifier(n) && want.has(n.text) && !shadowed(n, n.text)) {
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

  // Arrow -> function declaration. The parameter list, return type, async and
  // the body come across verbatim; an expression body gains a `return`.
  const arrowBodies = arrows.map(({ stmt, fn, name }) => {
    const c = cuts.find(x => x.start === stmt.getFullStart())!;
    const local = [...inside(c), ...rebindEdits(fn)];
    const deindent = (t: string): string => t.split('\n').map(l => l.startsWith('  ') ? l.slice(2) : l).join('\n');
    const piece = (node: ts.Node): string => deindent(applyEdits(source.slice(node.getStart(sf), node.getEnd()),
      local.filter(e => e.start >= node.getStart(sf) && e.end <= node.getEnd()), node.getStart(sf)));
    const params = fn.parameters.map(p => piece(p));
    const ret = fn.type ? `: ${piece(fn.type)}` : '';
    const asy = fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';
    const doc = deindent(source.slice(stmt.getFullStart(), stmt.getStart(sf)).replace(/^\n+/, ''));
    const sig = `${doc}export ${asy}function ${name}(${['ctx: GameContext', ...params].join(', ')})${ret} `;
    const body = ts.isBlock(fn.body)
      ? piece(fn.body)
      : `{\n  return ${piece(fn.body)};\n}`;
    return sig + body;
  });

  // game-main.ts must import back everything that just left it, plus withCtx if
  // anything is now wrapped.
  const back = [...fnNames, ...constNames, ...carriedMainTypes.map(([n]) => n)].sort();
  const needsWithCtx = bareRefs > 0 && !/^import \{ withCtx \} from '\.\/game-context';$/m.test(source);
  const importBack = `import { ${back.join(', ')} } from './${moduleName}';\n`
    + (needsWithCtx ? `import { withCtx } from './game-context';\n` : '');
  const lastImport = [...source.matchAll(/^import .*?;$/gms)].at(-1);
  if (!lastImport) throw new Error('no import block found in game-main.ts');
  const insertAt = lastImport.index! + lastImport[0].length + 1;

  const outside = edits.filter(e => !cuts.some(c => e.start >= c.start && e.end <= c.end));
  const out = applyEdits(source, [
    ...outside,
    ...rewrites,
    ...cuts.map(c => ({ ...c, text: '' })),
    { start: insertAt, end: insertAt, text: importBack },
  ]);

  // What the moved code needs where it lands: game-main's own import lines for
  // the names it uses, plus a copy of any module-scope TYPE it references. A
  // module-scope VALUE cannot be copied (that forks it) or imported (that makes
  // a cycle), so the tool refuses and names it — wave 1 shipped --imports by
  // hand and a forgotten one only showed up as a tsc error later.
  const typeBlocks = carriedMainTypes.map(([, t]) => `export ${t.text}`);
  const fragments = [...bodies, ...arrowBodies, ...consts, ...typeBlocks];
  const accounted = new Set([...moved, 'ctx']);
  if (!opts.force) {
    const missing = missingLocalValues(fragments, sf, accounted);
    if (missing.length) {
      throw new Error(
        `references module-scope values of game-main.ts that cannot travel: ${missing.join(', ')}\n`
        + 'Move each to its own module first (or --force if you are adding it by hand).',
      );
    }
  }
  // Never import from THIS module: an earlier wave's functions are imported back
  // into game-main from here, and inferring those would make the module import
  // itself (TS2440).
  const table = importTable(sf);
  for (const [name, e] of table) if (e.mod === `./${moduleName}`) accounted.add(name);
  const inferred = importsFor(fragments, table, accounted);
  const types = usedLocalTypes(fragments, localTypes(source, sf));
  const needsWrapper = fragments.some(f => f.includes('withCtx('));

  const module = [
    `// src/lab/sdf-zombie/webgpu/${moduleName}.ts`,
    `//`,
    `// Extracted from game-main.ts's main() closure. Each function takes the`,
    `// GameContext explicitly instead of capturing main()'s scope.`,
    `//`,
    `// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md`,
    ``,
    needsWrapper
      ? `import { withCtx, type GameContext } from './game-context';`
      : `import type { GameContext } from './game-context';`,
    ...inferred,
    ...extraImports,
    ``,
    ...types.map(t => t + '\n'),
    ...typeBlocks.map(t => t + '\n'),
    ...consts, consts.length ? '' : '',
    ...bodies.map(b => b + '\n'),
    ...arrowBodies.map(b => b + '\n'),
  ].join('\n');

  return {
    module: opts.existing ? mergeModule(opts.existing, module) : module,
    main: out, linesMoved, callSites, bareRefs,
  };
}

/** Append a freshly generated module onto an existing one: one header, one set
 *  of imports (merged per specifier), bodies in order. Wave 1 spawned
 *  game-render-leaves2 / game-world-leaves3 only because the writer could not do
 *  this. Imports are read with the PARSER, not a line pattern: the wave-1
 *  modules have imports with no trailing semicolon and multi-line named lists,
 *  which a pattern silently left in the body and then duplicated. */
export function mergeModule(existing: string, generated: string): string {
  interface Spec { star?: string; def?: string; named: Array<{ name: string; typeOnly: boolean }> }
  const specs = new Map<string, Spec>();
  const order: string[] = [];
  const parse = (src: string): { header: string[]; body: string } => {
    const sf = ts.createSourceFile('m.ts', src, ts.ScriptTarget.ES2022, true);
    const cuts: Array<{ start: number; end: number }> = [];
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st)) continue;
      // getStart, NOT getFullStart: the leading trivia of the first import is
      // the module's header comment, and cutting it loses the header.
      cuts.push({ start: st.getStart(sf), end: st.getEnd() });
      const mod = (st.moduleSpecifier as ts.StringLiteral).text;
      if (!specs.has(mod)) { specs.set(mod, { named: [] }); order.push(mod); }
      const e = specs.get(mod)!;
      const clause = st.importClause;
      if (!clause) continue;
      const blanket = clause.isTypeOnly;
      if (clause.name) e.def = clause.name.text;
      const b = clause.namedBindings;
      if (b && ts.isNamespaceImport(b)) e.star = b.name.text;
      if (b && ts.isNamedImports(b)) {
        for (const el of b.elements) {
          const name = el.propertyName ? `${el.propertyName.text} as ${el.name.text}` : el.name.text;
          const typeOnly = blanket || el.isTypeOnly;
          if (!e.named.some(n => n.name === name)) e.named.push({ name, typeOnly });
        }
      }
    }
    let body = src;
    for (const c of [...cuts].sort((a, b2) => b2.start - a.start)) body = body.slice(0, c.start) + body.slice(c.end);
    const lines = body.split('\n').filter((l, i, arr) => !(l.trim() === '' && arr[i - 1]?.trim() === ''));
    const end2 = lines.findIndex(l => l.trim() && !l.startsWith('//'));
    return {
      header: lines.slice(0, end2 < 0 ? lines.length : end2),
      body: lines.slice(end2 < 0 ? lines.length : end2).join('\n').replace(/^\s+/, '').replace(/\s+$/, ''),
    };
  };
  const a = parse(existing);
  const b = parse(generated);

  // Skip a body already present: re-running a wave must be idempotent.
  const fnName = /export (?:async )?function (\w+)/.exec(b.body)?.[1];
  if (fnName && new RegExp(`export (?:async )?function ${fnName}\\b`).test(a.body)) return existing;

  const importLines = order.map(mod => {
    const e = specs.get(mod)!;
    if (e.star) return `import * as ${e.star} from '${mod}';`;
    const parts = [
      ...(e.def ? [e.def] : []),
      ...(e.named.length
        ? [`{ ${e.named.map(n => (n.typeOnly ? `type ${n.name}` : n.name)).join(', ')} }`]
        : []),
    ];
    return `import ${parts.join(', ')} from '${mod}';`;
  });

  return [...a.header, '', ...importLines, '', a.body, '', b.body, ''].join('\n');
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
