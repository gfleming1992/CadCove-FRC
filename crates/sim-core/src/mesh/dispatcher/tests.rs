use super::*;
use rapier3d::na::{Quaternion, UnitQuaternion, Vector3};
type D = Vector3<f64>;
pub(super) fn point(v: Vector) -> D {
    D::new(v.x as f64, v.y as f64, v.z as f64)
}
pub(super) fn transform(p: &Pose, v: Vector) -> D {
    let [x, y, z, w] = p.rotation.to_array();
    UnitQuaternion::new_normalize(Quaternion::new(w as f64, x as f64, y as f64, z as f64))
        * point(v)
        + point(p.translation)
}
// Independent f64 closest-feature oracle: vertex/face, edge/edge, and segment
// piercing. It does not reuse the rejection's projection-interval calculation.
fn point_triangle(p: D, t: &[D; 3]) -> f64 {
    let [a, b, c] = *t;
    let ab = b - a;
    let ac = c - a;
    let ap = p - a;
    let d1 = ab.dot(&ap);
    let d2 = ac.dot(&ap);
    if d1 <= 0.0 && d2 <= 0.0 {
        return ap.norm_squared();
    }
    let bp = p - b;
    let d3 = ab.dot(&bp);
    let d4 = ac.dot(&bp);
    if d3 >= 0.0 && d4 <= d3 {
        return bp.norm_squared();
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        return (p - (a + ab * (d1 / (d1 - d3)))).norm_squared();
    }
    let cp = p - c;
    let d5 = ab.dot(&cp);
    let d6 = ac.dot(&cp);
    if d6 >= 0.0 && d5 <= d6 {
        return cp.norm_squared();
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        return (p - (a + ac * (d2 / (d2 - d6)))).norm_squared();
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        return (p - (b + (c - b) * ((d4 - d3) / ((d4 - d3) + (d5 - d6))))).norm_squared();
    }
    let sum = va + vb + vc;
    if sum == 0.0 {
        return f64::INFINITY;
    }
    (p - (a + ab * (vb / sum) + ac * (vc / sum))).norm_squared()
}
fn segments(p: D, q: D, r: D, s: D) -> f64 {
    let u = q - p;
    let v = s - r;
    let w = p - r;
    let a = u.dot(&u);
    let b = u.dot(&v);
    let c = v.dot(&v);
    let d = u.dot(&w);
    let e = v.dot(&w);
    let den = a * c - b * b;
    let mut x = if den > 1e-30 {
        ((b * e - c * d) / den).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let mut y = if c > 0.0 { (b * x + e) / c } else { 0.0 };
    if y < 0.0 {
        y = 0.0;
        x = if a > 0.0 {
            (-d / a).clamp(0.0, 1.0)
        } else {
            0.0
        }
    } else if y > 1.0 {
        y = 1.0;
        x = if a > 0.0 {
            ((b - d) / a).clamp(0.0, 1.0)
        } else {
            0.0
        }
    }
    (w + u * x - v * y).norm_squared()
}
fn pierces(p: D, q: D, t: &[D; 3]) -> bool {
    let e1 = t[1] - t[0];
    let e2 = t[2] - t[0];
    let dir = q - p;
    let h = dir.cross(&e2);
    let det = e1.dot(&h);
    if det.abs() < 1e-30 {
        return false;
    }
    let s = p - t[0];
    let u = s.dot(&h) / det;
    let k = s.cross(&e1);
    let v = dir.dot(&k) / det;
    let x = e2.dot(&k) / det;
    u >= 0.0 && v >= 0.0 && u + v <= 1.0 && (0.0..=1.0).contains(&x)
}
pub(super) fn distance(a: &[D; 3], b: &[D; 3]) -> f64 {
    let mut best = f64::INFINITY;
    for i in 0..3 {
        if pierces(a[i], a[(i + 1) % 3], b) || pierces(b[i], b[(i + 1) % 3], a) {
            return 0.0;
        }
        best = best
            .min(point_triangle(a[i], b))
            .min(point_triangle(b[i], a));
        for j in 0..3 {
            best = best.min(segments(a[i], a[(i + 1) % 3], b[j], b[(j + 1) % 3]));
        }
    }
    best.sqrt()
}
#[test]
fn independent_distance_oracle_known_cases() {
    let a = [D::zeros(), D::x(), D::y()];
    assert_eq!(distance(&a, &a), 0.0);
    let b = a.map(|p| p + D::z() * 2.0);
    assert!((distance(&a, &b) - 2.0).abs() < 1e-12);
    let crossing = [
        D::new(0.2, 0.2, -1.0),
        D::new(0.2, 0.2, 1.0),
        D::new(0.5, 0.2, 0.0),
    ];
    assert_eq!(distance(&a, &crossing), 0.0);
    let coplanar = [
        D::new(-0.1, 0.5, 0.0),
        D::new(1.0, 0.5, 0.0),
        D::new(0.5, -0.1, 0.0),
    ];
    assert_eq!(distance(&a, &coplanar), 0.0);
}
#[test]
fn rejects_only_pairs_beyond_independent_f64_distance() {
    let mut seed = 3310_u64;
    let mut next = || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        ((seed >> 40) as f32 / (1_u32 << 24) as f32) * 2.0 - 1.0
    };
    let mut rejected = 0;
    for case in 0..20_000 {
        let scale = [0.0001, 0.01, 1.0, 1000.0][case % 4];
        let mut p = || Vector::new(next(), next(), next()) * scale;
        let a = Triangle::new(p(), p(), p());
        let b = Triangle::new(p(), p(), p());
        let pose = Pose::new(p() * 3.0, p());
        let prediction = 0.0002 * scale;
        if separated(&pose, &a, &b, prediction) {
            rejected += 1;
            let d = distance(
                &[a.a, a.b, a.c].map(point),
                &[b.a, b.b, b.c].map(|v| transform(&pose, v)),
            );
            assert!(
                d > prediction as f64,
                "case={case}, f64 distance={d}, prediction={prediction}"
            );
        }
    }
    assert!(rejected > 10_000);
}
#[test]
fn separated_centimetre_triangles_do_not_report_penetration() {
    // Reproduced with the pinned upstream GJK/EPA path: it reports -10.7 mm
    // penetration here although an independent face-axis bound exceeds 2 mm.
    let a = Triangle::new(
        Vector::new(-0.009033895, -0.008879454, 0.009538524),
        Vector::new(-0.002864926, 0.0061469004, -0.0017317128),
        Vector::new(0.008276735, -0.0015023767, -0.0026849604),
    );
    let b = Triangle::new(
        Vector::new(0.001355623, 0.009379442, 0.009934489),
        Vector::new(0.009862615, -0.008588306, 0.003335551),
        Vector::new(-0.0050298497, -0.00895078, 0.0057939705),
    );
    let pose = Pose::from_parts(
        Vector::new(-0.01082208, 0.004970498, -0.010389687),
        rapier3d::math::Rotation::from_xyzw(-0.0014316455, 0.003837362, 0.0012687674, 0.9999908),
    );
    let d = distance(
        &[a.a, a.b, a.c].map(point),
        &[b.a, b.b, b.c].map(|v| transform(&pose, v)),
    );
    assert!(d > 0.002);
    let mut original = ContactManifold::<(), ()>::new();
    DefaultQueryDispatcher.contact_manifold_convex_convex(&pose, &a, &b, None, None, 0.0002, &mut original).unwrap();
    println!("separated triangle regression: f64 distance={d}, upstream reported gaps={:?}", original.points.iter().map(|point| point.dist).collect::<Vec<_>>());
    let mut m = ContactManifold::<(), ()>::new();
    PlaneContactDispatcher {
        filter_planes: true,
        audit_rejections: false,
    }
    .contact_manifold_convex_convex(&pose, &a, &b, None, None, 0.0002, &mut m)
    .unwrap();
    assert!(m.points.is_empty());
}
#[test]
fn touching_crossing_degenerate_and_tolerance_cases_fall_back() {
    let a = Triangle::new(Vector::ZERO, Vector::X, Vector::Y);
    for z in [0.0, 0.0001, 0.0002, 0.000205] {
        assert!(!separated(&Pose::translation(0.0, 0.0, z), &a, &a, 0.0002));
    }
    assert!(separated(
        &Pose::translation(0.0, 0.0, 0.001),
        &a,
        &a,
        0.0002
    ));
    let crossing = Triangle::new(
        Vector::new(0.2, 0.2, -1.0),
        Vector::new(0.2, 0.2, 1.0),
        Vector::new(0.5, 0.2, 0.0),
    );
    assert!(!separated(&Pose::IDENTITY, &a, &crossing, 0.0002));
    let zero = Triangle::new(Vector::ZERO, Vector::ZERO, Vector::ZERO);
    assert!(!separated(&Pose::IDENTITY, &zero, &zero, 0.0002));
    assert!(!separated(&Pose::IDENTITY, &a, &a, f32::NAN));
}
