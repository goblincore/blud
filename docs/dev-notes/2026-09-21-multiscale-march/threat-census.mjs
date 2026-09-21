// threat-census.mjs — before building the CPU threat mask: how many (wound, cluster) pairs would it cull?
import { writeFileSync } from 'node:fs';
const [, , VITE = '5391', CDP = '9391', ROOT] = process.argv;
const { connectGame, bootCloseupPage, stageCloseUp, stampFacingWounds, sleep } = await import(`${ROOT}/scripts/lib/sdf-closeup-stage.mjs`);
const { send, evaluate } = await connectGame({ vite: Number(VITE), cdp: Number(CDP), width: 1280, height: 800 });
await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?frozen=1` });
await evaluate('__sdfGame.setWoundTuning({ spillChance: 0 }); 1');
const staged = await stageCloseUp(evaluate, { settleTries: 2400 });
await stampFacingWounds(evaluate, {});
const dump = await evaluate(`(() => {
  const z = __sdfGame.zombie(${staged.body});
  const v = z.visualWoundList();
  return JSON.stringify({ n: v.length, rows: v.map(w => ({ prim: w.primIdx, r: w.radius, type: w.type, depth: w.carveDepth, preset: !!w.presetCut, rim: w.rimScale })), threats: __sdfGame.woundThreats(), dbg: __sdfGame.debugWounds(${staged.body})?.slice?.(0, 2) });
})()`);
console.log(dump.slice(0, 4000));
process.exit(0);
