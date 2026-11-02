// src/game/level/panel-textures.worker.ts
//
// Generates one panel kind's maps off the main thread (panel-textures.ts generatePanel is pure; all
// eight kinds take ~2 s of CPU, which used to block the sector level's boot). The buffers are
// transferred back, not copied.
import { generatePanel, type PanelKind } from './panel-textures';

interface Job { kind: PanelKind; seed: number }

self.onmessage = (ev: MessageEvent<Job>) => {
  const { kind, seed } = ev.data;
  const t0 = performance.now();
  const m = generatePanel(kind, seed);
  const ms = performance.now() - t0;
  const out = { kind, ms, albedo: m.albedo, normal: m.normal, roughness: m.roughness, emissive: m.emissive };
  const transfer = [m.albedo.buffer, m.normal.buffer, m.roughness.buffer, ...(m.emissive ? [m.emissive.buffer] : [])];
  (self as unknown as Worker).postMessage(out, transfer);
};
