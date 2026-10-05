package org.instantcad.frc;

import java.util.*;

/** 2026 season observer. Reads physics; never moves bodies or commands motors. */
public final class RebuiltMatch {
  public record Vec(double x,double y,double z) {
    Vec add(Vec b){return new Vec(x+b.x,y+b.y,z+b.z);}
    Vec sub(Vec b){return new Vec(x-b.x,y-b.y,z-b.z);}
    Vec scale(double s){return new Vec(x*s,y*s,z*s);}
    double dot(Vec b){return x*b.x+y*b.y+z*b.z;}
  }
  public record Plane(double x,double y,double offset) {}
  public record Beam(String id,Vec a,Vec b) {}
  public record Hub(String side,Vec center,double topZ,List<Plane> opening,List<Beam> beams) {}
  public record Fuel(String id,Vec position,double radius) {}
  public record Event(long sequence,String type,String fuel,String side,double elapsed,int points) {}
  private record Entry(Hub hub,double elapsed) {}
  private record Observation(String type,String fuel,String side,double elapsed) {}
  private final List<Hub> hubs;
  private final Map<String,Fuel> previous=new HashMap<>();
  private final Map<String,Entry> entered=new HashMap<>();
  private final ArrayDeque<Event> events=new ArrayDeque<>();
  private final int[] autoFuel=new int[2],teleopFuel=new int[2],inactiveFuel=new int[2];
  private String tieWinner,firstInactive,abortReason="";
  private double start=Double.NaN,time;
  private long sequence;
  public RebuiltMatch(List<Hub> hubs){this.hubs=List.copyOf(hubs);}
  private static int index(String side){return switch(side){case "blue"->0;case "red"->1;default->throw new IllegalArgumentException("Unknown alliance");};}
  public boolean started(){return Double.isFinite(start);}
  public boolean aborted(){return !abortReason.isEmpty();}
  public double elapsed(){return started()?Math.max(0,time-start):0;}
  public void start(double physicsTime,String tieWinner,List<Fuel> fuel){
    if(started()||!Double.isFinite(physicsTime)||physicsTime<0)throw new IllegalStateException("Start requires a fresh simulation");
    index(tieWinner);this.tieWinner=tieWinner;start=time=physicsTime;
    for(Fuel f:fuel)previous.put(f.id(),f);
    event("match_started","","",0,0);
  }
  public void abort(String reason){if(started()&&!aborted()&&elapsed()<166){abortReason=reason;event("match_aborted","","",elapsed(),0);}}
  private void resolveAuto(){if(firstInactive==null&&elapsed()>=23)firstInactive=autoFuel[0]==autoFuel[1]?tieWinner:autoFuel[0]>autoFuel[1]?"blue":"red";}
  public String phase(){
    if(!started())return "ready";if(aborted())return "aborted";
    double t=elapsed();if(t<20)return "auto";if(t<23)return "auto_assessment";
    if(t<33)return "transition";if(t<133)return "shift_"+(1+(int)((t-33)/25));
    if(t<163)return "endgame";if(t<166)return "final_assessment";return "complete";
  }
  public String mode(){return switch(phase()){case "auto"->"autonomous";case "transition","shift_1","shift_2","shift_3","shift_4","endgame"->"teleop";default->"disabled";};}
  public double remaining(){return mode().equals("autonomous")?20-elapsed():mode().equals("teleop")?163-elapsed():0;}
  public String gameData(){return firstInactive==null?"":firstInactive.equals("blue")?"B":"R";}
  private boolean activeAt(String side,double t){
    if(t<0||t>=163)return false;if(t<20||(t>=23&&t<33)||t>=133)return true;if(t<23)return false;
    if(firstInactive==null)throw new IllegalStateException("AUTO must be assessed before alliance shifts");
    int shift=(int)((t-33)/25);
    return (shift%2==0)!=side.equals(firstInactive);
  }
  public boolean hubActive(String side){index(side);return started()&&!aborted()&&activeAt(side,elapsed());}
  private boolean scoringAt(String side,double t){
    if(t<0||t>=166)return false;
    if(activeAt(side,t))return true;
    // An active interval's processing grace ends three seconds after deactivation.
    for(double end:new double[]{20,33,58,83,108,133,163})
      if(t>=end&&t<end+3&&activeAt(side,end-1e-7))return true;
    return false;
  }
  private void event(String type,String fuel,String side,double elapsed,int points){
    events.addLast(new Event(++sequence,type,fuel,side,elapsed,points));
    if(events.size()>4096)events.removeFirst();
  }
  public List<Event> eventsAfter(long after){return events.stream().filter(e->e.sequence()>after).toList();}
  public Map<String,Object> snapshot(){
    Map<String,Object> m=new LinkedHashMap<>();m.put("phase",phase());m.put("mode",mode());m.put("elapsed",elapsed());m.put("remaining",remaining());
    m.put("gameData",gameData());m.put("tieWinner",tieWinner==null?"":tieWinner);m.put("abortReason",abortReason);
    m.put("blueActive",hubActive("blue"));m.put("redActive",hubActive("red"));
    m.put("autoFuel",Map.of("blue",autoFuel[0],"red",autoFuel[1]));m.put("teleopFuel",Map.of("blue",teleopFuel[0],"red",teleopFuel[1]));
    m.put("inactiveFuel",Map.of("blue",inactiveFuel[0],"red",inactiveFuel[1]));m.put("pendingFuel",entered.size());
    m.put("eventSequence",sequence);m.put("firstRetainedEvent",events.isEmpty()?sequence+1:events.getFirst().sequence());
    m.put("scoringScope","fuel only; CAD-center sensor beams and conservative nominal-radius opening checks; tower/fouls/RP not assessed");
    return m;
  }
  public void advance(double physicsTime,List<Fuel> fuel){
    if(!started()||aborted()||elapsed()>=166)return;if(!Double.isFinite(physicsTime)||physicsTime<time)throw new IllegalArgumentException("Non-monotonic physics clock");
    String before=phase();double previousTime=time;
    List<Observation> observations=new ArrayList<>();
    for(Fuel f:fuel){
      Fuel old=previous.get(f.id());
      if(old!=null&&physicsTime>previousTime){
        Vec a=old.position(),b=f.position(),d=b.sub(a);
        for(Hub hub:hubs){
          if(a.z()>hub.topZ()&&b.z()<=hub.topZ()){
            double u=(hub.topZ()-a.z())/d.z();Vec p=a.add(d.scale(u));
            boolean fits=hub.opening().stream().allMatch(n->n.x()*(p.x()-hub.center().x())+n.y()*(p.y()-hub.center().y())<=n.offset()-f.radius());
            if(fits){double t=previousTime+u*(physicsTime-previousTime)-start;entered.put(f.id(),new Entry(hub,t));observations.add(new Observation("hub_entry",f.id(),hub.side(),t));}
          }
        }
        Entry entry=entered.get(f.id());
        if(entry!=null){
          double hit=Double.POSITIVE_INFINITY;
          double lower=Math.max(0,Math.min(1,(entry.elapsed()+start-previousTime)/(physicsTime-previousTime)));
          Vec from=a.add(d.scale(lower));
          for(Beam beam:entry.hub().beams())hit=Math.min(hit,lower+(1-lower)*beamHit(from,b,beam.a(),beam.b(),f.radius()));
          if(Double.isFinite(hit)){
            double t=previousTime+hit*(physicsTime-previousTime)-start;
            observations.add(new Observation("fuel_sensor_passage",f.id(),entry.hub().side(),t));entered.remove(f.id());
          }else if(Math.hypot(b.x()-entry.hub().center().x(),b.y()-entry.hub().center().y())>1.0||b.z()<0.4||b.z()>entry.hub().topZ()+0.3){
            entered.remove(f.id());observations.add(new Observation("hub_exit_without_sensor",f.id(),entry.hub().side(),physicsTime-start));
          }
        }
      }
      previous.put(f.id(),f);
    }
    // Process all bodies chronologically before freezing the AUTO result. Array
    // iteration order must not decide which alliance goes inactive first.
    observations.sort(Comparator.comparingDouble(Observation::elapsed).thenComparing(Observation::fuel));
    for(Observation o:observations){
      if(o.elapsed()>=166)continue;
      time=start+o.elapsed();resolveAuto();int points=0;
      if(o.type().equals("fuel_sensor_passage")){
        int side=index(o.side());points=scoringAt(o.side(),o.elapsed())?1:0;
        if(points==0)inactiveFuel[side]++;else if(o.elapsed()<23)autoFuel[side]++;else teleopFuel[side]++;
      }
      event(o.type(),o.fuel(),o.side(),o.elapsed(),points);
    }
    time=Math.min(physicsTime,start+166);resolveAuto();if(!phase().equals(before))event("phase_"+phase(),"","",elapsed(),0);
  }
  // Swept sphere vs finite beam segment. Tests both spherical endcaps and the
  // cylindrical interior, so a fast ball cannot skip a thin optical beam.
  static double beamHit(Vec p,Vec end,Vec a,Vec b,double radius){
    Vec d=end.sub(p),v=b.sub(a),q=p.sub(a);double vv=v.dot(v);
    if(vv<=0)throw new IllegalArgumentException("Zero-length beam");
    double u=q.dot(v)/vv,du=d.dot(v)/vv;
    double lo=0,hi=1;
    if(Math.abs(du)<1e-15){if(u<0||u>1){lo=1;hi=0;}}
    else {double t0=-u/du,t1=(1-u)/du;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));}
    double cylinder=quadraticHit(q.sub(v.scale(u)),d.sub(v.scale(du)),radius,lo,hi);
    return Math.min(cylinder,Math.min(quadraticHit(q,d,radius,0,1),quadraticHit(p.sub(b),d,radius,0,1)));
  }
  private static double quadraticHit(Vec q,Vec d,double r,double lo,double hi){
    if(lo>hi)return Double.POSITIVE_INFINITY;
    double aa=d.dot(d),bb=2*q.dot(d),cc=q.dot(q)-r*r;
    if(q.add(d.scale(lo)).dot(q.add(d.scale(lo)))<=r*r)return lo;
    if(aa==0)return Double.POSITIVE_INFINITY;
    double disc=bb*bb-4*aa*cc;if(disc<0)return Double.POSITIVE_INFINITY;
    double entry=(-bb-Math.sqrt(disc))/(2*aa),exit=(-bb+Math.sqrt(disc))/(2*aa);
    double hit=Math.max(lo,entry);return hit<=hi&&hit<=exit?hit:Double.POSITIVE_INFINITY;
  }
}
