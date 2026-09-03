# Face cleanup: judging a face in the context of its photo

Discussion: [open-noodle/gallery#1061](https://github.com/open-noodle/gallery/discussions/1061)
Status: approved design, not yet implemented
Date: 2026-09-03

## 1. Problem

On the guided face cleanup review page (`Face cleanup` → cluster → "Faces leaving {name}") an admin sees
only a tight face crop. There is no way to reach the source photo, so similar-looking children and babies
cannot be judged. The same gap exists on the manual review page.

Three grids render admin face crops today, all through `getAdminFaceThumbnailUrl`
(`web/src/lib/utils/people-utils.ts:110`):

| Surface                                                            | Grid                     | Faces come from             |
| ------------------------------------------------------------------ | ------------------------ | --------------------------- |
| `web/src/routes/admin/face-cleanup/[personId]/+page.svelte`        | flagged (`:672`)         | `getFaceRepairPersonFaces`  |
| `web/src/routes/admin/face-cleanup/[personId]/+page.svelte`        | rest-of-cluster (`:815`) | `getFaceRepairClusterFaces` |
| `web/src/routes/admin/face-cleanup/people/[personId]/+page.svelte` | manual (`:572`)          | `getFaceRepairClusterFaces` |

Clicking a tile only toggles selection. The client receives `{ assetFaceId, suspectedOwnerId }` and nothing
else — no `assetId`, no date, no bounding box.

## 2. Why not the normal photo viewer

`/photos/{assetId}` is wrong, and deliberately so. `AssetMediaService.viewThumbnail` calls
`requireAccess({ auth, permission: Permission.AssetView, ids: [id] })`
(`server/src/services/asset-media.service.ts:208`) — admins get **no** bypass. Every `/admin/face-repair`
route is `@Authenticated({ admin: true })` with no `requireAccess`, because the whole point of the console
is repairing clusters in other people's libraries. Linking to the owner-scoped viewer would work for the
admin's own library and 403 for every case the console exists to serve.

The privileged path already exists and is the one to extend:

```
GET /admin/face-repair/faces/:assetFaceId/thumbnail   (controller :210 → service :1288)
```

## 3. What the code makes cheap

Two findings shaped this design.

**The uncropped view costs less than the crop.** `getAdminFaceThumbnail` resolves the face, calls
`getFaceThumbnailSource(face.assetId)` (`base.service.ts:464`) — which returns the **already-generated
preview file path**, falling back to the thumbnail file — and only then decodes and crops it with sharp
into a temp dir. Serving that same file uncropped is one `serveFromBackend` call: no decode, no sharp, no
temp dir, no cleanup handlers.

**The context fields need no new joins and no extra queries.** Both list queries already inner-join
`asset`:

- `getScanFlaggedFaces` (`server/src/repositories/face-repair-scan.repository.ts:294`) — joins `asset_face`,
  `asset`, `face_search`; already filters `asset.deletedAt is null`.
- `getClusterFacePage` (`server/src/repositories/face-repair.repository.ts:217`) — same joins, same filter.

So `asset.localDateTime` and `asset_face.boundingBoxX1/Y1/X2/Y2` + `imageWidth`/`imageHeight` are a pure
`.select()` addition on queries that already run.

A consequence worth stating: **neither list can surface a face on a trashed asset**, because both already
filter `asset.deletedAt`. The trashed-asset guard on the new route (§4.1) is therefore defence in depth
against a hand-crafted id, not the primary gate.

## 4. Design

### 4.1 Server — the preview route

**New repository method** in `server/src/repositories/person.repository.ts`, a sibling of
`getFaceByIdIncludingTombstoned` (`:571`):

```ts
@GenerateSql({ params: [DummyValue.UUID] })
getFaceByIdOnLiveAsset(id: string) {
  // identical to getFaceByIdIncludingTombstoned, plus:
  .where('asset.deletedAt', 'is', null)
}
```

The name states the asymmetry precisely: the **face** may still be tombstoned (`asset_face.deletedAt`),
matching the crop route so a future magnifier on the resolutions history still works; the **asset** may
not be trashed. `getFaceByIdIncludingTombstoned` is left byte-for-byte alone, so the three shipped crop
surfaces do not change behaviour.

**New service method** in `server/src/services/face-repair.service.ts`, beside `getAdminFaceThumbnail`:

```ts
async getAdminFacePreview(assetFaceId: string): Promise<ImmichMediaResponse> {
  let face: AssetFace;
  try {
    face = await this.personRepository.getFaceByIdOnLiveAsset(assetFaceId);
  } catch {
    throw new NotFoundException();
  }

  const sourcePath = await this.getFaceThumbnailSource(face.assetId);
  if (!sourcePath) {
    throw new NotFoundException();
  }

  return this.serveFromBackend(sourcePath, mimeTypes.lookup(sourcePath), CacheControl.PrivateWithCache);
}
```

`serveFromBackend` (`base.service.ts:369`) rather than a raw `ImmichFileResponse`: it resolves the disk
vs S3 backend, which the fork needs and a hardcoded path would break.

`mimeTypes.lookup(sourcePath)` rather than `'image/jpeg'`: `image.preview.format` is configurable, so the
preview file is jpeg **or** webp.

`CacheControl.PrivateWithCache` for the same reason the crop route uses it — a preview file is immutable
for a given face id, and the grid would otherwise refetch on every visit.

`getFaceThumbnailSource` passes `edited: false` to `getForThumbnail`, so for an asset with saved edits this
serves the **original**, not the edited version. That is deliberate and must stay: the crop the admin is
comparing against was generated from the same unedited preview, and the stored bounding box is in that
image's coordinate space. Serving the edited preview would misplace the overlay on any crop or rotate.

**New controller route** in `server/src/controllers/face-repair-admin.controller.ts`, mirroring `:210`:

```ts
@Get('faces/:assetFaceId/preview')
@FileResponse()
@Authenticated({ admin: true })
@Endpoint({ summary: 'Get an admin face-repair source photo', history: new HistoryBuilder().added('v1') })
```

### 4.2 Server — context on the two list DTOs

In `server/src/dtos/face-repair.dto.ts`, one shared schema used by both response DTOs:

```ts
const FacePhotoContextSchema = z.object({
  localDateTime: z.string().meta({ format: 'date-time' }),
  boundingBoxX1: z.number(),
  boundingBoxY1: z.number(),
  boundingBoxX2: z.number(),
  boundingBoxY2: z.number(),
  imageWidth: z.number(),
  imageHeight: z.number(),
});
```

Fields are **flat, not nested**, because that is byte-for-byte the existing `FaceBox` type
(`web/src/lib/utils/people-utils.ts:128`) — the same six fields, in the same names — so the web side is an
assignment, not an adapter.

Note that `getBoundingBox` takes `Faces`, **not** `FaceBox`: `Faces` additionally requires `id`, and the
helper stamps it onto each result (`people-utils.ts:123`). The modal therefore passes
`{ id: assetFaceId, ...context }`. This is the whole difference between the two types and the only reason
an adapter line exists at all.

`localDateTime` is non-nullable — the column is `localDateTime!: Timestamp`
(`server/src/schema/tables/asset.table.ts:133`).

It crosses the wire as a `Date` in TypeScript and an ISO string in JSON, exactly like `createdAt` on the
neighbouring `DeclineItemSchema` (`:207`). Nest serialises it; do **not** add a `.toISOString()` in the
service.

It extends:

- `FlaggedFaceSchema` (`:134`) — `{ assetFaceId, suspectedOwnerId }` + context
- the cluster-faces `faces` element (`:306`) — `{ assetFaceId }` + context

**Carrying context through the verdict filter.** `getPersonFlaggedFaces` (`face-repair.service.ts:696`)
reads the scan snapshot, then runs `applyVerdictFilters` over a `Map<string, FlaggedFace[]>`.
`FlaggedFace` is shared with `withLiveFlaggedCounts`, which feeds the dashboard and must not grow these
fields. So the context does **not** go on `FlaggedFace`: build a `Map<assetFaceId, FacePhotoContext>` from
the `stored` rows before filtering, and re-join it onto the survivors afterwards. A face the verdict layer
removes therefore leaks no context — asserted in T2.11.

`getScanFlaggedFacesForPersons` (the dashboard/apply path, `:328`) is **not** changed.

**Regeneration.** `server/src/repositories/` is touched, so both are mandatory, run bare from `server/`:
`mise open-api` and `mise sql`.

### 4.3 Web — the lightbox

New `web/src/lib/components/face-cleanup/FacePhotoModal.svelte`, following `FaceActionsHelpModal.svelte`
(`Modal` / `ModalBody` / `ModalFooter` from `@immich/ui`, opened with `modalManager.show`, as the guided
page already does five times).

Props: `{ faces: FacePhotoContext[]; index: number; onClose: () => void }`.

- Image `src` = new `getAdminFacePreviewUrl(assetFaceId)` in `people-utils.ts`, beside
  `getAdminFaceThumbnailUrl`.
- Box overlay: `getContentMetrics(img)` (`container-utils.ts:65`, which handles `object-contain`
  letterboxing) → `getBoundingBox([{ id: assetFaceId, ...face }], metrics)` → one absolutely-positioned
  `div`.

  **`getBoundingBox` does not validate or clamp.** It divides raw (`people-utils.ts:117-121`), so a zero
  `imageWidth` yields `NaN` and an out-of-range box yields a rect outside the image. The modal guards
  _before_ calling it and skips the overlay when the guard fails (E8–E10), reusing the idiom
  `getFaceCropTransform` already established two functions below (`people-utils.ts:143`) — including its
  `Number.isFinite` form and the reason for it, which is worth quoting because the obvious rewrite is
  wrong:

  > `Number.isFinite` rather than `bw <= 0`: imageWidth/imageHeight can be 0, and 0/0 is NaN. `!(NaN > 0)`
  > is true but `NaN <= 0` is false, so the obvious rewrite the linter suggests would silently drop the
  > NaN guard.

  That docstring also already anticipates this modal — "the review modal shows the undistorted full photo
  separately". Extract the shared guard as `isUsableFaceBox(face: FaceBox): boolean` in `people-utils.ts`
  and have `getFaceCropTransform` use it too, so the two cannot drift.

  **Why fractions of `imageWidth`/`imageHeight` are correct against the preview file**, rather than merely
  plausible: face detection runs on the preview itself — `detectFaces(previewFile.path, …)`
  (`person.service.ts:925`) — and stores that file's dimensions on the row (`:963`). The stored box is
  therefore a box in the very file this route serves, orientation already baked in. Manually-created faces
  take the other path and store the _original_ dimensions (`:1554`); fractions are resolution-independent,
  so both are safe, and a later preview regeneration at a new size stays safe for the same reason.

- Caption: date via `fromISODateTimeUTC(face.localDateTime)` (`timeline-util.ts:40`) formatted with
  `dateFormats.album`. **UTC, not the viewer's zone** — `localDateTime` stores local wall-clock time as a
  UTC timestamp, so `new Date(...).toLocaleDateString()` would shift a 00:30 photo to the previous day.
- `←` / `→` page within the array; **clamped at both ends, no wrap.** The modal only knows the faces
  currently loaded in the grid it was opened from, and both grids paginate — wrapping would imply a cycle
  over the whole cluster that the array does not represent.
- `Escape` closes (`Modal` provides it); focus returns to the originating tile.

The modal pages within **one grid**. Opening from the flagged grid walks flagged faces; from the rest grid,
rest faces; from manual, manual faces. No cross-grid paging.

**Only the clicked face is boxed**, even when the photo contains several people. The discussion asked
about this case; the answer is that the console holds no data for the other faces (they belong to other
clusters, or to none), and a single box answers the question the admin is actually asking — "is _this_
detection the same child?" Boxing every face would need a second endpoint and would bury the subject.

### 4.4 Web — the three view-model types

Server-side, `FlaggedFace` deliberately does **not** grow (§4.2, it is shared with the dashboard). Web-side,
the same-named type **must**. Getting this backwards is the easiest mistake in this change, so all three
sites are named here:

| File                                                                             | Type          | Why                                                                      |
| -------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| `web/src/routes/admin/face-cleanup/[personId]/review.svelte.ts:30`               | `FlaggedFace` | `FaceEntry extends FlaggedFace`, so the guided grid gets the fields free |
| `web/src/routes/admin/face-cleanup/people/[personId]/manual-review.svelte.ts:16` | `ManualFace`  | flows in through `appendFaces(faces, total)` (`:65`)                     |
| `web/src/routes/admin/face-cleanup/[personId]/+page.svelte:213`                  | the SDK cast  | `facesResult as unknown as { flaggedFaces: FlaggedFace[] }` — widen it   |

Web's `FlaggedFace` is not shared with any count or summary path, which is exactly why the asymmetry with
the server type is safe.

### 4.5 Web — the tiles

Each of the three grids gets a magnifier control and a date pill.

- **Nested-button fix.** The flagged tile (`:672`) and the manual tile (`:572`) are bare `<button>`s; a
  nested button is invalid HTML. Wrap each in a `<div class="relative aspect-square">` and make the
  magnifier a **sibling**. The rest grid (`:815`) is already wrapped and needs only the sibling.
- **Magnifier**: `<button type="button">` with `mdiMagnify`, an `aria-label`, and a `data-testid`.
  `onclick` calls `event.stopPropagation()` before opening the modal — the acceptance criterion is that it
  never selects, deselects, or stages anything. Always rendered (not hover-only, which strands touch and
  keyboard users), at reduced opacity, full opacity on `hover` and `focus-visible`.
- **Date pill**: month + year (`{ month: 'short', year: 'numeric' }`) — enough to separate a 2019 baby from
  a 2023 one, short enough for a ~90px tile in the 8-column layout.

**Layout constraints** (rather than pixel prescriptions, which are better judged against a render): the
magnifier must not collide with the state icon at `top-1.5 left-1.5`; the date pill must not collide with
the state ribbon at `inset-x-0 bottom-0`; neither may obscure the centre of the crop. Intended default:
magnifier top-right, date pill bottom-left with the flagged tile's ribbon narrowed from full-width to
right-aligned. **The three grids get screenshotted before this is finalised.** Existing `data-testid`s and
ribbon text are unchanged, so the current page specs stay valid.

### 4.6 i18n

Three new keys under the existing `admin.face_cleanup_*` namespace:

| Key                                    | English                 |
| -------------------------------------- | ----------------------- |
| `admin.face_cleanup_view_photo`        | View the original photo |
| `admin.face_cleanup_photo_modal_title` | Original photo          |
| `admin.face_cleanup_photo_modal_taken` | Taken {date}            |

Landing in the **same commit**, alphabetically in place, in `en` plus the nine maintained locales
(`de` · `fr` · `it` · `nl` · `pl` · `es` · `ru` · `zh_Hans` · `zh_Hant`), matching each file's register
(`du`/`tu`/`tú` informal; `vous`/`вы` formal), then `npx prettier --write i18n/*.json`.

## 5. Edge cases

Every row has a test in §7.

| #   | Case                                                         | Behaviour                                                                |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| E1  | Face's asset is trashed (`asset.deletedAt`)                  | preview 404s; crop route unchanged (E20)                                 |
| E2  | Face's asset is Locked or Hidden                             | preview 404s (inherits `reviewableAssetVisibility`)                      |
| E3  | Unknown or malformed face id                                 | 404, identical to E1/E2 — no existence disclosure                        |
| E4  | Asset has no Preview file but has a Thumbnail file           | serves the thumbnail file                                                |
| E5  | Asset has neither                                            | 404                                                                      |
| E6  | `image.preview.format` is webp                               | `Content-Type: image/webp`, not hardcoded jpeg                           |
| E7  | Non-admin or unauthenticated caller                          | refused by `@Authenticated({ admin: true })`                             |
| E8  | `imageWidth` or `imageHeight` is 0 (legacy `Generated` rows) | photo renders, **no** overlay; never divides by zero                     |
| E9  | Degenerate box (`x2 <= x1` or `y2 <= y1`)                    | photo renders, no overlay                                                |
| E10 | Box extends past the image edge (bad ML output)              | clamped to 0–1 before mapping                                            |
| E11 | Face on a video asset                                        | works — the preview file is an image                                     |
| E12 | Face removed by `applyVerdictFilters`                        | its context is absent from the response                                  |
| E13 | Photo taken at 00:30                                         | date formatted in UTC, no day shift                                      |
| E14 | Magnifier clicked on a tile                                  | selection state unchanged, nothing staged                                |
| E15 | Keyboard-only admin                                          | magnifier focusable and labelled; Escape dismisses                       |
| E16 | Modal open on the first / last face                          | that arrow is disabled; no wrap                                          |
| E17 | Rest-grid magnifier with no destination chosen               | opens; stages nothing; `canBulkMove` untouched                           |
| E18 | Grid revisited                                               | preview served `PrivateWithCache`                                        |
| E19 | Preview stored in S3                                         | `serveFromBackend` resolves the backend correctly                        |
| E20 | Regression pin                                               | `getFaceByIdIncludingTombstoned` still returns a face on a trashed asset |
| E21 | `localDateTime` missing from a stale SDK response            | pill omitted, never renders Luxon's "Invalid DateTime"                   |
| E22 | Asset has saved edits                                        | serves the **unedited** preview, so the box stays aligned (§4.1)         |
| E23 | Photo contains several people                                | exactly one box — the clicked face (§4.3)                                |

## 6. Slices (TDD — each slice is red first, then green, then gates)

Every slice writes its failing test **before** the implementation, and each test must be proven capable of
failing (delete or invert the implementation and watch it go red) — `queryBy`-style assertions that pass
either way do not count.

| Slice | Scope                                                                        | Depends on |
| ----- | ---------------------------------------------------------------------------- | ---------- |
| S1    | Repository: `getFaceByIdOnLiveAsset` + the E20 pin                           | —          |
| S2    | Service + controller: `getAdminFacePreview`, the route                       | S1         |
| S3    | DTOs + queries: context fields on both list paths                            | —          |
| S4    | `mise open-api` + `mise sql` regeneration                                    | S2, S3     |
| S5    | API e2e: cross-owner read, non-admin refusal (T10)                           | S2         |
| S6    | Web: `getAdminFacePreviewUrl` + `FacePhotoModal` + i18n                      | S4         |
| S7    | Web: guided page — flagged grid and rest grid, plus web `FlaggedFace` (§4.4) | S6         |
| S8    | Web: manual review page, plus `ManualFace` (§4.4)                            | S6         |
| S9    | Full gates, screenshots, commit                                              | all        |

S3 is independent of S1/S2 and may run in parallel with them; S4 is the join point because web needs the
regenerated SDK types. S5 depends only on the route, so it can run while the web slices are in flight.

## 7. Test matrix

### T1 — Repository (medium, real DB)

`server/test/medium/specs/repositories/person.repository.spec.ts`, in a new
`describe('getFaceByIdOnLiveAsset')` beside the existing `getFaceByIdIncludingTombstoned` block (`:1241`).

| Id   | Test                                                              | Covers |
| ---- | ----------------------------------------------------------------- | ------ |
| T1.1 | returns a face on a live timeline asset (positive control)        | —      |
| T1.2 | throws for a face whose asset has `deletedAt` set                 | E1     |
| T1.3 | throws for a face on a Locked asset                               | E2     |
| T1.4 | still returns a **tombstoned** face on a live asset               | §4.1   |
| T1.5 | pin: `getFaceByIdIncludingTombstoned` still returns the T1.2 face | E20    |

T1.5 is the regression pin that proves the three shipped crop surfaces did not change.

### T2 — Service (small, mocked)

`server/src/services/face-repair.service.spec.ts`, new `describe('getAdminFacePreview')`. Follows the
existing `getAdminFaceThumbnail` block: `AssetFaceFactory.create` + `getForAssetFace`, and
`vi.spyOn(sut as any, 'serveFromBackend')` in the same style as the existing `ensureLocalFile` spy.

| Id   | Test                                                                                        | Covers |
| ---- | ------------------------------------------------------------------------------------------- | ------ |
| T2.1 | serves the preview path for a face on another user's asset, `checkOwnerAccess` never called | §2     |
| T2.2 | does **not** call `mocks.media.generateThumbnail` — the response is uncropped               | §3     |
| T2.3 | falls back to the Thumbnail file when the Preview file path is null                         | E4     |
| T2.4 | throws `NotFoundException` when both are null                                               | E5     |
| T2.5 | throws `NotFoundException` when the repository rejects                                      | E3     |
| T2.6 | a `.webp` preview path yields `image/webp`                                                  | E6     |
| T2.7 | serves with `CacheControl.PrivateWithCache`                                                 | E18    |
| T2.8 | goes through `serveFromBackend`, not a bare `ImmichFileResponse`                            | E19    |
| T2.9 | requests the thumbnail source with `edited: false` — the unedited preview                   | E22    |

T2.2 and T2.8 are the two that would silently regress into an expensive or disk-only implementation.

`getPersonFlaggedFaces`, same file:

| Id    | Test                                                                        | Covers |
| ----- | --------------------------------------------------------------------------- | ------ |
| T2.10 | surviving faces carry `localDateTime` and the box fields through the filter | §4.2   |
| T2.11 | a face removed by `applyVerdictFilters` contributes no context              | E12    |

### T3 — Controller

`server/src/controllers/face-repair-admin.controller.spec.ts`, mirroring the thumbnail block (`:935`) —
including its `ImmichRedirectResponse` trick, which exercises `sendFile`'s real dispatch without touching
the filesystem.

| Id   | Test                                                              | Covers |
| ---- | ----------------------------------------------------------------- | ------ |
| T3.1 | is an authenticated route with `metadata: { adminRoute: true }`   | E7     |
| T3.2 | delegates to `service.getAdminFacePreview` with the `assetFaceId` | §4.1   |

### T4 — DTOs

`server/src/dtos/face-repair.dto.spec.ts`.

| Id   | Test                                                                      | Covers |
| ---- | ------------------------------------------------------------------------- | ------ |
| T4.1 | `FaceRepairPersonFacesSchema` parses a flagged face carrying context      | §4.2   |
| T4.2 | `FaceRepairClusterFacesResponseSchema` parses a cluster face with context | §4.2   |
| T4.3 | both reject a face missing `localDateTime`                                | §4.2   |

### T5 — List queries (medium, real DB)

`server/test/medium/specs/repositories/face-repair.repository.spec.ts` and
`face-repair-scan-flagged-face.repository.spec.ts`.

| Id   | Test                                                                       | Covers |
| ---- | -------------------------------------------------------------------------- | ------ |
| T5.1 | `getClusterFacePage` returns `localDateTime` + the six box fields per face | §3     |
| T5.2 | `getScanFlaggedFaces` returns the same                                     | §3     |
| T5.3 | pin: a face on a trashed asset is still absent from both pages             | §3     |

### T6 — Web: modal

`web/src/lib/components/face-cleanup/FacePhotoModal.spec.ts`. happy-dom reports `naturalWidth`/`width` as
0 for images, so geometry tests stub them via `Object.defineProperty` on the `<img>`; the pure mapping is
separately covered by calling `getBoundingBox` with a synthetic `ContentMetrics`.

| Id    | Test                                                                    | Covers |
| ----- | ----------------------------------------------------------------------- | ------ |
| T6.1  | renders an `<img>` pointing at the admin preview URL for the face       | §4.3   |
| T6.2  | renders the box overlay positioned from `getContentMetrics`             | §4.3   |
| T6.3  | omits the overlay when `imageWidth` is 0                                | E8     |
| T6.11 | renders exactly one box for a face whose photo holds several people     | E23    |
| T6.4  | omits the overlay for a degenerate box                                  | E9     |
| T6.5  | clamps a box that extends past the image edge                           | E10    |
| T6.6  | `→` advances, `←` goes back, and the image `src` follows                | §4.3   |
| T6.7  | `←` is disabled at index 0; `→` is disabled at the last index; no wrap  | E16    |
| T6.8  | `Escape` calls `onClose`                                                | E15    |
| T6.9  | formats the date in UTC — a `T00:30Z` photo shows its own day           | E13    |
| T6.10 | omits the pill when `localDateTime` is absent, never "Invalid DateTime" | E21    |

### T7 — Web: guided page

`web/src/routes/admin/face-cleanup/[personId]/page.spec.ts`, extending the existing harness (SDK and
`@immich/ui` already mocked there, `modalManager.show` already a `vi.fn()`).

| Id   | Test                                                                                      | Covers   |
| ---- | ----------------------------------------------------------------------------------------- | -------- |
| T7.1 | every flagged tile renders a labelled magnifier                                           | §4.5     |
| T7.2 | clicking it calls `modalManager.show(FacePhotoModal, …)` with that face's index           | §4.5     |
| T7.3 | **clicking it leaves the tile's `data-state` and the selection count unchanged**          | E14      |
| T7.4 | every flagged tile renders its date pill                                                  | §4.5     |
| T7.5 | rest-grid tiles render a magnifier that opens the modal over `restFaces`                  | §4.5     |
| T7.6 | **rest-grid magnifier leaves `data-selected` alone and works with no destination chosen** | E14, E17 |
| T7.7 | the magnifier is a sibling of the tile button, not nested inside it                       | §4.5     |

T7.3 and T7.6 are the load-bearing tests of this whole change; both assert observable state before and
after the click, not merely that a handler ran.

### T8 — Web: manual page

`web/src/routes/admin/face-cleanup/people/[personId]/page.spec.ts`.

| Id   | Test                                                                      | Covers |
| ---- | ------------------------------------------------------------------------- | ------ |
| T8.1 | manual tiles render a labelled magnifier that opens the modal             | §4.5   |
| T8.2 | **clicking it leaves the tile's manual state at `keep`** — nothing staged | E14    |
| T8.3 | manual tiles render the date pill                                         | §4.5   |

### T9 — Web: url helper

`web/src/lib/utils/people-utils.spec.ts`.

| Id   | Test                                                                   | Covers |
| ---- | ---------------------------------------------------------------------- | ------ |
| T9.1 | `getAdminFacePreviewUrl` builds `/admin/face-repair/faces/:id/preview` | §4.3   |

### T10 — API end-to-end

New `e2e/src/specs/server/api/face-repair-preview.e2e-spec.ts`, following the scope-focused specs already
in that directory (`person-faces-picker-scope`, `person-representative-face-write-scope`). This is the fast
vitest API suite, **not** the Playwright web suite — it has none of the `.serial` fragility that makes web
e2e expensive, and this route's central promise is a cross-owner authorization claim that no unit test
exercises end to end.

| Id    | Test                                                                                   | Covers |
| ----- | -------------------------------------------------------------------------------------- | ------ |
| T10.1 | an admin GETs the preview for a face on **another user's** asset and receives an image | §2     |
| T10.2 | a non-admin user is refused for that same face id                                      | E7     |
| T10.3 | an unauthenticated request is refused                                                  | E7     |
| T10.4 | the same face id on a trashed asset 404s for the admin                                 | E1     |
| T10.5 | control: the crop route still serves that trashed face id                              | E20    |

T10.1 is the only test in the whole matrix that proves the feature actually does the thing the discussion
asked for. T10.5 pairs with T1.5 to pin the crop route from the other side of the stack.

### Not covered by automated tests

- The visual placement of the magnifier and date pill (§4.5) — verified by screenshot. The reskin visual
  regression cases are `test.fixme`, so UI is enforced through component reuse and testids, not
  screenshots.
- A Playwright web journey (open the console → click a magnifier → see the photo). T7/T8 cover the click
  contract at the component level and T10 covers the route; a browser journey would mostly re-assert both
  through the slowest available harness, in a `.serial` file where one failure skips every later test.
- **E11 (face on a video asset) — the only edge case in §5 with no test, deliberately.** There is no
  asset-type branch to exercise: `getFaceThumbnailSource` reads `asset_file` rows by `AssetFileType`, and
  Immich generates preview images for videos through the same pipeline it uses for photos — which is also
  why the existing crop route already works on video faces today. A test here would assert that an
  `if` nobody wrote is still absent.

## 8. Verification gates

```bash
# server (from server/)
pnpm exec vitest --run src/services/face-repair.service.spec.ts \
                       src/controllers/face-repair-admin.controller.spec.ts \
                       src/dtos/face-repair.dto.spec.ts
pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/repositories/person.repository.spec.ts \
  test/medium/specs/repositories/face-repair.repository.spec.ts
pnpm exec vitest --run src/utils/shared-space-album-scope.guard.spec.ts
pnpm lint                       # --max-warnings 0
pnpm exec prettier --check src test
mise open-api
mise sql

# API e2e (from e2e/, against a rebuilt stack)
pnpm test src/specs/server/api/face-repair-preview.e2e-spec.ts

# web (from web/)
pnpm exec vitest --run src/lib/components/face-cleanup/FacePhotoModal.spec.ts \
                       src/lib/utils/people-utils.spec.ts \
                       'src/routes/admin/face-cleanup/**/page.spec.ts'
pnpm check

# i18n + docs (from repo root)
npx prettier --write i18n/*.json
pnpm -C docs exec prettier --write superpowers/specs/2026-09-03-face-cleanup-photo-context-design.md
```

Traps this repo has hit before, all applicable here:

- `pnpm test -- --run <path>` **silently drops the filter** and runs the whole suite — use
  `pnpm exec vitest --run <path>`.
- Server `prettier --check` is a **separate CI gate** from eslint, and runs over `src/` **and** `test/`.
- `mise sql` needs a clean `dist` and a migrated throwaway Postgres, or it emits empty query files.
- **`shared-space-album-scope.guard.spec.ts` matches its visibility allowlist by _proximity_**, so inserting
  a new repository read can flip the verdict on a neighbouring method that did not change. The new method
  carries `reviewableAssetVisibility` inline and should pass on its own merits, but run that spec
  explicitly — it is the one gate that a purely additive change can still break.
- `mise e2e` runs `docker compose up` **without** `--build` and will happily serve 404s for a new route
  from a stale image. Rebuild explicitly before T10.
- Markdown under `docs/` must be formatted with the **docs** package's prettier, not web's — CI's
  "Docs Build → Check formatting" is strict and the two configs disagree.
- `check:svelte` is effectively push-only; a `$t` key typed as `string` passes tsc and local svelte-check
  and still fails CI.

## 9. Out of scope

- The **resolutions** page (`web/src/routes/admin/face-cleanup/resolutions/+page.svelte`). It renders the
  same crops, but its `assetFaceId` is nullable (`face-repair.dto.ts:197`) and it is a history log rather
  than a triage grid. `getFaceByIdOnLiveAsset` deliberately keeps tombstoned faces (§4.1) so this can be
  added later without a server change.
- Granting admins general `asset.read` in the library timeline.
- Changing who may run face cleanup — still admin-only.
- A selection-dock entry point. The dock is ambiguous under multi-select, and context is needed _before_
  selecting.
- Mobile. The face cleanup console is web-only.

## 10. Downstream notes

- **Demo branch.** `DEMO_ADMIN_PREVIEW_READ_ROUTES` (on the `demo` branch only) allowlists GET routes by
  anchored regex, and today includes `faces/:id/thumbnail`. That entry is safe because of demo's _dataset_
  — 0 archived and 0 trashed assets — not because of the route. Whoever rebases demo must decide
  explicitly whether `/preview` joins the allowlist; it would serve full photos of the seeded library
  through an id enumerable from `scan/latest`. Not adding it degrades to a broken magnifier, so the
  control should be hidden under `authManager.isReadOnlyDemo` if the route stays out.
- **Docs.** `docs/docs/administration/face-cleanup.md` has drifted from the shipped console before. It
  should gain a line about the magnifier once this lands; verify vocabulary against `i18n/en.json` and the
  route files, not against older spec documents.
