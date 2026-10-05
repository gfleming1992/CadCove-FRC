// Copyright (c) 2025 FRC 6328
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by an MIT-style
// license that can be found in the LICENSE file at
// the root directory of this project.

package frc.lib.util;

import edu.wpi.first.math.geometry.*;
import edu.wpi.first.math.util.Units;

/**
 * Contains various field dimensions and useful reference points. All units are in meters and poses
 * have a blue alliance origin.
 */
public class FieldConstants {
  public static final double kFieldLength = Units.inchesToMeters(649.5);
  public static final double kFieldWidth = Units.inchesToMeters(318.0);

  public static final double kBlueTrenchMidSideLine = Units.inchesToMeters(158.25);
  public static final double kBlueTrenchCenterLine = Units.inchesToMeters(181.5);
  public static final double kBlueTrenchHomeSideLine = Units.inchesToMeters(111.75);

  public static final double kRedTrenchMidSideLine =
      Units.inchesToMeters(kFieldLength - kBlueTrenchMidSideLine);
  public static final double kRedTrenchCenterLine =
      Units.inchesToMeters(kFieldLength - kBlueTrenchCenterLine);
  public static final double kRedTrenchHomeSideLine =
      Units.inchesToMeters(kFieldLength - kBlueTrenchHomeSideLine);

  public static final double kBlueShootLine = Units.inchesToMeters(245.0);
  public static final double kRedShootLine = Units.inchesToMeters(kFieldLength - 245.0);

  // Bias (meters) that shifts the DEP-vs-OUT decision line in pass mode.
  // Positive = prefer DEP; the robot must be farther toward the OUT side
  // before it switches to aiming at OUT.  0 = equal (pure midpoint).
  public static final double kMidBiasMeters = Units.inchesToMeters(24.0); // ~0.6 m

  public static enum StartingPosition { // measured with sim
    BLUEDEPHOME(new Translation2d(3.570, 7.499)),
    BLUEDEPMID(new Translation2d(4.445, 7.555)),
    BLUEHUB(new Translation2d(3.570, 3.977)),
    BLUEOUTHOME(new Translation2d(3.750, 0.607)),
    BLUEOUTMID(new Translation2d(4.433, 0.527)),

    REDDEPHOME(new Translation2d(13.0, 0.841)),
    REDDEPMID(new Translation2d(12.201, 0.841)),
    REDHUB(new Translation2d(13.0, 3.977)),
    REDOUTHOME(new Translation2d(13.0, 7.247)),
    REDOUTMID(new Translation2d(12.201, 7.247));

    private Translation2d translation;

    private StartingPosition(Translation2d translation) {
      this.translation = translation;
    }

    public Translation2d getTranslation() {
      return translation;
    }
  }

  public static enum
      LandingZone { // landing zones of where we want the balls to land when passing (little bit out
    // from
    // corner)
    BLUEOUT(new Translation2d(Units.inchesToMeters(96.0), Units.inchesToMeters(80.0))),
    BLUEDEP(new Translation2d(Units.inchesToMeters(96.0), Units.inchesToMeters(238.0))),
    BLUEMID(new Translation2d(Units.inchesToMeters(96.0), Units.inchesToMeters(159))),
    REDOUT(
        new Translation2d(kFieldLength - Units.inchesToMeters(96.0), Units.inchesToMeters(238.5))),
    REDDEP(
        new Translation2d(kFieldLength - Units.inchesToMeters(96.0), Units.inchesToMeters(79.5))),
    REDMID(new Translation2d(kFieldLength - Units.inchesToMeters(96.0), Units.inchesToMeters(159)));
    private final double x;
    private final double y;

    private LandingZone(Translation2d translation) {
      this.x = translation.getX();
      this.y = translation.getY();
    }

    public double getX() {
      return x;
    }

    public double getY() {
      return y;
    }
  }

  public static enum Zone { // Zones of field where x is where it ends
    BLUE(Units.inchesToMeters(192.25)),
    MID(Units.inchesToMeters(469.0)),
    RED(kFieldLength);

    private final double x;

    private Zone(double x) {
      this.x = x;
    }

    public double getX() {
      return x;
    }
  }

  public static enum Hub { // scoring hubs on both sides
    BLUE(
        new Translation3d(
            Units.inchesToMeters(182.0), Units.inchesToMeters(159.0), Units.inchesToMeters(72.0))),
    RED(
        new Translation3d(
            Units.inchesToMeters(469.0), Units.inchesToMeters(159.0), Units.inchesToMeters(72.0)));

    private final double x;
    private final double y;
    private final double z;

    private Hub(Translation3d translation) {
      this.x = translation.getX();
      this.y = translation.getY();
      this.z = translation.getZ();
    }

    public double getX() {
      return x;
    }

    public double getY() {
      return y;
    }

    public double getZ() {
      return z;
    }
  }

  // #region 2025
  // HACK:dofjoiaa
  //   public static class Processor {
  //     public static final Pose2d centerFace =
  //         new Pose2d(Units.inchesToMeters(235.726), 0, Rotation2d.fromDegrees(90));
  //   }

  //   public static class Barge {
  //     public static final Translation2d farCage =
  //         new Translation2d(Units.inchesToMeters(345.428), Units.inchesToMeters(286.779));
  //     public static final Translation2d middleCage =
  //         new Translation2d(Units.inchesToMeters(345.428), Units.inchesToMeters(242.855));
  //     public static final Translation2d closeCage =
  //         new Translation2d(Units.inchesToMeters(345.428), Units.inchesToMeters(199.947));

  //     // Measured from floor to bottom of cage
  //     public static final double deepHeight = Units.inchesToMeters(3.125);
  //     public static final double shallowHeight = Units.inchesToMeters(30.125);
  //   }

  //   public static class CoralStation {
  //     public static final Pose2d leftCenterFace =
  //         new Pose2d(
  //             Units.inchesToMeters(33.526),
  //             Units.inchesToMeters(291.176),
  //             Rotation2d.fromDegrees(90 - 144.011));
  //     public static final Pose2d rightCenterFace =
  //         new Pose2d(
  //             Units.inchesToMeters(33.526),
  //             Units.inchesToMeters(25.824),
  //             Rotation2d.fromDegrees(144.011 - 90));
  //   }

  //   @SuppressWarnings("unchecked")
  //   public static class Reef {
  //     public static final Translation2d center =
  //         new Translation2d(Units.inchesToMeters(176.746), Units.inchesToMeters(158.501));
  //     public static final double faceToZoneLine =
  //         Units.inchesToMeters(12); // Side of the reef to the inside of the reef zone line

  //     public static final Pose2d[] centerFaces =
  //         new Pose2d[6]; // Starting facing the driver station in clockwise order
  //     public static final List<Map<ReefHeight, Pose3d>> branchPositions =
  //         new ArrayList<>(); // Starting at the right branch facing the driver station in
  //     // clockwise
  //     public static final List<Map<ReefHeight, Pose3d>> branchTipPositions =
  //         new ArrayList<>(); // Starting at the right branch facing the driver station in

  //     // clockwise

  //     static {
  //       // Initialize faces
  //       centerFaces[0] =
  //           new Pose2d(
  //               Units.inchesToMeters(144.003),
  //               Units.inchesToMeters(158.500),
  //               Rotation2d.fromDegrees(180));
  //       centerFaces[1] =
  //           new Pose2d(
  //               Units.inchesToMeters(160.373),
  //               Units.inchesToMeters(186.857),
  //               Rotation2d.fromDegrees(120));
  //       centerFaces[2] =
  //           new Pose2d(
  //               Units.inchesToMeters(193.116),
  //               Units.inchesToMeters(186.858),
  //               Rotation2d.fromDegrees(60));
  //       centerFaces[3] =
  //           new Pose2d(
  //               Units.inchesToMeters(209.489),
  //               Units.inchesToMeters(158.502),
  //               Rotation2d.fromDegrees(0));
  //       centerFaces[4] =
  //           new Pose2d(
  //               Units.inchesToMeters(193.118),
  //               Units.inchesToMeters(130.145),
  //               Rotation2d.fromDegrees(-60));
  //       centerFaces[5] =
  //           new Pose2d(
  //               Units.inchesToMeters(160.375),
  //               Units.inchesToMeters(130.144),
  //               Rotation2d.fromDegrees(-120));

  //       // Initialize branch positions
  //       for (int face = 0; face < 6; face++) {
  //         Map<ReefHeight, Pose3d> fillRight = new HashMap<>();
  //         Map<ReefHeight, Pose3d> fillLeft = new HashMap<>();
  //         for (var level : ReefHeight.values()) {
  //           Pose2d poseDirection = new Pose2d(center, Rotation2d.fromDegrees(180 - (60 * face)));
  //           double adjustX = Units.inchesToMeters(30.738);
  //           double adjustY = Units.inchesToMeters(6.469);

  //           fillRight.put(
  //               level,
  //               new Pose3d(
  //                   new Translation3d(
  //                       poseDirection
  //                           .transformBy(new Transform2d(adjustX, adjustY, new Rotation2d()))
  //                           .getX(),
  //                       poseDirection
  //                           .transformBy(new Transform2d(adjustX, adjustY, new Rotation2d()))
  //                           .getY(),
  //                       level.height),
  //                   new Rotation3d(
  //                       0,
  //                       Units.degreesToRadians(level.pitch),
  //                       poseDirection.getRotation().getRadians())));
  //           fillLeft.put(
  //               level,
  //               new Pose3d(
  //                   new Translation3d(
  //                       poseDirection
  //                           .transformBy(new Transform2d(adjustX, -adjustY, new Rotation2d()))
  //                           .getX(),
  //                       poseDirection
  //                           .transformBy(new Transform2d(adjustX, -adjustY, new Rotation2d()))
  //                           .getY(),
  //                       level.height),
  //                   new Rotation3d(
  //                       0,
  //                       Units.degreesToRadians(level.pitch),
  //                       poseDirection.getRotation().getRadians())));
  //         }
  //         branchPositions.add(fillRight);
  //         branchPositions.add(fillLeft);
  //       }

  //       // Mirror for red alliance
  //       for (Map<ReefHeight, Pose3d> blueBranch : branchPositions.toArray(new Map[0])) {
  //         Map<ReefHeight, Pose3d> redBranch = new HashMap<>();
  //         for (Map.Entry<ReefHeight, Pose3d> entry : blueBranch.entrySet()) {
  //           Pose3d bluePose = entry.getValue();
  //           redBranch.put(
  //               entry.getKey(),
  //               new Pose3d(
  //                   Util.flipRedBlue(
  //                       new Translation3d(bluePose.getX(), bluePose.getY(), bluePose.getZ())),
  //                   new Rotation3d(
  //                       0, -bluePose.getRotation().getY(), -bluePose.getRotation().getZ())));
  //         }
  //         branchPositions.add(redBranch);
  //       }
  //       for (int face = 0; face < 6; face++) {
  //         Map<ReefHeight, Pose3d> fillRight = new HashMap<>();
  //         Map<ReefHeight, Pose3d> fillLeft = new HashMap<>();
  //         for (var level : ReefHeight.values()) {
  //           Pose2d poseDirection = new Pose2d(center, Rotation2d.fromDegrees(180 - (60 * face)));
  //           double adjustX = Units.inchesToMeters(-2);
  //           double adjustY = Units.inchesToMeters(6.469);

  //           fillRight.put(
  //               level,
  //               new Pose3d(
  //                   new Translation3d(
  //                       poseDirection
  //                           .transformBy(new Transform2d(adjustX, adjustY, new Rotation2d()))
  //                           .getX(),
  //                       poseDirection
  //                           .transformBy(new Transform2d(adjustX, adjustY, new Rotation2d()))
  //                           .getY(),
  //                       level.height),
  //                   new Rotation3d(
  //                       0,
  //                       Units.degreesToRadians(level.pitch),
  //                       poseDirection.getRotation().getRadians())));
  //           fillLeft.put(
  //               level,
  //               new Pose3d(
  //                   new Translation3d(
  //                       poseDirection
  //                           .transformBy(new Transform2d(adjustX, -adjustY, new Rotation2d()))
  //                           .getX(),
  //                       poseDirection
  //                           .transformBy(new Transform2d(adjustX, -adjustY, new Rotation2d()))
  //                           .getY(),
  //                       level.height),
  //                   new Rotation3d(
  //                       0,
  //                       Units.degreesToRadians(level.pitch),
  //                       poseDirection.getRotation().getRadians())));
  //         }
  //         branchTipPositions.add(fillRight);
  //         branchTipPositions.add(fillLeft);
  //       }
  //     }
  //   }

  //   public static class StagingPositions {
  //     // Measured from the center of the ice cream
  //     public static final Pose2d leftIceCream =
  //         new Pose2d(Units.inchesToMeters(48), Units.inchesToMeters(230.5), new Rotation2d());
  //     public static final Pose2d middleIceCream =
  //         new Pose2d(Units.inchesToMeters(48), Units.inchesToMeters(170.5), new Rotation2d());
  //     public static final Pose2d rightIceCream =
  //         new Pose2d(Units.inchesToMeters(48), Units.inchesToMeters(86.5), new Rotation2d());
  //   }

  //   public static class HPIntake {
  //     // HP Intake positions for blue alliance
  //     public static final Pose2d kStationA =
  //         new Pose2d(
  //             new Translation2d(0.7571420669555664, 0.6461422443389893), new Rotation2d(Math.PI /
  // 4));

  //     public static final Pose2d kStationB =
  //         new Pose2d(
  //             new Translation2d(0.7571420669555664, 7.364640235900879), new Rotation2d(-Math.PI /
  // 4));
  //   }

  //   public enum ReefHeight {
  //     L4(Units.inchesToMeters(72), -90),
  //     L3(Units.inchesToMeters(47.625), -35),
  //     L2(Units.inchesToMeters(31.875), -35),
  //     L1(Units.inchesToMeters(18), 0);

  //     ReefHeight(double height, double pitch) {
  //       this.height = height;
  //       this.pitch = pitch; // in degrees
  //     }

  //     public final double height;
  //     public final double pitch;
  //   }

  //   public enum BranchCode {
  //     A(0),
  //     B(1),
  //     C(2),
  //     D(3),
  //     E(4),
  //     F(5),
  //     G(6),
  //     H(7),
  //     L(8);

  //     BranchCode(int indexOffset) {
  //       this.indexOffset = indexOffset;
  //     }

  //     public final int indexOffset;
  //   }
  // #endregion
}
