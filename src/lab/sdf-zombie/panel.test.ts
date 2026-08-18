// src/lab/sdf-zombie/panel.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyDebugPanelVisibility, loadOverride, saveOverride, clearOverride,
  serializeOverride, STORAGE_KEY,
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
    expect(loadOverride()).toEqual({});
  });

  it('round-trips an override through localStorage', () => {
    saveOverride({ primRadius: { 3: 0.21 }, primBlendK: { 1: 0.09 } });
    expect(loadOverride()).toEqual({ primRadius: { 3: 0.21 }, primBlendK: { 1: 0.09 } });
  });

  it('survives corrupt stored data instead of throwing', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadOverride()).toEqual({});
  });

  it('clears back to empty', () => {
    saveOverride({ primRadius: { 0: 1 } });
    clearOverride();
    expect(loadOverride()).toEqual({});
  });

  it('serializes to pasteable JSON', () => {
    const text = serializeOverride({ primRadius: { 2: 0.15 } });
    expect(JSON.parse(text)).toEqual({ primRadius: { 2: 0.15 } });
    expect(text).toContain('\n'); // pretty-printed for pasting into body.ts
  });
});

it('round-trips faceParams through storage', () => {
  saveOverride({ faceParams: { headHeight: 1.44 } });
  expect(loadOverride().faceParams?.headHeight).toBeCloseTo(1.44, 6);
  clearOverride();
});
