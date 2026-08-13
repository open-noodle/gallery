# Shared-space album sort parity between web and mobile

**Issue:** [#966](https://github.com/open-noodle/gallery/issues/966) — _Album sorting options in Shared Space are inconsistent between Web and Mobile_
**Date:** 2026-08-10
**Status:** approved, ready for implementation

## Problem

The sort options offered for a shared space's linked-album list differ per platform:

| Web (6)           | Mobile (4)       |
| ----------------- | ---------------- |
| Title             | Name             |
| Number of items   | Photo count      |
| Date modified     | Recently updated |
| Date created      | Recently linked  |
| Most recent photo | —                |
| Oldest photo      | —                |

Two of those apparent differences are cosmetic: mobile's _Name_ is web's _Title_ (`albumName`), and mobile's
_Recently updated_ is web's _Date modified_ (`updatedAt`). The genuine gaps are that mobile lacks the three
date-based sorts, and web lacks _Recently linked_.

The platforms also open on different defaults — web on _Most recent photo_, mobile on _Recently linked_.

## Decisions

1. **Unify on the union of seven options** (web's six plus _Recently linked_). Nobody loses a capability, and
   _Recently linked_ answers a question specific to a shared space — "what did someone just add here?" — that no
   other sort answers.
2. **Both platforms default to _Recently linked_, descending.** This is the most useful opening order for a
   collaborative surface. Web changes its default; mobile's is already this.
3. **No server change.** `GET /shared-spaces/{id}/albums` already returns every field required
   (`server/src/dtos/shared-space.dto.ts:167` — `AlbumResponseSchema` minus `albumUsers`, plus `ownerId`,
   `showInTimeline`, `addedById`, `linkedAt`).
4. **No new i18n strings.** All seven label keys were verified present in each of the ten maintained locales
   (`en`, `de`, `fr`, `it`, `nl`, `pl`, `es`, `ru`, `zh_Hans`, `zh_Hant`).
5. **Upstream files stay byte-clean.** Web's new option lives in a fork-only layer, not in upstream's
   `AlbumSortBy` enum. See "Why not extend the upstream enum" below.
6. **Mobile derives photo dates locally** from the Drift query that already runs, rather than switching the
   surface to REST. This preserves offline and reactive behaviour.

## The unified sort contract

Seven options, identical order, identical labels, identical default direction on both platforms.

| #   | Web id            | Dart identifier   | i18n key               | Default dir | Web field    | Mobile source                          |
| --- | ----------------- | ----------------- | ---------------------- | ----------- | ------------ | -------------------------------------- |
| 1   | `Title`           | `name`            | `sort_title`           | Asc         | `albumName`  | `meta.name`                            |
| 2   | `ItemCount`       | `photoCount`      | `sort_items`           | Desc        | `assetCount` | `count(asset.id)`                      |
| 3   | `DateModified`    | `recentlyUpdated` | `sort_modified`        | Desc        | `updatedAt`  | `meta.updatedAt`                       |
| 4   | `DateCreated`     | `dateCreated`     | `sort_created`         | Desc        | `createdAt`  | `meta.createdAt` _(new)_               |
| 5   | `MostRecentPhoto` | `mostRecentPhoto` | `sort_recent`          | Desc        | `endDate`    | `max(localDateTime)` → UTC day _(new)_ |
| 6   | `OldestPhoto`     | `oldestPhoto`     | `sort_oldest`          | Desc        | `startDate`  | `min(localDateTime)` → UTC day _(new)_ |
| 7   | `RecentlyLinked`  | `recentlyLinked`  | `sort_recently_linked` | Desc        | `linkedAt`   | `link.createdAt`                       |

**Default: `RecentlyLinked` / descending, both platforms.**

### Dart identifiers are load-bearing — do not rename them

`SettingsKey.spaceAlbumsSortMode` persists through `EnumCodec`
(`mobile/lib/domain/models/value_codec.dart:45`), which encodes `value.name` and decodes with:

```dart
T decode(String raw) => values.firstWhere((v) => v.name == raw);
```

`firstWhere` has **no `orElse`**, and no layer between it and app startup catches the throw:
`CachedKeyValueRepository._build` (`cached_key_value_repository.dart:26`) calls it unguarded, `refresh()` is
awaited inside `SettingsRepository.ensureInitialized`. An unrecognised stored value therefore throws
`StateError` during startup rather than falling back to a default.

Consequences:

- Renaming `name` → `title` or `recentlyUpdated` → `dateModified` would crash on launch for every user who had
  selected that option. **Only the labels change; the identifiers stay.** `name` therefore renders "Title" and
  `recentlyUpdated` renders "Date modified"; both get an explanatory comment.
- Adding `dateCreated` / `mostRecentPhoto` / `oldestPhoto` creates a **downgrade** crash: a user who selects one
  and then installs an older build (RC rollback, PR RC images, TestFlight rollback) hits the same unguarded
  `firstWhere`. This risk is introduced by this change, so hardening `EnumCodec.decode` to fall back instead of
  throwing is in scope — see slice M0.

`storeIndex` on these enums is vestigial for `SpaceAlbumSortMode` (only the legacy `AlbumSortMode` consults it,
in `mobile/lib/utils/migration.dart:151`), so menu order can change freely.

### Unused keys left in place

`sort_photo_count` and `sort_recently_updated` become unreferenced. They are deliberately **not** deleted:
removing them cleanly would mean editing ~90 locale files, and `CLAUDE.md` states the ~80 translator-owned
locales must not be hand-edited. Unused keys are inert.

## Behaviour specification

Written as scenarios so each maps to one test. "Album list" means a shared space's linked-album list on either
platform.

### Ordering

- **S1 — Title ascending.** _Given_ albums "beach", "Apple", "Zoo"; _when_ sorted by Title ascending; _then_ the
  order is Apple, beach, Zoo. Comparison is case-insensitive.
- **S2 — Direction flips.** _Given_ any option; _when_ the same option is re-selected; _then_ the direction
  inverts and the order reverses.
- **S3 — Selecting a new option applies its default direction.** _Given_ sort is Title (asc); _when_ the user
  picks Number of items; _then_ direction becomes descending, not ascending.
- **S4 — Number of items descending.** _Given_ albums Small (1 asset), Big (9), Mid (5); _when_ sorted by Number
  of items descending; _then_ the order is Big, Mid, Small.
- **S5 — Date modified descending.** _Given_ albums with `updatedAt` of Jan 3, Jan 1, Jan 2; _when_ sorted by
  Date modified descending; _then_ the newest `updatedAt` is first.
- **S6 — Date created is distinct from linked date.** _Given_ album Old (`createdAt` Jan 1, `linkedAt` Mar 1)
  and album New (`createdAt` Feb 1, `linkedAt` Feb 2); _when_ sorted by Date created descending; _then_ New is
  first — the opposite of the Recently linked order for the same two albums (see S9).
- **S7 — Most recent photo descending.** _Given_ album A whose newest photo is Jan 10 and album B whose newest
  is Jan 20 (B's oldest photo being Jan 1, earlier than A's); _when_ sorted by Most recent photo descending;
  _then_ B is first. The fixture deliberately makes the oldest-photo order the reverse, so a comparator wired to
  the wrong field fails.
- **S8 — Oldest photo ascending.** Same fixture as S7; _when_ sorted by Oldest photo ascending; _then_ B is
  first, because B's oldest photo (Jan 1) precedes A's.
- **S9 — Recently linked.** _Given_ the S6 fixture; _when_ sorted by Recently linked descending; _then_ Old is
  first. An album created long ago but linked today sorts first.

### Albums with no photo dates

Upstream's `sortUnknownYearAlbums` (`web/src/lib/utils/album-utils.ts:211`) pushes albums with no `endDate` to
the end **irrespective of sort direction**, and it is applied to both photo-date sorts — including
`OldestPhoto`, which orders by `startDate` but null-checks `endDate`. Web inherits this unchanged because the
fork layer delegates to it. Mobile must reproduce it.

- **S10 — Empty albums sort last, descending.** _Given_ one album with photos and one with none; _when_ sorted
  by Most recent photo descending; _then_ the empty album is last.
- **S11 — Empty albums sort last, ascending too.** Same setup, ascending; the empty album is _still_ last.
- **S12 — Same rule for Oldest photo**, both directions.
- **S13 — Null `localDateTime` counts as no date.** `remote_asset.localDateTime` is nullable
  (`remote_asset.entity.dart:39`), so `MIN`/`MAX` can be null even for an album that has assets. Such an album
  is treated exactly like an empty one for S10–S12, and its asset count is unaffected.
- **S14 — Every album lacking photo dates.** _Given_ three albums, none with photo dates; _when_ sorted by Most
  recent photo in either direction; _then_ no album is dropped or duplicated and the order is the platform's
  tiebreak order (S16). This is the branch where the "unknown last" rule fires for every element.

### Photo-date precision

The server derives album photo dates as a **UTC calendar day**, not a timestamp
(`server/src/repositories/album.repository.ts:236`):

```sql
MIN(("asset"."localDateTime" AT TIME ZONE 'UTC'::text)::date)
```

Mobile must truncate its `MIN`/`MAX` of `remote_asset.localDateTime` to the same UTC day, so both platforms sort
on an identical key. Without this, two albums whose newest photos fall on the same UTC day compare **equal on
web** but are **time-ordered on mobile** — a visible ordering difference on the very sorts being added for
parity.

- **S15 — Same-day albums tie.** _Given_ two albums whose newest photos are 09:00 and 17:00 on the same UTC day;
  _when_ sorted by Most recent photo; _then_ they compare equal and the tiebreak (S16) decides. Mobile must not
  order them by time of day.

### Tiebreaks

- **S16 — Mobile tiebreak is deterministic.** Equal sort keys tie-break by name, then id. Preserved from the
  current implementation.
- **S17 — Ties are common under the new default.** _Given_ several albums bulk-linked in one action, so their
  `linkedAt` values are identical; _when_ sorted by Recently linked (the new default); _then_ the order is
  stable and deterministic, not arbitrary.
- Web's tiebreak is the server's ordering, which `getLinkedAlbums` pins explicitly as
  `album.createdAt DESC, album.id ASC` (`server/src/repositories/shared-space.repository.ts:1018`); lodash
  `orderBy` and `Array.sort` are stable, so that ordering survives. Mobile ties break by name then id. This
  difference is accepted: both are deterministic, and the option sets and primary ordering match, which is what
  #966 asks for. Matching them would mean post-sorting the six delegated options and changing web behaviour for
  no user-visible benefit.

### Boundary inputs

- **S18 — Empty list.** Sorting zero albums returns zero albums, for every option and direction.
- **S19 — Single album.** Sorting one album returns it unchanged, for every option and direction.
- **S20 — `linkedAt` is per space.** _Given_ one album linked into space A on Jan 1 and space B on Mar 1; _when_
  each space's list is sorted by Recently linked; _then_ each uses its own link date. Mobile's query filters on
  `link.spaceId`; web's endpoint is already per-space.

### Accepted divergences

These are pre-existing, unchanged by this work, and recorded so they are informed omissions rather than
oversights:

- **Title collation.** Web sorts titles with `albumName.localeCompare(other, locale)` (`album-utils.ts:229`),
  which is locale-aware; mobile uses `toLowerCase().compareTo()` (`collection_sort.dart:45`), which is code-unit
  order. The two agree on ASCII but can disagree on diacritics and non-Latin scripts. Dart has no built-in
  locale collator, so closing this would mean pulling in a collation dependency — out of proportion to a sort
  label parity fix.
- **Search scope.** Web's filter matches album name **or description** (`space-albums-list.svelte:49`); mobile's
  matches name only (`collection_sort.dart:42`). #966 is about sort options; this is filed separately rather
  than folded in.
- **Photo-date corpus.** Web's `startDate`/`endDate` are server-computed over all album assets; mobile's are
  derived from locally synced assets. See "Mobile design". (The _precision_ half of this divergence is **not**
  accepted — mobile truncates to match; see S15.)

### Filtering

- **S21 — Search filters before sorting** and is case-insensitive, trimmed, literal-substring, with no
  diacritic folding. Unchanged behaviour; asserted to prevent regression.

### Selection, persistence, defaults

- **S22 — Fresh install opens on Recently linked, descending.**
- **S23 — A stored preference wins over the new default.**
- **S24 — A stored preference from before this change still loads.** A device with `recentlyUpdated` or
  `photoCount` persisted must load without error and show the relabelled option.
- **S25 — An unrecognised stored value falls back to the default instead of throwing** (slice M0).
- **S26 — An unrecognised `sortBy` resolves consistently on web.** _Given_ `localStorage` holds a `sortBy` that
  matches no option; _when_ the list renders; _then_ the pill label **and** the applied ordering are both
  `RecentlyLinked`.

  This needs stating because the two halves disagree by default: upstream's `sortAlbums` falls back to
  `DateModified` (`album-utils.ts:261`) while upstream's `findSortOptionMetadata` falls back to
  `MostRecentPhoto` (`album-utils.ts:94`) — so upstream shows one option's name while applying another's order.
  `sortSpaceAlbums` must therefore resolve an unknown key to `RecentlyLinked` **itself**, before delegating,
  rather than letting the delegate's own fallback apply.

### Grouping (web only)

- **S27 — Year grouping stays ENABLED for Recently linked.** Revised during implementation. The original
  reasoning was that Year buckets albums by photo date, so pairing it with a link-date sort is as incoherent as
  with Date created or Date modified, which upstream already disables. That is defensible in isolation, but
  Recently linked is now the _default_ sort, so disabling Year for it puts the most useful grouping out of reach
  until the user changes sort — a discoverability regression for every new user. The `spaces-albums` e2e suite
  caught it immediately: its Year-grouping test lands on the page with fresh storage and the option is disabled.
  Year buckets by photo year and orders within each bucket by the active sort, which reads fine as "2024 albums,
  most recently linked first". Only `DateCreated` and `DateModified` disable Year.
- **S28 — Grouped lists sort within each group** using the same comparator, including Recently linked.
- **S29 — No user gets stuck in a disabled combination.** `svelte-persisted-store` writes the whole settings
  object whenever any field changes, so anyone who had set `groupBy: Year` already has their `sortBy` persisted
  alongside it and keeps it. Only users who never touched any space-album view setting receive the new default,
  and those have `groupBy: None`.

## Web design

### Why not extend the upstream enum

Adding `RecentlyLinked` to `AlbumSortBy` and `sortOptionsMetadata` would be less code, but
`web/src/routes/(user)/albums/AlbumsControls.svelte:104` iterates that same metadata array. The option would
appear on the regular `/albums` page, where `AlbumResponseDto` has no `linkedAt` — a visible option that
silently does nothing. It would also introduce a fork diff into two files that are currently byte-identical to
`upstream/main`, creating a permanent rebase conflict surface. Rejected on correctness first, rebase hygiene
second.

### New fork-only module

`web/src/lib/utils/space-album-sort.ts`:

- `SpaceAlbumSortBy` — the six `AlbumSortBy` values plus `RecentlyLinked`.
- `spaceAlbumSortOptionsMetadata` — upstream's `sortOptionsMetadata` entries followed by a `RecentlyLinked`
  entry (`defaultOrder: Desc`), reusing upstream's `AlbumSortOptionMetadata` shape.
- `findSpaceAlbumSortOptionMetadata(sortBy)` — like upstream's finder but defaulting to `RecentlyLinked`.
- `sortSpaceAlbums(albums, { sortBy, orderBy })` — resolves `sortBy` through
  `findSpaceAlbumSortOptionMetadata` **first**, then handles `RecentlyLinked` with lodash `orderBy` on
  `new Date(linkedAt)` (the same shape upstream uses for `DateModified`) and delegates every other value to
  upstream's `sortAlbums`. Delegation is possible without any upstream change because `sortAlbums` accepts
  `sortBy: string` and `sortOptions` is a plain string-keyed record (`album-utils.ts:260`).

  Resolving before delegating is what makes S26 hold: passing an unknown key straight through would land on
  upstream's `DateModified` fallback while the pill showed `RecentlyLinked`.

  It is typed to take and return `SharedSpaceLinkedAlbumDto[]`, absorbing the `AlbumResponseDto` cast that the
  delegation requires. That removes the existing double `as unknown as` cast at
  `space-albums-list.svelte:54-57` rather than propagating it.

### Call-site changes

| File                                                         | Change                                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `web/src/lib/stores/space-album-view-settings.store.ts:22`   | Default `sortBy` → `RecentlyLinked`                                                                   |
| `web/src/lib/components/spaces/space-albums-controls.svelte` | Iterate `spaceAlbumSortOptionsMetadata`; add the `sort_recently_linked` label; widen the label record |
| `web/src/lib/components/spaces/space-albums-list.svelte:53`  | Call `sortSpaceAlbums`                                                                                |
| `web/src/lib/utils/space-album-grouping.ts:40`               | Add `RecentlyLinked` to the Year-disabled list                                                        |
| `web/src/lib/utils/space-album-grouping.ts:268`              | Per-group re-sort calls `sortSpaceAlbums`                                                             |

Two latent bugs in `space-albums-controls.svelte` must be fixed as part of this, or the seventh option renders
incorrectly:

- Line 80 uses upstream `findSortOptionMetadata`, which returns `MostRecentPhoto` for any unrecognised id. With
  `sortBy: 'RecentlyLinked'` the pill would display the wrong label. Must use
  `findSpaceAlbumSortOptionMetadata`.
- `albumSortByNames` is typed `Record<AlbumSortBy, string>` and indexed via `option.id as AlbumSortBy`
  (lines 86, 127, 144). The cast must be widened to the new union rather than left to lie about the seventh
  value.

**Not touched:** `album-utils.ts`, `preferences.store.ts`, `space-albums-table.svelte`.

## Mobile design

`SpaceAlbumRepository.watchLinkedAlbums` (`space_album.repository.dart:25`) already `LEFT JOIN`s
`remoteAssetEntity` through the membership table and `groupBy`s to compute `assetCount`. The two photo-date
aggregates come from that same grouped query — no extra statement, no extra round trip, and the stream stays
reactive.

| File                                                                 | Change                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `mobile/lib/domain/models/space_album.model.dart`                    | Add `createdAt`, nullable `startDate`, nullable `endDate`                                         |
| `mobile/lib/infrastructure/repositories/space_album.repository.dart` | Add `min`/`max` of `asset.localDateTime` to `addColumns`; project `meta.createdAt`                |
| `mobile/lib/pages/library/spaces/collection_sort.dart`               | Extend `SpaceAlbumSortMode` to seven; relabel; add three comparator arms and the empty-album rule |
| `mobile/lib/domain/models/value_codec.dart`                          | `EnumCodec.decode` falls back instead of throwing (slice M0)                                      |

The asset join carries the existing visibility predicate (`deletedAt IS NULL AND visibility IN (timeline,
archive)`). This matches the server exactly — `withDefaultVisibility` is
`visibility IN (Archive, Timeline)` (`server/src/utils/database.ts:159`) and `getMetadataForIds` adds
`asset.deletedAt IS NULL` — so the photo-date range covers the same assets the count already reflects, on both
platforms.

**Truncate to a UTC day.** The server's aggregate is `MIN/MAX(("asset"."localDateTime" AT TIME ZONE 'UTC')::date)`
(`album.repository.ts:236`), i.e. day precision. Mobile's `MIN`/`MAX` must be truncated the same way so both
platforms sort on an identical key (S15). Both platforms read the same underlying column, `localDateTime`, so
after truncation the keys agree.

**Known and accepted divergence:** web's `startDate`/`endDate` are computed server-side across all album assets;
mobile's cover locally synced assets only. On a partially synced device the two can disagree. Fixing this would
mean moving the surface to REST and losing offline support — not worth it. The option sets, the sort key
semantics and the precision all match; only the underlying corpus can lag.

## Implementation slices

Each slice is test-first: write the failing test, watch it fail for the right reason, implement, confirm green.

**W1 — Web sort module.** New `space-album-sort.spec.ts` → new `space-album-sort.ts`.

**W2 — Web store default.** `space-album-view-settings.store.spec.ts` → store change. Note the existing test is
named `defaults sort to MostRecentPhoto desc and group to None` (line 14) and must be renamed, not just
re-asserted.

**W3 — Web controls.** `space-albums-controls.spec.ts` → component change. Includes the pill showing the correct
label for `RecentlyLinked` (the `findSortOptionMetadata` bug). The existing test
`renders all six sort option labels when dropdown is opened` (line 73) becomes seven.

**W4 — Web list and grouping.** `space-albums-list.spec.ts` and `space-album-grouping.spec.ts` → call-site
changes.

**M0 — Harden `EnumCodec`.** Test that decoding an unrecognised name yields the default rather than throwing,
then add the fallback. Protects the downgrade path.

**M1 — Mobile model and query.** `space_album_repository_test.dart` (medium, real DB) → model and repository
changes: `createdAt` projection, truncated `MIN`/`MAX` over the visibility-filtered join, and an album with no
assets yielding nulls.

**M2 — Mobile sort modes.** `collection_sort_test.dart` → `collection_sort.dart`. The existing
`sort-mode enum shape` group (line 415) asserts per-mode `storeIndex`/`defaultOrder` and must grow to seven.

**M3 — Mobile page assertions.** `space_albums_page_test.dart`. The menu is built from
`SpaceAlbumSortMode.values` (`space_albums.page.dart:206`), so the three new options appear with no wiring
change; this slice updates the label assertions — the suite asserts the literal `'Sort: Photo count'`, which
becomes `'Sort: Number of items'`.

**M4 — Mobile persistence.** `app_config_test.dart` already asserts the default
(`c.spaceAlbums.sortMode == recentlyLinked`, line 10) and round-trips `SettingsKey.spaceAlbumsSortMode`
(lines 14–18). Extend it to the new modes and to the pre-change stored values.

Existing `SpaceAlbum` fixtures gain `createdAt`, so stubs under `mobile/test/` are updated with M1.

### Scenario coverage map

Every scenario has a named home; no row may be left blank at review time.

| Scenario                            | Web slice / file                             | Mobile slice / file                   |
| ----------------------------------- | -------------------------------------------- | ------------------------------------- |
| S1 Title asc                        | W1 `space-album-sort.spec.ts`                | M2 `collection_sort_test.dart`        |
| S2 Direction flips                  | W3 `space-albums-controls.spec.ts`           | M3 `space_albums_page_test.dart`      |
| S3 New option → default dir         | W3 `space-albums-controls.spec.ts`           | M3 `space_albums_page_test.dart`      |
| S4 Number of items                  | W1                                           | M2                                    |
| S5 Date modified                    | W1                                           | M2                                    |
| S6 Date created ≠ linked            | W1                                           | M2                                    |
| S7 Most recent photo                | W1                                           | M2                                    |
| S8 Oldest photo                     | W1                                           | M2                                    |
| S9 Recently linked                  | W1                                           | M2                                    |
| S10–S12 Empty albums last           | W1 + W4 `space-albums-list.spec.ts`          | M2                                    |
| S13 Null `localDateTime`            | n/a (server-computed)                        | M1 `space_album_repository_test.dart` |
| S14 All albums date-less            | W1                                           | M2                                    |
| S15 Same-day albums tie             | n/a (server truncates)                       | M1 + M2                               |
| S16 Mobile tiebreak                 | n/a                                          | M2                                    |
| S17 Identical `linkedAt`            | W1                                           | M2                                    |
| S18 Empty list                      | W1                                           | M2                                    |
| S19 Single album                    | W1                                           | M2                                    |
| S20 `linkedAt` per space            | n/a (endpoint is per-space)                  | M1                                    |
| S21 Search before sort              | W4                                           | M2                                    |
| S22 Fresh default                   | W2 `space-album-view-settings.store.spec.ts` | M4 `app_config_test.dart`             |
| S23 Stored beats default            | W2                                           | M4                                    |
| S24 Pre-change stored value         | W2                                           | M4                                    |
| S25 Unrecognised stored value       | n/a                                          | M0 `value_codec` test                 |
| S26 Unknown `sortBy` consistent     | W1 + W3                                      | n/a (enum-typed)                      |
| S27 Year enabled for RecentlyLinked | W4 `space-album-grouping.spec.ts`            | n/a (web-only)                        |
| S28 Sort within group               | W4                                           | n/a                                   |
| S29 No stuck combination            | W4                                           | n/a                                   |

## Out of scope

- **Web space-album table headers.** `space-albums-table.svelte:80` hardcodes four static, non-clickable
  `<th>`s, whereas `/albums` renders a clickable sort button per option (`AlbumsTableHeader.svelte:31`). This is
  web-internal parity, not web↔mobile parity — mobile has no table view. A follow-up issue will be filed.
- **Search-scope parity.** Web matches name or description, mobile matches name only. A separate follow-up.
- Server changes; the API already returns everything needed.
- Sorting the Spaces grid itself (`SpaceSortMode`), a different surface.
- Removing the two orphaned i18n keys.
- Title collation parity (see "Accepted divergences").
- **New E2E coverage.** An earlier draft of this spec claimed there was no Playwright coverage of the Spaces
  surface at all. That was wrong — it looked at `e2e/src/ui/specs` when the web specs live in
  `e2e/src/specs/web/`, where `spaces-albums.e2e-spec.ts` already covers the albums-tab controls including sort
  and grouping. No new e2e is added here; the existing suite already exercises this surface, and it is what
  caught the S27 problem (see S27). The correction is recorded rather than quietly edited out, because the
  original claim was used to justify not looking further.

## Verification gates

- Web: `pnpm test`, `pnpm check:typescript`, `pnpm check:svelte`, `pnpm lint`, prettier.
- Mobile: `flutter test`, `dart format`, `dart analyze --fatal-infos lib test` (both are separate CI gates).
- Docs: prettier over this file — CI Docs Build is strict about `docs/`.
