# The lab ignored every `.blob`'s own `face` block

**Date:** 2026-08-22
**Fixed in:** `39f93e1`, with `goblin.blob` pinned in a follow-up

## What was wrong

`lab-main.ts` built every character's cranium from:

```ts
const face: FaceParams = { ...DEFAULT_FACE, ...(override.faceParams ?? {}) };
```

A character's OWN `face` block — `headRadius`, `headWidth`, `jawDrop`, the lot —
was parsed, validated, and then **discarded at render time**.

The mechanism is a trap `blob-compile.ts` already documents in its own header:

> `face` defaults to `compileFace(doc)` … but a default parameter only fires
> when the caller OMITS the argument. **This is not hypothetical.
> `lab-main.ts` always supplies an explicit face.**

The header called out the validation being skipped. The larger consequence —
that the whole block was unread — went unnoticed for as long as the format has
existed.

## How it surfaced

The clown's head looked far too small under a cap sized for it. Several
attempts to widen it *did nothing*, because `headWidth` was never read. The
clown authored `0.235 x 1.18` and rendered at `DEFAULT_FACE`'s `0.118 x 0.76` —
a head half the intended size.

## The part that matters for anyone touching this

**Fixing it changes characters, and not always for the better.**

Every by-eye decision made while the bug was live was tuned against the DEFAULT
head. For the goblin that was the nose's reach, the lips' height, the ears, the
sunglasses, and the whole kit fit. Its authored block is a wider, rounder,
shallower-crowned skull:

    headWidth   0.96  vs DEFAULT 0.76
    headHeight  1.02  vs DEFAULT 1.161

Under it the hooked nose that reads as a sharp beak becomes a soft bump on a
bloated face — 44 mm proud of the cranium instead of 57 mm, on a head 26%
wider. Rendered and confirmed, not theorised.

So `goblin.blob`'s face block is deliberately **pinned to `DEFAULT_FACE`'s
values**, with a comment saying why. Re-shaping that skull is a real art
decision that drags the nose, lips and kit with it; it should be taken
deliberately rather than inherited from a bug fix.

## Who was actually affected

| character | authored face vs DEFAULT | effect of the fix |
| --- | --- | --- |
| zombie | identical | none — verified by render, head ratio 0.381 -> 0.378, inside the turntable's own drift |
| goblin | differs | regressed; now pinned |
| clown | differs a lot | this is what the fix was for |

Do not assume from "its head looks big" that a character was hit. The zombie's
head has always been that size.

## Idea this suggests

The face params are per-character, live-tunable in the panel, and now actually
drive the render. A **big-head mode** — scale `headRadius` at spawn — is close
to free, and would work on every character at once.
