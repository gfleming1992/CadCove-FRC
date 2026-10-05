# Third-party release inventory

Original CadCove code is MIT licensed under the repository's `LICENSE`, including
the independently maintained browser CAD core (whose license is retained under
`vendor/cad-core/LICENSE`). This does not relicense any third-party dependency,
team robot assets, FIRST field/manual content, or the separate NativeCAD app.

`bun scripts/dependency-notices.js --output build/dependency-review` creates
`THIRD-PARTY-NOTICES.txt` and `dependency-inventory.json`. Runtime packaging
includes both as hashed, nonexecutable files; the VSIX also exposes the notices
at its root. This tool collects evidence and preserves texts. It does not label
an incomplete review as compliance or silently turn a package's metadata into
permission to redistribute its binary.

## Scope and sources

The inventory covers the locked Cargo dependency graph for the optimized native
feature set (conservatively including build/platform dependencies), the browser
CAD dependency closure, editor esbuild compiler/platform binary, compiled Bun
runtime, and the separate OCCT WASM kernel. Robot programs, WPILib and vendor
SDKs supplied by a team are not bundled or relicensed by this inventory.

The installed training-example bundle contains the pinned official
LimelightHelpers 1.14 **source**, including its MIT notice. The generated inventory
includes this source component and validates its recorded hashes. It does not
include CTRE/WPILib JARs or desktop native vendor binaries; those are resolved by
the team's robot build using its installed SDK and official vendordep descriptor.

Rust's standard library is inventoried separately from the Cargo graph. The
reviewed compiler is Rust 1.91.1, commit
`ed61e7d7e242494fb7057f2657300d9e77bb4fcb`. Its exact generated
`COPYRIGHT-library.html` (including bundled dependencies and exceptions) was
extracted from the official compiler distribution, whose checksum and archive
entry are recorded in `upstream.json`. Builds require this compiler release.
The build emits an adjacent `.build.json` record; packaging verifies the native
binary digest, target, feature set and dependency-lock digest, then distributes
`native-build.json`. This catches stale/mismatched local artifacts; it is not a
signed supply-chain attestation or a claim that all platforms have been tested.

Where package archives include license/notice files, their exact texts and
hashes are retained. `upstream.json` pins supplementary files omitted from those
archives to exact upstream commits. Updating a supplement requires reviewing
its version/source and recording the new SHA-256; builds reject changed bytes.
The Parry license restored into the vendored crate comes from its package VCS
revision. Source-export policy includes this directory and the vendored license.

The npm `occt-wasm` tooling declaration is MIT OR Apache-2.0. Its README declares
compiled WASM output separately as LGPL-2.1-only. We therefore inventory two
components, record the exact WASM digest, and preserve both the OCCT LGPL text
and upstream exception document without substituting the wrapper's license.
The source pin is OCCT commit `055a9a8a2b3fbb33da2ec9a5445d2b97ffbcd765`, the
submodule recorded by `occt-wasm` tag `v5.3.2` at
`648410061fd93f2c97c65b3401f9883faaa3699e`.

`occt-source.json` pins the wrapper, kernel, RapidJSON, Emsdk and the exact
Emscripten source archives. The Emscripten tree retains the driver, JavaScript
runtime and C/C++ runtime sources separately from the SDK installer. The
offline source-preparation tool preserves originals and records the exact
RapidJSON compatibility patch and bounded build concurrency change. See
[OCCT rebuild/replacement](../docs/OCCT-REBUILD.md). RapidJSON's full upstream
license inventory is included separately from the OCCT and wrapper notices.
Archive preparation is not proof of binary correspondence or completed review
of Emscripten's embedded runtime libraries.
The Emscripten 5.0.3 LICENSE, musl COPYRIGHT, and libc++, libc++abi, compiler-rt
and libunwind notices are pinned to source commit
`285c424dfa9e83b03cf8490c65ceadb7c45f28eb` and compared with the installed SDK.
These preserve those runtime-library notices and exceptions; they do not close
the remaining full-bundle source/notice review automatically.

Five OCCT in-tree source components now preserve six additional embedded notice
headers: DELABELLA (both implementation and header), FlexLexer, the DejaVu font,
Halton sampler and Khronos platform header. `occt-source.json` lists their source
paths and retained notices. Each notice has the verified kernel archive hash,
entry and exact byte range in `upstream.json`; packaging validates that mapping
and the retained text hash. These were extracted from the pinned archive, not
copied from an unverified build checkout.

This is a conservative source inventory. The qualified build disables the visualization
module and FreeType; retaining those source notices does not claim their
code/font data is linked into the WASM. DELABELLA is in the modeling mesh source.
The six headers were found by a targeted permission-notice scan, not a complete
file-level license audit. The remaining distribution-review gates stay open.

Bun `1.4.2` corresponds to upstream commit
`744846f844374847c902b5e7fd59b4342a51ef99`. Its upstream LICENSE.md lists additional
embedded libraries and discusses rebuilding with JavaScriptCore changes. That
file is preserved as an upstream inventory, not misrepresented as all embedded
license texts. The release tool rejects an unreviewed Bun version.

`bun-source.json` records the complete Bun source archive's checksum/size, 21
native GitHub dependency declarations and their source-file hashes, referenced
patches, and the WebKit revision. These are source-level pins, not proof that
every library is linked in every platform configuration. The full Bun archive
is retained locally under `artifacts/upstream-sources/`. All 21 native archives
are now retained and individually pinned by byte count and SHA-256 (105,661,452
bytes total, excluding the Bun archive). Brotli's upstream declaration uses the
`v1.1.0` tag; the archive checksum pins the reviewed bytes even if that tag moves.

The inventory preserves 44 native-dependency notice texts with their exact
archive entries and checksums, including nested source/test notices, authors,
patent grants, JPEG's `README.ijg`, and picohttpparser's initial license comment.
For that comment, `archiveByteRange` identifies the exact preserved bytes in
the source file. The generator includes a separate component record for each
native dependency and rejects missing notices or mismatched archive provenance.
These are conservative build-source records; test/build notices are retained
without claiming their code is linked into the executable. SQLite's in-tree
implementation, Node headers, WebKit, and transitive Rust dependencies are not
among these 21 archives. Bun's macOS default uses system SQLite, whereas its
Linux/Windows builds compile the in-tree SQLite implementation.

TinyCC's source headers contain additional license/copyright notices that remain
in its archive. These records do not establish complete notice coverage or a
successful Bun/WebKit/TinyCC rebuild and relink. The Bun source archive also
contains in-tree/Rust/polyfill dependencies outside the 21 native declarations;
those still need review. Do not treat a link to a repository as a replacement
for assembling and verifying the final release source materials.

The JSC build checkout is now pinned and 16 JavaScriptCore/WTF/bmalloc license
texts are collected with Git blob provenance. `bun-rust.json` adds 181 external
Cargo packages, whose 26,354,160 bytes of crate archives were checked against
Bun's lockfile. It records 348 notice texts, including pinned upstream supplements
and notices under `LICENSES/`. `r-efi`'s grant/attributions are in `AUTHORS`;
`selectors`' source grant is accompanied by Mozilla's full MPL 2.0 text. All 181
packages now have collected notices. Bun's source-build Rust standard-library
copyright inventory is preserved from the official compiler distribution, with
the matching `rust-src` archive pinned separately. Four in-tree records cover
uSockets, uWebSockets, clap and SQLite. These additions do not replace the
remaining file-level and complete distribution review. See
[Bun rebuild review](../docs/BUN-REBUILD.md) for the current build procedure and
the remaining source, toolchain and relink work.

`bun-polyfills.json` adds the exact browser-fallback dependency graph from Bun's
lockfile: 103 package versions, 1,219,388 bytes of source archives checked against
the upstream SHA-512 integrity values, and 105 collected notices. Nine packages
carry their license grants in README sections; the retained text includes exact
archive byte ranges. Seven in-tree attribution headers are retained separately.
This is a conservative source inventory, not proof of complete file-level
coverage or a linked-binary map. Packaging checks the inventory and notice pins.

The fresh source rebuild also identified Node.js 26.3.0 compatibility headers.
Their archive is checked against the publisher's checksum, with the matching
release license pinned by Git blob ID. Bun removes conflicting OpenSSL/libuv
headers and does not ship the Node.js runtime. Source preparation now preserves
this additional archive. The rebuilt CLI and installed editor passed on macOS;
complete file-level and release-distribution review still remain.

Primary source documents are linked in `upstream.json` and generated inventory.

## Unfinished release gates

The inventory deliberately reports `releaseReady: false` while these remain:

- Complete Bun's embedded-component notice inventory and provide/review the
  corresponding source and rebuild/relink materials for the compiled CLI.
- Archive/review the matching OCCT WASM build sources, facade, submodule and
  toolchain; document and verify the end-user replacement/rebuild workflow.
- Review the complete resulting release bundle and publication identity.

A final (non-prerelease) runtime version cannot be packaged while these gates
are unresolved. Development candidates still carry the inventory and its
unresolved items so missing work is visible. No source archive or binary has
been published as a result of generating notices.
