//! The pair entry points of the soft contact detection: the update of a soft-soft pair (both vertex passes, the edge pass, the volume patches) and of a soft-rigid pair (the predictive vertex contacts, the rigid patch).

use crate::alloc_prelude::*;

use crate::dynamics::{RigidBodySet, SoftBody, SoftCollisionMesh, SoftMeshRef};
use crate::geometry::{
    Collider, ColliderHandle, ContactManifold, ContactPair, PairContacts, RigidPairContacts,
};
use crate::math::{Real, Vector};
use parry::utils::PoseOpt;
#[cfg(not(feature = "std"))]
#[allow(unused_imports)]
use simba::scalar::{ComplexField as _, RealField as _};

use super::soft_contacts_types::SoftRigidVertexContact;
use super::soft_contacts_volume::{detect_rigid_patch, detect_volume_patch};
use super::{
    SoftDetectionCtx, SoftEdgePass, SoftPairContacts, SoftVertexPass, body_frozen, detect_edges,
    detect_vertex_pass,
};

/// The edge-pass owner of a pair of meshes: the lower `(body handle, cluster, mesh)`, which is
/// the solver's awake order for two touching bodies (they share a substep group).
fn owns_edge_pass(a: SoftMeshRef, b: SoftMeshRef) -> bool {
    (a.body.0.into_raw_parts(), a.id.cluster, a.id.mesh)
        <= (b.body.0.into_raw_parts(), b.id.cluster, b.id.mesh)
}

#[cfg(all(test, feature = "dim3"))]
mod exposure_tests {
    use crate::alloc_prelude::*;
    use crate::prelude::*;

    #[test]
    fn predictive_contacts_support_the_side_facing_the_rigid_shape() {
        for compound in [false, true] {
            for angle in [0.0, 0.6] {
                let mut world = PhysicsWorld::new();
                world.gravity = Vector::ZERO;
                world.integration_parameters.normalized_prediction_distance = 0.01;
                let rotation = Rotation::from_scaled_axis(Vector::new(0.0, 0.0, angle));
                let normal = rotation * Vector::Y;
                let pose = Pose::from_parts(normal * (-0.05), rotation);
                let shape = SharedShape::cuboid(1.0, 0.05, 1.0);
                let floor = if compound {
                    ColliderBuilder::compound(vec![(pose, shape)])
                } else {
                    ColliderBuilder::new(shape).position(pose)
                };
                let (_, floor) = world.insert(RigidBodyBuilder::fixed(), floor);
                let mut sphere =
                    SoftBodyBuilder::sphere(Vector::ZERO, 0.075, 1).particle_radius(0.0005);
                for p in &mut sphere.positions {
                    *p = rotation * *p + normal * 0.077;
                }
                world.insert_soft_body(sphere);
                world.step();
                let mut count = 0;
                for pair in world.narrow_phase.contact_pairs() {
                    if let Some(soft) = pair.rigid().and_then(|r| r.soft.as_deref()) {
                        for v in &soft.vertices {
                            count += 1;
                            let pose = world.colliders[floor].position();
                            assert!(
                                (pose.rotation * v.local_dir).dot(normal) > 0.99,
                                "floor must push toward soft body"
                            );
                            assert!(
                                pose.transform_point(v.local_point).dot(normal).abs() < 1.0e-5,
                                "support must lie on floor top"
                            );
                            assert!(
                                v.dist > 0.0 && v.dist < 0.01,
                                "predictive contact precedes touching"
                            );
                        }
                    }
                }
                assert!(
                    count > 0,
                    "nearby exposed bottom vertices need predictive support (compound={compound}, angle={angle})"
                );
            }
        }
    }
}

pub(crate) fn update_pair_soft_soft(
    pair: &mut ContactPair,
    co1: &Collider,
    co2: &Collider,
    ctx: &SoftDetectionCtx,
) {
    let (h1, h2) = (pair.collider1, pair.collider2);
    if let (Some(r1), Some(r2)) = (co1.deformable_mesh_ref, co2.deformable_mesh_ref) {
        let PairContacts::Soft {
            touching,
            candidates,
        } = &mut pair.contacts
        else {
            return;
        };
        candidates.clear();
        detect_soft_pair(candidates, (h1, co1, r1), (h2, co2, r2), ctx);
        candidates.number_slots();
        *touching = candidates.is_touching();
    }
}

/// The soft contacts of a soft-rigid pair beside its manifolds (computed first): the
/// predictive vertex contacts within `reach` (the solver contacts' separation bound) and the
/// volume patch.
pub(crate) fn update_pair_soft_rigid(
    rigid: &mut RigidPairContacts,
    (h1, co1): (ColliderHandle, &Collider),
    (h2, co2): (ColliderHandle, &Collider),
    bodies: &RigidBodySet,
    reach: Real,
    ctx: &SoftDetectionCtx,
) {
    let (r, soft_first) = match (co1.deformable_mesh_ref, co2.deformable_mesh_ref) {
        (Some(r), None) => (r, true),
        (None, Some(r)) => (r, false),
        _ => return,
    };
    let (soft_co, other_co, handle) = if soft_first {
        (co1, co2, h1)
    } else {
        (co2, co1, h2)
    };
    let Some((sb, mesh)) = ctx
        .soft_bodies
        .get(r.body)
        .and_then(|sb| sb.mesh(r.id).map(|mesh| (sb, mesh)))
    else {
        rigid.soft = None;
        return;
    };
    let mut soft = rigid.soft.take().unwrap_or_default();
    soft.patch = detect_rigid_patch((sb, mesh, handle, soft_co), other_co, bodies, ctx);
    detect_rigid_vertices(
        &mut soft.vertices,
        &rigid.manifolds,
        soft_first,
        (sb, mesh, soft_co),
        other_co,
        reach,
        ctx.params.soft_bodies.local_cylinder_contacts,
    );
    if soft.patch.is_some() || !soft.vertices.is_empty() {
        rigid.soft = Some(soft);
    }
}

/// The predictive vertex contacts of a soft-rigid pair: every vertex of an element the
/// manifolds reached, within `reach` of a convex rigid collider and exposed toward it (see
/// `SoftCollisionMesh::vertex_exposed`), warm-started from the previous contacts by vertex.
fn detect_rigid_vertices(
    out: &mut Vec<SoftRigidVertexContact>,
    manifolds: &[ContactManifold],
    soft_first: bool,
    (sb, mesh, soft_co): (&SoftBody, &SoftCollisionMesh, &Collider),
    other_co: &Collider,
    reach: Real,
    local_cylinder_contacts: bool,
) {
    let previous = core::mem::take(out);
    let shape = other_co.shape();
    let compound = shape.as_compound().is_some();
    #[cfg(feature = "dim3")]
    let local_cylinder = local_cylinder_contacts && shape.as_cylinder().is_some();
    #[cfg(not(feature = "dim3"))]
    let local_cylinder = { let _ = local_cylinder_contacts; false };
    if !shape.is_convex() && !compound {
        return;
    }
    let mut candidates: Vec<(u32, u32)> = Vec::new();
    for (mi, manifold) in manifolds.iter().enumerate() {
        if manifold.points.is_empty() {
            continue;
        }
        let element = if soft_first {
            manifold.subshape1
        } else {
            manifold.subshape2
        } as usize;
        if element < mesh.indices().len() {
            #[cfg(feature = "manifold-audit")]
            if manifold.data.audit_excluded_query {
                crate::geometry::manifold_audit::add(3, 1);
            }
            candidates.extend(mesh.element(element).iter().map(|&v| (v, mi as u32)));
        }
    }
    if local_cylinder && !manifolds.is_empty() {
        // Reserve every surface vertex on an already-detected pair. The local
        // worker projects these candidates each substep, so contacts can move
        // onto previously untouched vertices without another global refresh.
        candidates.clear();
        candidates.extend((0..mesh.vertices().len()).map(|v| (v as u32,0)));
    }
    candidates.sort_unstable_by_key(|c| c.0);
    let pose = other_co.position();
    let skins = soft_co.contact_skin() + other_co.contact_skin();
    let pose1 = if soft_first { soft_co } else { other_co }.position();
    let force_dir = |m: &ContactManifold| {
        let n = m.subshape_pos1().prepend_to(pose1).rotation * m.local_n1;
        if soft_first { -n } else { n }
    };
    let mut previous = previous.iter().peekable();
    let mut rest = &candidates[..];
    while let Some(&(vertex, _)) = rest.first() {
        let count = rest
            .iter()
            .position(|c| c.0 != vertex)
            .unwrap_or(rest.len());
        let (group, tail) = rest.split_at(count);
        rest = tail;
        let point = mesh.vertex(sb, vertex as usize);
        let local = pose.inverse_transform_point(point);
        let proj = shape.project_local_point(local, false);
        // Inside a compound, closest-child projection can select an internal
        // boundary. Leave interior recovery to the existing manifold/volume path.
        if compound && proj.is_inside {
            continue;
        }
        let delta = local - proj.point;
        let len = delta.length();
        // On the boundary itself the direction is undefined: the element's manifold holds it.
        if len <= 1.0e-6 {
            continue;
        }
        let (local_dir, separation) = if proj.is_inside {
            (-delta / len, -len)
        } else {
            (delta / len, len)
        };
        let dist = separation - skins;
        let dir = pose.rotation * local_dir;
        // `dir` pushes the soft surface away from the rigid shape. Its
        // exposed side faces the other way, toward the approaching shape.
        // Open cloth/shells have two sides: retain either exposed orientation.
        if !local_cylinder && (dist >= reach
            || !(mesh.vertex_exposed(sb, vertex, -dir)
                || (!mesh.is_solid() && mesh.vertex_exposed(sb, vertex, dir))))
        {
            continue;
        }
        // An incident element's contact must agree with the direction: inside a polyhedral
        // shape, the feature closest to the vertex can be another face than the one it met.
        let Some((manifold, alignment)) = group
            .iter()
            .map(|&(_, mi)| (mi, force_dir(&manifolds[mi as usize]).dot(dir)))
            .max_by(|a, b| a.1.total_cmp(&b.1))
        else {
            continue;
        };
        if !local_cylinder && alignment < 0.7 {
            continue;
        }
        while previous.peek().is_some_and(|c| c.vertex < vertex) {
            previous.next();
        }
        let (impulse, tangent_impulse) = previous
            .peek()
            .filter(|c| c.vertex == vertex)
            .map_or((0.0, Vector::ZERO), |c| (c.impulse, c.tangent_impulse));
        #[cfg(feature = "manifold-audit")]
        if manifolds[manifold as usize].data.audit_excluded_query {
            crate::geometry::manifold_audit::add(4, 1);
        }
        out.push(SoftRigidVertexContact {
            vertex,
            manifold,
            local_point: proj.point,
            local_dir,
            dist,
            impulse,
            tangent_impulse,
        });
    }
}

/// The detection of a pair of two soft surfaces (see [`update_pair`]), into the cleared
/// candidates.
fn detect_soft_pair(
    soft: &mut SoftPairContacts,
    (h1, co1, r1): (ColliderHandle, &Collider, SoftMeshRef),
    (h2, co2, r2): (ColliderHandle, &Collider, SoftMeshRef),
    ctx: &SoftDetectionCtx,
) {
    let (Some(sb1), Some(sb2)) = (ctx.soft_bodies.get(r1.body), ctx.soft_bodies.get(r2.body))
    else {
        return;
    };
    let (Some(mesh1), Some(mesh2)) = (sb1.mesh(r1.id), sb2.mesh(r2.id)) else {
        return;
    };
    // Two meshes of one body: alternative descriptions of the same particles when they share a
    // cluster (a hull and a skin), so they never collide; across clusters they do, but only if
    // both opted in and their clusters share no particle.
    if r1.body == r2.body {
        let same_cluster = r1.id.cluster == r2.id.cluster;
        if same_cluster
            || !mesh1.self_contacts_enabled()
            || !mesh2.self_contacts_enabled()
            || !sb1.clusters_are_disjoint(r1.id.cluster, r2.id.cluster)
        {
            return;
        }
    }
    // Two frozen surfaces have no DOF between them.
    let (frozen1, frozen2) = (body_frozen(sb1), body_frozen(sb2));
    if frozen1 && frozen2 {
        return;
    }
    // Two pieces of one torn body keep the gaps their features had at rest.
    let pieces = ctx.pieces_of_one_body((sb1, r1.body), (sb2, r2.body));
    // Both vertex passes: each surface's owner consumes the other's vertices against it (and
    // the reverse pass too when the other body is not simulated).
    let mut pass1 = SoftVertexPass::default();
    let mut pass2 = SoftVertexPass::default();
    detect_vertex_pass(
        &mut pass1,
        (sb1, mesh1, h1, co1),
        (sb2, mesh2, h2, co2),
        None,
        pieces,
        ctx,
    );
    detect_vertex_pass(
        &mut pass2,
        (sb2, mesh2, h2, co2),
        (sb1, mesh1, h1, co1),
        None,
        pieces,
        ctx,
    );
    // The edge pass, oriented from its owner: a crossed closed-closed pair whose volume constraint
    // stands its edges down (see `overlap_edge_stand_down`) skips it once the owner's vertex pass
    // found the crossing; the solver applies the per-vertex part of that rule itself.
    let (own, other) = if owns_edge_pass(r1, r2) {
        ((sb1, mesh1, h1, co1), (sb2, mesh2, h2, co2))
    } else {
        ((sb2, mesh2, h2, co2), (sb1, mesh1, h1, co1))
    };
    let owner_pass = if own.2 == h1 { &pass1 } else { &pass2 };
    let recovery = &ctx.params.soft_bodies.recovery;
    let stood_down = cfg!(feature = "dim3")
        && mesh1.is_solid()
        && mesh2.is_solid()
        && recovery.overlap_constraints
        && recovery.overlap_edge_stand_down
        && !owner_pass.cross_tangled_elements.is_empty();
    let mut edges = SoftEdgePass::default();
    let has_edges = !stood_down && detect_edges(&mut edges, own, other, None, pieces, ctx);
    // The volume patches, from the vertex pass of the pair's lower surface.
    let (lower_pass, lower, higher) = if h1.into_raw_parts() < h2.into_raw_parts() {
        (&pass1, (sb1, mesh1, h1, co1), (sb2, mesh2, h2, co2))
    } else {
        (&pass2, (sb2, mesh2, h2, co2), (sb1, mesh1, h1, co1))
    };
    soft.volume = detect_volume_patch(lower_pass, lower, higher, ctx);
    soft.vertex_passes.push(pass1);
    soft.vertex_passes.push(pass2);
    soft.edges = has_edges.then_some(edges);
}
