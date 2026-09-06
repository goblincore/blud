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
