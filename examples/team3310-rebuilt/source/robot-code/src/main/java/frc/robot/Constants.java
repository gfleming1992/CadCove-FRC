// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.
package frc.robot;

import com.ctre.phoenix6.configs.ClosedLoopRampsConfigs;
import com.ctre.phoenix6.configs.OpenLoopRampsConfigs;
import com.ctre.phoenix6.signals.InvertedValue;
import com.ctre.phoenix6.signals.NeutralModeValue;
import edu.wpi.first.math.util.Units;
import edu.wpi.first.wpilibj.RobotBase;
import frc.lib.drivers.CANDeviceId;
import frc.lib.subsystems.ServoMotorSubsystemConfig;
import frc.lib.subsystems.ServoMotorSubsystemWithCanCoderConfig;
import frc.robot.generated.TunerConstants;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;

/**
 * This class defines the runtime mode used by AdvantageKit. The mode is always "real" when running
 * on a roboRIO. Change the value of "simMode" to switch between "sim" (physics sim) and "replay"
 * (log replay from a file).
 */
public final class Constants {
  public static final Mode simMode = Mode.SIM;
  public static final Mode currentMode = RobotBase.isReal() ? Mode.REAL : simMode;
  // NOTE: non-final — refreshed every cycle in Robot.robotPeriodic() once DS connects.

  private static final String[] kLocalMacAddresses = findLocalMacAddresses();
  public static final String[] kPracticeBotMacAddresses = {
    "38:41:A5:68:34:74", "00:80:2F:33:CF:65"
  };
  // TODO: Fill in the bravo roboRIO MAC once it is known from logs.
  public static final String[] kBravoBotMacAddresses = {};
  public static final String[] kCompBotMacAddresses = {
    "12:2C:57:6C:7E:04", "DB:2B:7E:E6:11:0B", "00:80:2F:36:FE:54"
  };

  // Auto-detect the robot from the local roboRIO MAC address. Unknown MACs fall back to PRACTICE.
  public static final Bot currentBot = detectCurrentBot();
  public static final boolean kIsPracticeBot = currentBot == Bot.PRACTICE;

  // Global motor voltage limit applied to all TalonFX motors
  public static final double kMotorPeakVoltage = 12.0;

  // Field dimensions for 2026 Reefscape
  public static final double kFieldLengthMeters = 16.54;
  public static final double kFieldWidthMeters = 8.21;

  // Global log rate-limiting — every Nth 20 ms cycle.
  // All subsystems share this interval but use different counter offsets
  // so their Logger.recordOutput calls are staggered across cycles.
  public static final int kLogInterval = 10; // ~5 Hz at 50 Hz loop

  public static enum Mode {
    /** Running on a real robot. */
    REAL,

    /** Running a physics simulator. */
    SIM,

    /** Replaying from a log file. */
    REPLAY
  }

  public static enum Bot {
    /** Software robot (default configuration) */
    SOFTWARE,
    /** Bravo robot */
    BRAVO,
    /** Competition robot */
    COMP,
    // Add more robot variants here as needed, e.g.:
    // COMPETITION,
    PRACTICE
  }

  /** Logical CAN bus aliases so per-bot routing is centralized. */
  public static final class CanBusNames {
    private CanBusNames() {}

    public static final String KCANBUS1_STRING = TunerConstants.kCANBus1.getName();
    public static final String kRio = TunerConstants.kCANBusRio.getName();

    /**
     * Returns the CAN bus name for a superstructure device. On the comp bot devices are split
     * across kCANBus1, kCANBus2, and kCANBusRio. On the practice bot everything routes to kCANBus1
     * — the other bus objects exist but are never used.
     */
    public static String superstructureFor(int deviceId) {
      if (currentBot != Bot.COMP) {
        return KCANBUS1_STRING;
      }

      return switch (deviceId) {
        case 12, 13, 15, 20, 21, 22, 25, 26, 27, 28, 29 -> TunerConstants.kCANBus2.getName();
        case 30 -> kRio;
        default -> KCANBUS1_STRING;
      };
    }
  }

  public static final ClosedLoopRampsConfigs makeDefaultClosedLoopRampConfig() {
    return new ClosedLoopRampsConfigs()
        .withDutyCycleClosedLoopRampPeriod(0.02)
        .withTorqueClosedLoopRampPeriod(0.02)
        .withVoltageClosedLoopRampPeriod(0.02);
  }

  public static final OpenLoopRampsConfigs makeDefaultOpenLoopRampConfig() {
    return new OpenLoopRampsConfigs()
        .withDutyCycleOpenLoopRampPeriod(0.02)
        .withTorqueOpenLoopRampPeriod(0.02)
        .withVoltageOpenLoopRampPeriod(0.02);
  }

  // #region Vision
  // -------------------------------------------------------------------------
  // MegaTag 2 Vision Constants — 4× Limelight 4 cameras
  // Camera positions are from the Practice Robot Software Design Sheet.
  // Coordinate system: LL Robot-Space — forward(+X), side(+Y right), up(+Z).
  // All linear values converted from inches to meters.
  // -------------------------------------------------------------------------
  public static final class VisionConstants {
    // Camera hostnames (must match Limelight web UI / network config)
    public static final String kLimelightFront = "limelight-front";
    public static final String kLimelightRear = "limelight-rear";
    public static final String kLimelightRight = "limelight-right";
    public static final String kLimelightLeft = "limelight-left";

    public static final String[] kCameraNames = {
      kLimelightFront, kLimelightRear, kLimelightRight, kLimelightLeft
    };

    // ---- Camera #1  (Rear-facing) ----
    // SDS: X = -1.098 in, Y = 0 in, Z = 20.338 in
    //      Zrot = 180°, Yrot(pitch) = -20°, Xrot(roll) = 0° (TBD treated as 0)
    public static final double kRearForwardM = Units.inchesToMeters(-1.098);
    public static final double kRearSideM = Units.inchesToMeters(0.0);
    public static final double kRearUpM = Units.inchesToMeters(20.338);
    public static final double kRearRollDeg = 0.0;
    public static final double kRearPitchDeg = 20.0;
    public static final double kRearYawDeg = 180.0;

    // ---- Camera #2  (Right-side, mounted upside-down) ----
    // SDS: X = -3.132 in, Y = 13.179 in, Z = 13.558 in
    //      Zrot = -90°, Yrot = 180° (upside-down), Xrot = 0°
    public static final double kRightForwardM = Units.inchesToMeters(-3.132);
    public static final double kRightSideM = Units.inchesToMeters(13.179);
    public static final double kRightUpM = Units.inchesToMeters(12.859);
    public static final double kRightRollDeg = 180.0; // upside-down
    public static final double kRightPitchDeg = 0.0;
    public static final double kRightYawDeg = -90.0;

    // ---- Camera #3  (Left-side) ----
    // SDS: X = -3.312 in, Y = -13.179 in, Z = 13.558 in
    //      Zrot = 90°, Yrot = 0°, Xrot = 0°
    public static final double kLeftForwardM = Units.inchesToMeters(-3.312);
    public static final double kLeftSideM = Units.inchesToMeters(-13.179);
    public static final double kLeftUpM = Units.inchesToMeters(13.558);
    public static final double kLeftRollDeg = 0.0;
    public static final double kLeftPitchDeg = 0.0;
    public static final double kLeftYawDeg = 90.0;

    // Camera poses packed as {forward, side, up, roll, pitch, yaw} for
    // LimelightHelpers.setCameraPose_RobotSpace()
    public static final double[][] kCameraPoses = {
      {kRearForwardM, kRearSideM, kRearUpM, kRearRollDeg, kRearPitchDeg, kRearYawDeg},
      {kRightForwardM, kRightSideM, kRightUpM, kRightRollDeg, kRightPitchDeg, kRightYawDeg},
      {kLeftForwardM, kLeftSideM, kLeftUpM, kLeftRollDeg, kLeftPitchDeg, kLeftYawDeg}
    };

    // ---- Per-camera trust weighting ----
    // Each camera can have a different trust factor that multiplies its stddevs.
    // Higher value = less trust (wider stddev = smoother but slower convergence).
    //   1.0 = default trust
    //   >1.0 = trust this camera LESS  (e.g., poor mounting, lower res, frequent occlusion)
    //   <1.0 = trust this camera MORE  (e.g., best-positioned, highest quality)
    // Order matches kCameraNames: {front, rear, right, left}
    public static final double[] kCameraStdDevFactors = {
      1.0, // Front  — centered, high mount, faces forward
      1.0, // Rear   — LL 3G, re-enabled for all 4 cameras seeding odometry
      1.0, // Right  — side-mount
      1.0, // Left   — side-mount, symmetric to right
    };

    // Tags the Limelights are allowed to track. Pushed via SetFiducialIDFiltersOverride
    // on boot.  Tags NOT in this list are completely ignored at the hardware level —
    // they never enter the MT1/MT2 solve.
    // Currently using hub tags only — wall/outpost tags excluded because the
    // shop field walls are frequently mis-aligned and those tags give bad data.
    // Excluded tags are commented out and can be re-enabled per-event.
    public static final int[] kValidTagIds = {
      2,
      3,
      4,
      5,
      8,
      9,
      10,
      11, // red hub tags
      13,
      14, // red dep tags
      // 15,
      // 16, // red tower tags
      18,
      19,
      20,
      21,
      24,
      25,
      26,
      27, // blue hub tags
      29,
      30 // blue dep tags
      // 31,
      // 32 // blue tower tags
    };

    // ---- Tag-specific trust weighting ----
    // Trust hub tags 3× more than wall tags.
    // The pose estimator consumes stddev (lower = more trust), and internally
    // weights roughly by 1/stddev². To get a true 3× trust ratio in weight,
    // hub-tag stddev is scaled by 1/sqrt(3) relative to wall tags.
    public static final double kHubVsWallTrustRatio = 3.0;
    public static final double kHubTagStdDevFactor = 1.0 / Math.sqrt(kHubVsWallTrustRatio);
    public static final double kWallTagStdDevFactor = 1.0;
    public static final double kUnknownTagStdDevFactor = 1.0;

    public static boolean isHubTagId(int tagId) {
      return switch (tagId) {
        case 2,
                3,
                4,
                5,
                8,
                9,
                10,
                11, // red hub
                18,
                19,
                20,
                21,
                24,
                25,
                26,
                27 // blue hub
            ->
            true;
        default -> false;
      };
    }

    public static boolean isWallTagId(int tagId) {
      return switch (tagId) {
        case 13,
                14,
                15,
                16, // red wall
                29,
                30,
                31,
                32 // blue wall
            ->
            true;
        default -> false;
      };
    }

    public static double getTagTrustStdDevFactor(int tagId) {
      if (isHubTagId(tagId)) {
        return kHubTagStdDevFactor;
      }
      if (isWallTagId(tagId)) {
        return kWallTagStdDevFactor;
      }
      return kUnknownTagStdDevFactor;
    }

    // ---- Filtering thresholds ----
    // Maximum angular velocity (deg/s) before we reject vision updates.
    // Fast rotation causes motion-blur → bad detections.
    public static final double kMaxAngularVelocityDegPerSec = 360.0;

    // Maximum average tag distance (meters) before rejecting the observation.
    // Tags beyond this distance have poor corner resolution and produce noisy
    // / unreliable pose solves.  With hub-only tags this also prevents the
    // far hub from polluting the estimate when you can barely see it.
    //   6.0 m = covers the home zone + outpost comfortably without seeing the
    //           other hub across the field (~8 m away).
    // Set to Double.MAX_VALUE to disable the cutoff entirely.
    public static final double kMaxAvgTagDistMeters = 4.9;

    // ---- Distance-based std-dev scaling ----
    // Scale the XY stddev by (avgTagDist / kDistScalingRefMeters)² so that
    // far-away tags are trusted less.  At the reference distance the stddev
    // is unchanged; at 2× the reference it's 4× larger, etc.
    //   true  = enable distance scaling (recommended)
    //   false = flat stddev regardless of distance (legacy behavior)
    public static final boolean kDistanceScalingEnabled = true;

    // Reference distance for scaling — at this distance the base multiplier
    // is applied with no additional scaling.  Typical scoring distance is
    // ~1–2 m from the hub.
    public static final double kDistScalingRefMeters = 2.0;

    // Minimum average tag area (% of image) required to trust a single-tag result
    public static final double kMinTagAreaForSingleTag = 0.1;

    // Maximum allowed distance from prior pose before rejecting (meters).
    // This catches gross outliers (e.g., ghost detections on the far side of the
    // field).  Keep this large enough that normal drift doesn't trigger it.
    public static double kMaxPoseJumpMeters = 0.5;

    // Maximum accepted Limelight-reported XY std dev (meters) for MT2.
    // Measurements with stddevs above this are rejected outright — they indicate
    // poor tag geometry or excessive distance and would add noise even with a
    // high stddev weight.  Set to 0.0 to disable this filter.
    public static double kMT2MaxAcceptedStdDev = 0.3;

    // Maximum measurement age (seconds) before we reject a vision result.
    // Stale timestamps can cause the pose estimator to "rewind" and replay
    // with bad data.  Typical camera pipeline latency is 20–60 ms.
    public static final double kMaxMeasurementAgeSec = 0.3;

    // ---- Limelight NT std-dev array ----
    // The Limelight publishes a 12-element "stddevs" array on NetworkTables:
    //   [MT1x, MT1y, MT1z, MT1roll, MT1pitch, MT1yaw,
    //    MT2x, MT2y, MT2z, MT2roll, MT2pitch, MT2yaw]
    public static final int kExpectedStdDevArrayLength = 12;

    // MegaTag 1 std dev indices (used for pre-match seeding)
    public static final int kMT1XStdDevIndex = 0;
    public static final int kMT1YStdDevIndex = 1;
    public static final int kMT1YawStdDevIndex = 5;

    // MegaTag 2 std dev indices (used during match)
    public static final int kMT2XStdDevIndex = 6;
    public static final int kMT2YStdDevIndex = 7;

    // Theta std dev — set very high because MegaTag 2 uses gyro for rotation.
    // We ignore the LL-reported yaw std dev and always override with this value.
    public static final double kThetaStdDev = 999999.0;

    // ---- MT1 heading drift correction (while enabled) ----
    // MegaTag 2 does NOT estimate rotation — it echoes back the gyro heading
    // you feed it.  Over a long match the Pigeon2 can drift ~0.5–1°/min.
    // To correct this, we periodically query MT1 (full 6-DOF) and inject
    // its heading with a moderate theta std dev so the pose estimator slowly
    // pulls the fused heading toward the true field heading.
    //
    // This runs at low rate (every Nth 50 Hz cycle) so the extra NT read is
    // negligible.  We require ≥2 tags because single-tag MT1 heading is
    // ambiguous (flip-ambiguity on the yaw axis).

    // How often to query MT1 for heading correction (in 50 Hz cycles).
    // 10 = every 10th cycle = 5 Hz.  MT1 is expensive so keep this low.
    public static final int kMT1HeadingCorrectionInterval = 10;

    // Minimum tags visible for MT1 heading correction to fire.
    // Single-tag MT1 has yaw ambiguity — require ≥2 for reliable heading.
    public static final int kMT1HeadingMinTagCount = 2;

    // Maximum MT1 yaw std dev (degrees) to accept a heading correction.
    // Only correct when MT1 is confident.  Typical 2-tag MT1 yaw stddev
    // is 0.5–3° at reasonable range.
    public static final double kMT1HeadingMaxYawStdDevDeg = 5.0;

    // Theta std dev (degrees) fed to addVisionMeasurement() for MT1 heading
    // corrections.  This controls how aggressively the pose estimator pulls
    // the fused heading toward the MT1 observation.
    //   ~10–15° = very gentle drift correction (takes many seconds to converge)
    //   ~3–5°   = moderate (converges in a few seconds, slight heading jitter)
    //   ~1–2°   = aggressive (fast convergence but may fight the gyro)
    // Start conservative and reduce if gyro drift is noticeable.
    public static final double kMT1HeadingThetaStdDev = 10.0;

    // XY std dev multiplier for MT1 heading correction observations.
    // MT1 XY is less accurate than MT2 (it doesn't use the constrained gyro
    // heading), so we use a high multiplier to down-weight XY and only
    // benefit from the heading information.
    public static final double kMT1HeadingXYStdDevMultiplier = 5.0;

    // ---- Std-dev multipliers (filter strength) ----
    // These scale the Limelight-reported standard deviations *before* they are
    // passed to the WPILib pose estimator.  The pose estimator uses stddevs as
    // trust weights: larger stddev = less trust = smoother but slower to converge.
    //
    //   1.0  = use the Limelight's raw stddevs (default)
    //   >1.0 = trust vision LESS  (smoother pose, higher latency to converge)
    //   <1.0 = trust vision MORE  (snappier pose, more noise)
    //
    // Tune these during practice:
    //   • If the pose is jittery / jumpy, increase the multiplier.
    //   • If the pose is sluggish / slow to converge, decrease it.
    //
    // MegaTag 2 multiplier — applied during enabled mode (auto / teleop).
    // Scales the XY stddevs fed to addVisionMeasurement().
    // Increase to reduce jitter (less trust in vision, smoother pose).
    public static double kMT2StdDevMultiplier = 0.05;

    // MegaTag 1 multiplier — applied during disabled pre-match refinement.
    // Scales both XY and yaw stddevs in the addVisionMeasurement() path.
    // Does NOT affect the initial setPose() hard reset (that ignores stddevs).
    public static double kMT1StdDevMultiplier = 5.0;

    // ---- Pre-match pose seeding (while disabled, using MegaTag 1) ----
    // While disabled the cameras run throttled but still produce MegaTag 1
    // estimates.  MT1 solves full 6-DOF (including rotation) so it can
    // determine the robot's heading without a laser-aligned gyro.  The
    // first accepted result hard-resets the pose estimator (including gyro
    // offset) so the robot knows its exact field position and heading
    // before auto starts.  Subsequent results refine via addVisionMeasurement.
    //
    // On enable the system switches to MegaTag 2 which uses the now-correct
    // gyro heading for its constrained solve.

    // Require at least this many tags visible to accept a disabled-mode seed.
    // 1 = accept single-tag results (the stddev multiplier already down-weights
    //     noisy measurements so every observation helps converge the estimate).
    public static final int kPreMatchMinTagCount = 1;

    // Maximum Limelight-reported XY std dev (meters) to accept a seed.
    // Relaxed — the MT1 stddev multiplier (×10) already scales trust so even
    // a noisy measurement is heavily down-weighted.  Let it contribute rather
    // than discard it outright.
    public static final double kPreMatchMaxStdDev = 5.0;

    // Maximum Limelight-reported yaw std dev (degrees) to accept a seed.
    // Relaxed for the same reason — high-stddev yaw measurements are scaled
    // by kMT1StdDevMultiplier and barely nudge the estimate.
    public static final double kPreMatchMaxYawStdDevDeg = 50.0;

    // Maximum yaw std dev (degrees) required to seed the Pigeon2 heading from
    // MT1 while disabled.  Much tighter than kPreMatchMaxYawStdDevDeg —
    // we only touch the gyro when MT1 is very confident about rotation.
    // Typical multi-tag MT1 yaw stddev is ~0.5–2° when close to the tags.
    public static final double kGyroSeedMaxYawStdDevDeg = 3.0;

    // Limelight frame throttle while disabled. Higher values skip more frames
    // to reduce thermals during long disabled periods.
    // 0 = process every frame.  LL4 handles heat fine for pre-match.
    // Low value gives smooth pose convergence instead of choppy jumps.
    public static final int kDisabledThrottleFrames = 100;

    // Limelight frame throttle while enabled. 0 = process every frame.
    public static final int kEnabledThrottleFrames = 0;

    // Stable-seed verification: require this many consecutive accepted MT1
    // poses that remain within both the XY and yaw deltas below before
    // declaring the seed stable.
    public static final int kPreMatchStableSeedMinSamples = 3;

    // Maximum XY delta (meters) between consecutive accepted MT1 poses for the
    // seed to continue counting as stable.
    public static final double kPreMatchStableSeedXYDeltaMeters = 0.08;

    // Maximum yaw delta (degrees) between consecutive accepted MT1 poses for
    // the seed to continue counting as stable.
    public static final double kPreMatchStableSeedYawDeltaDeg = 2.0;
  }

  // #endregion

  // #region Sim Physics
  // -------------------------------------------------------------------------
  // Simulation inertia model — adds whole-robot mass & rotational inertia to
  // sim mode so that AdvantageScope odometry shows realistic acceleration,
  // deceleration, and slip-like behavior instead of instant velocity changes.
  //
  // The model applies a first-order exponential lag to the commanded
  // ChassisSpeeds on each axis independently:
  //   actual += (commanded - actual) * (1 - e^(-dt / tau))
  //
  // Larger tau = more sluggish response (heavier / more friction).
  // -------------------------------------------------------------------------
  public static final class SimPhysicsConstants {
    // ---- Translational inertia (forward / backward) ----
    // Time constant in seconds. Higher = slower acceleration.
    // ~0.15 s approximates a 75 kg robot with ~4 Kraken X60s on geared swerve.
    // public static double kTranslationalTauSeconds = 0.15;
    public static double kTranslationalTauSeconds = 0.12;

    // ---- Lateral (strafe) inertia ----
    // Typically similar to translational, but can be tuned separately to model
    // higher lateral scrub / lower traction.
    // public static double kLateralTauSeconds = 0.18;
    public static double kLateralTauSeconds = 0.12;

    // ---- Rotational inertia ----
    // Time constant for angular velocity. Higher = harder to start/stop spinning.
    // ~0.12 s is reasonable for a compact swerve with MOI ~6.9 kg·m².
    public static double kRotationalTauSeconds = 0.12;

    // ---- Soft speed caps ----
    // These define the *effective* top speed the sim robot can reach.
    // Instead of a hard wall, a drag model smoothly reduces acceleration as
    // speed approaches the cap.  The robot asymptotically approaches but never
    // exceeds the cap.  Set these independently of the tau values above.
    //
    // Translational soft cap (m/s).  The real kSpeedAt12Volts is the motor's
    // theoretical max; this should be ≤ that value to model traction limits,
    // carpet drag, etc.
    public static double kTranslationalSoftCapMps = 7.0;

    // Rotational soft cap (rad/s).  Real max ≈ kSpeedAt12Volts / driveBaseRadius.
    // Lower this to model realistic turn-rate limits.
    public static double kRotationalSoftCapRadPerSec = 8.0;

    // ---- Drag curve exponent ----
    // Controls the shape of the rolloff near the soft cap.
    //   1.0  = linear rolloff   (gentle, starts limiting early)
    //   2.0  = quadratic        (moderate — good default)
    //   3.0+ = sharper knee     (feels fast until near the cap, then drops off)
    // The drag factor is:  max(0, 1 - (speed / softCap) ^ exponent)
    public static double kDragExponent = 2.0;

    // ---- Simulated gyro noise (degrees per second, 1σ) ----
    // Adds a small random walk to the sim gyro to mimic real sensor noise.
    public static double kGyroNoiseDegPerSec = 0.05;

    // ---- Turret rotational inertia (simulation only) ----
    // First-order lag time constant for the turret mechanism.
    // Higher = heavier/slower turret.  ~0.20 s for a geared turret with
    // a ~2 kg·m² MOI driven by a single Kraken/Falcon.
    public static double kTurretSimTauSeconds = 0.20;

    // Maximum turret angular velocity in degrees per second.
    // Prevents the simulated turret from slewing unrealistically fast.
    public static double kTurretSimMaxVelocityDegPerSec = 360.0;
  }

  // #endregion

  // #region Drive Command Tuning
  // Constants used by frc.robot.commands.DriveCommands.
  // Usage references:
  //   - DriveCommands.getLinearVelocityFromJoysticks()
  //   - DriveCommands.joystickDrive()
  //   - DriveCommands.joystickDriveAtAngle()
  //   - DriveCommands.feedforwardCharacterization()
  //   - DriveCommands.wheelRadiusCharacterization()
  public static final class DriveCommandConstants {
    // Joystick deadband applied to translation magnitude in
    // getLinearVelocityFromJoysticks().
    public static final double kJoystickDeadband = 0.1;

    // Joystick deadband applied to rotational command shaping in joystickDrive().
    public static final double kRotationCommandDeadband = kJoystickDeadband;

    // Larger neutral threshold used to decide when heading hold should engage in joystickDrive().
    public static final double kHoldStickNeutralDeadband = 0.25;

    // Maximum measured yaw rate (rad/s) allowed before heading hold can engage in joystickDrive().
    // If robot rotates faster than this, hold setpoint tracks current heading instead of locking.
    public static final double kHoldEngageMaxRateRadPerSec = Units.degreesToRadians(15.0);

    // PID gains used for heading hold in joystickDrive() and angle control in
    // joystickDriveAtAngle().
    public static final double kAngleHoldKp = 7.0;
    // was 5.0. PDC put it to 3 on 3-18 before practice
    public static final double kAngleHoldKd = 0.0;

    // Trapezoid profile limits used only in joystickDriveAtAngle().
    public static final double kAngleProfileMaxVelocityRadPerSec = 12.0;
    public static final double kAngleProfileMaxAccelerationRadPerSec2 = 20.0;

    // Feedforward characterization timing/ramp values used only in
    // feedforwardCharacterization().
    public static final double kFfCharacterizationStartDelaySec = 2.0;
    public static final double kFfCharacterizationRampRate = 0.1; // Volts per second

    // Wheel-radius characterization limits used only in wheelRadiusCharacterization().
    public static final double kWheelRadiusCharacterizationMaxVelocity = 0.45; // Rad/s
    public static final double kWheelRadiusCharacterizationRampRate = 0.05; // Rad/s^2

    // Driver face-button snap targets (degrees).
    // RobotContainer mappings:
    //   - Y -> kDriverSnapAngleYDeg
    //   - X -> kDriverSnapAngleXDeg
    //   - A -> kDriverSnapAngleADeg
    //   - B -> kDriverSnapAngleBDeg
    public static final double kDriverSnapAngleYDeg = 0.0;
    public static final double kDriverSnapAngleXDeg = 90.0;
    public static final double kDriverSnapAngleADeg = 180.0;
    public static final double kDriverSnapAngleBDeg = 270.0;

    // The old activeHub-based drive slowdown is intentionally commented out.
    // Teleop drive mode selection now keys off alliance home zone + shooting,
    // not FMS hub state.
    // public static double kHubDriveScalar = 0.4;
    // public static double kHubTurnScalar = 0.3;

    // Normal teleop drive profile. These are driver-facing chassis limits, not
    // the drivetrain's physical module-speed ceiling.
    public static double kNormalMaxLinearSpeedMps = 4.0;
    public static double kNormalMaxAngularSpeedRadPerSec = 9.0;
    public static double kNormalMaxLinearAccelMetersPerSec2 = 9.0;
    public static double kNormalMaxAngularAccelRadPerSec2 = 30.0;
    public static double kNormalMaxLinearDecelMetersPerSec2 = 40.0;
    public static double kNormalMaxAngularDecelRadPerSec2 = 60.0;

    // Home-scoring drive profile. Applies only while the robot is in its home
    // zone and the shoot command is being held.
    public static double kHomeScoringMaxLinearSpeedMps = 2.5;
    public static double kHomeScoringMaxAngularSpeedRadPerSec = 8.0;
    public static double kHomeScoringMaxLinearAccelMetersPerSec2 = 6.0;
    public static double kHomeScoringMaxAngularAccelRadPerSec2 = 30.0;
    public static double kHomeScoringMaxLinearDecelMetersPerSec2 = 40.0;
    public static double kHomeScoringMaxAngularDecelRadPerSec2 = 45.0;

    // Driver right-trigger alternate center of rotation, robot-relative.
    public static final double kDriverAltCenterOfRotationXMeters = Units.inchesToMeters(23.125);
    public static final double kDriverAltCenterOfRotationYMeters = 0.0;
  }

  // #endregion

  // #region Scorer Subsystems
  public static final class ScorerConstants {
    public static final double kWaitTime = 0.5; // seconds before teleop feed engages
    // NOTE: non-final so SmartDashboard can override at runtime
    public static double kShootRPM = 5400.0;
    public static final double kFlywheelIdleRPM = 3310.0;
    public static double kReverseShootRPM = -5400.0;

    /** Flywheel RPM tolerance — feeders engage once both flywheels are within this of target. */
    public static final double kFlywheelRPMTolerance = 50.0;

    public static final double kHoodDegreesTolerance = 1.5;

    public static final double kHoodStowedDegrees = 5.0; // degrees from vertical
    public static double kHoodMaxDegrees =
        35.0; // degrees from vertical (flattest shot, 55° elevation)
    public static final double kHoodMinDegrees =
        5.0; // degrees from vertical (steepest shot, 80° elevation)
    public static final double kHoodUnitToRotorRatio =
        (10.0 / 44.0) * (18.0 / 294.0) * 360.0; // convert rotations to degrees
    public static final double kHoodMomentOfInertia = 0.01; // kg*m^2 (estimate for tuning)

    // Distance (meters) within which the robot is considered "near" a landing /
    // intake zone.  When inside this radius the hood stows to kHoodMinDegrees so
    // the intake can receive balls unobstructed.
    public static final double kHoodStowDistanceMeters = 1.5; // meters

    public static final double kTurretStowedPosition = 0.0; // degrees
    public static double kTurretMaxPositionUnits = 220.0; // degrees
    public static final double kTurretMinPositionUnits = -220.0; // degrees
    public static final double kTurretUnitToRotorRatio =
        (11.0 / 32.0) * (14.0 / 220.0) * 360.0; // convert rotations to degrees
    public static final double kTurretMomentOfInertia = 0.01; // kg*m^2 (estimate for tuning)

    public static double kTurretOffsetDegrees = 0.0;

    public static double kOverrideRobotLockOnToleranceDeg = 3.0;

    // Lock-on tolerance — the turret must be within this many degrees of the
    // commanded angle before the feeders are allowed to run (snowblow/shoot).
    public static final double kTurretLockOnToleranceDeg = 60.0;

    // ---- Turret-lock tag-based aiming ----
    // AprilTag IDs the turret lock is allowed to track, per alliance.
    public static final int[] kTurretLockRedTagIds = {5, 10, 2};
    public static final int[] kTurretLockBlueTagIds = {18, 21, 26};
    // Height of the turret-lock target tags above the carpet (meters).
    public static double kTurretLockTagHeightMeters = Units.inchesToMeters(72.0);
    // Distance from the tag face to the hub center (meters).
    public static double kTurretLockTagToHubCenterOffsetMeters = 1.0;

    // Turret command deadband — if the new aim command is within this many
    // degrees of the previous command, hold the previous value.  Prevents the
    // turret from chasing tiny jitter while shooting.
    public static double kTurretDeadbandDeg = 0.5;

    // ---- Aim-ahead (lead) compensation ----
    // Phase delay (seconds) to compensate for sensor/processing pipeline latency.
    // The aim calculator shifts the estimated pose forward by this amount using
    // Pose2d.exp(Twist2d) before any TOF-based prediction.  Typical: 0.02–0.05s.
    public static double kPhaseDelaySeconds = 0.03;

    // Time from issuing the shot command until the ball actually leaves the shooter.
    // This is distinct from the ball's time-of-flight after release.
    public static double kReleaseDelaySeconds = 0.12;

    // Maximum iterations for TOF ↔ distance convergence loop.
    // The time-of-flight depends on distance, which changes with the lookahead
    // offset, which depends on TOF — a circular dependency solved by iteration.
    // 10 iterations is more than enough for convergence in practice.
    public static final int kTofIterations = 10;

    // Shooter lateral offsets from robot center (SDS §3.9 / §3.10)
    public static final double kLeftShooterXOffsetMeters = Units.inchesToMeters(-6.4);
    public static final double kLeftShooterYOffsetMeters = Units.inchesToMeters(6.831);
    public static final double kRightShooterXOffsetMeters = Units.inchesToMeters(-6.4);
    public static final double kRightShooterYOffsetMeters = Units.inchesToMeters(-6.831);
    public static final double kShooterExitZMeters = Units.inchesToMeters(20.5);

    // ---- Ballistics lookup tables ----
    // Each row:
    // { distance (m), hood angle (deg from vertical), flywheel speed (RPM),
    //   time of flight (seconds), vertical feed speed (RPM) }
    //
    // Hood angle = degrees from vertical (ball exits perpendicular to hood face).
    //   Actual launch elevation from horizontal = 90° − hoodDeg.
    //   10° hood → 80° elevation (nearly straight up, steep arc)
    //   35° hood → 55° elevation (flatter, faster trajectory)
    //
    // The calculator linearly interpolates between rows.  Values beyond the
    // first / last row are clamped to that row's values.
    //
    // Tune these per-robot during practice by shooting at known distances.
    // Add or remove rows as needed — just keep them sorted by distance.

    // Hub (scoring) — aim at the elevated hub target.
    // Close range = steep arc (low hood), far range = flatter shot (high hood).
    // Feeder speed ramps up with distance to maintain ball energy.
    //
    // Column 0: distance (meters) — horizontal distance from shooter to target
    // Column 1: hood angle (degrees from vertical) — 10°=steep arc, 35°=flat shot
    // Column 2: flywheel speed (RPM)
    // Column 3: time of flight (seconds)
    // Column 4: vertical feed speed (RPM)
    // Table order no longer matters. TurretAimCalculator sorts a copied version at runtime.
    public static final double[][] kShootTable = {
      // Prior mixed-angle data kept for reference:
      // {1.2, 5.05, 2600.0, 0.0, 4000.0},
      // {1.4, 5.05, 2700.0, 0.0, 4000.0},
      // {1.60, 5.00, 3000.0, 0.0, 4000.0},
      // {2.1, 5.05, 3200.0, 0.0, 4000.0},
      // {2.3, 10.41, 3200, 0.0, 4000.0},
      // {2.6, 5.05, 3200.0, 0.0, 4000.0},
      // Simplified hub table:
      // <= 2.5 m: hood fixed at 5 deg
      // 2.5 to 5.0 m: hood fixed at 10 deg
      // 5.0 to 6.0 m: hood fixed at 12 deg
      // { distance_m, hoodDeg, flywheelRPM, tofSeconds, verticalFeedRPM }
      {1.219, 10.0, 2832.0, 1.1, 2000.0},
      {1.524, 12.5, 2856.0, 1.1, 2000.0},
      {1.829, 14.8, 2885.0, 1.2, 2000.0},
      {2.134, 17.2, 2919.0, 1.2, 3000.0},
      {2.438, 19.5, 2958.0, 1.3, 3000.0},
      {2.743, 21.7, 3001.0, 1.3, 3000.0},
      {3.048, 23.8, 3049.0, 1.3, 3000.0},
      {3.353, 25.9, 3100.0, 1.3, 3000.0},
      {3.658, 27.9, 3156.0, 1.4, 4000.0},
      {3.962, 29.9, 3616.0, 1.4, 4000.0},
      {4.267, 31.7, 3679.0, 1.4, 4000.0},
      {4.572, 33.5, 3745.0, 1.4, 4000.0},
      {4.877, 35.0, 3817.0, 1.4, 4000.0},
      {5.182, 35.0, 3898.0, 1.5, 4000.0},
      {5.486, 35.0, 3978.0, 1.5, 4000.0},
      {5.791, 35.0, 3856.0, 1.5, 4000.0},
      {6.096, 35.0, 3734.0, 1.6, 4000.0},
      {6.401, 35.0, 3810.0, 1.6, 4000.0},
      {6.706, 35.0, 3884.0, 1.6, 4000.0},
      {7.010, 35.0, 3958.0, 1.6, 4000.0},
      {7.315, 35.0, 4030.0, 1.6, 4000.0},
      {7.620, 35.0, 4102.0, 1.7, 4000.0},
      {7.930, 35.0, 4172.0, 1.7, 4000.0},
      {8.230, 35.0, 4241.0, 1.7, 4000.0},
      {8.534, 35.0, 4309.0, 1.8, 4000.0},
      {8.839, 35.0, 4376.0, 1.8, 4000.0},
      {9.144, 35.0, 4442.0, 1.8, 4000.0},
      {9.449, 35.0, 4508.0, 1.8, 4000.0},
      {9.754, 35.0, 4572.0, 1.9, 4000.0},
      {10.058, 35.0, 4636.0, 1.9, 4000.0},
      {10.363, 35.0, 4698.0, 1.9, 4000.0},
      {10.668, 35.0, 4760.0, 2.0, 4000.0},
      {10.973, 35.0, 4821.0, 2.0, 4000.0},
      {11.278, 35.0, 4882.0, 2.0, 4000.0},
      {11.582, 35.0, 4941.0, 2.0, 4000.0},
      {11.887, 35.0, 5001.0, 2.1, 4000.0},
      {12.192, 35.0, 5059.0, 2.1, 4000.0},
      {12.497, 35.0, 5117.0, 2.1, 4000.0},
      {12.802, 35.0, 5174.0, 2.2, 4000.0},
      {13.106, 35.0, 5230.0, 2.2, 4000.0},
      {13.411, 35.0, 5286.0, 2.2, 4000.0},
      {13.716, 35.0, 5341.0, 2.3, 4000.0},
      // {14.021, 35.0, 7600.0, 1.9, 2000.0},
      // {14.326, 35.0, 7700.0, 2.0, 2000.0},
      // {14.630, 35.0, 7800.0, 2.1, 2000.0},
      // {14.935, 35.0, 7900.0, 2.2, 2000.0},
      // {15.240, 35.0, 8000.0, 2.3, 2000.0},
      // {15.545, 35.0, 8100.0, 2.4, 2000.0},
      // {15.850, 35.0, 8200.0, 2.5, 2000.0},
      // {16.154, 35.0, 8300.0, 2.6, 2000.0},
    };

    // Default feeder speed when stowing (turret idle / trench zone).
    public static final double kFeederStowRPM = 0.0;
  }

  public static final ServoMotorSubsystemConfig kLeftHoodConfig = new ServoMotorSubsystemConfig();

  static {
    kLeftHoodConfig.name = "Left Hood";
    kLeftHoodConfig.talonCANID = new CANDeviceId(23, CanBusNames.superstructureFor(23));

    kLeftHoodConfig.unitToRotorRatio = ScorerConstants.kHoodUnitToRotorRatio;
    kLeftHoodConfig.kMaxPositionUnits = ScorerConstants.kHoodMaxDegrees;
    kLeftHoodConfig.kMinPositionUnits = ScorerConstants.kHoodMinDegrees;
    kLeftHoodConfig.momentOfInertia = ScorerConstants.kHoodMomentOfInertia;

    kLeftHoodConfig.fxConfig.Slot0.kP = 2.0;
    kLeftHoodConfig.fxConfig.Slot0.kD = 0.0;
    kLeftHoodConfig.fxConfig.Slot0.kV = 0.2;
    kLeftHoodConfig.fxConfig.MotionMagic.MotionMagicCruiseVelocity = 80.0;
    kLeftHoodConfig.fxConfig.MotionMagic.MotionMagicAcceleration = 300.0;

    kLeftHoodConfig.fxConfig.SoftwareLimitSwitch.ForwardSoftLimitEnable = true;
    kLeftHoodConfig.fxConfig.SoftwareLimitSwitch.ForwardSoftLimitThreshold =
        kLeftHoodConfig.kMaxPositionUnits / kLeftHoodConfig.unitToRotorRatio;
    kLeftHoodConfig.fxConfig.SoftwareLimitSwitch.ReverseSoftLimitEnable = true;
    kLeftHoodConfig.fxConfig.SoftwareLimitSwitch.ReverseSoftLimitThreshold =
        kLeftHoodConfig.kMinPositionUnits / kLeftHoodConfig.unitToRotorRatio;

    kLeftHoodConfig.fxConfig.MotorOutput.Inverted = InvertedValue.CounterClockwise_Positive;
    kLeftHoodConfig.fxConfig.MotorOutput.NeutralMode = NeutralModeValue.Brake;
    kLeftHoodConfig.fxConfig.CurrentLimits.StatorCurrentLimitEnable = true;
    kLeftHoodConfig.fxConfig.CurrentLimits.StatorCurrentLimit = 60.0;
    kLeftHoodConfig.fxConfig.CurrentLimits.SupplyCurrentLimit = 30.0;
    kLeftHoodConfig.fxConfig.CurrentLimits.SupplyCurrentLimitEnable = true;
  }

  public static final ServoMotorSubsystemConfig kRightHoodConfig = new ServoMotorSubsystemConfig();

  static {
    kRightHoodConfig.name = "Right Hood";
    kRightHoodConfig.talonCANID = new CANDeviceId(28, CanBusNames.superstructureFor(28));
    kRightHoodConfig.unitToRotorRatio = ScorerConstants.kHoodUnitToRotorRatio;
    kRightHoodConfig.kMaxPositionUnits = ScorerConstants.kHoodMaxDegrees;
    kRightHoodConfig.kMinPositionUnits = ScorerConstants.kHoodMinDegrees;
    kRightHoodConfig.momentOfInertia = ScorerConstants.kHoodMomentOfInertia;
    kRightHoodConfig.fxConfig.Slot0.kP = 2.0;
    kRightHoodConfig.fxConfig.Slot0.kD = 0.0;
    kRightHoodConfig.fxConfig.Slot0.kV = 0.2;
    kRightHoodConfig.fxConfig.MotionMagic.MotionMagicCruiseVelocity = 80.0;
    kRightHoodConfig.fxConfig.MotionMagic.MotionMagicAcceleration = 300.0;

    kRightHoodConfig.fxConfig.SoftwareLimitSwitch.ForwardSoftLimitEnable = true;
    kRightHoodConfig.fxConfig.SoftwareLimitSwitch.ForwardSoftLimitThreshold =
        kRightHoodConfig.kMaxPositionUnits / kRightHoodConfig.unitToRotorRatio;
    kRightHoodConfig.fxConfig.SoftwareLimitSwitch.ReverseSoftLimitEnable = true;
    kRightHoodConfig.fxConfig.SoftwareLimitSwitch.ReverseSoftLimitThreshold =
        kRightHoodConfig.kMinPositionUnits / kRightHoodConfig.unitToRotorRatio;

    kRightHoodConfig.fxConfig.MotorOutput.Inverted = InvertedValue.CounterClockwise_Positive;
    kRightHoodConfig.fxConfig.MotorOutput.NeutralMode = NeutralModeValue.Brake;
    kRightHoodConfig.fxConfig.CurrentLimits.StatorCurrentLimitEnable = true;
    kRightHoodConfig.fxConfig.CurrentLimits.StatorCurrentLimit = 60.0;
    kRightHoodConfig.fxConfig.CurrentLimits.SupplyCurrentLimit = 30.0;
    kRightHoodConfig.fxConfig.CurrentLimits.SupplyCurrentLimitEnable = true;
  }

  public static final ServoMotorSubsystemConfig kLeftTurretConfig = new ServoMotorSubsystemConfig();

  static {
    kLeftTurretConfig.name = "Left Turret";
    kLeftTurretConfig.talonCANID = new CANDeviceId(22, CanBusNames.superstructureFor(22));

    kLeftTurretConfig.unitToRotorRatio = ScorerConstants.kTurretUnitToRotorRatio;
    kLeftTurretConfig.kMaxPositionUnits = ScorerConstants.kTurretMaxPositionUnits;
    kLeftTurretConfig.kMinPositionUnits = ScorerConstants.kTurretMinPositionUnits;
    kLeftTurretConfig.momentOfInertia = ScorerConstants.kTurretMomentOfInertia;

    kLeftTurretConfig.fxConfig.Slot0.kP = 1.0;
    kLeftTurretConfig.fxConfig.Slot0.kD = 0.0;
    kLeftTurretConfig.fxConfig.Slot0.kV = 0.144;
    kLeftTurretConfig.fxConfig.Slot0.kS = 0.0915;
    kLeftTurretConfig.fxConfig.MotionMagic.MotionMagicCruiseVelocity = 80.0;
    kLeftTurretConfig.fxConfig.MotionMagic.MotionMagicAcceleration = 300.0;

    kLeftTurretConfig.fxConfig.SoftwareLimitSwitch.ForwardSoftLimitEnable = true;
    kLeftTurretConfig.fxConfig.SoftwareLimitSwitch.ForwardSoftLimitThreshold =
        kLeftTurretConfig.kMaxPositionUnits / kLeftTurretConfig.unitToRotorRatio;
    kLeftTurretConfig.fxConfig.SoftwareLimitSwitch.ReverseSoftLimitEnable = true;
    kLeftTurretConfig.fxConfig.SoftwareLimitSwitch.ReverseSoftLimitThreshold =
        kLeftTurretConfig.kMinPositionUnits / kLeftTurretConfig.unitToRotorRatio;

    kLeftTurretConfig.fxConfig.MotorOutput.Inverted = InvertedValue.CounterClockwise_Positive;
    kLeftTurretConfig.fxConfig.MotorOutput.NeutralMode = NeutralModeValue.Brake;
    kLeftTurretConfig.fxConfig.CurrentLimits.StatorCurrentLimitEnable = true;
    kLeftTurretConfig.fxConfig.CurrentLimits.StatorCurrentLimit = 60.0;
    kLeftTurretConfig.fxConfig.CurrentLimits.SupplyCurrentLimit = 30.0;
    kLeftTurretConfig.fxConfig.CurrentLimits.SupplyCurrentLimitEnable = true;
  }

  public static final ServoMotorSubsystemConfig kRightTurretConfig =
      new ServoMotorSubsystemConfig();

  static {
    kRightTurretConfig.name = "Right Turret";
    kRightTurretConfig.talonCANID = new CANDeviceId(27, CanBusNames.superstructureFor(27));
    kRightTurretConfig.unitToRotorRatio = ScorerConstants.kTurretUnitToRotorRatio;
    kRightTurretConfig.kMaxPositionUnits = ScorerConstants.kTurretMaxPositionUnits;
    kRightTurretConfig.kMinPositionUnits = ScorerConstants.kTurretMinPositionUnits;
    kRightTurretConfig.momentOfInertia = ScorerConstants.kTurretMomentOfInertia;
    kRightTurretConfig.fxConfig.Slot0.kP = 2.0;
    kRightTurretConfig.fxConfig.Slot0.kD = 0.0;
    kRightTurretConfig.fxConfig.Slot0.kV = 0.144;
    kRightTurretConfig.fxConfig.Slot0.kS = 0.0915;
    kRightTurretConfig.fxConfig.MotionMagic.MotionMagicCruiseVelocity = 80.0;
    kRightTurretConfig.fxConfig.MotionMagic.MotionMagicAcceleration = 300.0;

    kRightTurretConfig.fxConfig.SoftwareLimitSwitch.ForwardSoftLimitEnable = true;
    kRightTurretConfig.fxConfig.SoftwareLimitSwitch.ForwardSoftLimitThreshold =
        kRightTurretConfig.kMaxPositionUnits / kRightTurretConfig.unitToRotorRatio;
    kRightTurretConfig.fxConfig.SoftwareLimitSwitch.ReverseSoftLimitEnable = true;
    kRightTurretConfig.fxConfig.SoftwareLimitSwitch.ReverseSoftLimitThreshold =
        kRightTurretConfig.kMinPositionUnits / kRightTurretConfig.unitToRotorRatio;

    kRightTurretConfig.fxConfig.MotorOutput.Inverted = InvertedValue.CounterClockwise_Positive;
    kRightTurretConfig.fxConfig.MotorOutput.NeutralMode = NeutralModeValue.Brake;
    kRightTurretConfig.fxConfig.CurrentLimits.StatorCurrentLimitEnable = true;
    kRightTurretConfig.fxConfig.CurrentLimits.StatorCurrentLimit = 60.0;
    kRightTurretConfig.fxConfig.CurrentLimits.SupplyCurrentLimit = 30.0;
    kRightTurretConfig.fxConfig.CurrentLimits.SupplyCurrentLimitEnable = true;
  }

  public static final ServoMotorSubsystemConfig kLeftFlywheelConfig =
      new ServoMotorSubsystemConfig();

  static {
    kLeftFlywheelConfig.name = "Left Flywheel";
    kLeftFlywheelConfig.talonCANID = new CANDeviceId(24, CanBusNames.superstructureFor(24));
    kLeftFlywheelConfig.momentOfInertia = 0.00132536;
    kLeftFlywheelConfig.unitToRotorRatio = (26.0 / 26.0) * 60; // gear ratio * 60 for RPM to RPS

    kLeftFlywheelConfig.fxConfig.Slot0.kP = 11.0;
    // Eliminate steady-state speed error before allowing the feed gate to open.
    // Simulation-branch tuning; validate on hardware before deployment.
    kLeftFlywheelConfig.fxConfig.Slot0.kI = RobotBase.isSimulation() ? 20.0 : 0.0;
    kLeftFlywheelConfig.fxConfig.Slot0.kS = 6.5;
    kLeftFlywheelConfig.fxConfig.Slot0.kV = 0.05;

    kLeftFlywheelConfig.fxConfig.MotorOutput.Inverted = InvertedValue.Clockwise_Positive;
    kLeftFlywheelConfig.fxConfig.MotorOutput.NeutralMode = NeutralModeValue.Coast;
    kLeftFlywheelConfig.fxConfig.CurrentLimits.StatorCurrentLimitEnable = true;
    kLeftFlywheelConfig.fxConfig.CurrentLimits.StatorCurrentLimit = 120.0;
    kLeftFlywheelConfig.fxConfig.CurrentLimits.SupplyCurrentLimit = 60.0;
    kLeftFlywheelConfig.fxConfig.CurrentLimits.SupplyCurrentLimitEnable = true;
  }

  public static final ServoMotorSubsystemConfig kRightFlywheelConfig =
      new ServoMotorSubsystemConfig();

  static {
    kRightFlywheelConfig.name = "Right Flywheel";
    kRightFlywheelConfig.talonCANID = new CANDeviceId(29, CanBusNames.superstructureFor(29));
    kRightFlywheelConfig.momentOfInertia = 0.00132536;
    kRightFlywheelConfig.unitToRotorRatio = (26.0 / 26.0) * 60; // gear ratio * 60 for RPM to RPS

    kRightFlywheelConfig.fxConfig.Slot0.kP = 11.0;
    // Eliminate steady-state speed error before allowing the feed gate to open.
    // Simulation-branch tuning; validate on hardware before deployment.
    kRightFlywheelConfig.fxConfig.Slot0.kI = RobotBase.isSimulation() ? 20.0 : 0.0;
    kRightFlywheelConfig.fxConfig.Slot0.kS = 6.5;
    kRightFlywheelConfig.fxConfig.Slot0.kV = 0.05;

    kRightFlywheelConfig.fxConfig.MotorOutput.Inverted = InvertedValue.Clockwise_Positive;
    kRightFlywheelConfig.fxConfig.MotorOutput.NeutralMode = NeutralModeValue.Coast;
    kRightFlywheelConfig.fxConfig.CurrentLimits.StatorCurrentLimitEnable = true;
    kRightFlywheelConfig.fxConfig.CurrentLimits.StatorCurrentLimit = 120.0;
    kRightFlywheelConfig.fxConfig.CurrentLimits.SupplyCurrentLimit = 60.0;
    kRightFlywheelConfig.fxConfig.CurrentLimits.SupplyCurrentLimitEnable = true;
  }

  // #endregion

  // #region Intake Subsystems
  public static final class IntakeConstants {

    public static final double kIntakePivotStowedDegrees = 0.0; // degrees
    public static final double kIntakePivotDeployDegrees = 125.0;
    public static final double kHeadButtDegrees = 100.0;

    public static final double kIntakeDutyCycleIntake = 1.0;
    public static final double kIntakeDutyCycleExhaust = -0.75;
    // max motor speed (7500rpm) we are setting to 7000rpm then convert to system (divide by 3.55)
    // roughly 1900
    // NOTE: non-final so SmartDashboard can override at runtime
    public static double kIntakeVelocityRPM = 3200.0;
    public static double kOuttakeVelocityRPM = -3200.0;

    public static final double kDeployVelocityRPM = 1500.0;
    public static final double kRetractVelocityRPM = 200.0;

    public static final double kIntakePivotToleranceRadians = 0.03;
    public static final double kIntakeRollerRadius = 0.0269875; // in m

    public static final double kIntakePivotCancoderOffset = kIsPracticeBot ? 0.411133 : -0.086914;
  }

  public static final ServoMotorSubsystemConfig kIntakeRollerConfig =
      new ServoMotorSubsystemConfig();

  public static final ServoMotorSubsystemConfig kIntakeRollerFollowerConfig =
      new ServoMotorSubsystemConfig();

  static {
    kIntakeRollerConfig.name = "Intake_Roller";
    kIntakeRollerConfig.talonCANID =
        new CANDeviceId(13, CanBusNames.superstructureFor(13)); // Motor 1 (master)
    kIntakeRollerConfig.momentOfInertia =
        0.000075; // Reduced from 0.00132536 for proper sim behavior
    kIntakeRollerConfig.unitToRotorRatio =
        (18.0 / 20.0) * (16.0 / 28.0) * 60.0; // gear ratio in RPM to RPS

    kIntakeRollerConfig.fxConfig.Slot0.kP = 3.0;
    kIntakeRollerConfig.fxConfig.Slot0.kI = 0.0;
    kIntakeRollerConfig.fxConfig.Slot0.kD = 0.0;
    kIntakeRollerConfig.fxConfig.Slot0.kS = 4.3;
    kIntakeRollerConfig.fxConfig.Slot0.kV = 0.07;
    kIntakeRollerConfig.fxConfig.Slot0.kA = 0.0;

    kIntakeRollerConfig.fxConfig.MotorOutput.NeutralMode = NeutralModeValue.Coast;
    kIntakeRollerConfig.fxConfig.CurrentLimits.StatorCurrentLimitEnable = true;
    kIntakeRollerConfig.fxConfig.CurrentLimits.StatorCurrentLimit = 60.0;
    kIntakeRollerConfig.fxConfig.CurrentLimits.SupplyCurrentLimit = 40.0;
    kIntakeRollerConfig.fxConfig.CurrentLimits.SupplyCurrentLimitEnable = true;

    kIntakeRollerConfig.fxConfig.MotorOutput.Inverted = InvertedValue.Clockwise_Positive;
  }

  static {
    kIntakeRollerFollowerConfig.name = "Intake_Roller_Follower";
    kIntakeRollerFollowerConfig.talonCANID =
        new CANDeviceId(15, CanBusNames.superstructureFor(15)); // Motor 2 (follower)
    kIntakeRollerFollowerConfig.momentOfInertia =
        0.000075; // Reduced from 0.00132536 for proper sim behavior
    kIntakeRollerFollowerConfig.unitToRotorRatio =
        (18.0 / 20.0) * (16.0 / 28.0) * 60.0; // gear ratio in RPM to RPS

    kIntakeRollerFollowerConfig.fxConfig.Slot0.kP = 3.0;
    kIntakeRollerFollowerConfig.fxConfig.Slot0.kI = 0.0;
    kIntakeRollerFollowerConfig.fxConfig.Slot0.kD = 0.0;
    kIntakeRollerFollowerConfig.fxConfig.Slot0.kS = 4.3;
    kIntakeRollerFollowerConfig.fxConfig.Slot0.kV = 0.07;
    kIntakeRollerFollowerConfig.fxConfig.Slot0.kA = 0.0;

    kIntakeRollerFollowerConfig.fxConfig.MotorOutput.NeutralMode = NeutralModeValue.Coast;
    kIntakeRollerFollowerConfig.fxConfig.CurrentLimits.StatorCurrentLimitEnable = true;
    kIntakeRollerFollowerConfig.fxConfig.CurrentLimits.StatorCurrentLimit = 60.0;
    kIntakeRollerFollowerConfig.fxConfig.CurrentLimits.SupplyCurrentLimit = 40.0;
    kIntakeRollerFollowerConfig.fxConfig.CurrentLimits.SupplyCurrentLimitEnable = true;

    kIntakeRollerFollowerConfig.fxConfig.MotorOutput.Inverted = InvertedValue.Clockwise_Positive;
  }

  public static final ServoMotorSubsystemWithCanCoderConfig kIntakePivotConfig =
      new ServoMotorSubsystemWithCanCoderConfig();

  static {
    kIntakePivotConfig.name = "Intake_Pivot";
    kIntakePivotConfig.talonCANID = new CANDeviceId(12, CanBusNames.superstructureFor(12));
    kIntakePivotConfig.momentOfInertia = 0.01;

    // PID Slot 0 gains for MotionMagicVoltage
    // Amarillo CAD: X44, 20.357142857:1, Motion Magic Position Control.
    kIntakePivotConfig.fxConfig.Slot0.kP = 40.0;
    kIntakePivotConfig.fxConfig.Slot0.kI = 0.0;
    // Local simulation-branch calibration for the articulated CAD plant.
    // These damping gains need measured-hardware validation before deployment.
    kIntakePivotConfig.fxConfig.Slot0.kD = 1.2;
    kIntakePivotConfig.fxConfig.Slot0.kS = 0.0; // Static friction compensation (volts)
    kIntakePivotConfig.fxConfig.Slot0.kV = 0.144; // Velocity feedforward (volts per rot/s)
    kIntakePivotConfig.fxConfig.Slot0.kA = 0.0;

    kIntakePivotConfig.fxConfig.Slot1.kP = 6.0;
    kIntakePivotConfig.fxConfig.Slot1.kI = 0.0;
    kIntakePivotConfig.fxConfig.Slot1.kD = 0.4;
    kIntakePivotConfig.fxConfig.Slot1.kS = 0.0;
    kIntakePivotConfig.fxConfig.Slot1.kV = 0.144;
    kIntakePivotConfig.fxConfig.Slot1.kA = 0.0;

    // Motion Magic profile — units are rotor rotations/s and rotations/s²
    kIntakePivotConfig.fxConfig.MotionMagic.MotionMagicCruiseVelocity = 120.0; // rot/s
    kIntakePivotConfig.fxConfig.MotionMagic.MotionMagicAcceleration = 300.0; // rot/s²

    // Degrees per rotor revolution, from the pinned Amarillo CAD gear train:
    // 12:32, 16:38, 16:40, 26:26 spur stages, then an open 14:18 chain.
    // Local simulation-branch calibration; verify the physical robot revision
    // before deployment. Keep the physical plant independent of this conversion.
    kIntakePivotConfig.unitToRotorRatio =
        (12.0 / 32.0) * (16.0 / 38.0) * (16.0 / 40.0) * (26.0 / 26.0) * (14.0 / 18.0)
            * 360.0;

    // Position limits in degrees — design sheet: 0 → 145 degrees
    kIntakePivotConfig.kMaxPositionUnits = 160.0; // degrees (fully deployed)
    kIntakePivotConfig.kMinPositionUnits = 0.0; // degrees (fully stowed)
    kIntakePivotConfig.fxConfig.SoftwareLimitSwitch.ForwardSoftLimitEnable = true;
    kIntakePivotConfig.fxConfig.SoftwareLimitSwitch.ForwardSoftLimitThreshold =
        kIntakePivotConfig.kMaxPositionUnits / kIntakePivotConfig.unitToRotorRatio;
    kIntakePivotConfig.fxConfig.SoftwareLimitSwitch.ReverseSoftLimitEnable = true;
    kIntakePivotConfig.fxConfig.SoftwareLimitSwitch.ReverseSoftLimitThreshold =
        kIntakePivotConfig.kMinPositionUnits / kIntakePivotConfig.unitToRotorRatio;

    kIntakePivotConfig.fxConfig.MotorOutput.Inverted = InvertedValue.Clockwise_Positive;
    kIntakePivotConfig.fxConfig.MotorOutput.NeutralMode = NeutralModeValue.Brake;
    kIntakePivotConfig.fxConfig.CurrentLimits.StatorCurrentLimitEnable = true;
    kIntakePivotConfig.fxConfig.CurrentLimits.StatorCurrentLimit = 120.0; // Per design sheet
    kIntakePivotConfig.fxConfig.CurrentLimits.SupplyCurrentLimit = 60.0;
    kIntakePivotConfig.fxConfig.CurrentLimits.SupplyCurrentLimitEnable = true;
  }

  // #endregion

  // #region Agitator Subsystems

  public static final class AgitatorConstants {
    // Floor Roller speeds (Velocity Voltage Control)
    // Output Top Speed = 75 RPS (4500 RPM) from design sheet
    // TESTING: Increased speed to make velocity control more noticeable
    // NOTE: non-final so SmartDashboard can override at runtime
    public static double kFloorRollerSnowblowRPM = 2000.0; // RPM at output (increased for testing)
    public static double kFloorRollerCollectRPM =
        500.0; // RPM while intaking (Decreased for Collect mode)
    public static double kFloorRollerReverseRPM =
        -2000.0; // RPM while reversing (negative = opposite direction, matches snowblow speed)
    public static double kFloorRollerSnowblowRPS =
        kFloorRollerSnowblowRPM / 60.0; // RPS at output = 30 RPS
    public static double kFloorRollerCollectRPS =
        kFloorRollerCollectRPM / 60.0; // RPS at output = 6.67 RPS
    public static double kFloorRollerReverseRPS =
        kFloorRollerReverseRPM / 60.0; // RPS while reversing = -8.33 RPS
    // Vertical Feed Roller speeds (Velocity Voltage Control)
    // Output Top Speed = 83.33 RPS (5000 RPM) from design sheet
    public static double kVerticalFeedIntakeRPM = 2000.0; // RPM at output
    public static double kVerticalFeedOuttakeRPM = -2000.0; // RPM at output (reverse)

    public static double kVerticalFeedCollectRPM = -300.0; // RPM while collecting

    public static double kVerticalFeedIntakeRPS = kVerticalFeedIntakeRPM / 60.0; // RPS at output
    public static double kVerticalFeedOuttakeRPS = kVerticalFeedOuttakeRPM / 60.0; // RPS at output
  }

  // ---- Right Floor Roller (CAN 25, CANivore #2) ----
  // Design Sheet: X44, gear ratio 1.66667:1 (20/12), 75 RPS output, Outtake direction, 80A
  public static final ServoMotorSubsystemConfig kRightFloorRollerConfig =
      new ServoMotorSubsystemConfig();

  static {
    kRightFloorRollerConfig.name = "RightFloorRoller";
    kRightFloorRollerConfig.talonCANID = new CANDeviceId(25, CanBusNames.superstructureFor(25));
    kRightFloorRollerConfig.momentOfInertia = 0.00132536;
    kRightFloorRollerConfig.unitToRotorRatio = (12.0 / 20.0) * 60; // gear ratio 1.66667:1

    // Velocity PID gains - SIGNIFICANTLY INCREASED for better response
    // Phoenix Tuner confirmed velocity control works at these higher gains
    kRightFloorRollerConfig.fxConfig.Slot0.kP = 4.0; // Increased from 0.5
    kRightFloorRollerConfig.fxConfig.Slot0.kI = 0.0;
    kRightFloorRollerConfig.fxConfig.Slot0.kD = 0.0;
    kRightFloorRollerConfig.fxConfig.Slot0.kS = 7.5; // Increased from 0.02 - overcome friction
    kRightFloorRollerConfig.fxConfig.Slot0.kV = 0.1; // Increased from 0.1 - velocity feedforward
    kRightFloorRollerConfig.fxConfig.Slot0.kA = 0.0;

    kRightFloorRollerConfig.fxConfig.MotorOutput.Inverted = InvertedValue.CounterClockwise_Positive;

    kRightFloorRollerConfig.fxConfig.MotorOutput.NeutralMode = NeutralModeValue.Coast;
    kRightFloorRollerConfig.fxConfig.CurrentLimits.StatorCurrentLimitEnable = true;
    kRightFloorRollerConfig.fxConfig.CurrentLimits.StatorCurrentLimit = 80.0;
    kRightFloorRollerConfig.fxConfig.CurrentLimits.SupplyCurrentLimit = 30.0;
    kRightFloorRollerConfig.fxConfig.CurrentLimits.SupplyCurrentLimitEnable = true;
  }

  // ---- Left Floor Roller (CAN 20, CANivore #2) ----
  // Design Sheet: X44, gear ratio 1.66667:1 (20/12), 75 RPS output, Intake direction, 80A
  public static final ServoMotorSubsystemConfig kLeftFloorRollerConfig =
      new ServoMotorSubsystemConfig();

  static {
    kLeftFloorRollerConfig.name = "LeftFloorRoller";
    kLeftFloorRollerConfig.talonCANID = new CANDeviceId(20, CanBusNames.superstructureFor(20));
    kLeftFloorRollerConfig.momentOfInertia = 0.00132536;
    kLeftFloorRollerConfig.unitToRotorRatio = (12.0 / 20.0) * 60; // gear ratio 1.66667:1

    kLeftFloorRollerConfig.fxConfig.Slot0.kP = 4.0;
    kLeftFloorRollerConfig.fxConfig.Slot0.kS = 7.5;
    kLeftFloorRollerConfig.fxConfig.Slot0.kV = 0.1;

    kLeftFloorRollerConfig.fxConfig.MotorOutput.Inverted = InvertedValue.Clockwise_Positive;

    kLeftFloorRollerConfig.fxConfig.MotorOutput.NeutralMode = NeutralModeValue.Coast;
    kLeftFloorRollerConfig.fxConfig.CurrentLimits.StatorCurrentLimitEnable = true;
    kLeftFloorRollerConfig.fxConfig.CurrentLimits.StatorCurrentLimit = 80.0;
    kLeftFloorRollerConfig.fxConfig.CurrentLimits.SupplyCurrentLimit = 30.0;
    kLeftFloorRollerConfig.fxConfig.CurrentLimits.SupplyCurrentLimitEnable = true;
  }

  // ---- Right Vertical Feed Roller (CAN 26, CANivore #2) ----
  // Design Sheet: X44, gear ratio 1.5:1 (18/12), 83.33 RPS output, Outtake direction, 80A
  public static final ServoMotorSubsystemConfig kRightVerticalFeedConfig =
      new ServoMotorSubsystemConfig();

  static {
    kRightVerticalFeedConfig.name = "RightVerticalFeed";
    kRightVerticalFeedConfig.talonCANID = new CANDeviceId(26, CanBusNames.superstructureFor(26));
    kRightVerticalFeedConfig.momentOfInertia = 0.00132536;
    kRightVerticalFeedConfig.unitToRotorRatio = (12.0 / 18.0) * 60; // gear ratio 1.5:1

    // These constants are for VelocityTorqueCurrentFOC
    kRightVerticalFeedConfig.fxConfig.Slot0.kP = 4.0;
    kRightVerticalFeedConfig.fxConfig.Slot0.kS = 6.1;
    kRightVerticalFeedConfig.fxConfig.Slot0.kV = 0.1;

    kRightVerticalFeedConfig.fxConfig.MotorOutput.Inverted = InvertedValue.Clockwise_Positive;
    kRightVerticalFeedConfig.fxConfig.MotorOutput.NeutralMode = NeutralModeValue.Coast;
    kRightVerticalFeedConfig.fxConfig.CurrentLimits.StatorCurrentLimitEnable = true;
    kRightVerticalFeedConfig.fxConfig.CurrentLimits.StatorCurrentLimit = 80.0;
    kRightVerticalFeedConfig.fxConfig.CurrentLimits.SupplyCurrentLimit = 30.0;
    kRightVerticalFeedConfig.fxConfig.CurrentLimits.SupplyCurrentLimitEnable = true;
  }

  // ---- Left Vertical Feed Roller (CAN 21, CANivore #2) ----
  // Design Sheet: X44, gear ratio 1.5:1 (18/12), 83.33 RPS output, Intake direction, 80A
  public static final ServoMotorSubsystemConfig kLeftVerticalFeedConfig =
      new ServoMotorSubsystemConfig();

  static {
    kLeftVerticalFeedConfig.name = "LeftVerticalFeed";
    kLeftVerticalFeedConfig.talonCANID = new CANDeviceId(21, CanBusNames.superstructureFor(21));
    kLeftVerticalFeedConfig.momentOfInertia = 0.00132536;
    kLeftVerticalFeedConfig.unitToRotorRatio = (12.0 / 18.0) * 60; // gear ratio 1.5:1

    kLeftVerticalFeedConfig.fxConfig.Slot0.kP = 4.0;
    kLeftVerticalFeedConfig.fxConfig.Slot0.kS = 6.1;
    kLeftVerticalFeedConfig.fxConfig.Slot0.kV = 0.1;

    kLeftVerticalFeedConfig.fxConfig.MotorOutput.Inverted = InvertedValue.CounterClockwise_Positive;
    kLeftVerticalFeedConfig.fxConfig.MotorOutput.NeutralMode = NeutralModeValue.Coast;
    kLeftVerticalFeedConfig.fxConfig.CurrentLimits.StatorCurrentLimitEnable = true;
    kLeftVerticalFeedConfig.fxConfig.CurrentLimits.StatorCurrentLimit = 80.0;
    kLeftVerticalFeedConfig.fxConfig.CurrentLimits.SupplyCurrentLimit = 30.0;
    kLeftVerticalFeedConfig.fxConfig.CurrentLimits.SupplyCurrentLimitEnable = true;
  }

  // #region Roof Subsystem
  public static final class RoofConstants {
    // Linear travel limits in inches. The roof starts at the top hard-stop on boot.
    public static final double kRoofMinHeightInches = 0.0;
    public static final double kRoofMaxHeightInches = 6.1;
    public static final double kRoofStartupHeightInches = kRoofMaxHeightInches;

    // Output inches traveled per motor rotor revolution:
    // pulley circumference * pulley revs per motor rev.
    public static final double kRoofUnitToRotorRatio = Math.PI * 0.75 * (10.0 / 36.0);

    public static final double kRoofMomentOfInertia = 0.5; // kg·m² for sim
  }

  public static final ServoMotorSubsystemConfig kRoofConfig = new ServoMotorSubsystemConfig();

  static {
    kRoofConfig.name = "Roof";
    kRoofConfig.talonCANID = new CANDeviceId(30, CanBusNames.superstructureFor(30));

    kRoofConfig.unitToRotorRatio = RoofConstants.kRoofUnitToRotorRatio;
    kRoofConfig.kMaxPositionUnits = RoofConstants.kRoofMaxHeightInches;
    kRoofConfig.kMinPositionUnits = RoofConstants.kRoofMinHeightInches;
    kRoofConfig.momentOfInertia = RoofConstants.kRoofMomentOfInertia;

    // PID — tune on robot
    kRoofConfig.fxConfig.Slot0.kP = 1.0;
    kRoofConfig.fxConfig.Slot0.kD = 0.0;
    kRoofConfig.fxConfig.Slot0.kV = 0.12;
    kRoofConfig.fxConfig.MotionMagic.MotionMagicCruiseVelocity = 40.0;
    kRoofConfig.fxConfig.MotionMagic.MotionMagicAcceleration = 120.0;

    // Software limits
    kRoofConfig.fxConfig.SoftwareLimitSwitch.ForwardSoftLimitEnable = true;
    kRoofConfig.fxConfig.SoftwareLimitSwitch.ForwardSoftLimitThreshold =
        kRoofConfig.kMaxPositionUnits / kRoofConfig.unitToRotorRatio;
    kRoofConfig.fxConfig.SoftwareLimitSwitch.ReverseSoftLimitEnable = true;
    kRoofConfig.fxConfig.SoftwareLimitSwitch.ReverseSoftLimitThreshold =
        kRoofConfig.kMinPositionUnits / kRoofConfig.unitToRotorRatio;

    kRoofConfig.fxConfig.MotorOutput.Inverted = InvertedValue.Clockwise_Positive;
    kRoofConfig.fxConfig.MotorOutput.NeutralMode = NeutralModeValue.Brake;
    kRoofConfig.fxConfig.CurrentLimits.StatorCurrentLimitEnable = true;
    kRoofConfig.fxConfig.CurrentLimits.StatorCurrentLimit = 40.0;
  }

  // #endregion

  // #endregion

  /**
   * Check if this system has a certain mac address in any network device.
   *
   * @param mac_address Mac address to check.
   * @return true if some device with this mac address exists on this system.
   */
  private static Bot detectCurrentBot() {
    if (hasAnyMacAddress(kPracticeBotMacAddresses)) {
      return Bot.PRACTICE;
    }
    if (hasAnyMacAddress(kBravoBotMacAddresses)) {
      return Bot.BRAVO;
    }
    if (hasAnyMacAddress(kCompBotMacAddresses)) {
      return Bot.COMP;
    }

    return Bot.COMP;
  }

  public static boolean hasMacAddress(final String macAddress) {
    for (String detectedMacAddress : kLocalMacAddresses) {
      if (macAddress.equalsIgnoreCase(detectedMacAddress)) {
        return true;
      }
    }
    return false;
  }

  private static boolean hasAnyMacAddress(final String[] expectedMacAddresses) {
    for (String expectedMacAddress : expectedMacAddresses) {
      if (hasMacAddress(expectedMacAddress)) {
        return true;
      }
    }
    return false;
  }

  public static String[] getLocalMacAddresses() {
    return kLocalMacAddresses.clone();
  }

  public static String getLocalMacAddressesString() {
    return String.join(", ", kLocalMacAddresses);
  }

  private static String[] findLocalMacAddresses() {
    List<String> macAddresses = new ArrayList<>();
    try {
      Enumeration<NetworkInterface> nwInterface = NetworkInterface.getNetworkInterfaces();
      while (nwInterface.hasMoreElements()) {
        NetworkInterface nis = nwInterface.nextElement();
        if (nis == null) {
          continue;
        }
        StringBuilder deviceMacBuilder = new StringBuilder();
        byte[] mac = nis.getHardwareAddress();
        if (mac != null) {
          for (int i = 0; i < mac.length; i++) {
            deviceMacBuilder.append(
                String.format("%02X%s", mac[i], (i < mac.length - 1) ? ":" : ""));
          }
          macAddresses.add(deviceMacBuilder.toString());
        }
      }
    } catch (SocketException e) {
      e.printStackTrace();
    }
    return macAddresses.toArray(new String[0]);
  }
}
