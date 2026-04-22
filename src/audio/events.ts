/** Typed vocabulary for all game sound events. Grows with each milestone. */
export enum SfxEvent {
  LIGHTER_STRIKE = 'lighter_strike',
  FUSE_HISS = 'fuse_hiss',
  THROW_GRUNT = 'throw_grunt',
  DYNAMITE_BOOM = 'dynamite_boom',
  GIB_SPLAT = 'gib_splat',
  ZOMBIE_IDLE_GROAN = 'zombie_idle_groan',
  ZOMBIE_AGGRO = 'zombie_aggro',
  ZOMBIE_DEATH = 'zombie_death',
  ZOMBIE_FOOTSTEP = 'zombie_footstep',
  PLAYER_FOOTSTEP = 'player_footstep',
}

/** Blood SFX ID candidates keyed by event. Used at load time to map RFF → buffer. */
export const SFX_BLOOD_MAP: Record<SfxEvent, string> = {
  [SfxEvent.LIGHTER_STRIKE]:   '431',
  [SfxEvent.FUSE_HISS]:        '441',
  [SfxEvent.THROW_GRUNT]:      '455',
  [SfxEvent.DYNAMITE_BOOM]:    '304',
  [SfxEvent.GIB_SPLAT]:        '508',
  [SfxEvent.ZOMBIE_IDLE_GROAN]: '1107',
  [SfxEvent.ZOMBIE_AGGRO]:     '1106',
  [SfxEvent.ZOMBIE_DEATH]:     '1105',
  [SfxEvent.ZOMBIE_FOOTSTEP]:  '710',
  [SfxEvent.PLAYER_FOOTSTEP]:  '710',
};
