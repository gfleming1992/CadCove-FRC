---
name: frc-simulation-validation
description: Commission, diagnose and profile a CAD-first FRC simulation using real robot code, measurable trials and separate practice/accuracy settings.
---

# Simulation validation

Read `.cadcove/AGENT.md` for exact installed CLI options. Start with artifact
`audit`; passing it checks identity/bindings, not mechanical fidelity. Record
world, CAD, native binary, JAR and season revisions before behavioral trials.
Check `sourceFreshness`: untracked builds only verify compiled artifacts. A build
should record its complete CAD/physical input closure in `scene-bindings.json`
`sourceInputs`. Changed inputs require rebuilding the affected artifacts; never
just refresh their fingerprints to dismiss a stale-build error. Java edits also
require rebuilding the actual robot JAR. Restart to load either kind of change.

Progress from isolated motor signs/ratios/limits and sensors to subsystem tests,
drive paths, intake/shoot cycles, then an entire scheduled match. Use actual
robot controls and sensor feedback. Define acceptance criteria before running.
Use fresh initial conditions and record misses, jams, aborts and timeouts too.
In agent control mode, renew controller packets within the input lease; a
one-shot input is not a held button. In Driver Station mode, physical controllers
and enable/disable belong to WPILib. Do not override them with agent packets.
Verify disabled, cancellation and lost-input behavior for the selected owner.

Use `sim-state`, filtered `sim-objects`, `sim-devices` and `sim-motor-controls`
for numeric feedback. Use `sim-capture` for clearance/appearance or trajectories,
checking its run, world hash and tick. Keep screenshot scope near the mechanism.
Never write fabricated feedback files or inject target-directed poses/velocities
to make a controller trial succeed. A seeded initial scenario is fine; disclose it.

Diagnose in order: source/binding identity → controls and measured readiness →
physical transmission → collision geometry → material/solver behavior. Compare
an isolated analytic fixture and finer timesteps when changing contact behavior.
Energy conservation alone doesn't prove accurate contact trajectories. Native
input replay is not proof that the entire asynchronous robot scheduler replays.

Maintain separate practice and accuracy profiles with hashes, changed parameters
and evidence. Reduced-order gameplay contacts can improve responsiveness but
must retain declared limits; never use those results to certify hardware. Keep
detailed background trials for affected mechanisms and calibration comparisons.

Profile a representative run, not only an unloaded timestep: native phases,
bridge/JVM, rendering, p50/p95/p99/max tick time, deadline misses, simulation/wall
ratio and input-to-display behavior. Average 0.97x speed alone doesn't establish
smooth practice. Measure competing GPU/CPU load and repeat only to resolve a
specific risk. Fixed-timestamp video playback can look realtime despite slow
physics; label it and do not use it as throughput evidence.

Report observed scores versus observer semantics, tested ranges/layouts and
remaining calibration needs. A successful close-range volley is not proof of
accuracy from all positions. Preserve the user's active demo/session; tests own
and stop only their own sessions.

## Rotating-part alignment

A pickup counter alone does not verify a mechanism. Check spinning parts against
their joint axes and inspect the live scene. When moving an assembly, update its
joints, colliders and occurrence bindings consistently; do not apply an assembly
offset again inside the rotating body's mesh transform.

For known shaft points, add optional `axisChecks` to `scene-bindings.json`:
`[{"instance":"roller-occurrence","joint":"roller-joint","point":[0,0,0],"toleranceM":0.001}]`.
`point` is an explicitly identified point on the shaft in mesh coordinates, in
metres (not an assumed CAD origin). The audit transforms it into the child body's
frame and checks its distance from the revolute joint axis. Axial displacement
is allowed. This static consistency check complements a dynamic spin check; it
does not establish bearing clearance, collision fidelity or hardware calibration.
