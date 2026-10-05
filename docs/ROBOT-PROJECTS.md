# Reusable robot projects

## Product boundary

```text
Generic CAD extension / website
    ↑ optional assembly-view API
FRC companion: native physics, live practice, match observations
    ├── robot project: CAD + physical bindings + calibration ledger
    ├── runtime adapter: WPILib + vendor device simulation
    └── season package: field CAD, game pieces, rules/observations
```

The generic CAD app has no FRC dependency. Team-specific CAD interpretation stays in separate content/build tooling; it is
not the simulator's universal robot model.
The companion must never infer that an unknown robot shares that team's parts,
CAN numbers, shooter layout, axes or gear ratios.

## Implemented project boundary

`robot.sim.json` is a versioned local project file. All paths resolve relative to
that file, so source CAD and generated artifacts can live in different subfolders
of an ordinary WPILib workspace. The launcher and viewer take a project path:

```sh
cadcove audit --project /workspace/robot.sim.json
cadcove sim-validate --project /workspace/robot.sim.json
cadcove sim-run --project /workspace/robot.sim.json
```

Open **CadCove: Open Live Simulation** after the runtime reports ready. The CLI
requires an explicit project and does not select a team fixture. A project supplies robot/field asset directories, build directory,
runtime adapter, Java build locations and a calibration ledger. Build artifacts
are `world.json` and `scene-bindings.json`; the latter pins the former's exact
hash and both CAD revisions. These are still the existing native world/scene
formats, not a second physics language.

The audit rejects inconsistent revisions, duplicate IDs, unbound joints/motors,
missing motor ratios and missing/stale CAD occurrence bindings. It lists unknown
or estimated calibration categories. It is an artifact consistency check; the
native engine still validates its full input. A successful audit never certifies
physical fidelity. No measured/calibrated status is inferred from a successful
render or from a plausible-looking AI answer.

### Source freshness

Builders can record the source dependency closure in `scene-bindings.json`:

```json
{"sourceInputs":{"schema":1,"files":[{"file":"cad/model.js","sha256":"SHA256_OF_EXACT_SOURCE_BYTES"}]}}
```

Use actual 64-character SHA-256 digests. Paths are relative to `runtime.assetRoot`
when set, otherwise the profile directory. Include imported parts, CAD modules,
dimension/material/device configuration and every other input used to generate
the view/physics artifacts. Record the fingerprints from the bytes used during
the build, not by accepting whichever files happen to exist later. Regenerate
the affected artifacts and binding hashes together; updating fingerprints alone
does not make an old collider match new CAD.

`audit` and simulation startup check these files with streaming hashes. Missing,
changed, escaping or invalid input declarations fail the audit and prevent a new
simulation launch. The installed training example records its three CAD/design/
component modules; its geometry and native world derive from those modules.
The local content exporter preserves recorded inputs under its relocated asset
root. Its exported inputs may be in `physics-assets/`; consult their recorded
paths before editing rather than changing an unrelated copy.

The report's `sourceFreshness.status` is `verified`, `stale`, `untracked`, or
`unknown` when another validation error prevents checking. Older builds without
the declaration remain loadable as compiled snapshots and explicitly report
`untracked`; they do not gain a source-freshness guarantee. A builder that omits
a dependency cannot have that dependency checked automatically. This manifest
does not prove that an edited Java program was rebuilt into the selected JAR.
Run the real robot build after code edits. An already-running simulation remains
pinned to its loaded world/JAR; rebuild and restart to use edits.

### Small code integration surface

The supported implementation is currently desktop Java/WPILib + Phoenix 6
TalonFX, CANcoder and Pigeon2. Existing device instances are registered once:

```java
// Called where the team's motor is constructed; one integration point in a
// shared IO factory can handle many motors. Physical mount direction is reviewed.
TwinBridge.registerMotor(elevatorMotor, "elevator-left", false);
TwinBridge.registerEncoder(elevatorEncoder, "elevator-joint", encoderOffset, false);
TwinBridge.registerGyro(pigeon);
// Robot.simulationInit(), after all devices exist:
TwinBridge.start();
```

Registration is a no-op unless `INSTANTCAD_SIM=1` and WPILib is in simulation.
The same student control/PID/state-machine code runs, while the bridge exchanges
motor voltage and simulated position/velocity with native physics. Ratios and
inertial parameters live in physics data, rather than being repeated in every
team's Java wrapper. The legacy Team 3310 registration overload remains compatible.

Physical motor IDs are independent of CAN addresses. The registry distinguishes
network + device number and rejects duplicate endpoints. This avoids conflating
identical numbers on different buses; actual desktop Phoenix bus support/mapping
still needs qualification for each SDK/project (the current example uses `sim`).

Run `cadcove bridge-export --workspace PATH`, then apply the exported
`.cadcove/bridge/instantcad.gradle` in the team's Java Gradle project. This builds
the shipped bridge against the team's own WPILib/vendor dependencies. Existing internal
team simulation loops must be bypassed while this adapter owns physics, and
simulated hardware IO must be instantiated. Changes required depend on the team's
IO architecture; zero changes for arbitrary programs is not promised.

## Intended onboarding flow

STEP is the baseline generic input; an Onshape account or native assembly link
is not required. Native mates, when available, are additional evidence. A
generic inference pass should combine coaxial shafts/bores, bearing and rail
geometry, repeated components, gear/chain geometry and the robot configuration
to propose a mechanism graph with evidence and confidence. Geometry alone can
leave fixed-versus-revolute joints, travel limits, preload and motor-to-mechanism
wiring ambiguous. Preserve those uncertainties for focused review and persist
reviewed bindings beside the CAD. The current Team3310 adapter and axis/ratio
inspection scripts are not yet a complete generic inference engine.

1. Select the robot code workspace, CAD source folder and build/cache folder.
2. Import CAD into stable component/occurrence IDs and inventory vendor devices
   through the running simulation adapter and project configuration.
3. Suggest rigid groups, joints, drive modules, mechanisms and device bindings.
   Reuse reviewed mechanism templates where the hardware is known.
4. Resolve a short list of missing facts with the student or an IDE agent.
5. Run isolated direction/limit/sensor/contact checks before live practice.
6. Reuse the same compiled robot for practice, scripted tests and match runs.

| Input | Usually useful for | Still needs evidence/review |
|---|---|---|
| STEP geometry and assembly placements | Dimensions, component reuse, candidate axes | Which parts move together; missing mates; flexible parts |
| Student/vendor configuration | Device IDs, sensor types, configured ratios/offsets | Whether settings match actual hardware and physical frames |
| Recognized module/gearbox part numbers | Template candidates and nominal specifications | Installed variant, mounting direction, modifications |
| CAD volume plus material specification | Estimated mass and inertia | Omitted hardware, wiring, battery and actual material |
| AI interpretation | Proposals linking code, CAD and known mechanisms | Ambiguous joints, belt paths, backlash, friction and compliance |

AI should write reviewable project data and cite the CAD occurrence, source-code
setting, datasheet or measurement supporting each proposal. Unknown is a valid
state. It should not silently invent a ratio or treat every assembly as rigid.
Source changes invalidate relevant bindings/tests, not just the rendered cache.

### Acceptance contract for another team's robot

The target is one small simulation integration plus project data. The team's
editor agent discovers devices/configuration, proposes a binding file and
records unresolved facts beside the project. It can request focused CAD
captures and state queries. Review saves the binding and its evidence in the
workspace; the toolbox does not require another chat box or integration wizard.

- **Keep the real program:** commands, subsystem state machines, motor-controller
  settings, autonomous routines and controller mappings execute in the team's
  desktop simulation. Physics owns sensor feedback; another team simulation must
  not write the same devices concurrently.
- **Separate four inputs:** CAD geometry, physical mechanism bindings, robot
  runtime adapter and season field/rules. Changing teams should replace data and
  bindings; changing seasons should replace the field package. Neither requires
  adding FRC dependencies to the CAD core.
- **Ask concrete questions:** which motor drives which joint, whether two motors
  share a shaft, pulley/gear ratio, sign, zero pose, travel limits, missing mass,
  friction and sensor placement. Names and STEP geometry alone are insufficient.
  Present measured, derived, reviewed, estimated and unknown values distinctly.
- **AI is an authoring assistant:** it proposes bindings with source references
  and can run isolated tests. A proposal is not a measurement. A test must not
  certify the assumption it was configured to make.
- **Qualify each device family:** list detected, bound and unsupported controllers
  and sensors explicitly. Supporting all CTRE devices is a product target; the
  current adapter covers TalonFX, CANcoder and Pigeon2 only. Unsupported devices
  must never silently become generic motors.
- **One physical robot for every mode:** practice uses live controller input;
  automated checks use scripted input; match mode supplies the season schedule.
  All modes consume the same world, runtime and sensor bindings.

Current implementation includes the project boundary, extensible motor
registration, source/CLI integration guidance and category-level calibration
ledger. A reusable mechanism compiler and complete vendor-device matrix remain
to be built; agents explicitly author and validate physical bindings today.

### Time and qualification

The launcher defaults to `runtime.clock: "physics"`: completed native steps
advance WPILib's simulated FPGA clock and wait for its Notifiers. `/state.clock`
reports robot time, physics time and skew. This prevents wall-clock autonomous
timers from advancing past a stalled physical simulation. Optional `"wall"` is
retained for comparative diagnostics, not accepted by the match qualification.
Vendor background threads and hardware-specific simulation behavior still need
adapter qualification; synchronizing WPILib does not prove every vendor thread
uses that same clock.

Practice must separately meet real-time pacing. A test completing 166 simulated
seconds in 166 wall seconds can still stall for seconds and catch up later. The
match runner checks maximum lag as well as average pace and clock skew. See
`MATCH-TRIALS.md` for the current failures and recorded evidence.

## Remaining work toward anyone importing a robot

The runtime/project boundary is implemented; universal onboarding is not.
The Team 3310 CAD compiler remains bespoke. Next steps are a reusable declarative
mechanism compiler/template library, device-inventory reconciliation (including
sensor coverage), per-parameter provenance/review UI, hardware qualification
tests, and qualification of packaged installation across supported platforms.
The current calibration ledger
is category-level, not yet a complete property-level dependency graph.

Java/Phoenix 6 is the first adapter, not a claim to support every CTRE family or
language. Phoenix 5/TalonSRX, other sensors and C++ programs need their own tested
adapter implementations. The viewer/gyro currently require a root body named
`chassis`, two Xbox controller slots and the existing compiled scene format.
Season rules are optional in the world; the current authored field package is
2026. Project paths do not by themselves turn STEP geometry into calibrated
mechanisms or make a full match qualified.
