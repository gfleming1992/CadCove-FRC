package org.instantcad.frc;

import java.nio.file.*;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Real process-tree regression; does not load HAL, Phoenix, or a team robot. */
public final class LauncherWatchTest {
  private static ProcessBuilder command(String mode,Path directory){
    String executable=System.getProperty("os.name").startsWith("Windows")?"java.exe":"java";
    return new ProcessBuilder(Path.of(System.getProperty("java.home"),"bin",executable).toString(),
      "-cp",System.getProperty("java.class.path"),LauncherWatchTest.class.getName(),mode,directory.toString());
  }
  public static void main(String[] args)throws Exception{
    if(args.length>0){
      Path directory=Path.of(args[1]);
      if(args[0].equals("launcher")){
        ProcessBuilder child=command("robot",directory).inheritIO();
        var env=child.environment();
        env.put("CADCOVE_SESSION_FILE",directory.resolve("session.json").toString());
        env.put("CADCOVE_SESSION_TOKEN","a".repeat(64));env.put("CADCOVE_SESSION_OWNER",UUID.randomUUID().toString());
        env.put("INSTANTCAD_PROJECT",directory.resolve("robot.sim.json").toString());env.put("CADCOVE_PROJECT_ID","owner-test");
        env.put("CADCOVE_LAUNCHER_PID",Long.toString(ProcessHandle.current().pid()));
        Process robot=child.start();Files.writeString(directory.resolve("robot-pid"),Long.toString(robot.pid()));
      }else{
        ManagedSession session=ManagedSession.fromEnvironment();
        session.watchLauncher(()->{
          try{Files.writeString(directory.resolve("owner-lost"),"observed");}catch(java.io.IOException e){e.printStackTrace();}
          System.exit(0);
        });
        session.publish(12345,UUID.randomUUID().toString(),"b".repeat(64));
        Files.writeString(directory.resolve("ready"),Long.toString(session.launcherPid));
      }
      Thread.sleep(60000);throw new AssertionError("Orphan fixture outlived its test");
    }
    Path directory=Files.createTempDirectory("cadcove-launcher-watch-");
    Process launcher=null;ProcessHandle robot=null;
    try{
      AtomicBoolean lost=new AtomicBoolean();
      ManagedSession wrong=new ManagedSession(directory.resolve("wrong.json"),"a".repeat(64),UUID.randomUUID().toString(),"/project","test",ProcessHandle.current().pid());
      try{wrong.watchLauncher(()->lost.set(true));throw new AssertionError("Non-parent PID accepted");}
      catch(IllegalStateException expected){if(!lost.get())throw new AssertionError("Lost owner was not reported");}
      launcher=command("launcher",directory).redirectErrorStream(true).start();
      long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
      while(!Files.exists(directory.resolve("ready"))&&System.nanoTime()<deadline&&launcher.isAlive())Thread.sleep(20);
      if(!Files.exists(directory.resolve("ready")))throw new AssertionError("Robot fixture did not become ready");
      if(!Files.readString(directory.resolve("ready")).equals(Long.toString(launcher.pid())))throw new AssertionError("Wrong launcher identity");
      robot=ProcessHandle.of(Long.parseLong(Files.readString(directory.resolve("robot-pid")))).orElseThrow();
      Thread.sleep(200);if(!robot.isAlive())throw new AssertionError("Robot stopped while its launcher was alive");
      var robotExit=robot.onExit();
      launcher.destroyForcibly();if(!launcher.waitFor(5,TimeUnit.SECONDS))throw new AssertionError("Launcher did not die");
      robotExit.get(10,TimeUnit.SECONDS);
      if(!Files.exists(directory.resolve("owner-lost")))throw new AssertionError("Robot exited without its owner-loss callback");
      System.out.println("Launcher death: live-parent continuity, wrong-parent rejection, and orphan shutdown passed");
    }finally{
      if(launcher!=null&&launcher.isAlive())launcher.destroyForcibly();
      if(robot!=null&&robot.isAlive())robot.destroyForcibly();
      try(var files=Files.list(directory)){for(Path file:files.toList())Files.deleteIfExists(file);}
      Files.deleteIfExists(directory);
    }
  }
}
