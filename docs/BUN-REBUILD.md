> Historical engineering notes for the optional embedded-Bun developer build.
> Public release packages use externally installed Bun and do not redistribute
> this runtime. The gates below still apply if standalone packaging is selected.

# Compiled CLI runtime source review

CadCove's standalone CLI is built with Bun. This document tracks the source and
rebuild work for that runtime; it does not claim a completed public release or
cross-platform qualification. Teams using an installed toolbox do not need to
install this compiler toolchain.

## Pinned inputs

- Bun 1.4.2: `744846f844374847c902b5e7fd59b4342a51ef99`.
- Bun's WebKit fork: `2e2aa2290fac856d6f451ceacb58f7f5b44dd057`.
- LLVM 21.1.8 and Rust `nightly-2026-07-20`, including `rust-src`.
- Native dependency revisions, patches and archives: `licenses/bun-source.json`.
- Bun's Cargo dependency graph and crate archive checksums:
  `licenses/bun-rust.json`. These checksums come from the pinned Bun Cargo.lock
  and were compared with the downloaded crate archives.
- Browser polyfill lock graph: `licenses/bun-polyfills.json`. All 103 distinct
  package versions are pinned by Bun's SHA-512 integrity values and separately
  hashed source archives, including nested versions of the same package.
- Node.js 26.3.0 compatibility header archive: publisher SHA-256 checksums and
  the matching release license are pinned in `bun-source.json`. Bun retains
  these headers for N-API compatibility; it does not package Node.js itself.

The upstream build scripts are part of the pinned Bun source archive. Its
`rust-toolchain.toml` lists additional development/cross-target components;
the current native rebuild uses the minimal host toolchain plus `rust-src`.
This is separate from the Rust 1.91.1 toolchain used for CadCove's physics binary.

## Prepare source materials

Release maintainers can assemble the acquired inputs without executing a build:

```sh
bun scripts/prepare-bun-source.js \
  --archives /absolute/path/to/upstream-sources \
  --webkit /absolute/path/to/pinned-WebKit \
  --output /absolute/path/to/new-source-materials
```

The archive directory contains the names recorded in `bun-source.json`, plus
`bun-rust/<archive.name>` and `bun-polyfills/<archive.name>` from their respective
inventories. Obtain those exact files from their recorded URLs before running
preparation. Preparation validates every archive's size and SHA-256, copies it,
and checks the copy again. It never downloads dependencies or installs a
compiler. An existing output directory is refused.

WebKit must contain the pinned commit and selected build-source Git objects.
The tool exports those objects through a temporary bare repository, bypassing
partial-clone archive prefetching. It preserves exact blob bytes and executable
modes, suppresses checkout filters, and includes otherwise export-ignored source
files. Working-tree modifications, including the diagnostic relink patch, are
excluded. Git history and unrelated WebKit browser sources are excluded too.
Missing objects cause preparation to fail without lazy fetching. The archive's
timestamp comes from the pinned commit; gzip omits timestamps and source names.

The output includes 309 source archives, the source/notice pins, collected Bun
notices, the optional diagnostic patch, this guide, and a per-file WebKit Git
object inventory. `source-provenance.json` records hashes and source selection.
Extract the Bun and WebKit archives into separate directories, then use the
build procedure below. Native/Rust/polyfill archives are retained as original
inputs; the preparation tool does not prepopulate upstream build caches.

Compiler binaries, platform SDKs and Bun's build-tool npm packages are not in
this collection. CadCove's own source is exported separately with
`export-toolbox-source.js`. This is not yet a verified offline build kit or a
completed corresponding-source distribution audit.

The initial preparation verification produced 308 archives containing
503,041,050 bytes of original/source
archives. All 49,516 WebKit entries were checked against their Git blob IDs,
including symlink targets and executable modes; none were omitted. The optional
diagnostic source modification was absent. A second independent preparation
produced the same WebKit archive SHA-256:
`34f2c4238dcb7ef06ca9359c3c235445d7750f4dbe7f74a80aad57bf881fa8ce`.
The archive is 299,399,026 bytes. Evidence is in
`artifacts/bun-source-materials-qualification.json`. These are source-integrity
checks; the subsequent fresh-build qualification is described below.

The first fresh build revealed the separate Node.js headers download. Its
9,957,179-byte archive is now included, taking the collection to 309 archives
and 512,998,229 bytes. The archive matches Node.js's published SHA-256 and all
110 header files retained in the build cache match it byte for byte. The
upstream build removes conflicting OpenSSL/libuv header directories. Since the
headers archive omits a standalone license, the matching release's full license
inventory is pinned by Git blob ID and source revision.

To use the preserved native archives rather than downloading them again, seed
the exact upstream cache layout into a new directory:

```sh
bun scripts/seed-bun-build-cache.js \
  --archives /absolute/path/to/source-materials/archives \
  --output /absolute/path/to/new-build-cache
export BUN_BUILD_PREFETCH_DIR=/absolute/path/to/new-build-cache/prefetch
```

Pass `--cache-dir=/absolute/path/to/new-build-cache` to the build command below.
The seeder verifies the archives before and after copying, supplies 21 native
tarballs and the Node.js header prefetch entry, and refuses existing output.
It does not populate Cargo/npm package caches; those still require a matching
local cache or network access. The upstream build applies its own pinned native
patches after extraction.

## Current macOS build procedure

Use separate source directories and preserve the pinned archives. GitHub's
WebKit archive endpoint returned HTTP 422 during qualification; a Git checkout
of the pinned commit succeeded. The local review checkout includes
`Source/JavaScriptCore`, `Source/WTF`, `Source/bmalloc`, `Source/cmake`,
`Source/ThirdParty`, `Tools/Scripts`, `Tools/TestWebKitAPI`, `WebKitLibraries`,
`Configurations`, `scripts`, `icu`, `metadata`, `resources`, `.github`, and the
root/ancestor files included by Git's sparse checkout. This is a JSC build
checkout, not a complete WebKit source archive.

From the Bun source directory, with CMake, Ninja and the pinned LLVM tools on
PATH, the qualification invocation is:

```sh
export GIT_SHA=744846f844374847c902b5e7fd59b4342a51ef99
export BUN_WEBKIT_PATH=/absolute/path/to/pinned-WebKit
export BUN_TOOLCHAIN_LLVM=/absolute/path/to/llvm-21.1.8
export BUN_TOOLCHAIN_RUST=/absolute/path/to/nightly-2026-07-20-sysroot
export RUSTUP_TOOLCHAIN=nightly-2026-07-20
export CARGO_BUILD_JOBS=4
export CMAKE_BUILD_PARALLEL_LEVEL=4
bun install --frozen-lockfile --ignore-scripts
bun scripts/build.ts --profile=release-local --build-dir=build/cadcove-release-local -j4
```

`BUN_TOOLCHAIN_RUST` is the **sysroot directory**, not the `rustc` executable.
`GIT_SHA` prevents an extracted source directory nested in another repository
from accidentally embedding that repository's revision. The outer Ninja job
limit and nested CMake/Cargo limits are separate; four outer jobs does not cap
the whole process tree at four threads.

Upstream local macOS builds target the installed SDK's major version; the
current host therefore configures macOS 26. Upstream CI defaults to macOS 13.
A successful local build alone will not establish compatibility with older
macOS versions or with Linux/Windows.

## Evidence and remaining work

The full local build completed after installing the missing `rust-src`
component. JavaScriptCore's shell passed a JavaScript/typed-array smoke check;
Bun passed SQLite, compression and Argon2 checks. Runtime candidate
`0.1.0-dev.22`, compiled with this rebuilt Bun, passed the relocated-runtime
suite without Bun/Cargo on PATH. This covers CLI initialization, knowledge
search, example/bridge export and offline reuse, not full robot launch.

`licenses/patches/bun-jsc-relink-probe.patch` is a **qualification-only**
modification to JSC initialization. When `CADCOVE_JSC_RELINK_PROBE` is set, it
prints a diagnostic to stderr. This makes the changed library observable from
both Bun and a CLI compiled with that Bun; normal CLI JSON/stdout stays separate.
The patch is not intended for the production runtime. The modified library
rebuilt successfully and its diagnostic appeared in both Bun and the newly
compiled CadCove CLI, while it remained absent from the unmodified runtime/CLI.
The diagnostic CLI also passed the relocated-runtime suite and emitted no
stderr with the probe disabled. Evidence is recorded in
`artifacts/bun-rebuild-qualification.json`. This proves a functional JSC
modification/relink path on this host. The unmodified source-built CLI also
passed the installed WPILib 2026 editor checks: CAD edit/cache/error recovery,
runtime repair, colored example export, actual robot simulation, practice
focus-pause, camera/capture and clean teardown. Evidence is in
`artifacts/bun-source-runtime-editor-qualification.json`. Final distribution
review and qualification on other platforms remain.

The notice inventory includes 16 exact license texts from the pinned JSC/WTF/
bmalloc tree and 348 texts for Bun's 181 external Cargo packages. Git supplements
are pinned to the source revision recorded in the published crate. The
`r-efi` license grant and attributions are retained from its `AUTHORS` file.
The `selectors` source-header grant is retained alongside the full MPL 2.0
text from Mozilla, the license steward. The inventory now contains notice texts
for all 181 packages. This conservative graph includes build/platform packages
and is not a linked-binary map.

The nightly Rust compiler's generated `COPYRIGHT-library.html` is checked against
the official compiler archive and installed copy. That archive and `rust-src`
are retained with their official distribution checksums. Four additional
in-tree records preserve Bun's uSockets, uWebSockets, clap and SQLite notices.

The release binary embeds compressed browser polyfills used by Bun's bundler.
Their 103 package archives total 1,219,388 bytes. The notice inventory preserves
105 exact package notice texts, including nine README license sections, plus
seven leading attribution comments from adapted in-tree JavaScript files.
README sections and source comments retain archive byte ranges. Every locked
package now has a notice; this does not establish that every file's attribution
is covered or that every package contributes code to this platform's binary.
Release inventory generation rejects changed inventory hashes, notice text or
notice-to-archive provenance. These additions are not yet in the v22 candidate.

### Fresh build from extracted materials

The original Bun archive and generated WebKit archive were extracted into new
directories, with no WebKit Git checkout or previous build outputs. A separate
native download cache was seeded from the preserved archives. Bun's frozen npm
dependencies and the existing compiler/SDK installations were used; this was
not a fully isolated offline build. The build completed on macOS 26 arm64.
The upstream linker emitted alignment warnings, retained in the build log.

The resulting JavaScriptCore shell passed a JavaScript/typed-array check. Bun
passed revision, SQLite, compression and password-hashing checks. It compiled
CadCove `0.1.0-dev.23`, which passed the relocated-runtime suite with no Bun or
Cargo on the runtime PATH. The installed VSIX then passed the pinned WPILib
2026.2.1/VS Code 1.105.1 CAD and actual robot simulation checks, including repair,
cache reuse, camera/capture, practice focus-pause and clean shutdown.

Evidence: `artifacts/bun-source-bundle-rebuild-qualification.json` and
`artifacts/bun-source-bundle-installed-report.json`. Logs are under
`build/bun-materials-rebuild/`. The newly built Bun binary differs from the
previous local build: this establishes a functional rebuild from the collected
sources, not bit-for-bit binary reproducibility. It does not qualify older
macOS releases or other operating systems.

Still required: complete file-level notice review, final source bundle and
distribution review. Generating the
inventory leaves `releaseReady` false. No release source archive or replacement
runtime is published by this procedure.
