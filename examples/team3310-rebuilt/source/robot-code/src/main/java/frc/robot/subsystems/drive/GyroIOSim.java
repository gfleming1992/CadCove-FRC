package frc.robot.subsystems.drive;

import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;
import edu.wpi.first.wpilibj.Timer;
import frc.robot.Constants.SimPhysicsConstants;
import java.util.Random;

/**
 * Simulated gyro IO that derives its yaw from the measured chassis speeds fed by Drive. In the real
 * robot, the Pigeon2 provides this; in sim we integrate omega from kinematics. Optional Gaussian
 * noise can be added to mimic real sensor drift.
 */
public class GyroIOSim implements GyroIO {
  private double yawRad = 0.0;
  private double yawVelocityRadPerSec = 0.0;
  private final Random noiseRng = new Random(42);

  /**
   * Called by Drive every cycle to push the latest measured chassis speeds into the sim gyro. This
   * must be called BEFORE updateInputs() each cycle.
   */
  public void updateFromChassisSpeeds(ChassisSpeeds measured, double dtSeconds) {
    yawVelocityRadPerSec = measured.omegaRadiansPerSecond;
    double noise =
        Math.toRadians(SimPhysicsConstants.kGyroNoiseDegPerSec) * noiseRng.nextGaussian();
    yawRad += (yawVelocityRadPerSec + noise) * dtSeconds;
  }

  /** Allows Drive to reset the sim gyro heading (e.g. on setPose). */
  public void setYaw(Rotation2d newYaw) {
    yawRad = newYaw.getRadians();
  }

  @Override
  public void updateInputs(GyroIOInputs inputs) {
    inputs.connected = true;
    inputs.yawPosition = new Rotation2d(yawRad);
    inputs.yawVelocityRadPerSec = yawVelocityRadPerSec;

    // Provide one sample per cycle at 50 Hz (high-frequency odometry is
    // unnecessary in sim)
    inputs.odometryYawTimestamps = new double[] {Timer.getFPGATimestamp()};
    inputs.odometryYawPositions = new Rotation2d[] {new Rotation2d(yawRad)};
  }
}
