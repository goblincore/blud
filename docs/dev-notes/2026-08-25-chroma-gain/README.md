# chromaGain — more hue at the same darkness

The follow-up the P1 bounce spike left open. `ambientGain` made bounce visible
by adding LEVEL, which deliberately breaks the spec's "colour, not brightness"
rule. `chromaGain` adds hue **without** touching level, so it is that rule taken
literally.

**How.** `ambientAt` renormalises the accumulated bounce to unit luminance
(`tint`). White also has unit luminance, and luminance is linear — so
extrapolating from white through `tint` is *exactly* level-preserving at any
gain. Weak channels go negative past neutral, so they are clamped and the
result renormalised (a bare clamp silently ADDS level).

**Why it was needed.** A plausible room is mostly neutral — a Cornell box is
four white walls of six — so the accumulation lands near grey and almost no
colour reaches the figure. Measured 2026-08-25: the default box shifted the
character by (+2.1, +0.6, -4.6), which the owner could not see, while a single
saturated red wall shifted it +35.0 red. Without this knob the direction only
works with strongly-coloured level art.

**Measured on screen** — Cornell box, `practical-hard-key`, `ambientGain 4`,
flat -> bounce, cosmetics frozen:

| chromaGain | mean RGB shift | chroma of the shift |
|---|---|---|
| 1 | (13.3, 15.8, 12.0) | 3.8 |
| 2 | (13.4, 16.4, 8.1) | 8.3 |
| 3 | (13.5, 16.8, 5.1) | 11.7 |
| 4 | (13.9, 17.0, 2.9) | 14.1 |
| 6 | (14.9, 17.1, 0.2) | 16.9 |

The blue channel collapses from +12.0 to +0.2 while red and green hold — the
lift stops being a grey wash and becomes a coloured one. ~4.4x more chroma at
an unchanged level.

Images: `1-FLAT-no-bounce`, `2-bounce-gain4-chroma1`, `3-bounce-gain4-chroma4`.

**Shipping default is 1** on both presets — i.e. off, no behaviour change until
someone moves it. Still inert while `probeWeight` is 0, which every preset ships
and which only the lab overrides (gated on its enclosure).

**A test trap worth remembering.** The first unit test could not fail for the
right reason: with an AXIS-ALIGNED normal only one wall has positive `n.L` (the
others' closest points sit perpendicular), so the tint is that wall's pure
colour and is already saturated. An angled normal is required to make walls
compete — the same degenerate-fixture class that let task 1b's relax proof pass
on a broken shader.
