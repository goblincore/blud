// src/lab/sdf-zombie/webgpu/panel-chrome.ts
//
// The shell both tuning panels sit in: fixed frame, title bar, collapse caret,
// close button, and a body the caller fills with rows.
//
// It exists because goo-panel.ts and wound-panel.ts carried byte-identical CSS
// and title-bar code, and both needed the same new collapse state. A third copy
// is how the two drift apart.
//
// SHIPS COLLAPSED. The panels ship VISIBLE on purpose -- the owner asked twice,
// "the sliders could not be found" and "it should be default on tbh" -- but
// between them they cover most of the viewport, which made every visual capture
// useless (see c6bffc7: ten shots that "all passed their booleans and all
// showed the owner nothing"). Collapsing keeps the title bar on screen, so the
// panels stay findable, and closes only the part that occludes.
//
// The collapse state is deliberately NOT persisted. A remembered state is
// exactly the sort of per-profile variation that makes a capture reproduce
// differently on two machines.

// GOO and WOUND sit side by side (right:8px and right:266px) rather than
// stacked on the same spot — that's what makes both title bars stay visible
// and clickable at once while collapsed. `right` lets each caller keep its
// own slot; only the offset varies, so it stays a parameter, not a second copy.
function panelCss(right: number): string {
  return `
    position:fixed; top:8px; right:${right}px; width:250px; z-index:40;
    background:rgba(20,16,15,0.93); color:#e8ddd8; border:1px solid #3a2f2d;
    border-radius:3px; padding:9px 10px 10px;
    font:11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
    max-height:calc(100vh - 16px); overflow-y:auto;
  `;
}

export interface PanelShell {
  readonly el: HTMLElement;
  /** Append rows here. Hidden while collapsed. */
  readonly body: HTMLElement;
  readonly visible: boolean;
  readonly collapsed: boolean;
  setVisible(on: boolean): void;
  setCollapsed(on: boolean): void;
  /** Called on every state change while visible and expanded. */
  onReveal(fn: () => void): void;
  dispose(): void;
}

export function createPanelShell(
  titleLabel: string,
  opts: { right?: number } = {},
): PanelShell {
  const el = document.createElement('div');
  el.setAttribute('style', panelCss(opts.right ?? 8));
  el.style.display = 'none';
  // Stable hook for capture scripts. textContent now leads with the caret
  // glyph, so matching panels by their visible text is no longer reliable.
  el.dataset.panel = titleLabel;

  const title = document.createElement('div');
  title.setAttribute('style',
    'display:flex; align-items:center; justify-content:space-between; gap:8px;'
    + ' font-size:10px; letter-spacing:.12em; color:#9a8b86;');

  const caret = document.createElement('button');
  caret.setAttribute('style',
    'background:none; border:0; color:#9a8b86; cursor:pointer; font-size:10px;'
    + ' line-height:1; padding:0 4px 0 0; flex:none;');

  const titleText = document.createElement('span');
  titleText.textContent = titleLabel;
  titleText.setAttribute('style', 'flex:1; cursor:pointer;');

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.title = 'hide (H toggles both panels)';
  closeBtn.setAttribute('style',
    'background:none; border:0; color:#9a8b86; cursor:pointer; font-size:12px;'
    + ' line-height:1; padding:0 2px;');

  title.append(caret, titleText, closeBtn);
  el.appendChild(title);

  const body = document.createElement('div');
  body.setAttribute('style', 'margin-top:7px;');
  el.appendChild(body);

  document.body.appendChild(el);

  let visible = false;
  let collapsed = true;
  const revealFns: (() => void)[] = [];

  function paint(): void {
    el.style.display = visible ? 'block' : 'none';
    body.style.display = collapsed ? 'none' : 'block';
    caret.textContent = collapsed ? '▸' : '▾';
    caret.title = collapsed ? 'expand' : 'collapse';
    if (visible && !collapsed) for (const fn of revealFns) fn();
  }
  const toggle = (): void => { collapsed = !collapsed; paint(); };
  caret.addEventListener('click', toggle);
  titleText.addEventListener('click', toggle);
  closeBtn.addEventListener('click', () => { visible = false; paint(); });
  paint();

  return {
    el,
    body,
    get visible() { return visible; },
    get collapsed() { return collapsed; },
    setVisible(on) { visible = on; paint(); },
    setCollapsed(on) { collapsed = on; paint(); },
    onReveal(fn) { revealFns.push(fn); },
    dispose() { el.remove(); },
  };
}
