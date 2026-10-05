//! Exact convex partition of a tessellated, axis-aligned extrusion. Unlike voxel
//! decomposition this retains the two plane locations and the CAD openings.
use anyhow::{ensure, Context, Result};
use rapier3d::prelude::*;
use std::collections::{BTreeMap, HashMap};

fn cross(a: [f32; 2], b: [f32; 2], c: [f32; 2]) -> f64 {
    (b[0] as f64 - a[0] as f64) * (c[1] as f64 - b[1] as f64)
        - (b[1] as f64 - a[1] as f64) * (c[0] as f64 - b[0] as f64)
}
fn boundary(polygons: &[Vec<usize>]) -> Result<Vec<(usize, usize)>> {
    let mut edges = BTreeMap::new();
    for p in polygons {
        for i in 0..p.len() {
            let (a, b) = (p[i], p[(i + 1) % p.len()]);
            *edges.entry((a.min(b), a.max(b))).or_insert(0usize) += 1;
        }
    }
    ensure!(
        edges.values().all(|&n| n <= 2),
        "nonmanifold extrusion face"
    );
    Ok(edges
        .into_iter()
        .filter_map(|(e, n)| (n == 1).then_some(e))
        .collect())
}
pub(super) fn cook(points: &[Vector], triangles: &[[u32; 3]]) -> Result<SharedShape> {
    let mut low = Vector::splat(f32::INFINITY);
    let mut high = Vector::splat(f32::NEG_INFINITY);
    for &p in points {
        low = low.min(p);
        high = high.max(p);
    }
    // Extruded shafts can be much longer than their cross-section. Discover
    // cap planes geometrically instead of assuming the thinnest axis.
    let mut axes = [0, 1, 2];
    axes.sort_by(|&a, &b| (high[a] - low[a]).total_cmp(&(high[b] - low[b])));
    let mut failures = Vec::new();
    for axis in axes {
        match cook_axis(points, triangles, low, high, axis) {
            Ok(shape) => return Ok(shape),
            Err(error) => failures.push(format!("axis {axis}: {error}")),
        }
    }
    anyhow::bail!(
        "not a validated coordinate extrusion: {}",
        failures.join("; ")
    )
}

fn cook_axis(
    points: &[Vector],
    triangles: &[[u32; 3]],
    low: Vector,
    high: Vector,
    axis: usize,
) -> Result<SharedShape> {
    let radial: Vec<_> = (0..3).filter(|&i| i != axis).collect();
    let thickness = high[axis] - low[axis];
    ensure!(thickness > 1e-6, "extrusion has no thickness");
    let tolerance = 1e-7_f32.max(thickness * 1e-5);
    ensure!(
        points.iter().all(|p| (p[axis] - low[axis])
            .abs()
            .min((p[axis] - high[axis]).abs())
            <= tolerance),
        "planar extrusion requires vertices on two parallel coordinate planes"
    );
    let mut lookup = HashMap::new();
    let mut flat = Vec::new();
    let mut ids = Vec::new();
    for p in points {
        let q = [p[radial[0]], p[radial[1]]];
        let key = q.map(|v| if v == 0.0 { 0 } else { v.to_bits() });
        let id = *lookup.entry(key).or_insert_with(|| {
            let i = flat.len();
            flat.push(q);
            i
        });
        ids.push(id);
    }
    let mut faces = [Vec::<Vec<usize>>::new(), Vec::new()];
    for t in triangles {
        for (side, plane) in [low[axis], high[axis]].into_iter().enumerate() {
            if t.iter()
                .all(|&i| (points[i as usize][axis] - plane).abs() <= tolerance)
            {
                let mut p: Vec<_> = t.iter().map(|&i| ids[i as usize]).collect();
                let area = cross(flat[p[0]], flat[p[1]], flat[p[2]]);
                ensure!(area.abs() > 1e-14, "degenerate extrusion face");
                if area < 0.0 {
                    p.reverse();
                }
                faces[side].push(p);
            }
        }
    }
    ensure!(
        !faces[0].is_empty() && !faces[1].is_empty(),
        "extrusion needs both cap faces"
    );
    ensure!(
        faces[0].len() <= 4096 && faces[1].len() <= 4096,
        "extrusion cap exceeds cooking budget"
    );
    ensure!(
        boundary(&faces[0])? == boundary(&faces[1])?,
        "extrusion cap outlines differ"
    );
    // Matching caps alone do not prove a solid extrusion: disconnected caps,
    // missing side faces or an internal sheet must never be filled implicitly.
    let outline = boundary(&faces[0])?;
    let mut side_areas: BTreeMap<(usize, usize), f64> = BTreeMap::new();
    let mut shell_edges = BTreeMap::new();
    for t in triangles {
        let verts = t.map(|i| {
            let p = points[i as usize];
            (
                ids[i as usize],
                usize::from((p[axis] - high[axis]).abs() <= tolerance),
            )
        });
        ensure!(
            verts[0] != verts[1] && verts[1] != verts[2] && verts[2] != verts[0],
            "degenerate extrusion shell triangle"
        );
        for k in 0..3 {
            let (a, b) = (verts[k], verts[(k + 1) % 3]);
            *shell_edges.entry((a.min(b), a.max(b))).or_insert(0usize) += 1;
        }
        if verts.iter().all(|p| p.1 == verts[0].1) {
            continue;
        }
        let mut flat_ids = verts.map(|p| p.0).to_vec();
        flat_ids.sort_unstable();
        flat_ids.dedup();
        ensure!(
            flat_ids.len() == 2,
            "side triangle does not extrude one outline edge"
        );
        let edge = (flat_ids[0], flat_ids[1]);
        ensure!(
            outline.binary_search(&edge).is_ok(),
            "side face is not on the cap boundary"
        );
        let [a, b, c] = t.map(|i| points[i as usize]);
        *side_areas.entry(edge).or_default() += (b - a).cross(c - a).length() as f64 * 0.5;
    }
    ensure!(
        shell_edges.values().all(|&n| n == 2),
        "extrusion shell is open or nonmanifold"
    );
    for edge in outline {
        let a = flat[edge.0];
        let b = flat[edge.1];
        let length =
            ((a[0] as f64 - b[0] as f64).powi(2) + (a[1] as f64 - b[1] as f64).powi(2)).sqrt();
        let expected = length * thickness as f64;
        let actual = side_areas.get(&edge).copied().unwrap_or(0.0);
        ensure!(
            (actual - expected).abs() <= expected * 1e-5 + 1e-12,
            "extrusion side surface differs from the cap boundary"
        );
    }
    let area = |ps: &[Vec<usize>]| {
        ps.iter()
            .map(|p| cross(flat[p[0]], flat[p[1]], flat[p[2]]))
            .sum::<f64>()
    };
    ensure!(
        (area(&faces[0]) - area(&faces[1])).abs() < area(&faces[0]) * 1e-5,
        "extrusion cap areas differ"
    );
    let mut polygons = faces[1].clone();
    // Merge only across shared edges when the exact union remains convex.
    // Ordered traversal gives deterministic partitions despite hashed lookups.
    loop {
        let mut edges = HashMap::new();
        let mut merge = None;
        'outer: for (i, p) in polygons.iter().enumerate() {
            for a in 0..p.len() {
                let (u, v) = (p[a], p[(a + 1) % p.len()]);
                if let Some(&(j, b)) = edges.get(&(v, u)) {
                    let q: &Vec<usize> = &polygons[j];
                    let mut joined: Vec<_> =
                        (0..p.len()).map(|k| p[(a + 1 + k) % p.len()]).collect();
                    joined.extend((0..q.len() - 2).map(|k| q[(b + 2 + k) % q.len()]));
                    if joined.len() <= 128
                        && (0..joined.len()).all(|k| {
                            cross(
                                flat[joined[k]],
                                flat[joined[(k + 1) % joined.len()]],
                                flat[joined[(k + 2) % joined.len()]],
                            ) >= -1e-12
                        })
                    {
                        merge = Some((i, j, joined));
                        break 'outer;
                    }
                }
                edges.insert((u, v), (i, a));
            }
        }
        let Some((i, j, p)) = merge else { break };
        polygons[j] = p;
        polygons.remove(i);
    }
    let mut shapes = Vec::new();
    for polygon in polygons {
        let mut vertices = Vec::new();
        for plane in [low[axis], high[axis]] {
            for &id in &polygon {
                let mut p = Vector::ZERO;
                p[axis] = plane;
                p[radial[0]] = flat[id][0];
                p[radial[1]] = flat[id][1];
                vertices.push(p);
            }
        }
        // The polygon is already a verified convex partition. Supply its exact
        // prism topology: a generic 3D hull can lose tiny cross-section features
        // when an extrusion is orders of magnitude longer than it is wide.
        let n = polygon.len() as u32;
        let mut prism = Vec::new();
        for i in 1..n - 1 {
            prism.push([0, i + 1, i]);
            prism.push([n, n + i, n + i + 1]);
        }
        for i in 0..n {
            let j = (i + 1) % n;
            prism.push([i, j, j + n]);
            prism.push([i, j + n, i + n]);
        }
        if axis == 1 {
            for t in &mut prism {
                t.swap(1, 2);
            }
        }
        shapes.push((
            Pose::IDENTITY,
            SharedShape::convex_mesh(vertices, &prism).context("degenerate extrusion prism")?,
        ));
    }
    let shape = SharedShape::compound(shapes);
    let expected_volume = area(&faces[0]) * 0.5 * thickness as f64;
    let volume = shape.mass_properties(1.0).mass() as f64;
    ensure!(
        expected_volume > 0.0 && (volume - expected_volume).abs() <= expected_volume * 1e-4,
        "constructed extrusion does not preserve cap volume"
    );
    Ok(shape)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn long_thin_walled_shaft_keeps_its_volume_and_bore() {
        let n = 128_u32;
        let outer = 0.017_f32;
        let inner = 0.015_f32;
        let length = 1.2_f32;
        let mut points = Vec::new();
        for y in [-length / 2.0, length / 2.0] {
            for radius in [outer, inner] {
                for i in 0..n {
                    let angle = std::f32::consts::TAU * i as f32 / n as f32;
                    points.push(Vector::new(radius * angle.cos(), y, radius * angle.sin()));
                }
            }
        }
        let mut triangles = Vec::new();
        for side in [0, n * 2] {
            for i in 0..n {
                let j = (i + 1) % n;
                triangles.extend([
                    [side + i, side + j, side + n + j],
                    [side + i, side + n + j, side + n + i],
                ]);
            }
        }
        for ring in [0, n] {
            for i in 0..n {
                let a = ring + i;
                let b = ring + (i + 1) % n;
                triangles.extend([[a, b, b + 2 * n], [a, b + 2 * n, a + 2 * n]]);
            }
        }
        let shape = cook(&points, &triangles).unwrap();
        let area = 0.5
            * n as f64
            * (std::f64::consts::TAU / n as f64).sin()
            * ((outer as f64).powi(2) - (inner as f64).powi(2));
        let expected = area * length as f64;
        let error = (shape.mass_properties(1.0).mass() as f64 - expected).abs() / expected;
        assert!(error < 1e-4, "thin extrusion volume error: {error}");
        assert!(!shape.project_local_point(Vector::ZERO, false).is_inside);
        assert!(
            shape
                .project_local_point(Vector::new(0.016, 0.0, 0.0), false)
                .is_inside
        );
    }

    #[test]
    fn preserves_plate_opening_and_rejects_nonextruded_vertices() {
        let outline = [
            [-1., -1.],
            [1., -1.],
            [1., 1.],
            [-1., 1.],
            [-0.5, -0.5],
            [0.5, -0.5],
            [0.5, 0.5],
            [-0.5, 0.5],
        ];
        let mut points = Vec::new();
        for z in [-0.05, 0.05] {
            for [x, y] in outline {
                points.push(Vector::new(x, y, z));
            }
        }
        let mut tris = Vec::new();
        for side in [0, 8] {
            for i in 0..4 {
                let j = (i + 1) % 4;
                tris.extend([
                    [side + i, side + j, side + 4 + j],
                    [side + i, side + 4 + j, side + 4 + i],
                ]);
            }
        }
        // The source must contain the walls, including the opening's walls.
        for ring in [0, 4] {
            for i in 0..4 {
                let a = ring + i;
                let b = ring + (i + 1) % 4;
                tris.extend([[a, b, b + 8], [a, b + 8, a + 8]]);
            }
        }
        let shape = cook(&points, &tris).unwrap();
        assert!(!shape.project_local_point(Vector::ZERO, false).is_inside);
        assert!(
            shape
                .project_local_point(Vector::new(0.75, 0., 0.), false)
                .is_inside
        );
        assert!((shape.mass_properties(1.).mass() - 0.3).abs() < 1e-5);
        assert_eq!(shape.as_compound().unwrap().shapes().len(), 4);
        let mut open = tris.clone();
        open.pop();
        assert!(
            cook(&points, &open).is_err(),
            "missing walls cannot be synthesized"
        );
        let mut extra = tris.clone();
        extra.push(tris[0]);
        assert!(
            cook(&points, &extra).is_err(),
            "duplicate faces must be rejected"
        );
        // The same hollow extrusion along the largest axis is a shaft, not a plate.
        let long: Vec<_> = points
            .iter()
            .map(|p| Vector::new(p.x * 0.01, p.z * 20.0, p.y * 0.01))
            .collect();
        let shaft = cook(&long, &tris).unwrap();
        assert!(!shaft.project_local_point(Vector::ZERO, false).is_inside);
        assert!(
            shaft
                .project_local_point(Vector::new(0.0075, 0.0, 0.0), false)
                .is_inside
        );
        assert!((shaft.mass_properties(1.0).mass() - 0.0006).abs() < 1e-8);
        points[0].z = -0.04;
        assert!(cook(&points, &tris).is_err());
    }
}
