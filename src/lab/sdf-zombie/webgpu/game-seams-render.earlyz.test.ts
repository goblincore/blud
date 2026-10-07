// @vitest-environment happy-dom
// Early-Z stage 1 (Task 8 review, Important 1): the depth prepass, miss cull and depth gate
// debug seams refuse to turn ON under ?earlyz=1, because each sees only a type's back batch.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRenderSeams } from './game-seams-render';
import type { GameContext } from './game-context';

function fake(earlyzOn: boolean) {
  const sdfLayer = {
    setDepthGate: vi.fn(),
    setDepthPreEnabled: vi.fn(),
    setDepthPreMissCull: vi.fn(),
  };
  const ctx = {
    boot: { handle: { camera: {} } },
    crowd: { earlyz: { on: earlyzOn } },
    render: { sdfLayer },
  } as unknown as GameContext;
  return { seams: createRenderSeams(ctx), sdfLayer };
}

afterEach(() => vi.restoreAllMocks());

describe('createRenderSeams under early-Z', () => {
  it('refuses setDepthGate(true), setDepthPrepass(true) and setMissCull(true) when early-Z is on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { seams, sdfLayer } = fake(true);
    seams.setDepthGate(true);
    seams.setDepthPrepass(true);
    seams.setMissCull(true);
    expect(sdfLayer.setDepthGate).not.toHaveBeenCalled();
    expect(sdfLayer.setDepthPreEnabled).not.toHaveBeenCalled();
    expect(sdfLayer.setDepthPreMissCull).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('still lets every seam turn OFF under early-Z', () => {
    const { seams, sdfLayer } = fake(true);
    seams.setDepthGate(false);
    seams.setDepthPrepass(false);
    seams.setMissCull(false);
    expect(sdfLayer.setDepthGate).toHaveBeenCalledWith(false);
    expect(sdfLayer.setDepthPreEnabled).toHaveBeenCalledWith(false);
    expect(sdfLayer.setDepthPreMissCull).toHaveBeenCalledWith(false);
  });

  it('is the shipped behaviour with early-Z off', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { seams, sdfLayer } = fake(false);
    seams.setDepthGate(true);
    seams.setDepthPrepass(true);
    seams.setMissCull(true);
    expect(sdfLayer.setDepthGate).toHaveBeenCalledWith(true);
    expect(sdfLayer.setDepthPreEnabled).toHaveBeenCalledTimes(2); // prepass + miss cull's own enable
    expect(sdfLayer.setDepthPreEnabled).toHaveBeenNthCalledWith(1, true);
    expect(sdfLayer.setDepthPreEnabled).toHaveBeenNthCalledWith(2, true);
    expect(sdfLayer.setDepthPreMissCull).toHaveBeenCalledWith(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
