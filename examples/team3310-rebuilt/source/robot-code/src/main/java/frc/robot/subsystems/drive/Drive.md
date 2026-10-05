# Drive Subsystem

## Overview

The Drive subsystem controls a **4-module swerve drivetrain** using TalonFX motors, CANcoders, and a Pigeon 2 gyro. It handles field-oriented driving, odometry, pose estimation, PathPlanner autonomous, and SysId characterization. Configuration is selected at compile time via the `TunerConstants` facade based on `Constants.currentBot`.

## Class Hierarchy

```
Drive
  └─ extends SubsystemBase

Module (×4 internal instances)
  └─ Manages one swerve module (drive + turn + encoder)
```

## Hardware

### Swerve Modules (per TunerConstants — varies by robot)

| Module | Drive Motor | Steer Motor | CANcoder |
|--------|-------------|-------------|----------|
| Front Left | TalonFX | TalonFX | CANcoder |
| Front Right | TalonFX | TalonFX | CANcoder |
| Back Left | TalonFX | TalonFX | CANcoder |
| Back Right | TalonFX | TalonFX | CANcoder |

### Gyro

- **Pigeon 2** IMU (CAN ID varies by robot config)
- Fallback: Kinematics-based heading estimation if gyro disconnected

### Supported IO Implementations

| Class | Description |
|-------|-------------|
| `ModuleIOTalonFX` | Real hardware: TalonFX drive + TalonFX turn + CANcoder |
| `ModuleIOTalonFXS` | Alternative: TalonFXS + CANdi + PWM encoder |
| `ModuleIOSim` | Physics simulation |
| `GyroIOPigeon2` | Pigeon 2 gyro |
| `GyroIONavX` | NavX gyro (alternative) |

## Key Constants

| Constant | Description |
|----------|-------------|
| `ODOMETRY_FREQUENCY` | 250 Hz (FD CAN) or 100 Hz (standard CAN) |
| `DRIVE_BASE_RADIUS` | Calculated from module positions |
| `ROBOT_MASS_KG` | 74.088 kg |
| `ROBOT_MOI` | 6.883 kg⋅m² |
| `WHEEL_COF` | 1.2 |
| `kSpeedAt12Volts` | Max speed at 12V (varies by robot) |

## PathPlanner Configuration

| Parameter | Value |
|-----------|-------|
| Translation PID | kP=5.0, kI=0.0, kD=0.0 |
| Rotation PID | kP=5.0, kI=0.0, kD=0.0 |
| Pathfinder | LocalADStarAK |
| Alliance flip | Auto-detected from DriverStation |

## Commands

| Command | Description |
|---------|-------------|
| `sysIdQuasistatic(direction)` | SysId quasistatic characterization test |
| `sysIdDynamic(direction)` | SysId dynamic characterization test |

### Drive Commands (from `DriveCommands` utility class)

The default drive command is configured in `RobotContainer` using `DriveCommands.joystickDrive()` which provides field-oriented swerve control from the Xbox controller joysticks.

## Controller Mapping

| Input | Action |
|-------|--------|
| **Left Stick** | Translation (field-oriented) |
| **Right Stick X** | Rotation |
| **Left Bumper** | Slow mode (see DriveCommands) |

## Odometry & Pose Estimation

- Uses `SwerveDrivePoseEstimator` for fused odometry
- High-frequency odometry via `PhoenixOdometryThread` (runs at 250 Hz on FD CAN)
- Thread-safe with `odometryLock` (ReentrantLock)
- Supports vision measurement injection via `addVisionMeasurement()`

## Telemetry

### AdvantageKit Logged Outputs

| Key | Description |
|-----|-------------|
| `Drive/Gyro/*` | Gyro inputs (yaw, pitch, roll, connected) |
| `SwerveStates/Measured` | Actual module states |
| `SwerveStates/Setpoints` | Commanded module states |
| `SwerveStates/SetpointsOptimized` | Optimized (post-desaturation) setpoints |
| `SwerveChassisSpeeds/Measured` | Measured robot chassis speeds |
| `SwerveChassisSpeeds/Setpoints` | Commanded chassis speeds |
| `Odometry/Robot` | Estimated robot pose on field |
| `Odometry/Trajectory` | Active PathPlanner trajectory |
| `Odometry/TrajectorySetpoint` | Current PathPlanner target pose |
| `Drive/SysIdState` | SysId routine state |

### Alerts

| Alert | Condition |
|-------|-----------|
| Gyro Disconnected | Pigeon 2 not responding (real mode only) |

## How It Works

1. **Initialization:**
   - 4 `Module` instances created with IO implementations based on current mode (Real/Sim/Replay).
   - Pigeon 2 gyro IO created.
   - `PhoenixOdometryThread` started for high-frequency module position sampling.
   - PathPlanner `AutoBuilder` configured with pose supplier, velocity consumer, and PID controllers.

2. **Periodic (every 20ms):**
   - Acquires odometry lock.
   - Reads gyro inputs and all module inputs.
   - Releases lock.
   - Stops modules if robot is disabled.
   - Processes all odometry samples since last periodic:
     - Reads wheel positions and calculates deltas.
     - Updates gyro angle (or estimates from kinematics if disconnected).
     - Feeds into `SwerveDrivePoseEstimator`.

3. **Driving:**
   - `runVelocity(ChassisSpeeds)` converts desired speeds into per-module setpoints.
   - `SwerveDriveKinematics` calculates module states.
   - Wheel speeds desaturated to stay within `kSpeedAt12Volts`.
   - Each module receives optimized setpoint.

4. **Autonomous:**
   - PathPlanner reads current pose from `getPose()`.
   - Calculates target chassis speeds.
   - Calls `runVelocity()` to drive.

## Files

- `Drive.java` — Main subsystem class
- `Module.java` — Individual swerve module management
- `ModuleIO.java` — Module hardware interface
- `ModuleIOTalonFX.java` — TalonFX module implementation
- `ModuleIOTalonFXS.java` — TalonFXS module implementation
- `ModuleIOSim.java` — Simulation module implementation
- `GyroIO.java` — Gyro hardware interface
- `GyroIOPigeon2.java` — Pigeon 2 implementation
- `GyroIONavX.java` — NavX implementation
- `PhoenixOdometryThread.java` — High-frequency odometry sampling thread
- `TunerConstants.java` — Robot-specific swerve configuration facade
