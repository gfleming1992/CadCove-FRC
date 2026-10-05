package frc.robot.generated;

import com.ctre.phoenix6.CANBus;
import com.ctre.phoenix6.configs.*;
import com.ctre.phoenix6.swerve.*;
import edu.wpi.first.units.measure.*;
import frc.robot.Constants;

/**
 * Facade that delegates to the appropriate bot-specific TunerConstants based on
 * Constants.currentBot. This allows you to switch between different robot configurations by
 * changing one variable.
 */
public class TunerConstants {
  // Delegated constants - these forward to the selected variant based on Constants.currentBot
  public static final CANBus kCANBus1;
  public static final CANBus kCANBus2;
  public static final CANBus kCANBusRio;
  public static final LinearVelocity kSpeedAt12Volts;
  public static final SwerveDrivetrainConstants DrivetrainConstants;
  public static final SwerveModuleConstants<
          TalonFXConfiguration, TalonFXConfiguration, CANcoderConfiguration>
      FrontLeft;
  public static final SwerveModuleConstants<
          TalonFXConfiguration, TalonFXConfiguration, CANcoderConfiguration>
      FrontRight;
  public static final SwerveModuleConstants<
          TalonFXConfiguration, TalonFXConfiguration, CANcoderConfiguration>
      BackLeft;
  public static final SwerveModuleConstants<
          TalonFXConfiguration, TalonFXConfiguration, CANcoderConfiguration>
      BackRight;

  // Static initializer block - runs once when class is loaded, switches based on currentBot
  static {
    switch (Constants.currentBot) {
      case SOFTWARE:
        kCANBus1 = TunerConstantsSoftware.kCANBus1;
        kCANBus2 = TunerConstantsSoftware.kCANBus2;
        kCANBusRio = TunerConstantsSoftware.kCANBusRio;
        kSpeedAt12Volts = TunerConstantsSoftware.kSpeedAt12Volts;
        DrivetrainConstants = TunerConstantsSoftware.DrivetrainConstants;
        FrontLeft = TunerConstantsSoftware.FrontLeft;
        FrontRight = TunerConstantsSoftware.FrontRight;
        BackLeft = TunerConstantsSoftware.BackLeft;
        BackRight = TunerConstantsSoftware.BackRight;
        break;
      case BRAVO:
        kCANBus1 = TunerConstantsBravo.kCANBus1;
        kCANBus2 = TunerConstantsBravo.kCANBus1;
        kCANBusRio = TunerConstantsBravo.kCANBusRio;
        kSpeedAt12Volts = TunerConstantsBravo.kSpeedAt12Volts;
        DrivetrainConstants = TunerConstantsBravo.DrivetrainConstants;
        FrontLeft = TunerConstantsBravo.FrontLeft;
        FrontRight = TunerConstantsBravo.FrontRight;
        BackLeft = TunerConstantsBravo.BackLeft;
        BackRight = TunerConstantsBravo.BackRight;
        break;
      case COMP:
        // Competition bot — 2 CANivores + RIO bus, each with a unique name.
        kCANBus1 = TunerConstantsComp.kCANBus1;
        kCANBus2 = TunerConstantsComp.kCANBus2;
        kCANBusRio = TunerConstantsComp.kCANBusRio;
        kSpeedAt12Volts = TunerConstantsComp.kSpeedAt12Volts;
        DrivetrainConstants = TunerConstantsComp.DrivetrainConstants;
        FrontLeft = TunerConstantsComp.FrontLeft;
        FrontRight = TunerConstantsComp.FrontRight;
        BackLeft = TunerConstantsComp.BackLeft;
        BackRight = TunerConstantsComp.BackRight;
        break;
      case PRACTICE:
        // Practice bot — single CANivore. All 3 facade fields point to the
        // same kCANBus1 object so only one CANBus instance exists.
        // Routing in CanBusNames.superstructureFor() also returns kCANBus1
        // for all devices on non-COMP bots.
        kCANBus1 = TunerConstantsPractice.kCANBus1;
        kCANBus2 = TunerConstantsPractice.kCANBus1; // same object — no second bus
        kCANBusRio = TunerConstantsPractice.kCANBus1; // same object — no RIO bus
        kSpeedAt12Volts = TunerConstantsPractice.kSpeedAt12Volts;
        DrivetrainConstants = TunerConstantsPractice.DrivetrainConstants;
        FrontLeft = TunerConstantsPractice.FrontLeft;
        FrontRight = TunerConstantsPractice.FrontRight;
        BackLeft = TunerConstantsPractice.BackLeft;
        BackRight = TunerConstantsPractice.BackRight;
        break;
      default:
        throw new IllegalStateException("Unknown bot: " + Constants.currentBot);
    }
  }

  /** Swerve Drive class utilizing CTR Electronics' Phoenix 6 API with the selected device types. */
  public static class TunerSwerveDrivetrain extends TunerConstantsSoftware.TunerSwerveDrivetrain {
    public TunerSwerveDrivetrain(
        SwerveDrivetrainConstants drivetrainConstants, SwerveModuleConstants<?, ?, ?>... modules) {
      super(drivetrainConstants, modules);
    }

    public TunerSwerveDrivetrain(
        SwerveDrivetrainConstants drivetrainConstants,
        double odometryUpdateFrequency,
        SwerveModuleConstants<?, ?, ?>... modules) {
      super(drivetrainConstants, odometryUpdateFrequency, modules);
    }

    public TunerSwerveDrivetrain(
        SwerveDrivetrainConstants drivetrainConstants,
        double odometryUpdateFrequency,
        edu.wpi.first.math.Matrix<edu.wpi.first.math.numbers.N3, edu.wpi.first.math.numbers.N1>
            odometryStandardDeviation,
        edu.wpi.first.math.Matrix<edu.wpi.first.math.numbers.N3, edu.wpi.first.math.numbers.N1>
            visionStandardDeviation,
        SwerveModuleConstants<?, ?, ?>... modules) {
      super(
          drivetrainConstants,
          odometryUpdateFrequency,
          odometryStandardDeviation,
          visionStandardDeviation,
          modules);
    }
  }
}
