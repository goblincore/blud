// src/lab/sdf-zombie/webgpu/game-crt-capture.ts
//
// Capture the canvas for the Flat's CRT (spec 2026-10-21 §3.2). A WebGPU canvas is only readable in the task that drew it, so the capture is
// requested, and done by the renderer's frame observer (lab-renderer.ts: it runs in the same rAF task right after the draw). It crops the canvas
// to 4:3, downscales to CRT_SIZE on a 2D canvas, refuses a blank result and saves it (crt-handoff.ts). Every failure is swallowed: the Flat falls
// back to its committed still. Seam: `__sdfGame.crtCapture()` reports the last attempt.
import type { GameContext } from './game-context';
import { CRT_SIZE, looksBlank, saveCrtPicture, sessionStore } from './crt-handoff';

export interface CaptureResult { ok: boolean; reason: string; bytes: number }
let last: CaptureResult | null = null;
let pending = false;

export function requestCrtCapture(ctx: GameContext): void {
  if (pending) return;
  pending = true;
  ctx.boot.handle.setFrameObserver(() => {
    ctx.boot.handle.setFrameObserver(null);
    pending = false;
    last = captureNow(ctx);
  });
}

function captureNow(ctx: GameContext): CaptureResult {
  try {
    const src = ctx.boot.handle.renderer.domElement as HTMLCanvasElement;
    const store = sessionStore();
    if (!store) return { ok: false, reason: 'no sessionStorage', bytes: 0 };
    // Centre-crop the source to 4:3.
    const want = CRT_SIZE.width / CRT_SIZE.height;
    let sw = src.width, sh = src.height;
    if (sw / sh > want) sw = Math.round(sh * want); else sh = Math.round(sw / want);
    const sx = Math.round((src.width - sw) / 2), sy = Math.round((src.height - sh) / 2);
    const c = document.createElement('canvas');
    c.width = CRT_SIZE.width; c.height = CRT_SIZE.height;
    const g = c.getContext('2d');
    if (!g) return { ok: false, reason: 'no 2d context', bytes: 0 };
    g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    if (looksBlank(g.getImageData(0, 0, c.width, c.height).data)) return { ok: false, reason: 'blank capture', bytes: 0 };
    const url = c.toDataURL('image/png');
    const ok = saveCrtPicture(store, url);
    return { ok, reason: ok ? 'saved' : 'not saved (cap or storage)', bytes: url.length };
  } catch (e) {
    return { ok: false, reason: `threw: ${e instanceof Error ? e.message : String(e)}`, bytes: 0 };
  }
}

export function createCrtCaptureSeams(ctx: GameContext) {
  return { crtCapture: () => last, requestCrtCapture: () => requestCrtCapture(ctx) };
}
