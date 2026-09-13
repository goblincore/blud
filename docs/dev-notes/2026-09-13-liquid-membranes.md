# Liquid membrane experiment

Branch: codex/blood-liquid-membranes. Independent implementation following user rejection of GLM's spiky tuft.

Reduced tubes from 38 to 12 and changed their radius profile to narrow ligaments with rounded terminal bulges. Enlarged three curved membrane patches, increased their sampling, reduced contour serration, and removed triangles inside deterministic growing elliptical holes. Holes reach the rim and break the patches apart. Membranes retain extent and move outward rather than retracting to the wound. No shipped defaults changed.

Verified live WebGPU at 0.30 seconds front and 0.55 seconds oblique in the isolated port 5413 preview. This is a review candidate: connected red membranes now dominate, but broad fragments can still read as torn fabric and grid-cut hole edges remain visible close up. No claim of matching the reference yet, or of acceptable in-game performance. Vertex budget is 7,280 per event (test cap 8,192), up from the GLM bundle.

Validation: TypeScript clean after implementation; 53 focused impact/comparison tests pass. Comparison tests retain their pre-existing DOM-bootstrap console warning. Full game/temporal acceptance pending user review.

## Sprite representation

Following user direction, impact-splash-sprites.ts now generates eight branching alpha masks once into a filtered atlas. Thirty-two independently moving cards per event use deterministic trajectories, orientation, size, color and opacity variation. Cards sort by view depth across events; the existing small solid droplets and soft mist remain. Old membrane/core draw meshes are hidden. Live peak (.30s) and dispersal (.55s) inspected in WebGPU. The result has separate splash silhouettes rather than one continuous sheet, but shading remains flat. The old geometry builder still runs for the droplet path and diagnostic contracts: this is a visual prototype, not a performance-ready integration. No game default promotion. TypeScript and 53 focused tests pass.

## Wet shading and variation

Added a matching linear normal atlas derived from procedural mask thickness. TSL tangent-space normal mapping follows each rotated card and evaluates the existing impact light direction/color in view space, with restrained specular and grazing sheen. The supplied decal normal is not applied to unrelated generated shapes. Atlas increased to 16 masks; per-event pressure and count plus per-card size variation keep seeds distinct. Randomness remains deterministic over time. TypeScript, 53 focused tests, and diff whitespace checks pass. Peak comparison render inspected in WebGPU. In-game preview opened but did not reach gameplay during review: combat scale and frame cost remain unverified. Existing hidden geometry generation remains prototype overhead.

Reference workflow: Unity VFX Graph sample content includes texture flipbooks and particle behavior examples: https://github.com/Unity-Technologies/Graphics/blob/master/Packages/com.unity.visualeffectgraph/Documentation~/sample-content.md . This supports the atlas/particle workflow, not a claim that our blood matches a particular tutorial.

## Entry contact direction correction

User reported splash appearing behind actors. Immediate projectile splashes now receive the actual trace hit point and normalized incoming velocity; emit direction is the reverse incoming direction, with a 3.5 cm outward offset. Ongoing wound bleed and stump emission retain their existing anchors. This removes reliance on a reconstructed wound anchor for the entry effect. TypeScript passed; confirmation of the reported visual issue resolving is pending live user testing. Depth testing remains enabled.
