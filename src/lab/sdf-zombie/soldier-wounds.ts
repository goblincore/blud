import { MAX_WOUNDS, type Wound } from './damage';

/** Render-only secondary cuts. They never enter the gameplay ring or injury ledger. */
export function soldierVisualWounds(wounds: readonly Wound[]): Wound[] {
  const real=wounds.slice(-MAX_WOUNDS).map(w=>({...w,local:[...w.local] as [number,number,number]}));
  const out=[...real];
  for(let i=0;i<real.length && out.length<MAX_WOUNDS;i++) {
    const w=real[i]!;
    if(w.injuryIgnored||w.type==='burn') continue;
    for(let lobe=0;lobe<3 && out.length<MAX_WOUNDS;lobe++) {
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
