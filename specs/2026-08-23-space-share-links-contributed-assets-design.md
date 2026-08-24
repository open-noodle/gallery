# Space share links that include contributed assets

Discussion: [#1018](https://github.com/open-noodle/gallery/discussions/1018)

## The problem

Generating a share link from inside a Space — from a Space Album, or from a selection on the
space timeline — only ever covers assets the link creator owns. Everything contributed by other
Space members is dropped, so the link does not reflect what the Space actually shows.

Today the web app narrows the selection to the owned subset on purpose and says so
(`shared_link_excludes_other_owners`, #871), because the server rejects the whole request
otherwise. This design reverses that decision for the Space case only.

## Why it happens

`Permission.AssetShare` is the one asset permission with no space arm:

```ts
// server/src/utils/access.ts:127
case Permission.AssetShare: {
  const isOwner = await access.asset.checkOwnerAccess(auth.user.id, ids, false);
  const isPartner = await access.asset.checkPartnerAccess(auth.user.id, setDifference(ids, isOwner));
  return setUnion(isOwner, isPartner);
}
```

`AssetRead`, `AssetView` and `AssetDownload` all union `checkSpaceAccess`. `AssetShare` does not,
and neither does `AlbumShare` (`access.ts:222`), which has no space-linked-album arm. Downstream,
four read paths also stop at `album_asset` and never reach `album_space_asset`.

## Consent model: live-tethered, not a permanent grant

A share link that includes someone else's photo records **which space it was created from**
(`shared_link.spaceId`). On every read, a non-owned asset is re-derived from live state:

- the link creator is still a member of that space, **and**
- the asset is still visible in that space (direct add, linked library, linked album, or #764
  contribution).

When a contributor pulls their photo out of the space, or the album is unlinked, or the link
creator leaves the space, the link stops serving that asset. Deleting the space nulls `spaceId`
and the link degrades to the creator's own assets.

This follows the doctrine already stated verbatim in `album_space_asset.table.ts`: _"Visibility is
re-derived from live space membership + the live album↔space link on every read."_ A permanent
`shared_link_asset` grant would leave a withdrawn photo publicly exposed forever.

## Who may create one

**Space Owner/Editor only.** This mirrors the existing #764 rule — the space Owner/Editor is
already the single role that may act on assets it does not own
(`album.service.tryContributeDeniedAssets`, `selection-capabilities.ts` `isSpaceEditor`). A Viewer
keeps today's owned-subset narrowing and the existing notice.

## Slices

| #   | Area            | Change                                                                                                                                                       |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | schema + DTO    | `shared_link.spaceId` (nullable FK → `shared_space`, `SET NULL`), fork migration, create/response DTO fields, `AuthSharedLink.spaceId`, `authBuilder` select |
| S2  | create          | space-gated authorization for both link types                                                                                                                |
| S3  | read: per-asset | `checkSharedLinkAccess` — contributed arm for album links, live tether for non-owned individual assets                                                       |
| S4  | read: timeline  | `timeline.service` resolves `albumSpaceIds` from the link's space instead of refusing for shared-link auth                                                   |
| S5  | read: counts    | `album.service.get` passes the link's space to `getMetadataForIds`                                                                                           |
| S6  | serialization   | `shared-link.repository` album leg unions contributions; individual leg tethered                                                                             |
| S7  | web             | thread `spaceId`, stop narrowing for space editors, consent warning, ten locales                                                                             |
| S8  | mobile          | Dart client regen                                                                                                                                            |
| S9  | docs + e2e      | `shared-spaces.md`, `sharing.md`, cross-owner e2e coverage                                                                                                   |

### S2 — authorization rules

Individual link with `spaceId`:

1. caller is Owner/Editor of the space (`sharedSpaceRepository.getMember`),
2. every `assetId` is visible in that space (`access.asset.checkSpaceAccessForSpace`).

Album link with `spaceId`:

1. caller is Owner/Editor of the space,
2. the album is live-linked to that space and the caller is a member
   (`sharedSpaceRepository.getMemberSpaceIdsLinkingAlbum`).

Without `spaceId` nothing changes — `AssetShare` / `AlbumShare` as today.

### S3 — read gate

- Album links: union the `album_space_asset` arm, correlated on `shared_space_album` for
  `shared_link.spaceId`, so a contribution is only ever visible through the space it was
  contributed to.
- Individual links: a `shared_link_asset` row whose asset the link creator does **not** own is
  served only while the tether above holds. Owned assets are unaffected.

`spaceVisibleAssetVisibilities` (`archive`, `timeline`) applies throughout — Hidden and Locked
assets are never shareable.
