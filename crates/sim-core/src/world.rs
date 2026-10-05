use crate::transmission::{self, Jacobian, Row, TransmissionSpec, TransmissionState};
use anyhow::{bail, ensure, Context, Result};
use rapier3d::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
mod compliance;
mod gameplay;
mod field_transport;
pub use gameplay::GameplaySpec;
mod visibility;
pub use compliance::{ComplianceSpec, ComplianceZone};
pub use visibility::SightSegment;

fn one() -> f32 {
    1.0
}
fn efficiency() -> f32 {
    0.9
}
fn default_gravity() -> [f32; 3] {
    [0.0, 0.0, -9.80665]
}
fn default_dt() -> f32 {
    0.005
}
fn contact_tolerance() -> f32 {
    0.0002
}
fn solver_iterations() -> usize {
    4
}
fn static_contact_frequency() -> f32 {
    60.0
}
fn soft_contact_max_angle() -> f32 {
    0.2
}
fn default_friction() -> f32 {
    0.8
}
fn all_groups() -> u32 {
    u32::MAX
}
#[derive(Clone, Deserialize, Serialize)]
pub struct WorldSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gameplay: Option<GameplaySpec>,
    /// Experimental contact algorithm selection is part of the pinned world,
    /// so a recorded load fully specifies its physics without ambient flags.
    #[serde(default)]
    pub triangle_contact_filter: crate::mesh::dispatcher::TriangleContactFilter,
    #[serde(default = "default_dt")]
    pub dt: f32,
    #[serde(default = "default_gravity")]
    pub gravity: [f32; 3],
    #[serde(default = "contact_tolerance")]
    pub contact_tolerance: f32,
    /// Numerical convergence control, pinned with the world for replay.
    /// Four preserves the existing engine default; material properties are separate.
    #[serde(default = "solver_iterations")]
    pub solver_iterations: usize,
    /// Numerical contact regularization, not foam stiffness. Preserve the
    /// pinned Rapier default unless a convergence profile explicitly opts in.
    #[serde(default = "static_contact_frequency")]
    pub static_contact_frequency_hz: f32,
    /// Angular travel between soft-contact refreshes. Increasing this is an
    /// explicit fidelity tradeoff; the existing default remains 0.2 rad.
    #[serde(default = "soft_contact_max_angle")]
    pub soft_contact_max_angle_rad: f32,
    pub bodies: Vec<BodySpec>,
    #[serde(default)]
    pub joints: Vec<JointSpec>,
    #[serde(default)]
    pub motors: Vec<MotorSpec>,
    #[serde(default)]
    pub transmissions: Vec<TransmissionSpec>,
    #[serde(default)]
    pub compliance_zones: Vec<ComplianceZone>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct BodySpec {
    pub id: String,
    #[serde(default)]
    pub fixed: bool,
    pub position: [f32; 3],
    #[serde(default)]
    pub rotation: [f32; 3],
    /// Initial world-space motion for reproducible mechanism/impact scenarios.
    #[serde(default)]
    pub velocity: [f32; 3],
    #[serde(default)]
    pub angular_velocity: [f32; 3],
    #[serde(default = "one")]
    pub mass: f32,
    #[serde(default)]
    pub colliders: Vec<ShapeSpec>,
    #[serde(default = "default_friction")]
    pub friction: f32,
    #[serde(default)]
    pub restitution: f32,
    #[serde(default = "all_groups")]
    pub membership: u32,
    #[serde(default = "all_groups")]
    pub filter: u32,
    /// Authored mass properties are independent of the simplified collision hull.
    #[serde(default)]
    pub center_of_mass: Option<[f32; 3]>,
    #[serde(default)]
    pub principal_inertia: Option<[f32; 3]>,
    #[serde(default)]
    pub compliance: Option<ComplianceSpec>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ShapeSpec {
    Box {
        half: [f32; 3],
        #[serde(default)]
        center: [f32; 3],
    },
    Ball {
        radius: f32,
        #[serde(default)]
        center: [f32; 3],
    },
    Cylinder {
        half_height: f32,
        radius: f32,
        #[serde(default)]
        center: [f32; 3],
        #[serde(default)]
        rotation: [f32; 3],
    },
    MeshFile {
        file: String,
        sha256: String,
        #[serde(default)]
        convex: bool,
        #[serde(default)]
        cooking: Option<crate::mesh::Cooking>,
        #[serde(default)]
        position: [f32; 3],
        #[serde(default)]
        rotation: [f32; 3],
    },
    Mesh {
        vertices: Vec<[f32; 3]>,
        triangles: Vec<[u32; 3]>,
        #[serde(default)]
        convex: bool,
    },
}
#[derive(Clone, Deserialize, Serialize)]
pub struct JointSpec {
    pub id: String,
    pub parent: String,
    pub child: String,
    pub kind: String,
    pub axis: [f32; 3],
    pub anchor_parent: [f32; 3],
    pub anchor_child: [f32; 3],
    pub limits: Option<[f32; 2]>,
    #[serde(default)]
    pub damping: f32,
    /// Physical coordinate represented by the CAD assembly's bind pose.
    #[serde(default)]
    pub initial_position: f32,
    /// Opt in when CAD geometry provides a physical stop between linked bodies.
    /// Body collision groups must also allow the pair. Bearings/shafts normally
    /// overlap at a joint, so adjoining-body contacts stay disabled by default.
    #[serde(default)]
    pub contacts_enabled: bool,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct MotorSpec {
    pub id: String,
    pub joint: String,
    /// d(rotor radians)/d(joint coordinate). Rad/rad for rotary gears;
    /// rad/m for belt, rack, lead screw, drum or reeved pulley transmissions.
    pub rotor_per_unit: f32,
    #[serde(default = "efficiency")]
    pub efficiency: f32,
    pub resistance: f32,
    pub torque_constant: f32,
    pub velocity_constant: f32,
    pub current_limit: f32,
    #[serde(default)]
    pub initial_rotor_turns: f32,
}
#[derive(Default, Deserialize)]
pub struct Input {
    #[serde(default)]
    pub volts: BTreeMap<String, f32>,
    #[serde(default)]
    pub steps: Option<u32>,
    /// Open-circuit motors contribute no electrical braking torque.
    #[serde(default)]
    pub coast: Vec<String>,
}
#[derive(Serialize)]
pub struct BodyState {
    pub position: [f32; 3],
    pub quaternion: [f32; 4],
    pub velocity: [f32; 3],
    pub angular_velocity: [f32; 3],
}
#[derive(Serialize, Default, Clone)]
pub struct JointState {
    pub position: f32,
    pub velocity: f32,
}
#[derive(Serialize, Default, Clone)]
pub struct MotorState {
    pub rotor_turns: f32,
    pub rotor_rps: f32,
    pub current: f32,
    pub voltage: f32,
}
#[derive(Serialize)]
pub struct Snapshot {
    pub tick: u64,
    pub time: f64,
    pub physics_substeps: usize,
    pub bodies: BTreeMap<String, BodyState>,
    pub joints: BTreeMap<String, JointState>,
    pub motors: BTreeMap<String, MotorState>,
    pub transmissions: BTreeMap<String, TransmissionState>,
    pub contacts: Vec<[String; 2]>,
    pub compliance: compliance::ComplianceStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gameplay: Option<gameplay::Status>,
}
#[derive(Serialize)]
pub struct ContactInspection {
    pub bodies: [String; 2],
    pub collider_indices: [usize; 2],
    pub separation: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<ContactDetail>,
}
#[derive(Serialize)]
pub struct ContactDetail {
    /// Impulses cover the last native pipeline step, not the whole outer tick.
    pub step_seconds: f32,
    /// Complete scalar report before truncation, including auxiliary recovery.
    pub reported_impulse_ns: f64,
    /// Normal components with known orientation, acting on collider 2.
    /// Excludes friction and reports without a normal; not the net contact impulse.
    pub oriented_normal_impulse_on_collider2_ns: [f64; 3],
    pub unoriented_reported_impulse_ns: f64,
    pub omitted_manifolds: usize,
    pub manifolds: Vec<ContactManifoldInspection>,
}
#[derive(Serialize)]
pub struct ContactManifoldInspection {
    /// Synthetic recovery reports may have no single surface normal.
    pub normal_collider1_to_2: Option<[f32; 3]>,
    /// Scalar engine reports, including auxiliary recovery; not a net impulse
    /// vector, and not a sum over the outer tick.
    pub reported_impulse_ns: f32,
    pub separation: Option<f32>,
    pub points: usize,
}
impl ContactDetail {
    fn summarize(step_seconds: f32, mut manifolds: Vec<ContactManifoldInspection>) -> Self {
        let mut reported_impulse_ns = 0.0;
        let mut oriented_normal_impulse_on_collider2_ns = [0.0; 3];
        let mut unoriented_reported_impulse_ns = 0.0;
        for manifold in &manifolds {
            let impulse = f64::from(manifold.reported_impulse_ns);
            reported_impulse_ns += impulse;
            if let Some(normal) = manifold.normal_collider1_to_2 {
                for k in 0..3 {
                    oriented_normal_impulse_on_collider2_ns[k] += f64::from(normal[k]) * impulse;
                }
            } else {
                unoriented_reported_impulse_ns += impulse;
            }
        }
        manifolds.sort_by(|a, b| b.reported_impulse_ns.total_cmp(&a.reported_impulse_ns));
        let omitted_manifolds = manifolds.len().saturating_sub(32);
        manifolds.truncate(32);
        Self {
            step_seconds,
            reported_impulse_ns,
            oriented_normal_impulse_on_collider2_ns,
            unoriented_reported_impulse_ns,
            omitted_manifolds,
            manifolds,
        }
    }
}

#[cfg(test)]
mod contact_summary_tests {
    use super::*;

    #[test]
    fn totals_include_omitted_manifolds_and_separate_unknown_normals() {
        let mut rows: Vec<_> = (0..40)
            .map(|i| ContactManifoldInspection {
                normal_collider1_to_2: Some([0.0, 0.0, if i % 2 == 0 { 1.0 } else { -1.0 }]),
                reported_impulse_ns: 1.0,
                separation: Some(0.0),
                points: 1,
            })
            .collect();
        rows.push(ContactManifoldInspection {
            normal_collider1_to_2: None,
            reported_impulse_ns: 2.0,
            separation: None,
            points: 1,
        });
        let report = ContactDetail::summarize(0.005, rows);
        assert_eq!(report.manifolds.len(), 32);
        assert_eq!(report.omitted_manifolds, 9);
        assert_eq!(report.reported_impulse_ns, 42.0);
        assert_eq!(report.oriented_normal_impulse_on_collider2_ns, [0.0; 3]);
        assert_eq!(report.unoriented_reported_impulse_ns, 2.0);
        assert_eq!(report.manifolds[0].reported_impulse_ns, 2.0);
    }
}
#[derive(Serialize)]
pub struct ColliderInspection {
    pub intersects: bool,
    pub volume_m3: f32,
    pub convex_pieces: Option<usize>,
}
pub struct World {
    pub spec: WorldSpec,
    pub tick: u64,
    pub bodies: RigidBodySet,
    colliders: ColliderSet,
    joints: ImpulseJointSet,
    multibody: MultibodyJointSet,
    body_ids: HashMap<String, RigidBodyHandle>,
    joint_ids: HashMap<String, ImpulseJointHandle>,
    joint_references: HashMap<String, GenericJoint>,
    names: HashMap<RigidBodyHandle, String>,
    motor_states: BTreeMap<String, MotorState>,
    joint_states: BTreeMap<String, JointState>,
    transmission_states: BTreeMap<String, TransmissionState>,
    pipeline: PhysicsPipeline,
    islands: IslandManager,
    broad: BroadPhaseBvh,
    narrow: NarrowPhase,
    ccd: CCDSolver,
    soft_bodies: SoftBodySet,
    compliance: compliance::Runtime,
    gameplay: gameplay::Runtime,
    field_transport: field_transport::Runtime,
    physics_substeps: usize,
    transmission_ms: f64,
    // Optional diagnostics accumulated over every narrow-phase refinement, not
    // just Rapier's final inner step. Never serialized as physical state.
    profile_total: [f64; 18],
    islands_total_ms: f64,
    detailed_profiling: bool,
    substep_demands: Vec<serde_json::Value>,
}
impl World {
    pub fn new(spec: WorldSpec) -> Result<Self> {
        ensure!(
            spec.dt.is_finite() && spec.dt > 0.0 && spec.dt <= 0.02,
            "dt must be in (0,0.02]"
        );
        ensure!(
            spec.gravity.iter().all(|v| v.is_finite()),
            "nonfinite gravity"
        );
        ensure!(
            spec.contact_tolerance.is_finite()
                && spec.contact_tolerance > 0.0
                && spec.contact_tolerance <= 0.01,
            "invalid contact tolerance"
        );
        ensure!((1..=32).contains(&spec.solver_iterations), "solver_iterations must be in 1..32");
        ensure!(spec.static_contact_frequency_hz.is_finite()
            && (10.0..=1000.0).contains(&spec.static_contact_frequency_hz),
            "static_contact_frequency_hz must be in 10..1000");
        ensure!(spec.soft_contact_max_angle_rad.is_finite()
            && (0.05..=0.6).contains(&spec.soft_contact_max_angle_rad),
            "soft_contact_max_angle_rad must be in 0.05..0.6");
        let mut s = Self {
            spec: spec.clone(),
            tick: 0,
            bodies: RigidBodySet::new(),
            colliders: ColliderSet::new(),
            joints: ImpulseJointSet::new(),
            multibody: MultibodyJointSet::new(),
            body_ids: HashMap::new(),
            joint_ids: HashMap::new(),
            joint_references: HashMap::new(),
            names: HashMap::new(),
            motor_states: BTreeMap::new(),
            joint_states: BTreeMap::new(),
            transmission_states: BTreeMap::new(),
            pipeline: PhysicsPipeline::new(),
            islands: IslandManager::new(),
            broad: BroadPhaseBvh::new(),
            narrow: match spec.triangle_contact_filter {
                crate::mesh::dispatcher::TriangleContactFilter::Original if !cfg!(feature = "parallel-composite") => NarrowPhase::new(),
                mode => NarrowPhase::with_query_dispatcher(
                    crate::mesh::dispatcher::PlaneContactDispatcher {
                        audit_rejections: matches!(mode, crate::mesh::dispatcher::TriangleContactFilter::Audit),
                        filter_planes: !matches!(mode, crate::mesh::dispatcher::TriangleContactFilter::Original),
                    }
                ),
            },
            ccd: CCDSolver::new(),
            soft_bodies: SoftBodySet::new(),
            compliance: Default::default(),
            gameplay: Default::default(),
            field_transport: Default::default(),
            physics_substeps: 1,
            transmission_ms: 0.0,
            profile_total: [0.0; 18],
            islands_total_ms: 0.0,
            detailed_profiling: false,
            substep_demands: Vec::new(),
        };
        s.pipeline.counters.disable();
        let mut mesh_cache = crate::mesh::MeshCache::default();
        for b in &spec.bodies {
            ensure!(!s.body_ids.contains_key(&b.id), "duplicate body {}", b.id);
            ensure!(b.mass.is_finite() && b.mass > 0.0, "invalid mass {}", b.id);
            ensure!(
                b.friction.is_finite()
                    && b.friction >= 0.0
                    && b.restitution.is_finite()
                    && (0.0..=1.0).contains(&b.restitution),
                "invalid contact material"
            );
            ensure!(
                b.position
                    .iter()
                    .chain(b.rotation.iter())
                    .chain(b.velocity.iter())
                    .chain(b.angular_velocity.iter())
                    .all(|v| v.is_finite()),
                "nonfinite body pose or motion"
            );
            ensure!(
                !b.fixed || (b.velocity == [0.0; 3] && b.angular_velocity == [0.0; 3]),
                "fixed bodies cannot have initial motion"
            );
            let builder = if b.fixed {
                RigidBodyBuilder::fixed()
            } else {
                RigidBodyBuilder::dynamic()
            };
            let handle = s.bodies.insert(
                builder
                    .translation(b.position.into())
                    .rotation(b.rotation.into())
                    .linvel(b.velocity.into())
                    .angvel(b.angular_velocity.into())
                    .ccd_enabled(true)
                    .allow_fast_rotation(
                        spec.joints
                            .iter()
                            .any(|j| j.child == b.id && j.kind == "revolute" && j.limits.is_none()),
                    )
                    .can_sleep(true)
                    .build(),
            );
            s.body_ids.insert(b.id.clone(), handle);
            s.names.insert(handle, b.id.clone());
            for (shape_index, shape) in b.colliders.iter().enumerate() {
                let builder = match shape {
                    ShapeSpec::Box { half, center } => {
                        ensure!(
                            half.iter().all(|v| v.is_finite() && *v > 0.0),
                            "invalid box {}",
                            b.id
                        );
                        ColliderBuilder::cuboid(half[0], half[1], half[2])
                            .translation((*center).into())
                    }
                    ShapeSpec::Ball { radius, center } => {
                        ensure!(radius.is_finite() && *radius > 0.0, "invalid ball");
                        ColliderBuilder::ball(*radius).translation((*center).into())
                    }
                    ShapeSpec::Cylinder {
                        half_height,
                        radius,
                        center,
                        rotation,
                    } => {
                        ensure!(
                            half_height.is_finite()
                                && *half_height > 0.0
                                && radius.is_finite()
                                && *radius > 0.0,
                            "invalid cylinder"
                        );
                        ensure!(
                            center.iter().chain(rotation).all(|v| v.is_finite()),
                            "nonfinite cylinder pose"
                        );
                        ColliderBuilder::cylinder(*half_height, *radius)
                            .translation((*center).into())
                            .rotation((*rotation).into())
                    }
                    ShapeSpec::MeshFile {
                        file,
                        sha256,
                        convex,
                        cooking,
                        position,
                        rotation,
                    } => {
                        let cooking = cooking.unwrap_or(if *convex {
                            crate::mesh::Cooking::ConvexHull
                        } else {
                            crate::mesh::Cooking::TriMesh
                        });
                        ensure!(
                            b.fixed || !matches!(cooking, crate::mesh::Cooking::TriMesh | crate::mesh::Cooking::CuboidOrMesh),
                            "moving mesh files require convex cooking"
                        );
                        ensure!(
                            position.iter().chain(rotation).all(|v| v.is_finite()),
                            "nonfinite mesh pose"
                        );
                        ColliderBuilder::new(mesh_cache.load(file, sha256, cooking)?)
                            .translation((*position).into())
                            .rotation((*rotation).into())
                    }
                    ShapeSpec::Mesh {
                        vertices,
                        triangles,
                        convex,
                    } => {
                        ensure!(
                            !vertices.is_empty()
                                && vertices.iter().flatten().all(|v| v.is_finite()),
                            "invalid vertices"
                        );
                        ensure!(
                            triangles
                                .iter()
                                .flatten()
                                .all(|i| (*i as usize) < vertices.len()),
                            "invalid indices"
                        );
                        let points = vertices
                            .iter()
                            .map(|v| Vector::from(*v))
                            .collect::<Vec<_>>();
                        if *convex {
                            ColliderBuilder::convex_hull(&points)
                                .context("degenerate convex hull")?
                        } else {
                            ensure!(b.fixed, "moving meshes require convex cooking");
                            ColliderBuilder::trimesh(points, triangles.clone())
                                .map_err(|e| anyhow::anyhow!("trimesh: {e:?}"))?
                        }
                    }
                };
                s.colliders.insert_with_parent(
                    builder
                        .user_data(shape_index as u128)
                        .density(1.0)
                        .friction(b.friction)
                        .restitution(b.restitution)
                        .collision_groups(InteractionGroups::new(
                            Group::from_bits_retain(b.membership),
                            Group::from_bits_retain(b.filter),
                            InteractionTestMode::And,
                        ))
                        .build(),
                    handle,
                    &mut s.bodies,
                );
            }
            // Normalize the assembled collider mass to the authored body mass. This
            // preserves shape-derived center/inertia; material-specific overrides follow cooking.
            let body = &mut s.bodies[handle];
            body.recompute_mass_properties_from_colliders(&s.colliders);
            if !b.fixed {
                let props = body.mass_properties().local_mprops;
                if let Some(inertia) = b.principal_inertia {
                    let center = b.center_of_mass.unwrap_or([0.0; 3]);
                    ensure!(
                        inertia.iter().all(|v| v.is_finite() && *v > 0.0)
                            && center.iter().all(|v| v.is_finite()),
                        "invalid authored inertia"
                    );
                    for h in body.colliders().to_vec() {
                        s.colliders[h].set_density(0.0);
                    }
                    body.set_additional_mass_properties(
                        MassProperties::new(Vector::from(center), b.mass, inertia.into()),
                        true,
                    );
                } else if props.mass() > 0.0 {
                    let mut mp = props;
                    mp.set_mass(b.mass, true);
                    for h in body.colliders().to_vec() {
                        s.colliders[h].set_density(0.0);
                    }
                    body.set_additional_mass_properties(mp, true);
                } else {
                    body.set_additional_mass_properties(
                        MassProperties::new(Vector::ZERO, b.mass, Vector::splat(0.01)),
                        true,
                    );
                }
                body.recompute_mass_properties_from_colliders(&s.colliders);
            }
        }
        for j in &spec.joints {
            ensure!(!s.joint_ids.contains_key(&j.id), "duplicate joint {}", j.id);
            let parent = *s.body_ids.get(&j.parent).context("joint parent missing")?;
            let child = *s.body_ids.get(&j.child).context("joint child missing")?;
            ensure!(parent != child, "joint cannot link body to itself");
            ensure!(
                j.axis.iter().all(|v| v.is_finite()) && Vector::from(j.axis).length() > 0.99,
                "invalid joint axis"
            );
            ensure!(
                j.anchor_parent
                    .iter()
                    .chain(&j.anchor_child)
                    .all(|v| v.is_finite())
                    && j.initial_position.is_finite()
                    && j.damping.is_finite()
                    && j.damping >= 0.0,
                "invalid joint pose or damping"
            );
            if let Some(l) = j.limits {
                ensure!(
                    l[0].is_finite() && l[1].is_finite() && l[0] < l[1],
                    "invalid limits"
                );
            }
            let axis = Vector::from(j.axis).normalize();
            let mut data: GenericJoint = match j.kind.as_str() {
                "revolute" => {
                    let q = RevoluteJointBuilder::new(axis)
                        .local_anchor1(j.anchor_parent.into())
                        .local_anchor2(j.anchor_child.into())
                        .contacts_enabled(j.contacts_enabled);
                    // Continuous limits are recentered each step, allowing travel beyond pi.
                    q.build().into()
                }
                "prismatic" => {
                    let mut q = PrismaticJointBuilder::new(axis)
                        .local_anchor1(j.anchor_parent.into())
                        .local_anchor2(j.anchor_child.into())
                        .contacts_enabled(j.contacts_enabled);
                    if let Some(l) = j.limits {
                        q = q.limits([l[0] - j.initial_position, l[1] - j.initial_position]);
                    }
                    q.build().into()
                }
                "fixed" => FixedJointBuilder::new()
                    .local_anchor1(j.anchor_parent.into())
                    .local_anchor2(j.anchor_child.into())
                    .contacts_enabled(j.contacts_enabled)
                    .build()
                    .into(),
                _ => bail!("unsupported joint kind {}", j.kind),
            };
            // Axes are authored in the parent's bind frame. The child may
            // already have a different CAD pose: align the joint frames in
            // world space without rotating either body out of its bind pose.
            if s.bodies[parent].rotation() != s.bodies[child].rotation() {
                data.local_frame2.rotation = s.bodies[child].rotation().inverse()
                    * *s.bodies[parent].rotation()
                    * data.local_frame1.rotation;
            }
            s.joint_references.insert(j.id.clone(), data);
            s.joint_ids
                .insert(j.id.clone(), s.joints.insert(parent, child, data, true));
            let velocity = s.coordinates(j).velocity;
            s.joint_states.insert(
                j.id.clone(),
                JointState {
                    position: j.initial_position,
                    velocity,
                },
            );
        }
        for m in &spec.motors {
            ensure!(
                s.joint_ids.contains_key(&m.joint),
                "motor joint missing {}",
                m.id
            );
            ensure!(
                m.rotor_per_unit.is_finite()
                    && m.rotor_per_unit != 0.0
                    && m.resistance > 0.0
                    && m.velocity_constant > 0.0
                    && m.torque_constant > 0.0
                    && m.current_limit > 0.0
                    && m.efficiency > 0.0
                    && m.efficiency <= 1.0,
                "invalid motor/transmission {}",
                m.id
            );
            ensure!(
                s.motor_states
                    .insert(
                        m.id.clone(),
                        MotorState {
                            rotor_turns: s.joint_states[&m.joint].position * m.rotor_per_unit
                                / std::f32::consts::TAU
                                + m.initial_rotor_turns,
                            rotor_rps: s.joint_states[&m.joint].velocity * m.rotor_per_unit
                                / std::f32::consts::TAU,
                            ..Default::default()
                        }
                    )
                    .is_none(),
                "duplicate motor {}",
                m.id
            );
        }
        for t in &spec.transmissions {
            ensure!(
                t.driver != t.follower,
                "transmission cannot link a joint to itself"
            );
            for id in [&t.driver, &t.follower] {
                ensure!(
                    spec.joints.iter().any(|j| &j.id == id && j.kind != "fixed"),
                    "transmission joint missing or fixed: {id}"
                );
            }
            ensure!(
                [t.ratio, t.phase, t.stiffness, t.damping, t.max_effort]
                    .iter()
                    .all(|v| v.is_finite())
                    && t.ratio != 0.0
                    && t.stiffness > 0.0
                    && t.damping >= 0.0
                    && t.max_effort > 0.0,
                "invalid transmission {}",
                t.id
            );
            ensure!(
                s.transmission_states
                    .insert(t.id.clone(), TransmissionState::default())
                    .is_none(),
                "duplicate transmission {}",
                t.id
            );
        }
        s.validate_compliance()?;
        s.validate_gameplay()?;
        s.update_transmission_states();
        Ok(s)
    }
    fn update_transmission_states(&mut self) {
        for t in &self.spec.transmissions {
            let driver = &self.joint_states[&t.driver];
            let follower = &self.joint_states[&t.follower];
            let state = self.transmission_states.get_mut(&t.id).unwrap();
            state.error = follower.position - t.ratio * driver.position - t.phase;
            state.velocity_error = follower.velocity - t.ratio * driver.velocity;
        }
    }
    fn joint_jacobian(&self, j: &JointSpec, scale: f32, terms: &mut Vec<Jacobian>) {
        let parent = self.body_ids[&j.parent];
        let child = self.body_ids[&j.child];
        let p = &self.bodies[parent];
        let c = &self.bodies[child];
        let axis = p.rotation() * Vector::from(j.axis).normalize() * scale;
        if j.kind == "prismatic" {
            let anchor = c.position() * Vector::from(j.anchor_child);
            transmission::add_term(
                terms,
                Jacobian {
                    body: parent,
                    linear: -axis,
                    angular: -(anchor - p.center_of_mass()).cross(axis),
                },
            );
            transmission::add_term(
                terms,
                Jacobian {
                    body: child,
                    linear: axis,
                    angular: (anchor - c.center_of_mass()).cross(axis),
                },
            );
        } else {
            transmission::add_term(
                terms,
                Jacobian {
                    body: parent,
                    linear: Vector::ZERO,
                    angular: -axis,
                },
            );
            transmission::add_term(
                terms,
                Jacobian {
                    body: child,
                    linear: Vector::ZERO,
                    angular: axis,
                },
            );
        }
    }
    fn coupled(&self, id: &str) -> bool {
        // A motor and its unilateral stop must share the same impulse solve.
        // Solving the velocity drive separately leaves false residual motion
        // at a powered end stop, even without a belt on that shaft.
        self.spec
            .joints
            .iter()
            .any(|j| j.id == id && j.limits.is_some())
            || self
                .spec
                .transmissions
                .iter()
                .any(|t| t.driver == id || t.follower == id)
    }
    fn solve_transmissions(&mut self, drives: &BTreeMap<String, (f32, f32, f32)>, dt: f32) {
        let mut rows: Vec<_> = self
            .spec
            .transmissions
            .iter()
            .map(|t| {
                let driver = self.spec.joints.iter().find(|j| j.id == t.driver).unwrap();
                let follower = self
                    .spec
                    .joints
                    .iter()
                    .find(|j| j.id == t.follower)
                    .unwrap();
                let mut terms = Vec::with_capacity(4);
                self.joint_jacobian(driver, -t.ratio, &mut terms);
                self.joint_jacobian(follower, 1.0, &mut terms);
                Row {
                    terms,
                    error: self.coordinates(follower).position
                        - t.ratio * self.coordinates(driver).position
                        - t.phase,
                    stiffness: t.stiffness,
                    damping: t.damping,
                    max_effort: t.max_effort,
                    min_effort: -t.max_effort,
                    target_velocity: 0.0,
                }
            })
            .collect();
        // Coupled motors must be in the same implicit solve as their belts.
        // Applying a separate velocity motor afterwards would inject torque
        // after the load reaction and report a false residual shaft velocity.
        for j in self.spec.joints.iter().filter(|j| self.coupled(&j.id)) {
            let (motor_damping, weighted_target, max_force) =
                drives.get(&j.id).copied().unwrap_or_default();
            let damping = motor_damping + j.damping;
            if damping > 0.0 {
                let mut terms = Vec::with_capacity(2);
                self.joint_jacobian(j, 1.0, &mut terms);
                let force = if motor_damping > 0.0 {
                    max_force
                } else {
                    f32::MAX
                };
                rows.push(Row {
                    terms,
                    error: 0.0,
                    stiffness: 0.0,
                    damping,
                    target_velocity: weighted_target / damping,
                    max_effort: force,
                    min_effort: -force,
                });
            }
            if let Some([lower, upper]) = j.limits {
                // Speculative unilateral stops take part in the same solve.
                // Otherwise a light roller could wind up a whole belt before
                // Rapier applies its end stop later in the step.
                let position = self.coordinates(j).position;
                for (scale, gap) in [(1.0, position - lower), (-1.0, upper - position)] {
                    let mut terms = Vec::with_capacity(2);
                    self.joint_jacobian(j, scale, &mut terms);
                    rows.push(Row {
                        terms,
                        error: 0.0,
                        stiffness: 0.0,
                        damping: 0.0,
                        target_velocity: -gap / dt,
                        min_effort: 0.0,
                        max_effort: f32::MAX,
                    });
                }
            }
        }
        let efforts = transmission::solve(&rows, &mut self.bodies, dt);
        for (t, effort) in self.spec.transmissions.iter().zip(efforts) {
            let state = self.transmission_states.get_mut(&t.id).unwrap();
            state.effort = effort;
            state.saturated = effort.abs() >= t.max_effort * 0.999;
        }
    }
    fn coordinates(&self, j: &JointSpec) -> JointState {
        let p = &self.bodies[self.body_ids[&j.parent]];
        let c = &self.bodies[self.body_ids[&j.child]];
        let axis = p.rotation() * Vector::from(j.axis).normalize();
        let a = p.position() * Vector::from(j.anchor_parent);
        let b = c.position() * Vector::from(j.anchor_child);
        if j.kind == "prismatic" {
            JointState {
                position: (b - a).dot(axis) + j.initial_position,
                velocity: (c.velocity_at_point(b) - p.velocity_at_point(b)).dot(axis),
            }
        } else if j.kind == "revolute" {
            let joint = self.joint_references[&j.id].as_revolute().unwrap();
            let raw = joint.angle(p.rotation(), c.rotation()) + j.initial_position;
            let prev = self.joint_states.get(&j.id).map_or(0.0, |v| v.position);
            let tau = std::f32::consts::TAU;
            JointState {
                position: prev + (raw - prev + std::f32::consts::PI).rem_euclid(tau)
                    - std::f32::consts::PI,
                velocity: (c.angvel() - p.angvel()).dot(axis),
            }
        } else {
            JointState::default()
        }
    }
    fn contact_substeps(&mut self, input: &Input) -> Result<usize> {
        // Solver iterations reuse contact anchors. A rapidly turning roller
        // needs actual narrow-phase refreshes, not merely more solver iterations.
        // Predictive contacts become active before touching, so they trigger
        // finer stepping ahead of the nip. Free shafts keep the cheap cadence.
        let mut contacting: HashMap<RigidBodyHandle, f32> = HashMap::new();
        let mut demand = 1.0_f32;
        self.substep_demands.clear();
        for pair in self
            .narrow
            .contact_pairs()
            .filter(|p| p.has_any_active_contact())
        {
            let soft = [pair.collider1, pair.collider2].into_iter().any(|c| {
                self.colliders
                    .get(c)
                    .and_then(|c| c.parent())
                    .is_some_and(|h| self.bodies[h].soft_body().is_some())
            });
            let angle = if soft { self.spec.soft_contact_max_angle_rad } else { 0.6_f32 };
            for collider in [pair.collider1, pair.collider2] {
                if let Some(h) = self.colliders.get(collider).and_then(|c| c.parent()) {
                    contacting
                        .entry(h)
                        .and_modify(|a| *a = a.min(angle))
                        .or_insert(angle);
                    let rotation_demand = self.bodies[h].angvel().length() * self.spec.dt / angle;
                    demand = demand.max(rotation_demand);
                }
            }
        }
        if self.detailed_profiling {
            for (h, angle) in &contacting {
                let demand = self.bodies[*h].angvel().length() * self.spec.dt / angle;
                if demand > 1.0 {
                    self.substep_demands.push(serde_json::json!({
                        "source":"body_rotation", "body":self.names.get(h),
                        "soft":self.bodies[*h].soft_body().is_some(),
                        "angle":angle, "demand":demand
                    }));
                }
            }
        }
        for motor in &self.spec.motors {
            let joint = self
                .spec
                .joints
                .iter()
                .find(|j| j.id == motor.joint)
                .unwrap();
            if joint.kind == "revolute" {
                let Some(angle) = contacting.get(&self.body_ids[&joint.child]) else {
                    continue;
                };
                let target = input.volts.get(&motor.id).copied().unwrap_or(0.0)
                    * motor.velocity_constant
                    / motor.rotor_per_unit;
                let motor_demand = target.abs() * self.spec.dt / angle;
                demand = demand.max(motor_demand);
                if self.detailed_profiling && motor_demand > 1.0 {
                    self.substep_demands.push(serde_json::json!({
                        "source":"motor_target", "body":joint.child, "motor":motor.id,
                        "angle":angle, "demand":motor_demand
                    }));
                }
            }
        }
        // Soft contacts additionally refine their own island. Only rapid rigid
        // surface rotation needs extra narrow-phase refreshes of the world.
        let count = demand.ceil() as usize;
        ensure!(
            count <= 64,
            "contact motion exceeds bounded physics substep budget"
        );
        Ok(count)
    }

    pub fn step(&mut self, input: &Input) -> Result<()> {
        self.step_refined(input, 1)
    }

    pub fn enable_profiling(&mut self) {
        self.detailed_profiling = true;
        self.pipeline.counters.enable();
        self.ccd.enable_profiling(true);
        self.narrow.enable_profiling(true);
    }

    /// Live sampling enables only stage timers, never per-pair/CCD traces.
    pub fn sample_performance(&mut self, enabled: bool) {
        if enabled || self.detailed_profiling { self.pipeline.counters.enable(); }
        else { self.pipeline.counters.disable(); }
    }

    pub fn performance_sample(&self, physics_ms: f64) -> crate::performance::Sample {
        let mut sample = crate::performance::Sample::default();
        sample.stages = [self.profile_total[0], self.profile_total[4], self.profile_total[5],
            self.profile_total[2], self.profile_total[3], self.profile_total[6], self.profile_total[8],
            self.transmission_ms, (physics_ms - self.profile_total[0]).max(0.0),
            self.profile_total[7], self.islands_total_ms];
        sample.substeps = self.profile_total[9] as usize;
        for (_, b) in self.bodies.iter().filter(|(_,b)| b.is_enabled() && b.is_dynamic()) {
            if b.is_sleeping() { sample.counts[1] += 1; }
            else {
                sample.counts[0] += 1;
                if b.colliders().len() == 1 && self.colliders[b.colliders()[0]].shape().as_ball().is_some() { sample.counts[2] += 1; }
            }
        }
        sample.counts[3] = self.soft_bodies.iter().count();
        for pair in self.narrow.contact_pairs().filter(|p| p.has_any_active_contact()) {
            sample.counts[4] += 1;
            let a = &self.colliders[pair.collider1];
            let b = &self.colliders[pair.collider2];
            let sphere = |c: &Collider| c.shape().as_ball().is_some();
            let fixed = |c: &Collider| c.parent().is_none_or(|h| self.bodies[h].is_fixed());
            if sphere(a) && sphere(b) { sample.counts[5] += 1; }
            else if sphere(a) || sphere(b) {
                sample.counts[if fixed(a) || fixed(b) { 6 } else { 7 }] += 1;
            }
        }
        sample
    }

    /// Diagnostic counters. Rapier resets on each inner pipeline step; its
    /// counters therefore describe only the last substep, not an outer sum.
    pub fn profile(&self) -> Option<serde_json::Value> {
        let c = &self.pipeline.counters;
        if !self.detailed_profiling {
            return None;
        }
        Some(serde_json::json!({
            "tick":self.tick,"substeps":self.physics_substeps,
            "allSubsteps": {
                "pipelineMs":self.profile_total[0],
                "collisionMs":self.profile_total[1],
                "solverMs":self.profile_total[2],
                "ccdToiMs":self.profile_total[3],
                "broadPhaseMs":self.profile_total[4],
                "narrowPhaseMs":self.profile_total[5],
                "updateMs":self.profile_total[6],
                "userChangesMs":self.profile_total[7],
                "constraintsMs":self.profile_total[8],
                "count":self.profile_total[9],
                "solverAssemblyMs":self.profile_total[10],
                "solverResolutionMs":self.profile_total[11],
                "solverWritebackMs":self.profile_total[12],
                "solverVelocityUpdateMs":self.profile_total[13],
                "solverBodyInitMs":self.profile_total[14],
                "solverConstraintInitMs":self.profile_total[15],
                "solverContactPoints":self.profile_total[16],
                "solverManifoldsAndJoints":self.profile_total[17]
            },
            "triangleContactFilter":self.spec.triangle_contact_filter,
            "awakeDynamicBodyIds":self.bodies.iter().filter_map(|(h,b)| {
                (b.is_enabled() && b.is_dynamic() && !b.is_sleeping()).then(|| self.names.get(&h)).flatten()
            }).collect::<Vec<_>>(),
            "transmissionTotalMs":self.transmission_ms,
            "substepDemands":self.substep_demands,
            "contactPairsLastSubstep":self.narrow.contact_pairs().filter_map(|pair| {
                let (milliseconds,outcome)=pair.update_profile?;
                let collider = |handle: ColliderHandle| {
                    let c=&self.colliders[handle];
                    serde_json::json!({"body":c.parent().and_then(|h|self.names.get(&h)),
                        "index":c.user_data as usize})
                };
                Some(serde_json::json!({"a":collider(pair.collider1),"b":collider(pair.collider2),
                    "milliseconds":milliseconds,"outcome":outcome}))
            }).collect::<Vec<_>>(),
            "pipelineLastSubstepMs":c.step_time_ms(),
            "ccdBodies":self.body_ids.iter().filter_map(|(id,h)|self.bodies[*h].is_ccd_active().then_some(id)).collect::<Vec<_>>(),
            "ccdSweeps":self.ccd.body_profiles().iter().map(|body|serde_json::json!({
                "body":self.names.get(&body.body),"milliseconds":body.milliseconds,
                "colliders":body.colliders.iter().map(|collider|serde_json::json!({
                    "index":self.colliders[collider.collider].user_data as usize,
                    "preparationMs":collider.preparation_ms,
                    "pairs":collider.pairs.iter().map(|pair|{
                        let target=&self.colliders[pair.target];
                        serde_json::json!({"body":target.parent().and_then(|h|self.names.get(&h)),
                            "index":target.user_data as usize,"milliseconds":pair.milliseconds,
                            "fraction":pair.fraction})
                    }).collect::<Vec<_>>()
                })).collect::<Vec<_>>()
            })).collect::<Vec<_>>(),
            "lastSubstep":{
                "awakeDynamicBodies":self.bodies.iter().filter(|(_, b)| b.is_enabled() && b.is_dynamic() && !b.is_sleeping()).count(),
                "sleepingDynamicBodies":self.bodies.iter().filter(|(_, b)| b.is_enabled() && b.is_dynamic() && b.is_sleeping()).count(),
                "collisionMs":c.stages.collision_detection_time.time_ms(),
                "islandsMs":c.stages.island_construction_time.time_ms(),
                "constraintsMs":c.stages.island_constraints_collection_time.time_ms(),
                "solverMs":c.stages.solver_time.time_ms(),
                "solverAssemblyMs":c.solver.velocity_assembly_time.time_ms(),
                "solverResolutionMs":c.solver.velocity_resolution_time.time_ms(),
                "solverWritebackMs":c.solver.velocity_writeback_time.time_ms(),
                "solverVelocityUpdateMs":c.solver.velocity_update_time.time_ms(),
                "solverBodyInitMs":c.solver.velocity_assembly_time_solver_bodies.time_ms(),
                "solverConstraintInitMs":c.solver.velocity_assembly_time_constraints_init.time_ms(),
                "solverContactPoints":c.solver.ncontacts,
                "solverManifoldsAndJoints":c.solver.nconstraints,
                "ccdMs":c.stages.ccd_time.time_ms(),
                "ccdToiMs":c.ccd.toi_computation_time.time_ms(),
                "userChangesMs":c.stages.user_changes.time_ms(),
                "updateMs":c.stages.update_time.time_ms(),
                "broadPhaseMs":c.cd.broad_phase_time.time_ms(),
                "narrowPhaseMs":c.cd.narrow_phase_time.time_ms()
            }
        }))
    }

    /// Numerical diagnostics can refine a short interval after an identical
    /// history. Bridge time, input hold duration and compliance timing stay fixed.
    pub fn step_refined(&mut self, input: &Input, minimum_substeps: usize) -> Result<()> {
        ensure!(
            (1..=64).contains(&minimum_substeps),
            "invalid minimum substeps"
        );
        ensure!(
            input
                .coast
                .iter()
                .all(|id| self.motor_states.contains_key(id)),
            "unknown coasting motor"
        );
        ensure!(
            input
                .volts
                .iter()
                .all(|(k, v)| self.motor_states.contains_key(k)
                    && v.is_finite()
                    && v.abs() <= 16.0),
            "unknown motor or invalid voltage"
        );
        let steps = input.steps.unwrap_or(1);
        ensure!(steps > 0 && steps <= 10000, "step count out of range");
        self.transmission_ms = 0.0;
        self.profile_total = [0.0; 18];
        self.islands_total_ms = 0.0;
        for _ in 0..steps {
            self.update_compliance()?;
            self.physics_substeps = self.contact_substeps(input)?.max(minimum_substeps);
            let dt = self.spec.dt / self.physics_substeps as f32;
            for _substep in 0..self.physics_substeps {
                // Motors use constraints/impulses, not persistent user forces.
                // Touching every body here needlessly invalidates the engine's
                // incremental body/joint bookkeeping, including sleeping fuel.
                let mut drives: BTreeMap<String, (f32, f32, f32)> = BTreeMap::new();
                for m in &self.spec.motors {
                    let q = self
                        .coordinates(self.spec.joints.iter().find(|j| j.id == m.joint).unwrap());
                    let voltage = input.volts.get(&m.id).copied().unwrap_or(0.0);
                    let speed = q.velocity * m.rotor_per_unit;
                    let coasting = input.coast.contains(&m.id);
                    let current = if coasting {
                        0.0
                    } else {
                        ((voltage - speed / m.velocity_constant) / m.resistance)
                            .clamp(-m.current_limit, m.current_limit)
                    };
                    // Solve motor back-EMF implicitly with the joint constraints. Applying
                    // explicit high-reduction damping torques would destabilize light mechanisms.
                    let damping = m.torque_constant * m.rotor_per_unit.powi(2) * m.efficiency
                        / (m.resistance * m.velocity_constant);
                    let target = voltage * m.velocity_constant / m.rotor_per_unit;
                    if !coasting {
                        let d = drives.entry(m.joint.clone()).or_default();
                        d.0 += damping;
                        d.1 += damping * target;
                        d.2 += m.current_limit
                            * m.torque_constant
                            * m.rotor_per_unit.abs()
                            * m.efficiency;
                    }
                    self.motor_states.insert(
                        m.id.clone(),
                        MotorState {
                            rotor_turns: q.position * m.rotor_per_unit / std::f32::consts::TAU
                                + m.initial_rotor_turns,
                            rotor_rps: speed / std::f32::consts::TAU,
                            current,
                            voltage,
                        },
                    );
                }
                for j in &self.spec.joints {
                    if j.kind == "fixed" {
                        continue;
                    }
                    if j.kind == "revolute" {
                        if let Some([lo, hi]) = j.limits {
                            let q = self.coordinates(j).position;
                            let original = self.joint_references[&j.id].local_frame1;
                            let data = &mut self
                                .joints
                                .get_mut(self.joint_ids[&j.id], true)
                                .unwrap()
                                .data;
                            // Keep the solver's local angular coordinate near zero. Limits now
                            // describe distance from the continuous coordinate, not wrapped yaw.
                            data.local_frame1 =
                                original * Pose::rotation(Vector::X * (q - j.initial_position));
                            let pi = std::f32::consts::PI;
                            data.set_limits(
                                JointAxis::AngX,
                                [(lo - q).clamp(-pi, pi), (hi - q).clamp(-pi, pi)],
                            );
                        }
                    }
                    let (motor_damping, weighted_target, max_force) =
                        drives.get(&j.id).copied().unwrap_or_default();
                    let damping = motor_damping + j.damping;
                    if damping > 0.0 && !self.coupled(&j.id) {
                        let axis = if j.kind == "prismatic" {
                            JointAxis::LinX
                        } else {
                            JointAxis::AngX
                        };
                        let data = &mut self
                            .joints
                            .get_mut(self.joint_ids[&j.id], true)
                            .unwrap()
                            .data;
                        data.set_motor_model(axis, MotorModel::ForceBased);
                        data.set_motor_velocity(axis, weighted_target / damping, damping);
                        data.set_motor_max_force(
                            axis,
                            if motor_damping > 0.0 {
                                max_force
                            } else {
                                f32::MAX
                            },
                        );
                    } else {
                        let axis = if j.kind == "prismatic" {
                            JointAxis::LinX
                        } else {
                            JointAxis::AngX
                        };
                        self.joints
                            .get_mut(self.joint_ids[&j.id], true)
                            .unwrap()
                            .data
                            .set_motor_max_force(axis, 0.0);
                    }
                }
                let transmission_started = self
                    .pipeline
                    .counters
                    .enabled()
                    .then(std::time::Instant::now);
                self.solve_transmissions(&drives, dt);
                if let Some(t) = transmission_started {
                    self.transmission_ms += t.elapsed().as_secs_f64() * 1000.0;
                }
                let params = IntegrationParameters {
                    dt,
                    num_solver_iterations: self.spec.solver_iterations,
                    normalized_allowed_linear_error: self.spec.contact_tolerance,
                    contact_softness: SpringCoefficients::new(1.0e6, 1.0),
                    static_contact_softness: SpringCoefficients::new(self.spec.static_contact_frequency_hz, 10.0),
                    normalized_contact_recycle_distance: self.spec.contact_tolerance,
                    ..Default::default()
                };
                #[cfg(feature = "contact-audit")]
                eprintln!(
                    "{}",
                    serde_json::json!({"type":"physics_step","time":self.tick as f64*self.spec.dt as f64+_substep as f64*dt as f64,"dt":dt})
                );
                self.pipeline.step(
                    self.spec.gravity.into(),
                    &params,
                    &mut self.islands,
                    &mut self.broad,
                    &mut self.narrow,
                    &mut self.bodies,
                    &mut self.colliders,
                    &mut self.joints,
                    &mut self.multibody,
                    &mut self.soft_bodies,
                    &mut self.ccd,
                    &(),
                    &(),
                );
                let c = &self.pipeline.counters;
                if c.enabled() {
                    self.islands_total_ms += c.stages.island_construction_time.time_ms();
                    let sample = [c.step_time_ms(), c.stages.collision_detection_time.time_ms(),
                        c.stages.solver_time.time_ms(), c.ccd.toi_computation_time.time_ms(),
                        c.cd.broad_phase_time.time_ms(), c.cd.narrow_phase_time.time_ms(),
                        c.stages.update_time.time_ms(), c.stages.user_changes.time_ms(),
                        c.stages.island_constraints_collection_time.time_ms(), 1.0,
                        c.solver.velocity_assembly_time.time_ms(),
                        c.solver.velocity_resolution_time.time_ms(),
                        c.solver.velocity_writeback_time.time_ms(),
                        c.solver.velocity_update_time.time_ms(),
                        c.solver.velocity_assembly_time_solver_bodies.time_ms(),
                        c.solver.velocity_assembly_time_constraints_init.time_ms(),
                        c.solver.ncontacts as f64, c.solver.nconstraints as f64];
                    for (total, value) in self.profile_total.iter_mut().zip(sample) {
                        *total += value;
                    }
                }
                for j in &self.spec.joints {
                    let mut next = self.coordinates(j);
                    if j.kind == "revolute" {
                        // A shooter can rotate more than pi in one 5 ms bridge tick.
                        // Choose the rotation branch near the velocity prediction,
                        // instead of always choosing the smallest angular change.
                        let previous = &self.joint_states[&j.id];
                        let expected =
                            previous.position + 0.5 * (previous.velocity + next.velocity) * dt;
                        let tau = std::f32::consts::TAU;
                        next.position += ((expected - next.position) / tau).round() * tau;
                    }
                    self.joint_states.insert(j.id.clone(), next);
                }
                self.update_transmission_states();
                for m in &self.spec.motors {
                    let q = &self.joint_states[&m.joint];
                    let state = self.motor_states.get_mut(&m.id).unwrap();
                    state.rotor_turns = q.position * m.rotor_per_unit / std::f32::consts::TAU
                        + m.initial_rotor_turns;
                    state.rotor_rps = q.velocity * m.rotor_per_unit / std::f32::consts::TAU;
                    state.current = if input.coast.contains(&m.id) {
                        0.0
                    } else {
                        ((state.voltage - q.velocity * m.rotor_per_unit / m.velocity_constant)
                            / m.resistance)
                            .clamp(-m.current_limit, m.current_limit)
                    };
                }
            }
            self.gameplay_step(input);
            self.field_transport_step(input);
            self.tick += 1;
        }
        Ok(())
    }
    pub fn inspect_collider(
        &self,
        body: &str,
        index: usize,
        center: [f32; 3],
        radius: f32,
    ) -> Result<ColliderInspection> {
        ensure!(
            center.iter().all(|v| v.is_finite())
                && radius.is_finite()
                && radius > 0.0
                && radius <= 10.0,
            "invalid inspection sphere"
        );
        let handle = self.body_ids.get(body).context("unknown body")?;
        ensure!(
            self.compliant_body_state(body).is_none(),
            "inspect soft contacts instead of the inactive rigid template"
        );
        let collider = &self.colliders[*self.bodies[*handle]
            .colliders()
            .get(index)
            .context("unknown collider index")?];
        let sphere = Ball::new(radius);
        let intersects = rapier3d::parry::query::intersection_test(
            collider.position(),
            collider.shape(),
            &Pose::translation(center[0], center[1], center[2]),
            &sphere,
        )
        .map_err(|e| anyhow::anyhow!("unsupported inspection shape pair: {e:?}"))?;
        Ok(ColliderInspection {
            intersects: intersects.intersecting,
            volume_m3: collider.shape().mass_properties(1.0).mass(),
            convex_pieces: collider.shape().as_compound().map(|c| c.shapes().len()),
        })
    }

    /// Read-only, on-demand geometry for isolated contact profiling. Resolve
    /// active soft proxies by public name, never the disabled rigid template.
    pub fn inspect_collision_geometry(&self, body: &str, index: usize) -> Result<serde_json::Value> {
        ensure!(self.body_ids.contains_key(body), "unknown body");
        let matches: Vec<_> = self.colliders.iter().filter_map(|(_, co)| {
            let h=co.parent()?;
            (co.is_enabled() && self.bodies[h].is_enabled()
                && self.names.get(&h).is_some_and(|name|name==body)
                && co.user_data as usize==index).then_some(co)
        }).collect();
        ensure!(matches.len()==1,"expected one active collider, found {}",matches.len());
        let co=matches[0];
        Ok(serde_json::json!({"schema":1,"tick":self.tick,"body":body,"index":index,
            "scope":"Post-step collision geometry, not a solver checkpoint",
            "pose":co.position(),"shape":co.shared_shape(),"contactSkin":co.contact_skin()}))
    }

    pub fn inspect_contacts(&self, body: &str, details: bool) -> Result<Vec<ContactInspection>> {
        ensure!(self.body_ids.contains_key(body), "unknown body");
        let mut contacts = Vec::new();
        for pair in self
            .narrow
            .contact_pairs()
            .filter(|p| p.has_any_active_contact())
        {
            let Some(a) = self.colliders.get(pair.collider1) else {
                continue;
            };
            let Some(b) = self.colliders.get(pair.collider2) else {
                continue;
            };
            let (Some(ah), Some(bh)) = (a.parent(), b.parent()) else {
                continue;
            };
            let names = [self.names[&ah].clone(), self.names[&bh].clone()];
            if !names.iter().any(|n| n == body) {
                continue;
            }
            contacts.push(ContactInspection {
                bodies: names,
                collider_indices: [a.user_data as usize, b.user_data as usize],
                separation: pair.find_deepest_contact().map(|(_, c)| c.dist),
                detail: details.then(|| {
                    let manifolds = pair
                        // CAD mesh contacts may be clustered for the solver.
                        // Raw geometric manifolds then contain zero impulses.
                        .solver_manifolds()
                        .iter()
                        .map(|m| ContactManifoldInspection {
                            normal_collider1_to_2: (m.data.normal.length_squared() > 0.5)
                                .then(|| m.data.normal.into()),
                            reported_impulse_ns: m.points.iter().map(|p| p.data.impulse).sum(),
                            separation: m.points.iter().map(|p| p.dist).reduce(f32::min),
                            points: m.points.len(),
                        })
                        .collect::<Vec<_>>();
                    ContactDetail::summarize(self.spec.dt / self.physics_substeps as f32, manifolds)
                }),
            });
        }
        Ok(contacts)
    }

    pub fn snapshot(&self) -> Snapshot {
        let bodies = self
            .body_ids
            .iter()
            .map(|(id, h)| {
                if let Some(state) = self.compliant_body_state(id) {
                    return (id.clone(), state);
                }
                let b = &self.bodies[*h];
                let r = b.rotation();
                (
                    id.clone(),
                    BodyState {
                        position: b.translation().into(),
                        quaternion: [r.x, r.y, r.z, r.w],
                        velocity: b.linvel().into(),
                        angular_velocity: b.angvel().into(),
                    },
                )
            })
            .collect();
        let mut contacts = Vec::new();
        for c in self.narrow.contact_pairs() {
            if c.has_any_active_contact() {
                let a = self.colliders.get(c.collider1).and_then(|c| c.parent());
                let b = self.colliders.get(c.collider2).and_then(|c| c.parent());
                if let (Some(a), Some(b)) = (a, b) {
                    contacts.push([self.names[&a].clone(), self.names[&b].clone()]);
                }
            }
        }
        contacts.sort();
        contacts.dedup();
        Snapshot {
            tick: self.tick,
            time: self.tick as f64 * self.spec.dt as f64,
            physics_substeps: self.physics_substeps,
            bodies,
            joints: self.joint_states.clone(),
            motors: self.motor_states.clone(),
            transmissions: self.transmission_states.clone(),
            contacts,
            compliance: self.compliance_status(),
            gameplay: self.gameplay_status(),
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn inclined_compound_cylinder_preserves_analytic_inertia() {
        // Two adjacent coaxial cylinders are exactly one longer cylinder.
        // Inertia must retain its physical axis even at small CAD dimensions.
        let axis = Vector::new(0.35836795, 0.0, 0.93358043).normalize();
        let radius = 0.0254;
        let half = 0.0127;
        let rotation = Vector::Y.cross(axis).normalize() * std::f32::consts::FRAC_PI_2;
        let mut spec = fixture("revolute", 5.0);
        spec.bodies[1].mass = 0.25;
        spec.bodies[1].colliders = [-1.0, 1.0]
            .into_iter()
            .map(|sign| ShapeSpec::Cylinder {
                radius,
                half_height: half,
                center: (axis * half * sign).into(),
                rotation: rotation.into(),
            })
            .collect();
        spec.joints[0].axis = axis.into();
        let w = World::new(spec).unwrap();
        let body = &w.bodies[w.body_ids["moving"]];
        let expected = axis / (0.5 * 0.25 * radius * radius);
        let actual = body.mass_properties().effective_world_inv_inertia * axis;
        assert!(
            (actual - expected).length() / expected.length() < 0.0005,
            "compound inertia rotated the shaft axis: actual {actual:?}, expected {expected:?}"
        );
    }
    #[test]
    fn inclined_gear_graph_obeys_motor_speed_and_coast_energy() {
        // Eight shafts with coaxial compound wheels and alternating gear ratios.
        // Test oblique axes and translated frames, without field assets or contacts.
        for (tilt, origin) in [
            (0.0, Vector::ZERO),
            (0.36651915, Vector::new(8.2, 4.0, 0.0)),
            (-0.71, Vector::new(-2.0, 6.0, 1.0)),
        ] {
            let axis = Vector::new(tilt.sin(), 0.0, tilt.cos());
            let rotation = Vector::Y.cross(axis).normalize() * std::f32::consts::FRAC_PI_2;
            let mut spec = fixture("revolute", 5.0);
            spec.dt = 0.005;
            spec.bodies[0].position = origin.into();
            let mut wheel = spec.bodies.pop().unwrap();
            wheel.mass = 0.25;
            wheel.filter = 0;
            wheel.colliders = [-1.0, 1.0]
                .into_iter()
                .map(|sign| ShapeSpec::Cylinder {
                    radius: 0.0254,
                    half_height: 0.0127,
                    center: (axis * 0.0127 * sign).into(),
                    rotation: rotation.into(),
                })
                .collect();
            let mut joint = spec.joints.pop().unwrap();
            joint.axis = axis.into();
            joint.damping = 0.0001;
            for i in 0..8 {
                let offset = Vector::Y * i as f32;
                let mut body = wheel.clone();
                body.id = format!("shaft/{i}");
                body.position = (origin + offset).into();
                let mut j = joint.clone();
                j.id = format!("axis/{i}");
                j.child = body.id.clone();
                j.anchor_parent = offset.into();
                spec.bodies.push(body);
                spec.joints.push(j);
                if i != 0 {
                    spec.transmissions.push(TransmissionSpec {
                        id: format!("gear/{i}"),
                        driver: "axis/0".into(),
                        follower: format!("axis/{i}"),
                        ratio: if i % 2 == 0 { 1.0 } else { -80.0 / 48.0 },
                        phase: 0.0,
                        stiffness: 1000.0,
                        damping: 5.0,
                        max_effort: 20.0,
                    });
                }
            }
            spec.motors[0].joint = "axis/0".into();
            let motor = spec.motors[0].clone();
            let free_speed = 12.0 * motor.velocity_constant / motor.rotor_per_unit;
            let damping = motor.torque_constant * motor.rotor_per_unit.powi(2) * motor.efficiency
                / (motor.resistance * motor.velocity_constant);
            let bearing = 0.0001 * (4.0 + 4.0 * (80.0f32 / 48.0).powi(2));
            let expected_speed = free_speed * damping / (damping + bearing);
            let mut speeds = Vec::new();
            for refinement in [1, 16] {
                let mut w = World::new(spec.clone()).unwrap();
                let powered = Input {
                    volts: BTreeMap::from([("motor".into(), 12.0)]),
                    ..Default::default()
                };
                for _ in 0..400 {
                    w.step_refined(&powered, refinement).unwrap();
                    let speed = w.joint_states["axis/0"].velocity;
                    assert!(
                        speed >= -0.01 && speed <= free_speed * 1.005,
                        "unloaded gear graph overspeed: {speed}, free {free_speed}"
                    );
                }
                let speed = w.joint_states["axis/0"].velocity;
                assert!(
                    (speed - expected_speed).abs() / expected_speed < 0.005,
                    "steady speed {speed} expected {expected_speed}"
                );
                speeds.push(speed);
                let energy = |w: &World| {
                    w.bodies
                        .iter()
                        .map(|(_, b)| b.kinetic_energy())
                        .sum::<f32>()
                        + w.spec
                            .transmissions
                            .iter()
                            .map(|t| 0.5 * t.stiffness * w.transmission_states[&t.id].error.powi(2))
                            .sum::<f32>()
                };
                let initial = energy(&w);
                let coast = Input {
                    coast: vec!["motor".into()],
                    ..Default::default()
                };
                for _ in 0..100 {
                    w.step_refined(&coast, refinement).unwrap();
                    assert!(
                        energy(&w) <= initial * 1.001,
                        "unpowered shaft graph gained energy"
                    );
                }
                assert!(
                    energy(&w) < initial * 0.5,
                    "bearing damping must dissipate energy"
                );
            }
            assert!((speeds[0] - speeds[1]).abs() / expected_speed < 0.002);
        }
    }
    use super::*;
    use serde_json::json;
    fn fixture(kind: &str, ratio: f32) -> WorldSpec {
        serde_json::from_value(json!({"dt":0.002,"gravity":[0,0,0],"bodies":[
   {"id":"base","fixed":true,"position":[0,0,0]},
   {"id":"moving","position":[0,0,0],"mass":2,"colliders":[{"kind":"box","half":[0.1,0.1,0.1]}]}
  ],"joints":[{"id":"joint","parent":"base","child":"moving","kind":kind,"axis":[0,0,1],"anchor_parent":[0,0,0],"anchor_child":[0,0,0],"limits":null}],
  "motors":[{"id":"motor","joint":"joint","rotor_per_unit":ratio,"efficiency":1,"resistance":0.1,"torque_constant":0.02,"velocity_constant":50,"current_limit":100}]})).unwrap()
    }

    #[test]
    fn geared_rotor_matches_joint_and_no_load_speed() {
        let mut w = World::new(fixture("revolute", 20.0)).unwrap();
        w.step(&Input {
            volts: BTreeMap::from([("motor".into(), 6.0)]),
            steps: Some(2000),
            coast: vec![],
        })
        .unwrap();
        let s = w.snapshot();
        assert!(
            (s.joints["joint"].velocity - 15.0).abs() < 0.3,
            "{}",
            s.joints["joint"].velocity
        );
        assert!(
            (s.motors["motor"].rotor_rps * std::f32::consts::TAU
                - s.joints["joint"].velocity * 20.0)
                .abs()
                < 0.001
        );
        assert!(
            s.joints["joint"].position > 20.0,
            "continuous angle must unwrap"
        );
    }
    #[test]
    fn pulley_carriage_moves_linearly_and_hits_stop() {
        let mut spec = fixture("prismatic", 100.0);
        spec.joints[0].limits = Some([0.0, 0.4]);
        let mut w = World::new(spec).unwrap();
        w.step(&Input {
            volts: BTreeMap::from([("motor".into(), 6.0)]),
            steps: Some(1000),
            coast: vec![],
        })
        .unwrap();
        let s = w.snapshot();
        assert!((s.joints["joint"].position - 0.4).abs() < 0.003);
        assert!(s.joints["joint"].velocity.abs() < 0.01);
        assert!(s.motors["motor"].current > 50.0);
        assert!(s.bodies["moving"].position[0].abs() < 1e-5);
    }
    #[test]
    fn reversing_transmission_reverses_mechanism_not_rotor_feedback() {
        let mut w = World::new(fixture("revolute", -20.0)).unwrap();
        w.step(&Input {
            volts: BTreeMap::from([("motor".into(), 6.0)]),
            steps: Some(500),
            coast: vec![],
        })
        .unwrap();
        let s = w.snapshot();
        assert!(s.joints["joint"].velocity < 0.0);
        assert!(s.motors["motor"].rotor_rps > 0.0);
    }
    #[test]
    fn rejects_unknown_actuator_without_advancing_world() {
        let mut w = World::new(fixture("revolute", 20.0)).unwrap();
        assert!(w
            .step(&Input {
                volts: BTreeMap::from([("wrong".into(), 6.0)]),
                steps: None,
                coast: vec![]
            })
            .is_err());
        assert_eq!(w.tick, 0);
    }
    #[test]
    fn turret_can_cross_pi_and_stop_at_220_degrees_in_both_directions() {
        let mut spec = fixture("revolute", 20.0);
        let limit = 220.0f32.to_radians();
        spec.joints[0].limits = Some([-limit, limit]);
        let mut w = World::new(spec).unwrap();
        for sign in [1.0, -1.0] {
            w.step(&Input {
                volts: BTreeMap::from([("motor".into(), sign * 6.0)]),
                steps: Some(2000),
                coast: vec![],
            })
            .unwrap();
            let s = w.snapshot();
            assert!(
                (s.joints["joint"].position - sign * limit).abs() < 0.01,
                "{}",
                s.joints["joint"].position
            );
            assert!(
                s.joints["joint"].velocity.abs() < 0.05,
                "{}",
                serde_json::to_string(&s).unwrap()
            );
        }
    }
    #[test]
    fn cad_bind_pose_can_have_nonzero_encoder_coordinate() {
        let mut spec = fixture("revolute", 70.0);
        spec.joints[0].initial_position = 0.5;
        spec.joints[0].limits = Some([0.1, 0.6]);
        let mut w = World::new(spec).unwrap();
        assert!(
            (w.snapshot().motors["motor"].rotor_turns - 35.0 / std::f32::consts::TAU).abs() < 1e-5
        );
        w.step(&Input {
            volts: BTreeMap::from([("motor".into(), 6.0)]),
            steps: Some(1000),
            coast: vec![],
        })
        .unwrap();
        assert!((w.snapshot().joints["joint"].position - 0.6).abs() < 0.01);
    }
    #[test]
    fn coasting_removes_electrical_brake_after_a_powered_step() {
        let spec = fixture("revolute", 20.0);
        let mut brake = World::new(spec.clone()).unwrap();
        let mut coast = World::new(spec).unwrap();
        let powered = Input {
            volts: BTreeMap::from([("motor".into(), 6.0)]),
            steps: Some(500),
            coast: vec![],
        };
        brake.step(&powered).unwrap();
        coast.step(&powered).unwrap();
        brake
            .step(&Input {
                steps: Some(500),
                ..Default::default()
            })
            .unwrap();
        coast
            .step(&Input {
                steps: Some(500),
                coast: vec!["motor".into()],
                ..Default::default()
            })
            .unwrap();
        assert!(brake.snapshot().joints["joint"].velocity.abs() < 0.1);
        assert!(coast.snapshot().joints["joint"].velocity > 12.0);
        assert_eq!(coast.snapshot().motors["motor"].current, 0.0);
    }

    fn belt_fixture(ratio: f32, follower_kind: &str) -> WorldSpec {
        let mut spec = fixture("revolute", 2.0);
        spec.dt = 0.005;
        let mut follower = spec.bodies[1].clone();
        follower.id = "follower".into();
        follower.position = [0.5, 0.0, 0.0];
        spec.bodies.push(follower);
        let mut joint = spec.joints[0].clone();
        joint.id = "follower-axis".into();
        joint.child = "follower".into();
        joint.anchor_parent = [0.5, 0.0, 0.0];
        joint.kind = follower_kind.into();
        spec.joints.push(joint);
        spec.transmissions.push(TransmissionSpec {
            id: "belt".into(),
            driver: "joint".into(),
            follower: "follower-axis".into(),
            ratio,
            phase: 0.0,
            stiffness: 1000.0,
            damping: 5.0,
            max_effort: 100.0,
        });
        spec
    }
    fn run_voltage(w: &mut World, voltage: f32, steps: u32) -> Snapshot {
        w.step(&Input {
            volts: BTreeMap::from([("motor".into(), voltage)]),
            steps: Some(steps),
            ..Default::default()
        })
        .unwrap();
        w.snapshot()
    }
    #[test]
    fn live_sampling_preserves_state_without_enabling_detailed_traces() {
        let spec = belt_fixture(-2.0, "revolute");
        let mut plain = World::new(spec.clone()).unwrap();
        let mut sampled = World::new(spec).unwrap();
        for tick in 0..60 {
            sampled.sample_performance(tick % 20 == 0);
            let a = run_voltage(&mut plain, 6.0, 1);
            let b = run_voltage(&mut sampled, 6.0, 1);
            assert_eq!(serde_json::to_value(a).unwrap(), serde_json::to_value(b).unwrap());
            assert!(sampled.profile().is_none());
            if tick % 20 == 0 {
                let sample = sampled.performance_sample(1.0);
                assert!(sample.stages[0] > 0.0);
                assert!(sample.counts[0] > 0);
            }
        }
    }

    #[test]
    fn profiling_preserves_coupled_motor_dynamics() {
        let spec = belt_fixture(-2.0, "revolute");
        let mut plain = World::new(spec.clone()).unwrap();
        let mut profiled = World::new(spec).unwrap();
        assert!(plain.profile().is_none());
        profiled.enable_profiling();
        for volts in [6.0, 0.0, -4.0] {
            let a = run_voltage(&mut plain, volts, 100);
            let b = run_voltage(&mut profiled, volts, 100);
            assert_eq!(
                serde_json::to_value(a).unwrap(),
                serde_json::to_value(b).unwrap()
            );
            let report = profiled.profile().unwrap();
            assert_eq!(report["tick"].as_u64(), Some(profiled.tick));
            assert!(report["transmissionTotalMs"].as_f64().unwrap() > 0.0);
            assert!(report["pipelineLastSubstepMs"].as_f64().unwrap() > 0.0);
        }
    }
    #[test]
    fn belt_ratio_reverses_and_unpowered_follower_adds_inertia() {
        let mut single = fixture("revolute", 2.0);
        single.dt = 0.005;
        let mut single = World::new(single).unwrap();
        let free = run_voltage(&mut single, 6.0, 10);
        let mut w = World::new(belt_fixture(-2.0, "revolute")).unwrap();
        let accelerating = run_voltage(&mut w, 6.0, 10);
        assert!(
            accelerating.joints["joint"].velocity < free.joints["joint"].velocity * 0.5,
            "the motor must accelerate the follower inertia too"
        );
        let s = run_voltage(&mut w, 6.0, 500);
        assert!(s.joints["follower-axis"].position < -100.0);
        assert!(
            s.transmissions["belt"].error.abs() < 0.01,
            "{}",
            s.transmissions["belt"].error
        );
        // With split motor/contact integration, instantaneous error during
        // acceleration must stay below one percent of follower speed.
        assert!(
            s.transmissions["belt"].velocity_error.abs()
                < s.joints["follower-axis"].velocity.abs() * 0.01,
            "{}",
            serde_json::to_string(&s).unwrap()
        );
    }
    #[test]
    fn pulley_lifts_load_and_load_backdrives_unpowered_motor() {
        let mut spec = belt_fixture(0.02, "prismatic");
        // A 1 kg, 20 mm radius drum drives a separate 2 kg carriage.
        spec.bodies[1].mass = 1.0;
        spec.bodies[1].principal_inertia = Some([0.0002, 0.0002, 0.0002]);
        spec.gravity = [0.0, 0.0, -9.80665];
        spec.transmissions[0].stiffness = 20000.0;
        spec.transmissions[0].damping = 100.0;
        // 6 V gives 2.4 Nm at the drum, or 120 N at a 20 mm radius.
        spec.transmissions[0].max_effort = 300.0;
        spec.joints[1].limits = Some([-1.0, 0.5]);
        let mut w = World::new(spec).unwrap();
        let lifting = run_voltage(&mut w, 6.0, 600);
        assert!(
            (lifting.joints["follower-axis"].position - 0.5).abs() < 0.004,
            "{}",
            serde_json::to_string(&lifting).unwrap()
        );
        assert!(
            lifting.motors["motor"].current > 50.0,
            "upper stop must stall the motor: {}",
            serde_json::to_string(&lifting).unwrap()
        );
        w.step(&Input {
            steps: Some(80),
            coast: vec!["motor".into()],
            ..Default::default()
        })
        .unwrap();
        let falling = w.snapshot();
        assert!(
            falling.joints["follower-axis"].position < 0.3,
            "gravity must back-drive drum"
        );
        assert!(falling.motors["motor"].rotor_rps < -0.1);
        assert!(falling.transmissions["belt"].error.abs() < 0.005);
    }
    #[test]
    fn jammed_follower_reflects_load_and_force_limit_is_per_step() {
        for max_effort in [100.0, 0.05] {
            let mut spec = belt_fixture(1.0, "revolute");
            spec.joints[1].limits = Some([-0.001, 0.001]);
            spec.transmissions[0].max_effort = max_effort;
            let mut w = World::new(spec).unwrap();
            let s = run_voltage(&mut w, 6.0, 500);
            assert!(s.transmissions["belt"].effort.abs() <= max_effort + 0.0001);
            if max_effort > 1.0 {
                assert!(
                    s.joints["joint"].velocity.abs() < 0.05,
                    "{}",
                    serde_json::to_string(&s).unwrap()
                );
                assert!(s.motors["motor"].current > 50.0);
                assert!(s.transmissions["belt"].error.abs() < 0.02);
            } else {
                assert!(s.transmissions["belt"].saturated);
                assert!(
                    s.joints["joint"].velocity > 10.0,
                    "overloaded coupling must slip"
                );
            }
        }
    }
    #[test]
    fn shared_free_frame_receives_reaction_without_creating_angular_momentum() {
        let mut spec = belt_fixture(2.0, "revolute");
        spec.bodies[0].fixed = false;
        spec.bodies[0].mass = 20.0;
        for b in &mut spec.bodies {
            b.position = [0.0; 3];
            b.colliders.clear();
            b.principal_inertia = Some([0.5, 0.5, 0.5]);
        }
        spec.joints[1].anchor_parent = [0.0; 3];
        let mut w = World::new(spec).unwrap();
        let s = run_voltage(&mut w, 6.0, 400);
        let momentum: f32 = s.bodies.values().map(|b| 0.5 * b.angular_velocity[2]).sum();
        assert!(
            momentum.abs() < 0.002,
            "internal drive created angular momentum: {momentum}"
        );
        assert!(
            s.bodies["base"].angular_velocity[2].abs() > 0.1,
            "{}",
            serde_json::to_string(&s).unwrap()
        );
        assert!(s.transmissions["belt"].error.abs() < 0.02);
    }
    #[test]
    fn high_speed_flywheel_encoder_does_not_reverse_at_half_turn_per_tick() {
        for sign in [-1.0, 1.0] {
            let mut spec = fixture("revolute", 1.0);
            spec.dt = 0.005;
            let mut w = World::new(spec).unwrap();
            run_voltage(&mut w, sign * 16.0, 2500);
            let before = w.snapshot();
            let after = run_voltage(&mut w, sign * 16.0, 1);
            assert!(before.joints["joint"].velocity.abs() * 0.005 > std::f32::consts::PI);
            let delta = after.joints["joint"].position - before.joints["joint"].position;
            assert!(
                (delta - after.joints["joint"].velocity * 0.005).abs() < 0.01,
                "encoder aliased: delta {delta}, velocity {}",
                after.joints["joint"].velocity
            );
            assert!(sign * after.motors["motor"].rotor_turns > 100.0);
        }
    }
    #[test]
    fn shaft_pose_stays_normalized_over_match_duration() {
        let mut spec = fixture("revolute", 1.0);
        spec.dt = 0.005;
        let mut w = World::new(spec).unwrap();
        for _ in 0..4 {
            let state = run_voltage(&mut w, 16.0, 8500);
            let q = state.bodies["moving"].quaternion;
            let norm_squared: f32 = q.iter().map(|v| v * v).sum();
            assert!(
                (norm_squared - 1.0).abs() < 1e-5,
                "shaft pose drifted: {norm_squared}"
            );
        }
    }
    #[test]
    fn passive_belt_cannot_create_energy_after_power_is_removed() {
        let mut w = World::new(belt_fixture(-2.0, "revolute")).unwrap();
        run_voltage(&mut w, 6.0, 100);
        let energy = |w: &World| -> f32 {
            w.bodies
                .iter()
                .filter(|(_, b)| b.is_dynamic())
                .map(|(_, b)| b.kinetic_energy())
                .sum::<f32>()
                + w.spec
                    .transmissions
                    .iter()
                    .map(|t| 0.5 * t.stiffness * w.transmission_states[&t.id].error.powi(2))
                    .sum::<f32>()
        };
        let initial = energy(&w);
        for _ in 0..1000 {
            w.step(&Input {
                coast: vec!["motor".into()],
                ..Default::default()
            })
            .unwrap();
            assert!(
                energy(&w) <= initial * 1.01,
                "passive transmission added energy"
            );
        }
    }
    #[test]
    fn invalid_transmission_bindings_fail_before_simulation() {
        for case in 0..4 {
            let mut spec = belt_fixture(1.0, "revolute");
            match case {
                0 => spec.transmissions[0].follower = "missing".into(),
                1 => spec.transmissions[0].ratio = 0.0,
                2 => spec.transmissions[0].stiffness = f32::INFINITY,
                _ => spec.transmissions.push(spec.transmissions[0].clone()),
            }
            assert!(World::new(spec).is_err());
        }
    }
}
