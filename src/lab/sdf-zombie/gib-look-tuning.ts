// src/lab/sdf-zombie/gib-look-tuning.ts
//
// ONE constant, shared by the GPU march shader and the CPU bake so the two
// cannot drift: the fraction of a piece's gore a HEAD's non-face exterior
// keeps.
//
// WHY IT EXISTS (2026-09-16 playtest follow-ups task 2). The owner reported
// that a gibbed head rendered as "a generic mottled meat blob" with the face
// lost. The march's gore mask was darkened the whole head, and the bake baked
// the same darkening into the settled head's vertex colour. A head was torn at
// the NECK; its exterior skin is intact, so only a minority of the normal
// chunk gore belongs on it. The face itself is protected completely (coverage
// 1); the rest of the head keeps this fraction.
//
// 1.0 restores the pre-task-2 behaviour exactly, which is what the look test
// pins as the control. 0.3 was chosen by normal-speed A/B: 0.6 still read as a
// dark ball at gameplay distance, 0.3 keeps a bloodied tint on the crown while
// the face and skin stay legible.
export const HEAD_EXTERIOR_GORE_KEEP = 0.3;
