// src/lab/sdf-zombie/soldier-wounds.ts
//
// Soldier visual wounds: turns the wound list into the craters the shader draws, with the ragged-crater toggle.

import { MAX_WOUNDS, type Wound } from './damage';

/** How ragged a single crater's edge is when it stands in for the lobes (radius grows by
 *  up to this fraction by direction, shader-side). Stored in the fraction of the wound
 *  TYPE texel, so it must stay below 0.5. */
export const RAGGED_AMOUNT = 0.3;

/** Option 3 of the wound-cost work (2026-09-21): ONE noise-ragged crater per wound instead
 *  of the wound plus three lobe rows, cutting the rows every march sample walks ~4x. A look
 *  change the owner approved by eye (2026-09-21); ON. */
let raggedCraters = true;
export const setRaggedCraters = (on: boolean) => { raggedCraters = on; };
export const raggedCratersOn = () => raggedCraters;

/** Render-only secondary cuts. They never enter the gameplay ring or injury ledger. `cap`: the rows the body's
 *  upload holds, which must be the ring's own cap (the crater grid's WG_MAX_WOUNDS when it is on). A smaller cap
 *  hides the oldest wounds while the ring still holds them (2026-11-22: slug craters vanished after pellet volleys). */
export function soldierVisualWounds(wounds: readonly Wound[], cap: number = MAX_WOUNDS): Wound[] {
  const real=wounds.slice(-cap).map(w=>({...w,local:[...w.local] as [number,number,number]}));
  if(raggedCraters) return real.map(w=>w.injuryIgnored||w.type==='burn'?w:{...w,ragged:RAGGED_AMOUNT});
  const out=[...real];
  for(let i=0;i<real.length && out.length<cap;i++) {
    const w=real[i]!;
    if(w.injuryIgnored||w.type==='burn'||w.shape==='cut') continue;   // a cut is a slot: crater lobes would bowl it
    for(let lobe=0;lobe<3 && out.length<cap;lobe++) {
      const h=((w.primIdx+1)*1103515245+(Math.round(w.local[0]*1000)+4096)*12345+lobe*2654435761)>>>0;
      const angle=(h%6283)/1000, offset=w.radius*(.72+(h%11)/100);
      const n=w.carveN??[0,0,1], ref=Math.abs(n[2])<.8?[0,0,1] as const:[0,1,0] as const;
      let t:[number,number,number]=[n[1]*ref[2]-n[2]*ref[1],n[2]*ref[0]-n[0]*ref[2],n[0]*ref[1]-n[1]*ref[0]];
      const tl=Math.hypot(...t)||1;t=t.map(v=>v/tl) as typeof t;
      const b:[number,number,number]=[n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]];
      out.push({...w,injuryIgnored:true,radius:w.radius*(.38+(h%9)/100),
        local:[w.local[0]+(t[0]*Math.cos(angle)+b[0]*Math.sin(angle))*offset,w.local[1]+(t[1]*Math.cos(angle)+b[1]*Math.sin(angle))*offset,w.local[2]+(t[2]*Math.cos(angle)+b[2]*Math.sin(angle))*offset],
        rimScale:Math.min(w.rimScale??1,.72)});
    }
  }
  return out;
}
