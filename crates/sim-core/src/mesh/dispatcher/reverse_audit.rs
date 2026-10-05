//! Qualification of reverse-frame bounds: read-only by default. The optional
//! filter audit evaluates omitted queries on clones along the filtered trajectory.
use rapier3d::parry::{
    math::{Pose, Real, Vector},
    query::ContactManifold,
    shape::{CompositeShape, Shape},
};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};

static COUNTS: [AtomicU64; 10] = [const { AtomicU64::new(0) }; 10];
#[cfg(feature = "composite-filter-audit")]
static SHADOWS: [AtomicU64; 3] = [const { AtomicU64::new(0) }; 3];
static WITNESSES: Mutex<Vec<serde_json::Value>> = Mutex::new(Vec::new());
const LABELS: [&str; 10] = [
    "searches",
    "fallbacks",
    "queries",
    "proposedRejections",
    "protectedWarmManifolds",
    "rejectedWithOutputPoints",
    "rejectedWithInRangePoints",
    "inRangePoints",
    "emptyRejectedQueriesChangingNormals",
    "eligibleRejections",
];
fn count(i: usize, n: u64) {
    COUNTS[i].fetch_add(n, Ordering::Relaxed);
}
pub fn reset() {
    rapier3d::geometry::manifold_audit::reset();
    #[cfg(feature = "composite-filter-audit")]
    for n in &SHADOWS {
        n.store(0, Ordering::Relaxed);
    }
    for n in &COUNTS {
        n.store(0, Ordering::Relaxed);
    }
    WITNESSES.lock().unwrap().clear();
}
pub fn report() -> serde_json::Value {
    let mut result = serde_json::Map::new();
    for (key, value) in LABELS.iter().zip(&COUNTS) {
        result.insert((*key).into(), value.load(Ordering::Relaxed).into());
    }
    result.insert("witnesses".into(), WITNESSES.lock().unwrap().clone().into());
    result.insert("downstream".into(), serde_json::json!({
        "labels": ["taggedManifoldUpdates", "selectedSolverContacts", "nonemptyInputsToClustering", "softVertexCandidateManifolds", "selectedSoftVertices", "softConstraintsWrittenBack", "softConstraintsWithNonzeroImpulse"],
        "counts": rapier3d::geometry::manifold_audit::snapshot(),
        "scope": "Tags identify mesh/mesh reverse-bounds exclusions without prior points. Counts observe downstream use without changing selection. Cluster inputs are conservatively unresolved."
    }));
    result.insert(
        "filterEnabled".into(),
        cfg!(feature = "composite-filter").into(),
    );
    #[cfg(feature = "composite-filter-audit")]
    result.insert("shadow".into(), serde_json::json!({
        "queries": SHADOWS[0].load(Ordering::Relaxed),
        "outputPoints": SHADOWS[1].load(Ordering::Relaxed),
        "potentialSolverPoints": SHADOWS[2].load(Ordering::Relaxed),
        "scope": "Original query on a cloned empty manifold, using the actual filtered trajectory and exact narrow-phase velocity/skin/distance selection predicate on every point."
    }));
    result.insert("scope".into(), if cfg!(feature = "composite-filter-audit") {
        "Filtered-trajectory oracle queries operate on clones. Shadow solver-point checks are authoritative; older geometric counters include unfiltered proposals. Diagnostic overhead is not a throughput result."
    } else {
        "Original queries execute as an oracle for every proposed rejection. Warm manifolds with previous points are protected. Diagnostic overhead is not a throughput result. Existing whole-pair empty rejection remains active."
    }.into());
    result.into()
}
pub(super) fn candidates(
    a: &dyn CompositeShape,
    b: &dyn CompositeShape,
    ab: &Pose,
    prediction: Real,
) -> Option<super::reverse_bounds::CandidatePairs> {
    count(0, 1);
    let result = super::reverse_bounds::candidates(a, b, ab, prediction);
    if result.is_none() {
        count(1, 1);
    }
    result
}
#[allow(clippy::too_many_arguments)]
pub fn inspect<M: 'static, C>(
    excluded: bool,
    prediction: Real,
    m: &mut ContactManifold<M, C>,
    before: (Vector, Vector, usize),
    a: &dyn Shape,
    b: &dyn Shape,
    pose: Pose,
) {
    // Dedicated transient metadata: preserve user_data and every physical cache.
    if let Some(data) = (&mut m.data as &mut dyn std::any::Any)
        .downcast_mut::<rapier3d::geometry::ContactManifoldData>()
    {
        data.audit_excluded_query = excluded && before.2 == 0;
    }
    count(2, 1);
    if !excluded {
        return;
    }
    count(3, 1);
    if before.2 > 0 {
        count(4, 1);
        return;
    }
    count(9, 1);
    let near = m.points.iter().filter(|p| p.dist <= prediction).count();
    if m.points.is_empty() {
        if before.0 != m.local_n1 || before.1 != m.local_n2 {
            count(8, 1);
        }
        return;
    }
    if near > 0 {
        count(6, 1);
        count(7, near as u64);
    }
    let n = COUNTS[5].fetch_add(1, Ordering::Relaxed);
    if n < 8 {
        WITNESSES.lock().unwrap().push(serde_json::json!({
            "prediction":prediction,"subshapes":[m.subshape1,m.subshape2],"pose":pose,
            "types":[format!("{:?}",a.shape_type()),format!("{:?}",b.shape_type())],
            "triangleA":a.as_triangle(),"triangleB":b.as_triangle(),
            "cuboidA":a.as_cuboid(),"cuboidB":b.as_cuboid(),
            "beforeNormals":[before.0,before.1],"priorPointCount":before.2,
            "afterNormals":[m.local_n1,m.local_n2],
            "points":m.points.iter().map(|p|serde_json::json!({"a":p.local_p1,"b":p.local_p2,"distance":p.dist})).collect::<Vec<_>>()
        }));
    }
}

#[cfg(feature = "composite-filter-audit")]
pub fn inspect_shadow<M, C>(
    motion: rapier3d::geometry::query_motion::QueryMotion,
    manifold: &ContactManifold<M, C>,
) {
    SHADOWS[0].fetch_add(1, Ordering::Relaxed);
    SHADOWS[1].fetch_add(manifold.points.len() as u64, Ordering::Relaxed);
    let kept = motion.potentially_kept_points(manifold);
    SHADOWS[2].fetch_add(kept as u64, Ordering::Relaxed);
    assert_eq!(
        kept, 0,
        "Filtered query would supply a potential solver contact"
    );
}
