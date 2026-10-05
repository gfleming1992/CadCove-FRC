package frc.robot.util;

import org.littletonrobotics.junction.LogDataReceiver;
import org.littletonrobotics.junction.LogTable;

/**
 * Wraps an {@link LogDataReceiver} (typically {@link
 * org.littletonrobotics.junction.networktables.NT4Publisher}) so that {@link #putTable} only
 * forwards data every <em>N</em>th cycle. This dramatically reduces the amount of work
 * SmartDashboard.updateValues() must do each loop iteration because fewer NT4 entries change per
 * tick.
 *
 * <p>The underlying .wpilog file remains at full rate because it uses a separate {@code
 * WPILOGWriter} data receiver that is <b>not</b> wrapped.
 *
 * <p><b>Important:</b> AdvantageKit calls {@code putTable} from its own receiver thread, so the
 * counter is only accessed from that single thread and does not need synchronization.
 */
public class ThrottledDataReceiver implements LogDataReceiver {
  private final LogDataReceiver inner;
  private final int period;
  private int counter;

  /**
   * Creates a new ThrottledDataReceiver.
   *
   * @param inner The real data receiver to delegate to (e.g. {@code new NT4Publisher()}).
   * @param period Forward every Nth call to {@link #putTable}. A value of 3 at a 50 Hz loop gives
   *     ~16 Hz live data; a value of 5 gives ~10 Hz.
   */
  public ThrottledDataReceiver(LogDataReceiver inner, int period) {
    if (period < 1) {
      throw new IllegalArgumentException("period must be >= 1, got " + period);
    }
    this.inner = inner;
    this.period = period;
    this.counter = 0;
  }

  @Override
  public void start() {
    inner.start();
  }

  @Override
  public void end() {
    inner.end();
  }

  @Override
  public void putTable(LogTable table) throws InterruptedException {
    counter++;
    if (counter >= period) {
      counter = 0;
      inner.putTable(table);
    }
  }
}
