# Install the CadCove-FRC release candidate

Download the VSIX for your OS/CPU from
[GitHub Releases](https://github.com/gfleming1992/CadCove-FRC/releases).
Use the platform qualification report attached to that release. Windows is not
qualified yet. A Linux CI pass uses software graphics and is not a GPU guarantee.

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
2. Run **Extensions: Install from VSIX**, select the downloaded platform file, and
   restart VS Code so it inherits prerequisite environment variables.
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

This is a GitHub prerelease, not a Marketplace listing or hardware certification.
The original code is MIT; dependencies and team/season content retain their terms.
See the [system card](SYSTEM-CARD.md) for modeling, simulation and validation limits.
