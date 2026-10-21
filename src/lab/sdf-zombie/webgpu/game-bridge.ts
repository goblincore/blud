// src/lab/sdf-zombie/webgpu/game-bridge.ts
//
// THE BRIDGE RUNTIME (spec 2026-10-21 §3.1): when a level completes and declares `onComplete`, show its bridge card, hold it, then hop the page
// to the next level (level-bridge.ts is the pure side). One bridge per page, so the state is this module's, not ctx's. Seams:
// `__sdfGame.bridge()` and `setBridgeNavigate(fn | null)` (a driver replaces `location.assign` with a recorder: nothing in node navigates).
import type { GameContext } from './game-context';
import { bridgeHoldS, stepBridge, targetUrl, type BridgeState, type OnComplete } from './level-bridge';

interface Active { onc: OnComplete; state: BridgeState; el: HTMLElement; url: string | null }
let active: Active | null = null;
let navigateOverride: ((url: string) => void) | null = null;

/** Start the bridge for `onc`. False when there is no card to show and nothing to hop to (the caller then falls back to the overlay). */
export function startBridge(_ctx: GameContext, onc: OnComplete): boolean {
  if (active) return true;
  const url = targetUrl(location.pathname, onc, location.search);
  if (!url) { console.error(`[bridge] onComplete.goto ${onc.goto} is not a level id`); return false; }
  const el = document.createElement('div');
  const rgb = onc.bridge?.rgb ?? [0, 0, 0];
  const c = (v: number) => Math.round(v * 255);
  // z-index above the sequence overlay (44): the card repeats the ending's last black and its title, so the hand-over is one continuous black.
  el.setAttribute('style', `position:fixed; inset:0; z-index:46; pointer-events:none; background:rgb(${c(rgb[0])}, ${c(rgb[1])}, ${c(rgb[2])});`
    + ' display:grid; place-items:center;');
  const text = document.createElement('div');
  text.setAttribute('style', 'font:700 28px/1.2 ui-monospace,Menlo,monospace; color:#f2e6d0; letter-spacing:.3em;');
  text.textContent = onc.bridge?.text ?? '';
  el.appendChild(text);
  document.body.appendChild(el);
  document.exitPointerLock?.();
  active = { onc, state: { t: 0, holdS: bridgeHoldS(onc.bridge), navigated: false }, el, url };
  return true;
}

/** Per sim step (game-tick.ts, after stepSequence): the hold, then the hop. */
export function stepBridgeRuntime(_ctx: GameContext, dt: number): void {
  if (!active || !active.url) return;
  const r = stepBridge(active.state, dt);
  active.state = r.state;
  if (r.navigate) (navigateOverride ?? ((u: string) => location.assign(u)))(active.url);
}

export function createBridgeSeams(_ctx: GameContext) {
  return {
    bridge: () => active && { active: true, t: +active.state.t.toFixed(3), holdS: active.state.holdS, navigated: active.state.navigated, url: active.url, text: active.onc.bridge?.text ?? '' },
    setBridgeNavigate: (fn: ((url: string) => void) | null) => { navigateOverride = fn; },
  };
}
