package org.instantcad.frc;

import com.ctre.phoenix6.Utils;
import com.ctre.phoenix6.unmanaged.Unmanaged;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;

/** Keep Phoenix's wall-clock lease aligned with a paused FPGA simulation clock.
 * This changes no motor command and is never available on a real robot. */
public final class PhoenixSimulationEnable implements AutoCloseable {
  private final BooleanSupplier allowed;
  private final ScheduledExecutorService timer;
  private boolean closed;

  public PhoenixSimulationEnable(BooleanSupplier allowed) {
    if(!Utils.isSimulation())throw new IllegalStateException("Phoenix enable heartbeat requires simulation");
    this.allowed=allowed;
    timer=Executors.newSingleThreadScheduledExecutor(r->{
      Thread t=new Thread(r,"TwinPhoenixEnable");t.setDaemon(true);return t;
    });
    timer.scheduleAtFixedRate(this::refresh,0,20,TimeUnit.MILLISECONDS);
  }
  private synchronized void refresh() {
    if(closed)return;
    boolean enabled=false;
    try {enabled=allowed.getAsBoolean();}catch(RuntimeException ignored){/* Fail closed. */}
    Unmanaged.feedEnable(enabled?100:0);
  }
  @Override public synchronized void close() {
    closed=true;timer.shutdownNow();Unmanaged.feedEnable(0);
  }
}
