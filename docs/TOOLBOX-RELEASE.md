# Publication and release checklist

## Release scope

Original CadCove code is MIT licensed. The generic CAD core is independently
vendored with hashes and uses local Python/CadQuery for modeling.
Third-party libraries retain their licenses. Source publication, binary release,
and Marketplace publication are separate actions.

The public source is an allowlisted export, not the development repository's
history. It includes an original small training robot, replaceable season/device
contracts and instructions for obtaining external assets. The authorized Team 3310 example includes editable CAD, robot source and physics
bindings. Official FIRST field geometry is downloaded and rebuilt locally by
example setup. SDK binaries, private manuals, demo videos, runtime sessions,
credentials and benchmark dumps are excluded.

## GitHub source candidate

1. Review `LICENSE`, `licenses/README.md`, README and contributor/security guidance.
2. Commit the reviewed implementation. Export to a new directory:
   `bun scripts/export-toolbox-source.js --output /path/to/new-public-source`.
3. Verify from that clean export using the source verifier below. Inspect
   `source-provenance.json`; it records the source revision and per-file hashes.
4. Initialize a **new Git repository inside the export**. Set the user-selected
   GitHub URL and publication identity; do not push development history.
5. Enable Actions and private vulnerability reporting. Review the platform matrix
   results before advertising support. Keep source available even if binary
   redistribution gates have not yet been closed.

No repository is created or published automatically by these steps.

## Build and installation qualification

From a committed development or public source checkout:

```sh
CADCOVE_TEST_EDITOR_VERSION=1.105.1 bun scripts/verify-toolbox-source.js --output /path/to/new-source-check --editor
```

This exports only allowed source, performs a frozen dependency install, runs
portable/native tests, builds native physics and an external-Bun CLI launcher, tests a
relocated offline runtime, builds a VSIX and installs it into an isolated editor
profile. The editor checks CAD edits, colors, revision-matched previews, cache,
runtime repair and example export. It records source revision and VSIX hash.
`CADCOVE_TEST_SOFTWARE_GPU=1` uses SwiftShader for headless CI, not GPU performance
qualification. Actual robot execution additionally needs WPILib/vendor fixtures.
The workflow tests Linux and macOS; Windows is deferred to the maintainer; a defined workflow is not evidence
of completed runs on those platforms.

The current local platform is macOS arm64. Earlier candidates passed stock and
WPILib 2026.2.1 installed-editor and actual vendor integration checks. Each new
release must attach its own source/runtime/VSIX hashes and test scope; old
candidate evidence does not qualify new binaries automatically.

## GitHub binary candidate

The default `external-bun` package ships JavaScript, our small Rust launcher and
native physics. Bun 1.4.2 and Python/CadQuery are installed separately. Its locked
Rust/npm notices and provenance are verified before packaging. The optional
`--cli-mode standalone` continues to fail production packaging while its Bun
source/notice review remains unresolved; do not bypass that gate.

1. Use the reviewed `gfleming1992` GitHub publisher identity, rebuild the runtime
   and VSIX, then run relocated-runtime and installed-editor checks.
2. Attach the VSIX, its exact qualification report, SHA-256 checksums and notices
   to a prerelease tag at the tested source commit. Keep platform claims scoped
   to the attached evidence. Include the source archive and original MIT license.
3. Test agent initialization, CLI discovery, CAD edits/cache/capture, runtime
   repair and the separate simulation profiles. Actual team/vendor execution is
   recorded separately from the stock-editor CI test.
4. Keep Windows unqualified and the announcement draft unpublished until the
   maintainer's Windows check is complete. The actual-editor native CadQuery
   launch video is recorded, reviewed and attached to `v0.2.0-rc.1` with its
   own video provenance and SHA-256 manifest.

Marketplace publication is separate: no publisher registration or Marketplace
upload has been performed. Existing users should uninstall the old `cadcove-dev`
extension before installing the GitHub candidate to avoid duplicate commands.

## Main robot example source

The Team 3310 robot CAD/code publication was authorized on 2026-10-05.
`examples/team3310-rebuilt/source` is the reviewed source and collision baseline;
`field-source.json` pins FIRST's separately downloaded field. Run `bun run
example:team --output NEW_WORKSPACE` and `scripts/verify-team-example.js` to exercise
this example. Generic source CI uses a dependency-closure test without downloading
the field or vendor SDKs. The full example's platform qualification is separate.

### Native full-robot development candidate — 2026-10-17

Candidate: `artifacts/cadcove-frc-native-robot-20261017.vsix`.
SHA-256: `228e81580c861956ba4dba0c91a9b7a0b133f2b74c1d826b5d545f6d38d3d958`.
Runtime: `0.1.11-native-preview`; generic core:
`33a89e99c7e207db7de7b58027a8f83758fec874`.

All 109 authored robot designs now use native CadQuery; 320 vendor/unclassified
STEP assets remain intentional imports. All 1,958 placed shapes passed native
validity checks. 118 portable/native tests and the fresh installed VS Code 1.105.1
test passed on macOS arm64, including the complete colored robot opening from
disk cache without Python startup, Python edit/camera/cache behavior, packaged
CLI/image feedback and actual WPILib/CTRE teleop execution with clean shutdown.
The separately installed pinned Python environment was supplied to the test.

See [full timings and scope](NATIVE-CADQUERY-PROFILE.md#full-assembly-measurements)
and the [migration evidence](../examples/team3310-rebuilt/source/native-migration-validation.json).
Two rails retain a documented STEP round-trip limitation; their native geometry
is validated. Existing physical calibration and collision review limits remain.
This development artifact does not close the Windows/Linux, hardware or binary
redistribution gates above and has not been published.
