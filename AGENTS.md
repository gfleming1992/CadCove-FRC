# CadCove contributor instructions

Read `README.md` and `CONTRIBUTING.md` before changing this toolbox. The installed
student workflow is documented in `docs/AGENT-QUICKSTART.md`; do not run team
workspace initialization over this tool's source repository.

Keep the generic CAD core independent of FRC and of NativeCAD. Preserve hash pins,
team source and agent customizations. New CAD defaults to native Python/CadQuery via the CLI and shared editor viewer;
legacy JavaScript CAD entries must be migrated explicitly to Python;
physics is native Rust; robot integration uses actual WPILib/vendor interfaces.

Use `bun run test:toolbox` for portable contracts. Use the native tests for physics
changes. See `docs/TOOLBOX-RELEASE.md` for clean-source, packaged CLI and installed
VSIX checks. Do not claim platform qualification from a successful bundle build.

New shipped files must appear in `config/toolbox-source.json`. Keep private assets,
manual imports, tokens, build/session data and developer history out of the public
export. Guidance lives in `lib/toolbox-project.js` and `agent-skills`; the three
student agent entry files all route to one maintained workspace contract.
