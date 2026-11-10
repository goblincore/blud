// scripts/native-spike/compile-check.mjs
//
// Compile one manifest's march fragment module in the lab Chrome and print the compiler's messages with the
// offending source line. For a ladder.mjs rung that fails with "Invalid ShaderModule": the replay only reports
// that much.
//
//   scripts/native-spike/servers.sh node scripts/native-spike/compile-check.mjs 9291 <capture-dir>/manifest.<rung>.json
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connectGame, sleep } from '../lib/sdf-closeup-stage.mjs';
const [cdp, file] = [Number(process.argv[2]), process.argv[3]];
const m = JSON.parse(readFileSync(file, 'utf8'));
const code = Object.values(m.objects).find((o) => o.kind === 'shaderModule' && /\bfn mapBody\b/.test(o.desc.code)).desc.code;
const server = createServer((req, res) => { res.setHeader('Access-Control-Allow-Origin', '*'); if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html></html>'); } else { res.writeHead(200).end(code); } });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
const { send, evaluate } = await connectGame({ vite: 0, cdp, width: 400, height: 300 });
await send('Page.navigate', { url: `http://localhost:${port}/` });
await sleep(800);
const out = await evaluate(`(async () => {
  const code = await (await fetch('/code')).text();
  const d = await (await navigator.gpu.requestAdapter()).requestDevice();
  const info = await d.createShaderModule({ code }).getCompilationInfo();
  return info.messages.slice(0, 6).map((x) => x.type + ' L' + x.lineNum + ':' + x.linePos + ' ' + x.message + ' >> ' + code.split('\\n')[x.lineNum - 1]);
})()`, 120000);
console.log(out.join('\n'));
server.close(); process.exit(0);
