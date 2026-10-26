# Rapier assembly solving

`cadcove cad-mates` uses the bundled native Rapier runtime. `--backend rapier` is
optional; `--solver` selects an explicit compatible Rapier executable. The removed
Ondsel backend is rejected explicitly. There is no automatic solver fallback.

The request uses mm, degrees, seconds and explicit body-local mate frames.
Fixed, revolute and slider mates, closed loops, reviewed gear/belt/chain
relationships and timed drives retain the existing playback contract. Independent
residual checks in `vendor/cad-core/src/native/mate_contract.py` verify the result.
Solving a trajectory does not supply mass, material, contact or motor properties.

`solve-mechanism` projects the legacy CAD motion tree into mate constraints;
`animate` preserves uncommanded coordinates and rejects stale source/pose changes.
`inspect-step` reports standard STEP kinematics without guessing unresolved units
or occurrence mappings. See [Unified scene](UNIFIED-SCENE.md) for the physical graph.
