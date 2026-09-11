import { describe, expect, it } from 'vitest';
import {
  createUpscaleModel, parseUpscaleModelJson, serializeUpscaleModel, UPSCALE_MODEL_FORMAT, type UpscaleModelJson,
} from './upscale-model';

const b64 = (values: number[]) => btoa(String.fromCharCode(...new Uint8Array(new Float32Array(values).buffer)));

function trainedJson(): UpscaleModelJson {
  const m = { ...createUpscaleModel('s16', 'rgbd', 7), source: 'trained' as const, run: 's16-rgbd', step: 500 };
  return JSON.parse(JSON.stringify(serializeUpscaleModel(m, { metrics: { overall: 0.1, face: null } })));
}

describe('upscale model JSON (contracts §2)', () => {
  it('round-trips a model bit-exactly and keeps its hash and provenance', () => {
    const m = { ...createUpscaleModel('s16', 'rgbd', 7), source: 'trained' as const, run: 's16-rgbd', step: 500 };
    const json = trainedJson();
    expect(json.format).toBe(UPSCALE_MODEL_FORMAT);
    expect(json.inScale[4]).toBe(Math.fround(0.1));
    const back = parseUpscaleModelJson(json);
    expect(back.weightHash).toBe(m.weightHash);
    expect(back).toMatchObject({ id: 's16', inputs: 'rgbd', source: 'trained', run: 's16-rgbd', step: 500 });
    back.layers.forEach((l, k) => {
      expect(l.weights).toEqual(m.layers[k]!.weights);
      expect(l.bias).toEqual(m.layers[k]!.bias);
      expect(l.relu).toBe(m.layers[k]!.relu);
    });
    expect(Array.from(back.inScale)).toEqual(Array.from(m.inScale));
  });

  it('matches the cross-language hash vectors (the Python exporter asserts the same)', () => {
    expect(parseUpscaleModelJson(serializeUpscaleModel(createUpscaleModel('zero', 'rgb', 1))).weightHash).toBe('3d86dba5');
    expect(parseUpscaleModelJson(serializeUpscaleModel(createUpscaleModel('zero', 'rgbd', 1))).weightHash).toBe('55870aa7');
  });

  it('serializes seeded weights as random and defaults a missing source to trained', () => {
    const json = serializeUpscaleModel(createUpscaleModel('s8', 'rgb', 2));
    expect(json.source).toBe('random');
    expect(parseUpscaleModelJson(json).source).toBe('random');
    const { source: _drop, ...noSource } = json;
    expect(parseUpscaleModelJson(noSource).source).toBe('trained');
  });

  const cases: Array<[string, (j: UpscaleModelJson) => unknown, RegExp]> = [
    ['not an object', () => null, /not a JSON object/],
    ['format', (j) => ({ ...j, format: 'blud-upscale-model/0' }), /format/],
    ['id', (j) => ({ ...j, id: 's64' }), /unknown id/],
    ['inputs', (j) => ({ ...j, inputs: 'rgba' }), /unknown inputs/],
    ['layer count', (j) => ({ ...j, layers: j.layers.slice(0, 2) }), /needs 3 layers/],
    ['chain shape', (j) => ({ ...j, id: 's8' }), /layer 0 is 5->16, expected 5->8/],
    ['relu flag', (j) => ({ ...j, layers: j.layers.map((l, k) => (k === 2 ? { ...l, relu: true } : l)) }), /relu must be false/],
    ['weights length', (j) => ({ ...j, layers: j.layers.map((l, k) => (k === 0 ? { ...l, weights: b64([1, 2]) } : l)) }), /has 2 weights/],
    ['partial float', (j) => ({ ...j, layers: j.layers.map((l, k) => (k === 0 ? { ...l, bias: 'AAA=' } : l)) }), /not whole float32s/],
    ['non-finite', (j) => ({ ...j, layers: j.layers.map((l, k) => (k === 1 ? { ...l, bias: b64(new Array(16).fill(Number.NaN)) } : l)) }), /non-finite/],
    ['inScale length', (j) => ({ ...j, inScale: [1, 1, 1, 1] }), /inScale must be 5 finite numbers/],
    ['step', (j) => ({ ...j, step: 1.5 }), /step must be an integer/],
    ['hash mismatch', (j) => ({ ...j, weightHash: '00000000' }), /does not match the weights/],
    ['tampered weights', (j) => ({ ...j, inOffset: [0, 0, 0, 0, 0.5] }), /does not match the weights/],
  ];
  it.each(cases)('rejects: %s', (_name, mutate, message) => {
    expect(() => parseUpscaleModelJson(mutate(trainedJson()))).toThrow(message);
  });
});
