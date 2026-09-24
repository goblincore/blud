import { describe, expect, it } from 'vitest';
import { LEVEL_CHOICES, levelUrl, shouldShowMenu } from './game-menu';

describe('game menu', () => {
  it('offers the ring testbed and the Wake', () => {
    expect(LEVEL_CHOICES.map(c => c.id)).toEqual(['ring', 'the-wake']);
  });

  it('the ring drops ?level and ?state; other params survive', () => {
    expect(levelUrl('http://x/sdf-game.html?level=the-wake&state=alt&spawn=cultist', 'ring'))
      .toBe('http://x/sdf-game.html?spawn=cultist');
  });

  it('an authored level sets ?level and clears the state', () => {
    expect(levelUrl('http://x/sdf-game.html?state=alt&debug=1', 'the-wake'))
      .toBe('http://x/sdf-game.html?debug=1&level=the-wake');
  });

  it('keeps the hash and has no dangling ? for a bare ring url', () => {
    expect(levelUrl('http://x/sdf-game.html?level=the-wake#p', 'ring')).toBe('http://x/sdf-game.html#p');
  });

  it('shows only after the player has locked once and then released', () => {
    expect(shouldShowMenu({ locked: false, everLocked: false })).toBe(false);
    expect(shouldShowMenu({ locked: true, everLocked: true })).toBe(false);
    expect(shouldShowMenu({ locked: false, everLocked: true })).toBe(true);
  });
});
