# Agent-driven part drawings

`cad-drawing` creates an A4 landscape page from one current native CAD solid,
using optional, separately installed FreeCAD TechDraw. It writes vector PDF,
SVG, and an editable FreeCAD document. No visible FreeCAD window is required;
its Qt offscreen platform must be installed. Verified with FreeCAD 1.1.4 on
macOS Apple Silicon; other FreeCAD/platform combinations need qualification.

```sh
cadcove cad-drawing --action capabilities
cadcove cad-drawing --action export --workspace . --input drawing.json \
  --output build/drawing-001 --freecad /absolute/path/to/FreeCADCmd
```

`CADCOVE_FREECAD` can supply the executable. Python resolves like other native
CAD commands. The output directory must be new; failures keep diagnostic evidence.
The optional dependency is not bundled or silently installed.

## Request

Coordinates identify geometry in the current occurrence's CAD frame, in mm.
`positionMm` is the dimension text position on the page, measured from its lower
left corner, independent of drawing scale. Dimensions use exact projected
geometry. They are not arbitrary numeric annotations.

```json
{
  "schema": 1,
  "part": "plate",
  "title": "Bearing mount plate",
  "scale": "fit",
  "notes": ["Material and tolerances to be specified by the designer."],
  "dimensions": [
    {"id":"width","view":"top","type":"horizontal",
     "points":[[0,0,6],[80,0,6]],"positionMm":[70,115]},
    {"id":"bore","view":"top","type":"diameter",
     "center":[20,25,6],"radiusMm":5,"positionMm":[85,162]}
  ]
}
```

Views: top looks along +Z, front along -Y, right along +X; the isometric is
illustrative. The four views share a scale and use a third-angle arrangement.
`fit` chooses a conventional scale that fits all four projected bounds. An
explicit scale, such as `0.5`, is rejected if the part won't fit the reserved view
areas. Top/front/right can carry `horizontal`, `vertical`, `distance`, and
`diameter` dimensions. Linear endpoints must be actual CAD vertices. Diameter
references require a circular edge in the source and a unique circle in that
view. Ambiguous, missing, or collapsed references fail instead of being guessed.

Optional `shapeHash` pins the request to a previously inspected solid. Every
export records the actual source revision, geometry hash, FreeCAD version,
measured values, page scale and output hashes. This is a snapshot, not a live
link from the saved FreeCAD document to future CadQuery edits. Regenerate after
an edit; stale pins and missing references fail explicitly.

The agent should inspect geometry first, choose meaningful dimensions, export,
and render the PDF for visual review. Check all views/details, layout, dimension
placement, page scale, print at 100%, and explicitly supplied material/tolerances.
A successful exporter does not make a drawing complete for manufacture. The
current command does not infer tolerances or material, produce section views,
GD&T, assembly sheets, cutting DXF, or CAM toolpaths. `reviewRequired` remains
true even after an export succeeds.

The backend uses TechDraw to project geometry and measure dimensions. It exports
the complete SVG page and renders that vector page through Qt to PDF, avoiding a
missing-circle issue observed in direct TechDraw offscreen PDF export. FreeCAD
user preferences are isolated from the user's installation.
