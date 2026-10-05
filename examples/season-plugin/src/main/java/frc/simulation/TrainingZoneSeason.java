package frc.simulation;

import com.fasterxml.jackson.databind.JsonNode;
import org.instantcad.frc.*;
import java.util.*;

/** An intentionally small training game, NOT official FRC rules or scorekeeping. */
public final class TrainingZoneSeason implements SeasonPlugin {
  public String id(){return "example.training-zone";}
  public SeasonObserver create(JsonNode world,JsonNode config){return new Rules(config);}
  private static final class Rules implements SeasonObserver {
    private final Set<String> pieces;
    private final double goalX,duration;
    private final Map<String,Double> previous=new HashMap<>();
    private final ArrayDeque<Map<String,Object>> history=new ArrayDeque<>();
    private double start=Double.NaN,elapsed;
    private long sequence;
    private int score;
    private String aborted="";
    Rules(JsonNode config){
      if(config.path("schema").asInt()!=1||!config.path("bodies").isArray()||config.path("bodies").isEmpty())throw new IllegalArgumentException("Training rules need schema 1 and body IDs");
      Set<String> ids=new LinkedHashSet<>();for(JsonNode id:config.path("bodies"))if(!id.isTextual()||id.asText().isBlank()||!ids.add(id.asText()))throw new IllegalArgumentException("Invalid training body IDs");pieces=Set.copyOf(ids);
      goalX=number(config.path("goalX"));duration=number(config.path("duration"));if(duration<=0)throw new IllegalArgumentException("Training duration must be positive");
    }
    private static double number(JsonNode n){if(!n.isNumber()||!Double.isFinite(n.asDouble()))throw new IllegalArgumentException("Expected finite training configuration");return n.asDouble();}
    public Set<String> observedBodies(){return pieces;}
    public void start(SeasonFrame frame,JsonNode options){
      if(started())throw new IllegalStateException("Fresh run required");start=frame.time();for(String id:pieces)previous.put(id,frame.position(id).x());event("started","");
    }
    public void advance(SeasonFrame frame){
      if(!started()||finished())return;
      double next=frame.time()-start;
      for(String id:pieces){double x=frame.position(id).x(),old=previous.get(id);if(old<goalX&&x>=goalX){double crossing=elapsed+(next-elapsed)*(goalX-old)/(x-old);if(crossing<duration){score++;event("goal_crossed",id);}}previous.put(id,x);}
      elapsed=Math.min(duration,next);
    }
    private void event(String type,String id){history.add(Map.of("sequence",++sequence,"type",type,"objectId",id,"score",score));while(history.size()>256)history.removeFirst();}
    public void abort(String reason){if(started()&&!finished()){aborted=reason;event("aborted","");}}
    public boolean started(){return Double.isFinite(start);}
    public boolean finished(){return !aborted.isEmpty()||elapsed>=duration;}
    public Mode mode(){return started()&&!finished()?Mode.TELEOP:Mode.DISABLED;}
    public double remaining(){return started()&&!finished()?duration-elapsed:0;}
    public Map<String,Object> snapshot(){return Map.of("phase",!started()?"ready":!aborted.isEmpty()?"aborted":finished()?"complete":"teleop","elapsed",elapsed,"score",score,"reason",aborted,"official",false);}
    public List<?> events(long after){return history.stream().filter(e->((Long)e.get("sequence"))>after).toList();}
  }
}
