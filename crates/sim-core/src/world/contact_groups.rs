//! Read-only dependency analysis for local contact stepping. This deliberately
//! does not advance islands independently: a scheduler must still revalidate
//! contacts after impulses and synchronize before publishing an outer tick.
use super::*;
use rapier3d::parry::bounding_volume::{Aabb, BoundingVolume};

struct Components(Vec<usize>);
impl Components {
    fn root(&mut self, i: usize) -> usize {
        if self.0[i] != i { self.0[i] = self.root(self.0[i]); }
        self.0[i]
    }
    fn join(&mut self, a: usize, b: usize) {
        let a = self.root(a); let b = self.root(b);
        self.0[a.max(b)] = a.min(b);
    }
}

impl World {
    /// Candidate groups over the next outer tick, including current contacts,
    /// joint/transmission dependencies and swept collider bounds. The sweep
    /// assumes current velocities plus gravity; it is not a safety certificate
    /// for motion produced later by motors, impacts or custom mechanisms.
    pub fn inspect_contact_groups(&self) -> serde_json::Value {
        let dt = self.spec.dt;
        let mut handles: Vec<_> = self.bodies.iter()
            .filter(|(_, b)| b.is_enabled() && b.is_dynamic())
            .map(|(h, _)| h).collect();
        // Names give stable reports independently of arena insertion order.
        handles.sort_by_key(|h| self.names.get(h).cloned().unwrap_or_else(|| format!("{h:?}")));
        let slots: HashMap<_, _> = handles.iter().enumerate().map(|(i,h)| (*h,i)).collect();
        let mut components = Components((0..handles.len()).collect());
        let mut edges = BTreeMap::<(usize,usize), std::collections::BTreeSet<&str>>::new();
        let mut join = |a: RigidBodyHandle, b: RigidBodyHandle, reason: &'static str| {
            if let (Some(&a), Some(&b)) = (slots.get(&a), slots.get(&b)) {
                if a != b {
                    components.join(a,b);
                    edges.entry((a.min(b),a.max(b))).or_default().insert(reason);
                }
            }
        };
        for j in &self.spec.joints {
            join(self.body_ids[&j.parent], self.body_ids[&j.child], "joint");
        }
        let joints: HashMap<_,_> = self.spec.joints.iter().map(|j| (&j.id,j)).collect();
        // A belt may connect shafts whose individual joints both terminate on
        // fixed supports. Those supports must not hide the dynamic coupling.
        for t in &self.spec.transmissions {
            let a = joints[&t.driver]; let b = joints[&t.follower];
            for x in [&a.parent,&a.child] { for y in [&b.parent,&b.child] {
                join(self.body_ids[x],self.body_ids[y],"transmission");
            }}
        }
        for (_,soft) in self.soft_bodies.iter() {
            let root = soft.root_body();
            for (_,cluster) in soft.live_clusters() { join(root,cluster.proxy(),"soft_body"); }
            for attachment in soft.particle_attachments() { join(root,attachment.body,"soft_attachment"); }
        }
        for p in self.narrow.contact_pairs().filter(|p| p.has_any_active_contact()) {
            if let (Some(a),Some(b)) = (self.colliders.get(p.collider1),self.colliders.get(p.collider2)) {
                if let (Some(a),Some(b)) = (a.parent(),b.parent()) { join(a,b,"contact"); }
            }
        }
        // Sweep collider bounds, not robot origins. Use a rotation-invariant
        // radius about the body's origin whenever angular motion is present;
        // endpoint AABBs alone miss the middle of a rotating long mechanism.
        let mut swept = Vec::new();
        for (_,c) in self.colliders.iter().filter(|(_,c)| c.is_enabled() && !c.is_sensor()) {
            let Some(h) = c.parent() else { continue };
            if !slots.contains_key(&h) { continue; }
            let b = &self.bodies[h];
            let start = c.compute_aabb();
            let drift = b.linvel() * dt;
            let gravity_pad = Vector::from(self.spec.gravity).abs() * dt * dt;
            let mut bounds = if b.angvel().length_squared() > 0.0 {
                let origin = b.position().translation;
                let radius = (start.mins-origin).abs().max((start.maxs-origin).abs()).length();
                Aabb::new(origin-Vector::splat(radius),origin+Vector::splat(radius))
            } else { start };
            bounds.mins += drift.min(Vector::ZERO) - gravity_pad;
            bounds.maxs += drift.max(Vector::ZERO) + gravity_pad;
            bounds.loosen(self.spec.contact_tolerance);
            swept.push((h,bounds,c.collision_groups()));
        }
        // Sweep-and-prune avoids a full all-pairs walk for sparse fields. This
        // runs only on inspection, never in the measured live tick path.
        swept.sort_by(|a,b| a.1.mins.x.total_cmp(&b.1.mins.x));
        for i in 0..swept.len() {
            let (a,aa,ag) = &swept[i];
            for (b,bb,bg) in &swept[i+1..] {
                if bb.mins.x > aa.maxs.x { break; }
                if a != b && ag.test(*bg) && aa.intersects(bb) { join(*a,*b,"swept_bounds"); }
            }
        }
        drop(join);
        let name = |h: &RigidBodyHandle| self.names.get(h).cloned().unwrap_or_else(|| format!("{h:?}"));
        let mut groups = BTreeMap::<usize, Vec<String>>::new();
        for (i,h) in handles.iter().enumerate() { groups.entry(components.root(i)).or_default().push(name(h)); }
        serde_json::json!({
            "tick":self.tick, "horizonSeconds":dt, "execution":"inspection_only",
            "motionAssumption":"current velocity plus gravity; future impulses and motor acceleration require revalidation",
            "groups":groups.values().collect::<Vec<_>>(),
            "dynamicBodies":handles.len(),
            "largestGroup":groups.values().map(Vec::len).max().unwrap_or(0),
            "dependencies":edges.into_iter().map(|((a,b),reasons)| serde_json::json!({
                "bodies":[name(&handles[a]),name(&handles[b])],"reasons":reasons
            })).collect::<Vec<_>>()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn world(bodies: serde_json::Value) -> World {
        World::new(serde_json::from_value(json!({"dt":0.02,"gravity":[0,0,0],"bodies":bodies})).unwrap()).unwrap()
    }
    fn sphere(id: &str,x: f32,v: f32) -> serde_json::Value {
        json!({"id":id,"position":[x,0,0],"velocity":[v,0,0],"colliders":[{"kind":"ball","radius":0.1}]})
    }
    #[test]
    fn approaching_bodies_merge_before_contact_and_inspection_does_not_mutate() {
        let w = world(json!([sphere("a",0.0,10.0),sphere("b",0.5,-10.0),sphere("c",3.0,0.0)]));
        let before = serde_json::to_value(w.snapshot()).unwrap();
        let p = w.inspect_contact_groups();
        assert_eq!(p["groups"],json!([["a","b"],["c"]]));
        assert_eq!(p["dependencies"][0]["reasons"],json!(["swept_bounds"]));
        assert_eq!(serde_json::to_value(w.snapshot()).unwrap(),before);
    }
    #[test]
    fn shared_floor_does_not_merge_separated_robots() {
        let mut w = world(json!([sphere("a",0.0,0.0),sphere("b",2.0,0.0),
            {"id":"floor","fixed":true,"position":[0,0,-0.19],"colliders":[{"kind":"box","half":[10,10,0.1]}]}]));
        w.step(&Input::default()).unwrap();
        assert_eq!(w.inspect_contact_groups()["groups"],json!([["a"],["b"]]));
    }
    #[test]
    fn collision_filters_do_not_create_dependencies() {
        let mut a = sphere("a",0.0,0.0); a["membership"] = json!(1); a["filter"] = json!(1);
        let mut b = sphere("b",0.05,0.0); b["membership"] = json!(2); b["filter"] = json!(2);
        let w = world(json!([a,b]));
        assert_eq!(w.inspect_contact_groups()["groups"],json!([["a"],["b"]]));
    }
    #[test]
    fn rotating_arm_sweep_covers_intermediate_orientation() {
        let w = world(json!([
            {"id":"arm","position":[0,0,0],"angular_velocity":[0,0,157.08],
             "colliders":[{"kind":"box","half":[1.0,0.02,0.02]}]},
            {"id":"ball","position":[0,0.9,0],"colliders":[{"kind":"ball","radius":0.05}]}]));
        assert_eq!(w.inspect_contact_groups()["groups"],json!([["arm","ball"]]));
    }
    #[test]
    fn joint_chain_stays_together_without_contacts() {
        let w = World::new(serde_json::from_value(json!({"bodies":[
            {"id":"chassis","position":[0,0,0]},
            {"id":"arm","position":[1,0,0]},
            {"id":"roller","position":[2,0,0]},
            {"id":"other","position":[4,0,0]}],"joints":[
            {"id":"pivot","parent":"chassis","child":"arm","kind":"revolute","axis":[0,1,0],"anchor_parent":[1,0,0],"anchor_child":[0,0,0]},
            {"id":"shaft","parent":"arm","child":"roller","kind":"revolute","axis":[0,1,0],"anchor_parent":[1,0,0],"anchor_child":[0,0,0]}]
        })).unwrap()).unwrap();
        assert_eq!(w.inspect_contact_groups()["groups"],json!([["arm","chassis","roller"],["other"]]));
    }
    #[test]
    fn transmissions_couple_shafts_across_fixed_supports() {
        let spec = serde_json::from_value(json!({"dt":0.02,"bodies":[
            {"id":"base","fixed":true,"position":[0,0,0]},
            {"id":"moving","position":[0,0,0]},
            {"id":"follower","position":[2,0,0]}],
            "joints":[
                {"id":"a","parent":"base","child":"moving","kind":"revolute","axis":[0,1,0],"anchor_parent":[0,0,0],"anchor_child":[0,0,0]},
                {"id":"b","parent":"base","child":"follower","kind":"revolute","axis":[0,1,0],"anchor_parent":[2,0,0],"anchor_child":[0,0,0]}],
            "transmissions":[{"id":"belt","driver":"a","follower":"b","ratio":1,"stiffness":1000,"damping":5,"max_effort":10}]
        })).unwrap();
        let w = World::new(spec).unwrap();
        assert_eq!(w.inspect_contact_groups()["groups"],json!([["follower","moving"]]));
        assert!(w.inspect_contact_groups()["dependencies"][0]["reasons"].as_array().unwrap().contains(&json!("transmission")));
    }
}
