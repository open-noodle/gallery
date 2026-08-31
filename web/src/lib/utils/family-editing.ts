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

const isKnownParticipant = (
  participant: FamilyParticipantDto,
): participant is Extract<FamilyParticipantDto, { identityId: string }> => participant.kind === 'known';

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

export type FamilyDropMutation =
  { kind: 'join'; unionId: string; role: FamilyParticipantRole } | { kind: 'create'; create: FamilyUnionCreateDto };

/**
 * Decides how dropping `draggedId` at `position` relative to `targetId` should mutate the graph.
 *
 * `draggedId` is always an identity already known to the canvas (E53) — the canvas only ever
 * lets you drag a card that is already rendered somewhere, so there is never a "the dragged
 * person doesn't exist yet" branch here; the same identityId is simply attached to a new union
 * or a new participant role, never re-created.
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
): FamilyDropMutation {
  if (position === 'beside') {
    return { kind: 'create', create: { partnerIds: [draggedId, targetId] } };
  }

  if (position === 'above') {
    const existingUnion = findUnionAsChild(unions, targetId);
    if (existingUnion) {
      return { kind: 'join', unionId: existingUnion.id, role: FamilyParticipantRole.Partner };
    }
    return { kind: 'create', create: { partnerIds: [draggedId], childIds: [targetId] } };
  }

  // position === 'below'
  const existingUnion = findUnionAsPartner(unions, targetId);
  if (existingUnion) {
    return { kind: 'join', unionId: existingUnion.id, role: FamilyParticipantRole.Child };
  }
  return { kind: 'create', create: { partnerIds: [targetId], childIds: [draggedId] } };
}
