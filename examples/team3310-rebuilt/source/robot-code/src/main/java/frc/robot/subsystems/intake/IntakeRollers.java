package frc.robot.subsystems.intake;

import edu.wpi.first.wpilibj2.command.Command;
import frc.lib.subsystems.MotorIO;
import frc.lib.subsystems.MotorInputsAutoLogged;
import frc.lib.subsystems.ServoMotorSubsystem;
import frc.lib.subsystems.ServoMotorSubsystemConfig;
import frc.robot.Constants;

/**
 * The {@code IntakeRollerSubsystem} controls the roller mechanism of the robot's intake. It manages
 * the speed and direction of the intake rollers to collect and feed game pieces.
 */
public class IntakeRollers extends ServoMotorSubsystem<MotorInputsAutoLogged, MotorIO> {
  public MotorIO motorIO;

  // Default velocity setpoints (units per second - tune these values)

  public IntakeRollers(final ServoMotorSubsystemConfig motorConfig, final MotorIO motorIO) {

    super(motorConfig, new MotorInputsAutoLogged(), motorIO);
    this.motorIO = motorIO;
  }

  @Override
  public void periodic() {
    super.periodic();
  }

  // -------------------- Torque Current Control Command --------------------

  public Command setTorqueCurrentFOCCommand(double torqueCurrent) {
    return setTorqueCurrentFOC(() -> torqueCurrent); // change to DoubleSupplier
  }

  // -------------------- Velocity Control Commands --------------------

  /**
   * Command to run intake at target velocity for collecting game pieces.
   *
   * @return Command that runs intake forward
   */
  public Command intakeCommand() {
    return velocityTorqueCurrentFOCSetpointCommand(
            () -> Constants.IntakeConstants.kIntakeVelocityRPM)
        .withName("Intake Forward");
  }

  public Command outtakeCommand() {
    return velocityTorqueCurrentFOCSetpointCommand(
            () -> Constants.IntakeConstants.kOuttakeVelocityRPM)
        .withName("Intake Outtake");
  }

  public Command deployCommand() {
    return velocityTorqueCurrentFOCSetpointCommand(
            () -> Constants.IntakeConstants.kDeployVelocityRPM)
        .withName("Intake Deploy");
  }

  public Command retractCommand() {
    return velocityTorqueCurrentFOCSetpointCommand(
            () -> Constants.IntakeConstants.kRetractVelocityRPM)
        .withName("Intake Retract");
  }

  public Command offCommand() {
    return neutralCommand();
  }

  public Command customVelocityCommand(double velocityRPM) {
    return velocityTorqueCurrentFOCSetpointCommand(() -> velocityRPM)
        .withName(getName() + " Custom Velocity");
  }
}
