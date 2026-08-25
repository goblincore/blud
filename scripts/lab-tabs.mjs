// List or close leftover CDP tabs on a lab Chrome.
//
// The capture harnesses used to leak a renderer (~250 MB) per run because
// /json/new was never matched by /json/close (fixed 2026-08-25, d74dacf). Any
// harness that has not been re-run since — or any script written ad hoc — can
// still strand tabs, and stale tabs are not a cosmetic problem: ~35 of them
// drove host load to 27 and silently biased every timing number taken in that
// window. The runs did not fail; they measured a contended machine.
//
// Usage:
//   node scripts/lab-tabs.mjs [cdpPort]              # list
//   node scripts/lab-tabs.mjs [cdpPort] --close      # close ALL page tabs
//   node scripts/lab-tabs.mjs [cdpPort] --close 5233 # close tabs whose URL matches
//
// Closing every tab is safe while nothing is capturing: the browser stays up
// and the next harness run opens its own. Do NOT run --close against a port a
// dispatch is actively using.
const PORT = Number(process.argv[2] ?? 9223);
const CLOSE = process.argv.includes('--close');
const FILTER = process.argv.find((a, i) => i > 2 && !a.startsWith('--') && a !== String(PORT));

const base = `http://127.0.0.1:${PORT}`;
let tabs;
try {
  tabs = await (await fetch(`${base}/json/list`)).json();
} catch {
  console.error(`no CDP on ${PORT} — nothing to clean`);
  process.exit(0);
}
const pages = tabs.filter(t => t.type === 'page' && (!FILTER || (t.url ?? '').includes(FILTER)));
if (!pages.length) { console.log(`${PORT}: no matching page tabs`); process.exit(0); }

if (!CLOSE) {
  console.log(`${PORT}: ${pages.length} page tab(s)${FILTER ? ` matching "${FILTER}"` : ''}`);
  for (const p of pages) console.log(`   ${(p.url ?? '').slice(0, 100)}`);
  console.log(`\nre-run with --close to close them`);
  process.exit(0);
}
let n = 0;
for (const p of pages) {
  try { await fetch(`${base}/json/close/${p.id}`); n++; } catch { /* already gone */ }
}
console.log(`${PORT}: closed ${n} of ${pages.length} tab(s)`);
