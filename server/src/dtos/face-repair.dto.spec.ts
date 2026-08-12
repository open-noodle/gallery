import {
  FaceRepairClusterFacesRequestSchema,
  FaceRepairDeclineRemoveRequestSchema,
  FaceRepairResolutionsRemoveRequestSchema,
  FaceRepairResolveRequestSchema,
  FaceRepairScanStatusSchema,
  FaceRepairScanTriggerRequestSchema,
  FaceRepairUnconfirmRequestSchema,
} from 'src/dtos/face-repair.dto';
import { describe, expect, it } from 'vitest';

// face_repair_decline.id is a UUID v7 (@PrimaryGeneratedUuidV7Column). The remove DTO must accept it —
// validating with z.uuidv4() rejected v7 ids with a 400, which broke "Undo" on the declined page.
const UUID_V7 = '01890000-0000-7000-8000-000000000001';
const UUID_V4 = '00000000-0000-4000-a000-000000000001';

describe('FaceRepairDeclineRemoveRequestSchema', () => {
  it('accepts a v7 row id (regression for the declined-page Undo 400)', () => {
    const result = FaceRepairDeclineRemoveRequestSchema.safeParse({ ids: [UUID_V7] });
    expect(result.success).toBe(true);
  });

  it('still accepts v4 ids', () => {
    expect(FaceRepairDeclineRemoveRequestSchema.safeParse({ ids: [UUID_V4] }).success).toBe(true);
  });

  it('accepts removal by face natural key', () => {
    const result = FaceRepairDeclineRemoveRequestSchema.safeParse({
      faces: [{ assetFaceId: UUID_V4, suspectedOwnerId: UUID_V4 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty ids array', () => {
    expect(FaceRepairDeclineRemoveRequestSchema.safeParse({ ids: [] }).success).toBe(false);
  });

  it('rejects a non-uuid id', () => {
    expect(FaceRepairDeclineRemoveRequestSchema.safeParse({ ids: ['not-a-uuid'] }).success).toBe(false);
  });
});

describe('FaceRepairScanTriggerRequestSchema', () => {
  it('accepts an empty body (quick-path Re-scan)', () => {
    expect(FaceRepairScanTriggerRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts the curated params', () => {
    const r = FaceRepairScanTriggerRequestSchema.safeParse({
      params: { maxDistance: 0.45, minFaces: 4, maxFlaggedFraction: 0.3 },
    });
    expect(r.success).toBe(true);
  });

  it('accepts the non-curated params too (full optional set; future raw panel)', () => {
    const r = FaceRepairScanTriggerRequestSchema.safeParse({
      params: { voteWindow: 100, voteMargin: 0, maxAttributionDistance: 0.4, largeClusterThreshold: 80 },
    });
    expect(r.success).toBe(true);
  });

  it('rejects maxDistance above 2', () => {
    expect(FaceRepairScanTriggerRequestSchema.safeParse({ params: { maxDistance: 2.5 } }).success).toBe(false);
  });

  it('rejects maxFlaggedFraction above 1', () => {
    expect(FaceRepairScanTriggerRequestSchema.safeParse({ params: { maxFlaggedFraction: 1.5 } }).success).toBe(false);
  });

  it('rejects minFaces below 1', () => {
    expect(FaceRepairScanTriggerRequestSchema.safeParse({ params: { minFaces: 0 } }).success).toBe(false);
  });

  it('rejects maxDistance at or below 0', () => {
    expect(FaceRepairScanTriggerRequestSchema.safeParse({ params: { maxDistance: 0 } }).success).toBe(false);
  });

  it('rejects maxAttributionDistance at or below 0', () => {
    expect(FaceRepairScanTriggerRequestSchema.safeParse({ params: { maxAttributionDistance: 0 } }).success).toBe(false);
  });
});

describe('FaceRepairResolveRequestSchema', () => {
  const PERSON_ID = '00000000-0000-4000-a000-000000000001';
  const OWNER_A = '00000000-0000-4000-a000-000000000002';
  const OWNER_B = '00000000-0000-4000-a000-000000000003';
  const FACE_1 = '00000000-0000-4000-a000-000000000004';
  const FACE_2 = '00000000-0000-4000-a000-000000000005';
  const FACE_3 = '00000000-0000-4000-a000-000000000006';

  it('accepts owner move groups and defaults stay/lock/detach to []', () => {
    const result = FaceRepairResolveRequestSchema.safeParse({
      personId: PERSON_ID,
      moveToPerson: [
        { destinationPersonId: OWNER_A, faceIds: [FACE_1, FACE_2] },
        { destinationPersonId: OWNER_B, faceIds: [FACE_3] },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stay).toEqual([]);
      expect(result.data.lock).toEqual([]);
      expect(result.data.detach).toEqual([]);
    }
  });

  it('accepts an empty body beyond personId (defaults every bucket to [])', () => {
    const result = FaceRepairResolveRequestSchema.safeParse({ personId: PERSON_ID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.moveToPerson).toEqual([]);
    }
  });

  it('rejects a non-uuid faceId in a moveToPerson group', () => {
    const result = FaceRepairResolveRequestSchema.safeParse({
      personId: PERSON_ID,
      moveToPerson: [{ destinationPersonId: OWNER_A, faceIds: ['not-a-uuid'] }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid personId', () => {
    expect(FaceRepairResolveRequestSchema.safeParse({ personId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects a moveToPerson group with an empty faceIds array', () => {
    const result = FaceRepairResolveRequestSchema.safeParse({
      personId: PERSON_ID,
      moveToPerson: [{ destinationPersonId: OWNER_A, faceIds: [] }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid id in stay/lock/detach', () => {
    expect(FaceRepairResolveRequestSchema.safeParse({ personId: PERSON_ID, stay: ['not-a-uuid'] }).success).toBe(false);
    expect(FaceRepairResolveRequestSchema.safeParse({ personId: PERSON_ID, lock: ['not-a-uuid'] }).success).toBe(false);
    expect(FaceRepairResolveRequestSchema.safeParse({ personId: PERSON_ID, detach: ['not-a-uuid'] }).success).toBe(
      false,
    );
  });

  // Temporal-consistency hardening, Slice 3 (move-and-lock): moveToPerson groups gain an optional `lock` flag.
  it('accepts lock: true on a moveToPerson group', () => {
    const result = FaceRepairResolveRequestSchema.safeParse({
      personId: PERSON_ID,
      moveToPerson: [{ destinationPersonId: OWNER_A, faceIds: [FACE_1], lock: true }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.moveToPerson[0].lock).toBe(true);
    }
  });

  it('accepts lock: false on a moveToPerson group', () => {
    const result = FaceRepairResolveRequestSchema.safeParse({
      personId: PERSON_ID,
      moveToPerson: [{ destinationPersonId: OWNER_A, faceIds: [FACE_1], lock: false }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.moveToPerson[0].lock).toBe(false);
    }
  });

  it('defaults a moveToPerson group lock to false when omitted', () => {
    const result = FaceRepairResolveRequestSchema.safeParse({
      personId: PERSON_ID,
      moveToPerson: [{ destinationPersonId: OWNER_A, faceIds: [FACE_1] }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.moveToPerson[0].lock).toBe(false);
    }
  });

  it('rejects a non-boolean lock on a moveToPerson group', () => {
    const result = FaceRepairResolveRequestSchema.safeParse({
      personId: PERSON_ID,
      moveToPerson: [{ destinationPersonId: OWNER_A, faceIds: [FACE_1], lock: 'yes' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('FaceRepairClusterFacesRequestSchema', () => {
  const UUID = '00000000-0000-4000-a000-000000000001';

  it('accepts a valid page/size and defaults excludeFaceIds to []', () => {
    const result = FaceRepairClusterFacesRequestSchema.safeParse({ page: 0, size: 50 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.excludeFaceIds).toEqual([]);
    }
  });

  it('accepts excludeFaceIds and the boundary size of 200', () => {
    expect(FaceRepairClusterFacesRequestSchema.safeParse({ excludeFaceIds: [UUID], page: 3, size: 200 }).success).toBe(
      true,
    );
  });

  it('rejects size below 1 (E14)', () => {
    expect(FaceRepairClusterFacesRequestSchema.safeParse({ page: 0, size: 0 }).success).toBe(false);
  });

  it('rejects size above 200 (E14)', () => {
    expect(FaceRepairClusterFacesRequestSchema.safeParse({ page: 0, size: 201 }).success).toBe(false);
  });

  it('rejects a negative page (E14)', () => {
    expect(FaceRepairClusterFacesRequestSchema.safeParse({ page: -1, size: 50 }).success).toBe(false);
  });

  it('rejects a non-integer size', () => {
    expect(FaceRepairClusterFacesRequestSchema.safeParse({ page: 0, size: 1.5 }).success).toBe(false);
  });
});

// C4: every per-request face/owner array is bounded so a runaway admin payload cannot drive unbounded work.
const bulkUuid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const bulkIds = (n: number) => Array.from({ length: n }, (_, i) => bulkUuid(i + 1));

describe('FaceRepairResolveRequestSchema face-array bounds (C4)', () => {
  it('accepts a large-but-bounded bucket (25 000 faces)', () => {
    const stay = Array.from({ length: 25_000 }, (_, i) => bulkUuid(i + 1));
    expect(FaceRepairResolveRequestSchema.safeParse({ personId: UUID_V4, stay }).success).toBe(true);
  });

  it('rejects a bucket over the 25 000-face ceiling', () => {
    const stay = Array.from({ length: 25_001 }, (_, i) => bulkUuid(i + 1));
    expect(FaceRepairResolveRequestSchema.safeParse({ personId: UUID_V4, stay }).success).toBe(false);
  });

  it('rejects a moveToPerson group whose faceIds exceed the ceiling', () => {
    const faceIds = Array.from({ length: 25_001 }, (_, i) => bulkUuid(i + 1));
    const result = FaceRepairResolveRequestSchema.safeParse({
      personId: UUID_V4,
      moveToPerson: [{ destinationPersonId: bulkUuid(999_999), faceIds }],
    });
    expect(result.success).toBe(false);
  });

  // The regression this ceiling was raised for: a real 2952-face cluster flagged 2382 faces toward ONE owner,
  // so the client emitted them as a single move group and every Apply 400'd with no way to ever succeed.
  // `entireCluster` is not the same action — it drains all 2952, flagged or not.
  it('accepts a whole flagged subset of a large cluster in one move group', () => {
    const faceIds = Array.from({ length: 2382 }, (_, i) => bulkUuid(i + 1));
    const result = FaceRepairResolveRequestSchema.safeParse({
      personId: UUID_V4,
      moveToPerson: [{ destinationPersonId: bulkUuid(999_999), faceIds }],
    });
    expect(result.success).toBe(true);
  });

  // Group COUNT is a separate quantity from faces-per-group: raising the face bound must not let a resolve
  // route to 25 000 distinct destinations.
  it('rejects more than 1000 move groups', () => {
    const moveToPerson = Array.from({ length: 1001 }, (_, i) => ({
      destinationPersonId: bulkUuid(i + 1),
      faceIds: [bulkUuid(500_000 + i)],
    }));
    expect(FaceRepairResolveRequestSchema.safeParse({ personId: UUID_V4, moveToPerson }).success).toBe(false);
  });
});

// S10.1/S10.2 (F20): the DTO's own comment claims every per-request face/owner array is capped at
// MAX_RESOLVE_FACES. That was false for these four fields — three had only a `.min(1)`, and
// excludeFaceIds had no cap at all. Table-driven over all four so the same 25 000/25 001 boundary is
// asserted identically for each.
describe('Per-request face/owner array bounds (F20)', () => {
  const cases = [
    {
      name: 'FaceRepairUnconfirmRequestSchema.assetFaceIds',
      parse: (ids: string[]) => FaceRepairUnconfirmRequestSchema.safeParse({ assetFaceIds: ids }),
    },
    {
      name: 'FaceRepairResolutionsRemoveRequestSchema.verdictIds',
      parse: (ids: string[]) => FaceRepairResolutionsRemoveRequestSchema.safeParse({ verdictIds: ids }),
    },
    {
      name: 'FaceRepairResolutionsRemoveRequestSchema.clusterMuteIds',
      parse: (ids: string[]) => FaceRepairResolutionsRemoveRequestSchema.safeParse({ clusterMuteIds: ids }),
    },
    {
      // S10.2: this row has NO cap at all today (not even the 1000 the others started from) — the
      // genuine red among the four.
      name: 'FaceRepairClusterFacesRequestSchema.excludeFaceIds',
      parse: (ids: string[]) =>
        FaceRepairClusterFacesRequestSchema.safeParse({ excludeFaceIds: ids, page: 0, size: 50 }),
    },
  ];

  it.each(cases)('$name accepts exactly the 25 000-id ceiling', ({ parse }) => {
    expect(parse(bulkIds(25_000)).success).toBe(true);
  });

  it.each(cases)('$name rejects 25 001 ids', ({ parse }) => {
    expect(parse(bulkIds(25_001)).success).toBe(false);
  });
});

describe('ScanSuspectedOwnerSchema (via FaceRepairScanStatusSchema)', () => {
  const scan = (owner: Record<string, unknown>) => ({
    id: 'scan-1',
    status: 'completed',
    progress: null,
    totals: null,
    persons: [
      {
        personId: UUID_V4,
        ownerId: UUID_V4,
        personName: null,
        faceCount: 10,
        thumbnailFaceId: null,
        eligible: 10,
        flagged: 3,
        flaggedFraction: 0.3,
        suspectedOwners: [owner],
        recommendation: 'review-first',
        reviewReasons: [],
      },
    ],
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-07-29T00:00:00.000Z',
  });

  const validOwner = {
    ownerPersonId: UUID_V4,
    ownerName: 'Katrin',
    thumbnailFaceId: null,
    count: 2201,
    ownerFaceCount: 1204,
    ownerMissing: false,
  };

  it('accepts an owner carrying both its routing share and its own face count', () => {
    const parsed = FaceRepairScanStatusSchema.safeParse(scan(validOwner));
    expect(parsed.success && parsed.data.persons[0].suspectedOwners[0]).toMatchObject({
      ownerFaceCount: 1204,
      ownerMissing: false,
    });
  });

  it('rejects a bigint-as-string face count (what Postgres count() returns unconverted)', () => {
    const result = FaceRepairScanStatusSchema.safeParse(scan({ ...validOwner, ownerFaceCount: '1204' }));
    expect(result.success).toBe(false);
  });

  it('requires the overlay to state whether the destination still exists', () => {
    const { ownerMissing: _ownerMissing, ...withoutFlag } = validOwner;
    expect(FaceRepairScanStatusSchema.safeParse(scan(withoutFlag)).success).toBe(false);
  });
});
