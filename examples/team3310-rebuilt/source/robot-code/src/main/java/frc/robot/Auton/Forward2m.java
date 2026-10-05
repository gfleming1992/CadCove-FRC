package frc.robot.Auton;

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.geometry.Translation2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;
import edu.wpi.first.wpilibj2.command.Commands;
import frc.robot.RobotContainer;

/**
 * Drive forward a short distance relative to the robot's current pose. The path is generated at
 * runtime (when the InstantCommand runs) so it uses the robot's actual pose at the start of
 * autonomous instead of the pose at program startup.
 */
public class Forward2m extends AutonCommandBase {
  private static final double kTargetDistanceMeters = 2.0;
  private static final double kForwardSpeedMetersPerSecond = 1.0;
  private static final double kDistanceToleranceMeters = 0.05;
  private static final double kTimeoutSeconds = 10.0;

  public Forward2m(RobotContainer robotContainer) {
    super(robotContainer, (Pose2d) null);

    var drive = robotContainer.getDrive();
    Translation2d[] startTranslation = new Translation2d[] {Translation2d.kZero};
    Rotation2d[] startHeading = new Rotation2d[] {Rotation2d.kZero};

    // InstantCommand will run at the start of auto and schedule the generated follow-path
    // command. This avoids using the robot pose at program start.
    this.addCommands(
        Commands.runOnce(
            () -> {
              Pose2d startPose = drive.getPose();
              startTranslation[0] = startPose.getTranslation();
              startHeading[0] = startPose.getRotation();
            }),
        Commands.run(
                () -> {
                  Pose2d currentPose = drive.getPose();
                  Translation2d delta = currentPose.getTranslation().minus(startTranslation[0]);
                  Translation2d forwardAxis =
                      new Translation2d(startHeading[0].getCos(), startHeading[0].getSin());

                  double distanceTraveledMeters =
                      delta.getX() * forwardAxis.getX() + delta.getY() * forwardAxis.getY();
                  if (distanceTraveledMeters < kTargetDistanceMeters - kDistanceToleranceMeters) {
                    drive.runVelocity(new ChassisSpeeds(kForwardSpeedMetersPerSecond, 0.0, 0.0));
                  } else {
                    drive.stop();
                  }
                },
                drive)
            .until(
                () -> {
                  Translation2d delta = drive.getPose().getTranslation().minus(startTranslation[0]);
                  Translation2d forwardAxis =
                      new Translation2d(startHeading[0].getCos(), startHeading[0].getSin());
                  double distanceTraveledMeters =
                      delta.getX() * forwardAxis.getX() + delta.getY() * forwardAxis.getY();
                  return distanceTraveledMeters >= kTargetDistanceMeters - kDistanceToleranceMeters;
                })
            .withTimeout(kTimeoutSeconds)
            .finallyDo(interrupted -> drive.stop()));
  }
}
