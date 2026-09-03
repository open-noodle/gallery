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

/** The mockup's `.pcard` is 158×76, sized around labels as short as "your parent". Real ones are
 * not: "Gudrin's partner" and "your niece's child" are what the label engine actually derives, and
 * at 158px they were cut off mid-word. Wider, and tall enough for the relation to take a second
 * line, so the derived label — the whole point of the feature — is legible.
 *
 * Exported so the canvas draws cards at the size the connector maths assumes; a mismatch here
 * shows up as lines that miss the card edge. */
export const FAMILY_CARD_WIDTH = 210;
export const FAMILY_CARD_HEIGHT = 88;

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
  /** The union this seat belongs to, for the seats that belong to exactly one: an `empty` slot is
   * an invitation to add a partner to THAT union, so the canvas needs to know which. A `known`
   * seat is deliberately without one — the same person can sit in several unions (E51) and is
   * drawn once. */
  unionId?: string;
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
        const existing = mates.get(key) ?? [];
        mates.set(key, [...existing, ...local.filter((other) => other !== key && !existing.includes(other))]);
      }
    }

    // A block is a whole CHAIN of partners, not just a pair. Someone in two unions (Anton married
    // Ruth, then Vera) can only be adjacent to one of them if blocks cap at two — the other partner
    // is cast adrift, a stranger drifts into the gap, and the second union's pill, which hangs at
    // the midpoint of its partners, lands on top of that stranger and of any other union whose
    // midpoint happens to agree. Seating the chain Ruth-Anton-Vera keeps every pill over the two
    // people it actually joins.
    //
    // Walking from an endpoint (someone with a single partner) is what makes a chain come out in
    // path order rather than starting in the middle. A hub with three or more partners has no path
    // order to find; it leads, and its partners follow.
    const degree = (key: string) => (mates.get(key) ?? []).length;
    const taken = new Set<string>();
    const blocks: string[][] = [];

    for (const seed of keys) {
      if (taken.has(seed)) {
        continue;
      }

      // Collect the connected component first, so the walk can start at one of its ends.
      const component: string[] = [];
      const queue = [seed];
      const seen = new Set([seed]);
      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);
        for (const mate of mates.get(current) ?? []) {
          if (seen.has(mate)) {
            continue;
          }
          seen.add(mate);
          queue.push(mate);
        }
      }

      const start = component.find((key) => degree(key) === 1) ?? component[0]!;
      const block: string[] = [];
      const stack = [start];
      const emitted = new Set<string>();
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (emitted.has(current)) {
          continue;
        }
        emitted.add(current);
        taken.add(current);
        block.push(current);
        // Lowest degree first: a chain's continuation before a hub's other spokes.
        const next = [...(mates.get(current) ?? [])]
          .filter((mate) => !emitted.has(mate))
          .sort((a, b) => degree(b) - degree(a));
        stack.push(...next);
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

  const PITCH = FAMILY_CARD_WIDTH + GAP_X;

  const blockWidth = (block: string[]) => block.length * FAMILY_CARD_WIDTH + (block.length - 1) * GAP_X;
  const blockCentre = (block: string[]) => mean(block.map((key) => centreX.get(key)!));

  /** Seats a block's members side by side around `centre`, which is what keeps a couple together:
   * the pill hangs at their midpoint, so a couple that drifts apart puts its pill over whoever is
   * standing in the gap. */
  const setBlockCentre = (block: string[], centre: number) => {
    const start = centre - ((block.length - 1) * PITCH) / 2;
    for (const [index, key] of block.entries()) {
      centreX.set(key, start + index * PITCH);
    }
  };

  /**
   * Where a block would sit if nothing were in its way: the average of every pull on it — the
   * anchor of each union its members are a CHILD of, and the centre of the children of each union
   * they are a PARTNER in. A person who is both (most people, once a tree has three generations)
   * is drawn between their parents and their own children rather than being claimed by whichever
   * was processed last.
   */
  const desiredCentre = (block: string[]): number => {
    const members = new Set(block);
    const pulls: number[] = [];

    for (const union of base.unions) {
      const partners = unionPartners.get(union.unionId) ?? [];
      const children = unionChildren.get(union.unionId) ?? [];
      if (partners.length === 0 || children.length === 0) {
        continue;
      }
      if (partners.some((key) => members.has(key))) {
        pulls.push(mean(children.map((key) => centreX.get(key)!)));
      }
      if (children.some((key) => members.has(key))) {
        pulls.push(mean(partners.map((key) => centreX.get(key)!)));
      }
    }

    return pulls.length > 0 ? mean(pulls) : blockCentre(block);
  };

  /**
   * Re-packs one generation from scratch: every block starts at the position it actually wants and
   * is pushed right only as far as its left neighbour forces it.
   *
   * Recomputing rather than nudging is the whole point. An earlier version shifted blocks by a
   * delta each sweep and then pushed apart whatever collided — but the push only ever moved things
   * RIGHT, so each sweep inherited the last one's drift and the tree widened monotonically. Two
   * siblings ended up a thousand pixels apart with a connector sprawling between them, because
   * one of them was also somebody's partner and got dragged away every pass. Starting from the
   * desired position each time means a pass can give space back, not just take it.
   */
  const packGeneration = (generation: number) => {
    const blocks = blocksByGeneration.get(generation) ?? [];
    if (blocks.length === 0) {
      return;
    }

    const targets = blocks.map((block) => ({ block, desired: desiredCentre(block) }));
    targets.sort((a, b) => a.desired - b.desired);

    let cursor = -Infinity;
    for (const { block, desired } of targets) {
      const half = blockWidth(block) / 2;
      const centre = Math.max(desired, cursor + half);
      setBlockCentre(block, centre);
      cursor = centre + half + GAP_X;
    }
  };

  const generations = base.rows.map((row) => row.generation);

  // Sweep down then up: descendants settle under their parents, then parents re-centre over the
  // descendants that just moved. Repeating both directions is what lets a change at one end of the
  // tree reach the other.
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    for (const generation of generations) {
      packGeneration(generation);
    }
    for (const generation of [...generations].reverse()) {
      packGeneration(generation);
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

  // Only the union-scoped seats: a known seat's key is a bare identity id, shared across every
  // union that person sits in.
  const unionOfSeat = new Map<string, string>();
  for (const membership of memberships) {
    if (membership.seatKey.includes(':')) {
      unionOfSeat.set(membership.seatKey, membership.unionId);
    }
  }

  const seats: PositionedFamilySeat[] = base.rows.flatMap((row) =>
    row.seats.map((seat) => ({
      key: seat.key,
      kind: seat.kind,
      identityId: seat.identityId,
      unionId: unionOfSeat.get(seat.key),
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

      // The bus has to reach the ANCHOR, not just span the children. Drawing it across
      // `min(children)..max(children)` leaves the drop from the union hanging in mid-air whenever
      // the anchor sits outside that span — which is most of the time: a lone child is rarely
      // directly beneath its parents' midpoint, and a couple offset from their children's centre
      // puts the anchor past one end. On screen that reads as connectors that simply do not join
      // up. Including `anchorX` in the span is what makes the path a single connected run.
      const busFrom = Math.min(anchorX, ...childCentres);
      const busTo = Math.max(anchorX, ...childCentres);

      const segments = [`M${anchorX} ${midY} L${anchorX} ${busY}`];
      if (busTo > busFrom) {
        segments.push(`M${busFrom} ${busY} L${busTo} ${busY}`);
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
