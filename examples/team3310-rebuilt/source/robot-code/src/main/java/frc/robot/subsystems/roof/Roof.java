package frc.robot.subsystems.roof;

import edu.wpi.first.wpilibj.smartdashboard.SmartDashboard;
import edu.wpi.first.wpilibj2.command.Command;
import frc.lib.subsystems.*;
import frc.robot.Constants;
import java.util.function.DoubleSupplier;

/**
 * The {@code Roof} subsystem controls the linear roof mechanism in inches of travel. It uses Motion
 * Magic position control via the shared {@link ServoMotorSubsystem} base class.
 *
 * <p>The motor is connected directly to the roboRIO CAN bus (not the CANivore).
 */
public class Roof extends ServoMotorSubsystem<MotorInputsAutoLogged, MotorIO> {
  public MotorIO motorIO;
  private int dashboardCounter = 9; // staggered offset 9

  public Roof(final ServoMotorSubsystemConfig motorConfig, final MotorIO motorIO) {
    super(motorConfig, new MotorInputsAutoLogged(), motorIO);
    this.motorIO = motorIO;
    this.setCurrentPosition(Constants.RoofConstants.kRoofStartupHeightInches);
    this.positionSetpointUnits = Constants.RoofConstants.kRoofStartupHeightInches;
  }

  /**
   * Sets the default command to continuously hold the last-commanded position via Motion Magic.
   * Call this in teleop init so the roof doesn't go limp when a position command finishes.
   */
  public void setTeleopDefaultCommand() {
    this.getDefaultCommand().cancel();
    this.setDefaultCommand(
        motionMagicSetpointCommand(this::getPositionSetpointUnits)
            .withName("Roof Maintain Setpoint (default)")
            .ignoringDisable(true));
  }

  // -------------------- Height Control Commands --------------------

  /**
   * Command to move the roof to a fixed linear height in inches.
   *
   * @param heightInches target roof height in inches
   * @return Motion Magic position command
   */
  public Command setHeightInchesCommand(double heightInches) {
    return motionMagicSetpointCommand(() -> heightInches).withName("Roof Set Height Inches");
  }

  /**
   * Command to continuously track a supplied linear height in inches.
   *
   * @param heightInches supplier providing the target roof height in inches
   * @return Motion Magic position command
   */
  public Command setHeightInchesCommand(DoubleSupplier heightInches) {
    return motionMagicSetpointCommand(heightInches).withName("Roof Track Height Inches");
  }

  /** Command to move the roof to its maximum height. */
  public Command setMaxHeightCommand() {
    return motionMagicSetpointCommand(() -> Constants.RoofConstants.kRoofMaxHeightInches);
  }

  /** Command to move the roof to its minimum height. */
  public Command setMinHeightCommand() {
    return motionMagicSetpointCommand(() -> Constants.RoofConstants.kRoofMinHeightInches);
  }

  @Override
  public void periodic() {
    if (++dashboardCounter >= Constants.kLogInterval) {
      dashboardCounter = 0;
      SmartDashboard.putNumber(getName() + "/HeightInches", getCurrentPosition());
    }
    super.periodic();
  }
}
