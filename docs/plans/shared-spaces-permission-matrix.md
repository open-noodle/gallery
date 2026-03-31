# Shared Spaces Permission Matrix

**Last updated:** 2026-03-31 (after PRs #242, #243)

## Roles

| Role       | Hierarchy | Description                                         |
| ---------- | --------- | --------------------------------------------------- |
| **Owner**  | 2         | Full control — created the space                    |
| **Editor** | 1         | Can add/remove assets, edit metadata, manage people |
| **Viewer** | 0         | Read-only access                                    |

## Asset Access Permissions (Server)

| Permission          | Owner | Space Editor | Space Viewer | Partner | Album Member | Shared Link                      |
| ------------------- | ----- | ------------ | ------------ | ------- | ------------ | -------------------------------- |
| **AssetRead**       | Yes   | Yes          | Yes          | Yes     | Yes          | Yes                              |
| **AssetView**       | Yes   | Yes          | Yes          | Yes     | Yes          | Yes (EXIF stripped if !showExif) |
| **AssetDownload**   | Yes   | Yes          | Yes          | Yes     | Yes          | Yes (if allowDownload)           |
| **AssetUpdate**     | Yes   | Yes          | No           | No      | No           | No                               |
| **AssetDelete**     | Yes   | No           | No           | No      | No           | No                               |
| **AssetShare**      | Yes   | No           | No           | Yes     | No           | No                               |
| **AssetCopy**       | Yes   | No           | No           | No      | No           | No                               |
| **AssetEditGet**    | Yes   | No           | No           | No      | No           | No                               |
| **AssetEditCreate** | Yes   | No           | No           | No      | No           | No                               |
| **AssetEditDelete** | Yes   | No           | No           | No      | No           | No                               |

## Asset Detail Panel — Metadata Visibility

| Metadata                     | Owner | Editor | Viewer | Non-member | Notes                                                                   |
| ---------------------------- | ----- | ------ | ------ | ---------- | ----------------------------------------------------------------------- |
| **EXIF (camera, lens, ISO)** | View  | View   | View   | View       | Never stripped by server                                                |
| **Date/time**                | Edit  | View   | View   | View       | Edit button gated by `isOwner`                                          |
| **Location**                 | Edit  | View   | View   | View       | Edit pencil gated by `isOwner`                                          |
| **Description**              | Edit  | View   | View   | View       | Read-only for non-owners if exists                                      |
| **Rating**                   | Edit  | View   | View   | View       | `readOnly={!isOwner}`, requires `$preferences.ratings.enabled`          |
| **People**                   | Edit  | View   | View   | Hidden     | `isOwner \|\| isSpaceMember` gate                                       |
| **Tags**                     | Edit  | View   | View   | Hidden     | `isOwner \|\| isSpaceMember` gate, requires `$preferences.tags.enabled` |
| **File path**                | View  | Hidden | Hidden | Hidden     | `isOwner` only                                                          |
| **Album list**               | View  | View   | View   | View       | Always visible                                                          |

### People display details

| Feature             | Owner                  | Space Member                               | Non-member |
| ------------------- | ---------------------- | ------------------------------------------ | ---------- |
| Person thumbnails   | Global person endpoint | Space person endpoint                      | Hidden     |
| Person links        | `/people/{id}`         | `/spaces/{spaceId}/people/{spacePersonId}` | Hidden     |
| Face edit button    | Visible                | Hidden                                     | Hidden     |
| "Tag people" button | Visible                | Hidden                                     | Hidden     |
| Show/hide toggle    | Visible                | Hidden                                     | Hidden     |

### Space context resolution

| Entry Point               | `spaceId` source                      | People/Tags visible for space member? |
| ------------------------- | ------------------------------------- | ------------------------------------- |
| Space page                | Explicit prop from route              | Yes                                   |
| Timeline (showInTimeline) | Server fallback via `resolvedSpaceId` | Yes (PR #243)                         |
| Search results            | Server fallback via `resolvedSpaceId` | Yes (PR #243)                         |
| Direct URL                | Server fallback via `resolvedSpaceId` | Yes (PR #243)                         |

Note: PR #243 adds `findSpaceForAssetAndUser` which auto-resolves space context when `spaceId` is not explicitly passed. The server returns `resolvedSpaceId` on the asset response.

## Asset Viewer Nav Bar — Actions

| Action                  | Owner   | Editor | Viewer | Non-member |
| ----------------------- | ------- | ------ | ------ | ---------- |
| **Download**            | Yes     | Yes    | Yes    | Yes        |
| **Download original**   | Yes     | Yes    | Yes    | Yes        |
| **Share**               | Yes     | No\*   | No\*   | No\*       |
| **Favorite/unfavorite** | Yes     | No     | No     | No         |
| **Edit (crop/rotate)**  | Yes     | No     | No     | No         |
| **Add to album**        | Yes     | Yes    | Yes    | Yes        |
| **Slideshow**           | Yes     | Yes    | Yes    | Yes        |
| **View similar**        | Yes     | Yes    | Yes    | Yes        |
| **View in timeline**    | Yes     | No     | No     | No         |
| **Delete**              | Yes     | No     | No     | No         |
| **Archive**             | Yes     | No     | No     | No         |
| **Rating**              | Yes     | No     | No     | No         |
| **Restore from trash**  | Yes     | No     | No     | No         |
| **Stack operations**    | Yes     | No     | No     | No         |
| **Set visibility**      | Yes     | No     | No     | No         |
| **ML jobs**             | Yes     | No     | No     | No         |
| **Remove from album**   | Yes\*\* | No     | No     | No         |

\* Share button is visible to all users but the server rejects the shared link creation for non-owners (AssetShare is owner + partner only). This is a frontend gap.
\*\* Asset owner or album owner

## Space Management Endpoints

| Action                                                | Owner    | Editor   | Viewer   |
| ----------------------------------------------------- | -------- | -------- | -------- |
| **Create space**                                      | Any user | Any user | Any user |
| **View space**                                        | Yes      | Yes      | Yes      |
| **Update space** (name, description, color, settings) | Yes      | No       | No       |
| **Update space cover photo**                          | Yes      | Yes      | No       |
| **Delete space**                                      | Yes      | No       | No       |

## Member Management

| Action                        | Owner     | Editor    | Viewer    |
| ----------------------------- | --------- | --------- | --------- |
| **View members**              | Yes       | Yes       | Yes       |
| **Add member**                | Yes       | No        | No        |
| **Update member role**        | Yes       | No        | No        |
| **Remove member**             | Yes (any) | Self only | Self only |
| **Toggle own showInTimeline** | Yes       | Yes       | Yes       |

## Asset Management in Spaces

| Action                  | Owner | Editor | Viewer |
| ----------------------- | ----- | ------ | ------ |
| **Add assets**          | Yes   | Yes    | No     |
| **Bulk add all assets** | Yes   | Yes    | No     |
| **Remove assets**       | Yes   | Yes    | No     |

## Space People Management

| Action                                           | Owner | Editor | Viewer |
| ------------------------------------------------ | ----- | ------ | ------ |
| **View people list**                             | Yes   | Yes    | Yes    |
| **View person detail**                           | Yes   | Yes    | Yes    |
| **View person thumbnail**                        | Yes   | Yes    | Yes    |
| **View person assets**                           | Yes   | Yes    | Yes    |
| **Update person** (name, visibility, birth date) | Yes   | Yes    | No     |
| **Delete person**                                | Yes   | Yes    | No     |
| **Merge people**                                 | Yes   | Yes    | No     |
| **Deduplicate people**                           | Yes   | No     | No     |
| **Set personal alias**                           | Yes   | Yes    | Yes    |
| **Delete personal alias**                        | Yes   | Yes    | Yes    |

## Tag Permissions

| Action                        | Owner | Editor | Viewer | Notes                                                   |
| ----------------------------- | ----- | ------ | ------ | ------------------------------------------------------- |
| **View tags on space assets** | Yes   | Yes    | Yes    | Tags never stripped server-side; frontend gates display |
| **Add tag to asset**          | Yes   | No     | No     | `TagAsset` permission is owner-only                     |
| **Remove tag from asset**     | Yes   | No     | No     | `TagAsset` permission is owner-only                     |
| **Create/update/delete tags** | Yes   | No     | No     | All tag CRUD is owner-only                              |

## Other Space Features

| Feature            | Owner          | Editor         | Viewer |
| ------------------ | -------------- | -------------- | ------ |
| **Map markers**    | Yes            | Yes            | Yes    |
| **Activity feed**  | Yes            | Yes            | Yes    |
| **Link library**   | Yes (if admin) | Yes (if admin) | No     |
| **Unlink library** | Yes (if admin) | Yes (if admin) | No     |

## Filter Panel — Data Sources

### Space page filter panel

| Filter         | Data source                         | Space-scoped? |
| -------------- | ----------------------------------- | ------------- |
| **People**     | `getSpacePeople({ named: true })`   | Yes           |
| **Location**   | `getSearchSuggestions({ spaceId })` | Yes           |
| **Camera**     | `getSearchSuggestions({ spaceId })` | Yes           |
| **Tags**       | `getTagSuggestions({ spaceId })`    | Yes           |
| **Rating**     | Client-side                         | N/A           |
| **Media type** | Client-side                         | N/A           |

### Photos page filter panel

| Filter         | Data source                                        | Includes space content?     |
| -------------- | -------------------------------------------------- | --------------------------- |
| **People**     | `getAllPeople()`                                   | No (user's own people only) |
| **Location**   | `getSearchSuggestions({ withSharedSpaces: true })` | Yes                         |
| **Camera**     | `getSearchSuggestions({ withSharedSpaces: true })` | Yes                         |
| **Tags**       | `getTagSuggestions({ withSharedSpaces: true })`    | Yes                         |
| **Rating**     | Client-side                                        | N/A                         |
| **Media type** | Client-side                                        | N/A                         |

## Known Gaps

1. **Tag editing for space members** — `TagAsset` permission is owner-only. Space editors cannot add/remove tags on space assets. Requires extending the tag permission model.
2. **Photos page people filter** — Uses `getAllPeople()` which returns only the user's own people. Space people not included. Needs cross-space person dedup logic.
3. **`$preferences.tags.enabled`** — Space members must enable tags in their personal settings to see them. No automatic bypass for space context.
4. **Nav bar actions for editors** — Several actions (favorite, archive, edit/crop/rotate, rating) are gated by `isOwner` in the frontend even though space editors have `AssetUpdate` permission on the server. The Share button is visible to all but fails server-side for non-owners.
5. **No shared links from space context** — Space members cannot create shared links for space assets. Only the asset owner and partners can share via `AssetShare`.
