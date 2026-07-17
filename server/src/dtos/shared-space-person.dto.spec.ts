import { SharedSpacePersonMergeDto } from 'src/dtos/shared-space-person.dto';

// A valid v4 UUID for index i — uniqueness is not required for the length checks, only a valid format.
const uuids = (n: number) =>
  Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

// Same guardrail as the personal/scoped merges: an unbounded source array holds the instance-wide merge advisory
// lock while doing one DB round-trip per source, so the count is capped at 20 (design §5.2 row 6).
describe('SharedSpacePersonMergeDto source cap', () => {
  it('accepts up to 20 ids', () => {
    expect(SharedSpacePersonMergeDto.schema.safeParse({ ids: uuids(20) }).success).toBe(true);
  });

  it('rejects more than 20 ids', () => {
    expect(SharedSpacePersonMergeDto.schema.safeParse({ ids: uuids(21) }).success).toBe(false);
  });
});
