// scripts/native-spike/naga-compat.mjs
//
// NATIVE-RENDERER SPIKE: make a captured shader acceptable to naga.
//
// The march passes its storage buffers down the call tree as
// `ptr<storage, array<...>, read>` parameters (three's wgslFn does this for
// every storage-buffer argument). Chrome's Tint allows that — WGSL's
// `unrestricted_pointer_parameters` language feature — and naga 30 does not:
//
//   Argument 'inst' ... is a pointer of space Storage ..., which can't be
//   passed into functions.
//
// Every one of those parameters is only ever bound to ONE module-scope
// buffer, so the rewrite is mechanical and changes no behaviour: drop the
// parameter and its argument everywhere, and read the global directly in the
// body. This refuses (exits 1) if any parameter is bound to two different
// buffers, where the rewrite would not be exact.
//
//   node scripts/native-spike/naga-compat.mjs <capture-dir>
//
// Reads manifest.json, writes manifest.naga.json beside it.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const fail = (msg) => { console.error(`naga-compat: ${msg}`); process.exit(1); };

// Split `a, f(b, c), d` on its top-level commas.
function splitTop(text) {
  const out = []; let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '<' || ch === '[') depth++;
    else if (ch === ')' || ch === '>' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}
// Index of the bracket closing the one at `open`.
function closing(text, open, a, b) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === a) depth++;
    else if (text[i] === b && --depth === 0) return i;
  }
  fail(`unbalanced ${a}${b} at ${open}`);
}

export function rewrite(source) {
  // Comments quote call syntax ("loadInstance(inst, gHitSlot)"); they carry
  // no meaning, so they go before anything is matched.
  let code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const parse = () => {
    const fns = [];
    const re = /\bfn\s+(\w+)\s*\(/g;
    for (let m; (m = re.exec(code));) {
      const open = m.index + m[0].length - 1;
      const close = closing(code, open, '(', ')');
      const bodyOpen = code.indexOf('{', close);
      const bodyClose = closing(code, bodyOpen, '{', '}');
      const params = splitTop(code.slice(open + 1, close)).map((p) => {
        const [, name, type] = /^\s*(\w+)\s*:\s*([\s\S]*?)\s*$/.exec(p) ?? [];
        return { name, type, text: p };
      }).filter((p) => p.name);
      fns.push({ name: m[1], open, close, bodyOpen, bodyClose, params });
    }
    return fns;
  };

  let fns = parse();
  const ptrFns = new Map(); // fn name -> [{ index, name }]
  for (const f of fns) {
    const ptrs = f.params.map((p, index) => ({ index, name: p.name, type: p.type }))
      .filter((p) => /^ptr\s*<\s*storage\b/.test(p.type));
    if (ptrs.length > 0) ptrFns.set(f.name, ptrs);
  }
  if (ptrFns.size === 0) return { code: source, changed: [] };

  // Every call of a pointer-taking function, with the function it sits in.
  const calls = [];
  for (const [name] of ptrFns) {
    const re = new RegExp(`\\b${name}\\s*\\(`, 'g');
    for (let m; (m = re.exec(code));) {
      if (/\bfn\s+$/.test(code.slice(Math.max(0, m.index - 8), m.index))) continue;
      const open = m.index + m[0].length - 1;
      const close = closing(code, open, '(', ')');
      const caller = fns.find((f) => m.index > f.bodyOpen && m.index < f.bodyClose);
      calls.push({ callee: name, open, close, args: splitTop(code.slice(open + 1, close)), caller });
    }
  }

  // Resolve each pointer parameter to the buffer expression it is bound to,
  // following parameters that are merely forwarded.
  const bound = new Map(); // `${fn}.${param}` -> Set of global expressions
  const key = (fn, param) => `${fn}.${param}`;
  for (let changed = true; changed;) {
    changed = false;
    for (const c of calls) {
      for (const p of ptrFns.get(c.callee)) {
        const arg = c.args[p.index].trim();
        const set = bound.get(key(c.callee, p.name)) ?? new Set();
        const before = set.size;
        const forwarded = c.caller && ptrFns.get(c.caller.name)?.find((q) => q.name === arg);
        if (forwarded) for (const g of bound.get(key(c.caller.name, arg)) ?? []) set.add(g);
        else if (arg.startsWith('&')) set.add(arg.slice(1).trim());
        else fail(`${c.callee}(${p.name}) is called with "${arg}", which is neither &buffer nor a forwarded parameter`);
        bound.set(key(c.callee, p.name), set);
        if (set.size !== before) changed = true;
      }
    }
  }
  for (const [fn, ptrs] of ptrFns) {
    for (const p of ptrs) {
      const set = bound.get(key(fn, p.name)) ?? new Set();
      if (set.size !== 1) fail(`${fn}(${p.name}) is bound to ${set.size} buffers (${[...set].join(', ')}) — the rewrite would not be exact`);
    }
  }

  // Apply back to front so earlier offsets stay valid: drop the arguments,
  // then per function drop the parameters and name the global in the body.
  const edits = [];
  for (const c of calls) {
    const drop = new Set(ptrFns.get(c.callee).map((p) => p.index));
    edits.push({ from: c.open + 1, to: c.close, text: c.args.filter((_, i) => !drop.has(i)).join(',') });
  }
  for (const f of fns) {
    const ptrs = ptrFns.get(f.name);
    if (!ptrs) continue;
    const drop = new Set(ptrs.map((p) => p.index));
    edits.push({ from: f.open + 1, to: f.close, text: f.params.filter((_, i) => !drop.has(i)).map((p) => p.text).join(',') });
  }
  edits.sort((a, b) => b.from - a.from);
  for (const e of edits) code = code.slice(0, e.from) + e.text + code.slice(e.to);

  fns = parse();
  const bodies = [];
  for (const f of fns) {
    const ptrs = ptrFns.get(f.name);
    if (!ptrs) continue;
    let body = code.slice(f.bodyOpen, f.bodyClose + 1);
    for (const p of ptrs) {
      const [global] = bound.get(key(f.name, p.name));
      body = body.replace(new RegExp(`\\b${p.name}\\b`, 'g'), `(&${global})`);
    }
    bodies.push({ from: f.bodyOpen, to: f.bodyClose + 1, text: body });
  }
  bodies.sort((a, b) => b.from - a.from);
  for (const e of bodies) code = code.slice(0, e.from) + e.text + code.slice(e.to);

  const changed = [...ptrFns].map(([fn, ptrs]) => `${fn}(${ptrs.map((p) => `${p.name} -> ${[...bound.get(key(fn, p.name))][0]}`).join(', ')})`);
  return { code, changed };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const dir = process.argv[2] ?? fail('usage: naga-compat.mjs <capture-dir>');
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  let total = 0;
  for (const o of Object.values(manifest.objects)) {
    if (o.kind !== 'shaderModule') continue;
    const { code, changed } = rewrite(o.desc.code);
    o.desc.code = code;
    total += changed.length;
    for (const c of changed) console.log(`  ${o.desc.label ?? 'shader'}: ${c}`);
  }
  writeFileSync(join(dir, 'manifest.naga.json'), JSON.stringify(manifest, null, 1));
  console.log(`naga-compat: rewrote ${total} function(s) -> ${join(dir, 'manifest.naga.json')}`);
}
