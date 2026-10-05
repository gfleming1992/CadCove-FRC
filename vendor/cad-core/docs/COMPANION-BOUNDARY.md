# Optional companion boundary

Status: architectural proposal for discussion. The CAD baseline is commit
`0c8dfed`, tagged `core-baseline-2026-09-29`. FRC integration is maintained in
the separate `instantcad-frc` repository, not in this application's dependency tree.

## Ownership

The generic application owns CAD execution, component identity and placement,
geometry validation, tessellation, colors, rendering, camera controls, source
snapshots, caches, and browser / VS Code host adapters.

The optional FRC companion owns WPILib and vendor adapters, device bindings,
physical parameters, collision cooking, simulation scheduling, controller input,
season assets and rules, scenarios, and simulation telemetry. Its native runner
and robot process are separate from the CAD worker and rendering loop.

Dependencies point from companion to core. Core must install, build and run
without the companion, robot toolchains, physics libraries, or season assets.
No sport-specific fields or branches belong in generic source/cache formats.

## Proposed integration contract

Expose versioned capabilities for immutable scene snapshots, stable component
IDs, transient placement updates, selection, camera control and image capture.
External placement updates must not rewrite authored CAD or invalidate its mesh
cache. Physical descriptions reference component IDs and the CAD source revision;
stale or missing bindings require reconciliation before simulation starts.

The existing optional `AssemblyViewer` module is a generic rendering primitive,
not a complete extension API. It shares meshes across occurrences and updates
instance transforms without retessellation. It contains no FRC dependencies and
is not imported by the ordinary website entry point.

### Independent assembly captures

`AssemblyViewer.captureView({ids, transforms, view, camera, width, height})`
renders one offscreen PNG using the existing GPU device, assembly pipeline and
geometry buffers. Optional stable instance IDs select the visible components;
optional placement overrides represent a caller's immutable snapshot. Neither
changes the live assembly, camera, viewport or frame scheduler. Only temporary
uniform/placement buffers and render/readback targets are allocated, and they
are destroyed after capture. One capture per viewer may be in flight.

Without an explicit camera, the view fits the selected transformed bounds.
Standard world-aligned views are `front` (from −Y), `right` (from +X), `top`
(near +Z) and `iso`. Returned metadata includes camera, bounds, selected IDs and
pixel dimensions alongside the PNG data URL. Dimensions are bounded to
1–2048 pixels per axis. PNG readback accounts for BGRA/RGBA canvas formats and
256-byte row alignment. No CAD worker, OCCT instance, or physics dependency is
created by a capture. The caller adds any domain-specific revision/tick identity.

`bun run test:assembly-capture` uses Chrome/Metal WebGPU to verify pixel equality
with the visible renderer, selected-instance drawing, non-aligned image widths,
unchanged live camera/placements/frame count, and a placement update while the
snapshot is in flight. This optional capability is additive to assembly API v1;
distributed companions must still negotiate capabilities when packaging is added.

A future companion extension consumes an explicit versioned API exported by the
CAD extension. It must not reach into private webview globals or import files via
sibling-repository paths as its distribution mechanism. During development a
workspace link can resolve the generic package; releases pin compatible versions.

## Proposed project layout

```text
project/
  cad/model.js
  cad/parts/
  src/main/java/            # robot project only
  sim/robot.physics.json
  sim/bindings.json
  sim/scenarios/
  build/cad/               # generic, disposable CAD outputs
  build/sim/               # companion, disposable physics outputs
  build/sim-runs/          # companion traces and captures
```

Source and build locations remain configurable. The browser continues to use
its folder authority and IndexedDB cache; VS Code uses its trusted filesystem
adapter. Removing the companion must leave CAD sources usable in either host.

## Acceptance criteria before calling the integration complete

- Generic browser and editor builds/tests pass without FRC dependencies.
- Companion handles unsupported API versions and missing core capabilities.
- Simulation can stop or fail while CAD remains viewable and editable.
- Simulation transforms do not mutate saved CAD placements or geometry caches.
- CAD revision changes cannot silently reuse stale physical bindings.
- Installing only the generic app adds no robot or physics startup/download cost.

The public extension API, simulation lifecycle and final companion packaging
remain proposals until agreed and implemented; repository separation alone does
not establish these guarantees.

## Checkpoint verification (2026-09-29)

Ten unit tests pass; website and VS Code builds pass. The separate companion's
WebGPU inspection test renders 1,958 robot occurrences and 6,186 field occurrences,
and verifies a placement update changes the rendered image without page errors.
The generic browser suite reaches its offline reload/build step but fails with
`Reconnect this project folder before building.` Folder reconnection coverage
needs investigation; this checkpoint is not a claim that all browser tests pass.
# Embedding the editor host

`extensions/vscode/src/extension.js` exports `activate(context, options)`.
All options are optional; the standalone CAD extension retains its defaults.
An embedding product may supply `commandPrefix`, `viewType`, `outputName`,
`minimalUI`, and an async `projectSettings(workspaceRoot)` function returning
`{sourceDirectory, buildDirectory, entryPoint}`. The usual local-path checks
apply to those settings. `minimalUI` hides the authoring toolbar while retaining
pan/orbit/zoom, keyboard fit, automatic rebuilds and disk feedback. Configuration
is resolved when a model opens; close/reopen after changing folder locations.
The generic host contains no robot, vendor SDK, physics, or agent-provider logic.
