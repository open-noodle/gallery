# Pi Agent Capability Matrix

Status: planning artifact
Date: 2026-05-19
Branch: `explore/pi-agent-brainstorm`

## Purpose

This matrix defines what a Gallery assistant should be able to do for users,
whether the current MCP/runtime surface supports it, and what needs to be tested
before we can call the capability solid.

It is intentionally user-task focused. The assistant should be measured by
whether a normal prompt can produce a readable answer, permission request,
reviewable plan, applied-plan card, and continued chat flow. Raw MCP tool
availability is necessary, but not enough.

## Current Capability Surface

Current read tools:

- `searchAssets`: Smart, OCR, description, filename, and metadata search by
  date, created/updated ranges, location labels, camera fields, favorite state,
  album membership, tags, people, shared-space people, shared-space scope,
  visibility, rating including unrated, media type, trashed state (`isTrashed`,
  for restore sources), bounded limit, order, and page continuation.
- `resolveAssetSearchFilters`: resolves user-facing people, tag, album, shared
  space, location, camera make/model, and lens names into `searchAssets` filters
  or structured ambiguity/denied/no-match results.
- `resolveLocation`: forward-geocodes a place name to coordinates via the
  `geodata_places` trigram index, returning `matched` / `ambiguous` (with candidate
  choices) / `not_found` so place-name metadata edits resolve without asking for
  raw lat/lng.
- `readAssetMetadata`: timestamps, location labels, camera fields, rating,
  favorite state, visibility, and tags for selected assets.
- `readAssetPreviews`: preview media references for selected assets.
- `readAssetOriginals`: original media references for selected assets, gated by
  permission preset.
- `listAlbums`: visible album summaries.
- `readAlbum`: visible album details and asset ids.
- `listSpaces`: visible shared-space summaries.
- `readSpace`: visible shared-space details, member summaries, and bounded asset
  ids.
- `searchUsers`: visible Gallery users for shared-space member planning.
- `listDuplicateGroups`: near-duplicate photo groups (CLIP-embedding detection),
  scrubbed to the fields needed to choose a keeper (id, filename, date, favorite,
  rating, resolution) — no raw EXIF or media URLs.
- `curateSelection`: ranks a bounded selection handle by metadata signals and
  returns a curated subset handle (suggested highlights, not objective scoring).

Current planning tools:

- `proposeAlbumOperations`: creates a reviewable plan.
- `reviseProposedOperations`: replaces an existing plan after user feedback.
- `summarizePlan`: summarizes an existing plan.
- `proposeAssetBatchFromSearch` / `proposeAssetBatchFromSelection`: propose
  reviewable favorite, archive, tag, metadata, rotate, crop, adjust, flip, stack,
  or unstack operations from a declarative/previous search source or a resolved
  selection handle.

Current reviewable operation types:

- Albums: `album.create`, `album.addAssets`, `album.removeAssets`,
  `album.updateDetails`, `album.setCover`.
- Spaces: `space.create`, `space.addAssets`, `space.removeAssets`,
  `space.updateDetails`, `space.addMembers`, `space.removeMembers`,
  `space.updateMemberRole`.
- Assets: `asset.rotate`, `asset.setFavorite`, `asset.setArchive`,
  `asset.addTag`, `asset.removeTag`, `asset.updateMetadata`, `asset.trash`
  (reversible move to Trash; High risk; `trashAssets` write-scope),
  `asset.restore` (reversible un-trash; Low risk; `trashAssets` write-scope),
  `asset.crop` (reversible explicit-geometry crop; Low risk; `editAssets`
  write-scope; ImageEditBatch target), `asset.adjust` (reversible tonal edit —
  brightness/contrast/saturation named levels or one-click auto-enhance; Low
  risk; `editAssets`; ImageEditBatch), `asset.flip` (reversible horizontal/
  vertical mirror; Low risk; `editAssets`; ImageEditBatch), `asset.stack` /
  `asset.unstack` (stack a bounded set under an auto-selected cover, or dissolve
  stacks; Low risk; `manageStacks` write-scope).
- People: `person.update` (rename, birthdate, hide/unhide; Low risk;
  `managePeople` write-scope), `person.merge` (High risk, irreversible — faces
  reassigned, source person deleted; `managePeople`).
- Sharing: `shareLink.create` (creates an individual-asset public share link with
  optional expiry/password/hide-metadata; High risk; OUTWARD-FACING;
  `createSharedLinks` write-scope, granted only in the LocalPowerUser preset),
  `shareLink.createAlbum` (album public share link; High risk; OUTWARD-FACING;
  `createSharedLinks`, default-off in every preset — propose-only).

Image-edit operations (`asset.crop` / `asset.adjust` / `asset.flip`) render a
non-persisting before/after preview on the plan card via an ephemeral
`POST /assets/:id/edits/preview` endpoint, so users iterate on the look (via
`reviseProposedOperations`) before applying.

Safety invariant: MCP tools do not directly mutate the gallery. Writes must be
represented as operation plans and applied by Gallery after user review.

## Capability Tiers

- **Solid now**: supported by current MCP tools and operation plans. Needs
  regression coverage and prompt examples, not new backend capability.
- **Constrained now**: possible only when the user provides enough metadata or
  the assistant can inspect a bounded candidate set. Needs UX/prompt guardrails.
- **Needs new tool**: cannot be reliable with the current MCP surface.
- **Out of scope**: intentionally unsupported until product policy changes.

## Flow Ownership Matrix

Flow ownership defines whether Pi may freely choose MCP tool sequencing or
whether Gallery owns the workflow for a productized capability.

- **Strict**: Gallery code owns the procedure. Pi may fill user-facing slots
  such as names, place hints, counts, or final copy, but it cannot choose a
  different tool sequence once the supported intent matches.
- **Hybrid**: Pi may use open exploration to resolve a source, target, or
  subjective choice, then Gallery owns the write-plan procedure.
- **Open read flow**: Pi may choose read/search tools flexibly because the task
  is exploratory and non-mutating.
- **Open discovery, strict plan**: Pi may inspect and suggest candidates, but
  any write action still goes through deterministic plan creation.

Hard invariants apply to every flow: no claimed plan unless a persisted plan id
exists, no direct write tools, no large raw asset ID lists in model-facing
responses, selection handles for asset sets, and recoverable tool mistakes
retried only when the correction is mechanical.

| Capability                       | Flow ownership      | Workflow or boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create recent trip album         | Strict              | `create_recent_trip_album` handles recent-trip detection, candidate choice, and album plan creation from the handle. See [strict recent trip album design](./2026-05-28-pi-agent-strict-recent-trip-album-design.md).                                                                                                                                                                                                                                                                                                    |
| Create album from a source       | Hybrid              | `create_album_from_source`: generic album from a recency/date/type source via `proposeAlbumFromSelection`; trip and subjective sources hand off.                                                                                                                                                                                                                                                                                                                                                                         |
| Add photos to existing album     | Hybrid              | `add_photos_to_album`: Pi may resolve the source; Gallery owns album lookup, duplicate-safe add semantics, and plan creation.                                                                                                                                                                                                                                                                                                                                                                                            |
| Move photos between albums       | Hybrid              | `move_photos_between_albums`: Pi resolves the source + both albums; Gallery owns the compound `album.removeAssets` + `album.addAssets` plan (requires both from and to; same-album declines).                                                                                                                                                                                                                                                                                                                            |
| Remove photos from album         | Hybrid              | `remove_photos_from_album`: Pi resolves the album + source; Gallery owns the `album.removeAssets` plan from the handle (empty removals ask for input).                                                                                                                                                                                                                                                                                                                                                                   |
| Rename or describe album         | Strict              | `rename_or_describe_album`: Direct album-detail update plan; preserve unspecified fields.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Set album cover                  | Strict              | `set_album_cover`: Pi resolves the album + an explicit photo position; Gallery owns the `album.setCover` plan (cover rides in the asset selection).                                                                                                                                                                                                                                                                                                                                                                      |
| Delete an album                  | Strict              | `delete_album`: resolves the album by name (durable disambiguation for duplicate names) and proposes an `album.delete` plan. Photos stay in the library — only the container is removed. Declines photo-deletion intents ("delete the photos in X") and space deletion ("delete the X space" → `delete_space`). `deleteContainers` write-scope required.                                                                                                                                                                 |
| Delete a space                   | Strict              | `delete_space`: resolves the space by name (durable disambiguation for duplicate names) and proposes a `space.delete` plan. The shared space and its membership are removed; photos stay in members' libraries. Server enforces owner-level permission (`SharedSpaceDelete`); workflow proposes regardless (propose-only; server is the backstop). Declines photo-deletion intents ("delete the photos in X space") and album deletion ("delete the X album" → `delete_album`). `deleteContainers` write-scope required. |
| Create space from a source       | Hybrid              | `create_space_from_source`: Pi resolves the source; Gallery owns space creation from the wrapped selection handle (`proposeSpaceFromSearch`).                                                                                                                                                                                                                                                                                                                                                                            |
| Add/remove photos in a space     | Hybrid              | `manage_space_assets`: Pi resolves the space + source; Gallery owns the space add (from-search) / remove (`space.removeAssets`) plan.                                                                                                                                                                                                                                                                                                                                                                                    |
| Update space details             | Strict              | `rename_or_describe_space`: Direct space-detail update plan; preserve assets and members.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Add or remove space members      | Strict              | `manage_space_members`: Gallery owns user lookup, role defaults, membership validation, and plan creation.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Change space member roles        | Strict              | `change_member_role`: Gallery owns role transition validation and plan creation.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| People-based organization        | Hybrid              | Pi may resolve names and filters; Gallery owns the destination action plan.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Natural-language filtered search | Open read flow      | Pi may explore filters and summarize results, while handles remain the asset-set boundary.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Mark favorites                   | Hybrid              | `favorite_assets`: Open curation for subjective "best"; strict favorite plan once a bounded source exists.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Archive assets                   | Hybrid              | `archive_assets`: recency/date/type source -> batch `asset.setArchive` plan; subjective or qualified sources hand off.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Move photos to the Locked folder | Hybrid              | `lock_assets`: Pi resolves a bounded source; Gallery owns the batch `asset.setVisibility` (`visibility: 'locked'`) plan. Lock only — no unlock. Already-locked / non-owned filtering is server-enforced (plan service + `updateAll` ownership guard). Subjective sources and bare "hide <person>" decline. `lockAssets` write-scope required.                                                                                                                                                                            |
| Trash photos                     | Hybrid              | `trash_assets`: Pi resolves the source; Gallery owns the High-risk, reversible `asset.trash` plan (recoverable Trash); album/space deletion and subjective sources hand off.                                                                                                                                                                                                                                                                                                                                             |
| Restore from trash               | Hybrid              | `restore_assets`: Pi resolves a bounded trashed-asset source (isTrashed:true injected automatically); Gallery owns the Low-risk, reversible `asset.restore` plan (moves assets back to the library).                                                                                                                                                                                                                                                                                                                     |
| Duplicate cleanup                | Hybrid              | `cleanup_duplicates`: reads `listDuplicateGroups`, picks one keeper per group (favorite > rating > sharpness > resolution > age > id), and proposes a High-risk, reversible `asset.trash` over the explicit non-keeper asset IDs.                                                                                                                                                                                                                                                                                        |
| Add or remove tags               | Hybrid              | `tag_assets` adds (`asset.addTag`) and `untag_assets` removes (`asset.removeTag`, resolving the tag name to an id) from a resolved source; subjective sources hand off.                                                                                                                                                                                                                                                                                                                                                  |
| Batch asset metadata edits       | Hybrid              | `update_asset_metadata`: Pi resolves a loose-asset source; Gallery owns the `asset.updateMetadata` plan (description/rating/date/timezone/lat+lng; place names resolve to coordinates via `resolveLocation`).                                                                                                                                                                                                                                                                                                            |
| Rotate assets                    | Hybrid              | `rotate_assets`: Pi resolves the source + explicit angle (90/180/270); Gallery owns the batch `asset.rotate` plan. No-angle / subjective declines.                                                                                                                                                                                                                                                                                                                                                                       |
| Crop assets                      | Hybrid              | `crop_assets`: Pi resolves the source + explicit geometry (x/y/width/height); Gallery owns the batch `asset.crop` plan. No-geometry → asks for coordinates; never guesses. Verified at L1 (slot fidelity) + L2; a regex/explicit-path capability — raw coordinate-crop prompts are not reliably engaged by the live LLM agent (OQ-F1), so there is no live-L3 routing assertion.                                                                                                                                         |
| Adjust assets (tonal)            | Hybrid              | `adjust_assets`: Pi resolves a metadata-describable source + tonal params (brightness/contrast/saturation levels or autoEnhance); Gallery owns the batch `asset.adjust` plan. Conflicting brightness directions → needsInput. Subjective and flip/rotate/crop verbs excluded.                                                                                                                                                                                                                                            |
| Flip assets (mirror H/V)         | Hybrid              | `flip_assets`: Pi resolves a metadata-describable source + axis (horizontal default, vertical); Gallery owns the batch `asset.flip` plan. "Upside down" deferred to `rotate_assets` (180°). Subjective and rotate/crop verbs excluded.                                                                                                                                                                                                                                                                                   |
| Stack photos                     | Hybrid              | `stack_assets`: Pi resolves a bounded source (≥2 required; fewer asks to broaden); Gallery owns the batch `asset.stack` plan. Server selects the stack cover automatically (favorite > highest rating > newest > id). `manageStacks` write-scope grants are needed (VisualOrganizer/LocalPowerUser).                                                                                                                                                                                                                     |
| Unstack photos                   | Hybrid              | `unstack_assets`: Pi resolves a bounded source; Gallery owns the batch `asset.unstack` plan. Dissolves any stacks containing the matched assets (assets not in a stack are silently skipped; no minimum-count guard). `manageStacks` write-scope required.                                                                                                                                                                                                                                                               |
| Rename person                    | Hybrid              | `rename_person`: Pi resolves the person via `searchPeople` (durable disambiguation); Gallery owns the `person.update` plan with `{ name }` payload. `managePeople` write-scope required (VisualOrganizer/LocalPowerUser).                                                                                                                                                                                                                                                                                                |
| Set person birthday              | Hybrid              | `set_person_birthdate`: Pi resolves the person via `searchPeople` and parses the date (ISO or natural English); Gallery owns the `person.update` plan with `{ birthDate }` payload. Future dates and unparseable strings return needsInput. `managePeople` write-scope required.                                                                                                                                                                                                                                         |
| Hide/unhide person               | Hybrid              | `hide_person`: Pi resolves the person via `searchPeople` (includeHidden:true for unhide); Gallery owns the `person.update` plan with `{ isHidden }` payload. Durable disambiguation; container-noun guard prevents stealing album/space prompts. `managePeople` write-scope required.                                                                                                                                                                                                                                    |
| Merge people                     | Hybrid              | `merge_people`: Pi resolves both people via `searchPeople` (two-stage durable disambiguation: source then keep); Gallery owns the `person.merge` plan (High risk, irreversible — faces reassigned, source deleted). Same-person guard declines self-merge. `managePeople` write-scope required. Irreversibility disclosed in success copy.                                                                                                                                                                               |
| Answer album/library questions   | Open read flow      | Pi may use read/search tools and answer without write planning.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Summarize a proposed plan        | Strict              | Summary must be generated from a persisted plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Revise a plan                    | Strict              | Revision must replace a persisted plan and never apply it.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| “Best photos” curation           | Hybrid              | Open bounded curation; strict resulting album, favorite, archive, tag, or metadata plan.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Visual cleanup                   | Hybrid              | `visual_cleanup`: Pi resolves a bounded source, derives a quality-filtered handle (`maxSharpness`/`maxBrightness`/`maxQuality`), then feeds it into a reviewable, recoverable `asset.trash` proposal owned by Gallery.                                                                                                                                                                                                                                                                                                   |
| Share links                      | Hybrid              | `share_assets`: Pi resolves a bounded source and proposes a `shareLink.create` op (High risk; OUTWARD-FACING). The `createSharedLinks` write-scope is granted **only in the LocalPowerUser preset** (off in Careful/VisualOrganizer); each link is a reviewable plan the user must approve before it is created. The eval preset (VisualOrganizer) keeps it off, so no link is ever created in tests or evals. Optional payload: expiry, password, hide-metadata.                                                        |
| Album share links                | Hybrid              | `share_album`: Pi resolves a named album and proposes a `shareLink.createAlbum` op (High risk; OUTWARD-FACING). Requires the word "album" in the prompt to avoid collision with `share_assets`. The `createSharedLinks` write-scope defaults false in every preset — links are never created in tests or evals; the workflow is propose-only. Optional payload: expiry, password, hide-metadata.                                                                                                                         |
| Share an album with people       | Strict              | `manage_album_access`: Resolve album + users (durable two-stage disambiguation); guard owner/already-member; propose `album.addUsers` or `album.removeUsers` plan. `shareAlbums` write-scope required.                                                                                                                                                                                                                                                                                                                   |
| Change an album member's role    | Strict              | `change_album_member_role`: Resolve album + user (durable two-stage disambiguation); guard owner/no-op/non-member; propose `album.updateUserRole` plan. Requires "album" in the prompt; declines space targets (those belong to `change_member_role`). `shareAlbums` write-scope required.                                                                                                                                                                                                                               |
| Recent upload organization       | Strict when bounded | The source resolver maps “uploaded/added/recent uploads” to upload-date filters (`createdAfter`/`createdBefore`); the bounded handle then drives a deterministic source workflow (archive/tag/album/etc.).                                                                                                                                                                                                                                                                                                               |
| Screenshot/document cleanup      | Hybrid              | The "screenshots" source resolves tag-first to the `Screenshots` / `Auto/Screenshots` classification tag, then the verb's workflow (archive/trash/space) owns the plan; if the tag isn't configured the resolver discloses and hands off (no visual heuristic). Other metadata/OCR-identifiable cleanup can be strict; visual-only cleanup remains open discovery before plan creation.                                                                                                                                  |
| Story/memory albums              | Hybrid              | Open source resolution until a date/person/place source is concrete, then strict album plan creation.                                                                                                                                                                                                                                                                                                                                                                                                                    |

<!-- generated:workflows:start -->

### Implemented strict/hybrid workflows

Generated from `agent-runner/src/strict-workflows/manifest.generated.json`. Do not edit by hand; run `pnpm --dir server sync:agent-capabilities`.

| Kind                         | Flow   | Required read tools                                            | Plan tool                           |
| ---------------------------- | ------ | -------------------------------------------------------------- | ----------------------------------- |
| `create_recent_trip_album`   | Strict | `findTripCandidates`                                           | `proposeAlbumFromSelection`         |
| `rename_or_describe_album`   | Strict | `listAlbums`                                                   | `proposeAlbumOperations`            |
| `delete_album`               | Strict | `listAlbums`                                                   | `proposeAlbumOperations`            |
| `delete_space`               | Strict | `listSpaces`                                                   | `proposeAlbumOperations`            |
| `set_album_cover`            | Strict | `listAlbums`, `readAlbum`                                      | `proposeAlbumOperations`            |
| `add_photos_to_album`        | Hybrid | `listAlbums`, `resolveAssetSearchFilters`, `searchAssets`      | `proposeAlbumOperations`            |
| `move_photos_between_albums` | Hybrid | `listAlbums`, `resolveAssetSearchFilters`, `searchAssets`      | `proposeAlbumOperations`            |
| `remove_photos_from_album`   | Hybrid | `listAlbums`, `resolveAssetSearchFilters`, `searchAssets`      | `proposeAlbumOperations`            |
| `manage_space_assets`        | Hybrid | `listSpaces`, `resolveAssetSearchFilters`, `searchAssets`      | `proposeAddAssetsToSpaceFromSearch` |
| `archive_assets`             | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeAssetBatchFromSelection`    |
| `cleanup_duplicates`         | Hybrid | `listDuplicateGroups`                                          | `proposeAlbumOperations`            |
| `visual_cleanup`             | Hybrid | `resolveAssetSearchFilters`, `searchAssets`, `curateSelection` | `proposeAlbumOperations`            |
| `trash_assets`               | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeAlbumOperations`            |
| `share_assets`               | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeAlbumOperations`            |
| `share_album`                | Hybrid | `listAlbums`                                                   | `proposeAlbumOperations`            |
| `restore_assets`             | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeAlbumOperations`            |
| `favorite_assets`            | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeAssetBatchFromSelection`    |
| `tag_assets`                 | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeAssetBatchFromSelection`    |
| `untag_assets`               | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeAlbumOperations`            |
| `update_asset_metadata`      | Hybrid | `resolveAssetSearchFilters`, `searchAssets`, `resolveLocation` | `proposeAssetBatchFromSelection`    |
| `rotate_assets`              | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeAssetBatchFromSelection`    |
| `crop_assets`                | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeAssetBatchFromSelection`    |
| `adjust_assets`              | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeAssetBatchFromSelection`    |
| `flip_assets`                | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeAssetBatchFromSelection`    |
| `stack_assets`               | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeAssetBatchFromSelection`    |
| `unstack_assets`             | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeAssetBatchFromSelection`    |
| `rename_or_describe_space`   | Strict | `listSpaces`                                                   | `proposeAlbumOperations`            |
| `rename_person`              | Hybrid | `searchPeople`                                                 | `proposeAlbumOperations`            |
| `set_person_birthdate`       | Hybrid | `searchPeople`                                                 | `proposeAlbumOperations`            |
| `lock_assets`                | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeAssetBatchFromSelection`    |
| `hide_person`                | Hybrid | `searchPeople`                                                 | `proposeAlbumOperations`            |
| `merge_people`               | Hybrid | `searchPeople`                                                 | `proposeAlbumOperations`            |
| `manage_album_access`        | Strict | `listAlbums`, `readAlbum`, `searchUsers`                       | `proposeAlbumOperations`            |
| `change_album_member_role`   | Strict | `listAlbums`, `readAlbum`, `searchUsers`                       | `proposeAlbumOperations`            |
| `manage_space_members`       | Strict | `listSpaces`, `readSpace`, `searchUsers`                       | `proposeAlbumOperations`            |
| `change_member_role`         | Strict | `listSpaces`, `readSpace`, `searchUsers`                       | `proposeAlbumOperations`            |
| `create_album_from_source`   | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeAlbumFromSelection`         |
| `create_space_from_source`   | Hybrid | `resolveAssetSearchFilters`, `searchAssets`                    | `proposeSpaceFromSearch`            |

<!-- generated:workflows:end -->

## Core Capability Matrix

| Capability                       | User prompt examples                                                                                                   | Tier                                         | Current path                                                                                                                                                                                                                                                             | Required user-visible behavior                                                                                                                                                                                                     | Regression scenarios                                                                                                                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create event or trip album       | “Make an album of my Berlin photos from last weekend.”                                                                 | Solid now                                    | Search date/location, optionally read metadata/previews, propose `album.create` + `album.addAssets`.                                                                                                                                                                     | Shows a plan with destination album, representative thumbnails, selected count, and no direct write before apply.                                                                                                                  | Date window with results; date window with no results; create-only if no matching assets; plan apply keeps chat open.                                                                                                                                             |
| Add photos to existing album     | “Add my newest 20 photos to Family.”                                                                                   | Solid now                                    | `listAlbums`, `readAlbum` if needed, `searchAssets`, propose `album.addAssets`.                                                                                                                                                                                          | Resolves album by visible album list, asks/clarifies on ambiguous album names, avoids duplicate asset adds where possible.                                                                                                         | Unique album match; ambiguous album names; album already contains some assets; empty search result.                                                                                                                                                               |
| Remove wrong photos from album   | “Remove screenshots from this album.”                                                                                  | Solid now for metadata-identifiable cases    | `readAlbum`, `readAssetMetadata`, optionally `readAssetPreviews`, propose `album.removeAssets`.                                                                                                                                                                          | Explains what will be removed, shows reversible plan before apply, never deletes assets.                                                                                                                                           | Metadata-only screenshot match; preview-required visual match; all assets excluded; no matching assets.                                                                                                                                                           |
| Rename or describe album         | “Rename this album to Berlin Weekend and add a description.”                                                           | Solid now                                    | `listAlbums`, propose `album.updateDetails`.                                                                                                                                                                                                                             | Shows changed fields inline and preserves unspecified fields.                                                                                                                                                                      | Rename only; description only; ambiguous album name; stale album id during apply.                                                                                                                                                                                 |
| Set album cover                  | “Pick a better cover for this album.”                                                                                  | Solid now when previews allowed              | `readAlbum`, `readAssetPreviews`, propose `album.setCover`.                                                                                                                                                                                                              | Shows chosen cover thumbnail and lets user change plan through chat or exclude operation.                                                                                                                                          | Preview permission denied; album has no assets; album already has requested cover; set cover in a new dependent album plan.                                                                                                                                       |
| Share an album with people       | “Share the Family album with Alex.” / “Give mom viewer access to the Trip album.” / “Remove Sam from the Beach album.” | Solid now (shareAlbums scope)                | `listAlbums`, `readAlbum` (members + owner), `searchUsers`, propose `album.addUsers` or `album.removeUsers`. Default role viewer; “as editor” → editor.                                                                                                                  | Shows who is added/removed, their role, and the album before apply; never grants access without plan approval; declines public-link share (that is `share_album`).                                                                 | Unique album + user; ambiguous album/user (durable disambiguation); already-a-member add no-op; removing a non-member; owner target blocked; requester not the album owner blocked; `shareAlbums` ungranted blocks.                                               |
| Change an album member's role    | “Make Alex an editor on the Family album.” / “Change Sam’s role to viewer on the Trip album.”                          | Solid now (shareAlbums scope)                | `listAlbums`, `readAlbum` (members), `searchUsers`, propose `album.updateUserRole`. Requires “album” in the prompt; declines space targets.                                                                                                                              | Shows the current and proposed role and the album before apply.                                                                                                                                                                    | Promote/demote; ambiguous album/user; no-op same role; non-member; owner role blocked; “…in the Family space” routes to `change_member_role`; `shareAlbums` ungranted blocks.                                                                                     |
| Create shared space              | “Create a Family space for these photos.”                                                                              | Solid now                                    | Search/read candidates, propose `space.create` + optional `space.addAssets`.                                                                                                                                                                                             | Presents the new space name, description/color, and selected assets before apply.                                                                                                                                                  | Create empty space; create and add assets; dependent temporary target validation.                                                                                                                                                                                 |
| Add/remove photos in space       | “Add these vacation photos to the Family space.”                                                                       | Solid now                                    | `listSpaces`, `readSpace`, search/read candidates, then propose `space.addAssets` or `space.removeAssets`.                                                                                                                                                               | Makes it clear this changes space membership, not the original library asset.                                                                                                                                                      | Unique space match; ambiguous space names; no assets selected; already-in-space assets; remove without deleting; stale space id.                                                                                                                                  |
| Update space details             | “Rename Family to Family 2026.”                                                                                        | Solid now                                    | `listSpaces`, `readSpace` if needed, propose `space.updateDetails`.                                                                                                                                                                                                      | Shows changed fields and leaves assets/members untouched.                                                                                                                                                                          | Rename only; color/description update; ambiguous space name; stale space id during apply.                                                                                                                                                                         |
| Add or remove space members      | “Invite Alex to the Family space.”                                                                                     | Solid now                                    | `listSpaces`, `searchUsers`, `readSpace`, propose `space.addMembers` or `space.removeMembers`.                                                                                                                                                                           | Shows who will be added or removed, their role, and the target space before apply.                                                                                                                                                 | Unique user match; ambiguous user query; user already a member; removing non-member; removing self is rejected; last-owner removal blocked.                                                                                                                       |
| Change space member roles        | “Make Alex an editor in Family.”                                                                                       | Solid now                                    | `listSpaces`, `searchUsers`, `readSpace`, propose `space.updateMemberRole`.                                                                                                                                                                                              | Shows the current and proposed role and requires plan approval before changing permissions.                                                                                                                                        | Viewer to editor; editor to viewer; no-op role change; ambiguous user; demoting self is rejected; last-owner demotion blocked.                                                                                                                                    |
| People-based organization        | “Add photos of Alex to a Family album.”                                                                                | Solid now                                    | `resolveAssetSearchFilters` for person/space names, `searchAssets` with `personIds` or `spaceId` + `spacePersonIds`, then propose album/space/tag/favorite/archive/rotate operations.                                                                                    | Clarifies ambiguous people, shows selected assets before apply, and keeps chat open after apply.                                                                                                                                   | Global person; shared-space person; same-name ambiguity; no matching assets; mixed people + tag + date filters.                                                                                                                                                   |
| Natural-language filtered search | “Find photos of Alex in Berlin from last summer that are not in any album.”                                            | Solid now                                    | `resolveAssetSearchFilters` for names, then `searchAssets` with metadata, smart, OCR, description, or filename mode plus structured filters and pagination.                                                                                                              | Shows approval when needed, summarizes bounded results, asks to narrow large result sets, and feeds selection handles or declarative sources into reviewable plans.                                                                | People + place + date + unalbumed; 5-star videos by country; OCR invoice screenshots; smart search inside a Family space; Sony camera date filters.                                                                                                               |
| Mark favorites                   | “Favorite the best photos from Portugal.”                                                                              | Constrained now                              | Search by metadata and/or previews, propose `asset.setFavorite`.                                                                                                                                                                                                         | If “best” is subjective, activity preview should show inspection and the plan should be easy to review visually.                                                                                                                   | Metadata-only favorite request; preview-based curation; permission denied for previews; large candidate set.                                                                                                                                                      |
| Archive assets                   | “Archive old screenshots from 2024.”                                                                                   | Solid now for metadata-identifiable cases    | Search date/media/tag metadata, propose `asset.setArchive`.                                                                                                                                                                                                              | States that assets move to archive, not trash/delete, and shows affected count.                                                                                                                                                    | Exact metadata filters; no matches; mixed photos/videos; user revises plan to exclude items.                                                                                                                                                                      |
| Move photos to the Locked folder | “Move my passport scans to the locked folder.” / “Lock these photos.” / “Put these in my private folder.”              | Solid now (lockAssets; LocalPowerUser)       | `lock_assets`: resolve a bounded source, propose a High-risk `asset.setVisibility(locked)`. Lock-only (unlock deferred).                                                                                                                                                 | States photos move to the private Locked folder (reversible in-app); requires a lock/locked-folder/private-folder cue so it never steals `archive` or `hide <person>`; declines subjective sources.                                | Lock / move-to-locked / private-folder cues; “archive these” stays `archive_assets`; “hide Alex” stays `hide_person`; subjective declines; `lockAssets` ungranted blocks (propose-blocked outside LocalPowerUser).                                                |
| Add or remove tags               | “Tag these Berlin photos as Travel.”                                                                                   | Solid now                                    | Search/read metadata, propose `asset.addTag` or `asset.removeTag`.                                                                                                                                                                                                       | Shows tag name or existing tag id resolution and selected assets.                                                                                                                                                                  | New tag by name; existing tag removal; ambiguous tag names if exposed; invalid payload with both tag id and name rejected.                                                                                                                                        |
| Batch asset metadata edits       | “Set the description on the 5 newest photos to Test batch.”                                                            | Solid now for explicit supported fields      | Search or inspect the target set, then propose `asset.updateMetadata` through `proposeAssetBatchFromSearch` or `proposeAlbumOperations`. Supports description, rating, date/time, timezone, explicit latitude/longitude, and place names resolved via `resolveLocation`. | Shows field-level before/after metadata, selected count, representative assets, and coordinate warnings before apply; resolves place names to coordinates via `resolveLocation` (ambiguous names ask which place).                 | Description update; clear rating; absolute date/time; relative timestamp shift; timezone update; explicit coordinates; place name resolves to coordinates; ambiguous place name asks which; latitude without longitude asks for longitude; apply keeps chat open. |
| Rotate images                    | “Rotate the sideways photos clockwise.”                                                                                | Constrained now                              | Read previews/originals if allowed, propose `asset.rotate`.                                                                                                                                                                                                              | Shows thumbnails and rotation direction; only supports valid rotation angles.                                                                                                                                                      | Valid 90/180/270 angle; unsupported angle rejected; non-image assets excluded; preview permission denied.                                                                                                                                                         |
| Crop images                      | “Crop my newest photo to 100, 100, 800, 600.”                                                                          | Constrained now (explicit geometry)          | Resolve a source, parse explicit x/y/width/height, propose a batch `asset.crop` (ImageEditBatch; reversible via `removeAssetEdits`); image-only.                                                                                                                         | Shows the crop geometry + selected count; asks for x/y/width/height when absent and never guesses pixel coordinates.                                                                                                               | Comma + labeled geometry forms; no-geometry asks; rotate phrasing stays `rotate_assets`; out-of-bounds geometry rejected by the editor; coordinate crops are not reliably routed by the live LLM agent (OQ-F1) — verified at L1/L2.                               |
| Adjust photo look                | “Brighten my last 10 photos.” / “Make my Berlin photos pop.” / “Auto-enhance my newest 5.”                             | Solid now                                    | `adjust_assets`: resolve a metadata-describable source, parse tonal verb + intensity (brightness/contrast/saturation levels or autoEnhance), propose a batch `asset.adjust`. Conflicting directions (brighten + darken) prompt for clarification.                        | Shows adjustment type and selected count; declines subjective sources and conflicting instructions; rotate/crop/flip verbs are never stolen.                                                                                       | Brighten/darken with intensity; contrast increase/decrease; saturation/vivid/desaturate; auto-enhance; combined adjustments; conflicting brightness asks; no source asks.                                                                                         |
| Flip images (mirror H/V)         | “Flip this horizontally.” / “Mirror these.” / “Flip these vertically.”                                                 | Solid now                                    | `flip_assets`: resolve a metadata-describable source, parse horizontal/vertical axis (default horizontal), propose a batch `asset.flip`. “Upside down” deferred to `rotate_assets` (180°).                                                                               | Shows axis and selected count; never steals rotate/crop verbs; “upside down” always routes to rotate.                                                                                                                              | Horizontal (explicit + default); vertical; “top-to-bottom”; “upside down” stays rotate; subjective source declines.                                                                                                                                               |
| Trash photos (reversible)        | “Trash my newest 20 photos.” / “Delete my 2024 screenshots.”                                                           | Solid now                                    | Resolve a bounded source, propose a High-risk `asset.trash` (`deleteAll(force:false)` → recoverable Trash); `trashAssets` write-scope required.                                                                                                                          | States the count, that it moves to the recoverable Trash (not permanent), and never hard-deletes; declines album-level deletion and subjective sources.                                                                            | Bounded source; empty selection asks; album-level “delete the X album” declines; subjective declines; write-scope ungranted blocks; never `force:true`.                                                                                                           |
| Restore from trash (reversible)  | “Restore my newest 20 from trash.” / “Recover what I just trashed.”                                                    | Solid now                                    | Resolve a trashed-asset source (`isTrashed:true` injected), propose a Low-risk, reversible `asset.restore` (moves assets back to the library); `trashAssets` write-scope required.                                                                                       | States the count and that assets move back to the library from Trash; declines non-restore verbs.                                                                                                                                  | Bounded trashed source; nothing in trash (direct answer); does not steal plain trash/untag verbs; write-scope ungranted blocks.                                                                                                                                   |
| Duplicate cleanup                | “Clean up my duplicate photos.”                                                                                        | Solid now (metadata keep-rule)               | `listDuplicateGroups`, keep one per group (favorite > rating > sharpness > resolution > age > id), propose `asset.trash` over the non-keepers.                                                                                                                           | Discloses the keep rule + counts; keeper is never trashed; reversible; review before apply.                                                                                                                                        | No duplicate groups (direct answer, no plan); keeper preserved; tie-breaks deterministic; large libraries capped by `maxGroups`.                                                                                                                                  |
| Delete an album                  | “Delete the Test album.” / “Remove the Beach album.”                                                                   | Solid now (deleteContainers; LocalPowerUser) | `delete_album`: resolve the album by name (durable disambiguation), propose a High-risk, irreversible `album.delete`. Photos are NOT deleted — only the album container.                                                                                                 | States the album is permanently removed but the photos stay in the library; declines photo-deletion phrasing (“delete the photos in X” is not this); `deleteContainers` ungranted blocks (propose-blocked outside LocalPowerUser). | Unique album; ambiguous album (disambiguation); photo-deletion phrasing declined; “…space” routes to `delete_space`; bulk / multi-match declined; stale album id at apply surfaces as a visible failure.                                                          |
| Delete a space                   | “Delete the Family space.” / “Remove the Trip space.”                                                                  | Solid now (deleteContainers; LocalPowerUser) | `delete_space`: resolve the space by name (durable disambiguation), propose a High-risk, irreversible `space.delete`. The shared space + membership are removed; photos stay in members’ libraries.                                                                      | States the space is permanently removed but photos stay in members’ libraries; declines photo-deletion phrasing; requires owner-level permission server-side; `deleteContainers` ungranted blocks.                                 | Unique space; ambiguous space; photo-deletion phrasing declined; “…album” routes to `delete_album`; non-owner apply blocked server-side; stale space id at apply surfaces as a visible failure.                                                                   |
| Answer album/library questions   | “How many photos are in this album?”                                                                                   | Solid now                                    | `listAlbums`, `readAlbum`, optionally `readAssetMetadata`.                                                                                                                                                                                                               | Gives a direct answer and cites the album or search scope in plain language.                                                                                                                                                       | Album count; album date range; no album found; ambiguous album name.                                                                                                                                                                                              |
| Summarize a proposed plan        | “What exactly will this plan change?”                                                                                  | Solid now                                    | `summarizePlan`.                                                                                                                                                                                                                                                         | Produces a concise human summary without raw operation ids unless details are requested.                                                                                                                                           | Whole-plan summary; risk-focused summary; summary after revision; missing plan id validation.                                                                                                                                                                     |
| Revise a plan                    | “Actually exclude videos and keep only 30 photos.”                                                                     | Solid now                                    | `reviseProposedOperations` with previous plan id and replacement operations.                                                                                                                                                                                             | Replaces the displayed plan, keeps prior chat context, and does not apply either plan until user approval.                                                                                                                         | Remove subset; add dependent operation; invalid temporary target; apply revised plan then continue chat.                                                                                                                                                          |
| Share photos as a link           | “Share these photos as a link that expires in 7 days.”                                                                 | Solid now (LocalPowerUser only)              | Resolve a bounded source, propose a High-risk, OUTWARD-FACING `shareLink.create` (individual-asset link; optional expiry/password/hide-metadata); `createSharedLinks` granted only in LocalPowerUser.                                                                    | States it creates a public link, shows expiry/password/metadata settings, and requires plan approval before the link is created; blocked (with disclosure) when the scope is ungranted.                                            | Link with expiry; with password; hide-metadata; empty selection asks; past expiry rejected; scope ungranted blocks; never auto-applies.                                                                                                                           |

## High-Value Constrained Capabilities

These are attractive user workflows, but they need clear guardrails because the
current tool surface does not provide every specialized classifier or unbounded
semantic search.

| Capability                  | Why users want it                                             | Current feasibility                                                                                                                                                                                                              | Guardrail                                                                                                                              |
| --------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| “Best photos” curation      | Users want the assistant to pick highlights.                  | Solid now for bounded sources using ratings, favorites, metadata, previews, and available objective quality scores; suggested highlight curation remains bounded and reviewable.                                                 | Ask for a scope when broad: album, shared space, date range, search/filter, selection, or max count.                                   |
| Visual cleanup              | Remove blurry, dark, duplicate-looking, or irrelevant photos. | Solid now for bounded sources using objective quality scoring (`sharpness`, `brightness`, and `quality`) through a derived quality-filtered handle; resulting trash proposals are reviewable and recoverable.                    | Treat as suggestions; show thumbnails; avoid auto-apply.                                                                               |
| Recent upload organization  | “Organize everything I uploaded today.”                       | Solid now: the source resolver bounds “uploaded/added/recent uploads” by upload date (`createdAfter`/`createdBefore`) and feeds the strict source workflows.                                                                     | Chunk large result sets and explain any limit.                                                                                         |
| Screenshot/document cleanup | Archive screenshots or documents.                             | Solid for screenshots when an `Auto/Screenshots` classification category is configured (the "screenshots" source resolves tag-first); discloses and hands off when untagged; still weak for visual-only detection without a tag. | Tag-first resolution (no `make:null` heuristic — it would catch downloads/scans/exports); ask for confirmation on visual-only matches. |
| Story/memory albums         | “Make a birthday highlights album.”                           | Works when date/location/album context is known; weak for people/event recognition.                                                                                                                                              | Ask for date/person/album context if semantic cues are not searchable.                                                                 |

## Needs New MCP Tool

Next expansion candidates: image straightening and export/download workflows.
(Reversible trash, metadata-only duplicate cleanup, objective image quality
filters, forward geocoding for place-name location edits, explicit-geometry
crop, sharing, tonal adjustments (`asset.adjust`), flip (`asset.flip`),
album user-sharing (`manage_album_access` / `change_album_member_role`),
Locked-folder visibility (`lock_assets` / `asset.setVisibility`), and reviewed
container deletion (`delete_album` / `delete_space`) have
all shipped — see the Flow Ownership Matrix. Sharing ships via `share_assets` /
`shareLink.create`; it is High risk, OUTWARD-FACING, and the `createSharedLinks`
scope is granted only in the LocalPowerUser preset (off in Careful/VisualOrganizer).
The eval preset keeps it off, so no link is created in any test or eval; live
links are always reviewable plans the user approves first.)

| Capability                | Missing capability                                                                  | Candidate tool direction                              |
| ------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Straighten images         | No straighten/deskew op (rotate+crop is the manual workaround; no auto-level).      | Separate image-edit operation with preview artifacts. |
| Export/download workflows | No direct operation plan for exports or downloads (sharing now ships propose-only). | Export/download tools with explicit privacy review.   |

## Out Of Scope Until Policy Changes

- Direct mutation MCP tools that bypass Gallery plan review.
- Silent deletion or irreversible destructive changes. (Carve-out: a **reviewed**,
  propose-only container delete — `delete_album` / `delete_space` — is in scope: it is
  irreversible for the container but **preserves the photos**, is High-risk, gated behind
  the LocalPowerUser-only `deleteContainers` scope, and is only applied after explicit
  plan approval. Irreversible deletion of the underlying **photos** remains out of scope.)
- Exposing provider secrets, runner tokens, prompts, or raw original files in
  chat.
- Third-party MCP server access through this first-party runner path.
- Fully autonomous background library reorganization without a user-reviewed
  plan.

## Test Matrix

Every “solid now” capability should have at least one assistant-flow regression
that proves the user-level behavior, not only DTO validation.

| Layer               | Required coverage                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| MCP contract        | Valid examples parse; common malformed calls return actionable correction hints; approval retry uses only `toolCallId`.                          |
| Runner/session flow | User message appears immediately; assistant streams; read approval blocks; approval resumes runner; plan appears; apply does not terminate chat. |
| Plan review         | Destination grouping, selected counts, representative thumbnails, operation toggles, inline field edits, technical details disclosure.           |
| Apply flow          | Applied-plan card appears in transcript; partial success/failure is visible; user can continue chatting in same session.                         |
| Permissions         | Careful blocks previews/originals; visual organizer allows previews; local power user allows broader access; approval behavior matches settings. |
| Scale               | Bounded searches, large candidate counts, thumbnail strip caps, no eager rendering of hundreds/thousands of assets.                              |
| Ambiguity           | Duplicate album names, ambiguous “best” prompts, no matches, stale targets, permission denial, provider/model failures.                          |

## Recommended Product Smoke Prompts

Use these prompts as manual and automated acceptance scenarios:

1. “Create an album called Today’s Test with the 5 newest photos.”
2. “Add the remaining photos that are not already in the Family album.”
3. “Remove screenshots from this album.”
4. “Pick a cover photo for this album.”
5. “Create a Family space and add these photos.”
6. “Add Alex as an editor to the Family space.”
7. “Remove Alex from the Family space.”
8. “Archive old screenshots from 2024.”
9. “Tag my Berlin photos as Travel.”
10. “Rotate these sideways photos clockwise.”
11. “What will this plan change?”
12. “Actually exclude videos and show me the revised plan.”
13. “Find photos of Alex in Berlin from last summer that are not in any album.”
14. “Create an album from 5-star videos from Japan.”
15. “Find screenshots from 2024 that mention invoices.”
16. “Add beach sunset photos from the Family space to a new album.”
17. “Find photos taken with my Sony camera in May.”
18. “Set the description on the 5 newest photos to Test batch.”
19. “Clear the rating from this album.”
20. “Shift these scanned photos forward by 2 hours.”
21. “Set these photos to latitude 48.8566 and longitude 2.3522.”
22. “Set these photos to Paris.”
23. “Suggest 5 highlights from this album and make an album called Highlights.”
24. “Favorite the best 3 photos from last weekend.”
25. “Pick a cover from this album.”
26. “Pick the best photos from my library.”
27. “Suggest 20 highlights from this album.”
28. “Suggest highlights from last weekend.”
29. “Create an album for my recent trip to USA.”
30. “Restore my newest 20 photos from trash.”
31. “Trash my screenshots.”
32. “Crop my newest photo to 100, 100, 800, 600.”
33. “Share these photos as a link that expires in 7 days.” (LocalPowerUser preset)
34. “Brighten my last 10 photos.”
35. “Make my Berlin photos more vivid and add a bit of contrast.”
36. “Auto-enhance my newest 5 photos.”
37. “Flip these horizontally.”
38. “Share the Family album with Alex as a viewer.”
39. “Make Alex an editor on the Family album.”
40. “Move my passport scans to the locked folder.”
41. “Delete the Test album.” (LocalPowerUser preset)
42. “Delete the Family space.” (LocalPowerUser preset)

## Next Steps

1. Turn the “solid now” rows into an automated assistant regression suite.
2. Add prompt/docs examples for each smoke prompt so smaller models learn the
   intended tool sequence.
3. **Phase 2 shipped (16 strict/hybrid workflows total).** On top of the Phase-1
   set, six new workflows ship — `update_asset_metadata`, `remove_photos_from_album`,
   `manage_space_assets`, `create_space_from_source`, `rotate_assets`, and
   `set_album_cover` — each with L1 (component) + L3 (live, read-only) eval coverage.
4. **The shared source-resolver now resolves named entities + direct metadata.** It
   maps people/tags/albums/cameras through the real `resolveAssetSearchFilters` tool
   (structured args, never a free-text `query`) and places/ratings/favorites/
   visibility straight into `searchAssets` filters; ambiguous or not-found entities
   ask for input rather than guess. So every source-based workflow accepts entity
   sources (e.g. “archive my Berlin photos”, “tag photos of Alex as Family”).
5. **Phase 3 shipped (17 strict/hybrid workflows total).** `untag_assets` adds tag
   removal (`asset.removeTag`, resolving the tag name to an id) on a resolved
   source, completing the “Add or remove tags” capability; the shared source
   resolver now recognizes upload-date phrasing (“uploaded today”, “recent
   uploads”) and bounds it by `createdAfter`/`createdBefore` rather than capture
   date, so every source workflow accepts upload-dated sources. Highlight curation
   intentionally stays on the existing `curateSelection` tool + LLM path — a
   deterministic workflow would intercept “best N” prompts and regress
   preview-assisted curation — so no `curate_highlights` workflow was added.
6. **Trash + duplicate cleanup shipped (19 strict/hybrid workflows total).**
   `trash_assets` moves a resolved source to the recoverable Trash via a new
   High-risk, reversible `asset.trash` operation (`deleteAll(force:false)`; never
   hard-deletes; `trashAssets` write-scope granted only in VisualOrganizer +
   LocalPowerUser). `cleanup_duplicates` reads a new scrubbed `listDuplicateGroups`
   tool (CLIP-embedding groups), keeps one asset per group by a deterministic rule
   (favorite > rating > resolution > age > id), and proposes trashing the rest.
   Both were verified with a propose-only live L3 (the read-only audit confirms no
   plan is applied). This closes the “Trash/delete” and “Duplicate/similar-photo
   cleanup” new-tool gaps.
7. Space disambiguation (“which space/user did you mean?”) now offers a **durable
   candidate continuation** — `manage_space_members`, `change_member_role`,
   `rename_or_describe_space`, and `manage_space_assets` present a numbered
   candidate list and resolve the next-turn pick (“the first one” / a name / a
   number) via the shared `candidate-disambiguation` helper, reusing the trip
   workflow's continuation protocol (10-min TTL). Subjective/visual sources remain
   out of scope (they hand off); place-name → coordinate geocoding now resolves via
   `resolveLocation`.
8. **Roadmap phases B–F shipped (23 strict/hybrid workflows total).** On top of the
   trash/duplicate set: **B** — a `resolveLocation` forward-geocoder read tool +
   place-name location edits in `update_asset_metadata`. **C** — an `isTrashed`
   search filter, a reversible `asset.restore` op, and the `restore_assets`
   workflow. **D** — durable space/user disambiguation (item 7). **E** — the
   resolver maps "screenshots" tag-first to the `Screenshots` / `Auto/Screenshots`
   classification tag (discloses + hands off when untagged; no `make:null`
   heuristic). **F** — a reversible explicit-geometry `asset.crop` op + `crop_assets`
   workflow, and an outward-facing `shareLink.create` op + `share_assets` workflow
   gated behind a new `createSharedLinks` write-scope (granted only in LocalPowerUser;
   off in the eval preset). Each routing/op change carries L1 (component) + propose-
   only L3 (live, read-only; the audit confirms no plan is applied) coverage, except
   crop, whose coordinate-geometry intent is not reliably routed by the live LLM
   agent (OQ-F1) and is asserted at L1/L2 only. A live L3 run against the personal
   instance also surfaced and fixed a real bug — `asset.crop` was missing from the
   `proposeAssetBatch` tool's action union and its summary/target/payload/risk
   mappings, so the workflow could classify but not propose.
9. **Library reorg + sharing + people management shipped (31 strict/hybrid
   workflows total).** `move_photos_between_albums` owns a compound
   `album.removeAssets` + `album.addAssets` plan; `stack_assets` / `unstack_assets`
   add `asset.stack` / `asset.unstack` (server auto-selects the stack cover;
   `manageStacks` write-scope, granted in VisualOrganizer + LocalPowerUser);
   `share_album` proposes a `shareLink.createAlbum` op (High risk, OUTWARD-FACING;
   `createSharedLinks` default-off in every preset → propose-only; requires the
   word "album" to avoid colliding with `share_assets`); and a people-management
   set — `rename_person`, `set_person_birthdate`, `hide_person` (`person.update`
   with name / birthDate / isHidden), plus `merge_people` (`person.merge`, High
   risk, irreversible — faces reassigned, source deleted). People resolve via a
   new scrubbed `searchPeople` read tool with durable two-stage disambiguation;
   `managePeople` write-scope. Each carries L1 + propose-only L3 coverage.
10. **Image adjustments shipped (33 strict/hybrid workflows total).** `adjust_assets`
    proposes a reversible `asset.adjust` op — brightness / contrast / saturation as
    named signed levels (slight/moderate/strong) or a one-click auto-enhance — and
    `flip_assets` proposes a reversible `asset.flip` (horizontal/vertical mirror;
    "upside down" defers to `rotate_assets` as a 180° rotation). Both are
    `editAssets`-scoped (granted in VisualOrganizer + LocalPowerUser), Low risk,
    and ImageEditBatch-targeted, rendered via sharp (`modulate`/`linear`/`normalise`)
    as non-destructive `asset_edit` rows. Image-edit ops (crop/adjust/flip) now show
    a **before/after preview on the plan card** via an ephemeral, non-persisting
    `POST /assets/:id/edits/preview` render, so users iterate on the look through
    `reviseProposedOperations` before applying. Verified at L1 (100%) + a live
    propose-only L3 (89/89, read-only audit clean) against the personal-clone with a
    local gemma4 model; because the intents are verb-driven they route live, unlike
    crop's coordinate-geometry intent (OQ-F1). This ships the matrix's #1
    "Edits beyond rotation" new-tool candidate; **straighten** (arbitrary-angle
    rotate + auto-crop) and export/download remain the open image-edit follow-ups.
