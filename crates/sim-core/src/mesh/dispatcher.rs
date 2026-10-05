//! Experimental conservative plane rejection for triangle/triangle contacts.
//! All accepted/uncertain pairs retain Parry's original contact algorithm.
#[cfg(feature = "parallel-composite")]
mod composite;
#[cfg(feature = "composite-audit")]
pub(crate) mod reverse_audit;
#[cfg(any(feature = "composite-audit", feature = "composite-filter"))]
mod reverse_bounds;
use rapier3d::parry::{
    math::{Pose, Real, Vector},
    query::{
        self, ClosestPoints, Contact, ContactManifold, DefaultQueryDispatcher,
        NonlinearRigidMotion, PersistentQueryDispatcher, QueryDispatcher, ShapeCastHit,
        ShapeCastOptions, ShapeDistance, ShapeIntersection, Unsupported,
        details::{ContactManifoldsWorkspace, NormalConstraints},
    },
    shape::{Shape, Triangle},
};

#[derive(Clone, Copy, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriangleContactFilter {
    #[default]
    Original,
    Plane,
    Audit,
}

#[derive(Clone, Copy)]
pub struct PlaneContactDispatcher {
    /// Diagnostic mode runs the original algorithm at every proposed rejection.
    pub audit_rejections: bool,
    pub filter_planes: bool,
}

// An interval gap along ANY unit axis is a lower bound on Euclidean distance.
// The two face normals cheaply reject many triangle AABB false positives on
// sloped CAD panels. This does not remove faces, fill holes or shrink prediction.
fn separated(pos12: &Pose, a: &Triangle, b: &Triangle, prediction: Real) -> bool {
    if !prediction.is_finite() || prediction < 0.0 {
        return false;
    }
    let a = [a.a, a.b, a.c];
    let original_b = [b.a, b.b, b.c];
    let b = original_b.map(|p| pos12 * p);
    if !a.iter().chain(&b).all(|p| p.is_finite()) {
        return false;
    }
    // Cover f32 transform, dot product and subtraction error conservatively;
    // near-contact and very large-coordinate cases fall back to the original.
    let scale = a
        .iter()
        .chain(&b)
        .chain(&original_b)
        .map(|p| p.abs().max_element())
        .fold(1.0_f32, f32::max)
        + pos12.translation.abs().max_element();
    let margin = prediction + 64.0 * f32::EPSILON * scale;
    for t in [&a, &b] {
        let normal = (t[1] - t[0]).cross(t[2] - t[0]);
        let length = normal.length();
        if !length.is_finite() || length < 1.0e-12 {
            continue;
        }
        let axis = normal / length;
        let project = |t: &[Vector; 3]| {
            let values = t.map(|p| p.dot(axis));
            (
                values.into_iter().fold(f32::INFINITY, f32::min),
                values.into_iter().fold(f32::NEG_INFINITY, f32::max),
            )
        };
        let (amin, amax) = project(&a);
        let (bmin, bmax) = project(&b);
        if bmin - amax > margin || amin - bmax > margin {
            return true;
        }
    }
    false
}

// Ordinary distance, ray/shape cast and intersection behavior stays upstream.
impl QueryDispatcher for PlaneContactDispatcher {
    fn intersection_test(
        &self,
        p: &Pose,
        a: &dyn Shape,
        b: &dyn Shape,
    ) -> Result<ShapeIntersection, Unsupported> {
        DefaultQueryDispatcher.intersection_test(p, a, b)
    }
    fn distance(
        &self,
        p: &Pose,
        a: &dyn Shape,
        b: &dyn Shape,
    ) -> Result<ShapeDistance, Unsupported> {
        DefaultQueryDispatcher.distance(p, a, b)
    }
    fn contact(
        &self,
        p: &Pose,
        a: &dyn Shape,
        b: &dyn Shape,
        d: Real,
    ) -> Result<Option<Contact>, Unsupported> {
        DefaultQueryDispatcher.contact(p, a, b, d)
    }
    fn closest_points(
        &self,
        p: &Pose,
        a: &dyn Shape,
        b: &dyn Shape,
        d: Real,
    ) -> Result<ClosestPoints, Unsupported> {
        DefaultQueryDispatcher.closest_points(p, a, b, d)
    }
    fn cast_shapes(
        &self,
        p: &Pose,
        v: Vector,
        a: &dyn Shape,
        b: &dyn Shape,
        o: ShapeCastOptions,
    ) -> Result<Option<ShapeCastHit>, Unsupported> {
        DefaultQueryDispatcher.cast_shapes(p, v, a, b, o)
    }
    fn cast_shapes_nonlinear(
        &self,
        m1: &NonlinearRigidMotion,
        a: &dyn Shape,
        m2: &NonlinearRigidMotion,
        b: &dyn Shape,
        start: Real,
        end: Real,
        stop: bool,
    ) -> Result<Option<ShapeCastHit>, Unsupported> {
        DefaultQueryDispatcher.cast_shapes_nonlinear(m1, a, m2, b, start, end, stop)
    }
}
impl<M: Default + Clone + Send + Sync + 'static, C: Default + Copy + Send + Sync + 'static>
    PersistentQueryDispatcher<M, C> for PlaneContactDispatcher
{
    fn contact_manifolds(
        &self,
        p: &Pose,
        a: &dyn Shape,
        b: &dyn Shape,
        d: Real,
        manifolds: &mut Vec<ContactManifold<M, C>>,
        workspace: &mut Option<ContactManifoldsWorkspace>,
    ) -> Result<(), Unsupported> {
        if let (Some(ca), Some(cb)) = (a.as_composite_shape(), b.as_composite_shape()) {
            #[cfg(feature = "parallel-composite")]
            if !self.filter_planes {
                composite::contacts(p, a, b, d, manifolds, workspace);
                return Ok(());
            }
            query::details::contact_manifolds_composite_shape_composite_shape(
                self, p, ca, cb, d, manifolds, workspace,
            );
            Ok(())
        } else {
            DefaultQueryDispatcher.contact_manifolds(p, a, b, d, manifolds, workspace)
        }
    }
    fn contact_manifold_convex_convex(
        &self,
        p: &Pose,
        a: &dyn Shape,
        b: &dyn Shape,
        n1: Option<&dyn NormalConstraints>,
        n2: Option<&dyn NormalConstraints>,
        d: Real,
        manifold: &mut ContactManifold<M, C>,
    ) -> Result<(), Unsupported> {
        if !self.filter_planes {
            return DefaultQueryDispatcher.contact_manifold_convex_convex(p, a, b, n1, n2, d, manifold);
        }
        if let (Some(a), Some(b)) = (a.as_triangle(), b.as_triangle()) {
            if separated(p, a, b, d) {
                if self.audit_rejections {
                    let result = DefaultQueryDispatcher
                        .contact_manifold_convex_convex(p, a, b, n1, n2, d, manifold);
                    assert!(
                        manifold.points.iter().all(|point| point.dist > d),
                        "plane filter rejected an in-range upstream contact: prediction={d}, a={a:?}, b={b:?}, pose={p:?}, points={:?}",
                        manifold
                            .points
                            .iter()
                            .map(|point| (point.local_p1, point.local_p2, point.dist))
                            .collect::<Vec<_>>()
                    );
                    return result;
                }
                manifold.clear();
                // Reset a stale GJK hint; the next accepted pair is recomputed.
                manifold.local_n1 = Vector::ZERO;
                return Ok(());
            }
        }
        DefaultQueryDispatcher.contact_manifold_convex_convex(p, a, b, n1, n2, d, manifold)
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod support_point_tests;
