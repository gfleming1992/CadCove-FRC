package frc.robot.subsystems.scorer.turret;

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.geometry.Translation2d;
import edu.wpi.first.wpilibj.DriverStation.Alliance;
import frc.lib.util.FieldConstants;
import frc.robot.Constants;
import frc.robot.Robot;
import java.util.Arrays;
import java.util.Comparator;

/**
 * Pure-math utility that computes the desired turret (lateral) and hood (vertical) angles for the
 * scorers based on the robot's current field pose and alliance color.
 *
 * <p>Both turrets are mechanically parallel, but each shooter exit is modeled independently so the
 * aim can account for their unique offsets when computing turret angle, hood, flywheel, and feed
 * values.
 *
 * <h2>Zone logic</h2>
 *
 * <ul>
 *   <li><b>Own-alliance zone</b> — aim both scorers at the alliance hub.
 *   <li><b>Neutral (middle) zone</b> — "pass" mode: aim at the nearest landing zone on the alliance
 *       side so a partner can receive the ball.
 *   <li><b>Opponent zone</b> — stow (return 0° turret, stow hood).
 * </ul>
 *
 * <h2>Coordinate conventions</h2>
 *
 * <ul>
 *   <li>Field origin at blue-alliance corner (0, 0). X runs toward red wall.
 *   <li>Robot heading 0° = facing red wall (+X).
 *   <li>Turret 0° = facing robot-forward. Positive = CCW (left when viewed from above).
 *   <li>Hood angle = degrees from vertical (0° = straight up, 35° = 55° from horizontal). The ball
 *       exits perpendicular to the hood face, so the actual launch elevation from horizontal is
 *       {@code 90 − hoodDeg}. Lower hood values produce steeper (more vertical) trajectories;
 *       higher values produce flatter trajectories.
 * </ul>
 */
public final class TurretAimCalculator {
  private static final double[][] SORTED_SHOOT_TABLE =
      sortTableByDistance(Constants.ScorerConstants.kShootTable);

  /** Immutable result of a single aim calculation for both scorers. */
  public static class AimResult {
    /** Left turret lateral angle in degrees (0 = forward, + = left). */
    public final double leftTurretDeg;

    /** Left hood angle in degrees from vertical (0 = straight up, 35 = 55° from horizontal). */
    public final double leftHoodDeg;

    /** Left flywheel speed in RPM. */
    public final double leftFlywheelRPM;

    /** Left vertical feed speed in RPM. */
    public final double leftVerticalFeedRPM;

    /** Right turret lateral angle in degrees (0 = forward, + = left). */
    public final double rightTurretDeg;

    /** Right hood angle in degrees from vertical (0 = straight up, 35 = 55° from horizontal). */
    public final double rightHoodDeg;

    /** Right flywheel speed in RPM. */
    public final double rightFlywheelRPM;

    /** Right vertical feed speed in RPM. */
    public final double rightVerticalFeedRPM;

    /** Left shooter horizontal distance to target in meters. */
    public final double leftDistanceToTargetMeters;

    /** Right shooter horizontal distance to target in meters. */
    public final double rightDistanceToTargetMeters;

    /** The field-space target both scorers are aiming at (for logging). */
    public final Translation2d target;

    /** True when in own-alliance zone (aim at hub); false for pass/lob/stow. */
    public final boolean home;

    public AimResult(
        double leftTurretDeg,
        double leftHoodDeg,
        double leftFlywheelRPM,
        double leftVerticalFeedRPM,
        double rightTurretDeg,
        double rightHoodDeg,
        double rightFlywheelRPM,
        double rightVerticalFeedRPM,
        double leftDistanceToTargetMeters,
        double rightDistanceToTargetMeters,
        Translation2d target,
        boolean home) {
      this.leftTurretDeg = leftTurretDeg;
      this.leftHoodDeg = leftHoodDeg;
      this.leftFlywheelRPM = leftFlywheelRPM;
      this.leftVerticalFeedRPM = leftVerticalFeedRPM;
      this.rightTurretDeg = rightTurretDeg;
      this.rightHoodDeg = rightHoodDeg;
      this.rightFlywheelRPM = rightFlywheelRPM;
      this.rightVerticalFeedRPM = rightVerticalFeedRPM;
      this.leftDistanceToTargetMeters = leftDistanceToTargetMeters;
      this.rightDistanceToTargetMeters = rightDistanceToTargetMeters;
      this.target = target;
      this.home = home;
    }
  }

  // Hood limits — read from Constants so they stay tunable in one place.
  // (No circular dependency: Constants is a leaf class with only static finals.)

  // ---- Turret wrap-around state ----
  // Tracks the last output angle so we can pick the closest 360° wrap each
  // cycle.  This prevents the turret from snapping at ±180° and lets it use
  // the full ±220° software range before flipping.
  private enum TurretSide {
    LEFT,
    RIGHT
  }

  private static double lastLeftTurretDeg = 0.0;
  private static double lastRightTurretDeg = 0.0;

  // The turret flips to the other side when the commanded angle exceeds this
  // threshold.  270° is safely beyond the ±220° software limit, so the turret
  // uses its full range before wrapping to the opposite side.
  private static final double FLIP_THRESHOLD = 270.0;

  /** Prevent instantiation. */
  private TurretAimCalculator() {}

  /**
   * Compute aim angles for both turrets and hoods using the same robot pose for both.
   *
   * @param robotPose Current robot field pose from odometry / pose estimator.
   * @return Combined {@link AimResult} for left and right turrets.
   */
  public static AimResult calculate(Pose2d robotPose) {
    return calculate(robotPose, robotPose);
  }

  /**
   * Compute aim angles for both turrets and hoods, allowing each side to use its own effective
   * robot pose (e.g., after TOF-based ballistic compensation).
   *
   * @param leftPose Pose to use when computing the left shooter location/heading.
   * @param rightPose Pose to use when computing the right shooter location/heading.
   * @return Combined {@link AimResult} for left and right turrets.
   */
  public static AimResult calculate(Pose2d leftPose, Pose2d rightPose) {
    boolean isBlue = (Robot.getEffectiveAlliance() == Alliance.Blue);

    FieldConstants.Zone zone = Robot.currentZone;

    // ---- Pick field-space target ----
    Translation2d fieldTarget;

    boolean home = false;
    if (isBlue && zone == FieldConstants.Zone.BLUE) {
      home = true;
    } else if (!isBlue && zone == FieldConstants.Zone.RED) {
      home = true;
    }

    double referenceY = (leftPose.getY() + rightPose.getY()) / 2.0;
    if (home) {
      // Aim at our hub
      if (isBlue) {
        fieldTarget =
            new Translation2d(FieldConstants.Hub.BLUE.getX(), FieldConstants.Hub.BLUE.getY());
      } else {
        fieldTarget =
            new Translation2d(FieldConstants.Hub.RED.getX(), FieldConstants.Hub.RED.getY());
      }
    } else { // Midfield or opponent zone
      // Pass mode — aim at the landing zone on OUR side.
      // Choose whichever landing zone (outpost vs depot) is closer to the
      // robot's current Y to minimize turret travel.
      fieldTarget = pickLandingTarget(referenceY, isBlue);
    }

    // ---- Compute aim from each shooter exit ----
    Translation2d leftShooterField =
        robotToField(
            leftPose,
            Constants.ScorerConstants.kLeftShooterXOffsetMeters,
            Constants.ScorerConstants.kLeftShooterYOffsetMeters);
    Translation2d rightShooterField =
        robotToField(
            rightPose,
            Constants.ScorerConstants.kRightShooterXOffsetMeters,
            Constants.ScorerConstants.kRightShooterYOffsetMeters);

    double[] leftResult =
        computeAngles(leftShooterField, fieldTarget, leftPose.getRotation(), home, TurretSide.LEFT);
    double[] rightResult =
        computeAngles(
            rightShooterField, fieldTarget, rightPose.getRotation(), home, TurretSide.RIGHT);

    double turretDegLeft = leftResult[0] + Constants.ScorerConstants.kTurretOffsetDegrees;
    double turretDegRight = rightResult[0] + Constants.ScorerConstants.kTurretOffsetDegrees;

    double leftHoodDeg = leftResult[1];
    double rightHoodDeg = rightResult[1];
    double leftFlywheelRPM = leftResult[2];
    double rightFlywheelRPM = rightResult[2];
    double leftVerticalFeedRPM = leftResult[3];
    double rightVerticalFeedRPM = rightResult[3];

    double leftDistanceMeters = leftShooterField.getDistance(fieldTarget);
    double rightDistanceMeters = rightShooterField.getDistance(fieldTarget);

    return new AimResult(
        turretDegLeft,
        leftHoodDeg,
        leftFlywheelRPM,
        leftVerticalFeedRPM,
        turretDegRight,
        rightHoodDeg,
        rightFlywheelRPM,
        rightVerticalFeedRPM,
        leftDistanceMeters,
        rightDistanceMeters,
        fieldTarget,
        home);
  }

  // ====================================================================
  // Private helpers
  // ====================================================================

  /**
   * Estimate the ball's time-of-flight in seconds for a shot at the given distance.
   *
   * <p>Interpolates from the TOF column (column 3) of {@link
   * Constants.ScorerConstants#kShootTable}.
   *
   * @param distance Horizontal distance in meters from shooter to target.
   * @param home true when in own-alliance zone (hub scoring); false for pass mode.
   * @return Estimated flight time in seconds.
   */
  public static double estimateTimeOfFlight(double distance, boolean home) {
    return interpolateTable(SORTED_SHOOT_TABLE, distance, 3);
  }

  /**
   * Convert a robot-relative offset to a field-space Translation2d using the robot's current pose.
   */
  public static Translation2d robotToField(Pose2d robotPose, double robotRelX, double robotRelY) {
    // Rotate the offset by the robot heading, then translate to the robot's
    // field position.
    double cos = robotPose.getRotation().getCos();
    double sin = robotPose.getRotation().getSin();
    double fieldX = robotPose.getX() + (robotRelX * cos - robotRelY * sin);
    double fieldY = robotPose.getY() + (robotRelX * sin + robotRelY * cos);
    return new Translation2d(fieldX, fieldY);
  }

  /**
   * Compute turret angle, hood angle, flywheel speed, and vertical-feed speed for a single shooter.
   *
   * @param shooterField Field-space XY of the shooter exit.
   * @param targetField Field-space XY of the target.
   * @param robotHeading Current robot heading on the field.
   * @param home true when in own alliance zone (aim at hub); false for pass/lob mode.
   * @return double[4]: [turretDeg, hoodDeg, flywheelRPM, verticalFeedRPM].
   */
  private static double[] computeAngles(
      Translation2d shooterField,
      Translation2d targetField,
      Rotation2d robotHeading,
      boolean home,
      TurretSide side) {
    // --- Lateral (turret) angle ---
    // Vector from shooter to target in field frame
    double dx = targetField.getX() - shooterField.getX();
    double dy = targetField.getY() - shooterField.getY();

    // Field-frame bearing to the target (radians, 0 = +X, CCW positive)
    double fieldBearing = Math.atan2(dy, dx);

    // Turret angle = field bearing − robot heading.
    // This gives the angle in the robot's reference frame.
    double turretRad = fieldBearing - robotHeading.getRadians();

    // ---- Wrap-around ----
    // The turret is software-limited to ±220° from forward (440° total).
    // atan2 gives [-180, +180] which hides the fact that the turret can
    // smoothly pass through ±180°.  We pick the 360° wrap of the raw angle
    // that is closest to the previous output, giving natural continuity.
    // If that result exceeds ±FLIP_THRESHOLD (270°) we snap to the other
    // side — the turret has gone as far as it can and must reverse.

    double turretDeg = Math.toDegrees(turretRad);
    double turretMax = Constants.ScorerConstants.kTurretMaxPositionUnits; // +220
    double turretMin = Constants.ScorerConstants.kTurretMinPositionUnits; // -220

    // Normalize raw value to [-180, +180] as a clean starting point
    turretDeg = Math.IEEEremainder(turretDeg, 360.0);

    // Pick the 360° wrap closest to where the turret was last cycle.
    // This lets the angle smoothly pass through ±180° without snapping.
    double previousTurretDeg = (side == TurretSide.LEFT) ? lastLeftTurretDeg : lastRightTurretDeg;

    while (turretDeg - previousTurretDeg > 180.0) turretDeg -= 360.0;
    while (turretDeg - previousTurretDeg < -180.0) turretDeg += 360.0;

    // If we've exceeded the flip threshold, snap to the other side.
    if (turretDeg > FLIP_THRESHOLD) {
      turretDeg -= 360.0;
    } else if (turretDeg < -FLIP_THRESHOLD) {
      turretDeg += 360.0;
    }

    // Final safety clamp (dead-band behind robot where neither wrap fits)
    turretDeg = Math.max(turretMin, Math.min(turretMax, turretDeg));

    // Remember for next cycle
    if (side == TurretSide.LEFT) {
      lastLeftTurretDeg = turretDeg;
    } else {
      lastRightTurretDeg = turretDeg;
    }

    // --- Vertical (hood) angle and flywheel speed via lookup table ---
    double horizontalDist = Math.hypot(dx, dy);
    double hoodDeg;
    double flywheelRPM;
    double verticalFeedRPM;

    hoodDeg = interpolateTable(SORTED_SHOOT_TABLE, horizontalDist, 1); // column 1 = hood
    flywheelRPM = interpolateTable(SORTED_SHOOT_TABLE, horizontalDist, 2); // column 2 = flywheel
    verticalFeedRPM =
        interpolateTable(SORTED_SHOOT_TABLE, horizontalDist, 4); // column 4 = vertical feed

    // Separate simulator calibration from the team's measured hardware table.
    if (org.instantcad.frc.TwinBridge.enabled()) {
      hoodDeg += org.instantcad.frc.ShotTuning.HOOD_OFFSET;
      flywheelRPM *= org.instantcad.frc.ShotTuning.RPM_SCALE;
      verticalFeedRPM *= org.instantcad.frc.ShotTuning.FEED_SCALE;
    }

    // Clamp hood to physical limits
    hoodDeg =
        clamp(
            hoodDeg,
            Constants.ScorerConstants.kHoodMinDegrees,
            Constants.ScorerConstants.kHoodMaxDegrees);

    return new double[] {turretDeg, hoodDeg, flywheelRPM, verticalFeedRPM};
  }

  /**
   * Linearly interpolate a value from a sorted lookup table.
   *
   * <p>The table must be sorted ascending by column 0 (distance). If the input distance is below
   * the first row or above the last row, the corresponding row's value is returned (clamped, not
   * extrapolated).
   *
   * @param table 2-D array where each row is {distance, ...values...}.
   * @param distance The horizontal distance to look up.
   * @param valueColumn The column index of the value to interpolate (1-based: 1 = hood, 2 =
   *     flywheel, 3 = TOF, 4 = vertical feed).
   * @return The interpolated value.
   */
  public static double interpolateTable(double[][] table, double distance, int valueColumn) {
    // Below first row — clamp
    if (distance <= table[0][0]) {
      return table[0][valueColumn];
    }
    // Above last row — clamp
    if (distance >= table[table.length - 1][0]) {
      return table[table.length - 1][valueColumn];
    }
    // Find the bracketing rows and lerp
    for (int i = 0; i < table.length - 1; i++) {
      double d0 = table[i][0];
      double d1 = table[i + 1][0];
      if (distance >= d0 && distance <= d1) {
        double t = (distance - d0) / (d1 - d0);
        return table[i][valueColumn] + t * (table[i + 1][valueColumn] - table[i][valueColumn]);
      }
    }
    // Fallback (should never reach here if table is sorted)
    return table[table.length - 1][valueColumn];
  }

  private static double[][] sortTableByDistance(double[][] table) {
    double[][] sorted = new double[table.length][];
    for (int i = 0; i < table.length; i++) {
      sorted[i] = table[i].clone();
    }
    Arrays.sort(sorted, Comparator.comparingDouble(row -> row[0]));
    return sorted;
  }

  /**
   * Pick the landing zone for pass mode. Always targets the outpost (OUT) zone on the alliance
   * side. The hub/mid landing zone entries remain in {@link FieldConstants.LandingZone} but are not
   * used for pass targeting.
   *
   * @param robotY Robot's current Y coordinate on the field (meters). (currently unused)
   * @param isBlue true if we are the blue alliance.
   * @return Field Translation2d of the outpost landing zone center.
   */
  private static Translation2d pickLandingTarget(double robotY, boolean isBlue) {
    double midY = FieldConstants.kFieldWidth / 2.0;
    FieldConstants.LandingZone zone;
    if (isBlue) {
      zone =
          robotY < midY ? FieldConstants.LandingZone.BLUEOUT : FieldConstants.LandingZone.BLUEDEP;
    } else {
      zone = robotY < midY ? FieldConstants.LandingZone.REDDEP : FieldConstants.LandingZone.REDOUT;
    }
    return new Translation2d(zone.getX(), zone.getY());
  }

  private static double clamp(double value, double min, double max) {
    return Math.max(min, Math.min(max, value));
  }
}
