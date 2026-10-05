//! Bounded live diagnostics, deliberately separate from per-contact tracing.
use serde_json::{json, Value};
use std::time::{Duration, Instant};

pub const STAGES: [&str; 11] = [
    "pipelineMs",
    "broadPhaseMs",
    "narrowPhaseMs",
    "solverMs",
    "ccdToiMs",
    "updateMs",
    "constraintsMs",
    "transmissionMs",
    "outsidePipelineMs",
    "userChangesMs",
    "islandsMs",
];
pub const COUNTS: [&str; 8] = [
    "awakeDynamic",
    "sleepingDynamic",
    "awakeSpheres",
    "softBodies",
    "activeContactPairs",
    "sphereSpherePairs",
    "sphereFixedPairs",
    "sphereOtherPairs",
];
#[derive(Default)]
pub struct Sample {
    pub stages: [f64; 11],
    pub counts: [usize; 8],
    pub substeps: usize,
}

pub struct LivePerformance {
    enabled: bool,
    start: Instant,
    commands: u64,
    steps: u64,
    over_budget: u64,
    physics: f64,
    snapshot: f64,
    simulated: f64,
    maximum: f64,
    // Half-millisecond upper-bound buckets; final bucket is overflow (>=100ms).
    histogram: [u64; 201],
    samples: u64,
    stages: [f64; 11],
    counts: [usize; 8],
    substeps: usize,
}
impl LivePerformance {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            start: Instant::now(),
            commands: 0,
            steps: 0,
            over_budget: 0,
            physics: 0.,
            snapshot: 0.,
            simulated: 0.,
            maximum: 0.,
            histogram: [0; 201],
            samples: 0,
            stages: [0.; 11],
            counts: [0; 8],
            substeps: 0,
        }
    }
    pub fn sample_next(&self) -> bool {
        self.enabled && self.commands % 20 == 0
    }
    pub fn record(
        &mut self,
        tick: u64,
        steps: u64,
        dt_ms: f64,
        physics_ms: f64,
        snapshot_ms: f64,
        sample: Option<Sample>,
    ) -> Option<Value> {
        self.record_elapsed(
            tick,
            steps,
            dt_ms,
            physics_ms,
            snapshot_ms,
            sample,
            self.start.elapsed(),
        )
    }
    fn record_elapsed(
        &mut self,
        tick: u64,
        steps: u64,
        dt_ms: f64,
        physics_ms: f64,
        snapshot_ms: f64,
        sample: Option<Sample>,
        elapsed: Duration,
    ) -> Option<Value> {
        if !self.enabled {
            return None;
        }
        self.commands += 1;
        self.steps += steps;
        self.physics += physics_ms;
        self.snapshot += snapshot_ms;
        self.simulated += steps as f64 * dt_ms;
        // Deadlines describe complete native step requests, including batched requests.
        self.over_budget += u64::from(physics_ms + snapshot_ms > steps as f64 * dt_ms);
        self.maximum = self.maximum.max(physics_ms);
        self.histogram[((physics_ms / 0.5).floor() as usize).min(200)] += 1;
        if let Some(s) = sample {
            self.samples += 1;
            for (total, v) in self.stages.iter_mut().zip(s.stages) {
                *total += v;
            }
            for (peak, v) in self.counts.iter_mut().zip(s.counts) {
                *peak = (*peak).max(v);
            }
            self.substeps = self.substeps.max(s.substeps);
        }
        if elapsed < Duration::from_secs(5) {
            return None;
        }
        let rank = (self.commands * 95).div_ceil(100);
        let mut seen = 0;
        let bucket = self
            .histogram
            .iter()
            .position(|n| {
                seen += n;
                seen >= rank
            })
            .unwrap();
        let stages: serde_json::Map<String, Value> = STAGES
            .iter()
            .zip(self.stages)
            .map(|(k, v)| ((*k).into(), json!(v / self.samples.max(1) as f64)))
            .collect();
        let counts: serde_json::Map<String, Value> = COUNTS
            .iter()
            .zip(self.counts)
            .map(|(k, v)| ((*k).into(), json!(v)))
            .collect();
        let report = json!({"type":"physics-performance", "schema":1, "tick":tick,
            "windowSeconds":elapsed.as_secs_f64(), "commands":self.commands, "steps":self.steps,
            "simulatedSeconds":self.simulated / 1000.,
            "physicsMeanMs":self.physics / self.commands as f64, "physicsMaxMs":self.maximum,
            "physicsP95UpperMs":if bucket < 200 { Some((bucket + 1) as f64 * 0.5) } else { None },
            "physicsOver100Ms":self.histogram[200], "snapshotMeanMs":self.snapshot / self.commands as f64,
            "nativeBudgetUsedRatio":(self.physics + self.snapshot) / self.simulated,
            "overBudgetCommands":self.over_budget, "stageSamples":self.samples,
            "sampledStageMeanMs":stages, "sampledPeakCounts":counts, "sampledMaxSubsteps":self.substeps});
        *self = Self::new(self.enabled);
        Some(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_summary_counts_deadlines_batches_and_overflow() {
        let mut p = LivePerformance::new(true);
        assert!(p.sample_next());
        assert!(p
            .record_elapsed(
                1,
                1,
                5.,
                4.,
                0.5,
                Some(Sample {
                    substeps: 2,
                    ..Default::default()
                }),
                Duration::from_secs(1)
            )
            .is_none());
        assert!(!p.sample_next());
        let r = p
            .record_elapsed(3, 2, 5., 150., 1., None, Duration::from_secs(5))
            .unwrap();
        assert_eq!(r["commands"], 2);
        assert_eq!(r["steps"], 3);
        assert_eq!(r["overBudgetCommands"], 1);
        assert_eq!(r["physicsP95UpperMs"], Value::Null);
        assert_eq!(r["physicsOver100Ms"], 1);
        assert_eq!(r["stageSamples"], 1);
        assert_eq!(r["sampledMaxSubsteps"], 2);
        assert!(p.sample_next());
    }
    #[test]
    fn disabled_has_no_sampling_or_output() {
        let mut p = LivePerformance::new(false);
        assert!(!p.sample_next());
        assert!(p
            .record_elapsed(1, 1, 5., 10., 1., None, Duration::from_secs(10))
            .is_none());
    }
}
