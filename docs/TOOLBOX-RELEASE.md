# Publication and release checklist

## Release scope

Original CadCove code is MIT licensed. The generic CAD core is independently
vendored with hashes; no NativeCAD implementation, service or secret is required.
Third-party libraries retain their licenses. Source publication, binary release,
and Marketplace publication are separate actions.

The public source is an allowlisted export, not the development repository's
history. It includes an original small training robot, replaceable season/device
contracts and instructions for obtaining external assets. Team CAD, robot code,
private manuals, demo videos, runtime sessions, credentials and benchmark dumps
are excluded. The larger team example contains a replacement contract, not its
private CAD/code assets.

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
portable/native tests, builds native and standalone CLI executables, tests a
relocated offline runtime, builds a VSIX and installs it into an isolated editor
profile. The editor checks CAD edits, colors, revision-matched previews, cache,
runtime repair and example export. It records source revision and VSIX hash.
`CADCOVE_TEST_SOFTWARE_GPU=1` uses SwiftShader for headless CI, not GPU performance
qualification. Actual robot execution additionally needs WPILib/vendor fixtures.
The workflow tests Linux, Windows and macOS; a defined workflow is not evidence
of completed runs on those platforms.

The current local platform is macOS arm64. Earlier candidates passed stock and
WPILib 2026.2.1 installed-editor and actual vendor integration checks. Each new
release must attach its own source/runtime/VSIX hashes and test scope; old
candidate evidence does not qualify new binaries automatically.

## Binary / Marketplace gates still required

- Resolve the final Bun/OCCT corresponding-source, embedded notices and rebuild/
  replacement distribution review. See [licenses](../licenses/README.md),
  [Bun rebuild](BUN-REBUILD.md) and [OCCT rebuild](OCCT-REBUILD.md).
  `dependency-inventory.json` intentionally retains `releaseReady: false` until
  this is closed; development packaging must not bypass it for a stable release.
- Select the real repository URL and publisher account in the extension metadata.
  `cadcove-dev` is a development identity, not an owned Marketplace publisher claim.
- Rebuild the runtime and VSIX for each supported platform. Native packaging must
  include current gameplay, field-conveyor and cargo-collision capabilities.
- Publish the required notices/source materials beside each binary, retain hashes,
  and run installed-extension tests for every advertised platform.
- Verify a new robot workspace: all three agent entry files, CLI discovery,
  JavaScript CAD edit/preview, explicit robot integration, live controls and
  a separate detailed profile. Document calibration and supported device limits.

The checked packager refuses a production VSIX while licensing/publication
metadata is unresolved. A locally tested development candidate is useful for
review but is not represented as a fully cleared Marketplace release.
