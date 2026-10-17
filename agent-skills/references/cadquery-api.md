# CadQuery 2.6.1 API navigation

This is CadCove's authoring guide, not a restricted replacement for CadQuery.
The entire installed CadQuery and OCP Python APIs are available. Use the project's
Python executable for `help(...)` and `inspect.signature(...)`; this gives the
exact API for the installed version without guessing from another CAD dialect.

```python
import cadquery as cq
import inspect
print(inspect.signature(cq.Workplane.loft))
help(cq.Workplane.sweep)
help(cq.Sketch)
```

## Modeling vocabulary

- Primitives: `cq.Workplane('XY').box(...)`, `.cylinder(...)`, `.sphere(...)`.
- Profiles: `.moveTo(...)`, `.lineTo(...)`, `.polyline(...)`, `.spline(...)`,
  `.threePointArc(...)`, `.close()`, `.rect(...)`, `.circle(...)`.
- Features: `.extrude(...)`, `.revolve(...)`, `.sweep(...)`, `.loft(...)`,
  `.cutBlind(...)`, `.cutThruAll()`, `.hole(...)`, `.cboreHole(...)`, `.cskHole(...)`.
- Selection: `.faces(...)`, `.edges(...)`, `.vertices(...)`, `.workplane(...)`.
  Geometric selectors are sensitive to topology; inspect after changing features.
- Finishing: `.fillet(...)`, `.chamfer(...)`, `.shell(...)`.
- Booleans: `.union(...)`, `.cut(...)`, `.intersect(...)`; ordinary Python loops
  and helpers express patterns. Prefer reusable geometry over coordinate dumps.
- Sketches: `cq.Sketch()` supports constrained profiles; check constraint solve
  results and do not assume a partially constrained sketch has a unique solution.
- Assemblies: `cq.Assembly`, `cq.Location`, `cq.Color`; preserve IDs, placements,
  reusable prototypes and colors. See native-cadquery.md for `build(ctx)` caching.
- Exchange: `cq.importers.importStep(...)`, `cq.exporters.export(...)`.
  Use `ctx.import_step(...)` for source-bound imports inside models.
- Exact checks: `shape.isValid()`, `.Volume()`, `.Area()`, `.BoundingBox()`,
  `.Center()`, `cq.Shape.matrixOfInertia(shape)` and boolean intersection volume.
  Geometric mass properties require density/material assignments for real mass.

Use `cadcove cad-session` to build, inspect and export in one warm native worker.
Use `cadcove cad-capture` for focused WebGPU images in the open editor canvas.
An agent should check dimensions, clearances and validity numerically, then inspect
images, revise, and repeat. A successful render alone is not engineering sign-off.

Official documentation: https://cadquery.readthedocs.io/en/latest/
Source and upstream license: https://github.com/CadQuery/cadquery/tree/2.6.1
Python/CadQuery/OCCT are installed separately; the MIT license on CadCove does
not relicense those dependencies.
