package org.instantcad.frc;

/** Simulation-only, bounded calibration knobs. Never alters a hardware shot table. */
public final class ShotTuning {
  private ShotTuning() {}
  // Close-range practice calibration: six- and twelve-ball successful trials.
  // This is simulator calibration, not a replacement hardware characterization.
  public static final double RPM_SCALE = value("INSTANTCAD_SHOT_RPM_SCALE", 1.035, .8, 1.25);
  public static final double HOOD_OFFSET = value("INSTANTCAD_SHOT_HOOD_OFFSET", 1, -5, 5);
  public static final double FEED_SCALE = value("INSTANTCAD_SHOT_FEED_SCALE", 1, .5, 1.5);
  private static double value(String name, double fallback, double min, double max) {
    if (!TwinBridge.enabled()) return fallback;
    String raw = System.getenv(name);
    if (raw == null) return fallback;
    double result = Double.parseDouble(raw);
    if (!Double.isFinite(result) || result < min || result > max)
      throw new IllegalArgumentException(name + " outside simulation calibration bounds");
    return result;
  }
}
