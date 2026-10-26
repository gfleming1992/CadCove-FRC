//! Experimental, collision-free assembly placement using Rapier constraints.
//! Uses numerical unit masses/inertias, not authored physical properties. The
//! relaxation clock is NOT the requested animation clock. Callers must validate
//! every returned pose against the original mates before allowing playback.
use anyhow::{ensure, Context, Result};
use rapier3d::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Instant;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Body {
    pose: [f32; 7],
    fixed: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Mate {
    a: usize,
    b: usize,
    kind: String,
    frame_a: [f32; 7],
    frame_b: [f32; 7],
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Sample {
    time: f64,
    targets: Vec<Option<f32>>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    bodies: Vec<Body>,
    mates: Vec<Mate>,
    samples: Vec<Sample>,
    #[serde(default)]
    relax: bool,
}

fn pose(v: &[f32; 7]) -> Result<Pose> {
    ensure!(v.iter().all(|n| n.is_finite()), "Nonfinite mate pose");
    let q = Rotation::from_xyzw(v[3], v[4], v[5], v[6]);
    ensure!(
        (q.length_squared() - 1.0).abs() < 1e-5,
        "Invalid mate quaternion"
    );
    Ok(Pose::from_parts(
        Vector::new(v[0], v[1], v[2]),
        q.normalize(),
    ))
}
fn free(kind: &str) -> Result<JointAxesMask> {
    Ok(match kind {
        "fixed" => JointAxesMask::empty(),
        "revolute" => JointAxesMask::ANG_Z,
        "slider" => JointAxesMask::LIN_Z,
        _ => anyhow::bail!("Unsupported mate type"),
    })
}

pub fn solve(value: Value) -> Result<Value> {
    let r: Request = serde_json::from_value(value)?;
    ensure!(
        !r.bodies.is_empty()
            && r.bodies.len() <= 512
            && !r.mates.is_empty()
            && r.mates.len() <= 2048,
        "Invalid mate solve size"
    );
    ensure!(
        !r.samples.is_empty()
            && r.samples.len() <= 10001
            && r.samples.len() * r.bodies.len() <= 100000,
        "Invalid mate sample budget"
    );
    ensure!(r.samples[0].time == 0.0, "Mate timeline must start at zero");
    ensure!(r.bodies.iter().any(|b| b.fixed), "Ground body required");
    let started = Instant::now();
    let mut bodies = RigidBodySet::new();
    let handles = r
        .bodies
        .iter()
        .map(|b| -> Result<_> {
            let builder = if b.fixed {
                RigidBodyBuilder::fixed()
            } else {
                RigidBodyBuilder::dynamic()
            };
            Ok(bodies.insert(
                builder
                    .pose(pose(&b.pose)?)
                    .can_sleep(false)
                    .additional_mass_properties(MassProperties::new(
                        Vector::ZERO,
                        1.0,
                        Vector::splat(10000.0),
                    ))
                    .build(),
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    let mut joints = ImpulseJointSet::new();
    let mut mate_frames = Vec::new();
    let mut joint_handles = Vec::new();
    for m in &r.mates {
        ensure!(
            m.a < handles.len() && m.b < handles.len() && m.a != m.b,
            "Invalid mate bodies"
        );
        let a = pose(&m.frame_a)?;
        let b = pose(&m.frame_b)?;
        let locked = JointAxesMask::LOCKED_FIXED_AXES & !free(&m.kind)?;
        joint_handles.push(
            joints.insert(
                handles[m.a],
                handles[m.b],
                GenericJointBuilder::new(locked)
                    .local_frame1(a)
                    .local_frame2(b)
                    .contacts_enabled(false),
                true,
            ),
        );
        mate_frames.push((a, b));
    }
    let mut pipeline = PhysicsPipeline::new();
    let mut islands = IslandManager::new();
    let mut broad = BroadPhaseBvh::new();
    let mut narrow = NarrowPhase::new();
    let mut colliders = ColliderSet::new();
    let mut multibody = MultibodyJointSet::new();
    // Fully prescribed forests need no relaxation. Let Rapier's own multibody
    // forward kinematics propagate the frames instead of integrating artificial
    // forces. Closed loops and passive coordinates retain the constraint path.
    let mut reached = r.bodies.iter().map(|b| b.fixed).collect::<Vec<_>>();
    let mut order = Vec::new();
    let prescribed = r.samples.iter().all(|s| {
        s.targets.len() == r.mates.len()
            && r.mates
                .iter()
                .enumerate()
                .all(|(i, m)| m.kind == "fixed" || s.targets[i].is_some())
    });
    if prescribed {
        let mut pending = (0..r.mates.len()).collect::<Vec<_>>();
        while !pending.is_empty() {
            let Some(at) = pending.iter().position(|i| reached[r.mates[*i].a]) else {
                break;
            };
            let i = pending.remove(at);
            let m = &r.mates[i];
            if reached[m.b] {
                break;
            }
            reached[m.b] = true;
            order.push(i);
        }
    }
    let tree = !r.relax && prescribed && order.len() == r.mates.len() && reached.iter().all(|b| *b);
    let mut kinematic_handles = vec![None; r.mates.len()];
    if tree {
        for &i in &order {
            let m = &r.mates[i];
            kinematic_handles[i] = Some(
                multibody
                    .insert_kinematic(
                        handles[m.a],
                        handles[m.b],
                        GenericJointBuilder::new(JointAxesMask::LOCKED_FIXED_AXES)
                            .local_frame1(mate_frames[i].0)
                            .local_frame2(mate_frames[i].1),
                        true,
                    )
                    .context("Cannot construct prescribed multibody")?,
            );
        }
    }
    let mut soft = SoftBodySet::new();
    let mut ccd = CCDSolver::new();
    let params = IntegrationParameters {
        dt: 1.0 / 120.0,
        length_unit: 1000.0,
        num_solver_iterations: 16,
        num_internal_stabilization_iterations: 4,
        ..Default::default()
    };
    let mut frames = Vec::new();
    let mut iterations = 0;
    let mut max_position = 0.0_f32;
    let mut max_rotation = 0.0_f32;
    let mut previous = -1.0;
    for sample in r.samples {
        ensure!(
            sample.time.is_finite()
                && sample.time > previous
                && sample.time <= 300.0
                && sample.targets.len() == r.mates.len(),
            "Invalid sample"
        );
        previous = sample.time;
        for (i, target) in sample.targets.iter().enumerate() {
            if let Some(q) = target {
                ensure!(
                    q.is_finite() && r.mates[i].kind != "fixed",
                    "Invalid drive target"
                );
                let delta = if r.mates[i].kind == "revolute" {
                    Pose::rotation(Vector::Z * *q)
                } else {
                    Pose::translation(0.0, 0.0, *q)
                };
                let j = &mut joints
                    .get_mut(joint_handles[i], true)
                    .context("Missing mate")?
                    .data;
                j.locked_axes = JointAxesMask::LOCKED_FIXED_AXES;
                j.local_frame1 = mate_frames[i].0 * delta;
                if let Some(h) = kinematic_handles[i] {
                    let (mb, link) = multibody.get_mut(h).context("Missing prescribed mate")?;
                    mb.link_mut(link)
                        .context("Missing prescribed link")?
                        .joint
                        .data
                        .local_frame1 = j.local_frame1;
                }
            }
        }
        let mut residual = (f32::INFINITY, f32::INFINITY);
        for _ in 0..if tree {
            1
        } else if prescribed && order.len() == r.mates.len() {
            32
        } else {
            512
        } {
            ensure!(
                started.elapsed().as_secs() < 50,
                "Rapier mate solve exceeded time budget"
            );
            for h in &handles {
                let b = &mut bodies[*h];
                b.set_linvel(Vector::ZERO, true);
                b.set_angvel(Vector::ZERO, true);
            }
            if tree {
                let mut roots = Vec::new();
                for (_, link, _, _) in multibody.iter() {
                    if !roots.contains(&link.multibody) {
                        roots.push(link.multibody);
                    }
                }
                for root in roots {
                    let mb = multibody
                        .get_multibody_mut(root)
                        .context("Missing multibody")?;
                    mb.forward_kinematics(&bodies, true);
                    mb.update_rigid_bodies(&mut bodies, true);
                }
            } else {
                pipeline.step(
                    Vector::ZERO,
                    &params,
                    &mut islands,
                    &mut broad,
                    &mut narrow,
                    &mut bodies,
                    &mut colliders,
                    &mut joints,
                    &mut multibody,
                    &mut soft,
                    &mut ccd,
                    &(),
                    &(),
                );
            }
            iterations += 1;
            residual = (0.0_f32, 0.0_f32);
            for (i, m) in r.mates.iter().enumerate() {
                let j = &joints.get(joint_handles[i]).context("Missing mate")?.data;
                let rel = (bodies[handles[m.a]].position() * j.local_frame1).inverse()
                    * (bodies[handles[m.b]].position() * j.local_frame2);
                let mut p = rel.translation;
                // q and -q are the same rotation. Use the short rotation when
                // testing convergence, including trajectories crossing pi.
                let rotation = if rel.rotation.w < 0.0 {
                    -rel.rotation
                } else {
                    rel.rotation
                };
                let mut a = rotation.to_scaled_axis();
                if sample.targets[i].is_none() {
                    if m.kind == "slider" {
                        p.z = 0.0;
                    }
                    if m.kind == "revolute" {
                        // compare axes, allowing arbitrary spin
                        a = rel.rotation * Vector::Z - Vector::Z;
                    }
                }
                residual.0 = residual.0.max(p.abs().max_element());
                residual.1 = residual.1.max(a.abs().max_element());
            }
            // Leave margin for the independently checked f64 frame products,
            // but do not chase precision below Rapier's f32 noise floor.
            if residual.0 < 3e-5 && residual.1 < 2e-6 {
                break;
            }
        }
        max_position = max_position.max(residual.0);
        max_rotation = max_rotation.max(residual.1);
        let poses = handles
            .iter()
            .map(|h| {
                let p = bodies[*h].position();
                // Convert normalized quaternion to f64 matrix to avoid exporting a
                // nonorthonormal matrix from f32 rounding. No position correction.
                let q = p.rotation.normalize();
                let [x, y, z, w] = q.to_array().map(f64::from);
                let n = (x * x + y * y + z * z + w * w).sqrt();
                let (x, y, z, w) = (x / n, y / n, z / n, w / n);
                vec![
                    1. - 2. * (y * y + z * z),
                    2. * (x * y + z * w),
                    2. * (x * z - y * w),
                    0.,
                    2. * (x * y - z * w),
                    1. - 2. * (x * x + z * z),
                    2. * (y * z + x * w),
                    0.,
                    2. * (x * z + y * w),
                    2. * (y * z - x * w),
                    1. - 2. * (x * x + y * y),
                    0.,
                    p.translation.x as f64,
                    p.translation.y as f64,
                    p.translation.z as f64,
                    1.,
                ]
            })
            .collect::<Vec<_>>();
        frames.push(json!({"time":sample.time,"poses":poses}));
    }
    Ok(
        json!({"ok":true,"frames":frames,"diagnostics":{"nativeSolveMs":started.elapsed().as_secs_f64()*1000.,
        "relaxationSteps":iterations,"maxPositionResidualMm":max_position,"maxRotationResidualRad":max_rotation,
        "mode":if tree {"Rapier multibody forward kinematics"} else {"Rapier impulse-joint relaxation"},"physicalDynamics":false}}),
    )
}
