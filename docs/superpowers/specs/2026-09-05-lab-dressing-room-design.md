# Lab dressing room — upload a face, pick a skin tone, save both to the repo

> Date: 2026-09-05
> Status: approved in dialogue (owner: "A is fine" — a dev-server save endpoint)

## Why

Owner, 2026-09-05: "we should make it in the UI you can upload a face
texture and save it", and "would be cool to have a slider to adjust skin
tone color". Today a face bake reaches a character only through
`npm run blob:face-bake` plus a hand edit of the `sheet` block, and the skin
colour only by editing the `palette` block's `baseColor` line.

## What

Two controls in the lab panel, one dev-only save endpoint behind them.

### Face upload (panel `face` section)

- **upload face** — a file picker (`image/png`, `image/jpeg`). The image
  becomes the live face sheet immediately, through the same path the
  character's baked `sheet image` takes today (atlas rect = whole image,
  mean measured off the pixels, `decal` mode as the character's sheet block
  says). Every crowd body gets it too, as the existing sheet swap does.
- **save face** — POSTs the uploaded bytes to the dev endpoint, which writes
  `public/assets/lab/faces/<character>-face.png` (the file the character's
  `sheet image` line already names; if the sheet names something else, the
  endpoint writes THAT name). Disabled until an upload has happened.

### Skin tone (panel `material` section, beside the flesh sliders)

- **skin** — an `<input type="color">` bound to the flesh material's
  `baseColor` (sRGB in the picker, linear in the material — convert both
  ways), applied live through the existing `reapply()`.
- **lightness** — a −0.5..+0.5 slider that scales the picked colour's
  linear RGB by `1 + v` (clamped to 0..1). Applied live.
- **save skin** — POSTs `{ baseColor: [r, g, b] }` (linear) to the endpoint,
  which rewrites the character's `.blob` `palette` block `baseColor` line
  in place through `emitBlob` (a new `palette` override — same splice-the-
  value-span rule the face override uses, so alignment and comments
  survive). A character with no `palette` block gets an error back, shown
  in the panel: declare one first.

### The dev endpoint

A Vite plugin, `apply: 'serve'` only (never in a build), mounted at
`/__lab/save-face?character=<name>` and `/__lab/save-palette?character=<name>`.
It accepts only names matching `/^[a-z0-9-]+$/` that have a
`src/lab/sdf-zombie/characters/<name>.blob`, writes under the project root
only, and answers JSON `{ ok: true, path }` or `{ ok: false, error }`. The
handlers are pure functions of (root, name, payload) so they are unit-tested
against a temp directory; the plugin is a thin adapter over them.

Saves are ordinary file writes: the result is a git diff the owner reviews
like any other change. No backups, no history — that is git's job.

### Gates

- `emitBlob` palette override round-trips every shipped `.blob` byte-for-byte
  when no override is given (the existing test) and splices only the value
  span of `baseColor` when one is.
- Handler tests: rejects bad names and unknown characters; writes the PNG to
  the sheet's declared filename; rewrites `baseColor` and nothing else in a
  copied soldier.blob.
- Lab: upload a PNG → the head wears it; pick a colour → the body changes;
  both saves return `ok` and the files change on disk (verified by reading
  them back in the browser session).

### Out of scope

Editing any other palette parameter, non-decal blend modes, the game page,
production builds (the endpoint does not exist there).
