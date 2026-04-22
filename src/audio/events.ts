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

/**
 * Blood SFX name → file candidates keyed by event. Used at load time to map
 * RFF → buffer. Names come from the extracted SFX header (the symbolic name
 * written to `{name}.wav` by scripts/extract_blood_sfx.py), NOT the numeric
 * sound-ID used internally by Blood's dispatchEvent system — that numbering
 * scheme doesn't land cleanly in the extraction filenames.
 */
export const SFX_BLOOD_MAP: Record<SfxEvent, string> = {
  [SfxEvent.LIGHTER_STRIKE]:   'SPARK',     // match flick
  [SfxEvent.FUSE_HISS]:        'BURN',      // burning fuse loop
  [SfxEvent.THROW_GRUNT]:      'CALEBM~1',  // Caleb voice — only player vocal we have
  [SfxEvent.DYNAMITE_BOOM]:    'EXPLODCM',  // medium-close explosion
  [SfxEvent.GIB_SPLAT]:        'SPLATT',    // gib impact
  [SfxEvent.ZOMBIE_IDLE_GROAN]: 'MOAN2LP',  // long loop moan
  [SfxEvent.ZOMBIE_AGGRO]:     'MOAN3',     // shorter aggressive moan
  [SfxEvent.ZOMBIE_DEATH]:     'MOAN4',     // longest — death scream
  [SfxEvent.ZOMBIE_FOOTSTEP]:  'FFSTONE1',  // crypt-stone step
  [SfxEvent.PLAYER_FOOTSTEP]:  'FFSTONE2',  // crypt-stone step alt
};
