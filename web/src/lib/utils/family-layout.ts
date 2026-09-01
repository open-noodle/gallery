import type { FamilyParticipantDto, FamilyUnionDto } from '@immich/sdk';

// Gallery-fork: family relationships (slice 10, D6). Layout is computed fresh from the graph on
// every render — never stored, and never anchored on a fixed `x, y` — because an arrangement
// centred on one person's root is wrong for anyone rooted elsewhere (D6). This module does the
// generation assignment; `FamilyCanvas.svelte` only turns the result into markup.
//
// It deliberately does NOT recompute clusters (D8.3): it only ever walks the union list it is
// handed, and any union not reachable from `rootId` is silently skipped (never assigned a
// generation) rather than assigned an arbitrary one. Which unions belong to which cluster is the
// server's `getClusters()` — the caller picks a cluster's `rootCandidateId` as `rootId`, and this
// function's own reachability walk over that cluster's unions naturally recovers only that
// cluster's own members. Two different clusters never collide in the same call because a caller
// only ever passes the unions from `getUnions()` filtered to one connected component — see
// `+page.svelte`'s `selectedClusterUnions`.

export type FamilySeatKind = 'known' | 'anonymous' | 'empty';

export interface FamilySeat {
  /** Stable, unique key across the whole layout: the identityId for a known seat (so the SAME
   * person appearing as a partner in several unions — E51 — is added exactly once, deduped by
   * this key), or `${unionId}:${role}:${index}` for an anonymous/empty seat, which is unique per
   * union+slot and never shared with any other union (D3/E30: an anonymous seat carries no
   * identity, so it must never be mistaken for "the same" hidden person elsewhere). */
  key: string;
  kind: FamilySeatKind;
  /** Only ever set for a `known` seat. An `anonymous` or `empty` seat never carries an
   * identityId — redaction must not be reversible from what the client renders (E30). */
  identityId?: string;
}

export interface FamilyLayoutUnion {
  unionId: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  /** The generation partners sit at; children sit at `partnerGeneration + 1`. */
  partnerGeneration: number;
}

export interface FamilyLayoutRow {
  generation: number;
  seats: FamilySeat[];
}

export interface FamilyLayout {
  /** Ascending by generation. */
  rows: FamilyLayoutRow[];
  /** Ascending by generation, then union id. */
  unions: FamilyLayoutUnion[];
}

const isKnown = (participant: FamilyParticipantDto): participant is FamilyParticipantDto & { identityId: string } =>
  participant.identityId !== null;

interface Edge {
  identityId: string;
  deltaGeneration: number;
}

/**
 * Assigns every identity reachable from `rootId` a generation number relative to it, walking
 * only KNOWN participants (an anonymous seat has no identity to link elsewhere, so it can never
 * carry the walk further — it is attached to its union once the union's own generation is known,
 * in the second pass below). Two knowns in the same union are connected: partners at the same
 * generation, a child one generation below its union's partners, and siblings (co-children of one
 * union) at the same generation as each other.
 *
 * Exported (not just used internally by `buildFamilyLayout`) because its key set — "every
 * identity reachable from this anchor" — is exactly a connected component: `/family/+page.ts`
 * reuses it to work out which cluster chip contains the viewer's root, without ever
 * recomputing the cluster LIST itself (that stays server-side, D8.3).
 */
export function assignGenerations(unions: FamilyUnionDto[], rootId: string): Map<string, number> {
  const edges = new Map<string, Edge[]>();
  const addEdge = (from: string, to: string, deltaGeneration: number) => {
    const list = edges.get(from) ?? [];
    list.push({ identityId: to, deltaGeneration });
    edges.set(from, list);
  };

  for (const union of unions) {
    const partners = union.partners.filter((participant) => isKnown(participant));
    const children = union.children.filter((participant) => isKnown(participant));

    for (const a of partners) {
      for (const b of partners) {
        if (a.identityId !== b.identityId) {
          addEdge(a.identityId, b.identityId, 0);
        }
      }
    }
    for (const partner of partners) {
      for (const child of children) {
        addEdge(partner.identityId, child.identityId, 1);
        addEdge(child.identityId, partner.identityId, -1);
      }
    }
    for (const a of children) {
      for (const b of children) {
        if (a.identityId !== b.identityId) {
          addEdge(a.identityId, b.identityId, 0);
        }
      }
    }
  }

  const generationOf = new Map<string, number>([[rootId, 0]]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentGeneration = generationOf.get(current)!;
    for (const edge of edges.get(current) ?? []) {
      if (generationOf.has(edge.identityId)) {
        continue;
      }

      generationOf.set(edge.identityId, currentGeneration + edge.deltaGeneration);
      queue.push(edge.identityId);
    }
  }

  return generationOf;
}

/**
 * Builds a generation-based layout of `unions` around `rootId`. `canContribute` gates whether a
 * union with fewer than two partners renders `empty` seats for the missing slot(s) (A6) — a
 * view-only viewer gets no seat there at all, not a disabled one.
 */
export function buildFamilyLayout(unions: FamilyUnionDto[], rootId: string, canContribute: boolean): FamilyLayout {
  const generationOf = assignGenerations(unions, rootId);

  const seatsByGeneration = new Map<number, FamilySeat[]>();
  const knownAdded = new Set<string>();
  const layoutUnions: FamilyLayoutUnion[] = [];

  const pushSeat = (generation: number, seat: FamilySeat) => {
    const list = seatsByGeneration.get(generation) ?? [];
    list.push(seat);
    seatsByGeneration.set(generation, list);
  };

  const pushKnownOnce = (generation: number, identityId: string) => {
    if (knownAdded.has(identityId)) {
      return;
    }
    knownAdded.add(identityId);
    pushSeat(generation, { key: identityId, kind: 'known', identityId });
  };

  for (const union of unions) {
    const knownPartnerGeneration = union.partners
      .filter((participant) => isKnown(participant))
      .map((participant) => generationOf.get(participant.identityId))
      .find((generation): generation is number => generation !== undefined);
    const knownChildGenerations = union.children
      .filter((participant) => isKnown(participant))
      .map((participant) => generationOf.get(participant.identityId))
      .filter((generation): generation is number => generation !== undefined);

    // A union not reachable from `rootId` at all (neither a partner nor a child resolves to a
    // known generation) belongs to a different cluster entirely — skip it rather than guessing a
    // generation for it. This is what keeps this function scoped to one connected component
    // without ever computing "which cluster is this" itself (D8.3).
    let partnerGeneration = knownPartnerGeneration;
    if (partnerGeneration === undefined && knownChildGenerations.length > 0) {
      partnerGeneration = knownChildGenerations[0]! - 1;
    }
    if (partnerGeneration === undefined) {
      continue;
    }

    layoutUnions.push({
      unionId: union.id,
      status: union.status,
      startDate: union.startDate,
      endDate: union.endDate,
      partnerGeneration,
    });

    for (const [index, participant] of union.partners.entries()) {
      if (isKnown(participant)) {
        pushKnownOnce(partnerGeneration, participant.identityId);
      } else {
        pushSeat(partnerGeneration, { key: `${union.id}:partner:${index}`, kind: 'anonymous' });
      }
    }

    // A6: only a contributor sees the dashed "+ Add a parent" affordance for a missing partner
    // slot — a view-only viewer gets nothing there, not a disabled version of it.
    if (canContribute) {
      for (let index = union.partners.length; index < 2; index++) {
        pushSeat(partnerGeneration, { key: `${union.id}:empty:${index}`, kind: 'empty' });
      }
    }

    for (const [index, participant] of union.children.entries()) {
      if (isKnown(participant)) {
        pushKnownOnce(partnerGeneration + 1, participant.identityId);
      } else {
        pushSeat(partnerGeneration + 1, { key: `${union.id}:child:${index}`, kind: 'anonymous' });
      }
    }
  }

  // The root may belong to no union at all (E63) — still render them alone at generation 0
  // rather than silently dropping the one person the whole layout is centred on.
  if (!knownAdded.has(rootId)) {
    pushKnownOnce(0, rootId);
  }

  const rows: FamilyLayoutRow[] = [...seatsByGeneration]
    .sort(([a], [b]) => a - b)
    .map(([generation, seats]) => ({ generation, seats }));

  layoutUnions.sort((a, b) => a.partnerGeneration - b.partnerGeneration || a.unionId.localeCompare(b.unionId));

  return { rows, unions: layoutUnions };
}

// ── Positioned layout (mockup §1) ───────────────────────────────────────────────────────────
//
// `buildFamilyLayout` above answers "who sits in which generation"; it deliberately says nothing
// about WHERE. The mockup's canvas is a drawn tree — cards at absolute coordinates, children
// centred under the union they belong to, and SVG connectors running partner-to-partner and
// union-to-child with the union pill sitting ON that line. None of that is expressible as
// generation rows alone, which is why this second pass exists rather than the component doing
// arithmetic in markup.
//
// Coordinates are computed per render from the same per-viewer graph (D6) — never stored, for
// exactly the reason a generation assignment isn't: an arrangement centred on one person's root
// is wrong for anyone rooted elsewhere.

/** Mockup §1: `.pcard{width:158px;height:76px}`. Exported so the canvas draws cards at the size
 * the connector maths assumes — a mismatch here shows up as lines that miss the card edge. */
export const FAMILY_CARD_WIDTH = 158;
export const FAMILY_CARD_HEIGHT = 76;

const GAP_X = 22;
/** Mockup: gen rows at y=40 / 230 / 420. */
const ROW_PITCH = 190;
/** Leaves the gutter free for the `Gen −1 / 0 / +1` labels. */
const PADDING_X = 74;
/** Headroom for the top generation's "drop above" zone, which is drawn 62px above the card it
 * targets — at the mockup's own 40px the gesture that adds a parent to the OLDEST generation
 * would be half outside the canvas, which is exactly the row you most often need it on. */
const PADDING_Y = 72;
/** Mockup: children at y=230 with their bus line at y=180. */
const CHILD_BUS_OFFSET = 50;
/** Relaxation sweeps. Enough to settle the trees this feature actually renders; the separation
 * pass runs after every sweep, so stopping early can only ever leave a tree wider than ideal,
 * never overlapping. */
const RELAX_PASSES = 8;

export interface PositionedFamilySeat {
  key: string;
  kind: FamilySeatKind;
  identityId?: string;
  generation: number;
  /** Top-left of the card, in canvas coordinates. */
  x: number;
  y: number;
}

export interface PositionedFamilyUnion {
  unionId: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  /** Centre of the union anchor — where the pill sits and the child bus drops from. */
  x: number;
  /** Top of the union pill. */
  y: number;
  /** Joins the two partner cards, or null when the union has a single seat. */
  partnerPath: string | null;
  /** Drops from the anchor to a horizontal bus and on to each child, or null when childless. */
  childPath: string | null;
}

export interface PositionedFamilyLayout {
  width: number;
  height: number;
  seats: PositionedFamilySeat[];
  unions: PositionedFamilyUnion[];
  /** Gutter label positions, ascending. */
  generations: { generation: number; y: number }[];
}

interface SeatMembership {
  unionId: string;
  role: 'partner' | 'child';
  seatKey: string;
}

/** Recovers which seats belong to which union, using the SAME key derivation `buildFamilyLayout`
 * uses — a known seat is its identityId (so one person shared across three unions is one card,
 * E51), anything else is scoped to its union and slot. Derived rather than returned from
 * `buildFamilyLayout` so that function's shape, and every test written against it, is untouched. */
const collectMemberships = (
  unions: FamilyUnionDto[],
  reachable: Set<string>,
  canContribute: boolean,
): SeatMembership[] => {
  const memberships: SeatMembership[] = [];

  for (const union of unions) {
    if (!reachable.has(union.id)) {
      continue;
    }

    for (const [index, participant] of union.partners.entries()) {
      memberships.push({
        unionId: union.id,
        role: 'partner',
        seatKey: participant.identityId ?? `${union.id}:partner:${index}`,
      });
    }

    // A6: the dashed "+ Add a parent" seat exists only for a contributor, so it only takes part
    // in the layout for one — otherwise a view-only canvas would reserve space for a card it
    // never draws.
    if (canContribute) {
      for (let index = union.partners.length; index < 2; index++) {
        memberships.push({ unionId: union.id, role: 'partner', seatKey: `${union.id}:empty:${index}` });
      }
    }

    for (const [index, participant] of union.children.entries()) {
      memberships.push({
        unionId: union.id,
        role: 'child',
        seatKey: participant.identityId ?? `${union.id}:child:${index}`,
      });
    }
  }

  return memberships;
};

const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;

/**
 * Turns the generation assignment into drawable coordinates.
 *
 * Seats start evenly spaced in their generation's existing order, then relax: children slide to
 * sit under their union's partners, partners slide to sit over their children, and after each
 * sweep a separation pass pushes apart anything that ended up closer than a card width. Averaging
 * is what keeps a person who belongs to several unions (E51) in one place instead of being
 * claimed by whichever union was processed last.
 */
export function buildPositionedFamilyLayout(
  unions: FamilyUnionDto[],
  rootId: string,
  canContribute: boolean,
): PositionedFamilyLayout {
  const base = buildFamilyLayout(unions, rootId, canContribute);
  const reachable = new Set(base.unions.map((union) => union.unionId));
  const memberships = collectMemberships(unions, reachable, canContribute);

  const unionPartners = new Map<string, string[]>();
  const unionChildren = new Map<string, string[]>();
  for (const membership of memberships) {
    const target = membership.role === 'partner' ? unionPartners : unionChildren;
    const list = target.get(membership.unionId) ?? [];
    list.push(membership.seatKey);
    target.set(membership.unionId, list);
  }

  // Seat ORDER within a generation, with partners kept side by side. `buildFamilyLayout` emits
  // seats union by union, which can leave two partners at opposite ends of their row — and since
  // a union's pill hangs at the midpoint of its partners, two unions whose partners straddle each
  // other then resolve to the SAME midpoint and stack their pills on one another. Pairing them up
  // front is what stops that, and it is also simply how a family tree reads: spouses adjacent,
  // with the line between them.
  //
  // Someone in three unions (E51) can only be adjacent to one partner; the rest fall where the
  // relaxation puts them, which is inherent to drawing a graph on a line rather than a defect.
  const blockGeneration = (keys: string[]): string[][] => {
    const inGeneration = new Set(keys);
    const mates = new Map<string, string[]>();
    for (const partners of unionPartners.values()) {
      const local = partners.filter((key) => inGeneration.has(key));
      for (const key of local) {
        mates.set(key, [...(mates.get(key) ?? []), ...local.filter((other) => other !== key)]);
      }
    }

    const taken = new Set<string>();
    const blocks: string[][] = [];
    for (const key of keys) {
      if (taken.has(key)) {
        continue;
      }
      taken.add(key);
      const block = [key];
      for (const mate of mates.get(key) ?? []) {
        if (taken.has(mate)) {
          continue;
        }
        taken.add(mate);
        block.push(mate);
      }
      blocks.push(block);
    }
    return blocks;
  };

  const centreX = new Map<string, number>();
  const rowIndexOf = new Map<number, number>();
  const keysByGeneration = new Map<number, string[]>();

  const blocksByGeneration = new Map<number, string[][]>();

  for (const [rowIndex, row] of base.rows.entries()) {
    rowIndexOf.set(row.generation, rowIndex);
    const blocks = blockGeneration(row.seats.map((seat) => seat.key));
    const ordered = blocks.flat();
    blocksByGeneration.set(row.generation, blocks);
    keysByGeneration.set(row.generation, ordered);
    for (const [seatIndex, key] of ordered.entries()) {
      centreX.set(key, seatIndex * (FAMILY_CARD_WIDTH + GAP_X) + FAMILY_CARD_WIDTH / 2);
    }
  }

  /** Re-seats every couple side by side around wherever the relaxation has drifted them. The
   * barycentre sweeps move people one at a time — a partner who is also somebody's child gets
   * pulled towards their own parents — so without this a couple slowly separates and the pill
   * that hangs at their midpoint ends up over whoever is standing between them. */
  const collapseBlocks = (generation: number) => {
    for (const block of blocksByGeneration.get(generation) ?? []) {
      if (block.length < 2) {
        continue;
      }
      const centre = mean(block.map((key) => centreX.get(key)!));
      const pitch = FAMILY_CARD_WIDTH + GAP_X;
      const start = centre - ((block.length - 1) * pitch) / 2;
      for (const [index, key] of block.entries()) {
        centreX.set(key, start + index * pitch);
      }
    }
  };

  const shift = (keys: string[], desired: number) => {
    const delta = desired - mean(keys.map((key) => centreX.get(key)!));
    for (const key of keys) {
      centreX.set(key, centreX.get(key)! + delta);
    }
  };

  const separate = (generation: number) => {
    const keys = [...(keysByGeneration.get(generation) ?? [])].sort((a, b) => centreX.get(a)! - centreX.get(b)!);
    for (let index = 1; index < keys.length; index++) {
      const minimum = centreX.get(keys[index - 1]!)! + FAMILY_CARD_WIDTH + GAP_X;
      if (centreX.get(keys[index]!)! < minimum) {
        centreX.set(keys[index]!, minimum);
      }
    }
  };

  const generations = base.rows.map((row) => row.generation);

  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    for (const generation of generations) {
      for (const union of base.unions) {
        if (union.partnerGeneration + 1 !== generation) {
          continue;
        }
        const partners = unionPartners.get(union.unionId) ?? [];
        const children = unionChildren.get(union.unionId) ?? [];
        if (partners.length > 0 && children.length > 0) {
          shift(children, mean(partners.map((key) => centreX.get(key)!)));
        }
      }
      collapseBlocks(generation);
      separate(generation);
    }

    for (const generation of [...generations].reverse()) {
      for (const union of base.unions) {
        if (union.partnerGeneration !== generation) {
          continue;
        }
        const partners = unionPartners.get(union.unionId) ?? [];
        const children = unionChildren.get(union.unionId) ?? [];
        if (partners.length > 0 && children.length > 0) {
          shift(partners, mean(children.map((key) => centreX.get(key)!)));
        }
      }
      collapseBlocks(generation);
      separate(generation);
    }
  }

  // Normalise so the leftmost card lands on the gutter padding rather than at some arbitrary
  // negative offset left over from the relaxation.
  const allCentres = [...centreX.values()];
  const offset = allCentres.length > 0 ? PADDING_X + FAMILY_CARD_WIDTH / 2 - Math.min(...allCentres) : 0;
  for (const [key, value] of centreX) {
    centreX.set(key, value + offset);
  }

  const yOfGeneration = (generation: number) => PADDING_Y + rowIndexOf.get(generation)! * ROW_PITCH;

  const seats: PositionedFamilySeat[] = base.rows.flatMap((row) =>
    row.seats.map((seat) => ({
      key: seat.key,
      kind: seat.kind,
      identityId: seat.identityId,
      generation: row.generation,
      x: centreX.get(seat.key)! - FAMILY_CARD_WIDTH / 2,
      y: yOfGeneration(row.generation),
    })),
  );

  const positionedUnions: PositionedFamilyUnion[] = base.unions.map((union) => {
    const partners = unionPartners.get(union.unionId) ?? [];
    const children = unionChildren.get(union.unionId) ?? [];
    const partnerRowY = yOfGeneration(union.partnerGeneration);
    const midY = partnerRowY + FAMILY_CARD_HEIGHT / 2;

    const anchorKeys = partners.length > 0 ? partners : children;
    const anchorX = anchorKeys.length > 0 ? mean(anchorKeys.map((key) => centreX.get(key)!)) : PADDING_X;

    // Mockup: a short horizontal run between the two partner cards, at card mid-height, with the
    // pill sitting on it. Drawn from card EDGE to card EDGE so it never crosses a card.
    let partnerPath: string | null = null;
    if (partners.length === 2) {
      const [left, right] = partners.map((key) => centreX.get(key)!).sort((a, b) => a - b) as [number, number];
      const from = left + FAMILY_CARD_WIDTH / 2;
      const to = right - FAMILY_CARD_WIDTH / 2;
      if (to > from) {
        partnerPath = `M${from} ${midY} L${to} ${midY}`;
      }
    }

    // Anchor down to a horizontal bus, then a drop onto the top of every child card.
    let childPath: string | null = null;
    if (children.length > 0 && rowIndexOf.has(union.partnerGeneration + 1)) {
      const childRowY = yOfGeneration(union.partnerGeneration + 1);
      const busY = childRowY - CHILD_BUS_OFFSET;
      const childCentres = children.map((key) => centreX.get(key)!);
      const segments = [`M${anchorX} ${midY} L${anchorX} ${busY}`];
      if (childCentres.length > 1) {
        segments.push(`M${Math.min(...childCentres)} ${busY} L${Math.max(...childCentres)} ${busY}`);
      }
      for (const childCentre of childCentres) {
        segments.push(`M${childCentre} ${busY} L${childCentre} ${childRowY}`);
      }
      childPath = segments.join(' ');
    }

    return {
      unionId: union.unionId,
      status: union.status,
      startDate: union.startDate,
      endDate: union.endDate,
      x: anchorX,
      y: partnerRowY + FAMILY_CARD_HEIGHT + 8,
      partnerPath,
      childPath,
    };
  });

  const width = seats.length > 0 ? Math.max(...seats.map((seat) => seat.x + FAMILY_CARD_WIDTH)) + PADDING_X : 0;
  const height = seats.length > 0 ? Math.max(...seats.map((seat) => seat.y + FAMILY_CARD_HEIGHT)) + PADDING_Y : 0;

  return {
    width,
    height,
    seats,
    unions: positionedUnions,
    generations: base.rows.map((row) => ({ generation: row.generation, y: yOfGeneration(row.generation) })),
  };
}
