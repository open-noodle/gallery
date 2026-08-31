import { defaults, type PersonResponseDto } from '@immich/sdk';

// Gallery-fork: family relationships, slice 8 (person page). See
// specs/2026-08-31-family-relationships-design-and-slices.md — D5, D5.1, D5.3 — and the mockup's
// §4 ("Person page").
//
// This is the PAGE PERSON'S OWN relations, each labelled RELATIVE TO THE PAGE'S PERSON
// ("parent", "partner", "half-sibling") — a different derivation from the asset viewer's
// per-face label (slice 9's `PersonResponseDto.familyRelationLabel`, relative to the VIEWER).
// The two must not be conflated: `familyRelationLabel` only ever describes the ONE person
// already fetched and cannot produce a list of who THAT person's own relations are.
//
// `GET /family/people/{personId}/relations` is a new endpoint dispatched alongside this slice
// and may not exist on the server yet at the time this file is written. It is called with a
// hand-rolled `fetch` against the SDK's shared `defaults` (baseUrl + auth headers) rather than a
// generated SDK function, because no generated function exists for this route yet — swap this
// for the real `@immich/sdk` export the moment `mise open-api` regenerates the client with it.
//
// Do NOT fetch `/family/unions` and join it against `person` client-side instead:
// `identityId` is deliberately not exposed on `PersonResponseDto` (a client must not be able to
// correlate the same person across viewers), so that join is not something this page is allowed
// to reconstruct itself.

export type FamilyPanelAccess = 'none' | 'view' | 'contribute';

/**
 * One relation of the page's person. `known` carries the full resolved person (so the row can
 * reuse `ImageThumbnail` with a real thumbnail, exactly like the header). `anonymous` carries an
 * opaque per-union slot and — deliberately — no identity id at all: leaking the id would let a
 * client correlate the same hidden person across unions and across viewers, which is exactly
 * what redaction is meant to withhold (mirrors `E30` on the server).
 */
export type FamilyRelationEntry =
  { kind: 'known'; person: PersonResponseDto; label: string } | { kind: 'anonymous'; slot: number; label: string };

export type PersonFamilyRelations = {
  access: FamilyPanelAccess;
  relations: FamilyRelationEntry[];
};

type RawFamilyPersonRelation = {
  person: PersonResponseDto | null;
  anonymousSlot: number | null;
  relation: string;
};

type RawFamilyPersonRelationsResponse = {
  relations: RawFamilyPersonRelation[];
};

const toFamilyRelationEntry = (raw: RawFamilyPersonRelation): FamilyRelationEntry =>
  raw.person
    ? { kind: 'known', person: raw.person, label: raw.relation }
    : { kind: 'anonymous', slot: raw.anonymousSlot ?? -1, label: raw.relation };

/**
 * Fetches the page person's own family relations. Returns `{ access: 'none', relations: [] }`
 * for a pet (E55, never even asks), and on any non-2xx response (below `view` access, including
 * the feature being disabled instance-wide) — the caller must render nothing at all for that
 * case, never an empty or locked section (A12).
 *
 * The endpoint's own contract has no field for `contribute` vs `view` (it only answers "can I
 * read"), so this never resolves to `contribute` today. `FamilyRelationsPanel` itself still
 * supports and is tested against the `contribute` case directly via props — only the real-app
 * wiring is conservative until a write-capable signal exists.
 */
export const getPersonFamilyRelations = async (person: PersonResponseDto): Promise<PersonFamilyRelations> => {
  if (person.type === 'pet') {
    return { access: 'none', relations: [] };
  }

  let response: Response;
  try {
    response = await fetch(`${defaults.baseUrl}/family/people/${encodeURIComponent(person.id)}/relations`, {
      headers: defaults.headers as HeadersInit,
      credentials: 'include',
    });
  } catch {
    return { access: 'none', relations: [] };
  }

  if (!response.ok) {
    return { access: 'none', relations: [] };
  }

  const body = (await response.json()) as RawFamilyPersonRelationsResponse;

  return { access: 'view', relations: body.relations.map((raw) => toFamilyRelationEntry(raw)) };
};
