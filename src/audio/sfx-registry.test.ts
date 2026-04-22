import { describe, it, expect } from 'vitest';
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
