# CAD authoring in the installed toolbox

Read `.cadcove/project.json` for this workspace's `sourceDirectory`,
`buildDirectory` and `entryPoint`. Work in that source directory, not a hard-coded
`cad/` folder. The user's own coding agent writes files; the toolbox does not
need an AI API key. Open **CadCove: Open CAD Model** in VS Code to build and view the
entry. Java, CTRE libraries and a simulation JAR are needed for robot simulation,
not for authoring/viewing CAD.

## Small first build

For a new, empty entry, a mounting plate is a useful build check. Do not replace
an existing model to perform this check. Dimensions are millimetres, Z is up.

```javascript
import { box } from 'brepjs';

export default function build() {
  return [{
    id: 'mounting-plate',
    name: 'Mounting plate',
    color: '#cf8355',
    shape: box(80, 40, 6, { centered: true }),
  }];
}
```

The default export is a synchronous or asynchronous build function. Return a
shape or an array of `{id, name, color, shape}` parts. Use stable, unique IDs and
explicit `#RRGGBB` colors. Use relative JavaScript module imports to separate
reusable components from assembly placements. Bare `brepjs` imports resolve in
the CAD worker; the robot workspace does not need its own npm install. Do not
retain OCCT-WASM shape handles across rebuilds.

## Fast component edits in large assemblies

The build context provides `cache.part(spec, async () => placedShape)`. Return
these parts directly in the assembly array. Use stable `id`, `name`, `color`,
`dependencies` (project-root JavaScript paths) and JSON `inputs` containing every
dimension, placement, asset SHA-256 and repair setting used by the factory.
Declared modules include their transitive imports. For a registry selecting a
separately declared builder, add `{path:'parametric/registry.js',transitive:false}`
to dependencies. Asset-only factories can use `dependencies:[]`.

Factories must be deterministic, have no side effects, and return a placed
brepjs shape. Declare closure inputs explicitly; do not hide geometry changes
in mutable globals or random/time values. Only changed components are built,
validated and tessellated; unchanged meshes and GPU batches are reused. Rotation,
pan and zoom remain at the student's live camera position during a hot swap.
Root assembly source edits conservatively invalidate all its components.

Read `timings.components` (hits/misses/retained bytes) and `timings.client` in
the CAD feedback for measured behavior. The component mesh cache is bounded
and prunes removed/old entries. Disk snapshots preserve the keys across reopening.
Exact BREP inspection/export may reconstruct unchanged shapes lazily. Never
assume a cached display means all exact shapes are resident or physics is fresh.

## Find the real API before using it

Search `brepjs-api.md` alongside this file for signatures, overloads and upstream
comments. It is generated from the exact pinned version, including the full
declaration tree. Start from the root public exports (`dist/index.d.ts`); a symbol
in an internal module is not automatically importable. Check whether an operation
returns a shape or a `Result` and handle errors, using `unwrap` where appropriate.
Do not invent CadQuery Python methods or limit designs to boxes because an API is
unfamiliar. Sketches, curves, sweeps, lofts and booleans need their actual brepjs
signatures and a successful build before relying on the result.

## Close the feedback loop

After saving source with the CAD viewer open:

```sh
cadcove cad-status --workspace .
cadcove cad-preview --workspace .
```

These commands read viewer feedback; they do not start a headless CAD build.
Check the reported source freshness, errors and revision before using the preview.
The viewer may retain the last successful scene when the current source fails.
Read the image file reported by `cad-preview` with the agent's image tool. Inspect
the edited part and its clearance to neighbours, repair errors, then check again.
Do not assume old captures prove new geometry is valid. Never edit generated
mesh/cache/status files to manufacture a successful build.

## From CAD to a robot

Use the team's real vendor STEP assets and BOM. A generic geometric plate is not
a qualified structural design. Follow the CAD/mechanisms skill for fits, bearings,
service access, transmissions, collision geometry and uncertainty. Read the
season-rules skill for rule-sensitive dimensions, citing the selected manual's
revision/rule/page. CAD-only work can finish with a verified viewer build; moving
to simulation additionally requires explicit physics bindings, calibrated device
adapters, and the team's compiled robot program as described in `.cadcove/AGENT.md`.
