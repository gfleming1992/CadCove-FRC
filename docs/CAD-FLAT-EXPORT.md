# Flat DXF export and SVG preview

Use `cadcove cad-flat --action capabilities` to discover the contract. This uses
the installed CadQuery/ezdxf libraries, without FreeCAD or a running editor.

Export a single constant-section plate with through holes:

```sh
cadcove cad-flat --action export --workspace . --input flat.json --output build/plate-flat --show
```

```json
{"schema":1,"part":"plate","frame":{"origin":[0,0,0],"xDir":[1,0,0],"normal":[0,0,1]}}
```

Coordinates are assembly-space millimetres. `frame.origin` lies on the bottom
stock face; `normal` points into the stock, and `xDir` sets the cutting-file X
axis. Directions must be perpendicular. Choose the intended broad plate face;
do not assume the assembly's XY plane. Optional `shapeHash` rejects stale geometry.

The exporter checks valid, closed contours and compares the profile extruded
through the measured thickness against the source solid. It rejects pockets,
countersinks, bevels and bent parts rather than losing these features. It does
not unfold sheet metal or add cutter compensation. No scale option is accepted.

Outputs in a new directory:

- `profile.dxf`: full-size millimetre geometry; OUTLINE and HOLES layers; exact
  lines/arcs/circles and native curve representations from CadQuery's exporter.
- `profile.svg`: a display preview rendered **from that DXF** by ezdxf.
- `source.json` and `result.json`: source revision, geometry/file hashes,
  thickness, contour counts, bounds and validation evidence.

The DXF is the CAM handoff. SVG is a preview, not a toolpath or a guarantee of
CAM software compatibility. Use the machine's CAM workflow to choose cutter,
stock, depth, feeds and workholding. Dimensioned PDFs are a separate `cad-drawing`
workflow.

Preview an existing DXF without rebuilding any CAD:

```sh
cadcove cad-flat --action preview --workspace . --input part.dxf --output build/dxf-preview --show
```

The initial preview scope is planar XY modelspace geometry at Z=0: LINE, ARC,
CIRCLE, ELLIPSE, SPLINE, LWPOLYLINE and POLYLINE. INSUNITS must declare mm or inches;
inches convert to mm. Unsupported entities (including text, blocks and hatches),
invalid files, undeclared units and 3D geometry fail explicitly. Limit: 32 MiB,
100,000 entities, 60-second conversion deadline. Rendering honors layer visibility.

Show an existing SVG on request:

```sh
cadcove cad-flat --action show --workspace . --input build/plate-flat/profile.svg
```

MCP hosts can instead call `open_svg_preview` with `file` and optional `workspace`.
It uses VS Code's existing image preview editor; no custom DXF viewer is required.
Files must be inside the open workspace (including after symlink resolution).
`--show` requests this after a successful export/conversion. If the editor is not
available, export still succeeds and returns `display.ok:false` with the reason;
the agent must not claim the preview opened. Refresh agent guidance after upgrading.
