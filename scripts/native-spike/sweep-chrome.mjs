// scripts/native-spike/sweep-chrome.mjs
//
// Driver for replay.html's `sweep`: one pass run once per value of a 1 x 1 parameter texture, each run's colour
// target written to <outDir>/<index>.bin (rgba32float, tightly packed).
//
//   node scripts/native-spike/sweep-chrome.mjs <cdp-port> <capture-dir> <manifest> <outDir> <first> <step> <count>
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectGame, failHard, sleep } from '../lib/sdf-closeup-stage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const [CDP, DIR, MANIFEST, OUT, FIRST, STEP, COUNT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (req.method === 'POST' && path.startsWith('/out/')) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { writeFileSync(join(OUT, `${Number(path.slice(5))}.bin`), Buffer.concat(chunks)); res.writeHead(200).end(); });
    return;
  }
  const file = path === '/replay.html' ? join(HERE, 'replay.html')
    : path.startsWith('/cap/') ? join(DIR, normalize(path.slice(5)).replace(/^(\.\.[/\\])+/, ''))
    : null;
  if (!file || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : file.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
const { send, evaluate } = await connectGame({ vite: 0, cdp: Number(CDP), width: 900, height: 700 });
await send('Page.navigate', { url: `http://localhost:${port}/replay.html` });
for (let i = 0; i < 40 && !(await evaluate('window.replayReady === true').catch(() => false)); i++) await sleep(250);
const values = Array.from({ length: Number(COUNT) }, (_, i) => Number(FIRST) + i * Number(STEP));
const result = await evaluate(`sweep(${JSON.stringify({ dir: '/cap', manifest: MANIFEST, values, post: '/out' })})`, 900_000);
if (!result) failHard('sweep returned nothing');
console.log(JSON.stringify(result));
server.close();
process.exit(result.errors.length > 0 ? 1 : 0);
