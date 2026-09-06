interface NormalPlaytestApi {
  setNormalGradient(mode: 0 | 1): void;
  setNormalGradientDebug(mode: 0 | 1 | 2): void;
  normalGradientStatus(): { mode: number };
}

/** Opt-in developer playtest; the ordinary game keeps its configured default. */
export function installNormalPlaytest(api: NormalPlaytestApi): () => void {
  const panel = document.createElement('div');
  panel.dataset.normalPlaytest = '';
  panel.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:9999;background:#171b20ee;color:#eee;border:1px solid #687079;padding:10px;font:13px monospace;border-radius:5px';
  const label = document.createElement('div');
  const toggle = document.createElement('button');
  toggle.textContent = 'Toggle normals [N]';
  const update = () => {
    label.textContent = api.normalGradientStatus().mode === 1
      ? 'Analytic normals · automatic fallback'
      : 'Original normals';
  };
  const flip = () => {
    api.setNormalGradient(api.normalGradientStatus().mode === 1 ? 0 : 1);
    update();
  };
  const key = (event: KeyboardEvent) => {
    const target = event.target;
    if (event.code !== 'KeyN' || event.repeat || event.ctrlKey || event.metaKey || event.altKey
      || (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))) return;
    event.preventDefault();
    flip();
  };
  api.setNormalGradientDebug(0);
  api.setNormalGradient(1);
  update();
  toggle.onclick = flip;
  panel.append(label, toggle);
  document.body.append(panel);
  window.addEventListener('keydown', key);
  return () => { window.removeEventListener('keydown', key); panel.remove(); };
}
