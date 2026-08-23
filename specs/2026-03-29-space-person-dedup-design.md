# Space Person Deduplication Design

## Problem

When multiple external libraries are linked to a shared space and the same physical person appears across them, duplicate `shared_space_person` records get created. This happens because `processSpaceFaceMatch` only uses embedding distance to find existing space persons -- if the distance exceeds `maxDistance`, it creates a new one without checking whether the face's `personId` already has a corresponding space person.

Three duplicate scenarios:

- **(a)** Same owner, same `personId` across libraries -- most common, produces identical thumbnails
- **(b)** Same owner, different `personId` records for the same physical person (unmerged in personal library)
- **(c)** Different owners, different `personId` records for the same physical person

## Solution Overview

Two layers of automatic deduplication plus a manual trigger for existing duplicates:

1. **Layer 1**: `personId` fallback during face sync -- prevents scenario (a)
2. **Layer 2**: Post-sync merge pass using the vector index -- catches scenarios (b) and (c)
3. **Manual trigger**: "Deduplicate people" action in space settings for cleaning up existing duplicates

## Layer 1: `personId` Fallback During Sync

In `processSpaceFaceMatch`, after embedding matching fails for a regular person face, add a `findSpacePersonByLinkedPersonId` check before creating a new space person -- identical to what pets already do.

### Modified flow (shared-space.service.ts, `processSpaceFaceMatch`)

```
1. Check if face already assigned -> skip
2. Find closest space person by embedding distance
3. If match found -> assign face to that space person
4. If no match:
   a. If face has no personId -> skip
   b. Check findSpacePersonByLinkedPersonId(spaceId, face.personId)
   c. If existing space person found -> assign face to it
   d. If not found -> create new space person
```

### Properties

- Handles scenario (a) with zero false positives (exact ID match)
- ~5 lines of code change
- No new queries needed -- `findSpacePersonByLinkedPersonId` already exists (used by pet path)

## Layer 2: Post-Sync Merge Pass (Index-Based)

After library face sync completes, a dedup job runs that compares all space persons' embeddings against each other using the existing vectorchord index.

### New job

- `JobName.SharedSpacePersonDedup` on the `FacialRecognition` queue
- Queued automatically after: `handleSharedSpaceLibraryFaceSync`, `handleSharedSpaceFaceMatchAll`
- BullMQ serializes jobs on the same queue, solving concurrent sync concerns naturally

### Algorithm (`deduplicateSpacePeople(spaceId)`)

1. Fetch all space person IDs + their representative face embeddings (join `shared_space_person` -> `face_search` via `representativeFaceId`)
2. For each space person, call `findClosestSpacePerson` with:
   - `excludePersonIds: [self]` (new parameter, required to avoid self-match at distance ~0)
   - `type` filter (new parameter, never merge 'person' with 'pet')
3. If match within `maxDistance` -> merge:
   - **Target**: the space person with more faces
   - **Face reassignment**: `UPDATE shared_space_person_face SET personId = target WHERE personId = source` with `ON CONFLICT DO NOTHING` (handles edge case where same face exists on both)
   - **Representative face**: keep target's existing `representativeFaceId` (only affects thumbnail, not matching)
   - **Name**: prefer non-empty name; if both named, keep target's
   - **Aliases**: copy from source to target with `ON CONFLICT DO NOTHING` (composite PK `(personId, userId)`)
   - **Hidden state**: if either is visible (`isHidden = false`), result is visible
   - **Delete source**: handle "not found" gracefully (concurrent dedup resilience)
4. Repeat for only the persons involved in merges, until a pass produces zero merges (handles transitive chains: A matches B, B matches C)

### Repository changes

- `findClosestSpacePerson`: add optional `excludePersonIds` and `type` parameters
- New method to fetch representative face embeddings for all space persons in a space

### Scaling

- O(n) vector index queries per pass (not O(n^2) brute-force)
- Vectorchord index queries are O(log n) each
- Typically converges in 1-2 passes
- Tested against spaces with thousands of people (750K photo libraries)

### Concurrency

Two concurrent library syncs can create duplicates via TOCTOU in both the embedding check and the `personId` check. This is acceptable because:

- Both syncs queue a `SharedSpacePersonDedup` job after finishing
- BullMQ serializes jobs on the same queue, so dedup runs sequentially
- The merge pass is idempotent -- running it twice is harmless

## Manual Trigger

### Endpoint

- `POST /spaces/:id/people/deduplicate`
- Requires **Owner** role on the space
- Queues the same `SharedSpacePersonDedup` job (shared code path with post-sync trigger)
- Returns immediately (background job)

### UI

- "Deduplicate people" button in space settings, visible to space owners only

## No Schema Changes

- No new tables, columns, or migrations
- Layer 1 uses existing `findSpacePersonByLinkedPersonId` method
- Layer 2 extends `findClosestSpacePerson` with optional parameters
- New job type added to `JobName` enum

## Testing

- Unit tests for the `personId` fallback in `processSpaceFaceMatch`
- Unit tests for `deduplicateSpacePeople`:
  - Basic merge (two persons with matching embeddings)
  - Name preservation (non-empty wins)
  - Alias migration with conflict handling
  - Hidden state resolution (visible wins)
  - Type filtering (person/pet never merged)
  - Transitive merge convergence
  - Idempotency (running twice is safe)
  - Self-exclusion (person doesn't match itself)
- E2E test for the deduplicate endpoint (owner role check)

## Known Limitations

- Space persons whose `representativeFaceId` points to a deleted face (missing `face_search` row) are invisible to the dedup algorithm. These orphaned persons require manual merge.
