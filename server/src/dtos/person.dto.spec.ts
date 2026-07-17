import { MergePersonDto, MergeScopedPeopleDto } from 'src/dtos/person.dto';

// A valid v4 UUID for index i — uniqueness is not required for the length checks, only a valid format.
const uuidAt = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const uuids = (n: number) => Array.from({ length: n }, (_, i) => uuidAt(i));
const personRefs = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'person' as const, id: uuidAt(i) }));

// The merge endpoints acquire the instance-wide merge advisory lock and then do one DB round-trip per source
// while holding it, so an unbounded source array is an authenticated denial-of-service. The source count is
// capped at 20 (design §5.2 row 6; the web UI caps at 5).
describe('MergePersonDto source cap', () => {
  it('accepts up to 20 ids', () => {
    expect(MergePersonDto.schema.safeParse({ ids: uuids(20) }).success).toBe(true);
  });

  it('rejects more than 20 ids', () => {
    expect(MergePersonDto.schema.safeParse({ ids: uuids(21) }).success).toBe(false);
  });
});

describe('MergeScopedPeopleDto source cap', () => {
  const target = { type: 'person' as const, id: uuidAt(999) };

  it('accepts up to 20 sources', () => {
    expect(MergeScopedPeopleDto.schema.safeParse({ target, sources: personRefs(20) }).success).toBe(true);
  });

  it('rejects more than 20 sources', () => {
    expect(MergeScopedPeopleDto.schema.safeParse({ target, sources: personRefs(21) }).success).toBe(false);
  });
});
