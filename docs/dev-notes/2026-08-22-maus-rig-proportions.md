# Proportions off the maus-biped reference rig

**Date:** 2026-08-22
**Source:** `~/Downloads/maus-biped/Meshy_AI_maus_biped_Character_output.glb`

Owner supplied a rigged mesh of the mouse. Its skeleton is a better brief than
any screenshot, because it gives exact joint heights rather than a silhouette.

## How these were taken

NOT by composing node translations — that gives nonsense here (segments summing
past 100%, a negative hip height) because the bind chain carries rotations.
Take the skin's `inverseBindMatrices`, invert each, and read the translation:
that is the joint's world position in bind pose, exactly.

## The numbers, as % of the bone-span (lowest joint to highest)

    toe              0.0%
    foot            12.7%
    hips            32.1%
    shoulder        56.5%
    neck            66.3%
    head base       74.1%

Which splits the body into near-thirds:

    legs   (toe -> hips)     32.1%
    torso  (hips -> neck)    34.2%
    head   (neck -> top)     33.7%

Segment lengths, same scale: thigh 9.7%, shin 7.6%, upper arm 11.5%,
forearm 8.2%, hips->chest 7.8%, chest->neck 26.5%, neck 7.8%.

## Against what mouse.blob currently does

    reference        blud mouse
    legs    32.1%    22%      <- legs are 46% too short
    torso   34.2%    37%
    head    33.7%    41%      <- head is 22% too big for the body

This is exactly the owner's read: *"the mouse should be quite tall and the body
long and elongated but in this one the body is too short and small compared to
the head... the limbs the legs the body everything needs to be longer."*

The fix is not to shrink the head — it is to LENGTHEN the legs and torso, which
lowers the head's share as a consequence and makes the whole character taller.
