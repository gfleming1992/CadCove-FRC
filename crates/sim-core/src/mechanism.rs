//! Team-owned force models. This is trusted compiled Rust, not a sandbox.
//! Hooks observe current state and return world-space forces at the center of mass
//! and torques. They cannot teleport a body through this interface.
use crate::world::{BodyState, Input, WorldSpec};
use anyhow::{ensure, Context, Result};
use rapier3d::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Spec {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub config: serde_json::Value,
}
pub type Factory = fn(&serde_json::Value) -> Result<Box<dyn Mechanism>>;
pub type Registry = BTreeMap<String, Factory>;

pub struct Frame<'a> {
    pub dt: f32,
    pub time: f64,
    pub input: &'a Input,
    bodies: &'a RigidBodySet,
    ids: &'a HashMap<String, RigidBodyHandle>,
}
impl Frame<'_> {
    pub fn body(&self, id: &str) -> Option<BodyState> {
        let b = self.bodies.get(*self.ids.get(id)?)?;
        let q = b.rotation();
        Some(BodyState {
            position: b.translation().into(),
            quaternion: [q.x, q.y, q.z, q.w],
            velocity: b.linvel().into(),
            angular_velocity: b.angvel().into(),
        })
    }
}
/// Forces in newtons, torques in newton-metres, in world coordinates.
/// Emit equal and opposite loads yourself for internal interactions.
pub struct Wrench {
    pub body: String,
    pub force: [f32; 3],
    pub torque: [f32; 3],
}
pub trait Mechanism {
    /// Immutable list of dynamic bodies this model may load.
    fn targets(&self) -> Vec<String>;
    /// Re-evaluated at every native substep. No wall clock, I/O or threads here.
    fn step(&mut self, frame: &Frame<'_>, output: &mut Vec<Wrench>) -> Result<()>;
}
pub(crate) struct Instance {
    id: String,
    targets: HashSet<String>,
    model: Box<dyn Mechanism>,
}
pub(crate) fn instantiate(world: &WorldSpec, registry: &Registry) -> Result<Vec<Instance>> {
    ensure!(world.mechanisms.len() <= 128, "too many custom mechanisms");
    let mut ids = HashSet::new();
    world
        .mechanisms
        .iter()
        .map(|spec| {
            ensure!(
                !spec.id.is_empty() && ids.insert(&spec.id),
                "duplicate/empty mechanism id"
            );
            let factory = registry
                .get(&spec.kind)
                .with_context(|| format!("unsupported mechanism {}: {}", spec.id, spec.kind))?;
            let model = factory(&spec.config)
                .with_context(|| format!("mechanism {} configuration", spec.id))?;
            let targets = model.targets();
            ensure!(
                !targets.is_empty() && targets.len() <= 1024,
                "invalid mechanism target count"
            );
            let mut unique = HashSet::new();
            for id in targets {
                let body = world
                    .bodies
                    .iter()
                    .find(|b| b.id == id)
                    .context("unknown mechanism body")?;
                ensure!(
                    !body.fixed && body.compliance.is_none(),
                    "mechanism targets must be ordinary dynamic rigid bodies"
                );
                ensure!(unique.insert(id), "duplicate mechanism target");
            }
            Ok(Instance {
                id: spec.id.clone(),
                targets: unique,
                model,
            })
        })
        .collect()
}
pub(crate) fn apply(
    models: &mut [Instance],
    bodies: &mut RigidBodySet,
    ids: &HashMap<String, RigidBodyHandle>,
    input: &Input,
    dt: f32,
    time: f64,
) -> Result<()> {
    if models.is_empty() {
        return Ok(());
    }
    let frame = Frame {
        dt,
        time,
        input,
        bodies,
        ids,
    };
    let mut loads = Vec::new();
    let mut output = Vec::new();
    for model in models {
        output.clear();
        model
            .model
            .step(&frame, &mut output)
            .with_context(|| format!("mechanism {} step", model.id))?;
        ensure!(
            loads.len() + output.len() <= 4096,
            "invalid custom mechanism output count"
        );
        for load in &output {
            ensure!(
                model.targets.contains(&load.body),
                "mechanism {} wrote undeclared target",
                model.id
            );
            ensure!(
                load.force
                    .iter()
                    .chain(load.torque.iter())
                    .all(|v| v.is_finite() && v.abs() <= 1.0e6),
                "mechanism {} returned nonfinite/excessive load",
                model.id
            );
        }
        loads.append(&mut output);
    }
    // Validate all outputs before applying any. Impulses integrate F*dt once;
    // they do not persist or accumulate as user forces across substeps.
    for load in loads {
        if load.force == [0.0; 3] && load.torque == [0.0; 3] {
            continue;
        }
        let b = bodies
            .get_mut(ids[&load.body])
            .context("missing mechanism body")?;
        b.apply_impulse(Vector::from(load.force) * dt, true);
        b.apply_torque_impulse(Vector::from(load.torque) * dt, true);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::World;
    struct Push;
    impl Mechanism for Push {
        fn targets(&self) -> Vec<String> {
            vec!["chassis".into()]
        }
        fn step(&mut self, f: &Frame<'_>, out: &mut Vec<Wrench>) -> Result<()> {
            assert!(f.body("chassis").is_some());
            out.push(Wrench {
                body: "chassis".into(),
                force: [2.0, 0.0, 0.0],
                torque: [0.0; 3],
            });
            Ok(())
        }
    }
    fn spec() -> WorldSpec {
        serde_json::from_value(serde_json::json!({
        "dt":0.01,"gravity":[0,0,0],"bodies":[{"id":"chassis","mass":2,"position":[0,0,0],
        "colliders":[{"kind":"ball","radius":0.1}]}],
        "mechanisms":[{"id":"test","kind":"push","config":{}}]}))
        .unwrap()
    }
    fn registry() -> Registry {
        BTreeMap::from([(
            "push".into(),
            (|_| Ok(Box::new(Push) as Box<dyn Mechanism>)) as Factory,
        )])
    }
    #[test]
    fn explicit_registration_required() {
        assert!(World::new(spec()).is_err());
    }
    #[test]
    fn force_is_independent_of_substeps_and_does_not_accumulate() {
        for refinement in [1, 4, 16] {
            let mut w = World::with_mechanisms(spec(), &registry()).unwrap();
            for _ in 0..10 {
                w.step_refined(&Input::default(), refinement).unwrap();
            }
            assert!((w.snapshot().bodies["chassis"].velocity[0] - 0.1).abs() < 1e-4);
        }
    }
    struct Invalid(bool);
    impl Mechanism for Invalid {
        fn targets(&self) -> Vec<String> {
            vec!["chassis".into()]
        }
        fn step(&mut self, _: &Frame<'_>, out: &mut Vec<Wrench>) -> Result<()> {
            out.push(Wrench {
                body: if self.0 {
                    "missing".into()
                } else {
                    "chassis".into()
                },
                force: [if self.0 { 1.0 } else { f32::NAN }, 0.0, 0.0],
                torque: [0.0; 3],
            });
            Ok(())
        }
    }
    #[test]
    fn bad_load_does_not_advance_or_apply_partial_impulses() {
        for invalid in [false, true] {
            let mut registry = registry();
            registry.insert("invalid".into(), |v| {
                Ok(Box::new(Invalid(v.as_bool().unwrap())))
            });
            let mut s = spec();
            s.mechanisms.push(Spec {
                id: "bad".into(),
                kind: "invalid".into(),
                config: invalid.into(),
            });
            let mut w = World::with_mechanisms(s, &registry).unwrap();
            assert!(w.step(&Input::default()).is_err());
            assert_eq!(w.tick, 0);
            assert_eq!(w.snapshot().bodies["chassis"].velocity, [0.0; 3]);
        }
    }
    #[test]
    fn invalid_targets_and_duplicate_ids_rejected() {
        let mut s = spec();
        s.bodies[0].fixed = true;
        assert!(World::with_mechanisms(s, &registry()).is_err());
        let mut s = spec();
        s.mechanisms.push(s.mechanisms[0].clone());
        assert!(World::with_mechanisms(s, &registry()).is_err());
    }
}
