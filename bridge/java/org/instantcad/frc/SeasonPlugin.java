package org.instantcad.frc;

import com.fasterxml.jackson.databind.JsonNode;

/** Implement in the team project and register with Java ServiceLoader.
 * The plugin runs as trusted team code, not in a security sandbox.
 */
public interface SeasonPlugin {
  int API_VERSION = 1;
  String id();
  default int apiVersion() { return API_VERSION; }
  /** Called once. Inputs are owned copies; validate schema/units/config here. */
  SeasonObserver create(JsonNode world, JsonNode config);
}
