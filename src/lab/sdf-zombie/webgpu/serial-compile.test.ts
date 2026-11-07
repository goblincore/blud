import { describe, expect, it } from 'vitest';
import { serializeCompileAsync } from './serial-compile';

/** three's shape: compileAsync reads the target and MRT when called, then runs until released. */
function fakeRenderer() {
  const started: { name: string; target: unknown; mrt: unknown; release(): void; fail(e: Error): void }[] = [];
  const renderer = {
    target: null as unknown,
    mrt: null as unknown,
    getRenderTarget() { return this.target; },
    setRenderTarget(t: unknown) { this.target = t; },
    getMRT() { return this.mrt; },
    setMRT(m: unknown) { this.mrt = m; return this; },
    compileAsync(name: string): Promise<unknown> {
      return new Promise((resolve, reject) => {
        started.push({ name, target: this.target, mrt: this.mrt, release: () => resolve(name), fail: reject });
      });
    },
  };
  serializeCompileAsync(renderer as never);
  const compile = renderer.compileAsync as unknown as (name: string) => Promise<unknown>;
  return { renderer, started, compile };
}
const flush = () => new Promise<void>(r => setTimeout(r, 0));

describe('serializeCompileAsync', () => {
  it('an idle renderer starts the call synchronously, as three does', () => {
    const { started, compile } = fakeRenderer();
    void compile('a');
    expect(started.map(s => s.name)).toEqual(['a']);
  });

  it('an overlapping call waits for the running one', async () => {
    const { started, compile } = fakeRenderer();
    const a = compile('a'), b = compile('b');
    await flush();
    expect(started.map(s => s.name)).toEqual(['a']);
    started[0]!.release();
    expect(await a).toBe('a');
    await flush();
    expect(started.map(s => s.name)).toEqual(['a', 'b']);
    started[1]!.release();
    expect(await b).toBe('b');
  });

  it('a queued call starts under the target and MRT it was called with, and puts back what is current', async () => {
    const { renderer, started, compile } = fakeRenderer();
    void compile('a');
    renderer.target = 'march'; renderer.mrt = 'marchMrt';
    void compile('b');
    renderer.target = 'later'; renderer.mrt = 'laterMrt';
    started[0]!.release();
    await flush();
    expect(started[1]).toMatchObject({ name: 'b', target: 'march', mrt: 'marchMrt' });
    expect(renderer.target).toBe('later');
    expect(renderer.mrt).toBe('laterMrt');
  });

  it('a failed call rejects for its caller and does not block the next', async () => {
    const { started, compile } = fakeRenderer();
    const a = compile('a'), b = compile('b');
    started[0]!.fail(new Error('boom'));
    await expect(a).rejects.toThrow('boom');
    await flush();
    started[1]!.release();
    expect(await b).toBe('b');
  });

  it('once everything has settled the next call starts synchronously again', async () => {
    const { started, compile } = fakeRenderer();
    const a = compile('a');
    started[0]!.release();
    await a;
    await flush();
    void compile('b');
    expect(started.map(s => s.name)).toEqual(['a', 'b']);
  });
});
