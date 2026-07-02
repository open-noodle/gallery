# Slice 16 (finding LOW#5) — takeout uploader drops removed DTO fields

## Problem

`web/src/lib/utils/google-takeout-uploader.ts` still builds its upload
`FormData` with `deviceAssetId` / `deviceId` fields. Upstream removed both
fields from `AssetMediaCreateDto` (`server/src/dtos/asset-media.dto.ts` —
`AssetMediaCreateSchema` only has `fileCreatedAt`, `fileModifiedAt`,
`duration`, `filename`, `assetData`, `isFavorite`, `visibility`,
`livePhotoVideoId`, `metadata`, `sidecarData`). The canonical uploader,
`web/src/lib/utils/file-uploader.ts`, already builds its FormData without
those two fields (confirmed by reading `fileUploader()`). The takeout
uploader is stale and sends two form fields the server DTO no longer
declares.

## Ground truth read

- `google-takeout-uploader.ts` (`uploadTakeoutItem`): computes a local
  `deviceAssetId` const (`'takeout-' + item.name + '-' + item.lastModified`)
  and appends `formData.append('deviceAssetId', deviceAssetId)` and
  `formData.append('deviceId', 'WEB_IMPORT')` before appending
  `fileCreatedAt` / `fileModifiedAt` / `isFavorite` / `assetData`.
- `file-uploader.ts` (`fileUploader`): builds FormData from
  `{ fileCreatedAt, fileModifiedAt, isFavorite, assetData }` only — no
  `deviceAssetId`/`deviceId` fields sent to the server (it keeps a
  `deviceAssetId` string only as a local upload-tracking key for the
  `uploadAssetsStore`, never appended to FormData).
- `server/src/dtos/asset-media.dto.ts` `AssetMediaCreateSchema`: no device
  fields exist in the current schema.
- Existing spec `google-takeout-uploader.spec.ts` has two tests that
  currently assert the stale fields' *values* (`deviceAssetId` ===
  `'takeout-IMG_001.jpg-1609459200000'`, `deviceId` === `'WEB_IMPORT'`) —
  these assertions must flip to asserting absence.

## Plan (strict TDD)

1. RED: update the existing spec assertions (`builds FormData with correct
   fileCreatedAt from Takeout date`, `uses item name and lastModified
   metadata instead of file metadata`) to assert `formData.get('deviceAssetId')`
   and `formData.get('deviceId')` are `null` (field absent), plus add one
   dedicated test asserting the current required fields present
   (`fileCreatedAt`, `isFavorite`, `assetData`) and the two legacy fields
   absent. Run scoped vitest — expect failure since implementation still
   appends both fields today.
2. GREEN: remove the two `formData.append('deviceAssetId', ...)` /
   `formData.append('deviceId', 'WEB_IMPORT')` lines and the now-unused
   local `deviceAssetId` const from `uploadTakeoutItem`. Re-run scoped
   vitest — expect pass.
3. Confirm no other use of the local `deviceAssetId` variable remains
   (duplicate-check path uses `item.name`, not this var) and that
   live-photo pairing / filename / fileCreatedAt behavior is untouched.

## Non-goals

- Not touching `file-uploader.ts` (already correct, used as the reference).
- Not touching the server DTO (already correct upstream state).
- Not changing any other takeout parser/scanner files.
