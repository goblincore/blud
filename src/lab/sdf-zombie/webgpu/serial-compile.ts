// src/lab/sdf-zombie/webgpu/serial-compile.ts
//
// ONE compileAsync AT A TIME. three r187 compiles through a single renderer field,
// `_precompilationState`, set and cleared around each work item with awaits in between, so
// two overlapping calls clear each other's state and the second throws "Cannot destructure
// property 'useFrameBufferTarget' of 'this._precompilationState' as it is null". The game
// overlaps them: gooLayer.precompileLayer() and shutterGame.precompile() are fire-and-forget
// while the boot warm is compiling.
//
// compileAsync reads the render target and MRT synchronously when it starts, and callers
// (sdf-layer's precompile) set them just before the call. So a call that runs at once starts
// synchronously, as three's does, and a queued call starts under the target and MRT it was
// called with; what is current then is put back as soon as it has started.

interface SerialCompileRenderer {
  compileAsync(...args: never[]): Promise<unknown>;
  getRenderTarget(): unknown;
  setRenderTarget(target: never): void;
  getMRT(): unknown;
  setMRT(mrt: never): unknown;
}

export function serializeCompileAsync(renderer: SerialCompileRenderer): void {
  const compile = renderer.compileAsync.bind(renderer) as (...args: unknown[]) => Promise<unknown>;
  let tail: Promise<unknown> | null = null;

  /** Forget the tail once it is the last call, so the next call starts synchronously again. */
  const track = (run: Promise<unknown>): void => {
    const settled = run.then(() => undefined, () => undefined).then(() => {
      if (tail === settled) tail = null;
    });
    tail = settled;
  };

  renderer.compileAsync = ((...args: unknown[]) => {
    if (tail === null) {
      const run = compile(...args);
      track(run);
      return run;
    }
    const target = renderer.getRenderTarget(), mrt = renderer.getMRT();
    const run = tail.then(() => {
      const currentTarget = renderer.getRenderTarget(), currentMrt = renderer.getMRT();
      renderer.setRenderTarget(target as never);
      renderer.setMRT(mrt as never);
      try {
        return compile(...args);
      } finally {
        renderer.setRenderTarget(currentTarget as never);
        renderer.setMRT(currentMrt as never);
      }
    });
    track(run);
    return run;
  }) as SerialCompileRenderer['compileAsync'];
}
