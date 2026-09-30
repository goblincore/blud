# Launcher grenade gameplay

Owner request: pronounced but playable arc, a visible grenade leaving the live muzzle, surface bounces, standard explosive/fragment round, and direct flesh hits that embed the grenade before it explodes. No arming delay or minimum standoff distance. The accepted FPV pass is PR #26; gameplay stays on a separate branch.

Use an immediately active 1.6-second fuse, 16 m/s launch speed, a small upward launch bias and 14 m/s² gravity. Hard surfaces bounce with damping; flesh embeds the nose, with the rear of the can visible. The fuse continues while embedded. Binding follows the hit primitive's live pose; a removed actor/limb releases the grenade with the remaining fuse. Reuse the active blast damage/gib/light/VFX path. Add deterministic damaging fragments, blocked by world surfaces, with short visible metal streaks.

Keep timing, swept collision, flight/fuse, embedding and fragment patterns in renderer-free modules. Build a simple olive can with brass band from the GLB palette, pooled before warm-up. Stock Basic materials keep it readable under the game's bright local lights; no new custom shaders, lights or real-world arming rules. Controls remain opt-in slot 4, normal fire and reload; keep multiple rounds alive across weapon switches.
