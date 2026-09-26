// src/lab/sdf-zombie/webgpu/game-menu.ts
//
// The Esc menu's decisions, as pure functions: where New game starts, which levels the
// dev picker offers, the URL that starts one, and when the menu shows. Starting a level is a page reload with
// ?level= (the engine cannot swap levels live yet). Pure: no DOM, no three.js; the
// overlay itself is game-menu-dom.ts.

export interface LevelChoice { id: string; label: string }

/** New game starts here (new game flow spec 2026-09-24): the hub, unlit. */
export const NEW_GAME_LEVEL = 'the-void';

/** The dev level picker. `ring` is the testbed (no ?level param); every other id is public/assets/levels/<id>.level.json. */
export const LEVEL_CHOICES: readonly LevelChoice[] = [
  { id: 'ring', label: 'Ring (testbed)' },
  { id: 'the-void', label: 'The Void' },
  { id: 'night-train', label: 'Night Train (WIP)' },
  { id: 'the-wake', label: 'The Wake (WIP)' },
];

/** `href` with the level switched to `id`: ?state is dropped (it names a state of the old
 *  level); every other param (dev flags such as ?spawn=) and the hash survive. */
export function levelUrl(href: string, id: string): string {
  const url = new URL(href);
  url.searchParams.delete('state');
  if (id === 'ring') url.searchParams.delete('level');
  else url.searchParams.set('level', id);
  return url.toString();
}

/** The menu shows whenever the pointer is free after the player has locked it once
 *  (before the first lock the loader and the click-to-lock hint cover it). */
export function shouldShowMenu(s: { locked: boolean; everLocked: boolean }): boolean {
  return s.everLocked && !s.locked;
}
