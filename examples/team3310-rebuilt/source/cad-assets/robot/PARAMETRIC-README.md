# Editable robot CAD

The default entry is `models.py`, using native Python/CadQuery/OCCT. Its 109
authored designs account for 178 of the full robot's 1,958 occurrences.

Edit the matching `native/parts/p_*.py` module; follow its imports to named
parameters, manufacturing profiles, hole patterns and shared builders.
`native/migration.json` maps stable asset IDs to Python modules. The assembly
preserves occurrence IDs, transforms and colors and caches reusable prototypes.
See [the native authoring guide](native/README.md) for the CLI feedback loop,
focused WebGPU captures and validation boundaries.

Executable legacy JavaScript CAD sources have been removed. Historical shape
measurements are retained in `native/evidence/legacy-geometry-validation.json`.
Vendor and unclassified parts remain STEP; do not replace them with guessed
geometry. Native coverage is recorded in `native/migration.json`. CAD validity
does not establish real-robot hardware fidelity.
