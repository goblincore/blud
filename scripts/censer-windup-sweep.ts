// scripts/censer-windup-sweep.ts — does a FULL-CHARGE wind-up always form its orbit,
// whatever the head was doing at the press? (censer Task 9, Part B; cited by
// CENSER_SWING.spinFloor.) The pure model only: a previous stroke (none, a tap, light
// and full heavies), a gap of 0–60 frames at idle, then a 75- or 95-frame hold, from all
// five dead-zone sides — 1,280 presses. Prints how many wind-ups are under 12 m/s at
// the release and the stroke-peak spread.
//   npx tsx scripts/censer-windup-sweep.ts
// Env: NOGRIP=1 / NOFB=1 turn the hand's grip / the wrist's speed floor off (the
// before-state); OVR='{"spinFloor":[2,13]}' overrides CENSER_SWING fields; OFFS a
// JSON list of dead-zone offsets.
import { CENSER_SWING, handHold, handlePose, makeCenserSwing, ropeLength, stepCenserSwing, type CenserSwing } from '../src/lab/sdf-zombie/webgpu/censer-swing';
import { CENSER_HEAD, makeCenserHead, stepCenserHead } from '../src/lab/sdf-zombie/webgpu/censer-head';
type V = [number, number, number];
const DT = 1 / 60, REST: V = [0.22, -0.16, -0.46], TILT = -65 * Math.PI / 180, KU = 0.255;
const knotAt = (s: CenserSwing): V => { const p = handlePose(s); return [REST[0] + p[0], REST[1] + p[1] + KU * Math.cos(TILT), REST[2] + p[2] + KU * Math.sin(TILT)]; };
const W = { floorY: -100, boxes: [] };
if (process.env.OVR) Object.assign(CENSER_SWING as any, JSON.parse(process.env.OVR));
const FB = !process.env.NOFB, GRIP = !process.env.NOGRIP;
const offs = process.env.OFFS ? JSON.parse(process.env.OFFS) : [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }];
let n = 0, bad = 0, minW = 99, minS = 99; const hist: number[] = []; const sp: number[] = [];
for (const off of offs) for (const prev of [0, 3, 10, 20, 30, 45, 60, 80]) for (let gap = 0; gap <= 60; gap += 4) for (const hold of [75, 95]) {
  let s = makeCenserSwing(); let h = makeCenserHead(knotAt(s), ropeLength(s, CENSER_HEAD.ropeLen));
  const st = (d: boolean) => { s = stepCenserSwing(s, { down: d, offset: off }, DT); const hh = handHold(s); h = stepCenserHead(h, knotAt(s), DT, W, undefined, ropeLength(s, CENSER_HEAD.ropeLen), { grip: GRIP ? hh.grip : 0, drive: FB ? hh.drive : null }); };
  for (let i = 0; i < 240; i++) st(false);
  if (prev) { for (let i = 0; i < prev; i++) st(true); for (let i = 0; i < 200 && s.phase !== 'idle'; i++) st(false); }
  for (let i = 0; i < gap; i++) st(false);
  let w = 0; for (let i = 0; i < hold; i++) { st(true); if (i > hold - 20) w = Math.max(w, Math.hypot(...h.vel)); }
  let pk = 0; for (let i = 0; i < 60; i++) { st(false); if (s.phase === 'stroke' || s.phase === 'recover') pk = Math.max(pk, Math.hypot(...h.vel)); }
  n++; if (w < 12) { bad++; hist.push(offs.indexOf(off)); } minW = Math.min(minW, w); minS = Math.min(minS, pk); sp.push(pk);
}
console.log('fails by offset', [0,1,2,3,4].map(i => hist.filter(h => h === i).length).join(' '));
sp.sort((a, b) => a - b);
console.log(`FB ${FB} GRIP ${GRIP}: ${bad}/${n} windups under 12 m/s at release; min windup ${minW.toFixed(1)}; stroke peak min ${minS.toFixed(1)} p10 ${sp[Math.floor(n * 0.1)].toFixed(1)} median ${sp[n >> 1].toFixed(1)} max ${sp[n - 1].toFixed(1)}`);
