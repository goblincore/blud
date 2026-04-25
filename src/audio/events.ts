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
  FLARE_SHOOT = 'flare_shoot',
  FLARE_IMPACT = 'flare_impact',
  FLARE_BURN_LOOP = 'flare_burn_loop',
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
  [SfxEvent.THROW_GRUNT]:      '',          // disabled — CALEBM~1 has a monster vocal mixed into the same file
  [SfxEvent.DYNAMITE_BOOM]:    'EXPLODCM',  // medium-close explosion
  [SfxEvent.GIB_SPLAT]:        'SPLATT',    // gib impact
  [SfxEvent.ZOMBIE_IDLE_GROAN]: 'MOAN2LP',  // long loop moan
  [SfxEvent.ZOMBIE_AGGRO]:     'MOAN3',     // shorter aggressive moan
  [SfxEvent.ZOMBIE_DEATH]:     'MOAN4',     // longest — death scream
  [SfxEvent.ZOMBIE_FOOTSTEP]:  'FFSTONE1',  // crypt-stone step
  [SfxEvent.PLAYER_FOOTSTEP]:  'FFSTONE2',  // crypt-stone step alt
  [SfxEvent.FLARE_SHOOT]:      '',           // TODO: find a fire-shot whoosh SFX (FLARE1.wav placeholder)
  [SfxEvent.FLARE_IMPACT]:     '',           // TODO: find a flare-hit sfx (FLAREHIT.wav placeholder)
  [SfxEvent.FLARE_BURN_LOOP]:  '',           // TODO: looping crackle (FLAREBRN.wav placeholder)
};
