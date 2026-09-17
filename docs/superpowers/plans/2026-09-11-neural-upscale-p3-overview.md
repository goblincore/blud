# Neural upscale P3 — plain-language overview

**Date:** 2026-09-11 · **Status:** plans written and their code verified; nothing executed yet.
**Audience:** the owner. This is the human-readable summary — the technical detail is in the specs
and plans linked at the bottom.

> This note is also meant for Obsidian (`Claude Notes/Research/`). macOS has been blocking this
> process from writing into `~/Documents`, so it lives here until that is sorted; copy it over
> unchanged when the permission works.

## What this phase is

The game renders bodies at 400×300 and stretches that to 800×600. P3 trains a small neural network
to do that stretch with more detail than a plain resize: sharper faces, wounds and body surfaces,
and cleaner outlines, especially at medium and far range.

Three pieces, in order:

| Step | What happens | Where it runs |
|---|---|---|
| **Capture** | Freeze the game, photograph ~1,000 bodies twice: the real low-res frame, and a clean high-res "answer key" built from 16 slightly shifted renders | Your Mac, hours |
| **Train** | Six variants of the network learn to turn the first into the second, and are scored against ordinary resizing | A rented GPU, ~3 hours |
| **Judge** | Load the winners into the game and press **U** to flip between full-res, blocky, and the model | Your Mac, your call |

## What is built and checked

Everything below was written, run and committed as plans; the code inside them is a copy of code
that actually ran on this machine.

- **The trainer** (PyTorch): 55 tests pass, both on this Mac's Python and on the older Python the
  rented GPU image ships.
- **A real rehearsal:** trained a small model on the 60 existing sample pairs in 16 seconds.
  It beat the blocky baseline and came just short of the smooth one — expected for a 16-second run
  on old data, and enough to prove the pipeline end to end.
- **The in-game loader:** 83 tests, a clean typecheck and build, and a GPU check that loaded that
  trained model into the game, flipped through the A/B key, and matched the reference maths.
- **Python and TypeScript agree** on the same model to within 0.00000024, so a model trained on the
  pod renders identically in the game.
- **The pod scripts:** each one's dry run was proved never to touch RunPod. The
  download-and-install path was rehearsed against a local server.

## What it costs

About 3.9 hours of pod time. At roughly $0.69/hour for an RTX 4090 that's **about $2.70**, against
the **$10 cap** you set. The grid stops itself at the cap, and the pod stops itself 40 minutes after
training ends, so an idle pod can't quietly burn money.

## What you do, in order

1. **Run the capture** on a quiet machine (hours; it resumes if interrupted).
2. **Add your RunPod key** once (`runpodctl doctor`).
3. **Read the estimate**, then re-run the launch command with `--yes`.
4. **Upload and start** — two commands in RunPod's web terminal.
5. **Watch the dashboard** from any device while it runs.
6. **Pull the models** when it finishes, then stop and delete the pod.
7. **Judge it in the game.**

The exact commands live in the runbook (`p3-runbook.md`), which the last plan writes.

## Reading the dashboard

- **Runs table:** every number is how far the picture is from the answer key, so **lower is better**.
  Green means that run beats an ordinary smooth resize. **G4 pass** means it's worth your time in-game.
- **Curves:** the training line should fall; the validation lines should drop under the dashed
  "ordinary resize" line — especially for faces, wounds, outlines, and at medium and far range.
- **Showcase:** the same crop five ways — blocky, smooth, the model, the plain full-res render, and
  the answer key — blown up so you can see individual pixels.

## Known limits, stated up front

- A single frame can only go so far. Face features that were never sampled at 400×300 (an eye line
  a pixel wide) can be inferred, not recovered. If faces fall short, the next levers are temporal
  reconstruction or a small full-resolution face pass — both deliberately out of scope here.
- The capture has no post-processing and no field rendering, by design. The upscaler runs before
  post-processing in the game too, so that matches.
- The dashboard link is unlisted but not password-protected. It only ever shows game crops and numbers.

## Where everything is

| Thing | Path |
|---|---|
| Design | `docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md` |
| Shared formats and rules | `docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md` |
| Capture plan | `docs/superpowers/plans/2026-09-11-neural-upscale-p3a-capture-v2.md` |
| Trainer plan | `docs/superpowers/plans/2026-09-11-neural-upscale-p3b-trainer.md` |
| In-game plan | `docs/superpowers/plans/2026-09-11-neural-upscale-p3c-ingame.md` |
| Pre-flight + RunPod plan | `docs/superpowers/plans/2026-09-11-neural-upscale-p3d-preflight-runpod.md` |
| Earlier results (P1/P2) | `docs/dev-notes/2026-09-11-neural-upscale/` |

## Next decision

The three independent plans (capture, trainer, in-game) can run in parallel through the dispatch UI;
the fourth waits for the trainer and the in-game work. The capture tasks load the machine heavily,
so starting with the trainer and the in-game work is the gentler order.
