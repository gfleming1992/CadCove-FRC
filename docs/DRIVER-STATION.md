# Driver Station and controllers

The editor simulation canvas displays CAD and the physics real-time percentage.
Robot enable/disable and USB controller input come from WPILib, independently
of which VS Code panel has focus. Closing the canvas does not disable a DS run;
use Disabled/E-stop in Driver Station or CadCove: Stop Robot Simulation.

## Live practice

The Team Robot edition defaults to these `robot.sim.json` runtime settings:

```json
"controlSource": "driverstation",
"driverStation": "gui"
```

Start with **CadCove: Play Team Robot Example**, or **Start Robot Simulation**
and **Open Live Simulation**. WPILib Sim GUI opens separately. Under System
Joysticks, drag each plugged-in controller to its robot joystick port. Enable
**Map gamepad** for the standard Xbox layout. Amarillo uses **driver port 1** and
**operator port 0**. Select **Teleoperated** in Robot State to drive; select
**Disabled** before changing code or stopping. Mechanism buttons are the bindings
in the team's robot code, not CadCove controls. The simulation never auto-enables.

WPILib documents the [simulation Driver Station and joystick mapping](https://docs.wpilib.org/en/stable/docs/software/wpilib-tools/robot-simulation/simulation-gui.html).
NI's FRC Driver Station is a separate Windows application. To use it, select
`"driverStation": "socket"`, restart, and connect Driver Station to the simulation
host (localhost when on the same Windows computer). This loads WPILib's
`halsim_ds_socket` instead of `halsim_gui`. Do not run competing simulations
against the same DS socket. Windows socket operation still needs Windows testing.

The matching WPILib `halsim_gui` / `halsim_ds_socket` native library must be in
`runtime.nativeLibraries`. Missing providers fail at startup. An older robot JAR
must be rebuilt with the current CadCove bridge to support external input.

## Agent simulation runs

Use `"controlSource": "agent"`, remove `driverStation`, and restart for scripted
trials or match schedules. This remains the default for existing manifests.
`sim-controls` accepts leased virtual Xbox packets; expired input disables the
robot. In Driver Station mode those packets and scripted match start requests
are rejected. There is one input owner per run, never automatic takeover.

`sim-capture`, `sim-view`, numeric telemetry and camera controls work in both
modes. `sim-practice` cannot enable the view-only editor canvas. The browser
research/demo UI is separate and retains its explicit virtual control mode.
