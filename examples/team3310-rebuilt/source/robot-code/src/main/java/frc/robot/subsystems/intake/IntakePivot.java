package frc.robot.subsystems.intake;

import edu.wpi.first.wpilibj.smartdashboard.SmartDashboard;
import edu.wpi.first.wpilibj2.command.Command;
import frc.lib.subsystems.*;
import frc.robot.Constants;

/**
 * The {@code IntakePivotSubsystem} controls the pivoting mechanism of the robot's intake. It
 * manages the deployment and stowing of the intake using a motor for precise position control and
 * feedback.
 *
 * <p>Units are in degrees (matching Hood pattern). The unitToRotorRatio in config handles the
 * degree-to-rotor-rotation conversion via the gear ratio.
 *
 * <p>Amarillo CAD calibration: CAN 12, gear ratio 20.357142857:1. Motion limits and
 * current limits are configured in Constants; validate the hardware revision before deployment.
 */
public class IntakePivot extends ServoMotorSubsystem<MotorInputsAutoLogged, MotorIO> {
  public MotorIO motorIO;
  private int dashboardCounter = 4; // staggered offset 4

  public IntakePivot(final ServoMotorSubsystemConfig motorConfig, final MotorIO motorIO) {
    super(motorConfig, new MotorInputsAutoLogged(), motorIO);
    this.motorIO = motorIO;

    // Initialize at stow position (0 degrees)
    this.setCurrentPosition(Constants.IntakeConstants.kIntakePivotStowedDegrees);
    this.positionSetpointUnits = 0.0;
    // Deploy commands finish when their goal is reached. Preserve that goal
    // through the real controller instead of returning to the base neutral
    // default and letting the gravity-loaded intake drop during autonomous.
    setTeleopDefaultCommand();
  }

  /** Installs the hold default in autonomous and teleop (legacy method name). */
  public void setTeleopDefaultCommand() {
    this.getDefaultCommand().cancel();
    this.setDefaultCommand(
        motionMagicSetpointCommand(this::getPositionSetpointUnits)
            .withName("Intake Pivot Maintain Setpoint (default)")
            .ignoringDisable(true));
  }

  // -------------------- Torque Current Control Command --------------------

  public Command setTorqueCurrentFOCCommand(double torqueCurrent) {
    return setTorqueCurrentFOC(() -> torqueCurrent); // change to DoubleSupplier
  }

  // -------------------- Position Control Commands --------------------

  /**
   * Command to move pivot to a target position in degrees.
   *
   * <p>Units are degrees — the unitToRotorRatio in config converts degrees to rotor rotations.
   * Design sheet range: 0° (stowed) → 145° (fully deployed).
   *
   * @param degrees target position in degrees
   * @return Command that moves and holds the pivot at the specified angle
   */
  public Command setDegreesCommand(double degrees) {
    return motionMagicSetpointCommand(() -> degrees).withName("Intake Pivot " + degrees + " deg");
  }

  public Command deployCommand() {
    return motionMagicSetpointCommand(() -> Constants.IntakeConstants.kIntakePivotDeployDegrees, 0)
        .withName("Intake Pivot " + Constants.IntakeConstants.kIntakePivotDeployDegrees + " deg");
  }

  public Command retractCommand() {
    return motionMagicSetpointCommand(() -> Constants.IntakeConstants.kIntakePivotStowedDegrees, 1)
        .withName("Intake Pivot " + Constants.IntakeConstants.kIntakePivotStowedDegrees + " deg");
  }

  @Override
  public void periodic() {
    if (++dashboardCounter >= Constants.kLogInterval) {
      dashboardCounter = 0;
      SmartDashboard.putNumber(getName() + "/Position", getCurrentPosition());
    }
    super.periodic();
  }
}
