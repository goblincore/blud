---
Paste-in console helpers for judging the P1 bounce spike in the lab.
Branch: dispatch/lighting-p1-bounce. Run: npm run dev -> /sdf-lab-webgpu.html
Same idea as 2026-08-24-wound-debug-views.md — self-contained, no page support
needed, so it works in any tab or browser.
---

Paste the whole block into the devtools console of the lab tab:

```js
(() => {
  const L = window.__sdfLab;
  if (!L) { console.warn('lab not booted yet — wait for the panel, then re-paste'); return; }
  const u = L.uniforms;
  const pick = () => [...document.querySelectorAll('input[type=color]')];
  // Driving the colour INPUTS (not the uniforms) keeps the wall you see and the
  // colour it bounces in sync. Setting the uniform alone silently desyncs them.
  const paint = (hexes, label) => { const e = pick();
    hexes.forEach((h, i) => { if (e[i]) { e[i].value = h; e[i].dispatchEvent(new Event('input')); } });
    return label; };

  window.ab      = w => (u.bounceCfg.value.x = w, `probeWeight ${w}`);
  window.gain    = g => (u.bounceCfg.value.y = g, `ambientGain ${g}`);
  window.fill    = f => (u.lightCfg.value.y  = f, `fillIntensity ${f}`);
  window.redroom = () => paint(['#e60d0d','#0f0505','#0f0505','#0f0505','#0f0505','#0f0505'], 'one red wall, rest dark');
  window.cornell = () => paint(['#a11510','#277a17','#bab5ad','#bab8b3','#bab5ad','#bab5ad'], 'cornell box');
  window.box     = () => { const b = [...document.querySelectorAll('button')].find(x => /enclosure/i.test(x.textContent)); b.click(); return b.textContent; };
  window.pose    = () => { L.setMotionEnabled(false); L.setWander(false); L.setCam(0.55, 0.02, 1.85); return 'frozen, camera inside the box'; };

  console.log('ready:  ab(0|1)  gain(n)  fill(n)  redroom()  cornell()  box()  pose()');
  return 'ready';
})()
```

Then, in order:

| # | Type | Expect |
|---|---|---|
| 1 | `pose()` then `box()` if the enclosure is off | inside a Cornell box, pose frozen |
| 2 | `ab(1)` / `ab(0)` | **nothing** — the shipping preset; this is the finding |
| 3 | `redroom(); fill(0.34)` then `ab(0)` / `ab(1)` | strong red on the shadow side — the mechanism, isolated |
| 4 | `cornell()` (still fill 0.34), `ab(0)` / `ab(1)` | washes out — 4 of 6 walls are white |
| 5 | `gain(2.5)` | visible, but by adding lift — breaks "colour not brightness" on purpose |
| 6 | drag-orbit at each | hue should shift as the camera nears a coloured wall |

Reset: `cornell(); fill(0.06); ab(0); gain(1)`.

The question the captures cannot answer: at step 3 vs 4, is "rooms must carry
strong hues" an acceptable constraint on level art, or must bounce work in a
mostly-neutral room? That decides whether chroma gain is optional or the whole
ballgame.
