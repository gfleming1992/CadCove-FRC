package frc.robot.subsystems.scorer.turret;

import org.littletonrobotics.junction.AutoLog;

/**
 * IO interface for turret aim data. The AdvantageKit {@code @AutoLog} annotation will generate
 * {@code TurretAimIOInputsAutoLogged} with full struct-logging support so every field is visible in
 * AdvantageScope.
 */
public interface TurretAimIO {

  @AutoLog
  public static class TurretAimIOInputs {
    // ---- Computed aim angles (degrees) ----
    public double leftTurretAngleDeg = 0.0;

    /** Hood angle in degrees from vertical (10 = 80° elevation, 35 = 55° elevation). */
    public double leftHoodAngleDeg = 10.0;

    /** Left flywheel speed in RPM. */
    public double leftFlywheelRPM = 0.0;

    /** Left vertical feed speed in RPM. */
    public double leftVerticalFeedRPM = 0.0;

    public double rightTurretAngleDeg = 0.0;

    /** Hood angle in degrees from vertical (10 = 80° elevation, 35 = 55° elevation). */
    public double rightHoodAngleDeg = 10.0;

    /** Right flywheel speed in RPM. */
    public double rightFlywheelRPM = 0.0;

    /** Right vertical feed speed in RPM. */
    public double rightVerticalFeedRPM = 0.0;

    // ---- Debug / diagnostics ----
    /** Current zone: "OWN_ALLIANCE", "NEUTRAL", or "OPPONENT". */
    public String zone = "UNKNOWN";

    /** Alliance color being used ('B' or 'R'). */
    public String allianceColor = "B";

    /** Field-space X of the current target (meters). */
    public double targetXMeters = 0.0;

    /** Field-space Y of the current target (meters). */
    public double targetYMeters = 0.0;

    /** Robot X at time of calculation (meters). */
    public double robotXMeters = 0.0;

    /** Robot Y at time of calculation (meters). */
    public double robotYMeters = 0.0;

    /** Robot heading at time of calculation (degrees). */
    public double robotHeadingDeg = 0.0;

    /** Horizontal distance from the left shooter to target (meters). */
    public double leftDistanceToTargetMeters = 0.0;

    /** Horizontal distance from the right shooter to target (meters). */
    public double rightDistanceToTargetMeters = 0.0;
  }

  /** Called once per cycle to update the inputs struct. */
  default void updateInputs(TurretAimIOInputs inputs) {}
}
