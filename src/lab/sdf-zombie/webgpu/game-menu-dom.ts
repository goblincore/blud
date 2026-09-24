// src/lab/sdf-zombie/webgpu/game-menu-dom.ts
//
// The Esc menu overlay. Esc already releases pointer lock (the browser does that); this
// shows a panel whenever the pointer is free after the first lock: Resume re-locks,
// New game lists LEVEL_CHOICES and reloads into one. Decisions live in game-menu.ts.
//
// The game does NOT pause behind the menu (there is no pause in the sim yet).

import { LEVEL_CHOICES, levelUrl, shouldShowMenu } from './game-menu';

const CSS = `
#menu { position: fixed; inset: 0; z-index: 40; display: none; align-items: center; justify-content: center;
  background: rgba(10,4,8,0.55); font: 13px monospace; color: #eee; }
#menu.menu-open { display: flex; }
#menu .menu-panel { min-width: 240px; padding: 18px 20px; background: rgba(20,10,14,0.92); border: 1px solid #5a2a31;
  display: flex; flex-direction: column; gap: 8px; }
#menu .menu-title { font-size: 22px; letter-spacing: 6px; color: #c46a72; text-align: center; margin-bottom: 6px; }
#menu .menu-sub { color: #8f8f8f; font-size: 11px; margin-top: 4px; }
#menu button { font: inherit; color: #eee; background: #2a1419; border: 1px solid #5a2a31; padding: 7px 10px;
  text-align: left; cursor: pointer; }
#menu button:hover, #menu button:focus-visible { background: #4a1f27; outline: none; }
#menu button.menu-current::after { content: ' · current'; color: #8f8f8f; }
#menu .menu-note { color: #c46a72; font-size: 11px; min-height: 1em; }
`;

/** Mounts the menu; `currentLevel` is `ctx.world.level.id` ('ring' for the testbed). */
export function mountGameMenu(canvas: HTMLElement, currentLevel: string): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'menu';
  const panel = document.createElement('div');
  panel.className = 'menu-panel';
  root.appendChild(panel);
  document.body.appendChild(root);

  const note = document.createElement('div');
  note.className = 'menu-note';
  const button = (label: string, onClick: () => void, current = false): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    if (current) b.classList.add('menu-current');
    b.addEventListener('click', onClick);
    return b;
  };

  const resume = (): void => {
    note.textContent = '';
    // Chrome refuses a re-lock for about a second after Esc released it.
    Promise.resolve(canvas.requestPointerLock()).catch(() => { note.textContent = 'not yet — click Resume again'; });
  };
  const showMain = (): void => {
    panel.replaceChildren(
      Object.assign(document.createElement('div'), { className: 'menu-title', textContent: 'PAUSED' }),
      button('Resume', resume),
      button('New game', showLevels),
      note,
    );
  };
  const showLevels = (): void => {
    panel.replaceChildren(
      Object.assign(document.createElement('div'), { className: 'menu-title', textContent: 'NEW GAME' }),
      ...LEVEL_CHOICES.map(c => button(c.label, () => location.assign(levelUrl(location.href, c.id)), c.id === currentLevel)),
      Object.assign(document.createElement('div'), { className: 'menu-sub', textContent: 'starts the level fresh (reloads the page)' }),
      button('Back', showMain),
    );
  };

  let everLocked = false;
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    everLocked ||= locked;
    const open = shouldShowMenu({ locked, everLocked });
    if (open && !root.classList.contains('menu-open')) showMain();
    root.classList.toggle('menu-open', open);
  });
}
