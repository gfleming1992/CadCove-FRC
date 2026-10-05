package org.instantcad.frc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Bounded, read-only selection from one published physics snapshot. */
final class ObjectQuery {
  private static final ObjectMapper JSON = new ObjectMapper();

  static ObjectNode select(JsonNode state, String query) {
    if (!state.path("bodies").isObject() || !state.path("tick").isNumber())
      throw new IllegalStateException("Physics snapshot unavailable");
    if (query != null && query.length() > 4096)
      throw new IllegalArgumentException("Object query too large");
    Set<String> ids = new LinkedHashSet<>();
    Map<String,String> options = new HashMap<>();
    if (query != null && !query.isEmpty()) for (String pair : query.split("&", -1)) {
      String[] parts = pair.split("=", 2);
      if (parts.length != 2) throw new IllegalArgumentException("Expected query key=value");
      String key = decode(parts[0]), value = decode(parts[1]);
      if (value.isEmpty() || value.length() > 256)
        throw new IllegalArgumentException("Invalid object query value");
      if (key.equals("id")) {
        ids.add(value);
        if (ids.size() > 32) throw new IllegalArgumentException("At most 32 explicit object IDs");
      } else if (!Set.of("prefix", "after", "limit", "near", "radius").contains(key)
          || options.putIfAbsent(key, value) != null)
        throw new IllegalArgumentException("Unknown or repeated query option: " + key);
    }
    JsonNode bodies = state.path("bodies");
    for (String id : ids) if (!bodies.has(id))
      throw new IllegalArgumentException("Unknown object: " + id);
    int limit = 64;
    if (options.containsKey("limit")) {
      String value = options.get("limit");
      if (!value.matches("[0-9]{1,3}")) throw new IllegalArgumentException("Invalid object limit");
      limit = Integer.parseInt(value);
    }
    if (limit < 1 || limit > 256) throw new IllegalArgumentException("Object limit must be 1–256");
    if (options.containsKey("near") != options.containsKey("radius"))
      throw new IllegalArgumentException("near and radius must be supplied together");
    double[] near = null;
    double radius = 0;
    if (options.containsKey("near")) {
      String[] coordinates = options.get("near").split(",", -1);
      if (coordinates.length != 3) throw new IllegalArgumentException("near requires x,y,z in metres");
      near = new double[3];
      for (int i = 0; i < 3; i++) near[i] = finite(coordinates[i]);
      radius = finite(options.get("radius"));
      if (radius <= 0 || radius > 1000) throw new IllegalArgumentException("radius must be in (0,1000] metres");
    }
    List<String> selected = new ArrayList<>();
    String prefix = options.get("prefix"), after = options.get("after");
    Iterator<String> names = bodies.fieldNames();
    while (names.hasNext()) {
      String id = names.next();
      if ((!ids.isEmpty() || prefix != null) && !ids.contains(id)
          && (prefix == null || !id.startsWith(prefix))) continue;
      if (near != null) {
        JsonNode p = bodies.path(id).path("position");
        if (!p.isArray() || p.size() != 3) throw new IllegalStateException("Invalid physical position");
        double dx = p.get(0).asDouble() - near[0], dy = p.get(1).asDouble() - near[1], dz = p.get(2).asDouble() - near[2];
        if (Math.hypot(Math.hypot(dx, dy), dz) > radius) continue;
      }
      selected.add(id);
    }
    Collections.sort(selected);
    ObjectNode result = JSON.createObjectNode().put("tick", state.path("tick").asLong())
        .put("time", state.path("time").asDouble()).put("totalMatched", selected.size());
    ObjectNode objects = result.putObject("objects");
    String last = null;
    boolean more = false;
    for (String id : selected) {
      if (after != null && id.compareTo(after) <= 0) continue;
      if (objects.size() == limit) { more = true; break; }
      // A caller cannot mutate the bridge's published snapshot through this result.
      objects.set(id, bodies.get(id).deepCopy());
      last = id;
    }
    if (more) result.put("nextAfter", last); else result.putNull("nextAfter");
    return result;
  }

  private static String decode(String value) {
    return URLDecoder.decode(value, StandardCharsets.UTF_8);
  }
  private static double finite(String value) {
    double number = Double.parseDouble(value);
    if (!Double.isFinite(number)) throw new IllegalArgumentException("Expected a finite number");
    return number;
  }
}
