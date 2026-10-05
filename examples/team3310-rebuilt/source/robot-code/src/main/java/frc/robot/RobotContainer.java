package frc.robot;

import com.pathplanner.lib.auto.NamedCommands;
import edu.wpi.first.math.filter.Debouncer;
import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.geometry.Translation2d;
import edu.wpi.first.wpilibj.DriverStation.Alliance;
import edu.wpi.first.wpilibj.GenericHID;
import edu.wpi.first.wpilibj.XboxController;
import edu.wpi.first.wpilibj.smartdashboard.SmartDashboard;
import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.CommandScheduler;
import edu.wpi.first.wpilibj2.command.Commands;
import edu.wpi.first.wpilibj2.command.InstantCommand;
import edu.wpi.first.wpilibj2.command.WaitCommand;
import edu.wpi.first.wpilibj2.command.button.CommandXboxController;
import edu.wpi.first.wpilibj2.command.button.Trigger;
import frc.lib.subsystems.ServoMotorSubsystemConfig;
import frc.lib.subsystems.SimTalonFXIO;
import frc.lib.subsystems.TalonFXIO;
import frc.lib.util.Util;
import frc.robot.commands.DriveCommands;
import frc.robot.generated.TunerConstants;
// import frc.robot.subsystems.Lights;
import frc.robot.subsystems.agitator.Agitator;
import frc.robot.subsystems.drive.Drive;
import frc.robot.subsystems.drive.GyroIOPigeon2;
import frc.robot.subsystems.drive.GyroIOSim;
import frc.robot.subsystems.drive.ModuleIOSim;
import frc.robot.subsystems.drive.ModuleIOTalonFX;
import frc.robot.subsystems.intake.IntakePivot;
import frc.robot.subsystems.intake.IntakeRollers;
// import frc.robot.subsystems.roof.Roof;
import frc.robot.subsystems.scorer.flywheel.Flywheel;
import frc.robot.subsystems.scorer.hood.Hood;
import frc.robot.subsystems.scorer.turret.Turret;
import frc.robot.subsystems.scorer.turret.TurretAimManager;
import frc.robot.subsystems.vision.Vision;
import frc.robot.util.choosers.AutonomousChooser;
import java.util.Set;

/**
 * This class is where the bulk of the robot should be declared. Since Command-based is a
 * "declarative" paradigm, very little robot logic should actually be handled in the {@link Robot}
 * periodic methods (other than the scheduler calls). Instead, the structure of the robot (including
 * subsystems, commands, and button mappings) should be declared here.
 */
public class RobotContainer {

  private static RobotContainer instance;

  public static RobotContainer getInstance() {
    if (instance == null) {
      instance = new RobotContainer();
    }
    return instance;
  }

  // Subsystem Builders
  private Drive buildDriveSystem() {
    if (Constants.currentMode == Constants.Mode.REAL || org.instantcad.frc.TwinBridge.enabled()) {
      return new Drive(
          new GyroIOPigeon2(),
          new ModuleIOTalonFX(TunerConstants.FrontLeft),
          new ModuleIOTalonFX(TunerConstants.FrontRight),
          new ModuleIOTalonFX(TunerConstants.BackLeft),
          new ModuleIOTalonFX(TunerConstants.BackRight));
    } else {
      return new Drive(
          new GyroIOSim(),
          new ModuleIOSim(TunerConstants.FrontLeft),
          new ModuleIOSim(TunerConstants.FrontRight),
          new ModuleIOSim(TunerConstants.BackLeft),
          new ModuleIOSim(TunerConstants.BackRight));
    }
  }

  private Agitator buildAgitatorSystem(ServoMotorSubsystemConfig config, int logOffset) {
    if (Constants.currentMode == Constants.Mode.REAL) {
      return new Agitator(config, new TalonFXIO(config), logOffset);
    } else {
      return new Agitator(config, new SimTalonFXIO(config), logOffset);
    }
  }

  private IntakeRollers buildIntakeRollersSystem(ServoMotorSubsystemConfig config) {
    if (Constants.currentMode == Constants.Mode.REAL) {
      return new IntakeRollers(config, new TalonFXIO(config));
    } else {
      return new IntakeRollers(config, new SimTalonFXIO(config));
    }
  }

  private IntakePivot buildIntakePivotSystem() {
    if (Constants.currentMode == Constants.Mode.REAL) {
      return new IntakePivot(
          Constants.kIntakePivotConfig, new TalonFXIO(Constants.kIntakePivotConfig));
    } else {
      return new IntakePivot(
          Constants.kIntakePivotConfig, new SimTalonFXIO(Constants.kIntakePivotConfig));
    }
  }

  private Flywheel buildFlywheelSystem(ServoMotorSubsystemConfig config) {
    if (Constants.currentMode == Constants.Mode.REAL) {
      return new Flywheel(config, new TalonFXIO(config));
    } else {
      return new Flywheel(config, new SimTalonFXIO(config));
    }
  }

  private Hood buildHoodSystem(ServoMotorSubsystemConfig config) {
    if (Constants.currentMode == Constants.Mode.REAL) {
      return new Hood(config, new TalonFXIO(config));
    } else {
      return new Hood(config, new SimTalonFXIO(config));
    }
  }

  private Turret buildTurretSystem(ServoMotorSubsystemConfig config) {
    if (Constants.currentMode == Constants.Mode.REAL) {
      return new Turret(config, new TalonFXIO(config));
    } else {
      return new Turret(config, new SimTalonFXIO(config));
    }
  }

  // private Roof buildRoofSystem(ServoMotorSubsystemConfig config) {
  //   if (Constants.currentMode == Constants.Mode.REAL) {
  //     return new Roof(config, new TalonFXIO(config));
  //   } else {
  //     return new Roof(config, new SimTalonFXIO(config));
  //   }
  // }

  // Subsystem Intances
  private final Drive drive = buildDriveSystem();

  private final Agitator agitatorRight = buildAgitatorSystem(Constants.kRightFloorRollerConfig, 0);
  private final Agitator agitatorLeft = buildAgitatorSystem(Constants.kLeftFloorRollerConfig, 2);
  private final Agitator verticalFeedRight =
      buildAgitatorSystem(Constants.kRightVerticalFeedConfig, 5);
  private final Agitator verticalFeedLeft =
      buildAgitatorSystem(Constants.kLeftVerticalFeedConfig, 7);

  private final IntakeRollers intakeRollers =
      buildIntakeRollersSystem(Constants.kIntakeRollerConfig);
  private final IntakeRollers intakeRollerFollower =
      buildIntakeRollersSystem(Constants.kIntakeRollerFollowerConfig);
  private final IntakePivot intakePivot = buildIntakePivotSystem();

  private final Hood hoodLeft = buildHoodSystem(Constants.kLeftHoodConfig);
  private final Flywheel flywheelLeft = buildFlywheelSystem(Constants.kLeftFlywheelConfig);
  private final Turret turretLeft = buildTurretSystem(Constants.kLeftTurretConfig);

  private final Hood hoodRight = buildHoodSystem(Constants.kRightHoodConfig);
  private final Flywheel flywheelRight = buildFlywheelSystem(Constants.kRightFlywheelConfig);
  private final Turret turretRight = buildTurretSystem(Constants.kRightTurretConfig);

  // private final Roof roof = buildRoofSystem(Constants.kRoofConfig);

  public final AutonomousChooser autonomousChooser;

  // Turret aim calculator — computes desired turret/hood angles every cycle based
  // on robot pose, alliance color, and field zone. Logs everything via
  // AdvantageKit IO.
  private final TurretAimManager turretAimManager =
      new TurretAimManager(drive::getPose, drive::getChassisSpeeds);

  // Vision — 3× Limelight 4 cameras feeding MegaTag 2 poses into the drive
  // pose estimator.  Logs per-camera data under Vision/<cameraName>/ in
  // AdvantageScope.
  private final Vision vision = new Vision(drive);

  // #region getters
  public Drive getDrive() {
    return drive;
  }

  public Agitator getAgitatorRight() {
    return agitatorRight;
  }

  public Agitator getAgitatorLeft() {
    return agitatorLeft;
  }

  public Agitator getVerticalFeedRight() {
    return verticalFeedRight;
  }

  public Agitator getVerticalFeedLeft() {
    return verticalFeedLeft;
  }

  public IntakeRollers getIntakeRollers() {
    return intakeRollers;
  }

  public IntakePivot getIntakePivot() {
    return intakePivot;
  }

  public Hood getHoodLeft() {
    return hoodLeft;
  }

  public Flywheel getFlywheelLeft() {
    return flywheelLeft;
  }

  public Turret getTurretLeft() {
    return turretLeft;
  }

  public Hood getHoodRight() {
    return hoodRight;
  }

  public Flywheel getFlywheelRight() {
    return flywheelRight;
  }

  public double getDesiredLeftFlywheelRpm() {
    return desiredLeftFlywheelRpm;
  }

  public double getDesiredRightFlywheelRpm() {
    return desiredRightFlywheelRpm;
  }

  public void setDesiredFlywheelRpms(double leftRpm, double rightRpm) {
    desiredLeftFlywheelRpm = leftRpm;
    desiredRightFlywheelRpm = rightRpm;
  }

  public Turret getTurretRight() {
    return turretRight;
  }

  // public Roof getRoof() {
  //   return roof;
  // }

  public TurretAimManager getTurretAimManager() {
    return turretAimManager;
  }

  public Vision getVision() {
    return vision;
  }

  public AutonomousChooser getAutonomousChooser() {
    return autonomousChooser;
  }

  public Command getAutonomousCommand() {
    return autonomousChooser.getCommand();
  }

  public Command buildAutoDefenseOutCommand() {
    return Commands.parallel(
            intakePivot.deployCommand().asProxy(),
            intakeRollers.offCommand().asProxy(),
            agitatorLeft.offCommand().asProxy(),
            verticalFeedLeft.offCommand().asProxy(),
            verticalFeedRight.offCommand().asProxy(),
            flywheelLeft.idleCommand().asProxy(),
            flywheelRight.idleCommand().asProxy())
        .withName("Auto DefenceOut");
  }

  public Command buildAutoIntakeDeployPhaseCommand() {
    return Commands.deadline(
            intakePivot
                .motionMagicSetpointCommandBlocking(
                    () -> Constants.IntakeConstants.kIntakePivotDeployDegrees, 2.0)
                .asProxy(),
            intakeRollers.deployCommand().asProxy())
        .withName("Auto Intake Deploy Phase");
  }

  public Command buildAutoCollectCommand() {
    Command collectHold =
        Commands.parallel(
            intakeRollers.intakeCommand().asProxy(),
            agitatorLeft.collectCommand().asProxy(),
            // Right floor roller follows the left floor roller, so do not
            // directly command the follower in autonomous collect.
            verticalFeedLeft.verticalFeedCollectCommand().asProxy(),
            verticalFeedRight.verticalFeedCollectCommand().asProxy(),
            flywheelLeft.idleCommand().asProxy(),
            flywheelRight.idleCommand().asProxy());

    return Commands.sequence(buildAutoIntakeDeployPhaseCommand(), collectHold)
        .withName("Auto Collect");
  }

  public Command holdDefenceOutCommand() {
    return buildAutoDefenseOutCommand().withName("Hold DefenceOut");
  }

  public Command holdCollectCommand() {
    return buildAutoCollectCommand().withName("Hold Collect");
  }

  public Command holdShootCommand() {
    return buildShootWhileHeldCommand(false, true).withName("Hold Shoot");
  }

  public Command buildAutoShootCommand() {
    return buildShootWhileHeldCommand(true, true).withName("Auto Shoot");
  }

  public Command buildAutoShootOnCommand() {
    Command shootOn = buildShootWhileHeldCommand(true, false).withName("Auto ShootOn");
    activeAutoShootOnCommand = shootOn;
    return shootOn.finallyDo(
        () -> {
          if (activeAutoShootOnCommand == shootOn) {
            activeAutoShootOnCommand = null;
          }
        });
  }

  public Command buildAutoShootOffCommand() {
    return Commands.runOnce(
            () -> {
              cancelActiveAutoShootOn();
              Robot.shootButtonHeld = false;
            })
        .withName("Auto ShootOff");
  }

  public Command buildAutoFlywheelsOnCommand() {
    java.util.function.DoubleSupplier leftTargetRpm = turretAimManager::getLeftFlywheelRPM;
    java.util.function.DoubleSupplier rightTargetRpm = turretAimManager::getRightFlywheelRPM;

    return Commands.parallel(
            flywheelLeft.setRPMCommand(leftTargetRpm).asProxy(),
            flywheelRight.setRPMCommand(rightTargetRpm).asProxy())
        .withName("Auto Flywheels On");
  }

  public Command buildAutoSnowblowCommand() {
    java.util.function.DoubleSupplier leftTargetRpm = turretAimManager::getLeftFlywheelRPM;
    java.util.function.DoubleSupplier rightTargetRpm = turretAimManager::getRightFlywheelRPM;
    return Commands.parallel(
            Commands.startEnd(
                () -> Robot.shootButtonHeld = true, () -> Robot.shootButtonHeld = false),
            flywheelLeft.setRPMCommand(leftTargetRpm).asProxy(),
            flywheelRight.setRPMCommand(rightTargetRpm).asProxy(),
            intakePivot.deployCommand().asProxy(),
            intakeRollers.intakeCommand().asProxy(),
            buildReadyFeedCommand(true))
        .withName("Auto Snowblow");
  }

  // #endregion

  // Controllers
  private final CommandXboxController driver = new CommandXboxController(1);
  private final CommandXboxController operator = new CommandXboxController(0);
  private static final Pose2d kPitAssumedPose =
      new Pose2d(new Translation2d(3.581, 4.039), Rotation2d.kZero);
  // Flywheel enable policy:
  // - Pit mode: controlled by pitFlywheelsEnabled via operator/dashboard toggles.
  // - Normal mode: controlled by normalFlywheelsEnabled (default true for auto +
  // teleop).
  public boolean pitFlywheelsEnabled = false;
  public boolean normalFlywheelsEnabled = true;
  // Keep pit mode as a distinct path, but default operator pit behavior to mirror normal mode.
  public boolean pitOperatorMirrorsNormalMode = true;
  public boolean pitManualTurretEnabled = false;
  private double desiredLeftFlywheelRpm = 0.0;
  private double desiredRightFlywheelRpm = 0.0;
  private Command activeAutoShootOnCommand = null;

  private void cancelActiveAutoShootOn() {
    if (activeAutoShootOnCommand == null) {
      return;
    }

    if (CommandScheduler.getInstance().isScheduled(activeAutoShootOnCommand)) {
      activeAutoShootOnCommand.cancel();
    }
  }

  /** The container for the robot. Contains subsystems, OI devices, and commands. */
  public RobotContainer() {
    // Intake follower roller follows the intake master roller.
    intakeRollerFollower.motorIO.follow(Constants.kIntakeRollerConfig.talonCANID, false);
    intakeRollerFollower.setDefaultCommand(
        Commands.run(
                () ->
                    intakeRollerFollower.motorIO.follow(
                        Constants.kIntakeRollerConfig.talonCANID, false),
                intakeRollerFollower)
            .ignoringDisable(true)
            .withName("IntakeRollerFollower Follow IntakeRoller"));

    // Right floor roller follows the left floor roller so the left remains
    // the only floor roller running VelocityTorqueCurrentFOC closed-loop control.
    agitatorRight.motorIO.follow(Constants.kLeftFloorRollerConfig.talonCANID, true);
    agitatorRight.setDefaultCommand(
        Commands.run(
                () ->
                    agitatorRight.motorIO.follow(Constants.kLeftFloorRollerConfig.talonCANID, true),
                agitatorRight)
            .ignoringDisable(true)
            .withName("RightFloorRoller Follow LeftFloorRoller"));

    // Register PathPlanner named commands (must be before any path loading)
    NamedCommands.registerCommand(
        "stateDefenceOut", Commands.defer(this::holdDefenceOutCommand, Set.of()));
    NamedCommands.registerCommand(
        "stateCollect", Commands.defer(this::holdCollectCommand, Set.of()));
    NamedCommands.registerCommand(
        "flywheelsOn", Commands.defer(this::buildAutoFlywheelsOnCommand, Set.of()));
    NamedCommands.registerCommand(
        "shootOn", Commands.defer(this::buildAutoShootOnCommand, Set.of()));
    NamedCommands.registerCommand(
        "shootOff", Commands.defer(this::buildAutoShootOffCommand, Set.of()));
    NamedCommands.registerCommand(
        "deployIntake",
        Commands.defer(
            () -> Commands.parallel(intakePivot.deployCommand(), intakeRollers.deployCommand()),
            Set.of()));

    // Initialize autonomous commands
    autonomousChooser = new AutonomousChooser();
    DriverReadout.addChoosers(autonomousChooser);

    // #region Dashboard Buttons
    SmartDashboard.putData(
        "enterPitMode",
        Commands.runOnce(
            () -> {
              Robot.inPit = true;
              drive.setPose(kPitAssumedPose);
            },
            drive));
    SmartDashboard.putData(
        "exitPitMode",
        Commands.runOnce(
            () -> {
              Robot.inPit = false;
            }));

    SmartDashboard.putData("intake", intakeRollers.intakeCommand());
    SmartDashboard.putData("outtake", intakeRollers.outtakeCommand());
    SmartDashboard.putData(
        "shoot",
        Commands.parallel(
            flywheelLeft.shootCommand(),
            flywheelRight.shootCommand(),
            verticalFeedLeft.verticalFeedIntakeCommand(),
            verticalFeedRight.verticalFeedIntakeCommand(),
            agitatorLeft.snowblowCommand(),
            // Right floor roller now follows the left floor roller.
            // Keep the old direct command commented out so follower mode is not overridden.
            // agitatorRight.snowblowCommand(),
            hoodLeft.setDegreesCommand(Constants.ScorerConstants.kHoodStowedDegrees),
            hoodRight.setDegreesCommand(Constants.ScorerConstants.kHoodStowedDegrees)));
    SmartDashboard.putData(
        "rotate Robot 0°",
        DriveCommands.joystickDriveAtAngle(
            drive, () -> 0.0, () -> 0.0, () -> Rotation2d.fromDegrees(0.0)));
    SmartDashboard.putData(
        "rotate Robot 90°",
        DriveCommands.joystickDriveAtAngle(
            drive, () -> 0.0, () -> 0.0, () -> Rotation2d.fromDegrees(90.0)));
    SmartDashboard.putData(
        "rotate Robot 180°",
        DriveCommands.joystickDriveAtAngle(
            drive, () -> 0.0, () -> 0.0, () -> Rotation2d.fromDegrees(180.0)));
    SmartDashboard.putData(
        "rotate Robot 270°",
        DriveCommands.joystickDriveAtAngle(
            drive, () -> 0.0, () -> 0.0, () -> Rotation2d.fromDegrees(270.0)));
    SmartDashboard.putData(
        "rotate left turret", turretLeft.setDegreesCommand(turretLeft.getCurrentPosition() + 90.0));
    SmartDashboard.putData(
        "rotate right turret",
        turretRight.setDegreesCommand(turretRight.getCurrentPosition() + 90.0));
    SmartDashboard.putData(
        "deploy intake",
        Commands.parallel(
            intakePivot.setDegreesCommand(Constants.IntakeConstants.kIntakePivotDeployDegrees),
            intakeRollers.deployCommand()));
    SmartDashboard.putData(
        "retract intake",
        intakePivot.setDegreesCommand(Constants.IntakeConstants.kIntakePivotStowedDegrees));
    SmartDashboard.putData(
        "floors on",
        Commands.parallel(
            agitatorLeft.snowblowCommand()
            // Right floor roller now follows the left floor roller.
            // Keep the old direct command commented out so follower mode is not overridden.
            // , agitatorRight.snowblowCommand()
            ));
    SmartDashboard.putData(
        "spit balls",
        Commands.parallel(
            agitatorLeft.reverseCommand(),
            // Right floor roller now follows the left floor roller.
            // Keep the old direct command commented out so follower mode is not overridden.
            // agitatorRight.reverseCommand(),
            intakeRollers.outtakeCommand()));
    SmartDashboard.putData(
        "vertical feed on",
        Commands.parallel(
            verticalFeedLeft.verticalFeedIntakeCommand(),
            verticalFeedRight.verticalFeedIntakeCommand()));
    SmartDashboard.putData(
        "vertical feed reverse",
        Commands.parallel(
            verticalFeedLeft.verticalFeedOuttakeCommand(),
            verticalFeedRight.verticalFeedOuttakeCommand()));
    SmartDashboard.putData(
        "flywheel on",
        Commands.runOnce(
            () -> {
              if (Robot.inPit) {
                pitFlywheelsEnabled = true;
              } else {
                normalFlywheelsEnabled = true;
              }
            }));
    SmartDashboard.putData(
        "flywheel off",
        Commands.runOnce(
            () -> {
              if (Robot.inPit) {
                pitFlywheelsEnabled = false;
              } else {
                normalFlywheelsEnabled = false;
              }
            }));
    SmartDashboard.putData(
        "Move Hood to max", Commands.parallel(hoodLeft.setMaxCommand(), hoodRight.setMaxCommand()));
    SmartDashboard.putData(
        "Reset Hood",
        Commands.parallel(
            hoodLeft.setDegreesCommand(Constants.ScorerConstants.kHoodStowedDegrees),
            hoodRight.setDegreesCommand(Constants.ScorerConstants.kHoodStowedDegrees)));
    SmartDashboard.putData(
        "rotate turret to max",
        Commands.parallel(turretLeft.maxCommand(), turretRight.maxCommand()));

    SmartDashboard.putData(
        "Change Hub Active", new InstantCommand(() -> Robot.hubOverride = !Robot.hubOverride));

    // SmartDashboard.putData("Roof Deploy", roof.setMaxHeightCommand());
    // SmartDashboard.putData("Roof Stow", roof.setMinHeightCommand());

    // LED on/off buttons
    // SmartDashboard.putData(
    //     "Lights ON",
    //     new InstantCommand(() -> Lights.getInstance().setMode(Lights.LightMode.BOT_STATE))
    //         .ignoringDisable(true));
    // SmartDashboard.putData(
    //     "Lights OFF",
    //     new InstantCommand(() -> Lights.getInstance().setMode(Lights.LightMode.OFF))
    //         .ignoringDisable(true));

    // Speed tuning — publish defaults so Elastic/SmartDashboard shows editable
    // number widgets.
    // Robot.robotPeriodic() reads these back into the Constants each loop.
    SmartDashboard.putNumber(
        "SpeedTune/FloorForwardRPM", Constants.AgitatorConstants.kFloorRollerSnowblowRPM);
    SmartDashboard.putNumber(
        "SpeedTune/FloorReverseRPM", Constants.AgitatorConstants.kFloorRollerReverseRPM);
    SmartDashboard.putNumber(
        "SpeedTune/IntakeForwardRPM", Constants.IntakeConstants.kIntakeVelocityRPM);
    SmartDashboard.putNumber(
        "SpeedTune/IntakeReverseRPM", Constants.IntakeConstants.kOuttakeVelocityRPM);
    SmartDashboard.putNumber(
        "SpeedTune/VertFeedForwardRPM", Constants.AgitatorConstants.kVerticalFeedIntakeRPM);
    SmartDashboard.putNumber(
        "SpeedTune/VertFeedReverseRPM", Constants.AgitatorConstants.kVerticalFeedOuttakeRPM);
    SmartDashboard.putNumber("SpeedTune/FlywheelForwardRPM", Constants.ScorerConstants.kShootRPM);
    SmartDashboard.putNumber(
        "SpeedTune/FlywheelReverseRPM", Constants.ScorerConstants.kReverseShootRPM);
    SmartDashboard.putNumber(
        "SpeedTune/TurretMaxDegrees", Constants.ScorerConstants.kTurretMaxPositionUnits);
    SmartDashboard.putNumber("SpeedTune/HoodMaxDegrees", Constants.ScorerConstants.kHoodMaxDegrees);
    SmartDashboard.putNumber(
        "SpeedTune/PhaseDelaySeconds", Constants.ScorerConstants.kPhaseDelaySeconds);
    SmartDashboard.putNumber(
        "SpeedTune/ReleaseDelaySeconds", Constants.ScorerConstants.kReleaseDelaySeconds);

    // Vision filter-strength tuning — multipliers for the Limelight std devs
    // fed into the WPILib pose estimator.  >1.0 = smoother, <1.0 = snappier.
    SmartDashboard.putNumber(
        "VisionTune/MT2StdDevMultiplier", Constants.VisionConstants.kMT2StdDevMultiplier);
    SmartDashboard.putNumber(
        "VisionTune/MT1StdDevMultiplier", Constants.VisionConstants.kMT1StdDevMultiplier);
    SmartDashboard.putNumber(
        "VisionTune/MaxPoseJumpM", Constants.VisionConstants.kMaxPoseJumpMeters);
    SmartDashboard.putNumber(
        "VisionTune/MT2MaxAcceptedStdDev", Constants.VisionConstants.kMT2MaxAcceptedStdDev);
    SmartDashboard.putNumber("turret offset", Constants.ScorerConstants.kTurretOffsetDegrees);

    // Removed individual turret offset controls; only the global turret offset remains adjustable.

    // Light color buttons — work even while disabled
    // SmartDashboard.putData(
    //     "Lights Red",
    //     new InstantCommand(() -> Lights.getInstance().setMode(Lights.LightMode.COLOR_RED))
    //         .ignoringDisable(true));
    // SmartDashboard.putData(
    //     "Lights Blue",
    //     new InstantCommand(() -> Lights.getInstance().setMode(Lights.LightMode.COLOR_BLUE))
    //         .ignoringDisable(true));
    // SmartDashboard.putData(
    //     "Lights Green",
    //     new InstantCommand(() -> Lights.getInstance().setMode(Lights.LightMode.COLOR_GREEN))
    //         .ignoringDisable(true));
    // SmartDashboard.putData(
    //     "Lights Orange",
    //     new InstantCommand(() -> Lights.getInstance().setMode(Lights.LightMode.COLOR_ORANGE))
    //         .ignoringDisable(true));
    // #endregion

    // Initialize LED display mode to show bot state colors
    // Lights.getInstance().setMode(Lights.LightMode.BOT_STATE);

    // Configure the button bindings
    configureButtonBindings();
  }

  /**
   * Use this method to define your button->command mappings. Buttons can be created by
   * instantiating a {@link GenericHID} or one of its subclasses ({@link
   * edu.wpi.first.wpilibj.Joystick} or {@link XboxController}), and then passing it to a {@link
   * edu.wpi.first.wpilibj2.command.button.JoystickButton}.
   */
  private Command buildNormalSnapCommand(double targetAngleDeg) {
    return DriveCommands.joystickDriveAtAngle(
            drive,
            () -> -driver.getLeftY(),
            () -> -driver.getLeftX(),
            () -> getDriverPerspectiveSnapAngle(targetAngleDeg),
            this::getDriverCenterOfRotation)
        .until(
            () ->
                Math.abs(driver.getRightX())
                    > Constants.DriveCommandConstants.kRotationCommandDeadband);
  }

  private Translation2d getDriverCenterOfRotation() {
    return driver.getHID().getRightTriggerAxis() > 0.5
        ? new Translation2d(
            Constants.DriveCommandConstants.kDriverAltCenterOfRotationXMeters,
            Constants.DriveCommandConstants.kDriverAltCenterOfRotationYMeters)
        : Translation2d.kZero;
  }

  private Rotation2d getDriverPerspectiveSnapAngle(double blueFrameAngleDeg) {
    Rotation2d targetAngle = Rotation2d.fromDegrees(blueFrameAngleDeg);
    return Robot.currentAlliance == Alliance.Red ? Util.flipRedBlue(targetAngle) : targetAngle;
  }

  private Command buildCrossOverrideCommand() {
    return Commands.parallel(
            hoodLeft.setDegreesCommand(Constants.ScorerConstants.kHoodMinDegrees),
            hoodRight.setDegreesCommand(Constants.ScorerConstants.kHoodMinDegrees),
            intakePivot.setDegreesCommand(Constants.IntakeConstants.kHeadButtDegrees))
        .alongWith(
            Commands.startEnd(
                () -> Robot.crossOverrideActive = true, () -> Robot.crossOverrideActive = false));
  }

  private Command buildOverrideStateCommand(Robot.OverrideState overrideState) {
    return Commands.runOnce(
        () -> {
          Robot.overrideState = overrideState;
          Robot.stateRefreshRequested = true;
        });
  }

  /**
   * Waits until both floor rollers are at snowblow speed (live from the SmartDashboard table), then
   * enables both vertical feed rollers at the aim-manager's desired RPM. Registered as the
   * PathPlanner named command {@code "snowblow"}.
   */
  @SuppressWarnings("unused")
  private Command buildSnowblowCommand() {
    return new edu.wpi.first.wpilibj2.command.WaitUntilCommand(
            () -> {
              double target = Constants.AgitatorConstants.kFloorRollerSnowblowRPM;
              double tol = Constants.ScorerConstants.kFlywheelRPMTolerance;
              return Math.abs(agitatorLeft.getCurrentVelocity() - target) < tol
                  && Math.abs(agitatorRight.getCurrentVelocity() - target) < tol;
            })
        .withTimeout(3.0)
        .andThen(
            Commands.runOnce(
                () -> {
                  java.util.function.DoubleSupplier leftFeedRpm =
                      turretAimManager::getLeftVerticalFeedRPM;
                  java.util.function.DoubleSupplier rightFeedRpm =
                      turretAimManager::getRightVerticalFeedRPM;
                  edu.wpi.first.wpilibj2.command.CommandScheduler.getInstance()
                      .schedule(verticalFeedLeft.setRPMCommand(leftFeedRpm));
                  edu.wpi.first.wpilibj2.command.CommandScheduler.getInstance()
                      .schedule(verticalFeedRight.setRPMCommand(rightFeedRpm));
                }))
        .withName("SnowblowEnableVertical");
  }

  private boolean isOperatorJamClearOverrideAllowed() {
    return isUsingLegacyPitOperatorMode()
        || Robot.currentState == Robot.BotState.DEFENCEOUT
        || Robot.currentState == Robot.BotState.COLLECT;
  }

  private Command buildOperatorJamClearOverrideCommand() {
    return Commands.parallel(
            intakeRollers.outtakeCommand(),
            agitatorLeft.reverseCommand(),
            // Right floor roller now follows the left floor roller.
            // Keep the old direct command commented out so follower mode is not overridden.
            // agitatorRight.reverseCommand(),
            verticalFeedLeft.verticalFeedOuttakeCommand(),
            verticalFeedRight.verticalFeedOuttakeCommand())
        .finallyDo(() -> Robot.stateRefreshRequested = true);
  }

  private boolean isUsingLegacyPitOperatorMode() {
    return Robot.inPit && !pitOperatorMirrorsNormalMode;
  }

  private Command buildPitCardinalDriveCommand(
      double xMetersPerSecondScalar, double yMetersPerSecondScalar) {
    return DriveCommands.joystickDrive(
        drive, () -> xMetersPerSecondScalar, () -> yMetersPerSecondScalar, () -> 0.0);
  }

  /**
   * Returns true when both physical turrets are within tolerance of their commanded positions. Use
   * this to gate feeders so balls aren't launched while the turret is mid-flip.
   */
  public boolean isTurretOnTarget() {
    double tol = Constants.ScorerConstants.kTurretLockOnToleranceDeg;
    double leftErr =
        Math.abs(turretLeft.getCurrentPosition() - turretAimManager.getLeftTurretAngleDeg());
    double rightErr =
        Math.abs(turretRight.getCurrentPosition() - turretAimManager.getRightTurretAngleDeg());
    return leftErr < tol && rightErr < tol;
  }

  private Command maybeProxy(Command command, boolean proxyCommands) {
    return proxyCommands ? command.asProxy() : command;
  }

  private boolean leftFeedReady;
  private boolean rightFeedReady;

  public boolean isShotFeedReady() {
    return leftFeedReady && rightFeedReady;
  }

  public boolean isLeftFeedReady() { return leftFeedReady; }
  public boolean isRightFeedReady() { return rightFeedReady; }

  /** Each lane waits for its own measured flywheel speed, and rechecks under load. */
  public Command buildReadyFeedCommand(boolean proxyCommands) {
    Debouncer leftSettled = new Debouncer(0.10, Debouncer.DebounceType.kRising);
    Debouncer rightSettled = new Debouncer(0.10, Debouncer.DebounceType.kRising);
    Command readiness = Commands.run(() -> {
      double left = turretAimManager.getLeftFlywheelRPM();
      double right = turretAimManager.getRightFlywheelRPM();
      double tolerance = Constants.ScorerConstants.kFlywheelRPMTolerance;
      boolean sim = org.instantcad.frc.TwinBridge.enabled();
      boolean leftAimReady = !sim || (Math.abs(hoodLeft.getCurrentPosition()
          - turretAimManager.getLeftHoodAngleDeg()) <= Constants.ScorerConstants.kHoodDegreesTolerance
          && Math.abs(turretLeft.getCurrentPosition() - turretAimManager.getLeftTurretAngleDeg()) <= 2.0);
      boolean rightAimReady = !sim || (Math.abs(hoodRight.getCurrentPosition()
          - turretAimManager.getRightHoodAngleDeg()) <= Constants.ScorerConstants.kHoodDegreesTolerance
          && Math.abs(turretRight.getCurrentPosition() - turretAimManager.getRightTurretAngleDeg()) <= 2.0);
      leftFeedReady = leftSettled.calculate(Double.isFinite(left) && left > 0
          && leftAimReady && Math.abs(flywheelLeft.getCurrentVelocity() - left) <= tolerance);
      rightFeedReady = rightSettled.calculate(Double.isFinite(right) && right > 0
          && rightAimReady && Math.abs(flywheelRight.getCurrentVelocity() - right) <= tolerance);
    });
    return Commands.parallel(
            readiness,
            maybeProxy(verticalFeedLeft.setRPMCommand(
                () -> leftFeedReady ? turretAimManager.getLeftVerticalFeedRPM() : 0), proxyCommands),
            maybeProxy(verticalFeedRight.setRPMCommand(
                () -> rightFeedReady ? turretAimManager.getRightVerticalFeedRPM() : 0), proxyCommands),
            maybeProxy(agitatorLeft.setRPMCommand(
                () -> leftFeedReady || rightFeedReady ? Constants.AgitatorConstants.kFloorRollerSnowblowRPM : 0), proxyCommands))
        .beforeStarting(() -> {
          leftFeedReady = false; rightFeedReady = false;
          leftSettled.calculate(false); rightSettled.calculate(false);
        })
        .finallyDo(() -> { leftFeedReady = false; rightFeedReady = false; })
        .withName("Feed each lane at measured flywheel speed");
  }

  private Command buildShootWhileHeldCommand(boolean proxyCommands, boolean runCleanupOnEnd) {
    java.util.function.DoubleSupplier leftTargetRpm = turretAimManager::getLeftFlywheelRPM;
    java.util.function.DoubleSupplier rightTargetRpm = turretAimManager::getRightFlywheelRPM;

    Command shooterCore =
        Commands.parallel(
            maybeProxy(flywheelLeft.setRPMCommand(leftTargetRpm), proxyCommands),
            maybeProxy(flywheelRight.setRPMCommand(rightTargetRpm), proxyCommands),
            buildReadyFeedCommand(proxyCommands));

    if (runCleanupOnEnd) {
      shooterCore =
          shooterCore.finallyDo(
              () -> {
                CommandScheduler.getInstance().schedule(flywheelLeft.offCommand());
                CommandScheduler.getInstance().schedule(flywheelRight.offCommand());
                CommandScheduler.getInstance().schedule(verticalFeedLeft.offCommand());
                CommandScheduler.getInstance().schedule(verticalFeedRight.offCommand());
                CommandScheduler.getInstance().schedule(agitatorLeft.offCommand());
                // Right floor roller now follows the left floor roller.
                // Keep the old direct off command commented out so follower mode is not
                // overridden.
                // CommandScheduler.getInstance().schedule(agitatorRight.offCommand());
                Robot.stateRefreshRequested = true;
              });
    }

    return Commands.parallel(
        Commands.startEnd(() -> Robot.shootButtonHeld = true, () -> Robot.shootButtonHeld = false),
        shooterCore);
  }

  private void configureButtonBindings() {
    // Flywheel defaults enforce desired mode behavior:
    // - Pit: off unless explicitly enabled.
    // - Normal: on unless explicitly disabled.
    // Flywheels off when:
    //  - Pit mode and pitFlywheelsEnabled is false
    //  - Normal mode and normalFlywheelsEnabled is false
    //  - DEFENCEIN (hood at min / "cross" - do not shoot)]

    // Hood defaults: continuously hold the last-commanded position via motion
    // magic.  Without this the base-class neutral command takes over as soon as a
    // setDegreesCommand finishes, and the hood drifts back to zero / goes limp.
    hoodLeft.setTeleopDefaultCommand();
    hoodRight.setTeleopDefaultCommand();
    // roof.setTeleopDefaultCommand();
    flywheelLeft.setDefaultCommand(
        flywheelLeft.offCommand().withName("Flywheel Left Neutral (default)"));
    flywheelRight.setDefaultCommand(
        flywheelRight.offCommand().withName("Flywheel Right Neutral (default)"));

    // Default command, normal field-relative drive (same in both modes)
    drive.setDefaultCommand(
        DriveCommands.joystickDrive(
            drive,
            () -> -driver.getLeftY(),
            () -> -driver.getLeftX(),
            () -> -driver.getRightX(),
            this::getDriverCenterOfRotation));

    // #region Driver Controls
    // --- DRIVER BINDINGS
    // -----------------------------------------------------------------------

    // Face buttons (pit): hold to drive full-speed cardinals.
    driver.y().and(() -> Robot.inPit).whileTrue(buildPitCardinalDriveCommand(1.0, 0.0));
    driver.x().and(() -> Robot.inPit).whileTrue(buildPitCardinalDriveCommand(0.0, 1.0));
    driver.a().and(() -> Robot.inPit).whileTrue(buildPitCardinalDriveCommand(-1.0, 0.0));
    driver.b().and(() -> Robot.inPit).whileTrue(buildPitCardinalDriveCommand(0.0, -1.0));

    // Face buttons (normal): on release, snap to angle and keep holding until
    // driver commands
    // manual rotation by pushing right-stick X outside the normal rotation
    // deadband.
    driver
        .y()
        .and(() -> !Robot.inPit)
        .whileTrue(buildNormalSnapCommand(Constants.DriveCommandConstants.kDriverSnapAngleYDeg));
    driver
        .x()
        .and(() -> !Robot.inPit)
        .whileTrue(buildNormalSnapCommand(Constants.DriveCommandConstants.kDriverSnapAngleXDeg));
    driver
        .a()
        .and(() -> !Robot.inPit)
        .whileTrue(buildNormalSnapCommand(Constants.DriveCommandConstants.kDriverSnapAngleADeg));
    driver
        .b()
        .and(() -> !Robot.inPit)
        .whileTrue(buildNormalSnapCommand(Constants.DriveCommandConstants.kDriverSnapAngleBDeg));
    // Start: normal = zero gyro (both modes)
    driver
        .start()
        .onTrue(
            Commands.runOnce(
                    () ->
                        drive.setPose(
                            new Pose2d(drive.getPose().getTranslation(), Rotation2d.kZero)),
                    drive)
                .ignoringDisable(true));

    // Back: pit = set pose to Blue right-of-hub scoring position, normal = set pose to behind Red
    // Hub
    driver
        .back()
        .and(() -> Robot.inPit)
        .onTrue(
            Commands.runOnce(() -> drive.setPose(kPitAssumedPose), drive).ignoringDisable(true));
    driver
        .back()
        .and(() -> !Robot.inPit)
        .onTrue(
            Commands.runOnce(
                    () -> {
                      Pose2d blueFrontHubPose =
                          new Pose2d(new Translation2d(3.581, 4.039), Rotation2d.kZero);
                      Pose2d targetPose =
                          Robot.currentAlliance == Alliance.Red
                              ? new Pose2d(
                                  Util.flipRedBlue(blueFrontHubPose.getTranslation()),
                                  Util.flipRedBlue(blueFrontHubPose.getRotation()))
                              : blueFrontHubPose;
                      drive.setPose(targetPose);
                    },
                    drive)
                .ignoringDisable(true));

    // right bumper = unbound

    // left bumper = intake roller outtake only while held in both modes
    driver
        .leftBumper()
        .whileTrue(
            intakeRollers.outtakeCommand().finallyDo(() -> Robot.stateRefreshRequested = true));

    // right trigger = alternate center of rotation for normal drive + snap-to-angle

    // left trigger = intake roller only while held in both modes
    driver.leftTrigger().whileTrue(intakeRollers.intakeCommand());

    driver
        .povDown()
        .and(() -> !Robot.inPit)
        .onTrue(
            Commands.parallel(
                hoodLeft.setDegreesCommand(Constants.ScorerConstants.kHoodMinDegrees),
                hoodRight.setDegreesCommand(Constants.ScorerConstants.kHoodMinDegrees)));
    // #endregion

    // #region Operator Controls
    // ----------------------------------------------------------------------------------------------------

    if (turretLeft != null) {

      // Pit: left joystick angle maps directly to left turret angle.
      // The command is still clamped by the turret software limits (currently ±220°).
      // Only updates when stick is pushed past deadband magnitude.
      turretLeft.setDefaultCommand(
          turretLeft.dutyCycleCommand(
              () -> {
                if (!Robot.inPit) return 0.0;
                if (!pitManualTurretEnabled) return 0.0;
                double x = operator.getLeftX();
                double y = operator.getLeftY();
                if (Math.sqrt(x * x + y * y) < 0.5) return 0.0;
                double angleDeg = Math.toDegrees(Math.atan2(x, -y)); // 0° = stick up, +CW
                double clamped =
                    Math.max(
                        Constants.ScorerConstants.kTurretMinPositionUnits,
                        Math.min(Constants.ScorerConstants.kTurretMaxPositionUnits, angleDeg));
                edu.wpi.first.wpilibj2.command.CommandScheduler.getInstance()
                    .schedule(turretLeft.setDegreesCommand(clamped));
                return 0.0;
              }));
    }

    if (turretRight != null) {
      // Pit: right joystick angle maps directly to right turret angle.
      // The command is still clamped by the turret software limits (currently ±220°).
      turretRight.setDefaultCommand(
          turretRight.dutyCycleCommand(
              () -> {
                if (!Robot.inPit) return 0.0;
                if (!pitManualTurretEnabled) return 0.0;
                double x = operator.getRightX();
                double y = operator.getRightY();
                if (Math.sqrt(x * x + y * y) < 0.5) return 0.0;
                double angleDeg = Math.toDegrees(Math.atan2(x, -y));
                double clamped =
                    Math.max(
                        Constants.ScorerConstants.kTurretMinPositionUnits,
                        Math.min(Constants.ScorerConstants.kTurretMaxPositionUnits, angleDeg));
                edu.wpi.first.wpilibj2.command.CommandScheduler.getInstance()
                    .schedule(turretRight.setDegreesCommand(clamped));
                return 0.0;
              }));
    }

    if (agitatorRight != null && agitatorLeft != null) {
      // Y = pit legacy: shooter rollers on | normal and mirrored pit: snowblow state
      operator
          .y()
          .onTrue(
              Commands.either(
                  Commands.runOnce(() -> pitFlywheelsEnabled = true),
                  buildOverrideStateCommand(Robot.OverrideState.SNOWBLOW),
                  this::isUsingLegacyPitOperatorMode));
    }

    // X = pit legacy: shooter rollers off | normal and mirrored pit: defenceout state
    operator
        .x()
        .onTrue(
            Commands.either(
                Commands.runOnce(() -> pitFlywheelsEnabled = false),
                buildOverrideStateCommand(Robot.OverrideState.DEFENCEOUT),
                this::isUsingLegacyPitOperatorMode));

    // B = pit legacy: floors on | normal and mirrored pit: collect state
    operator
        .b()
        .toggleOnTrue(
            Commands.either(
                Commands.parallel(
                    agitatorLeft.snowblowCommand()
                    // Right floor roller now follows the left floor roller.
                    // Keep the old direct command commented out so follower mode is not overridden.
                    // , agitatorRight.snowblowCommand()
                    ),
                buildOverrideStateCommand(Robot.OverrideState.COLLECT),
                this::isUsingLegacyPitOperatorMode));

    // A = pit legacy: floors off | normal and mirrored pit: defencein state
    operator
        .a()
        .toggleOnTrue(
            Commands.either(
                Commands.parallel(
                    agitatorLeft.offCommand()
                    // Right floor roller now follows the left floor roller.
                    // Keep the old direct off command commented out so follower mode is not
                    // overridden.
                    // , agitatorRight.offCommand()
                    ),
                buildOverrideStateCommand(Robot.OverrideState.DEFENCEIN),
                this::isUsingLegacyPitOperatorMode));

    // Right Trigger:
    // Pit legacy -> toggle vertical feed rollers on/off.
    // Normal mode and mirrored pit -> spin flywheels to TurretAimManager RPM, wait for at-speed,
    // then engage vertical feeders + agitators. All off on release.
    operator
        .rightTrigger()
        .and(() -> !isUsingLegacyPitOperatorMode())
        .and(
            () ->
                Robot.currentState == Robot.BotState.DEFENCEOUT
                    || Robot.currentState == Robot.BotState.COLLECT)
        .whileTrue(holdShootCommand());

    // Left Trigger:
    // Pit legacy -> toggleOnTrue: vertical rollers off
    // Normal mode and mirrored pit -> whileTrue: intake on only while held in DEFENCEOUT
    if (verticalFeedRight != null && verticalFeedLeft != null) {
      operator
          .leftTrigger()
          .and(this::isUsingLegacyPitOperatorMode)
          .toggleOnTrue(
              Commands.parallel(verticalFeedLeft.offCommand(), verticalFeedRight.offCommand()));

      operator
          .leftTrigger()
          .and(
              () ->
                  !isUsingLegacyPitOperatorMode()
                      && Robot.currentState == Robot.BotState.DEFENCEOUT)
          .whileTrue(intakeRollers.intakeCommand());
    }

    // Left bumper = jam-clear override while held
    operator
        .leftBumper()
        .and(this::isOperatorJamClearOverrideAllowed)
        .whileTrue(buildOperatorJamClearOverrideCommand());

    if (flywheelLeft != null && hoodLeft != null) {
      Trigger crossOverrideTrigger = operator.povDown();

      // D-Pad Up/Down: same in normal and mirrored pit. Legacy pit keeps old preset behavior.
      operator
          .povUp()
          .onTrue(
              Commands.either(
                  Commands.parallel(
                      hoodLeft.setDegreesCommand(() -> Constants.ScorerConstants.kHoodMaxDegrees),
                      hoodRight.setDegreesCommand(() -> Constants.ScorerConstants.kHoodMaxDegrees)),
                  Commands.parallel(
                      hoodLeft.setDegreesCommand(() -> Constants.ScorerConstants.kHoodMaxDegrees),
                      hoodRight.setDegreesCommand(() -> Constants.ScorerConstants.kHoodMaxDegrees)),
                  this::isUsingLegacyPitOperatorMode));
      crossOverrideTrigger.whileTrue(buildCrossOverrideCommand());
      // Legacy pit: D-Pad Right = hoods to 25 deg, D-Pad Left = hoods to 20 deg
      operator
          .povRight()
          .onTrue(
              Commands.either(
                  Commands.parallel(
                      hoodLeft.setDegreesCommand(25.0), hoodRight.setDegreesCommand(25.0)),
                  Commands.none(),
                  this::isUsingLegacyPitOperatorMode));
      operator
          .povLeft()
          .onTrue(
              Commands.either(
                  Commands.parallel(
                      hoodLeft.setDegreesCommand(20.0), hoodRight.setDegreesCommand(20.0)),
                  Commands.none(),
                  this::isUsingLegacyPitOperatorMode));
    }
    // #endregion
  }
}
