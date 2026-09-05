import { connectGame, bootCloseupPage } from './lib/sdf-closeup-stage.mjs';
const fail = (m) => { console.error('FAIL:', m); process.exit(1); };
const conn = await connectGame({ vite: 5397, cdp: 9397, width: 1280, height: 800, onFail: fail });
const ev = conn.evaluate;
await bootCloseupPage({ send: conn.send, evaluate: ev, url: 'http://localhost:5397/sdf-game.html?frozen=1', fail });

const stage = `
  __sdfGame.teleport(1);
  const z = __sdfGame.zombies().find(q => q.room === 1);
  const ex = z.pos[0], ez = z.pos[2] + 1.1;
  __sdfGame.setPose(ex, ez, 0, 0.05, 0);
  __sdfGame.step(10);
  __sdfGame.fireSlug();
  __sdfGame.step(36);
  return 1;
`;
const expr = `(async () => { ${stage} })()`;
console.log('composed length:', expr.length);
const r = await conn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log('raw result:', JSON.stringify(r.result).slice(0, 300));
if (r.result?.exceptionDetails) {
  console.log('full exception:', JSON.stringify(r.result.exceptionDetails, null, 2).slice(0, 800));
}
