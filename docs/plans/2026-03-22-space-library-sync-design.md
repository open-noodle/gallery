# Space-Library Sync Design

## Problem

External libraries can contain tens or hundreds of thousands of photos, managed by admins.
Users have no visibility into the library concept. Shared Spaces provide collaborative access
to photos but require manually adding assets one by one. There is no way to share an entire
library's worth of photos with other users through spaces.

## Goal

Allow admins to link an external library to a shared space so that all library assets
automatically appear in the space. Space members can then toggle `showInTimeline` to merge
those photos into their main timeline, effectively getting per-library access control through
the existing spaces infrastructure.

## User Story

1. Admin creates a space (e.g., "Mom's Photos") and invites family members
2. In space settings, admin sees a "Connect Library" option (admin-only UI)
3. Admin picks a library from a dropdown of all managed libraries
4. All assets from that library immediately appear in the space
5. Each member toggles "show in timeline" per their preference
6. New photos added to the library via future scans automatically appear in the space

## Design Decisions

### Query-through (not sync-based)

Instead of copying every asset ID into `shared_space_asset`, space queries resolve library
assets at query time by joining through `shared_space_library` to `asset.libraryId`. This
means:

- No duplication of data (no 117k rows in a junction table)
- Zero sync delay — new library assets appear instantly
- No sync jobs to manage, no race conditions with the library scan pipeline
- `UNION` (not `UNION ALL`) deduplicates assets that exist in both `shared_space_asset`
  and a linked library

If per-asset control or materialized performance becomes necessary later, the
`shared_space_library` table stays the same — a sync layer can be added on top.

### Permission Model

Both conditions required to link or unlink a library:

- User is a **server admin** (library management is admin-only)
- User is an **editor or owner** of the target space

This means the admin must be a member of the space. This is intentional — you should not be
able to push photos into a space you are not part of.

### Face Recognition

**Automatic**, triggered in two scenarios:

1. **On library link creation**: A single `SharedSpaceLibraryFaceSync` orchestrator job is
   queued with `{ spaceId, libraryId }`. The handler queries all library assets with detected
   faces and processes them in batches internally. This avoids flooding the queue with 117k
   individual jobs.

2. **On ongoing library scans**: When the library scan creates new assets, individual
   `SharedSpaceFaceMatch` jobs are queued for each new asset against linked spaces. The
   number of new assets per scan is small (tens/hundreds), so individual jobs are fine.

Face matching reuses existing face embeddings computed during normal asset processing — only
the matching step (comparing embeddings to space-scoped people) runs.

## Data Model

One new table. No changes to existing tables.

### `shared_space_library`

| Column      | Type        | Constraints                              |
| ----------- | ----------- | ---------------------------------------- |
| `spaceId`   | uuid        | PK, FK → `shared_space` (CASCADE delete) |
| `libraryId` | uuid        | PK, FK → `library` (CASCADE delete)      |
| `addedById` | uuid / null | FK → `user` (SET NULL)                   |
| `createdAt` | timestamptz | auto-generated                           |

Composite primary key `(spaceId, libraryId)`. A library can be linked to multiple spaces. A
space can have multiple linked libraries.

See `docs/plans/space-library-sync-erd.html` for the full entity relationship diagram.

## API

Two new endpoints on the existing `SharedSpaceController`:

### `PUT /shared-spaces/:id/libraries`

- Body: `{ libraryId: string }`
- Guards: admin + space editor/owner
- Creates row in `shared_space_library`
- Queues `SharedSpaceLibraryFaceSync` orchestrator job
- Returns updated space

### `DELETE /shared-spaces/:id/libraries/:libraryId`

- Guards: admin + space editor/owner
- Deletes row from `shared_space_library`
- Library assets disappear from space immediately (query-through)

## Query Changes

All space asset queries need to UNION library-linked assets. Affected areas:

- **`SharedSpaceRepository`**: `getAssetCount()`, `getRecentAssets()`, `getNewAssetCount()`
- **`AssetRepository`**: `getTimeBuckets()`, `getTimeBucket()` where `timelineSpaceIds` is
  used
- **Space map queries**: include library assets in map markers
- **Space search queries**: include library assets in search results

Pattern for all queries:

```sql
-- Manual assets
SELECT a.id FROM asset a
JOIN shared_space_asset sa ON sa."assetId" = a.id
WHERE sa."spaceId" = :spaceId

UNION

-- Library-linked assets
SELECT a.id FROM asset a
JOIN shared_space_library sl ON sl."libraryId" = a."libraryId"
WHERE sl."spaceId" = :spaceId
```

## What This Does NOT Cover

- **Reverse sync**: Photos added to the space by members are not imported back into the
  library. One-way only (library → space).
- **Per-asset exclusion**: Linking a library is all-or-nothing. To exclude individual assets,
  unlink the library and manually add the desired assets.
- **User-facing library UI**: Libraries remain an admin-only concept. Users see library photos
  through spaces, not through a library browser.
