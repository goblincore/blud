import * as THREE from 'three';

/** Three.js AudioListener parented to the camera + two gain buses (sfx, ambient). */
export interface AudioEngine {
  listener: THREE.AudioListener;
  ctx: AudioContext;
  sfxGain: GainNode;
  ambientGain: GainNode;
}

export function createAudioEngine(camera: THREE.Camera): AudioEngine {
  const listener = new THREE.AudioListener();
  camera.add(listener);
  const ctx = listener.context;

  const sfxGain = ctx.createGain();
  sfxGain.gain.value = 1.0;
  sfxGain.connect(listener.gain);

  const ambientGain = ctx.createGain();
  // Ambient bed is meant to be "brooding background", not foreground — keep it
  // well under SFX. 0.12 puts 1WIND at a barely-there whisper; raise toward
  // 0.2 if the arena feels dead during long idle stretches.
  ambientGain.gain.value = 0.12;
  ambientGain.connect(listener.gain);

  return { listener, ctx, sfxGain, ambientGain };
}

/** Decode an ArrayBuffer into an AudioBuffer via the engine's context. */
export async function decodeAudio(engine: AudioEngine, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    engine.ctx.decodeAudioData(data.slice(0), resolve, reject);
  });
}
