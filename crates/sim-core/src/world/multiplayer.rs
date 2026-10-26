//! Multiple robot mechanism runtimes over one authoritative rigid-body world.
use super::*;

impl World {
    fn swap_gameplay(&mut self, key: &str) {
        std::mem::swap(self.spec.gameplay.as_mut().unwrap(), self.spec.robot_gameplay.get_mut(key).unwrap());
        std::mem::swap(&mut self.gameplay, self.robot_gameplay.get_mut(key).unwrap());
    }
    pub(super) fn validate_all_gameplay(&mut self) -> Result<()> {
        self.validate_gameplay()?;
        if self.spec.robot_gameplay.is_empty() { return Ok(()); }
        let primary = self.spec.gameplay.as_ref().context("robot_gameplay requires a primary game-piece pool")?;
        let mut carriers = std::collections::HashSet::from([primary.carrier.clone()]);
        for (key, g) in &self.spec.robot_gameplay {
            ensure!(!key.is_empty() && carriers.insert(g.carrier.clone()), "duplicate robot carrier");
            ensure!(g.balls == primary.balls, "robots must share the same game-piece pool");
            ensure!(g.field_conveyors.is_empty(), "field conveyors belong to the shared primary world");
            ensure!(g.robot_compliance == primary.robot_compliance && g.field_compliance == primary.field_compliance,
                "shared game-piece compliance modes must agree");
            self.robot_gameplay.insert(key.clone(), Default::default());
        }
        for key in self.spec.robot_gameplay.keys().cloned().collect::<Vec<_>>() {
            self.swap_gameplay(&key);
            // Validation initializes conveyors; preserve the one shared field runtime.
            let field = std::mem::take(&mut self.field_transport);
            let result = self.validate_gameplay();
            self.field_transport = field;
            self.swap_gameplay(&key);
            result?;
        }
        Ok(())
    }
    pub(super) fn all_gameplay_step(&mut self, input: &Input) {
        self.gameplay_step(input);
        for key in self.spec.robot_gameplay.keys().cloned().collect::<Vec<_>>() {
            self.swap_gameplay(&key);
            self.gameplay_step(input);
            self.swap_gameplay(&key);
        }
    }
    pub(super) fn any_robot_carries(&self, id: &str) -> bool {
        self.gameplay.carried.iter().any(|c| c.id == id)
            || self.robot_gameplay.values().any(|r| r.carried.iter().any(|c| c.id == id))
    }
    pub(super) fn robot_gameplay_status(&self) -> BTreeMap<String, gameplay::Status> {
        self.robot_gameplay.iter().map(|(key, r)| (key.clone(), gameplay::Status {
            mode: "reduced-order-mechanisms", field_transport: self.field_transport_status(),
            captured: r.captured, launched: r.launched, released: r.released,
            carried: r.carried.iter().map(|c| c.id.clone()).collect(),
        })).collect()
    }
}
