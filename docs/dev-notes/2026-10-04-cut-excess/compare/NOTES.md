# Cut excess pass: before and after (2026-10-04)

Left is the base (`e3d4a897`), right is the excess pass (`36b3a7c3`). Same gate scenario, same camera, same
frame. The full measurements are in [`../STATUS.md`](../STATUS.md); this file is the look record and the cost
decision.

| Scenario | Image | What changed |
| --- | --- | --- |
| Rod belly slash (cut-wound-gate R) | [`cut-R.png`](cut-R.png) | The slot is about a third longer and runs out past the flank into a tapered tail. A wet red band spreads above and beside it. The slot itself is not much taller at this distance. |
| Rod cut, close (cut-wound-gate K) | [`cut-K.png`](cut-K.png) | Wider gape, swollen lips, red band. |
| Rod cut on the face (cut-wound-gate H) | [`cut-H.png`](cut-H.png) | Little visible change: the face is dark and wet in both. |
| Axe overhead body chop (axe-gate A) | [`axe-A.png`](axe-A.png) | The gash is roughly twice as wide and half again as long, with a ragged outline and a broad red margin. |
| Axe diagonal body chop (axe-gate D) | [`axe-D.png`](axe-D.png) | As A, on the diagonal. |
| Axe, second head chop (axe-gate K-2) | [`axe-K2.png`](axe-K2.png) | The largest change. Before: two thin slashes on an intact head. After: the face is opened into a deep cavity with the skull showing and the whole head reads wet. |

The source photos (38 MB, every stage) stay untracked in the worktree they were shot in
(`.claude/worktrees/head-explosion-effect-d6231e`, `photos/`).

## Numbers (from STATUS.md)

- Axe cut half-length 0.09 → 0.15 m; kerf 0.015 → 0.025 m (capped at 0.3 × half-length).
- Rod sweeps 1.4× longer, `maxLen` 0.35 → 0.45 m; kerf 0.015 → 0.02 m.
- Lip raise 2.9 mm → 8.0–9.3 mm.
- Lipschitz maxima 1.7–2.0 against a 2.2 bound, now including the GPU noise.
- Gates: cut-wound 30/30, axe 24/24.

## Cost, and the decision

| Cost | Before | After |
| --- | --- | --- |
| Three axe chops on one torso at 0.9 m (ungated draw time) | +4.3 ms | about +22 ms |
| Cold boot (4 interleaved pairs) | — | +136 to +936 ms, mean about +430 ms |

**Decision (2026-10-04, controller; the owner can overrule): keep the pass as built and carry both costs as open
debt.** The owner asked for excess, has said to raise budgets freely while the look is being found, and has made
the head split the priority. Neither cost has been investigated yet. The first things to try when it is:

1. Drop or cheapen the `woundMask` noise (an extra `noise3` per cut per shaded pixel) and the pinch's `hash13`
   calls. This is the likely source of the boot delta as well.
2. Tighten the cut's reach sphere, which grew with the lip (`(1.7 + 2·1.5)·kerf`) and the 1.3 h mask tail.
3. Lower `AXE_CUT.halfLen` or the kerf.

The head split's own cost measurement (plan B, task B4) is taken on top of this state.
