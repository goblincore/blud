// scripts/native-spike/compute-view.mjs
//
// THE COMPUTE-MARCH SPIKE, for a look by eye (docs/dev-notes/2026-11-10-compute-march-spike/NOTES.md). Serves
// replay.html beside the captures compute-march.mjs has already written manifests into, with an index of every
// frame and leg. A leg's page replays it once and shows: the game's own frame | this replay | their difference x 8.
//
//   node scripts/native-spike/compute-view.mjs [capturesDir] [port]      (default .scratch/compute, 5392)
//
// Open it in a browser with WebGPU. Nothing is timed here.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] ?? '.scratch/compute';
const PORT = Number(process.argv[3] ?? 5392);
const ORDER = ['frag', 'port', 'list', 'shared', 'mask'];
const legOf = (file) => (file === 'manifest.json' ? 'frag' : file.replace(/^manifest\.cmp-/, '').replace(/\.json$/, ''));

const index = () => {
  const frames = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(ROOT, d.name, 'manifest.json'))).map((d) => d.name).sort();
  const rows = frames.map((f) => {
    const legs = readdirSync(join(ROOT, f)).filter((n) => n === 'manifest.json' || /^manifest\.cmp-[\w]+\.json$/.test(n))
      .sort((a, b) => (ORDER.indexOf(legOf(a)) + 1 || 99) - (ORDER.indexOf(legOf(b)) + 1 || 99) || legOf(a).localeCompare(legOf(b)));
    return `<tr><th>${f}</th><td>${legs.map((n) => `<a href="/replay.html?dir=/cap/${f}&manifest=${n}">${legOf(n)}</a>`).join(' ')}</td></tr>`;
  });
  return `<!doctype html><meta charset="utf-8"><title>compute march: look</title>
<style>body{font:14px system-ui;margin:24px;background:#111;color:#ddd}a{color:#8cf;margin-right:10px}th{text-align:left;padding-right:16px}td,th{padding-top:6px}</style>
<h3>Compute-march spike: the game's frame | the replay | difference &times; 8</h3>
<p>frag is the fragment pass as captured; every other leg is a compute form of it (compute-march.mjs). ${frames.length ? '' : `No captures under ${ROOT}: run compute-capture.sh and compute-march.mjs first.`}</p>
<table>${rows.join('\n')}</table>`;
};

createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }).end(index()); return; }
  const file = path === '/replay.html' ? join(HERE, 'replay.html')
    : path.startsWith('/cap/') ? join(ROOT, normalize(path.slice(5)).replace(/^(\.\.[/\\])+/, ''))
    : null;
  if (!file || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : file.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`compute-view: http://localhost:${PORT}/  (captures in ${ROOT})`));
