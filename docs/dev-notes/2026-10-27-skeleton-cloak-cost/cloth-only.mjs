// cloth-only.mjs: cultist.blob -> the same character with every FLESH prim dropped, only the cloth shells left
// (hood, drape, peak, capelet, skirt, bell cuffs). The stand-in for "SDF cloth over a raster skeleton": the march
// pays for the cloth alone. Throwaway; not a shipping character.
//   node docs/dev-notes/2026-10-27-skeleton-cloak-cost/cloth-only.mjs < cultist.blob > cultist-cloth.blob
import { readFileSync } from 'node:fs';
const src = readFileSync(0, 'utf8');
const out = [];
let section = null;
for (const line of src.split('\n')) {
  const head = line.match(/^([a-z]+)\b/);
  if (head) section = head[1];
  if (section === 'face') continue;                       // the face block makes head flesh prims
  if (section === 'body' && /^\s+(blob|bar|shell)\b/.test(line)) {
    if (!/^\s+shell\b/.test(line) || /when=dead/.test(line)) continue;
  }
  out.push(line);
}
process.stdout.write(out.join('\n'));
