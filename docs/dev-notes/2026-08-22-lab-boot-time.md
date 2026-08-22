# Lab cold boot: it is one `await`, and painting first does not fix it

**Date:** 2026-08-22
**Status:** measured; the obvious fix was tried and REVERTED

## What was measured

`__sdfLab.boot` (added in `lab-main.ts`) records the boot timeline in ms since
navigation start. Read it from the console after the lab loads.

Measure this way, not by polling from outside. CDP `Runtime.evaluate` queues
behind the blocked main thread, and a leaked lab tab keeps raymarching forever
— together those made three runs of the SAME build read 127 s, 133 s and 223 s.
The in-page numbers are the honest ones.

## The shape of it

    main() entered         3504
    renderer ready         3514
    body in scene          3595   <- the character is fully built and in the scene
    chunk warm-up start    3602
    chunk warm-up end    159456   (155853 ms inside the warm-up)
    main() returned      159471   <- the first pixel of anything
    after warm-up            15 ms

**97.7% of the boot is a single statement**: `await sdfLayer.precompile(...)`.
Everything after it costs 15 ms. The character is finished and sitting in the
scene at 3.6 s and then nobody sees it for two and a half minutes.

CAVEAT ON THE ABSOLUTE NUMBERS: these were taken with two dispatch agents
running (load average 16-50). The earlier note's 19-30 s was a quiet machine.
Treat the RATIO as the finding and re-measure the magnitudes when idle.

## The fix that failed, and why

The obvious move — paint the character before the warm-up, since it is already
in the scene — was implemented and reverted.

`handle.step(0)` drives one frame by hand, so the sequence became: body into
scene, step, yield a compositor frame, then warm up. Result:

    body in scene          467
    FIRST PAINT         108363   <- the step() itself took 108 SECONDS
    chunk warm-up end   257995
    main() returned     258017

**Painting the body IS the expensive thing.** The cost is building the march
material's node graph, and the first render is what triggers it. In the
baseline that build happens *inside* `precompile`, which is why precompile
looked like it cost 108 s. Moving the paint earlier does not remove the build,
it just relocates it — and then `precompile` still pays ~150 s of its own, so
the total went from 108 s to 258 s. Strictly worse.

Two attempts have now failed the same way:

1. Deferring the warm-up until after `main()` returned: 36.8 s vs 18.8 s.
   Nothing paints until main() returns, so this bought nothing.
2. Painting before the warm-up (this one): 258 s vs 108 s. The paint pays the
   build the warm-up was already paying.

**Reordering cannot help.** The work has to get smaller.

Also learned on the way: the draw closure captures `gooLayer`, which is created
*after* the warm-up. The comment above `setDrawFn` states the invariant — safe
only because nothing draws before `main()` ends — and drawing early put
"Cannot access 'gooLayer' before initialization" on screen. Any future attempt
to render mid-boot has to move `gooLayer` up first.

## Where to look next

Not at the ordering. At the size and number of node graphs:

- A CPU profile previously put ~85% in three's TSL node builder
  (`NodeBuilder.get` 37.6%, `build` 13%, `generate` 13%). Pure JS graph
  traversal, which no shader cache absorbs.
- The body march material and the chunk material appear to be built
  independently and neither is cheap — in the reverted experiment they cost
  ~108 s and ~150 s separately. If they share most of their graph, building
  once and reusing is the win.
- The march grew recently (`bend=`, `chamfer`, `groove`, more rows). Worth
  checking whether boot time tracks the shader's size — if so, the WGSL is
  being re-walked more than it needs to be.
