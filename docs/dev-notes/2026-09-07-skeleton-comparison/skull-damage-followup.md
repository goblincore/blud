# Skull damage follow-up

User approved mesh skull geometry with more menacing exposed face, shaped jaw/nasal/cheek/socket cavities, raised readable tooth rows, restored ivory contrast, eyes knocked out by headshot force and dark empty sockets. Earlier accepted tissue/eye work is base f7a2b2e2.

Parallel work: skull_geometry owns mesh-only source sculpt/cache and appearance; eye_impacts owns event-driven eye damage/renderer integration; cavity_contrast diagnoses and locally corrects bright mesh wound cavity. Coordinator owns actual serial GPU and review. No main/push/default changes.

Interface: meshBoneSource(source) supplies sculpted mesh field for extraction and eye placement. Geometry must stay within original envelope; head pose remains common. Eye removal is per actor/eye from actual hits and persists until lifecycle reset. Eye emission absent after removal, dark cavity actual recess. Cavity work must distinguish real flesh shading from mesh bone shading and preserve global lighting.

## Result

- 7bb64154: zombie-only subtractive skull geometry within original bone envelope, narrowed flat chin, nasal/orbital/cheek recesses, raised mouth slit; more ivory and darker recess material. Teeth remain material detail on physical dental ledges, not individual modeled teeth. Soldier geometry unchanged.
- bd973272: localized actual projectile head impact integration with per-actor missing eyes, short ballistic debris and cleanup; compatible with source revision/reset. __sdfGame.hitMeshSkull and meshEyeState provide deterministic checks. Fixture invokes damage directly and does not test ballistic tracing; actual projectile hook reviewed separately. Cosmetic eye debris uses a simplified floor.
- 91012609: cavity diagnosis only; missing bone contributions to flesh secondary shading and control bone/material ambiguity documented. No arbitrary cavity darkening. Broader torso cavity brightness remains open.
- Source reviews for both changes and final integration review: no blockers. Geometry/appearance/mesh40 tests, eye13 tests, TypeScript and build passed; build retains existing chunk-size warning.
- Browser GPU captures /tmp/skull-damage-stable and /tmp/skull-damage-angle inspected: intact face remains covered; real damage fixture ejected2, missing[0,1], debris2; empty sockets and actual skull geometry visible front and three-quarter. No shader/runtime errors. Existing repeated-frame drift still makes harness exit1 and prohibits exact parity/performance claims. An earlier HMR-interrupted capture superseded.
- Preview5408 contains combined result. No main merge/push. Owner manual visual acceptance remains next.
