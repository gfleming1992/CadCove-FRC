package org.instantcad.frc;

/** Keeps normal timer jitter from accumulating, but never retains more than
 * one physics tick of wall-clock debt. Physical steps are never skipped. */
final class GameplayPacing {
  private final long period;
  private long deadline;
  private boolean initialized;
  GameplayPacing(long periodNanos){
    if(periodNanos<=0)throw new IllegalArgumentException("Positive tick period required");
    period=periodNanos;
  }
  long afterStep(long startedNanos,long finishedNanos){
    if(!initialized){deadline=startedNanos;initialized=true;}
    deadline+=period;
    // Drop wall-clock debt after overload; retain at most one tick of jitter
    // correction. Neither robot time nor physics time skips a step.
    if(finishedNanos-deadline>period)deadline=finishedNanos;
    return Math.max(0L,deadline-finishedNanos);
  }
}
