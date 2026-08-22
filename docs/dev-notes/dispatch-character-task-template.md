# Dispatch template: a character task

Copy this into `~/.claude/dispatch/plans/YYYY-MM-DD-<slug>.md`, fill every
`<...>`, and delete the angle brackets. The loop below is the point of the
template — a dispatched agent that improvises its own loop is how the last
several characters drifted. Keep it verbatim.

`model:` needs the provider prefix (`zai/glm-5.1`, `openrouter/…`); a bare name
fails silently with an empty worktree. `base_branch` must already contain the
reference files — a fresh worktree cannot see an untracked file in the primary
checkout.

```markdown
---
title: "<what the character needs, in the owner's words>"
status: queued
project: /Users/donny/Projects/blud
model: zai/glm-5.1
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

You can see images. `Read` these, and `Read` the frames you produce.

## YOUR LOOP — do not improvise a different one

1. `npm run blob:measure -- <name>` — record the starting IoU and worst bands
   in your report. If POSE MISMATCH prints, pick a `--range` and use it
   consistently.
2. Edit ONE owning line. Re-measure. Repeat.
3. Every ~5 edits: `npm run blob:shot -- <name>` and Read the frames.
4. Any hole or artefact the measure did not predict:
   `npm run blob:render-check -- <name>` BEFORE editing further. If it fails,
   report it and stop — the fix is not in the .blob.
5. `npx vitest run src/lab/sdf-zombie/` green before you commit.

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
