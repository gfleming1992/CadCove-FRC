# Contributing to CadCove

Original contributions are MIT licensed under [LICENSE](LICENSE). Retain upstream
notices for vendored code and identify any third-party source or asset additions.
Robot CAD, official manuals, SDK binaries and recordings have separate provenance;
do not assume the project license grants redistribution rights to them.

## Boundaries

- `vendor/cad-core` is a hash-pinned export of the independent native CAD / WebGPU core.
  Make generic changes upstream, repin with `scripts/vendor-cad-core.js`, and
  verify the manifest. Keep FRC dependencies outside that core.
- `lib`, `bin` and `extensions/vscode` provide portable agent tools and the editor
  wrapper. Teams use their existing coding agent with these local tools.
- `crates/sim-core` supplies native physics; `bridge/java` integrates actual team
  robot code. Device and season contracts remain explicit and replaceable.
- `agent-skills` holds reusable task guidance, not one team's geometry/constants.

## Build and tests

Install Bun 1.4.2 and Rust 1.91.1 with a platform native toolchain. In this checkout:

```sh
bun install --frozen-lockfile
bun run test:toolbox
cargo test --locked --release -p instantcad-sim --features composite-compact
bun scripts/build-native-runtime.js
```

Use [README](README.md) for runtime/VSIX packaging and
[release gates](docs/TOOLBOX-RELEASE.md) for the clean source and installed-editor
checks. Testing the Java bridge needs matching WPILib JDK/vendor dependencies;
those are not silently downloaded as part of CAD onboarding.

Add regression coverage for changed contracts, stale artifacts, source tracking,
agent initialization/updates, physical assumptions and shutdown behavior when
relevant. Do not use a staged screenshot or edited trajectories as proof of a
successful controller/physics test. Report untested platforms honestly.

## Before a pull request

- Explain behavior, testing and remaining limits. Include a minimal reproduction.
- Preserve student instructions, source files, stable part IDs and existing sessions.
- Run the relevant tests and rebuild packaged executables after runtime changes.
- Add newly shipped files to `config/toolbox-source.json`; keep private fixtures out.
- Update shared agent guidance and use managed upgrades for team customizations.
- Strip credentials, local session files, absolute developer paths and private assets
  from attachments. See [SECURITY](SECURITY.md).

Public source is exported from a committed tree. Do not push development history
containing private fixtures; initialize the reviewed export as the public repo.

## Build and verify from source

Development needs Bun 1.4.2, Rust 1.91.1, Python 3.12 with the pinned
CadQuery requirements, and the appropriate native build toolchain.
[Windows verification instructions](docs/WINDOWS-CHECK.md) cover the native
toolchain and installed-editor checks.
This source tree includes the pinned generic core; no sibling checkout or team
robot submodule is needed for the toolbox build and asset-free test suite.

```sh
python3.12 -m venv .venv-cadquery
.venv-cadquery/bin/python -m pip install -r vendor/cad-core/src/native/requirements.txt
export CADCOVE_PYTHON="$PWD/.venv-cadquery/bin/python"
bun install --frozen-lockfile
bun run test:toolbox
bun scripts/build-native-runtime.js
# Windows native output ends in .exe.
bun scripts/package-runtime.js --native-binary target/distribution/release/instantcad-sim \
  --output artifacts/runtime-candidate --version 0.2.0 \
  --base-url https://YOUR-RELEASE-HOST/RELEASE/TARGET
bun tests/packaged-runtime.js artifacts/runtime-candidate
bun scripts/build-toolbox-extension.js --runtime artifacts/runtime-candidate
```

Package the staged extension with the checked packager (substitute its platform
and architecture):

```sh
bun scripts/package-toolbox-extension.js \
  --extension build/toolbox-extension-darwin-arm64 \
  --output artifacts/cadcove-toolbox.vsix
```

This verifies required VSIX contents, runtime provenance and distribution notices.
The default external-Bun package does not redistribute Bun. The optional
`--cli-mode standalone` embeds Bun and remains blocked for public distribution
until its separate source/notice review is complete. A package build does not
replace installed-platform qualification. See `extensions/vscode/README.md` for runtime repair and terminal PATH
behavior. Exported Java source updates are reviewed explicitly and never replace
team customizations automatically.

The public-source CI also installs the generated VSIX into a separate editor
profile and exercises CAD builds, edits, cache reuse, preview feedback, runtime
repair and the bundled example. To run that gate locally from a committed tree:

```sh
CADCOVE_TEST_EDITOR_VERSION=1.105.1 \
  bun scripts/verify-toolbox-source.js --output /path/to/new-source-check --editor
```

It downloads the pinned stock editor using Microsoft's test helper. CI uses
`CADCOVE_TEST_SOFTWARE_GPU=1` for SwiftShader and Xvfb on Linux; this checks
functionality, not hardware rendering speed. Reports bind results to the source
revision and VSIX hash. WPILib companion extensions and actual vendor robot
execution remain separate qualification runs.

## Contributing and publishing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development, tests and agent guidance,
[SECURITY.md](SECURITY.md) for the local execution boundary, and
[release checklist](docs/TOOLBOX-RELEASE.md) for source versus binary release gates.
GitHub source publication and Marketplace publication are separate steps.

## Public source boundary

`config/toolbox-source.json` defines the source distribution. From a committed
checkout, `bun scripts/export-toolbox-source.js --output NEW_DIRECTORY` exports
only approved tracked files, with per-file hashes and source revision. It omits
unapproved team fixtures, FIRST field geometry/manuals, recordings, profiles, local credentials, development assets,
benchmark experiments and repository history. The development checkout keeps
those fixtures separately for engineering evidence; they are not required to
build the exported toolbox. This export is a reviewable candidate, not a license
or publication assertion.

The library list is explicit: adding a new shipped module also requires updating
the source policy. Team-specific field/shooter extraction and profiling helpers
are outside that list. Run the fresh-source verifier after changing this boundary
so a working development checkout cannot hide a missing release dependency.
