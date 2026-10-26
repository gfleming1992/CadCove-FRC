//! Explicit practice approximation for powered internal field conveyors.
//! Only the internal passage is prescribed. Admission, exit clearance, motor
//! power, ball identity and subsequent rigid-body flight remain observable.
use super::*;

#[derive(Clone, Deserialize, Serialize)]
pub struct ConveyorSpec {
    pub id: String,
    pub frame: String,
    pub capture_center: [f32; 3],
    pub capture_half: [f32; 3],
    pub path: Vec<[f32; 3]>,
    /// Signed rotor turns drive travel; no motion while power is absent.
    pub motor: String,
    pub direction: f32,
    pub metres_per_rotor_turn: f32,
    pub required_motors: Vec<String>,
}
struct Cargo {
    id: String,
    position: Vector,
    waypoint: usize,
}
#[derive(Default)]
pub(super) struct Runtime {
    cargo: Vec<Option<Cargo>>,
    admitted: u64,
    discharged: u64,
}
#[derive(Serialize)]
pub struct Status {
    pub admitted: u64,
    pub discharged: u64,
    pub carried: Vec<String>,
}
impl World {
    pub(super) fn release_field_cargo(&mut self, id: &str) {
        for cargo in &mut self.field_transport.cargo {
            if cargo.as_ref().is_some_and(|c| c.id == id) { *cargo = None; }
        }
    }

    pub(super) fn validate_field_transport(&mut self) -> Result<()> {
        let Some(g) = &self.spec.gameplay else {
            return Ok(());
        };
        let mut ids = std::collections::HashSet::new();
        ensure!(g.field_conveyors.len() <= 64, "too many field conveyors");
        ensure!(
            g.field_conveyors.is_empty() || !g.field_compliance,
            "choose one field transport representation"
        );
        for c in &g.field_conveyors {
            ensure!(
                !c.id.is_empty() && ids.insert(&c.id),
                "duplicate field conveyor"
            );
            ensure!(
                self.spec.bodies.iter().any(|b| b.id == c.frame && b.fixed),
                "field conveyor frame must be fixed"
            );
            ensure!(
                self.motor_states.contains_key(&c.motor)
                    && c.required_motors
                        .iter()
                        .all(|m| self.motor_states.contains_key(m)),
                "unknown conveyor motor"
            );
            ensure!(
                c.direction.abs() == 1.0
                    && c.metres_per_rotor_turn.is_finite()
                    && (0.0001..=0.1).contains(&c.metres_per_rotor_turn),
                "invalid conveyor drive"
            );
            ensure!(
                c.capture_center.iter().all(|x| x.is_finite())
                    && c.capture_half
                        .iter()
                        .all(|x| x.is_finite() && *x > 0.0 && *x <= 2.0),
                "invalid conveyor admission box"
            );
            ensure!(
                (2..=16).contains(&c.path.len()) && c.path.iter().flatten().all(|x| x.is_finite()),
                "invalid conveyor path"
            );
            ensure!(
                c.path.windows(2).all(|p| {
                    let d = (Vector::from(p[1]) - Vector::from(p[0])).length();
                    d > 0.001 && d < 3.0
                }),
                "invalid conveyor path segment"
            );
        }
        self.field_transport.cargo = (0..g.field_conveyors.len()).map(|_| None).collect();
        Ok(())
    }
    pub(super) fn field_transport_step(&mut self, input: &Input) {
        let Some(g) = self.spec.gameplay.clone() else {
            return;
        };
        let powered: Vec<f32> = g
            .field_conveyors
            .iter()
            .map(|c| {
                let volts = input.volts.get(&c.motor).copied().unwrap_or(0.0) * c.direction;
                let rps = self.motor_states[&c.motor].rotor_rps * c.direction;
                if volts <= 1.0
                    || rps <= 1.0
                    || c.required_motors.iter().any(|m| {
                        input.volts.get(m).copied().unwrap_or(0.0).abs() <= 1.0
                            || self.motor_states[m].rotor_rps.abs() <= 1.0
                    })
                {
                    0.0
                } else {
                    rps * c.metres_per_rotor_turn
                }
            })
            .collect();
        // Each lane owns at most one ball. Choose the closest available lane;
        // other balls remain physical upstream, rather than entering a hidden queue.
        for id in &g.balls {
                if self.physical_only(id) || self.any_robot_carries(id) { continue; }
            let h = self.body_ids[id];
            let b = &self.bodies[h];
            if !b.is_enabled() {
                continue;
            }
            let lane = g
                .field_conveyors
                .iter()
                .enumerate()
                .filter(|(i, _)| powered[*i] > 0.0 && self.field_transport.cargo[*i].is_none())
                .filter_map(|(i, c)| {
                    let p =
                        self.bodies[self.body_ids[&c.frame]].position().inverse() * b.translation();
                    if (p - Vector::from(c.capture_center))
                        .abs()
                        .cmple(Vector::from(c.capture_half))
                        .all()
                    {
                        Some((i, (p - Vector::from(c.path[0])).length_squared(), p))
                    } else {
                        None
                    }
                })
                .min_by(|a, b| a.1.total_cmp(&b.1));
            if let Some((i, _, position)) = lane {
                self.bodies[h].set_enabled(false);
                self.field_transport.cargo[i] = Some(Cargo {
                    id: id.clone(),
                    position,
                    waypoint: 0,
                });
                self.field_transport.admitted += 1;
            }
        }
        for (i, c) in g.field_conveyors.iter().enumerate() {
            let Some(mut cargo) = self.field_transport.cargo[i].take() else {
                continue;
            };
            let frame = *self.bodies[self.body_ids[&c.frame]].position();
            let mut travel = powered[i] * self.spec.dt;
            while cargo.waypoint < c.path.len() && travel > 0.0 {
                let delta = Vector::from(c.path[cargo.waypoint]) - cargo.position;
                let distance = delta.length();
                if distance <= travel {
                    cargo.position = Vector::from(c.path[cargo.waypoint]);
                    cargo.waypoint += 1;
                    travel -= distance;
                } else {
                    cargo.position += delta * (travel / distance);
                    break;
                }
            }
            let h = self.body_ids[&cargo.id];
            let position = frame * cargo.position;
            let b = &mut self.bodies[h];
            b.set_translation(position, false);
            b.set_linvel(Vector::ZERO, false);
            b.set_angvel(Vector::ZERO, false);
            if cargo.waypoint == c.path.len() && powered[i] > 0.0 {
                let radius = self.ball_radius(&cargo.id);
                let groups = self.colliders[self.bodies[h].colliders()[0]].collision_groups();
                let query = self.broad.as_query_pipeline(
                    self.narrow.query_dispatcher(),
                    &self.bodies,
                    &self.colliders,
                    QueryFilter::default()
                        .exclude_rigid_body(h)
                        .exclude_sensors()
                        .groups(groups),
                );
                let ball = Ball::new(radius + 0.001);
                // Never restore a sphere inside a wall, another ball or a robot.
                let obstructed = query
                    .intersect_shape(Pose::translation(position.x, position.y, position.z), &ball)
                    .next()
                    .is_some();
                // Also account for earlier releases in this very step: broad-phase
                // membership isn't rebuilt until the next physics step.
                let ball_blocked = g.balls.iter().filter(|id| **id != cargo.id).any(|id| {
                    let other = &self.bodies[self.body_ids[id]];
                    other.is_enabled()
                        && (other.translation() - position).length()
                            < radius + self.ball_radius(id) + 0.002
                });
                if !obstructed && !ball_blocked {
                    let n = c.path.len();
                    let direction = frame.rotation
                        * (Vector::from(c.path[n - 1]) - Vector::from(c.path[n - 2])).normalize();
                    let b = &mut self.bodies[h];
                    b.set_linvel(direction * powered[i], false);
                    b.set_enabled(true);
                    b.wake_up(true);
                    self.field_transport.discharged += 1;
                    continue;
                }
            }
            self.field_transport.cargo[i] = Some(cargo);
        }
    }
    pub(super) fn field_transport_status(&self) -> Status {
        Status {
            admitted: self.field_transport.admitted,
            discharged: self.field_transport.discharged,
            carried: self
                .field_transport
                .cargo
                .iter()
                .filter_map(|c| c.as_ref().map(|c| c.id.clone()))
                .collect(),
        }
    }
}
