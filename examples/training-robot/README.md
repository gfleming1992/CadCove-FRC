# Independent training robot

This original desktop-only example has a four-wheel differential drivetrain,
an elevator tray, five TalonFX/Kraken X60 motors, a CANcoder, a Pigeon2 and a
Limelight 3G camera model. Its Java robot
program controls real Phoenix simulation devices. The bridge supplies sensor
feedback from the native world; test scripts never teleport bodies to complete
the course. No team robot code, STEP assets or field downloads are included.

The separate `example.training-zone` season provider counts the chassis crossing
the yellow line during a 15-second driving exercise. This is a teaching game,
not an official FRC season or hardware qualification. Source dimensions are in
`cad/design.js`; browser CAD is millimetres and native physics is SI. Masses,
friction and ratios are example estimates. Motor electrical constants are derived
from WPILib's non-FOC Kraken X60 model and checked against the actual installed
`DCMotor.getKrakenX60(1)` at robot startup. The mast and bumper
are visual geometry attached to the base; simplified base/wheel/tray collision
shapes do not model all hardware, flex, wiring or bumper contact.

## Real vendor interfaces and explicit limits

- CTRE: official Phoenix 6 26.1.3 device classes and desktop native simulation,
  `VoltageOut` requests, configured 40 A stator limits, rotor feedback, CANcoder
  turns and Pigeon2 yaw. The gearbox ratios and example mechanism are team data.
- Limelight: the unchanged official [LimelightHelpers 1.14](https://github.com/LimelightVision/limelightlib-wpijava/tree/523dfe07e8ac6a0ae7de2f5b5054981b0ab25148)
  reads normal NetworkTables pose packets in `Robot.robotPeriodic()`. Its pinned
  source and MIT notice are under `vendor/limelight/`; the JAR carries the notice.
  The [LL3G sensor configuration](https://limelightvision.io/products/limelight-3g)
  is 80 × 56 degrees at 1280 × 800. Mount, 30 FPS, 40 ms processing delay and
  noise are declared assumptions in `cad/components.js`. The native scene gates
  tag visibility using field of view, range and occlusion. This does not run
  Limelight firmware, process camera images, or qualify MegaTag accuracy.
- Camera/AprilTag rectangles in CAD mark the reviewed mount and tag planes;
  they are schematic geometry, not manufacturer STEP models or printed tags.

The contract verifies the actual helper parses detected tags, a noisy pose and
the delayed timestamp. Tests separately verify Phoenix rotor/CANcoder feedback,
gyro yaw and controller timeout; merely displaying a sensor icon is insufficient.

## Start from an installed toolbox

Use the toolbox terminal to export a fresh workspace (parent folder must exist):

```sh
cadcove example-create --workspace /path/to/new-training-folder --example training-robot --phoenix-descriptor /path/to/official/Phoenix6.json
```

No CadCove source checkout, Bun or Rust is needed. The command exports CAD source,
prebuilt view meshes, physics bindings, Java source, season provider, bridge,
skills and instructions. Existing directories are refused. `example-provenance.json`
records the bundle/source hashes and supplied descriptor digest. The descriptor
argument is optional; if omitted, place the official Phoenix 6 **26.1.3** / 2026
descriptor in `vendordeps/Phoenix6.json` before building. Checking its identity and
version does not authenticate an arbitrary third-party descriptor.

Open the exported folder in VS Code/WPILib and use **CadCove: Open CAD Model**.
The installed exporter selects **`robot.sim.json`** for simulation. With the
WPILib 2026 JDK and Gradle 8.11, build the actual robot dependencies and JAR:

```sh
gradle --no-daemon jar extractReleaseNative
cadcove doctor --project robot.sim.json
```

Use the team's installed Gradle executable if `gradle` is not on PATH; set
`JAVA_HOME` to the WPILib JDK. Gradle resolves official dependencies from its
configured repositories or local cache. The exporter itself is offline and
ships no robot JAR, CTRE native libraries or JDK. Then use **CadCove: Start Robot
Simulation** and **CadCove: Open Live Simulation**, or run
`cadcove sim-run --project robot.sim.json`. Substitute this profile name for
`training-profile.json` in the engineering commands below.

## Build from the toolbox source checkout

Prerequisites for this engineering example: installed source dependencies, Bun,
the WPILib 2026 JDK, Gradle 8.11, the official Phoenix 6 **26.1.3** vendordep
descriptor, and a built host runtime package. Robot dependencies are resolved
by Gradle from WPILib/CTRE repositories (or the team's existing dependency cache).
They are not copied from another robot's executable. End users running the
packaged runtime do not need a Rust compiler.

For the complete repeatable build-and-test flow, supply explicit local paths:

```sh
bun scripts/verify-training-example.js --output /path/to/new-training-workspace --runtime /path/to/packaged-runtime --gradle /path/to/gradle --phoenix-descriptor /path/to/Phoenix6.json --jdk /path/to/wpilib/2026/jdk
```

The runner uses the descriptor's repository declarations to resolve vendor
dependencies, so use the official installed descriptor. It checks the expected
vendor identity/version and records its digest. It does not authenticate an
arbitrary descriptor supplied by a third party. The output workspace must not
already exist. To perform the steps individually:

```sh
bun scripts/build-training-example.js --output /path/to/new-training-workspace
cadcove init --workspace /path/to/new-training-workspace --id training-robot
cadcove bridge-export --workspace /path/to/new-training-workspace
```

Use `artifacts/runtime-<candidate>/cadcove` if it is not yet on PATH. In the new
workspace, place the official installed Phoenix descriptor in
`vendordeps/Phoenix6.json`, then run the installed Gradle with the WPILib JDK:

```sh
gradle --no-daemon jar extractReleaseNative
cadcove audit --project training-profile.json
cadcove sim-run --project training-profile.json
```

Select `training-profile.json` as `simulationProject` in `.cadcove/project.json`
to open it with **CadCove: Open Live Simulation**. The CAD model entry remains
`cad/model.js`; orbit/pan/zoom uses the shared viewer. The example has no roboRIO
deployment target and rejects real-hardware execution. Its NetworkTables is
local-only; vendor background service isolation is not implied.

## Drive and inspect

Xbox port 0: left Y drives, right X turns, Y raises the lift and A lowers it.
Through `cadcove sim-controls`, send standard Xbox axis/button packets in teleop;
renew packets at least several times per second. An expired input lease disables
motor output. Use `sim-state`, `sim-devices`, `sim-motor-controls`, `sim-objects`,
and the live panel's `sim-capture` for agent feedback.

The full contract runner starts its own packaged-CLI session, drives over the
line, raises/lowers the lift with sensor checks, turns, verifies input timeout,
finishes the 15-second season and tears down the owned session:

```sh
bun tests/training-robot.js --project /path/to/new-training-workspace/training-profile.json --runtime /path/to/packaged-runtime
```

Evidence is written to `build/cadcove/qualification/` in the example workspace.
Never treat this fixture's passing results as evidence for an unknown real
robot. After CAD changes, regenerate the authored world/bindings and re-run the
checks; the source-checkout builder intentionally rejects an existing output
directory. The installed exporter supplies a fixed starting snapshot, not a
generic CAD-to-physics compiler. Agents adapting it must update dimensions,
colliders/joints/devices and revision hashes together using the exported sources
and bridge contract. Re-exporting to the same folder is not an update mechanism.
