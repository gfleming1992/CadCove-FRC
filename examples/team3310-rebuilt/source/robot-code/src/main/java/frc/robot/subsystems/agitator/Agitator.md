# Agitator Subsystem

## Overview

The Agitator subsystem controls floor roller motors used to move game pieces through the robot. Two instances are created — **RightFloorRoller** and **LeftFloorRoller** — each controlling a single TalonFX motor using **Velocity Voltage Control**.

## Class Hierarchy

```
Agitator
  └─ extends ServoMotorSubsystem<MotorInputsAutoLogged, MotorIO>
       └─ extends SubsystemBase
```

## Hardware

| Instance | CAN ID | CAN Bus | Gear Ratio | Max Output Speed | Current Limit |
|----------|--------|---------|------------|------------------|---------------|
| RightFloorRoller | 25 | CANivore CAN1 | 1.667:1 (20/12) | 75 RPS (4500 RPM) | 80A stator |
| LeftFloorRoller | 20 | CANivore CAN1 | 1.667:1 (20/12) | 75 RPS (4500 RPM) | 80A stator |

- **Motor Type:** TalonFX (Kraken X60 / Falcon 500)
- **Neutral Mode:** Coast
- **Right roller** is inverted (`Clockwise_Positive`)

## PID Gains (Slot 0)

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
| Intake RPM | 900 RPM |
| Outtake RPM | -900 RPM |
| Intake RPS | 15 RPS |
| Outtake RPS | -15 RPS |

## Commands

| Command | Description | Speed |
|---------|-------------|-------|
| `intakeCommand()` | Runs roller in intake direction | 900 RPM |
| `outtakeCommand()` | Runs roller in outtake (reverse) direction | -900 RPM |
| `customVelocityCommand(rpm)` | Runs roller at a custom RPM | User-specified |

All commands use `velocitySetpointCommand()` from the base class and run **while held** (whileTrue).

## Controller Mapping

| Button | Action |
|--------|--------|
| **Y** (hold) | Both agitators run `intakeCommand()` |

## Telemetry

### SmartDashboard Keys

| Key | Type | Description |
|-----|------|-------------|
| `Agitator/IntakeRPM` | Number | Default intake RPM target |
| `Agitator/OuttakeRPM` | Number | Default outtake RPM target |
| `Agitator/CurrentRPM` | Number | Measured velocity in RPM |
| `Agitator/CurrentRPS` | Number | Measured velocity in RPS |
| `Agitator/AppliedVolts` | Number | Voltage being applied to motor |
| `Agitator/StatorCurrent` | Number | Stator current draw (amps) |
| `Agitator/SupplyCurrent` | Number | Supply current draw (amps) |
| `Agitator/Status` | String | "MOTOR ACTIVE" or "IDLE" |
| `Agitator/SubsystemActive` | Boolean | Always true when periodic runs |

### AdvantageKit Logged Outputs

- `<Name>/Config/Name`, `CANID`, `CANBus`, `GearRatio`
- `<Name>/Config/TargetIntakeRPS`, `TargetIntakeRPM`
- `<Name>/Config/PID/kP`, `kI`, `kD`, `kS`, `kV`, `kA`

## How It Works

1. **Initialization:** Constructor configures the TalonFX motor via `TalonFXIO`, publishes default RPM values to SmartDashboard, and logs config to AdvantageKit.
2. **Button Press (Y):** `intakeCommand()` starts a velocity setpoint command targeting 900 RPM.
3. **Control Loop (every 20ms):** The TalonFX's onboard PID controller drives the motor to the target velocity. `periodic()` reads sensor data and logs telemetry.
4. **Button Release:** Command ends, motor coasts to a stop (Coast neutral mode).

## Files

- `Agitator.java` — Subsystem class
- `Constants.java` → `AgitatorConstants` — Speed constants
- `Constants.java` → `kRightFloorRollerConfig` / `kLeftFloorRollerConfig` — Motor configs
