//! Explicit reduced-order mechanism model for driver practice only.
//! CAD-body frames and actual motor/joint feedback drive transport and release.
//! After release the existing rigid-body engine owns flight, collisions and scoring.
use super::*;

#[derive(Clone, Deserialize, Serialize)]
pub struct GameplaySpec {
    #[serde(default)]
    pub field_conveyors: Vec<super::field_transport::ConveyorSpec>,
    /// Keep authored foam only in fixed-field zones. Robot internals still use
    /// practice transport; owned cargo must never also become a soft body.
    #[serde(default)]
    pub field_compliance: bool,
    pub carrier: String,
    pub balls: Vec<String>,
    pub intake_body: String,
    pub intake_center: [f32; 3],
    pub intake_half: [f32; 3],
    pub intake_motor: String,
    pub storage_origin: [f32; 3],
    pub storage_spacing: f32,
    /// Optional CAD-authored centers in the carrier frame. The legacy grid is
    /// accepted for older projects, and settled cargo remains collision-enabled.
    #[serde(default)]
    pub storage_slots: Vec<[f32; 3]>,
    pub capacity: usize,
    pub transport_seconds: f32,
    pub launchers: Vec<LauncherSpec>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct LauncherSpec {
    pub frame: String,
    pub hood_joint: String,
    pub flywheel_joint: String,
    pub feed_motor: String,
    pub pivot: [f32; 3],
    pub forward: [f32; 3],
    pub wheel_radius: f32,
    pub guide_radius: f32,
    pub speed_ratio: f32,
    pub seconds_per_ball: f32,
}
struct Carried {
    id: String,
    start_local: Vector,
    age: f32,
    slot: usize,
    stored: bool,
}
#[derive(Default)]
pub(super) struct Runtime {
    carried: Vec<Carried>,
    cooldown: Vec<f32>,
    captured: u64,
    launched: u64,
    released: u64,
}
#[derive(Serialize)]
pub struct Status {
    pub field_transport: super::field_transport::Status,
    pub mode: &'static str,
    pub captured: u64,
    pub launched: u64,
    pub carried: Vec<String>,
    pub released: u64,
}
impl GameplaySpec {
    fn storage_target(&self, slot: usize) -> Vector {
        self.storage_slots
            .get(slot)
            .map(|p| Vector::from(*p))
            .unwrap_or_else(|| {
                Vector::from(self.storage_origin)
                    + Vector::new(
                        (slot % 3) as f32,
                        ((slot / 3) % 4) as f32,
                        (slot / 12) as f32,
                    ) * self.storage_spacing
            })
    }
}
impl World {
    pub(super) fn validate_gameplay(&mut self) -> Result<()> {
        let Some(g) = &self.spec.gameplay else {
            return Ok(());
        };
        if g.field_compliance {
            ensure!(
                !self.spec.compliance_zones.is_empty()
                    && self.spec.compliance_zones.iter().all(|z| self
                        .spec
                        .bodies
                        .iter()
                        .any(|b| b.id == z.body && b.fixed)),
                "gameplay field compliance requires only fixed-field zones"
            );
        } else {
            ensure!(
                self.spec.bodies.iter().all(|b| b.compliance.is_none()),
                "gameplay transport requires rigid balls unless field compliance is explicit"
            );
        }
        ensure!(
            self.body_ids.contains_key(&g.carrier)
                && self.body_ids.contains_key(&g.intake_body)
                && self.motor_states.contains_key(&g.intake_motor),
            "unknown gameplay carrier/intake reference"
        );
        ensure!(
            (1..=64).contains(&g.capacity) && !g.launchers.is_empty() && g.launchers.len() <= 8,
            "invalid gameplay capacity/launchers"
        );
        ensure!(
            g.transport_seconds.is_finite()
                && (0.05..=5.0).contains(&g.transport_seconds)
                && g.storage_spacing.is_finite()
                && (0.01..=1.0).contains(&g.storage_spacing),
            "invalid gameplay transport dimensions"
        );
        ensure!(
            g.intake_center
                .iter()
                .chain(&g.storage_origin)
                .all(|v| v.is_finite())
                && g.intake_half
                    .iter()
                    .all(|v| v.is_finite() && *v > 0.0 && *v < 2.0),
            "invalid gameplay intake bounds"
        );
        let mut ids = std::collections::HashSet::new();
        for id in &g.balls {
            ensure!(ids.insert(id), "duplicate gameplay ball");
            let b = self
                .spec
                .bodies
                .iter()
                .find(|b| &b.id == id)
                .context("unknown gameplay ball")?;
            ensure!(
                !b.fixed
                    && matches!(b.colliders.as_slice(),[ShapeSpec::Ball{center,..}] if *center==[0.0;3])
                    && !self
                        .spec
                        .joints
                        .iter()
                        .any(|j| j.parent == *id || j.child == *id),
                "gameplay cargo must be an unjointed dynamic sphere"
            );
        }
        ensure!(
            g.storage_slots.is_empty() || g.storage_slots.len() == g.capacity,
            "storage slots must match gameplay capacity"
        );
        ensure!(
            g.storage_slots.iter().flatten().all(|v| v.is_finite()),
            "non-finite gameplay storage slot"
        );
        let diameter = g
            .balls
            .iter()
            .map(|id| self.ball_radius(id) * 2.0)
            .fold(0.0_f32, f32::max);
        for a in 0..g.capacity {
            for b in 0..a {
                ensure!(
                    (g.storage_target(a) - g.storage_target(b)).length() + 1.0e-6 >= diameter,
                    "gameplay storage slots overlap"
                );
            }
        }
        for l in &g.launchers {
            ensure!(
                self.body_ids.contains_key(&l.frame)
                    && self.motor_states.contains_key(&l.feed_motor)
                    && [&l.hood_joint, &l.flywheel_joint].iter().all(|id| self
                        .spec
                        .joints
                        .iter()
                        .any(|j| &j.id == *id && j.kind == "revolute")),
                "unknown gameplay launcher reference"
            );
            ensure!(
                l.pivot.iter().chain(&l.forward).all(|v| v.is_finite())
                    && (Vector::from(l.forward).length() - 1.0).abs() < 0.001,
                "invalid gameplay launch frame"
            );
            ensure!(
                [
                    l.wheel_radius,
                    l.guide_radius,
                    l.speed_ratio,
                    l.seconds_per_ball
                ]
                .iter()
                .all(|v| v.is_finite() && *v > 0.0)
                    && l.guide_radius > l.wheel_radius
                    && l.speed_ratio <= 1.0
                    && l.seconds_per_ball >= 0.05,
                "invalid gameplay launcher calibration"
            );
        }
        self.gameplay.cooldown = vec![0.0; g.launchers.len()];
        self.validate_field_transport()?;
        Ok(())
    }
    pub(super) fn gameplay_step(&mut self, input: &Input) {
        let Some(g) = self.spec.gameplay.clone() else {
            return;
        };
        let dt = self.spec.dt;
        let carrier = *self.bodies[self.body_ids[&g.carrier]].position();
        let intake = *self.bodies[self.body_ids[&g.intake_body]].position();
        let powered = input.volts.get(&g.intake_motor).copied().unwrap_or(0.0) > 1.0
            && self.motor_states[&g.intake_motor].rotor_rps > 5.0;
        if powered {
            for id in &g.balls {
                if self.gameplay.carried.len() >= g.capacity {
                    break;
                }
                let h = self.body_ids[id];
                let b = &self.bodies[h];
                if !b.is_enabled() || self.gameplay.carried.iter().any(|c| c.id == *id) {
                    continue;
                }
                let radius = self.ball_radius(id);
                let p = intake.inverse() * b.translation();
                if (p - Vector::from(g.intake_center))
                    .abs()
                    .cmple(Vector::from(g.intake_half) + Vector::splat(radius))
                    .all()
                {
                    let Some(slot) = (0..g.capacity).find(|i| {
                        !self.gameplay.carried.iter().any(|c| c.slot == *i)
                            && self.gameplay_storage_clear(id, carrier * g.storage_target(*i))
                    }) else {
                        continue;
                    };
                    let start_local = carrier.inverse() * b.translation();
                    // The short intake nip remains a reduced-order conveyor.
                    // Never disable the proxy after it reaches clear storage.
                    self.bodies[h].set_enabled(false);
                    self.bodies[h].enable_ccd(true);
                    self.gameplay.carried.push(Carried {
                        id: id.clone(),
                        start_local,
                        age: 0.0,
                        slot,
                        stored: false,
                    });
                    self.gameplay.captured += 1;
                }
            }
        }
        let mut released = Vec::new();
        for index in 0..self.gameplay.carried.len() {
            let c = &mut self.gameplay.carried[index];
            c.age += dt;
            let target = carrier * g.storage_target(c.slot);
            let h = self.body_ids[&c.id];
            if !c.stored {
                let t = (c.age / g.transport_seconds).min(1.0);
                let smooth = t * t * (3.0 - 2.0 * t);
                let p = carrier * c.start_local + (target - carrier * c.start_local) * smooth;
                // Reservations are checked again: moving mechanisms and free
                // balls can occupy a slot after intake has begun. Give an
                // obstructed transfer back to physics; never strand a disabled
                // proxy behind a moving robot or fill an occupied slot.
                let clear = self.gameplay_storage_clear(&self.gameplay.carried[index].id, target);
                let c = &mut self.gameplay.carried[index];
                let b = &mut self.bodies[h];
                if clear {
                    b.set_translation(p, false);
                    if t >= 1.0 {
                        b.set_enabled(true);
                        b.set_linvel(Vector::ZERO, true);
                        c.stored = true;
                    }
                } else {
                    b.set_enabled(true);
                    b.wake_up(true);
                    released.push(index);
                }
                continue;
            }
            let carrier_body = &self.bodies[self.body_ids[&g.carrier]];
            let inherited = carrier_body.linvel()
                + carrier_body
                    .angvel()
                    .cross(target - carrier_body.center_of_mass());
            let b = &mut self.bodies[h];
            if (target - b.translation()).length() > 0.35 {
                // A collision can eject cargo. It then belongs to the field,
                // not to an invisible spring or a remote launcher inventory.
                released.push(index);
                continue;
            }
            // Cargo restraint is bounded and contact-resolved. Neither a moving
            // turret nor another sphere can be overridden by a storage pose.
            let acceleration = ((target - b.translation()) * 100.0
                + (inherited - b.linvel()) * 20.0
                - Vector::from(self.spec.gravity))
            .clamp_length_max(30.0);
            b.apply_impulse(acceleration * (b.mass() * dt), true);
        }
        for index in released.into_iter().rev() {
            self.gameplay.carried.remove(index);
            self.gameplay.released += 1;
        }
        for (lane, l) in g.launchers.iter().enumerate() {
            self.gameplay.cooldown[lane] = (self.gameplay.cooldown[lane] - dt).max(0.0);
            if self.gameplay.cooldown[lane] > 0.0
                || input.volts.get(&l.feed_motor).copied().unwrap_or(0.0) <= 1.0
                || self.motor_states[&l.feed_motor].rotor_rps <= 1.0
            {
                continue;
            }
            let omega = self.joint_states[&l.flywheel_joint].velocity;
            let speed = omega.abs() * l.wheel_radius * l.speed_ratio;
            if speed < 1.0 {
                continue;
            }
            let Some(index) = self
                .gameplay
                .carried
                .iter()
                .position(|c| c.stored && c.age >= g.transport_seconds)
            else {
                continue;
            };
            let id = self.gameplay.carried[index].id.clone();
            let h = self.body_ids[&id];
            let radius = self.ball_radius(&id);
            let frame = *self.bodies[self.body_ids[&l.frame]].position();
            let forward = frame.rotation * Vector::from(l.forward);
            let up = frame.rotation * Vector::Z;
            let angle = self.joint_states[&l.hood_joint].position;
            let direction = forward * angle.sin() + up * angle.cos();
            let radial = -forward * angle.cos() + up * angle.sin();
            let exit = frame * Vector::from(l.pivot) + radial * (l.guide_radius - radius);
            // A rigid practice ball cannot leave inside a compressed nip. Find
            // the first free sphere beyond the physical guide edge, never a target.
            let filter = QueryFilter::default()
                .exclude_rigid_body(h)
                .exclude_sensors()
                .groups(self.colliders[self.bodies[h].colliders()[0]].collision_groups());
            let query = self.broad.as_query_pipeline(
                self.narrow.query_dispatcher(),
                &self.bodies,
                &self.colliders,
                filter,
            );
            let ball = Ball::new(radius + 0.001);
            let position = (0..25)
                .map(|i| exit + direction * (radius + 0.01 + i as f32 * 0.005))
                .find(|p| {
                    query
                        .intersect_shape(Pose::translation(p.x, p.y, p.z), &ball)
                        .next()
                        .is_none()
                });
            let Some(position) = position else {
                continue;
            };
            let carrier_body = &self.bodies[self.body_ids[&g.carrier]];
            let inherited = carrier_body.linvel()
                + carrier_body
                    .angvel()
                    .cross(position - carrier_body.center_of_mass());
            let mass = self.bodies[h].mass();
            let b = &mut self.bodies[h];
            b.set_translation(position, false);
            b.set_linvel(inherited + direction * speed, false);
            b.set_angvel(Vector::ZERO, false);
            b.set_enabled(true);
            b.wake_up(true);
            // Impulse load makes the real motor controller respond to each shot.
            let joint = self
                .spec
                .joints
                .iter()
                .find(|j| j.id == l.flywheel_joint)
                .unwrap();
            let axis =
                self.bodies[self.body_ids[&joint.parent]].rotation() * Vector::from(joint.axis);
            self.bodies[self.body_ids[&joint.child]].apply_torque_impulse(
                -axis * (omega.signum() * mass * speed * l.wheel_radius),
                true,
            );
            self.gameplay.carried.remove(index);
            self.gameplay.launched += 1;
            self.gameplay.cooldown[lane] = l.seconds_per_ball;
        }
    }
    fn gameplay_storage_clear(&self, id: &str, position: Vector) -> bool {
        let own = self.body_ids[id];
        let sphere = Ball::new(self.ball_radius(id) + 0.002);
        let pose = Pose::translation(position.x, position.y, position.z);
        let bounds = sphere.compute_aabb(&pose);
        for (_, collider) in self.colliders.iter() {
            if collider.is_sensor() || !collider.is_enabled() {
                continue;
            }
            if let Some(parent) = collider.parent() {
                if parent == own || !self.bodies[parent].is_enabled() {
                    continue;
                }
            }
            if bounds.intersects(&collider.compute_aabb())
                && rapier3d::parry::query::intersection_test(
                    &pose,
                    &sphere,
                    collider.position(),
                    collider.shape(),
                )
                .map(|hit| hit.intersecting)
                .unwrap_or(true)
            {
                return false;
            }
        }
        true
    }
    pub(super) fn gameplay_owns(&self, id: &str) -> bool {
        self.gameplay.carried.iter().any(|c| c.id == id)
    }
    pub(super) fn ball_radius(&self, id: &str) -> f32 {
        self.colliders[self.bodies[self.body_ids[id]].colliders()[0]]
            .shape()
            .as_ball()
            .unwrap()
            .radius
    }
    pub(super) fn gameplay_status(&self) -> Option<Status> {
        self.spec.gameplay.as_ref().map(|_| Status {
            mode: "reduced-order-mechanisms",
            field_transport: self.field_transport_status(),
            captured: self.gameplay.captured,
            launched: self.gameplay.launched,
            released: self.gameplay.released,
            carried: self.gameplay.carried.iter().map(|c| c.id.clone()).collect(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn spec() -> WorldSpec {
        serde_json::from_value(json!({
            "gravity":[0,0,-9.80665],
            "bodies":[
                {"id":"frame","fixed":true,"position":[0,0,0]},
                {"id":"wheel","position":[5,0,0],"colliders":[{"kind":"ball","radius":0.05,"center":[0,0,0]}]},
                {"id":"ball","position":[0,0,0],"colliders":[{"kind":"ball","radius":0.075,"center":[0,0,0]}]},
                {"id":"ball2","position":[0.1,0,0],"colliders":[{"kind":"ball","radius":0.075,"center":[0,0,0]}]}
            ],
            "joints":[{"id":"shaft","kind":"revolute","parent":"frame","child":"wheel","axis":[0,1,0],"anchor_parent":[5,0,0],"anchor_child":[0,0,0]}],
            "motors":[{"id":"motor","joint":"shaft","rotor_per_unit":1,"resistance":0.05,"velocity_constant":50,"torque_constant":0.02,"current_limit":60}],
            "gameplay":{"carrier":"frame","balls":["ball","ball2"],"intake_body":"frame","intake_center":[0,0,0],"intake_half":[0.2,0.2,0.2],"intake_motor":"motor","storage_origin":[0,0,1],"storage_spacing":0.2,"capacity":1,"transport_seconds":0.05,
                "launchers":[{"frame":"frame","hood_joint":"shaft","flywheel_joint":"shaft","feed_motor":"motor","pivot":[0,0,2],"forward":[1,0,0],"wheel_radius":0.05,"guide_radius":0.18,"speed_ratio":0.4,"seconds_per_ball":0.2}]}
        })).unwrap()
    }
    #[test]
    fn transport_requires_power_and_capacity_and_release_uses_measured_motor_speed() {
        let mut w = World::new(spec()).unwrap();
        w.gameplay_step(&Input::default());
        assert_eq!(w.gameplay.captured, 0);
        w.motor_states.get_mut("motor").unwrap().rotor_rps = 10.0;
        let input = Input {
            volts: BTreeMap::from([("motor".into(), 6.0)]),
            ..Default::default()
        };
        w.gameplay_step(&input);
        assert_eq!(w.gameplay.captured, 1);
        assert!(!w.bodies[w.body_ids["ball"]].is_enabled());
        assert!(w.bodies[w.body_ids["ball2"]].is_enabled());
        for _ in 0..20 {
            w.gameplay_step(&input);
        }
        assert_eq!(
            w.gameplay.launched, 0,
            "voltage alone must not launch a ball"
        );
        w.joint_states.get_mut("shaft").unwrap().velocity = 300.0;
        w.gameplay_step(&Input::default());
        assert_eq!(
            w.gameplay.launched, 0,
            "spinning wheel without feed must not launch"
        );
        w.gameplay_step(&input);
        assert_eq!(w.gameplay.launched, 1);
        let b = &w.bodies[w.body_ids["ball"]];
        assert!(b.is_enabled());
        assert!((b.linvel().length() - 6.0).abs() < 0.001);
        let v = b.linvel().z;
        w.step(&Input::default()).unwrap();
        assert!(
            w.bodies[w.body_ids["ball"]].linvel().z < v,
            "released flight must obey gravity"
        );
    }
    #[test]
    fn blocked_storage_is_not_reserved_and_settled_cargo_remains_physical() {
        let mut s = spec();
        s.bodies
            .iter_mut()
            .find(|b| b.id == "ball2")
            .unwrap()
            .position = [3.0, 0.0, 0.0];
        s.bodies.push(
            serde_json::from_value(json!({
                "id":"barrel","fixed":true,"position":[0,0,1],
                "colliders":[{"kind":"box","half":[1,1,0.025],"center":[0,0,0]}]
            }))
            .unwrap(),
        );
        let mut w = World::new(s.clone()).unwrap();
        let input = Input {
            volts: BTreeMap::from([("motor".into(), 6.0)]),
            ..Default::default()
        };
        w.motor_states.get_mut("motor").unwrap().rotor_rps = 10.0;
        w.gameplay_step(&input);
        assert_eq!(
            w.gameplay.captured, 0,
            "blocked hopper cannot accept a ball"
        );
        assert!(w.bodies[w.body_ids["ball"]].is_enabled());
        s.bodies
            .iter_mut()
            .find(|b| b.id == "barrel")
            .unwrap()
            .position = [0.0, 0.0, 1.15];
        let mut w = World::new(s).unwrap();
        w.motor_states.get_mut("motor").unwrap().rotor_rps = 10.0;
        for _ in 0..20 {
            w.gameplay_step(&input);
        }
        assert!(w.gameplay.carried[0].stored);
        // Attempt to drive the stored sphere through a nearby solid barrel.
        w.spec.gameplay.as_mut().unwrap().storage_origin = [0.0, 0.0, 1.3];
        for _ in 0..400 {
            w.step(&Input::default()).unwrap();
            let ball = &w.bodies[w.body_ids["ball"]];
            assert!(ball.is_enabled() && ball.is_ccd_enabled());
            assert!(
                ball.translation().z <= 1.061,
                "stored ball crossed the barrel"
            );
        }
        assert!(w.bodies[w.body_ids["ball"]].translation().z > 1.04);
        assert_eq!(w.gameplay.captured, 1, "owned cargo cannot be recaptured");
    }
    #[test]
    fn a_slot_blocked_during_intake_returns_the_ball_to_physics() {
        let mut s = spec();
        s.bodies.push(
            serde_json::from_value(json!({
                "id":"obstruction","fixed":true,"position":[0,0,2],
                "colliders":[{"kind":"box","half":[0.1,0.1,0.1]}]
            }))
            .unwrap(),
        );
        let mut w = World::new(s).unwrap();
        let input = Input {
            volts: BTreeMap::from([("motor".into(), 6.0)]),
            ..Default::default()
        };
        w.motor_states.get_mut("motor").unwrap().rotor_rps = 10.0;
        w.gameplay_step(&input);
        assert_eq!(w.gameplay.carried.len(), 1);
        let h = w.bodies[w.body_ids["obstruction"]].colliders()[0];
        w.colliders[h].set_translation(Vector::new(0.0, 0.0, 1.0));
        w.gameplay_step(&input);
        assert!(w.gameplay.carried.is_empty());
        assert_eq!(w.gameplay.released, 1);
        assert!(w.bodies[w.body_ids["ball"]].is_enabled());
    }
    #[test]
    fn authored_storage_slots_require_finite_separated_centers() {
        let mut s = spec();
        let g = s.gameplay.as_mut().unwrap();
        g.capacity = 2;
        g.storage_slots = vec![[0.0, 0.0, 1.0], [0.1, 0.0, 1.0]];
        assert!(World::new(s.clone()).is_err());
        s.gameplay.as_mut().unwrap().storage_slots[1][0] = 0.16;
        assert!(World::new(s.clone()).is_ok());
        s.gameplay.as_mut().unwrap().storage_slots.pop();
        assert!(World::new(s).is_err());
    }
    #[test]
    fn invalid_gameplay_rejected_and_detailed_state_has_no_gameplay_field() {
        let mut s = spec();
        s.gameplay.as_mut().unwrap().carrier = "missing".into();
        assert!(World::new(s).is_err());
        let mut s = spec();
        s.gameplay.as_mut().unwrap().balls.push("ball".into());
        assert!(World::new(s).is_err());
        let mut s = spec();
        s.gameplay = None;
        let w = World::new(s).unwrap();
        assert!(serde_json::to_value(w.snapshot())
            .unwrap()
            .get("gameplay")
            .is_none());
    }

    #[test]
    fn field_foam_is_explicit_and_never_promotes_owned_practice_cargo() {
        let mut s = spec();
        s.bodies
            .iter_mut()
            .find(|b| b.id == "ball")
            .unwrap()
            .compliance = Some(serde_json::from_value(serde_json::json!({})).unwrap());
        s.compliance_zones = serde_json::from_value(serde_json::json!([
            {"body":"frame","center":[0,0,0],"half":[0.3,0.3,0.3]}
        ]))
        .unwrap();
        assert!(
            World::new(s.clone()).is_err(),
            "foam requires explicit opt-in"
        );
        s.gameplay.as_mut().unwrap().field_compliance = true;
        let mut w = World::new(s.clone()).unwrap();
        w.motor_states.get_mut("motor").unwrap().rotor_rps = 10.0;
        w.gameplay_step(&Input {
            volts: BTreeMap::from([("motor".into(), 6.0)]),
            ..Default::default()
        });
        assert_eq!(w.gameplay.captured, 1);
        w.update_compliance().unwrap();
        assert!(
            w.compliant_body_state("ball").is_none(),
            "transport-owned cargo must not also become a soft body"
        );
        let mut free = World::new(s.clone()).unwrap();
        free.update_compliance().unwrap();
        assert!(
            free.compliant_body_state("ball").is_some(),
            "free ball must deform in field zone"
        );
        free.motor_states.get_mut("motor").unwrap().rotor_rps = 10.0;
        free.gameplay_step(&Input {
            volts: BTreeMap::from([("motor".into(), 6.0)]),
            ..Default::default()
        });
        assert!(
            free.gameplay.carried.iter().all(|c| c.id != "ball"),
            "soft-body proxy must not be captured twice"
        );
        s.compliance_zones[0].body = "wheel".into();
        assert!(
            World::new(s).is_err(),
            "moving robot zones are not part of this approximation"
        );
    }
    #[test]
    fn field_conveyor_preserves_ball_and_waits_for_power_and_clear_exit() {
        let mut s = spec();
        s.bodies
            .iter_mut()
            .find(|b| b.id == "ball")
            .unwrap()
            .position = [0.0, 0.0, 2.0];
        s.bodies
            .iter_mut()
            .find(|b| b.id == "ball2")
            .unwrap()
            .position = [1.0, 0.0, 2.0];
        s.gameplay.as_mut().unwrap().field_conveyors = serde_json::from_value(json!([{
            "id":"lane","frame":"frame","capture_center":[0,0,2],"capture_half":[0.1,0.1,0.1],
            "path":[[0,0,2],[1,0,2]],"motor":"motor","direction":1,
            "metres_per_rotor_turn":0.01,"required_motors":[]
        }]))
        .unwrap();
        let mut w = World::new(s.clone()).unwrap();
        let power = Input {
            volts: BTreeMap::from([("motor".into(), 6.0)]),
            ..Default::default()
        };
        w.motor_states.get_mut("motor").unwrap().rotor_rps = 100.0;
        w.field_transport_step(&Input::default());
        assert_eq!(w.field_transport_status().admitted, 0);
        w.field_transport_step(&power);
        assert_eq!(w.field_transport_status().admitted, 1);
        let stopped = w.bodies[w.body_ids["ball"]].translation();
        w.field_transport_step(&Input::default());
        assert_eq!(w.bodies[w.body_ids["ball"]].translation(), stopped);
        for _ in 0..250 {
            w.field_transport_step(&power);
        }
        assert_eq!(
            w.field_transport_status().discharged,
            0,
            "occupied exit must wait"
        );
        w.bodies[w.body_ids["ball2"]].set_translation(Vector::new(3.0, 0.0, 2.0), true);
        w.field_transport_step(&power);
        assert_eq!(w.field_transport_status().discharged, 1);
        assert!(w.bodies[w.body_ids["ball"]].is_enabled());
        assert!((w.bodies[w.body_ids["ball"]].linvel().x - 1.0).abs() < 1e-6);
        assert_eq!(
            w.body_ids.len(),
            4,
            "conveyor must not create or delete bodies"
        );
        s.gameplay.as_mut().unwrap().field_conveyors[0].frame = "wheel".into();
        assert!(World::new(s).is_err());
    }
}
