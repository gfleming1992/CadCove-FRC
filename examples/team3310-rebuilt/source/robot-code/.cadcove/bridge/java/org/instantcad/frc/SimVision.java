package org.instantcad.frc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import edu.wpi.first.math.geometry.*;
import edu.wpi.first.networktables.*;
import java.util.*;

/** Synthetic Limelight observation model, not an implementation of MegaTag.
 * Geometry/facing/FOV and native occlusion gate every observation. Pose noise,
 * frame rate and delay are explicit calibration inputs. Controls stay in robot code. */
public final class SimVision implements AutoCloseable {
  @FunctionalInterface public interface NativeQuery { JsonNode call(JsonNode input) throws Exception; }
  private static final ObjectMapper JSON=new ObjectMapper();
  private final List<Tag> tags=new ArrayList<>();
  private final List<Camera> cameras=new ArrayList<>();
  private final double tagSize;
  private volatile JsonNode diagnostics=JSON.createObjectNode();
  private record Tag(int id,Translation3d position,Translation3d reference,Rotation3d rotation) {}
  private record Target(Tag tag,double tx,double ty,double area,double distance,List<Translation3d> probes) {}
  private record Frame(double captured,double due,double[] mt1,double[] mt2,double[] stddevs,double[] raw) {}
  private static final class Camera {
    String name,body;
    Transform3d mount;
    double tanH,tanV,width,height,minPixels,maxDistance,minFacing,period,latency,xyNoise,yawNoise,nextCapture;
    long captures,delivered,withTags;
    double lastCapture,lastDelivery;
    int lastTags;
    Random random;
    NetworkTable table;
    DoubleArrayPublisher mt1,mt2,stddevs,raw;
    ArrayDeque<Frame> pending=new ArrayDeque<>();
  }
  public SimVision(JsonNode world,NetworkTableInstance nt) {
    JsonNode config=world.path("vision");
    if(!config.isMissingNode()&&!config.isObject())throw new IllegalArgumentException("vision must be an object");
    if(config.has("seed")&&(!config.path("seed").isIntegralNumber()||!config.path("seed").canConvertToLong()))throw new IllegalArgumentException("Vision seed must be a 64-bit integer");
    tagSize=number(config,"tagSizeMetres",.1651,.01,1);
    if(!config.has("cameras"))return;
    if(!config.path("cameras").isArray()||config.path("cameras").size()>8)throw new IllegalArgumentException("Invalid vision cameras");
    Set<String> bodies=new HashSet<>(),names=new HashSet<>();
    for(JsonNode b:world.path("bodies"))bodies.add(b.path("id").asText());
    Set<Integer> tagIds=new HashSet<>();
    for(JsonNode t:world.path("field_tags").path("tags")){
      int id=t.path("id").asInt(-1);if(!t.path("id").isIntegralNumber()||!t.path("id").canConvertToInt()||id<1||!tagIds.add(id))throw new IllegalArgumentException("Invalid vision tag ID");
      tags.add(new Tag(id,translation(t.path("position")),translation(t.path("referencePosition")),rotation(t.path("quaternion"))));
    }
    if(tags.isEmpty()||tags.size()>64)throw new IllegalArgumentException("Vision requires 1..64 validated field tags");
    for(JsonNode c:config.path("cameras")){
      Camera a=new Camera();a.name=c.path("name").asText();a.body=c.path("body").asText();
      if(!a.name.matches("[A-Za-z0-9_-]{1,64}")||!names.add(a.name)||!bodies.contains(a.body))throw new IllegalArgumentException("Invalid vision camera name/body");
      double[] r=vector(c.path("rotationDegrees"),3);
      a.mount=new Transform3d(translation(c.path("position")),new Rotation3d(Math.toRadians(r[0]),Math.toRadians(r[1]),Math.toRadians(r[2])));
      a.tanH=Math.tan(Math.toRadians(number(c,"horizontalFovDegrees",82,1,170))/2);
      a.tanV=Math.tan(Math.toRadians(number(c,"verticalFovDegrees",56.2,1,170))/2);
      a.width=number(c,"widthPixels",1280,16,8192);a.height=number(c,"heightPixels",800,16,8192);
      a.minPixels=number(c,"minEdgePixels",8,1,100);a.maxDistance=number(c,"maxDistanceMetres",6,.1,50);
      a.minFacing=Math.cos(Math.toRadians(number(c,"maxIncidenceDegrees",75,1,89)));
      a.period=1/number(c,"framesPerSecond",30,1,60);a.latency=number(c,"latencyMs",40,0,200)/1000;
      a.xyNoise=number(c,"xyStdDevAt2m",.02,.0001,1);a.yawNoise=number(c,"yawStdDevDegreesAt2m",1.5,.001,30);
      a.random=new Random(config.path("seed").asLong(0)^a.name.hashCode());
      a.table=nt.getTable(a.name);a.mt1=a.table.getDoubleArrayTopic("botpose_wpiblue").publish();
      a.mt2=a.table.getDoubleArrayTopic("botpose_orb_wpiblue").publish();a.stddevs=a.table.getDoubleArrayTopic("stddevs").publish();
      a.raw=a.table.getDoubleArrayTopic("rawfiducials").publish();cameras.add(a);
    }
  }
  private static double number(JsonNode n,String key,double fallback,double min,double max){
    if(n.has(key)&&!n.path(key).isNumber())throw new IllegalArgumentException("Invalid vision "+key);
    double x=n.has(key)?n.path(key).asDouble(Double.NaN):fallback;
    if(!Double.isFinite(x)||x<min||x>max)throw new IllegalArgumentException("Invalid vision "+key);return x;
  }
  private static double[] vector(JsonNode n,int count){
    if(!n.isArray()||n.size()!=count)throw new IllegalArgumentException("Invalid vision vector");
    double[] a=new double[count];for(int i=0;i<count;i++){a[i]=n.get(i).asDouble(Double.NaN);if(!n.get(i).isNumber()||!Double.isFinite(a[i]))throw new IllegalArgumentException("Nonfinite/nonnumeric vision vector");}return a;
  }
  private static Translation3d translation(JsonNode n){double[] p=vector(n,3);return new Translation3d(p[0],p[1],p[2]);}
  private static Rotation3d rotation(JsonNode n){double[] q=vector(n,4);double norm=Math.sqrt(Arrays.stream(q).map(x->x*x).sum());if(Math.abs(norm-1)>1e-3)throw new IllegalArgumentException("Invalid vision quaternion");return new Rotation3d(new Quaternion(q[3],q[0],q[1],q[2]));}
  private static double[] array(Translation3d p){return new double[]{p.getX(),p.getY(),p.getZ()};}
  private static Pose3d pose(JsonNode body){return new Pose3d(translation(body.path("position")),rotation(body.path("quaternion")));}

  public void tick(JsonNode state,double now,NativeQuery query)throws Exception {
    ObjectNode status=JSON.createObjectNode();
    for(Camera a:cameras){
      if(now+1e-9>=a.nextCapture){
        Pose3d robot=pose(state.path("bodies").path(a.body)),camera=robot.transformBy(a.mount);
        List<Target> possible=project(a,camera);
        var request=JSON.createObjectNode().put("op","sight_segments");var segments=request.putArray("segments");
        for(Target t:possible)for(Translation3d endpoint:t.probes()){
          var ray=segments.addObject();ray.set("from",JSON.valueToTree(array(camera.getTranslation())));ray.set("to",JSON.valueToTree(array(endpoint)));
        }
        List<Target> visible=new ArrayList<>();
        if(!possible.isEmpty()){
          JsonNode result=query.call(request),hits=result.path("hits");
          if(result.path("tick").asLong(-1)!=state.path("tick").asLong()||hits.size()!=segments.size())throw new IllegalStateException("Unsynchronized visibility query");
          for(int i=0;i<possible.size();i++){boolean clear=true;for(int k=0;k<5;k++)clear&=hits.get(i*5+k).isNull();if(clear)visible.add(possible.get(i));}
        }
        a.pending.addLast(frame(a,robot,visible,now));
        if(a.pending.size()>32)throw new IllegalStateException("Vision queue overflow");
        a.captures++;a.lastCapture=now;a.lastTags=visible.size();
        a.nextCapture=a.nextCapture==0?now+a.period:a.nextCapture+a.period;
        if(a.nextCapture<=now)a.nextCapture=now+a.period; // wall-time stalls never generate a burst of fabricated captures
      }
      while(!a.pending.isEmpty()&&a.pending.peekFirst().due()<=now+1e-9)publish(a,a.pending.removeFirst(),now);
      status.set(a.name,JSON.createObjectNode().put("captures",a.captures).put("delivered",a.delivered).put("deliveredWithTags",a.withTags)
        .put("lastCaptureSeconds",a.lastCapture).put("lastDeliverySeconds",a.lastDelivery).put("lastTagCount",a.lastTags).put("queued",a.pending.size()));
    }
    diagnostics=JSON.createObjectNode().put("tick",state.path("tick").asLong()).put("timeSeconds",now).set("cameras",status);
  }
  private List<Target> project(Camera a,Pose3d camera){
    List<Target> output=new ArrayList<>();double[] filter=a.table.getEntry("fiducial_id_filters_set").getDoubleArray(new double[0]);
    for(Tag tag:tags){
      if(filter.length>0&&Arrays.stream(filter).noneMatch(v->v==tag.id()))continue;
      Translation3d delta=camera.getTranslation().minus(tag.position()),normal=new Translation3d(1,0,0).rotateBy(tag.rotation());
      double distance=delta.getNorm(),facing=(delta.getX()*normal.getX()+delta.getY()*normal.getY()+delta.getZ()*normal.getZ())/distance;
      if(distance<.05||distance>a.maxDistance||facing<a.minFacing)continue;
      List<Translation3d> corners=new ArrayList<>(),probes=new ArrayList<>();double[][] pixels=new double[4][2];boolean accepted=true;
      int[][] signs={{-1,-1},{1,-1},{1,1},{-1,1}};
      for(int i=0;i<4;i++){
        Translation3d world=tag.position().plus(new Translation3d(0,signs[i][0]*tagSize/2,signs[i][1]*tagSize/2).rotateBy(tag.rotation()));corners.add(world);
        Translation3d local=world.minus(camera.getTranslation()).rotateBy(camera.getRotation().unaryMinus());
        double u=-local.getY()/local.getX()/a.tanH,v=local.getZ()/local.getX()/a.tanV;
        if(local.getX()<=.01||Math.abs(u)>1||Math.abs(v)>1)accepted=false;
        pixels[i]=new double[]{u*a.width/2,v*a.height/2};
      }
      if(!accepted)continue;
      double area=0,minEdge=Double.POSITIVE_INFINITY;
      for(int i=0;i<4;i++){double[] p=pixels[i],q=pixels[(i+1)%4];area+=p[0]*q[1]-p[1]*q[0];minEdge=Math.min(minEdge,Math.hypot(p[0]-q[0],p[1]-q[1]));}
      if(minEdge<a.minPixels)continue;
      // Stand 1 mm in front of the printed plane to avoid counting the tag
      // substrate itself as an occluder. Center AND all four corners must clear.
      probes.add(tag.position().plus(normal.times(.001)));for(var p:corners)probes.add(p.plus(normal.times(.001)));
      Translation3d local=tag.position().minus(camera.getTranslation()).rotateBy(camera.getRotation().unaryMinus());
      output.add(new Target(tag,Math.toDegrees(Math.atan2(-local.getY(),local.getX())),Math.toDegrees(Math.atan2(local.getZ(),local.getX())),Math.abs(area)*50/(a.width*a.height),distance,probes));
    }
    return output;
  }
  private Frame frame(Camera a,Pose3d robot,List<Target> visible,double now){
    int n=visible.size();double distance=0,area=0,span=0;Translation3d center=new Translation3d(),bias=new Translation3d();
    if(n==0)return new Frame(now,now+a.latency,new double[11],new double[11],new double[12],new double[0]);
    double[] raw=new double[7*n];
    for(int i=0;i<n;i++){
      Target t=visible.get(i);distance+=t.distance();area+=t.area();center=center.plus(t.tag().position());bias=bias.plus(t.tag().reference().minus(t.tag().position()));
      double[] values={t.tag().id(),t.tx(),t.ty(),t.area(),t.distance(),t.tag().position().getDistance(robot.getTranslation()),n>1?.02:.15};System.arraycopy(values,0,raw,i*7,7);
      for(int j=0;j<i;j++)span=Math.max(span,t.tag().position().getDistance(visible.get(j).tag().position()));
    }
    if(n>0){distance/=n;area/=n;center=center.div(n);bias=bias.div(n);}
    double scale=Math.max(.25,Math.pow(distance/2,2))/Math.sqrt(Math.max(1,n));
    double sigma=a.xyNoise*scale,yawSigma=a.yawNoise*scale;
    double nx=a.random.nextGaussian()*sigma,ny=a.random.nextGaussian()*sigma,heading=robot.getRotation().getZ();
    double yaw=heading+Math.toRadians(a.random.nextGaussian()*yawSigma);
    double[] mt1=new double[11+raw.length],mt2=new double[11+raw.length];
    mt1[0]=robot.getX()+bias.getX()+nx;mt1[1]=robot.getY()+bias.getY()+ny;mt1[2]=robot.getZ()+bias.getZ();
    mt1[3]=Math.toDegrees(robot.getRotation().getX());mt1[4]=Math.toDegrees(robot.getRotation().getY());mt1[5]=Math.toDegrees(yaw);
    System.arraycopy(mt1,0,mt2,0,6);
    double[] orientation=a.table.getEntry("robot_orientation_set").getDoubleArray(new double[0]);
    boolean haveYaw=orientation.length>=1&&Double.isFinite(orientation[0]);
    if(haveYaw){
      // First-order heading sensitivity of a tag-based translation estimate.
      // This deliberately does not grant MT2 a perfect independent heading.
      double hint=Math.toRadians(orientation[0]),angle=hint-heading;
      Translation3d d=center.minus(robot.getTranslation());double c=Math.cos(angle),s=Math.sin(angle);
      mt2[0]+=d.getX()-(c*d.getX()-s*d.getY());mt2[1]+=d.getY()-(s*d.getX()+c*d.getY());mt2[5]=orientation[0];
    }
    for(double[] packet:new double[][]{mt1,mt2}){packet[7]=n;packet[8]=span;packet[9]=distance;packet[10]=area;System.arraycopy(raw,0,packet,11,raw.length);}
    if(!haveYaw){mt2=new double[11];}
    double[] std={sigma,sigma,sigma,yawSigma,yawSigma,yawSigma,sigma,sigma,sigma,999,999,999};
    return new Frame(now,now+a.latency,mt1,mt2,std,raw);
  }
  private static void publish(Camera a,Frame f,double now){
    long timestamp=Math.max(1,Math.round(now*1e6));double delay=(timestamp/1e6-f.captured())*1000;
    f.mt1()[6]=delay;f.mt2()[6]=delay;
    a.stddevs.set(f.stddevs(),timestamp);a.raw.set(f.raw(),timestamp);a.mt1.set(f.mt1(),timestamp);a.mt2.set(f.mt2(),timestamp);
    a.table.getEntry("tv").setDouble(f.mt1()[7]>0?1:0);a.table.getEntry("hb").setDouble(++a.delivered);
    if(f.mt1()[7]>0)a.withTags++;a.lastDelivery=now;
  }
  public JsonNode snapshot(){return diagnostics;}
  public void close(){for(Camera a:cameras){a.mt1.close();a.mt2.close();a.stddevs.close();a.raw.close();}}
}
