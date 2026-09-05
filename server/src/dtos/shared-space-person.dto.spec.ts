import { SharedSpacePersonMergeDto, SpacePeopleQueryDto } from 'src/dtos/shared-space-person.dto';

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

// S30: the People/Pets filter on shared-space people, statistics, and face-statistics endpoints.
describe('SpacePeopleQueryDto type filter', () => {
  it('accepts a query with type absent', () => {
    expect(SpacePeopleQueryDto.schema.safeParse({}).success).toBe(true);
  });

  it('accepts type: person', () => {
    expect(SpacePeopleQueryDto.schema.safeParse({ type: 'person' }).success).toBe(true);
  });

  it('accepts type: pet', () => {
    expect(SpacePeopleQueryDto.schema.safeParse({ type: 'pet' }).success).toBe(true);
  });

  it('rejects a type outside the person/pet enum (S30)', () => {
    expect(SpacePeopleQueryDto.schema.safeParse({ type: 'dog' }).success).toBe(false);
  });
});
