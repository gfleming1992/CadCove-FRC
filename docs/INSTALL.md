# Install CadCove-FRC

Install [CadCove FRC from Marketplace](https://marketplace.visualstudio.com/items?itemName=gfleming1992.cadcove-toolbox)
or search **CadCove FRC** (publisher **CadCove**) in VS Code's Extensions view.
The exact extension ID is `gfleming1992.cadcove-toolbox`. VS Code selects the
package for Windows x64, Linux x64, macOS Intel or macOS Apple Silicon.
For offline installation, download the VSIX for your operating system and CPU
from [GitHub Releases](https://github.com/gfleming1992/CadCove-FRC/releases).
Windows and macOS share one source tree; each OS/CPU needs its own native package.
The Windows software workflow has been tested on Windows 11 with Intel graphics;
Windows 10 has not been tested. Release attachments describe each package's
checks. Hosted CI graphics checks do not measure hardware performance.

## Prerequisites

- VS Code 1.100 or newer, or the WPILib 2026 editor. The pinned automated editor
  test uses VS Code 1.105.1; the full example was also tested with WPILib 2026.2.1.
- **Bun 1.4.2**, installed separately from [Bun](https://bun.sh/docs/installation).
  Check `bun --version`. CadCove ships its CLI JavaScript and a small Rust launcher,
  not a Bun interpreter. No runtime download runs silently.
- **Python 3.12** and the pinned CadQuery dependencies. In a checkout of the same
  release tag:

  ```sh
  python3.12 -m venv .venv-cadquery
  .venv-cadquery/bin/python -m pip install -r vendor/cad-core/src/native/requirements.txt
  ```

  Configure VS Code's `instantcad.pythonPath` to the absolute environment Python
  path. Set `CADCOVE_PYTHON` or project `pythonPath` for CLI use. Windows commands
  are in [the maintainer checklist](WINDOWS-CHECK.md).
- For the robot program: WPILib 2026's JDK/toolchain and matching desktop vendor
  dependencies, obtained by the team's Gradle build. These are separate from CAD.

## Open the extension

1. Remove any older **cadcove-dev** development extension to avoid duplicate commands.
2. Install **CadCove FRC** from Marketplace. If using an offline package, run
   **Extensions: Install from VSIX** and select the downloaded platform file.
   Restart VS Code so it inherits prerequisite environment variables.
3. Open a trusted robot workspace. Run **CadCove: Initialize Team Workspace**.
4. Open **CadCove: Open Toolbox Terminal**, then run `cadcove capabilities`.
5. Start a new agent conversation. The generated `AGENTS.md`, `CLAUDE.md` and
   `.github/copilot-instructions.md` route to the shared workspace guidance.
6. Right-click a `.py` model or `.step` file and choose **Open in CAD Canvas**.

The launcher checks `CADCOVE_BUN` first (an absolute executable path), then the
standard `~/.bun/bin/bun` install (`%USERPROFILE%\.bun\bin\bun.exe` on Windows),
then PATH. It checks the pinned Bun version before running the CLI. Set
`CADCOVE_BUN` before launching VS Code if Bun lives elsewhere. A missing interpreter
does not trigger a download. Runtime repair restores CadCove's files, not Bun.
Rust is needed to build from source, not to use the downloaded native package.

## Updates

Marketplace installations update through VS Code's normal extension updater.
Leave auto-update enabled, or use **Check for Extension Updates** in the Extensions
view. Reload the editor if prompted, then run **CadCove: Update Agent Guidance**
in each robot workspace and start a new agent conversation.

Offline VSIX users can install newer platform packages from GitHub Releases.
Marketplace and GitHub release version numbers may differ; their publication
cadences are separate.

## Use the actual team example

The public VSIX contains the generic tools and small training fixture. The full
Team 3310 CAD/code example is in the release source; FIRST field assets and vendor
SDKs are downloaded by explicit setup, not redistributed inside the public VSIX.

From the release source checkout, with `CADCOVE_PYTHON` configured:

```sh
bun install --frozen-lockfile
bun run example:team --output ../Amarillo-REBUILT
```

Open the new folder and select **CadCove: Open Robot CAD** or **Open Live Simulation**.
For driving, map controllers in WPILib Sim GUI and enable Teleoperated. Follow
[the example guide](../examples/team3310-rebuilt/README.md) and
[Driver Station setup](DRIVER-STATION.md). Keep source/build files and credentials
out of shared screenshots or issue reports as appropriate.

## Scope

The original code is MIT; dependencies and team/season content retain their terms.
See the [system card](SYSTEM-CARD.md) for modeling, simulation and validation limits.

## Optional custom physics

The bundled simulator needs no Rust installation. Teams adding custom force models
can follow [Custom robot physics](CUSTOM-SIMULATOR.md) and use **CadCove: Build
Custom Simulator**. That command prompts for Rust setup when Cargo is missing.
