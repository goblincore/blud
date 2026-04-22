# Blud M3 — One-Kill Feel Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the single-kill loop (throw → explode → gib) so it feels *great*, landing the audio engine, post-fx stack, gib-profile taxonomy, and 5-state weapon FSM as generalizable foundations for M4 (arsenal) and M5 (bestiary).

**Architecture:** Four loosely-coupled tracks, all layered onto existing M2 systems. Audio is a new `src/audio/` package (Three.js AudioListener + custom SFX registry + ambient scheduler). Post-fx is a new `src/vfx/post-fx/` package built around the `postprocessing` npm library, swapping `renderer.render()` for `composer.render()`. Gib polish extends the existing `ChunkSystem` via a `GibProfile` interface attached to each dude type. Weapon FSM refactors `Dynamite` from 3 states (IDLE/COOKING/THROWING) to 5 (IDLE/RAISING/IGNITING/COOKING/THROWING) so press-and-release sequencing matches Blood's `processTNT`.

**Tech Stack:** TypeScript, Three.js (r170 WebGLRenderer + AudioListener + PositionalAudio), Rapier3D.js, Vite, Vitest. Adds `postprocessing` (EffectComposer) as a single new npm dep. Python 3 for the Blood SFX extraction tool (mirrors `extract_blood_sprites.py`).

**Source spec:** [docs/superpowers/specs/2026-04-21-blud-m3-feel-pass-design.md](../specs/2026-04-21-blud-m3-feel-pass-design.md)

**Scope note:** M3 bundles 4 subsystems the spec treats as co-tuned. This plan keeps them in one file but phases them so each phase is independently playtestable. If budget overruns, trim post-fx polish *not* audio (per spec Risks section).

---

## File Structure

New files (~14):
- `scripts/extract_blood_sfx.py` — VOC → WAV + manifest (dev-only)
- `src/audio/engine.ts` — AudioContext, listener, bus gain
- `src/audio/events.ts` — typed event-ID enum
- `src/audio/sfx-registry.ts` — eventId → AudioBuffer map, silent fallback
- `src/audio/sfx.ts` — `play(eventId, pos?)` plus throttle pool for `GIB_SPLAT`
- `src/audio/ambient.ts` — wind loop + random-interval spikes
- `src/audio/sfx-registry.test.ts`
- `src/audio/ambient.test.ts`
- `src/vfx/post-fx/config.ts` — `PostFxConfig` + defaults
- `src/vfx/post-fx/composer.ts` — EffectComposer setup + `composer.render()` entry
- `src/vfx/post-fx/palette-dither-pass.ts` — custom ShaderPass (Bayer 8×8 + PAL LUT)
- `src/vfx/post-fx/post-fx-bus.ts` — `triggerDamagePulse()` event emitter
- `src/vfx/post-fx/post-fx-bus.test.ts`
- `src/vfx/post-fx/dev-panel.ts` — `?devfx=1` HUD
- `scripts/build_palette_lut.py` — bake BLOOD.PAL → 16×16 PNG LUT

Modified files (~10):
- `package.json` — add `postprocessing` dep
- `.gitignore` — add `public/assets/audio-placeholder/`, `public/assets/post-fx/`
- `src/game/weapons/dynamite.ts` — 5-state FSM, projectile tumble, SFX events
- `src/game/weapons/dynamite.test.ts` — FSM transition tests
- `src/game/gibs/tuning.ts` — `GibProfile` interface + `ZOMBIE_GIB_PROFILE` + `BONE_PICNUMS`
- `src/game/gibs/chunks.ts` — profile-driven spawn, bone tier, SFX hooks
- `src/game/gibs/chunks.test.ts` — NEW (profile ratio test)
- `src/game/gibs/index.ts` — triggerGib fires `GIB_SPLAT` event
- `src/game/enemy/axe-zombie.ts` — declare `gibProfile`, fire enemy SFX events
- `src/game/enemy/ai.ts` — idle-groan scheduler hooks
- `src/vfx/explosion.ts` — fix aspect + frame timing (if diagnosed)
- `src/engine/renderer.ts` — `composer.render()` replaces `renderer.render()`
- `src/engine/asset-loader.ts` — `loadAudioBuffers()` helper
- `src/main.ts` — wire audio engine + post-fx composer + ambient start

---

## Tasks

### Phase 1 — Foundations (parallel-safe)

Tasks 1–5 are disjoint infrastructure. They can each run in a separate dispatch worktree; none depend on another in Phase 1.

---

### Task 1: Blood SFX extraction tool

**Goal:** Python script that reads BLOOD.RFF, finds `.VOC` resources, converts them to WAV, and emits a manifest. Mirrors `scripts/extract_blood_sprites.py`.

**Files:**
- Create: `scripts/extract_blood_sfx.py`
- Create: `scripts/tests/test_extract_blood_sfx.py`
- Modify: `.gitignore` — add `public/assets/audio-placeholder/`

- [ ] **Step 1: Write failing test for VOC header parsing**

Create `scripts/tests/test_extract_blood_sfx.py`:

```python
"""Tests for Blood VOC → WAV conversion."""
import struct
from pathlib import Path
import pytest

from extract_blood_sfx import parse_voc_header, voc_to_wav_pcm

def _make_voc(sample_rate: int = 11025, data: bytes = b"\x80" * 1024) -> bytes:
    """Synthesize a minimal Creative VOC file (block type 0x01 only)."""
    hdr = b"Creative Voice File\x1a"
    hdr += struct.pack("<HHH", 0x1A, 0x010A, 0x1129)  # offset, version, ~version
    # Block type 0x01 = sound data
    block_len = 2 + len(data)  # freq-divisor + codec + data
    block = bytes([0x01]) + struct.pack("<I", block_len)[:3]
    freq_div = 256 - (1_000_000 // sample_rate)
    block += bytes([freq_div & 0xFF, 0x00])  # unsigned 8-bit PCM
    block += data
    end = bytes([0x00])
    return hdr + block + end

def test_parse_voc_header_reads_sample_rate():
    voc = _make_voc(sample_rate=11025)
    info = parse_voc_header(voc)
    assert info["sample_rate"] == 11025
    assert info["bits"] == 8
    assert info["channels"] == 1

def test_voc_to_wav_pcm_strips_voc_wrapper():
    payload = b"\x40\x80\xC0\x00" * 8
    voc = _make_voc(sample_rate=22050, data=payload)
    sr, bits, pcm = voc_to_wav_pcm(voc)
    assert sr == 22050
    assert bits == 8
    assert pcm == payload

def test_voc_to_wav_pcm_rejects_bad_magic():
    with pytest.raises(ValueError, match="not a VOC"):
        voc_to_wav_pcm(b"\x00" * 32)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/donny/Projects/blud && python -m pytest scripts/tests/test_extract_blood_sfx.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'extract_blood_sfx'`

- [ ] **Step 3: Implement extraction script**

Create `scripts/extract_blood_sfx.py`:

```python
#!/usr/bin/env python3
"""Extract Blood (Build engine) SFX into WAV + manifest.

Reads BLOOD.RFF, finds .VOC resources, decodes each to linear PCM, wraps
it in a RIFF/WAVE header, and writes public/assets/audio-placeholder/sfx/{id}.wav.

Mirrors scripts/extract_blood_sprites.py policy: dev-only placeholders,
never shipped. Drop all outputs if donny cleans placeholder/ later.
"""
from __future__ import annotations
import argparse
import json
import struct
from pathlib import Path


def parse_voc_header(data: bytes) -> dict:
    """Return {'sample_rate', 'bits', 'channels'} from first sound-data block."""
    if data[:19] != b"Creative Voice File":
        raise ValueError("not a VOC file")
    # Header: 20-byte magic, then 2-byte offset to first block.
    first = struct.unpack_from("<H", data, 20)[0]
    offset = first
    while offset < len(data):
        block_type = data[offset]
        if block_type == 0x00:
            break
        block_len = int.from_bytes(data[offset + 1 : offset + 4], "little")
        body = data[offset + 4 : offset + 4 + block_len]
        if block_type == 0x01:
            freq_div, codec = body[0], body[1]
            sample_rate = 1_000_000 // (256 - freq_div)
            if codec != 0x00:
                raise ValueError(f"unsupported VOC codec 0x{codec:02x}")
            return {"sample_rate": sample_rate, "bits": 8, "channels": 1}
        offset += 4 + block_len
    raise ValueError("no sound-data block found")


def voc_to_wav_pcm(voc: bytes) -> tuple[int, int, bytes]:
    """Extract (sample_rate, bits, pcm_bytes) from a VOC. 8-bit unsigned PCM only."""
    info = parse_voc_header(voc)
    # Gather concatenated 0x01 / 0x02 blocks.
    first = struct.unpack_from("<H", voc, 20)[0]
    offset = first
    pcm = bytearray()
    while offset < len(voc):
        bt = voc[offset]
        if bt == 0x00:
            break
        blen = int.from_bytes(voc[offset + 1 : offset + 4], "little")
        body = voc[offset + 4 : offset + 4 + blen]
        if bt == 0x01:
            pcm.extend(body[2:])
        elif bt == 0x02:  # continuation
            pcm.extend(body)
        offset += 4 + blen
    return info["sample_rate"], info["bits"], bytes(pcm)


def wrap_wav(sample_rate: int, bits: int, pcm: bytes) -> bytes:
    """Build a RIFF/WAVE container around raw PCM. 8-bit unsigned mono only."""
    byte_rate = sample_rate * 1 * (bits // 8)
    block_align = 1 * (bits // 8)
    data_size = len(pcm)
    riff = b"RIFF" + struct.pack("<I", 36 + data_size) + b"WAVE"
    fmt = b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, byte_rate, block_align, bits)
    data = b"data" + struct.pack("<I", data_size) + pcm
    return riff + fmt + data


def read_rff_voc_entries(rff_path: Path) -> list[tuple[str, bytes]]:
    """Return [(sfx_id, voc_bytes), ...] for all .VOC entries in the RFF."""
    data = rff_path.read_bytes()
    if data[:4] != b"RFF\x1a":
        raise ValueError(f"not an RFF: magic {data[:4]!r}")
    _, fat_offset, num_files = struct.unpack_from("<III", data, 4)
    fat_raw = data[fat_offset : fat_offset + num_files * 48]
    start_key = fat_raw[0]
    fat = bytes(b ^ ((start_key + (i >> 1)) & 0xFF) for i, b in enumerate(fat_raw))
    out: list[tuple[str, bytes]] = []
    for i in range(num_files):
        entry = fat[i * 48 : (i + 1) * 48]
        offset, size = struct.unpack_from("<II", entry, 16)
        flags = entry[32]
        ext = entry[33:36]
        name = entry[36:44].rstrip(b"\x00 ")
        try:
            name_s = name.decode("ascii")
            ext_s = ext.decode("ascii")
        except UnicodeDecodeError:
            continue
        if ext_s != "VOC":
            continue
        raw = bytearray(data[offset : offset + size])
        if flags & 0x10:  # DICT_CRYPT: first 256 bytes XOR'd
            for i2 in range(min(256, len(raw))):
                raw[i2] ^= (i2 >> 1) & 0xFF
        out.append((name_s, bytes(raw)))
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("rff_path", type=Path, help="Path to BLOOD.RFF")
    p.add_argument("--out", type=Path, default=Path("public/assets/audio-placeholder/sfx"))
    args = p.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {}
    entries = read_rff_voc_entries(args.rff_path)
    print(f"found {len(entries)} .VOC entries")
    for sfx_id, voc in entries:
        try:
            sr, bits, pcm = voc_to_wav_pcm(voc)
        except ValueError as e:
            print(f"  skip {sfx_id}: {e}")
            continue
        wav = wrap_wav(sr, bits, pcm)
        out_path = args.out / f"{sfx_id}.wav"
        out_path.write_bytes(wav)
        manifest[sfx_id] = {
            "file": f"{sfx_id}.wav",
            "sample_rate": sr,
            "bits": bits,
            "size_bytes": len(pcm),
        }
    (args.out.parent / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))
    print(f"wrote {len(manifest)} WAVs to {args.out}")


if __name__ == "__main__":
    main()
```

Also add `scripts/tests/conftest.py` path shim if not already present — the other parser tests import from `scripts/` using `sys.path`; follow the same pattern.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/donny/Projects/blud && python -m pytest scripts/tests/test_extract_blood_sfx.py -v`
Expected: 3 PASS

- [ ] **Step 5: Run extractor against real BLOOD.RFF**

Run: `cd /Users/donny/Projects/blud && python scripts/extract_blood_sfx.py /Users/donny/Documents/Raze/Blood/BLOOD.RFF`
Expected: prints `found N .VOC entries`, writes WAVs + `manifest.json` to `public/assets/audio-placeholder/sfx/`. If the Blood install lives elsewhere, prompt donny for the path.

- [ ] **Step 6: Update .gitignore**

Append to `.gitignore`:

```
# Dev-only Blood SFX placeholders — never ship
public/assets/audio-placeholder/
```

- [ ] **Step 7: Commit**

```bash
git add scripts/extract_blood_sfx.py scripts/tests/test_extract_blood_sfx.py .gitignore
git commit -m "feat(audio): Blood SFX extraction tool (dev placeholder pipeline)"
```

---

### Task 2: Audio engine scaffold

**Goal:** `src/audio/` package with engine, typed event enum, SFX registry with silent fallback, `play(eventId, pos?)`, and ambient scheduler. No wiring into game yet — just the library.

**Files:**
- Create: `src/audio/engine.ts`
- Create: `src/audio/events.ts`
- Create: `src/audio/sfx-registry.ts`
- Create: `src/audio/sfx-registry.test.ts`
- Create: `src/audio/sfx.ts`
- Create: `src/audio/ambient.ts`
- Create: `src/audio/ambient.test.ts`

- [ ] **Step 1: Write failing registry test**

Create `src/audio/sfx-registry.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SfxRegistry } from './sfx-registry';
import { SfxEvent } from './events';

describe('SfxRegistry', () => {
  it('get() returns null for unregistered event (silent fallback)', () => {
    const reg = new SfxRegistry();
    expect(reg.get(SfxEvent.LIGHTER_STRIKE)).toBeNull();
  });

  it('get() returns registered buffer', () => {
    const reg = new SfxRegistry();
    const fake = { duration: 0.1 } as AudioBuffer;
    reg.set(SfxEvent.LIGHTER_STRIKE, fake);
    expect(reg.get(SfxEvent.LIGHTER_STRIKE)).toBe(fake);
  });

  it('set() overwrites without throwing', () => {
    const reg = new SfxRegistry();
    reg.set(SfxEvent.THROW_GRUNT, { duration: 0.1 } as AudioBuffer);
    reg.set(SfxEvent.THROW_GRUNT, { duration: 0.2 } as AudioBuffer);
    expect(reg.get(SfxEvent.THROW_GRUNT)!.duration).toBe(0.2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/audio/sfx-registry.test.ts`
Expected: FAIL (cannot resolve `./sfx-registry` or `./events`)

- [ ] **Step 3: Create events enum + registry**

Create `src/audio/events.ts`:

```typescript
/** Typed vocabulary for all game sound events. Grows with each milestone. */
export enum SfxEvent {
  // Weapon — fired by dynamite FSM
  LIGHTER_STRIKE = 'lighter_strike',   // IGNITING phase entry
  FUSE_HISS = 'fuse_hiss',             // COOKING phase (loop)
  THROW_GRUNT = 'throw_grunt',         // THROWING phase
  DYNAMITE_BOOM = 'dynamite_boom',     // Explosion detonation

  // Gib — fired by GibSystem.triggerGib
  GIB_SPLAT = 'gib_splat',             // Chunk spawn (throttled to 3 voices)

  // Enemy — fired by axe-zombie AI
  ZOMBIE_IDLE_GROAN = 'zombie_idle_groan',  // every 8-20s, random
  ZOMBIE_AGGRO = 'zombie_aggro',            // IDLE → CHASE transition
  ZOMBIE_DEATH = 'zombie_death',            // non-gib death
  ZOMBIE_FOOTSTEP = 'zombie_footstep',      // every N chase steps

  // Player — fired by player controller
  PLAYER_FOOTSTEP = 'player_footstep',
}

/** Blood SFX ID candidates keyed by event. Used at load time to map RFF → buffer. */
export const SFX_BLOOD_MAP: Record<SfxEvent, string> = {
  [SfxEvent.LIGHTER_STRIKE]:   '431',   // cigar lighter
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
```

Create `src/audio/sfx-registry.ts`:

```typescript
import type { SfxEvent } from './events';

/**
 * Map of SfxEvent → decoded AudioBuffer. Missing entries return null so
 * callers can short-circuit without throwing (intentional — a missing
 * placeholder sound should never crash gameplay).
 */
export class SfxRegistry {
  private buffers = new Map<SfxEvent, AudioBuffer>();

  set(event: SfxEvent, buffer: AudioBuffer): void {
    this.buffers.set(event, buffer);
  }

  get(event: SfxEvent): AudioBuffer | null {
    return this.buffers.get(event) ?? null;
  }
}
```

- [ ] **Step 4: Run registry test to verify it passes**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/audio/sfx-registry.test.ts`
Expected: 3 PASS

- [ ] **Step 5: Write failing ambient scheduler test**

Create `src/audio/ambient.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { nextSpikeDelaySec, SpikeConfig } from './ambient';

// Seeded RNG for deterministic tests
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ambient spike scheduler', () => {
  const cfg: SpikeConfig = { minSec: 20, maxSec: 40 };

  it('returns a delay within [min,max] for any RNG output', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 500; i++) {
      const d = nextSpikeDelaySec(cfg, rng);
      expect(d).toBeGreaterThanOrEqual(20);
      expect(d).toBeLessThanOrEqual(40);
    }
  });

  it('uniform-ish distribution over 10k samples', () => {
    const rng = mulberry32(7);
    let sum = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) sum += nextSpikeDelaySec(cfg, rng);
    const mean = sum / N;
    // Expected mean 30; wider tolerance because we have fat tails from the RNG
    expect(mean).toBeGreaterThan(29);
    expect(mean).toBeLessThan(31);
  });

  it('equal min/max always returns that value', () => {
    const rng = mulberry32(1);
    expect(nextSpikeDelaySec({ minSec: 5, maxSec: 5 }, rng)).toBe(5);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/audio/ambient.test.ts`
Expected: FAIL (`nextSpikeDelaySec` not exported)

- [ ] **Step 7: Implement engine, sfx, ambient**

Create `src/audio/engine.ts`:

```typescript
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
  ambientGain.gain.value = 0.6;
  ambientGain.connect(listener.gain);

  return { listener, ctx, sfxGain, ambientGain };
}

/** Decode an ArrayBuffer into an AudioBuffer via the engine's context. */
export async function decodeAudio(engine: AudioEngine, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    engine.ctx.decodeAudioData(data.slice(0), resolve, reject);
  });
}
```

Create `src/audio/sfx.ts`:

```typescript
import * as THREE from 'three';
import type { AudioEngine } from './engine';
import type { SfxRegistry } from './sfx-registry';
import { SfxEvent } from './events';

export interface Vec3Like { x: number; y: number; z: number }

/** Max concurrent voices per event. Prevents N gib splats from overwhelming the mix. */
const THROTTLE: Partial<Record<SfxEvent, number>> = {
  [SfxEvent.GIB_SPLAT]: 3,
};

export class Sfx {
  private activeByEvent = new Map<SfxEvent, Set<AudioBufferSourceNode>>();

  constructor(
    private readonly engine: AudioEngine,
    private readonly registry: SfxRegistry,
  ) {}

  /**
   * Play a one-shot sound. If `pos` is omitted, plays through the 2D sfx bus.
   * If `pos` is provided, plays as a PositionalAudio node at that world-space point.
   * Returns null if buffer missing (silent fallback) or throttled.
   */
  play(event: SfxEvent, pos?: Vec3Like): AudioBufferSourceNode | null {
    const buffer = this.registry.get(event);
    if (!buffer) return null;

    const limit = THROTTLE[event];
    if (limit !== undefined) {
      const active = this.activeByEvent.get(event) ?? new Set();
      if (active.size >= limit) return null; // skip-if-busy (oldest keeps playing)
    }

    const src = this.engine.ctx.createBufferSource();
    src.buffer = buffer;

    if (pos) {
      const panner = this.engine.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 2;
      panner.maxDistance = 40;
      panner.setPosition(pos.x, pos.y, pos.z);
      src.connect(panner).connect(this.engine.sfxGain);
    } else {
      src.connect(this.engine.sfxGain);
    }

    // Track active for throttling; clean up on end.
    const active = this.activeByEvent.get(event) ?? new Set();
    active.add(src);
    this.activeByEvent.set(event, active);
    src.onended = () => {
      active.delete(src);
    };

    src.start(0);
    return src;
  }
}
```

Create `src/audio/ambient.ts`:

```typescript
import type { AudioEngine } from './engine';

export interface SpikeConfig {
  minSec: number;
  maxSec: number;
}

/** Pure function exported for TDD. Returns next spike delay in [min, max]. */
export function nextSpikeDelaySec(cfg: SpikeConfig, rng: () => number): number {
  if (cfg.minSec === cfg.maxSec) return cfg.minSec;
  return cfg.minSec + rng() * (cfg.maxSec - cfg.minSec);
}

/**
 * Two-layer ambient bed:
 *  - wind loop: continuous, seamlessly looped AudioBuffer
 *  - spike scheduler: one-shots every [min, max] seconds
 */
export class Ambient {
  private windSource: AudioBufferSourceNode | null = null;
  private nextSpikeAt = 0;

  constructor(
    private readonly engine: AudioEngine,
    private readonly windBuffer: AudioBuffer | null,
    private readonly spikeBuffer: AudioBuffer | null,
    private readonly spikeCfg: SpikeConfig,
    private readonly rng: () => number = Math.random,
  ) {}

  start(nowSec: number): void {
    if (this.windBuffer) {
      const src = this.engine.ctx.createBufferSource();
      src.buffer = this.windBuffer;
      src.loop = true;
      src.connect(this.engine.ambientGain);
      src.start(0);
      this.windSource = src;
    }
    this.nextSpikeAt = nowSec + nextSpikeDelaySec(this.spikeCfg, this.rng);
  }

  /** Call per frame. Fires spike one-shots when their scheduled time arrives. */
  update(nowSec: number): void {
    if (!this.spikeBuffer) return;
    if (nowSec < this.nextSpikeAt) return;
    const src = this.engine.ctx.createBufferSource();
    src.buffer = this.spikeBuffer;
    // Random ±3 semitones pitch + ±0.3 pan for variety
    src.playbackRate.value = 1 + (this.rng() - 0.5) * 0.35;
    const panner = this.engine.ctx.createStereoPanner();
    panner.pan.value = (this.rng() - 0.5) * 0.6;
    src.connect(panner).connect(this.engine.ambientGain);
    src.start(0);
    this.nextSpikeAt = nowSec + nextSpikeDelaySec(this.spikeCfg, this.rng);
  }

  stop(): void {
    this.windSource?.stop();
    this.windSource = null;
  }
}
```

- [ ] **Step 8: Run all audio tests**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/audio/`
Expected: 6 PASS total (3 registry + 3 ambient)

- [ ] **Step 9: Commit**

```bash
git add src/audio/
git commit -m "feat(audio): engine scaffold + registry + ambient scheduler"
```

---

### Task 3: Post-fx composer skeleton

**Goal:** EffectComposer wired as `composer.render()` replacing `renderer.render()`. Baseline passes (vignette, film grain) enabled; dither + CA placeholders added in later tasks. Dev-panel hotkey F9 / query-string `?devfx=1`.

**Files:**
- Modify: `package.json` — add `postprocessing` dep
- Create: `src/vfx/post-fx/config.ts`
- Create: `src/vfx/post-fx/composer.ts`
- Create: `src/vfx/post-fx/post-fx-bus.ts`
- Create: `src/vfx/post-fx/post-fx-bus.test.ts`
- Create: `src/vfx/post-fx/dev-panel.ts`
- Modify: `src/engine/renderer.ts`
- Modify: `src/main.ts` — plumb composer in boot

- [ ] **Step 1: Add postprocessing dep**

Run: `cd /Users/donny/Projects/blud && npm install postprocessing@^6.36.0`
Expected: package-lock.json updated, `node_modules/postprocessing` present.

- [ ] **Step 2: Write failing bus test**

Create `src/vfx/post-fx/post-fx-bus.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PostFxBus } from './post-fx-bus';

describe('PostFxBus', () => {
  it('currentCAIntensity returns baseline when no pulse active', () => {
    const bus = new PostFxBus(0.05);
    expect(bus.currentCAIntensity(0)).toBeCloseTo(0.05, 5);
    expect(bus.currentCAIntensity(100)).toBeCloseTo(0.05, 5);
  });

  it('triggerDamagePulse raises intensity immediately', () => {
    const bus = new PostFxBus(0.05);
    bus.triggerDamagePulse(0.8, 0.5, 0);
    expect(bus.currentCAIntensity(0)).toBeCloseTo(0.8, 5);
  });

  it('pulse decays linearly toward baseline over duration', () => {
    const bus = new PostFxBus(0.0);
    bus.triggerDamagePulse(1.0, 1.0, 0);
    expect(bus.currentCAIntensity(0.5)).toBeCloseTo(0.5, 3);
    expect(bus.currentCAIntensity(1.0)).toBeCloseTo(0.0, 3);
    expect(bus.currentCAIntensity(1.5)).toBeCloseTo(0.0, 3);
  });

  it('new pulse overrides decaying one', () => {
    const bus = new PostFxBus(0.0);
    bus.triggerDamagePulse(0.4, 1.0, 0);
    bus.triggerDamagePulse(0.9, 1.0, 0.2);
    expect(bus.currentCAIntensity(0.2)).toBeCloseTo(0.9, 3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/vfx/post-fx/post-fx-bus.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 4: Implement bus + config**

Create `src/vfx/post-fx/post-fx-bus.ts`:

```typescript
/**
 * Event bus for post-fx pulses. Passes subscribe by calling `currentCAIntensity(now)`
 * each frame. Pure — no Three.js dep so it's testable.
 */
export class PostFxBus {
  private pulseAmp = 0;
  private pulseStart = 0;
  private pulseDuration = 0;

  constructor(private readonly baselineCA = 0.05) {}

  /** Fire a damage pulse: intensity ramps to `amp` immediately then decays over `durationSec`. */
  triggerDamagePulse(amp: number, durationSec: number, nowSec: number): void {
    this.pulseAmp = amp;
    this.pulseStart = nowSec;
    this.pulseDuration = durationSec;
  }

  /** Linear ease-out from pulseAmp → baseline over pulseDuration seconds. */
  currentCAIntensity(nowSec: number): number {
    const elapsed = nowSec - this.pulseStart;
    if (elapsed < 0 || elapsed >= this.pulseDuration || this.pulseDuration <= 0) {
      return this.baselineCA;
    }
    const t = elapsed / this.pulseDuration; // 0 → 1
    return this.pulseAmp + (this.baselineCA - this.pulseAmp) * t;
  }
}
```

Create `src/vfx/post-fx/config.ts`:

```typescript
/** All post-fx toggles + tunables. Dev-panel mutates this live. */
export interface PostFxConfig {
  vignette: { enabled: boolean; offset: number; darkness: number };
  dither:   { enabled: boolean; strength: number };   // 0..1
  ca:       { enabled: boolean; baseline: number };   // baseline intensity
  grain:    { enabled: boolean; amount: number };
  scanlines: { enabled: boolean };
  barrel:   { enabled: boolean };
}

export const DEFAULT_POST_FX: PostFxConfig = {
  vignette: { enabled: true, offset: 0.35, darkness: 0.6 },
  dither:   { enabled: true, strength: 0.5 },
  ca:       { enabled: true, baseline: 0.0025 },
  grain:    { enabled: true, amount: 0.08 },
  scanlines: { enabled: false },
  barrel:   { enabled: false },
};

/** Query-string + hotkey check for dev mode. */
export function isDevPanelEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('devfx') === '1';
}
```

- [ ] **Step 5: Run bus test to verify it passes**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/vfx/post-fx/post-fx-bus.test.ts`
Expected: 4 PASS

- [ ] **Step 6: Implement composer skeleton (vignette + grain only for now; dither stub)**

Create `src/vfx/post-fx/composer.ts`:

```typescript
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass,
  VignetteEffect, NoiseEffect, ChromaticAberrationEffect, ScanlineEffect,
} from 'postprocessing';
import type { PostFxConfig } from './config';
import type { PostFxBus } from './post-fx-bus';

export interface PostFxComposer {
  render(dtSec: number, nowSec: number): void;
  setSize(w: number, h: number): void;
  /** Mutating handle for dev-panel. Returns the live config reference. */
  readonly config: PostFxConfig;
}

/**
 * Build a composer stack driven by config.
 *
 * Order:  Scene → Vignette → Dither (TODO Task 11) → CA → Grain → [Scanlines] → Output
 *
 * Dither is added in Task 11 once the custom ShaderPass is implemented.
 */
export function createPostFxComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  bus: PostFxBus,
  cfg: PostFxConfig,
): PostFxComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const vignette = new VignetteEffect({
    offset: cfg.vignette.offset,
    darkness: cfg.vignette.darkness,
  });
  const ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(cfg.ca.baseline, 0) });
  const grain = new NoiseEffect({ premultiply: true });
  grain.blendMode.opacity.value = cfg.grain.amount;
  const scanlines = new ScanlineEffect({ density: 1.25 });

  composer.addPass(new EffectPass(camera, vignette, ca, grain, scanlines));

  return {
    render(_dtSec: number, nowSec: number) {
      // Drive CA from bus pulse
      const intensity = bus.currentCAIntensity(nowSec);
      ca.offset.x = intensity;
      ca.offset.y = intensity * 0.5;

      // Live toggles
      vignette.blendMode.opacity.value = cfg.vignette.enabled ? 1 : 0;
      ca.blendMode.opacity.value = cfg.ca.enabled ? 1 : 0;
      grain.blendMode.opacity.value = cfg.grain.enabled ? cfg.grain.amount : 0;
      scanlines.blendMode.opacity.value = cfg.scanlines.enabled ? 0.25 : 0;

      composer.render();
    },
    setSize(w: number, h: number) { composer.setSize(w, h); },
    config: cfg,
  };
}
```

Create stub `src/vfx/post-fx/dev-panel.ts`:

```typescript
import type { PostFxConfig } from './config';

/**
 * Minimal dev HUD: a fixed-position panel with sliders + toggles bound to `cfg`.
 * No framework — plain DOM manipulation to keep bundle size flat.
 */
export function mountDevPanel(parent: HTMLElement, cfg: PostFxConfig): () => void {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed; top:8px; right:8px; z-index:9999;
    background:rgba(20,15,15,0.88); color:#eee; font:11px monospace;
    padding:10px; border:1px solid #444; min-width:220px; user-select:none;
  `;
  el.innerHTML = `
    <div style="font-weight:bold;margin-bottom:6px;">post-fx (F9)</div>
    ${renderToggle('vignette', cfg.vignette.enabled)}
    ${renderToggle('dither', cfg.dither.enabled)}
    ${renderSlider('dither strength', cfg.dither.strength, 0, 1)}
    ${renderToggle('ca', cfg.ca.enabled)}
    ${renderSlider('ca baseline', cfg.ca.baseline, 0, 0.02)}
    ${renderToggle('grain', cfg.grain.enabled)}
    ${renderSlider('grain amount', cfg.grain.amount, 0, 0.3)}
    ${renderToggle('scanlines', cfg.scanlines.enabled)}
    ${renderToggle('barrel', cfg.barrel.enabled)}
  `;
  parent.appendChild(el);

  // Wire handlers — tagged via data-key
  el.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.key!;
      (cfg as unknown as Record<string, { enabled: boolean }>)[key].enabled = cb.checked;
    });
  });
  el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((r) => {
    r.addEventListener('input', () => {
      const [group, field] = r.dataset.key!.split('.');
      (cfg as unknown as Record<string, Record<string, number>>)[group!][field!] = parseFloat(r.value);
    });
  });

  return () => el.remove();
}

function renderToggle(key: string, checked: boolean): string {
  return `<label style="display:block;margin:3px 0;">
    <input type="checkbox" data-key="${key}" ${checked ? 'checked' : ''}> ${key}
  </label>`;
}
function renderSlider(label: string, value: number, min: number, max: number): string {
  const key = label.includes('strength') ? 'dither.strength'
    : label.includes('ca') ? 'ca.baseline'
    : 'grain.amount';
  const step = (max - min) / 100;
  return `<label style="display:block;margin:3px 0;font-size:10px;">
    ${label}:<input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}"
      value="${value}" style="width:100%;">
  </label>`;
}
```

- [ ] **Step 7: Export composer from renderer**

Modify `src/engine/renderer.ts`:

Replace the `setRenderCallback` field + the `renderer.setAnimationLoop` internals with a version that supports an *external* composer. Don't tightly couple — let `main.ts` drive rendering:

```typescript
// At the bottom of createRenderer(), change the animation loop so the render
// callback returns optionally (main.ts draws via composer after its callback):
let cb: (dtSec: number) => void = () => {};
let drawFn: () => void = () => renderer.render(scene, camera);
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  cb(dt);
  drawFn();
});

return {
  renderer, scene, camera,
  canvas: renderer.domElement,
  setRenderCallback(fn) { cb = fn; },
  setDrawFn(fn) { drawFn = fn; },  // NEW
};
```

And extend the interface:

```typescript
export interface RendererHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  setRenderCallback(cb: (dtSec: number) => void): void;
  /** Swap the default renderer.render for a custom draw (e.g. EffectComposer). */
  setDrawFn(fn: () => void): void;
}
```

- [ ] **Step 8: Wire composer + dev panel + F9 in main.ts**

Modify `src/main.ts`. After `createRenderer` and after scene setup, before the scheduler:

```typescript
// ---- Post-FX
import { DEFAULT_POST_FX, isDevPanelEnabled } from './vfx/post-fx/config';
import { createPostFxComposer } from './vfx/post-fx/composer';
import { PostFxBus } from './vfx/post-fx/post-fx-bus';
import { mountDevPanel } from './vfx/post-fx/dev-panel';

const postFxBus = new PostFxBus(DEFAULT_POST_FX.ca.baseline);
const composer = createPostFxComposer(renderer, scene, camera, postFxBus, DEFAULT_POST_FX);
setDrawFn(() => composer.render(0, performance.now() / 1000));

// F9 or ?devfx=1 → show dev panel
let devPanelUnmount: (() => void) | null = null;
if (isDevPanelEnabled()) devPanelUnmount = mountDevPanel(document.body, DEFAULT_POST_FX);
window.addEventListener('keydown', (e) => {
  if (e.key === 'F9') {
    if (devPanelUnmount) { devPanelUnmount(); devPanelUnmount = null; }
    else devPanelUnmount = mountDevPanel(document.body, DEFAULT_POST_FX);
  }
});

// Composer size follow-through on window resize
window.addEventListener('resize', () => {
  composer.setSize(renderer.domElement.width, renderer.domElement.height);
});
```

Destructure `setDrawFn` from `createRenderer(mount)` return.

- [ ] **Step 9: Type-check + run all tests + visual smoke**

Run: `cd /Users/donny/Projects/blud && npm run build`
Expected: `tsc --noEmit` clean, Vite build clean.

Run: `cd /Users/donny/Projects/blud && npx vitest run`
Expected: all existing tests still pass (131 prior + 4 new bus = 135) + audio (6) = 141 total.

Browser smoke: `npm run dev`, open arena — scene renders, slight vignette + grain visible. Press F9 → dev panel appears with toggles.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json src/engine/renderer.ts src/vfx/post-fx/ src/main.ts
git commit -m "feat(post-fx): EffectComposer skeleton + bus + dev panel"
```

---

### Task 4: GibProfile interface + zombie profile

**Goal:** Data-model refactor. `GibProfile` attached to each dude; `ChunkSystem.spawnChunks` takes a profile instead of hardcoded `axeZombieChunks`. No bone variants yet (Task 5); Tier 2 weight stays 0.

**Files:**
- Modify: `src/game/gibs/tuning.ts` — add `GibProfile` type + `ZOMBIE_GIB_PROFILE`
- Modify: `src/game/gibs/chunks.ts` — accept profile, weighted-pick flesh for now
- Create: `src/game/gibs/chunks.test.ts` — NEW (profile spawn math)
- Modify: `src/game/gibs/index.ts` — pass dude's profile to `chunks.spawnChunks`
- Modify: `src/game/gibs/index.ts` — add `gibProfile` to `GibbableDude`
- Modify: `src/game/enemy/axe-zombie.ts` — declare `gibProfile`

- [ ] **Step 1: Write failing profile-math test**

Create `src/game/gibs/chunks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { pickChunkPicnum, rollChunkCount, GibProfile } from './tuning';

// Seeded RNG (mulberry32) so probability tests are deterministic.
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROFILE: GibProfile = {
  fleshPicnums: [1454, 1268, 1269, 1456, 1267],
  bonePicnums:  [421, 422, 423],
  boneWeight: 0.2,
  bodyPartCount: { min: 2, max: 4 },
  chunkCount: { min: 8, max: 14 },
};

describe('pickChunkPicnum', () => {
  it('returns bone ~20% of the time over 10k rolls', () => {
    const rng = mulberry32(1);
    let bone = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const p = pickChunkPicnum(PROFILE, rng);
      if (PROFILE.bonePicnums.includes(p)) bone++;
    }
    const ratio = bone / N;
    expect(ratio).toBeGreaterThan(0.17);
    expect(ratio).toBeLessThan(0.23);
  });

  it('returns only flesh when boneWeight is 0', () => {
    const rng = mulberry32(2);
    const profile = { ...PROFILE, boneWeight: 0 };
    for (let i = 0; i < 1000; i++) {
      const p = pickChunkPicnum(profile, rng);
      expect(PROFILE.fleshPicnums).toContain(p);
    }
  });

  it('returns only bone when boneWeight is 1', () => {
    const rng = mulberry32(3);
    const profile = { ...PROFILE, boneWeight: 1 };
    for (let i = 0; i < 1000; i++) {
      const p = pickChunkPicnum(profile, rng);
      expect(PROFILE.bonePicnums).toContain(p);
    }
  });
});

describe('rollChunkCount', () => {
  it('respects min/max bounds', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const n = rollChunkCount({ min: 8, max: 14 }, rng);
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n).toBeLessThanOrEqual(14);
    }
  });

  it('returns min when min === max', () => {
    const rng = mulberry32(1);
    expect(rollChunkCount({ min: 5, max: 5 }, rng)).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/game/gibs/chunks.test.ts`
Expected: FAIL (`pickChunkPicnum`, `rollChunkCount`, `GibProfile` not exported from `tuning.ts`)

- [ ] **Step 3: Add GibProfile + helpers to tuning.ts**

Append to `src/game/gibs/tuning.ts`:

```typescript
// ——— Gib profile ————————————————————————————————————————
// M3 infrastructure for per-enemy death customization. Each enemy type
// declares a profile; GibSystem reads it at gib time for spawn counts +
// flesh/bone weights. M5 enemies plug in without refactoring ChunkSystem.

export interface ChunkRange { min: number; max: number }

export interface GibProfile {
  /** Flesh tier picnums — torso/arm/leg/spine/misc sprites. */
  fleshPicnums: number[];
  /** Bone tier picnums — clean bones, decorative skull/femur sprites. */
  bonePicnums: number[];
  /** Probability [0,1] a single chunk roll picks from bonePicnums. */
  boneWeight: number;
  /** Count of body-part chunks to spawn (uniform int in [min,max]). */
  bodyPartCount: ChunkRange;
  /** Count of FX_13 blood particles to spray (info only; used by GibSystem). */
  chunkCount: ChunkRange;
}

/** Pick a single chunk picnum biased by profile.boneWeight. */
export function pickChunkPicnum(profile: GibProfile, rng: () => number): number {
  if (profile.bonePicnums.length > 0 && rng() < profile.boneWeight) {
    return profile.bonePicnums[Math.floor(rng() * profile.bonePicnums.length)]!;
  }
  const flesh = profile.fleshPicnums;
  return flesh[Math.floor(rng() * flesh.length)]!;
}

/** Uniform int in [range.min, range.max]. */
export function rollChunkCount(range: ChunkRange, rng: () => number): number {
  if (range.min === range.max) return range.min;
  return range.min + Math.floor(rng() * (range.max - range.min + 1));
}

/** Blood-derived flesh picnums for humanoid enemies (torso, arm, leg, spine, misc). */
export const HUMANOID_FLESH_PICNUMS = [1454, 1268, 1269, 1456, 1267] as const;

/**
 * Bone-tier picnums — filled by Task 5 after extraction. Empty list here
 * means Task 4 only wires the flesh path; boneWeight stays at 0 until
 * Task 5 populates BONE_PICNUMS and bumps the weight.
 */
export const BONE_PICNUMS: number[] = [];

export const ZOMBIE_GIB_PROFILE: GibProfile = {
  fleshPicnums: [...HUMANOID_FLESH_PICNUMS],
  bonePicnums: BONE_PICNUMS,
  boneWeight: 0,              // bumped to 0.2 in Task 5
  bodyPartCount: { min: 2, max: 4 },
  chunkCount: { min: 8, max: 14 },
};
```

- [ ] **Step 4: Run profile-math test**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/game/gibs/chunks.test.ts`
Expected: 5 PASS

Note: the 20% bone test uses `PROFILE.bonePicnums: [421, 422, 423]` not `BONE_PICNUMS`; it tests the function, not the zombie config.

- [ ] **Step 5: Thread GibProfile through ChunkSystem**

Modify `src/game/gibs/chunks.ts`:

```typescript
// New import
import { BLOOD_TRAIL, pickChunkPicnum, rollChunkCount, type GibProfile } from './tuning';

// Drop: private readonly axeZombieChunks = [...];  (deleted — profile-driven now)

// Change signature of spawnChunks:
spawnChunks(origin: Vec3, impulse: Vec3, profile: GibProfile, now: number, rng: () => number = Math.random): void {
  const count = rollChunkCount(profile.bodyPartCount, rng);
  for (let i = 0; i < count; i++) {
    const picnum = pickChunkPicnum(profile, rng);
    this.spawnOne(origin, impulse, picnum, i, count, now);
  }
  this.spawnHead(origin, impulse, now);
  while (this.chunks.length > this.capacity) {
    this.despawn(this.chunks[0]!);
    this.chunks.shift();
  }
}
```

Inside `spawnOne`, change signature to take `totalCount` and use it for the radial `theta`:

```typescript
private spawnOne(
  origin: Vec3, impulse: Vec3, picnum: number, index: number, totalCount: number, now: number,
): void {
  // ... same body, but:
  const theta = (index / totalCount) * Math.PI * 2 + Math.random() * 0.8;
  // ... rest unchanged
}
```

- [ ] **Step 6: Add gibProfile to GibbableDude + pass through triggerGib**

Modify `src/game/gibs/index.ts`:

```typescript
import { ZOMBIE_GIB_PROFILE, type GibProfile } from './tuning';

export interface GibbableDude {
  pos: Vec3;
  hp: number;
  id: string;
  takeDamage(amount: number, impulse: Vec3): void;
  onGibbed?(): void;
  kind: 'player' | 'axe-zombie';
  /** M3: per-enemy gib customization. Required on all dudes. */
  gibProfile: GibProfile;
}

// In triggerGib(), pass profile through:
triggerGib(pos: Vec3, impulse: Vec3, profile: GibProfile, now: number): void {
  console.log(`[gibs] GIB! at (${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)})`);
  this.chunks.spawnChunks(pos, impulse, profile, now);
  // ... existing particle burst using profile.chunkCount.max for count
  const burstCount = profile.chunkCount.max * 2;
  this.particles.emitBurst(pos, {
    tile: GIB_BURST.tile,
    count: burstCount,
    // ... rest unchanged
  });
}

// In spawnExplosion callsite change:
if (damage >= GIB_THRESHOLD) {
  this.triggerGib(dude.pos, impulseVec, dude.gibProfile, now);
  // ... rest unchanged
}
```

- [ ] **Step 7: Declare profile on axe-zombie**

Modify `src/game/enemy/axe-zombie.ts` — add the import + field:

```typescript
import { AXE_ZOMBIE, ZOMBIE_GIB_PROFILE } from '../gibs/tuning';
import type { GibProfile } from '../gibs/tuning';

// On AxeZombie class:
readonly gibProfile: GibProfile = ZOMBIE_GIB_PROFILE;
```

Also update the `GibbableDude` shape that `main.ts` `PlayerGibAdapter` implements — give the player a minimal profile so the type shape holds:

In `src/main.ts`, add to `PlayerGibAdapter`:

```typescript
readonly gibProfile = {
  fleshPicnums: [1454, 1268, 1269, 1456, 1267],
  bonePicnums: [],
  boneWeight: 0,
  bodyPartCount: { min: 2, max: 4 },
  chunkCount: { min: 8, max: 14 },
};
```

- [ ] **Step 8: Run all tests + tsc**

Run: `cd /Users/donny/Projects/blud && npm run build && npx vitest run`
Expected: all previous tests still pass, `chunks.test.ts` added (5 more). Total ≈ 146.

- [ ] **Step 9: Commit**

```bash
git add src/game/gibs/ src/game/enemy/axe-zombie.ts src/main.ts
git commit -m "feat(gibs): GibProfile interface + per-enemy profile wiring"
```

---

### Task 5: Bone picnum extraction + manifest

**Goal:** Scout Blood's tiles000–003 ART for clean-bone decorative sprites, pick 3–4 picnums, extract PNGs into `gibs-placeholder/bone/`, update manifest and `BONE_PICNUMS`, set `ZOMBIE_GIB_PROFILE.boneWeight = 0.2`.

**Note:** This is a mostly-visual research step; the dispatched agent should use `scripts/extract_blood_sprites.py --art TILES000` / `TILES001` / etc. to dump candidate tiles, then inspect the contact-sheet HTML and pick 3–4 clean-bone looking picnums. Candidates per spec: `kThingBone = 421` plus wall-decoration range in tiles000–003.

**Files:**
- Modify: `public/assets/gibs-placeholder/manifest.json` — add bone entries
- Create: `public/assets/gibs-placeholder/bone/<picnum>.png` (×3–4)
- Modify: `src/game/gibs/tuning.ts` — populate `BONE_PICNUMS`, bump `boneWeight` to 0.2
- Modify: `src/engine/asset-loader.ts` — ensure `loadGibTextures` picks up bone entries

- [ ] **Step 1: Run contact-sheet extractor for candidate ART files**

Run: `cd /Users/donny/Projects/blud && python scripts/extract_blood_sprites.py /Users/donny/Documents/Raze/Blood --art TILES000 --out /tmp/bone-scout`
Expected: HTML contact sheet + PNGs for tiles000.art. Check `/tmp/bone-scout/tiles000.html` in a browser.

Repeat for `TILES001`, `TILES002`, `TILES003`.

- [ ] **Step 2: Pick 3–4 bone picnums + copy to gibs-placeholder/bone/**

Candidate picnums to examine first (from spec):
- 421 (`kThingBone`)
- wall-decoration range in tiles000/tiles001 (Blood cathedral/crypt sprites often include femurs, ribs, skulls)

Pick 3–4 picnums matching "clean bone / skull / rib / femur" visuals. Record the chosen picnums in a comment.

```bash
mkdir -p /Users/donny/Projects/blud/public/assets/gibs-placeholder/bone
# Replace <picnum> with each chosen tile number (3–4 total):
cp /tmp/bone-scout/tiles0XX/<picnum>.png /Users/donny/Projects/blud/public/assets/gibs-placeholder/bone/<picnum>.png
```

- [ ] **Step 3: Update gibs-placeholder manifest**

Read `public/assets/gibs-placeholder/manifest.json` and add a `bones` array (or extend existing structure — match the shape `loadGibTextures` expects by inspecting `src/engine/asset-loader.ts`'s `loadGibTextures` function).

Example addition (exact field name depends on existing manifest):

```json
{
  "chunks": [ ... existing ... ],
  "bones": [
    { "picnum": 421, "file": "bone/421.png" },
    { "picnum": 4XX, "file": "bone/4XX.png" },
    { "picnum": 4YY, "file": "bone/4YY.png" }
  ]
}
```

Update `loadGibTextures` in `src/engine/asset-loader.ts` to include bone textures in the returned atlas (same pattern as chunks — the `ChunkTextureAtlas.get(picnum)` already works picnum-keyed; just ensure the loader iterates both arrays).

- [ ] **Step 4: Populate BONE_PICNUMS + bump weight**

Modify `src/game/gibs/tuning.ts`:

```typescript
// Replace:
export const BONE_PICNUMS: number[] = [];
// With the chosen picnums (example — update with real values):
export const BONE_PICNUMS: number[] = [421, 4XX, 4YY];

// And update:
export const ZOMBIE_GIB_PROFILE: GibProfile = {
  fleshPicnums: [...HUMANOID_FLESH_PICNUMS],
  bonePicnums: BONE_PICNUMS,
  boneWeight: 0.2,        // was 0; now 20% bone bias
  bodyPartCount: { min: 2, max: 4 },
  chunkCount: { min: 8, max: 14 },
};
```

- [ ] **Step 5: Run tests + manual visual**

Run: `cd /Users/donny/Projects/blud && npm run build && npx vitest run`
Expected: all tests still pass.

Browser smoke: `npm run dev` → kill a zombie with dynamite → confirm ~1-in-5 spawned chunks is a bone sprite (visually different from flesh).

- [ ] **Step 6: Commit**

```bash
git add public/assets/gibs-placeholder/ src/game/gibs/tuning.ts src/engine/asset-loader.ts
git commit -m "feat(gibs): bone tier variants — 20% bias on zombie gib"
```

---

### Phase 2 — Throw fidelity (in-session, feel-iteration)

### Task 6: 5-state weapon FSM port

**Goal:** Replace `Dynamite`'s 3-state machine (IDLE/cooking/throwingUntil) with 5 phases: IDLE → RAISING → IGNITING → COOKING → THROWING. Cook timer starts at IGNITING→COOKING transition (not onPress). Press-during-RAISING before fuse lit is a no-op that returns to IDLE.

**Files:**
- Modify: `src/game/weapons/dynamite.ts` — FSM refactor
- Modify: `src/game/weapons/dynamite.test.ts` — add FSM transition tests

- [ ] **Step 1: Write failing FSM tests**

Append to `src/game/weapons/dynamite.test.ts`:

```typescript
import { Dynamite } from './dynamite';
import type { FrameCtx } from './types';

// Minimal stub FrameCtx for FSM tests (no physics, no fpAnimator)
function makeCtx(now: number): FrameCtx {
  return {
    world: { createRigidBody: () => ({ setLinvel: () => {}, setAngvel: () => {} }),
             createCollider: () => {}, removeRigidBody: () => {} } as any,
    player: {
      pos: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 },
      handPos: { x: 0, y: 1, z: 0 }, takeDamage: () => {},
    },
    gibs: { spawnExplosion: () => {}, registerDude: () => {}, unregisterDude: () => {} } as any,
    now,
  };
}

describe('Dynamite FSM', () => {
  it('starts in IDLE', () => {
    const d = new Dynamite();
    expect(d.phase()).toBe('idle');
  });

  it('onPress IDLE → RAISING; fuse NOT lit', () => {
    const d = new Dynamite();
    d.onPress(makeCtx(0));
    expect(d.phase()).toBe('raising');
    expect(d.isFuseLit()).toBe(false);
  });

  it('RAISING auto-advances to IGNITING after raiseMs', () => {
    const d = new Dynamite();
    d.onPress(makeCtx(0));
    d.onFrame(makeCtx(0.35), 0.35);  // raiseMs ≈ 300ms + buffer
    expect(d.phase()).toBe('igniting');
  });

  it('IGNITING auto-advances to COOKING after igniteMs; fuse LIT at transition', () => {
    const d = new Dynamite();
    d.onPress(makeCtx(0));
    d.onFrame(makeCtx(0.35), 0.35);   // raising → igniting
    d.onFrame(makeCtx(0.80), 0.45);   // igniting (400ms) → cooking
    expect(d.phase()).toBe('cooking');
    expect(d.isFuseLit()).toBe(true);
  });

  it('cook timer resets at COOKING entry (NOT at press)', () => {
    const d = new Dynamite();
    d.onPress(makeCtx(0));            // t=0 press
    d.onFrame(makeCtx(0.35), 0.35);   // t=0.35 raising→igniting
    d.onFrame(makeCtx(0.80), 0.45);   // t=0.80 igniting→cooking  (cook timer STARTS here)
    // At t=1.80 (1s into cooking), chargeFraction should be ~0.5 of a 2s max
    d.onFrame(makeCtx(1.80), 1.0);
    expect(d.chargeFractionAt(1.80)).toBeCloseTo(0.5, 1);
  });

  it('release during RAISING → no-op, returns to IDLE, no projectile', () => {
    const d = new Dynamite();
    const ammoBefore = d.ammo;
    d.onPress(makeCtx(0));
    d.onRelease(makeCtx(0.15));       // before raiseMs elapses
    expect(d.phase()).toBe('idle');
    expect(d.ammo).toBe(ammoBefore);  // no throw
  });

  it('release during COOKING → THROWING phase', () => {
    const d = new Dynamite();
    d.onPress(makeCtx(0));
    d.onFrame(makeCtx(0.35), 0.35);
    d.onFrame(makeCtx(0.80), 0.45);   // cooking
    // Stub the projectile spawn path — we test the phase only
    const spawnedBefore = (d as any).throwingUntil;
    d.onRelease(makeCtx(1.0));
    expect(d.phase()).toBe('throwing');
  });

  it('THROWING phase ends after throwMs → IDLE', () => {
    const d = new Dynamite();
    d.onPress(makeCtx(0));
    d.onFrame(makeCtx(0.35), 0.35);
    d.onFrame(makeCtx(0.80), 0.45);
    d.onRelease(makeCtx(1.0));
    d.onFrame(makeCtx(1.5), 0.5);     // throwMs ≈ 300ms
    expect(d.phase()).toBe('idle');
  });

  it('overcook during COOKING → self-explode, phase returns to IDLE', () => {
    const d = new Dynamite();
    d.onPress(makeCtx(0));
    d.onFrame(makeCtx(0.35), 0.35);
    d.onFrame(makeCtx(0.80), 0.45);   // cooking
    d.onFrame(makeCtx(0.80 + 2.01), 2.01);  // past fuseMaxSec (2s)
    expect(d.phase()).toBe('idle');   // self-explode auto-returns
  });
});
```

- [ ] **Step 2: Run FSM tests — verify they fail**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/game/weapons/dynamite.test.ts`
Expected: FAIL (no `phase()` / `isFuseLit()` on Dynamite)

- [ ] **Step 3: Refactor Dynamite to 5-state FSM**

Rewrite the `Dynamite` class in `src/game/weapons/dynamite.ts`:

```typescript
type DynPhase = 'idle' | 'raising' | 'igniting' | 'cooking' | 'throwing';

// Phase durations — sourced from QAV manifest durMs × nFrames:
//   dynamite-raise:           10 frames × 42ms  = 420ms (trimmed to 300ms for responsiveness)
//   dynamite-lighter-ignite:   7 frames × 42ms  = ~294ms (spec calls ~400, we use 294 to match real QAV)
//   dynamite-throw:            8 frames × 42ms  = ~336ms
const PHASE_DURATIONS = {
  raisingMs: 300,
  ignitingMs: 294,
  throwingMs: 336,
} as const;

export class Dynamite implements Weapon {
  readonly id = 'dynamite';
  readonly ammoMax = Number.POSITIVE_INFINITY;
  ammo = Number.POSITIVE_INFINITY;

  private _phase: DynPhase = 'idle';
  private phaseEnteredAt = 0;
  private cookStart = 0;            // valid only during 'cooking'
  private pendingRelease = false;   // true if user released during raising/igniting
  private fuseLit = false;

  phase(): DynPhase { return this._phase; }
  isFuseLit(): boolean { return this.fuseLit; }

  onPress(ctx: FrameCtx): void {
    if (this.ammo <= 0) return;
    if (this._phase !== 'idle') return;
    this.enter('raising', ctx);
  }

  onRelease(ctx: FrameCtx): void {
    // During raising: queue a release → return to idle when raise completes (Blood behavior: no-op)
    if (this._phase === 'raising' || this._phase === 'igniting') {
      this.pendingRelease = true;
      return;
    }
    if (this._phase === 'cooking') {
      this.throw(ctx);
    }
  }

  onFrame(ctx: FrameCtx, dt: number): void {
    const elapsed = (ctx.now - this.phaseEnteredAt) * 1000;

    switch (this._phase) {
      case 'raising':
        if (elapsed >= PHASE_DURATIONS.raisingMs) {
          if (this.pendingRelease) {
            this.pendingRelease = false;
            this.enter('idle', ctx);
          } else {
            this.enter('igniting', ctx);
          }
        }
        break;
      case 'igniting':
        if (elapsed >= PHASE_DURATIONS.ignitingMs) {
          this.fuseLit = true;
          this.cookStart = ctx.now;
          if (this.pendingRelease) {
            // User released mid-ignite → throw immediately at min charge
            this.pendingRelease = false;
            this.throw(ctx);
          } else {
            this.enter('cooking', ctx);
          }
        }
        break;
      case 'cooking': {
        const heldSec = ctx.now - this.cookStart;
        if (heldSec >= DYNAMITE_COOK.fuseMaxSec) {
          // Over-cook self-gib
          ctx.gibs.spawnExplosion(ctx.player.pos, EXPLOSION_STANDARD, ctx.now);
          this.fuseLit = false;
          this.enter('idle', ctx);
        }
        break;
      }
      case 'throwing':
        if (elapsed >= PHASE_DURATIONS.throwingMs) {
          this.enter('idle', ctx);
        }
        break;
    }

    updateProjectiles(ctx, dt);
  }

  private enter(next: DynPhase, ctx: FrameCtx): void {
    this._phase = next;
    this.phaseEnteredAt = ctx.now;
    switch (next) {
      case 'raising':  ctx.fpAnimator?.restart('dynamite-raise', ctx.now); break;
      case 'igniting': ctx.fpAnimator?.restart('dynamite-lighter-ignite', ctx.now); break;
      case 'cooking':  ctx.fpAnimator?.restart('dynamite-idle', ctx.now); break;
      case 'throwing': ctx.fpAnimator?.restart('dynamite-throw', ctx.now); break;
      case 'idle':
        this.fuseLit = false;
        ctx.fpAnimator?.restart('dynamite-idle', ctx.now);
        break;
    }
  }

  private throw(ctx: FrameCtx): void {
    const heldSec = ctx.now - this.cookStart;
    const frac = chargeFraction(heldSec);
    const speed = throwVelocityMps(frac);
    const fuseLeft = Math.max(0, remainingFuse(heldSec));
    const vel = throwVector(ctx.player.forward, speed);
    spawnProjectile(ctx.world, ctx.player.handPos, vel, fuseLeft, ctx.now);
    this.ammo--;
    this.fuseLit = false;
    this.enter('throwing', ctx);
  }

  chargeFraction(): number { return 0; }

  chargeFractionAt(now: number): number {
    if (this._phase !== 'cooking') return 0;
    return chargeFraction(now - this.cookStart);
  }

  isCooking(): boolean { return this._phase === 'cooking'; }

  renderView(_ctx: ViewCtx): void { /* handled by fpAnimator */ }
  renderHud(_ctx: HudCtx): void { /* handled by ChargeHud */ }
}
```

Drop the unused private fields (`cooking`, `cookStart`, `throwingUntil`) from the old implementation.

- [ ] **Step 4: Run FSM tests — verify they pass**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/game/weapons/dynamite.test.ts`
Expected: all prior tests + 8 new FSM tests = 18+ PASS in this file.

- [ ] **Step 5: Manual playtest for feel**

Run: `cd /Users/donny/Projects/blud && npm run dev`. Open arena. Verify:
- Press-hold-release cycles through raise → ignite → cook → throw with animation transitions
- Fuse hiss begins only when the lighter finishes striking (~0.6s into press) — not on press
- Quick tap before raise completes is a no-op
- Hold past 2s from cook-start → self-gib

Tune `PHASE_DURATIONS.raisingMs` / `ignitingMs` to taste if the sequencing feels sluggish (they're starting points; spec allows iteration).

- [ ] **Step 6: Commit**

```bash
git add src/game/weapons/dynamite.ts src/game/weapons/dynamite.test.ts
git commit -m "feat(weapons): 5-state dynamite FSM (raising/igniting/cooking/throwing)"
```

---

### Task 7: Projectile tumble around camera axis

**Goal:** Flying dynamite visibly rotates while remaining camera-facing. Spin rate derived from projection of Rapier angular velocity onto camera-forward.

**Files:**
- Modify: `src/game/weapons/dynamite.ts` — change `updateProjectiles` mesh orientation

- [ ] **Step 1: Replace lookAt-only logic with spin-around-camera-axis**

In `src/game/weapons/dynamite.ts`, inside `updateProjectiles`:

Find:
```typescript
if (p.mesh) {
  p.mesh.position.set(t.x, t.y, t.z);
  if (projectileCamera) p.mesh.lookAt(projectileCamera.position);
}
```

Replace with:

```typescript
if (p.mesh) {
  p.mesh.position.set(t.x, t.y, t.z);
  if (projectileCamera) {
    // 1) Face the camera (billboard readability).
    p.mesh.lookAt(projectileCamera.position);
    // 2) Extract spin rate from the physics body's angular velocity,
    //    projected onto the camera-forward axis. This gives visible tumble
    //    without the plane ever going edge-on.
    const av = p.body.angvel();
    const camPos = projectileCamera.position;
    const dx = t.x - camPos.x, dy = t.y - camPos.y, dz = t.z - camPos.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const fx = dx / len, fy = dy / len, fz = dz / len;
    const spinRate = av.x * fx + av.y * fy + av.z * fz;   // rad/s along cam-forward
    // Integrate spin: accumulate rotation about the mesh's local Z (billboard normal).
    // Use a mesh userData field to keep the running angle.
    const ud = p.mesh.userData as { _spinAngle?: number };
    ud._spinAngle = (ud._spinAngle ?? 0) + spinRate * 0.016; // rough dt; visual only
    p.mesh.rotateOnAxis(new THREE.Vector3(0, 0, 1), spinRate * 0.016);
  }
}
```

(Use a cached `new THREE.Vector3(0, 0, 1)` at module scope if the allocation shows up in a profile — the plan keeps it simple first.)

- [ ] **Step 2: tsc + smoke**

Run: `cd /Users/donny/Projects/blud && npm run build`
Expected: clean.

Browser smoke: throw dynamite, watch projectile in flight — should spin visibly while staying readable. If spin looks jittery, multiply the scalar by a smaller factor (e.g. 0.008 instead of 0.016).

- [ ] **Step 3: Commit**

```bash
git add src/game/weapons/dynamite.ts
git commit -m "feat(weapons): projectile tumble — spin around camera-forward axis"
```

---

### Task 8: Explosion sprite investigation + fix

**Goal:** Diagnose why the current explosion sprite looks distorted / wrong-scale, then fix the root cause. Budget ~1h; if it turns into a rabbit hole, stop and re-scope.

**Files (likely):**
- Modify: `src/vfx/explosion.ts`
- Modify: `public/assets/vfx/explosion-placeholder/manifest.json`
- Possibly: `public/assets/vfx/explosion-placeholder/<picnum>.png` — re-extract

- [ ] **Step 1: Diagnostic pass — check manifest picnums**

Read: `public/assets/vfx/explosion-placeholder/manifest.json`. Blood's `kExplosionStandard` SEQ plays tile range starting at `picnum 2384` (M2 extraction). Verify manifest matches:
- frames listed
- files present in `public/assets/vfx/explosion-placeholder/`
- picnums align with Blood's `seq_explode.seq` (check NotBlood `actor.cpp:2300` + SEQ file if reachable)

- [ ] **Step 2: Check aspect ratio**

Read `src/vfx/explosion.ts:30`. Current geometry: `new THREE.PlaneGeometry(sizeM * 2, sizeM * 2)` — always square. Check `tiles-meta.json` for the explosion frames: if the sprites are non-square (Blood fireballs are taller than wide), the 1:1 plane squashes them.

If non-square: change to use actual `meta.w / meta.h` aspect from `tiles-meta.json` (passed in via atlas interface), or hardcode the aspect after measuring the PNGs.

- [ ] **Step 3: Check frame-advance timing**

`ExplosionVfx.update` uses `atlas.frameDurationMs`. Blood's explosion SEQ runs at 10 tics (~83ms per frame) across 5 frames. If `frameDurationMs` is set lower (e.g. 50ms), frames play too fast → looks jittery/distorted. Check the manifest and compare to Blood's SEQ.

- [ ] **Step 4: Fix whichever of the above is wrong**

Most common root cause based on spec's symptoms: aspect mismatch. Apply the fix:

```typescript
// In ExplosionVfx.spawn, if atlas provides w/h:
spawn(pos: {...}, sizeM: number, atlas: ExplosionAtlas): void {
  const aspect = atlas.frameAspect ?? 1.0;  // w/h ratio
  const geom = new THREE.PlaneGeometry(sizeM * 2, (sizeM * 2) / aspect);
  // ...
}
```

And extend `ExplosionAtlas` interface:

```typescript
export interface ExplosionAtlas {
  frameCount: number;
  get(frame: number): THREE.Texture;
  frameDurationMs: number;
  /** w / h ratio of the sprite (non-square sprites squash into 1:1 quads). */
  frameAspect?: number;
}
```

Update `loadExplosionAtlas` in `asset-loader.ts` to populate `frameAspect` from the PNG dimensions (or from `tiles-meta.json`).

- [ ] **Step 5: Visual verification**

Run: `npm run dev` → throw dynamite → watch explosion. Should look proportional and advance at a readable pace (not blink-fast, not slo-mo).

If still off after ~1h of iteration: stop. Write the remaining mystery into a follow-up ticket (`F2.explosion` in TASKS.md) and move on.

- [ ] **Step 6: Run tests**

Run: `cd /Users/donny/Projects/blud && npm run build && npx vitest run`
Expected: all still pass.

- [ ] **Step 7: Commit**

```bash
git add src/vfx/explosion.ts src/engine/asset-loader.ts public/assets/vfx/explosion-placeholder/
git commit -m "fix(vfx): explosion sprite aspect/timing to match Blood SEQ"
```

---

### Phase 3 — Audio pass (hybrid)

### Task 9: Wire 10-event firing

**Goal:** All 10 events from the spec's vocabulary fire at the correct trigger points. Mechanical wiring — no tuning.

**Files:**
- Modify: `src/engine/asset-loader.ts` — add `loadAudioBuffers()`
- Modify: `src/main.ts` — construct `AudioEngine`, `SfxRegistry`, `Sfx` at boot; populate registry
- Modify: `src/game/weapons/dynamite.ts` — fire `LIGHTER_STRIKE`, `FUSE_HISS` (loop start/stop), `THROW_GRUNT`, `DYNAMITE_BOOM`
- Modify: `src/game/gibs/index.ts` — fire `GIB_SPLAT` per chunk spawn (up to throttle cap)
- Modify: `src/game/enemy/axe-zombie.ts` — fire `ZOMBIE_AGGRO`, `ZOMBIE_DEATH`, `ZOMBIE_FOOTSTEP`
- Modify: `src/game/enemy/ai.ts` — schedule `ZOMBIE_IDLE_GROAN` every 8–20s
- Modify: `src/game/player.ts` — fire `PLAYER_FOOTSTEP` every N steps

- [ ] **Step 1: Add audio buffer loader**

Modify `src/engine/asset-loader.ts` — add:

```typescript
import type { AudioEngine } from '../audio/engine';
import { decodeAudio } from '../audio/engine';
import { SfxEvent, SFX_BLOOD_MAP } from '../audio/events';
import { SfxRegistry } from '../audio/sfx-registry';

/**
 * Fetches WAVs listed in manifest.json and decodes each into an AudioBuffer
 * mapped to its SfxEvent. Missing files fail silently — the registry's
 * silent-fallback handles it at play time.
 */
export async function loadSfxRegistry(
  engine: AudioEngine,
  basePath = '/assets/audio-placeholder/sfx',
): Promise<SfxRegistry> {
  const registry = new SfxRegistry();
  const events: SfxEvent[] = Object.values(SfxEvent);
  await Promise.all(events.map(async (event) => {
    const bloodId = SFX_BLOOD_MAP[event];
    try {
      const res = await fetch(`${basePath}/${bloodId}.wav`);
      if (!res.ok) return;
      const data = await res.arrayBuffer();
      const buf = await decodeAudio(engine, data);
      registry.set(event, buf);
    } catch (err) {
      console.warn(`[audio] failed to load ${event} (${bloodId})`, err);
    }
  }));
  return registry;
}

export async function loadAmbientBuffers(
  engine: AudioEngine,
  basePath = '/assets/audio-placeholder/ambient',
): Promise<{ wind: AudioBuffer | null; spike: AudioBuffer | null }> {
  const fetchDecode = async (name: string): Promise<AudioBuffer | null> => {
    try {
      const r = await fetch(`${basePath}/${name}`);
      if (!r.ok) return null;
      return await decodeAudio(engine, await r.arrayBuffer());
    } catch { return null; }
  };
  const [wind, spike] = await Promise.all([
    fetchDecode('wind.wav'),
    fetchDecode('thunder.wav'),
  ]);
  return { wind, spike };
}
```

- [ ] **Step 2: Construct audio engine at boot**

Modify `src/main.ts`. After `createRenderer` + before post-fx setup:

```typescript
import { createAudioEngine } from './audio/engine';
import { Sfx } from './audio/sfx';
import { SfxEvent } from './audio/events';
import { Ambient } from './audio/ambient';
import { loadSfxRegistry, loadAmbientBuffers } from './engine/asset-loader';

const audioEngine = createAudioEngine(camera);
const sfxRegistry = await loadSfxRegistry(audioEngine);
const sfx = new Sfx(audioEngine, sfxRegistry);
const ambient = (async () => {
  const bufs = await loadAmbientBuffers(audioEngine);
  return new Ambient(audioEngine, bufs.wind, bufs.spike, { minSec: 20, maxSec: 40 });
})();

// After first user gesture (click) we can start ambient — required by browser autoplay policy.
const startAudioOnce = () => {
  if (audioEngine.ctx.state === 'suspended') audioEngine.ctx.resume();
  ambient.then((a) => a.start(performance.now() / 1000));
  canvas.removeEventListener('click', startAudioOnce);
};
canvas.addEventListener('click', startAudioOnce);
```

Pass `sfx` through the existing dude/weapon ctor/wiring so gameplay code can call `sfx.play(...)`. The simplest threading: attach to a module-level export or to `FrameCtx`.

Add to `FrameCtx` in `src/game/weapons/types.ts`:

```typescript
import type { Sfx } from '../../audio/sfx';

export interface FrameCtx {
  world: RAPIER.World;
  player: Player;
  gibs: GibSystem;
  now: number;
  fpAnimator?: FpWeaponAnimator;
  sfx?: Sfx;    // NEW — optional so tests don't need to stub
}
```

- [ ] **Step 3: Fire weapon events from dynamite FSM**

In `src/game/weapons/dynamite.ts`'s `enter()` method:

```typescript
import { SfxEvent } from '../../audio/events';

private enter(next: DynPhase, ctx: FrameCtx): void {
  // ...existing animation switch...
  switch (next) {
    case 'raising':  ctx.fpAnimator?.restart('dynamite-raise', ctx.now); break;
    case 'igniting':
      ctx.fpAnimator?.restart('dynamite-lighter-ignite', ctx.now);
      ctx.sfx?.play(SfxEvent.LIGHTER_STRIKE);
      break;
    case 'cooking':
      ctx.fpAnimator?.restart('dynamite-idle', ctx.now);
      this._fuseHissSrc = ctx.sfx?.play(SfxEvent.FUSE_HISS) ?? null;
      if (this._fuseHissSrc) (this._fuseHissSrc as any).loop = true;
      break;
    case 'throwing':
      ctx.fpAnimator?.restart('dynamite-throw', ctx.now);
      ctx.sfx?.play(SfxEvent.THROW_GRUNT);
      this._fuseHissSrc?.stop();
      this._fuseHissSrc = null;
      break;
    case 'idle':
      this.fuseLit = false;
      ctx.fpAnimator?.restart('dynamite-idle', ctx.now);
      this._fuseHissSrc?.stop();
      this._fuseHissSrc = null;
      break;
  }
  this._phase = next;
  this.phaseEnteredAt = ctx.now;
}
```

Add `private _fuseHissSrc: AudioBufferSourceNode | null = null;` to the Dynamite class.

Also in `updateProjectiles` (the detonation branch), call:

```typescript
if (p.fuseLeft <= 0) {
  ctx.gibs.spawnExplosion({ x: t.x, y: t.y, z: t.z }, EXPLOSION_STANDARD, ctx.now);
  ctx.sfx?.play(SfxEvent.DYNAMITE_BOOM, { x: t.x, y: t.y, z: t.z });
  // ...rest unchanged
}
```

Need to pass `ctx` into `updateProjectiles` (it already does — it takes `FrameCtx` as the first arg). Good.

- [ ] **Step 4: Fire GIB_SPLAT from chunk spawn**

Modify `src/game/gibs/chunks.ts`. Pass `Sfx` to ChunkSystem ctor (or via a setter), and call `sfx.play(SfxEvent.GIB_SPLAT, origin)` once per chunk in `spawnOne` (the throttle is in `Sfx` — max 3 concurrent).

Minimally, add optional setter:

```typescript
private sfx: import('../../audio/sfx').Sfx | null = null;
setSfx(sfx: import('../../audio/sfx').Sfx): void { this.sfx = sfx; }

// In spawnOne, after body/mesh setup:
this.sfx?.play('gib_splat' as import('../../audio/events').SfxEvent, origin);
```

Wire from `main.ts` right after `chunks` construction:

```typescript
chunks.setSfx(sfx);
```

- [ ] **Step 5: Fire enemy events from axe-zombie + ai**

In `src/game/enemy/ai.ts`, give `ZombieBrain` an optional callback:

```typescript
export interface BrainHooks {
  onAggroTransition?: () => void;
  onIdleGroan?: () => void;
  onFootstep?: () => void;
}
```

Add a footstep-step counter + idle-groan timer to the brain. Wire up in axe-zombie.ts:

```typescript
// In AxeZombie constructor, take sfx + pass hooks to brain:
readonly brain = new ZombieBrain(
  { hp: AXE_ZOMBIE.hp, speed: AXE_ZOMBIE.speed },
  {
    onAggroTransition: () => this.sfx?.play(SfxEvent.ZOMBIE_AGGRO, this.pos),
    onIdleGroan: () => this.sfx?.play(SfxEvent.ZOMBIE_IDLE_GROAN, this.pos),
    onFootstep: () => this.sfx?.play(SfxEvent.ZOMBIE_FOOTSTEP, this.pos),
  },
);
```

In `takeDamage()` where the brain transitions to Dead:

```typescript
if (wasAlive && this.brain.state === ZombieState.Dead && impulseMag <= 50) {
  // non-explode death (normal kill, under gib threshold)
  this.sfx?.play(SfxEvent.ZOMBIE_DEATH, this.pos);
}
```

Idle-groan scheduler in `ZombieBrain.update`:

```typescript
// Add fields:
private nextGroanAt = 0;
// In update():
if (this.state === ZombieState.Idle && nowSec >= this.nextGroanAt) {
  this.hooks?.onIdleGroan?.();
  this.nextGroanAt = nowSec + 8 + Math.random() * 12;
}
```

Footstep: in `desiredVelocity` (or wherever movement is applied), accumulate travelled distance; every ~0.8m, call `hooks.onFootstep()`.

- [ ] **Step 6: Fire PLAYER_FOOTSTEP**

In `src/game/player.ts` (inspect existing structure first), track distance travelled each frame. When exceeding 0.8m, reset and fire:

```typescript
player.setSfx(sfx); // add setter analogous to ChunkSystem
// Inside player.update, if horizSpeed > 0.5:
this.distanceAccum += Math.hypot(...) * dt;
if (this.distanceAccum > 0.8) { this.sfx?.play(SfxEvent.PLAYER_FOOTSTEP); this.distanceAccum = 0; }
```

- [ ] **Step 7: Tests + smoke**

Run: `cd /Users/donny/Projects/blud && npm run build && npx vitest run`
Expected: all still pass (wiring is behind optional chaining — no runtime behavior change when sfx absent).

Browser smoke: `npm run dev` → click canvas (starts audio) → press → lighter strike sound → hold → fuse hiss loops → release → grunt → explosion boom + gib splats. Zombies groan in idle, shout on aggro, footstep while chasing, grunt on death.

- [ ] **Step 8: Commit**

```bash
git add src/audio/ src/engine/asset-loader.ts src/game/ src/main.ts
git commit -m "feat(audio): wire 10 gameplay events — weapon, gib, enemy, player"
```

---

### Task 10: Ambient mix + curation

**Goal:** Pick + trim the wind loop and thunder one-shot from Blood's SFX pool. Tune bus levels (audio mixing is subjective — plan this as an in-session feel pass).

**Files:**
- Create / copy: `public/assets/audio-placeholder/ambient/wind.wav`, `.../thunder.wav`
- Modify: `src/audio/engine.ts` — bus gain defaults if re-tuned
- Modify: `src/main.ts` — ambient spike config if re-tuned

- [ ] **Step 1: Pick wind + thunder SFX candidates**

From the Blood RFF, candidates: any sustained low-rumble SFX for wind (Blood has ambient cathedral wind); any sharp percussive SFX for thunder. If none fit cleanly, pick a short hiss for wind and a muffled boom for thunder — perfect isn't needed at this stage.

Copy chosen files:

```bash
mkdir -p /Users/donny/Projects/blud/public/assets/audio-placeholder/ambient
cp public/assets/audio-placeholder/sfx/<wind-id>.wav public/assets/audio-placeholder/ambient/wind.wav
cp public/assets/audio-placeholder/sfx/<thunder-id>.wav public/assets/audio-placeholder/ambient/thunder.wav
```

- [ ] **Step 2: Check seamless-loop quality on wind**

Play `wind.wav` back-to-back with itself (any audio editor or `ffplay wind.wav -loop 0`). If there's an audible seam, trim the head/tail in an editor or use a crossfade (sox or ffmpeg's `afade`). Document the chosen file + any edits in `public/assets/audio-placeholder/README.md` (create if absent).

- [ ] **Step 3: In-session mix tuning**

Run dev server. Walk around the arena with ambient playing + trigger combat. Adjust:
- `audioEngine.ambientGain.gain.value` (default 0.6) — lower until wind is background, combat SFX are in front
- `SpikeConfig { minSec, maxSec }` — 20–40 may feel too sparse or too frequent depending on sample length

Tune live via browser devtools console (mutate the gain node) — write the final values back to code once they feel right.

- [ ] **Step 4: Manual sign-off by donny**

Playtest 2–3 min continuous arena. Confirm ambient reads as "brooding crypt", not "distracting loop".

- [ ] **Step 5: Commit**

```bash
git add public/assets/audio-placeholder/ambient/ src/main.ts src/audio/engine.ts
git commit -m "feat(audio): ambient bed — wind loop + random thunder spikes"
```

---

### Phase 4 — Visual pass (in-session)

### Task 11: Palette dither shader pass

**Goal:** Custom `ShaderPass` — Bayer 8×8 dither + BLOOD.PAL snap. The distinctive "clay" look.

**Files:**
- Create: `scripts/build_palette_lut.py` — bake BLOOD.PAL → 16×16 LUT PNG
- Create: `public/assets/post-fx/BLOOD.PAL.png` (gitignored)
- Create: `src/vfx/post-fx/palette-dither-pass.ts`
- Modify: `src/vfx/post-fx/composer.ts` — insert new pass between vignette and CA
- Modify: `.gitignore` — add `public/assets/post-fx/`

- [ ] **Step 1: Write palette LUT builder**

Create `scripts/build_palette_lut.py`:

```python
#!/usr/bin/env python3
"""Bake BLOOD.PAL into a 16×16 LUT PNG for the palette-dither shader.

Each pixel is one palette entry — R/G/B from the palette, A=0xFF.
Shader samples via a texture2D lookup indexed by quantized RGB.
"""
from __future__ import annotations
import argparse, struct
from pathlib import Path
from PIL import Image

def read_pal_from_rff(rff_path: Path) -> bytes:
    """Reuse the logic from extract_blood_sprites.py."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from extract_blood_sprites import read_palette_from_rff
    return read_palette_from_rff(rff_path)

def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("rff_path", type=Path)
    p.add_argument("--out", type=Path, default=Path("public/assets/post-fx/BLOOD.PAL.png"))
    args = p.parse_args()
    pal = read_pal_from_rff(args.rff_path)   # 768 bytes, 256 RGB triples
    assert len(pal) == 768
    img = Image.new("RGBA", (16, 16))
    for i in range(256):
        r, g, b = pal[i*3], pal[i*3+1], pal[i*3+2]
        img.putpixel((i % 16, i // 16), (r, g, b, 255))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    img.save(args.out)
    print(f"wrote {args.out}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the baker**

Run: `cd /Users/donny/Projects/blud && python scripts/build_palette_lut.py /Users/donny/Documents/Raze/Blood/BLOOD.RFF`
Expected: `public/assets/post-fx/BLOOD.PAL.png` (16×16 RGBA PNG).

Update `.gitignore`:

```
# Baked palette LUT — re-generated from BLOOD.RFF by scripts/build_palette_lut.py
public/assets/post-fx/
```

- [ ] **Step 3: Implement palette-dither pass**

Create `src/vfx/post-fx/palette-dither-pass.ts`:

```typescript
import * as THREE from 'three';
import { Effect } from 'postprocessing';

const DITHER_FRAG = /* glsl */`
  uniform sampler2D palette;
  uniform float ditherStrength;   // 0 = flat snap, 1 = full bayer

  // Classic Bayer 8x8 — values in [0,63], normalized to [-0.5, 0.5] on use.
  const float bayer[64] = float[](
     0., 32.,  8., 40.,  2., 34., 10., 42.,
    48., 16., 56., 24., 50., 18., 58., 26.,
    12., 44.,  4., 36., 14., 46.,  6., 38.,
    60., 28., 52., 20., 62., 30., 54., 22.,
     3., 35., 11., 43.,  1., 33.,  9., 41.,
    51., 19., 59., 27., 49., 17., 57., 25.,
    15., 47.,  7., 39., 13., 45.,  5., 37.,
    63., 31., 55., 23., 61., 29., 53., 21.
  );

  // Nearest-color lookup: scan all 256 palette entries. This is O(256) per
  // pixel per frame — at 960×540 that's ~130M ops, fine for a GPU.
  vec3 snapToPalette(vec3 c) {
    float bestDist = 999.0;
    vec3 bestCol = c;
    for (int i = 0; i < 256; i++) {
      vec2 uv = vec2(float(i % 16) / 16.0, float(i / 16) / 16.0);
      vec3 p = texture2D(palette, uv).rgb;
      float d = dot(c - p, c - p);
      if (d < bestDist) { bestDist = d; bestCol = p; }
    }
    return bestCol;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    ivec2 pix = ivec2(mod(gl_FragCoord.xy, 8.0));
    float b = (bayer[pix.y * 8 + pix.x] / 63.0 - 0.5) * (1.0/16.0); // small offset
    vec3 offset = vec3(b * ditherStrength);
    vec3 snapped = snapToPalette(clamp(inputColor.rgb + offset, 0.0, 1.0));
    outputColor = vec4(snapped, inputColor.a);
  }
`;

export class PaletteDitherEffect extends Effect {
  constructor(paletteTexture: THREE.Texture, strength = 0.5) {
    super('PaletteDither', DITHER_FRAG, {
      uniforms: new Map<string, THREE.Uniform>([
        ['palette', new THREE.Uniform(paletteTexture)],
        ['ditherStrength', new THREE.Uniform(strength)],
      ]),
    });
  }

  get ditherStrength(): number {
    return (this.uniforms.get('ditherStrength') as THREE.Uniform).value;
  }
  set ditherStrength(v: number) {
    (this.uniforms.get('ditherStrength') as THREE.Uniform).value = v;
  }
}
```

- [ ] **Step 4: Insert into composer stack**

Modify `src/vfx/post-fx/composer.ts`:

```typescript
import { PaletteDitherEffect } from './palette-dither-pass';

// In createPostFxComposer, after loading palette texture:
const paletteTex = new THREE.TextureLoader().load('/assets/post-fx/BLOOD.PAL.png');
paletteTex.magFilter = THREE.NearestFilter;
paletteTex.minFilter = THREE.NearestFilter;
paletteTex.generateMipmaps = false;
const dither = new PaletteDitherEffect(paletteTex, cfg.dither.strength);

// Change the EffectPass order:
composer.addPass(new EffectPass(camera, vignette, dither, ca, grain, scanlines));

// Per-frame live update:
return {
  render(_dtSec, nowSec) {
    // ...existing updates...
    dither.ditherStrength = cfg.dither.enabled ? cfg.dither.strength : 0;
    composer.render();
  },
  ...
};
```

- [ ] **Step 5: Type-check + browser smoke**

Run: `cd /Users/donny/Projects/blud && npm run build`
Expected: clean.

Browser smoke: `npm run dev`. Scene should have a visible dither pattern + palette-reduced colors. With `?devfx=1`, slide `dither strength` from 0→1 and watch the effect range from flat-banding to strong-dot-pattern. If sprite edges show halos, note and address in Task 12.

- [ ] **Step 6: Tune default ditherStrength**

Iterate `DEFAULT_POST_FX.dither.strength` between 0.2 and 0.8 until it feels right with the crypt-stone arena. Commit the chosen value.

- [ ] **Step 7: Commit**

```bash
git add scripts/build_palette_lut.py src/vfx/post-fx/palette-dither-pass.ts src/vfx/post-fx/composer.ts .gitignore
git commit -m "feat(post-fx): Bayer dither + BLOOD.PAL palette snap shader pass"
```

---

### Task 12: CA pulse + vignette + grain tuning

**Goal:** Wire damage-driven CA pulse via `postFxBus`. Tune baseline CA, vignette darkness, grain amount against the combined stack with dither active. In-session feel pass; no tests here beyond what the bus already has.

**Files:**
- Modify: `src/game/gibs/index.ts` — call `postFxBus.triggerDamagePulse` when player takes damage
- Modify: `src/main.ts` — thread `postFxBus` to the gib system (or wire via a callback)

- [ ] **Step 1: Trigger damage pulse on player damage**

In `src/main.ts`, after constructing `postFxBus`:

```typescript
// Extend PlayerGibAdapter to fire a CA pulse on damage
class PlayerGibAdapter implements GibbableDude {
  // ...existing...
  takeDamage(amount: number, _impulse: Vec3): void {
    this.hp -= amount;
    // Non-disruptive damage feedback: CA spike that decays in 0.4s
    const intensity = 0.015 + 0.01 * Math.min(amount / 60, 1);
    postFxBus.triggerDamagePulse(intensity, 0.4, performance.now() / 1000);
  }
}
```

Construct `postFxBus` *before* `playerGib` and close over it.

- [ ] **Step 2: Tune defaults via dev panel**

Launch `npm run dev?devfx=1`. With dither, grain, vignette, CA all on, adjust:
- `ca.baseline` — start 0.0025; higher if the scene looks dead, lower if colors separate at rest
- `grain.amount` — start 0.08; noticeable but not TV-static
- `vignette.darkness` — start 0.6; stronger if edges feel bright, lower if the whole image reads dim

Walk through 3–4 full combat cycles while tuning. Record final values back into `DEFAULT_POST_FX`.

- [ ] **Step 3: Address sprite-edge halos if present**

If the spec's "known risk — sprite edge halos" surfaced in Task 11, add an alpha-threshold guard in the dither shader:

```glsl
if (inputColor.a < 0.02) {
  outputColor = inputColor;
  return;
}
```

Before the `snapToPalette` call.

- [ ] **Step 4: Smoke + commit**

Run: `cd /Users/donny/Projects/blud && npm run build && npx vitest run`
Expected: clean.

```bash
git add src/main.ts src/vfx/post-fx/config.ts src/vfx/post-fx/palette-dither-pass.ts
git commit -m "feat(post-fx): damage-pulse CA + tuned vignette/grain baselines"
```

---

### Task 13: CRT scanlines + barrel toggles

**Goal:** Scanlines + barrel distortion available as toggleable passes, default OFF. Mechanical library wiring — no tuning expected.

**Files:**
- Modify: `src/vfx/post-fx/composer.ts` — add `BarrelEffect` (or custom barrel shader; library doesn't ship one)
- Modify: `src/vfx/post-fx/dev-panel.ts` — already has the toggles; confirm they flip correctly

- [ ] **Step 1: Add ScanlineEffect (already placeholder-wired in Task 3)**

Confirm `ScanlineEffect` is added to the EffectPass in composer.ts (done in Task 3). Verify the toggle actually works: enabling scanlines in dev panel should show visible horizontal lines.

If the library API differs slightly, check the postprocessing docs (v6.36): `ScanlineEffect` exists and takes `{ density, scrollSpeed }`.

- [ ] **Step 2: Add barrel distortion pass**

The `postprocessing` lib has no pre-built barrel effect. Implement a minimal one:

Create `src/vfx/post-fx/barrel-pass.ts`:

```typescript
import { Effect } from 'postprocessing';
import * as THREE from 'three';

const BARREL_FRAG = /* glsl */`
  uniform float distortion;  // 0 = no-op, 0.3 = strong

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 cc = uv - 0.5;
    float dist = dot(cc, cc);
    vec2 warped = uv + cc * dist * distortion;
    if (warped.x < 0.0 || warped.x > 1.0 || warped.y < 0.0 || warped.y > 1.0) {
      outputColor = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
      outputColor = texture2D(inputBuffer, warped);
    }
  }
`;

export class BarrelEffect extends Effect {
  constructor(distortion = 0.15) {
    super('Barrel', BARREL_FRAG, {
      uniforms: new Map([['distortion', new THREE.Uniform(distortion)]]),
    });
  }
  setDistortion(v: number) {
    (this.uniforms.get('distortion') as THREE.Uniform).value = v;
  }
}
```

Add to composer:

```typescript
import { BarrelEffect } from './barrel-pass';

const barrel = new BarrelEffect(0.15);
// Inside EffectPass ctor, append barrel at the end:
composer.addPass(new EffectPass(camera, vignette, dither, ca, grain, scanlines, barrel));

// Live toggle in render callback:
barrel.setDistortion(cfg.barrel.enabled ? 0.15 : 0);
```

- [ ] **Step 3: Smoke + commit**

Run: `npm run dev?devfx=1` → toggle scanlines + barrel individually → both visible and toggleable without jank.

```bash
git add src/vfx/post-fx/
git commit -m "feat(post-fx): scanline + barrel toggles (default off)"
```

---

### Phase 5 — Gib weight tuning

### Task 14: Playtest bone-weight sweep

**Goal:** Validate the 20% default feels right. If bones are too rare or too common, bump `ZOMBIE_GIB_PROFILE.boneWeight` and re-playtest.

**Files:**
- Modify: `src/game/gibs/tuning.ts` — `boneWeight` value only

- [ ] **Step 1: Kill 10 zombies, count bone sprites**

`npm run dev`, kill zombies until you've seen ~100 chunks. Count how many were bones. Ratio should land in 15–25%.

- [ ] **Step 2: Adjust if needed**

If < 15%: bump to 0.25. If > 25%: drop to 0.15. Re-test.

- [ ] **Step 3: Commit**

```bash
git add src/game/gibs/tuning.ts
git commit -m "tune(gibs): bone-weight set to <N> after playtest"
```

---

### Task 15: Acceptance pass + TASKS.md update

**Goal:** Verify all 10 acceptance criteria from the spec, update TASKS.md, save dualmem checkpoint.

- [ ] **Step 1: Run acceptance checklist**

Against `docs/superpowers/specs/2026-04-21-blud-m3-feel-pass-design.md#acceptance-criteria`, for each of the 10 items:

1. Full Blood throw FSM wired (raising → igniting → cooking → throwing) — ✓/✗
2. Projectile visibly tumbles — ✓/✗
3. Explosion sprite correct aspect + rate — ✓/✗
4. Audio plays for all 10 events + 2-layer ambient bed — ✓/✗
5. Post-fx stack running (dither + palette snap + CA pulse + vignette + grain) — ✓/✗
6. CRT + barrel toggleable, default off — ✓/✗
7. Bone gibs spawn ~20% on zombie explosion — ✓/✗
8. Dev-panel toggles + sliders working — ✓/✗
9. All tests green; tsc clean; build clean — ✓/✗
10. Playtest: "a single kill feels great" (donny's call) — ✓/✗

Any ✗ → fix or write a follow-up (`F2.<name>` in TASKS.md).

- [ ] **Step 2: Update TASKS.md**

Flip `M3` to `[x]` with a one-line note referencing the PR/commit. Append any deferred items (F2 bullets if spec scope slipped).

- [ ] **Step 3: Save dualmem checkpoint**

Run (substituting real files touched + commit hash):

```bash
source ~/.claude/hooks/dualmem-env.sh && ~/go/bin/dualmem checkpoint \
  --task "blud M3 feel-pass landed" --status completed \
  --files "src/audio/,src/vfx/post-fx/,src/game/weapons/dynamite.ts,src/game/gibs/tuning.ts" \
  --done "5-state weapon FSM; projectile tumble; explosion fix; audio engine + 10 events + ambient bed; post-fx composer with dither/CA/vignette/grain/scanlines/barrel; GibProfile + bone tier at 20%" \
  --remaining "M4 arsenal (flare gun first — uses M3 FSM pattern); Phase 1 gate at end of M5 (30min arena fun test)"
```

- [ ] **Step 4: Commit TASKS.md**

```bash
git add TASKS.md
git commit -m "chore: M3 feel-pass complete — flip milestone status"
```

---

## Acceptance Criteria (repeated for visibility)

M3 is done when all 10 items from `docs/superpowers/specs/2026-04-21-blud-m3-feel-pass-design.md#acceptance-criteria` are green. Item 10 (subjective playtest sign-off by donny) is the final gate.

## Risks (carried forward from spec)

1. **Post-fx sprite halos** — mitigation alpha-guard in Task 12 Step 3.
2. **Audio async race** — mitigated by eager `loadSfxRegistry` at boot + silent fallback.
3. **Dispatch failures** — Phase 1 tasks fall back to in-session if dispatch fails. Don't block on dispatch flakiness.
4. **Tuning scope creep** — 2h max per track (Task 10, 12, 14). Ship at "good enough."

## Out of Scope (guarded)

Per spec, these are explicitly NOT in M3 and should not be added:
- Player hit flash — disruptive per playtest
- Self-gib overlay polish
- Music bed (M8)
- Weapon pickup sounds (M4)
- Enemy damage to player beyond self-gib (M5)
- Clay-proper vertex effects
- Scanlines/barrel default-on
