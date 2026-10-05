package org.instantcad.frc;
public final class GameplayPacingTest {
 public static void main(String[] args){
  final long ms=1_000_000;
  GameplayPacing p=new GameplayPacing(5*ms);
  if(p.afterStep(0,50*ms)!=0)throw new AssertionError("Slow step cannot add waiting");
  if(p.afterStep(50*ms,51*ms)!=4*ms)throw new AssertionError("A slow tick cannot create unbounded catch-up debt");
  p=new GameplayPacing(10*ms);
  if(p.afterStep(0,3*ms)!=7*ms)throw new AssertionError("Respect selected timestep");
  // Scheduler wakes 2 ms late every time. It must correct that small jitter,
  // not turn a 10 ms simulation tick into 12 ms forever.
  if(p.afterStep(12*ms,15*ms)!=5*ms)throw new AssertionError("Timer jitter accumulated");
  if(p.afterStep(22*ms,25*ms)!=5*ms)throw new AssertionError("Deadline lost its cadence");
  if(p.afterStep(32*ms,150*ms)!=0)throw new AssertionError("Overload should rebase deadline");
  if(p.afterStep(150*ms,153*ms)!=7*ms)throw new AssertionError("Fast-forward after overload");
  System.out.println("Gameplay pacing: stable cadence, bounded jitter correction, no accumulated catch-up burst");
 }
}
