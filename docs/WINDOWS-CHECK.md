# Maintainer Windows check — not yet qualified

The Windows fixes have been exercised on Windows 11 Home build 26200. Windows 10
and the manual acceptance below remain unqualified. CI currently runs macOS and
Linux only. Require the exact candidate's qualification report and hashes; these
instructions do not turn a macOS VSIX into a Windows package.

## Build from the source release

Install Git, Python 3.12, Bun 1.4.2, and Rust 1.91.1 with the MSVC target and its
Visual Studio C++ build tools. For robot simulation, install the team's WPILib
2026 toolchain and the desktop libraries resolved by its vendor descriptors.
Use a trusted, short local path and a fresh PowerShell session.
Enable Git long paths for the checkout (`git config core.longpaths true`) when
using a deeply nested directory. Source tests use directory junctions on Windows
to verify redirected-file boundaries without Developer Mode; POSIX also tests
direct file symlinks. The test command allows 60 seconds per portable contract.

The CLI launcher honors `CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER`, matching
Cargo, for an explicitly configured workspace-local MSVC SDK and linker. The
qualified compiler must still be Rust 1.91.1 with the MSVC host; a GNU build does
not satisfy release provenance. SDKs and build tools are not shipped in the VSIX.
Cold native-world validation and startup allow 120 seconds on Windows.
Cold native CAD operations allow 15 minutes for full assemblies; a timed-out
operation reports its deadline and the next request starts a fresh worker.
Example publication retries temporary directory sharing locks for 30 seconds
after Gradle exits, without replacing an existing output workspace.

Record the actual OS version: a Windows 11 test run does not qualify Windows 10.
Run the same candidate and installed-editor checks on Windows 10 before adding
that OS to an announcement's supported-platform list.

```powershell
git clone https://github.com/gfleming1992/CadCove-FRC.git
cd CadCove-FRC
py -3.12 -m venv .venv-cadquery
.\.venv-cadquery\Scripts\python.exe -m pip install -r vendor/cad-core/src/native/requirements.txt
$env:CADCOVE_PYTHON = (Resolve-Path .\.venv-cadquery\Scripts\python.exe).Path
$env:CADCOVE_TEST_EDITOR_VERSION = '1.105.1'
bun install --frozen-lockfile
bun scripts/verify-toolbox-source.js --output ..\CadCove-Windows-check --editor
```

This builds a Windows native runtime, packages a local candidate VSIX, and
installs it into an isolated editor profile for checks. It does not publish a
binary, change the team's robot project, or qualify hardware behavior. Inspect
`artifacts/source-verification-report.json` and the exported checkout's
`artifacts/toolbox-extension-test-report.json`; a successful command must report
`ok: true`, not merely create an archive.

The resulting local VSIX is under
`..\CadCove-Windows-check\artifacts\cadcove-source-check.vsix`. Install it in
WPILib VS Code via **Extensions: Install from VSIX**. Configure
`instantcad.pythonPath` to the Python executable above.

The qualification launcher sets `VSCODE_PORTABLE` to its temporary profile on
Windows. WPILib's portable editor otherwise ignores `--user-data-dir` and uses
its adjacent `data` folder, including that folder's Python settings. The test
asserts the actual interpreter, extension location and runtime storage before
building CAD; a Python setting written to an unused profile is not sufficient.

## Manual acceptance

- Initialize a new team workspace; confirm existing code/instructions are kept.
- Create `models.py`, build, open its canvas, orbit/pan/zoom, then edit one part.
  Camera should stay fixed; a failed build must preserve the last good scene and
  expose an error. Close/reopen to verify cached viewing.
- Right-click a colored assembly STEP file; verify placement and colors.
- Ask the installed editor agent to build, inspect exact geometry, capture a
  focused view, fix an error and export STEP using the generated instructions.
- Follow the team example setup instructions to build the robot and vendor
  libraries **on Windows**. Never copy macOS `.dylib` files into its native folder.
- Run doctor/audit and sim-validate. Open live simulation, map the controllers in
  WPILib Sim GUI, enable Teleoperated, and test drive, intake, shooting and stop.
- Verify structured state/object queries, scene captures, disable/enable, clean
  shutdown and runtime repair. Check live physics pace during crowded-ball play.

Report OS/build, CPU/GPU/RAM, editor/WPILib versions, source commit, runtime/VSIX
hashes, failures and logs. Keep generated endpoint credentials out of reports.
The package uses an externally installed Bun 1.4.2. If VS Code cannot find it,
set `CADCOVE_BUN` to its absolute executable path and restart the editor.
Windows qualification remains pending until these checks actually pass.
