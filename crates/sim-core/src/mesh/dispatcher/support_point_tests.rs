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

#[test]
fn support_lane_reduction_keeps_earliest_noninitial_tie() {
    // The earlier index can belong to a later SIMD lane or the scalar tail.
    for n in [16, 17, 19, 32, 65, 129] {
        for first in 1..n {
            for second in first + 1..n {
                for maximum in [1.0, f32::INFINITY] {
                    let mut points = vec![Vector::new(-1.0, 0.0, 0.0); n];
                    points[first].x = maximum;
                    points[second].x = maximum;
                    assert_eq!(point_cloud_support_point_id(Vector::X, &points), first,
                        "n={n}, first={first}, second={second}, maximum={maximum}");
                }
            }
        }
    }
}

#[test]
fn ccd_support_indices_preserve_relative_rounding_and_ties() {
    use rapier3d::parry::query::sweep_toi::ToiProxy;
    let scalar = |direction: Vector, points: &[Vector]| {
        let (mut best, mut value) = (0, 0.0);
        for (i, p) in points.iter().enumerate().skip(1) {
            let dot = direction.dot(*p - points[0]);
            if dot > value { best = i; value = dot; }
        }
        best as u32
    };
    let mut seed = 3310_u64;
    let mut random = || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        ((seed >> 40) as f32 / 8_388_608.0) - 1.0
    };
    for n in [1, 8, 15, 16, 17, 19, 32, 64, 129, 256] {
        for offset in [0.0, 10000.0, 1.0e8] {
            let mut points: Vec<_> = (0..n).map(|_| Vector::splat(offset)
                + Vector::new(random(), random(), random()) * 100.0).collect();
            for _ in 0..4096 {
                let direction = Vector::new(random(), random(), random());
                assert_eq!(ToiProxy::from_points(&points, 0.0).support(direction), scalar(direction, &points));
            }
            for value in [0.0, -0.0, f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
                for slot in [0, n / 2, n - 1] {
                    points[slot] = Vector::splat(value);
                    for direction in [Vector::X, -Vector::X, Vector::Y, Vector::ZERO, Vector::splat(value)] {
                        assert_eq!(ToiProxy::from_points(&points, 0.0).support(direction), scalar(direction, &points));
                    }
                }
            }
        }
        for first in 1..n {
            let mut points = vec![Vector::ZERO; n];
            points[first].x = 1.0;
            points[n - 1].x = 1.0;
            assert_eq!(ToiProxy::from_points(&points, 0.0).support(Vector::X), first as u32);
        }
    }
}
