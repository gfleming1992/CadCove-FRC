//! Conservative reverse-frame candidate set; exhaustion always falls back.
use rapier3d::parry::{
    bounding_volume::BoundingVolume,
    math::{Pose, Real},
    shape::CompositeShape,
    utils::{hashmap::HashMap, PoseOpt},
};

/// Exact sparse set of part pairs. Adjacent part IDs share a 64-bit page,
/// reducing hash entries for the many triangles of one nearby soft surface.
/// The cardinality counts pairs, not pages, so the existing fallback bound
/// remains identical even with sparse or maximal u32 part IDs.
#[derive(Default)]
pub(super) struct CandidatePairs {
    pages: HashMap<(u32, u32), u64>,
    len: usize,
}
impl CandidatePairs {
    fn insert(&mut self, (a, b): (u32, u32)) {
        let mask = 1_u64 << (b & 63);
        let page = self.pages.entry((a, b >> 6)).or_default();
        if *page & mask == 0 {
            self.len += 1;
            *page |= mask;
        }
    }
    fn len(&self) -> usize {
        self.len
    }
    pub(super) fn contains_key(&self, &(a, b): &(u32, u32)) -> bool {
        self.pages.get(&(a, b >> 6))
            .is_some_and(|page| page & (1_u64 << (b & 63)) != 0)
    }
}

pub(super) fn candidates(
    a: &dyn CompositeShape,
    b: &dyn CompositeShape,
    ab: &Pose,
    prediction: Real,
) -> Option<CandidatePairs> {
    let aa = a.bvh().root_aabb();
    let bb = b.bvh().root_aabb();
    if !prediction.is_finite()
        || prediction < 0.0
        || !ab.is_finite()
        || !aa.mins.is_finite()
        || !aa.maxs.is_finite()
        || !bb.mins.is_finite()
        || !bb.maxs.is_finite()
    {
        return None;
    }
    let scale = aa
        .mins
        .abs()
        .max_element()
        .max(aa.maxs.abs().max_element())
        .max(bb.mins.abs().max_element())
        .max(bb.maxs.abs().max_element())
        .max(ab.translation.abs().max_element())
        .max(1.0);
    let reach = prediction + 128.0 * Real::EPSILON * scale;
    let search = aa.transform_by(&ab.inverse()).loosened(reach);
    let mut pairs = CandidatePairs::default();
    for (count, ib) in b.bvh().intersect_aabb(&search).enumerate() {
        if count >= 256 {
            return None;
        }
        let mut overflow = false;
        b.map_part_at(ib, &mut |part, shape, _| {
            let bound = shape.compute_aabb(&part.prepend_to(ab)).loosened(reach);
            if !bound.mins.is_finite() || !bound.maxs.is_finite() {
                overflow = true;
                return;
            }
            for ia in a.bvh().intersect_aabb(&bound) {
                pairs.insert((ia, ib));
                if pairs.len() > 4096 {
                    overflow = true;
                    break;
                }
            }
        });
        if overflow {
            return None;
        }
    }
    Some(pairs)
}

#[cfg(test)]
mod tests {
    use super::super::tests::{distance, point, transform};
    use super::*;
    use rapier3d::prelude::{TriMesh, Vector};
    #[test]
    fn paged_pairs_preserve_membership_and_pair_limit() {
        let mut actual = CandidatePairs::default();
        let mut expected = std::collections::HashSet::new();
        for a in [0, 1, 65, u32::MAX] {
            for b in (0..2048).chain([4095, 4096, u32::MAX]) {
                for _ in 0..2 {
                    actual.insert((a, b));
                    expected.insert((a, b));
                    assert_eq!(actual.len(), expected.len());
                    assert_eq!(actual.len() > 4096, expected.len() > 4096);
                }
            }
        }
        for a in [0, 1, 2, 64, 65, u32::MAX] {
            for b in (0..4200).chain([u32::MAX - 1, u32::MAX]) {
                assert_eq!(actual.contains_key(&(a, b)), expected.contains(&(a, b)));
            }
        }
        assert!(actual.pages.len() * 50 < actual.len());
    }
    #[test]
    fn rejected_triangle_pairs_are_separated_by_independent_f64_oracle() {
        let mut seed = 3310_u64;
        let mut next = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            ((seed >> 40) as f32 / (1_u32 << 24) as f32) * 2.0 - 1.0
        };
        let mut rejected = 0;
        for case in 0..20_000 {
            let scale = [0.0001, 0.01, 1.0, 1000.0][case % 4];
            let mut vertex = || Vector::new(next(), next(), next()) * scale;
            let a = [vertex(), vertex(), vertex()];
            let b = [vertex(), vertex(), vertex()];
            let pose = Pose::new(vertex() * 3.0, vertex());
            let prediction = 0.0002 * scale;
            let ma = TriMesh::new(a.to_vec(), vec![[0, 1, 2]]).unwrap();
            let mb = TriMesh::new(b.to_vec(), vec![[0, 1, 2]]).unwrap();
            if candidates(&ma, &mb, &pose, prediction)
                .is_some_and(|pairs| !pairs.contains_key(&(0, 0)))
            {
                rejected += 1;
                let d = distance(&a.map(point), &b.map(|v| transform(&pose, v)));
                assert!(
                    d > prediction as f64,
                    "case={case}, separation={d}, prediction={prediction}"
                );
            }
        }
        assert!(rejected > 10_000);
    }
    #[test]
    fn invalid_query_distance_keeps_original_queries() {
        let m = TriMesh::new(vec![Vector::ZERO, Vector::X, Vector::Y], vec![[0, 1, 2]]).unwrap();
        for prediction in [f32::NAN, f32::INFINITY, -0.001] {
            assert!(candidates(&m, &m, &Pose::IDENTITY, prediction).is_none());
        }
        assert!(candidates(&m, &m, &Pose::IDENTITY, 0.001)
            .unwrap()
            .contains_key(&(0, 0)));
    }
}
