import { it, expect } from 'vitest';
import { GameTelemetry } from './game-telemetry';
import { createTelemetryControls } from './game-telemetry-controls';

it('F8 records once despite key repeat, stops and retains a failed save for retry', async () => {
  const log = new GameTelemetry();
  let fail = true;
  const panel = createTelemetryControls(log, () => ({ build: 'test' }), async capture => {
    if (fail) throw new Error('offline');
    return { path: `telemetry/${capture.schema}.json` };
  });
  try {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F8' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F8', repeat: true }));
    expect(log.active).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F8' }));
    await new Promise(r => setTimeout(r, 0));
    expect(log.active).toBe(false);
    expect(panel.element.textContent).toContain('offline');
    expect(panel.lastCapture()?.schema).toBe('blud-gameplay-v1');
    const retained = panel.lastCapture();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F8' }));
    expect(log.active).toBe(false);
    expect(panel.lastCapture()).toBe(retained);
    fail = false;
    (panel.element.querySelector('[data-retry]') as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 0));
    expect(panel.element.textContent).toContain('telemetry/blud-gameplay-v1.json');
  } finally { panel.dispose(); }
});

it('marks visual issues only during recording and ignores held F9 keys', () => {
  const log = new GameTelemetry();
  const panel = createTelemetryControls(log, () => ({}), async () => ({ path: 'saved.json' }), undefined,
    () => log.snapshot('visual-issue', { camera: [1, 2, 3] }));
  try {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F9' }));
    panel.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F9' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F9', repeat: true }));
    panel.stop();
    expect(panel.lastCapture()?.snapshots).toHaveLength(1);
    expect(panel.lastCapture()?.snapshots[0]?.name).toBe('visual-issue');
  } finally { panel.dispose(); }
});

it('waits for fresh build metadata once and does not start after disposal', async () => {
  const log = new GameTelemetry();
  let resolve!: (value: Record<string, unknown>) => void;
  let calls = 0;
  const panel = createTelemetryControls(log, () => { calls++; return new Promise(r => { resolve = r; }); });
  const pending = panel.start();
  panel.start();
  expect(log.active).toBe(false);
  expect(calls).toBe(1);
  panel.dispose();
  resolve({ build: 'fresh' });
  await pending;
  expect(log.active).toBe(false);
});

it('stopping during metadata preparation cancels that start even if a newer start is pending', async () => {
  const log = new GameTelemetry();
  const resolve: ((value: Record<string, unknown>) => void)[] = [];
  const panel = createTelemetryControls(log, () => new Promise(r => resolve.push(r)));
  try {
    const old = panel.start();
    panel.stop();
    const current = panel.start();
    resolve[0]!({ build: 'old' });
    await old;
    expect(log.active).toBe(false);
    resolve[1]!({ build: 'current' });
    await current;
    expect(log.active).toBe(true);
    expect(log.stop().metadata.build).toBe('current');
  } finally { panel.dispose(); }
});
