import { FamilyParticipantKind, FamilyUnionStatus, type FamilyUnionDto } from '@immich/sdk';
import {
  buildFamilyLayout,
  buildPositionedFamilyLayout,
  FAMILY_CARD_HEIGHT,
  FAMILY_CARD_WIDTH,
  type PositionedFamilyLayout,
} from '$lib/utils/family-layout';

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

// The second pass: generation rows turned into drawable coordinates. These are the properties the
// mockup's tree actually depends on — cards that don't collide, children hanging under the union
// they belong to, and a connector for every relationship that has one.
describe('buildPositionedFamilyLayout', () => {
  const seatFor = (layout: PositionedFamilyLayout, key: string) => layout.seats.find((seat) => seat.key === key)!;
  const centreOf = (layout: PositionedFamilyLayout, key: string) => seatFor(layout, key).x + FAMILY_CARD_WIDTH / 2;

  it('never overlaps two cards in the same generation', () => {
    const unions: FamilyUnionDto[] = [
      union({ id: 'u1', partners: [known('sam'), known('partnerA')], children: [known('kid1')] }),
      union({ id: 'u2', partners: [known('sam'), known('partnerB')], children: [known('kid2')] }),
      union({ id: 'u3', partners: [known('sam'), known('partnerC')], children: [known('kid3')] }),
    ];

    const layout = buildPositionedFamilyLayout(unions, 'sam', false);

    const byGeneration = new Map<number, typeof layout.seats>();
    for (const seat of layout.seats) {
      byGeneration.set(seat.generation, [...(byGeneration.get(seat.generation) ?? []), seat]);
    }

    for (const seats of byGeneration.values()) {
      const ordered = [...seats].sort((a, b) => a.x - b.x);
      for (let index = 1; index < ordered.length; index++) {
        expect(ordered[index]!.x).toBeGreaterThanOrEqual(ordered[index - 1]!.x + FAMILY_CARD_WIDTH);
      }
    }
  });

  it('puts every generation on its own row, ordered top to bottom', () => {
    const unions: FamilyUnionDto[] = [
      union({ id: 'u1', partners: [known('gran')], children: [known('parent')] }),
      union({ id: 'u2', partners: [known('parent')], children: [known('kid')] }),
    ];

    const layout = buildPositionedFamilyLayout(unions, 'parent', false);

    expect(seatFor(layout, 'gran').y).toBeLessThan(seatFor(layout, 'parent').y);
    expect(seatFor(layout, 'parent').y).toBeLessThan(seatFor(layout, 'kid').y);
  });

  // The visual claim the whole tree rests on: an only child sits under its parents, not off to
  // one side of them.
  it('centres a child under the union it belongs to', () => {
    const unions: FamilyUnionDto[] = [
      union({ id: 'u1', partners: [known('ruth'), known('anton')], children: [known('alex')] }),
    ];

    const layout = buildPositionedFamilyLayout(unions, 'alex', false);

    const parentsCentre = (centreOf(layout, 'ruth') + centreOf(layout, 'anton')) / 2;
    expect(centreOf(layout, 'alex')).toBeCloseTo(parentsCentre, 0);
  });

  it('hangs the union pill between its two partners', () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('ruth'), known('anton')], children: [] })];

    const layout = buildPositionedFamilyLayout(unions, 'ruth', false);

    const [left, right] = [centreOf(layout, 'ruth'), centreOf(layout, 'anton')].sort((a, b) => a - b);
    const pill = layout.unions[0]!;
    expect(pill.x).toBeGreaterThan(left!);
    expect(pill.x).toBeLessThan(right!);
    // …and below the cards it joins, not on top of them.
    expect(pill.y).toBeGreaterThan(seatFor(layout, 'ruth').y);
  });

  it('draws a partner connector only when there are two partners to join', () => {
    const paired = buildPositionedFamilyLayout(
      [union({ id: 'u1', partners: [known('a'), known('b')], children: [] })],
      'a',
      false,
    );
    expect(paired.unions[0]!.partnerPath).not.toBeNull();

    // A one-partner union is legal — the second seat was simply never recorded — and has nothing
    // to join. `canContribute: false` so no dashed "add a parent" seat stands in for the missing one.
    const single = buildPositionedFamilyLayout(
      [union({ id: 'u2', partners: [known('a')], children: [known('c')] })],
      'a',
      false,
    );
    expect(single.unions[0]!.partnerPath).toBeNull();
  });

  it('draws a child connector only when the union has children', () => {
    const withChildren = buildPositionedFamilyLayout(
      [union({ id: 'u1', partners: [known('a'), known('b')], children: [known('c')] })],
      'a',
      false,
    );
    expect(withChildren.unions[0]!.childPath).toContain('M');

    const childless = buildPositionedFamilyLayout(
      [union({ id: 'u2', partners: [known('a'), known('b')], children: [] })],
      'a',
      false,
    );
    expect(childless.unions[0]!.childPath).toBeNull();
  });

  // Connector paths are only worth drawing if they actually meet. Asserting a path merely EXISTS
  // (`childPath` is non-null) passed happily while the tree rendered with lines hanging in mid-air,
  // so these walk the segments and check the joins.
  const segmentsOf = (path: string) =>
    path
      .split('M')
      .filter(Boolean)
      .map((run) => {
        const [from, to] = run.trim().split('L', 2);
        const [x1, y1] = from.trim().split(/\s+/).map(Number) as [number, number];
        const [x2, y2] = to.trim().split(/\s+/).map(Number) as [number, number];
        return { x1, y1, x2, y2 };
      });

  type Segment = { x1: number; y1: number; x2: number; y2: number };

  /** Whether an axis-aligned segment passes through a point — anywhere along it, not just at its
   * ends. A vertical meeting the middle of the bus is a T-junction, which is a perfectly good
   * join; only requiring shared ENDPOINTS would reject it. */
  const passesThrough = (segment: Segment, x: number, y: number) => {
    const within = (value: number, a: number, b: number) =>
      value >= Math.min(a, b) - 0.5 && value <= Math.max(a, b) + 0.5;
    return (
      within(x, segment.x1, segment.x2) &&
      within(y, segment.y1, segment.y2) &&
      // On the line itself: one axis must be constant and match.
      ((Math.abs(segment.x1 - segment.x2) < 0.5 && Math.abs(x - segment.x1) < 0.5) ||
        (Math.abs(segment.y1 - segment.y2) < 0.5 && Math.abs(y - segment.y1) < 0.5))
    );
  };

  /** Every endpoint of every segment must meet another segment, or be a real terminus: the union
   * anchor it descends from, or the top of a child card it lands on. A connector that fails this
   * is drawn hanging in mid-air. */
  const assertConnected = (layout: PositionedFamilyLayout) => {
    for (const union of layout.unions) {
      if (!union.childPath) {
        continue;
      }
      const segments = segmentsOf(union.childPath);

      for (const [index, segment] of segments.entries()) {
        const endpoints = [
          { x: segment.x1, y: segment.y1 },
          { x: segment.x2, y: segment.y2 },
        ];

        for (const point of endpoints) {
          const isAnchorTop = Math.abs(point.x - union.x) < 0.5 && point.y < union.y;
          const landsOnACard = layout.seats.some(
            (seat) => Math.abs(seat.x + FAMILY_CARD_WIDTH / 2 - point.x) < 0.5 && Math.abs(seat.y - point.y) < 0.5,
          );
          if (isAnchorTop || landsOnACard) {
            continue;
          }

          const joined = segments.some(
            (other, otherIndex) => otherIndex !== index && passesThrough(other, point.x, point.y),
          );
          expect(joined, `union ${union.unionId}: (${Math.round(point.x)}, ${Math.round(point.y)}) joins nothing`).toBe(
            true,
          );
        }
      }
    }
  };

  // The bus used to span only min(children)..max(children). A lone child is rarely directly under
  // its parents midpoint, so the drop from the union ended in mid-air with a visible gap.
  it('joins a union to its only child even when the child is not directly below it', () => {
    const unions: FamilyUnionDto[] = [
      // Two grandparents whose single child is also partnered, which drags the child sideways and
      // leaves the anchor well outside the child span.
      union({ id: 'u-gp', partners: [known('gp1'), known('gp2')], children: [known('ivan')] }),
      union({ id: 'u-ivan', partners: [known('ivan'), known('nell')], children: [known('kid')] }),
    ];

    const layout = buildPositionedFamilyLayout(unions, 'ivan', false);

    assertConnected(layout);
  });

  it('joins a union to children that sit entirely to one side of it', () => {
    const unions: FamilyUnionDto[] = [
      union({ id: 'u-a', partners: [known('p1'), known('p2')], children: [known('c1'), known('c2')] }),
      // c1 is partnered far to the left, dragging both children off the parents centre.
      union({ id: 'u-b', partners: [known('c1'), known('spouse')], children: [] }),
    ];

    const layout = buildPositionedFamilyLayout(unions, 'c1', true);

    assertConnected(layout);
  });

  it('joins every connector in the mockup family', () => {
    assertConnected(buildPositionedFamilyLayout(mockupFamily(), 'alex', false));
  });

  it('sizes the canvas to hold every card it laid out', () => {
    const unions: FamilyUnionDto[] = [
      union({ id: 'u1', partners: [known('a'), known('b')], children: [known('c'), known('d')] }),
    ];

    const layout = buildPositionedFamilyLayout(unions, 'a', false);

    for (const seat of layout.seats) {
      expect(seat.x + FAMILY_CARD_WIDTH).toBeLessThanOrEqual(layout.width);
      expect(seat.y + FAMILY_CARD_HEIGHT).toBeLessThanOrEqual(layout.height);
      expect(seat.x).toBeGreaterThanOrEqual(0);
    }
  });

  // The mockup's own family, and the case that exposed both bugs below: Ruth+Anton have Lena and
  // Alex; Anton remarried Vera; Mia's only recorded parent is Bram; Lena and Alex are each
  // partnered in turn. Every generation here holds someone who is simultaneously somebody's
  // child and somebody's partner, which is what pulls a couple apart.
  const mockupFamily = (): FamilyUnionDto[] => [
    union({ id: 'u-ruth-anton', partners: [known('ruth'), known('anton')], children: [known('lena'), known('alex')] }),
    union({ id: 'u-anton-vera', partners: [known('anton'), known('vera')], children: [known('nico')] }),
    union({ id: 'u-bram', partners: [known('bram')], children: [known('mia')] }),
    union({ id: 'u-lena-oskar', partners: [known('lena'), known('oskar')], children: [known('juno')] }),
    union({ id: 'u-alex-mia', partners: [known('alex'), known('mia')], children: [known('iris'), known('theo')] }),
  ];

  // A couple is drawn side by side with the union pill on the line between them. When the two
  // drift apart the pill ends up hanging over whoever is standing in the gap.
  it('seats a couple side by side even when each is also somebody child', () => {
    const layout = buildPositionedFamilyLayout(mockupFamily(), 'alex', false);

    for (const [a, b] of [
      ['alex', 'mia'],
      ['lena', 'oskar'],
      ['ruth', 'anton'],
    ]) {
      const first = layout.seats.find((seat) => seat.key === a)!;
      const second = layout.seats.find((seat) => seat.key === b)!;
      expect(first.y).toBe(second.y);
      expect(Math.abs(first.x - second.x)).toBeLessThanOrEqual(FAMILY_CARD_WIDTH + 40);
    }
  });

  // Two unions whose partners straddled each other used to resolve to the SAME midpoint, stacking
  // one pill exactly on top of the other — two relationships rendered as one illegible chip.
  it('never hangs two union pills on the same point', () => {
    const layout = buildPositionedFamilyLayout(mockupFamily(), 'alex', false);

    const points = layout.unions.map((union) => `${Math.round(union.x)}:${Math.round(union.y)}`);
    expect(new Set(points).size).toBe(points.length);
  });

  // A6 again, but at the layout level: the dashed seat must not reserve space for a viewer who
  // will never see it drawn.
  it('reserves no space for the add-a-parent seat when the viewer may not contribute', () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('a')], children: [known('c')] })];

    const viewOnly = buildPositionedFamilyLayout(unions, 'a', false);
    const contributor = buildPositionedFamilyLayout(unions, 'a', true);

    expect(viewOnly.seats.filter((seat) => seat.kind === 'empty')).toHaveLength(0);
    expect(contributor.seats.filter((seat) => seat.kind === 'empty')).toHaveLength(1);
  });
});
