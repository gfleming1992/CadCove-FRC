use super::*;
use rapier3d::parry::query::{Ray, RayCast};

#[derive(Deserialize)]
pub struct SightSegment {
    pub from: [f32; 3],
    pub to: [f32; 3],
}

#[derive(Serialize)]
pub struct SightHit {
    pub body: Option<String>,
    pub collider_index: Option<usize>,
    pub distance: f32,
    pub point: [f32; 3],
}

impl World {
    /// Read-only optical obstruction query against current physical geometry.
    /// Collision masks do not determine visibility. Disabled rigid templates
    /// are skipped; active deformed surface colliders participate normally.
    pub fn sight_segments(&self, segments: &[SightSegment]) -> Result<Vec<Option<SightHit>>> {
        ensure!(segments.len() <= 512, "too many sight segments");
        for s in segments {
            let delta = Vector::from(s.to) - Vector::from(s.from);
            ensure!(s.from.iter().chain(s.to.iter()).all(|v| v.is_finite())
                && delta.length().is_finite() && delta.length() > 1e-6
                && delta.length() <= 100.0, "invalid sight segment");
        }
        // This deliberate linear top-level scan uses fresh AABBs, including
        // newly inserted/deformed proxies and the pre-step world. It never
        // advances physics to populate a broad-phase cache. Each CAD mesh
        // retains its own acceleration structure for the exact ray test.
        let candidates: Vec<_> = self.colliders.iter().filter(|(_, c)| {
            c.is_enabled() && !c.is_sensor()
                && c.parent().map(|p| self.bodies[p].is_enabled()).unwrap_or(true)
        }).map(|(_, c)| (c, c.compute_aabb())).collect();
        Ok(segments.iter().map(|s| {
            let origin = Vector::from(s.from);
            let delta = Vector::from(s.to) - origin;
            let mut nearest = delta.length();
            let ray = Ray::new(origin, delta / nearest);
            let mut result = None;
            for (c, aabb) in &candidates {
                if aabb.cast_local_ray(&ray, nearest, true).is_none() { continue; }
                if let Some(distance) = c.shape().cast_ray(c.position(), &ray, nearest, true) {
                    let name = c.parent().and_then(|p| self.names.get(&p));
                    result = Some(SightHit {
                        body: name.cloned(),
                        collider_index: name.map(|_| c.user_data as usize),
                        distance,
                        point: (origin + ray.dir * distance).into(),
                    });
                    nearest = distance;
                }
            }
            result
        }).collect())
    }
}
