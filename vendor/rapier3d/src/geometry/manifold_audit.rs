//! Optional observation of tagged query outputs as narrow phase prepares constraints.
//! No diagnostic value participates in simulation decisions.
use std::sync::atomic::{AtomicU64, Ordering};

static COUNTS: [AtomicU64; 7] = [const { AtomicU64::new(0) }; 7];

pub(crate) fn add(index: usize, count: u64) {
    COUNTS[index].fetch_add(count, Ordering::Relaxed);
}

/// Reset only between independent runs, while no query jobs are active.
pub fn reset() {
    for counter in &COUNTS {
        counter.store(0, Ordering::Relaxed);
    }
}

/// Counts are diagnostic, not a performance measurement.
pub fn snapshot() -> [u64; 7] {
    std::array::from_fn(|i| COUNTS[i].load(Ordering::Relaxed))
}
