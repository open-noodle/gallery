# Honest feedback from bulk tagging

Status: design, 2026-11-27. Base: `main` at `94f05b13f3c`; every path and line below refers to that commit. Upstream
reference: Immich `v3.4.2` (`branding/config.json` `upstream.version`), diffs measured against `refs/upstream/v3.4.2`.

## Summary

`PUT /tags/assets` answers 200 with `count: 0` when it skipped every requested tag or asset, and the web shows that as a
success toast ("Tagged 0 assets"). The response gains three additive fields that say which assets were tagged and which
assets and tags were skipped, and the web toast reports them. No permission changes, no stored data, one spread in one
upstream method.

## Problem

1. **A picked tag the caller does not own is dropped silently.** The tag picker
   (`web/src/lib/modals/AssetTagModal.svelte:26`) lists `GET /tags`, which since #647 includes tags on assets the caller
   sees through a space (`TagRepository.getAll` and `ownedOrSpaceAccessible`,
   `server/src/repositories/tag.repository.ts:72-94`). `TagService.bulkTagAssets`
   (`server/src/services/tag.service.ts:94-114`) keeps only the tag ids that pass `Permission.TagAsset` (`:96`), which
   is tag-owner only (`server/src/utils/access.ts:339-343`), and returns `{ count: results.length }` (`:113`). A space
   editor who picks a tag another member owns, or an owner who picks a name held only by another user, gets 200 with
   `count: 0`.
2. **The web reports that as a success.** `handleTagAssets` (`web/src/lib/services/asset.service.ts:569-581`) shows
   `toastManager.primary` with `tagged_assets` and `response.count` whatever the count is.
3. **`count` cannot say what was skipped.** It counts newly inserted tag×asset pairs (`upsertAssetIds` inserts with
   `ON CONFLICT DO NOTHING`, `tag.repository.ts:212-224`), so an asset that already carried the tag counts 0 as well,
   and assets the caller may not edit (`checkAssetEditAccess`, `:97`) are not reported at all.

## Goals and non-goals

Goals:

1. The response says which requested assets were tagged, which assets were skipped and which tags were skipped.
2. The web toast reports success only when nothing was skipped.
3. No permission, data or event change: the same links are written, the same `AssetTag` events are emitted, in the
   same order.

Non-goals, left for a later design on top of #1344:

- Which namespace a tag on a member's asset lands in. Since #1344 a space editor's tag stays the editor's: metadata
  extraction writes only the asset owner's tags (`getForUpdateTags` filters `tag.userId = asset.ownerId`,
  `server/src/repositories/asset.repository.ts:1464-1475`) and
  `replaceAssetTags` replaces only the owner's links (`server/src/gallery/utils/asset-owner-tags.ts`).
- Removing tags by the asset owner or by space editors (`TagService.removeAssets`, `tag.service.ts:137-156`,
  unchanged).
- One picker entry per tag name, grouped tag search, the tag explorer, mobile.

## Current state

| Step         | Code                                                                                            | Behaviour                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Tag access   | `tag.service.ts:96` → `access.ts:339-343`                                                       | tag ids the caller owns                                                                    |
| Asset access | `tag.service.ts:97` → `checkAssetEditAccess`, `server/src/gallery/utils/access-grants.ts:60-68` | owner, or Owner/Editor of a space whose member owns the asset                              |
| Links        | `tag.service.ts:100-107`, `upsertAssetIds`                                                      | every permitted tag × every permitted asset, existing pairs kept                           |
| Side effects | `tag.service.ts:108-111`                                                                        | per newly linked asset: `updateTags` (exif tag list), then `AssetTag` with the caller's id |
| Response     | `tag.service.ts:113`, `TagBulkAssetsResponseSchema` (`server/src/dtos/tag.dto.ts:43-47`)        | `{ count }`                                                                                |
| Web toast    | `asset.service.ts:569-581`                                                                      | `primary` "Tagged {count} assets", always                                                  |
| Mobile       | `mobile/lib/data/server/tag.dart:21-24`                                                         | reads `count` only                                                                         |

## Options considered

1. **One spread in the upstream return (chosen).** `bulkTagAssets` keeps upstream's body; its return becomes
   `{ count: results.length, ...galleryTagBulkFeedback(dto, tagIds, assetIds) }`, with the pure helper in a fork file.
   The helper only reads the two permitted sets the method already computed, so nothing upstream decides moves out of
   the upstream file (AGENTS.md rules 4 and 5), and an upstream change to the method still conflicts at rebase time
   instead of being lost.
2. **Move the method body into a fork service.** Needed only if the fork had to change which tags or assets are linked
   (an earlier draft did, for owner-namespace resolution and removal). For feedback alone it removes ~20 upstream lines
   from the file and turns every future upstream change to the method into a silent loss that must be caught by a
   preflight entry. Rejected.
3. **Compute the feedback on the client** by comparing the request with the tags shown afterwards. Needs a second read
   per asset and cannot tell "not permitted" from "already linked". Rejected.

## Design

### API (additive only)

`TagBulkAssetsResponseDto` gains three fields through one spread in `server/src/dtos/tag.dto.ts` from the fork file
`server/src/gallery/dtos/tag.dto.ts`. All are optional in the schema (AGENTS.md rule 6) and always sent by this server:

- `taggedAssetIds: string[]`: the requested assets the caller may tag that carry every **permitted** requested tag after
  the call, whether the link is new or already existed. Empty when no requested tag is permitted. A request with
  permitted tags and one skipped tag still reports the permitted assets as tagged and lists the tag in
  `skippedTagIds` (this matches upstream's e2e case "should skip tags that are not owned by the user").
- `skippedAssetIds: string[]`: the requested assets the caller may not tag; nothing was written for them.
- `skippedTagIds: string[]`: the requested tag ids the caller may not use; nothing was written for them.

Each list holds every id once, in request order. `count` keeps its meaning (new tag×asset pairs).

The helper `galleryTagBulkFeedback(dto, permittedTagIds, permittedAssetIds)`
(`server/src/gallery/utils/tag-bulk-feedback.ts`) is pure: it derives the three lists from the request and the two
sets `bulkTagAssets` already holds. It reads no repository and writes nothing.

### Web

`handleTagAssets` calls the fork helper `notifyTagAssets` (`web/src/lib/gallery/utils/tag-assets-result.ts`) in place of
its own toast. It reports tagged assets, assets not tagged (requested minus tagged) and tags that could not be added
(`skippedTagIds`) separately, for example "Tagged 2 assets, 1 tag could not be added" or "Tagged 1 asset, 1 asset was
not tagged". Severity: success only when nothing was skipped, info when something was tagged and something skipped,
warning when nothing was tagged. Without `taggedAssetIds` in the response it keeps upstream's toast.

### i18n

New keys in `i18n/gallery/en.json` and the nine maintained locales (`de`, `fr`, `it`, `nl`, `pl`, `es`, `ru`, `zh_Hans`,
`zh_Hant`), each in its file's register, ICU plurals, keys sorted:

- `tagged_assets_with_skipped` (tagged assets and assets not tagged)
- `tagged_assets_with_skipped_tags` (tagged assets and tags that could not be added)
- `tagged_assets_with_skipped_assets_and_tags` (all three counts)

Upstream's `tagged_assets` stays unchanged and is still used for the success case.

## Authorization

No permission changes. The two access checks (`tag.service.ts:96-97`) and the links they produce are upstream's
and #992's, unchanged; the response only reports their outcome. The tag ids in `skippedTagIds` are ids the caller sent,
so the response reveals nothing the caller did not supply, and `taggedAssetIds` and `skippedAssetIds` partition the
caller's own request. No widening, so no opt-in setting and no enumerating role matrix (AGENTS.md rule 7): there is no
new decision to enumerate. The existing guards cover the decisions themselves: the access oracle for `TagAsset` and
`AssetUpdate`, the RBAC oracle's tag-write row (`server/test/medium/specs/utils/rbac-oracle.medium.spec.ts`, which
snapshots `count` and the written links) and `server/test/medium/specs/services/space-editor-asset-edit.medium.spec.ts`.

## Compatibility

| Pairing                                   | What it sees                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| Web, any                                  | same version as the server (`server/src/repositories/config.repository.ts:246`) |
| Old Gallery app or API client, new server | extra response fields, ignored; `count` unchanged                               |
| New web, old server                       | fields absent, upstream's toast                                                 |
| Mobile app, any server                    | reads `count` only (`tag.dart:21-24`), unchanged                                |
| Stock Immich app, Gallery server          | extra fields in a response its generated client already parses as `{ count }`   |
| Stock Immich server, Gallery DB           | nothing stored, nothing to see                                                  |

## Upstream impact

Measured against `refs/upstream/v3.4.2`, on the base and with this change:

| File                                       | Base vs tag | With this change | What changes                                                                                                                                                                                                                                                |
| ------------------------------------------ | ----------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/services/tag.service.ts`       | +2 / −1     | +4 / −2          | one import and the spread in `bulkTagAssets`' return                                                                                                                                                                                                        |
| `server/src/dtos/tag.dto.ts`               | identical   | +2               | one import, one spread into `TagBulkAssetsResponseSchema`                                                                                                                                                                                                   |
| `server/src/services/tag.service.spec.ts`  | +14         | +20 / −2         | three upstream assertions on the response relaxed from `toEqual({ count })` to `toMatchObject({ count })`, because the response gained additive fields; no fork tests added here (they sit beside the fork helper and in the medium spec, AGENTS.md rule 8) |
| `e2e/src/specs/server/api/tag.e2e-spec.ts` | identical   | +3 / −3          | the same three relaxations for the HTTP cases; nothing else                                                                                                                                                                                                 |
| `web/src/lib/services/asset.service.ts`    | +28 / −8    | +30 / −9         | one import and the toast call replaced by the fork helper                                                                                                                                                                                                   |

Generated: `open-api/immich-openapi-specs.json` and `packages/sdk/src/fetch-client.ts` gain the three fields. The Dart
client is generated at build time.

## Switch-back

Nothing is stored: no table, no column, no config key. A stock Immich server returns `{ count }` again.

## Performance

Three linear passes over the request's ids, after the existing queries. No query added.

## Testing

- Unit, through `TagService` (`server/src/gallery/utils/tag-bulk-feedback.spec.ts`): all permitted; an asset that
  already carried the tag (tagged, no new link, no event); every tag skipped; permitted tags plus one skipped tag
  (permitted assets tagged, tag skipped); assets without edit access skipped and not written; repeated ids reported
  once; `updateTags` and `AssetTag` per newly linked asset in that order, with the caller's id.
- Medium (`server/test/medium/specs/gallery/tag-bulk-assets-feedback.medium.spec.ts`), real repositories: owner on own
  asset; already tagged; an editor picking the owner's tag (skipped, nothing written); an editor's own tag on a member
  asset; the editor's own tag plus the owner's tag on a member asset (tagged plus skipped tag, links checked); an asset
  outside the caller's edit access.
- `server/test/medium/specs/services/space-editor-asset-edit.medium.spec.ts`: the editor case asserts the full new
  object.
- Web (`web/src/lib/gallery/utils/tag-assets-result.spec.ts`): every toast branch (fields absent, success, assets not
  tagged, tags not added, both, nothing tagged because of assets, nothing tagged because of tags).
- The access and RBAC oracle snapshots stay unchanged.

## Documentation

None user-facing: the toast explains itself. The OpenAPI descriptions of the three fields carry the semantics.

## Open questions

1. Should a later design make `count` count tagged assets rather than new pairs? Not proposed: it would change an
   upstream field's meaning (AGENTS.md rule 6).
