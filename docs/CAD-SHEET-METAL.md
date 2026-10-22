# Headless sheet-metal unfolding

`cad-sheetmetal` calls the existing FreeCAD SheetMetal add-on's Python unfolder,
without opening FreeCAD's GUI. It does not implement a second unfolding algorithm.
This first integration unfolds a current CAD part; bend/flange authoring, forming
simulation, machine-specific DFM and toolpaths are not exposed by this command.
Use ordinary CadQuery for geometry authoring and `cad-flat` for already-flat stock.

## Dependencies

FreeCADCmd and the SheetMetal add-on are external, optional dependencies. Commands
never install them. Configure absolute paths with `--freecad` and `--sheetmetal`,
or `CADCOVE_FREECAD` and `CADCOVE_SHEETMETAL`. The latter points to the directory
containing `SheetMetalNewUnfolder.py`. NetworkX must be importable by FreeCAD's
Python (the add-on directory is also on its module path). CadQuery/ezdxf use the
workspace's normal configured Python executable.

Tested on macOS arm64 with FreeCAD 1.1.4, NetworkX 3.4.2, and unmodified
[SheetMetal](https://github.com/shaise/FreeCAD_SheetMetal) commit
`cbf6595b68ad015266923749c160c3555a72e1fd`. No FreeCADGui module or task panel is
used. This does not qualify other add-on revisions or operating systems. Backend
results record the FreeCAD/NetworkX versions and actual loaded add-on source hashes.
The external add-on retains its upstream LGPL notices; CadCove does not bundle or
modify it. Its FreeCAD document/Part dependencies mean it is not a direct OCP import.

## Agent workflow

1. Identify the part and inspect its exact CAD. Select a named planar root face
   by centroid and outward normal, using the checked-reference contract.
2. Obtain sheet thickness and a shop/material-supported K-factor. Do not silently
   invent a production value. ANSI values are 0–0.5; DIN values are 0–1 (twice ANSI).
3. Run the request below. Ask for missing manufacturing inputs only when existing
   model/shop data cannot establish them. The example's value is a test assumption.
4. Inspect the SVG and numeric result. Review the flat pattern and bend setup
   with the manufacturer. An unfold success is not a DFM approval.

```sh
cadcove cad-sheetmetal --action capabilities
cadcove cad-sheetmetal --action unfold --workspace . \
  --input sheetmetal.json --output output/bracket-unfold \
  --freecad /absolute/path/to/FreeCADCmd \
  --sheetmetal /absolute/path/to/FreeCAD_SheetMetal --explain --show
```

```json
{
  "schema": 1,
  "part": "bracket",
  "thicknessMm": 2,
  "rootFace": {
    "id": "base", "part": "bracket", "kind": "plane",
    "point": [-20, -10, 0], "axis": [0, 0, -1]
  },
  "kFactor": {
    "value": 0.4, "standard": "ansi",
    "source": "Synthetic demonstration assumption; replace with shop data"
  }
}
```

Optional `shapeHash` pins a previously inspected shape. The CLI builds the current
CAD in the native worker, resolves the reference, exports BREP, and checks its hash
and face again inside FreeCAD. Source CAD files are not rewritten. Geometry cache
behavior stays with the existing CAD build; unfolding does not invalidate it.

## Outputs and limits

- `cut.dxf`: full-size millimetre cutting contours on OUTLINE and HOLES layers.
- `unfold.dxf`: same contours plus dashed BENDS centerlines (not cutting paths).
- `preview.svg`: rendered from `unfold.dxf`, viewable in VS Code with `--show` or
  `cad-flat --action show --workspace . --input output/bracket-unfold/preview.svg`.
- `flat.step`, `flat.brep`: unfolded solid, independently checked as a constant
  section with the requested thickness and closed contours.
- `source.json`, `input.json`, `backend-result.json`, `result.json`, `backend.log`:
  source revision, geometry hashes, parameters, backend provenance and diagnostics.

Outputs require a new directory. Failed jobs keep diagnostics but do not report
success; an editor display failure does not discard a completed export. The CLI
works without VS Code unless `--show` is requested. Bend marks must be planar and
inside the cutting profile. Missing/ambiguous faces, stale geometry, thickness
mismatches, invalid/disconnected flats and omitted bends are rejected. A second
mid-thickness unfold checks material-volume consistency to catch omitted nonuniform
features such as counterbores; this remains a geometry check, not a DFM certificate.

Initial scope is one solid with planar walls and cylindrical bends. This is not
a complete recognition or manufacturability proof for arbitrary STEP geometry.
Upstream may approximate curves during cleanup. The command does not check press
brake tooling access, minimum flange length, hole-to-bend rules, springback, bend
sequence, or material suitability. `dfmValidated` is always false.

## Deterministic animated explanations

Optional `--explain` produces `folds.svg`: self-contained SVG animation generated
by Python from the recovered bend angles/radii, thickness and K-factor. The agent
supplies parameters; no model-generated frames, JavaScript, external assets or
per-frame agent calls are needed. Identical inputs produce identical SVG bytes.
`--show` opens both the flat preview and animated explanation in VS Code. A static
final pose is included for viewers without animation, and reduced-motion settings
select the static version.

Each bend is an independent cross-section schematic with illustrative flange
lengths. The neutral-axis arc length is preserved during the illustration. It is
not the entire bracket folding in 3D, not a press-brake sequence, and not a
collision/material-deformation simulation. Up to 24 bends, each at most 180 degrees,
are supported by the explanation generator. The six-second loop folds, holds,
and visually resets. Future DFM explanations can reuse this scripted artifact
approach without interpreting a diagram as a manufacturing validation.

## Interactive 3D fold preview

For spatial explanations use the existing WebGPU CAD canvas. After unfolding,
create a separate preview entry under the configured CAD source directory:

```sh
cadcove cad-sheetmetal --action preview --workspace . \
  --input output/bracket-unfold --output cad/bracket-fold-preview \
  --seconds 4 --freecad /absolute/path/to/FreeCADCmd \
  --sheetmetal /absolute/path/to/FreeCAD_SheetMetal --show
```

Replace `cad` with your configured source directory. The input is the completed
unfold job directory, not the original request JSON. It uses that frozen geometry
snapshot, checks its hash, and revalidates it with the external backend. It does
not rewrite your original model. The output directory must be new. With no
`--show`, creation and building work headlessly; the returned `foldPreview.entry`
and `playbackFile` can be opened and played later.

The agent can orbit, pan and zoom during playback. The shared `canvas_command`
accepts `motion` options `{action:"play-fold",solutionFile:"build/...json"}` with
an explicit CAD entry. Pause, resume, seek (seconds), stop, reset and state use the
same motion API as mechanisms. Reset restores flat stock. A new play-fold command
starts at flat stock. Replay and seeking use the loaded meshes, not CAD rebuilds.
The generated plan has one timed track per bend; `startSeconds` and `seconds`
allow sequential or simultaneous folds. The CLI's `--seconds` is time per bend,
with sequential illustrative ordering and a two-second final hold.

Flat sections remain rigid; bend strips change curvature while preserving neutral
axis length and thickness. Descendant regions follow their parent bends. Holes and
profiles come from the actual unfolded geometry. Rendering subdivides bend strips
once; the source geometry cache stays immutable. Plans require the exact preview
source revision and reject invalid frames, missing regions and inconsistent trees.

Initial scope: an acyclic tree of planar walls and cylindrical bends up to 180°,
64 bends / 128 regions / 500,000 display vertices, and at most 300 seconds of motion.
The recovered regions must partition the independently validated flat stock.
This is a geometric folding illustration, not a forming/material simulation or a
collision-checked press-brake sequence. Bend ordering is not manufacturing advice.
SVG remains available for flat patterns and compact cross-section explanations.
