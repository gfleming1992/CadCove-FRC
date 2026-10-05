package frc.lib.subsystems;

import com.ctre.phoenix6.configs.MotionMagicConfigs;
import com.ctre.phoenix6.signals.NeutralModeValue;
import edu.wpi.first.wpilibj2.command.*;
import frc.lib.time.RobotTime;
import frc.lib.util.Util;
import frc.robot.Constants;
import java.util.function.DoubleSupplier;
import java.util.function.Supplier;
import org.littletonrobotics.junction.Logger;

/**
 * RollerMotorSubsystem
 *
 * @param <T>
 */
public class ServoMotorSubsystem<T extends MotorInputsAutoLogged, U extends MotorIO>
    extends SubsystemBase {
  private static final int LATENCY_LOG_INTERVAL = 25; // ~2 Hz at a 20 ms main loop

  protected U io;
  protected T inputs;
  protected double positionSetpointUnits = 0.0;

  protected ServoMotorSubsystemConfig conf;
  private int latencyLogCounter = 0;
  private String lastLoggedCommandName = "";

  /** True on the one cycle per kLogInterval where API-level Logger calls fire. */
  private boolean shouldLogAPI = false;

  private int apiLogCounter = 0;

  public ServoMotorSubsystem(ServoMotorSubsystemConfig config, T inputs, U io) {
    super(config.name);
    this.conf = config;
    this.io = io;
    this.inputs = inputs;

    setDefaultCommand(
        neutralCommand().withName(getName() + " Default Command Neutral").ignoringDisable(true));
  }

  @Override
  public void periodic() {
    double timestamp = RobotTime.getTimestampSeconds();
    io.readInputs(inputs);
    Logger.processInputs(getName(), inputs);

    // Rate-limit API-level Logger.recordOutput calls to ~5 Hz.
    apiLogCounter++;
    shouldLogAPI = apiLogCounter >= Constants.kLogInterval;
    if (shouldLogAPI) apiLogCounter = 0;

    if (++latencyLogCounter >= LATENCY_LOG_INTERVAL) {
      latencyLogCounter = 0;
      Logger.recordOutput(
          getName() + "/latencyPeriodicSec", RobotTime.getTimestampSeconds() - timestamp);
    }

    String currentCommandName =
        (getCurrentCommand() == null) ? "Default" : getCurrentCommand().getName();
    if (!currentCommandName.equals(lastLoggedCommandName)) {
      Logger.recordOutput(getName() + "/currentCommand", currentCommandName);
      lastLoggedCommandName = currentCommandName;
    }
  }

  protected void setMotionMagicConfig(MotionMagicConfigs config) {
    io.setMotionMagicConfig(config);
  }

  protected void setOpenLoopDutyCycleImpl(double dutyCycle) {
    if (shouldLogAPI)
      Logger.recordOutput(getName() + "/API/setOpenLoopDutyCycle/dutyCycle", dutyCycle);
    io.setOpenLoopDutyCycle(dutyCycle);
  }

  protected void setVoltageImpl(double voltage) {
    if (shouldLogAPI) Logger.recordOutput(getName() + "/API/setVoltageImpl/voltage", voltage);
    io.setVoltageOutput(voltage);
  }

  protected void setPositionSetpointImpl(double units) {
    positionSetpointUnits = units;
    if (shouldLogAPI) Logger.recordOutput(getName() + "/API/setPositionSetpointImp/Units", units);
    io.setPositionSetpoint(units);
  }

  protected void setNeutralModeImpl(NeutralModeValue mode) {
    if (shouldLogAPI) Logger.recordOutput(getName() + "/API/setNeutralModeImpl/Mode", mode);
    io.setNeutralMode(mode);
  }

  protected void setMotionMagicSetpointImpl(double units, int slot) {
    positionSetpointUnits = units;
    if (shouldLogAPI) {
      Logger.recordOutput(getName() + "/API/setMotionMagicSetpointImp/Units", units);
      Logger.recordOutput(getName() + "/API/setMotionMagicSetpointImp/Slot", slot);
    }
    io.setMotionMagicSetpoint(units, slot);
  }

  protected void setMotionMagicSetpointImpl(double units, MotionMagicConfigs config, int slot) {
    positionSetpointUnits = units;
    double velocity = config.MotionMagicCruiseVelocity;
    double acceleration = config.MotionMagicAcceleration;
    double jerk = config.MotionMagicJerk;

    if (shouldLogAPI) {
      Logger.recordOutput(getName() + "/API/setMotionMagicSetpointImpDynamic/Units", units);
      Logger.recordOutput(getName() + "/API/setMotionMagicSetpointImpDynamic/Velocity", velocity);
      Logger.recordOutput(getName() + "/API/setMotionMagicSetpointImpDynamic/Accel", acceleration);
      Logger.recordOutput(getName() + "/API/setMotionMagicSetpointImpDynamic/Jerk", jerk);
      Logger.recordOutput(getName() + "/API/setMotionMagicSetpointImpDynamic/Slot", slot);
    }
    io.setMotionMagicSetpoint(units, velocity, acceleration, jerk, slot);
  }

  protected void setMotionMagicSetpointImpl(
      double units, MotionMagicConfigs config, double feedfowards, int slot) {
    positionSetpointUnits = units;
    double velocity = config.MotionMagicCruiseVelocity;
    double acceleration = config.MotionMagicAcceleration;
    double jerk = config.MotionMagicJerk;

    if (shouldLogAPI) {
      Logger.recordOutput(getName() + "/API/setMotionMagicSetpointImpDynamic/Units", units);
      Logger.recordOutput(getName() + "/API/setMotionMagicSetpointImpDynamic/Velocity", velocity);
      Logger.recordOutput(getName() + "/API/setMotionMagicSetpointImpDynamic/Accel", acceleration);
      Logger.recordOutput(getName() + "/API/setMotionMagicSetpointImpDynamic/Jerk", jerk);
      Logger.recordOutput(getName() + "/API/setMotionMagicSetpointImpDynamic/Slot", slot);
      Logger.recordOutput(
          getName() + "/API/setMotionMagicSetpointImpDynamic/Feedforwards", feedfowards);
    }
    io.setMotionMagicSetpoint(units, velocity, acceleration, jerk, slot, feedfowards);
  }

  protected void setVelocitySetpointImpl(double unitsPerSecond, int slot) {
    if (shouldLogAPI)
      Logger.recordOutput(getName() + "/API/setVelocitySetpointImpl/UnitsPerS", unitsPerSecond);
    io.setVelocitySetpoint(unitsPerSecond, slot);
  }

  protected void setVelocityTorqueCurrentFOCSetpointImpl(double unitsPerSecond, int slot) {
    if (shouldLogAPI)
      Logger.recordOutput(
          getName() + "/API/setVelocityTorqueCurrentFOCSetpointImpl/UnitsPerS", unitsPerSecond);
    io.setVelocityTorqueCurrentFOCSetpoint(unitsPerSecond, slot);
  }

  public double getCurrentPosition() {
    return inputs.unitPosition;
  }

  public double getCurrentVelocity() {
    return inputs.velocityUnitsPerSecond;
  }

  public double getSupplyCurrentAmps() {
    return inputs.currentSupplyAmps;
  }

  public double getStatorCurrentAmps() {
    return inputs.currentStatorAmps;
  }

  public double getPositionSetpointUnits() {
    return positionSetpointUnits;
  }

  public Command setMotionMagicConfigCommand(MotionMagicConfigs configs) {
    // Not taking requirements is intentional here.
    return new InstantCommand(() -> setMotionMagicConfig(configs));
  }

  public Command dutyCycleCommand(DoubleSupplier dutyCycle) {
    return runEnd(
            () -> {
              setOpenLoopDutyCycleImpl(dutyCycle.getAsDouble());
            },
            () -> {
              setOpenLoopDutyCycleImpl(0.0);
            })
        .withName(getName() + " DutyCycleControl");
  }

  public Command neutralCommand() {
    return run(() -> io.setNeutralOutput()).withName(getName() + " Neutral");
  }

  public Command dutyCycleCommandNoEnd(DoubleSupplier dutyCycle) {
    return runEnd(
            () -> {
              setOpenLoopDutyCycleImpl(dutyCycle.getAsDouble());
            },
            () -> {})
        .withName(getName() + " DutyCycleControl");
  }

  public Command voltageCommand(DoubleSupplier voltage) {
    return runEnd(
            () -> {
              setVoltageImpl(voltage.getAsDouble());
            },
            () -> {
              setVoltageImpl(0.0);
            })
        .withName(getName() + " VoltageControl");
  }

  public Command velocitySetpointCommand(DoubleSupplier velocitySupplier) {
    return velocitySetpointCommand(velocitySupplier, 0);
  }

  public Command velocitySetpointCommand(DoubleSupplier velocitySupplier, int slot) {
    return runEnd(
            () -> {
              setVelocitySetpointImpl(velocitySupplier.getAsDouble(), slot);
            },
            () -> {})
        .withName(getName() + " VelocityControl");
  }

  public Command velocityTorqueCurrentFOCSetpointCommand(DoubleSupplier velocitySupplier) {
    return velocityTorqueCurrentFOCSetpointCommand(velocitySupplier, 0);
  }

  public Command velocityTorqueCurrentFOCSetpointCommand(
      DoubleSupplier velocitySupplier, int slot) {
    return runEnd(
            () -> {
              setVelocityTorqueCurrentFOCSetpointImpl(velocitySupplier.getAsDouble(), slot);
            },
            () -> {})
        .withName(getName() + " VelocityTorqueCurrentFOCControl");
  }

  public Command setCoast() {
    return startEnd(
            () -> setNeutralModeImpl(NeutralModeValue.Coast),
            () -> setNeutralModeImpl(NeutralModeValue.Brake))
        .withName(getName() + "CoastMode")
        .ignoringDisable(true);
  }

  public Command positionSetpointCommand(DoubleSupplier unitSupplier) {
    return runEnd(
            () -> {
              setPositionSetpointImpl(unitSupplier.getAsDouble());
            },
            () -> {})
        .withName(getName() + " positionSetpointCommand");
  }

  public Command positionSetpointUntilOnTargetCommand(
      DoubleSupplier unitSupplier, DoubleSupplier epsilon) {
    return new ParallelDeadlineGroup(
        new WaitUntilCommand(
            () ->
                Util.epsilonEquals(
                    unitSupplier.getAsDouble(), inputs.unitPosition, epsilon.getAsDouble())),
        positionSetpointCommand(unitSupplier));
  }

  public Command motionMagicSetpointCommand(DoubleSupplier unitSupplier, int slot) {
    return runEnd(
            () -> {
              setMotionMagicSetpointImpl(unitSupplier.getAsDouble(), slot);
            },
            () -> {})
        .withName(getName() + " motionMagicSetpointCommand");
  }

  public Command motionMagicSetpointCommand(
      DoubleSupplier unitSupplier, Supplier<MotionMagicConfigs> configSupplier, int slot) {
    return runEnd(
            () -> {
              setMotionMagicSetpointImpl(unitSupplier.getAsDouble(), configSupplier.get(), slot);
            },
            () -> {})
        .withName(getName() + " dynamicMotionMagicSetpointCommand");
  }

  public Command motionMagicSetpointCommand(
      DoubleSupplier unitSupplier,
      Supplier<MotionMagicConfigs> configSupplier,
      Supplier<Double> feedforwards,
      int slot) {
    return runEnd(
            () -> {
              setMotionMagicSetpointImpl(
                  unitSupplier.getAsDouble(), configSupplier.get(), feedforwards.get(), slot);
            },
            () -> {})
        .withName(getName() + " dynamicMotionMagicSetpointCommand");
  }

  public Command motionMagicSetpointCommandBlocking(
      DoubleSupplier setpoint, double tolerance, int slot) {
    return motionMagicSetpointCommand(() -> setpoint.getAsDouble(), slot)
        .until(() -> Util.epsilonEquals(getCurrentPosition(), setpoint.getAsDouble(), tolerance));
  }

  public Command motionMagicSetpointCommandBlocking(
      DoubleSupplier setpoint,
      Supplier<MotionMagicConfigs> configSupplier,
      double tolerance,
      int slot) {
    return motionMagicSetpointCommand(setpoint, configSupplier, slot)
        .until(() -> Util.epsilonEquals(getCurrentPosition(), setpoint.getAsDouble(), tolerance));
  }

  public Command motionMagicSetpointCommandBlocking(
      DoubleSupplier setpoint,
      Supplier<MotionMagicConfigs> configSupplier,
      Supplier<Double> feedforwards,
      double tolerance,
      int slot) {
    return motionMagicSetpointCommand(setpoint, configSupplier, feedforwards, slot)
        .until(() -> Util.epsilonEquals(getCurrentPosition(), setpoint.getAsDouble(), tolerance));
  }

  public Command motionMagicSetpointCommand(DoubleSupplier unitSupplier) {
    return motionMagicSetpointCommand(unitSupplier, 0);
  }

  public Command motionMagicSetpointCommand(
      DoubleSupplier unitSupplier, Supplier<MotionMagicConfigs> configSupplier) {
    return motionMagicSetpointCommand(unitSupplier, configSupplier, 0);
  }

  public Command motionMagicSetpointCommandBlocking(DoubleSupplier setpoint, double tolerance) {
    return motionMagicSetpointCommandBlocking(setpoint, tolerance, 0);
  }

  public Command motionMagicSetpointCommandBlocking(
      DoubleSupplier setpoint, Supplier<MotionMagicConfigs> configSupplier, double tolerance) {
    return motionMagicSetpointCommandBlocking(setpoint, configSupplier, tolerance, 0);
  }

  public void setTorqueCurrentFOCImpl(double current) {
    if (shouldLogAPI) Logger.recordOutput(getName() + "/API/setTorqueCurrentFoC/Current", current);
    io.setTorqueCurrentFOC(current);
  }

  public Command setTorqueCurrentFOC(DoubleSupplier current) {
    return runEnd(
            () -> {
              setTorqueCurrentFOCImpl(current.getAsDouble());
            },
            () -> {})
        .withName(getName() + " torqueCurrentFOCCommand");
  }

  protected void setCurrentPositionAsZero() {
    io.setCurrentPositionAsZero();
  }

  public void setCurrentPosition(double positionUnits) {
    io.setCurrentPosition(positionUnits);
  }

  public void setVelocitySetpoint(double unitsPerSecond) {
    io.setVelocitySetpoint(unitsPerSecond);
  }

  protected Command withoutLimitsTemporarily() {
    var prev =
        new Object() {
          boolean fwd = false;
          boolean rev = false;
        };
    return Commands.startEnd(
        () -> {
          prev.fwd = conf.fxConfig.SoftwareLimitSwitch.ForwardSoftLimitEnable;
          prev.rev = conf.fxConfig.SoftwareLimitSwitch.ReverseSoftLimitEnable;
          io.setEnableSoftLimits(false, false);
        },
        () -> {
          io.setEnableSoftLimits(prev.fwd, prev.rev);
        });
  }
}
