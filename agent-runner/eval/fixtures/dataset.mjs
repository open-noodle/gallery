// Frozen seed data for the L2 eval layer. Fixed UUIDs, no wall-clock, no
// randomness — every scenario must produce the same result on every run.

export const OWNER_ID = '00000000-0000-4000-8000-000000000001';
export const ALBUM_JAPAN_ID = '00000000-0000-4000-8000-000000000101';
export const ALBUM_SUMMER_A_ID = '00000000-0000-4000-8000-000000000102';
export const ALBUM_SUMMER_B_ID = '00000000-0000-4000-8000-000000000103';
export const USER_ALEX_ID = '00000000-0000-4000-8000-000000000201';
export const TRIP_HANDLE_ID = '00000000-0000-4000-8000-000000000921';
export const SEARCH_HANDLE_ID = '00000000-0000-4000-8000-000000000922';
export const PLAN_ID = '00000000-0000-4000-8000-000000000923';

// Two albums deliberately share the name "Summer" so the ambiguity arm
// (needs_input on multiple matches) is reachable without an override.
export const DATASET = Object.freeze({
  albums: Object.freeze([
    Object.freeze({ id: ALBUM_JAPAN_ID, albumName: 'Japan', ownerId: OWNER_ID, assetCount: 120 }),
    Object.freeze({ id: ALBUM_SUMMER_A_ID, albumName: 'Summer', ownerId: OWNER_ID, assetCount: 40 }),
    Object.freeze({ id: ALBUM_SUMMER_B_ID, albumName: 'Summer', ownerId: OWNER_ID, assetCount: 12 }),
  ]),
  users: Object.freeze([Object.freeze({ userId: USER_ALEX_ID, name: 'Alex', email: 'alex@example.com' })]),
  duplicateGroups: Object.freeze([
    Object.freeze({ id: 'dup-1', assetCount: 3 }),
    Object.freeze({ id: 'dup-2', assetCount: 2 }),
  ]),
  tripCandidates: Object.freeze([
    Object.freeze({
      dedupeKey: 'trip:japan:tokyo:2026-05-03:2026-05-12',
      label: 'Tokyo, Japan',
      confidence: 'high',
      startDate: '2026-05-03',
      endDate: '2026-05-12',
      selectionHandle: Object.freeze({ id: TRIP_HANDLE_ID, assetCount: 84 }),
      places: Object.freeze([Object.freeze({ city: 'Tokyo', country: 'Japan' })]),
    }),
  ]),
  tripRecommendation: Object.freeze({
    action: 'use_top_candidate',
    candidateDedupeKey: 'trip:japan:tokyo:2026-05-03:2026-05-12',
    reason: 'The only readable trip candidate is high confidence.',
  }),
  searchSelectionHandle: Object.freeze({ id: SEARCH_HANDLE_ID, assetCount: 25 }),
  planId: PLAN_ID,
});
