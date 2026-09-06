import { GameTelemetry, type GameplayCapture } from './game-telemetry';

async function saveLocal(capture: GameplayCapture): Promise<{ path: string }> {
  const response = await fetch('/__lab/save-telemetry', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(capture),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error ?? `Save failed (${response.status})`);
  return result;
}

export function createTelemetryControls(log: GameTelemetry, metadata: () => Record<string, unknown> | Promise<Record<string, unknown>>, save = saveLocal, onActive = (_active: boolean) => {}, onMark = () => {}) {
  const element = document.createElement('div');
  element.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:10000;padding:8px 10px;background:#171b20ee;color:#eee;font:12px monospace;border:1px solid #687079;border-radius:5px;max-width:540px;pointer-events:auto';
  const toggle = document.createElement('button');
  const marker = document.createElement('button');
  marker.textContent = 'Mark visual issue [F9]'; marker.disabled = true;
  const status = document.createElement('span');
  status.style.marginLeft = '10px';
  const download = document.createElement('button');
  download.textContent = 'Download JSON'; download.hidden = true;
  const retry = document.createElement('button');
  retry.textContent = 'Retry save'; retry.dataset.retry = ''; retry.hidden = true;
  toggle.textContent = 'Record [F8]';
  element.append(toggle, marker, status, retry, download); document.body.append(element);
  let last: GameplayCapture | null = null;
  let saving = false;
  let saved = true;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let starting = false;
  let startGeneration = 0;
  async function persist() {
    if (!last || saving) return;
    saving = true; toggle.disabled = true; retry.hidden = true;
    status.textContent = 'Saving…';
    try {
      const result = await save(last);
      saved = true;
      status.textContent = `Saved ${result.path} · ${last.summary.spikes40ms} frames ≥40 ms`;
    } catch (error) {
      status.textContent = `Save failed: ${String(error)} — recording retained`;
      retry.hidden = false;
    } finally { saving = false; toggle.disabled = !saved; }
  }
  function stop(reason = 'manual') {
    if (starting) {
      startGeneration++; starting = false;
      toggle.textContent = 'Record [F8]'; status.textContent = 'Recording cancelled';
      return;
    }
    if (disposed || saving || (!log.active && toggle.textContent === 'Record [F8]')) return;
    clearTimeout(timeout); onActive(false); last = log.stop(reason); saved = false;
    marker.disabled = true;
    toggle.textContent = 'Record [F8]'; download.hidden = false;
    void persist();
  }
  async function start() {
    if (disposed || starting || saving || log.active || !saved) return;
    starting = true;
    const generation = ++startGeneration;
    try {
    const pendingMetadata = metadata();
    if (pendingMetadata instanceof Promise) {
      status.textContent = 'Preparing recording…'; toggle.textContent = 'Cancel start [F8]';
    }
    const info = pendingMetadata instanceof Promise ? await pendingMetadata : pendingMetadata;
    if (disposed || generation !== startGeneration) return;
    log.start(info); onActive(true); last = null; retry.hidden = true; download.hidden = true;
    marker.disabled = false;
    toggle.textContent = 'Stop & Save [F8]'; status.textContent = '● Recording · max 3 min';
    timeout = setTimeout(() => stop('duration-limit'), 180000);
    } catch (error) {
      if (!disposed && generation === startGeneration) {
        toggle.textContent = 'Record [F8]';
        status.textContent = `Could not start recording: ${String(error)}`;
      }
    } finally { if (generation === startGeneration) starting = false; }
  }
  function key(e: KeyboardEvent) {
    if (e.code === 'F9' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (log.active) { e.preventDefault(); mark(); }
      return;
    }
    if (e.code !== 'F8' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault(); log.active || starting ? stop() : start();
  }
  const visibility = () => log.event('visibility', { hidden: document.hidden });
  const blur = () => log.event('window-blur');
  const focus = () => log.event('window-focus');
  toggle.onclick = () => log.active || starting ? stop() : start();
  function mark() { if (!disposed && log.active) { onMark(); status.textContent = '● Visual issue marked · recording'; } }
  marker.onclick = mark;
  retry.onclick = () => { void persist(); };
  download.onclick = () => {
    if (!last) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(last)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `blud-gameplay-${last.startedAt.replace(/[:.]/g, '-')}.json`;
    anchor.click(); saved = true; toggle.disabled = false;
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  window.addEventListener('keydown', key);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('blur', blur); window.addEventListener('focus', focus);
  return { element, start, stop, mark, lastCapture: () => last,
    afterFrame() { if (!starting && !log.active && toggle.textContent !== 'Record [F8]') stop(); },
    dispose() {
      disposed = true; clearTimeout(timeout);
      onActive(false); if (log.active) log.stop('disposed');
      window.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', blur); window.removeEventListener('focus', focus);
      element.remove();
    },
  };
}
