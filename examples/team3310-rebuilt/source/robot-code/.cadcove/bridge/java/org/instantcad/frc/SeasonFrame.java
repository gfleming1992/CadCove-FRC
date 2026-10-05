package org.instantcad.frc;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Set;

/** Read-only view of one immutable published native snapshot, in SI units.
 * Lazily extracts only requested values; no per-step JSON deep copy is needed.
 * Do not retain every frame: that would retain the underlying snapshot history.
 */
public final class SeasonFrame {
  public record Vec3(double x,double y,double z) {}
  public record Quaternion(double x,double y,double z,double w) {}
  private final JsonNode state;
  private final Set<String> observed;
  private final long tick;
  private final double time;
  SeasonFrame(JsonNode state,Set<String> observed,double dt) {
    if(!state.path("tick").isIntegralNumber()||!state.path("tick").canConvertToLong()||state.path("tick").asLong()<0)throw new IllegalArgumentException("Invalid physics tick");
    this.state=state;this.observed=observed;this.tick=state.path("tick").asLong();this.time=tick*dt;
    if(!Double.isFinite(time))throw new IllegalArgumentException("Invalid physics time");
  }
  public long tick(){return tick;}
  public double time(){return time;}
  public Set<String> bodyIds(){return observed;}
  private JsonNode value(String id,String field,int size){
    if(!observed.contains(id))throw new IllegalArgumentException("Season did not declare body "+id);
    JsonNode value=state.path("bodies").path(id).path(field);
    if(!value.isArray()||value.size()!=size)throw new IllegalArgumentException("Missing season observation "+id+"."+field);
    for(JsonNode n:value)if(!n.isNumber()||!Double.isFinite(n.asDouble()))throw new IllegalArgumentException("Nonfinite season observation "+id);
    return value;
  }
  private Vec3 vector(String id,String field){var v=value(id,field,3);return new Vec3(v.get(0).asDouble(),v.get(1).asDouble(),v.get(2).asDouble());}
  public Vec3 position(String id){return vector(id,"position");}
  public Vec3 velocity(String id){return vector(id,"velocity");}
  public Vec3 angularVelocity(String id){return vector(id,"angular_velocity");}
  public Quaternion quaternion(String id){var v=value(id,"quaternion",4);return new Quaternion(v.get(0).asDouble(),v.get(1).asDouble(),v.get(2).asDouble(),v.get(3).asDouble());}
}
