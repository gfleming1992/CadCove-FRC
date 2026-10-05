//! Exact support-index regression: geometric tie-breaking must survive SIMD.
use rapier3d::parry::{math::Vector, utils::point_cloud_support_point_id};

fn reference(dir: Vector, points: &[Vector]) -> usize {
    let mut index = 0;
    let mut value = points[0].dot(dir);
    for (i, point) in points.iter().enumerate().skip(1) {
        let dot = point.dot(dir);
        if dot > value {
            index = i;
            value = dot;
        }
    }
    index
}

#[test]
fn support_indices_preserve_scalar_rounding_ties_and_nonfinite_rules() {
    let mut seed = 0x731e_93a2_47df_a983_u64;
    let mut random = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        ((seed >> 40) as f32 / 8_388_608.0) - 1.0
    };
    for n in [1, 4, 8, 15, 16, 17, 19, 32, 64, 128, 256] {
        let points: Vec<_> = (0..n)
            .map(|_| Vector::new(random(), random(), random()))
            .collect();
        for scale in [0.0001, 1.0, 10000.0] {
            let points: Vec<_> = points.iter().map(|p| p * scale).collect();
            for _ in 0..4096 {
                let dir = Vector::new(random(), random(), random());
                assert_eq!(
                    point_cloud_support_point_id(dir, &points),
                    reference(dir, &points)
                );
            }
        }
        for dir in [
            Vector::ZERO,
            Vector::X,
            -Vector::X,
            Vector::Y,
            Vector::Z,
            Vector::splat(f32::NAN),
            Vector::splat(f32::INFINITY),
        ] {
            let mut special = points.clone();
            for value in [
                Vector::ZERO,
                Vector::splat(-0.0),
                Vector::splat(f32::NAN),
                Vector::splat(f32::INFINITY),
            ] {
                special[n / 2] = value;
                assert_eq!(
                    point_cloud_support_point_id(dir, &special),
                    reference(dir, &special)
                );
                let duplicates = vec![value; n];
                assert_eq!(
                    point_cloud_support_point_id(dir, &duplicates),
                    reference(dir, &duplicates)
                );
            }
        }
    }
}
