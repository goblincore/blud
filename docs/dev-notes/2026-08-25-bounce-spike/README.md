# Bounce-spike captures

Intended location for the four A/B screenshots (flat vs bounce, red room and
blue room, `henenlotter-latex` + `practical-hard-key`), judged by the owner.

**Empty as of 2026-08-25.** The dispatch sandbox in the session that built this
spike could not boot Chrome: macOS Chrome must write its crashpad state and
process-singleton socket to `~/Library/Application Support/Google/Chrome` and
`/var/folders/<uuid>/T`, both outside the `workspace-write` sandbox, and
escalation to `danger-full-access` was unavailable (approval prompts disabled).
So nothing was rendered and no PNG was produced.

To fill this directory, run the lab in a normal (non-sandboxed) session and
capture with `scripts/blob-turntable.mjs`, then drop the PNGs here. See
`../2026-08-25-bounce-spike-findings.md` for the full findings and the exact
gate checks.
