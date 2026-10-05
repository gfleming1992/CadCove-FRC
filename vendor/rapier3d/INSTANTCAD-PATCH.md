# Pinned Rapier source and local changes

The current throughput candidate uses eight-contact work claims instead of 64
in the optional parallel narrow phase. Each pair still has one owner, and the
canonical reconciliation order is unchanged. The fresh 2026-09-30 twelve-second
volley replay matches every published serial state. It improves throughput but
does not meet the real-time target; see `docs/CPU-PROFILING.md`.

The CCD candidate also caches exact swept bounds on each pass-local convex
piece. The start pose is immutable; an end-fraction change recomputes its bound.
Before a mesh/compound query, it applies Parry's original local-bounds formula
and BVH traversal. Only an empty traversal skips the original TOI calculation;
possible hits retain the original algorithm, tolerances and fallback sphere.
No target geometry is cached, so deforming mesh targets use their current BVH.
These caches never persist across physics steps or pass between worker threads.
`composite_bounds_tests` checks empty-query results against the original query
across rotations, translations, fractions, sensor and one-sided modes. Full
robot replay and timing qualification are recorded separately before deployment.

Source: published `rapier3d` 0.36.0 crate from crates.io.
Archive SHA-256:
`c2e2b20538584bb3ba5bfe6a66c2d9a242ee17d15e5398be0fa35279c7d73739`.
The archive reports upstream revision `b716d375efc0201003f0cd9ef7168eee0b62c177`
with a dirty tree, so the archive hash, not that Git revision alone, pins this
source. Apache-2.0 license is included from that upstream revision.

The rotation integration change is in:
`src/dynamics/solver/staged_island_solver/worker.rs` uses Rapier's existing exact
`RigidBodyVelocity::integrate` for rigid-body rotation instead of its linearized
quaternion update, normalizing the result to prevent long-run drift. The existing
velocity caps remain in place. The companion
explicitly permits fast rotation for unlimited rotary-joint children.

Why: with the stock linearized update, a shaft at 778.57 rad/s advanced about
3.623 rad per 5 ms tick, versus the expected 3.893 rad. That introduces encoder
travel error in a flywheel. Using exact integration only for the fast shaft
also failed the shared-frame angular-momentum fixture; all supporting rigid
frames must use the same integration rule.

This change is covered by the companion's native tests, including high-speed encoder
travel, a 170-second shaft-normalization run, shared-frame reaction momentum, passive energy, signed gears, loaded
drums, coast/brake, effort caps, continuous turret stops and malformed input.
CAD bank and full-world contact tests are also required before deployment.
Do not delete or weaken those tests when updating this dependency.

`src/dynamics/ccd/sweeps.rs` constructs `FastColliderInfo` lazily, after a
broad-phase candidate passes the existing CCD target, group and hook filters.
Previously it calculated every convex child's centroid even when no target
could be hit. Decomposed CAD shapes made that preparation dominate runtime.
Accepted pairs still use exactly the same sweep description and cast logic;
this does not disable CCD or remove collision geometry. A 400-sample full-world
feed fixture produced identical positions, rotations and velocities before and
after this change. Detailed measurements are in `docs/FEED-PATH.md`.

`src/geometry/collider.rs` stores optional per-shape CCD centroids, refreshed by
`src/pipeline/user_changes.rs` on shape changes and consumed by `sweeps.rs`.
Shape mutation, deformation, replacement, copying and internal-reference reset
invalidate the cache. It is omitted from serialized state; absent caches use the
original exact mass-property calculation. Compound child transforms remain in
the sweep calculation, not the cached local centroid. This removes repeated
convex-polyhedron mass calculations without changing sweep results. The full
feed trajectory remains bit-for-bit identical across this optimization.

Cache invalidation regression (using a separate target directory is optional):

```sh
cargo test --manifest-path vendor/rapier3d/Cargo.toml --target-dir target --release --features serde-serialize --lib centroid_cache_is_invalidated_by_shape_changes
```

The core CAD website/extension does not depend on this crate. It is only part
of the optional native simulation companion. Upstream examples and tests are
retained with the published package manifest; no global Cargo registry files
are modified.

Optional CCD profiling records body, collider-preparation and pair-cast times.
It is disabled by default, omitted from serialized solver state, and cleared
each substep so an inactive pass cannot report stale work. Native diagnostics
map handles back to the authored body IDs and collider indices. Timings do not
participate in collision decisions. This identified spinning intake cylinders
against compound field CAD as the slow match interval's dominant work.

The nonlinear cylinder fallback now tests a clearance bound before casting.
For a cylinder of bounding radius R, symmetry axis a, center offset r from the
rotation center, linear velocity v and angular velocity w, its occupied volume
moves by at most dt * (|v| + |w cross r| + R * |w cross a|). Rotation about a
changes surface material locations but not the cylinder's occupied volume.
The cross-product magnitudes stay constant under this constant-angular-velocity
motion. The integrated bound therefore includes precession and off-center
rotation, even for many revolutions; it is not an endpoint-only estimate.

Only an initial distance exceeding that bound plus collision/floating-point
tolerance skips the original nonlinear cast. Touching, unsupported and
non-finite queries retain the original cast. Sensor pairs use the same bound.
The current fallback already holds the target pose constant; this change does
not alter that target-motion convention. It does not disable CCD or simplify
the authored collision geometry. Tests exercise pure spin, translation,
off-center motion and tilted axes, comparing rejected pairs with sampled poses
and the original nonlinear cast. Match replay evidence is in MATCH-TRIALS.md.

```sh
cargo test --manifest-path vendor/rapier3d/Cargo.toml --target-dir target --release --features serde-serialize --lib cylinder_bound_tests
```

Shape-matching constraints use a nearby particle as the coordinate origin and
f64 accumulation for mass-weighted centroids and linear velocity. Their spring
error is prepared in that local frame instead of constructing a rounded f32
world-space target and subtracting it again. Angular momentum uses velocity
relative to the mass-averaged velocity. Target-driven clusters retain their
external kinematic target. This corrects artificial center-of-mass acceleration
in fast-spinning compliant fuel without imposing an after-the-fact momentum
correction or changing contact coefficients.

`tests/soft-free-flight.js` tests three translations and three substep policies
with no contacts or gravity. Maximum velocity drift over 0.8 seconds changes
from 3.323 m/s to 0.000554 m/s. Upstream shape recovery, rigid-motion preservation
and pinned-cluster tests also pass. The companion roller regression and a fresh
actual Java/Phoenix feed run pass their scoped gates. Contact convergence and
reliable shooting remain unqualified; see `docs/soft-momentum-results.json`.

Optional narrow-phase profiling now times each visited contact pair, recording
its collider handles and update outcome. Each worker writes only its own edge;
there is no shared timing lock in the parallel path. Measurements are cleared
at the beginning of each contact pass and excluded from serialized physics
state. The existing contact decisions, solver ordering and contact layout
inside `PairContacts` are unchanged. These durations include pair processing,
not the whole narrow phase or solver. The companion emits them only with
`INSTANTCAD_PROFILE=1`; the published phase is the last inner substep.

The optional `manifold-audit` feature observes application-tagged query outputs
through solver contact selection and soft-constraint writeback. Its transient
manifold field is excluded from serialization and independent of `user_data`.
Counters never participate in physics decisions. The application resets them
between independent runs and reports them via its diagnostic operation. These
builds must not be used for capacity claims; see CPU-PROFILING.md for parity and
qualification scope.

Soft contact assembly now skips its per-element preparation when a manifold
has no solver contacts. All narrow-phase manifolds, query caches, and indices
remain intact. The skipped calculations previously fed only an empty inner
constraint loop; supplemental vertex/volume passes remain independent. The
2,400-state reference replay and compliant-contact tests pass; the isolated
paired measurement improves mean step time by 3.78% (18.872 to 18.159 ms).

The optional `query-motion` feature exposes a scoped, copied pair context to
an experimental application-side mesh filter. It carries the exact contact
selection inputs and a conservative point-speed reach, including rotation
about each body's center of mass. Only soft/rigid mesh pairs without hooks
publish a context. The context is restored immediately after the dispatcher
returns, including unwind handling, and copied before nested Rayon queries.
No engine selection predicate, integration setting, or material is changed.
The application audits omitted queries on cloned caches along their resulting
trajectory and checks every point against the engine's selection formula.
This feature is not enabled by default; evidence and limitations are recorded
in CPU-PROFILING.md.

`SoftContact::apply` now returns for an exactly zero impulse delta, avoiding
anchor/FEM response traversal that cannot change velocity. Its normal solve
still runs. The friction solve also returns when its admissible impulse limit
is zero and both previous tangent impulses are zero; a previous nonzero
friction impulse still follows the original path so it is removed correctly.
Nonzero impulse arithmetic and contact ordering remain unchanged. Targeted
regressions cover unloaded tangential motion and removal of a previous tangent
impulse. The paired fresh robot replay retains all 3,000 published states and
measures a 10.20% mean-time reduction from the impulse shortcut alone; combined
and varied-case evidence is recorded in CPU-PROFILING.md. These shortcuts do
not relax contact tolerances, remove contacts, or reduce solver iterations.

Large CCD bodies now distribute eight-collider speculative chunks through the
existing Rayon pool (16-collider threshold). Chunks start at the full interval,
but results are reconciled in original order; after an earlier impact tightens
the cutoff, subsequent chunks are recomputed with that cutoff. This preserves
iterative proxy-cast semantics and sensor ordering. Contact-filter callbacks
and unsync-callback builds retain the serial path. The focused engine test
compares positive impacts, sensor ordering and callback counts with the serial
helper. Two full-state heavy replays reduce mean step time by 6.6–6.9%, and
paired intake/shooting/pile replays improve by 7.0–9.5%. Geometry and physical
parameters are unchanged. See CPU-PROFILING.md for scope and remaining limits.
