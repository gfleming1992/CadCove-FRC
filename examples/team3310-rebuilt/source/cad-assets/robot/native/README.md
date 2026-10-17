# Native CadQuery robot parts

`../models.py` is the robot's default CAD entry. All 109 authored part designs
are Python/CadQuery modules under `parts/`; `migration.json` maps the stable
asset IDs to those modules and records the original source digests. They rebuild
geometry with native OCCT from dimensions, profiles, curves and surface grids.
The assembly retains 1,958 occurrence IDs, placements and authored colors.
Vendor, unclassified and intentionally unconverted custom components remain
separate STEP assets; they are loaded only by the assembly's vendor/import path.

## Edit and inspect

Use the robot folder as the configured CAD source root and `models.py` as its
entry. Find a part by asset ID in `migration.json`, then edit its
`parts/p_*.py` module or the shared helper it imports. Each part exposes
`make(**overrides)` and `build(ctx)`. Follow the named parameters and
manufacturing intent. Shared helper changes can affect multiple parts.

Install the pinned Python/CadQuery environment described in the repository's
native authoring guide. From the configured robot workspace:

```sh
cadcove cad-build --workspace .
cadcove cad-session --workspace .
cadcove cad-inspect --workspace . --script checks.py
cadcove cad-capture --workspace . --view iso --ids OCCURRENCE_ID --output build/check.png
```

Build/inspect/export run from the command line. Open `models.py`, an individual
Python part, or a STEP file through VS Code's **Open in CAD Canvas** command
for interactive WebGPU viewing. Capture requires that editor view, preserves
its camera, and binds the image to the accepted revision. Keep the native CLI
session open during iterative edits to avoid repeated Python imports.

## Geometry and validation boundaries

The modules do not execute JavaScript or load original authored STEP/BREP files
as a fallback. A few difficult trim repairs exchange the *newly generated*
native shape through a temporary STEP file to normalize OCCT pcurves; those
files are temporary outputs, not hidden source geometry. Explicit rolling-blend
surfaces preserve the converted design, but changing their overall curvature
may require changing their boundary data as well as nearby stock dimensions.
The 600-003 ring uses a 1e-6 mm fuzzy cut at its tangent notch lips.

From the robot source folder, run the full default-shape check with:

```sh
python native/validate.py
```

This checks generated solid validity and positive volume. It does not establish
arbitrary parameter ranges, assembly interference, physical material properties
or hardware calibration. Use focused renders and exact geometric checks for
individual edits. Preserve stable IDs, transforms and colors; review and rebuild
source-bound collision/mass artifacts before simulating changed geometry.
Rapier configuration and robot controls remain independent of the CAD backend.

### Known rail STEP exchange limitation

The reconstructed 600004 A/B rails render and validate as native solids, with
sub-micron surface agreement to the existing model. STEP export/reimport changes
some trimmed rail geometry in both the old WASM construction and this native
port. Do not use those STEP exports for manufacturing without checking the
reimported shape. Native source/BREP geometry is the validated representation.
See `../../../native-migration-validation.json` for the measured evidence.
