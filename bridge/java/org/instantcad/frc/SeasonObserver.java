package org.instantcad.frc;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Rules/score observer only. Robot code and the physics engine own actuation. */
public interface SeasonObserver {
  enum Mode { DISABLED, AUTONOMOUS, TELEOP, TEST }
  /** Fixed physical body IDs needed by this observer, validated at world load. */
  Set<String> observedBodies();
  void start(SeasonFrame frame, JsonNode options);
  void advance(SeasonFrame frame);
  void abort(String reason);
  boolean started();
  boolean finished();
  Mode mode();
  double remaining();
  default String gameData() { return ""; }
  Map<String,Object> snapshot();
  /** Bounded, monotonically sequenced event history; after is exclusive. */
  default List<?> events(long after) { return List.of(); }
}
