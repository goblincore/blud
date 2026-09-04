#!/usr/bin/env bash
# Link the gitignored dev-placeholder assets into THIS worktree.
#
# WHY THIS EXISTS. public/assets carries two kinds of thing. The tracked dirs
# (animations/, blood-tiles/, lab/) are ours and clone with the repo. The rest
# are extracted Blood placeholders — .gitignore refuses them on purpose, and
# CLAUDE.md's guardrail says never commit, never ship. So a fresh worktree or
# clone gets 3 of the 11 dirs and CANNOT run the game.
#
# The failure is ugly and does not name its cause: Vite's SPA fallback answers
# a missing file with index.html and a 200, so the manifest fetches "succeed"
# and the boot dies on
#     SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON
# with a wall of audio EncodingErrors above it. Nothing in that says "you are
# in a worktree". Half an hour of debugging the wrong thing, once per worktree.
#
# Symlinks, not copies: 33M per worktree adds up, and a copy silently goes
# stale the next time the extraction pipeline reruns.
#
#   scripts/link-dev-assets.sh
set -euo pipefail

# The CALLER's worktree, not the script's own directory. Worktrees share this
# script through the primary checkout, so keying off "$0" made every run think
# it was already home and link nothing.
here="$(git rev-parse --show-toplevel)"
# The FIRST line of `git worktree list` is always the primary checkout — the
# one place these dirs actually live, since no clone can fetch them.
primary="$(git -C "$here" worktree list --porcelain | head -1 | sed 's/^worktree //')"

if [ "$primary" = "$here" ]; then
  echo "already in the primary checkout ($here) — nothing to link"
  exit 0
fi

linked=0; missing=0
for src in "$primary"/public/assets/*/; do
  name="$(basename "$src")"
  dest="$here/public/assets/$name"
  # Only ever fill a HOLE. An existing dir is either tracked (and correct) or a
  # link we already made; clobbering it could destroy real work.
  [ -e "$dest" ] || [ -L "$dest" ] && continue
  ln -s "$src" "$dest"
  echo "  linked $name"
  linked=$((linked + 1))
done

for name in gibs-placeholder audio-placeholder arena-placeholder weapons vfx; do
  [ -e "$here/public/assets/$name" ] || { echo "  STILL MISSING: $name" >&2; missing=$((missing + 1)); }
done

echo "linked $linked dir(s) from $primary"
[ "$missing" -eq 0 ] || { echo "the primary checkout is missing them too — re-run the extraction pipeline" >&2; exit 1; }
