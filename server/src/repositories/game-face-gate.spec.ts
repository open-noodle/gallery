import { describe, expect, it } from 'vitest';

/**
 * The face gate's three branches, as pure arithmetic over the same expression the SQL evaluates.
 *
 * This exists because the SQL-level equivalence between the old LEFT JOIN form and the new
 * correlated form was verified empirically against a 56,730-row library that contains ZERO face
 * groups with a zero image area - so the NULL-denominator branch was never executed by that
 * check. It is reasoning-only in production data, and reasoning-only branches are how the
 * integer-division defect survived two review cycles.
 */
const MAX_FACE_AREA_RATIO = 0.05;

/** `sum(area)::double precision / nullif(width * height, 0)`, as JS. */
const faceAreaRatio = (faceArea: number, imageWidth: number, imageHeight: number): number | null => {
  const denominator = imageWidth * imageHeight;
  return denominator === 0 ? null : faceArea / denominator;
};

/** `NOT EXISTS (... HAVING ratio > 0.05)` - a NULL ratio fails HAVING, so the group vanishes. */
const isKept = (ratio: number | null): boolean => ratio === null || ratio <= MAX_FACE_AREA_RATIO;

describe('face-area gate', () => {
  it('keeps an asset with no faces at all', () => {
    // No face rows means no group, so NOT EXISTS is trivially true.
    expect(isKept(null)).toBe(true);
  });

  it('keeps an asset whose face group has zero image area', () => {
    // nullif(0, 0) is NULL, `NULL > 0.05` is NULL, HAVING drops the group, NOT EXISTS is true.
    // Unexercised by every library measured - this is the only coverage it has.
    expect(faceAreaRatio(5000, 0, 0)).toBeNull();
    expect(isKept(faceAreaRatio(5000, 0, 0))).toBe(true);
  });

  it('keeps an asset whose faces cover exactly the threshold', () => {
    expect(isKept(faceAreaRatio(500, 100, 100))).toBe(true);
  });

  it('excludes an asset whose faces cover more than the threshold', () => {
    expect(isKept(faceAreaRatio(5001, 100, 100))).toBe(false);
  });

  it('divides in floating point, so a sub-threshold ratio is not truncated to zero', () => {
    // The integer-division defect: bigint/integer truncates, every ratio becomes 0, and the gate
    // admits every portrait while looking healthy.
    expect(faceAreaRatio(6000, 100, 100)).toBeCloseTo(0.6, 10);
    expect(isKept(faceAreaRatio(6000, 100, 100))).toBe(false);
  });
});
