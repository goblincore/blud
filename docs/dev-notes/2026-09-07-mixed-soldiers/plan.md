# Mixed soldier encounters

User delegated requirements and implementation decisions. Scope: fifth room east of room2, three soldiers/two zombies, shared combat spacing and fire lanes, observed-position pursuit through real doorways, persistent noninteractive spent shells. Preserve current soldier appearance, damage, fall and baking work.

Design: deterministic static floor navigation grid over existing room/tunnel rectangles with inflated collision boxes; cached short routes and swept shortcut following. A game encounter coordinator owns sight/hearing/short-lived last-seen records and one ranged attack lease. Individual brains retain aim/fire/recovery and melee states. Only observed/heard coordinates enter pursuit. No unseen player tracking; lost actors search last known spot and return home. Dynamic room IDs and global collision-safe movement replace spawn-room clamps only when encounter navigation is enabled. Firing is gated by world LOS, ally corridor clearance and attack lease. Nearby enemies share direct observations; downed actors leave combat arbitration. Door traffic yields to agents already ahead.

Room and casing implementation are independent parallel subtasks. Casings use custom ballistic simulation then rest in capped instanced meshes, with no collision/picking interactions.

Validation: layout traversal/spawn clearance; navigation around furniture and through doors; memory expiry and no hidden-position leakage; fire lease fairness/blocked lanes; integration pursuit without crossing walls; one case per shot and settled/capped pool. Real game mixed room and casing visual smoke. Existing full suite and build after integration.

References: Valve, Michael Booth, The AI Systems of Left 4 Dead (2009), navigation/perception split and reactive path following; Jeff Orkin, Three States and a Plan: The AI of F.E.A.R. (GDC 2006), individual actions supporting squad behavior. No GOAP framework or full navmesh is needed for this small static layout.
