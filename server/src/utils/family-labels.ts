// Derives the word a viewer uses for another person in their family graph —
// "your sister", "your half-brother", "Mia's parent" — without storing a
// single relative term anywhere. Unions and membership are the only stored
// facts; every relationship word is computed here, at read time, by walking
// the graph from whichever identity the viewer nominated as themselves.
//
// This module is PURE: no repository, no database, no async I/O, no NestJS.
// Its only input is a graph literal. That is deliberate — it keeps the
// edge-case matrix (see the design spec's `E35`-`E47`, `E59`) cheap to test
// exhaustively and impossible to get wrong by half-loading data.
//
// SECURITY PROPERTY, not a style choice: `ProjectedFamilyGraph` must be the
// already-filtered graph a slice-5-style projection produces for ONE viewer,
// never the full graph. Deriving on the full graph and filtering the output
// afterwards still leaks: the label itself is the disclosure. "Your niece"
// computed through a union the viewer cannot see tells them a connection
// exists even though the connecting union was withheld. So this function's
// first parameter is named and shaped so it cannot be confused with a raw
// graph or a repository: it carries only names/genders for identities the
// viewer can resolve, and unresolvable participants appear as an
// `{ kind: 'anonymous' }` slot that structurally cannot carry an
// `identityId` — carrying one would let a caller correlate the same hidden
// person across separate unions, exactly what the projection withholds.
//
// A union absent from this graph (because the viewer cannot resolve enough
// of its participants) simply contributes no edges here. That is what makes
// `E59` fall out for free: no special-casing is needed to hide a path that
// runs through a hidden union, because that union's edges never existed in
// this graph in the first place.

/** A person's recorded gender. Never inferred — unset (`null`) is common and
 * expected, and always yields the neutral term. */
export type FamilyGender = 'male' | 'female' | null;

export type FamilyUnionStatus = 'married' | 'partnered' | 'separated' | 'divorced' | 'widowed';

/**
 * One seat in a union: either an identity the viewer can resolve, or an
 * anonymous participant who is present but unresolvable to this viewer.
 *
 * The `anonymous` variant has no `identityId` field at all — not an optional
 * one left undefined, an actually absent one — so there is no value a caller
 * could extract and use to correlate the same hidden person across unions.
 */
export type ProjectedFamilyParticipant =
  { readonly kind: 'known'; readonly identityId: string } | { readonly kind: 'anonymous' };

/** Per-identity facts the viewer is allowed to see. Gender is optional and
 * never derived from anything else in this module. */
export interface ProjectedFamilyIdentity {
  readonly name: string;
  readonly gender: FamilyGender;
}

/** One union as the viewer is allowed to see it: 0, 1 or 2 partners, and any
 * number of children, each either a known identity or an anonymous seat. */
export interface ProjectedFamilyUnion {
  readonly id: string;
  readonly status: FamilyUnionStatus;
  /** Display-only — never consulted by any relation computation in this module (only `status`
   * is, via `statusOf`, for the ex-partner distinction). */
  readonly startDate?: string | null;
  readonly endDate?: string | null;
  readonly partners: readonly ProjectedFamilyParticipant[];
  readonly children: readonly ProjectedFamilyParticipant[];
}

/**
 * The graph as one specific viewer is allowed to see it. Produced by a
 * projection slice (filtering the full graph to what that viewer can
 * resolve) and consumed here — never constructed from a repository, and
 * never the unfiltered graph. Passing anything else defeats the purpose of
 * this type existing at all.
 */
export interface ProjectedFamilyGraph {
  readonly identities: Readonly<Record<string, ProjectedFamilyIdentity>>;
  readonly unions: readonly ProjectedFamilyUnion[];
}

// ---------------------------------------------------------------------------
// Internal graph model
// ---------------------------------------------------------------------------

/** Every node the walk can visit is keyed by a string: a real identity id for
 * a known participant, or a synthetic per-slot key for an anonymous one. The
 * synthetic key never looks like a real identity id, and it is never
 * returned to a caller — it exists only to let the walk pass through an
 * unresolvable participant without ever naming them (`E47`). It is also,
 * deliberately, unique per union+slot: an anonymous participant can never be
 * linked to "the same" anonymous participant in a different union. */
type NodeKey = string;

function anonymousKey(unionId: string, role: 'partner' | 'child', index: number): NodeKey {
  return `anon:${unionId}:${role}:${index}`;
}

function participantKey(
  participant: ProjectedFamilyParticipant,
  unionId: string,
  role: 'partner' | 'child',
  index: number,
): NodeKey {
  return participant.kind === 'known' ? participant.identityId : anonymousKey(unionId, role, index);
}

interface GraphModel {
  /** nodeKey -> the nodeKeys of that node's recorded parents (from every union it is a child of). */
  parentsOf: Map<NodeKey, NodeKey[]>;
  /** nodeKey -> the nodeKeys of that node's recorded children (from every union it is a partner of). */
  childrenOf: Map<NodeKey, NodeKey[]>;
  /** nodeKey -> the partner(s) it shares a 2-partner union with. Union status is looked up
   * separately (via `statusOf`) only when a partner candidate is actually formed. */
  partnersOf: Map<NodeKey, NodeKey[]>;
  /** nodeKey -> every other child it co-appears with in the SAME union's children list. This is
   * what makes two children of a union full siblings regardless of how many partners that union
   * happens to record (0, 1 or 2) — full/half is a fact about which union you were born into, not
   * about how many named parents were recorded on it (`E1`, `E39`). */
  coChildrenOf: Map<NodeKey, NodeKey[]>;
}

function pushInto(map: Map<NodeKey, NodeKey[]>, key: NodeKey, value: NodeKey): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

function buildModel(graph: ProjectedFamilyGraph): GraphModel {
  const parentsOf: GraphModel['parentsOf'] = new Map();
  const childrenOf: GraphModel['childrenOf'] = new Map();
  const partnersOf: GraphModel['partnersOf'] = new Map();
  const coChildrenOf: GraphModel['coChildrenOf'] = new Map();

  for (const union of graph.unions) {
    const partnerKeys = union.partners.map((partner, index) => participantKey(partner, union.id, 'partner', index));
    const childKeys = union.children.map((child, index) => participantKey(child, union.id, 'child', index));

    if (partnerKeys.length === 2) {
      const [a, b] = partnerKeys as [NodeKey, NodeKey];
      pushInto(partnersOf, a, b);
      pushInto(partnersOf, b, a);
    }

    for (const childKey of childKeys) {
      for (const parentKey of partnerKeys) {
        pushInto(parentsOf, childKey, parentKey);
        pushInto(childrenOf, parentKey, childKey);
      }
    }

    for (const childKey of childKeys) {
      for (const otherChildKey of childKeys) {
        if (otherChildKey !== childKey) {
          pushInto(coChildrenOf, childKey, otherChildKey);
        }
      }
    }
  }

  return { parentsOf, childrenOf, partnersOf, coChildrenOf };
}

/** BFS strictly along parent edges, returning every ancestor reachable within
 * `maxDepth` steps, keyed by the shortest number of steps to reach it. The
 * node itself is included at distance 0 — this is what lets a single
 * "common ancestor" scan also cover the direct parent/child line without a
 * separate code path. */
function ancestorsOf(model: GraphModel, start: NodeKey, maxDepth: number): Map<NodeKey, number> {
  const distances = new Map<NodeKey, number>([[start, 0]]);
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: NodeKey[] = [];
    for (const node of frontier) {
      for (const parent of model.parentsOf.get(node) ?? []) {
        if (distances.has(parent)) {
          continue;
        }

        distances.set(parent, depth);
        next.push(parent);
      }
    }
    frontier = next;
  }
  return distances;
}

// ---------------------------------------------------------------------------
// Term vocabulary — the only place gender chooses wording
// ---------------------------------------------------------------------------

type SimpleRelation =
  | 'parent'
  | 'child'
  | 'sibling'
  | 'half-sibling'
  | 'partner'
  | 'ex-partner'
  | 'parent-in-law'
  | 'step-parent'
  | 'step-child'
  | 'child-in-law';

/** Gender only ever chooses which WORD is used for an already-determined
 * relation; it is never used to determine WHICH relation applies. Unset
 * gender always falls back to the neutral term — this is `A9`/`E37`/`E38`. */
function genderedTerm(relation: SimpleRelation, gender: FamilyGender): string {
  switch (relation) {
    case 'parent': {
      return gender === 'male' ? 'father' : gender === 'female' ? 'mother' : 'parent';
    }
    case 'child': {
      return gender === 'male' ? 'son' : gender === 'female' ? 'daughter' : 'child';
    }
    case 'sibling': {
      return gender === 'male' ? 'brother' : gender === 'female' ? 'sister' : 'sibling';
    }
    case 'half-sibling': {
      return gender === 'male' ? 'half-brother' : gender === 'female' ? 'half-sister' : 'half-sibling';
    }
    case 'partner': {
      return gender === 'male' ? 'husband' : gender === 'female' ? 'wife' : 'partner';
    }
    case 'ex-partner': {
      return gender === 'male' ? 'ex-husband' : gender === 'female' ? 'ex-wife' : 'former partner';
    }
    case 'parent-in-law': {
      return gender === 'male' ? 'father-in-law' : gender === 'female' ? 'mother-in-law' : 'parent-in-law';
    }
    case 'step-parent': {
      return gender === 'male' ? 'stepfather' : gender === 'female' ? 'stepmother' : 'step-parent';
    }
    case 'step-child': {
      return gender === 'male' ? 'stepson' : gender === 'female' ? 'stepdaughter' : 'step-child';
    }
    case 'child-in-law': {
      return gender === 'male' ? 'son-in-law' : gender === 'female' ? 'daughter-in-law' : 'child-in-law';
    }
  }
}

function lineTerm(steps: number, direction: 'ancestor' | 'descendant', gender: FamilyGender): string {
  if (steps === 1) {
    return genderedTerm(direction === 'ancestor' ? 'parent' : 'child', gender);
  }
  const great = 'great-'.repeat(Math.max(steps - 2, 0));
  if (direction === 'ancestor') {
    return gender === 'male'
      ? `${great}grandfather`
      : gender === 'female'
        ? `${great}grandmother`
        : `${great}grandparent`;
  }
  return gender === 'male' ? `${great}grandson` : gender === 'female' ? `${great}granddaughter` : `${great}grandchild`;
}

function auntUncleTerm(greatCount: number, gender: FamilyGender): string {
  const great = 'great-'.repeat(Math.max(greatCount, 0));
  return gender === 'male' ? `${great}uncle` : gender === 'female' ? `${great}aunt` : `${great}aunt or ${great}uncle`;
}

function nieceNephewTerm(greatCount: number, gender: FamilyGender): string {
  const great = 'great-'.repeat(Math.max(greatCount, 0));
  return gender === 'male'
    ? `${great}nephew`
    : gender === 'female'
      ? `${great}niece`
      : `${great}niece or ${great}nephew`;
}

const COUSIN_ORDINALS: Record<number, string> = { 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth' };

function cousinTerm(degree: number, removed: number): string {
  const base = degree === 1 ? 'cousin' : `${COUSIN_ORDINALS[degree] ?? `${degree}th`} cousin`;
  if (removed === 0) {
    return base;
  }
  if (removed === 1) {
    return `${base}, once removed`;
  }
  if (removed === 2) {
    return `${base}, twice removed`;
  }
  return `${base}, ${removed} times removed`;
}

/** The walk is capped: past this many combined generations, a precise term
 * ("third cousin twice removed") stops being useful and we say "relative"
 * instead (`E45`). */
const MAX_SUPPORTED_TOTAL_GENERATIONS = 6;
const ANCESTOR_SEARCH_DEPTH = 10;

function bloodTerm(u: number, d: number, gender: FamilyGender): string {
  if (d === 0) {
    return lineTerm(u, 'ancestor', gender);
  }
  if (u === 0) {
    return lineTerm(d, 'descendant', gender);
  }
  if (u === 1 && d === 1) {
    // A same-union sibling is always caught by the shorter, distance-1
    // "co-child" candidate below, which wins the distance sort outright.
    // Reaching this branch at all means root and target do NOT share a
    // union — only a parent identity across two different unions — so this
    // is unconditionally the half-sibling case.
    return genderedTerm('half-sibling', gender);
  }
  const minUD = Math.min(u, d);
  const maxUD = Math.max(u, d);
  if (minUD === 1) {
    const greatCount = maxUD - 2;
    return u > d ? auntUncleTerm(greatCount, gender) : nieceNephewTerm(greatCount, gender);
  }
  const degree = minUD - 1;
  const removed = maxUD - minUD;
  return cousinTerm(degree, removed);
}

// ---------------------------------------------------------------------------
// Candidate relations between two nodes
// ---------------------------------------------------------------------------

interface RelationCandidate {
  readonly distance: number;
  /** Fixed precedence used only to break exact ties in `distance` — lower
   * sorts first. */
  readonly precedence: number;
  /** A stable string used as the final tie-break, so the result never
   * depends on iteration/insertion order (`E44`, determinism). */
  readonly tieKey: string;
  readonly term: (targetGender: FamilyGender) => string;
}

const PRECEDENCE = {
  partner: 0,
  stepOrInLaw: 1,
  blood: 2,
} as const;

function statusOf(graph: ProjectedFamilyGraph, aKey: NodeKey, bKey: NodeKey): FamilyUnionStatus | undefined {
  for (const union of graph.unions) {
    const partnerKeys = union.partners.map((partner, index) => participantKey(partner, union.id, 'partner', index));
    if (partnerKeys.length === 2 && partnerKeys.includes(aKey) && partnerKeys.includes(bKey)) {
      return union.status;
    }
  }
  return undefined;
}

function collectCandidates(
  model: GraphModel,
  graph: ProjectedFamilyGraph,
  rootKey: NodeKey,
  targetKey: NodeKey,
): RelationCandidate[] {
  const candidates: RelationCandidate[] = [];

  // Direct co-children of the same union: full siblings, regardless of how
  // many partners that union records (`E1`, `E39`). This is deliberately
  // shorter than the generic ancestor-based path below, so it always wins
  // the distance sort when it applies.
  for (const siblingKey of model.coChildrenOf.get(rootKey) ?? []) {
    if (siblingKey === targetKey) {
      candidates.push({
        distance: 1,
        precedence: PRECEDENCE.blood,
        tieKey: `sibling:${targetKey}`,
        term: (gender) => genderedTerm('sibling', gender),
      });
    }
  }

  // Direct partner.
  for (const partnerKey of model.partnersOf.get(rootKey) ?? []) {
    if (partnerKey !== targetKey) {
      continue;
    }

    const status = statusOf(graph, rootKey, targetKey);
    const base: SimpleRelation = status === 'divorced' || status === 'separated' ? 'ex-partner' : 'partner';
    candidates.push({
      distance: 1,
      precedence: PRECEDENCE.partner,
      tieKey: `partner:${targetKey}`,
      term: (gender) => genderedTerm(base, gender),
    });
  }

  // Step-parent: root's parent's partner in a DIFFERENT union than the one
  // that makes them root's own parent. (If it were the same union, target
  // would already be root's direct parent via the blood scan below, which
  // wins on distance, so no exclusion is needed here.)
  for (const parentKey of model.parentsOf.get(rootKey) ?? []) {
    for (const partnerKey of model.partnersOf.get(parentKey) ?? []) {
      if (partnerKey === targetKey) {
        candidates.push({
          distance: 2,
          precedence: PRECEDENCE.stepOrInLaw,
          tieKey: `step-parent:${parentKey}`,
          term: (gender) => genderedTerm('step-parent', gender),
        });
      }
    }
  }

  // Parent-in-law: root's partner's parent.
  for (const spouseKey of model.partnersOf.get(rootKey) ?? []) {
    for (const parentKey of model.parentsOf.get(spouseKey) ?? []) {
      if (parentKey === targetKey) {
        candidates.push({
          distance: 2,
          precedence: PRECEDENCE.stepOrInLaw,
          tieKey: `parent-in-law:${spouseKey}`,
          term: (gender) => genderedTerm('parent-in-law', gender),
        });
      }
    }
  }

  // Step-child: root's partner's child who is not also root's own child.
  const rootChildren = new Set(model.childrenOf.get(rootKey));
  for (const spouseKey of model.partnersOf.get(rootKey) ?? []) {
    for (const childKey of model.childrenOf.get(spouseKey) ?? []) {
      if (childKey === targetKey && !rootChildren.has(childKey)) {
        candidates.push({
          distance: 2,
          precedence: PRECEDENCE.stepOrInLaw,
          tieKey: `step-child:${spouseKey}`,
          term: (gender) => genderedTerm('step-child', gender),
        });
      }
    }
  }

  // Child-in-law: root's child's partner.
  for (const childKey of model.childrenOf.get(rootKey) ?? []) {
    for (const partnerKey of model.partnersOf.get(childKey) ?? []) {
      if (partnerKey === targetKey) {
        candidates.push({
          distance: 2,
          precedence: PRECEDENCE.stepOrInLaw,
          tieKey: `child-in-law:${childKey}`,
          term: (gender) => genderedTerm('child-in-law', gender),
        });
      }
    }
  }

  // Blood relations: every common ancestor of root and target, including
  // root or target themselves (which yields the direct parent/child line).
  const rootAncestors = ancestorsOf(model, rootKey, ANCESTOR_SEARCH_DEPTH);
  const targetAncestors = ancestorsOf(model, targetKey, ANCESTOR_SEARCH_DEPTH);

  for (const [nodeKey, u] of rootAncestors) {
    const d = targetAncestors.get(nodeKey);
    if (d === undefined) {
      continue;
    }
    if (u === 0 && d === 0) {
      continue;
    } // root === target is handled by the caller, never reached here.
    const total = u + d;
    candidates.push({
      distance: total,
      precedence: PRECEDENCE.blood,
      tieKey: `blood:${nodeKey}`,
      term: (gender) => (total > MAX_SUPPORTED_TOTAL_GENERATIONS ? 'relative' : bloodTerm(u, d, gender)),
    });
  }

  return candidates;
}

function pickWinner(candidates: RelationCandidate[]): RelationCandidate | null {
  if (candidates.length === 0) {
    return null;
  }
  const sorted = [...candidates].sort(
    (a, b) => a.distance - b.distance || a.precedence - b.precedence || a.tieKey.localeCompare(b.tieKey),
  );
  return sorted[0] ?? null;
}

/** The base relation term from `fromId` to `toId` (no "your" prefix, no
 * possessive), or `null` if the projected graph has no path between them —
 * whether because they are genuinely unconnected or because the only
 * connecting union was withheld from this projection (`E59`). */
function directRelation(
  model: GraphModel,
  graph: ProjectedFamilyGraph,
  fromId: string,
  toId: string,
): { term: string; distance: number } | null {
  const winner = pickWinner(collectCandidates(model, graph, fromId, toId));
  if (!winner) {
    return null;
  }
  const targetGender = graph.identities[toId]?.gender ?? null;
  return { term: winner.term(targetGender), distance: winner.distance };
}

/**
 * Rule 4: when the viewer has no path to the target, describe the target
 * relative to whichever known identity is both reachable from the root AND
 * as close as possible to the target — "Pierre's sister" rather than
 * nothing. Ties broken deterministically: nearest to the target first, then
 * nearest to the root, then by identity id.
 */
function findNearestAnchor(
  model: GraphModel,
  graph: ProjectedFamilyGraph,
  rootId: string,
  targetId: string,
): { name: string; term: string } | null {
  let best: { anchorId: string; distanceToTarget: number; distanceFromRoot: number; term: string } | null = null;

  for (const anchorId of Object.keys(graph.identities)) {
    if (anchorId === rootId || anchorId === targetId) {
      continue;
    }
    const fromRoot = directRelation(model, graph, rootId, anchorId);
    if (!fromRoot) {
      continue;
    }
    const toTarget = directRelation(model, graph, anchorId, targetId);
    if (!toTarget) {
      continue;
    }

    if (
      !best ||
      toTarget.distance < best.distanceToTarget ||
      (toTarget.distance === best.distanceToTarget && fromRoot.distance < best.distanceFromRoot) ||
      (toTarget.distance === best.distanceToTarget &&
        fromRoot.distance === best.distanceFromRoot &&
        anchorId < best.anchorId)
    ) {
      best = {
        anchorId,
        distanceToTarget: toTarget.distance,
        distanceFromRoot: fromRoot.distance,
        term: toTarget.term,
      };
    }
  }

  if (!best) {
    return null;
  }
  const anchorIdentity = graph.identities[best.anchorId];
  if (!anchorIdentity) {
    return null;
  }
  return { name: anchorIdentity.name, term: best.term };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Turns a viewer-projected family graph, that viewer's chosen root identity,
 * and a target identity into the word the viewer would use for the target.
 *
 * Rules, in order (see `D4` in the design spec):
 * 1. No root set -> `null` (the caller renders a plain name).
 * 2. Target is the root -> "that's you".
 * 3. A path exists from root to target -> the relative term.
 * 4. No path -> described relative to the nearest reachable person.
 * 5. Beyond the supported degree -> "relative".
 *
 * `graph` must already be filtered to what `rootId`'s viewer may resolve —
 * see the module documentation above for why that is a security property,
 * not a convenience.
 */
export function deriveRelationLabel(
  graph: ProjectedFamilyGraph,
  rootId: string | null,
  targetId: string,
): string | null {
  if (rootId === null) {
    return null;
  }
  if (rootId === targetId) {
    return "that's you";
  }

  const model = buildModel(graph);

  const direct = directRelation(model, graph, rootId, targetId);
  if (direct) {
    return `your ${direct.term}`;
  }

  const anchor = findNearestAnchor(model, graph, rootId, targetId);
  if (!anchor) {
    return null;
  }
  return `${anchor.name}'s ${anchor.term}`;
}

/**
 * One direct relation `subjectId` has to another seat in the graph — the shape a person's OWN
 * relations panel needs (D4 read as "root = the person being viewed" rather than "root = the
 * viewer"). Never includes the anchored "X's Y" form `deriveRelationLabel` falls back to for a
 * DISTANT viewer with no path of their own — on a person's own page every listed relation is, by
 * definition, directly reachable from that person, so the fallback phrasing never applies here.
 */
export interface FamilyDirectRelation {
  /** The other seat. `kind: 'known'` carries an `identityId`; `kind: 'anonymous'` carries none —
   * see `anonymousSlot` for how to reference it instead. */
  readonly participant: ProjectedFamilyParticipant;
  /** The seat's position within its own union+role participant array — only meaningful when
   * `participant.kind === 'anonymous'`, `null` otherwise. Mirrors the "position in the array IS
   * the slot" convention used everywhere else an anonymous seat needs referencing (`E30`): it is
   * never a global id, so it carries nothing that could correlate this seat with another. */
  readonly anonymousSlot: number | null;
  /** The plain relation term (no "your " prefix — the caller decides how to render it relative
   * to whoever is asking). */
  readonly relation: string;
}

/**
 * Every relation `subjectId` has directly to someone else in the graph: parents, partners,
 * children, siblings/half-siblings, step-relations, in-laws, and blood relatives at any
 * resolvable degree — reusing the exact same candidate collection and wording
 * (`collectCandidates`/`genderedTerm`/`bloodTerm`) `deriveRelationLabel` uses for rule 3, just
 * entered from `subjectId` instead of a viewer's root, and never falling through to rule 4's
 * anchored phrasing (see `FamilyDirectRelation`'s doc for why). `subjectId` is never included in
 * its own relations.
 *
 * One entry per (union, role, seat): a known identity occupying two structurally different seats
 * relative to `subjectId` (e.g. a co-parent who is ALSO, through a separate union, a step-parent)
 * is a genuine, if unusual, distinct fact — the caller decides whether to deduplicate by
 * identity. Every anonymous seat is unique by construction (`anonymousSlot` above), so those
 * never need deduplication either way.
 */
export function deriveDirectRelations(graph: ProjectedFamilyGraph, subjectId: string): FamilyDirectRelation[] {
  const model = buildModel(graph);
  const results: FamilyDirectRelation[] = [];

  for (const identityId of Object.keys(graph.identities)) {
    if (identityId === subjectId) {
      continue;
    }
    const direct = directRelation(model, graph, subjectId, identityId);
    if (direct) {
      results.push({ participant: { kind: 'known', identityId }, anonymousSlot: null, relation: direct.term });
    }
  }

  for (const union of graph.unions) {
    const roleSeats: ReadonlyArray<{ role: 'partner' | 'child'; participants: readonly ProjectedFamilyParticipant[] }> =
      [
        { role: 'partner', participants: union.partners },
        { role: 'child', participants: union.children },
      ];

    for (const { role, participants } of roleSeats) {
      for (const [index, participant] of participants.entries()) {
        if (participant.kind !== 'anonymous') {
          continue;
        }
        const targetKey = anonymousKey(union.id, role, index);
        const direct = directRelation(model, graph, subjectId, targetKey);
        if (direct) {
          results.push({ participant, anonymousSlot: index, relation: direct.term });
        }
      }
    }
  }

  return results;
}
