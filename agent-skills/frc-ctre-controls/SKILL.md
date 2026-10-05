---
name: frc-ctre-controls
description: Integrate and debug FRC WPILib and Phoenix 6 motor, swerve, encoder, and gyro code against the actual robot and CadCove plant.
---

# CTRE controls

Read the team's vendordeps, active TunerConstants selection, device construction,
subsystem/command ownership, and `.cadcove/bridge/DEVICE-ADAPTERS.md`. Consult the
matching version's official API; a device supported by Phoenix may still be
unsupported by our bridge. Preserve the installed SDK and the team's architecture.
See `../references/frc-components.md` for sources.

Inventory CAN bus + ID, motor model, sensor source, inversion, neutral mode,
current limits, ratio/units, zero offset and mechanism limits. Check desktop SDK
limitations around multiple buses and duplicate IDs before running; do not
silently renumber hardware devices. Distinguish mechanical SimState orientation
from logical motor inversion, and rotor turns from mechanism turns/metres.

For swerve, confirm exact module/wheel variant, actual rolling radius, module
locations/order, drive/steer/coupling ratios, encoder offsets, bus mapping and
gyro frame. Compare code to CAD, then test signs and a measured-distance drive.
Do not copy another robot's Tuner gains, speed constants or offsets. Use the
team's Phoenix/WPILib swerve facilities rather than recreating their kinematics.
Motor torque/speed data must match FOC mode and selected motor type.

Keep real commands driving real vendor devices in simulation. Register existing
objects with TwinBridge, feed physical rotor/sensor state back through SimState,
and remove competing simulation writers for those devices. The plant must not
be driven directly by desired position or copied joystick pose. The bridge owns
the simulation clock; don't advance WPILib timing independently.

Keep mechanism state machines cancellable and subsystem requirements correct.
Test disable, interruption and sensor timeout. Shooter feed should depend on
measured readiness (wheel speed, hood/turret pose, settling), not only a fixed
delay or the requested setpoint. Expose readiness failures in telemetry.

For a short shot or stalled intake: compare request → actual motor output →
rotor speed/position → physical joint → contact/release trajectory before changing
the plant. Our earlier early-feed failure was control sequencing; other jams
were missing drives or false convex-hull obstructions. These require different fixes.

Build the real project, run isolated sign/ratio/limit tests, then a course with
the same JAR. Record hashes and target-versus-observed traces. Keep simulator-only
tuning explicit; passing a calibrated scene must not silently alter hardware gains.
