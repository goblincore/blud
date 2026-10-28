# Zombie refinement look-dev (2026-10-26)

The owner, after the grabber hands (PR goblincore/blud#75): bring the plain zombie up to the newer creatures' standard,
with a detailed body normal map, some kit, wrist shackles and bigger, fleshier hands.

`zombie-variants-sheet.png`: the shared base, then three outfits, all rendered in the lab (`blob:shot`) through the real
pipeline (baked map + Blender kit):

1. **Asylum escapee**: ankle shackles, a torn canvas straitjacket yoke and two leather straps, torn sleeve stubs.
2. **Morgue walker**: a Y-incision in the map, a sheet drape and hip wrap, a toe tag. The weakest at a distance.
3. **Rotting labourer**: torn work trousers, boots, suspenders. **Picked by the owner.**

`zombie-labourer-ingame.png`: the labourer in the arena (`/sdf-game.html?level=arena&god`), reaching.

Rebuild: `npx tsx scripts/zombie-surface.ts`, then `blender -b -noaudio -P assets-source/zombie-kit/make_kit.py [-- asylum|morgue]`,
then `npx tsx scripts/blender-kit.ts zombie assets-source/zombie-kit/zombie-parts.glb`. The map:
`npx tsx scripts/zombie-detail-gen.ts` and the `zombie` line of `scripts/body-normal-bake/bake-args.json`.

## Update 2026-10-27: SDF-cloth trousers

The owner wanted to try real cloth before machine legs. `characters/zombie-labourer.ts` splices five `shell`s into zombie.blob
for the game's zombie (zombie.blob itself stays the fixture body): `zombie-trousers-lab.png` (lab, rest pose, before the
knee-blend and fold tweak) and `zombie-trousers-ingame.png` (arena, walking).
