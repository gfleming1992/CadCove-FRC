# Primary worked example: Amarillo + REBUILT

This is the detailed team robot/field already used by the demo. The small
`training-robot` remains a fast, independently authored contract test. Neither
is a universal robot configuration.

`example.json` keeps robot and field identities independent. `components.json`
records the actual component families and uncertainties. The existing
`robot.sim.json` and chosen practice/accuracy profiles supply executable bindings.
The generic CAD core and runtime do not import these manifests or team constants.

The Team Robot edition packages this local content pack with the extension.
The current local conversion pack contains 109 editable brepjs part designs
(178 occurrences). Its remaining 23 custom designs, 22 unclassified designs,
and vendor/standard components retain their original STEP geometry. Open
`cad-assets/robot/model.js`; `parametric/parts/` contains the editable builders,
and `PARAMETRIC-README.md` plus `parametric/migration.json` describe the exact
conversion and retention decisions. Instance IDs, placements and colors are
preserved. Geometry edits still require reviewing the corresponding simulation
bindings; converting a part does not automatically recalibrate its mechanism.

Run **CadCove: Play Team Robot Example** to create a new workspace and launch live
practice. The pack includes the platform JAR/libraries and referenced collision
caches; only the WPILib JDK must already be installed. Controller port 1 is
the team driver; operator uses port 0. The view has no controls. Map physical
controllers in WPILib Sim GUI and enable Teleoperated there; see
[Driver Station setup](../../docs/DRIVER-STATION.md). The generic source/runtime can still be
built without the pack using the explicit training example for contract tests.

The large CAD, team's robot program, vendor binaries and FIRST field remain a
separate local content pack. Public redistribution is not yet cleared. FIRST
explicitly asks that its posted content not be re-hosted; obtain source assets
from its official links. Preserve upstream attribution and team ownership.

Create a portable local snapshot from a reviewed profile, with explicit asset
root (needed by older demo profiles whose collider paths were repository-relative):

```sh
bun scripts/export-example-workspace.js --project /path/to/robot.sim.json --asset-root /path/to/source/workspace --output /path/to/new-example --bridge-source /path/to/source/workspace/bridge --component-catalog examples/team3310-rebuilt/components.json
```

This copies source CAD/component files, compiled world/bindings and their collision
dependencies, selected robot source files, the selected JAR and desktop native
libraries. It excludes live sessions, tokens, logs, git history and unrelated build
outputs. The result is for the current machine platform, not a public release.
The optional component catalog is copied into the workspace and selected in
`.cadcove/frc.json`; other robots should supply their own catalog or omit it.
It never rebuilds or executes copied robot code. Runtime provenance records the
copied bytes. Run `cadcove doctor`, open the simulation and commission before use.

To replace the robot, supply its independent CAD and explicit mechanism/device
bindings, actual program and calibration. To replace the field, supply its CAD,
collision geometry, frame-aligned tag layout, season knowledge and observer.
Recompile world/scene hashes in either case. The old team-specific compiler cannot
infer an arbitrary replacement robot. The agent skills guide this integration.

Never reuse the demo's shooter calibration, estimated sleeve/friction values,
CAN mappings or camera assumptions as validated data for a different robot.

### Intake alignment regression

The updated local content pack restores the original intake joint anchors,
collider positions and 110 occurrence bindings after an experimental 50.8 mm
extension offset was applied twice. Four explicit shaft-point `axisChecks` now
travel with its scene bindings. Project audit and content packaging reject a
roller visual that would orbit its revolute axis. Validate rotating geometry as
well as pickup/scoring counters. The corrected workspace's dynamic check found
less than 0.023 mm radial error while spinning; this is simulation evidence,
not hardware calibration. Public source includes the generic check and synthetic
regression test; the team CAD/field content remains a separate asset pack.
