package frc.robot.subsystems;

import static edu.wpi.first.units.Units.Percent;

import edu.wpi.first.wpilibj.AddressableLED;
import edu.wpi.first.wpilibj.AddressableLEDBuffer;
import edu.wpi.first.wpilibj.LEDPattern;
import edu.wpi.first.wpilibj.Timer;
import edu.wpi.first.wpilibj.smartdashboard.SendableChooser;
import edu.wpi.first.wpilibj.smartdashboard.SmartDashboard;
import edu.wpi.first.wpilibj.util.Color;
import edu.wpi.first.wpilibj2.command.SubsystemBase;
import frc.robot.Constants;
import frc.robot.Robot;
import org.littletonrobotics.junction.Logger;

public class Lights extends SubsystemBase {
  private static Lights instance;
  private LightMode mode = LightMode.BOT_STATE; // Default mode
  private AddressableLED ledStrip;
  private AddressableLEDBuffer ledBuffer;
  private final SendableChooser<Robot.BotState> lightModeChooser = new SendableChooser<>();

  // Log rate-limiting — staggered offset 8.
  private int logCounter = 8;

  public static Lights getInstance() {
    if (instance == null) {
      instance = new Lights();
    }
    return instance;
  }

  private Lights() {

    ledStrip = new AddressableLED(2);
    ledBuffer = new AddressableLEDBuffer(41); // Number of LEDs in the strip

    ledStrip.setLength(ledBuffer.getLength());
    LEDPattern.solid(Color.kRed).applyTo(ledBuffer);
    ledStrip.setColorOrder(AddressableLED.ColorOrder.kGRB);
    ledStrip.setData(ledBuffer);
    ledStrip.start();

    // Build the color-preview dropdown for Elastic/SmartDashboard
    lightModeChooser.setDefaultOption("SNOWBLOW (White)", Robot.BotState.SNOWBLOW);
    lightModeChooser.addOption("COLLECT (Green)", Robot.BotState.COLLECT);
    lightModeChooser.addOption("DEFENCEIN (Red)", Robot.BotState.DEFENCEIN);
    lightModeChooser.addOption("DEFENCEOUT (Yellow)", Robot.BotState.DEFENCEOUT);
    lightModeChooser.addOption("DEPLOY (Teal)", Robot.BotState.DEPLOY);
    lightModeChooser.addOption("RETRACT (Orange)", Robot.BotState.RETRACT);
    lightModeChooser.addOption("PIT (Off)", Robot.BotState.PIT);
    SmartDashboard.putData("Light Color", lightModeChooser);

    register();
  }

  private final Timer gyroLightTimer = new Timer();

  /**
   * Sets the LED display mode. Gyro modes (GYRO_STOP, GYRO_RESETING, GYRO_NONRESETING) hold for 2
   * seconds before any other mode can replace them, so the driver has time to see the indicator.
   */
  public void setMode(LightMode mode) {
    boolean currentIsGyro =
        this.mode == LightMode.GYRO_STOP
            || this.mode == LightMode.GYRO_RESETING
            || this.mode == LightMode.GYRO_NONRESETING;
    boolean requestIsGyro =
        mode == LightMode.GYRO_STOP
            || mode == LightMode.GYRO_RESETING
            || mode == LightMode.GYRO_NONRESETING;

    if (requestIsGyro) {
      // Always accept a gyro mode and restart the hold timer.
      gyroLightTimer.restart();
      this.mode = mode;
    } else if (currentIsGyro && !gyroLightTimer.hasElapsed(2.0)) {
      // Currently showing a gyro indicator and hold period hasn't elapsed — ignore.
    } else {
      this.mode = mode;
    }
  }

  @Override
  public void periodic() {
    logCounter++;
    boolean shouldLog = logCounter >= Constants.kLogInterval;
    if (shouldLog) logCounter = 0;

    // Read the dropdown selection to override which state color is displayed
    Robot.BotState colorOverride = lightModeChooser.getSelected();
    if (shouldLog) {
      Logger.recordOutput("Lights/Mode", mode.name());
    }
    switch (mode) {
      case BOT_STATE:
        if (Robot.inPit) {
          // Solid blue in pit mode
          LEDPattern.solid(new Color(0, 0, 255)).atBrightness(Percent.of(85)).applyTo(ledBuffer);
        } else {
          // Color based on dropdown selection (defaults to current robot state)
          Robot.BotState displayState =
              (colorOverride != null) ? colorOverride : Robot.currentState;
          Color stateColor;
          switch (displayState) {
            case SNOWBLOW:
              stateColor = new Color(255, 255, 255); // White
              break;
            case COLLECT:
              stateColor = new Color(0, 255, 0); // Green
              break;
            case DEFENCEIN:
              stateColor = new Color(255, 0, 0); // Red
              break;
            case DEFENCEOUT:
              stateColor = new Color(255, 255, 0); // Yellow
              break;
            case DEPLOY:
              stateColor = new Color(0, 255, 128); // Teal
              break;
            case RETRACT:
              stateColor = new Color(255, 128, 0); // Orange
              break;
            case PIT:
            default:
              stateColor = new Color(0, 0, 0); // Off
              break;
          }
          LEDPattern.solid(stateColor).applyTo(ledBuffer);
          if (shouldLog) {
            Logger.recordOutput("Lights/StateColor", displayState.name());
            Logger.recordOutput("Lights/R", stateColor.red * 255);
            Logger.recordOutput("Lights/G", stateColor.green * 255);
            Logger.recordOutput("Lights/B", stateColor.blue * 255);
          }
        }
        ledStrip.setData(ledBuffer);
        break;

      case GYRO_RESETING:
        LEDPattern.solid(new Color(255, 0, 0)).applyTo(ledBuffer);
        ledStrip.setData(ledBuffer);
        break;

      case GYRO_NONRESETING:
        LEDPattern.solid(new Color(0, 255, 0)).applyTo(ledBuffer);
        ledStrip.setData(ledBuffer);
        break;

      case GYRO_STOP:
        LEDPattern.solid(new Color(0, 0, 255)).applyTo(ledBuffer);
        ledStrip.setData(ledBuffer);
        break;

      case AUTO_POSE_GOOD:
        LEDPattern.solid(new Color(0, 255, 255)).applyTo(ledBuffer);
        ledStrip.setData(ledBuffer);
        break;

      case AUTO_POSE_BAD:
        LEDPattern.solid(new Color(255, 0, 0))
            .blink(edu.wpi.first.units.Units.Seconds.of(0.25))
            .applyTo(ledBuffer);
        ledStrip.setData(ledBuffer);
        break;

      case AUTO_POSE_STOP:
        LEDPattern.solid(new Color(0, 0, 255)).applyTo(ledBuffer);
        ledStrip.setData(ledBuffer);
        break;

      case COLOR_RED:
        LEDPattern.solid(new Color(255, 0, 0)).applyTo(ledBuffer);
        ledStrip.setData(ledBuffer);
        break;

      case COLOR_BLUE:
        LEDPattern.solid(new Color(0, 0, 255)).applyTo(ledBuffer);
        ledStrip.setData(ledBuffer);
        break;

      case COLOR_GREEN:
        LEDPattern.solid(new Color(0, 255, 0)).applyTo(ledBuffer);
        ledStrip.setData(ledBuffer);
        break;

      case COLOR_ORANGE:
        LEDPattern.solid(new Color(255, 128, 0)).applyTo(ledBuffer);
        ledStrip.setData(ledBuffer);
        break;

      case OFF:
      default:
        LEDPattern.kOff.applyTo(ledBuffer);
        ledStrip.setData(ledBuffer);
        break;
    }
  }

  public enum LightMode {
    GYRO_RESETING,
    GYRO_NONRESETING,
    GYRO_STOP,
    AUTO_POSE_BAD,
    AUTO_POSE_GOOD,
    AUTO_POSE_STOP,
    BOT_STATE,
    COLOR_RED,
    COLOR_BLUE,
    COLOR_GREEN,
    COLOR_ORANGE,
    OFF;
  }
}
