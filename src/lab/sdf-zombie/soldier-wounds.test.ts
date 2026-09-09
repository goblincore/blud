import { describe, expect, it } from 'vitest';
import type { Wound } from './damage';
import { soldierVisualWounds } from './soldier-wounds';

const wound = (n: number): Wound => ({ primIdx:n, local:[n*.01,0,0], radius:.055, type:'pellet', ageSec:n, carveN:[0,0,1], carveDepth:.03 });

describe('soldier cosmetic wounds', () => {
  it('keeps real wounds first and adds deterministic ragged lobes without mutation', () => {
    const input=[wound(1),wound(2)], before=JSON.stringify(input);
    const a=soldierVisualWounds(input), b=soldierVisualWounds(input);
    expect(a).toEqual(b); expect(JSON.stringify(input)).toBe(before);
    expect(a.slice(0,2)).toEqual(input); expect(a).toHaveLength(4);
    expect(a[2]!.injuryIgnored).toBe(true); expect(a[2]!.primIdx).toBe(input[0]!.primIdx);
    expect(a[2]!.carveDepth).toBe(input[0]!.carveDepth);
    const d=Math.hypot(a[2]!.local[0]-input[0]!.local[0],a[2]!.local[1]-input[0]!.local[1]);
    expect(d+a[2]!.radius).toBeGreaterThan(input[0]!.radius*1.1);
    expect(d+a[2]!.radius).toBeLessThan(input[0]!.radius*1.35);
  });
  it('never lets cosmetic lobes evict real wounds', () => {
    const input=Array.from({length:16},(_,i)=>wound(i));
    expect(soldierVisualWounds(input)).toEqual(input);
  });
  it.each([[[0,0,1]],[[1,0,0]]])('offsets in the wound tangent plane for normal %j',(normal)=>{
    const w={...wound(3),carveN:normal as [number,number,number]},l=soldierVisualWounds([w])[1]!;
    const d=l.local.map((v,i)=>v-w.local[i]!) as [number,number,number];
    expect(d[0]*normal[0]!+d[1]*normal[1]!+d[2]*normal[2]!).toBeCloseTo(0,10);
  });
});
