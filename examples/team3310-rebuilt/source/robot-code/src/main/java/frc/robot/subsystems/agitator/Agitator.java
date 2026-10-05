package frc.robot.subsystems.agitator;

import edu.wpi.first.wpilibj.smartdashboard.SmartDashboard;
import edu.wpi.first.wpilibj2.command.Command;
import frc.lib.subsystems.MotorIO;
import frc.lib.subsystems.MotorInputsAutoLogged;
import frc.lib.subsystems.ServoMotorSubsystem;
import frc.lib.subsystems.ServoMotorSubsystemConfig;
import frc.robot.Constants;
import java.util.function.DoubleSupplier;
import org.littletonrobotics.junction.Logger;

/**
 * Generic roller subsystem used for floor rollers and vertical feed rollers. Each instance controls
 * a single roller motor using Velocity Voltage Control.
 *
 * <p>Design Sheet Reference (CANivore #2):
 *
 * <ul>
 *   <li>CAN 20: Left Floor Roller - X44, 1.66667:1 (20/12), 75 RPS output, Intake dir, 80A
 *   <li>CAN 21: Left Vertical Feed - X44, 1.5:1 (18/12), 83.33 RPS output, Intake dir, 80A
 *   <li>CAN 25: Right Floor Roller - X44, 1.66667:1 (20/12), 75 RPS output, Outtake dir, 80A
 *   <li>CAN 26: Right Vertical Feed - X44, 1.5:1 (18/12), 83.33 RPS output, Outtake dir, 80A
 * </ul>
 */
public class Agitator extends ServoMotorSubsystem<MotorInputsAutoLogged, MotorIO> {
  public MotorIO motorIO;
  private static final String SNOWBLOW_RPM_KEY = "Agitator/SnowblowRPM";
  private static final String COLLECT_RPM_KEY = "Agitator/CollectRPM";
  private int dashboardCounter;

  public Agitator(
      final ServoMotorSubsystemConfig motorConfig, final MotorIO motorIO, int logOffset) {
    super(motorConfig, new MotorInputsAutoLogged(), motorIO);
    this.motorIO = motorIO;
    this.dashboardCounter = logOffset; // stagger per-instance

    // Initialize SmartDashboard with default RPM values (converting from RPS)
    SmartDashboard.putNumber(
        SNOWBLOW_RPM_KEY, rpsToRpm(Constants.AgitatorConstants.kFloorRollerSnowblowRPS));
    SmartDashboard.putNumber(
        COLLECT_RPM_KEY, rpsToRpm(Constants.AgitatorConstants.kFloorRollerCollectRPS));

    // Log configuration to AdvantageKit (persists in logs, doesn't get overwritten)
    Logger.recordOutput(getName() + "/Config/Name", motorConfig.name);
    Logger.recordOutput(getName() + "/Config/CANID", motorConfig.talonCANID.getDeviceNumber());
    Logger.recordOutput(getName() + "/Config/CANBus", motorConfig.talonCANID.getBus());
    Logger.recordOutput(getName() + "/Config/GearRatio", motorConfig.unitToRotorRatio);
    Logger.recordOutput(
        getName() + "/Config/TargetIntakeRPS", Constants.AgitatorConstants.kFloorRollerSnowblowRPS);
    Logger.recordOutput(
        getName() + "/Config/TargetIntakeRPM",
        rpsToRpm(Constants.AgitatorConstants.kFloorRollerSnowblowRPS));
    Logger.recordOutput(getName() + "/Config/PID/kP", motorConfig.fxConfig.Slot0.kP);
    Logger.recordOutput(getName() + "/Config/PID/kI", motorConfig.fxConfig.Slot0.kI);
    Logger.recordOutput(getName() + "/Config/PID/kD", motorConfig.fxConfig.Slot0.kD);
    Logger.recordOutput(getName() + "/Config/PID/kS", motorConfig.fxConfig.Slot0.kS);
    Logger.recordOutput(getName() + "/Config/PID/kV", motorConfig.fxConfig.Slot0.kV);
    Logger.recordOutput(getName() + "/Config/PID/kA", motorConfig.fxConfig.Slot0.kA);

    // Also log to console for immediate visibility
    System.out.println("==================================================");
    System.out.println("AGITATOR INIT: " + motorConfig.name);
    System.out.println(
        "  CAN: "
            + motorConfig.talonCANID.getDeviceNumber()
            + " on "
            + motorConfig.talonCANID.getBus());
    System.out.println(
        "  Target: "
            + Constants.AgitatorConstants.kFloorRollerSnowblowRPS
            + " RPS ("
            + rpsToRpm(Constants.AgitatorConstants.kFloorRollerSnowblowRPS)
            + " RPM)");
    System.out.println(
        "  PID: kP="
            + motorConfig.fxConfig.Slot0.kP
            + " kV="
            + motorConfig.fxConfig.Slot0.kV
            + " kS="
            + motorConfig.fxConfig.Slot0.kS);
    System.out.println("==================================================");
  }

  public double getPositionRotations() {
    return inputs.unitPosition;
  }

  @Override
  public void periodic() {
    super.periodic();

    if (++dashboardCounter < Constants.kLogInterval) {
      return;
    }
    dashboardCounter = 0;

    String dashboardPrefix = getName() + "/";

    // Log current velocity in RPM to SmartDashboard
    SmartDashboard.putNumber(
        dashboardPrefix + "CurrentRPM", rpsToRpm(inputs.velocityUnitsPerSecond));
    SmartDashboard.putNumber(dashboardPrefix + "CurrentRPS", inputs.velocityUnitsPerSecond);
    SmartDashboard.putNumber(dashboardPrefix + "AppliedVolts", inputs.appliedVolts);
    SmartDashboard.putNumber(dashboardPrefix + "StatorCurrent", inputs.currentStatorAmps);
    SmartDashboard.putNumber(dashboardPrefix + "SupplyCurrent", inputs.currentSupplyAmps);
    SmartDashboard.putBoolean(dashboardPrefix + "SubsystemActive", true);

    // Debug: Log if motor is being driven
    if (Math.abs(inputs.appliedVolts) > 0.1) {
      SmartDashboard.putString(dashboardPrefix + "Status", "MOTOR ACTIVE");
    } else {
      SmartDashboard.putString(dashboardPrefix + "Status", "IDLE");
    }
  }

  // -------------------- Unit Conversion Helpers --------------------

  /**
   * Convert rotations per second to rotations per minute.
   *
   * @param rps rotations per second
   * @return rotations per minute
   */
  private double rpsToRpm(double rps) {
    return rps * 60.0;
  }

  // -------------------- Velocity Control Commands --------------------

  /**
   * Command to run roller at the floor roller intake speed from SmartDashboard.
   *
   * @return Command that runs roller in intake direction
   */
  public Command snowblowCommand() {
    return velocityTorqueCurrentFOCSetpointCommand(
            () -> Constants.AgitatorConstants.kFloorRollerSnowblowRPM)
        .withName(getName() + " Snowblow");
  }

  /**
   * Command to run roller at the floor roller outtake speed from SmartDashboard.
   *
   * @return Command that runs roller in outtake direction
   */
  public Command collectCommand() {
    return velocityTorqueCurrentFOCSetpointCommand(
            () -> Constants.AgitatorConstants.kFloorRollerCollectRPM)
        .withName(getName() + " Collect");
  }

  /**
   * Command to run floor roller in reverse direction (negative RPM).
   *
   * @return Command that runs floor roller in reverse
   */
  public Command reverseCommand() {
    return velocityTorqueCurrentFOCSetpointCommand(
            () -> Constants.AgitatorConstants.kFloorRollerReverseRPM)
        .withName(getName() + " Reverse");
  }

  /**
   * Command to run roller at the vertical feed intake speed.
   *
   * @return Command that runs vertical feed in intake direction
   */
  public Command verticalFeedIntakeCommand() {
    return velocityTorqueCurrentFOCSetpointCommand(
            () -> Constants.AgitatorConstants.kVerticalFeedIntakeRPM)
        .withName(getName() + " VertFeed Intake");
  }

  /**
   * Command to run roller at the vertical feed outtake speed.
   *
   * @return Command that runs vertical feed in outtake direction
   */
  public Command verticalFeedOuttakeCommand() {
    return velocityTorqueCurrentFOCSetpointCommand(
            () -> Constants.AgitatorConstants.kVerticalFeedOuttakeRPM)
        .withName(getName() + " VertFeed Outtake");
  }

  public Command verticalFeedCollectCommand() {
    return velocityTorqueCurrentFOCSetpointCommand(
            () -> Constants.AgitatorConstants.kVerticalFeedCollectRPM)
        .withName(getName() + " VertFeed Collect");
  }

  public Command offCommand() {
    return neutralCommand();
  }

  /**
   * Command to run roller at a custom velocity setpoint in RPS.
   *
   * @param velocityRPS velocity in rotations per second at the output
   * @return Command that runs roller at the specified velocity
   */
  public Command setRPMCommand(double velocityRPM) {
    return velocityTorqueCurrentFOCSetpointCommand(() -> velocityRPM)
        .withName(getName() + " Custom Velocity");
  }

  public Command setRPMCommand(DoubleSupplier velocitySupplierRPM) {
    return velocityTorqueCurrentFOCSetpointCommand(velocitySupplierRPM)
        .withName(getName() + " Custom Velocity");
  }
}
