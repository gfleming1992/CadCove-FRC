//! Compliant mechanical coupling between joint coordinates.
//!
//! C = q_follower - ratio * q_driver - phase. A signed ratio supports gears,
//! belts and rotary-to-linear drums. Impulses act on every participating body,
//! including the supporting frames: followers can back-drive or stall a motor.
//! This is a bounded spring/damper, not an infinitely rigid gear constraint.
//! Backward-Euler softness follows the standard soft-constraint formulation:
//! https://box2d.org/files/ErinCatto_SoftConstraints_GDC2011.pdf
use rapier3d::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
pub struct TransmissionSpec {
    pub id: String,
    pub driver: String,
    pub follower: String,
    /// Follower units / driver units (rad/rad, m/rad, ...).
    pub ratio: f32,
    #[serde(default)]
    pub phase: f32,
    /// Generalized follower force per follower coordinate error.
    pub stiffness: f32,
    pub damping: f32,
    /// Maximum follower torque (Nm) or linear force (N).
    pub max_effort: f32,
}

#[derive(Clone, Default, Serialize)]
pub struct TransmissionState {
    pub error: f32,
    pub velocity_error: f32,
    pub effort: f32,
    pub saturated: bool,
}

pub struct Jacobian {
    pub body: RigidBodyHandle,
    pub linear: Vector,
    pub angular: Vector,
}

pub struct Row {
    pub terms: Vec<Jacobian>,
    pub error: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub max_effort: f32,
    pub min_effort: f32,
    pub target_velocity: f32,
}

/// Merge shared frames before calculating J M^-1 J^T. Counting the same frame
/// twice independently would lose cross terms and apply incorrect reactions.
pub fn add_term(terms: &mut Vec<Jacobian>, term: Jacobian) {
    if let Some(existing) = terms.iter_mut().find(|t| t.body == term.body) {
        existing.linear += term.linear;
        existing.angular += term.angular;
    } else {
        terms.push(term);
    }
}

pub fn solve(rows: &[Row], bodies: &mut RigidBodySet, dt: f32) -> Vec<f32> {
    let coefficients: Vec<_> = rows
        .iter()
        .map(|row| {
            let inverse_mass: f32 = row
                .terms
                .iter()
                .map(|term| {
                    let body = &bodies[term.body];
                    if !body.is_dynamic() {
                        return 0.0;
                    }
                    let mass = body.mass_properties();
                    term.linear.dot(term.linear * mass.effective_inv_mass)
                        + term
                            .angular
                            .dot(mass.effective_world_inv_inertia * term.angular)
                })
                .sum();
            let spring = row.damping + dt * row.stiffness;
            let softness = if spring > 0.0 {
                1.0 / (dt * spring)
            } else {
                0.0
            };
            let bias = if spring > 0.0 {
                (row.stiffness * row.error - row.damping * row.target_velocity) / spring
            } else {
                -row.target_velocity
            };
            (inverse_mass, softness, bias)
        })
        .collect();
    let mut impulses = vec![0.0f32; rows.len()];
    // PGS couples an entire belt graph. Accumulated impulses enforce one force
    // budget per timestep, rather than multiplying the budget by the iterations.
    for _ in 0..128 {
        let mut max_change = 0.0f32;
        for (i, row) in rows.iter().enumerate() {
            let (inverse_mass, softness, bias) = coefficients[i];
            if inverse_mass <= 0.0 {
                continue;
            }
            let velocity: f32 = row
                .terms
                .iter()
                .map(|term| {
                    let body = &bodies[term.body];
                    term.linear.dot(body.linvel()) + term.angular.dot(body.angvel())
                })
                .sum();
            let delta = -(velocity + bias + softness * impulses[i]) / (inverse_mass + softness);
            let next = (impulses[i] + delta).clamp(row.min_effort * dt, row.max_effort * dt);
            let applied = next - impulses[i];
            max_change = max_change.max(applied.abs());
            impulses[i] = next;
            if applied.abs() < 1e-10 {
                continue;
            }
            for term in &row.terms {
                let body = &mut bodies[term.body];
                body.apply_impulse(term.linear * applied, true);
                body.apply_torque_impulse(term.angular * applied, true);
            }
        }
        if max_change < 1e-7 {
            break;
        }
    }
    impulses.into_iter().map(|impulse| impulse / dt).collect()
}
