// src/lab/sdf-zombie/webgpu/march-private-reads.ts
//
// The ONE wgslFn node that carries MARCH_NORMAL_OUT — and with it the march
// body's module-scope privates `gMarchNormal` and `gMarchAnchor` — plus the
// anchor read that shares it.
//
// WHY ITS OWN MODULE. Every node chain that includes the march body must be
// SEEDED with this exact node (identity, not a copy of the text): three's
// builder emits a dependency's code once per node, so one shared node means
// one `var<private>` declaration, and two copies of the text would redeclare
// it and fail every pipeline (MARCH_NORMAL_OUT's own doc).
//
// It lived in zombie-gpu.ts, which only the FORWARD march could reach.
// deferred-sdf.ts builds the deferred surface chain at module load and is
// imported BY zombie-gpu, so importing the node back from there is a cycle
// that hands it `undefined`. Its chain was therefore seeded with `[]` — and
// once upscale run 4 (cd8d8d8a) made the shared wound-masks block WRITE
// `gMarchAnchor`, every deferred surface shader referenced an undeclared
// private: "unresolved value 'gMarchAnchor'", no deferred stamps, found by
// the shutter task-3 rig on 2026-09-21. A leaf module both can import ends it.
import { wgslFn } from 'three/tsl';
import { MARCH_ANCHOR_READ, MARCH_NORMAL_OUT } from './march.wgsl';

/** The runtime-normals read fn + its private globals (MARCH_NORMAL_OUT). Seeds
 *  every march chain, forward and deferred; call as marchNormalRead({ dep })
 *  with the march result. */
export const marchNormalRead = wgslFn(MARCH_NORMAL_OUT);
/** Run 4: the anchor/gate read (MARCH_ANCHOR_READ), sharing marchNormalRead's private declaration. */
export const marchAnchorRead = wgslFn(MARCH_ANCHOR_READ, [marchNormalRead] as never);
