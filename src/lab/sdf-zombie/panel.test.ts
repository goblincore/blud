// src/lab/sdf-zombie/panel.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadOverride, saveOverride, clearOverride, serializeOverride, STORAGE_KEY } from './panel';

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
