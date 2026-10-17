# CadCove-FRC: open-source CAD + code + simulation for your editor agent

I've been building CadCove-FRC to bring robot design, code, and simulation into
one local VS Code / WPILib workspace. The idea is to let a team's existing coding
agent work across the whole loop, with files and measurable feedback.

**[Source and setup](https://github.com/gfleming1992/CadCove-FRC)** ·
**[Technical system card](SYSTEM-CARD.md)**

## How it works

- **CAD:** ordinary Python with native CadQuery and OCCT. The agent can use the
  full APIs, build geometry, inspect dimensions/clearances, and repair failures.
- **Viewing:** right-click a Python model or STEP file to open an interactive
  WebGPU canvas inside VS Code. Captures can focus on the part being edited.
- **Code:** the robot's Java/WPILib program runs through supported Phoenix device
  adapters. CAD does not automatically guess wiring, gearing or mechanism behavior.
- **Simulation:** native Rust/Rapier, with an interactive gameplay mode and a
  more detailed mode. Agents can query object states and control inputs instead
  of relying entirely on screenshots. Driver Station owns normal practice input.
- **Agent setup:** initialization adds shared instructions for Codex, Claude Code
  and Copilot while preserving team edits. Files and CLI are the primary workflow;
  MCP is available for editor integration. There is no bundled AI subscription.

The example is our Team 3310 robot on REBUILT: 1,958 CAD occurrences, including
109 authored CadQuery designs and retained vendor STEP components. Robot and
season packs are replaceable; FIRST field geometry is downloaded from FIRST.

This is an early-access release. Platform packages and source are on
[GitHub Releases](https://github.com/gfleming1992/CadCove-FRC/releases); install
Bun 1.4.2 and Python/CadQuery separately. Calibration and real robot validation still
matter. It is not automatic engineering sign-off, and physics performance varies
with hardware and contact load. Windows validation is the next maintainer check;
please see the system card for platform evidence and current limitations.

The original code is MIT. Third-party dependencies and season/team assets retain
their respective licenses. Feedback from teams on setup, useful mechanisms,
vendor integration and simulation accuracy would be especially helpful.

## Launch media

The updated native-CadQuery film is pending capture verification. Add its final
URL here before posting this announcement; do not substitute the earlier
brepjs introduction.
