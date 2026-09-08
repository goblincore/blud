# Mesh-only skull sculpt follow-up

Approved scope: shot-off zombie face should reveal a skull with angular mandible, a flatter narrower chin, separated raised dental rows, nasal recess and cheek hollows, yellow-white bone and selective pink attachments. This is a geometry change, not just painted anatomy.

`mesh-skull.ts` adapts only zombie head sources. Subtractive planes and bounded ellipsoid recesses are intersected with the original field before CPU mesh extraction. The original head-rigid pose, AABB and outer containment envelope remain authoritative. The adapter appends a mesh-art revision token so cached head geometry cannot alias the unsculpted source; all other segments and volume/procedural sources remain unchanged. Eye placement must sample this adapter to seat on actual socket floors.

The soldier source has a much smaller, disconnected head field: normalized zombie nasal coordinates can contain no soldier bone. Soldier geometry is deliberately preserved rather than forcing zombie anatomy into that source. Mesh material remains shared with soldier as before.

The bite line moves from normalized y=-0.53 to -0.38. A real recessed slit separates the dental ledges, with irregular upper/lower dental coloring above and below. Socket/nose/cheek floors receive dark matte cavity shading; the frontal cavity gate reaches the sculpted recess depth. Broad ivory returns on heads, pink connective coverage and wound stain strength are reduced there; other body tissue rules are unchanged.

CPU verification covers subtractive envelope containment, nasal/orbital/cheek/bite depth, both retained dental ledges, flat chin face, rigid flesh clearance for zombie and soldier, mesh extraction completeness/field coverage, cache/lifecycle and material classes. GPU visual acceptance belongs to coordinator: exposed face forward and three-quarter, intact zombie and soldier, eyes seated and eyes removed. No performance claim and no volume/procedural visual change.
