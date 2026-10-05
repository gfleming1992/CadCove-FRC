use anyhow::{ensure, Context, Result};
use rapier3d::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Component, Path},
};
mod planar;
mod cuboid;
pub mod dispatcher;

/// Immutable CTM1 collider artifacts: header, metre positions, triangle indices.
/// A prototype's BVH/hull is cooked once and shared by all placed occurrences.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Cooking {
    TriMesh,
    /// Validated six-face rectangular solid, within 1 micrometre of its mesh.
    Cuboid,
    /// Use a validated box where possible, otherwise preserve the triangle mesh.
    CuboidOrMesh,
    ConvexHull,
    ConvexDecomposition,
    /// Opt-in exact cap partition; not selected by the robot's current bindings.
    PlanarExtrusion,
}

#[derive(Default)]
pub struct MeshCache(HashMap<(String, Cooking), SharedShape>);
impl MeshCache {
    /// Diagnostic only: query the surface without constructing or stepping a world.
    pub fn surface(
        &mut self,
        file: &str,
        digest: &str,
        cooking: Cooking,
        points: &[[f32; 3]],
    ) -> Result<Vec<SurfaceProjection>> {
        ensure!(points.len() <= 4096, "too many surface probes");
        ensure!(
            points.iter().flatten().all(|v| v.is_finite()),
            "nonfinite probe"
        );
        let shape = self.load(file, digest, cooking)?;
        Ok(points
            .iter()
            .map(|p| {
                let p = Vector::from(*p);
                let projection = shape.project_local_point(p, false);
                SurfaceProjection {
                    point: projection.point.into(),
                    distance: (projection.point - p).length(),
                    // For a triangle mesh this is not a watertight-solid membership test.
                    is_inside: projection.is_inside,
                }
            })
            .collect())
    }
    pub fn load(&mut self, file: &str, digest: &str, cooking: Cooking) -> Result<SharedShape> {
        let key = (digest.to_owned(), cooking);
        ensure!(
            digest.len() == 64 && digest.bytes().all(|c| c.is_ascii_hexdigit()),
            "invalid collider digest"
        );
        let relative = Path::new(file);
        ensure!(
            !relative.is_absolute()
                && relative
                    .components()
                    .all(|c| matches!(c, Component::Normal(_))),
            "collider path must be relative without traversal"
        );
        let root = std::env::current_dir()?.canonicalize()?;
        let target = root
            .join(relative)
            .canonicalize()
            .context("collider artifact missing")?;
        ensure!(target.starts_with(&root), "collider outside project");
        if let Some(s) = self.0.get(&key) {
            return Ok(s.clone());
        }
        ensure!(
            target.metadata()?.len() <= 64 * 1024 * 1024,
            "collider artifact exceeds size limit"
        );
        let bytes = std::fs::read(target)?;
        ensure!(
            format!("{:x}", Sha256::digest(&bytes)) == digest.to_lowercase(),
            "collider hash mismatch"
        );
        let cache_path = root
            .join("build/physics-cache")
            .join(format!("{digest}-rapier036-vhacd128-c001-h64-v1.cpc"));
        let shape = if cooking == Cooking::ConvexDecomposition {
            if let Some(shape) = read_cooked(&cache_path) {
                shape
            } else {
                let shape = decode(&bytes, cooking)?;
                let payload = serde_json::to_vec(&shape)?;
                let mut artifact = b"CPC1".to_vec();
                artifact.extend(Sha256::digest(&payload));
                artifact.extend(payload);
                std::fs::create_dir_all(cache_path.parent().unwrap())?;
                let temporary = cache_path.with_extension(format!("{}.tmp", std::process::id()));
                std::fs::write(&temporary, artifact)?;
                std::fs::rename(temporary, &cache_path)?;
                shape
            }
        } else {
            decode(&bytes, cooking)?
        };
        self.0.insert(key, shape.clone());
        Ok(shape)
    }
}
#[derive(Serialize)]
pub struct SurfaceProjection {
    pub point: [f32; 3],
    pub distance: f32,
    pub is_inside: bool,
}
fn read_cooked(path: &Path) -> Option<SharedShape> {
    if path.metadata().ok()?.len() > 64 * 1024 * 1024 {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() < 36
        || &bytes[..4] != b"CPC1"
        || Sha256::digest(&bytes[36..]).as_slice() != &bytes[4..36]
    {
        return None;
    }
    serde_json::from_slice(&bytes[36..]).ok()
}

fn decode(bytes: &[u8], cooking: Cooking) -> Result<SharedShape> {
    ensure!(
        bytes.len() >= 12 && &bytes[..4] == b"CTM1",
        "invalid collider header"
    );
    let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let vertices = word(4) as usize;
    let triangles = word(8) as usize;
    ensure!(
        vertices >= 3 && triangles > 0 && vertices <= 2_000_000 && triangles <= 4_000_000,
        "invalid collider counts"
    );
    ensure!(
        bytes.len() == 12 + 12 * (vertices + triangles),
        "collider length mismatch"
    );
    let points = (0..vertices)
        .map(|i| {
            Vector::new(
                f32::from_bits(word(12 + 12 * i)),
                f32::from_bits(word(16 + 12 * i)),
                f32::from_bits(word(20 + 12 * i)),
            )
        })
        .collect::<Vec<_>>();
    ensure!(
        points.iter().all(|p| p.is_finite()),
        "nonfinite collider vertex"
    );
    let offset = 12 + 12 * vertices;
    let indices = (0..triangles)
        .map(|i| {
            [
                word(offset + 12 * i),
                word(offset + 12 * i + 4),
                word(offset + 12 * i + 8),
            ]
        })
        .collect::<Vec<_>>();
    ensure!(
        indices.iter().flatten().all(|i| (*i as usize) < vertices),
        "collider index outside vertices"
    );
    match cooking {
        Cooking::Cuboid => cuboid::cook(&points, &indices),
        Cooking::CuboidOrMesh => match cuboid::cook(&points, &indices) {
            Ok(shape) => Ok(shape),
            Err(_) => SharedShape::trimesh(points, indices)
                .map_err(|e| anyhow::anyhow!("trimesh: {e:?}")),
        },
        Cooking::ConvexHull => SharedShape::convex_hull(&points).context("degenerate hull"),
        Cooking::TriMesh => {
            SharedShape::trimesh(points, indices).map_err(|e| anyhow::anyhow!("trimesh: {e:?}"))
        }
        Cooking::PlanarExtrusion => planar::cook(&points, &indices),
        Cooking::ConvexDecomposition => {
            let params = rapier3d::parry::transformation::vhacd::VHACDParameters {
                resolution: 128,
                concavity: 0.001,
                max_convex_hulls: 64,
                ..Default::default()
            };
            let shape = SharedShape::convex_decomposition_with_params(&points, &indices, &params);
            ensure!(
                !shape
                    .as_compound()
                    .context("decomposition did not create compound")?
                    .shapes()
                    .is_empty(),
                "empty decomposition"
            );
            Ok(shape)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn corrupt_cooked_cache_is_rejected() {
        let path = std::env::temp_dir().join(format!(
            "instantcad-cooked-integrity-{}.cpc",
            std::process::id()
        ));
        let payload = serde_json::to_vec(&SharedShape::ball(0.075)).unwrap();
        let mut bytes = b"CPC1".to_vec();
        bytes.extend(Sha256::digest(&payload));
        bytes.extend(payload);
        std::fs::write(&path, &bytes).unwrap();
        assert_eq!(read_cooked(&path).unwrap().as_ball().unwrap().radius, 0.075);
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        std::fs::write(&path, &bytes).unwrap();
        assert!(read_cooked(&path).is_none());
        std::fs::write(&path, &bytes[..20]).unwrap();
        assert!(read_cooked(&path).is_none());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn rejects_malformed_geometry_before_cooking() {
        assert!(decode(b"CTM1", Cooking::TriMesh).is_err());
        let mut bytes = b"CTM1".to_vec();
        bytes.extend(3u32.to_le_bytes());
        bytes.extend(1u32.to_le_bytes());
        for v in [0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0] {
            bytes.extend(v.to_le_bytes());
        }
        for i in [0u32, 1, 2] {
            bytes.extend(i.to_le_bytes());
        }
        assert!(decode(&bytes, Cooking::TriMesh).is_ok());
        assert!(decode(&bytes, Cooking::Cuboid).is_err());
        assert!(decode(&bytes, Cooking::CuboidOrMesh).unwrap().as_trimesh().is_some(),
            "an open triangle must remain a mesh, not become its bounding box");
        bytes[48..52].copy_from_slice(&100u32.to_le_bytes());
        assert!(decode(&bytes, Cooking::TriMesh).is_err());
        bytes[48..52].copy_from_slice(&0u32.to_le_bytes());
        bytes[12..16].copy_from_slice(&f32::NAN.to_le_bytes());
        assert!(decode(&bytes, Cooking::TriMesh).is_err());
    }
}
