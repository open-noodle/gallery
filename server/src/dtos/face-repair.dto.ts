import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export const FaceRepairRequestSchema = z
  .object({
    dryRun: z.boolean().default(true),
    ownerId: z.uuidv4().optional(),
    personId: z.uuidv4().optional(),
    maxDistance: z.number().gt(0).max(2).optional(),
    minFaces: z.number().int().min(1).optional(),
    voteWindow: z.number().int().min(1).optional(),
    voteMargin: z.number().int().min(0).optional(),
    maxAttributionDistance: z.number().gt(0).max(2).optional(),
    maxFlaggedFraction: z.number().min(0).max(1).optional(),
  })
  .meta({ id: 'FaceRepairRequestDto' });

export class FaceRepairRequestDto extends createZodDto(FaceRepairRequestSchema) {}

const SuspectedOwnerSchema = z.object({ ownerPersonId: z.string(), count: z.number() });
const PersonSchema = z.object({
  personId: z.string(),
  eligible: z.number(),
  flagged: z.number(),
  flaggedFraction: z.number(),
  reviewOnly: z.boolean(),
  suspectedOwners: z.array(SuspectedOwnerSchema),
});

export const FaceRepairResponseSchema = z
  .object({
    dryRun: z.boolean(),
    mutated: z.boolean(),
    executed: z.object({ moved: z.number(), skipped: z.number() }).optional(),
    report: z.object({
      totals: z.object({
        eligibleFaces: z.number(),
        flaggedFaces: z.number(),
        toRepair: z.number(),
        reviewOnlyFaces: z.number(),
        reviewOnlyPersons: z.number(),
        affectedPersons: z.number(),
        reviewOnlyByReason: z.object({ overCap: z.number(), badTarget: z.number(), unAttributable: z.number() }),
      }),
      persons: z.array(PersonSchema),
    }),
  })
  .meta({ id: 'FaceRepairResponseDto' });

export class FaceRepairResponseDto extends createZodDto(FaceRepairResponseSchema) {}

export const FaceRepairScanTriggerResponseSchema = z
  .object({ scanId: z.string() })
  .meta({ id: 'FaceRepairScanTriggerResponseDto' });
export class FaceRepairScanTriggerResponseDto extends createZodDto(FaceRepairScanTriggerResponseSchema) {}

export const FaceRepairScanParamsSchema = z.object({
  maxDistance: z.number().gt(0).max(2).optional(),
  minFaces: z.number().int().min(1).optional(),
  voteWindow: z.number().int().min(1).optional(),
  voteMargin: z.number().int().min(0).optional(),
  maxAttributionDistance: z.number().gt(0).max(2).optional(),
  maxFlaggedFraction: z.number().min(0).max(1).optional(),
  largeClusterThreshold: z.number().int().min(1).optional(),
});
export type FaceRepairScanParams = z.infer<typeof FaceRepairScanParamsSchema>;

export const FaceRepairScanTriggerRequestSchema = z
  .object({ params: FaceRepairScanParamsSchema.optional() })
  .meta({ id: 'FaceRepairScanTriggerRequestDto' });
export class FaceRepairScanTriggerRequestDto extends createZodDto(FaceRepairScanTriggerRequestSchema) {}

export const FaceRepairScanDefaultsSchema = z
  .object({
    maxDistance: z.number(),
    minFaces: z.number().int(),
    maxFlaggedFraction: z.number(),
  })
  .meta({ id: 'FaceRepairScanDefaultsDto' });
export class FaceRepairScanDefaultsDto extends createZodDto(FaceRepairScanDefaultsSchema) {}

const ScanSuspectedOwnerSchema = z.object({
  ownerPersonId: z.string(),
  ownerName: z.string().nullable(),
  thumbnailFaceId: z.string().nullable(),
  // Two different numbers, one of which used to do duty for both — which is how the console came to print
  // "Unnamed cluster / 1 faces" under a destination holding thousands.
  //   count          — PERSISTED, scan-time: flagged faces on THIS cluster routing to this owner.
  //   ownerFaceCount — OVERLAY, live: the destination person's own face count.
  count: z.number(),
  ownerFaceCount: z.number(),
  // The destination person row is gone (deleted or merged since the scan). The console renders a warning and
  // refuses to offer it as a destination, rather than letting Apply fail with face-repair:destination-missing.
  ownerMissing: z.boolean(),
});
const ScanPersonSchema = z.object({
  personId: z.string(),
  ownerId: z.string(),
  personName: z.string().nullable(),
  faceCount: z.number(),
  thumbnailFaceId: z.string().nullable(),
  eligible: z.number(),
  flagged: z.number(),
  flaggedFraction: z.number(),
  suspectedOwners: z.array(ScanSuspectedOwnerSchema),
  recommendation: z.enum(['confident', 'review-first']),
  reviewReasons: z.array(z.string()),
});
export const FaceRepairScanStatusSchema = z
  .object({
    id: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'failed']),
    progress: z.object({ scanned: z.number(), total: z.number() }).nullable(),
    totals: z
      .object({
        eligibleFaces: z.number(),
        flaggedFaces: z.number(),
        toRepair: z.number(),
        reviewOnlyFaces: z.number(),
        reviewOnlyPersons: z.number(),
        affectedPersons: z.number(),
        reviewOnlyByReason: z.object({ overCap: z.number(), badTarget: z.number(), unAttributable: z.number() }),
      })
      .nullable(),
    persons: z.array(ScanPersonSchema),
    error: z.string().nullable(),
    startedAt: z.string().meta({ format: 'date-time' }).nullable(),
    finishedAt: z.string().meta({ format: 'date-time' }).nullable(),
    createdAt: z.string().meta({ format: 'date-time' }),
  })
  .meta({ id: 'FaceRepairScanStatusDto' });
export class FaceRepairScanStatusDto extends createZodDto(FaceRepairScanStatusSchema) {}

// Enough of the source photo to judge a face in context (#1061): when it was taken, and where in the frame
// the detection sits. Both list queries already inner-join `asset`, so these are added columns on queries
// that already run — no new join, no second round-trip.
//
// FLAT, not nested: this is byte-for-byte web's existing `FaceBox` type (web/src/lib/utils/people-utils.ts),
// so the client hands it straight to getBoundingBox/getFaceCropTransform.
const FacePhotoContextShape = {
  localDateTime: z.string().meta({ format: 'date-time' }),
  boundingBoxX1: z.number(),
  boundingBoxY1: z.number(),
  boundingBoxX2: z.number(),
  boundingBoxY2: z.number(),
  imageWidth: z.number(),
  imageHeight: z.number(),
};

const FlaggedFaceSchema = z.object({
  assetFaceId: z.string(),
  suspectedOwnerId: z.string(),
  ...FacePhotoContextShape,
});
export const FaceRepairPersonFacesSchema = z
  .object({ personId: z.string(), flaggedFaces: z.array(FlaggedFaceSchema) })
  .meta({ id: 'FaceRepairPersonFacesDto' });
export class FaceRepairPersonFacesDto extends createZodDto(FaceRepairPersonFacesSchema) {}

// Upper bound on every per-request face/owner array (C4, F20). These endpoints are all admin-only, so this is
// a backstop against a runaway payload rather than a hostile-input guard: every DB write path this bound
// feeds chunks its IN-lists/inserts at 1000 internally, so this bound governs payload size and page weight,
// not statement size — EXCEPT `getClusterFacePage`'s `excludeFaceIds`, which is a single unchunked `NOT IN`.
// That is deliberate, not an oversight: chunking a `NOT IN` requires ANDing the chunks (excluded from EVERY
// chunk), not ORing them like an `IN`'s chunks — gluing an OR across chunks like a normal `IN` would silently
// turn "exclude these" into "exclude almost nothing". At the 25 000 cap below, one un-chunked `NOT IN` clause
// plus the query's handful of other predicates stays at ~25 010 bind parameters — comfortably under Postgres's
// 65 535 ceiling for the single statement it's compiled into (this query is built once as `base` and executed
// twice, as a count and a page, but those are two independent round trips, each with its own bind-parameter
// budget, not one combined statement). So the correct fix here is the cap itself, not chunking.
//
// This was 1000 on the assumption that a single reviewed person never has a realistic selection that large,
// because whole-cluster moves go through `entireCluster` (server-enumerated, no client array). That assumption
// was wrong for the case it matters most: a real 2952-face cluster came back with 2382 faces flagged toward one
// owner — a SUBSET, so `entireCluster` (which drains all 2952, flagged or not) is not the same action. The
// client emits one `moveToPerson` group per (destination, lock) pair, so every one of those faces lands in a
// single array and the resolve 400'd with no way for the admin to ever apply it.
//
// 25 000 uuids is ~1 MB of JSON, an order of magnitude under the 10 MB body limit (`app.common.ts`), and stays
// far below Postgres's 65 535 bind-parameter ceiling once chunked. The review page is the real limit long
// before this is: it renders a tile per flagged face.
const MAX_RESOLVE_FACES = 25_000;

// Bound on arrays whose elements are PEOPLE/CLUSTERS rather than faces: move groups (keyed by
// (destinationPersonId, lock), i.e. "how many distinct destinations may one resolve route to"), muted clusters,
// and suspected-owner sets. Kept at the original ceiling — raising the per-group FACE bound is not a reason to
// accept 25 000 destinations. The decline endpoint's arrays stay on this bound too: its write path was not part
// of this change, so it keeps exactly the limits it shipped with.
const MAX_RESOLVE_TARGETS = 1000;

const FaceDeclineSchema = z.object({ assetFaceId: z.uuidv4(), suspectedOwnerId: z.uuidv4() });
const PersonDeclineSchema = z.object({
  personId: z.uuidv4(),
  suspectedOwnerIds: z.array(z.uuidv4()).max(MAX_RESOLVE_TARGETS),
});

export const FaceRepairDeclineRequestSchema = z
  .object({
    faces: z.array(FaceDeclineSchema).max(MAX_RESOLVE_TARGETS).optional(),
    persons: z.array(PersonDeclineSchema).max(MAX_RESOLVE_TARGETS).optional(),
  })
  .meta({ id: 'FaceRepairDeclineRequestDto' });
export class FaceRepairDeclineRequestDto extends createZodDto(FaceRepairDeclineRequestSchema) {}

export const FaceRepairDeclineCreatedSchema = z
  .object({ created: z.number() })
  .meta({ id: 'FaceRepairDeclineCreatedDto' });
export class FaceRepairDeclineCreatedDto extends createZodDto(FaceRepairDeclineCreatedSchema) {}

const DeclineItemSchema = z.object({
  id: z.string(),
  // Plain string, NOT z.enum: an inline `z.enum(['face','person'])` here generates an anonymous `Type` enum in
  // the SDK, which joins oazapfts's numbered `Type`/`Type2`/... pool and RENUMBERS existing anonymous enums —
  // silently repointing unrelated consumers (e.g. web's `Type2 as ScopedPersonProfileType`) to the wrong enum.
  // The value is always 'face' | 'person'; the web reads it via a local cast.
  type: z.string(),
  assetFaceId: z.string().nullable(),
  suspectedOwnerId: z.string().nullable(),
  suspectedOwnerName: z.string().nullable(),
  suspectedOwnerThumbnailFaceId: z.string().nullable(),
  personId: z.string().nullable(),
  personName: z.string().nullable(),
  personThumbnailFaceId: z.string().nullable(),
  createdAt: z.string().meta({ format: 'date-time' }),
});
export const FaceRepairDeclineListSchema = z
  .object({ declines: z.array(DeclineItemSchema) })
  .meta({ id: 'FaceRepairDeclineListDto' });
export class FaceRepairDeclineListDto extends createZodDto(FaceRepairDeclineListSchema) {}

export const FaceRepairDeclineRemoveRequestSchema = z
  .object({
    // z.uuid() (version-agnostic), NOT z.uuidv4(): face_repair_decline.id is a UUID **v7**
    // (@PrimaryGeneratedUuidV7Column). z.uuidv4() enforces the version nibble == 4 and rejects v7 ids
    // with a 400 — which broke "Undo" on the declined page. z.uuid() accepts any RFC 9562 version.
    ids: z.array(z.uuid()).min(1).optional(),
    // Remove face declines by their natural key. Lets the review screen undo a just-made per-face decline
    // without first re-fetching the (server-generated) row id. assetFaceId/suspectedOwnerId are v4 entity ids.
    faces: z.array(FaceDeclineSchema).min(1).optional(),
  })
  .meta({ id: 'FaceRepairDeclineRemoveRequestDto' });
export class FaceRepairDeclineRemoveRequestDto extends createZodDto(FaceRepairDeclineRemoveRequestSchema) {}

export const FaceRepairDeclineRemovedSchema = z
  .object({ removed: z.number() })
  .meta({ id: 'FaceRepairDeclineRemovedDto' });
export class FaceRepairDeclineRemovedDto extends createZodDto(FaceRepairDeclineRemovedSchema) {}

// A negative verdict row for the resolutions manage page — "this face is not that person", from either
// engine. `source` says which one recorded it ('cleanup' = an admin's "keep here", 'suggestion' = a user's
// reject/ignore) and `actorName` who did. Exactly one of the person / space-person target is set, and either
// may be null if the target row was deleted after the verdict was recorded (the verdict survives via its
// identity key). Human PLACEMENTS are deliberately absent — see FaceRepairService.listResolutions.
const ResolutionItemSchema = z.object({
  id: z.string(),
  assetFaceId: z.string(),
  // Plain strings, NOT z.enum: see the anonymous-enum-renumbering note on DeclineItemSchema.type above.
  status: z.string(),
  source: z.string(),
  personId: z.string().nullable(),
  personName: z.string().nullable(),
  personThumbnailFaceId: z.string().nullable(),
  spacePersonId: z.string().nullable(),
  spacePersonName: z.string().nullable(),
  // Slice 11 (F23): the space-person twin of personThumbnailFaceId above, so a space-person target can
  // render a thumbnail too (projected from shared_space_person.representativeFaceId).
  spacePersonThumbnailFaceId: z.string().nullable(),
  spaceName: z.string().nullable(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  createdAt: z.string().meta({ format: 'date-time' }),
});
// Slice 11 (F23): this list is unscoped (no owner/person filter), so it now paginates like every other
// admin/review page query — same page/size shape as PersonFaceSuggestionPageQuerySchema, capped higher
// (200, not 100) since an admin working through a long resolutions list benefits from a larger page.
export const FaceRepairResolutionsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).describe('Page number'),
    size: z.coerce.number().int().min(1).max(200).default(50).describe('Number of resolutions per page'),
  })
  .meta({ id: 'FaceRepairResolutionsQueryDto' });
export class FaceRepairResolutionsQueryDto extends createZodDto(FaceRepairResolutionsQuerySchema) {}

export const FaceRepairResolutionsListSchema = z
  .object({ total: z.int().min(0), resolutions: z.array(ResolutionItemSchema) })
  .meta({ id: 'FaceRepairResolutionsListDto' });
export class FaceRepairResolutionsListDto extends createZodDto(FaceRepairResolutionsListSchema) {}

export const FaceRepairResolutionsRemoveRequestSchema = z
  .object({
    // z.uuid() (version-agnostic), NOT z.uuidv4(): these are UUID **v7** row ids
    // (@PrimaryGeneratedUuidV7Column). z.uuidv4() rejecting v7 ids is the exact regression that broke
    // decline "Undo" before.
    verdictIds: z.array(z.uuid()).min(1).max(MAX_RESOLVE_FACES).optional(),
    clusterMuteIds: z.array(z.uuid()).min(1).max(MAX_RESOLVE_FACES).optional(),
  })
  // Strict: a client still sending the retired `declineIds`/`lockIds`/`faces` shape must get a 400 rather
  // than have its keys stripped and silently perform a no-op undo.
  .strict()
  .meta({ id: 'FaceRepairResolutionsRemoveRequestDto' });
export class FaceRepairResolutionsRemoveRequestDto extends createZodDto(FaceRepairResolutionsRemoveRequestSchema) {}

export const FaceRepairUnconfirmRequestSchema = z
  .object({
    assetFaceIds: z.array(z.uuid()).min(1).max(MAX_RESOLVE_FACES),
  })
  .meta({ id: 'FaceRepairUnconfirmRequestDto' });
export class FaceRepairUnconfirmRequestDto extends createZodDto(FaceRepairUnconfirmRequestSchema) {}

export const FaceRepairResolutionsRemovedSchema = z
  .object({ removed: z.number() })
  .meta({ id: 'FaceRepairResolutionsRemovedDto' });
export class FaceRepairResolutionsRemovedDto extends createZodDto(FaceRepairResolutionsRemovedSchema) {}

export const FaceRepairClusterFacesRequestSchema = z
  .object({
    excludeFaceIds: z.array(z.uuidv4()).max(MAX_RESOLVE_FACES).default([]),
    page: z.number().int().min(0),
    size: z.number().int().min(1).max(200),
  })
  .meta({ id: 'FaceRepairClusterFacesRequestDto' });
export class FaceRepairClusterFacesRequestDto extends createZodDto(FaceRepairClusterFacesRequestSchema) {}

export const FaceRepairClusterFacesResponseSchema = z
  .object({
    faces: z.array(z.object({ assetFaceId: z.string(), ...FacePhotoContextShape })),
    total: z.number(),
    hasMore: z.boolean(),
  })
  .meta({ id: 'FaceRepairClusterFacesResponseDto' });
export class FaceRepairClusterFacesResponseDto extends createZodDto(FaceRepairClusterFacesResponseSchema) {}

// `resolve` (the full per-face resolution, spec specs/2026-07-10-face-cleanup-full-resolution-design.md)
// replaces the retired 2-state `apply`. Every bucket is now wired end-to-end: `moveToPerson` (move to a chosen
// person / owner), `stay` (soft-decline "keep here"), `lock` (confirm/lock), `detach` ("not a face"), `unknown`
// (park in a fresh cluster), and `entireCluster` (server-enumerated whole-cluster move).
// `lock` on a MoveGroup (temporal-consistency hardening, "move-and-lock"): a deliberate move can also durably,
// owner-agnostically lock the moved faces to their destination, so a later re-scan never re-flags them.
// Defaults to false — plain moves stay undurable unless the caller opts in.
const MoveGroupSchema = z.object({
  destinationPersonId: z.uuidv4(),
  faceIds: z.array(z.uuidv4()).min(1).max(MAX_RESOLVE_FACES),
  lock: z.boolean().default(false),
});
export const FaceRepairResolveRequestSchema = z
  .object({
    personId: z.uuidv4(),
    moveToPerson: z.array(MoveGroupSchema).max(MAX_RESOLVE_TARGETS).default([]),
    stay: z.array(z.uuidv4()).max(MAX_RESOLVE_FACES).default([]),
    lock: z.array(z.uuidv4()).max(MAX_RESOLVE_FACES).default([]),
    detach: z.array(z.uuidv4()).max(MAX_RESOLVE_FACES).default([]),
    // "Unknown person" (state 6): a real face of a real person the admin cannot name — the standard case when
    // reviewing someone else's library. The server moves these into a FRESH unnamed person owned by the
    // reviewed cluster's owner and locks them there. Deliberately NOT a bare unassign: an unassigned face is
    // re-queued by recognition and re-matched onto its nearest neighbour-with-a-person (very often the cluster
    // it was just pulled out of), so "send it back to the unknown pool" would boomerang. Giving it a person of
    // its own means recognition skips it, the lock means no future scan re-flags it, and it still surfaces as an
    // unnamed cluster on the People page for anyone to name later.
    unknown: z.array(z.uuidv4()).max(MAX_RESOLVE_FACES).default([]),
    entireCluster: z.object({ destinationPersonId: z.uuidv4() }).optional(),
  })
  .meta({ id: 'FaceRepairResolveRequestDto' });
export class FaceRepairResolveRequestDto extends createZodDto(FaceRepairResolveRequestSchema) {}
export type FaceRepairResolveRequest = z.infer<typeof FaceRepairResolveRequestSchema>;

export const FaceRepairResolveResponseSchema = z
  .object({
    moved: z.number(),
    declined: z.number(),
    locked: z.number(),
    detached: z.number(),
    // Faces parked in a fresh unnamed cluster of their own. Counted separately from `moved` (they never pass
    // through the moveToPerson buckets) and from `locked` (they are locked, but reporting them in both would
    // double-count them in the apply summary).
    unknown: z.number(),
    skipped: z.number(),
  })
  .meta({ id: 'FaceRepairResolveResponseDto' });
export class FaceRepairResolveResponseDto extends createZodDto(FaceRepairResolveResponseSchema) {}
export type FaceRepairResolveResponse = z.infer<typeof FaceRepairResolveResponseSchema>;

// Slice 4 (owner-scoped people for the move-to-chosen-person picker): Immich's own `getAllPeople` /
// `createPerson` are self-scoped to the calling user, so the admin move-to-person picker needs dedicated,
// admin-only, owner-scoped helpers instead — always the reviewed CLUSTER's owner (`:ownerId` in the route),
// never the admin's own people.
export const FaceRepairOwnerPeopleQuerySchema = z
  .object({
    query: z.string().optional(),
    page: z.coerce.number().int().min(0).default(0),
  })
  .meta({ id: 'FaceRepairOwnerPeopleQueryDto' });
export class FaceRepairOwnerPeopleQueryDto extends createZodDto(FaceRepairOwnerPeopleQuerySchema) {}

const FaceRepairOwnerPersonRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  faceCount: z.number(),
  thumbnailFaceId: z.string().nullable(),
});
export const FaceRepairOwnerPeopleResponseSchema = z
  .object({
    people: z.array(FaceRepairOwnerPersonRowSchema),
    total: z.number(),
    hasMore: z.boolean(),
  })
  .meta({ id: 'FaceRepairOwnerPeopleResponseDto' });
export class FaceRepairOwnerPeopleResponseDto extends createZodDto(FaceRepairOwnerPeopleResponseSchema) {}

export const FaceRepairOwnerPersonCreateRequestSchema = z
  .object({ name: z.string().min(1) })
  .meta({ id: 'FaceRepairOwnerPersonCreateRequestDto' });
export class FaceRepairOwnerPersonCreateRequestDto extends createZodDto(FaceRepairOwnerPersonCreateRequestSchema) {}

export const FaceRepairOwnerPersonCreatedResponseSchema = z
  .object({ id: z.string() })
  .meta({ id: 'FaceRepairOwnerPersonCreatedResponseDto' });
export class FaceRepairOwnerPersonCreatedResponseDto extends createZodDto(FaceRepairOwnerPersonCreatedResponseSchema) {}

// Slice 3 (manual face review): the manual review page has no scan to read personName/ownerId off, and the
// user-scoped GET /people/:id does not admin-bypass for a person the admin does not own. `name` is returned
// raw (empty string for an unnamed person) — the client applies its own display fallback.
export const FaceRepairPersonMetadataResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    ownerId: z.string(),
    faceCount: z.number(),
    thumbnailFaceId: z.string().nullable(),
  })
  .meta({ id: 'FaceRepairPersonMetadataResponseDto' });
export class FaceRepairPersonMetadataResponseDto extends createZodDto(FaceRepairPersonMetadataResponseSchema) {}
