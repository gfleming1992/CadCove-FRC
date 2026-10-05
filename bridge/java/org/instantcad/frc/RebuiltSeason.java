package org.instantcad.frc;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;

/** Explicit 2026 season adapter. No year-specific rules belong in TwinBridge. */
public final class RebuiltSeason implements SeasonObserver {
  private final RebuiltMatch match;
  private final Map<String,Double> radii=new LinkedHashMap<>();
  RebuiltSeason(JsonNode world,JsonNode config){
    if(config.path("schema").asInt()!=1||config.path("season").asInt()!=2026||config.path("hubs").size()!=2)throw new IllegalArgumentException("Unsupported season configuration");
    List<RebuiltMatch.Hub> hubs=new ArrayList<>();Set<String> sides=new HashSet<>();
    for(JsonNode hub:config.path("hubs")){
      String side=hub.path("side").asText();if(!Set.of("red","blue").contains(side)||!sides.add(side))throw new IllegalArgumentException("Invalid hub side");
      var opening=new ArrayList<RebuiltMatch.Plane>();var beams=new ArrayList<RebuiltMatch.Beam>();
      for(JsonNode p:hub.path("opening")){
        double x=number(p.path("x")),y=number(p.path("y")),offset=number(p.path("offset"));
        if(Math.abs(Math.hypot(x,y)-1)>.0001||offset<=0)throw new IllegalArgumentException("Invalid aperture plane");
        opening.add(new RebuiltMatch.Plane(x,y,offset));
      }
      for(JsonNode b:hub.path("beams")){
        var a=vec(b.path("a"));var end=vec(b.path("b"));if(a.sub(end).dot(a.sub(end))<.000001)throw new IllegalArgumentException("Invalid sensor beam");
        beams.add(new RebuiltMatch.Beam(b.path("id").asText(),a,end));
      }
      if(opening.size()!=6||beams.size()!=4)throw new IllegalArgumentException("Incomplete hub geometry");
      hubs.add(new RebuiltMatch.Hub(side,vec(hub.path("center")),number(hub.path("topZ")),opening,beams));
    }
    for(JsonNode b:world.path("bodies"))if(b.path("id").asText().startsWith("fuel/")){
      if(b.path("colliders").size()!=1||!b.path("colliders").get(0).path("kind").asText().equals("ball"))throw new IllegalArgumentException("Fuel observer requires nominal sphere geometry");
      double radius=number(b.path("colliders").get(0).path("radius"));if(radius<=0)throw new IllegalArgumentException("Invalid fuel radius");
      radii.put(b.path("id").asText(),radius);
    }
    match=new RebuiltMatch(hubs);
  }
  private static double number(JsonNode n){double v=n.asDouble(Double.NaN);if(!n.isNumber()||!Double.isFinite(v))throw new IllegalArgumentException("Expected finite number");return v;}
  private static RebuiltMatch.Vec vec(JsonNode n){if(!n.isArray()||n.size()!=3)throw new IllegalArgumentException("Expected 3D vector");return new RebuiltMatch.Vec(number(n.get(0)),number(n.get(1)),number(n.get(2)));}
  private List<RebuiltMatch.Fuel> fuel(SeasonFrame frame){var result=new ArrayList<RebuiltMatch.Fuel>(radii.size());radii.forEach((id,radius)->{var p=frame.position(id);result.add(new RebuiltMatch.Fuel(id,new RebuiltMatch.Vec(p.x(),p.y(),p.z()),radius));});return result;}
  public Set<String> observedBodies(){return Set.copyOf(radii.keySet());}
  public void start(SeasonFrame frame,JsonNode options){match.start(frame.time(),options.path("tieWinner").asText(),fuel(frame));}
  public void advance(SeasonFrame frame){if(started()&&!finished())match.advance(frame.time(),fuel(frame));}
  public void abort(String reason){if(started())match.abort(reason);}
  public boolean started(){return match.started();}
  public boolean finished(){return match.aborted()||match.elapsed()>=166;}
  public Mode mode(){return Mode.valueOf(match.mode().toUpperCase(Locale.ROOT));}
  public String gameData(){return match.gameData();}
  public double remaining(){return match.remaining();}
  public Map<String,Object> snapshot(){return match.snapshot();}
  public List<?> events(long after){return match.eventsAfter(after);}
  public static final class Plugin implements SeasonPlugin {
    public String id(){return "rebuilt-2026";}
    public SeasonObserver create(JsonNode world,JsonNode config){return new RebuiltSeason(world,config);}
  }
}
