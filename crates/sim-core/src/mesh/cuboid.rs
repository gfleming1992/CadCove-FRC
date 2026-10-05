//! Recognize a complete rectangular solid, not an arbitrary mesh's bounding box.
//! Reject holes, incomplete/overlapping faces, extra details and reversed winding.
use anyhow::{ensure, Result};
use rapier3d::prelude::*;

pub(super) fn cook(points: &[Vector], triangles: &[[u32; 3]]) -> Result<SharedShape> {
    const TOLERANCE: f32 = 1.0e-6; // metres, including the f32 box construction
    ensure!(
        triangles.len() == 12 && points.len() >= 8,
        "cuboid requires twelve face triangles"
    );
    let low = points
        .iter()
        .copied()
        .fold(Vector::splat(f32::INFINITY), Vector::min);
    let high = points
        .iter()
        .copied()
        .fold(Vector::splat(f32::NEG_INFINITY), Vector::max);
    let center = (low + high) * 0.5;
    let half = (high - low) * 0.5;
    ensure!(
        half.is_finite() && half.cmpgt(Vector::splat(TOLERANCE)).all(),
        "degenerate cuboid"
    );
    let mut corners = Vec::with_capacity(points.len());
    for &p in points {
        let mut corner = 0_u8;
        let mut snapped = Vector::ZERO;
        for axis in 0..3 {
            if p[axis] > center[axis] {
                corner |= 1 << axis;
            }
            let coordinate = center[axis]
                + if corner & (1 << axis) != 0 {
                    half[axis]
                } else {
                    -half[axis]
                };
            snapped[axis] = coordinate;
            ensure!(
                (p[axis] - coordinate).abs() <= TOLERANCE,
                "mesh vertex is not on a cuboid corner"
            );
        }
        ensure!(
            p.distance(snapped) <= TOLERANCE,
            "cuboid corner displacement exceeds tolerance"
        );
        corners.push(corner);
    }
    let mut faces: [Vec<[u8; 3]>; 6] = Default::default();
    let mut used = 0_u16;
    for triangle in triangles {
        let ids = triangle.map(|i| corners[i as usize]);
        ensure!(
            ids[0] != ids[1] && ids[1] != ids[2] && ids[0] != ids[2],
            "degenerate cuboid face"
        );
        let axis = (0..3).find(|axis| ids.iter().all(|c| (c >> axis) & 1 == (ids[0] >> axis) & 1));
        let axis = axis.ok_or_else(|| anyhow::anyhow!("triangle crosses cuboid interior"))?;
        let side = ((ids[0] >> axis) & 1) as usize;
        let [a, b, c] = triangle.map(|i| points[i as usize]);
        ensure!(
            (b - a).cross(c - a)[axis] * if side == 1 { 1.0 } else { -1.0 } > 0.0,
            "cuboid face winding must be outward"
        );
        for id in ids {
            used |= 1 << id;
        }
        faces[2 * axis + side].push(ids);
    }
    ensure!(used == 255, "cuboid corners missing");
    for (face, triangles) in faces.iter().enumerate() {
        ensure!(triangles.len() == 2, "cuboid face missing or duplicated");
        let common = triangles[0]
            .iter()
            .filter(|i| triangles[1].contains(i))
            .copied()
            .collect::<Vec<_>>();
        // The shared edge must be the face diagonal. Sharing a boundary edge
        // instead leaves a hole and an overlapping region despite equal area.
        ensure!(
            common.len() == 2 && common[0] ^ common[1] == (7 ^ (1 << (face / 2))),
            "cuboid face triangles do not tile the rectangle"
        );
    }
    let shape = SharedShape::cuboid(half.x, half.y, half.z);
    Ok(if center == Vector::ZERO {
        shape
    } else {
        SharedShape::compound(vec![(
            Pose::translation(center.x, center.y, center.z),
            shape,
        )])
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cube() -> (Vec<Vector>, Vec<[u32; 3]>) {
        let points = (0..8)
            .map(|i| {
                Vector::new(
                    if i & 1 == 0 { -1.0 } else { 1.0 },
                    if i & 2 == 0 { -2.0 } else { 2.0 },
                    if i & 4 == 0 { -3.0 } else { 3.0 },
                )
            })
            .collect();
        (
            points,
            vec![
                [0, 4, 6],
                [0, 6, 2],
                [1, 3, 7],
                [1, 7, 5],
                [0, 1, 5],
                [0, 5, 4],
                [2, 6, 7],
                [2, 7, 3],
                [0, 2, 3],
                [0, 3, 1],
                [4, 5, 7],
                [4, 7, 6],
            ],
        )
    }
    #[test]
    fn complete_translated_box_preserves_surface_and_inside() {
        let (mut p, t) = cube();
        for v in &mut p {
            *v += Vector::new(2.0, 4.0, 6.0);
        }
        let shape = cook(&p, &t).unwrap();
        let original = SharedShape::trimesh(p, t).unwrap();
        for x in -4..8 {
            for y in -4..8 {
                for z in -4..12 {
                    let v = Vector::new(x as f32 + 0.123, y as f32 + 0.234, z as f32 + 0.345);
                    let a = shape.project_local_point(v, false);
                    let b = original.project_local_point(v, false);
                    assert!((a.point.distance(v) - b.point.distance(v)).abs() < 2e-6);
                    assert_eq!(
                        shape.contains_local_point(v),
                        (v.x > 1.0 && v.x < 3.0)
                            && (v.y > 2.0 && v.y < 6.0)
                            && (v.z > 3.0 && v.z < 9.0)
                    );
                }
            }
        }
    }
    #[test]
    fn holes_overlap_reversed_and_extra_geometry_are_rejected() {
        let (p, t) = cube();
        let mut bad = t.clone();
        bad[1] = bad[0];
        assert!(cook(&p, &bad).is_err());
        let mut bad = t.clone();
        bad[1] = [0, 4, 2];
        assert!(cook(&p, &bad).is_err());
        let mut bad = t.clone();
        bad[0].swap(0, 1);
        assert!(cook(&p, &bad).is_err());
        assert!(cook(&p, &t[..11]).is_err());
        let mut bad = p.clone();
        bad.push(Vector::ZERO);
        assert!(cook(&bad, &t).is_err());
        let mut bad = p.clone();
        bad[0].x += 0.001;
        assert!(cook(&bad, &t).is_err());
    }
}
