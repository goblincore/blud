# Character reference images

Visual references for characters being authored in `.blob` / `.wam`.

These exist because **a dispatched agent cannot see a description — it can see
a file.** Two characters were authored from prose alone (the clown, and a first
run at the mouse) and both drifted a long way from their reference; the model
turns out to read images fine through `Read`, verified by a probe. So a
character task should point at a file in here rather than describe the art.

Dev references only. Nothing here ships, and nothing here is redistributed —
they are inputs to authoring the project's own original characters, in the same
spirit as `docs/dev-notes/` generally.

Name them `<character>-reference.png`, or `<character>-<n>-ref.png` when
there are several angles, so the dispatch plan can point at the exact files.
**Point at every angle you have** — the clown's cap and hair tufts only make
sense across three views, and one flat front shot would have lost them.

Two things silently break this:

- **The file must be committed.** A dispatch agent runs in a fresh git worktree,
  so an untracked file in the primary checkout does not exist for it. These are
  added with `git add -f`.
- **`base_branch` must contain the image.** The first mouse plan was based on a
  feature branch that predated the refs commit, so the path resolved to nothing.
