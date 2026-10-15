import {
  FamilyParticipantRole,
  type FamilyParticipantDto,
  type FamilyUnionCreateDto,
  type FamilyUnionDto,
} from '@immich/sdk';

// Gallery-fork: family relationships (slice 11, D6/D5.3). Pure decision logic for the three
// canvas drop gestures — kept out of `FamilyCanvas.svelte` so the "join, don't duplicate" rule
// (E52) is a small, directly-readable function rather than something buried in event-handler
// wiring. `FamilyCanvas.svelte` is the only caller; its own tests exercise this indirectly via
// real drag/drop events, which is why there is no separate spec for this file.

export type FamilyDropPosition = 'above' | 'beside' | 'below';

// `FamilyParticipantDto` is a flat object with a nullable `identityId`, not a discriminated
// union — narrowing on `kind` yields `never`, so the null-check on `identityId` is the real
// invariant (same as `family-layout.ts`).
const isKnownParticipant = (
  participant: FamilyParticipantDto,
): participant is FamilyParticipantDto & { identityId: string } => participant.identityId !== null;

const participantIs = (participant: FamilyParticipantDto, identityId: string): boolean =>
  isKnownParticipant(participant) && participant.identityId === identityId;

/**
 * The union `identityId` is a CHILD of, if any. First match — a person recorded as a child of
 * more than one union is an unusual multi-parent-set graph this slice does not need to
 * disambiguate; picking the first keeps the rule simple and deterministic.
 */
export function findUnionAsChild(unions: FamilyUnionDto[], identityId: string): FamilyUnionDto | undefined {
  return unions.find((union) => union.children.some((participant) => participantIs(participant, identityId)));
}

/** The union `identityId` is a PARTNER in, if any. First match — see `findUnionAsChild`. */
export function findUnionAsPartner(unions: FamilyUnionDto[], identityId: string): FamilyUnionDto | undefined {
  return unions.find((union) => union.partners.some((participant) => participantIs(participant, identityId)));
}

/** A union `identityId` is a partner in that still has a free partner seat — the dashed
 * "+ Add a parent" the canvas draws next to them. A union holds at most two partners, so this is
 * the one the `beside` gesture should fill rather than starting a rival. */
export function findUnionWithFreePartnerSeat(unions: FamilyUnionDto[], identityId: string): FamilyUnionDto | undefined {
  return unions.find(
    (union) =>
      union.partners.length < 2 && union.partners.some((participant) => participantIs(participant, identityId)),
  );
}

export type FamilyDropMutation =
  { kind: 'join'; unionId: string; role: FamilyParticipantRole } | { kind: 'create'; create: FamilyUnionCreateDto };

/** Where the dragged id came from. A card already on the canvas is dragged by IDENTITY id; a face
 * dragged in from the tray is only ever a PERSON id, because a people picker never learns an
 * identity id (`PersonResponseDto` withholds it, E30) and the server resolves the person id
 * itself. Only the create branches care — `addParticipant` takes either. */
export type FamilyDragKind = 'identity' | 'person';

/**
 * Decides how dropping `dragged` at `position` relative to `targetId` should mutate the graph.
 *
 * A card dragged from the canvas is an identity already rendered somewhere (E53): it is attached
 * to a new union or a new participant role, never re-created. A face dragged from the tray is a
 * person the canvas has never drawn, carried as a person id — the one case where the dragged
 * side is genuinely new to the graph.
 *
 * E52 is decided entirely in the `above`/`below` branches: when the target card already belongs
 * to a union in the relevant role, the dragged person JOINS that union (`addParticipant`) rather
 * than starting a rival one (`createUnion`). That is what stops two parents silently describing
 * two separate families for the same child, and what makes "drop below the parent" double as
 * "add a sibling" with no gesture of its own.
 */
export function planFamilyDrop(
  unions: FamilyUnionDto[],
  position: FamilyDropPosition,
  draggedId: string,
  targetId: string,
  draggedKind: FamilyDragKind = 'identity',
): FamilyDropMutation {
  const isPerson = draggedKind === 'person';
  // The create DTO merges its identity and person arrays server-side, so the dragged side can be
  // a person id while the target — always a card already on the canvas — stays an identity id.
  const asPartner = (id: string) => (isPerson ? { partnerPersonIds: [id] } : { partnerIds: [id] });
  const asChild = (id: string) => (isPerson ? { childPersonIds: [id] } : { childIds: [id] });

  if (position === 'beside') {
    // E52 applies here too, not just to parents: when the target already sits in a union with an
    // empty partner seat, the drop FILLS that seat instead of opening a second union beside it.
    // Without this, partnering two people who already share a child leaves the child's union
    // half-empty — the canvas keeps offering "+ Add a parent" for a parent who is standing right
    // there, and the couple is drawn twice, once as a partnership and once as a lone parent.
    const halfEmpty = findUnionWithFreePartnerSeat(unions, targetId);
    if (halfEmpty) {
      return { kind: 'join', unionId: halfEmpty.id, role: FamilyParticipantRole.Partner };
    }
    return isPerson
      ? { kind: 'create', create: { partnerIds: [targetId], partnerPersonIds: [draggedId] } }
      : { kind: 'create', create: { partnerIds: [draggedId, targetId] } };
  }

  if (position === 'above') {
    const existingUnion = findUnionAsChild(unions, targetId);
    if (existingUnion) {
      return { kind: 'join', unionId: existingUnion.id, role: FamilyParticipantRole.Partner };
    }
    return { kind: 'create', create: { ...asPartner(draggedId), childIds: [targetId] } };
  }

  // position === 'below'
  const existingUnion = findUnionAsPartner(unions, targetId);
  if (existingUnion) {
    return { kind: 'join', unionId: existingUnion.id, role: FamilyParticipantRole.Child };
  }
  return { kind: 'create', create: { partnerIds: [targetId], ...asChild(draggedId) } };
}
