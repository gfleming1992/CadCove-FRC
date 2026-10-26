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

// Temporary solver storage: applying each PGS impulse through RigidBodySet
// repeats handle validation, change tracking and wakeups hundreds of times per
// body. The mass properties are constant during this solve. Keep the exact
// impulse arithmetic/order, then publish velocities and wake each touched body.
struct BodyVelocity {
    handle: RigidBodyHandle,
    linear: Vector,
    angular: Vector,
    inverse_mass: Vector,
    inverse_inertia: rapier3d::math::AngularInertia,
    dynamic: bool,
    touched: bool,
    visited: bool,
}

pub fn solve(rows: &[Row], bodies: &mut RigidBodySet, dt: f32) -> Vec<f32> {
    let mut slots = std::collections::HashMap::new();
    let mut velocities = Vec::new();
    let terms: Vec<Vec<usize>> = rows.iter().map(|row| row.terms.iter().map(|term| {
        *slots.entry(term.body).or_insert_with(|| {
            let body = &bodies[term.body];
            let mass = body.mass_properties();
            let slot = velocities.len();
            velocities.push(BodyVelocity {
                handle: term.body, linear: body.linvel(), angular: body.angvel(),
                inverse_mass: mass.effective_inv_mass,
                inverse_inertia: mass.effective_world_inv_inertia,
                dynamic: body.is_dynamic(), touched: false, visited: false,
            });
            slot
        })
    }).collect()).collect();
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
    let mut modified = Vec::new();
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
                .iter().zip(&terms[i])
                .map(|(term, slot)| {
                    let body = &velocities[*slot];
                    term.linear.dot(body.linear) + term.angular.dot(body.angular)
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
            for (term, slot) in row.terms.iter().zip(&terms[i]) {
                let body = &mut velocities[*slot];
                // Preserve the engine's first-access modification order, including
                // fixed bodies and zero Jacobian terms. This keeps downstream
                // broad-phase bookkeeping identical to direct impulse application.
                if !body.visited { modified.push(*slot);body.visited=true; }
                if !body.dynamic { continue; }
                let impulse = term.linear * applied;
                let torque = term.angular * applied;
                if impulse != Vector::ZERO {
                    body.linear += impulse * body.inverse_mass;
                    body.touched = true;
                }
                if torque != Vector::ZERO {
                    body.angular += body.inverse_inertia * torque;
                    body.touched = true;
                }
            }
        }
        if max_change < 1e-7 {
            break;
        }
    }
    for slot in modified {
        let velocity = &velocities[slot];
        let body = &mut bodies[velocity.handle];
        if velocity.touched {
            body.set_linvel(velocity.linear, false);
            body.set_angvel(velocity.angular, false);
            body.wake_up(true);
        }
    }
    impulses.into_iter().map(|impulse| impulse / dt).collect()
}

// Pre-optimization implementation retained only as a numerical regression oracle.
#[cfg(test)]
fn solve_reference(rows: &[Row], bodies: &mut RigidBodySet, dt: f32) -> Vec<f32> {
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compact_velocities_match_engine_impulses_bit_for_bit() {
        for dt in [0.0005, 0.005, 0.02] {
            let mut bodies = RigidBodySet::new();
            let handles: Vec<_> = (0..12).map(|i| {
                let mut b = if i == 0 { RigidBodyBuilder::fixed() }
                    else if i == 1 { RigidBodyBuilder::kinematic_velocity_based() }
                    else { RigidBodyBuilder::dynamic() }
                    .additional_mass_properties(MassProperties::new(Vector::ZERO, 1.0+i as f32,
                        Vector::new(0.2, 0.3, 0.4)))
                    .linvel(Vector::new(0.1, -0.2, i as f32*0.03))
                    .angvel(Vector::new(0.5, 0.1, -0.2))
                    .locked_axes(if i == 3 { LockedAxes::TRANSLATION_LOCKED_X } else { LockedAxes::empty() })
                    .build();
                b.recompute_mass_properties_from_colliders(&ColliderSet::new());
                if i == 4 { b.sleep(); }
                bodies.insert(b)
            }).collect();
            let mut reference = bodies.clone();
            let rows: Vec<_> = (0..36).map(|i| Row {
                terms: (0..3).map(|k| Jacobian {
                    body: handles[(i+k)%handles.len()],
                    linear: Vector::new((i%3) as f32*0.2, 0.3, -0.1),
                    angular: Vector::new(-0.2, (k+1) as f32*0.1, 0.4),
                }).collect(),
                error: (i%4) as f32*0.01, stiffness: 200.0, damping: 3.0,
                max_effort: 20.0, min_effort: if i%3==0 { 0.0 } else { -20.0 },
                target_velocity: (i%5) as f32-2.0,
            }).collect();
            for _ in 0..20 {
                let actual = solve(&rows, &mut bodies, dt);
                let expected = solve_reference(&rows, &mut reference, dt);
                assert_eq!(actual.iter().map(|v| v.to_bits()).collect::<Vec<_>>(),
                    expected.iter().map(|v| v.to_bits()).collect::<Vec<_>>());
                for handle in &handles {
                    let a=&bodies[*handle];let b=&reference[*handle];
                    assert_eq!(a.linvel().to_array().map(f32::to_bits), b.linvel().to_array().map(f32::to_bits));
                    assert_eq!(a.angvel().to_array().map(f32::to_bits), b.angvel().to_array().map(f32::to_bits));
                    assert_eq!(a.is_sleeping(), b.is_sleeping());
                }
                assert_eq!(serde_json::to_value(&bodies).unwrap(), serde_json::to_value(&reference).unwrap());
            }
        }
    }
}
