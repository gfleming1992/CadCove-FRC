use crate::math::Vector;

/// Computes the index of the support point of a cloud of points.
#[inline]
pub fn point_cloud_support_point_id(dir: Vector, points: &[Vector]) -> usize {
    #[cfg(all(
        feature = "dim3",
        feature = "f32",
        target_arch = "x86_64",
        target_feature = "avx2",
        feature = "x86-support-batch"
    ))]
    if points.len() >= 32 && points.len() <= u32::MAX as usize {
        return support_avx2(dir, points);
    }
    #[cfg(all(
        feature = "dim3",
        feature = "f32",
        any(
            target_arch = "aarch64",
            all(target_arch = "x86_64", feature = "x86-support-batch")
        )
    ))]
    if points.len() >= 16 {
        return point_cloud_support_point_id_batched(dir, points);
    }

    let mut best_pt = 0;
    let mut best_dot = points[0].dot(dir);

    for (i, p) in points.iter().enumerate().skip(1) {
        let dot = p.dot(dir);

        if dot > best_dot {
            best_dot = dot;
            best_pt = i;
        }
    }

    best_pt
}

/// Computes the support point of a cloud of points.
#[inline]
pub fn point_cloud_support_point(dir: Vector, points: &[Vector]) -> Vector {
    points[point_cloud_support_point_id(dir, points)]
}

#[cfg(all(
    feature = "dim3",
    feature = "f32",
    any(
        target_arch = "aarch64",
        all(target_arch = "x86_64", feature = "x86-support-batch")
    )
))]
#[inline]
fn point_cloud_support_point_id_batched(dir: Vector, points: &[Vector]) -> usize {
    use crate::math::Vec4;
    let mut best = 0;
    let mut value = points[0].dot(dir);
    let dx = Vec4::splat(dir.x);
    let dy = Vec4::splat(dir.y);
    let dz = Vec4::splat(dir.z);
    let mut index = 1;
    while index + 4 <= points.len() {
        let p = &points[index..index + 4];
        let x = Vec4::new(p[0].x, p[1].x, p[2].x, p[3].x);
        let y = Vec4::new(p[0].y, p[1].y, p[2].y, p[3].y);
        let z = Vec4::new(p[0].z, p[1].z, p[2].z, p[3].z);
        // Same multiplication/addition order as Vec3::dot, across four points.
        let dots = ((x * dx + y * dy) + z * dz).to_array();
        for k in 0..4 {
            if dots[k] > value {
                value = dots[k];
                best = index + k;
            }
        }
        index += 4;
    }
    for (i, p) in points.iter().enumerate().skip(index) {
        let dot = p.dot(dir);
        if dot > value {
            value = dot;
            best = i;
        }
    }
    best
}

// Keep eight independent maxima in registers. The final merge explicitly
// chooses the earliest equal maximum, preserving the scalar support index.
#[cfg(all(
    feature = "dim3",
    feature = "f32",
    target_arch = "x86_64",
    target_feature = "avx2",
    feature = "x86-support-batch"
))]
#[inline]
fn support_avx2(dir: Vector, points: &[Vector]) -> usize {
    use core::arch::x86_64::*;
    let mut best = 0;
    let mut value = points[0].dot(dir);
    let mut index = 1;
    // The compile-time target guarantees AVX2. Every eight-point read is
    // bounds-checked; unaligned stores target full, local eight-lane arrays.
    unsafe {
        let dx = _mm256_set1_ps(dir.x);
        let dy = _mm256_set1_ps(dir.y);
        let dz = _mm256_set1_ps(dir.z);
        let mut maxima = _mm256_set1_ps(value);
        let mut ids = _mm256_setzero_si256();
        while index + 8 <= points.len() {
            let p = &points[index..index + 8];
            let x = _mm256_setr_ps(
                p[0].x, p[1].x, p[2].x, p[3].x, p[4].x, p[5].x, p[6].x, p[7].x,
            );
            let y = _mm256_setr_ps(
                p[0].y, p[1].y, p[2].y, p[3].y, p[4].y, p[5].y, p[6].y, p[7].y,
            );
            let z = _mm256_setr_ps(
                p[0].z, p[1].z, p[2].z, p[3].z, p[4].z, p[5].z, p[6].z, p[7].z,
            );
            // No fused multiply-add or reordered sum: match Vec3::dot exactly.
            let dots = _mm256_add_ps(
                _mm256_add_ps(_mm256_mul_ps(x, dx), _mm256_mul_ps(y, dy)),
                _mm256_mul_ps(z, dz),
            );
            let greater = _mm256_cmp_ps::<_CMP_GT_OQ>(dots, maxima);
            maxima = _mm256_blendv_ps(maxima, dots, greater);
            let current = _mm256_setr_epi32(
                index as i32,
                (index + 1) as i32,
                (index + 2) as i32,
                (index + 3) as i32,
                (index + 4) as i32,
                (index + 5) as i32,
                (index + 6) as i32,
                (index + 7) as i32,
            );
            ids = _mm256_blendv_epi8(ids, current, _mm256_castps_si256(greater));
            index += 8;
        }
        let mut values = [0.0f32; 8];
        let mut indices = [0u32; 8];
        _mm256_storeu_ps(values.as_mut_ptr(), maxima);
        _mm256_storeu_si256(indices.as_mut_ptr().cast(), ids);
        for lane in 0..8 {
            let id = indices[lane] as usize;
            if values[lane] > value || (values[lane] == value && id < best) {
                value = values[lane];
                best = id;
            }
        }
    }
    for (i, p) in points.iter().enumerate().skip(index) {
        let dot = p.dot(dir);
        if dot > value {
            value = dot;
            best = i;
        }
    }
    best
}
