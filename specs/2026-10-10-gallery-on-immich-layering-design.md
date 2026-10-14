# Gallery on top of Immich: layering design

Decided 2026-10-10, delivered by #1180, #1181, #1182 and #1186 (October 2026). This is the record of why the fork is
shaped the way it is after those pull requests and what still diverges on purpose. The rules that follow from it are in AGENTS.md, "Gallery sits on top of Immich".

## Goal

Gallery used to change Immich from the inside: fork columns on Immich tables, fork migration names in Immich's
ledger, fork strings in Immich's locale files, and fork logic inside Immich's services. Every Immich release then
conflicted with that code. The owner set five goals:

1. Gallery does not touch, or barely touches, Immich's tables.
2. Stock Immich apps keep working against Gallery.
3. Uninstalling Gallery and going back to Immich is safe.
4. Where Gallery and Immich overlap, Gallery adopts Immich's version.
5. Fewer conflicts when rebasing onto a new Immich release.

The owner's standing tie-break, recorded 2026-10-11: "i prefer to adopt immich v3.3.1 base code as much as possible,
or else the gallery is starting to be way too different from immich v3 to maintain. so whatever makes us closer to
immich v3 baseline".

## What each wave did

| Wave | PR    | What moved                                                                                                                                                                                                                                                                                                                                               |
| ---- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | #1180 | Revert script cleans fork data (S3 guard, pets, rule memories, trims, space share links pruned by Immich's owner-or-editor album rule), proven by a seeded CI job. Stock clients get no fork sync types, unknown sync request types are dropped, and stock clients see the Immich base version.                                                          |
| 1    | #1181 | Fork migrations recorded in `gallery_migrations`; the Gallery app falls back cleanly on a stock Immich server; fork server code moved into `server/src/gallery`; the Dart client patch pipeline repaired.                                                                                                                                                |
| 2    | #1182 | Five fork columns moved to side tables and `library.createId` dropped; sync and access seams (`src/gallery/utils/gallery-sync.streams.ts`, `src/gallery/utils/access-grants.ts`); the i18n overlay (`i18n/gallery/`), so Immich's locale files are byte-identical to the tag; web filtered-timeline module and mobile timeline splits.                                                 |
| 3    | #1186 | `asset.isFavorite` restored as the owner's projection of `asset_favorite`, kept by triggers; viewer-scope and album-membership helpers; upstream search V3 adopted with four hooks; trims moved to `asset_video_trim` behind their own endpoint; one disk/S3 resolver (`StorageService.backendFor`); stock Immich round trip added to the revert CI job. |

Measured against Immich v3.3.1 (before on `main` at 2026-10-10, after at the #1186 head):

| Measure                                                                       | Before                        | After                        |
| ----------------------------------------------------------------------------- | ----------------------------- | ---------------------------- |
| Fork columns on Immich tables                                                 | 8 added, `isFavorite` removed | none                         |
| Immich table files the fork edits                                             | 8                             | 5, indexes and triggers only |
| Foreign keys from Immich tables into fork tables                              | 2                             | 0                            |
| Fork names in `kysely_migrations`                                             | 71, plus 2 aliases            | 0                            |
| Immich locale files the fork edits                                            | 57                            | 0                            |
| `sync.service.ts`, `sync.repository.ts`, `access.repository.ts` changed lines | about 3,400                   | about 400                    |
| Files in `server/src/gallery`                                                 | 6                             | 49                           |

## Decisions and their reasons

- **Migration order stays interleaved by name** across both folders, so installs from before v5.7.0 keep upgrading. Fork
  migrations are already separate by folder and ledger; running upstream first can be revisited once those installs
  are no longer an upgrade source.
- **Downgrades** follow the procedure in `docs/docs/install/upgrading.md`. A downgrade only affects RC users, which the
  owner accepted.
- **`person_personGroupId_key` stays** on `person`: it is a product rule (one person row per group), and a database
  index is race-safe where a service check is not. Immich's person sharing stays dormant
  (`specs/2026-10-01-upstream-person-sharing-dormant-design.md`).
- **The person files stay fork-owned.** Space people and pets run through `person.repository.ts` and `person.service.ts`, and so
  does face identity; the upstream preflight lists Immich's changes to them every cycle.
- **Favorites:** `asset_favorite` is the source of truth for every user, `asset.isFavorite` is the owner's projection.
  Gallery code never writes the column; Immich's owner-only write paths (upload, copy, duplicate resolve) do, and a
  reverse trigger mirrors them. Paths a non-owner reaches (space editors hold `AssetUpdate`) write the caller's overlay
  row. Design: `specs/2026-07-20-per-user-favorites-design.md`.
- **Trims have their own endpoint** (`/assets/{id}/trim`) and table. Trim is not an `asset_edit` action, so Immich's
  edit code stays upstream text. Trims cut at keyframes (stream copy, no re-encode); the duration Gallery stores matches the file, and so
  does the one clients receive.
- **Search V3 is adopted** with four optional hooks on `AssetSearchScope`, each defaulting to Immich's behaviour.
  V3 follows Immich's trash rule and its `hasAlbums` reads `album_asset` only.
- **Unknown sync request types are ignored**, so stock apps from a newer Immich release keep syncing.
- **Space links in a revert** follow Immich's rule: an album link survives only if its creator owns or edits the album.
- **Spaces stay visible** in the Gallery app while the server version is unknown (0.0.0); they hide once a stock
  server is identified.
- **No dead code:** upstream client files the fork had deleted stay deleted.
- **Gallery does not re-enable `gallery-core` on boot** after a stock Immich trial (Immich never touches a plugin's
  `enabled` flag); it logs a warning with the SQL instead.

## Security fix found on the way: duplicate resolve

Immich v3.3.1 lets user A write onto user B's asset. A can read B's `duplicateId` on any asset response, put one of
A's own assets into B's group (`PUT /assets` checks only that A may update A's asset), then resolve the group keeping
B's asset (`POST /duplicates/resolve` never checks the kept ids). Resolve writes onto B's asset: A's favorite, the strictest
visibility, the highest rating, merged descriptions, a shared location, the group's tags. It also rewrites B's sidecar and clears the group. Gallery
refuses the join when the group holds another owner's asset and requires owner access on every kept asset. Both fixes
apply to Immich unchanged and can be offered upstream; Immich has not been contacted.

## What still diverges on purpose

- **People:** the person repository and service (+1,095 and +608 lines against the tag), for the reasons above.
- **Timeline filters:** `asset.repository.ts` and `utils/database.ts` hold the filter panel's rules in one shared
  timeline function that five queries use; restoring Immich's inline chain would repeat each rule.
- **Older search fields:** `search.repository.ts` keeps the flat search endpoints' fork fields next to the V3 hooks,
  because released Gallery apps send them.
- **Generated files** (OpenAPI spec, SDK, SQL docs) still conflict and are regenerated, not merged.

Not verified at runtime: a rollback to a v5.7 release (the procedure names what it loses: non-owner favorites and
`asset_face.createdBy`), real phones, and the ML image.
