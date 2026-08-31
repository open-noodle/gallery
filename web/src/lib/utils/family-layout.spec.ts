import { FamilyParticipantKind, FamilyUnionStatus, type FamilyUnionDto } from '@immich/sdk';
import { buildFamilyLayout } from '$lib/utils/family-layout';

const known = (identityId: string) => ({ kind: FamilyParticipantKind.Known, identityId });
const anonymous = () => ({ kind: FamilyParticipantKind.Anonymous, identityId: null });

const union = (overrides: Partial<FamilyUnionDto> & Pick<FamilyUnionDto, 'id'>): FamilyUnionDto => ({
  status: FamilyUnionStatus.Partnered,
  startDate: null,
  endDate: null,
  partners: [],
  children: [],
  ...overrides,
});

describe('buildFamilyLayout', () => {
  // E51 — the layout case that actually breaks naive generational layout: one person belongs to
  // three unions. Every card must appear exactly once, at one generation, with no two seats
  // sharing a rendering key (the layout's proxy for "does not overlap").
  it('renders a person who belongs to three unions without overlapping cards', () => {
    const unions: FamilyUnionDto[] = [
      union({ id: 'u1', partners: [known('sam'), known('partnerA')], children: [known('kid1')] }),
      union({ id: 'u2', partners: [known('sam'), known('partnerB')], children: [known('kid2')] }),
      union({ id: 'u3', partners: [known('sam'), known('partnerC')], children: [known('kid3')] }),
    ];

    const layout = buildFamilyLayout(unions, 'sam', false);

    const allKeys = layout.rows.flatMap((row) => row.seats.map((seat) => seat.key));
    expect(allKeys).toHaveLength(new Set(allKeys).size); // every key unique — no duplicate slot

    const samOccurrences = allKeys.filter((key) => key === 'sam');
    expect(samOccurrences).toHaveLength(1);

    const partnerGenerationRow = layout.rows.find((row) => row.seats.some((seat) => seat.key === 'sam'));
    expect(partnerGenerationRow?.seats.map((seat) => seat.key).sort()).toEqual(
      ['partnerA', 'partnerB', 'partnerC', 'sam'].sort(),
    );

    const childRow = layout.rows.find((row) => row.generation === (partnerGenerationRow?.generation ?? 0) + 1);
    expect(childRow?.seats.map((seat) => seat.key).sort()).toEqual(['kid1', 'kid2', 'kid3'].sort());

    expect(layout.unions.map((u) => u.unionId).sort()).toEqual(['u1', 'u2', 'u3']);
  });

  it('gives an anonymous participant a per-union slot key and no identityId', () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root'), anonymous()], children: [] })];

    const layout = buildFamilyLayout(unions, 'root', false);
    const seats = layout.rows.flatMap((row) => row.seats);
    const anonymousSeat = seats.find((seat) => seat.kind === 'anonymous');

    expect(anonymousSeat).toBeDefined();
    expect(anonymousSeat?.identityId).toBeUndefined();
    expect(anonymousSeat?.key).toBe('u1:partner:1');
  });

  it('adds an empty seat for a missing partner only when contribution is allowed', () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root')], children: [] })];

    const withContribute = buildFamilyLayout(unions, 'root', true);
    const withoutContribute = buildFamilyLayout(unions, 'root', false);

    const emptySeats = withContribute.rows.flatMap((row) => row.seats).filter((seat) => seat.kind === 'empty');
    expect(emptySeats).toHaveLength(1);
    expect(emptySeats[0]?.key).toBe('u1:empty:1');

    const noEmptySeats = withoutContribute.rows.flatMap((row) => row.seats).filter((seat) => seat.kind === 'empty');
    expect(noEmptySeats).toHaveLength(0);
  });

  it('skips a union that is not reachable from the root, instead of guessing a generation for it', () => {
    const unions: FamilyUnionDto[] = [
      union({ id: 'u1', partners: [known('root'), known('spouse')], children: [] }),
      union({ id: 'u2', partners: [known('stranger1'), known('stranger2')], children: [] }),
    ];

    const layout = buildFamilyLayout(unions, 'root', false);

    expect(layout.unions.map((u) => u.unionId)).toEqual(['u1']);
    const allKeys = layout.rows.flatMap((row) => row.seats.map((seat) => seat.key));
    expect(allKeys).not.toContain('stranger1');
    expect(allKeys).not.toContain('stranger2');
  });

  it('still renders the root alone when they belong to no union at all (E63)', () => {
    const layout = buildFamilyLayout([], 'lonely', false);

    expect(layout.rows).toHaveLength(1);
    expect(layout.rows[0]?.seats).toEqual([{ key: 'lonely', kind: 'known', identityId: 'lonely' }]);
  });

  it('carries the union status and dates through for the connector pill', () => {
    const unions: FamilyUnionDto[] = [
      union({
        id: 'u1',
        status: FamilyUnionStatus.Divorced,
        startDate: '1988-01-01',
        endDate: '2007-01-01',
        partners: [known('a'), known('b')],
        children: [],
      }),
    ];

    const layout = buildFamilyLayout(unions, 'a', false);

    expect(layout.unions).toEqual([
      {
        unionId: 'u1',
        status: FamilyUnionStatus.Divorced,
        startDate: '1988-01-01',
        endDate: '2007-01-01',
        partnerGeneration: 0,
      },
    ]);
  });
});
