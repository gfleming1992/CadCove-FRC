package frc.robot.subsystems.vision;

import edu.wpi.first.math.VecBuilder;
import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.wpilibj.DriverStation;
import edu.wpi.first.wpilibj.Timer;
import edu.wpi.first.wpilibj.smartdashboard.SmartDashboard;
import edu.wpi.first.wpilibj2.command.SubsystemBase;
import frc.lib.limelight.LimelightHelpers;
import frc.lib.limelight.LimelightHelpers.PoseEstimate;
import frc.lib.limelight.LimelightHelpers.RawFiducial;
import frc.robot.Constants;
import frc.robot.Constants.VisionConstants;
import frc.robot.Robot;
import frc.robot.subsystems.drive.Drive;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.littletonrobotics.junction.Logger;

/**
 * Vision subsystem using 4× Limelight 4 cameras with a two-phase MegaTag strategy:
 *
 * <h3>Phase 1 — Disabled (pre-match): MegaTag 1 + IMU Mode 0</h3>
 *
 * <p>While the robot is disabled, cameras run in <b>IMU Mode 0 (External Only)</b> — the LL ignores
 * its internal IMU and uses exactly the heading from {@code SetRobotOrientation()}. MT1 (full
 * 6-DOF) estimates are filtered for high yaw confidence and used to hard-reset the pose estimator
 * via {@link Drive#setPose}, which also sets the Pigeon2 offset. On each seed, the corrected
 * heading is immediately broadcast to all cameras so every MT2 solve reflects the true field
 * heading.
 *
 * <h3>Phase 2 — Enabled (auto / teleop): MegaTag 2 + IMU Mode 0</h3>
 *
 * <p>Once enabled, cameras remain in <b>IMU Mode 0 (External Only)</b>. The raw Pigeon2 heading is
 * pushed to all cameras every cycle at 50 Hz via {@code SetRobotOrientation()}, which is more than
 * sufficient for accurate MT2 XY solves. Mode 4 (Internal + External Assist) was previously used
 * but caused heading corruption on the disabled→enabled transition.
 *
 * <p>Each enabled loop we:
 *
 * <ol>
 *   <li>Push raw Pigeon2 yaw + yaw rate via {@code SetRobotOrientation()} to all cameras.
 *   <li>Query {@code getBotPoseEstimate_wpiBlue_MegaTag2()} for each camera.
 *   <li>Filter out bad results (no tags, spinning too fast, off-field, stale timestamp).
 *   <li>Scale stddevs and feed accepted measurements into {@code Drive.addVisionMeasurement()}.
 * </ol>
 *
 * <h3>Heading Drift Correction — Periodic MT1 while enabled</h3>
 *
 * <p>MT2 does <b>not</b> estimate rotation — it echoes back the gyro heading you supply. Over a
 * long match the Pigeon2 can drift ~0.5–1°/min. To correct this, every Nth cycle we also query MT1
 * (full 6-DOF) and, when ≥2 tags are visible with low yaw stddev, inject the result with a moderate
 * theta stddev so the WPILib pose estimator slowly pulls the fused heading toward the true field
 * heading. The XY component of MT1 is heavily down-weighted since MT2 is more accurate for
 * translation.
 *
 * <p>Theta std dev is set to 999999 for MT2 observations (no heading info) but to {@code
 * kMT1HeadingThetaStdDev} (~10°) for MT1 heading corrections.
 */
public class Vision extends SubsystemBase {
  private static final String kVisionEnabledKey = "Vision/Enabled";
  private static final String kVisionSeededKey = "Vision/Seeded";
  private static final String kVisionSeedStableKey = "Vision/SeedStable";

  private final Drive drive;

  // Log rate-limiting — Logger.recordOutput is expensive (NT write per call).
  // We have ~15 log calls per camera × 3 cameras = ~45 writes per loop at 50 Hz.
  // Rate-limiting to every Nth cycle cuts NT traffic without affecting robot
  // functionality — all filtering, processing, and pose injection still run
  // every single cycle.
  private int logCounter = 0;

  // Thermal throttle — skip frames while disabled to keep cameras cool.
  // Per Limelight docs (LDS §13): 100–200 while disabled, 0 while enabled.
  // We use 0 while disabled too so pre-match pose seeding gets full frame rate.
  // The cameras won't overheat during a few minutes of pre-match idle.
  private boolean wasDisabled = true; // assume starting disabled
  private boolean firstLoop = true; // push throttle on the very first periodic() call
  private int lastIMUMode = -1; // track IMU mode to avoid spamming SetIMUMode every cycle

  // Downsample disabled-mode processing to avoid loop overruns.
  // While disabled the cameras are throttled (low FPS) so running full
  // NT reads + SetRobotOrientation + processCameraPreMatch at 50 Hz is
  // wasteful and eats into the 20 ms budget.  Run every Nth cycle instead.
  private int disabledCycleCounter = 0;
  private static final int DISABLED_PROCESS_INTERVAL = 5; // run every 5th cycle (~10 Hz)

  // Pre-match pose seeding state — seed fires once on first high-confidence MT1 result.
  private boolean hasSeed = false;
  private boolean seedStable = false;

  // AdvantageScope QoL: track the last time each camera saw tags so we can
  // log an off-screen pose when a camera goes stale.  This keeps the field
  // view clean instead of showing frozen ghost poses from the last sighting.
  private static final double STALE_TIMEOUT_SEC = 1.0;
  private static final Pose2d OFF_SCREEN_POSE = new Pose2d(100, 100, new Rotation2d());
  private final double[] lastMT2SeenTime;
  private double lastFinalFilteredTime = 0.0;

  // Pre-allocated lists for per-cycle observation collection (max 4 cameras).
  // Reused every cycle to avoid allocating a new ArrayList on the 100 MB heap
  // with SerialGC (which has no concurrent collection).
  private final List<AcceptedObservation> acceptedBuf = new ArrayList<>(4);
  private final List<AcceptedObservation> disabledAcceptedBuf = new ArrayList<>(4);

  // Per-camera last-accepted timestamp — used to detect and reject duplicate
  // or replayed NT frames.  When the NT4 connection to a Limelight drops and
  // reconnects, the server may re-send the last value with the same embedded
  // timestamp.  Without this guard, the same stale pose gets re-injected.
  private final double[] lastAcceptedTimestamp;

  // MT1 heading drift correction — runs every Nth enabled cycle to slowly
  // pull the gyro heading toward the true field heading using MegaTag 1's
  // full 6-DOF solve (which independently estimates rotation).
  private int mt1HeadingCycleCounter = 0;

  // Dashboard key for the vision enable/disable toggle.
  // Default: true (vision actively seeds pose estimator).
  // Set to false from Elastic/SmartDashboard to remove vision from the pose
  // estimator for debugging (cameras still run, log data, and seed IMU —
  // only the pose injection is suppressed).

  /** A vision measurement that passed all filters and is ready to be injected. */
  private record AcceptedObservation(
      Pose2d pose, double timestampSeconds, double scaledXYStdDev, double thetaStdDev) {}

  /**
   * Creates a new Vision subsystem.
   *
   * @param drive The drive subsystem, used to read gyro heading and inject vision measurements.
   */
  public Vision(Drive drive) {
    this.drive = drive;
    this.lastMT2SeenTime = new double[VisionConstants.kCameraNames.length];
    this.lastAcceptedTimestamp = new double[VisionConstants.kCameraNames.length];
    // Publish the default value so the toggle appears on the dashboard immediately.
    // Vision is always on — this key is published for AdvantageScope logging only.
    SmartDashboard.putBoolean(kVisionEnabledKey, true);
    SmartDashboard.putBoolean(kVisionSeededKey, false);
    SmartDashboard.putBoolean(kVisionSeedStableKey, false);
    // Whether to reset the pre-match seed when transitioning back to disabled.
    // Default false to preserve a previously-seeded pose when re-disabling
    // (avoids choppy re-seeding after enable/disable cycles). Set true to
    // force re-localization between matches / practice runs.
    SmartDashboard.putBoolean("Vision/ResetOnDisable", false);
  }

  // Vision is always on — no toggle. This method is kept as a no-op so
  // callers in Robot.java don't need to be changed.
  public void setVisionEnabled(boolean enabled) {
    // no-op: vision is unconditionally enabled
  }

  /** Returns true if the odometry has already been seeded by limelight pre-match. */
  public boolean isSeeded() {
    return seedStable;
  }

  // -----------------------------------------------------------------------
  //  Periodic — runs every 20 ms
  // -----------------------------------------------------------------------
  @Override
  public void periodic() {
    // Rate-limit logging — increment counter and decide if this is a log cycle.
    // All processing and injection still runs every cycle; only Logger output is gated.
    logCounter++;
    boolean shouldLog = logCounter >= Constants.kLogInterval;
    if (shouldLog) {
      logCounter = 0;
    }

    // Read the dashboard toggle — when false, cameras still run and log but
    // do NOT inject measurements into the pose estimator.  Useful for debugging.
    // HARDCODED: Vision is always on. No dashboard toggle — eliminates the risk
    // of accidental disable or NT disconnect killing vision mid-match.
    SmartDashboard.putBoolean(kVisionSeededKey, hasSeed);
    SmartDashboard.putBoolean(kVisionSeedStableKey, seedStable);

    // Always log state flags so a latched-off condition is visible in AdvantageScope.
    if (shouldLog) {
      Logger.recordOutput("Vision/inPit", Robot.inPit);
    }

    // Skip all vision processing while in pit mode.
    if (Robot.inPit) {
      return;
    }

    // Always push IMU mode every cycle so the transition from mode 1 → 4
    // happens promptly when the robot is enabled.
    setIMUModes();

    // Thermal throttle: set frame processing rate.
    // Push on first loop (so cameras are configured immediately on boot)
    // and on enable/disable transitions.
    boolean isDisabled = DriverStation.isDisabled();
    if (firstLoop || isDisabled != wasDisabled) {
      int throttle =
          isDisabled
              ? VisionConstants.kDisabledThrottleFrames
              : VisionConstants.kEnabledThrottleFrames;
      for (String name : VisionConstants.kCameraNames) {
        LimelightHelpers.SetThrottle(name, throttle);
      }
      // Tell each camera which AprilTag IDs to track.  Tags NOT in this list
      // are completely ignored at the hardware level (never enter the MT2
      // solve), so we don't need to gate them with huge stddev factors.
      if (firstLoop) {
        for (String name : VisionConstants.kCameraNames) {
          LimelightHelpers.SetFiducialIDFiltersOverride(name, VisionConstants.kValidTagIds);
        }
      }
      // Reset pre-match seed when transitioning back to disabled only if the
      // dashboard toggle is enabled. Older behavior always reset which caused
      // re-seeding and visible jumps after enable→disable cycles. Default is
      // false so a previously-seeded pose remains stable across brief toggles.
      if (isDisabled && !firstLoop) {
        disabledCycleCounter = 0; // reset so first disabled cycle processes immediately
      }
      wasDisabled = isDisabled;
      firstLoop = false;
    }

    // Always feed the raw Pigeon2 heading to SetRobotOrientation — NOT the
    // fused pose-estimator heading. Using the fused heading creates a feedback
    // loop: a bad vision measurement corrupts the pose, which corrupts the
    // heading we report back to the LL, which corrupts the next MT2 solve.
    // The raw gyro is immune to vision errors and is what the LL actually needs.
    double robotYawDeg = drive.getRawGyroRotation().getDegrees();
    double yawRateDps = drive.getRawGyroYawRateDegPerSec();

    if (shouldLog) {
      Logger.recordOutput("Vision/pushedYawDeg", robotYawDeg);
    }

    // While disabled, downsample the expensive per-camera work
    // (SetRobotOrientation flushes + getBotPoseEstimate NT reads) so we don't
    // blow the 20 ms loop budget.  The cameras are throttled to low FPS anyway,
    // so 10 Hz robot-side processing is more than enough.
    if (isDisabled) {
      disabledCycleCounter++;
      if (disabledCycleCounter >= DISABLED_PROCESS_INTERVAL) {
        disabledCycleCounter = 0;
        for (String name : VisionConstants.kCameraNames) {
          LimelightHelpers.SetRobotOrientation_NoFlush(
              name, robotYawDeg, yawRateDps, 0.0, 0.0, 0.0, 0.0);
        }
        for (int i = 0; i < VisionConstants.kCameraNames.length; i++) {
          // MT1 pre-match seeding: attempt to seed full pose (XY + heading) from
          // MegaTag 1 while disabled.  Only seeds once (hasSeed flag).
          // This is critical for the LL 3G — it has no internal IMU, so MT2
          // produces garbage until the Pigeon is seeded to the real field heading.
          // LL4s mask this problem because their internal IMU provides a heading
          // reference even before seeding.
          processCameraPreMatch(VisionConstants.kCameraNames[i], i, shouldLog);
        }

        // Once seeded, run the full MT2 processing pipeline and inject into
        // odometry even while disabled.  This keeps the pose estimator warm
        // so it doesn't drift on wheel slip / encoder error during pre-match
        // repositioning, and gives AdvantageScope a live fused pose ghost.
        if (hasSeed) {
          disabledAcceptedBuf.clear();
          for (int i = 0; i < VisionConstants.kCameraNames.length; i++) {
            AcceptedObservation obs =
                processCamera(
                    VisionConstants.kCameraNames[i], robotYawDeg, yawRateDps, i, shouldLog);
            if (obs != null) {
              disabledAcceptedBuf.add(obs);
            }
          }
          disabledAcceptedBuf.sort(
              Comparator.comparingDouble(AcceptedObservation::timestampSeconds));
          for (AcceptedObservation obs : disabledAcceptedBuf) {
            drive.addVisionMeasurement(
                obs.pose(),
                obs.timestampSeconds(),
                VecBuilder.fill(obs.scaledXYStdDev(), obs.scaledXYStdDev(), obs.thetaStdDev()));
          }
        } else if (shouldLog) {
          // Not yet seeded — just log MT2 for diagnostics (rate-limited).
          for (int i = 0; i < VisionConstants.kCameraNames.length; i++) {
            logRawMegaTag2Pose(VisionConstants.kCameraNames[i], i);
          }
        }
      }
      return;
    }

    // Enabled path — full-rate processing every cycle.
    // NoFlush: WPILib already flushes NT at the end of every 20 ms loop iteration,
    // so the orientation data reaches the LLs within one cycle regardless.
    // Calling flush() manually just blocks the thread for no benefit.
    for (String name : VisionConstants.kCameraNames) {
      LimelightHelpers.SetRobotOrientation_NoFlush(name, robotYawDeg, 0.0, 0.0, 0.0, 0.0, 0.0);
    }

    // Process each camera — collect accepted observations for timestamp-sorted injection.
    // Sorting ensures the pose estimator processes measurements in chronological order
    // even when cameras have different pipeline latencies.
    acceptedBuf.clear();
    for (int i = 0; i < VisionConstants.kCameraNames.length; i++) {
      AcceptedObservation obs =
          processCamera(VisionConstants.kCameraNames[i], robotYawDeg, yawRateDps, i, shouldLog);
      if (obs != null) {
        acceptedBuf.add(obs);
      }
    }

    // ---- MT1 diagnostic logging (gated, no injection) ----
    // Log the raw MT1 pose + tag count + avg distance for every camera on log
    // cycles so we can compare MT1 vs MT2 in AdvantageScope.  This is purely
    // diagnostic — the data is NOT fed into the pose estimator.
    if (shouldLog) {
      for (int i = 0; i < VisionConstants.kCameraNames.length; i++) {
        String cameraName = VisionConstants.kCameraNames[i];
        String prefix = "Vision/" + cameraName + "/";
        PoseEstimate mt1Est = LimelightHelpers.getBotPoseEstimate_wpiBlue(cameraName);
        if (mt1Est != null && mt1Est.tagCount > 0 && mt1Est.pose != null) {
          Logger.recordOutput(prefix + "mt1Pose", mt1Est.pose);
          Logger.recordOutput(prefix + "mt1TagCount", mt1Est.tagCount);
          Logger.recordOutput(prefix + "mt1AvgTagDist", mt1Est.avgTagDist);
          double[] stddevs = LimelightHelpers.getLimelightNTDoubleArray(cameraName, "stddevs");
          if (stddevs.length >= VisionConstants.kExpectedStdDevArrayLength) {
            Logger.recordOutput(
                prefix + "mt1YawStdDev", stddevs[VisionConstants.kMT1YawStdDevIndex]);
            Logger.recordOutput(
                prefix + "mt1XYStdDev",
                Math.max(
                    stddevs[VisionConstants.kMT1XStdDevIndex],
                    stddevs[VisionConstants.kMT1YStdDevIndex]));
          }
        } else {
          Logger.recordOutput(prefix + "mt1Pose", OFF_SCREEN_POSE);
          Logger.recordOutput(prefix + "mt1TagCount", 0);
        }
      }
    }

    // ---- MT1 heading drift correction (low-rate) ----
    // Every Nth cycle, query MT1 from each camera.  When ≥2 tags are visible
    // with low yaw stddev, inject the full 6-DOF pose with a moderate theta
    // stddev so the pose estimator slowly corrects gyro heading drift.
    // The XY component is heavily down-weighted (MT2 is better for XY).
    mt1HeadingCycleCounter++;
    if (mt1HeadingCycleCounter >= VisionConstants.kMT1HeadingCorrectionInterval) {
      mt1HeadingCycleCounter = 0;
      for (int i = 0; i < VisionConstants.kCameraNames.length; i++) {
        AcceptedObservation mt1Obs =
            processCameraMT1Heading(VisionConstants.kCameraNames[i], i, shouldLog);
        if (mt1Obs != null) {
          acceptedBuf.add(mt1Obs);
        }
      }
    }

    // Sort by timestamp (oldest first) and inject into pose estimator via WPILib's
    // built-in Kalman filter (SwerveDrivePoseEstimator). Each camera's stddev weight
    // controls how much it influences the fused pose — lower stddev = more trust.
    acceptedBuf.sort(Comparator.comparingDouble(AcceptedObservation::timestampSeconds));
    for (AcceptedObservation obs : acceptedBuf) {
      drive.addVisionMeasurement(
          obs.pose(),
          obs.timestampSeconds(),
          VecBuilder.fill(obs.scaledXYStdDev(), obs.scaledXYStdDev(), obs.thetaStdDev()));
    }

    // Log the final filtered pose feeding odometry (rate-limited).
    if (shouldLog) {
      // Log the combined accepted pose that is actually feeding the pose
      // estimator this cycle.  When multiple cameras pass filters we compute a
      // stddev-weighted average so AdvantageScope can show a single "what
      // odometry sees" ghost alongside the per-camera raw ghosts.
      if (!acceptedBuf.isEmpty()) {
        lastFinalFilteredTime = Timer.getFPGATimestamp();
        double weightSum = 0.0;
        double sumX = 0.0;
        double sumY = 0.0;
        double sumCos = 0.0;
        double sumSin = 0.0;
        for (AcceptedObservation obs : acceptedBuf) {
          // Weight = 1/stddev² — lower stddev → higher weight.
          double w = 1.0 / (obs.scaledXYStdDev() * obs.scaledXYStdDev());
          weightSum += w;
          sumX += obs.pose().getX() * w;
          sumY += obs.pose().getY() * w;
          double r = obs.pose().getRotation().getRadians();
          sumCos += Math.cos(r) * w;
          sumSin += Math.sin(r) * w;
        }
        double avgX = sumX / weightSum;
        double avgY = sumY / weightSum;
        double avgYaw = Math.atan2(sumSin / weightSum, sumCos / weightSum);
        Pose2d combinedAccepted = new Pose2d(avgX, avgY, new Rotation2d(avgYaw));
        Logger.recordOutput("Vision/finalFilteredPose", combinedAccepted);
        Logger.recordOutput("Vision/finalFilteredXYStdDev", Math.sqrt(1.0 / weightSum));
      } else if (Timer.getFPGATimestamp() - lastFinalFilteredTime > STALE_TIMEOUT_SEC) {
        // No cameras accepted — move the combined ghost off-screen after 1s.
        Logger.recordOutput("Vision/finalFilteredPose", OFF_SCREEN_POSE);
      }
    }
  }

  /**
   * Sets the IMU mode on every camera. Uses a two-phase strategy:
   *
   * <ul>
   *   <li><b>All modes:</b> Mode 0 — "External Only". The LL ignores its internal IMU entirely and
   *       uses exactly the heading supplied via {@code SetRobotOrientation()} for every MT2 solve.
   *       This ensures MT2 output is always consistent with the Pigeon2 heading we feed it, with no
   *       internal drift or IMU fighting on enable transitions.
   * </ul>
   *
   * <p>Mode 4 (Internal + External Assist) was previously used while enabled but caused heading
   * corruption on the disabled→enabled transition — the LL's internal IMU would disagree with the
   * Pigeon and pull MT2 heading off. Since we push raw Pigeon2 yaw every cycle at 50 Hz, Mode 0 is
   * sufficient and eliminates the issue entirely.
   */
  private void setIMUModes() {
    // Mode 0 (External Only) always — MT2 uses exactly what we pass to SetRobotOrientation.
    // The Pigeon2 heading is pushed every cycle at 50 Hz which is more than sufficient.
    int mode = 0;
    if (mode == lastIMUMode) {
      return;
    }
    lastIMUMode = mode;
    for (String name : VisionConstants.kCameraNames) {
      LimelightHelpers.SetIMUMode(name, mode);
    }
  }

  private void logRawMegaTag2Pose(String cameraName, int cameraIndex) {
    String prefix = "Vision/" + cameraName + "/";
    PoseEstimate estimate = LimelightHelpers.getBotPoseEstimate_wpiBlue_MegaTag2(cameraName);
    if (estimate != null && estimate.tagCount > 0 && estimate.pose != null) {
      lastMT2SeenTime[cameraIndex] = Timer.getFPGATimestamp();
      // Read real LL-reported stddevs for diagnostic logging.
      double xyStdDev = -1.0;
      double[] stddevs = LimelightHelpers.getLimelightNTDoubleArray(cameraName, "stddevs");
      if (stddevs.length >= VisionConstants.kExpectedStdDevArrayLength) {
        double xStdDev = stddevs[VisionConstants.kMT2XStdDevIndex];
        double yStdDev = stddevs[VisionConstants.kMT2YStdDevIndex];
        xyStdDev = Math.max(xStdDev, yStdDev);
      }
      Logger.recordOutput(prefix + "mt2Pose", estimate.pose);
      Logger.recordOutput(prefix + "mt2XYStdDev", xyStdDev);
    } else {
      // No tags — if stale for > 1s, log off-screen so AdvantageScope clears the ghost.
      if (Timer.getFPGATimestamp() - lastMT2SeenTime[cameraIndex] > STALE_TIMEOUT_SEC) {
        Logger.recordOutput(prefix + "mt2Pose", OFF_SCREEN_POSE);
      }
      Logger.recordOutput(prefix + "mt2XYStdDev", -1.0);
    }
  }

  // -----------------------------------------------------------------------
  //  Per-camera processing
  // -----------------------------------------------------------------------
  /**
   * Queries one Limelight for a MegaTag 2 pose estimate, applies filtering, and — if accepted —
   * returns an {@link AcceptedObservation} ready for injection. Returns {@code null} if the
   * measurement was rejected by any filter.
   *
   * @param cameraName Limelight hostname
   * @param robotYawDeg Current gyro yaw in degrees
   * @param yawRateDegPerSec Current angular velocity in deg/s
   * @param cameraIndex Index into kCameraNames (for logging and per-camera stddev factor)
   * @param shouldLog Whether to emit Logger output this cycle (rate-limited) /** Queries one
   *     Limelight for a MegaTag 2 pose estimate, applies filtering, and — if accepted — returns an
   *     {@link AcceptedObservation} ready for injection.
   *     <p>Filters: null/no-tag guard, stale timestamp rejection (kMaxMeasurementAgeSec), duplicate
   *     timestamp rejection, yaw rate gate (kMaxAngularVelocityDegPerSec), off-field bounds check.
   * @param cameraName Limelight hostname
   * @param cameraIndex Index into kCameraNames (for per-camera stddev factor)
   * @param shouldLog Whether to emit Logger output this cycle (rate-limited)
   * @return An accepted observation, or {@code null} if rejected.
   */
  private AcceptedObservation processCamera(
      String cameraName,
      double robotYawDeg,
      double yawRateDegPerSec,
      int cameraIndex,
      boolean shouldLog) {

    String prefix = "Vision/" + cameraName + "/";

    // 1. Read the MegaTag 2 pose estimate.
    PoseEstimate estimate = LimelightHelpers.getBotPoseEstimate_wpiBlue_MegaTag2(cameraName);

    // 2. Null / no-tag guard.
    if (estimate == null || estimate.tagCount == 0 || estimate.pose == null) {
      // No tags — if stale for > 1s, log off-screen so AdvantageScope clears the ghost.
      if (shouldLog
          && Timer.getFPGATimestamp() - lastMT2SeenTime[cameraIndex] > STALE_TIMEOUT_SEC) {
        Logger.recordOutput(prefix + "mt2Pose", OFF_SCREEN_POSE);
      }
      return null;
    }

    Pose2d visionPose = estimate.pose;
    lastMT2SeenTime[cameraIndex] = Timer.getFPGATimestamp();

    // Log raw MT2 pose and real LL-reported stddevs (diagnostic only).
    if (shouldLog) {
      Logger.recordOutput(prefix + "mt2Pose", visionPose);
      double[] stddevs = LimelightHelpers.getLimelightNTDoubleArray(cameraName, "stddevs");
      if (stddevs.length >= VisionConstants.kExpectedStdDevArrayLength) {
        double xStdDev = stddevs[VisionConstants.kMT2XStdDevIndex];
        double yStdDev = stddevs[VisionConstants.kMT2YStdDevIndex];
        Logger.recordOutput(prefix + "mt2XYStdDev", Math.max(xStdDev, yStdDev));
      }
    }

    // 3. Reject stale measurements — if the NT4 connection dropped during a
    //    loop overrun, the Limelight queues frames that were computed against
    //    the heading you pushed *before* the disconnect.  Those poses reflect
    //    where the robot WAS, not where it IS, and they cause visible jitter
    //    for several seconds after the robot stops moving.
    double measurementAge = Timer.getFPGATimestamp() - estimate.timestampSeconds;
    if (measurementAge > VisionConstants.kMaxMeasurementAgeSec) {
      if (shouldLog) {
        Logger.recordOutput(prefix + "accepted", false);
        Logger.recordOutput(prefix + "rejectReason", "stale:" + measurementAge);
      }
      return null;
    }

    // 4. Reject duplicate / replayed timestamps — when the NT4 connection
    //    reconnects, getAtomic() may return the same embedded timestamp as the
    //    last accepted observation.  Re-injecting the same pose is useless at
    //    best and harmful if the robot has moved since.
    if (estimate.timestampSeconds <= lastAcceptedTimestamp[cameraIndex]) {
      if (shouldLog) {
        Logger.recordOutput(prefix + "accepted", false);
        Logger.recordOutput(prefix + "rejectReason", "duplicate");
      }
      return null;
    }

    // 5. Reject while spinning fast — motion blur degrades tag detection and
    //    MT2 solves become unreliable at high angular velocities.
    if (Math.abs(yawRateDegPerSec) > VisionConstants.kMaxAngularVelocityDegPerSec) {
      if (shouldLog) {
        Logger.recordOutput(prefix + "accepted", false);
        Logger.recordOutput(prefix + "rejectReason", "spinning");
      }
      return null;
    }

    // 6. Reject poses clearly off the field.
    if (visionPose.getX() < 0.01
        || visionPose.getX() > Constants.kFieldLengthMeters
        || visionPose.getY() < 0.01
        || visionPose.getY() > Constants.kFieldWidthMeters) {
      if (shouldLog) {
        Logger.recordOutput(prefix + "accepted", false);
        Logger.recordOutput(prefix + "rejectReason", "off-field");
      }
      return null;
    }

    // 7. Reject if average tag distance exceeds the cutoff.
    //    Far-away tags have poor corner resolution and produce noisy solves.
    //    With hub-only tags this also prevents the far hub from polluting.
    if (estimate.avgTagDist > VisionConstants.kMaxAvgTagDistMeters) {
      if (shouldLog) {
        Logger.recordOutput(prefix + "accepted", false);
        Logger.recordOutput(prefix + "rejectReason", "too-far:" + estimate.avgTagDist);
      }
      return null;
    }

    // 8. Apply per-camera trust factor + distance scaling.
    //    Scale stddev by (avgTagDist / refDist)² so far tags are trusted less.
    //    At the reference distance (2 m) the base multiplier is unchanged;
    //    at 4 m it's 4× larger, etc.
    double cameraFactor = VisionConstants.kCameraStdDevFactors[cameraIndex];
    double scaledXYStdDev = VisionConstants.kMT2StdDevMultiplier * cameraFactor;
    if (VisionConstants.kDistanceScalingEnabled && estimate.avgTagDist > 0.0) {
      double distRatio = estimate.avgTagDist / VisionConstants.kDistScalingRefMeters;
      scaledXYStdDev *= distRatio * distRatio;
    }

    // 9. Apply tag-specific trust weighting.
    //    Hub tags are trusted 3× more than wall tags (configured in VisionConstants).
    //    Lower factor => lower stddev => more trust in the fused estimate.
    double tagTrustStdDevFactor = getTagTrustStdDevFactor(estimate);
    scaledXYStdDev *= tagTrustStdDevFactor;

    if (shouldLog) {
      Logger.recordOutput(prefix + "avgTagDist", estimate.avgTagDist);
      Logger.recordOutput(prefix + "tagTrustStdDevFactor", tagTrustStdDevFactor);
      Logger.recordOutput(prefix + "scaledXYStdDev", scaledXYStdDev);
    }

    // Record this timestamp so future duplicate frames from the same camera
    // are rejected by filter 4.
    lastAcceptedTimestamp[cameraIndex] = estimate.timestampSeconds;

    if (shouldLog) {
      Logger.recordOutput(prefix + "accepted", true);
      Logger.recordOutput(prefix + "rejectReason", "");
    }

    return new AcceptedObservation(
        visionPose, estimate.timestampSeconds, scaledXYStdDev, VisionConstants.kThetaStdDev);
  }

  // -----------------------------------------------------------------------
  //  MT1 heading drift correction (while enabled)
  // -----------------------------------------------------------------------
  /**
   * Queries one Limelight for a MegaTag 1 pose estimate to extract heading information for gyro
   * drift correction. MT1 performs a full 6-DOF solve (including independent rotation estimation),
   * unlike MT2 which echoes back the gyro heading you supply.
   *
   * <p>Filters: null/no-tag guard, minimum 2 tags (single-tag MT1 has yaw ambiguity), yaw stddev
   * gate, stale timestamp, off-field bounds. XY is heavily down-weighted since MT2 is more accurate
   * for translation — we only want the heading information from MT1.
   *
   * @param cameraName Limelight hostname
   * @param cameraIndex Index into kCameraNames
   * @param shouldLog Whether to emit Logger output this cycle (rate-limited)
   * @return An accepted observation with finite theta stddev, or {@code null} if rejected.
   */
  private AcceptedObservation processCameraMT1Heading(
      String cameraName, int cameraIndex, boolean shouldLog) {

    String prefix = "Vision/" + cameraName + "/";

    // 1. Read the MegaTag 1 pose estimate (full 6-DOF including rotation).
    PoseEstimate estimate = LimelightHelpers.getBotPoseEstimate_wpiBlue(cameraName);

    // 2. Null / no-tag guard.
    if (estimate == null || estimate.tagCount == 0 || estimate.pose == null) {
      return null;
    }

    // 3. Require ≥2 tags — single-tag MT1 has yaw flip ambiguity.
    if (estimate.tagCount < VisionConstants.kMT1HeadingMinTagCount) {
      return null;
    }

    Pose2d visionPose = estimate.pose;

    // 4. Reject stale measurements (same logic as MT2 filter).
    double measurementAge = Timer.getFPGATimestamp() - estimate.timestampSeconds;
    if (measurementAge > VisionConstants.kMaxMeasurementAgeSec) {
      return null;
    }

    // 5. Reject poses off the field.
    if (visionPose.getX() < 0.01
        || visionPose.getX() > Constants.kFieldLengthMeters
        || visionPose.getY() < 0.01
        || visionPose.getY() > Constants.kFieldWidthMeters) {
      return null;
    }

    // 6. Reject if average tag distance exceeds the cutoff.
    if (estimate.avgTagDist > VisionConstants.kMaxAvgTagDistMeters) {
      return null;
    }

    // 7. Read yaw stddev — only correct heading when MT1 is confident.
    double[] stddevs = LimelightHelpers.getLimelightNTDoubleArray(cameraName, "stddevs");
    if (stddevs.length < VisionConstants.kExpectedStdDevArrayLength) {
      return null;
    }
    double yawStdDev = stddevs[VisionConstants.kMT1YawStdDevIndex];
    if (yawStdDev > VisionConstants.kMT1HeadingMaxYawStdDevDeg) {
      return null;
    }

    // 7. Accepted — inject with high XY stddev (down-weight translation) and
    //    moderate theta stddev (the heading info we actually want).
    double cameraFactor = VisionConstants.kCameraStdDevFactors[cameraIndex];
    double scaledXYStdDev = VisionConstants.kMT1HeadingXYStdDevMultiplier * cameraFactor;
    double tagTrustStdDevFactor = getTagTrustStdDevFactor(estimate);
    scaledXYStdDev *= tagTrustStdDevFactor;

    if (shouldLog) {
      Logger.recordOutput(prefix + "mt1HeadingPose", visionPose);
      Logger.recordOutput(prefix + "mt1HeadingYawStdDev", yawStdDev);
      Logger.recordOutput(prefix + "mt1HeadingTagTrustStdDevFactor", tagTrustStdDevFactor);
      Logger.recordOutput(prefix + "mt1HeadingAccepted", true);
    }

    return new AcceptedObservation(
        visionPose,
        estimate.timestampSeconds,
        scaledXYStdDev,
        VisionConstants.kMT1HeadingThetaStdDev);
  }

  /**
   * Computes a stddev multiplier from the tags in a pose estimate.
   *
   * <p>If multiple tags are present, we use the most-trusted one (minimum stddev factor) so a
   * visible hub tag can dominate over wall tags in mixed observations.
   */
  private static double getTagTrustStdDevFactor(PoseEstimate estimate) {
    RawFiducial[] rawFiducials = estimate.rawFiducials;
    if (rawFiducials == null || rawFiducials.length == 0) {
      return VisionConstants.kUnknownTagStdDevFactor;
    }

    double bestFactor = Double.POSITIVE_INFINITY;
    for (RawFiducial fiducial : rawFiducials) {
      if (fiducial == null) {
        continue;
      }
      bestFactor = Math.min(bestFactor, VisionConstants.getTagTrustStdDevFactor(fiducial.id));
    }

    if (!Double.isFinite(bestFactor)) {
      return VisionConstants.kUnknownTagStdDevFactor;
    }
    return bestFactor;
  }

  // -----------------------------------------------------------------------
  //  Pre-match pose seeding (while disabled, MegaTag 1)
  // -----------------------------------------------------------------------
  /**
   * Process a single camera while disabled to seed the full pose (XY + heading) from MT1. Only runs
   * once — after the first high-confidence seed, subsequent calls are no-ops.
   *
   * <p>Filters: null/no-tag guard, off-field bounds, yaw stddev gate (kGyroSeedMaxYawStdDevDeg).
   */
  private void processCameraPreMatch(String cameraName, int cameraIndex, boolean shouldLog) {

    // Only seed once per power cycle.
    if (hasSeed) {
      return;
    }

    String prefix = "Vision/" + cameraName + "/";

    // 1. Read the MegaTag 1 pose estimate (full 6-DOF including rotation).
    PoseEstimate estimate = LimelightHelpers.getBotPoseEstimate_wpiBlue(cameraName);

    // 2. Null / no-tag guard.
    if (estimate == null || estimate.tagCount == 0 || estimate.pose == null) {
      return;
    }

    Pose2d visionPose = estimate.pose;
    if (shouldLog) {
      Logger.recordOutput(prefix + "mt1Pose", visionPose);
    }

    // 3. Reject poses off the field.
    if (visionPose.getX() < 0.01
        || visionPose.getX() > Constants.kFieldLengthMeters
        || visionPose.getY() < 0.01
        || visionPose.getY() > Constants.kFieldWidthMeters) {
      return;
    }

    // 4. Read yaw stddev — only seed when MT1 rotation confidence is very high.
    double[] stddevs = LimelightHelpers.getLimelightNTDoubleArray(cameraName, "stddevs");
    if (stddevs.length < VisionConstants.kExpectedStdDevArrayLength) {
      return;
    }
    double yawStdDev = stddevs[VisionConstants.kMT1YawStdDevIndex];
    if (shouldLog) {
      Logger.recordOutput(prefix + "mt1YawStdDev", yawStdDev);
    }
    if (yawStdDev > VisionConstants.kGyroSeedMaxYawStdDevDeg) {
      return;
    }

    // 5. High-confidence seed — hard-reset pose estimator (XY + Pigeon heading).
    drive.setPose(visionPose);
    hasSeed = true;
    seedStable = true;

    // Immediately broadcast the new heading to ALL cameras so MT2 is re-anchored right away.
    // No manual flush needed — WPILib flushes NT at the end of every loop iteration.
    double newYawDeg = visionPose.getRotation().getDegrees();
    for (String cam : VisionConstants.kCameraNames) {
      LimelightHelpers.SetRobotOrientation_NoFlush(cam, newYawDeg, 0.0, 0.0, 0.0, 0.0, 0.0);
    }

    if (shouldLog) {
      Logger.recordOutput(prefix + "poseSeeded", true);
      Logger.recordOutput(prefix + "poseSeedYawDeg", newYawDeg);
    }
  }
}
