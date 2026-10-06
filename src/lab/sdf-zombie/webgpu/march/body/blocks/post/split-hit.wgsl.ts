// src/lab/sdf-zombie/webgpu/march/body/blocks/post/split-hit.wgsl.ts
//
// THE HEAD SPLIT after the hit (head-split.ts unwarpPoint / unwarpDir are the CPU mirror): the hit piece's un-warped
// point, its turn, the head frame turned with it, and the cut-face gate and depth. Spliced into MARCH_TRACE_POST right
// after the world hit point, so marchBody, refineBody and the deferred marchSurface all run it.
import { SPLIT_SHADE } from '../../../../../head-split';

export const SPLIT_HIT_BLOCK = /* wgsl */ `  // THE HEAD SPLIT. The hit is on ONE rigid piece of its body (hitPiece, the walk's copy of gHitPiece: 0 the unmoved
  // rest and every closed body, 1 / 2 a half turned open by splitTheta), and the body's wounds, rest rows, bones and
  // face live on the CLOSED head. So what is anchored to the body reads the piece's UN-WARPED point pS (the rest
  // anchor, the wound and char masks, the bone taps) or the head frame turned with the piece (the face layer:
  // faceCentre, faceQuat), and a direction crosses between the two frames by the piece's turn splitQ. Lighting, the
  // normal's taps and the probes stay at the world point p.
  // A hit that is not on a turned half takes p, the record's frame and the identity themselves: h + R(a, 0)(p - h) is
  // not bit-equal to p, and a closed body must shade to the bit as it did.
  var splitTheta = 0.0;
  if (gInstSplitOpen && hitPiece != 0) { splitTheta = select(gInstSplitA.w, gInstSplitN.w, hitPiece == 1); }
  var pS = p;
  var splitQ = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  var faceCentre = gInstHeadCentre;
  var faceQuat = gInstHeadQuat;
  if (splitTheta != 0.0) {
    pS = splitMoveBack(p, gInstSplitH.xyz, gInstSplitA.xyz, splitTheta);
    splitQ = vec4<f32>(gInstSplitA.xyz * sin(0.5 * splitTheta), cos(0.5 * splitTheta));
    faceCentre = splitMoveBack(gInstHeadCentre, gInstSplitH.xyz, gInstSplitA.xyz, -splitTheta);
    faceQuat = qMulQ(splitQ, gInstHeadQuat);
  }
  // Inside an open head's region sphere the field is the union of turned, capped pieces (map-body.wgsl.ts): the
  // shading normal block takes the finite-difference normal there.
  let splitIn = gInstSplitOpen && length(p - gInstSplitH.xyz) <= gInstSplitR.x;
  // CUT FACES (head-split.ts SPLIT_SHADE). hitField.x is the split field at the accepted sample and hitSplitF the
  // winning piece's own field there, before its caps: equal on skin, where the piece's field is the surface, and
  // apart by the depth inside the closed body where a cap is (a cut face, the rest's hinge-plane face). cutFace is 0
  // on skin and on every closed body, 1 on a cut face; the wound mask block, the face layer and the cut-face look
  // block (cut-face.wgsl.ts) read it. cutDepth is how deep inside the closed body, as it is now, the hit lies at its
  // un-warped point: the depth the tissue ramp takes on a cut face, and the look block's.
  var cutFace = 0.0;
  if (gInstSplitOpen) { cutFace = smoothstep(${SPLIT_SHADE.cutLo}, ${SPLIT_SHADE.cutHi}, hitField.x - hitSplitF); }
  let cutDepth = max(0.0, -hitSplitF);`;
