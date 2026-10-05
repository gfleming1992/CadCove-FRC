//! Selective, reversible sphere compliance. Rigid bodies remain the cheap far
//! representation; nearby squeezing mechanisms use the same world's soft solver.
use super::*;

fn frequency() -> f32 {
    30.0
}
fn subdivision() -> usize {
    1
}
fn entry_margin() -> f32 {
    0.03
}
fn exit_margin() -> f32 {
    0.10
}
fn recovery() -> f32 {
    0.0005
}
fn lookahead() -> f32 {
    0.03
}

#[derive(Clone, Deserialize, Serialize)]
pub struct ComplianceSpec {
    #[serde(default = "frequency")]
    pub frequency_hz: f32,
    #[serde(default = "subdivision")]
    /// Zero is an opt-in coarse practice model (12 surface particles plus
    /// center); one retains the default 42 surface particles plus center.
    pub subdivisions: usize,
    #[serde(default = "entry_margin")]
    pub entry_margin: f32,
    #[serde(default = "exit_margin")]
    pub exit_margin: f32,
    #[serde(default = "recovery")]
    pub recovery_tolerance: f32,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct ComplianceZone {
    pub body: String,
    pub center: [f32; 3],
    pub half: [f32; 3],
    #[serde(default = "lookahead")]
    pub lookahead: f32,
}

struct Config {
    material: ComplianceSpec,
    radius: f32,
    mass: f32,
    friction: f32,
    restitution: f32,
    groups: InteractionGroups,
}
struct Active {
    handle: SoftBodyHandle,
    // The inserted particle rest positions already include the original pose.
    // Rapier's fitted proxy rotation measures change from that rest pose.
    initial_rotation: Rotation,
    started: u64,
}
#[derive(Default)]
pub(super) struct Runtime {
    configs: BTreeMap<String, Config>,
    active: BTreeMap<String, Active>,
    promotions: u64,
    demotions: u64,
}
#[derive(Serialize)]
pub struct ComplianceStatus {
    pub active_soft: usize,
    pub promotions: u64,
    pub demotions: u64,
    pub bodies: BTreeMap<String, SoftStatus>,
}
#[derive(Serialize)]
pub struct SoftStatus {
    pub particles: usize,
    pub shape_error: f32,
}

struct Moments {
    center: Vector,
    velocity: Vector,
    momentum: Vector,
    kinetic_energy: f32,
    shape_error: f32,
    deformation_speed: f32,
}
fn moments(soft: &SoftBody, proxy: &RigidBody) -> Moments {
    let center = soft.center_of_mass();
    let mass = soft.mass();
    let velocity = soft
        .particles()
        .iter()
        .enumerate()
        .fold(Vector::ZERO, |sum, (i, p)| {
            sum + p.mass() * soft.particle_velocity(i)
        })
        / mass;
    let mut m = Moments {
        center,
        velocity,
        momentum: Vector::ZERO,
        kinetic_energy: 0.0,
        shape_error: 0.0,
        deformation_speed: 0.0,
    };
    for (i, p) in soft.particles().iter().enumerate() {
        let r = soft.particle_position(i) - center;
        let v = soft.particle_velocity(i);
        m.momentum += p.mass() * r.cross(v - velocity);
        m.kinetic_energy += 0.5 * p.mass() * v.length_squared();
        m.shape_error = m
            .shape_error
            .max((r - proxy.rotation() * p.initial_rest_position()).length());
        m.deformation_speed = m
            .deformation_speed
            .max((v - velocity - proxy.angvel().cross(r)).length());
    }
    m
}

impl World {
    /// Optional diagnostic positions, kept out of the per-tick bridge snapshot.
    pub fn inspect_particles(&self, id: &str) -> Result<Vec<[f32; 3]>> {
        ensure!(self.body_ids.contains_key(id), "unknown body");
        let active = self
            .compliance
            .active
            .get(id)
            .context("body is not currently compliant")?;
        let soft = &self.soft_bodies[active.handle];
        Ok((0..soft.num_particles())
            .map(|i| soft.particle_position(i).into())
            .collect())
    }
    pub(super) fn validate_compliance(&mut self) -> Result<()> {
        for b in &self.spec.bodies {
            let Some(c) = &b.compliance else { continue };
            ensure!(
                !b.fixed && b.principal_inertia.is_none() && b.center_of_mass.is_none(),
                "compliance requires a dynamic sphere with its natural inertia"
            );
            ensure!(
                !self
                    .spec
                    .joints
                    .iter()
                    .any(|j| j.parent == b.id || j.child == b.id),
                "compliant spheres cannot own joints"
            );
            let radius = match b.colliders.as_slice() {
                [ShapeSpec::Ball { radius, center }] if *center == [0.0; 3] => *radius,
                _ => bail!("compliance requires exactly one centered ball collider"),
            };
            ensure!(
                c.frequency_hz.is_finite() && c.frequency_hz > 0.0 && c.frequency_hz <= 300.0,
                "invalid compliance stiffness"
            );
            ensure!(
                (0..=2).contains(&c.subdivisions),
                "compliance subdivisions must be 0, 1 or 2"
            );
            ensure!(
                [c.entry_margin, c.exit_margin, c.recovery_tolerance]
                    .iter()
                    .all(|v| v.is_finite() && *v > 0.0)
                    && c.exit_margin > c.entry_margin
                    && c.recovery_tolerance < radius * 0.05,
                "invalid compliance margins"
            );
            self.compliance.configs.insert(
                b.id.clone(),
                Config {
                    material: c.clone(),
                    radius,
                    mass: b.mass,
                    friction: b.friction,
                    restitution: b.restitution,
                    groups: InteractionGroups::new(
                        Group::from_bits_retain(b.membership),
                        Group::from_bits_retain(b.filter),
                        InteractionTestMode::And,
                    ),
                },
            );
        }
        for z in &self.spec.compliance_zones {
            ensure!(
                self.body_ids.contains_key(&z.body)
                    && !self.compliance.configs.contains_key(&z.body),
                "compliance zone must reference a rigid body"
            );
            ensure!(
                z.center.iter().all(|v| v.is_finite())
                    && z.half.iter().all(|v| v.is_finite() && *v > 0.0)
                    && z.lookahead.is_finite()
                    && (self.spec.dt..=0.2).contains(&z.lookahead),
                "invalid compliance zone"
            );
        }
        Ok(())
    }

    fn near_compliance_zone(
        &self,
        center: Vector,
        velocity: Vector,
        radius: f32,
        margin: f32,
    ) -> bool {
        self.spec.compliance_zones.iter().any(|z| {
            let parent = &self.bodies[self.body_ids[&z.body]];
            let local = parent.position().inverse_transform_point(center) - Vector::from(z.center);
            let relative =
                parent.rotation().inverse() * (velocity - parent.velocity_at_point(center));
            let future = local + relative * z.lookahead;
            // Conservative swept bounds also cover zone rotation during lookahead.
            let angular_pad =
                parent.angvel().length() * (Vector::from(z.half).length() + radius) * z.lookahead;
            let half = Vector::from(z.half) + Vector::splat(radius + margin + angular_pad);
            local.min(future).cmple(half).all() && local.max(future).cmpge(-half).all()
        })
    }

    fn promote_compliance(&mut self, id: &str) {
        let c = &self.compliance.configs[id];
        let rigid = &self.bodies[self.body_ids[id]];
        let pose = *rigid.position();
        let velocity = rigid.linvel();
        let angular = rigid.angvel();
        let mut builder = SoftBodyBuilder::sphere(Vector::ZERO, c.radius, c.material.subdivisions)
            .volume_preservation(false)
            .shape_matching(true)
            .material(SoftBodyMaterial {
                shape_matching_softness: SpringCoefficients::new(c.material.frequency_hz, 1.0),
                deformation_damping: 2.0,
                ..Default::default()
            })
            .particle_radius(0.0005)
            .surface_collider(
                ColliderBuilder::ball(c.radius)
                    .friction(c.friction)
                    .restitution(c.restitution)
                    .collision_groups(c.groups),
            );
        builder.edges.clear();
        builder.dihedrals.clear();
        // Surface-only points have 2/3*m*r² inertia. Put 60% of the mass on
        // the symmetric surface and 40% at its center to retain solid-sphere
        // inertia 2/5*m*r², angular momentum AND rotational kinetic energy.
        let n = builder.positions.len();
        builder.masses = vec![c.mass * 0.6 / n as f32; n];
        builder.positions.push(Vector::ZERO);
        builder.masses.push(c.mass * 0.4);
        for p in &mut builder.positions {
            *p = pose * *p;
        }
        self.bodies[self.body_ids[id]].set_enabled(false);
        let handle = self
            .soft_bodies
            .insert(builder, &mut self.bodies, &mut self.colliders);
        let s = &mut self.soft_bodies[handle];
        for i in 0..s.num_particles() {
            s.set_particle_velocity(
                i,
                velocity + angular.cross(s.particle_position(i) - pose.translation),
            );
        }
        let root = s.root_body();
        self.bodies[root].set_linvel(velocity, true);
        self.bodies[root].set_angvel(angular, true);
        self.names.insert(root, id.to_owned());
        self.compliance.active.insert(
            id.to_owned(),
            Active {
                handle,
                initial_rotation: pose.rotation,
                started: self.tick,
            },
        );
        self.compliance.promotions += 1;
    }

    fn can_demote_compliance(&self, id: &str) -> bool {
        self.compliance_retention_reason(id).is_none()
    }

    // Return the first failed gate, in the same order as the demotion decision.
    // Inspection shares these gates so its explanation cannot drift from the solver.
    fn compliance_retention_reason(&self, id: &str) -> Option<&'static str> {
        let a = &self.compliance.active[id];
        let c = &self.compliance.configs[id];
        let soft = &self.soft_bodies[a.handle];
        let proxy = &self.bodies[soft.root_body()];
        let m = moments(soft, proxy);
        if (self.tick - a.started) as f32 * self.spec.dt < 0.1 {
            return Some("minimum_age");
        }
        if m.shape_error > c.material.recovery_tolerance {
            return Some("deformed");
        }
        if m.deformation_speed > 0.03 {
            return Some("deforming");
        }
        if self.near_compliance_zone(m.center, m.velocity, c.radius, c.material.exit_margin) {
            return Some("mechanism_zone");
        }
        // Never restore a larger rigid contact envelope inside another body.
        let filter = QueryFilter::default()
            .exclude_rigid_body(soft.root_body())
            .exclude_sensors()
            .groups(c.groups);
        let query = self.broad.as_query_pipeline(
            self.narrow.query_dispatcher(),
            &self.bodies,
            &self.colliders,
            filter,
        );
        let shape = Ball::new(c.radius + 0.0005);
        if query
            .intersect_shape(
                Pose::translation(m.center.x, m.center.y, m.center.z),
                &shape,
            )
            .next()
            .is_some()
        {
            return Some("rigid_envelope_overlap");
        }
        let inertia = 0.4 * c.mass * c.radius * c.radius;
        let restored_energy = 0.5 * c.mass * m.velocity.length_squared()
            + 0.5 * m.momentum.length_squared() / inertia;
        // Remaining internal deformation may dissipate; representation changes
        // must not introduce a kinetic-energy kick.
        if restored_energy <= m.kinetic_energy + 1e-6 {
            None
        } else {
            Some("energy_increase")
        }
    }

    /// On-demand diagnostic only; not part of the high-frequency bridge snapshot.
    /// A null reason means eligible at this post-step state, before the next update.
    pub fn inspect_compliance(&self) -> serde_json::Value {
        let bodies: BTreeMap<_, _> = self
            .compliance
            .active
            .iter()
            .map(|(id, active)| {
                let soft = &self.soft_bodies[active.handle];
                let m = moments(soft, &self.bodies[soft.root_body()]);
                (
                    id,
                    serde_json::json!({
                        "retainedBy": self.compliance_retention_reason(id),
                        "sleeping": soft.is_sleeping(),
                        "ageSeconds": (self.tick-active.started) as f32*self.spec.dt,
                        "position": <[f32;3]>::from(m.center),
                        "shapeError": m.shape_error,
                        "deformationSpeed": m.deformation_speed
                    }),
                )
            })
            .collect();
        serde_json::json!({"tick":self.tick,"bodies":bodies})
    }

    fn demote_compliance(&mut self, id: &str) {
        let a = self.compliance.active.remove(id).unwrap();
        let c = &self.compliance.configs[id];
        let soft = &self.soft_bodies[a.handle];
        let proxy = &self.bodies[soft.root_body()];
        let m = moments(soft, proxy);
        let rotation = (*proxy.rotation() * a.initial_rotation).normalize();
        let root = soft.root_body();
        self.soft_bodies.remove(
            a.handle,
            &mut self.islands,
            &mut self.bodies,
            &mut self.colliders,
            &mut self.joints,
            &mut self.multibody,
        );
        self.names.remove(&root);
        let rigid = &mut self.bodies[self.body_ids[id]];
        rigid.set_position(Pose::from_parts(m.center, rotation), true);
        rigid.set_linvel(m.velocity, true);
        rigid.set_angvel(m.momentum / (0.4 * c.mass * c.radius * c.radius), true);
        rigid.set_enabled(true);
        self.compliance.demotions += 1;
    }

    pub(super) fn update_compliance(&mut self) -> Result<()> {
        let mut promote = Vec::new();
        let mut demote = Vec::new();
        for (id, c) in &self.compliance.configs {
            if let Some(a) = self.compliance.active.get(id) {
                ensure!(
                    self.soft_bodies[a.handle].is_enabled(),
                    "compliant body quarantined: {id}"
                );
                if self.can_demote_compliance(id) {
                    demote.push(id.clone())
                }
            } else {
                let b = &self.bodies[self.body_ids[id]];
                // Intake/field proxies and collision-enabled hopper cargo may be
                // owned by practice transport; never duplicate that cargo.
                if !b.is_enabled() || self.gameplay_owns(id) {
                    continue;
                }
                if self.near_compliance_zone(
                    b.translation(),
                    b.linvel(),
                    c.radius,
                    c.material.entry_margin,
                ) {
                    promote.push(id.clone())
                }
            }
        }
        for id in promote {
            self.promote_compliance(&id)
        }
        for id in demote {
            self.demote_compliance(&id)
        }
        Ok(())
    }

    pub(super) fn compliant_body_state(&self, id: &str) -> Option<BodyState> {
        let a = self.compliance.active.get(id)?;
        let s = &self.soft_bodies[a.handle];
        let b = &self.bodies[s.root_body()];
        let q = (*b.rotation() * a.initial_rotation).normalize();
        Some(BodyState {
            position: s.center_of_mass().into(),
            quaternion: q.into(),
            velocity: b.linvel().into(),
            angular_velocity: b.angvel().into(),
        })
    }
    pub(super) fn compliance_status(&self) -> ComplianceStatus {
        ComplianceStatus {
            active_soft: self.compliance.active.len(),
            promotions: self.compliance.promotions,
            demotions: self.compliance.demotions,
            bodies: self
                .compliance
                .active
                .iter()
                .map(|(id, a)| {
                    let s = &self.soft_bodies[a.handle];
                    let m = moments(s, &self.bodies[s.root_body()]);
                    (
                        id.clone(),
                        SoftStatus {
                            particles: s.num_particles(),
                            shape_error: m.shape_error,
                        },
                    )
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(zone_x: f32, ball_x: f32) -> World {
        World::new(serde_json::from_value(json!({"dt":0.005,"gravity":[0,0,0],"bodies":[
            {"id":"mechanism","fixed":true,"position":[zone_x,0,0]},
            {"id":"fuel","position":[ball_x,0,0],"mass":0.215,"colliders":[{"kind":"ball","radius":0.075}],"compliance":{}}
        ],"compliance_zones":[{"body":"mechanism","center":[0,0,0],"half":[0.05,0.1,0.1]}]})).unwrap()).unwrap()
    }

    #[test]
    fn coarse_practice_ball_preserves_mass_and_initial_motion() {
        for (subdivisions, particles) in [(0, 13), (1, 43)] {
            let mut spec = fixture(0.0, 0.0).spec;
            let ball = spec.bodies.iter_mut().find(|b| b.id == "fuel").unwrap();
            ball.compliance.as_mut().unwrap().subdivisions = subdivisions;
            ball.velocity = [2.0, -1.0, 0.5];
            ball.angular_velocity = [0.0, 0.0, 10.0];
            let mut w = World::new(spec).unwrap();
            w.promote_compliance("fuel");
            let active = &w.compliance.active["fuel"];
            let soft = &w.soft_bodies[active.handle];
            let m = moments(soft, &w.bodies[soft.root_body()]);
            assert_eq!(soft.num_particles(), particles);
            assert!((soft.mass() - 0.215).abs() < 1.0e-6);
            assert!((m.velocity - Vector::new(2.0, -1.0, 0.5)).length() < 1.0e-5);
            let expected_momentum = 0.4 * 0.215 * 0.075_f32.powi(2) * 10.0;
            assert!((m.momentum.z - expected_momentum).abs() < 1.0e-6);
        }
    }

    #[test]
    #[ignore = "requires locally extracted shooter CAD; run the test executable from repository root"]
    fn cad_side_plate_contact_witnesses() {
        use rapier3d::parry::utils::PoseOpt;
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        use sha2::{Digest, Sha256};
        let bytes = std::fs::read(root.join("artifacts/shooter-guide-sides-fixture.json")).unwrap();
        let data: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let spec: WorldSpec = serde_json::from_value(data["world"].clone()).unwrap();
        let mut w = World::new(spec).unwrap();
        let input = serde_json::from_value(json!({"volts":data["volts"]})).unwrap();
        let mut rows = Vec::new();
        for _ in 0..16 {
            w.step_refined(&input, 32).unwrap();
            for pair in w.narrow.contact_pairs() {
                let a = &w.colliders[pair.collider1];
                let b = &w.colliders[pair.collider2];
                let Some(ah) = a.parent() else { continue };
                let Some(_) = b.parent() else { continue };
                let hood_first = w.names[&ah] == "hood/left";
                let (hood, other) = if hood_first { (a, b) } else { (b, a) };
                if w.names[&hood.parent().unwrap()] != "hood/left"
                    || !w.names[&other.parent().unwrap()].starts_with("fuel/")
                    || hood.user_data > 1
                {
                    continue;
                }
                for m in pair.manifolds() {
                    if m.data.normal.length_squared() < 0.5 {
                        continue;
                    }
                    let n = if hood_first {
                        m.data.normal
                    } else {
                        -m.data.normal
                    };
                    let pose = if hood_first {
                        m.subshape_pos1()
                    } else {
                        m.subshape_pos2()
                    }
                    .prepend_to(hood.position());
                    for p in &m.points {
                        let world =
                            pose.transform_point(if hood_first { p.local_p1 } else { p.local_p2 });
                        let local = hood.position().inverse_transform_point(world);
                        let probe = hood.position().inverse_transform_point(world + n * 0.0001);
                        let proj = hood.shape().project_local_point(local, false);
                        let subshape = if hood_first { m.subshape1 } else { m.subshape2 };
                        let covered_by_other_child =
                            hood.shape().as_compound().is_some_and(|compound| {
                                let aabb =
                                    rapier3d::parry::bounding_volume::Aabb::from_half_extents(
                                        probe,
                                        Vector::ZERO,
                                    );
                                let covered = compound.bvh().intersect_aabb(&aabb).any(|i| {
                                    let (pose, shape) = &compound.shapes()[i as usize];
                                    i != subshape && shape.contains_point(pose, probe)
                                });
                                covered
                            });
                        rows.push(json!({"tick":w.tick,"plate":hood.user_data as usize,"normal":[n.x,n.y,n.z],"witness":[world.x,world.y,world.z],"insideAhead":hood.shape().contains_local_point(probe),"coveredByOtherChild":covered_by_other_child,"projectionDelta":(proj.point-local).length(),"separation":p.dist,"impulse":p.data.impulse,"subshape":subshape}));
                    }
                }
            }
        }
        let report = json!({"schema":1,"fixtureSha256":format!("{:x}",Sha256::digest(&bytes)),"testBinarySha256":format!("{:x}",Sha256::digest(std::fs::read(std::env::current_exe().unwrap()).unwrap())),"scope":"Last-substep contact witnesses transformed with post-step collider poses; impulses are scalar reports, not a vector force audit.","rows":rows});
        std::fs::write(
            root.join("artifacts/shooter-contact-witnesses.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
        println!("captured {} witnesses", rows.len());
        assert!(!rows.is_empty());
    }

    fn invalid_contact_normal_fixture(reverse: bool) {
        use std::sync::atomic::{AtomicUsize, Ordering};
        struct InvalidNormal(AtomicUsize, bool);
        impl PhysicsHooks for InvalidNormal {
            fn modify_solver_contacts(&self, ctx: &mut ContactModificationContext) {
                if let Some(m) = ctx.rigid_mut() {
                    if !m.solver_contacts.is_empty() {
                        self.0.fetch_add(1, Ordering::Relaxed);
                        *m.normal = if self.1 { -*m.normal } else { Vector::ZERO };
                    }
                }
            }
        }
        let mut velocities = Vec::new();
        for degenerate in [false, true] {
            let mut w = PhysicsWorld::new();
            w.gravity = Vector::ZERO;
            w.integration_parameters.dt = 0.005;
            // Isolate manifold contacts. Reversed/zero normals also fail
            // predictive-contact alignment, so those cannot hide the error.
            w.integration_parameters.soft_bodies.recovery.overlap_rigid = false;
            w.insert(
                RigidBodyBuilder::fixed(),
                ColliderBuilder::compound(vec![(
                    Pose::translation(0.0, -0.5, 0.0),
                    SharedShape::cuboid(1.0, 0.5, 1.0),
                )])
                .friction(1.0)
                .active_hooks(ActiveHooks::MODIFY_SOLVER_CONTACTS),
            );
            let mut builder = SoftBodyBuilder::sphere(Vector::new(0.0, 0.073, 0.0), 0.075, 1)
                .volume_preservation(false)
                .shape_matching(true)
                .mass(0.215)
                .material(SoftBodyMaterial {
                    shape_matching_softness: SpringCoefficients::new(200.0, 1.0),
                    deformation_damping: 2.0,
                    ..Default::default()
                })
                .particle_radius(0.0005)
                .can_sleep(false)
                .surface_collider(ColliderBuilder::ball(0.075).friction(1.0));
            builder.edges.clear();
            builder.dihedrals.clear();
            let handle = w.insert_soft_body(builder);
            for i in 0..w.soft_bodies[handle].num_particles() {
                w.soft_bodies[handle].set_particle_velocity(i, Vector::new(2.0, 0.0, 0.0));
            }
            let hook = InvalidNormal(AtomicUsize::new(0), reverse);
            for _ in 0..20 {
                if degenerate {
                    w.step_with_events(&hook, &());
                } else {
                    w.step();
                }
            }
            let s = &w.soft_bodies[handle];
            let velocity = s
                .particles()
                .iter()
                .enumerate()
                .fold(Vector::ZERO, |v, (i, p)| {
                    v + p.mass() * s.particle_velocity(i)
                })
                / s.mass();
            if degenerate {
                assert!(
                    hook.0.load(Ordering::Relaxed) > 0,
                    "fixture must exercise degenerate manifolds"
                );
                assert!(
                    (velocity - Vector::new(2.0, 0.0, 0.0)).length() < 0.0001,
                    "an invalid contact normal must not change momentum: {velocity:?}"
                );
            } else {
                assert!(
                    velocity.x < 1.99,
                    "valid normal contacts must still exert friction: {velocity:?}"
                );
            }
            velocities.push(velocity);
        }
        println!("valid and degenerate contact velocities: {velocities:?}");
    }

    #[test]
    fn degenerate_contact_normal_cannot_create_friction() {
        invalid_contact_normal_fixture(false);
    }

    #[test]
    fn reversed_boundary_contact_cannot_pull_a_closed_surface_inward() {
        invalid_contact_normal_fixture(true);
    }

    #[test]
    fn passive_thin_plate_contacts_preserve_energy_and_prevent_tunneling() {
        let mut results = Vec::new();
        for pieces in [0, 1, 2, 4] {
            for spin in [0.0, 100.0] {
                for refinement in [1, 32] {
                    let spec=serde_json::from_value(json!({"dt":0.005,"gravity":[0,0,0],"bodies":[
                {"id":"base","fixed":true,"position":[0,0,0]},
                {"id":"plate","position":[0,-0.082169,0],"mass":1,"friction":0.65,"colliders":[{"kind":"box","half":[0.3,0.002794,0.4]}]},
                {"id":"fuel","position":[0,0,-0.12],"velocity":[0,-0.22,4.8],"angular_velocity":[spin,0,0],"mass":0.215,"friction":0.65,"colliders":[{"kind":"ball","radius":0.075}],"compliance":{"frequency_hz":200}}
            ],"joints":[{"id":"mount","parent":"base","child":"plate","kind":"fixed","axis":[0,1,0],"anchor_parent":[0,-0.082169,0],"anchor_child":[0,0,0]}],
            "compliance_zones":[{"body":"base","center":[0,0,0],"half":[2,2,2]}]})).unwrap();
                    let mut w = World::new(spec).unwrap();
                    if pieces > 0 {
                        let collider = w.bodies[w.body_ids["plate"]].colliders()[0];
                        let half = 0.4 / pieces as f32;
                        let parts = if pieces == 2 {
                            let corners = [
                                Vector::new(-0.3, 0.0, -0.4),
                                Vector::new(0.3, 0.0, -0.4),
                                Vector::new(0.3, 0.0, 0.4),
                                Vector::new(-0.3, 0.0, 0.4),
                            ];
                            [[0, 1, 2], [0, 2, 3]]
                                .into_iter()
                                .map(|ids| {
                                    let vertices: Vec<_> = ids
                                        .into_iter()
                                        .flat_map(|i| {
                                            [-0.002794, 0.002794]
                                                .map(|y| corners[i] + Vector::new(0.0, y, 0.0))
                                        })
                                        .collect();
                                    (Pose::IDENTITY, SharedShape::convex_hull(&vertices).unwrap())
                                })
                                .collect()
                        } else {
                            (0..pieces)
                                .map(|i| {
                                    (
                                        Pose::translation(
                                            0.0,
                                            0.0,
                                            -0.4 + half + 2.0 * half * i as f32,
                                        ),
                                        SharedShape::cuboid(0.3, 0.002794, half),
                                    )
                                })
                                .collect()
                        };
                        w.colliders[collider].set_shape(SharedShape::compound(parts));
                    }
                    let initial = w.bodies[w.body_ids["fuel"]].kinetic_energy();
                    let mut maximum = initial;
                    let mut min_y = 0.0_f32;
                    for _ in 0..40 {
                        w.step_refined(&Input::default(), refinement).unwrap();
                        let active = &w.compliance.active["fuel"];
                        let soft = &w.soft_bodies[active.handle];
                        let m = moments(soft, &w.bodies[soft.root_body()]);
                        maximum = maximum
                            .max(m.kinetic_energy + w.bodies[w.body_ids["plate"]].kinetic_energy());
                        for p in soft.particles() {
                            let x = p.position();
                            if x.x.abs() < 0.3 && x.z.abs() < 0.4 {
                                min_y = min_y.min(x.y);
                            }
                        }
                    }
                    let end = &w.snapshot().bodies["fuel"];
                    results.push(json!({"pieces":pieces,"spin":spin,"refinement":refinement,"energyRatio":maximum/initial,"minimumParticleY":min_y,"position":end.position,"velocity":end.velocity}));
                }
            }
        }
        println!("{}", serde_json::to_string_pretty(&results).unwrap());
        assert!(
            results
                .iter()
                .all(|r| r["energyRatio"].as_f64().unwrap() < 1.001),
            "passive plate contact must not add substantial kinetic energy"
        );
        assert!(
            results
                .iter()
                .all(|r| r["minimumParticleY"].as_f64().unwrap() > -0.079475),
            "surface particles must not tunnel through the plate"
        );
        for base in results.iter().filter(|r| r["pieces"] == 0) {
            let wrapped = results
                .iter()
                .find(|r| {
                    r["pieces"] == 1
                        && r["spin"] == base["spin"]
                        && r["refinement"] == base["refinement"]
                })
                .unwrap();
            assert_eq!(
                wrapped["velocity"], base["velocity"],
                "wrapping the same cuboid in one compound child must preserve motion"
            );
        }
    }

    #[test]
    fn representation_change_preserves_mass_momentum_energy_and_pose() {
        let mut w = fixture(10.0, 0.0);
        let h = w.body_ids["fuel"];
        let pose = Pose::new(Vector::new(1.0, 2.0, 3.0), Vector::new(0.2, 0.3, 0.4));
        let v = Vector::new(2.0, -1.0, 0.3);
        let omega = Vector::new(3.0, 5.0, -2.0);
        w.bodies[h].set_position(pose, true);
        w.bodies[h].set_linvel(v, true);
        w.bodies[h].set_angvel(omega, true);
        let energy = w.bodies[h].kinetic_energy();
        let inertia = 0.4 * 0.215 * 0.075 * 0.075;
        w.promote_compliance("fuel");
        let active = &w.compliance.active["fuel"];
        let soft = &w.soft_bodies[active.handle];
        let m = moments(soft, &w.bodies[soft.root_body()]);
        assert!((soft.mass() - 0.215).abs() < 1e-6);
        assert!((m.center - pose.translation).length() < 1e-5);
        assert!((m.velocity - v).length() < 1e-5);
        assert!((m.momentum - inertia * omega).length() < 1e-6);
        assert!((m.kinetic_energy - energy).abs() < 1e-5);
        let s = w.snapshot();
        assert_eq!(s.bodies.len(), 2);
        assert_eq!(s.compliance.active_soft, 1);
        let q = Rotation::from_array(s.bodies["fuel"].quaternion);
        assert!(q.dot(pose.rotation).abs() > 0.99999);
        assert!(!w.bodies[h].is_enabled());
        w.demote_compliance("fuel");
        assert_eq!(w.soft_bodies.len(), 0);
        assert_eq!(w.bodies.len(), 2);
        assert!((w.bodies[h].kinetic_energy() - energy).abs() < 1e-5);
        assert!((w.bodies[h].linvel() - v).length() < 1e-5);
        assert!((w.bodies[h].angvel() - omega).length() < 0.001);
        assert!(w.bodies[h].rotation().dot(pose.rotation).abs() > 0.99999);
    }

    #[test]
    fn approaching_ball_promotes_before_contact_and_demotes_without_chatter() {
        let mut w = fixture(0.0, -0.5);
        let h = w.body_ids["fuel"];
        w.bodies[h].set_linvel(Vector::X * 2.0, true);
        let mut first = None;
        for _ in 0..200 {
            w.step(&Input::default()).unwrap();
            let s = w.snapshot();
            if s.compliance.active_soft == 1 && first.is_none() {
                first = Some(s.bodies["fuel"].position[0]);
            }
            assert_eq!(s.bodies.len(), 2);
        }
        assert!(
            first.unwrap() < -0.125,
            "promotion must precede physical mechanism contact"
        );
        assert_eq!(w.compliance.promotions, 1);
        assert_eq!(w.compliance.demotions, 1);
        assert!((w.bodies[h].translation().x - 1.5).abs() < 0.001);
        assert!((w.bodies[h].linvel().x - 2.0).abs() < 0.001);
        assert_eq!(w.names.len(), 2, "removed proxies must not accumulate");
    }

    #[test]
    fn compliance_inspection_is_read_only_and_reports_first_retention_gate() {
        let mut inspected = fixture(0.0, -0.5);
        let mut control = fixture(0.0, -0.5);
        for w in [&mut inspected, &mut control] {
            let h = w.body_ids["fuel"];
            w.bodies[h].set_linvel(Vector::X * 2.0, true);
        }
        let mut seen = std::collections::BTreeSet::new();
        for _ in 0..200 {
            inspected.step(&Input::default()).unwrap();
            control.step(&Input::default()).unwrap();
            let before = serde_json::to_value(inspected.snapshot()).unwrap();
            let report = inspected.inspect_compliance();
            assert_eq!(report["tick"], inspected.tick);
            if let Some(reason) = report["bodies"]["fuel"]["retainedBy"].as_str() {
                seen.insert(reason.to_owned());
            }
            assert_eq!(before, serde_json::to_value(inspected.snapshot()).unwrap());
            assert_eq!(before, serde_json::to_value(control.snapshot()).unwrap());
        }
        assert!(seen.contains("minimum_age"));
        assert!(seen.contains("mechanism_zone"));
        assert!(inspected.inspect_compliance()["bodies"]
            .as_object()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn moving_mechanism_promotes_stationary_ball_predictively() {
        let mut w = fixture(-0.4, 0.0);
        let h = w.body_ids["mechanism"];
        w.bodies[h].set_body_type(RigidBodyType::KinematicVelocityBased, true);
        w.bodies[h].set_linvel(Vector::X * 5.0, true);
        for _ in 0..8 {
            w.step(&Input::default()).unwrap();
        }
        assert_eq!(w.compliance.promotions, 1);
        assert!(w.bodies[h].translation().x < -0.125);
    }

    #[test]
    fn demotion_waits_for_clearance_even_after_shape_recovers() {
        let mut spec = fixture(10.0, 0.0).spec;
        spec.bodies.push(serde_json::from_value(json!({"id":"floor","fixed":true,"position":[0,0,-0.08],"colliders":[{"kind":"box","half":[1,1,0.005]}]})).unwrap());
        let mut w = World::new(spec).unwrap();
        w.promote_compliance("fuel");
        w.step(&Input::default()).unwrap();
        w.tick = 100;
        let a = &w.compliance.active["fuel"];
        let s = &w.soft_bodies[a.handle];
        assert!(moments(s, &w.bodies[s.root_body()]).shape_error < 0.0005);
        assert!(
            !w.can_demote_compliance("fuel"),
            "restored sphere envelope must not intersect floor"
        );
        assert_eq!(
            w.inspect_compliance()["bodies"]["fuel"]["retainedBy"],
            "rigid_envelope_overlap"
        );
    }

    #[test]
    fn invalid_compliance_is_rejected_before_start() {
        let mut spec = fixture(0.0, 0.0).spec;
        spec.bodies[1].principal_inertia = Some([1.0; 3]);
        assert!(World::new(spec.clone()).is_err());
        spec.bodies[1].principal_inertia = None;
        spec.compliance_zones[0].body = "missing".into();
        assert!(World::new(spec).is_err());
    }

    #[test]
    fn compliant_fuel_squeezes_through_driven_gap_while_rigid_control_jams() {
        for voltage in [0.0, 1.6, 6.0, 12.0] {
            for compliant in [false, true] {
                let mut spec = serde_json::json!({"dt":0.005,"bodies":[
                {"id":"base","fixed":true,"position":[0,0,0]},
                {"id":"left","position":[-0.0841375,0,0],"mass":0.18,"friction":0.8,"colliders":[{"kind":"cylinder","radius":0.01524,"half_height":0.15}]},
                {"id":"right","position":[0.0841375,0,0],"mass":0.18,"friction":0.8,"colliders":[{"kind":"cylinder","radius":0.01524,"half_height":0.15}]},
                {"id":"fuel","position":[0,0,0.16],"mass":0.215,"friction":0.65,"restitution":0.1,"colliders":[{"kind":"ball","radius":0.075}]}
            ],"joints":[
                {"id":"left-axis","parent":"base","child":"left","kind":"revolute","axis":[0,1,0],"anchor_parent":[-0.0841375,0,0],"anchor_child":[0,0,0],"limits":null},
                {"id":"right-axis","parent":"base","child":"right","kind":"revolute","axis":[0,1,0],"anchor_parent":[0.0841375,0,0],"anchor_child":[0,0,0],"limits":null}
            ],"motors":[
                {"id":"left-motor","joint":"left-axis","rotor_per_unit":1,"resistance":0.1,"torque_constant":0.02,"velocity_constant":50,"current_limit":100},
                {"id":"right-motor","joint":"right-axis","rotor_per_unit":1,"resistance":0.1,"torque_constant":0.02,"velocity_constant":50,"current_limit":100}
            ],"compliance_zones":[{"body":"base","center":[0,0,0],"half":[0.11,0.16,0.03]}]});
                if compliant {
                    spec["bodies"][3]["compliance"] = serde_json::json!({});
                }
                let mut w = World::new(serde_json::from_value(spec).unwrap()).unwrap();
                let input = Input {
                    volts: BTreeMap::from([
                        ("left-motor".into(), voltage),
                        ("right-motor".into(), -voltage),
                    ]),
                    ..Default::default()
                };
                let mut deformation = 0.0_f32;
                let mut contacts = false;
                let mut through_gap = false;
                let mut max_penetration = 0.0_f32;
                let mut previous_z = 0.16;
                for _ in 0..300 {
                    w.step(&input).unwrap();
                    let state = w.snapshot();
                    if let Some(s) = state.compliance.bodies.get("fuel") {
                        deformation = deformation.max(s.shape_error);
                    }
                    contacts |= state
                        .contacts
                        .iter()
                        .any(|c| c.contains(&"fuel".to_string()));
                    let p = state.bodies["fuel"].position;
                    let points: Vec<_> = if let Some(active) = w.compliance.active.get("fuel") {
                        w.soft_bodies[active.handle]
                            .particle_positions()
                            .map(|p| (p, 0.0005))
                            .collect()
                    } else {
                        vec![(Vector::from(p), 0.075)]
                    };
                    for (p, radius) in points {
                        for id in ["left", "right"] {
                            let roller = &w.bodies[w.body_ids[id]];
                            let local = roller.position().inverse_transform_point(p);
                            if local.y.abs() < 0.15 {
                                max_penetration = max_penetration.max(
                                    radius + 0.01524
                                        - (local.x * local.x + local.z * local.z).sqrt(),
                                );
                            }
                        }
                    }
                    if previous_z >= 0.0 && p[2] < 0.0 && p[0].abs() < 0.07 && p[1].abs() < 0.10 {
                        through_gap = true;
                    }
                    previous_z = p[2];
                }
                let state = w.snapshot();
                eprintln!("pinch voltage={voltage} soft={compliant} penetration={max_penetration} deformation={deformation} promotions={} demotions={}", state.compliance.promotions, state.compliance.demotions);
                assert!(
                    max_penetration < 0.001,
                    "excessive contact penetration {max_penetration}"
                );
                assert!(contacts, "ball must actually contact the rollers");
                if compliant {
                    assert!(
                        through_gap,
                        "soft fuel must pass between the rollers, not fall around them"
                    );
                    assert!(state.bodies["fuel"].position[2] < -0.1, "soft fuel jammed");
                    assert!(deformation > 0.001, "gap passage must require deformation");
                    assert_eq!(state.compliance.promotions, 1);
                    assert_eq!(
                        state.compliance.demotions, 1,
                        "free recovered ball must become cheap again"
                    );
                } else {
                    assert!(
                        !through_gap,
                        "rigid control tunneled through gap: {}",
                        serde_json::to_string(&state).unwrap()
                    );
                }
            }
        }
    }
}
