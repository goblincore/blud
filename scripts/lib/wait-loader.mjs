// scripts/lib/wait-loader.mjs
//
// Wait until sdf-game.html is actually PLAYABLE, then dismiss its loader.
//
// `window.__sdfGame` exists long before the march pipelines finish compiling
// (cold: minutes — docs/dev-notes/2026-09-19-shader-compile), and the loader
// overlay covers the whole frame until they do. A capture script that waits
// only for `__sdfGame` photographs "compiling pipelines": the shorty gate's
// first three shots and every bleed-parity capture were 15 KB loader frames
// that passed their assertions and showed nothing — bleed parity reported a
// "zero diff" between two identical pictures of the loader.
//
// game-boot-leaves adds `loader-ready` when the game is playable;
// `loader-hidden` is what the overlay's own click handler adds, so dismissing
// it this way is the player's path, not a private one.
//
//   await waitForLoader(evaluate, { fail });
//
// `evaluate(expr)` is the script's own CDP Runtime.evaluate wrapper.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitForLoader(evaluate, { fail, timeoutSec = 600, settleMs = 1500 } = {}) {
  for (let i = 0; i < timeoutSec; i++) {
    const ready = await evaluate(`!!document.getElementById('loader')?.classList.contains('loader-ready')`);
    if (ready) {
      await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
      await sleep(settleMs);
      return;
    }
    await sleep(1000);
  }
  const msg = `loader never reached loader-ready — pipelines still compiling after ${timeoutSec} s`;
  if (fail) fail(msg);
  throw new Error(msg);
}
