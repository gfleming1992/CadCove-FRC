use crate::world::{BodyState, Snapshot};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn same_body(a: &BodyState, b: &BodyState) -> bool {
    a.position
        .iter()
        .chain(&a.quaternion)
        .chain(&a.velocity)
        .chain(&a.angular_velocity)
        .zip(
            b.position
                .iter()
                .chain(&b.quaternion)
                .chain(&b.velocity)
                .chain(&b.angular_velocity),
        )
        .all(|(x, y)| x.to_bits() == y.to_bits())
}

/// Transport-only cache. Every omitted body/contact list is exactly unchanged;
/// there is no tolerance, decimation or simulation-state mutation.
pub fn reply(next: Snapshot, previous: &mut Option<Snapshot>, delta: bool) -> Value {
    let result = if let Some(old) = previous.as_ref().filter(|_| delta) {
        let changed: BTreeMap<_, _> = next
            .bodies
            .iter()
            .filter(|(id, body)| {
                !old.bodies
                    .get(*id)
                    .is_some_and(|before| same_body(before, body))
            })
            .collect();
        let removed: Vec<_> = old
            .bodies
            .keys()
            .filter(|id| !next.bodies.contains_key(*id))
            .collect();
        let mut state = json!({"tick":next.tick,"time":next.time,"physics_substeps":next.physics_substeps,
            "bodies":changed,"joints":next.joints,"motors":next.motors,
            "transmissions":next.transmissions,"compliance":next.compliance,"manipulation":next.manipulation});
        if !next.robot_gameplay.is_empty() { state["robot_gameplay"] = json!(next.robot_gameplay); }
        if let Some(status) = &next.gameplay { state["gameplay"] = json!(status); }
        if old.contacts != next.contacts {
            state["contacts"] = json!(next.contacts);
        }
        json!({"ok":true,"stateDelta":{"baseTick":old.tick,"removedBodies":removed,"state":state}})
    } else {
        json!({"ok":true,"state":next})
    };
    *previous = Some(next);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::World;
    #[test]
    fn transport_preserves_signed_zero_and_removals() {
        let world = World::new(
            serde_json::from_value(json!({
                "dt":0.005,"gravity":[0,0,0],"bodies":[{"id":"a","fixed":true,"position":[0,0,0]}],
                "joints":[],"motors":[]
            }))
            .unwrap(),
        )
        .unwrap();
        let mut previous = None;
        assert!(reply(world.snapshot(), &mut previous, true)
            .get("state")
            .is_some());
        let same = reply(world.snapshot(), &mut previous, true);
        assert_eq!(same["stateDelta"]["state"]["bodies"], json!({}));
        assert!(same["stateDelta"]["state"].get("contacts").is_none());
        let mut changed = world.snapshot();
        changed.tick = 1;
        changed.bodies.get_mut("a").unwrap().position[0] = -0.0;
        let delta = reply(changed, &mut previous, true);
        assert!(delta["stateDelta"]["state"]["bodies"].get("a").is_some());
        let mut removed = world.snapshot();
        removed.tick = 2;
        removed.bodies.clear();
        let delta = reply(removed, &mut previous, true);
        assert_eq!(delta["stateDelta"]["baseTick"], 1);
        assert_eq!(delta["stateDelta"]["removedBodies"], json!(["a"]));
        assert!(reply(world.snapshot(), &mut previous, false)
            .get("state")
            .is_some());
    }
}
