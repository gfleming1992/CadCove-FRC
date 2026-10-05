package frc.robot.Auton;

import com.pathplanner.lib.path.PathPlannerPath;
import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.wpilibj.DriverStation.Alliance;
import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.Commands;
import edu.wpi.first.wpilibj2.command.InstantCommand;
import edu.wpi.first.wpilibj2.command.ParallelCommandGroup;
import edu.wpi.first.wpilibj2.command.ParallelDeadlineGroup;
import edu.wpi.first.wpilibj2.command.SequentialCommandGroup;
import edu.wpi.first.wpilibj2.command.WaitCommand;
import edu.wpi.first.wpilibj2.command.WaitUntilCommand;
import frc.lib.pathplanner.util.FlippingUtil;
import frc.lib.util.FieldConstants;
import frc.lib.util.FieldConstants.Zone;
import frc.robot.Constants;
import frc.robot.Robot;
import frc.robot.RobotContainer;
import java.util.function.DoubleSupplier;

/**
 * Container class for all autonomous commands. Automatically discovers and registers all public
 * Command methods for easy access.
 */
public class AutonCommandBase extends SequentialCommandGroup {
  private final RobotContainer robotContainer;
  private final Pose2d startingPose;

  public static boolean trenchCheckActive;
  public static boolean spinUp;
  public static boolean setShoot;
  public static boolean deployCheckActive;

  /**
   * Creates a new AutonCommandBase.
   *
   * @param robotContainer The robot container
   * @param startingPose The full starting pose of the robot, or null for no pose reset
   */
  protected AutonCommandBase(RobotContainer robotContainer, Pose2d startingPose) {
    this.robotContainer = robotContainer;
    this.startingPose = startingPose;
  }

  /**
   * Returns the starting pose adjusted for alliance (rotation flipped 180° on Red), or null if this
   * auto should run from wherever the robot currently is (no pose reset).
   */
  public Pose2d getStartingPose() {
    if (startingPose == null) return null;
    if (Robot.currentAlliance == Alliance.Red) {
      return FlippingUtil.flipFieldPose(startingPose);
    }
    return startingPose;
  }

  protected Command followPath(PathPlannerPath path) {
    return new FollowPathCommand(robotContainer.getDrive(), path);
  }

  /**
   * Returns a command that waits until both floor rollers are within {@link
   * Constants#kFlywheelRPMTolerance} RPM of the snowblow target speed (read live from the
   * SmartDashboard table via {@link Constants.AgitatorConstants#kFloorRollerSnowblowRPM}), then
   * immediately starts both vertical feed rollers at the aim-manager's desired feed RPM.
   *
   * <p>Falls back to a 3-second timeout so the auto never hangs indefinitely.
   */
  protected Command waitForSnowblowAtSpeed() {
    return new WaitUntilCommand(
            () -> {
              double target = Constants.AgitatorConstants.kFloorRollerSnowblowRPM;
              double tol = Constants.ScorerConstants.kFlywheelRPMTolerance;
              double leftErr =
                  Math.abs(robotContainer.getAgitatorLeft().getCurrentVelocity() - target);
              double rightErr =
                  Math.abs(robotContainer.getAgitatorRight().getCurrentVelocity() - target);
              return leftErr < tol && rightErr < tol;
            })
        .withTimeout(3.0)
        .andThen(
            Commands.runOnce(
                () -> {
                  java.util.function.DoubleSupplier leftFeedRpm =
                      robotContainer.getTurretAimManager()::getLeftVerticalFeedRPM;
                  java.util.function.DoubleSupplier rightFeedRpm =
                      robotContainer.getTurretAimManager()::getRightVerticalFeedRPM;
                  edu.wpi.first.wpilibj2.command.CommandScheduler.getInstance()
                      .schedule(robotContainer.getVerticalFeedLeft().setRPMCommand(leftFeedRpm));
                  edu.wpi.first.wpilibj2.command.CommandScheduler.getInstance()
                      .schedule(robotContainer.getVerticalFeedRight().setRPMCommand(rightFeedRpm));
                }))
        .withName("WaitForSnowblowAtSpeed");
  }

  protected Command followPathAndSnowblow(PathPlannerPath path) {
    return new ParallelDeadlineGroup(followPath(path), robotContainer.buildAutoSnowblowCommand());
  }

  protected Command followPathAndCollectThenShoot(PathPlannerPath path) {
    return new SequentialCommandGroup(
        new ParallelDeadlineGroup(
            followPath(path),
            new SequentialCommandGroup(
                new WaitUntilCommand(this::hasCrossedDeployLine),
                new InstantCommand(() -> deployCheckActive = false),
                new ParallelDeadlineGroup(
                    new WaitUntilCommand(this::hasCrossedAllianceTrenchCenterline),
                    deployAndIntake()))),
        shoot());
  }

  /**
   * Like {@link #followPathAndCollectThenShoot} but deploys the intake immediately at path start
   * instead of waiting for the deploy line. Use this for the first path in an auto that starts
   * inside the trench zone, where the normal deploy-line and trench-deadline conditions would fire
   * too early due to the robot's starting position.
   */
  protected Command followPathDeployImmediatelyAndCollectThenShoot(PathPlannerPath path) {
    return new SequentialCommandGroup(
        new ParallelDeadlineGroup(followPath(path), deployAndIntake()), shoot());
  }

  // #endregion

  // #region Helpers

  @SuppressWarnings("unused")
  private Command spinUp() {
    return new SequentialCommandGroup(
        new WaitUntilCommand(this::hasCrossedAllianceShootline),
        new InstantCommand(() -> spinUp = true),
        flywheelsOn(),
        waitForFlywheelsAtSpeed());
  }

  private Command deployAndIntake() {
    return new ParallelDeadlineGroup(
            robotContainer
                .getIntakePivot()
                .motionMagicSetpointCommandBlocking(
                    () -> Constants.IntakeConstants.kIntakePivotDeployDegrees, 2.0)
                .asProxy(),
            robotContainer.getIntakeRollers().deployCommand().asProxy())
        .andThen(robotContainer.getIntakeRollers().intakeCommand().asProxy());
  }

  private Command shoot() {
    return new SequentialCommandGroup(
        new WaitUntilCommand(this::hasCrossedAllianceTrenchCenterline),
        new InstantCommand(() -> trenchCheckActive = false),
        shootStart(),
        shootAndWait(),
        shootEnd());
  }

  private Command shootStart() {
    return new InstantCommand(() -> Robot.shootButtonHeld = true);
  }

  private Command shootEnd() {
    return new InstantCommand(() -> Robot.shootButtonHeld = false);
  }

  /**
   * Returns a command that continuously tracks TurretAimManager flywheel RPM targets. Use as a
   * parallel command alongside the entire auto sequence so the flywheels stay spun up for the full
   * autonomous period. Uses asProxy() so flywheel subsystem requirements don't propagate to the
   * parent command group.
   */
  protected Command flywheelsOn() {
    DoubleSupplier leftTargetRpm = robotContainer.getTurretAimManager()::getLeftFlywheelRPM;
    DoubleSupplier rightTargetRpm = robotContainer.getTurretAimManager()::getRightFlywheelRPM;
    // Use asProxy() so flywheel subsystem requirements don't propagate to the
    // parent SequentialCommandGroup (which also contains followPath).  Without
    // this, the whole group claims Drive + Flywheels + Agitators etc., and the
    // state-machine's collect() scheduling on those subsystems cancels the
    // entire group — killing path-following after ~1 cm.
    return new ParallelCommandGroup(
            robotContainer.getFlywheelLeft().setRPMCommand(leftTargetRpm).asProxy(),
            robotContainer.getFlywheelRight().setRPMCommand(rightTargetRpm).asProxy())
        .until(() -> false);
  }

  private Command shootAndWait() {
    DoubleSupplier leftVerticalFeedTargetRpm =
        robotContainer.getTurretAimManager()::getLeftVerticalFeedRPM;
    DoubleSupplier rightVerticalFeedTargetRpm =
        robotContainer.getTurretAimManager()::getRightVerticalFeedRPM;
    // Hold floor/vertical-feed requirements directly during the shoot window so
    // another command can't preempt these rollers off mid-shot.
    // Use ParallelDeadlineGroup with a WaitCommand as the deadline so the
    // never-ending velocity commands are interrupted after 3 seconds and the
    // sequence can continue to the next step.
    return new ParallelDeadlineGroup(
        new WaitCommand(3.0),
        new SequentialCommandGroup(
            new ParallelCommandGroup(
                robotContainer.getAgitatorLeft().snowblowCommand(),
                // Right floor roller now follows the left floor roller.
                // Keep the old direct command commented out so follower mode is not overridden.
                // robotContainer.getAgitatorRight().snowblowCommand().asProxy(),
                robotContainer.getVerticalFeedLeft().setRPMCommand(leftVerticalFeedTargetRpm),
                robotContainer.getVerticalFeedRight().setRPMCommand(rightVerticalFeedTargetRpm)),
            new InstantCommand(() -> setShoot = true)));
  }

  // #endregion

  // #region Auto Conditions
  private boolean hasCrossedAllianceShootline() {
    double robotX = robotContainer.getDrive().getPose().getX();
    double trenchMidSideLine =
        Robot.getEffectiveAlliance() == Alliance.Blue
            ? FieldConstants.kBlueShootLine
            : FieldConstants.kRedShootLine;

    return Robot.getEffectiveAlliance() == Alliance.Blue
        ? robotX < trenchMidSideLine
        : robotX > trenchMidSideLine;
  }

  private boolean hasCrossedAllianceTrenchCenterline() {
    double robotX = robotContainer.getDrive().getPose().getX();
    trenchCheckActive = true;
    double trenchCenterLine =
        Robot.getEffectiveAlliance() == Alliance.Blue
            ? FieldConstants.kBlueTrenchCenterLine
            : FieldConstants.kRedTrenchCenterLine;

    return Robot.getEffectiveAlliance() == Alliance.Blue
        ? robotX < trenchCenterLine
        : robotX > trenchCenterLine;
  }

  private boolean hasCrossedDeployLine() {
    deployCheckActive = true;
    double robotX = robotContainer.getDrive().getPose().getX();
    double deployLine =
        Robot.getEffectiveAlliance() == Alliance.Blue
            ? FieldConstants.kBlueShootLine
            : FieldConstants.kRedShootLine;

    return Robot.getEffectiveAlliance() == Alliance.Blue
        ? robotX > deployLine
        : robotX < deployLine;
  }

  /**
   * Returns a command that waits until the robot is in its home alliance zone AND at least one
   * flywheel is within {@link Constants.ScorerConstants#kFlywheelRPMTolerance} of its target. A
   * single flywheel being ready is sufficient — waiting for both risks blocking forever if one
   * motor has an issue.
   *
   * <p>Falls back to a 3-second timeout so the auto never hangs indefinitely.
   */
  protected Command waitForFlywheelsAtSpeed() {
    return new WaitUntilCommand(
            () -> {
              // Confirm the robot is in its home alliance zone before shooting.
              boolean inHomeZone =
                  Robot.currentAlliance == Alliance.Blue
                      ? Robot.currentZone == Zone.BLUE
                      : Robot.currentZone == Zone.RED;

              double tolRPM = Constants.ScorerConstants.kFlywheelRPMTolerance;
              double leftTarget = robotContainer.getTurretAimManager().getLeftFlywheelRPM();
              double rightTarget = robotContainer.getTurretAimManager().getRightFlywheelRPM();
              double leftErr =
                  Math.abs(robotContainer.getFlywheelLeft().getCurrentVelocity() - leftTarget);
              double rightErr =
                  Math.abs(robotContainer.getFlywheelRight().getCurrentVelocity() - rightTarget);
              return inHomeZone && (leftErr < tolRPM || rightErr < tolRPM);
            })
        .withTimeout(3.0)
        .withName("WaitForFlywheelsAtSpeed");
  }
  // #endregion
}
