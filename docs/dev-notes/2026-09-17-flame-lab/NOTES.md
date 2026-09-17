# Flame lab — foundation captures (2026-09-17)

Baseline captures of the plan's surface fire/char look, shot with
`npm run flame:capture` (`scripts/flame-capture.mjs`, headless Chrome,
`?seed=1`, fixed 1380×820). Ten PNGs: five poses (`stand`, `walk`, `run`,
`collapsed`, `distant`) × two stages (`-fresh` = burn 1 char 0,
`-charred` = burn 1 char 0.6). The Blood tiles in each frame's bottom-right
corner are the reference the spec judges against (3321/3323/3325, burning
run). Backend confirmed `webgpu`; the shutter layer is installed in
pass-through (empty sim blurs nothing) and the captures.json beside these
files records the run.

What the surface look GIVES: at every pose the pair reads unambiguously as
"on fire" — the march paints burning noise directly on the skin, the flicker
light pools on the floor and both bodies, the glow bleeds over the
silhouette and the heat warp shimmers the air above; at `distant` the
emissive-plus-light-pool alone carries the read, which is the common combat
distance. Char turns the same body into a burnt corpse when the fire goes
out, and `collapsed-charred` is already a usable post-combat shot. The
silhouette stays exactly the character's own, so the pose stays readable
while burning — a genuine gameplay advantage over silhouette-breaking fire.

What it does NOT give — the brief for the three tongue plans: everything
above stops at the skin. The Blood reference shows flame TONGUES that rise
off the body, lick past the silhouette and dance independently of it; here
an engulfed body is a hot statue — no upward licks, no flame extending past
the outline, no volume between viewer and body at close range, where the
fire reads as an emissive texture rather than something WRAPPING the body.
Close/mid shots (the `stand` framing) are where the gap against the
reference tiles is widest, so that is the framing the tongue techniques
should be judged at; `distant` shows the foundation look is already
sufficient there and tongues must not wreck that readability.
