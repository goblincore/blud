# Gibbet kit: joints. exec()'d by ../gorehound-kit/build.py after hound_common.py (whose helpers this kit shares),
# overriding the joint table with gibbet.blob's rest skeleton (blob coords). The legs reuse make_legs.py from the
# gorehound kit (found by build.py's script search), run thinner (HEAVY). skin.json is an empty stub: nothing on
# this body seats on the skin (the cage swings with the sac, so it is placed on the hem axis instead).
J = {
    'hip': (0.220, 1.060, 0.000), 'knee': (0.392, 0.762, 0.241), 'hock': (0.392, 0.440, -0.029), 'toe': (0.392, 0.019, 0.030),
    'shoulder': (0.260, 0.932, 0.620), 'elbow': (0.443, 0.588, 0.462), 'wrist': (0.443, 0.169, 0.598), 'paw': (0.443, 0.014, 0.754),
    'hips': (0.0, 1.060, 0.0), 'withers': (0.0, 1.082, 0.620), 'neckBase': (0.0, 1.056, 0.767),
    'atlas': (0.0, 0.777, 0.880), 'face': (0.0, 0.624, 1.008), 'chin': (0.0, 0.608, 0.941),
    # the sac's pendulum: hips -> the sac's bottom
    'hemTop': (0.0, 1.060, 0.0), 'hemEnd': (0.0, 0.300, 0.307),
}
JV = {k: bv(*v) for k, v in J.items()}
HEAVY = {'fore': 1.05, 'hind': 1.1}
TOE_STYLE = 'spike'   # the parasite's walking spikes, not paws (owner review: the paws read as skis)
WIRE_MATS = ('cable', 'red')
