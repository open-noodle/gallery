# Add-to-collection and Share for Shared Space selections

Status: approved 2026-07-25. Follows on from
`2026-07-24-selection-toolbar-consistency-design.md` (#839 / PR #842).

## Problem

#839 unified the multi-select toolbar across the three Shared Space surfaces (space timeline, space
person, space album) behind the pure `getSelectionCapabilities` rule engine. It gated two actions
all-or-nothing on asset ownership:

```ts
canShare: sel.isAllUserOwned,
canAddToAlbum: sel.isAllUserOwned,
```

So the moment a space selection contains one photo owned by another member, both the `+`
(add-to-album-or-space) and the share button disappear. The #839 spec called this out explicitly
(line 146: _"the #764 space-editor contribution is a separate flow, out of scope"_) — a deliberate
deferral, now being closed.

A space Owner/Editor should be able to gather other members' photos into an album, and sharing
should not vanish just because the selection is mixed.

## What the server actually permits

The gate design is dictated by existing server behaviour. No server change is needed.

| Target         | Endpoint                         | Non-owned asset                                                                                                                                                |
| -------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One album      | `POST /albums/:id/assets`        | **Allowed** when the album is space-linked and the caller is Owner/Editor of that space — `album.service.tryContributeDeniedAssets` writes `album_space_asset` |
| Several albums | `PUT /albums/assets`             | **Silently dropped** — the bulk path has no contribution arm                                                                                                   |
| A space        | `POST /shared-spaces/:id/assets` | **Rejected, whole request** — `requireAccess(AssetShare)` throws (deliberate anti-escalation gate, `shared-space.service.ts`)                                  |
| Shared link    | `POST /shared-links`             | **Rejected, whole request** — same `AssetShare` gate                                                                                                           |

Two consequences drive the design:

1. `AssetShare` is owner ∪ partner only and **throws for the entire request**. Any action built on it
   must send the owned subset, never the full selection.
2. Cross-owner contribution only reaches **albums linked to a space the caller can write to**. A
   personal album, a brand-new album, or any space pool cannot receive another member's photo.

`Permission.AlbumAssetCreate` has a `checkSpaceLinkedAlbumAccess` arm
(`access.repository.ts`), so a space Owner/Editor holds add-permission on every album linked to
their space even when they are not an album user. The flow therefore clears every server gate.

## Design

### 1. Rule engine — `web/src/lib/managers/selection-capabilities.ts`

```ts
// Share the owned subset rather than hiding the button on a mixed selection.
canShare: sel.ownedSelectedAssetIds.length > 0,

// All-owned works anywhere. Otherwise a space Owner/Editor can still contribute
// non-owned assets to albums linked to this space (#764).
canAddToAlbum: sel.isAllUserOwned || isSpaceEditor,

// Opens the picker in restricted mode.
addToAlbumRestrictedToSpace: !sel.isAllUserOwned && isSpaceEditor,
```

where `isSpaceEditor = space !== null && space.canWrite`, covering all three space surfaces (each
passes a `space` prop to `SelectionToolbar`).

A space **Viewer** is unaffected: `canWrite` is false, so they keep the all-owned gate.

`SelectionToolbar` currently hardcodes `ownedAssets: []` / `ownedSelectedAssetIds: []` in its derived
`CommandContext`. These get populated from `assetInteraction.ownedAssets`, which is what makes
`canShare` computable.

### 2. Restricted picker — `CollectionPickerModal`

New optional `restrictToSpaceId` prop, threaded through `AssetAddToCollectionModal`.

| Aspect            | Normal mode                                    | Restricted mode                                     |
| ----------------- | ---------------------------------------------- | --------------------------------------------------- |
| Albums            | `getAllAlbums({ isOwned })` + `({ isShared })` | `getSharedSpaceAlbums(spaceId)` — space-linked only |
| Spaces            | writable spaces                                | none — no space pool can take a non-owned asset     |
| New album / space | shown                                          | hidden — a fresh album is not space-linked          |
| Notice            | —                                              | explains why the list is narrowed                   |

`SharedSpaceLinkedAlbumDto` is `AlbumResponseDto` minus `albumUsers`, so it needs an
`albumUsers: []` shim before `AlbumListItem` can render it. `getLinkedAlbums` requires space
membership only, so an Editor can always list them.

### 3. Contribution dispatch — `collection.service.ts`

`addAssetsToAlbums` routes >1 album through the bulk endpoint, which has no contribution arm. In
restricted mode `addAssetsToCollections` dispatches **one single-album call per album** so
`tryContributeDeniedAssets` runs for each, and `notifyAddToAlbum` reports the per-asset outcome
truthfully (it already distinguishes added / contributed / duplicate / denied).

### 4. Share owned-subset — `CreateSharedLinkAction`

Sends `assetMultiSelectManager.ownedAssets` instead of `.assets`. This is correct on every surface,
not just spaces — a link over someone else's asset has always been a whole-request 400.
`SharedLinkCreateModal` takes an optional excluded count and shows how many selected photos are
being left out, so the subsetting is visible at decision time rather than silent.

## Testing strategy

TDD throughout: failing test first, confirm it fails for the right reason, then implement.

1. `selection-capabilities.spec.ts` — capability matrix over {owner, editor, viewer} ×
   {all-owned, mixed, none-owned} × {direct space, space album, space person, regular album,
   personal}. Regular-album and personal rows are the regression guard: they must not change.
2. `collection.service.spec.ts` — restricted mode issues one single-album call per album and never
   the bulk call; normal mode keeps today's batching.
3. `CollectionPickerModal.spec.ts` — restricted mode loads space albums, hides spaces and both
   create rows, renders the notice.
4. `SelectionToolbar.spec.ts` — `+` and share render for a space editor on a mixed selection; the
   restriction is threaded into the action.
5. `CreateSharedLinkAction` — passes owned ids only.
6. Web e2e — space editor with a mixed selection sees both buttons.

## Risks

- **R1 — asset visibility through the space.** `getContributableAssetSpaces` also requires each asset
  to be visible via that space (direct pool, linked library, or another linked album). Restricting
  the picker to albums of the **current** space keeps this true by construction: the selection was
  made on that space's surface. Albums of some _other_ space are not offered.
- **R2 — partial success.** Contribution is per-asset on the server. The existing `notifyAddToAlbum`
  toast already reports counts truthfully, so no new failure mode is introduced.
