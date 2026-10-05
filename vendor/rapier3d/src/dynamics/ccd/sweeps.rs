//! Sweep machinery of the continuous-collision pass: fast-collider descriptions,
//! per-pair time-of-impact casts (proxy sweeps + nonlinear fallback),
//! and the per-body continuous solve.

use super::ccd_solver::{BodySweepProfile, ColliderSweepProfile, PairSweepProfile};
use core::cell::{Cell, OnceCell};
use crate::alloc_prelude::*;
use crate::dynamics::{RigidBody, RigidBodyHandle, RigidBodySet, SoftBodySet};
use crate::geometry::{Collider, ColliderHandle, ColliderSet};
use crate::math::{Pose, Real, Vector};
use crate::parry::bounding_volume::Aabb;
use crate::parry::bounding_volume::BoundingVolume;
use crate::parry::partitioning::Bvh;
use crate::pipeline::{ActiveHooks, PairFilterContext, PhysicsHooks};
#[cfg(feature = "dim2")]
use parry::query::sweep_toi::CORE_FRACTION;
use parry::query::sweep_toi::{
    Sweep, SweepCompositeFastShape, SweepToiStatus, ToiProxy, sweep_time_of_impact,
    sweep_time_of_impact_composite,
};
use parry::query::{NonlinearRigidMotion, QueryDispatcher};
use parry::shape::{Shape, TypedShape};

struct SweepTimer {
    #[cfg(feature = "profiler")]
    start: Option<web_time::Instant>,
}
impl SweepTimer {
    fn new(_enabled: bool) -> Self {
        Self {
            #[cfg(feature = "profiler")]
            start: _enabled.then(web_time::Instant::now),
        }
    }
    fn ms(&self) -> f64 {
        #[cfg(feature = "profiler")]
        {
            return self
                .start
                .map_or(0.0, |t| t.elapsed().as_secs_f64() * 1000.0);
        }
        #[cfg(not(feature = "profiler"))]
        {
            0.0
        }
    }
}

/// Is `rb` a *fixed* CCD target? A parentless collider (`rb == None`) and a
/// `Fixed` parent body are both fixed. Kinematic and dynamic parents are not.
fn is_fixed_target(rb: Option<&RigidBody>) -> bool {
    rb.map(|b| b.is_fixed()).unwrap_or(true)
}

/// Is `co` a target of the automatic (non-bullet) tier: fixed geometry, plus the deformable
/// collision meshes of soft bodies (surfaces of no thickness, never swept, taken at their
/// start-of-step geometry).
fn is_auto_target(rb: Option<&RigidBody>, co: &Collider) -> bool {
    is_fixed_target(rb) || co.is_deformable_collider()
}

/// Is `rb` a bullet (a dynamic body with the full-CCD upgrade)? Bullets never sweep against
/// other bullets.
pub(super) fn is_bullet(rb: &RigidBody) -> bool {
    rb.is_dynamic() && rb.ccd.ccd_enabled
}

/// The target-selection rule for a fast body `rb1`: a non-bullet fast body only sweeps
/// against automatic targets (fixed geometry and soft-body meshes); a bullet sweeps against
/// every body type except other bullets.
fn tier_allows(rb1: &RigidBody, rb2: Option<&RigidBody>, co2: &Collider) -> bool {
    if is_bullet(rb1) {
        !rb2.map(is_bullet).unwrap_or(false)
    } else {
        is_auto_target(rb2, co2)
    }
}

/// Returns `true` if the user's `filter_contact_pair` hook rejected this pair. Mirrors the
/// narrow-phase filter in `NarrowPhase::compute_contacts` so CCD respects the same user-level
/// filtering (issue #754).
#[inline]
#[allow(clippy::too_many_arguments)]
fn pair_filtered_out_by_hooks(
    hooks: &dyn PhysicsHooks,
    bodies: &RigidBodySet,
    colliders: &ColliderSet,
    co1: &Collider,
    co2: &Collider,
    ch1: ColliderHandle,
    ch2: ColliderHandle,
    bh1: RigidBodyHandle,
    bh2: Option<RigidBodyHandle>,
) -> bool {
    let active_hooks = co1.flags.active_hooks | co2.flags.active_hooks;
    if !active_hooks.contains(ActiveHooks::FILTER_CONTACT_PAIRS) {
        return false;
    }
    let context = PairFilterContext {
        bodies,
        colliders,
        rigid_body1: Some(bh1),
        rigid_body2: bh2,
        collider1: ch1,
        collider2: ch2,
    };
    hooks.filter_contact_pair(&context).is_none()
}

/// Is this shape one of the composite shapes handled by
/// [`sweep_time_of_impact_composite`]?
fn is_composite_shape(shape: &dyn Shape) -> bool {
    matches!(
        shape.as_typed_shape(),
        TypedShape::TriMesh(_)
            | TypedShape::Polyline(_)
            | TypedShape::HeightField(_)
            | TypedShape::Compound(_)
    )
}

/// Is this a shape the continuous phase never sweeps as the *fast* (moving) shape?
/// Mesh-like bodies rely on speculative contacts only. Also kept out of `ccd_thickness`:
/// a mesh's zero thickness would flag the body fast every step for nothing.
pub(crate) fn shape_never_ccd_swept(shape: &dyn Shape) -> bool {
    matches!(
        shape.as_typed_shape(),
        TypedShape::TriMesh(_)
            | TypedShape::Polyline(_)
            | TypedShape::HeightField(_)
            | TypedShape::Voxels(_)
    )
}

/// The pose a target collider holds during the continuous pass. Targets are stationary at
/// their end-of-step pose (static targets trivially; dynamic/kinematic targets of bullets
/// read the — possibly already clamped — solved `next_position`).
fn target_collider_pose(co: &Collider, rb: Option<&RigidBody>) -> Pose {
    match (rb, co.parent.as_ref()) {
        (Some(rb), Some(parent)) => rb.pos.next_position * parent.pos_wrt_parent,
        _ => co.pos.0,
    }
}

/// Iterates the enabled colliders whose broad-phase (swept) AABB intersects `aabb`. Queries the
/// BVH directly (not via `QueryPipeline`) so the closure stays `Sync` for the parallel per-body
/// sweeps; the CCD sites use the default, pass-everything query filter anyway.
fn intersect_swept_aabb<'a>(
    bvh: &'a Bvh,
    colliders: &'a ColliderSet,
    aabb: Aabb,
) -> impl Iterator<Item = (ColliderHandle, &'a Collider)> + 'a {
    bvh.leaves(move |node| node.aabb().intersects(&aabb))
        .filter_map(move |leaf| {
            // NOTE: do **not** recompute and check the latest collider AABB: checking only
            //       against the one in the BVH is what makes the query conservative (the
            //       leaves hold the swept AABBs).
            let (co, ch) = colliders.get_unknown_gen(leaf)?;
            Some((ch, co))
        })
}

/// The targets a fast body sweeps against. Non-bullets only hit automatic targets, so flat AABB
/// lists skip walking the shared BVH; bullets and fixed-heavy worlds use the full BVH.
#[derive(Copy, Clone)]
pub(super) enum CcdTargets<'a> {
    /// Flat lists of the automatic targets and their (slightly fattened) AABBs: the cached
    /// fixed colliders, and the soft-body collision meshes (rebuilt every step, as they deform).
    Lists {
        /// The fixed colliders.
        fixed: &'a [(ColliderHandle, Aabb)],
        /// The soft-body collision meshes.
        soft: &'a [(ColliderHandle, Aabb)],
    },
    /// The full broad-phase BVH.
    FullBvh(&'a Bvh),
}

/// Maximum number of fixed colliders stored in the flat list before falling back to the
/// full broad-phase BVH.
const FIXED_TARGETS_LIST_MAX: usize = 512;

/// Collects the enabled fixed-target colliders (parentless + attached to `Fixed` bodies),
/// AABBs fattened by the prediction (speculative) distance. Returns `None` when there are
/// more than [`FIXED_TARGETS_LIST_MAX`] of them.
pub(super) fn collect_fixed_targets(
    bodies: &RigidBodySet,
    colliders: &ColliderSet,
    prediction_distance: Real,
) -> Option<Vec<(ColliderHandle, Aabb)>> {
    let mut fixed = Vec::new();
    for (ch, co) in colliders.iter_enabled() {
        let rb = co.parent.and_then(|p| bodies.get(p.handle));
        if is_fixed_target(rb) {
            if fixed.len() == FIXED_TARGETS_LIST_MAX {
                return None;
            }
            let aabb = co.shape.compute_aabb(&co.pos).loosened(prediction_distance);
            fixed.push((ch, aabb));
        }
    }
    Some(fixed)
}

/// Collects the enabled soft-body collision meshes and their AABBs, fattened by the prediction
/// (speculative) distance. Rebuilt every step: unlike the fixed targets, a mesh deforms with its
/// particles without any scene change.
pub(super) fn collect_soft_targets(
    soft_bodies: &SoftBodySet,
    colliders: &ColliderSet,
    prediction_distance: Real,
) -> Vec<(ColliderHandle, Aabb)> {
    let mut soft = Vec::new();
    for (_, sb) in soft_bodies.iter() {
        for mesh in sb.meshes() {
            let ch = mesh.collider();
            let Some(co) = colliders.get(ch).filter(|co| co.is_enabled()) else {
                continue;
            };
            let aabb = co.shape.compute_aabb(&co.pos).loosened(prediction_distance);
            soft.push((ch, aabb));
        }
    }
    soft
}

/// A convex piece of the fast collider: its point-cloud proxy plus its own sweep (the
/// collider's sweep composed with the piece's local pose for compound children).
struct FastSubShape<'a> {
    proxy: ToiProxy<'a>,
    sweep: Sweep,
    /// The piece's centroid in its sweep's local frame, used for the initial-overlap core
    /// ball.
    local_centroid: Vector,
    /// The piece's smallest extent (inner radius).
    min_extent: Real,
    // This description is local to one body's CCD pass. Its proxy and sweep
    // never change, and no worker shares it. Keep exact endpoint bounds across
    // target queries; a tighter impact fraction recomputes the end bound.
    start_bounds: OnceCell<Aabb>,
    swept_bounds: Cell<Option<(Real, Aabb)>>,
}

impl FastSubShape<'_> {
    fn swept_bounds(&self, fraction: Real) -> Aabb {
        if let Some((previous, bounds)) = self.swept_bounds.get() {
            if previous.to_bits() == fraction.to_bits() {
                return bounds;
            }
        }
        let start = self.start_bounds.get_or_init(|| {
            self.proxy.compute_aabb(&self.sweep.transform_at(0.0))
        });
        let end = self.proxy.compute_aabb(&self.sweep.transform_at(fraction));
        let bounds = start.merged(&end);
        self.swept_bounds.set(Some((fraction, bounds)));
        bounds
    }

    fn composite_has_no_candidates(&self, target: &dyn Shape, pose: &Pose, fraction: Real) -> bool {
        // Use precisely Parry's composite-query bounds and BVH traversal, not
        // an approximate bounding radius or a different collision tolerance.
        // An empty traversal would make its original query return Separated.
        // Accepted queries retain the original TOI and fallback-sphere logic.
        let bvh = match target.as_typed_shape() {
            TypedShape::TriMesh(mesh) => mesh.bvh(),
            TypedShape::Compound(compound) => compound.bvh(),
            _ => return false,
        };
        let local = self.swept_bounds(fraction).transform_by(&pose.inverse());
        bvh.intersect_aabb(&local).next().is_none()
    }
}

/// How the continuous phase sweeps the fast collider's shape.
// Only ever a stack local, built once per fast collider per step: boxing the convex variant
// to even out the sizes would buy an allocation on that path and nothing else.
#[allow(clippy::large_enum_variant)]
enum FastShapeKind<'a> {
    /// A single convex point-cloud shape: the exact proxy sweep.
    Convex(FastSubShape<'a>),
    /// A compound: each point-cloud child sweeps independently, each running its own TOI.
    /// Children without a point-cloud proxy are skipped.
    Compound(Vec<FastSubShape<'a>>),
    /// Cylinders, cones, half-spaces, custom shapes: nonlinear shape-cast fallback.
    Nonlinear,
}

/// Description of the fast collider shared by all its pair casts.
struct FastColliderInfo<'a> {
    collider: &'a Collider,
    body: &'a RigidBody,
    kind: FastShapeKind<'a>,
}

impl<'a> FastColliderInfo<'a> {
    /// Builds the fast-collider description for a sweep from collider pose `start` to `end`, or
    /// `None` for never-swept shapes (meshes, heightfields, polylines, voxels — and compounds with
    /// no point-cloud child). `local_com` makes every sweep rotate about the true center of mass.
    fn new(
        collider: &'a Collider,
        body: &'a RigidBody,
        start: &Pose,
        end: &Pose,
        local_com: Vector,
    ) -> Option<Self> {
        let shape = collider.shape.as_ref();
        if shape_never_ccd_swept(shape) {
            return None;
        }

        let kind = if let Some(proxy) = ToiProxy::from_shape(shape) {
            FastShapeKind::Convex(FastSubShape {
                proxy,
                sweep: Sweep::from_poses(start, end, local_com),
                local_centroid: collider
                    .ccd_centroids
                    .as_ref()
                    .and_then(|c| c.first())
                    .copied()
                    .unwrap_or_else(|| shape.mass_properties(1.0).local_com),
                min_extent: shape.ccd_thickness(),
                start_bounds: OnceCell::new(),
                swept_bounds: Cell::new(None),
            })
        } else if let TypedShape::Compound(compound) = shape.as_typed_shape() {
            let children: Vec<_> = compound
                .shapes()
                .iter()
                .enumerate()
                .filter_map(|(index, (child_pose, child_shape))| {
                    let proxy = ToiProxy::from_shape(child_shape.as_ref())?;
                    Some(FastSubShape {
                        proxy,
                        sweep: Sweep::from_poses(
                            &(*start * *child_pose),
                            &(*end * *child_pose),
                            child_pose.inverse_transform_point(local_com),
                        ),
                        local_centroid: collider
                            .ccd_centroids
                            .as_ref()
                            .and_then(|c| c.get(index))
                            .copied()
                            .unwrap_or_else(|| child_shape.mass_properties(1.0).local_com),
                        min_extent: child_shape.ccd_thickness(),
                        start_bounds: OnceCell::new(),
                        swept_bounds: Cell::new(None),
                    })
                })
                .collect();
            if children.is_empty() {
                return None;
            }
            FastShapeKind::Compound(children)
        } else {
            FastShapeKind::Nonlinear
        };

        Some(Self {
            collider,
            body,
            kind,
        })
    }
}

/// A target collider's shape, classified once per pair before the per-piece casts.
// Stack-local per pair, like [`FastShapeKind`] — indirection would only add an allocation.
#[allow(clippy::large_enum_variant)]
enum TargetKind<'a> {
    /// Point-cloud target: the exact proxy-vs-proxy sweep.
    Proxy(ToiProxy<'a>),
    /// Composite target handled by [`sweep_time_of_impact_composite`].
    Composite,
}

/// A hit against a sensor (or a pair with mismatched solver groups), recorded during the
/// sweep for later intersection-event emission. Never clamps positions.
pub(super) struct PseudoHit {
    pub(super) ch1: ColliderHandle,
    pub(super) ch2: ColliderHandle,
    pub(super) fraction: Real,
}

/// Result of the continuous solve of one fast body.
pub(super) struct BodyContinuousResult {
    pub(super) handle: RigidBodyHandle,
    /// The earliest solid impact fraction in `[0, 1]`; `1.0` if the body sweeps freely.
    pub(super) fraction: Real,
    pub(super) pseudo_hits: Vec<PseudoHit>,
    pub(super) profile: Option<BodySweepProfile>,
}

/// Casts the fast collider against one target and returns the accepted impact fraction.
/// Solid pairs stop only at strictly >0 fractions (on initial overlap, 2D retries with a core
/// ball while 3D advances); pseudo pairs (sensors, mismatched groups) report any genuine impact.
#[allow(clippy::too_many_arguments)]
fn cast_collider_pair(
    dispatcher: &dyn QueryDispatcher,
    fast: &FastColliderInfo,
    co2: &Collider,
    rb2: Option<&RigidBody>,
    max_fraction: Real,
    dt: Real,
    linear_slop: Real,
    is_pseudo: bool,
) -> Option<Real> {
    let target_pose = target_collider_pose(co2, rb2);

    let sub_shapes: &[FastSubShape] = match &fast.kind {
        FastShapeKind::Convex(sub) => core::slice::from_ref(sub),
        FastShapeKind::Compound(children) => children,
        FastShapeKind::Nonlinear => {
            return fallback_nonlinear_fraction(
                dispatcher,
                fast,
                co2,
                &target_pose,
                max_fraction,
                dt,
                linear_slop,
                is_pseudo,
            );
        }
    };

    let shape2 = co2.shape.as_ref();
    let target = match ToiProxy::from_shape(shape2) {
        Some(proxy) => TargetKind::Proxy(proxy),
        None if is_composite_shape(shape2) => TargetKind::Composite,
        // Targets with neither a point-cloud proxy nor a supported composite sweep
        // (cylinders, cones, voxels, custom shapes): one whole-collider nonlinear cast.
        None => {
            return fallback_nonlinear_fraction(
                dispatcher,
                fast,
                co2,
                &target_pose,
                max_fraction,
                dt,
                linear_slop,
                is_pseudo,
            );
        }
    };

    // Each accepted piece fraction tightens `max_fraction`, so the returned value is the
    // earliest impact across all the pieces (both the solid and pseudo accept conditions
    // only pass at or below the current bound).
    let mut best = None;
    let mut max_fraction = max_fraction;
    for sub in sub_shapes {
        if let Some(fraction) = cast_sub_shape(
            sub,
            &target,
            shape2,
            &target_pose,
            max_fraction,
            linear_slop,
            is_pseudo,
        ) {
            best = Some(fraction);
            max_fraction = fraction;
        }
    }
    best
}

/// Casts one convex piece of the fast collider against the target collider's shape and
/// returns the accepted impact fraction (see [`cast_collider_pair`]), or `None`.
fn cast_sub_shape(
    sub: &FastSubShape,
    target: &TargetKind,
    shape2: &dyn Shape,
    target_pose: &Pose,
    max_fraction: Real,
    linear_slop: Real,
    is_pseudo: bool,
) -> Option<Real> {
    let output = match target {
        TargetKind::Proxy(target_proxy) => {
            let target_sweep = Sweep::constant(target_pose, Vector::ZERO);
            sweep_time_of_impact(
                target_proxy,
                &target_sweep,
                &sub.proxy,
                &sub.sweep,
                max_fraction,
                linear_slop,
            )
        }
        TargetKind::Composite => {
            if sub.composite_has_no_candidates(shape2, target_pose, max_fraction) {
                return None;
            }
            // Heightfields are treated as one-sided in 3D; oriented polylines and
            // oriented meshes enable the one-sided early-outs from their own flags inside
            // the composite dispatch.
            #[cfg(feature = "dim2")]
            let one_sided = false;
            #[cfg(feature = "dim3")]
            let one_sided = matches!(shape2.as_typed_shape(), TypedShape::HeightField(_));

            let fast_desc = SweepCompositeFastShape {
                proxy: &sub.proxy,
                sweep: &sub.sweep,
                local_centroid: sub.local_centroid,
                min_extent: sub.min_extent,
            };
            sweep_time_of_impact_composite(
                shape2,
                target_pose,
                fast_desc,
                one_sided,
                is_pseudo,
                max_fraction,
                linear_slop,
            )?
        }
    };

    if is_pseudo {
        // Any genuine impact counts (initial overlaps are filtered later by the endpoint
        // intersection re-check); `Separated` does not.
        return match output.status {
            SweepToiStatus::Hit | SweepToiStatus::Failed | SweepToiStatus::Overlapped
                if output.fraction <= max_fraction =>
            {
                Some(output.fraction)
            }
            _ => None,
        };
    }

    if 0.0 < output.fraction && output.fraction < max_fraction {
        return Some(output.fraction);
    }

    #[cfg(feature = "dim2")]
    if output.fraction == 0.0 {
        // Fallback to the TOI of a small core circle around the fast shape centroid,
        // so a body already touching a surface isn't pinned at fraction 0.
        if let TargetKind::Proxy(target_proxy) = target {
            let core = ToiProxy::point(sub.local_centroid, CORE_FRACTION * sub.min_extent);
            let target_sweep = Sweep::constant(target_pose, Vector::ZERO);
            let output = sweep_time_of_impact(
                target_proxy,
                &target_sweep,
                &core,
                &sub.sweep,
                max_fraction,
                linear_slop,
            );
            if 0.0 < output.fraction && output.fraction < max_fraction {
                return Some(output.fraction);
            }
        }
    }

    None
}

/// Nonlinear shape-cast fallback for pairs the proxy sweep can't handle (cylinder, cone or
/// custom fast shapes; cylinder, cone, voxels or custom targets). Motion is derived from
/// the solved effective velocities, like rapier's historical CCD.
fn fallback_nonlinear_fraction(
    dispatcher: &dyn QueryDispatcher,
    fast: &FastColliderInfo,
    co2: &Collider,
    target_pose: &Pose,
    max_fraction: Real,
    dt: Real,
    linear_slop: Real,
    is_pseudo: bool,
) -> Option<Real> {
    if dt == 0.0 {
        return None;
    }

    let rb1 = fast.body;
    let parent1 = fast.collider.parent.as_ref()?;
    let motion1 = NonlinearRigidMotion::new(
        rb1.pos.position,
        rb1.mprops.local_mprops.local_com,
        rb1.ccd_vels.linvel,
        rb1.ccd_vels.angvel,
    )
    .prepend(parent1.pos_wrt_parent);
    let motion2 = NonlinearRigidMotion::constant_position(*target_pose);

    #[cfg(feature = "dim3")]
    if cylinder_stays_separated(
        dispatcher,
        &motion1,
        fast.collider.shape.as_ref(),
        target_pose,
        co2.shape.as_ref(),
        dt,
        linear_slop,
    ) {
        return None;
    }

    let hit = dispatcher
        .cast_shapes_nonlinear(
            &motion1,
            fast.collider.shape.as_ref(),
            &motion2,
            co2.shape.as_ref(),
            0.0,
            dt,
            is_pseudo, // Sensors stop at the first penetration.
        )
        .ok()??;

    let fraction = hit.time_of_impact / dt;
    if is_pseudo {
        (fraction <= max_fraction).then_some(fraction)
    } else {
        (0.0 < fraction && fraction < max_fraction).then_some(fraction)
    }
}

/// Bound the motion of a cylinder's occupied volume, rather than its surface
/// material. Axial spin changes no geometry. Translation, an offset center and
/// precession still contribute; their rates are constant for this rigid motion.
/// A positive initial gap greater than that bound cannot close within the step.
/// Unsupported queries and touching/uncertain pairs retain the original cast.
#[cfg(feature = "dim3")]
fn cylinder_stays_separated(
    dispatcher: &dyn QueryDispatcher,
    motion: &NonlinearRigidMotion,
    shape: &dyn Shape,
    target_pose: &Pose,
    target: &dyn Shape,
    dt: Real,
    linear_slop: Real,
) -> bool {
    let TypedShape::Cylinder(cylinder) = shape.as_typed_shape() else {
        return false;
    };
    let axis = motion.start.rotation * Vector::Y;
    let center_offset = -(motion.start.rotation * motion.local_center);
    let radius =
        (cylinder.half_height * cylinder.half_height + cylinder.radius * cylinder.radius).sqrt();
    let reach = dt
        * (motion.linvel.length()
            + motion.angvel.cross(center_offset).length()
            + radius * motion.angvel.cross(axis).length());
    let pos12 = motion.start.inverse() * *target_pose;
    // Protect the comparison against query/pose floating-point error, in
    // addition to the existing collision tolerance. Non-finite bounds fail open.
    let guard = linear_slop
        + 64.0
            * Real::EPSILON
            * (1.0
                + radius
                + center_offset.length()
                + motion.start.translation.length()
                + target_pose.translation.length()
                + reach);
    reach.is_finite()
        && guard.is_finite()
        && dispatcher
            .distance(&pos12, shape, target)
            .is_ok_and(|gap| gap.distance.is_finite() && gap.distance > reach + guard)
}

#[cfg(all(test, feature = "dim3"))]
mod composite_bounds_tests {
    use super::*;
    use parry::shape::{Compound, SharedShape, TriMesh};

    #[test]
    fn cached_rejections_match_original_composite_queries() {
        let compound = Compound::new(vec![
            (Pose::translation(-0.8, 0.0, 0.0), SharedShape::cuboid(0.15, 0.3, 0.2)),
            (Pose::translation(0.8, 0.0, 0.0), SharedShape::cuboid(0.15, 0.3, 0.2)),
        ]);
        let mesh = TriMesh::new(
            vec![Vector::new(-1.0, 0.0, -1.0), Vector::new(1.0, 0.0, -1.0),
                 Vector::new(1.0, 0.0, 1.0), Vector::new(-1.0, 0.0, 1.0)],
            vec![[0, 1, 2], [0, 2, 3]],
        ).unwrap();
        let shapes: [&dyn Shape; 2] = [&compound, &mesh];
        let mut rejected = 0;
        let mut accepted = 0;
        let mut hits = 0;
        for angle in [0.0, 0.7, 2.9] {
            let start = Pose::from_parts(Vector::new(-1.6, 0.1, 0.0),
                crate::math::Rotation::from_scaled_axis(Vector::Y * angle));
            let end = Pose::from_parts(Vector::new(1.6, -0.1, 0.0),
                crate::math::Rotation::from_scaled_axis(Vector::Z * (angle + 0.4)));
            let shape = SharedShape::cuboid(0.12, 0.15, 0.08);
            let sub = FastSubShape {
                proxy: ToiProxy::from_shape(shape.as_ref()).unwrap(),
                sweep: Sweep::from_poses(&start, &end, Vector::new(0.02, 0.03, 0.0)),
                local_centroid: Vector::ZERO,
                min_extent: 0.08,
                start_bounds: OnceCell::new(),
                swept_bounds: Cell::new(None),
            };
            // Repeated, shrinking and growing fractions exercise cache refresh;
            // changing target geometry and pose must not reuse target bounds.
            for fraction in [1.0, 1.0, 0.6, 0.2, 1.0] {
                let exact = sub.proxy.compute_aabb(&sub.sweep.transform_at(0.0))
                    .merged(&sub.proxy.compute_aabb(&sub.sweep.transform_at(fraction)));
                assert_eq!(sub.swept_bounds(fraction), exact);
                for target in shapes {
                    for offset in [0.0, 0.15, 0.8, 5.0] {
                        let pose = Pose::from_parts(Vector::Y * offset,
                            crate::math::Rotation::from_scaled_axis(Vector::X * angle));
                        for one_sided in [false, true] {
                            for sensor in [false, true] {
                                let raw = sweep_time_of_impact_composite(target, &pose,
                                    SweepCompositeFastShape { proxy: &sub.proxy, sweep: &sub.sweep,
                                        local_centroid: sub.local_centroid, min_extent: sub.min_extent },
                                    one_sided, sensor, fraction, 0.0001).unwrap();
                                if sub.composite_has_no_candidates(target, &pose, fraction) {
                                    rejected += 1;
                                    assert_eq!(raw.status, SweepToiStatus::Separated);
                                    assert_eq!(raw.fraction, fraction);
                                } else {
                                    accepted += 1;
                                    hits += usize::from(raw.fraction > 0.0 && raw.fraction < fraction);
                                }
                            }
                        }
                    }
                }
            }
        }
        assert!(rejected > 0 && accepted > 0 && hits > 0);
    }
}

#[cfg(all(test, feature = "dim3"))]
mod cylinder_bound_tests {
    use super::*;
    use parry::query::DefaultQueryDispatcher;
    use parry::shape::{Cuboid, Cylinder};

    #[test]
    fn axial_spin_clearance_keeps_translation_and_offset_collisions() {
        let shape = Cylinder::new(0.3, 0.04);
        let target = Cuboid::new(Vector::splat(0.02));
        let wall = Pose::translation(0.08, 0.0, 0.0);
        let mut motion = NonlinearRigidMotion::new(
            Pose::IDENTITY,
            Vector::ZERO,
            Vector::ZERO,
            Vector::Y * 1000.0,
        );
        let separated = |m: &NonlinearRigidMotion, pose: &Pose| {
            cylinder_stays_separated(
                &DefaultQueryDispatcher,
                m,
                &shape,
                pose,
                &target,
                0.02,
                0.0001,
            )
        };
        assert!(separated(&motion, &wall));
        assert!(!separated(&motion, &Pose::translation(0.05, 0.0, 0.0)));
        motion.linvel = Vector::X * 2.0;
        assert!(!separated(&motion, &wall));
        motion.linvel = Vector::ZERO;
        motion.local_center = Vector::Z * 0.1;
        assert!(!separated(&motion, &wall));
        motion.local_center = Vector::ZERO;
        motion.angvel += Vector::Z * 100.0;
        assert!(!separated(&motion, &wall));
    }

    #[test]
    fn rejected_cylinder_sweeps_remain_clear_along_nonlinear_motion() {
        let shape = Cylinder::new(0.3, 0.04);
        let target = Cuboid::new(Vector::new(0.012, 0.06, 0.025));
        let mut skipped = 0;
        let mut retained = 0;
        for angular in [
            Vector::Y * 1000.0,
            Vector::new(0.5, 1000.0, 0.8),
            Vector::new(60.0, 200.0, 30.0),
        ] {
            for offset in [Vector::ZERO, Vector::new(0.03, 0.1, -0.01)] {
                let start =
                    Pose::translation(8.0, 4.0, 0.2) * Pose::rotation(Vector::new(0.2, 0.3, -0.4));
                let motion = NonlinearRigidMotion::new(
                    start,
                    offset,
                    Vector::new(0.4, -0.2, 0.1),
                    start.rotation * angular,
                );
                for i in 0..80 {
                    let relative = Vector::new(
                        (i % 8) as Real * 0.04 - 0.14,
                        (i / 8) as Real * 0.08 - 0.36,
                        (i % 3) as Real * 0.035 - 0.035,
                    );
                    let pose = start * Pose::from_translation(relative);
                    if !cylinder_stays_separated(
                        &DefaultQueryDispatcher,
                        &motion,
                        &shape,
                        &pose,
                        &target,
                        0.02,
                        0.0001,
                    ) {
                        retained += 1;
                        continue;
                    }
                    skipped += 1;
                    for sample in 0..=80 {
                        let at = motion.position_at_time(0.02 * sample as Real / 80.0);
                        let gap = DefaultQueryDispatcher
                            .distance(&(at.inverse() * pose), &shape, &target)
                            .unwrap();
                        assert!(
                            gap.distance > 0.0001,
                            "rejected sweep intersects at sample {sample}"
                        );
                    }
                    if let Some(hit) = DefaultQueryDispatcher
                        .cast_shapes_nonlinear(
                            &motion,
                            &shape,
                            &NonlinearRigidMotion::constant_position(pose),
                            &target,
                            0.0,
                            0.02,
                            true,
                        )
                        .unwrap()
                    {
                        panic!("rejected sweep reported a collision: {hit:?}");
                    }
                }
            }
        }
        assert!(
            skipped > 20 && retained > 20,
            "fixture must exercise both branches: skipped {skipped}, retained {retained}"
        );
    }
}

/// How the per-body sweep treats *pseudo* pairs (a sensor collider, or mismatched solver
/// groups): the continuous pass records them for intersection-event emission; the substep
/// splitter ignores them since they never clamp motion.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum PseudoHitMode {
    Record,
    Ignore,
}

/// Runs the continuous sweep of a single fast body from its current pose to `end_body_pose`:
/// sweeps each of its colliders through `targets`, keeps the earliest solid impact fraction,
/// and records sensor crossings in [`PseudoHitMode::Record`] mode. Shared by the continuous
/// pass (end pose = solved `next_position`) and the substep splitter (end pose = the
/// forces/velocities integration, pseudo pairs ignored).
#[allow(clippy::too_many_arguments)]
pub(super) fn sweep_fast_body(
    handle: RigidBodyHandle,
    bodies: &RigidBodySet,
    colliders: &ColliderSet,
    end_body_pose: Pose,
    targets: CcdTargets,
    dispatcher: &dyn QueryDispatcher,
    hooks: &dyn PhysicsHooks,
    dt: Real,
    linear_slop: Real,
    pseudo_mode: PseudoHitMode,
    profiling: bool,
) -> BodyContinuousResult {
    let collider_handles = &bodies[handle].colliders.0;
    #[cfg(all(feature = "parallel", not(feature = "unsync-callbacks")))]
    if collider_handles.len() >= 16
        && rayon::current_num_threads() > 1
        && !colliders.iter_enabled().any(|(_, co)| {
            co.flags
                .active_hooks
                .contains(ActiveHooks::FILTER_CONTACT_PAIRS)
        })
    {
        use rayon::prelude::*;
        let timer = SweepTimer::new(profiling);
        // Independent speculative chunks start at the original full interval.
        // A prior chunk's hit changes the cutoff used by subsequent proxy casts:
        // recompute those chunks at that cutoff instead of assuming min(TOI)
        // preserves the original iterative algorithm or sensor event order.
        let outputs: Vec<_> = collider_handles
            .par_chunks(8)
            .map(|chunk| {
                sweep_fast_body_serial(
                    handle,
                    bodies,
                    colliders,
                    end_body_pose,
                    targets,
                    dispatcher,
                    hooks,
                    dt,
                    linear_slop,
                    pseudo_mode,
                    profiling,
                    chunk,
                    1.0,
                )
            })
            .collect();
        let mut result = BodyContinuousResult {
            handle,
            fraction: 1.0,
            pseudo_hits: Vec::new(),
            profile: profiling.then(|| BodySweepProfile {
                body: handle,
                milliseconds: 0.0,
                colliders: Vec::new(),
            }),
        };
        for (chunk, speculative) in collider_handles.chunks(8).zip(outputs) {
            let next = if result.fraction == 1.0 {
                speculative
            } else {
                sweep_fast_body_serial(
                    handle,
                    bodies,
                    colliders,
                    end_body_pose,
                    targets,
                    dispatcher,
                    hooks,
                    dt,
                    linear_slop,
                    pseudo_mode,
                    profiling,
                    chunk,
                    result.fraction,
                )
            };
            result.fraction = next.fraction;
            result.pseudo_hits.extend(next.pseudo_hits);
            if let (Some(profile), Some(next_profile)) = (&mut result.profile, next.profile) {
                profile.colliders.extend(next_profile.colliders);
            }
        }
        if let Some(profile) = &mut result.profile {
            profile.milliseconds = timer.ms();
        }
        return result;
    }
    sweep_fast_body_serial(
        handle,
        bodies,
        colliders,
        end_body_pose,
        targets,
        dispatcher,
        hooks,
        dt,
        linear_slop,
        pseudo_mode,
        profiling,
        collider_handles,
        1.0,
    )
}
#[allow(clippy::too_many_arguments)]
fn sweep_fast_body_serial(
    handle: RigidBodyHandle,
    bodies: &RigidBodySet,
    colliders: &ColliderSet,
    end_body_pose: Pose,
    targets: CcdTargets,
    dispatcher: &dyn QueryDispatcher,
    hooks: &dyn PhysicsHooks,
    dt: Real,
    linear_slop: Real,
    pseudo_mode: PseudoHitMode,
    profiling: bool,
    collider_handles: &[ColliderHandle],
    initial_fraction: Real,
) -> BodyContinuousResult {
    let body_started = SweepTimer::new(profiling);
    let mut profile = profiling.then(|| BodySweepProfile {
        body: handle,
        milliseconds: 0.0,
        colliders: Vec::new(),
    });
    let rb1 = &bodies[handle];
    let mut fraction: Real = initial_fraction;
    let mut pseudo_hits = Vec::new();

    for ch1 in collider_handles {
        let co1 = &colliders[*ch1];
        let Some(parent1) = co1.parent.as_ref() else {
            continue;
        };
        if pseudo_mode == PseudoHitMode::Ignore && co1.is_sensor() {
            continue; // Sensors never clamp motion, so they can't affect the earliest impact.
        }

        let start = rb1.pos.position * parent1.pos_wrt_parent;
        let end = end_body_pose * parent1.pos_wrt_parent;
        let local_com = parent1
            .pos_wrt_parent
            .inverse_transform_point(rb1.mprops.local_mprops.local_com);
        if shape_never_ccd_swept(co1.shape.as_ref()) {
            continue;
        }
        // Decomposed CAD colliders can have many convex children. Their sweep
        // descriptions compute mass centroids, so build them only after the
        // broad phase and collision filters find an eligible target. Preserve
        // the original description and pair casts for every accepted pair.
        let mut fast = None;
        let mut collider_profile = profiling.then(|| ColliderSweepProfile {
            collider: *ch1,
            ..Default::default()
        });

        // Swept box: union of the collider's AABBs at the start and end poses.
        let start_aabb = co1.shape.compute_aabb(&start);
        let end_aabb = co1.shape.compute_aabb(&end);
        let swept_aabb = start_aabb.merged(&end_aabb);

        let mut handle_candidate = |ch2: ColliderHandle, co2: &Collider| {
            if ch2 == *ch1 {
                return;
            }
            let bh2 = co2.parent.map(|p| p.handle);
            if bh2 == Some(handle) {
                return; // Skip same body.
            }
            let rb2 = bh2.and_then(|h| bodies.get(h));
            if !tier_allows(rb1, rb2, co2) {
                return;
            }
            if !co1.flags.collision_groups.test(co2.flags.collision_groups) {
                return;
            }

            let is_pseudo = co1.is_sensor()
                || co2.is_sensor()
                || !co1.flags.solver_groups.test(co2.flags.solver_groups);
            if is_pseudo && pseudo_mode == PseudoHitMode::Ignore {
                return;
            }
            if pair_filtered_out_by_hooks(
                hooks, bodies, colliders, co1, co2, *ch1, ch2, handle, bh2,
            ) {
                return;
            }
            let Some(fast) = fast
                .get_or_insert_with(|| {
                    let timer = SweepTimer::new(profiling);
                    let result = FastColliderInfo::new(co1, rb1, &start, &end, local_com);
                    if let Some(p) = &mut collider_profile {
                        p.preparation_ms += timer.ms();
                    }
                    result
                })
                .as_ref()
            else {
                return;
            };
            let pair_started = SweepTimer::new(profiling);
            let hit = cast_collider_pair(
                dispatcher,
                fast,
                co2,
                rb2,
                fraction,
                dt,
                linear_slop,
                is_pseudo,
            );
            if let Some(p) = &mut collider_profile {
                p.pairs.push(PairSweepProfile {
                    target: ch2,
                    milliseconds: pair_started.ms(),
                    fraction: hit,
                });
            }
            if let Some(hit_fraction) = hit {
                if is_pseudo {
                    pseudo_hits.push(PseudoHit {
                        ch1: *ch1,
                        ch2,
                        fraction: hit_fraction,
                    });
                } else {
                    fraction = hit_fraction;
                }
            }
        };

        match targets {
            CcdTargets::Lists { fixed, soft } => {
                for (ch2, aabb2) in fixed.iter().chain(soft.iter()) {
                    if aabb2.intersects(&swept_aabb) {
                        handle_candidate(*ch2, &colliders[*ch2]);
                    }
                }
            }
            CcdTargets::FullBvh(bvh) => {
                for (ch2, co2) in intersect_swept_aabb(bvh, colliders, swept_aabb) {
                    handle_candidate(ch2, co2);
                }
            }
        }
        if let (Some(p), Some(c)) = (&mut profile, collider_profile) {
            p.colliders.push(c);
        }
    }
    if let Some(p) = &mut profile {
        p.milliseconds = body_started.ms();
    }
    BodyContinuousResult {
        handle,
        fraction,
        pseudo_hits,
        profile,
    }
}

/// Fake hook that simply detects if hooks are enabled during CCD.
///
/// This lets us know if another pass is needed when the hooks are non-sync.
#[cfg(all(feature = "parallel", feature = "unsync-callbacks"))]
#[derive(Default)]
struct HookProbe(core::sync::atomic::AtomicBool);

#[cfg(all(feature = "parallel", feature = "unsync-callbacks"))]
impl PhysicsHooks for HookProbe {
    fn filter_contact_pair(
        &self,
        _: &crate::pipeline::PairFilterContext,
    ) -> Option<crate::geometry::SolverFlags> {
        self.0.store(true, core::sync::atomic::Ordering::Relaxed);
        // Irrelevant: reaching this discards the whole pass in favour of the serial redo.
        Some(crate::geometry::SolverFlags::COMPUTE_RIGID_IMPULSES)
    }
}

/// Maps `f` (typically an expensive time-of-impact computation) over the given body handles,
/// in parallel when the `parallel` feature is enabled.
///
/// `f` takes the hooks rather than capturing them, so that a non-`Sync` build can hand the
/// workers a stand-in and keep the user's callback on this thread.
#[cfg(feature = "parallel")]
pub(super) fn map_bodies_parallel<T: Send>(
    handles: &[RigidBodyHandle],
    hooks: &dyn PhysicsHooks,
    f: impl Fn(RigidBodyHandle, &dyn PhysicsHooks) -> T + Sync + Send,
) -> Vec<T> {
    // A few CAD bodies can contain costly compound sweeps. Keep tiny batches
    // serial, but permit the worker pool to share these larger shape queries.
    let map_with = |hooks: &(dyn PhysicsHooks + Sync)| {
        if handles.len() >= 4 && rayon::current_num_threads() > 1 {
            use rayon::prelude::*;
            return handles.par_iter().map(|h| f(*h, hooks)).collect();
        }
        handles.iter().map(|h| f(*h, hooks)).collect()
    };

    #[cfg(not(feature = "unsync-callbacks"))]
    return map_with(hooks);

    #[cfg(feature = "unsync-callbacks")]
    {
        let probe = HookProbe::default();
        let swept = map_with(&probe);
        if !probe.0.load(core::sync::atomic::Ordering::Relaxed) {
            // No sweep met a hook-flagged pair, so the stand-in answered nothing.
            return swept;
        }
        // One did: redo on this thread with the real hooks. Sweeps only read the body and
        // collider sets and return their result — the caller applies it — so throwing the
        // first pass away is free of side effects.
        drop(swept);
        handles.iter().map(|h| f(*h, hooks)).collect()
    }
}

/// Serial fallback for non-`parallel` builds. Keeps the same shape as the parallel one so
/// both call sites read alike; nothing here needs the hooks to be `Sync`.
#[cfg(not(feature = "parallel"))]
pub(super) fn map_bodies_parallel<T>(
    handles: &[RigidBodyHandle],
    hooks: &dyn PhysicsHooks,
    f: impl Fn(RigidBodyHandle, &dyn PhysicsHooks) -> T,
) -> Vec<T> {
    handles.iter().map(|h| f(*h, hooks)).collect()
}

#[cfg(all(
    test,
    feature = "parallel",
    feature = "dim3",
    not(feature = "unsync-callbacks")
))]
mod collider_chunk_tests {
    use super::*;
    use crate::prelude::{ColliderBuilder, RigidBodyBuilder, SolverFlags};
    use core::sync::atomic::{AtomicUsize, Ordering};
    use parry::query::DefaultQueryDispatcher;

    #[derive(Default)]
    struct CountingHooks(AtomicUsize);
    impl PhysicsHooks for CountingHooks {
        fn filter_contact_pair(&self, _: &PairFilterContext) -> Option<SolverFlags> {
            self.0.fetch_add(1, Ordering::Relaxed);
            Some(SolverFlags::COMPUTE_RIGID_IMPULSES)
        }
    }

    fn signature(r: &BodyContinuousResult) -> (u32, Vec<(ColliderHandle, ColliderHandle, u32)>) {
        (
            r.fraction.to_bits(),
            r.pseudo_hits
                .iter()
                .map(|p| (p.ch1, p.ch2, p.fraction.to_bits()))
                .collect(),
        )
    }

    #[test]
    fn collider_chunks_preserve_cutoff_sensor_order_and_hook_fallback() {
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(4)
            .build()
            .unwrap();
        let mut tested_hits = 0;
        let mut tested_sensors = 0;
        for hooked in [false, true] {
            for solids in [false, true] {
                let mut bodies = RigidBodySet::new();
                let mut colliders = ColliderSet::new();
                let body = bodies.insert(RigidBodyBuilder::dynamic().ccd_enabled(true));
                // Multiple chunks with distinct child offsets; every chunk sees
                // several targets, and an early solid hit tightens later cutoffs.
                for i in 0..24 {
                    let child = ColliderBuilder::cuboid(0.04, 0.04, 0.04)
                        .translation(Vector::new(i as Real * 0.003, 0.0, 0.0))
                        .active_hooks(if hooked {
                            ActiveHooks::FILTER_CONTACT_PAIRS
                        } else {
                            ActiveHooks::empty()
                        });
                    colliders.insert_with_parent(child, body, &mut bodies);
                }
                bodies[body].ccd_vels.linvel = Vector::X * 4.0;
                bodies[body].ccd_vels.angvel = Vector::ZERO;
                let mut targets = Vec::new();
                // Deliberately not ordered spatially. A sensor discovered before
                // a closer solid remains in the original event order.
                for (x, sensor) in [
                    (2.8, true),
                    (2.4, false),
                    (0.4, true),
                    (1.0, false),
                    (1.8, true),
                ] {
                    let ch = colliders.insert(
                        ColliderBuilder::ball(0.1)
                            .translation(Vector::X * x)
                            .sensor(sensor || !solids),
                    );
                    targets.push((ch, colliders[ch].shape.compute_aabb(&colliders[ch].pos)));
                }
                for reversed in [false, true] {
                    if reversed {
                        targets.reverse();
                    }
                    for mode in [PseudoHitMode::Record, PseudoHitMode::Ignore] {
                        let hooks = CountingHooks::default();
                        let reference = sweep_fast_body_serial(
                            body,
                            &bodies,
                            &colliders,
                            Pose::translation(4.0, 0.0, 0.0),
                            CcdTargets::Lists {
                                fixed: &targets,
                                soft: &[],
                            },
                            &DefaultQueryDispatcher,
                            &hooks,
                            1.0,
                            0.0001,
                            mode,
                            true,
                            &bodies[body].colliders.0,
                            1.0,
                        );
                        let reference_hooks = hooks.0.swap(0, Ordering::Relaxed);
                        let actual = pool.install(|| {
                            sweep_fast_body(
                                body,
                                &bodies,
                                &colliders,
                                Pose::translation(4.0, 0.0, 0.0),
                                CcdTargets::Lists {
                                    fixed: &targets,
                                    soft: &[],
                                },
                                &DefaultQueryDispatcher,
                                &hooks,
                                1.0,
                                0.0001,
                                mode,
                                true,
                            )
                        });
                        assert_eq!(signature(&reference), signature(&actual));
                        assert_eq!(reference_hooks, hooks.0.load(Ordering::Relaxed));
                        if hooked && (solids || mode == PseudoHitMode::Record) {
                            assert!(reference_hooks > 0);
                        }
                        assert_eq!(
                            reference.profile.as_ref().unwrap().colliders.len(),
                            actual.profile.as_ref().unwrap().colliders.len()
                        );
                        tested_hits +=
                            usize::from(reference.fraction > 0.0 && reference.fraction < 1.0);
                        tested_sensors += usize::from(!reference.pseudo_hits.is_empty());
                    }
                }
            }
        }
        assert!(tested_hits > 0 && tested_sensors > 0);
    }
}
