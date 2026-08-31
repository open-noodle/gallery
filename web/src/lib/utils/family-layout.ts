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

const isKnown = (
  participant: FamilyParticipantDto,
): participant is Extract<FamilyParticipantDto, { identityId: string }> => participant.kind === 'known';

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
