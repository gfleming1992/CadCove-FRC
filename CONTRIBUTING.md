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
  wrapper. No hosted AI API, model account or proprietary NativeCAD dependency.
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
