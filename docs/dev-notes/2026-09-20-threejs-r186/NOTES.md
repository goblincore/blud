# three.js r186 — what it means for us (2026-09-20)

The bump (`b067bc9d`, main) is the dependency plus one source fix
(`a368f684`, post-aa: stop re-wrapping the vec4 fire resolve/composite results).

## Verified here

- **Pixel-identical.** With the r186 install, the gate gives the canonical line
  in BOTH rooms: room1 `8f2b74e7…` (repeat identical, wounded `1381a866…`),
  room2 `35b6d561…`. So the march pins and the phase-2 baselines carry over —
  no re-pinning, and phase-2 tasks 3–6 can compare against task 1's row.
- `npx tsc --noEmit` clean against `@types/three` 0.186.

## Boot timing: NOT attributable, and worth remembering why

Warm census on r186 (6 runs): `warmMs` 2526–3031, `drawOnce` 1705–1876.
Task 1's r185 baseline, same script, same machine, ~9 h earlier: `warmMs`
1762–1779, `drawOnce` 1226–1250. That looks like a ~40% regression — but a
control run of the tree WITHOUT the phase-2 `MarchIn` change, on the same r186
install, was SLOWER STILL (`warmMs` 3110–3600, `drawOnce` 1899–2309).

So the spread tracks WHEN the numbers were taken, not WHAT was in the tree.
Boot timings on this machine are not comparable across sessions (same lesson
the march-hash bistability taught: the capture path is sensitive to machine
state). **A real r185-vs-r186 answer needs the two installs measured
INTERLEAVED in one session**, which means a second `node_modules` — not the
shared symlink every worktree uses. Filed rather than guessed.

## r186 features against our goals (checked in the installed source, not the notes)

| Feature | Verdict |
| --- | --- |
| `DirectRenderPipeline` | **Not usable on the game path.** Its own doc: it avoids the intermediate framebuffer and output pass, "is not compatible with materials that sample the framebuffer". Our post-AA / upscale / VHS chain does exactly that. Possibly interesting for a bare lab page. |
| `compileComputeAsync()` (`Renderer.js:1115`) | **Worth trying.** We have one compute node on the boot path (`probe-gather-compute.ts` → `renderer.compute`). Async compile keeps it off the blocking path, in the same spirit as the 2026-09-19 gib/crowd deferral. |
| Bind-group cache key hardening, shared-UBO refresh, stale storage-buffer fix | Relevant to the crowd path (many near-identical material instances that the driver dedupes). No action, but if crowd draws start mis-binding, this is the first place to look. |
| TSL "build CodeNode includes as references" | **Most relevant to phase 2.** Our `HELPERS` chain is exactly a CodeNode include list; if includes are now emitted by reference rather than inlined per program, the per-program text (243 KB today) may shrink, which is the same lever phase 2's task 4 pulls. Measure `MARCH_BODY` module size as emitted before/after in the r185-vs-r186 A/B. |
| `packed_4x8_integer_dot_product`, atomics in non-compute stages, 4x8 pack/unpack | Nothing we need today. |
