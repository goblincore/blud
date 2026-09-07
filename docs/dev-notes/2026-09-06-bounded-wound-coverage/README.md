# Bounded torso coverage diagnosis

The user reports acceptable but visibly reduced wound quality versus baseline, including upper-chest hits sometimes showing no wound. They consider the tradeoff worthwhile only if a measured performance improvement justifies it.

`check.ts` traces horizontal pellet rays against the actual compiled zombie body, stamps through `createZombieActor.stampBlast`, advances the preview transition, and checks the resolved uploaded cutter spheres and slab caps at the new impact. Both baseline and preview start in the same initialized actor pose. Each fixture starts fresh; the prior-damage fixtures first receive a belly hit at y=1.05. This is a CPU actor/state/geometry diagnosis, not a GPU pixel-visibility test or a timing result.

Of 15 positions (x=-0.12/0/0.12; y=1.10/1.25/1.32/1.38/1.43), 13 hit torso primitives. All 13 fresh torso shots have positive carve support in both baseline and preview. After the belly hit, the baseline still covers all 13 new torso impact points, whereas the preview fails to cover 12 of 13.

At upper-chest y=1.32, the first hit correctly binds torso primitive 5 and gets a 0.1152 m depth cap. With prior belly damage, gameplay records that same correct upper-chest wound, but visual cutters stay near y=1.067 and y=1.017. The closest cutter fails to reach the new impact by approximately 0.133 m. Therefore this reproduction is a single-region coverage limitation, not incorrect upper-chest ownership or a missing depth cap. It does not establish that every user-observed invisible wound has this cause.

Proposed next design: a small fixed set of torso regions (at minimum upper/lower and front/back), each with bounded preset severity and an anchor in its wound frame. Do not move the old cavity to the newest hit. Region count and cutter budget need to remain explicit; four regions with up to two cutters each cost up to eight torso cutters and leave fewer stock fallback slots in the existing 16-row upload. First-hit placement, side/flank boundaries and repeated hits across regions need coverage checks before timing.

Measure baseline and the adequately covered candidate with identical resolution (640x480), SDF scale (1.0), FXAA (on), smear (0.25), actor load and shot sequence. Report steady GPU/frame cost, first-hit/transition stalls, and combat frame misses separately. No performance gain has been established for this game preview, and adding regions may reduce any savings from the current two-cutter case.

Reproduce:

```sh
node_modules/.bin/vite-node docs/dev-notes/2026-09-06-bounded-wound-coverage/check.ts
```

No runtime behavior changed during this investigation.
