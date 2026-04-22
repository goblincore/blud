# NotBlood source reference

Canonical source of truth for NotBlood / Blood code paths, QAV mappings, weapon state machines, and resource file formats lives in the Obsidian vault:

**`~/Documents/obsidiandocs/my life and learnings/Claude Notes/Blud/2026-04-22-notblood-source-reference.md`**

Topics covered there:

- File paths for the NotBlood source tree (primary at `/private/tmp/notblood-ref/NotBlood/source/blood/src/`), BLOOD.RFF, and the pre-extracted tile PNG scan at `/Users/donny/Pictures/blud-sprite-scan/`
- Which `.cpp` file holds what (weapon state machines, enemy AI, projectile physics, sound dispatch)
- How Blood weapon state machines work (`WeaponRaise` → `WeaponProcess`/`processXXX` → `FireNone` post-QAV callbacks → `WeaponLower`)
- Resource formats: RFF, ART, QAV, SEQ, MAP
- Full canonical mapping for the dynamite (kWeaponTNT) FSM: states 1/3/4/5/6, the 8 BUN* QAVs with frame counts and purposes, tile vocabulary (3192–3221)
- A reusable recipe for investigating any new weapon

When touching any Blood-ported system, open the Obsidian note first.
