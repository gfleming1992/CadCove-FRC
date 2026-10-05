package org.instantcad.frc;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import edu.wpi.first.hal.HAL;
import edu.wpi.first.networktables.*;
import edu.wpi.first.wpilibj.Timer;
import edu.wpi.first.wpilibj.simulation.SimHooks;
import frc.lib.limelight.LimelightHelpers;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

public final class SimVisionTest {
  static final ObjectMapper JSON=new ObjectMapper();
  static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
  static void near(double a,double b,double tolerance,String message){check(Math.abs(a-b)<tolerance,message+": "+a+" vs "+b);}
  public static void main(String[] args)throws Exception {
    HAL.initialize(500,0);SimHooks.pauseTiming();
    var nt=NetworkTableInstance.getDefault();nt.startLocal();
    String name="limelight-test";
    ObjectNode world=(ObjectNode)JSON.readTree("""
      {"bodies":[{"id":"robot"}],"field_tags":{"tags":[
        {"id":1,"position":[2,0,1],"referencePosition":[2,0,1],"quaternion":[0,0,1,0]},
        {"id":2,"position":[-2,0,1],"referencePosition":[-2,0,1],"quaternion":[0,0,0,1]},
        {"id":3,"position":[2,3,1],"referencePosition":[2,3,1],"quaternion":[0,0,1,0]},
        {"id":4,"position":[20,0,1],"referencePosition":[20,0,1],"quaternion":[0,0,1,0]},
        {"id":5,"position":[3,0,1],"referencePosition":[3,0,1],"quaternion":[0,0,0,1]}
      ]},"vision":{"seed":123,"tagSizeMetres":0.1651,"cameras":[{
        "name":"limelight-test","body":"robot","position":[0,0,0],"rotationDegrees":[0,0,0],
        "framesPerSecond":10,"latencyMs":40,"xyStdDevAt2m":0.02,"yawStdDevDegreesAt2m":1.5
      }]}}
      """);
    // Reject coerced text values and fractional/overflowing identities before publishing.
    for(String field:new String[]{"framesPerSecond","latencyMs"}){
      var invalid=world.deepCopy();((ObjectNode)invalid.path("vision").path("cameras").get(0)).put(field,"30");
      try(var ignored=new SimVision(invalid,nt)){throw new AssertionError("Accepted text "+field);}catch(IllegalArgumentException expected){}
    }
    var invalidSeed=world.deepCopy();((ObjectNode)invalidSeed.path("vision")).put("seed",1.5);
    try(var ignored=new SimVision(invalidSeed,nt)){throw new AssertionError("Accepted fractional seed");}catch(IllegalArgumentException expected){}
    var invalidTag=world.deepCopy();((ObjectNode)invalidTag.path("field_tags").path("tags").get(0)).put("id","1");
    try(var ignored=new SimVision(invalidTag,nt)){throw new AssertionError("Accepted textual tag");}catch(IllegalArgumentException expected){}
    ObjectNode state=(ObjectNode)JSON.readTree("{\"tick\":1,\"bodies\":{\"robot\":{\"position\":[0,0,1],\"quaternion\":[0,0,0,1]}}}");
    var blocked=new AtomicBoolean();var calls=new AtomicInteger();
    SimVision.NativeQuery query=input->{
      calls.incrementAndGet();check(input.path("segments").size()==5,"only visible/facing/in-range tag should reach ray test");
      var result=JSON.createObjectNode().put("tick",state.path("tick").asLong());var hits=result.putArray("hits");
      for(int i=0;i<5;i++){if(blocked.get()&&i==4)hits.addObject().put("distance",1);else hits.addNull();}return result;
    };
    double start=Timer.getFPGATimestamp();
    try(var vision=new SimVision(world,nt)){
      String before=state.toString();vision.tick(state,start,query);
      check(LimelightHelpers.getBotPoseEstimate_wpiBlue(name).tagCount==0,"must not deliver before latency");
      SimHooks.stepTiming(.03);vision.tick(state,Timer.getFPGATimestamp(),query);
      check(LimelightHelpers.getBotPoseEstimate_wpiBlue(name).tagCount==0,"30 ms is too early");
      SimHooks.stepTiming(.011);vision.tick(state,Timer.getFPGATimestamp(),query);
      var mt1=LimelightHelpers.getBotPoseEstimate_wpiBlue(name);
      check(mt1.tagCount==1&&mt1.rawFiducials[0].id==1,"actual Limelight parser gets valid raw tag identity");
      near(mt1.timestampSeconds,start,1e-6,"capture timestamp survives paused physics clock and NT delivery");
      check(mt1.latency>=40,"latency includes scheduler delay");
      check(mt1.avgTagArea>0&&mt1.avgTagDist==2,"projected area and measured range");
      check(Math.hypot(mt1.pose.getX(),mt1.pose.getY())>1e-5,"pose must include configured noise");
      check(LimelightHelpers.getBotPoseEstimate_wpiBlue_MegaTag2(name).tagCount==0,"MT2 requires robot-supplied heading");
      check(before.equals(state.toString()),"vision must not alter physical state");
      var table=nt.getTable(name);table.getEntry("robot_orientation_set").setDoubleArray(new double[]{15,0,0,0,0,0});
      SimHooks.stepTiming(.060);vision.tick(state,Timer.getFPGATimestamp(),query);
      SimHooks.stepTiming(.041);vision.tick(state,Timer.getFPGATimestamp(),query);
      mt1=LimelightHelpers.getBotPoseEstimate_wpiBlue(name);var mt2=LimelightHelpers.getBotPoseEstimate_wpiBlue_MegaTag2(name);
      check(mt2.tagCount==1,"MT2 publishes once heading is supplied");
      near(mt2.pose.getRotation().getDegrees(),15,1e-9,"MT2 returns supplied heading");
      near(mt2.pose.getY()-mt1.pose.getY(),-2*Math.sin(Math.toRadians(15)),1e-9,"heading error must affect MT2 translation");
      near(mt2.pose.getX()-mt1.pose.getX(),2*(1-Math.cos(Math.toRadians(15))),1e-9,"heading lever arm");
      int captured=calls.get();vision.tick(state,Timer.getFPGATimestamp(),query);check(calls.get()==captured,"no repeated capture within frame period");
      blocked.set(true);SimHooks.stepTiming(.060);vision.tick(state,Timer.getFPGATimestamp(),query);SimHooks.stepTiming(.041);vision.tick(state,Timer.getFPGATimestamp(),query);
      check(LimelightHelpers.getBotPoseEstimate_wpiBlue(name).tagCount==0,"one occluded corner rejects tag");
      near(LimelightHelpers.getBotPoseEstimate_wpiBlue(name).pose.getX(),0,1e-9,"invalid frame must not expose unseen ground truth");
      blocked.set(false);((ObjectNode)state.path("bodies").path("robot")).set("quaternion",JSON.readTree("[0,0,1,0]"));
      SimHooks.stepTiming(.060);vision.tick(state,Timer.getFPGATimestamp(),query);SimHooks.stepTiming(.041);vision.tick(state,Timer.getFPGATimestamp(),query);
      check(LimelightHelpers.getBotPoseEstimate_wpiBlue(name).rawFiducials[0].id==2,"body rotation changes visible tag");
      table.getEntry("fiducial_id_filters_set").setDoubleArray(new double[]{42});captured=calls.get();
      SimHooks.stepTiming(.060);vision.tick(state,Timer.getFPGATimestamp(),query);SimHooks.stepTiming(.041);vision.tick(state,Timer.getFPGATimestamp(),query);
      check(calls.get()==captured,"robot tag filters apply before ray work");
      check(LimelightHelpers.getBotPoseEstimate_wpiBlue(name).tagCount==0,"filter removes unwanted detections");
      check(vision.snapshot().path("cameras").path(name).path("queued").asInt()==0,"delivered frames leave bounded queue");
    }
    try {
      nt.getTable(name).getEntry("fiducial_id_filters_set").setDoubleArray(new double[0]);
      ObjectNode small=world.deepCopy();((ObjectNode)small.path("vision").path("cameras").get(0)).put("minEdgePixels",100);
      try(var vision=new SimVision(small,nt)){
        vision.tick(state,Timer.getFPGATimestamp(),request->{throw new AssertionError("sub-threshold tag must not reach ray test");});
      }
      ObjectNode mounted=world.deepCopy();var mount=(ObjectNode)mounted.path("vision").path("cameras").get(0);
      mount.set("position",JSON.readTree("[0,1,0]"));mount.set("rotationDegrees",JSON.readTree("[0,0,-90]"));
      var robot=(ObjectNode)state.path("bodies").path("robot");robot.set("position",JSON.readTree("[1,0,1]"));
      robot.set("quaternion",JSON.valueToTree(new double[]{0,0,Math.sqrt(.5),Math.sqrt(.5)}));
      try(var vision=new SimVision(mounted,nt)){
        int oldCalls=calls.get();
        vision.tick(state,Timer.getFPGATimestamp(),request->{
          var from=request.path("segments").get(0).path("from");
          near(from.get(0).asDouble(),0,1e-9,"parent rotation transforms mount translation");
          near(from.get(1).asDouble(),0,1e-9,"camera world Y");
          near(from.get(2).asDouble(),1,1e-9,"camera world Z");
          return query.call(request);
        });check(calls.get()==oldCalls+1,"parent and mount rotations compose to see forward tag");
      }
      System.out.println("SimVisionTest passed: actual Limelight parser, delayed physics timestamps, noise, heading sensitivity, FOV/facing/range/size, corner occlusion, mounting transforms, filters, queue and nonmutation");
    } finally {SimHooks.resumeTiming();nt.stopLocal();}
  }
}
