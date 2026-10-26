# Motor and sensor integration

The robot program owns control requests. CadCove exchanges physical state with
that program's simulated devices; it does not replace its subsystem logic, PID
controllers, CTRE firmware model, or autonomous code. The bridge is Java source
compiled against the team's WPILib/vendor SDK. No API key is involved.

## Current capability boundary

| Device/interface | Included behavior | Team qualification needed |
| --- | --- | --- |
| Phoenix 6 TalonFX | Voltage/current sampling, supply voltage, rotor turns and turns/sec feedback, configured coast/brake, applied-request diagnostics | Physical motor model, gear ratio, electrical constants, orientation, current limits and loaded response |
| Other motor controller families | `MotorAdapter` extension point wrapping an existing device instance | Implement its desktop simulation SDK calls; validate voltage, rotor feedback, neutral mode and failure behavior |
| Phoenix 6 CANcoder | Angular joint feedback or explicit turns per native joint unit, raw offset and inversion | Mount/gear ratio, sign, zero reference; configured SDK offsets must not double-apply physical offsets |
| Phoenix 6 Pigeon2 | One explicit body binding, world Z-up yaw and Z angular rate | Level mount; roll/pitch, arbitrary mounts, multiple IMUs, drift and acceleration are not currently modeled |
| Limelight NetworkTables | Synthetic MT1/MT2-shaped observations, pose/tag metadata, frame rate, delayed timestamps, noise, visibility/FOV/occlusion, heading and tag filters | Field layout, camera mounts/optics/latency/noise and the team's parser/estimator; this is not the proprietary MegaTag algorithm |
| Other sensors and non-Java robot code | No built-in general adapter yet | Add and test a bridge integration; do not treat absent feedback as zero or claim qualification |

The installed SDK used for the contract tests provides TalonFX simulation motor
models `KrakenX60` and `KrakenX44`. The bridge validates the requested `model`
against the team's actual SDK enum and rejects unsupported values. A missing
model retains the legacy `KrakenX60` default; author `model` explicitly in new
worlds. Never relabel a Falcon/TalonFXS/other device as a Kraken to bypass this.
The native world's electrical constants remain separately authored physical
inputs; selecting an SDK enum does not populate or calibrate them.

## Register actual robot objects

Export using `cadcove bridge-export --workspace .`, then apply
`.cadcove/bridge/instantcad.gradle` from the team's Gradle build. Read this guide
in `.cadcove/bridge/DEVICE-ADAPTERS.md`. Export refuses to overwrite customized
files. For an upgrade, run `cadcove bridge-export --workspace . --review`.
It writes the current packaged sources to `.cadcove/bridge-updates/<hash>/` and
returns per-file `missing`, `identical`, or `different` statuses and hashes.
Compare/merge the relevant incoming files into `.cadcove/bridge`, preserve team
customizations and extra local adapters, then rebuild the actual robot JAR and
run device/integration tests. Review copies are not added to Gradle source sets.
A `different` status does not distinguish an older upstream file from a team
edit: read the difference before merging. Repeating a review reuses the same
incoming version; locally edited review copies are preserved and reported as a
conflict. They can be moved aside before requesting a clean review copy.

At device construction, before `TwinBridge.start()` in simulation initialization:

```java
TwinBridge.registerMotor(leftDriveTalon, "drive/left", false);
// Revolute native coordinate in radians; physical offset in sensor turns.
TwinBridge.registerEncoder(steerEncoder, "steer/left", 0.125, false);
// Example linear encoder: 5 sensor turns per metre of native travel.
TwinBridge.registerEncoder(liftEncoder, "lift/axis", 5.0, 0.0, false);
TwinBridge.registerGyro(pigeon, "chassis");
```

Registration is inactive on hardware or without `INSTANTCAD_SIM=1`. IDs must
match the authored world, not necessarily CAN numbers. Duplicate motor IDs or
endpoints, repeated built-in sensor devices, late registration, missing world
bindings, and invalid conversion values fail clearly. The angular convenience
overload rejects non-revolute joints; supply explicit turns per unit for them.
Multiple different encoders may observe the same joint.

Encoder conversion is `sign * (position * turnsPerUnit - offsetTurns)` and
`sign * velocity * turnsPerUnit`. Native revolute units are radians and radians
per second; prismatic units are metres and metres per second. Phoenix receives
turns and turns per second. Motor native `rotor_per_unit` uses rotor radians per
joint unit; the native engine produces the rotor turns sent to controllers.
Keep these two ratio conventions distinct.

## Add another motor family without changing bridge internals

Implement `org.instantcad.frc.MotorAdapter` in the team's source and register it
with `TwinBridge.registerMotor(adapter, "physical/motor-id")`:

- `endpoint()` returns a stable, globally distinct vendor/family/bus/device ID.
- `description()` returns JSON-serializable device metadata, no secrets.
- `configure(physicalMotor)` validates the selected hardware model and applies
  its simulation orientation. The supplied JSON is an owned copy of world data.
- `sample(supplyVoltage)` sets the simulated supply and returns requested volts,
  nonnegative supply current in amperes, and whether the disabled shaft coasts.
- `feedback(Feedback)` sends native rotor turns and turns/sec to the SDK.
- `appliedControl()` optionally describes host-side requests for diagnosis.

Keep calls bounded and nonblocking: sampling/feedback run once per physics step.
Diagnostics can run concurrently; synchronize adapter-owned mutable data if
necessary. Robot code may also update its controller asynchronously. Throw on
invalid SDK state or missing feedback; do not silently select another model.
NaN/infinite output and negative current are rejected by the typed boundary.
The bridge suppresses robot voltage while disabled and disables/halt steps on
adapter errors. Field machinery is separately powered. The current battery sag
model is provisional (12.6 V, 20 mΩ); calibrate it before battery qualification.
Coast/brake in the included Talon adapter is read at startup; runtime neutral-mode
changes require adapter support. Applied-control diagnostics are asynchronous
host requests, not atomic physics snapshots or firmware acknowledgements.

`tests/MotorAdapterTest.java` contains a minimal independent controller with a
native prismatic closed loop. `tests/MotorBridgeTest.java` additionally exercises
the real scheduler, authenticated controls, voltage gating, feedback and failure
handling. Use these as contract examples, not a substitute for the real SDK.

## Vision configuration for another robot or season

`world.vision` declares cameras by unique NetworkTables name and physical body.
Each supplies `position` in metres and `rotationDegrees` (roll/pitch/yaw), plus
optics/rate/latency/noise parameters. `world.field_tags.tags` supplies official
IDs, `position`, `referencePosition`, and normalized `[x,y,z,w]` quaternions.
Validate these against the imported field's frame and official season layout.
Do not infer sensor IDs from CAD labels. `vision.seed` is an optional signed
64-bit integer (default 0); author it for reproducible experiments. Numeric
values must be JSON numbers. The simulator publishes only visible observations;
it does not feed exact unobserved ground truth to the robot's estimator.

Check the actual LimelightHelpers version the team uses. The supplied vision
test imports `frc.lib.limelight.LimelightHelpers`; adjust that test import for
another package, without renaming the student's implementation. Full image
processing, reflective targets and every firmware topic are not implemented.

## Verification commands

```sh
bun tests/device-adapters.js --classpath /path/to/team-robot-with-dependencies.jar \
  --native-binary /path/to/instantcad-sim \
  --native-libraries /path/to/team-desktop-jni --jdk /path/to/wpilib/jdk
bun tests/run-sim-vision.js /path/to/integrated/robot.sim.json
```

The first command compiles the full shipped bridge against that dependency set.
Without `--native-libraries`, it only runs the custom native closed loop and
numeric contracts; it explicitly reports the SDK and live-bridge tests skipped.
The second uses the selected project's JDK/JAR/JNI and compiles the current
vision source first, so an old copy in a robot JAR cannot mask a regression.

On macOS arm64 these tests passed with the integrated robot dependencies
(WPILib/GradleRIO 2026.2.1 and Phoenix 6 26.1.3). They do
not establish Windows/Linux compatibility, accurate hardware behavior, support
for all CTRE devices, or another complete robot's integration. Record measured
calibration evidence in the project's ledger and qualify disabled behavior,
mechanism limits, sensor directions, trajectories and estimator error before
using detailed simulation for sign-off.


The Pigeon simulation raw yaw starts at zero at world load and accumulates
physical yaw changes, including crossings of ±180°. The robot owns firmware
`setYaw` offsets. `TwinBridge.initialPose()` supplies the initial field pose from
the loaded body's quaternion for seeding odometry. A robot spawned facing 180°
can therefore call `setYaw(180)` once without adding the physical initial heading
a second time. This fixes mirrored field-relative control; it does not reset the
robot's heading on every physics tick. Bridge state reports `gyroReference` as
`boot-relative`. Agent-controlled station selection uses
`INSTANTCAD_ALLIANCE_STATION` (Blue1–Blue3 or Red1–Red3, default Blue1); an external
Driver Station retains authority over its own alliance and station.
