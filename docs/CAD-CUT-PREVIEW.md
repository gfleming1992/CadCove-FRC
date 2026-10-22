# Cutting preview

`cad-cut-preview` creates a separate native CAD scene for a rectangular stock
plate and a cutter, then plays supplied moves in the existing 3D canvas. Orbit,
pan, zoom, selection and the shared pause/resume/seek/reset commands stay available.
Only swept material is removed. Finished pieces and surrounding scrap remain in
place even after a closed contour cuts through; no falling or automatic release.

```sh
cadcove cad-cut-preview --action preview --workspace . \
  --input paths.json --output cad/cutting-preview --show
```

Output must be a **new directory inside the configured CAD source directory**.
The tool does not overwrite a model. It returns the entry, source revision,
playback file, duration and display resolution. It works without an editor unless
`--show` is requested. No FreeCAD or CAM dependency is needed.

Example `paths.json` (all positions and tool dimensions in mm, timing in seconds):

```json
{
  "schema": 1,
  "units": "mm-s",
  "stock": {"id":"stock","origin":[0,0,0],"size":[60,40,4]},
  "tool": {"id":"tool","kind":"bit","diameterMm":3,"lengthMm":12},
  "resolutionMm": 0.5,
  "start": [10,8,8],
  "moves": [
    {"mode":"cut","to":[10,8,2],"seconds":2},
    {"mode":"cut","to":[50,8,2],"seconds":5},
    {"mode":"rapid","to":[50,8,8],"seconds":1}
  ],
  "holdSeconds": 2
}
```

Choose `tool.kind:"bit"` for the fluted end mill and short shank, or
`tool.kind:"laser"` for a compact nozzle with a thin red beam to the stock surface. `"router"` remains a compatibility
alias for `"bit"`. The visuals are built once when creating the preview;
`diameterMm` is the bit diameter or laser kerf width, independently of timing.
For example, a ¼-inch bit uses `diameterMm:6.35`; its diameter controls both
the cutter geometry and the removed groove. For bits, `lengthMm` controls the
displayed cutter length; cutting depth comes from the move’s Z coordinate.
No spindle housing or machine body obscures the stock. The laser beam is on
only during cut moves and off during travel, holds and after completion.
For laser, `lengthMm` is the nozzle-tip height above the programmed XYZ; it
must place the nozzle above the stock. The CLI adds `tool.nozzleId` and binds
that separate part to the same motion. Direct `play-cut` callers can provide
that ID explicitly; the beam uses `tool.id`.

Coordinates are absolute in the XY stock plane, Z up. The tool's tip is at the
specified XYZ. Router moves sweep a vertical flat-ended cylindrical cutter;
Z=2 in 4-mm stock leaves a 2-mm floor, and Z at/below the stock bottom cuts
through. Linear ramps and repeated depth passes are supported. `rapid` never
removes material. Tabs are retained by explicitly leaving stock at their positions.
For laser previews use `kind:"laser"`, set `diameterMm` to the kerf width, and
keep cut moves at a constant Z at/below the stock bottom. Rapid moves are laser-off.
Discretize arcs into linear segments upstream at the desired path tolerance.

The CLI returns a `playbackFile`. Replay with the shared `canvas` motion action
`play-cut` and `solutionFile` pointing to that workspace file. Pause, resume,
seek (`seconds`), stop and reset use the same API as mechanism/fold playback.
The plan is pinned to the generated scene's revision; stale plans fail before
changing the current animation. Seeking recomputes removal deterministically;
reset restores the original uncut stock. The CAD source and disk mesh cache stay
unchanged during playback.

This is an explicit-path **visual preview**, not a CAM planner, G-code interpreter,
collision checker, manufacturing approval or gravity simulation. It supports
rectangular planar stock, vertical flat cutters and through laser kerfs—not
ball tools, undercuts or multi-axis machining. Removal samples stock column
centres. Planar cuts share boundary vertices fitted to the swept cutter outline,
so curved ends and diagonal edges do not render as square stair steps. Depth
ramps and ambiguous sub-grid intersections retain column boundaries; this is
still an approximation, not an exact CAD boolean. Requested resolution must be <= one third of cutter/kerf width and
within 40,000 cells. The result reports actual cell size and half-cell diagonal
as the raster boundary approximation. Fine kerfs on large sheets may exceed the
budget; crop the stock or use a focused job rather than silently hiding a kerf.
The source part remains separate; this preview does not export a modified BREP.
