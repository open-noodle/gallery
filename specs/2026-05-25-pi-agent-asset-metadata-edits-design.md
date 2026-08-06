# Pi Agent Asset Metadata Edits Design

Status: draft design
Date: 2026-05-25
Branch: `explore/pi-agent-brainstorm`

## Purpose

Pi can already search assets, inspect metadata, and create reviewable plans for
album, space, tag, favorite, archive, and rotation workflows. The next useful
capability gap is batch asset metadata cleanup: scanned-photo dates, timezone
fixes, descriptions, ratings, and explicit GPS coordinate corrections.

Users should be able to ask:

> Set the date on these scanned photos to June 1998.

or:

> Add "Berlin trip" as the description for these photos.

and receive a reviewable plan that shows what metadata will change before
anything is applied. The assistant must not mutate assets directly through MCP;
metadata writes remain behind Gallery plan review and user approval.

## Current State

Gallery already supports bulk asset updates through `AssetService.updateAll`.
The existing path can update:

- `description`
- `rating`
- `dateTimeOriginal`
- `dateTimeRelative`
- `timeZone`
- `latitude` and `longitude`

When coordinates are updated, Gallery reverse-geocodes those coordinates and
stores city, state, and country labels. Gallery does not currently expose a
forward geocoder that resolves place names such as "Paris" into coordinates.

The agent operation surface already supports:

- `asset.setFavorite`
- `asset.setArchive`
- `asset.addTag`
- `asset.removeTag`
- `asset.rotate`

Those operations should not be folded into metadata edits. This design covers
descriptive EXIF/user metadata only.

## Goals

- Add a reviewable `asset.updateMetadata` operation type.
- Let Pi propose metadata updates for explicit assets, selection handles,
  previous searches, and declarative search sources.
- Reuse the existing asset update behavior rather than creating a parallel write
  implementation.
- Show user-facing before/after metadata in plan review before apply.
- Keep location edits explicit: v1 accepts coordinates only, not place names.
- Keep favorite, archive, tag, and rotate operations on their existing operation
  types.
- Add a dedicated `updateAssetMetadata` write-scope flag so metadata writes can
  be controlled independently from image edits.
- Keep provider exposure safe: before-values shown to the user in Gallery must
  not be leaked to the model unless the session allows metadata exposure.
- Implement in TDD slices: each slice starts with a failing test, verifies the
  expected red failure, implements the smallest useful change, then verifies
  green before continuing.
- Cover the new operation with unit, DTO, UI, assistant-flow, and docs
  regressions.

## Non-Goals

- No forward geocoding in v1. Pi must not guess coordinates for a place name.
- No raw EXIF editing beyond the fields listed in this design.
- No title, filename, device path, checksum, stack, live-photo, or duplicate
  metadata edits.
- No direct mutation MCP tool.
- No delete/trash operation.
- No replacement for existing favorite, archive, tag, or rotate operations.
- No unbounded library-wide metadata rewrite without a materialized, reviewable
  asset set.

## User-Facing Behavior

### Supported Prompts

- "Set the description on these photos to Berlin weekend."
- "Rate these 12 photos five stars."
- "Clear the rating from photos in this album."
- "Move these scanned photos to June 1998."
- "Shift this album's timestamps forward by 2 hours."
- "Set the timezone on these photos to Europe/Berlin."
- "Set these photos to latitude 48.8566 and longitude 2.3522."

### Location Prompts Without Coordinates

If the user asks for a place name without coordinates, Pi should not invent a
location. It should ask for explicit latitude and longitude:

> I can update location metadata when you provide coordinates. Gallery will use
> those coordinates to fill city, state, and country labels.

The MCP contract should make this easy by rejecting `placeName` or any unknown
location field with a correction hint.

## Operation Contract

Add `AgentOperationType.AssetUpdateMetadata`:

```ts
export enum AgentOperationType {
  AssetUpdateMetadata = 'asset.updateMetadata',
}
```

The operation uses the existing `asset_batch` target kind:

```ts
type AgentAssetUpdateMetadataOperation = {
  type: 'asset.updateMetadata';
  summary: string;
  targetKind: 'asset_batch';
  assetIds?: string[];
  assetSelectionHandleId?: string;
  assetSource?: AgentAssetSourceInput;
  riskLevel?: 'low' | 'medium' | 'high';
  enabled?: boolean;
  payload: AgentAssetMetadataUpdatePayload;
};
```

### Payload

```ts
type AgentAssetMetadataUpdatePayload = {
  description?: string;
  rating?: 1 | 2 | 3 | 4 | 5 | null;
  dateTimeOriginal?: string;
  dateTimeRelative?: number; // integer minutes
  timeZone?: string;
  latitude?: number;
  longitude?: number;
};
```

Validation rules:

- At least one payload field is required.
- `description` may be an empty string to clear the description, but non-empty
  descriptions are trimmed and capped at 1000 characters.
- `dateTimeOriginal` must be an ISO datetime string.
- `dateTimeRelative` is an integer minute offset, matching the existing bulk
  date-shift UI and service behavior.
- `dateTimeRelative: 0` is rejected when it is the only effective payload field.
- `dateTimeOriginal` and `dateTimeRelative` are mutually exclusive, matching
  `AssetBulkUpdateDto`.
- `timeZone` may be supplied alone or with either time mode. It must be a
  non-empty IANA timezone string accepted by the server runtime.
- `latitude` and `longitude` must be supplied together.
- `latitude` must be within `[-90, 90]`.
- `longitude` must be within `[-180, 180]`.
- `latitude: null` and `longitude: null` are rejected. Clearing location is not
  part of v1 because the existing bulk update DTO does not expose nullable
  coordinate updates.
- `rating: null` clears the rating.
- `rating: 0` and `rating: -1` should be rejected in the agent operation even
  though legacy asset DTOs still tolerate older rating shapes.
- Unknown fields such as `placeName`, `city`, `country`, or `title` are rejected
  with a correction hint.

## Permissions

Add a write-scope flag:

```ts
writeScope: {
  updateAssetMetadata: boolean;
}
```

Preset behavior:

- `Careful`: `false`
- `VisualOrganizer`: `true`
- `LocalPowerUser`: `true`

Legacy session snapshots should backfill `updateAssetMetadata: false`. This is
consistent with the current conservative legacy defaults for new write scopes.

Plan creation and apply must both check:

- session `writeScope.updateAssetMetadata`
- normal asset update access for all selected assets
- asset-scope restrictions from the session permission plan

Metadata read permissions are separate from metadata write permissions. Gallery
may fetch before-values server-side to render the user's plan review, but MCP
responses must only include those before-values when provider metadata exposure
allows it.

## Data Flow

1. Pi resolves the target assets through explicit IDs, a selection handle,
   `previousSearch`, or a declarative search source.
2. Gallery materializes the asset set at plan creation time, using the same
   durable plan review snapshot rules as other asset-bearing operations.
3. Gallery validates the payload and write scope.
4. Gallery stores a reviewable `asset.updateMetadata` operation.
5. Plan review displays the affected count, representative thumbnails, changed
   fields, and before/after values for a bounded sample.
6. User can disable the operation, revise through chat, or apply the plan.
7. Apply calls `assetService.updateAll(auth, dto)` with the materialized asset
   IDs and payload fields.
8. Existing asset update behavior queues sidecar writes and reverse-geocodes
   coordinates.

`asset.updateMetadata` is operation-level atomic from the agent plan
perspective. `AssetService.updateAll` returns no per-asset result list, so a
metadata operation is either marked applied or failed as a whole. Other enabled
operations in the same plan may still apply if the plan apply flow reaches them.

## Plan Review UI

The existing asset operation review can be reused, but metadata edits need a
field-focused summary in addition to thumbnails.

For each `asset.updateMetadata` operation, show:

- operation summary
- selected asset count
- changed fields
- previous value and proposed value for a representative sample
- any fields that apply uniformly to all selected assets
- a warning when coordinates will be applied to multiple assets

The large item review modal should continue to support thumbnail inspection and
selection changes. If the user removes items from the operation, the metadata
update applies only to the remaining selected assets.

## Activity And Approval Copy

Tool and activity copy should be specific:

- Pending planning approval: "Pi wants to draft metadata changes."
- Completed planning: "Pi drafted metadata changes."
- Activity item: "Preparing metadata update plan"
- Applied card: "Updated metadata for N photos"

The UI should not label this as image editing, because no pixels are changed.

## Error Handling

Recoverable errors should include model-facing correction hints:

- Missing coordinates: "Provide both latitude and longitude."
- Place name supplied: "Gallery does not resolve place names here. Ask the user
  for latitude and longitude."
- Absolute and relative time supplied together: "Choose dateTimeOriginal or
  dateTimeRelative, not both."
- No payload fields: "Provide at least one metadata field to update."
- Inaccessible assets: "Search again within the allowed asset scope or ask the
  user to narrow the target."
- Write scope disabled: "This session is not allowed to update asset metadata."

Apply-time failure should use the existing applied-plan card behavior:
successful operations remain visible, failed metadata operations show a concise
operation-level error, and the chat remains usable.

## TDD Implementation Slices

Each slice must follow red-green-refactor:

1. Add or update the failing test first.
2. Run the targeted test and confirm it fails for the expected reason.
3. Implement the smallest production change.
4. Re-run the targeted test and confirm it passes.
5. Run the relevant surrounding suite before moving to the next slice.

Suggested slices:

1. DTO/schema contract: add `asset.updateMetadata`, payload validation, generated
   MCP schema coverage, and unknown-field correction coverage.
2. Permission model: add `updateAssetMetadata` to permission snapshots, presets,
   legacy backfill, OpenAPI required fields, and custom-plan validation.
3. Plan creation/materialization: validate write scope and asset access,
   materialize explicit/search-backed asset sources, and persist review metadata.
4. Apply path: delegate to `assetService.updateAll`, preserve all-or-failed
   operation status, and surface reverse-geocode or sidecar-write failures.
5. UI review and activity: render operation copy, before/after fields, empty
   clears, coordinate warnings, and photo-review selection edits.
6. Assistant flow: prove prompt-to-plan behavior, plan apply continuation, and
   the place-name-without-coordinates clarification path.
7. Docs/capability matrix: update the matrix and add a regression that prevents
   this capability from drifting back into `Needs new tool`.

## Edge Case Matrix

| Edge case                                  | Required behavior                                                                           | Coverage                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------- |
| Empty payload                              | Reject before plan creation.                                                                | DTO and MCP contract tests       |
| Unknown payload field                      | Reject with correction hint; do not silently drop it.                                       | DTO and MCP contract tests       |
| `description: ""`                          | Clear the description and show "clear description" in review.                               | DTO, apply, UI tests             |
| Overlong description                       | Reject before plan creation.                                                                | DTO tests                        |
| `rating: null`                             | Clear rating and show "unrated" in review.                                                  | DTO, apply, UI tests             |
| `rating: 0`, `-1`, or `6`                  | Reject even though legacy asset DTOs are looser.                                            | DTO tests                        |
| Invalid ISO datetime                       | Reject before plan creation.                                                                | DTO tests                        |
| `dateTimeOriginal` plus `dateTimeRelative` | Reject before plan creation.                                                                | DTO tests                        |
| `dateTimeRelative: 0` alone                | Reject as a no-op.                                                                          | DTO tests                        |
| Non-integer relative time                  | Reject before plan creation.                                                                | DTO tests                        |
| Invalid or blank timezone                  | Reject before plan creation.                                                                | DTO tests                        |
| Place name without coordinates             | Ask for latitude/longitude; no plan is created.                                             | Assistant-flow tests             |
| Latitude without longitude                 | Reject before plan creation.                                                                | DTO tests                        |
| Null or out-of-range coordinates           | Reject before plan creation.                                                                | DTO tests                        |
| Reverse geocode returns no labels          | Apply coordinates and show blank city/state/country safely.                                 | Service tests                    |
| Reverse geocode throws                     | Mark operation failed and keep chat usable.                                                 | Apply tests                      |
| Search source returns no assets            | Return a recoverable no-match response instead of an empty plan.                            | Service and assistant-flow tests |
| Search source exceeds caps                 | Materialize within existing caps or ask user to narrow.                                     | Service tests                    |
| Expired selection handle                   | Return recoverable handle guidance.                                                         | Service tests                    |
| Shared-space asset outside write access    | Reject inaccessible assets.                                                                 | Permission tests                 |
| Locked asset outside session scope         | Reject inaccessible assets.                                                                 | Permission tests                 |
| Metadata read disabled but write enabled   | Do not leak before-values to the model; UI review may still show user-visible plan details. | Service tests                    |
| Apply after asset becomes inaccessible     | Mark metadata operation failed with concise error.                                          | Apply tests                      |
| Revision changes metadata payload          | Revalidate the replacement payload before storing.                                          | Service tests                    |

## Testing Plan

### DTO And Contract Tests

- Accept each supported field.
- Accept `description: ""`.
- Accept `rating: null`.
- Reject `rating: 0`, `rating: -1`, and values outside 1-5.
- Reject invalid ISO date strings.
- Reject non-integer `dateTimeRelative`.
- Reject `dateTimeRelative: 0` when it is the only effective field.
- Reject `dateTimeOriginal` with `dateTimeRelative`.
- Accept a valid IANA `timeZone`.
- Reject blank or invalid `timeZone`.
- Reject latitude without longitude and longitude without latitude.
- Reject null, out-of-range, and non-finite coordinates.
- Reject unknown fields such as `placeName`, `city`, and `title`.
- Verify the generated MCP tool schema exposes `asset.updateMetadata`.
- Verify schema descriptions state that `dateTimeRelative` is an integer minute
  offset.

### Service Tests

- Plan creation validates `writeScope.updateAssetMetadata`.
- Legacy permission snapshots backfill `updateAssetMetadata: false`.
- Permission presets set `updateAssetMetadata` to `false`, `true`, and `true`
  for Careful, VisualOrganizer, and LocalPowerUser respectively.
- OpenAPI schema marks `updateAssetMetadata` as required for non-legacy custom
  permission plans.
- Search-backed metadata plans materialize asset sources at creation time.
- No-match sources return a recoverable response and do not create an empty
  plan.
- Expired or cross-session selection handles return recoverable guidance.
- Apply delegates to `assetService.updateAll` with the selected asset IDs and
  expected DTO fields.
- Coordinate updates call the existing bulk update path so reverse geocoding
  remains centralized.
- Reverse-geocode failure marks the operation failed without ending the chat
  session.
- Provider-facing responses omit before-values unless metadata exposure allows
  them.
- Revised plans preserve metadata payload validation.
- Applying after an asset becomes inaccessible fails the operation cleanly.

### UI Tests

- Operation rows render `asset.updateMetadata` with changed field names.
- Plan review shows before/after metadata for representative sample assets.
- Empty descriptions and cleared ratings are displayed clearly.
- Coordinate updates display latitude and longitude together.
- Coordinate updates show a multi-asset warning when more than one asset is
  selected.
- Operation-level apply failure renders as failed without removing successful
  sibling operation cards.
- Photo review item selection changes update the operation asset set.
- Unknown future metadata operation fields do not break the panel.

### Assistant Flow Tests

Acceptance prompts:

1. "Set the description on the 5 newest photos to Test batch."
2. "Rate my Berlin photos five stars."
3. "Clear the rating from this album."
4. "Shift these scanned photos forward by 2 hours."
5. "Set these photos to latitude 48.8566 and longitude 2.3522."
6. "Set these photos to Paris."
7. "Set the date on these photos to yesterday and the timezone to Europe/Berlin."
8. "Set these photos to latitude 48.8566."

Expected behavior for prompt 6: Pi asks for coordinates instead of creating a
plan.

Expected behavior for prompt 8: Pi asks for the missing longitude instead of
creating a plan.

## Capability Matrix Update

After implementation, add a "Batch asset metadata edits" row to the capability
matrix as `Solid now` for explicit supported fields and `Needs new tool` or
`Out of scope` for place-name-to-coordinate resolution.

## Future Work

- Forward geocoding for place-name edits, with ambiguity handling and a privacy
  decision about data sources.
- Metadata templates for scanned imports.
- Per-asset metadata payloads when different assets need different dates or
  coordinates in one plan.
- Filename/title editing if Gallery adds first-class product support.
- Richer timezone disambiguation for imported camera rolls.
