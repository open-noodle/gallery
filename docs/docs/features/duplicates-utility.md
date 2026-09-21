# Duplicates Utility

Immich comes with a duplicates utility to help you detect assets that look visually similar. The duplicate detection feature relies on machine learning and is enabled by default. For more information about when the duplicate detection job runs, see [Jobs and Workers](/administration/jobs-workers). Once an asset has been processed and added to a duplicate group, it becomes available to review in the "Review duplicates" utility, which can be found [here](https://my.immich.app/utilities/duplicates).

## Reviewing duplicates

The review duplicates page allows the user to individually select which assets should be kept and which ones should be trashed. When more than one asset is kept, there is an option to automatically put the kept assets into a stack.

### Automatic preselection

When using "Deduplicate All" or viewing suggestions, Immich automatically preselects which assets to keep based on:

1. **Image size in bytes** — larger files are preferred as they typically have higher quality.
2. **Count of EXIF data** — assets with more metadata are preferred.

### Synchronizing metadata

When resolving duplicates, metadata from trashed assets is automatically synchronized to the kept asset. This synchronization only happens when **exactly one** asset is kept and at least one asset is trashed. When more than one asset is kept, metadata is not merged — the assets keep their own metadata and are simply removed from the duplicate group. The following metadata is synchronized:

| Name         | Description                                                                                                                                                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Album        | The kept asset will be added to _every_ album that the other assets in the group belong to.                                                                                                                                                                                   |
| Shared Space | The kept asset will be added to every [Shared Space](./shared-spaces.md) the trashed duplicates belonged to, provided you have Owner or Editor role. Face recognition re-runs on the keeper inside each space so any people it captures flow into the space's people sidebar. |
| Favorite     | If any of the assets in the group have been added to favorites, the kept asset will also be added to favorites.                                                                                                                                                               |
| Rating       | If one or more assets in the duplicate group have a rating, the highest rating is selected and synchronized to the kept asset.                                                                                                                                                |
| Description  | Descriptions from each asset are combined together and synchronized to the kept asset.                                                                                                                                                                                        |
| Visibility   | The most restrictive visibility is applied to the kept asset.                                                                                                                                                                                                                 |
| Location     | Latitude and longitude are copied if all assets with geolocation data in the group share the same coordinates.                                                                                                                                                                |
| Tag          | Tags from all assets in the group are merged and applied to the kept asset.                                                                                                                                                                                                   |

### Re-upload prevention

When you resolve a duplicate group, Gallery keeps the checksums of the trashed assets in a tombstone table, so the mobile app does not upload those files again.

Without the tombstones you get a loop. The backup cycle sees that a resolved duplicate's file is gone from the server, because its checksum was removed when the trash was emptied, and uploads the file again. The same duplicate comes back.

#### How it works

```
Phone has files A and B (visually similar, different checksums)
  │
  ├─ Both uploaded to server
  │
  ├─ CLIP duplicate detection groups them
  │
  ├─ User resolves: keep A, trash B
  │    └─ Tombstone created: B's checksum → A's asset ID
  │
  ├─ Trash emptied: B's asset record deleted from DB
  │    └─ Tombstone persists
  │
  └─ Phone backup cycle:
       ├─ Computes B's checksum locally
       ├─ Calls bulkUploadCheck → server finds B's checksum in tombstone table
       ├─ Returns REJECT (duplicate of A)
       └─ Phone skips upload ✓
```

#### Tombstone lifecycle

- Created when a duplicate group is resolved and assets are trashed, and only if at least one asset is kept.
- Cleaned up automatically when:
  - The kept asset is deleted (CASCADE). The duplicate content is no longer on the server, so re-upload is allowed.
  - A trashed asset is restored from trash. The original asset is back, so the tombstone is no longer needed.
- Not created when every asset in a group is trashed, since no surviving asset is left to point at.
- Not created for manual deletions. Only duplicate resolution writes tombstones, so a file you delete by hand can be uploaded again.
