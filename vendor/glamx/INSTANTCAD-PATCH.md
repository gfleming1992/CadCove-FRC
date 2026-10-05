# Local eigensolver correction

Upstream: `glamx` 0.3.1, crates.io SHA-256
`28d74079318e3a077bd3d15faa90fde24fa37bb9f157f92f853e6019a15fd413`.
MIT / Apache-2.0 licenses are retained beside the source.

`src/eigen3.rs` changes:

- Normalize a symmetric matrix before solving, and rescale its eigenvalues.
  The original absolute `1e-20` threshold compares squared cross-product norms
  (fourth power of matrix scale). Small but anisotropic CAD inertia tensors
  consequently selected the X-axis fallback and lost their principal frame.
- Select the better-separated extremal eigenvalue for the first eigenvector.
  That cross-product solve requires a simple root; always choosing the smallest
  root is invalid when the two lower roots coincide. Output stays ascending
  with an orthonormal frame. Eigenvector signs can differ without changing the
  decomposition; the original known-vector test accounts for those signs.
- Add scale/repeated-root/reconstruction/residual tests, including zero and
  scales from 1e-30 through 1e30.

Verification: `cargo test --manifest-path vendor/glamx/Cargo.toml --release`.
The native application's analytic compound-cylinder and inclined eight-shaft
motor/energy tests exercise the fix through Rapier/Parry, without CAD assets.

This patch only belongs to the FRC companion's native dependency tree. The
generic InstantCAD app and its browser bundle do not depend on this crate.
