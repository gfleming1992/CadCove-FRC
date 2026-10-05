# IntakeRollers Subsystem

## Overview

The IntakeRollers subsystem controls the roller mechanism that collects and feeds game pieces into the robot. It uses a **leader-follower** motor configuration with two TalonFX motors running in sync via **Velocity Voltage Control**.

## Class Hierarchy

```
IntakeRollers
  └─ extends ServoMotorSubsystemWithFollowers<MotorInputsAutoLogged, MotorIO>
       └─ extends ServoMotorSubsystem<MotorInputsAutoLogged, MotorIO>
            └─ extends SubsystemBase
```

## Hardware

| Role | CAN ID | CAN Bus | Gear Ratio | Current Limit |
|------|--------|---------|------------|---------------|
| **Leader** | 13 | CANivore CAN1 | (18/20) × (10/32) × 60 = 8.4375:1 | 60A supply |
| **Follower** | 14 | CANivore CAN1 | (18/20) × (10/32) × 60 = 8.4375:1 | 60A supply |

- **Motor Type:** TalonFX (Kraken X60 / Falcon 500)
- **Neutral Mode:** Coast
- **Follower is inverted** relative to the leader

## PID Gains (Slot 0) — Both Motors

| Gain | Value |
|------|-------|
| kP | 0.5 |
| kI | 0.0 |
| kD | 0.0 |
| kS | 0.02 |
| kV | 0.1 |
| kA | 0.0 |

## Speed Constants

| Constant | Value |
|----------|-------|
| Intake Velocity | 1000 RPM |
| Outtake Velocity | -500 RPM |

## Commands

| Command | Description | Speed |
|---------|-------------|-------|
| `intakeCommand()` | Runs rollers forward to collect game pieces | 1000 RPM |
| `outakeCommand()` | Runs rollers in reverse to eject game pieces | -500 RPM |

All commands use `velocitySetpointCommand()` from the base class and run **while held** (whileTrue).

## Controller Mapping

| Button | Action |
|--------|--------|
| **Right Bumper** (hold) | `intakeCommand()` — rollers forward |
| **Left Bumper** (hold) | `outakeCommand()` — rollers reverse |

## Leader-Follower Behavior

1. **On construction:** The follower motor calls `followerIO.follow(leaderCANID, inverted=true)`.
2. **Every periodic cycle:**
   - Velocity setpoint is sent **only** to the leader motor.
   - Follower mirrors the leader's output automatically (inverted).
   - Both motors' telemetry is read and logged independently.
3. **Position/Velocity readings** are averaged across leader and follower for accurate feedback.

## Telemetry

### AdvantageKit Logged Inputs

| Key | Description |
|-----|-------------|
| `Intake_Roller/velocityUnitsPerSecond` | Leader measured velocity |
| `Intake_Roller/appliedVolts` | Leader applied voltage |
| `Intake_Roller/currentStatorAmps` | Leader stator current |
| `Intake_Roller/currentSupplyAmps` | Leader supply current |
| `Intake_Roller/unitPosition` | Leader position |
| `Intake_Roller/follower0/velocityUnitsPerSecond` | Follower measured velocity |
| `Intake_Roller/follower0/appliedVolts` | Follower applied voltage |
| `Intake_Roller/follower0/currentStatorAmps` | Follower stator current |

## How It Works

1. **Initialization:** Two `TalonFXIO` objects are created (leader + follower). The follower is configured to mirror the leader (inverted). Motor configs and PID gains are applied.
2. **Button Press (Right Bumper):** `intakeCommand()` starts a velocity setpoint command targeting 1000 RPM.
3. **Control Loop (every 20ms):**
   - Leader motor's onboard PID controller drives to target velocity.
   - Follower automatically mirrors leader output.
   - `periodic()` reads sensor data from both motors and logs to AdvantageKit.
4. **Button Release:** Command ends, both motors coast to a stop.

## Files

- `IntakeRollers.java` — Subsystem class
- `Constants.java` → `IntakeConstants` — Speed constants
- `Constants.java` → `kIntakeRollerConfig` — Leader motor config
- `Constants.java` → `kIntakeRollerFollowerConfig` — Follower motor config
- `ServoMotorSubsystemWithFollowers.java` — Base class handling leader-follower logic
