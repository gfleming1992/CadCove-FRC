//! Experimental scheduling variant of Parry 0.31.1's composite/composite
//! manifold algorithm (Apache-2.0; see vendor/rapier3d/LICENSE).
//! The base path keeps upstream BVH order and independent query caches. The
//! optional compact filter parks excluded empty entries while preserving their
//! history and the relative order of retained contacts. Convex queries run on
//! disjoint manifold slots.
//! The existing Rayon pool is reused, including when a pair is already on it.
#[cfg(feature = "composite-bounds")]
use rapier3d::parry::shape::CompositeShape;
use rapier3d::parry::{
    bounding_volume::BoundingVolume,
    math::{Pose, Real},
    query::{
        ContactManifold, ContactManifoldsWorkspace, DefaultQueryDispatcher,
        PersistentQueryDispatcher, TypedWorkspaceData, WorkspaceData,
    },
    shape::Shape,
    utils::{
        hashmap::{Entry, HashMap},
        PoseOpt,
    },
};
use rayon::prelude::*;

#[derive(Clone, Default)]
struct Workspace<M, C> {
    // Empty between calls; retain both manifold vector allocations per pair.
    scratch: Vec<ContactManifold<M, C>>,
    indices: HashMap<(u32, u32), (usize, bool)>,
    timestamp: bool,
    #[cfg(feature = "composite-compact")]
    dormant: HashMap<(u32, u32), (ContactManifold<M, C>, bool)>,
}
impl<M: Clone + Send + Sync + 'static, C: Copy + Send + Sync + 'static> WorkspaceData
    for Workspace<M, C>
{
    fn as_typed_workspace_data(&self) -> TypedWorkspaceData<'_> {
        TypedWorkspaceData::Custom
    }
    fn clone_dyn(&self) -> Box<dyn WorkspaceData> {
        Box::new(self.clone())
    }
}

/// Search the smaller composite's parts in the larger composite's own frame.
/// An empty search proves separation at this reach. Rotating a long field
/// triangle into a small ball's frame can make its AABB overlap most of the
/// ball despite the two surfaces being separated in the field's frame.
#[cfg(feature = "composite-bounds")]
fn reverse_has_candidates(
    a: &dyn CompositeShape,
    b: &dyn CompositeShape,
    ab: &Pose,
    prediction: Real,
) -> bool {
    let aa = a.bvh().root_aabb();
    let bb = b.bvh().root_aabb();
    let scale = aa
        .mins
        .abs()
        .max_element()
        .max(aa.maxs.abs().max_element())
        .max(bb.mins.abs().max_element())
        .max(bb.maxs.abs().max_element())
        .max(ab.translation.abs().max_element())
        .max(1.0);
    if !prediction.is_finite()
        || prediction < 0.0
        || !scale.is_finite()
        || !ab.is_finite()
        || !aa.mins.is_finite()
        || !aa.maxs.is_finite()
        || !bb.mins.is_finite()
        || !bb.maxs.is_finite()
    {
        return true;
    }
    // Cover f32 transforms/inversion and bound rounding. Uncertain cases keep
    // the existing complete query. This pad can only add work, never contacts.
    let reach = prediction + 128.0 * Real::EPSILON * scale;
    let search = aa.transform_by(&ab.inverse()).loosened(reach);
    for (count, ib) in b.bvh().intersect_aabb(&search).enumerate() {
        if count >= 256 {
            return true;
        }
        let mut found = false;
        b.map_part_at(ib, &mut |part, shape, _| {
            let bound = shape.compute_aabb(&part.prepend_to(ab)).loosened(reach);
            if !bound.mins.is_finite()
                || !bound.maxs.is_finite()
                || a.bvh().intersect_aabb(&bound).next().is_some()
            {
                found = true;
            }
        });
        if found {
            return true;
        }
    }
    false
}

pub(super) fn contacts<
    M: Default + Clone + Send + Sync + 'static,
    C: Default + Copy + Send + Sync + 'static,
>(
    pose: &Pose,
    shape_a: &dyn Shape,
    shape_b: &dyn Shape,
    prediction: Real,
    manifolds: &mut Vec<ContactManifold<M, C>>,
    workspace: &mut Option<ContactManifoldsWorkspace>,
) {
    let mut a = shape_a.as_composite_shape().unwrap();
    let mut b = shape_b.as_composite_shape().unwrap();
    if workspace
        .as_ref()
        .and_then(|w| w.0.downcast_ref::<Workspace<M, C>>())
        .is_none()
    {
        // A restored standard workspace is not reinterpreted as this cache.
        *workspace = Some(ContactManifoldsWorkspace(Box::new(
            Workspace::<M, C>::default(),
        )));
    }
    let ws = workspace
        .as_mut()
        .unwrap()
        .0
        .downcast_mut::<Workspace<M, C>>()
        .unwrap();
    let mut bounds_a = a.bvh().root_aabb();
    let mut bounds_b = b.bvh().root_aabb();
    let mut ab = *pose;
    let mut ba = ab.inverse();
    let flipped =
        bounds_a.half_extents().length_squared() < bounds_b.half_extents().length_squared();
    if flipped {
        std::mem::swap(&mut a, &mut b);
        std::mem::swap(&mut bounds_a, &mut bounds_b);
        std::mem::swap(&mut ab, &mut ba);
    }
    #[cfg(feature = "composite-filter")]
    let motion = rapier3d::geometry::query_motion::QueryMotion::current();
    #[cfg(all(feature = "composite-bounds", not(feature = "composite-filter")))]
    let whole_reach = prediction;
    #[cfg(feature = "composite-filter")]
    let whole_reach = motion.map_or(prediction, |m| m.reach);
    #[cfg(feature = "composite-bounds")]
    if !reverse_has_candidates(a, b, &ab, whole_reach) {
        manifolds.clear();
        ws.indices.clear();
        #[cfg(feature = "composite-compact")]
        ws.dormant.clear();
        return;
    }
    let deformable = a.is_deformable() || b.is_deformable();
    #[cfg(feature = "composite-audit")]
    let mesh_pair = shape_a.as_trimesh().is_some() && shape_b.as_trimesh().is_some();
    // Diagnostic only: retain every original query and cache mutation while
    // measuring what the unqualified per-part bounds filter would remove.
    #[cfg(feature = "composite-audit")]
    let audit_allowed = mesh_pair
        .then(|| super::reverse_audit::candidates(a, b, &ab, prediction))
        .flatten();
    #[cfg(feature = "composite-filter")]
    let filter_allowed =
        motion.and_then(|motion| super::reverse_bounds::candidates(a, b, &ab, motion.reach));
    debug_assert!(ws.scratch.is_empty());
    std::mem::swap(manifolds, &mut ws.scratch);
    let old = &mut ws.scratch;
    ws.timestamp = !ws.timestamp;
    let timestamp = ws.timestamp;
    #[cfg(all(feature = "composite-compact", feature = "composite-filter-audit"))]
    let mut audit_skipped = Vec::new();
    // Keep the same two-stage BVH walk as upstream; do not sort the leaves.
    for ia in a
        .bvh()
        .intersect_aabb(&bounds_b.transform_by(&ab).loosened(prediction))
    {
        a.map_part_at(ia, &mut |pa, sa, _| {
            let ba_part = pa.prepend_to(&ba);
            let bounds = sa.compute_aabb(&ba_part).loosened(prediction);
            for ib in b.bvh().intersect_aabb(&bounds) {
                let key = if flipped { (ib, ia) } else { (ia, ib) };
                #[cfg(feature = "composite-compact")]
                if filter_allowed
                    .as_ref()
                    .is_some_and(|pairs| !pairs.contains_key(&(ia, ib)))
                    && !ws
                        .indices
                        .get(&key)
                        .is_some_and(|(i, _)| !old[*i].points.is_empty())
                {
                    // Preserve previously evaluated empty caches; brand-new skipped
                    // pairs have no history and can be created lazily when reached.
                    if let Some((i, _)) = ws.indices.remove(&key) {
                        ws.dormant
                            .insert(key, (std::mem::take(&mut old[i]), timestamp));
                    }
                    if let Some((m, seen)) = ws.dormant.get_mut(&key) {
                        *seen = timestamp;
                        if deformable {
                            m.mark_shapes_deformed();
                        }
                        #[cfg(feature = "composite-filter-audit")]
                        audit_skipped.push(m.clone());
                    } else {
                        #[cfg(feature = "composite-filter-audit")]
                        {
                            let mut m = ContactManifold::<M, C>::new();
                            m.subshape1 = key.0;
                            m.subshape2 = key.1;
                            if deformable {
                                m.mark_shapes_deformed();
                            }
                            audit_skipped.push(m);
                        }
                    }
                    continue;
                }
                b.map_part_at(ib, &mut |pb, _, _| {
                    let mut m = match ws.indices.entry(key) {
                        Entry::Occupied(mut entry) => {
                            let m = std::mem::take(&mut old[entry.get().0]);
                            *entry.get_mut() = (manifolds.len(), timestamp);
                            m
                        }
                        Entry::Vacant(entry) => {
                            entry.insert((manifolds.len(), timestamp));
                            let mut m = ContactManifold::new();
                            #[cfg(feature = "composite-compact")]
                            if let Some((cached, _)) = ws.dormant.remove(&key) {
                                m = cached;
                            }
                            m.subshape1 = key.0;
                            m.subshape2 = key.1;
                            m.set_subshape_pos1(if flipped { pb } else { pa }.copied());
                            m.set_subshape_pos2(if flipped { pa } else { pb }.copied());
                            m
                        }
                    };
                    if deformable {
                        m.mark_shapes_deformed();
                    }
                    manifolds.push(m);
                });
            }
        });
    }
    old.clear();
    ws.indices.retain(|_, entry| entry.1 == timestamp);
    #[cfg(feature = "composite-compact")]
    ws.dormant.retain(|_, entry| entry.1 == timestamp);
    let update = |m: &mut ContactManifold<M, C>| {
        #[cfg(feature = "composite-filter")]
        let filtered = m.points.is_empty()
            && filter_allowed.as_ref().is_some_and(|pairs| {
                let key = if flipped {
                    (m.subshape2, m.subshape1)
                } else {
                    (m.subshape1, m.subshape2)
                };
                !pairs.contains_key(&key)
            });
        #[cfg(all(feature = "composite-filter", not(feature = "composite-filter-audit")))]
        if filtered {
            return;
        }
        // Audit the exact query that would be omitted on this filtered trajectory.
        // It operates on a clone; the original empty manifold/cache is untouched.
        #[cfg(feature = "composite-filter-audit")]
        let mut shadow = filtered.then(|| m.clone());
        #[cfg(feature = "composite-filter-audit")]
        let m = if let Some(shadow) = shadow.as_mut() {
            shadow
        } else {
            m
        };

        // Shape is Sync. Obtain its read-only composite interface inside each
        // worker rather than asserting Sync on the weaker CompositeShape trait.
        let (a, b) = if flipped {
            (shape_b, shape_a)
        } else {
            (shape_a, shape_b)
        };
        let (a, b) = (
            a.as_composite_shape().unwrap(),
            b.as_composite_shape().unwrap(),
        );
        let (ia, ib) = if flipped {
            (m.subshape2, m.subshape1)
        } else {
            (m.subshape1, m.subshape2)
        };
        a.map_part_at(ia, &mut |pa, sa, na| {
            let ba_part = pa.prepend_to(&ba);
            b.map_part_at(ib, &mut |pb, sb, nb| {
                let relative = pb.inv_mul(&ba_part);
                #[cfg(feature = "composite-audit")]
                let audit_before = (m.local_n1, m.local_n2, m.points.len());
                if flipped {
                    let _ = DefaultQueryDispatcher
                        .contact_manifold_convex_convex(&relative, sb, sa, nb, na, prediction, m);
                } else {
                    let _ = DefaultQueryDispatcher.contact_manifold_convex_convex(
                        &relative.inverse(),
                        sa,
                        sb,
                        na,
                        nb,
                        prediction,
                        m,
                    );
                }
                #[cfg(feature = "composite-audit")]
                super::reverse_audit::inspect(
                    audit_allowed
                        .as_ref()
                        .is_some_and(|pairs| !pairs.contains_key(&(ia, ib))),
                    prediction,
                    m,
                    audit_before,
                    if flipped { sb } else { sa },
                    if flipped { sa } else { sb },
                    if flipped {
                        relative
                    } else {
                        relative.inverse()
                    },
                );
            });
        });
        #[cfg(feature = "composite-filter-audit")]
        if filtered {
            super::reverse_audit::inspect_shadow(motion.unwrap(), m);
        }
    };
    #[cfg(all(feature = "composite-compact", feature = "composite-filter-audit"))]
    audit_skipped
        .par_chunks_mut(64)
        .for_each(|chunk| chunk.iter_mut().for_each(&update));
    if manifolds.len() >= 256 {
        manifolds
            .par_chunks_mut(64)
            .for_each(|chunk| chunk.iter_mut().for_each(&update));
    } else {
        manifolds.iter_mut().for_each(update);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rapier3d::prelude::{Compound, SharedShape, TriMesh, TriMeshFlags, Vector};

    fn comparable(manifolds: &[ContactManifold<(), ()>]) -> serde_json::Value {
        if cfg!(feature = "composite-bounds") {
            // Bounds pruning intentionally removes empty/out-of-reach slots.
            // Compare every manifold that could supply a solver contact.
            serde_json::to_value(
                manifolds
                    .iter()
                    .filter(|m| m.points.iter().any(|p| p.dist <= 0.01))
                    .collect::<Vec<_>>(),
            )
            .unwrap()
        } else {
            serde_json::to_value(manifolds).unwrap()
        }
    }

    #[cfg(feature = "composite-bounds")]
    #[test]
    fn reverse_bounds_keep_overlap_near_contacts_and_uncertainty() {
        let a = Compound::new(vec![(
            Pose::translation(7.0, -3.0, 2.0),
            SharedShape::cuboid(2.0, 0.02, 1.0),
        )]);
        let b = Compound::new(vec![(
            Pose::translation(0.03, 0.02, 0.01),
            SharedShape::cuboid(0.01, 0.01, 0.01),
        )]);
        for i in 0..200 {
            let rotation = rapier3d::prelude::Rotation::from_scaled_axis(Vector::new(
                i as f32 * 0.1,
                i as f32 * 0.03,
                i as f32 * -0.07,
            ));
            // Both boxes contain the selected common point by construction,
            // even with a different local frame and compound-child offset.
            let p = Pose::from_parts(
                Vector::new(7.0, -3.0, 2.0) - rotation * Vector::new(0.03, 0.02, 0.01),
                rotation,
            );
            assert!(reverse_has_candidates(&a, &b, &p, 0.0025));
        }
        let b = Compound::new(vec![(
            Pose::IDENTITY,
            SharedShape::cuboid(0.01, 0.01, 0.01),
        )]);
        for gap in [0.0, 0.001, 0.0024] {
            assert!(reverse_has_candidates(
                &a,
                &b,
                &Pose::translation(7.0, -3.0 + 0.03 + gap, 2.0),
                0.0025
            ));
        }
        assert!(!reverse_has_candidates(
            &a,
            &b,
            &Pose::translation(7.0, -3.0 + 0.04, 2.0),
            0.0025
        ));
        assert!(reverse_has_candidates(&a, &b, &Pose::IDENTITY, f32::NAN));
        assert!(reverse_has_candidates(&a, &b, &Pose::IDENTITY, -1.0));
    }

    #[test]
    fn parallel_composite_matches_upstream_across_motion_and_deformation() {
        // Dense overlapping surface grids exercise the parallel branch, including
        // reused manifolds, removed pairs, flips and refreshed deformable vertices.
        let mesh = |z: f32| {
            let mut points = Vec::new();
            let mut triangles = Vec::new();
            for y in 0..20 {
                for x in 0..20 {
                    let i = points.len() as u32;
                    let x = x as f32 * 0.01;
                    let y = y as f32 * 0.01;
                    points.extend([
                        Vector::new(x, y, z),
                        Vector::new(x + 0.01, y, z),
                        Vector::new(x, y + 0.01, z),
                    ]);
                    triangles.push([i, i + 1, i + 2]);
                }
            }
            TriMesh::new(points, triangles).unwrap()
        };
        let mut a = mesh(0.0);
        let b = mesh(0.002).scaled(Vector::splat(1.1));
        a.set_flags(TriMeshFlags::DEFORMABLE).unwrap();
        for flipped in [false, true] {
            let (mut expected, mut actual): (
                Vec<ContactManifold<(), ()>>,
                Vec<ContactManifold<(), ()>>,
            ) = (Vec::new(), Vec::new());
            let (mut upstream_ws, mut candidate_ws) = (None, None);
            for offset in [0.0, 0.003, 0.006, 0.4, 0.001] {
                a.transform_vertices(&Pose::translation(0.0, 0.0, 0.00001));
                let p = Pose::translation(offset, 0.0, 0.0);
                let (a, b): (&dyn Shape, &dyn Shape) = if flipped { (&b, &a) } else { (&a, &b) };
                rapier3d::parry::query::details::contact_manifolds_composite_shape_composite_shape(
                    &DefaultQueryDispatcher,
                    &p,
                    a.as_composite_shape().unwrap(),
                    b.as_composite_shape().unwrap(),
                    0.01,
                    &mut expected,
                    &mut upstream_ws,
                );
                contacts(&p, a, b, 0.01, &mut actual, &mut candidate_ws);
                assert_eq!(comparable(&actual), comparable(&expected));
                if offset == 0.0 {
                    assert!(actual.len() > 256);
                }
            }
        }
    }

    #[test]
    fn mesh_contacts_keep_normal_corrections_through_rotation() {
        use rapier3d::prelude::Cuboid;
        for flags in [
            TriMeshFlags::empty(),
            TriMeshFlags::FIX_INTERNAL_EDGES_TWO_SIDED,
        ] {
            let make = |half: Vector| {
                let (vertices, indices) = Cuboid::new(half).to_trimesh();
                TriMesh::with_flags(vertices, indices, flags).unwrap()
            };
            let a = make(Vector::new(0.2, 0.1, 0.08));
            let b = make(Vector::new(0.07, 0.11, 0.05));
            for flipped in [false, true] {
                let (a, b) = if flipped { (&b, &a) } else { (&a, &b) };
                let (mut expected, mut actual): (
                    Vec<ContactManifold<(), ()>>,
                    Vec<ContactManifold<(), ()>>,
                ) = (vec![], vec![]);
                let (mut original_ws, mut candidate_ws) = (None, None);
                for i in 0..200 {
                    let t = i as f32 * 0.07;
                    let p = Pose::new(
                        Vector::new(t.sin() * 0.3, 0.01, 0.04),
                        Vector::new(t, t * 0.7, t * -0.3),
                    );
                    rapier3d::parry::query::details::contact_manifolds_composite_shape_composite_shape(
                        &DefaultQueryDispatcher, &p, a, b, 0.01, &mut expected, &mut original_ws,
                    );
                    contacts(&p, a, b, 0.01, &mut actual, &mut candidate_ws);
                    assert!(
                        comparable(&actual) == comparable(&expected),
                        "exact contact mismatch: flags={flags:?}, flipped={flipped}, sample={i}, actual_manifolds={}, expected_manifolds={}",
                        actual.len(), expected.len()
                    );
                }
            }
        }
    }

    #[test]
    fn compounds_keep_local_transforms_normals_and_order_with_one_or_four_workers() {
        let parts = (0..20)
            .flat_map(|y| {
                (0..20).map(move |x| {
                    (
                        Pose::new(
                            Vector::new(x as f32 * 0.02, y as f32 * 0.02, 0.0),
                            Vector::new(0.0, 0.0, 0.2),
                        ),
                        SharedShape::cuboid(0.009, 0.009, 0.003),
                    )
                })
            })
            .collect();
        let a = Compound::new(parts);
        let b = Compound::new(vec![(
            Pose::translation(0.2, 0.2, 0.006),
            SharedShape::cuboid(0.3, 0.3, 0.003),
        )]);
        for workers in [1, 4] {
            let pool = rayon::ThreadPoolBuilder::new()
                .num_threads(workers)
                .build()
                .unwrap();
            let (mut expected, mut actual): (
                Vec<ContactManifold<(), ()>>,
                Vec<ContactManifold<(), ()>>,
            ) = (Vec::new(), Vec::new());
            let (mut upstream_ws, mut candidate_ws) = (None, None);
            for offset in [0.0, 0.002, 1.0, 0.003] {
                let p = Pose::translation(offset, 0.0, 0.0);
                rapier3d::parry::query::details::contact_manifolds_composite_shape_composite_shape(
                    &DefaultQueryDispatcher,
                    &p,
                    &a,
                    &b,
                    0.01,
                    &mut expected,
                    &mut upstream_ws,
                );
                pool.install(|| contacts(&p, &a, &b, 0.01, &mut actual, &mut candidate_ws));
                assert_eq!(comparable(&actual), comparable(&expected));
                if offset == 0.0 {
                    assert!(actual.len() > 256);
                }
            }
        }
    }
}
