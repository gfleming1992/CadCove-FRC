// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

package frc.robot.subsystems.drive;

import static edu.wpi.first.units.Units.*;

import com.ctre.phoenix6.BaseStatusSignal;
import com.pathplanner.lib.auto.AutoBuilder;
import com.pathplanner.lib.config.ModuleConfig;
import com.pathplanner.lib.config.PIDConstants;
import com.pathplanner.lib.config.RobotConfig;
import com.pathplanner.lib.controllers.PPHolonomicDriveController;
import com.pathplanner.lib.pathfinding.Pathfinding;
import com.pathplanner.lib.util.PathPlannerLogging;
import edu.wpi.first.hal.FRCNetComm.tInstances;
import edu.wpi.first.hal.FRCNetComm.tResourceType;
import edu.wpi.first.hal.HAL;
import edu.wpi.first.math.Matrix;
import edu.wpi.first.math.estimator.SwerveDrivePoseEstimator;
import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.geometry.Translation2d;
import edu.wpi.first.math.geometry.Twist2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;
import edu.wpi.first.math.kinematics.SwerveDriveKinematics;
import edu.wpi.first.math.kinematics.SwerveModulePosition;
import edu.wpi.first.math.kinematics.SwerveModuleState;
import edu.wpi.first.math.numbers.N1;
import edu.wpi.first.math.numbers.N3;
import edu.wpi.first.math.system.plant.DCMotor;
import edu.wpi.first.wpilibj.Alert;
import edu.wpi.first.wpilibj.Alert.AlertType;
import edu.wpi.first.wpilibj.DriverStation;
import edu.wpi.first.wpilibj.DriverStation.Alliance;
import edu.wpi.first.wpilibj.smartdashboard.Field2d;
import edu.wpi.first.wpilibj.smartdashboard.SmartDashboard;
import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.SubsystemBase;
import edu.wpi.first.wpilibj2.command.sysid.SysIdRoutine;
import frc.robot.Constants;
import frc.robot.Constants.Mode;
import frc.robot.Constants.SimPhysicsConstants;
import frc.robot.generated.TunerConstants;
import frc.robot.util.LocalADStarAK;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Consumer;
import org.littletonrobotics.junction.Logger;

public class Drive extends SubsystemBase {
  // TunerConstants doesn't include these constants, so they are declared locally
  static final double ODOMETRY_FREQUENCY = TunerConstants.kCANBus1.isNetworkFD() ? 250.0 : 100.0;
  public static final double DRIVE_BASE_RADIUS =
      Math.max(
          Math.max(
              Math.hypot(TunerConstants.FrontLeft.LocationX, TunerConstants.FrontLeft.LocationY),
              Math.hypot(TunerConstants.FrontRight.LocationX, TunerConstants.FrontRight.LocationY)),
          Math.max(
              Math.hypot(TunerConstants.BackLeft.LocationX, TunerConstants.BackLeft.LocationY),
              Math.hypot(TunerConstants.BackRight.LocationX, TunerConstants.BackRight.LocationY)));

  // PathPlanner config constants
  private static final double ROBOT_MASS_KG = 74.088;
  private static final double ROBOT_MOI = 6.883;
  private static final double WHEEL_COF = 1.2;
  private static final RobotConfig PP_CONFIG =
      new RobotConfig(
          ROBOT_MASS_KG,
          ROBOT_MOI,
          new ModuleConfig(
              TunerConstants.FrontLeft.WheelRadius,
              TunerConstants.kSpeedAt12Volts.in(MetersPerSecond),
              WHEEL_COF,
              DCMotor.getKrakenX60Foc(1)
                  .withReduction(TunerConstants.FrontLeft.DriveMotorGearRatio),
              TunerConstants.FrontLeft.SlipCurrent,
              1),
          getModuleTranslations());

  static final Lock odometryLock = new ReentrantLock();
  private final GyroIO gyroIO;
  private final GyroIOInputsAutoLogged gyroInputs = new GyroIOInputsAutoLogged();
  private final Module[] modules = new Module[4]; // FL, FR, BL, BR
  private final SysIdRoutine sysId;
  private final Alert gyroDisconnectedAlert =
      new Alert("Disconnected gyro, using kinematics as fallback.", AlertType.kError);

  // All CAN status signals from gyro + 4 modules, refreshed in one batched call.
  private final BaseStatusSignal[] allDriveSignals;

  private SwerveDriveKinematics kinematics = new SwerveDriveKinematics(getModuleTranslations());
  private Rotation2d rawGyroRotation = Rotation2d.kZero;
  private SwerveModulePosition[] lastModulePositions = // For delta tracking
      new SwerveModulePosition[] {
        new SwerveModulePosition(),
        new SwerveModulePosition(),
        new SwerveModulePosition(),
        new SwerveModulePosition()
      };
  private SwerveDrivePoseEstimator poseEstimator =
      new SwerveDrivePoseEstimator(kinematics, rawGyroRotation, lastModulePositions, Pose2d.kZero);

  // --- Sim inertia model ---
  // Tracks the "actual" chassis speeds after filtering through the inertia model.
  // Only used when Constants.currentMode == Mode.SIM.
  private ChassisSpeeds simActualSpeeds = new ChassisSpeeds();

  // Log rate-limiting — staggered offset 3 so Drive logs don't spike
  // on the same cycle as Vision (offset 0) or other subsystems.
  private int logCounter = 3;
  private boolean shouldLog = false;
  private volatile Pose2d[] latestActivePath = new Pose2d[] {};
  private final Field2d field = new Field2d();

  public Drive(
      GyroIO gyroIO,
      ModuleIO flModuleIO,
      ModuleIO frModuleIO,
      ModuleIO blModuleIO,
      ModuleIO brModuleIO) {
    this.gyroIO = gyroIO;
    modules[0] = new Module(flModuleIO, 0, TunerConstants.FrontLeft);
    modules[1] = new Module(frModuleIO, 1, TunerConstants.FrontRight);
    modules[2] = new Module(blModuleIO, 2, TunerConstants.BackLeft);
    modules[3] = new Module(brModuleIO, 3, TunerConstants.BackRight);

    // Usage reporting for swerve template
    HAL.report(tResourceType.kResourceType_RobotDrive, tInstances.kRobotDriveSwerve_AdvantageKit);

    // Build a single array of every CAN signal from all modules + gyro so
    // Drive.periodic() can refresh them all with ONE BaseStatusSignal.refreshAll()
    // call instead of 13 separate round-trips.
    {
      BaseStatusSignal[] gyroSigs = gyroIO.getStatusSignals();
      int totalLen = gyroSigs.length;
      for (var m : modules) totalLen += m.getStatusSignals().length;
      allDriveSignals = new BaseStatusSignal[totalLen];
      int idx = 0;
      for (BaseStatusSignal s : gyroSigs) allDriveSignals[idx++] = s;
      for (var m : modules)
        for (BaseStatusSignal s : m.getStatusSignals()) allDriveSignals[idx++] = s;
    }

    // Start odometry thread
    PhoenixOdometryThread.getInstance().start();

    // Configure AutoBuilder for PathPlanner
    AutoBuilder.configure(
        this::getPose,
        this::setPose,
        this::getChassisSpeeds,
        (Consumer<ChassisSpeeds>) this::runVelocity,
        new PPHolonomicDriveController(
            new PIDConstants(5.0, 0.0, 0.0), new PIDConstants(5.0, 0.0, 0.0)),
        PP_CONFIG,
        () -> DriverStation.getAlliance().orElse(Alliance.Blue) == Alliance.Red,
        this);
    Pathfinding.setPathfinder(new LocalADStarAK());
    PathPlannerLogging.setLogActivePathCallback(
        (activePath) -> {
          latestActivePath = activePath.toArray(new Pose2d[0]);
        });
    PathPlannerLogging.setLogTargetPoseCallback(
        (targetPose) -> {
          if (shouldLog) Logger.recordOutput("Odometry/TrajectorySetpoint", targetPose);
        });

    // Publish live field map widget for Driver Station dashboards.
    SmartDashboard.putData("Field", field);

    // Configure SysId
    sysId =
        new SysIdRoutine(
            new SysIdRoutine.Config(
                null,
                null,
                null,
                (state) -> Logger.recordOutput("Drive/SysIdState", state.toString())),
            new SysIdRoutine.Mechanism(
                (voltage) -> runCharacterization(voltage.in(Volts)), null, this));
  }

  @Override
  public void periodic() {
    // Rate-limited logging — offset from other subsystems to stagger NT writes.
    logCounter++;
    shouldLog = logCounter >= Constants.kLogInterval;
    if (shouldLog) logCounter = 0;

    // Batch-refresh ALL drive CAN signals (gyro + 4 modules = ~38 signals) in
    // ONE call instead of 13 separate refreshAll() calls. This eliminates 12
    // CAN round-trips per cycle and is the single biggest Drive.periodic() win.
    if (allDriveSignals.length > 0) {
      BaseStatusSignal.refreshAll(allDriveSignals);
    }

    odometryLock.lock(); // Prevents odometry updates while reading data
    gyroIO.updateInputs(gyroInputs);
    Logger.processInputs("Drive/Gyro", gyroInputs);
    for (var module : modules) {
      module.periodic();
    }
    odometryLock.unlock();

    // Stop moving when disabled
    if (DriverStation.isDisabled()) {
      for (var module : modules) {
        module.stop();
      }
    }

    // Log empty setpoint states when disabled
    if (DriverStation.isDisabled() && shouldLog) {
      Logger.recordOutput("SwerveStates/Setpoints", new SwerveModuleState[] {});
      Logger.recordOutput("SwerveStates/SetpointsOptimized", new SwerveModuleState[] {});
    }

    // Update odometry
    double[] sampleTimestamps =
        modules[0].getOdometryTimestamps(); // All signals are sampled together
    int gyroSampleCount = gyroInputs.odometryYawPositions.length;
    if (shouldLog) {
      Logger.recordOutput("Drive/Odometry/ModuleSampleCount", sampleTimestamps.length);
      Logger.recordOutput("Drive/Odometry/GyroSampleCount", gyroSampleCount);
      Logger.recordOutput(
          "Drive/Odometry/GyroSampleMismatch",
          gyroInputs.connected && gyroSampleCount != sampleTimestamps.length);
    }
    int sampleCount = sampleTimestamps.length;
    for (int i = 0; i < sampleCount; i++) {
      // Read wheel positions and deltas from each module
      SwerveModulePosition[] modulePositions = new SwerveModulePosition[4];
      SwerveModulePosition[] moduleDeltas = new SwerveModulePosition[4];
      for (int moduleIndex = 0; moduleIndex < 4; moduleIndex++) {
        modulePositions[moduleIndex] = modules[moduleIndex].getOdometryPositions()[i];
        moduleDeltas[moduleIndex] =
            new SwerveModulePosition(
                modulePositions[moduleIndex].distanceMeters
                    - lastModulePositions[moduleIndex].distanceMeters,
                modulePositions[moduleIndex].angle);
        lastModulePositions[moduleIndex] = modulePositions[moduleIndex];
      }

      // Update gyro angle
      if (gyroInputs.connected) {
        // Prefer the time-aligned gyro sample, but fall back to the latest yaw
        // if the gyro queue is shorter than the module queues.
        rawGyroRotation =
            i < gyroSampleCount ? gyroInputs.odometryYawPositions[i] : gyroInputs.yawPosition;
      } else {
        // Use the angle delta from the kinematics and module deltas
        Twist2d twist = kinematics.toTwist2d(moduleDeltas);
        rawGyroRotation = rawGyroRotation.plus(new Rotation2d(twist.dtheta));
      }

      // Apply update
      poseEstimator.updateWithTime(sampleTimestamps[i], rawGyroRotation, modulePositions);
    }

    // Always update Field2d so robot pose is live on the dashboard map.
    field.setRobotPose(getPose());

    // Update gyro alert
    gyroDisconnectedAlert.set(!gyroInputs.connected && Constants.currentMode != Mode.SIM);

    // Manual gated logging — replaces @AutoLogOutput annotations that fire every cycle.
    if (shouldLog) {
      Logger.recordOutput("SwerveStates/Measured", getModuleStates());
      Logger.recordOutput("SwerveChassisSpeeds/Measured", getChassisSpeeds());
      Logger.recordOutput("Odometry/Robot", getPose());
      Logger.recordOutput("Odometry/Trajectory", latestActivePath);
    }
  }

  /**
   * Runs the drive at the desired velocity.
   *
   * @param speeds Speeds in meters/sec
   */
  public void runVelocity(ChassisSpeeds speeds) {
    runVelocity(speeds, Translation2d.kZero);
  }

  public void runVelocity(ChassisSpeeds speeds, Translation2d centerOfRotationMeters) {
    // In sim mode, filter the commanded speeds through an inertial model with
    // velocity-dependent drag so that:
    //   1) The robot cannot change velocity instantaneously (tau-based inertia).
    //   2) There is a smooth, continuous soft speed cap — the robot asymptotically
    //      approaches the limit rather than hitting a brick wall.
    //
    // Drag model:  alpha_eff = alpha_base * max(0, 1 - (|v| / softCap) ^ n)
    //   - When |v| is small the full alpha applies → normal acceleration.
    //   - As |v| approaches softCap the alpha → 0 → no more acceleration.
    //   - The exponent n controls the rolloff shape (see SimPhysicsConstants).
    ChassisSpeeds effectiveSpeeds = speeds;
    if (Constants.currentMode == Mode.SIM && !org.instantcad.frc.TwinBridge.enabled() && !DriverStation.isAutonomous()) {
      final double dt = 0.02; // 50 Hz loop
      final double exp = SimPhysicsConstants.kDragExponent;

      // Base response alphas (from inertia tau values)
      double alphaVx = 1.0 - Math.exp(-dt / SimPhysicsConstants.kTranslationalTauSeconds);
      double alphaVy = 1.0 - Math.exp(-dt / SimPhysicsConstants.kLateralTauSeconds);
      double alphaOmega = 1.0 - Math.exp(-dt / SimPhysicsConstants.kRotationalTauSeconds);

      // Current translational speed magnitude (used for drag on both vx & vy)
      double currentTransSpeed =
          Math.hypot(simActualSpeeds.vxMetersPerSecond, simActualSpeeds.vyMetersPerSecond);
      double transSoftCap = SimPhysicsConstants.kTranslationalSoftCapMps;
      double rotSoftCap = SimPhysicsConstants.kRotationalSoftCapRadPerSec;

      // Drag factors: 1 at rest, smoothly → 0 at the cap.
      // Only applied when accelerating *toward* the cap (not when decelerating).
      double transDrag =
          Math.max(0.0, 1.0 - Math.pow(Math.min(currentTransSpeed / transSoftCap, 1.0), exp));
      double rotDrag =
          Math.max(
              0.0,
              1.0
                  - Math.pow(
                      Math.min(Math.abs(simActualSpeeds.omegaRadiansPerSecond) / rotSoftCap, 1.0),
                      exp));

      // Determine if the command would increase speed (accelerating) or decrease it
      // (decelerating). Only apply drag when accelerating — braking should always be
      // fully responsive.
      double commandedTransSpeed = Math.hypot(speeds.vxMetersPerSecond, speeds.vyMetersPerSecond);
      boolean transAccelerating = commandedTransSpeed >= currentTransSpeed;
      boolean rotAccelerating =
          Math.abs(speeds.omegaRadiansPerSecond) >= Math.abs(simActualSpeeds.omegaRadiansPerSecond);

      double effectiveAlphaVx = transAccelerating ? alphaVx * transDrag : alphaVx;
      double effectiveAlphaVy = transAccelerating ? alphaVy * transDrag : alphaVy;
      double effectiveAlphaOmega = rotAccelerating ? alphaOmega * rotDrag : alphaOmega;

      simActualSpeeds =
          new ChassisSpeeds(
              simActualSpeeds.vxMetersPerSecond
                  + effectiveAlphaVx
                      * (speeds.vxMetersPerSecond - simActualSpeeds.vxMetersPerSecond),
              simActualSpeeds.vyMetersPerSecond
                  + effectiveAlphaVy
                      * (speeds.vyMetersPerSecond - simActualSpeeds.vyMetersPerSecond),
              simActualSpeeds.omegaRadiansPerSecond
                  + effectiveAlphaOmega
                      * (speeds.omegaRadiansPerSecond - simActualSpeeds.omegaRadiansPerSecond));

      effectiveSpeeds = simActualSpeeds;

      // Log for tuning in AdvantageScope
      if (shouldLog) {
        Logger.recordOutput("SwerveChassisSpeeds/Commanded", speeds);
        Logger.recordOutput("SwerveChassisSpeeds/SimActual", simActualSpeeds);
        Logger.recordOutput(
            "SimPhysics/TranslationalSpeed",
            Math.hypot(simActualSpeeds.vxMetersPerSecond, simActualSpeeds.vyMetersPerSecond));
        Logger.recordOutput(
            "SimPhysics/RotationalSpeed", Math.abs(simActualSpeeds.omegaRadiansPerSecond));
        Logger.recordOutput("SimPhysics/TransDragFactor", transAccelerating ? transDrag : 1.0);
        Logger.recordOutput("SimPhysics/RotDragFactor", rotAccelerating ? rotDrag : 1.0);
      }

      // Feed the simulated gyro with the inertia-filtered omega
      if (gyroIO instanceof GyroIOSim simGyro) {
        simGyro.updateFromChassisSpeeds(simActualSpeeds, dt);
      }
    } else if (Constants.currentMode == Mode.SIM && !org.instantcad.frc.TwinBridge.enabled()) {
      // In autonomous: bypass inertia model but still update the sim gyro
      // with the raw commanded speeds so heading tracks correctly.
      final double dt = 0.02;
      simActualSpeeds = speeds;
      if (gyroIO instanceof GyroIOSim simGyro) {
        simGyro.updateFromChassisSpeeds(speeds, dt);
      }
    }

    // Calculate module setpoints
    ChassisSpeeds discreteSpeeds = ChassisSpeeds.discretize(effectiveSpeeds, 0.02);
    SwerveModuleState[] setpointStates =
        kinematics.toSwerveModuleStates(discreteSpeeds, centerOfRotationMeters);
    SwerveDriveKinematics.desaturateWheelSpeeds(setpointStates, TunerConstants.kSpeedAt12Volts);

    // Log unoptimized setpoints and setpoint speeds
    if (shouldLog) {
      Logger.recordOutput("SwerveStates/Setpoints", setpointStates);
      Logger.recordOutput("SwerveChassisSpeeds/Setpoints", discreteSpeeds);
    }

    // Send setpoints to modules
    for (int i = 0; i < 4; i++) {
      modules[i].runSetpoint(setpointStates[i]);
    }

    // Log optimized setpoints (runSetpoint mutates each state)
    if (shouldLog) {
      Logger.recordOutput("SwerveStates/SetpointsOptimized", setpointStates);
    }
  }

  /** Runs the drive in a straight line with the specified drive output. */
  public void runCharacterization(double output) {
    for (int i = 0; i < 4; i++) {
      modules[i].runCharacterization(output);
    }
  }

  /** Stops the drive. */
  public void stop() {
    runVelocity(new ChassisSpeeds());
  }

  /**
   * Stops the drive and turns the modules to an X arrangement to resist movement. The modules will
   * return to their normal orientations the next time a nonzero velocity is requested.
   */
  public void stopWithX() {
    Rotation2d[] headings = new Rotation2d[4];
    for (int i = 0; i < 4; i++) {
      headings[i] = getModuleTranslations()[i].getAngle();
    }
    kinematics.resetHeadings(headings);
    stop();
  }

  /** Returns a command to run a quasistatic test in the specified direction. */
  public Command sysIdQuasistatic(SysIdRoutine.Direction direction) {
    return run(() -> runCharacterization(0.0))
        .withTimeout(1.0)
        .andThen(sysId.quasistatic(direction));
  }

  /** Returns a command to run a dynamic test in the specified direction. */
  public Command sysIdDynamic(SysIdRoutine.Direction direction) {
    return run(() -> runCharacterization(0.0)).withTimeout(1.0).andThen(sysId.dynamic(direction));
  }

  /** Returns the module states (turn angles and drive velocities) for all of the modules. */
  private SwerveModuleState[] getModuleStates() {
    SwerveModuleState[] states = new SwerveModuleState[4];
    for (int i = 0; i < 4; i++) {
      states[i] = modules[i].getState();
    }
    return states;
  }

  /** Returns the module positions (turn angles and drive positions) for all of the modules. */
  private SwerveModulePosition[] getModulePositions() {
    SwerveModulePosition[] states = new SwerveModulePosition[4];
    for (int i = 0; i < 4; i++) {
      states[i] = modules[i].getPosition();
    }
    return states;
  }

  /** Returns the measured chassis speeds of the robot. */
  public ChassisSpeeds getChassisSpeeds() {
    return kinematics.toChassisSpeeds(getModuleStates());
  }

  /** Returns the position of each module in radians. */
  public double[] getWheelRadiusCharacterizationPositions() {
    double[] values = new double[4];
    for (int i = 0; i < 4; i++) {
      values[i] = modules[i].getWheelRadiusCharacterizationPosition();
    }
    return values;
  }

  /** Returns the average velocity of the modules in rotations/sec (Phoenix native units). */
  public double getFFCharacterizationVelocity() {
    double output = 0.0;
    for (int i = 0; i < 4; i++) {
      output += modules[i].getFFCharacterizationVelocity() / 4.0;
    }
    return output;
  }

  /** Returns the current odometry pose. */
  public Pose2d getPose() {
    return poseEstimator.getEstimatedPosition();
  }

  /** Returns the current odometry rotation. */
  public Rotation2d getRotation() {
    return getPose().getRotation();
  }

  /**
   * Returns the raw Pigeon2 yaw — NOT fused with vision. Use this when feeding
   * SetRobotOrientation() so that a bad vision measurement cannot corrupt the heading we send back
   * to the Limelight for MegaTag 2.
   */
  public Rotation2d getRawGyroRotation() {
    return rawGyroRotation;
  }

  /**
   * Returns the raw Pigeon2 yaw rate in degrees per second. Comes directly from the IMU signal, not
   * from kinematics, so it is valid even while stationary.
   */
  public double getRawGyroYawRateDegPerSec() {
    return Math.toDegrees(gyroInputs.yawVelocityRadPerSec);
  }

  /** Resets the current odometry pose. */
  public void setPose(Pose2d pose) {
    odometryLock.lock();
    try {
      gyroIO.setYaw(pose.getRotation());
      rawGyroRotation = pose.getRotation();
      poseEstimator.resetPosition(rawGyroRotation, getModulePositions(), pose);
    } finally {
      odometryLock.unlock();
    }
  }

  /**
   * Seeds only the gyro heading from a vision-derived yaw, without touching XY odometry. The pose
   * estimator is updated so its rotation matches the new gyro heading, but X/Y remain unchanged.
   * Use this during disabled pre-match when MT1 has a very confident yaw but XY is not yet trusted.
   */
  public void setGyroYaw(Rotation2d yaw) {
    odometryLock.lock();
    try {
      gyroIO.setYaw(yaw);
      rawGyroRotation = yaw;
      // Re-anchor the pose estimator at the same XY with the new heading.
      Pose2d currentPose = poseEstimator.getEstimatedPosition();
      Pose2d correctedPose = new Pose2d(currentPose.getTranslation(), yaw);
      poseEstimator.resetPosition(rawGyroRotation, getModulePositions(), correctedPose);
    } finally {
      odometryLock.unlock();
    }
  }

  /** Re-applies the current estimated heading to the gyro for enabled-mode vision seeding. */
  public void lockGyroHeadingToEstimatedPose() {
    Pose2d estimatedPose = getPose();
    setPose(estimatedPose);
    Logger.recordOutput("Drive/GyroHeadingLockDeg", estimatedPose.getRotation().getDegrees());
  }

  /** Adds a new timestamped vision measurement. */
  public void addVisionMeasurement(
      Pose2d visionRobotPoseMeters,
      double timestampSeconds,
      Matrix<N3, N1> visionMeasurementStdDevs) {
    poseEstimator.addVisionMeasurement(
        visionRobotPoseMeters, timestampSeconds, visionMeasurementStdDevs);
  }

  /** Returns the maximum linear speed in meters per sec. */
  public double getMaxLinearSpeedMetersPerSec() {
    return TunerConstants.kSpeedAt12Volts.in(MetersPerSecond);
  }

  /** Returns the maximum angular speed in radians per sec. */
  public double getMaxAngularSpeedRadPerSec() {
    return getMaxLinearSpeedMetersPerSec() / DRIVE_BASE_RADIUS;
  }

  /** Returns an array of module translations. */
  public static Translation2d[] getModuleTranslations() {
    return new Translation2d[] {
      new Translation2d(TunerConstants.FrontLeft.LocationX, TunerConstants.FrontLeft.LocationY),
      new Translation2d(TunerConstants.FrontRight.LocationX, TunerConstants.FrontRight.LocationY),
      new Translation2d(TunerConstants.BackLeft.LocationX, TunerConstants.BackLeft.LocationY),
      new Translation2d(TunerConstants.BackRight.LocationX, TunerConstants.BackRight.LocationY)
    };
  }

  /** Returns the drive motor current for a specific module (0=FL,1=FR,2=BL,3=BR). */
  public double getModuleDriveCurrentAmps(int index) {
    return modules[index].getDriveCurrentAmps();
  }

  /** Returns the turn motor current for a specific module (0=FL,1=FR,2=BL,3=BR). */
  public double getModuleTurnCurrentAmps(int index) {
    return modules[index].getTurnCurrentAmps();
  }

  /** Returns the total supply current of all 8 drivetrain motors (4 drive + 4 turn). */
  public double getTotalDriveTrainCurrentAmps() {
    double total = 0.0;
    for (int i = 0; i < 4; i++) {
      total += modules[i].getDriveCurrentAmps() + modules[i].getTurnCurrentAmps();
    }
    return total;
  }
}
