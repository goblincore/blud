import type { PostFxConfig } from './config';

export function mountDevPanel(parent: HTMLElement, cfg: PostFxConfig): () => void {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed; top:8px; right:8px; z-index:9999;
    background:rgba(20,15,15,0.88); color:#eee; font:11px monospace;
    padding:10px; border:1px solid #444; min-width:220px; user-select:none;
  `;
  el.innerHTML = `
    <div style="font-weight:bold;margin-bottom:6px;">post-fx (F9)</div>
    ${toggle('vignette', cfg.vignette.enabled)}
    ${toggle('dither', cfg.dither.enabled)}
    ${slider('dither.strength', cfg.dither.strength, 0, 1, 'dither strength')}
    ${toggle('ca', cfg.ca.enabled)}
    ${slider('ca.baseline', cfg.ca.baseline, 0, 0.02, 'ca baseline')}
    ${toggle('grain', cfg.grain.enabled)}
    ${slider('grain.amount', cfg.grain.amount, 0, 0.3, 'grain amount')}
    ${toggle('scanlines', cfg.scanlines.enabled)}
    ${toggle('barrel', cfg.barrel.enabled)}
  `;
  parent.appendChild(el);

  el.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.key!;
      (cfg as unknown as Record<string, { enabled: boolean }>)[key]!.enabled = cb.checked;
    });
  });
  el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((r) => {
    r.addEventListener('input', () => {
      const parts = r.dataset.key!.split('.');
      const group = parts[0]!;
      const field = parts[1]!;
      (cfg as unknown as Record<string, Record<string, number>>)[group]![field] = parseFloat(r.value);
    });
  });

  return () => el.remove();
}

function toggle(key: string, checked: boolean): string {
  return `<label style="display:block;margin:3px 0;">
    <input type="checkbox" data-key="${key}" ${checked ? 'checked' : ''}> ${key}
  </label>`;
}
function slider(key: string, value: number, min: number, max: number, label: string): string {
  const step = (max - min) / 100;
  return `<label style="display:block;margin:3px 0;font-size:10px;">
    ${label}:<input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}"
      value="${value}" style="width:100%;">
  </label>`;
}
