// src/lab/sdf-zombie/panel.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyDebugPanelVisibility, loadOverride, saveOverride, clearOverride,
  serializeOverride, overrideKey, STORAGE_PREFIX,
} from './panel';

describe('debug panel visibility', () => {
  it('collapses the panel while leaving an accessible show control', () => {
    const panel = document.createElement('div');
    const toggle = document.createElement('button');

    applyDebugPanelVisibility(panel, toggle, true);
    expect(panel.hidden).toBe(true);
    expect(toggle.textContent).toBe('debug: show (H)');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    applyDebugPanelVisibility(panel, toggle, false);
    expect(panel.hidden).toBe(false);
    expect(toggle.textContent).toBe('debug: hide (H)');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('override persistence', () => {
  beforeEach(() => localStorage.clear());

  it('returns an empty override when nothing is stored', () => {
    expect(loadOverride('zombie')).toEqual({});
  });

  it('round-trips an override through localStorage', () => {
    saveOverride('zombie', { primRadius: { 3: 0.21 }, primBlendK: { 1: 0.09 } });
    expect(loadOverride('zombie')).toEqual({ primRadius: { 3: 0.21 }, primBlendK: { 1: 0.09 } });
  });

  it('survives corrupt stored data instead of throwing', () => {
    localStorage.setItem(overrideKey('zombie'), '{not json');
    expect(loadOverride('zombie')).toEqual({});
  });

  it('clears back to empty', () => {
    saveOverride('zombie', { primRadius: { 0: 1 } });
    clearOverride('zombie');
    expect(loadOverride('zombie')).toEqual({});
  });

  it('serializes to pasteable JSON', () => {
    const text = serializeOverride({ primRadius: { 2: 0.15 } });
    expect(JSON.parse(text)).toEqual({ primRadius: { 2: 0.15 } });
    expect(text).toContain('\n'); // pretty-printed for pasting into body.ts
  });
});

describe('overrides do not leak between characters', () => {
  beforeEach(() => localStorage.clear());

  // The bug this key shape exists to prevent: tuning the clown's head left
  // the goblin and the zombie wearing a 0.235 cranium, across reloads,
  // because the panel's override is spread over the .blob's own face block
  // and used to be stored under one global key.
  it('keeps one character\'s face out of another\'s', () => {
    saveOverride('clown', { faceParams: { headRadius: 0.235 } });
    expect(loadOverride('goblin')).toEqual({});
    expect(loadOverride('zombie')).toEqual({});
    expect(loadOverride('clown').faceParams?.headRadius).toBeCloseTo(0.235, 6);
  });

  // primRadius/primBlendK are keyed by built-array prim INDEX, so a shared
  // key silently resized a DIFFERENT primitive on every other character.
  it('keeps index-keyed prim overrides out of another character', () => {
    saveOverride('clown', { primRadius: { 7: 0.4 } });
    expect(loadOverride('goblin').primRadius).toBeUndefined();
  });

  it('clears only the character it was asked to clear', () => {
    saveOverride('clown', { primRadius: { 1: 0.3 } });
    saveOverride('goblin', { primRadius: { 1: 0.1 } });
    clearOverride('clown');
    expect(loadOverride('clown')).toEqual({});
    expect(loadOverride('goblin')).toEqual({ primRadius: { 1: 0.1 } });
  });

  // A v1 entry belongs to no character, so there is nothing to migrate it to.
  // Left in place it would sit there being ignored; dropping it means the
  // poisoned value cannot be recovered by a downgrade either.
  it('drops the pre-v2 global entry on load', () => {
    localStorage.setItem('blud.sdf-lab.override.v1',
      JSON.stringify({ faceParams: { headRadius: 0.235 } }));
    expect(loadOverride('goblin')).toEqual({});
    expect(localStorage.getItem('blud.sdf-lab.override.v1')).toBeNull();
  });

  it('namespaces its keys under the versioned prefix', () => {
    expect(overrideKey('goblin')).toBe(`${STORAGE_PREFIX}:goblin`);
  });
});

it('round-trips faceParams through storage', () => {
  saveOverride('zombie', { faceParams: { headHeight: 1.44 } });
  expect(loadOverride('zombie').faceParams?.headHeight).toBeCloseTo(1.44, 6);
  clearOverride('zombie');
});
