# Pinned Parry source and local change

Source: published `parry3d` 0.31.1 crate, copied from the Cargo registry.
Archive SHA-256:
`7b626edc0b497dba4bdf6e1e0797895294ed9f61dac2bd28cb5d34d37ad2ca7e`.
The original license and upstream files are retained. Before adding this note,
all 435 copied files were compared with the registry package; only
`src/utils/point_cloud_support_point.rs` differed. The root Cargo patch uses
this directory without changing dependency versions. No global registry files
are modified.

On AArch64, 3D, f32 builds, support-index searches over at least 16 points batch
four dot products through Vec4. Multiplication/addition order is the same as
Vec3::dot, and the scalar strict-greater reduction runs in original point order
so ties keep the first point. Remainder points and smaller clouds use scalar
operations. Other architectures, precisions and dimensions retain the original
implementation. This does not enable eight-lane solver SIMD or change contact
geometry, solver ordering, tolerances, or physical parameters.

The application's `support_point_tests` compares the production utility with
an independent copy of the original scalar reduction, including the threshold,
remainders, scales, ties, signed zero, NaNs and infinities. The standalone
`support-point-throughput` example keeps its scalar reference independent of
the library linked into it. Full-state replay qualification and performance
results are documented in `docs/CPU-PROFILING.md` at the project root. The
isolated kernel benchmark is not an end-to-end performance claim.

Distribution note (2026-10-01): the published crate omitted a root license text.
`LICENSE` was restored from upstream revision
`3383f51cbbe9af70565427e7a66c605e1557c1fc`, matching the package VCS metadata.
Its URL and SHA-256 are recorded in `licenses/upstream.json` at the project root.
