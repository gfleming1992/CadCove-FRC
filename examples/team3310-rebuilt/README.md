# Team 3310 Amarillo on REBUILT

This is CadCove-FRC's main runnable example: the team's robot, the 2026 field,
actual Java/WPILib/Phoenix controls and the corrected intake/cargo gameplay model.
The robot CAD and code are included in `source/`; FIRST field geometry and SDK
binaries are obtained locally during setup. The small `training-robot` remains a
fast independent contract test, not a substitute for this full example.

## Fresh-clone setup

Install Bun 1.4.2, WPILib 2026 (including its JDK), and the pinned Python 3.12 /
CadQuery environment from [native authoring](../../agent-skills/references/native-cadquery.md).
Set `CADCOVE_PYTHON` for CLI work and `instantcad.pythonPath` in VS Code to that
interpreter. Install a locally built CadCove extension as described in the root
README. From the monorepo root:

```sh
bun install --frozen-lockfile
bun run example:team --output ../Amarillo-REBUILT
```

Setup performs these steps:

1. Copy the included CAD source, robot program and reviewed simulation bindings.
2. Download the pinned official REBUILT STEP from FIRST (35.7 MB), verifying its
   size and SHA-256. Later runs reuse the verified download.
3. Rebuild the 6,186 field occurrences, surface colors and collision buffers with
   the pinned OCCT-WASM kernel. The first run takes several minutes.
4. Audit CAD identities, intake axes, collision hashes and world/view consistency.
5. Resolve WPILib/CTRE dependencies through Gradle and compile `robot.jar` plus
   desktop native libraries for the current machine. No Mac libraries are copied
   into Windows/Linux examples. No robot program is executed during setup.
6. Create the Codex, Claude and Copilot guidance and a configured CAD workspace.

Open the output folder in VS Code/WPILib. Run **CadCove: Open Robot CAD** or
**CadCove: Open Live Simulation**. Map plugged-in controllers in WPILib Sim GUI:
driver port **1**, operator port **0**, Xbox mapping; enable **Teleoperated**.
See [Driver Station setup](../../docs/DRIVER-STATION.md).

The output directory must be new; setup never overwrites student work. To use a
previous official download, add `--field-step /path/to/field.step`. A different
field revision is rejected because occurrence bindings must be reviewed together.
To prepare CAD and simulation artifacts without Java, add `--skip-robot-build`.
Before playing that workspace, run in its `robot-code` directory (with the WPILib
JDK as `JAVA_HOME`):

```sh
./gradlew --no-daemon jar extractReleaseNative
# Windows: .\gradlew.bat --no-daemon jar extractReleaseNative
```

`example-setup.json` records download/world hashes, platform and build status.
The example team number is zero for simulation; configure deployment separately
only for a robot you own. Calibration remains provisional. Passing artifact
validation does not establish hardware fidelity.

## Editable source and test scope

`source/cad-assets/robot/models.py` is the default assembly entry. It rebuilds
all 109 authored designs in native Python/CadQuery (178 occurrences) and combines
them with retained vendor, unclassified and intentionally unconverted custom
STEP components. All 1,958 occurrence IDs, transforms and colors remain stable.
Edit `native/parts/p_*.py` and their helpers; `native/migration.json` maps asset
IDs to Python modules. See [the robot authoring guide](source/cad-assets/robot/native/README.md).
Executable legacy CAD sources have been removed. Historical shape measurements
are retained under `native/evidence`.

Use `cadcove cad-session` for warm build/inspect/export iterations. Open Python
or STEP files through VS Code's **Open in CAD Canvas** command and request
focused captures with `cadcove cad-capture`. Exact geometry checks and captures
provide the agent feedback; the viewer remains an interactive WebGPU canvas.
Prototype caches reuse unchanged parts across edits. The browser does not start
Python or rebuild authored CAD; native OCCT produces its view meshes.

`source/robot-code` contains the actual team program with its simulation bridge.
Vendor dependency descriptors and Gradle resolve upstream libraries. Source CAD
edits require corresponding physics-binding review: the shipped collision
snapshot is the reviewed baseline, not automatic arbitrary CAD-to-physics inference.
The four shaft axis checks preserve the repaired intake alignment.

The included world is the demonstrated **gameplay** profile. Its reduced-order
intake/feed, conservative eight-slot cargo storage and powered hub passage
approximations are explicit in `robot.sim.json`. Do not call it a detailed-mode
qualification. The generic runtime still supports independently authored detailed
profiles; hardware mass/friction/shooter calibration remains required.

For a local Team Robot edition, pass the completed workspace to
`scripts/package-runtime.js --team-example WORKSPACE` alongside that command's
normal arguments. Its pack includes locally obtained field/vendor assets and is
not automatically cleared for public binary redistribution.

## Attribution and distribution

Publication of the team's CAD and robot code was authorized by the project owner.
Original team/CadCove contributions in this example use the repository MIT license.
Existing third-party notices and ownership remain intact: vendor component designs,
WPILib, AdvantageKit, Limelight and SDK dependencies are not relicensed by CadCove.
See [example notices](THIRD-PARTY-NOTICES.md).

FIRST requests that its posted content remain on its own servers. `field-source.json`
contains the official URL, checksum, occurrence identifiers and our collision
rebuild recipe; the actual field STEP, extracted geometry and meshes are excluded
from Git. Setup obtains them directly from [FIRST's official field page](https://www.firstinspires.org/resources/library/frc/playing-field).
No game manual or local API credentials are included.

## Integration smoke test

After building the native engine (`bun scripts/build-native-runtime.js`):

```sh
# Select target/distribution/release/instantcad-sim via INSTANTCAD_SIM_BINARY
# if your source checkout has no target/release build; append .exe on Windows.
bun scripts/verify-team-example.js ../Amarillo-REBUILT/robot.sim.json
```

This launches the real team robot with agent-owned input in a temporary test
profile, drives briefly, verifies physical displacement and shuts it down. It
leaves the main Driver Station profile unchanged. It is a functional integration
check, not a full-match regression or hardware calibration.

On macOS arm64, the source setup rebuilt all 6,186 field occurrences and 431
prototypes; all 283 referenced field collider hashes matched the reviewed local
example. Native loading accepted 517 bodies, 59 joints and 25 motors. The actual
rebuilt robot/CTRE smoke test advanced 456 physics ticks and drove 1.43 m. Portable
source tests passed. Windows/Linux execution of this large example is not yet
qualified by those results.
