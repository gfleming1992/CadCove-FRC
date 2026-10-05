// Copyright (c) 2026 FRC Team 3310
// Use of this source code is governed by an MIT-style
// license that can be found in the LICENSE file.

package frc.robot.Auton;

import com.pathplanner.lib.path.PathPlannerPath;

/**
 * Container class for all PathPlanner paths and autonomous routines. Paths are loaded from
 * deploy/pathplanner/paths and autos from depliy/pathplanner/autos.
 */
public class Paths {
  // Individual paths (loaded from .path files)
  public static PathPlannerPath forward2m;

  public static PathPlannerPath depCollect;
  public static PathPlannerPath depCollect2;

  public static PathPlannerPath outCollect;
  public static PathPlannerPath outCollect2;

  public static PathPlannerPath outCitrus1;
  public static PathPlannerPath outCitrus2;

  public static PathPlannerPath depCitrus1;
  public static PathPlannerPath depCitrus2;

  public static PathPlannerPath hubBackUp;
  public static PathPlannerPath OutInterweave;
  public static PathPlannerPath DepInterweave;

  public static PathPlannerPath DepMadtown;
  public static PathPlannerPath OutMadtown;

  public static boolean loaded;

  /**
   * Load all paths from PathPlanner path files. Alliance flipping is handled automatially by
   * AutoBuilder.followPath() at runtime, so no manual flip needed here.
   */
  public static void loadPaths() {
    loaded = true;

    forward2m = loadPath("forward2m");

    depCollect = loadPath("DepCollect");
    depCollect2 = loadPath("DepCollect2");

    outCollect = loadPath("OutCollect");
    outCollect2 = loadPath("OutCollect2");

    outCitrus1 = loadPath("OutCitrus1");
    outCitrus2 = loadPath("OutCitrus2");

    depCitrus1 = loadPath("DepCitrus1");
    depCitrus2 = loadPath("DepCitrus2");

    hubBackUp = loadPath("HubBackUp");
    OutInterweave = loadPath("OutInterweave");
    DepInterweave = loadPath("DepInterweave");

    DepMadtown = loadPath("DepMadtown");
    OutMadtown = loadPath("OutMadtown");
  }

  /** Load a single path from a PathPlanner .path file. */
  private static PathPlannerPath loadPath(String name) {
    try {
      return PathPlannerPath.fromPathFile(name);
    } catch (Exception e) {
      System.err.println("Failed to load path '" + name + "': " + e.getMessage());
      loaded = false;
    }
    return null;
  }
}
