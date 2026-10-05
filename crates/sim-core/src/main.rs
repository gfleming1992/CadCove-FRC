mod mesh;
mod performance;
mod state_delta;
mod transmission;
mod world;
use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use world::{Input, World, WorldSpec};
fn main() -> Result<()> {
    let mut world: Option<World> = None;
    let live_logging = std::env::var("CADCOVE_PHYSICS_LOG").as_deref() != Ok("0");
    let mut performance = performance::LivePerformance::new(live_logging);
    let mut latest_performance = Value::Null;
    let mut previous_snapshot = None;
    let mut inspection_meshes = mesh::MeshCache::default();
    let mut out = io::BufWriter::new(io::stdout().lock());
    for line in io::stdin().lock().lines() {
        let line = line?;
        if line.len() > 128 * 1024 * 1024 {
            anyhow::bail!("command exceeds limit");
        }
        let result = (|| -> Result<Value> {
            let v: Value = serde_json::from_str(&line)?;
            match v["op"].as_str().context("missing op")? {
                "capabilities" => Ok(json!({"ok":true,"features":["gameplay-mechanisms-v1","practice-field-conveyors-v1","practice-cargo-contacts-v1"]})),
                "load" => {
                    #[cfg(feature = "composite-audit")]
                    mesh::dispatcher::reverse_audit::reset();
                    let spec: WorldSpec = serde_json::from_value(v["world"].clone())?;
                    world = Some(World::new(spec)?);
                    performance = performance::LivePerformance::new(live_logging);
                    latest_performance = Value::Null;
                    if std::env::var("INSTANTCAD_PROFILE").as_deref() == Ok("1") {
                        world.as_mut().unwrap().enable_profiling();
                    }
                    Ok(state_delta::reply(world.as_ref().unwrap().snapshot(), &mut previous_snapshot, false))
                }
                "step" => {
                    let delta = v.get("state_delta").map(|v|v.as_bool().context("state_delta must be boolean")).transpose()?.unwrap_or(false);
                    let refinement = v
                        .get("minimum_substeps")
                        .map(|v| {
                            v.as_u64()
                                .filter(|n| (1..=64).contains(n))
                                .context("minimum_substeps must be an integer from 1 to 64")
                        })
                        .transpose()?;
                    let input: Input = serde_json::from_value(v)?;
                    let w = world.as_mut().context("load world first")?;
                    let sampled = performance.sample_next();
                    w.sample_performance(sampled);
                    let previous_tick = w.tick;
                    let started = std::time::Instant::now();
                    if let Some(n) = refinement {
                        w.step_refined(&input, n as usize)?;
                    } else {
                        w.step(&input)?;
                    }
                    let physics_ms = started.elapsed().as_secs_f64() * 1000.0;
                    let snapshot_started = std::time::Instant::now();
                    let mut result = state_delta::reply(w.snapshot(), &mut previous_snapshot, delta);
                    let snapshot_ms = snapshot_started.elapsed().as_secs_f64() * 1000.0;
                    if let Some(report) = performance.record(w.tick, w.tick - previous_tick, w.spec.dt as f64 * 1000.0, physics_ms, snapshot_ms, sampled.then(|| w.performance_sample(physics_ms))) {
                        // stderr is inherited by the bridge into the session robot log.
                        // Failure to write diagnostics must never stop the physics protocol.
                        let _ = writeln!(io::stderr().lock(), "{report}");
                        latest_performance = report.clone();
                        result["performance"] = report;
                    }
                    result["physicsMs"] = json!(physics_ms);
                    if let Some(profile) = w.profile() {
                        result["profile"] = profile;
                    }
                    Ok(result)
                }
                "performance" => Ok(json!({"ok":true,"performance":latest_performance})),
                "contacts" => Ok(
                    json!({"ok":true,"contacts":world.as_ref().context("load world first")?
                    .inspect_contacts(v["body"].as_str().context("missing body")?,v["details"].as_bool().unwrap_or(false))?}),
                ),
                #[cfg(feature = "composite-audit")]
                "collision_audit" => Ok(json!({"ok":true,"audit":mesh::dispatcher::reverse_audit::report()})),
                "collision_geometry" => Ok(json!({"ok":true,"geometry":world.as_ref()
                    .context("load world first")?.inspect_collision_geometry(
                        v["body"].as_str().context("missing body")?,
                        v["collider_index"].as_u64().context("missing collider index")? as usize)?})),
                "particles" => Ok(
                    json!({"ok":true,"points":world.as_ref().context("load world first")?
                    .inspect_particles(v["body"].as_str().context("missing body")?)?}),
                ),
                "compliance" => Ok(json!({"ok":true,"compliance":world.as_ref()
                    .context("load world first")?.inspect_compliance()})),
                "sight_segments" => {
                    let w = world.as_ref().context("load world first")?;
                    let segments = serde_json::from_value::<Vec<world::SightSegment>>(v["segments"].clone())?;
                    Ok(json!({"ok":true,"tick":w.tick,"hits":w.sight_segments(&segments)?}))
                },
                "mesh_surface" => Ok(json!({"ok":true,"projections":inspection_meshes.surface(
                    v["file"].as_str().context("missing file")?,
                    v["sha256"].as_str().context("missing sha256")?,
                    serde_json::from_value(v["cooking"].clone())?,
                    &serde_json::from_value::<Vec<[f32; 3]>>(v["points"].clone())?)?})),
                "collider" => Ok(
                    json!({"ok":true,"collider":world.as_ref().context("load world first")?
                    .inspect_collider(v["body"].as_str().context("missing body")?,v["collider_index"].as_u64().context("missing collider index")? as usize,
                    serde_json::from_value(v["center"].clone())?,v["radius"].as_f64().context("missing radius")? as f32)?}),
                ),
                "state" => Ok(
                    state_delta::reply(world.as_ref().context("load world first")?.snapshot(), &mut previous_snapshot, false),
                ),
                _ => anyhow::bail!("unknown operation"),
            }
        })();
        let response = result.unwrap_or_else(|e| json!({"ok":false,"error":format!("{e:#}")}));
        serde_json::to_writer(&mut out, &response)?;
        writeln!(out)?;
        out.flush()?;
    }
    Ok(())
}
