// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

package frc.robot.commands;

import edu.wpi.first.math.MathUtil;
import edu.wpi.first.math.controller.PIDController;
import edu.wpi.first.math.controller.ProfiledPIDController;
import edu.wpi.first.math.filter.SlewRateLimiter;
import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.geometry.Transform2d;
import edu.wpi.first.math.geometry.Translation2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;
import edu.wpi.first.math.trajectory.TrapezoidProfile;
import edu.wpi.first.math.util.Units;
import edu.wpi.first.wpilibj.DriverStation;
import edu.wpi.first.wpilibj.DriverStation.Alliance;
import edu.wpi.first.wpilibj.Timer;
import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.Commands;
import frc.robot.Constants;
import frc.robot.Robot;
import frc.robot.subsystems.drive.Drive;
import java.text.DecimalFormat;
import java.text.NumberFormat;
import java.util.LinkedList;
import java.util.List;
import java.util.function.DoubleSupplier;
import java.util.function.Supplier;
import org.littletonrobotics.junction.Logger;

public class DriveCommands {
  private static final double LOOP_PERIOD_SECONDS = 0.02;
  private static final double VELOCITY_EPSILON = 1e-9;

  private DriveCommands() {}

  private static Translation2d getLinearVelocityFromJoysticks(double x, double y) {
    // Apply deadband
    double linearMagnitude =
        MathUtil.applyDeadband(Math.hypot(x, y), Constants.DriveCommandConstants.kJoystickDeadband);
    Rotation2d linearDirection = new Rotation2d(Math.atan2(y, x));

    // Square magnitude for more precise control
    linearMagnitude = linearMagnitude * linearMagnitude;

    // Return new linear velocity
    return new Pose2d(Translation2d.kZero, linearDirection)
        .transformBy(new Transform2d(linearMagnitude, 0.0, Rotation2d.kZero))
        .getTranslation();
  }

  private static boolean isHomeScoringDriveModeActive() {
    return Robot.shouldLimitHomeZoneDrive();
  }

  private static double getActiveMaxLinearSpeedMetersPerSec() {
    return isHomeScoringDriveModeActive()
        ? Constants.DriveCommandConstants.kHomeScoringMaxLinearSpeedMps
        : Constants.DriveCommandConstants.kNormalMaxLinearSpeedMps;
  }

  private static double getActiveMaxAngularSpeedRadPerSec() {
    return isHomeScoringDriveModeActive()
        ? Constants.DriveCommandConstants.kHomeScoringMaxAngularSpeedRadPerSec
        : Constants.DriveCommandConstants.kNormalMaxAngularSpeedRadPerSec;
  }

  private static double getActiveMaxLinearAccelMetersPerSec2() {
    return isHomeScoringDriveModeActive()
        ? Constants.DriveCommandConstants.kHomeScoringMaxLinearAccelMetersPerSec2
        : Constants.DriveCommandConstants.kNormalMaxLinearAccelMetersPerSec2;
  }

  private static double getActiveMaxAngularAccelRadPerSec2() {
    return isHomeScoringDriveModeActive()
        ? Constants.DriveCommandConstants.kHomeScoringMaxAngularAccelRadPerSec2
        : Constants.DriveCommandConstants.kNormalMaxAngularAccelRadPerSec2;
  }

  private static double getActiveMaxLinearDecelMetersPerSec2() {
    return isHomeScoringDriveModeActive()
        ? Constants.DriveCommandConstants.kHomeScoringMaxLinearDecelMetersPerSec2
        : Constants.DriveCommandConstants.kNormalMaxLinearDecelMetersPerSec2;
  }

  private static double getActiveMaxAngularDecelRadPerSec2() {
    return isHomeScoringDriveModeActive()
        ? Constants.DriveCommandConstants.kHomeScoringMaxAngularDecelRadPerSec2
        : Constants.DriveCommandConstants.kNormalMaxAngularDecelRadPerSec2;
  }

  private static Translation2d limitTranslationVelocity(
      Translation2d currentVelocity,
      Translation2d targetVelocity,
      double maxLinearAccelMetersPerSec2,
      double maxLinearDecelMetersPerSec2) {
    Translation2d deltaVelocity = targetVelocity.minus(currentVelocity);
    double deltaMagnitude = deltaVelocity.getNorm();
    boolean isBraking =
        currentVelocity.getNorm() > VELOCITY_EPSILON
            && deltaVelocity.getX() * currentVelocity.getX()
                    + deltaVelocity.getY() * currentVelocity.getY()
                < 0.0;
    double maxVelocityDelta =
        (isBraking ? maxLinearDecelMetersPerSec2 : maxLinearAccelMetersPerSec2)
            * LOOP_PERIOD_SECONDS;
    if (deltaMagnitude > maxVelocityDelta && deltaMagnitude > VELOCITY_EPSILON) {
      return currentVelocity.plus(deltaVelocity.times(maxVelocityDelta / deltaMagnitude));
    }
    return targetVelocity;
  }

  private static double limitAngularVelocity(
      double currentOmegaRadPerSec,
      double targetOmegaRadPerSec,
      double maxAngularAccelRadPerSec2,
      double maxAngularDecelRadPerSec2) {
    boolean isBraking =
        Math.abs(currentOmegaRadPerSec) > VELOCITY_EPSILON
            && (targetOmegaRadPerSec - currentOmegaRadPerSec) * currentOmegaRadPerSec < 0.0;
    double maxOmegaDelta =
        (isBraking ? maxAngularDecelRadPerSec2 : maxAngularAccelRadPerSec2) * LOOP_PERIOD_SECONDS;
    return currentOmegaRadPerSec
        + MathUtil.clamp(
            targetOmegaRadPerSec - currentOmegaRadPerSec, -maxOmegaDelta, maxOmegaDelta);
  }

  private static ChassisSpeeds buildLimitedFieldRelativeSpeeds(
      Translation2d linearVelocityInput,
      double targetOmegaRadPerSec,
      double[] previousCommandedVxMetersPerSecond,
      double[] previousCommandedVyMetersPerSecond,
      double[] previousCommandedOmegaRadPerSec) {
    Translation2d targetTranslationVelocity =
        linearVelocityInput.times(getActiveMaxLinearSpeedMetersPerSec());
    Translation2d currentTranslationVelocity =
        new Translation2d(
            previousCommandedVxMetersPerSecond[0], previousCommandedVyMetersPerSecond[0]);
    Translation2d limitedTranslationVelocity =
        limitTranslationVelocity(
            currentTranslationVelocity,
            targetTranslationVelocity,
            getActiveMaxLinearAccelMetersPerSec2(),
            getActiveMaxLinearDecelMetersPerSec2());

    double limitedOmegaRadPerSec =
        limitAngularVelocity(
            previousCommandedOmegaRadPerSec[0],
            MathUtil.clamp(
                targetOmegaRadPerSec,
                -getActiveMaxAngularSpeedRadPerSec(),
                getActiveMaxAngularSpeedRadPerSec()),
            getActiveMaxAngularAccelRadPerSec2(),
            getActiveMaxAngularDecelRadPerSec2());

    previousCommandedVxMetersPerSecond[0] = limitedTranslationVelocity.getX();
    previousCommandedVyMetersPerSecond[0] = limitedTranslationVelocity.getY();
    previousCommandedOmegaRadPerSec[0] = limitedOmegaRadPerSec;

    return new ChassisSpeeds(
        previousCommandedVxMetersPerSecond[0],
        previousCommandedVyMetersPerSecond[0],
        previousCommandedOmegaRadPerSec[0]);
  }

  /**
   * Field relative drive command using two joysticks (controlling linear and angular velocities).
   */
  public static Command joystickDrive(
      Drive drive,
      DoubleSupplier xSupplier,
      DoubleSupplier ySupplier,
      DoubleSupplier omegaSupplier) {
    return joystickDrive(drive, xSupplier, ySupplier, omegaSupplier, () -> Translation2d.kZero);
  }

  public static Command joystickDrive(
      Drive drive,
      DoubleSupplier xSupplier,
      DoubleSupplier ySupplier,
      DoubleSupplier omegaSupplier,
      Supplier<Translation2d> centerOfRotationSupplier) {
    PIDController headingHoldController =
        new PIDController(
            Constants.DriveCommandConstants.kAngleHoldKp,
            0.0,
            Constants.DriveCommandConstants.kAngleHoldKd);
    headingHoldController.enableContinuousInput(-Math.PI, Math.PI);
    headingHoldController.setTolerance(Units.degreesToRadians(1.0));
    double[] headingHoldSetpointRad = new double[] {0.0};
    boolean[] headingHoldActive = new boolean[] {false};
    double[] previousCommandedVxMetersPerSecond = new double[] {0.0};
    double[] previousCommandedVyMetersPerSecond = new double[] {0.0};
    double[] previousCommandedOmegaRadPerSec = new double[] {0.0};

    return Commands.run(
            () -> {
              // Get linear velocity
              Translation2d linearVelocity =
                  getLinearVelocityFromJoysticks(xSupplier.getAsDouble(), ySupplier.getAsDouble());

              // Use a dedicated deadband for rotation command shaping.
              double omegaInput =
                  MathUtil.applyDeadband(
                      omegaSupplier.getAsDouble(),
                      Constants.DriveCommandConstants.kRotationCommandDeadband);
              boolean wantsHold =
                  Math.abs(omegaSupplier.getAsDouble())
                      <= Constants.DriveCommandConstants.kHoldStickNeutralDeadband;
              double omega;

              if (!wantsHold) {
                // Manual rotation mode: track current heading so release holds this angle.
                headingHoldSetpointRad[0] = drive.getRotation().getRadians();
                headingHoldActive[0] = false;
                omega =
                    Math.copySign(omegaInput * omegaInput, omegaInput)
                        * getActiveMaxAngularSpeedRadPerSec();
              } else {
                // Delay hold engagement until measured yaw rate settles to avoid snap-back after
                // spins.
                double measuredYawRateRadPerSec = drive.getChassisSpeeds().omegaRadiansPerSecond;
                if (Math.abs(measuredYawRateRadPerSec)
                    > Constants.DriveCommandConstants.kHoldEngageMaxRateRadPerSec) {
                  headingHoldSetpointRad[0] = drive.getRotation().getRadians();
                  headingHoldActive[0] = false;
                  omega = 0.0;
                } else {
                  // Hold heading mode: lock to the most recent heading from manual-rotation mode.
                  if (!headingHoldActive[0]) {
                    headingHoldSetpointRad[0] = drive.getRotation().getRadians();
                    headingHoldController.reset();
                    headingHoldActive[0] = true;
                  }
                  omega =
                      MathUtil.clamp(
                          headingHoldController.calculate(
                              drive.getRotation().getRadians(), headingHoldSetpointRad[0]),
                          -getActiveMaxAngularSpeedRadPerSec(),
                          getActiveMaxAngularSpeedRadPerSec());
                }
              }

              // Convert to field relative speeds & send command
              // The previous activeHub-based drive slowdown is intentionally left commented out.
              // Teleop drive mode selection now depends on alliance home zone + shooting instead of
              // FMS hub state.
              // double driveScale =
              //     Robot.activeHub ? Constants.DriveCommandConstants.kHubDriveScalar : 1.0;
              // double turnScale =
              //     Robot.activeHub ? Constants.DriveCommandConstants.kHubTurnScalar : 1.0;
              ChassisSpeeds speeds =
                  buildLimitedFieldRelativeSpeeds(
                      linearVelocity,
                      omega,
                      previousCommandedVxMetersPerSecond,
                      previousCommandedVyMetersPerSecond,
                      previousCommandedOmegaRadPerSec);
              boolean isFlipped =
                  DriverStation.getAlliance().isPresent()
                      && DriverStation.getAlliance().get() == Alliance.Red;
              drive.runVelocity(
                  ChassisSpeeds.fromFieldRelativeSpeeds(
                      speeds,
                      isFlipped
                          ? drive.getRotation().plus(new Rotation2d(Math.PI))
                          : drive.getRotation()),
                  centerOfRotationSupplier.get());
            },
            drive)
        .beforeStarting(
            () -> {
              headingHoldSetpointRad[0] = drive.getRotation().getRadians();
              headingHoldController.reset();
              headingHoldActive[0] = true;
              previousCommandedVxMetersPerSecond[0] = 0.0;
              previousCommandedVyMetersPerSecond[0] = 0.0;
              previousCommandedOmegaRadPerSec[0] = 0.0;
            })
        .finallyDo((interrupted) -> headingHoldController.close());
  }

  /**
   * Field relative drive command using joystick for linear control and PID for angular control.
   * Possible use cases include snapping to an angle, aiming at a vision target, or controlling
   * absolute rotation with a joystick.
   */
  public static Command joystickDriveAtAngle(
      Drive drive,
      DoubleSupplier xSupplier,
      DoubleSupplier ySupplier,
      Supplier<Rotation2d> rotationSupplier) {
    return joystickDriveAtAngle(
        drive, xSupplier, ySupplier, rotationSupplier, () -> Translation2d.kZero);
  }

  public static Command joystickDriveAtAngle(
      Drive drive,
      DoubleSupplier xSupplier,
      DoubleSupplier ySupplier,
      Supplier<Rotation2d> rotationSupplier,
      Supplier<Translation2d> centerOfRotationSupplier) {

    // Create PID controller
    ProfiledPIDController angleController =
        new ProfiledPIDController(
            Constants.DriveCommandConstants.kAngleHoldKp,
            0.0,
            Constants.DriveCommandConstants.kAngleHoldKd,
            new TrapezoidProfile.Constraints(
                Constants.DriveCommandConstants.kAngleProfileMaxVelocityRadPerSec,
                Constants.DriveCommandConstants.kAngleProfileMaxAccelerationRadPerSec2));
    angleController.enableContinuousInput(-Math.PI, Math.PI);
    double[] previousCommandedVxMetersPerSecond = new double[] {0.0};
    double[] previousCommandedVyMetersPerSecond = new double[] {0.0};
    double[] previousCommandedOmegaRadPerSec = new double[] {0.0};
    int[] snapLogCounter = new int[] {7}; // staggered offset 7

    // Construct command
    return Commands.run(
            () -> {
              // Rate-limited logging
              snapLogCounter[0]++;
              boolean shouldLog = snapLogCounter[0] >= Constants.kLogInterval;
              if (shouldLog) snapLogCounter[0] = 0;

              // Get linear velocity
              Translation2d linearVelocity =
                  getLinearVelocityFromJoysticks(xSupplier.getAsDouble(), ySupplier.getAsDouble());

              // Calculate angular speed
              Rotation2d targetRotation = rotationSupplier.get();
              double omega =
                  angleController.calculate(
                      drive.getRotation().getRadians(), targetRotation.getRadians());
              double headingErrorRad =
                  MathUtil.angleModulus(targetRotation.minus(drive.getRotation()).getRadians());
              if (shouldLog) {
                Logger.recordOutput("Drive/Snap/TargetRotationRad", targetRotation.getRadians());
                Logger.recordOutput(
                    "Drive/Snap/CurrentRotationRad", drive.getRotation().getRadians());
                Logger.recordOutput("Drive/Snap/ErrorRad", headingErrorRad);
                Logger.recordOutput("Drive/Snap/OmegaCommandRadPerSec", omega);
              }

              // Convert to field relative speeds & send command
              ChassisSpeeds speeds =
                  buildLimitedFieldRelativeSpeeds(
                      linearVelocity,
                      omega,
                      previousCommandedVxMetersPerSecond,
                      previousCommandedVyMetersPerSecond,
                      previousCommandedOmegaRadPerSec);
              boolean isFlipped =
                  DriverStation.getAlliance().isPresent()
                      && DriverStation.getAlliance().get() == Alliance.Red;
              drive.runVelocity(
                  ChassisSpeeds.fromFieldRelativeSpeeds(
                      speeds,
                      isFlipped
                          ? drive.getRotation().plus(new Rotation2d(Math.PI))
                          : drive.getRotation()),
                  centerOfRotationSupplier.get());
            },
            drive)

        // Reset PID controller when command starts
        .beforeStarting(
            () -> {
              angleController.reset(drive.getRotation().getRadians());
              previousCommandedVxMetersPerSecond[0] = 0.0;
              previousCommandedVyMetersPerSecond[0] = 0.0;
              previousCommandedOmegaRadPerSec[0] = 0.0;
            });
  }

  /**
   * Measures the velocity feedforward constants for the drive motors.
   *
   * <p>This command should only be used in voltage control mode.
   */
  public static Command feedforwardCharacterization(Drive drive) {
    List<Double> velocitySamples = new LinkedList<>();
    List<Double> voltageSamples = new LinkedList<>();
    Timer timer = new Timer();

    return Commands.sequence(
        // Reset data
        Commands.runOnce(
            () -> {
              velocitySamples.clear();
              voltageSamples.clear();
            }),

        // Allow modules to orient
        Commands.run(
                () -> {
                  drive.runCharacterization(0.0);
                },
                drive)
            .withTimeout(Constants.DriveCommandConstants.kFfCharacterizationStartDelaySec),

        // Start timer
        Commands.runOnce(timer::restart),

        // Accelerate and gather data
        Commands.run(
                () -> {
                  double voltage =
                      timer.get() * Constants.DriveCommandConstants.kFfCharacterizationRampRate;
                  drive.runCharacterization(voltage);
                  velocitySamples.add(drive.getFFCharacterizationVelocity());
                  voltageSamples.add(voltage);
                },
                drive)

            // When cancelled, calculate and print results
            .finallyDo(
                () -> {
                  int n = velocitySamples.size();
                  double sumX = 0.0;
                  double sumY = 0.0;
                  double sumXY = 0.0;
                  double sumX2 = 0.0;
                  for (int i = 0; i < n; i++) {
                    sumX += velocitySamples.get(i);
                    sumY += voltageSamples.get(i);
                    sumXY += velocitySamples.get(i) * voltageSamples.get(i);
                    sumX2 += velocitySamples.get(i) * velocitySamples.get(i);
                  }
                  double kS = (sumY * sumX2 - sumX * sumXY) / (n * sumX2 - sumX * sumX);
                  double kV = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

                  NumberFormat formatter = new DecimalFormat("#0.00000");
                  System.out.println("********** Drive FF Characterization Results **********");
                  System.out.println("\tkS: " + formatter.format(kS));
                  System.out.println("\tkV: " + formatter.format(kV));
                }));
  }

  /** Measures the robot's wheel radius by spinning in a circle. */
  public static Command wheelRadiusCharacterization(Drive drive) {
    SlewRateLimiter limiter =
        new SlewRateLimiter(Constants.DriveCommandConstants.kWheelRadiusCharacterizationRampRate);
    WheelRadiusCharacterizationState state = new WheelRadiusCharacterizationState();

    return Commands.parallel(
        // Drive control sequence
        Commands.sequence(
            // Reset acceleration limiter
            Commands.runOnce(
                () -> {
                  limiter.reset(0.0);
                }),

            // Turn in place, accelerating up to full speed
            Commands.run(
                () -> {
                  double speed =
                      limiter.calculate(
                          Constants.DriveCommandConstants.kWheelRadiusCharacterizationMaxVelocity);
                  drive.runVelocity(new ChassisSpeeds(0.0, 0.0, speed));
                },
                drive)),

        // Measurement sequence
        Commands.sequence(
            // Wait for modules to fully orient before starting measurement
            Commands.waitSeconds(1.0),

            // Record starting measurement
            Commands.runOnce(
                () -> {
                  state.positions = drive.getWheelRadiusCharacterizationPositions();
                  state.lastAngle = drive.getRotation();
                  state.gyroDelta = 0.0;
                }),

            // Update gyro delta
            Commands.run(
                    () -> {
                      var rotation = drive.getRotation();
                      state.gyroDelta += Math.abs(rotation.minus(state.lastAngle).getRadians());
                      state.lastAngle = rotation;
                    })

                // When cancelled, calculate and print results
                .finallyDo(
                    () -> {
                      double[] positions = drive.getWheelRadiusCharacterizationPositions();
                      double wheelDelta = 0.0;
                      for (int i = 0; i < 4; i++) {
                        wheelDelta += Math.abs(positions[i] - state.positions[i]) / 4.0;
                      }
                      double wheelRadius = (state.gyroDelta * Drive.DRIVE_BASE_RADIUS) / wheelDelta;

                      NumberFormat formatter = new DecimalFormat("#0.000");
                      System.out.println(
                          "********** Wheel Radius Characterization Results **********");
                      System.out.println(
                          "\tWheel Delta: " + formatter.format(wheelDelta) + " radians");
                      System.out.println(
                          "\tGyro Delta: " + formatter.format(state.gyroDelta) + " radians");
                      System.out.println(
                          "\tWheel Radius: "
                              + formatter.format(wheelRadius)
                              + " meters, "
                              + formatter.format(Units.metersToInches(wheelRadius))
                              + " inches");
                    })));
  }

  private static class WheelRadiusCharacterizationState {
    double[] positions = new double[4];
    Rotation2d lastAngle = Rotation2d.kZero;
    double gyroDelta = 0.0;
  }
}
