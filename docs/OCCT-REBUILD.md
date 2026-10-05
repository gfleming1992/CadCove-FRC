# Rebuilding and replacing the CAD kernel

This is an engineering workflow for modifying the OCCT dependency. Teams using
the normal extension do not need Rust, Emscripten, CMake, Ninja or Python for CAD.
The existing JavaScript/brepjs interface and FRC integration remain separate.

## Source inputs

`licenses/occt-source.json` pins five complete archives: occt-wasm 5.3.2's facade
and API sources, its exact OCCT submodule, RapidJSON 1.1.0, Emsdk 5.0.3, and the
matching Emscripten source commit. Emsdk is the SDK installer; the separate
Emscripten archive preserves its compiler-driver, JavaScript runtime and C/C++
runtime-library sources and notices. It is extracted under
`toolchain-sources/emscripten/`, separately from the installed SDK. The usual
build still uses `emsdk install/activate`; the retained source tree does not
silently replace its tool binaries or cached system libraries.
Download the URLs in that manifest into a local directory using their recorded
filenames. Keep those original archives with the release's source materials.
Do not replace a hash merely because a download changed; review the new bytes.

```sh
bun scripts/prepare-occt-source.js \
  --archives artifacts/upstream-sources \
  --output build/occt-source-kit \
  --jobs 4
```

Preparation is offline and refuses an existing output directory. It verifies
all archive hashes before extraction, retains the complete originals, and records
the before/after hashes and exact text of two patches in `source-provenance.json`:

- The RapidJSON assignment fix from upstream `scripts/fetch-rapidjson.sh`.
- A bounded job count in the OCCT build command. No geometry implementation or
  compiler optimization flags are changed by this scheduling patch.

RapidJSON's complete upstream license inventory is retained. Headers used by
this build have MIT/BSD notices; the archive also contains a separate JSON-checker
test corpus with its own terms. That corpus is not extracted into the include
tree or represented as MIT-licensed compiled code.

## Build

The reviewed upstream build selects Emsdk 5.0.3 and Rust 1.95.0. These are the
**kernel build** tools; the native physics release uses its own pinned compiler.
Install CMake and Ninja (locally exercised Ninja 1.13.0), and Rust 1.95.0 through
rustup. The following shell workflow is for macOS/Linux:

```sh
cd build/occt-source-kit/emsdk
python3 emsdk.py install 5.0.3
python3 emsdk.py activate 5.0.3
source ./emsdk_env.sh
cd ../source
# Explicit RUSTC also works when PATH contains a non-rustup rustc executable.
export RUSTC="$(rustup which --toolchain 1.95.0 rustc)"
# Use a fresh prepared source tree when changing these flags. Compiler environment
# changes do not invalidate every existing CMake/facade object automatically.
export EMCC_CFLAGS="-ffile-prefix-map=\"$PWD=/cadcove/occt-source\" -ffile-prefix-map=\"$EMSDK=/cadcove/emsdk\""
rustup run 1.95.0 cargo run --locked --package xtask -- build-occt && \
  rustup run 1.95.0 cargo run --locked --package xtask -- build --release
```

SDK installation and Cargo may download their pinned dependencies; preparation
alone is offline. The generated pair is `source/dist/occt-wasm.js` and
`source/dist/occt-wasm.wasm`. Do not mix a loader from one build with another
build's WASM export table. Always run `build-occt` before `build --release`,
including after source edits or an interrupted build: upstream's release command
skips the kernel build if a library directory already exists. Preserve the full
build log and record host/tool
versions alongside the source provenance. End users may modify the source tree;
record their patch/diff separately from the unmodified source archives.

## Build a replacement extension

From the CadCove source root, using a packaged runtime:

```sh
bun scripts/build-toolbox-extension.js \
  --runtime artifacts/runtime-candidate \
  --occt-dist build/occt-source-kit/source/dist
bun scripts/package-toolbox-extension.js \
  --extension build/toolbox-extension-darwin-arm64 \
  --output artifacts/cadcove-rebuilt-kernel.vsix --development
bun scripts/test-toolbox-extension.js artifacts/cadcove-rebuilt-kernel.vsix
```

Use the appropriate staging target on another platform. The replacement preserves
the pinned JS API adapter, so source modifications must retain that interface;
changing the facade API requires updating that adapter too. The bundler verifies
that it actually selected the supplied loader. The VSIX records kernel/loader
hashes, the adapter entry hash, core revision, and the runtime cache identity.
Scene revisions include that identity, preventing reuse of meshes from an older
kernel. Both the editor host and webview use the same identity; CLI feedback
checks use the identity saved with the scene that was actually built.

The top-level `dependency-inventory.json` describes the browser kernel included
in this extension. The separately hashed `runtime/dependency-inventory.json`
remains the record supplied with the standalone runtime package. Development
replacement builds remain explicitly unqualified for production publication.
Packaging checks that the staged kernel matches its inventory and build record,
then verifies critical file bytes inside the resulting VSIX.

## Evidence and remaining release work

Source preparation, the installed extension's normal kernel path, cache
identity changes and CLI feedback must each be tested. A successful rebuild and
replacement test demonstrate replaceability; they do not establish byte-for-byte
reproduction of the npm WASM. Upstream's release workflow uses a mutable builder
image, so matching tags alone cannot establish that stronger claim.

On 2026-10-01 the complete source build finished on macOS arm64 with Emsdk 5.0.3,
Rust 1.95.0, CMake 4.4.3 and Ninja 1.13.0. After rebuilding from a fresh tree with
the source-path remapping above, the WASM is 22,257,641 bytes,
SHA-256 `8b6f38c5aca12a4982389fef364f09ff81906016958c403bfd76e5fa98d2c8c2`;
the paired generated loader is
`540c2f3660d2d0436a2351b6b2daffcdf0624edcd6727495a82bca065e1fb889`.
It differs from the recorded npm WASM checksum. No bit-for-bit reproduction is
claimed.

A replacement VSIX with runtime 0.1.0-dev.19 was installed in an isolated
VS Code 1.105.1 profile with WPILib 2026.2.1 and its installer-selected Java/C++
extensions. WPILib activation was verified. It built a colored plate with fillets and a through-hole,
edited its width, preserved the scene on a deliberate failed edit, recovered,
reopened from disk cache without loading the worker, returned revision-matched
CLI status/preview, and repaired its runtime while an older native process lived.
It also launched the independently authored training robot through the packaged
CLI, rendered 17 parts, exercised agent capture/camera and practice focus-loss
disable, and stopped cleanly. Local evidence is retained in
`artifacts/occt-remapped-qualification.json`,
`artifacts/occt-remapped-installed-report.json`, and the source kit's build log and
environment record. These checks cover this installed macOS kernel replacement;
they do not establish Windows/Linux, all-API coverage or real-robot calibration.

The final binary contains the normalized `/cadcove/occt-source/` diagnostic path;
the local checkout path and `/Users/`/`/home/` paths were absent in the scan.
The earlier unremapped build and its evidence remain separate historical artifacts.

The matching Emscripten source archive was subsequently added to the source kit
(34,477,324 bytes; SHA-256
`8c8c413026dd7b86b0acf7e4b48cb718956c21a053887f2a628168dd1ba2cb33`).
Offline preparation verified and preserved all five archives. Comparing `system/`,
`src/`, `tools/`, `cmake/`, and the root license, authors and compiler-driver files
against the SDK used for the qualified build found 6,047 identical files
(39,966,173 bytes) and no differing files in that scope. The SDK omits 32 source
maintenance/configuration files and adds two generated shell entry points; both
entry points match the source template. Release version metadata is `5.0.3`,
whereas the source revision carries `5.0.3-git`. All six separately retained
runtime notices also match the archive. The detailed local comparison is
`artifacts/emscripten-runtime-source-comparison.json`.
This verifies retained source correspondence within the stated scope; it is not
a linked-library map or a new kernel rebuild. The qualified loader/WASM bytes
above are unchanged.

Review the complete source/build materials and remaining embedded notice scope
before removing the OCCT distribution gate. Other release gates in
`licenses/README.md` still apply; these tools do not publish a release or assert
licensing completeness.
