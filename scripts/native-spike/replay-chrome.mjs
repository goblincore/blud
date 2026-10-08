// scripts/native-spike/replay-chrome.mjs
//
// NATIVE-RENDERER SPIKE, step 2a driver: serve replay.html beside a capture
// directory, open it in the lab Chrome and print the timing as one JSON line.
//
//   node scripts/native-spike/replay-chrome.mjs <cdp-port> <capture-dir> [repeat] [rounds] [manifest]
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectGame, failHard, sleep } from '../lib/sdf-closeup-stage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CDP = Number(process.argv[2] ?? 9291);
const DIR = process.argv[3] ?? '.scratch/native-spike/capture';
const REPEAT = Number(process.argv[4] ?? 20);
const ROUNDS = Number(process.argv[5] ?? 30);
const MANIFEST = process.argv[6] ?? 'manifest.json';

const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = path === '/replay.html' ? join(HERE, 'replay.html')
    : path.startsWith('/cap/') ? join(DIR, normalize(path.slice(5)).replace(/^(\.\.[/\\])+/, ''))
    : null;
  if (!file || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : file.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;

const { send, evaluate } = await connectGame({ vite: 0, cdp: CDP, width: 900, height: 700 });
await send('Page.navigate', { url: `http://localhost:${port}/replay.html` });
for (let i = 0; i < 40 && !(await evaluate('window.replayReady === true').catch(() => false)); i++) await sleep(250);
const result = await evaluate(
  `replay(${JSON.stringify({ dir: '/cap', manifest: MANIFEST, repeat: REPEAT, rounds: ROUNDS })})`, 600_000,
);
if (!result) failHard('replay returned nothing');
const { ms, ...summary } = result;
console.log(JSON.stringify({ runner: MANIFEST === 'manifest.json' ? 'chrome' : `chrome:${MANIFEST}`, ...summary }));
server.close();
process.exit(result.errors.length > 0 ? 1 : 0);
