import { describe, expect, it } from 'vitest';

/**
 * The face gate's three branches, as pure arithmetic - documenting intended semantics, NOT
 * verifying the emitted query. This is a duplicate implementation of the ratio in JS, asserted
 * against itself: it writes down what should happen (no faces -> kept, zero image area -> kept,
 * ratio over threshold -> excluded, floating-point not integer division) and will keep passing
 * unchanged even if the SQL regresses on any of those, because nothing here reads
 * src/queries/game.repository.sql.
 *
 * What actually verifies the emitted query: the static SQL-shape guards in
 * game.repository.spec.ts's `describe('generated query shape')` block - "divides the face-area
 * ratio in floating point, not integer arithmetic" and "scopes the face-area aggregate to the
 * candidate rows, not the whole asset_face table" - which read the generated SQL directly.
 *
 * This file exists because a reasoning-only check is how the integer-division defect survived two
 * review cycles undetected in the first place, and the zero-image-area branch below has no
 * coverage anywhere else: the SQL-level equivalence between the old LEFT JOIN form and the new
 * correlated form was verified empirically against a 56,730-row library that contains ZERO face
 * groups with a zero image area, so that branch was never exercised by that check either.
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
