package org.instantcad.frc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;

/** Generic lifecycle boundary. A season is selected explicitly from trusted providers. */
final class MatchRuntime {
  private static final ObjectMapper JSON=new ObjectMapper();
  private final SeasonObserver observer;
  private final Set<String> observed;
  private final String adapter;
  private final double dt;
  private long lastTick=-1;
  private boolean aborted;
  private final List<String> available;
  MatchRuntime(JsonNode world){this(world,ServiceLoader.load(SeasonPlugin.class));}
  MatchRuntime(JsonNode world,Iterable<SeasonPlugin> providers){
    dt=world.path("dt").asDouble(.005);if(!Double.isFinite(dt)||dt<=0)throw new IllegalArgumentException("Invalid season timestep");
    Map<String,SeasonPlugin> plugins=new LinkedHashMap<>();register(plugins,new RebuiltSeason.Plugin());for(var plugin:providers)register(plugins,plugin);
    available=List.copyOf(plugins.keySet());
    JsonNode selection=world.path("season"),legacy=world.path("rebuilt2026"),config;
    if(!selection.isMissingNode()&&!legacy.isMissingNode())throw new IllegalArgumentException("Choose season or legacy rebuilt2026, not both");
    if(!selection.isMissingNode()){
      if(!selection.isObject()||!selection.path("schema").isIntegralNumber()||selection.path("schema").asInt()!=1||!selection.path("adapter").isTextual()||!selection.path("config").isObject())throw new IllegalArgumentException("Invalid season selection");
      adapter=selection.path("adapter").asText();config=selection.get("config");
    }else if(!legacy.isMissingNode()){adapter="rebuilt-2026";config=legacy;}
    else{adapter="none";observer=null;observed=Set.of();return;}
    var plugin=plugins.get(adapter);if(plugin==null)throw new IllegalArgumentException("Season adapter is not installed: "+adapter+"; available: "+available);
    observer=Objects.requireNonNull(plugin.create(world.deepCopy(),config.deepCopy()),"Season factory returned null");
    observed=Set.copyOf(observer.observedBodies());Set<String> bodies=new HashSet<>();for(JsonNode b:world.path("bodies"))bodies.add(b.path("id").asText());
    for(String id:observed)if(id.isBlank()||!bodies.contains(id))throw new IllegalArgumentException("Season observes unknown body: "+id);
  }
  private static void register(Map<String,SeasonPlugin> map,SeasonPlugin plugin){
    String id=plugin.id();if(id==null||!id.matches("[a-z0-9][a-z0-9.-]{0,63}")||id.equals("none")||plugin.apiVersion()!=SeasonPlugin.API_VERSION)throw new IllegalArgumentException("Invalid/incompatible season provider: "+id);
    if(map.putIfAbsent(id,plugin)!=null)throw new IllegalArgumentException("Duplicate season provider: "+id);
  }
  private SeasonFrame frame(JsonNode state){var frame=new SeasonFrame(state,observed,dt);if(frame.tick()<lastTick)throw new IllegalArgumentException("Season physics clock moved backwards");lastTick=frame.tick();return frame;}
  synchronized void start(JsonNode state,JsonNode options){
    if(observer==null)throw new IllegalStateException("Configure a season observer before starting a match");
    if(observer.started())throw new IllegalStateException("Start requires a fresh simulation");
    if(!options.isObject())throw new IllegalArgumentException("Season start options must be an object");
    observer.start(frame(state),options.deepCopy());
  }
  // Backward-compatible direct callers; the HTTP boundary also accepts options.
  synchronized void start(JsonNode state,String tieWinner){start(state,JSON.createObjectNode().put("tieWinner",tieWinner));}
  synchronized void advance(JsonNode state){if(started()&&!aborted&&!observer.finished())observer.advance(frame(state));}
  synchronized void abort(String reason){if(started()){aborted=true;observer.abort(reason);}}
  synchronized boolean started(){return observer!=null&&observer.started();}
  synchronized String mode(){return observer==null||aborted||observer.finished()?"disabled":Objects.requireNonNull(observer.mode(),"Missing season mode").name().toLowerCase(Locale.ROOT);}
  synchronized String gameData(){return observer==null?"":Objects.requireNonNull(observer.gameData(),"Missing game data");}
  synchronized double remaining(){double value=observer==null||aborted||observer.finished()?0:observer.remaining();if(!Double.isFinite(value)||value<0)throw new IllegalStateException("Invalid season time remaining");return value;}
  synchronized Map<String,Object> snapshot(){var result=new LinkedHashMap<String,Object>(observer==null?Map.of("phase","unavailable"):observer.snapshot());result.put("adapter",adapter);result.put("adapterApiVersion",SeasonPlugin.API_VERSION);result.put("availableAdapters",available);return result;}
  synchronized List<?> events(long after){if(after<0)throw new IllegalArgumentException("Event cursor must be nonnegative");return observer==null?List.of():List.copyOf(observer.events(after));}
}
