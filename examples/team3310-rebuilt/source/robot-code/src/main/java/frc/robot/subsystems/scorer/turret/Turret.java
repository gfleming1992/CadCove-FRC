package frc.robot.subsystems.scorer.turret;

import edu.wpi.first.wpilibj.smartdashboard.SmartDashboard;
import edu.wpi.first.wpilibj2.command.Command;
import frc.lib.subsystems.*;
import frc.robot.Constants;
import java.util.function.DoubleSupplier;

/** The {@code Turret} controls the pivoting mechanism of the robot's launcher turret. */
public class Turret extends ServoMotorSubsystem<MotorInputsAutoLogged, MotorIO> {
  public MotorIO motorIO;
  private int dashboardCounter = 2; // staggered offset 2

  public Turret(final ServoMotorSubsystemConfig motorConfig, final MotorIO motorIO) {
    super(motorConfig, new MotorInputsAutoLogged(), motorIO);
    this.motorIO = motorIO;
    this.setCurrentPosition(Constants.ScorerConstants.kTurretStowedPosition);
    this.positionSetpointUnits = Constants.ScorerConstants.kTurretStowedPosition;
  }

  public void setTeleopDefaultCommand() {
    this.getDefaultCommand().cancel();
    this.setDefaultCommand(
        motionMagicSetpointCommand(this::getPositionSetpointUnits)
            .withName("Turret Maintain Setpoint (default)")
            .ignoringDisable(true));
  }

  // -------------------- Torque Current Control Command --------------------

  public Command setTorqueCurrentFOCCommand(double torqueCurrent) {
    return setTorqueCurrentFOC(() -> torqueCurrent); // change to DoubleSupplier
  }

  // -------------------- Position Control Commands --------------------

  /**
   * Command to run turret at target position.
   *
   * @return Command that sets position as angle
   */
  public Command setDegreesCommand(double position) {
    return motionMagicSetpointCommand(() -> (position)).withName("Turret Maintain Setpoint");
  }

  public Command setDegreesCommand(DoubleSupplier position) {
    return motionMagicSetpointCommand(position).withName("Turret Aim Tracking");
  }

  public Command maxCommand() {
    return motionMagicSetpointCommand(() -> Constants.ScorerConstants.kTurretMaxPositionUnits);
  }

  @Override
  public void periodic() {
    if (++dashboardCounter >= Constants.kLogInterval) {
      dashboardCounter = 0;
      SmartDashboard.putNumber(getName() + "/Position", getCurrentPosition());
      SmartDashboard.putBoolean(getName() + "/Running", Math.abs(inputs.appliedVolts) > 0.1);
      String cmd = getCurrentCommand() == null ? "None" : getCurrentCommand().getName();
      SmartDashboard.putString(getName() + "/CurrentCommand", cmd);
    }
    super.periodic();
  }
}
