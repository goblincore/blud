# Dispatch template: a character task

Copy this into `~/.claude/dispatch/plans/YYYY-MM-DD-<slug>.md`, fill every
`<...>`, and delete the angle brackets. The loop below is the point of the
template — a dispatched agent that improvises its own loop is how the last
several characters drifted. Keep it verbatim.

**`status:` MUST be `pending`, not `queued`.** `queued` is not a state the
dispatcher will run: the UI renders its "Run Now" button only for `pending`,
and `POST /api/tasks/<name>/run` refuses anything else with "task is not
pending". A task written as `queued` sits forever with `started_at` null and no
way to start it from the UI. This template said `queued` until 2026-09-02, and
three real tasks were found stranded that way — `2026-08-24-raymarcher-perf-task-4`
and `-task-5` since 24 Aug, `2026-08-25-tile-all-bodies` since the 25th. Check
`curl -s localhost:8090/api/tasks` for `"status":"queued"` before assuming a
task is merely waiting its turn.

`model:` needs the provider prefix (`zai/glm-5.3-flash`, `openrouter/…`); a bare name
fails silently with an empty worktree. `base_branch` must already contain the
reference files — a fresh worktree cannot see an untracked file in the primary
checkout.

```markdown
---
title: "<what the character needs, in the owner's words>"
status: pending
project: /Users/donny/Projects/blud
model: zai/glm-5.3-flash
branch: dispatch/<slug>
base_branch: <branch that contains the refs and the blob: commands>
priority: 1
max_runtime: 120m
created: <YYYY-MM-DD>
allowed_tools: Edit,Write,Bash,Read,Glob,Grep
harness: pi
---

## THE ONE JOB

<one sentence: what the owner will look at to judge this>

## REFERENCE

- mesh: docs/dev-notes/refs/<name>-mesh/<name>.glb   (committed — verify with `git ls-files`)
- plates: docs/dev-notes/refs/<name>-*.png

**`zai/glm-5.3-flash` HAS native vision** (`input: ["text","image"]`) — `Read`
these references and every frame you produce, directly. That is the default
above and the reason it is the default.

Vision is per-MODEL, not per-family: `glm-5.3`, `glm-5.2`, `glm-5.1` and
kimi-k3 are text-only. If you change `model:`, check `~/.pi/agent/models.json`
— `input` must list `"image"`. Where it does not, `Read` on a PNG shows you
NOTHING and silently: use the sidecar `python3 scripts/vision-ask.py <image>
"<question>"` on every reference and on frame-00/frame-02 after each
`blob:shot`, and quote its answers.

## YOUR LOOP — do not improvise a different one

1. `npm run blob:measure -- <name>` — record the starting IoU and worst bands
   in your report. If POSE MISMATCH prints, pick a `--range` and use it
   consistently.
2. Edit ONE owning line. Re-measure. Repeat.
3. Every ~5 edits: `LAB_TMP=.lab-tmp npm run blob:shot -- <name>` and Read the
   frames (they land in `.lab-tmp/blob-shot/<name>/`). **`LAB_TMP` is not
   optional in a dispatch worktree**: it defaults to `/tmp`, which the
   `workspace-write` sandbox makes read-only, so Chrome cannot create its
   profile and never starts — silently, producing no frames at all.
4. Any hole or artefact the measure did not predict:
   `npm run blob:render-check -- <name>` BEFORE editing further. If it fails,
   report it and stop — the fix is not in the .blob.
5. `npx vitest run src/lab/sdf-zombie/` green before you commit.
6. The FACE is not yours to paint. If the character has a mesh, it wears a
   decal baked from it (`npm run blob:face-bake -- <name>`, then `sheet` /
   `image` / `decal 1` — skill reference.md, "Face decal"). Do not add eye
   or mouth prims; do not tune the generated-sheet numbers.

## WHAT IS ALREADY ESTABLISHED — do not re-derive

<measured facts; see the skill's "Measure against the mesh" section>

## DONE WHEN

- IoU vs <ref> (--range <lo:hi>) ≥ <target> (from <start>), or the owner's
  named band within ±<n>%
- frames in /tmp/blob-shot/<name>/ show <the thing>
- report lists start/end numbers and every line you changed, with the reason
  on the line

## COMMIT AS YOU GO

Runs here have been cut off mid-flight and lost everything. Commit after every
step that compiles.
```
