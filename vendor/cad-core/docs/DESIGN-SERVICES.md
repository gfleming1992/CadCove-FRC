# Experimental agent design services

These services complement CadQuery geometry and Ondsel assembly motion. They
require no FreeCAD GUI. They are not a general FreeCAD document importer.

## Sketch constraints

`sketch_solver.solve(request)` uses FreeCAD's PlaneGCS through the independent
`planegcs==0.9.6` Python wrapper. Install that optional dependency explicitly in
the chosen Python environment. Linux/Windows wheels are provided upstream;
Apple Silicon was tested with a local C++ build requiring Eigen and Boost. That
does not qualify other platforms. The package is LGPL-2.1-or-later, maintained
separately at https://github.com/spookylukey/planegcs. We do not bundle its source
or binary, change its license, or modify the solver. Revisit source, notices and
replacement obligations before redistributing a wheel. No network install is
performed by a CAD command.

Agent CLI: `cadcove cad-sketch --action solve --input sketch.json --output result.json
--python /path/to/python`. Output paths must be new. Input errors are structured;
unsolved requests return `ok:false` and diagnostics without publishing geometry.
Capabilities can be queried without loading the optional library.

```json
{
  "schema":1,"units":"mm",
  "points":[{"id":"a","x":0,"y":0},{"id":"b","x":40,"y":0}],
  "lines":[{"id":"centers","a":"a","b":"b"}],
  "circles":[{"id":"bearing","center":"b","radius":5}],
  "constraints":[
    {"id":"origin","type":"fix","point":"a","x":0,"y":0},
    {"id":"alignment","type":"horizontal","line":"centers"},
    {"id":"spacing","type":"distance","a":"a","b":"b","value":40},
    {"id":"bore","type":"radius","circle":"bearing","value":5}
  ]
}
```

Constraint types currently exposed: fix, x, y, distance, coincident, horizontal,
vertical, equalLength, radius, equalRadius, concentric. Unsupported constraints
are rejected; direct Python callers can use the upstream package for its broader
API. All IDs are unique. The result maps solved coordinates back to those names,
reports remaining degrees of freedom/conflicting IDs, and independently checks
residuals. Under-constrained sketches are rejected by default; explicit
`requireFullyConstrained:false` allows a nonunique solution and retains the DOF
diagnostic. The initial geometry selects a solution branch; a fully constrained
result is not proof that a nonlinear sketch has only one possible solution.

Feed the solved coordinates to ordinary CadQuery construction and
`ctx.component(..., inputs=...)`. Include the sketch input and dependent sources
in the component's declared dependencies. Existing geometry caches remain in
charge; solving is not a reason to discard unrelated component meshes.

## Checked named references

`cad_references.resolve(parts, reference)` returns a current OCCT face and evidence.
Use the same parts records as `cad-inspect`; occurrence transforms are already
applied. A supported reference is:

```json
{"id":"right-bearing","part":"plate","kind":"cylinder",
 "point":[40,0,2],"axis":[0,0,1],"radius":5}
```

The point is on the axis within the intended face's axial span, in CAD mm. This
matches exactly one cylindrical face using OCCT analytic surfaces, not a stored
face index. Its direction is authored. Missing, split/ambiguous or changed-radius
features fail clearly; no closest-face fallback changes a joint silently.
Each result includes the current exact shape hash. Joint/analysis consumers must
resolve against the current build, not reuse an old returned face or hash.
Recompute authored datum positions from the same sketch parameters when editing.
Imported STEP needs explicitly reviewed datums; this does not infer design intent.

CLI: `cadcove cad-references --workspace PATH --input references.json`, where the
file is an array. A warm `cad-session` also accepts
`{"op":"references","references":[...]}` after building. Outer session `ok`
means execution succeeded; inspect `result.ok` and per-reference status too.

This is a narrow semantic-anchor path, **not FreeCAD's topology-history mapping**.
That implementation depends on FreeCAD's shape/document history. Extracting it
or running the relevant FreeCAD App modules headlessly remains an evaluation.
STEP exchange usually cannot reconstruct that missing history.

## FEA intake

`cadcove cad-analysis --action prepare --input analysis.json --output review.json`
generates missing-information questions. It never runs or claims an FEA solve.
The first supported intake is linear static isotropic analysis in mm/N/MPa:

```json
{"schema":1,"analysis":"linearStatic","units":"mm-N-MPa",
 "parts":[{"id":"plate"}],"outputs":["displacement","stress"]}
```

Known properties may be supplied as `parts[].material` (name, source,
youngsModulusMPa, poissonRatio, optional yieldStrengthMPa), and `shapeHash` pins
geometry. Loads have id, part, reference, source and forceN [x,y,z]. Supports
have id, part, reference, source and restrainedTranslations [bool,bool,bool].
These references must later be resolved against the pinned CAD; intake alone
does not validate them. `assumptions` is an explicit list of descriptions.
Requesting safetyFactor additionally requires yield strength. Multi-part
connections remain a blocking question, not implicitly bonded contacts.

Use existing evidenced properties before asking the user. Ask about missing
material grade, load case, mounting restraints, and desired result, keeping
engineering assumptions visible. `inputComplete` only means fields are present;
`readyToSolve` remains false for intake alone. FEA does not replace robot contact
or motor dynamics; do not silently invent loads/materials.

## Optional headless static solve

`cad-analysis --action solve --workspace PATH --input REQUEST.json --output NEW_DIRECTORY`
connects current native CAD to an explicitly installed FreeCAD/Gmsh/CalculiX backend.
Set absolute executable paths using `--freecad`, `--gmsh`, `--ccx` or
`CADCOVE_FREECAD`, `CADCOVE_GMSH`, `CADCOVE_CCX`. These dependencies are not bundled
or automatically installed. Tested locally with FreeCAD 1.1.4 on macOS arm64;
other platforms/builds require qualification.

The solve request wraps the intake as `{analysis, references, mesh}`. `references`
is an array of checked native reference queries. Cylinder queries retain their
existing contract. Plane queries use `kind:"plane"`, `point` equal to the face
centroid and `axis` equal to its outward normal (no radius). Both reject missing
or ambiguous matches. `mesh` specifies two to four decreasing `sizesMm` and
an explicit `relativeTolerance` between zero and 0.2.

Only one valid solid, linear isotropic elasticity, fully fixed face supports,
and distributed face forces are supported. Geometry hashes are checked before
export; BREP bytes and boundary descriptors are independently checked in FreeCAD.
The backend uses isolated user/system preferences, generates second-order tetrahedral
meshes, runs CalculiX, and saves input decks, logs, nodal displacement/stress and
FreeCAD documents in the new evidence directory. Existing evidence is never replaced.
The source revision is recorded separately; a later CAD edit makes this a historical
analysis, not a result for the edited model.

`solved:true` reports successful numerical execution. `convergence.passed` compares
requested global extrema on the last two successively refined meshes. It is not
a local error estimator or engineering certification. Stress singularities at fixed
edges may not converge; report that rather than silently switching metrics.
`engineeringValidated` remains false. Review actual materials, restraint realism,
loads, deformation scale and local mesh adequacy before using results for design.
