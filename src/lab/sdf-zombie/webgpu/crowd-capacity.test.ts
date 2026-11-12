import { describe, expect, it } from 'vitest';
import { crowdCapacities, crowdSizeOn, crowdTypeKey } from './crowd-capacity';

describe('crowd capacity', () => {
  it('counts the cast per character and room', () => {
    const c = crowdCapacities([{ name: 'butcher', roomId: 1 }, { name: 'butcher', roomId: 1 }, { name: 'butcher', roomId: 2 }, { name: 'zombie', roomId: 1 }]);
    expect(c.get('butcher@1')).toBe(2);
    expect(c.get('butcher@2')).toBe(1);
    expect(c.get('zombie@1')).toBe(1);
    expect(c.size).toBe(3);
  });

  it('keys an overflow type apart from the counted one', () => {
    expect(crowdTypeKey('butcher', 3)).toBe('butcher@3');
    expect(crowdTypeKey('butcher', 3, 1)).toBe('butcher@3#2');
  });

  it('is on unless ?crowdsize=0', () => {
    expect(crowdSizeOn('')).toBe(true);
    expect(crowdSizeOn('?crowdsize=0')).toBe(false);
  });
});
