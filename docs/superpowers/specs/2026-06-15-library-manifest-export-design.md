# Library Manifest Export Endpoint Design

## Context

Users who store their library in object storage need a way to export everything they own — a
data-portability / "takeout" capability. The goal is not for the server to build and serve a zip
archive (it already supports downloading selected assets); it is to expose a **manifest**: a complete,
machine-readable listing of a user's original files with their object-storage keys, integrity
checksums, basic file metadata, and album membership. A caller (an export/backup tool, or an operator
acting on a user's behalf) uses the manifest to fetch each object directly from storage — a no-copy
export that never streams the bytes back through the server.

There is no such listing today. The closest existing surfaces — the timeline/search APIs and the
selected-assets download — neither expose storage object keys + checksums nor guarantee complete,
stable coverage of everything a user owns across all visibilities.

## Goals

- Add an admin API endpoint that returns a **complete, paginated manifest** of a target user's owned,
  live, non-trashed assets across **all** visibilities (timeline, archive, hidden, locked).
- Each entry carries enough to download and verify the original object and reconstruct album
  organization: object key, checksum (+ algorithm), size, original filename, timestamps, type, album ids.
- Stable pagination that does not skip or duplicate existing rows if the library changes during a long
  export (keyset/cursor).
- A versioned response envelope so consumers can guard against breaking changes.

## Non-Goals (out of scope for this slice)

- Derived objects (thumbnails, previews, encoded video, sidecars) — regenerable; not part of an
  originals export.
- Rich per-asset metadata (EXIF/GPS, people/faces, tags, descriptions, ratings) — a larger,
  multi-table follow-up.
- A self-service variant (a user exporting their own library) — admin-scoped only for now.
- The server building/serving an archive — this is a manifest only; the caller fetches the objects.
- External-library assets — see "Which assets"; excluded by design (their bytes are not in the bucket).

## Prerequisite (must be confirmed before Slice 1)

**`asset.originalPath` is the raw object key under the user's object-storage bucket** (no leading
slash, no bucket prefix). The entire no-copy premise depends on this: the caller fetches each object
by `objectKey` directly from storage. If `originalPath` is instead an absolute filesystem path or
carries a prefix the storage layer strips, `objectKey` must be derived from it via the same mapping
the storage backend uses, and that mapping belongs in the service layer. **Verify against the running
Noodle deployment's storage config before implementing** (inspect a real `originalPath` value and the
OVH S3 object key for the same asset). This is a hard blocker, not a footnote.

## API Contract

### Route & auth

```
GET /api/admin/users/:id/library-manifest?cursor=<assetId>
```

- **Auth:** `@Authenticated({ permission: Permission.AdminUserRead, admin: true })` — admin-only,
  matching the existing `/admin/users/:id` endpoints (verified: `user-admin.controller.ts`).
- **`:id`** — the target user's id (`UUIDParamDto`). `404` if no such user.
- **`cursor`** (optional) — the `assetId` returned as `nextCursor` by the previous page. Absent on the
  first request. `400` if present but not a valid UUID.

### Response

```jsonc
{
  "manifestSchemaVersion": 1, // bump on breaking changes; consumers must guard
  "generatedAt": "2026-06-15T12:00:00.000Z", // ISO-8601, when this page was generated
  "owner": { "id": "<uuid>", "email": "<string>" }, // the target user
  "albums": [{ "id": "<uuid>", "name": "<string>" }], // the user's OWN albums; maps albumIds -> names
  "assets": [/* ManifestAssetItem, this page */],
  "nextCursor": "<assetId>", // pass back as ?cursor to get the next page; null when exhausted
}
```

- `albums` is the target user's full **owned** album list (albums where `album.ownerId = :id`) and is
  repeated on **every** page so each page is self-contained (the list is small — tens of entries — and
  lets a consumer that starts mid-stream still resolve album names).
- `nextCursor` is the `assetId` of the last asset in this page **iff** more pages remain, else `null`.

### ManifestAssetItem

```jsonc
{
  "assetId": "<uuid>",
  "objectKey": "<string>", // = asset.originalPath; the object key under the object-storage backend
  "originalFileName": "<string>",
  "checksum": "<base64>", // base64-encoded SHA1 hash; reuse hexOrBufferToBase64()
  "checksumAlgorithm": "sha1", // ChecksumAlgorithm: 'sha1' (managed uploads). 'sha1-path' marks external libs (excluded)
  "size": 123456, // bytes (number; fileSizeInByte is typed number|null); null if no exif row
  "type": "IMAGE", // AssetType enum, serialized as-is (IMAGE, VIDEO, …)
  "fileCreatedAt": "<ISO-8601>",
  "fileModifiedAt": "<ISO-8601>",
  "albumIds": ["<uuid>", "..."], // the user's OWN albums this asset belongs to (possibly empty)
}
```

### Errors

| Status | When                                                                      |
| ------ | ------------------------------------------------------------------------- |
| `401`  | unauthenticated                                                           |
| `403`  | authenticated but not an admin / lacks `AdminUserRead`                    |
| `404`  | user `:id` does not exist                                                 |
| `400`  | `cursor` present but not a valid UUID                                     |
| `200`  | empty library or a cursor past the end → `assets: []`, `nextCursor: null` |

## Behavior & Semantics

### Which assets

Included: assets that are **owned by `:id`, live, and stored in the managed object storage**. The
predicate (verified field names against `asset.table.ts`):

```sql
WHERE asset.ownerId = :id
  AND asset.deletedAt IS NULL
  AND asset.status = 'active'      -- AssetStatus.Active; explicitly excludes 'trashed' and 'deleted'
  AND asset.libraryId IS NULL      -- upload library only
  AND asset.isExternal = false     -- belt-and-suspenders with libraryId
```

across **all** visibilities (`timeline`, `archive`, `hidden`, `locked`).

Excluded:

- trashed / soft-deleted assets (`deletedAt IS NOT NULL` or `status <> 'active'`),
- assets owned by someone else (e.g. shared _to_ this user),
- **external-library assets** (`libraryId IS NOT NULL` / `isExternal = true`) — their `originalPath` is
  an external filesystem path, not an object key in the user's bucket, so a no-copy export cannot fetch
  them. In the Noodle managed setting users have no external libraries, so this is currently a no-op
  filter, but it keeps the manifest correct if that ever changes.

> Note on visibility: `hidden` is **not** a user "hidden folder" — in this schema it is the video
> component of live/motion photos (a real, separately-stored object with its own `originalPath`).
> `locked` is the private/locked folder. Both are deliberately included: they are the user's data and
> an originals export must be complete. (If locked-folder assets must be excluded for privacy, that is
> a one-line predicate change — decide before implementing Slice 1.)

### Pagination (keyset)

Order by `asset.id` ascending (the PK is unique, so the order is total and tie-free — a requirement for
keyset paging); page with a keyset predicate rather than `OFFSET`. Implemented with the Kysely query
builder (this repo does not use raw SQL); the SQL below is illustrative:

```sql
WHERE asset.ownerId = :id
  AND asset.deletedAt IS NULL
  AND asset.status = 'active'
  AND asset.libraryId IS NULL
  AND asset.isExternal = false
  AND (:cursor IS NULL OR asset.id > :cursor)
ORDER BY asset.id ASC
LIMIT :pageSize + 1
```

Fetch `pageSize + 1` rows; if more than `pageSize` come back, trim to `pageSize` and set `nextCursor`
to the last kept row's id, else `nextCursor = null`. `pageSize` is a server constant
(`MANIFEST_PAGE_SIZE`, default **1000**; tunable, no client override for now).

Keyset paging is stable across a long export: rows inserted after the cursor are simply picked up,
rows deleted are skipped, and no existing row is ever skipped or duplicated — unlike `OFFSET`.

### Album membership

Both the envelope `albums` list and per-asset `albumIds` are scoped to **albums owned by `:id`**
(`album.ownerId = :id`). This keeps the envelope self-consistent: every id in any asset's `albumIds`
resolves to a name in `albums`. Assets that live only in another user's _shared_ album therefore carry
an empty (or smaller) `albumIds` — by design; we export the user's own organization, not foreign
shared-album membership.

For the page's asset ids, resolve owned-album ids in **one** grouped query against the album↔asset join
(`album_asset(albumId, assetId)`), restricted to owned albums:
`SELECT assetId, array_agg(albumId) FROM album_asset JOIN album ... WHERE assetId = ANY(:ids) AND album.ownerId = :id GROUP BY assetId`,
then attach `albumIds` per asset (default `[]`). No N+1.

### Field sourcing

- `objectKey` = `asset.originalPath` (see Prerequisite). For an object-storage backend this is the
  object key; documented as such.
- `checksum` = base64 of the stored `checksum` `bytea`/Buffer, via the existing `hexOrBufferToBase64()`
  helper (used by `asset-response.dto.ts`). `checksumAlgorithm` from `asset.checksumAlgorithm`
  (`ChecksumAlgorithm`: `'sha1'` for managed uploads; `'sha1-path'` only on external libraries, which
  are excluded).
- `size` = `asset_exif.fileSizeInByte` (typed `number | null` in `src/types.ts` — the pg int8 parser
  returns a JS number, so `size` is a JSON number, **not** a string); `null` when no exif row exists.
- `type` = `asset.type` (`AssetType` enum), serialized as-is.
- timestamps — ISO-8601 from `asset.fileCreatedAt` / `asset.fileModifiedAt`.

### Schema version

`manifestSchemaVersion: 1`. Additive, backward-compatible changes do not bump it; removing/renaming a
field or changing semantics bumps it. Consumers should reject an unknown major version.

## Implementation Outline (shared reference for the slices)

Follow the existing controller → service → repository layering and the Zod-DTO + generated-OpenAPI
conventions.

- **Controller** — a dedicated `LibraryManifestController` (`@Controller('admin/users')`) exposing
  `GET admin/users/:id/library-manifest`, guarded
  `@Authenticated({ permission: Permission.AdminUserRead, admin: true })`, `:id` via `UUIDParamDto`,
  `cursor` via a small query DTO. (Decided: dedicated controller, not a route on
  `user-admin.controller.ts`.)
- **Service** — a dedicated `LibraryManifestService` (extends `BaseService`, which injects
  repositories): resolve the target user **with `withDeleted`** (so a deactivated account can still be
  exported for GDPR teardown) and `404` only if truly absent; run the keyset asset query, the grouped
  owned-album-ids query, the owned-albums query; map rows to DTOs; compute `nextCursor`; stamp
  `generatedAt` + `manifestSchemaVersion`.
- **Repository** — add narrow Kysely methods: asset repo — owned/live/non-external keyset query;
  album repo — owned-album-ids-for-assets and owned-albums-for-user. Keep mapping in the service.
- **DTOs** — `LibraryManifestResponseDto` + `LibraryManifestAssetDto` + a `LibraryManifestQueryDto`
  (cursor) as Zod schemas with `.meta({ id })` for OpenAPI; run `pnpm run sync:open-api` afterwards.
- **Permission** — reuse `Permission.AdminUserRead`.

## TDD Approach (applies to every slice)

Each slice is built test-first:

1. **Red** — write the slice's failing tests first; run them and confirm they fail for the _expected_
   reason (assertion mismatch / missing method), not a setup error.
2. **Green** — write the minimal implementation to make them pass; run and confirm green.
3. **Refactor** — clean up (extract helpers, tidy mapping) with tests staying green.
4. **Regen + validate** — when DTOs change, run `pnpm run sync:open-api`; run lint/typecheck.

Test harness mapping (verified against the repo):

- **Service + SQL behavior** → **medium tests** (`server/test/medium/specs/services/*.spec.ts`) via
  `newMediumService(LibraryManifestService, { database, real: [...repos...], mock: [...] })` against a
  **real Kysely DB**, seeding with `ctx.newUser()/newAsset()/newAlbum()`. Use real repos for the
  asset/album repos so the actual keyset + `array_agg` SQL runs. Run: `pnpm run test:medium`.
- **Pure logic** (nextCursor trim arithmetic, checksum→base64, envelope stamping) may also be small
  unit specs (`server/src/**/*.spec.ts`, `pnpm run test`) where no DB is needed.
- **Controller** (`server/src/controllers/library-manifest.controller.spec.ts`) → assert the route is
  authenticated (`ctx.authenticate` called) and DTO validation (**400** on bad cursor). It does **not**
  assert 403/404 — that is e2e.
- **E2E** (`e2e/src/specs/server/api/*.e2e-spec.ts`, `cd e2e && pnpm run test`) → **403** (non-admin via
  `userSetup` + `asBearerAuth`), **404** (missing user), happy path, and full pagination coverage.

## Slices

Three vertical slices, each shippable and independently testable. Earlier slices are a working baseline
for later ones; no slice implements a later slice's behavior.

### Slice 1 — Single-page manifest (no cursor, no albums)

**Outcome:** `GET admin/users/:id/library-manifest` returns the first up-to-`MANIFEST_PAGE_SIZE` owned,
live, managed assets for a user, fully mapped, with `albums: []`, `albumIds: []`, `nextCursor: null`.
A usable manifest for any user whose library fits in one page.

**Build:** `LibraryManifestAssetDto` + `LibraryManifestResponseDto` (Zod + `.meta`); `MANIFEST_PAGE_SIZE`
constant; asset-repo keyset method _without_ the cursor arg (just the filtered, ordered, limited query);
`LibraryManifestService.getManifest(auth, id)` doing user-resolve (`withDeleted`) + map + stamp; new
`LibraryManifestController` with the route; `pnpm run sync:open-api`.

**Tests (red→green):**

- _Medium:_ owner scoping (only `:id`'s assets); trash excluded (`deletedAt`/`status='trashed'` not
  returned); `status='deleted'` excluded; external excluded (`libraryId` set / `isExternal=true` not
  returned); **all four visibilities included** (seed one of each); field mapping — `objectKey ===
originalPath`, `checksum` base64 matches `hexOrBufferToBase64`, `checksumAlgorithm`, `type`,
  timestamps ISO-8601; `size` from `asset_exif.fileSizeInByte`; **`size: null` when no exif row**;
  `owner.{id,email}`; `manifestSchemaVersion === 1` and `generatedAt` present; empty library →
  `assets: []`, `nextCursor: null`, `albums: []`; **a deactivated (soft-deleted) target user's library
  is still exported** (user resolved with `withDeleted`).
- _Controller:_ route is authenticated (`ctx.authenticate` called).
- _E2E:_ admin happy path returns assets; **403** for a non-admin user; **404** for an unknown `:id`.

**Edge cases covered here:** empty library; user with only trashed assets → empty; user with only
external assets → empty; locked/hidden-only library still exported; deactivated target user exported.

### Slice 2 — Keyset pagination

**Outcome:** the endpoint accepts `?cursor=<assetId>` and pages stably to exhaustion.

**Build:** `LibraryManifestQueryDto` (`cursor: z.uuidv4().optional()`); extend the asset-repo method with
the `cursor` predicate (`asset.id > :cursor`) and fetch `pageSize + 1`; service trims to `pageSize` and
computes `nextCursor`; wire `@Query()` into the controller; regen OpenAPI.

**Tests (red→green):**

- _Medium:_ with `pageSize+1` matching rows, exactly `pageSize` returned and `nextCursor` = last kept
  id; with exactly `pageSize` rows, all returned and `nextCursor: null`; passing that `nextCursor` back
  returns the next contiguous page; **paginate to exhaustion → union has every asset exactly once, no
  dup, no skip**; cursor past the end → `assets: []`, `nextCursor: null`; cursor of a since-deleted
  asset still returns the assets ordered after it (no crash).
- _Controller:_ **400** when `cursor` is present but not a UUID.
- _E2E:_ seed > `pageSize` (use a small test override or enough fixtures) and paginate to exhaustion;
  assert complete, non-duplicated coverage.

**Edge cases covered here:** invalid cursor (400); cursor past end; deleted-cursor; single page exactly
at the boundary.

### Slice 3 — Album membership

**Outcome:** `albums` (owner's own albums, id→name) populated on every page; each asset's `albumIds`
populated from owned albums; both consistent.

**Build:** album-repo `getOwnedAlbumsForUser(ownerId)` and `getOwnedAlbumIdsForAssets(ownerId, assetIds)`
(single grouped query, owned-album-scoped); service runs both, attaches `albumIds` (default `[]`), fills
`albums`; regen OpenAPI if the DTO shape changed (it already declares the fields, so likely no change).

**Tests (red→green):**

- _Medium:_ asset in multiple owned albums → all ids present; asset in no album → `[]`; **single grouped
  query, no N+1** (e.g. assert via the medium harness that one album query runs for the page, or assert
  correctness across many assets); `albums` lists exactly the user's owned albums with correct names;
  **every id in any `albumIds` appears in `albums`** (consistency invariant); an asset that is only in
  _another_ user's shared album → `albumIds: []` and that foreign album absent from `albums`; `albums`
  repeated identically on page 2.
- _E2E:_ seeded user with assets across albums + visibilities; assert `albumIds` and `albums` resolve.

**Edge cases covered here:** asset in 0 / 1 / many albums; shared-album-only asset; albums list stable
across pages.

## Open Decisions (defaults chosen; flag to change before implementing)

- **Controller placement** — **decided:** dedicated `LibraryManifestController` + `LibraryManifestService`.
- **Deactivated (soft-deleted) target user** — **decided:** resolve with `withDeleted` so a deactivated
  account can be exported (GDPR teardown); `404` only if the user truly does not exist. Slice 1 includes
  a test for this.
- **`albums`/`albumIds` scope** — default: owner-owned albums only (keeps the envelope consistent).
- **Locked-folder assets** — default: included (complete export). Exclude only if privacy requires.
- **`pageSize` default** — `MANIFEST_PAGE_SIZE = 1000`, server constant, no client override.

## Open Implementation Details To Verify (during the code, not blocking the design)

- That `originalPath` is the raw object key (no leading slash) under the object-storage backend — see
  **Prerequisite** (this one _is_ blocking).
- Exact `array_agg` typing in Kysely (cast to `uuid[]`) and that `ANY(:ids)` is parameterized safely.
- Whether `asset_exif`'s int8 parser is already globally configured (it is, per `src/types.ts`); confirm
  `size` arrives as a number in the medium test.
