//! Synthetic viscous drag example; values are not a calibrated FRC tire model.
use anyhow::{ensure, Context, Result};
use instantcad_sim::mechanism::{Frame, Mechanism, Registry, Wrench};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Drag {
    body: String,
    /// N per (m/s), world-space translation only.
    damping: f32,
}
impl Mechanism for Drag {
    fn targets(&self) -> Vec<String> {
        vec![self.body.clone()]
    }
    fn step(&mut self, frame: &Frame<'_>, output: &mut Vec<Wrench>) -> Result<()> {
        let state = frame.body(&self.body).context("drag body missing")?;
        output.push(Wrench {
            body: self.body.clone(),
            force: state.velocity.map(|v| -self.damping * v),
            torque: [0.0; 3],
        });
        Ok(())
    }
}
fn main() -> Result<()> {
    let mut registry = Registry::new();
    registry.insert("team.viscous-drag-v1".into(), |config| {
        let model: Drag = serde_json::from_value(config.clone())?;
        ensure!(
            model.damping.is_finite() && (0.0..=10000.0).contains(&model.damping),
            "invalid damping"
        );
        Ok(Box::new(model))
    });
    instantcad_sim::run(registry)
}
