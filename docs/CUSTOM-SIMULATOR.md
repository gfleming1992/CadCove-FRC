# Custom robot physics

Most teams should use the bundled native simulator. Keep CAD, collision geometry,
mass/inertia, center of gravity, joints, gearing and motor/contact parameters in
the robot project. Rebuild the world/bindings and restart simulation after edits.
Season scoring and match timing belong in the [Java season provider](SEASON-PLUGINS.md).
Neither of these tasks requires rebuilding Rapier.

## When a mechanism needs new behavior

The native simulator is also a Rust library. A small team-owned executable can
register force models and reuse the existing protocol, solver, collision handling,
logging and viewer. The example in `examples/custom-mechanism` adds translational
viscous drag. It is a synthetic example, not a calibrated tire or intake model.

Start with a source checkout matching your installed CadCove release. The
checkout includes the locked dependencies and patched Rapier/Parry sources.
Copy/adapt the example crate within that checkout and add it to its Cargo
workspace. Keep your changes under version control. No edits to Rapier or the
CadCove stepping loop are needed to register a model. Native plugins are compiled
into the executable; arbitrary dynamic libraries are not loaded.

In your team's `robot.sim.json`, add to `runtime`:

```json
"customSimulator": {
  "sourceDirectory": "../CadCove-FRC",
  "package": "cadcove-team-sim",
  "binary": "cadcove-team-sim"
}
```

Paths are relative to `robot.sim.json`. An optional `features` array enables Cargo
features. Use **CadCove: Build Custom Simulator**, or:

```sh
cadcove sim-build --project robot.sim.json
cadcove sim-validate --project robot.sim.json
```

The editor prompts with the Rust installer link if Cargo is missing. Rust and
platform native build tools (Xcode command-line tools on macOS, MSVC C++ tools on
Windows, a C toolchain on Linux) are needed only for custom builds. Install them
and restart the editor. Bun remains a prerequisite for the CLI.

Builds run explicitly as a visible, cancellable VS Code task, with Cargo's locked
dependency resolution. Cargo may download pinned dependencies on the first build.
The binary and a SHA-256 build report live under `<build>/custom-simulator`.
Remove `runtime.customSimulator` to return to the bundled engine. A configured
custom engine takes precedence over the legacy `INSTANTCAD_SIM_BINARY` environment
variable. Missing/failed custom builds produce an error, never silent fallback.
Stop the running simulation before rebuilding; an active process does not hot-swap.
After source edits, rebuild explicitly. The executable is not rebuilt on activation.

## Register and configure a model

See `examples/custom-mechanism/src/main.rs` for the complete program. Register a
versioned kind in `mechanism::Registry`, then call `instantcad_sim::run(registry)`.
Select it in the **source world** and regenerate world/binding hashes:

```json
"mechanisms": [{
  "id": "chassis-drag",
  "kind": "team.viscous-drag-v1",
  "config": {"body": "chassis", "damping": 5.0}
}]
```

A model declares its dynamic target bodies once. Each native substep receives
simulation time, substep duration, motor input and read-only body states. Return
world-space forces in newtons at body centers of mass, and torques in newton-metres.
The engine integrates each load exactly once using the substep duration and
retains responsibility for collision/joint solving. For a force applied off-center,
include the corresponding `r × F` torque. Internal interactions require equal and
opposite loads. The interface does not expose pose setters or scoring operations.

Unknown kinds, duplicate instance IDs, invalid/fixed/compliant targets, undeclared
output targets and nonfinite/excessive loads fail explicitly. The current contract
supports ordinary rigid bodies, not deformable particle bodies or replacement
contact solvers. Keep callbacks deterministic, bounded, free of I/O and independent
of wall-clock time. This is trusted compiled team code, not a security sandbox.
Do not rely on a failed step being transactional: restart after a model error.

Validate new behavior with bench tests, timestep/refinement comparisons, energy
and force limits, then measured hardware data. Keep assumptions in the calibration
ledger. Accurate and gameplay worlds may use different calibrated models, but
must explicitly record that choice. A successful build does not establish fidelity.
