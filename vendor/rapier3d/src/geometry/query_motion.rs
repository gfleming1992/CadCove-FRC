//! Scoped motion information for an optional conservative composite query filter.
//! The dispatcher copies the context before scheduling its own parallel jobs.
use crate::dynamics::{RigidBody, RigidBodyVelocity};
use crate::geometry::Collider;
use crate::math::{Pose, Real, Vector};
use parry::query::ContactManifold;
use parry::utils::PoseOpt;
use std::cell::Cell;

/// Immutable pair kinematics, captured before nested query parallelism.
#[derive(Clone, Copy)]
pub struct QueryMotion {
    poses: [Pose; 2],
    centers: [Vector; 2],
    velocities: [RigidBodyVelocity<Real>; 2],
    skins: [Real; 2],
    prediction: Real,
    soft_prediction: Real,
    dt: Real,
    /// Conservative point separation beyond both selection-distance tests.
    pub reach: Real,
}

std::thread_local! {
    static CURRENT: Cell<Option<QueryMotion>> = const { Cell::new(None) };
}

pub(crate) struct QueryMotionGuard(Option<QueryMotion>);
impl Drop for QueryMotionGuard {
    fn drop(&mut self) {
        CURRENT.set(self.0);
    }
}

impl QueryMotion {
    /// Only call for a soft mesh against a rigid mesh, without modification hooks.
    pub(crate) fn new(
        colliders: [&Collider; 2],
        bodies: [Option<&RigidBody>; 2],
        prediction: Real,
        soft_prediction: Real,
        query_prediction: Real,
        dt: Real,
    ) -> Option<Self> {
        let centers = bodies.map(|b| b.map_or(Vector::ZERO, RigidBody::center_of_mass));
        let velocities = bodies.map(|b| b.map_or_else(RigidBodyVelocity::zero, |b| b.vels));
        let skins = colliders.map(|c| c.contact_skin());
        let mut speed_bound = 0.0;
        for i in 0..2 {
            let bounds = colliders[i].compute_collision_aabb(0.0);
            // Maximum radius of the world AABB about the body's center of mass.
            let radius = (bounds.mins - centers[i])
                .abs()
                .max((bounds.maxs - centers[i]).abs())
                .length();
            speed_bound += velocities[i].linvel.length() + velocities[i].angvel.length() * radius;
        }
        let reach = query_prediction.max(prediction + skins[0] + skins[1] + dt * speed_bound);
        if !speed_bound.is_finite()
            || !query_prediction.is_finite()
            || !reach.is_finite()
            || dt < 0.0
            || !dt.is_finite()
        {
            return None;
        }
        Some(Self {
            poses: colliders.map(|c| *c.position()),
            centers,
            velocities,
            skins,
            prediction,
            soft_prediction,
            dt,
            reach,
        })
    }

    /// Publish only around the outer dispatcher call; restored even on unwinding.
    pub(crate) fn enter(context: Option<Self>) -> QueryMotionGuard {
        QueryMotionGuard(CURRENT.replace(context))
    }

    /// Copy the enclosing pair context before dispatching worker jobs.
    pub fn current() -> Option<Self> {
        CURRENT.get()
    }

    /// An audit overestimate: test every original point, including ones that
    /// manifold reduction might discard. Mirrors narrow-phase selection math.
    pub fn potentially_kept_points<M, C>(&self, manifold: &ContactManifold<M, C>) -> usize {
        let p1 = manifold.subshape_pos1().prepend_to(&self.poses[0]);
        let p2 = manifold.subshape_pos2().prepend_to(&self.poses[1]);
        let normal = p1.rotation * manifold.local_n1;
        manifold
            .points
            .iter()
            .filter(|contact| {
                if !contact.dist.is_finite()
                    || !contact.local_p1.is_finite()
                    || !contact.local_p2.is_finite()
                    || !normal.is_finite()
                {
                    return true;
                }
                let dist = contact.dist - self.skins[0] - self.skins[1];
                dist < self.prediction + self.soft_prediction || {
                    let v1 = self.velocities[0]
                        .velocity_at_point(p1 * contact.local_p1, self.centers[0]);
                    let v2 = self.velocities[1]
                        .velocity_at_point(p2 * contact.local_p2, self.centers[1]);
                    dist + (v2 - v1).dot(normal) * self.dt < self.prediction
                }
            })
            .count()
    }
}
