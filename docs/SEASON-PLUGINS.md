# Season observers

Robot mechanisms, CAD/field geometry, and game rules have separate sources.
A new season should not require changing `TwinBridge`, the native stepping loop,
or the viewer. The native world still needs correct colliders, masses, joints,
motors, and calibrated interactions; a rules observer does not infer them.

## Register a provider in the team's robot project

1. Export the current bridge with `cadcove bridge-export --workspace .`, and
   apply `.cadcove/bridge/instantcad.gradle`. Read the exported `SeasonPlugin`,
   `SeasonObserver`, and `SeasonFrame` interfaces. They compile with the team's
   existing WPILib/Phoenix/Jackson dependencies.
2. Put a public Java class with a public no-argument constructor in the team's
   `src/main/java`, implementing `org.instantcad.frc.SeasonPlugin`. Give it a
   unique ID, for example `team1234.practice-2027`. API version is currently 1.
3. Add the fully qualified provider class name as a line in
   `src/main/resources/META-INF/services/org.instantcad.frc.SeasonPlugin`.
   Preserve other provider lines. Ensure the built desktop simulation JAR
   contains this resource and the class. If assembling multiple dependency JARs,
   merge ServiceLoader resources rather than discarding duplicate filenames.
4. Select it in **compiled world.json**, then regenerate the world hash in
   scene-bindings.json and physics-mode provenance as part of the same build:

```json
{
  "season": {
    "schema": 1,
    "adapter": "team1234.practice-2027",
    "config": { "schema": 1 }
  }
}
```

This is one field of the complete world, not a complete world file. `config`
is the provider's own versioned schema. The factory receives owned copies of
config/world once; validate units, scoring geometry, IDs, and schema there.
Declare only the body IDs needed in `observedBodies()`. Unknown IDs, duplicate
provider IDs, incompatible API versions, and absent selected providers fail
startup. An unknown season never falls back silently to 2026 scoring.

`rebuilt-2026` is the bundled provider for the existing 2026 observer. Its config
is the previous `rebuilt2026` object. Legacy worlds using `rebuilt2026` continue
to select that provider. Supplying both `season` and `rebuilt2026` is an error.
A world with neither has no rules observer; ordinary practice can still run.

## Observer contract

`start(SeasonFrame, JsonNode options)` begins one match in a fresh simulation.
`advance(SeasonFrame)` observes subsequent physics ticks until `finished()`.
`abort(reason)` must finish the match and return disabled mode. The observer
provides `mode()`, finite nonnegative `remaining()`, optional driver-station
`gameData()`, `snapshot()`, and a bounded event history via `events(after)`.
The bridge serializes these under its existing lock. Keep methods deterministic,
bounded, nonblocking, and free of file/network work on the physics thread.

`SeasonFrame` exposes tick/time, declared body IDs, position, velocity, rotation
quaternion, and angular velocity. Values use metres, seconds, radians, and
quaternion [x,y,z,w]. The frame offers immutable value objects with no mutable
JSON or native physics handle. Values are extracted lazily, without copying the
entire scene at each step. Do not retain every frame or accumulate unbounded
events. Store only the previous observations needed for swept crossing tests.

Observers **must not** command motors, teleport pieces, or adjust physics to
make a score happen. The API does not provide those operations. This is a code
contract, not a security sandbox: team Java code remains trusted code in the
robot JVM. A provider must be reviewed and tested just like robot code.

Use swept tests between physics observations for fast pieces; do not require a
ball to land exactly on a scoring plane at a discrete tick. Define boundary
inclusion, clock transitions, grace periods, replay ordering, and duplicate-score
handling explicitly from that season's actual rules. Test misses, backflow,
stationary pieces, simultaneous scores, resets, aborts, and score/timer edges.
Do not call a training rule set official or hardware-qualified.

## Agent control loop

- `cadcove sim-match --project robot.sim.json` reports selected/available adapter
  IDs and the observer snapshot/events after the robot bridge is ready.
- Start while disabled with `--input start.json`, where the file contains
  `{"action":"start","options":{...}}`. Options belong to the provider. For
  2026, use `{"tieWinner":"blue"}` (or `"red"`) inside options. The old top-level
  `tieWinner` is also accepted for existing callers.
- Continue renewing `sim-controls` packets with `{"mode":"match","controllers":[]}`
  within the one-second lease. During teleop, add the team's controller inputs.
  The observer controls autonomous/teleop timing; the robot code controls actions.
  A one-shot CLI invocation does not keep a complete match enabled by itself.
- `{"action":"abort"}` aborts. A dropped control lease or manual takeover also
  aborts the scheduled match. A new match requires a new simulation run.
- `sim-autonomous` queries the team's configured chooser; selection must be
  acknowledged by the actual robot program before starting autonomous.
- Use `sim-state`, `sim-objects`, `sim-devices`, `sim-motor-controls`, and
  `sim-capture` for feedback. No agent API key or MCP server is required.

The source repository includes `examples/season-plugin`, a separate training
provider registered through ServiceLoader. It scores an explicit body's forward
crossing of a plane and is intentionally not a future-season FRC implementation.
Its tests feed it actual native-engine motion as well as boundary/error cases.
