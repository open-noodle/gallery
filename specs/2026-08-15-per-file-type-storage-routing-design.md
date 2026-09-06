# Per-file-type storage routing (disk / S3)

Design for [discussion #491](https://github.com/open-noodle/gallery/discussions/491).

## Problem

Storage backend selection is global. `IMMICH_STORAGE_BACKEND=s3` sends originals, thumbnails,
transcodes, person thumbnails and profile images to S3 alike. Admins on metered object storage pay
per-request costs dominated by thumbnails — many small GETs on every timeline scroll — while the
bulk-storage saving they actually wanted comes from originals. They cannot separate the two.

The discussion asks for a local thumbnail _cache_. This design instead makes storage location a
_routing_ choice per file kind: each kind lives on exactly one backend. Routing needs no
invalidation, no eviction, no dual-write and no second lookup path, and it fits the existing
key-shape model exactly. A read-through cache remains possible later as a separate feature.

## Non-goals

- A local read cache in front of S3. S3 does not stay authoritative for a kind routed to disk.
- Per-user or per-library routing. Routing is instance-wide.
- Moving HLS session segments. They are written directly to disk by `transcoding.service.ts` and
  never pass through `persistFile`, so they are disk-only today regardless of backend, and they are
  absent from the migrator's file-type list. Unchanged here.
- New S3 credential settings in the UI. Bucket and credentials stay env-only.

## Background: how storage works today

Four facts from the current code shape this design.

**The backend is inferred from the key, not from config.** `backends/storage-backend.provider.ts`
resolves an absolute path to disk and a relative key to S3. Every stored file therefore describes
its own location, and `StorageService.resolveBackendForKey` needs no config to serve, delete or
stream it. Changing where _new_ files go can never strand _existing_ ones.

**Generation always writes to local disk first.** `media.service.persistFile(localPath, relativeKey)`
runs after ffmpeg/sharp have produced a file at the absolute path from
`StorageCore.getImagePath` / `getEncodedVideoPath`. In disk mode it returns that path unchanged; in
S3 mode it uploads to `relativeKey`, unlinks the local file and returns the key. The decision is
already isolated to one function.

**One global write switch, four consumers.** `StorageService.getWriteBackend()` reads a static set
at bootstrap from `IMMICH_STORAGE_BACKEND`. It is called from `media.service.persistFile`,
`asset-media.service` (originals and sidecars) and `user.service` / `auth.service` (profile
images). `persistFile` in turn has four callers, so the four consumers fan out to seven write paths
that need a kind.

**Storage-usage accounting is already backend-agnostic.** `gallery/storage-usage.ts` sums disk
folder sizes _and_ S3 prefix usage unconditionally, so mixed routing needs no change there.

## Design

### Config model

`SystemConfig` gains a `storage.routing` section, following the fork's existing `storageUsage`
precedent in `server/src/config.ts`:

```ts
storage: {
  routing: {
    originals: StorageRouting; // 'auto' | 'disk' | 's3'
    thumbnails: StorageRouting;
    encodedVideo: StorageRouting;
  }
}
```

All three default to `'auto'`, which resolves to `IMMICH_STORAGE_BACKEND` (itself defaulting to
`disk`). Every existing install therefore behaves identically after upgrade, with no database
migration and no bootstrap seeding, and `IMMICH_STORAGE_BACKEND` keeps working forever as the
single env lever rather than going inert.

Living in `SystemConfig` gives three delivery channels for one implementation: the admin UI, the
`IMMICH_CONFIG_FILE` YAML, and the existing config export/import actions.

### Kind mapping

Three knobs cover all eight file types the migrator knows about. The mapping is a single exported
table used by the router, the migration validator and the counts query, so the three can never
disagree.

| Knob           | Covers                                                          |
| -------------- | --------------------------------------------------------------- |
| `originals`    | `asset.originalPath`, sidecars, the `upload/` landing key       |
| `thumbnails`   | thumbnail, preview, fullsize, person thumbnails, profile images |
| `encodedVideo` | transcoded MP4s, edited MP4s                                    |

Nobody has a use case for previews on S3 while thumbnails sit on disk, and three knobs give eight
documented combinations instead of 256.

### Resolution

A new `server/src/backends/storage-router.ts` owns one pure function:

```ts
resolveRouting(routing: StorageRouting, envBackend: 'disk' | 's3'): 'disk' | 's3';
```

`auto` returns `envBackend`; `disk` and `s3` return themselves. A `StorageService.getWriteBackend(kind, config)`
static combines it with `getConfig({ withCache: true })` and the `StorageService` backend statics.

| Knob   | `IMMICH_STORAGE_BACKEND` | S3 configured | Resolved                                      |
| ------ | ------------------------ | ------------- | --------------------------------------------- |
| `auto` | unset / `disk`           | no            | disk                                          |
| `auto` | unset / `disk`           | yes           | disk                                          |
| `auto` | `s3`                     | yes           | s3                                            |
| `auto` | `s3`                     | no            | startup error (existing env check, unchanged) |
| `disk` | any                      | any           | disk                                          |
| `s3`   | any                      | yes           | s3                                            |
| `s3`   | any                      | no            | rejected at save; disk fallback at runtime    |

`s3` combined with `IMMICH_STORAGE_BACKEND=disk` is a genuinely new capability and it already
works: `StorageService.onBootstrap` constructs `S3StorageBackend` whenever `IMMICH_S3_BUCKET` is
set, independent of `storage.backend`.

**Resolution reads config, it does not cache in a static.** `getConfig({ withCache: true })` is a
process-wide cache cleared by `clearConfigCache()` on `ConfigUpdate`, which is the mechanism every
other runtime config consumer already uses. A private static refreshed on the `ConfigUpdate` event
would be strictly worse: `storage-usage.service.ts` documents that config-file installs never emit
`ConfigUpdate`, so such a cache would silently never update for exactly the deployments most likely
to use this feature.

### Write path

`persistFile` gains a `kind` parameter and resolves the backend **once** at the top of the call,
then branches on that single value for the upload, the DB path and the temp-file unlink. Resolving
twice would allow a concurrent config save to produce an upload with no unlink (orphaned local
file) or an unlink with no upload (data loss).

| Call site                                 | Kind           |
| ----------------------------------------- | -------------- |
| `media.service.persistImageFiles`         | `thumbnails`   |
| `media.service` person thumbnail (`:708`) | `thumbnails`   |
| `media.service` encoded video (`:908`)    | `encodedVideo` |
| `media.service` edited encoded video      | `encodedVideo` |
| `asset-media.service` (`:396`)            | `originals`    |
| `user.service` (`:127`)                   | `thumbnails`   |
| `auth.service` (`:407`)                   | `thumbnails`   |

Reads, deletes and serving are untouched: all three go through the shape-based
`resolveBackendForKey`.

`StorageCore.moveFile` early-returns on `!isAbsolute(oldPath)` (`storage.core.ts:203`), so the
media-location moves in `media.service.ts:218-221` (fullsize, preview, thumbnail, encoded video) and
`person.service.ts:1433` (face thumbnails) are inert for any kind routed to S3. That is correct — an
S3 key has no media-location prefix to rewrite — but it reads like a bug, so it is called out here
to stop a later refactor from "fixing" it into a data-loss path.

External-library originals are never written by Immich — they are scanned in place — so the
`originals` knob does not affect them. Their thumbnails and transcodes are Immich-generated and do
follow the knobs.

### Validation, in three layers

`BootstrapEventPriority.SystemConfig` is `100` and `StorageService` is `-195`; the enum comment
states plainly that config must not be read by other services during bootstrap. The startup check
therefore cannot grow a `SystemConfig` dependency where it currently lives.

1. **`ConfigValidate`** (`StorageService`, new handler) throws when any knob is `s3` and no bucket
   is configured. `SystemConfigService.updateSystemConfig` emits this event, so an admin simply
   cannot save the bad combination through the UI or the API.
2. **`ConfigInit`** logs an error naming the offending kinds without throwing. This covers
   config-file installs, which never run `ConfigValidate` — the event is emitted only from
   `updateSystemConfig`, and that method rejects outright when `IMMICH_CONFIG_FILE` is set.
3. **Resolution time** falls back to disk with a throttled warning when a kind resolves to `s3` but
   `StorageService.getS3Backend()` returns undefined. This covers credentials removed from the
   environment after routing was configured. Falling back is safe precisely because keys are
   self-describing, and it is better than failing every thumbnail job on a running instance.

The existing env-only `ImmichStartupError` for `IMMICH_STORAGE_BACKEND=s3` without a bucket stays
exactly as it is. It fires even when all three knobs are pinned to `disk` and the env value is
therefore irrelevant; making it config-aware would require reading `SystemConfig` at a bootstrap
priority that forbids it. The fix is for the admin to set the env var to `disk`, and the error
message will say so.

### Migration coupling

The copier is reused wholesale. `handleMigration`, `handleQueueAll`, `computeTargetPath`, the
source/target resolution, the five stream queries, `updatePath`, the migration log, `rollback` and
the four existing endpoints are unchanged.

One behavioural change: `validateBackendConfig` compares per kind instead of globally. Today it
rejects unless the global backend matches the direction, which prevents the non-converging case of
migrating thumbnails to disk while new thumbnails still land on S3. The same guarantee per kind is:
for every selected file type, resolve its knob and require it to equal the direction's target.
Rejection names **every** offending kind, not the first, and says how the value was resolved
("Thumbnails are routed to S3 via IMMICH_STORAGE_BACKEND") so an `auto` knob does not read as a
mystery.

The direction radio stays global. Two migrations cannot run concurrently anyway —
`isActive(QueueName.StorageBackendMigration)` serializes them — so originals-to-S3 alongside
thumbnails-to-disk is two sequential runs, not a new concept.

Flipping a knob never queues a migration. A migration can move terabytes and cost real egress; it
stays an explicit operation with its own estimate, concurrency, `deleteSource` choice and rollback
batch id. The settings page links to it with the direction and file types prefilled.

### Counts endpoint

`GET /storage-migration/routing` returns, per knob, `{ routedTo, misplacedCount }`. `routedTo` is
the _resolved_ backend — `disk` or `s3`, never `auto` — so the client never has to reimplement the
truth table. `misplacedCount` is the number of files of that kind sitting on the other backend.

It does not reuse `getEstimate`, which also runs `getOriginalsSizeEstimate` — a `SUM` over
`asset_exif` the settings page does not need. Both directions come out of a single pass per table
via `count(*) filter (where path like '/%')` alongside the total, rather than two full scans.

The query must reproduce the stream queries' predicates exactly or the page will over-report and
nag admins into running a migration they do not need:

- `person.thumbnailPath != ''` and `user.profileImagePath != ''`
- external-library exclusion for originals and sidecars (see below)

### Known limitation: integrity checks stay off

`integrity.service.ts:76` `skipIfS3Configured()` short-circuits **nine** job handlers whenever
`StorageService.getS3Backend()` returns non-null, and its comment at `:71-74` explicitly covers
"mixed disk+S3 setups mid-migration" (open-noodle/gallery#685).

This matters more than it looks. Today a mixed install is a _transient_ state that exists only for
the duration of a migration. Per-kind routing makes mixed the intended permanent steady state — so
every admin who adopts this feature permanently loses all integrity checking, and gets no warning
that they have.

The feature ships with this limitation rather than blocking on it, because making integrity checks
S3-aware is a substantially larger piece of work with its own design. Two obligations follow:

- The docs for routing state plainly that configuring S3 at all disables integrity checks today, and
  link #685.
- #685 is promoted to a coupled follow-up rather than a background nice-to-have, since this feature
  turns its blast radius from "during migrations" into "always".

No code changes here — the existing skip already handles mixed correctly. This section exists so the
limitation is a decision rather than an oversight.

### Pre-existing defects to fix alongside

Two latent bugs become materially more likely once mixed storage is a permanent state rather than a
migration window. Both ship as companion fixes.

#### External libraries in the migrator

`storage-migration.repository.ts` filters on path shape alone, with no `libraryId` predicate.
External-library assets have an absolute `originalPath` outside the media location, so
`streamOriginals('toS3')` matches them. The migrator would copy those originals into S3 and rewrite
`asset.originalPath` to a relative key — detaching the asset from the file the library scanner
matches on, and importing files the admin deliberately keeps external. `computeTargetPath` also
falls into its "doesn't start with media location" fallback and produces a key derived from the
host filesystem layout.

This is a pre-existing defect, not one this feature introduces, but the feature makes those counts
prominent on a settings page and actively invites admins to act on them. It ships as a companion
fix: add `where('asset.libraryId', 'is', null)` to `streamOriginals` and to `streamAssetFiles` when
the type is `Sidecar`. Thumbnails and transcodes of external assets are Immich-generated and stay
migratable.

The counts query and the stream queries must apply one shared predicate builder, not two
hand-copied ones. A drift between them is exactly what produces a settings page nagging an admin
toward a migration that detaches their external library.

#### Non-deterministic startup on a mixed install

`asset.repository.ts:1068` is `select assetId, path from asset_file limit 3` with **no `order by`**.
`storage.service.ts:148` reads `samples[0].path`, and when the media location has changed it throws
`ErrorMessages.InconsistentMediaLocation` at `:163` if that path does not start with the previous
location.

On a mixed install, whether `samples[0]` is an absolute disk path or a relative S3 key is arbitrary
— and can differ **between restarts of the same instance**. An admin who changes
`IMMICH_MEDIA_LOCATION` therefore gets a server that boots or refuses to boot depending on Postgres'
row order. The `previous` inference at `:157` (`path.startsWith('upload/') ? 'upload' : ...`) is
wrong for S3 keys in the same way, and `asset-media.service` writes S3 originals under exactly the
`upload/` prefix, so it misfires on the most common key shape.

Fix: restrict `getFileSamples()` to absolute paths (`where('path', 'like', '/%')`). The media
location only ever describes disk files, so an S3 key is never a valid sample for this check. If
that returns nothing, there is no disk-resident file and the location check is vacuous — skip it.

`migrateFilePaths(previous, current)` itself needs no change: it rewrites only paths under the old
location, so relative keys are untouched.

### Web UI

`StorageSettings.svelte` in `web/src/routes/admin/system-settings/`, added to the typed `settings`
array at `+page.svelte:65` with `component` / `title` / `subtitle` / `key` / `icon`. Title and
subtitle also feed the settings search filter at `:231`, so they are two of the i18n keys, not
decoration.

It follows `StorageTemplateSettings.svelte` exactly —
`const disabled = $derived(featureFlagsManager.value.configFile)` and
`<SettingButtonsRow bind:configToEdit keys={['storage']} {disabled} />`, where `SettingButtonsRow`
is the local import alias for
`$lib/components/shared-components/settings/SystemConfigButtonRow.svelte`. That yields the
config-file lock, dirty tracking, save/reset and the search index for free.

Three `SettingSelect` rows, each offering `Follow IMMICH_STORAGE_BACKEND (currently: S3)`, `Disk`
and `S3`, with a status line beneath: _"40,182 thumbnails still on S3 — Migrate them"_, linking to
`/admin/storage-migration` with direction and file types prefilled. The line is omitted when the
count is zero.

`SettingSelect` needs a small extension first. Its `options` prop is typed
`{ value: string | number; text: string }[]` (`SettingSelect.svelte:12`) and its `disabled` prop
(`:15`) applies to the whole `<select>` — there is no way to disable one option. Add an optional
`disabled?: boolean` to the option type and forward it to the rendered `<option>`. This is a
two-line change to a shared component used by several settings panels, so it ships with its own test
asserting existing callers are unaffected.

The storage-migration page disables checkboxes whose routing contradicts the selected direction and
shows the reason, so the invalid combination is unreachable before the server rejects it.

### Feature flag

`ServerFeaturesSchema` has no S3 signal, so the web cannot tell whether S3 is configured at all.
Adding `s3Storage: boolean` (true when `IMMICH_S3_BUCKET` is set) lets the S3 option render
_disabled with its reason_ — "Set `IMMICH_S3_BUCKET` to enable" — rather than silently offering a
choice that fails validation. Hiding the section entirely would leave an admin mid-setup with no
signal about what is missing.

It is populated in `server.service.ts:119` `getFeatures()` from
`this.configRepository.getEnv().storage.s3.bucket`, alongside the existing env-derived `configFile`
flag. `getFeatures` is cached and invalidated on `ConfigUpdate`; since the bucket comes from the
environment and cannot change at runtime, no extra invalidation is needed.

## Edge cases

| #   | Case                                                                  | Decided behaviour                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Knob flipped while a thumbnail job is in flight                       | Job persists to the target it resolved at its start. Harmless — the key is self-describing and the residual count self-heals.                                                                                                    |
| 2   | Knob flipped mid-migration                                            | In-flight single jobs are not re-validated; they complete against the direction the batch started with. `handleQueueAll` re-validates at dequeue. The settings page then shows a non-zero residual, which is the correct signal. |
| 3   | Config changes between the upload and the unlink inside `persistFile` | Impossible: the backend is resolved once per call and both branches read that one value.                                                                                                                                         |
| 4   | Knob set to `auto` after being pinned                                 | `updateConfig` strips values equal to the default before persisting, so the key disappears from the stored partial config and the install returns to following the env var.                                                      |
| 5   | Knob pinned to `s3` with no bucket, via the UI                        | `ConfigValidate` rejects the save.                                                                                                                                                                                               |
| 6   | Same, via `IMMICH_CONFIG_FILE`                                        | `ConfigInit` logs an error naming the kinds; resolution falls back to disk. The server stays up.                                                                                                                                 |
| 7   | S3 credentials removed after files were written to S3                 | Those files become unreadable. Documented: do not remove credentials until the routing page reports zero files on S3. The counts make this checkable.                                                                            |
| 8   | `IMMICH_STORAGE_BACKEND=s3`, no bucket, all knobs pinned to `disk`    | Still a startup error, unchanged. The check runs before config is available. Error message names `IMMICH_STORAGE_BACKEND` explicitly.                                                                                            |
| 9   | Knob `s3` while `IMMICH_STORAGE_BACKEND=disk`                         | Works. `S3StorageBackend` construction is gated on bucket presence only.                                                                                                                                                         |
| 10  | External-library assets                                               | Originals and sidecars excluded from migration and from counts. Their thumbnails and transcodes follow the knobs and remain migratable.                                                                                          |
| 11  | `person.thumbnailPath = ''` / `user.profileImagePath = ''`            | Excluded from counts, matching the existing stream predicates.                                                                                                                                                                   |
| 12  | Empty library                                                         | All counts zero; status lines and migrate links are not rendered.                                                                                                                                                                |
| 13  | Soft-deleted assets                                                   | Included, matching existing migrator behaviour — the files still exist and still occupy the backend.                                                                                                                             |
| 14  | HLS session segments                                                  | Out of scope; disk-only today and unchanged.                                                                                                                                                                                     |
| 15  | Mixed routing and storage-usage accounting                            | Already correct — `storage-usage.ts` sums disk folders and S3 prefixes unconditionally.                                                                                                                                          |
| 16  | Deleting an asset with files split across backends                    | Already correct — `handleDeleteFiles` branches per file on `isAbsolute`.                                                                                                                                                         |
| 17  | Invalid routing value in a config file                                | Rejected by the zod enum during config load, as with any other malformed `SystemConfig` value.                                                                                                                                   |
| 18  | Media location changed on a mixed install                             | Fixed here: `getFileSamples()` is restricted to absolute paths, so the check never sees an S3 key and boots deterministically. Vacuous and skipped when no disk-resident file exists.                                            |
| 19  | Integrity check jobs on a mixed install                               | All nine are skipped, as they already are for any S3-configured install. Documented limitation, not a change; see #685.                                                                                                          |
| 20  | Media-location move of an S3-routed derivative                        | `moveFile` no-ops on relative keys. Correct — there is no location prefix to rewrite — and pinned by a test so it is not "fixed" later.                                                                                          |
| 21  | Migration run with `deleteSource: false`                              | The file genuinely exists on both backends and storage usage counts it twice until the source is cleaned up. Pre-existing, but longer-lived now that mixed is a steady state. Documented in the migration docs.                  |

## Test plan

### Unit — `server/src/backends/storage-router.spec.ts` (new)

1. Each of the seven truth-table rows resolves as specified.
2. `getWriteBackend` returns the disk backend instance when resolution is `disk`, the S3 instance
   when `s3`.
3. Resolution `s3` with `getS3Backend()` undefined falls back to disk and warns.
4. The kind-mapping table is exhaustive: every `AssetFileType` and every migrator file type maps to
   exactly one knob. Asserted over the enum so a new file type fails the test rather than silently
   defaulting.

### Unit — `media.service.spec.ts`

5. `thumbnails: disk`, `encodedVideo: s3` — the thumbnail keeps its absolute path with no `put` and
   no unlink; the encoded video uploads under a relative key and unlinks the temp file.
6. The reverse mix.
7. Person thumbnails follow the `thumbnails` knob, not `originals`.
8. Edited encoded video follows the `encodedVideo` knob.
9. Every file in one `persistImageFiles` batch uses the same resolved backend.
10. Routing resolved to `s3` with the backend missing writes to disk and does not lose the file.

### Unit — `asset-media.service.spec.ts`

11. `originals: s3` uploads original and sidecar and queues both temp files for deletion.
12. `originals: disk` with `thumbnails: s3` leaves the original absolute and issues no S3 put on
    upload.
13. Sidecars follow the `originals` knob.

### Unit — `user.service.spec.ts`, `auth.service.spec.ts`

14. Profile images follow the `thumbnails` knob on both the direct-upload and OAuth paths.

### Unit — `storage.service.spec.ts`

15. The existing env-only startup error is preserved.
16. `ConfigValidate` throws when any knob is `s3` and no bucket is configured, naming the kinds.
17. `ConfigValidate` passes when a bucket is configured.
18. `ConfigInit` logs an error and does not throw for the same bad combination.

### Unit — `storage-migration.service.spec.ts`

19. `toDisk` with thumbnails selected while the thumbnails knob is `s3` is rejected, message names
    Thumbnails.
20. Multiple contradicting kinds are all named in one message.
21. A knob resolving via `auto` produces a message mentioning `IMMICH_STORAGE_BACKEND`.
22. All eight file types selected under mixed routing rejects and names only the contradicting ones.
23. Matching routing is accepted and queues as before.
24. `handleQueueAll` re-validates at dequeue and fails cleanly when routing changed after `start`.

### Medium — `storage-migration.repository` counts

25. Counts exclude empty `person.thumbnailPath` and `user.profileImagePath`.
26. Counts exclude external-library originals and sidecars, and include external-library thumbnails.
27. A knob's count equals the sum over its constituent file types.
28. Empty library returns all zeros.
29. Disk count plus S3 count equals the total for every kind, from the single-pass query.
30. `streamOriginals` and `streamAssetFiles` no longer emit external-library rows (companion fix).
31. Counts and streams agree on the same fixture: for every kind and direction, the count equals the
    number of rows the corresponding stream yields. This is the drift guard for the shared predicate
    builder — a hand-copied second predicate fails here.

### Unit — startup determinism (companion fix)

32. `getFileSamples()` returns only absolute paths, given a fixture mixing disk paths and S3 keys.
33. `StorageService.onBootstrap` with a changed media location and an S3-only `asset_file` table
    skips the location check instead of throwing `InconsistentMediaLocation`.
34. Same with a mixed table: the check runs against the disk sample and succeeds regardless of row
    order (asserted by running the fixture with both orderings).
35. `StorageCore.moveFile` no-ops on a relative key and does not touch the DB — pinning edge case 20.

### Unit — `system-config.service.spec.ts`

36. The full-config literal is extended with `storage.routing`.
37. Defaults are `auto` for all three knobs.
38. `storage.routing` is accepted from a config file.
39. Setting a knob back to `auto` removes it from the persisted partial config.

### Web — `SettingSelect.spec.ts`

40. A per-option `disabled` renders a disabled `<option>` and cannot be selected.
41. Options without the field are unaffected, and the whole-component `disabled` prop still behaves
    as before — the regression guard for the panels already using this component.

### Web — `StorageSettings.spec.ts` (new)

42. The S3 option is disabled with its hint when the `s3Storage` feature flag is false.
43. The whole section is disabled when `configFile` is true.
44. The `auto` option label interpolates the resolved env backend.
45. Status line and migrate link render only when `misplacedCount > 0`.
46. The migrate link carries the correct direction and file-type query params.

### Web — storage-migration page

47. Checkboxes contradicting the selected direction render disabled with a reason.
48. Query-param prefill selects the right direction and checkboxes.

### e2e API

49. `GET /storage-migration/routing` requires an admin.
50. The system-config e2e default shape includes `storage.routing`.

### e2e harness — `e2e/storage-migration.sh` (real MinIO, `make storage-migration-tests`)

This is the only place real S3 is exercised, and the shape-based read resolution is the feature's
load-bearing assumption, so the mixed case belongs here.

51. Set `originals: s3`, `thumbnails: disk`, `encodedVideo: disk`; upload an image and a video.
    Assert `originalPath` is a relative key present in MinIO, that thumbnail and preview paths are
    absolute and present on disk and absent from MinIO, and that both serve correctly over HTTP.
52. Flip `thumbnails` to `s3` and upload a second asset. Assert the new thumbnail is in MinIO while
    the first asset's thumbnail still serves from disk — the "flipping is safe" guarantee.
53. Run the migrator for thumbnails `toS3`; assert `misplacedCount` reaches zero and the old
    thumbnails now serve from MinIO.
54. Roll that batch back; assert paths revert and files still serve.
55. Delete an asset whose files span both backends; assert the S3 object and the disk file are both
    removed.
56. Pin a knob to `s3` with the bucket unset; assert the server starts, logs the error and writes to
    disk.
57. With the mixed routing of step 51 in place, restart the server with a changed
    `IMMICH_MEDIA_LOCATION` and assert it boots — the end-to-end form of the `getFileSamples` fix,
    and the only test that exercises real row ordering rather than a fixture.

### Gates

`make check-server`, `make check-web`, server and web `pnpm test`, `make open-api` (new config keys,
new endpoint, new feature flag — regenerates the TypeScript SDK and the Dart client), and prettier
over `i18n/*.json` and `docs/`.

## Files touched

**Server**

- `src/config.ts` — `storage.routing` type and defaults
- `src/dtos/system-config.dto.ts` — `SystemConfigStorageSchema`
- `src/dtos/server.dto.ts` — `s3Storage` feature flag
- `src/services/server.service.ts` — populate the flag
- `src/backends/storage-router.ts` — new; resolution and the kind-mapping table
- `src/services/storage.service.ts` — `getWriteBackend(kind, config)` static, `ConfigValidate` /
  `ConfigInit` handlers. Deliberately not on `BaseService`: that would close an import cycle
  (`base.service` → `storage.service` → `base.service`), and every call site already imports
  `StorageService`.
- `src/services/media.service.ts`, `asset-media.service.ts`, `user.service.ts`, `auth.service.ts` —
  pass the kind
- `src/services/storage-migration.service.ts` — per-kind validation, routing status
- `src/repositories/storage-migration.repository.ts` — counts query, shared predicate builder,
  external-library fix
- `src/repositories/asset.repository.ts` — `getFileSamples()` restricted to absolute paths
- `src/controllers/storage-migration.controller.ts` — `GET /routing`
- `src/dtos/storage-migration.dto.ts` — response DTO

**Web**

- `src/routes/admin/system-settings/StorageSettings.svelte` — new
- `src/routes/admin/system-settings/+page.svelte` — add to the `settings` array at `:65`
- `src/routes/admin/system-settings/SettingSelect.svelte` — per-option `disabled`
- `src/routes/admin/storage-migration/+page.svelte` — disabled checkboxes, query-param prefill

**Shared**

- `i18n/en.json` plus `de` `fr` `it` `nl` `pl` `es` `ru` `zh_Hans` `zh_Hant` — roughly twelve keys,
  including the section title and subtitle that feed the settings search
- `docs/docs/features/s3-storage.md` — routing section, and the integrity-check limitation
- `docs/docs/features/storage-migration.md` — per-kind validation rule, and the double-counting note
  for `deleteSource: false`
- `docs/docs/install/environment-variables.md` — `IMMICH_STORAGE_BACKEND` is now the `auto` fallback

## Rollout

No database migration. No bootstrap seeding. Defaults reproduce current behaviour byte for byte on
every existing install, whether env-configured or not. The feature is inert until an admin pins a
knob.

## Risks

- **Config-file installs get no save-time validation.** `ConfigValidate` fires only from
  `updateSystemConfig`. Mitigated by the `ConfigInit` error log and the runtime disk fallback.
- **Removing S3 credentials after routing away from S3 orphans anything still there.** Mitigated by
  the misplaced counts, which make "is anything still on S3" a glance rather than an audit, and by a
  docs warning.
- **The external-library fix changes existing migrator behaviour.** An admin who already migrated
  external originals to S3 is in a broken state this fix does not repair; it only prevents new
  occurrences. Called out in the docs.
- **Integrity checks stay disabled for anyone using this feature.** The largest known cost of
  adopting routing, and not something this work fixes. It is a decision, documented as such, with
  #685 as the coupled follow-up.
- **`SettingSelect` is shared.** Adding a per-option `disabled` touches a component several settings
  panels render. The change is additive and optional, and test 41 guards the existing callers.
