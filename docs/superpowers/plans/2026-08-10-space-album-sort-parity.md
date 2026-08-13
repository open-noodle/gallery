# Shared-Space Album Sort Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a shared space's linked-album list the same seven sort options, in the same order, with the same default, on web and mobile (issue #966).

**Architecture:** No server change — `GET /shared-spaces/{id}/albums` already returns every field needed. Web gains a fork-only sort layer (`space-album-sort.ts`) that adds `RecentlyLinked` and delegates the other six to upstream's `sortAlbums`, leaving upstream files byte-clean. Mobile derives `createdAt` and truncated photo-date aggregates from the Drift query that already runs, then extends its sort enum from four options to seven.

**Tech Stack:** SvelteKit 5 + vitest + @testing-library/svelte (web); Flutter/Dart + Drift + flutter_test (mobile); shared `i18n/` at repo root.

**Spec:** `docs/superpowers/specs/2026-08-10-space-album-sort-parity-design.md`. Scenario ids (S1–S29) below refer to its "Behaviour specification" section.

## Global Constraints

- **The unified contract is seven options in this exact order**, identical on both platforms: `Title` (`sort_title`, Asc), `ItemCount` (`sort_items`, Desc), `DateModified` (`sort_modified`, Desc), `DateCreated` (`sort_created`, Desc), `MostRecentPhoto` (`sort_recent`, Desc), `OldestPhoto` (`sort_oldest`, Desc), `RecentlyLinked` (`sort_recently_linked`, Desc).
- **Default sort on both platforms: `RecentlyLinked`, descending.**
- **Never rename an existing `SpaceAlbumSortMode` Dart identifier.** `EnumCodec` persists `value.name` and `decode` currently throws on an unknown name during app startup. `name`, `photoCount`, `recentlyUpdated`, `recentlyLinked` must keep their identifiers; only their labels change. New identifiers are `dateCreated`, `mostRecentPhoto`, `oldestPhoto`.
- **Do not modify `web/src/lib/utils/album-utils.ts` or `web/src/lib/stores/preferences.store.ts`.** They are byte-identical to `upstream/main` and must stay that way.
- **Do not modify `web/src/lib/components/spaces/space-albums-table.svelte`.** Out of scope.
- **No new i18n keys.** All seven already exist in all ten maintained locales. Do not delete the now-unused `sort_photo_count` / `sort_recently_updated`.
- **Mobile photo dates are truncated to a UTC calendar day** to match the server's `MIN/MAX((localDateTime AT TIME ZONE 'UTC')::date)`.
- **Commit after every task.** Never use `git stash` (shared across worktrees); never add `Co-Authored-By` / `Generated-with` trailers.

### One-time environment setup

Run once before Task 1; not part of any task's commit.

```bash
# Repo root. The web suite cannot resolve `@immich/sdk` until this is built.
pnpm install
pnpm --filter @immich/sdk build

# Mobile. Flutter is pinned to 3.44.8 in mobile/mise.toml; `mise install` can
# symlink a different patch, so invoke the pinned binaries directly if `flutter
# --version` disagrees:
#   ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter
cd mobile
flutter pub get
dart run easy_localization:generate -S ../i18n
dart run bin/generate_keys.dart
```

`mobile/lib/generated/*.g.dart` is gitignored; without those two `dart run` steps every mobile test fails to compile. Drift and OpenAPI generated code is committed, so `build_runner` is not needed.

### Verification gates (run before opening the PR)

```bash
cd web    && pnpm exec vitest run && pnpm check:typescript && pnpm check:svelte && pnpm lint
cd mobile && dart format --set-exit-if-changed lib test && dart analyze --fatal-infos lib test && flutter test
npx prettier --check docs/superpowers/**/*.md
```

`dart format` and `dart analyze --fatal-infos` are **two separate CI gates**; passing one does not imply the other.

---

## File Structure

**Web — create:**

- `web/src/lib/utils/space-album-sort.ts` — the fork-only seven-option metadata, the finder, and `sortSpaceAlbums`. Sole owner of "what sort options a space album list has".
- `web/src/lib/utils/space-album-sort.spec.ts` — unit tests for the above.

**Web — modify:**

- `web/src/lib/stores/space-album-view-settings.store.ts` — default `sortBy`.
- `web/src/lib/components/spaces/space-albums-controls.svelte` — render seven options; fix the wrong-label bug.
- `web/src/lib/components/spaces/space-albums-list.svelte` — call `sortSpaceAlbums`.
- `web/src/lib/utils/space-album-grouping.ts` — disable Year for `RecentlyLinked`; per-group sort via `sortSpaceAlbums`.

**Mobile — modify:**

- `mobile/lib/domain/models/value_codec.dart` — `EnumCodec` fallback instead of throw.
- `mobile/lib/domain/models/settings_key.dart` — declare the fallback for the two space sort keys.
- `mobile/lib/domain/models/space_album.model.dart` — `createdAt`, `startDate`, `endDate`.
- `mobile/lib/infrastructure/repositories/space_album.repository.dart` — project `createdAt`; add truncated `min`/`max` aggregates.
- `mobile/lib/pages/library/spaces/collection_sort.dart` — seven modes; three new comparator arms; empty-album rule.

---

## Task 1: Web sort module

Implements S1, S4–S12, S14, S17–S19, S26 (comparator half).

**Files:**

- Create: `web/src/lib/utils/space-album-sort.ts`
- Create: `web/src/lib/utils/space-album-sort.spec.ts`

**Interfaces:**

- Consumes: upstream `sortAlbums`, `sortOptionsMetadata`, `stringToSortOrder` from `$lib/utils/album-utils`; `AlbumSortBy`, `SortOrder` from `$lib/stores/preferences.store`.
- Produces:
  - `SpaceAlbumSortBy` — const object; `AlbumSortBy`'s six values plus `RecentlyLinked: 'RecentlyLinked'`.
  - `type SpaceAlbumSortOptionMetadata = { id: string; defaultOrder: SortOrder; columnStyle: string }`
  - `spaceAlbumSortOptionsMetadata: SpaceAlbumSortOptionMetadata[]` — seven entries in contract order.
  - `findSpaceAlbumSortOptionMetadata(sortBy: string): SpaceAlbumSortOptionMetadata`
  - `sortSpaceAlbums(albums: SharedSpaceLinkedAlbumDto[], opts: { sortBy: string; orderBy: string }): SharedSpaceLinkedAlbumDto[]`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/utils/space-album-sort.spec.ts`:

```ts
import type { SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { AlbumSortBy, SortOrder } from '$lib/stores/preferences.store';
import {
  SpaceAlbumSortBy,
  findSpaceAlbumSortOptionMetadata,
  sortSpaceAlbums,
  spaceAlbumSortOptionsMetadata,
} from '$lib/utils/space-album-sort';

const A = (o: Partial<SharedSpaceLinkedAlbumDto>): SharedSpaceLinkedAlbumDto => ({
  id: 'x',
  ownerId: 'owner-1',
  albumName: 'A',
  assetCount: 0,
  albumThumbnailAssetId: null,
  showInTimeline: true,
  addedById: null,
  linkedAt: '2026-01-01T00:00:00.000Z',
  description: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  shared: false,
  hasSharedLink: false,
  isActivityEnabled: false,
  ...o,
});

const names = (albums: SharedSpaceLinkedAlbumDto[]) => albums.map((a) => a.albumName);

describe('spaceAlbumSortOptionsMetadata', () => {
  it('lists the seven contract options in order', () => {
    expect(spaceAlbumSortOptionsMetadata.map(({ id }) => id)).toEqual([
      AlbumSortBy.Title,
      AlbumSortBy.ItemCount,
      AlbumSortBy.DateModified,
      AlbumSortBy.DateCreated,
      AlbumSortBy.MostRecentPhoto,
      AlbumSortBy.OldestPhoto,
      SpaceAlbumSortBy.RecentlyLinked,
    ]);
  });

  it('defaults Title to ascending and every other option to descending', () => {
    const byId = new Map(spaceAlbumSortOptionsMetadata.map((o) => [o.id, o.defaultOrder]));
    expect(byId.get(AlbumSortBy.Title)).toBe(SortOrder.Asc);
    for (const id of [
      AlbumSortBy.ItemCount,
      AlbumSortBy.DateModified,
      AlbumSortBy.DateCreated,
      AlbumSortBy.MostRecentPhoto,
      AlbumSortBy.OldestPhoto,
      SpaceAlbumSortBy.RecentlyLinked,
    ]) {
      expect(byId.get(id)).toBe(SortOrder.Desc);
    }
  });
});

describe('findSpaceAlbumSortOptionMetadata', () => {
  it('finds a known option', () => {
    expect(findSpaceAlbumSortOptionMetadata(AlbumSortBy.Title).id).toBe(AlbumSortBy.Title);
    expect(findSpaceAlbumSortOptionMetadata(SpaceAlbumSortBy.RecentlyLinked).id).toBe(SpaceAlbumSortBy.RecentlyLinked);
  });

  // S26
  it('falls back to RecentlyLinked for an unrecognised value', () => {
    expect(findSpaceAlbumSortOptionMetadata('NotASort').id).toBe(SpaceAlbumSortBy.RecentlyLinked);
    expect(findSpaceAlbumSortOptionMetadata('').id).toBe(SpaceAlbumSortBy.RecentlyLinked);
  });
});

describe('sortSpaceAlbums delegates the six upstream options', () => {
  // S1
  it('sorts by Title ascending, case-insensitively', () => {
    const albums = [A({ albumName: 'beach' }), A({ albumName: 'Apple' }), A({ albumName: 'Zoo' })];
    expect(names(sortSpaceAlbums(albums, { sortBy: AlbumSortBy.Title, orderBy: SortOrder.Asc }))).toEqual([
      'Apple',
      'beach',
      'Zoo',
    ]);
  });

  // S4
  it('sorts by Number of items descending', () => {
    const albums = [
      A({ albumName: 'Small', assetCount: 1 }),
      A({ albumName: 'Big', assetCount: 9 }),
      A({ albumName: 'Mid', assetCount: 5 }),
    ];
    expect(names(sortSpaceAlbums(albums, { sortBy: AlbumSortBy.ItemCount, orderBy: SortOrder.Desc }))).toEqual([
      'Big',
      'Mid',
      'Small',
    ]);
  });

  // S5
  it('sorts by Date modified descending', () => {
    const albums = [
      A({ albumName: 'Jan3', updatedAt: '2026-01-03T00:00:00.000Z' }),
      A({ albumName: 'Jan1', updatedAt: '2026-01-01T00:00:00.000Z' }),
      A({ albumName: 'Jan2', updatedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    expect(names(sortSpaceAlbums(albums, { sortBy: AlbumSortBy.DateModified, orderBy: SortOrder.Desc }))).toEqual([
      'Jan3',
      'Jan2',
      'Jan1',
    ]);
  });

  // S6 — createdAt order is the reverse of linkedAt order for this fixture
  it('sorts by Date created descending, independently of linkedAt', () => {
    const albums = [
      A({ albumName: 'Old', createdAt: '2026-01-01T00:00:00.000Z', linkedAt: '2026-03-01T00:00:00.000Z' }),
      A({ albumName: 'New', createdAt: '2026-02-01T00:00:00.000Z', linkedAt: '2026-02-02T00:00:00.000Z' }),
    ];
    expect(names(sortSpaceAlbums(albums, { sortBy: AlbumSortBy.DateCreated, orderBy: SortOrder.Desc }))).toEqual([
      'New',
      'Old',
    ]);
  });

  // S7 — B's newest is later than A's, but B's oldest is earlier than A's,
  // so a comparator wired to the wrong field produces the opposite order.
  it('sorts by Most recent photo descending', () => {
    const albums = [
      A({ albumName: 'A', startDate: '2026-01-05T00:00:00.000Z', endDate: '2026-01-10T00:00:00.000Z' }),
      A({ albumName: 'B', startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-20T00:00:00.000Z' }),
    ];
    expect(names(sortSpaceAlbums(albums, { sortBy: AlbumSortBy.MostRecentPhoto, orderBy: SortOrder.Desc }))).toEqual([
      'B',
      'A',
    ]);
  });

  // S8 — same fixture, opposite field. Descending is asserted too: it yields
  // ['A','B'] where MostRecentPhoto descending yields ['B','A'], so a
  // comparator reading endDate here would fail rather than coincidentally pass.
  it('sorts by Oldest photo in both directions', () => {
    const albums = () => [
      A({ albumName: 'A', startDate: '2026-01-05T00:00:00.000Z', endDate: '2026-01-10T00:00:00.000Z' }),
      A({ albumName: 'B', startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-20T00:00:00.000Z' }),
    ];
    expect(names(sortSpaceAlbums(albums(), { sortBy: AlbumSortBy.OldestPhoto, orderBy: SortOrder.Asc }))).toEqual([
      'B',
      'A',
    ]);
    expect(names(sortSpaceAlbums(albums(), { sortBy: AlbumSortBy.OldestPhoto, orderBy: SortOrder.Desc }))).toEqual([
      'A',
      'B',
    ]);
  });
});

describe('sortSpaceAlbums RecentlyLinked', () => {
  const albums = () => [
    A({ albumName: 'Old', createdAt: '2026-01-01T00:00:00.000Z', linkedAt: '2026-03-01T00:00:00.000Z' }),
    A({ albumName: 'New', createdAt: '2026-02-01T00:00:00.000Z', linkedAt: '2026-02-02T00:00:00.000Z' }),
  ];

  // S9
  it('puts the most recently linked album first when descending', () => {
    expect(
      names(sortSpaceAlbums(albums(), { sortBy: SpaceAlbumSortBy.RecentlyLinked, orderBy: SortOrder.Desc })),
    ).toEqual(['Old', 'New']);
  });

  // S2 (comparator half)
  it('reverses when ascending', () => {
    expect(
      names(sortSpaceAlbums(albums(), { sortBy: SpaceAlbumSortBy.RecentlyLinked, orderBy: SortOrder.Asc })),
    ).toEqual(['New', 'Old']);
  });

  // S17 — bulk-linked albums share a linkedAt; order must be stable, not arbitrary
  it('keeps a stable order for identical linkedAt values', () => {
    const tied = [
      A({ id: 'a', albumName: 'First', linkedAt: '2026-01-01T00:00:00.000Z' }),
      A({ id: 'b', albumName: 'Second', linkedAt: '2026-01-01T00:00:00.000Z' }),
      A({ id: 'c', albumName: 'Third', linkedAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const once = names(sortSpaceAlbums(tied, { sortBy: SpaceAlbumSortBy.RecentlyLinked, orderBy: SortOrder.Desc }));
    const twice = names(sortSpaceAlbums(tied, { sortBy: SpaceAlbumSortBy.RecentlyLinked, orderBy: SortOrder.Desc }));
    expect(once).toEqual(['First', 'Second', 'Third']);
    expect(twice).toEqual(once);
  });

  it('does not mutate the input array', () => {
    const input = albums();
    sortSpaceAlbums(input, { sortBy: SpaceAlbumSortBy.RecentlyLinked, orderBy: SortOrder.Desc });
    expect(names(input)).toEqual(['Old', 'New']);
  });
});

// S26 — the pill label and the applied ordering must agree
describe('sortSpaceAlbums unknown sortBy', () => {
  it('orders by RecentlyLinked, matching what the finder reports', () => {
    // updatedAt and linkedAt deliberately disagree, so falling through to
    // upstream's DateModified fallback produces the opposite order.
    const albums = [
      A({ albumName: 'ByUpdated', updatedAt: '2026-09-01T00:00:00.000Z', linkedAt: '2026-01-01T00:00:00.000Z' }),
      A({ albumName: 'ByLinked', updatedAt: '2026-01-01T00:00:00.000Z', linkedAt: '2026-09-01T00:00:00.000Z' }),
    ];
    expect(names(sortSpaceAlbums(albums, { sortBy: 'NotASort', orderBy: SortOrder.Desc }))).toEqual([
      'ByLinked',
      'ByUpdated',
    ]);
    expect(findSpaceAlbumSortOptionMetadata('NotASort').id).toBe(SpaceAlbumSortBy.RecentlyLinked);
  });
});

// S10–S12, S14
describe('sortSpaceAlbums albums without photo dates', () => {
  const mixed = () => [
    A({ albumName: 'Empty', startDate: undefined, endDate: undefined }),
    A({ albumName: 'HasPhotos', startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-10T00:00:00.000Z' }),
  ];

  it('puts the album with no photos last, descending (S10)', () => {
    expect(names(sortSpaceAlbums(mixed(), { sortBy: AlbumSortBy.MostRecentPhoto, orderBy: SortOrder.Desc }))).toEqual([
      'HasPhotos',
      'Empty',
    ]);
  });

  it('puts the album with no photos last, ascending too (S11)', () => {
    expect(names(sortSpaceAlbums(mixed(), { sortBy: AlbumSortBy.MostRecentPhoto, orderBy: SortOrder.Asc }))).toEqual([
      'HasPhotos',
      'Empty',
    ]);
  });

  it('applies the same rule to Oldest photo in both directions (S12)', () => {
    expect(names(sortSpaceAlbums(mixed(), { sortBy: AlbumSortBy.OldestPhoto, orderBy: SortOrder.Desc }))).toEqual([
      'HasPhotos',
      'Empty',
    ]);
    expect(names(sortSpaceAlbums(mixed(), { sortBy: AlbumSortBy.OldestPhoto, orderBy: SortOrder.Asc }))).toEqual([
      'HasPhotos',
      'Empty',
    ]);
  });

  it('keeps every album when none has photo dates (S14)', () => {
    const none = [A({ albumName: 'One' }), A({ albumName: 'Two' }), A({ albumName: 'Three' })];
    const sorted = sortSpaceAlbums(none, { sortBy: AlbumSortBy.MostRecentPhoto, orderBy: SortOrder.Desc });
    expect(sorted).toHaveLength(3);
    expect(new Set(names(sorted))).toEqual(new Set(['One', 'Two', 'Three']));
  });
});

// S18, S19
describe('sortSpaceAlbums boundary inputs', () => {
  const everyOption = spaceAlbumSortOptionsMetadata.map(({ id }) => id);

  it('returns an empty array for every option and direction', () => {
    for (const sortBy of everyOption) {
      for (const orderBy of [SortOrder.Asc, SortOrder.Desc]) {
        expect(sortSpaceAlbums([], { sortBy, orderBy })).toEqual([]);
      }
    }
  });

  it('returns a single album unchanged for every option and direction', () => {
    for (const sortBy of everyOption) {
      for (const orderBy of [SortOrder.Asc, SortOrder.Desc]) {
        expect(names(sortSpaceAlbums([A({ albumName: 'Only' })], { sortBy, orderBy }))).toEqual(['Only']);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm exec vitest run src/lib/utils/space-album-sort.spec.ts`
Expected: FAIL — `Failed to resolve import "$lib/utils/space-album-sort"`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/lib/utils/space-album-sort.ts`:

```ts
import type { AlbumResponseDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { orderBy } from 'lodash-es';
import { AlbumSortBy, SortOrder } from '$lib/stores/preferences.store';
import { sortAlbums, sortOptionsMetadata, stringToSortOrder } from '$lib/utils/album-utils';

/**
 * Space album lists offer everything the regular album list offers, plus
 * `RecentlyLinked` — when the album was linked into *this* space. That option
 * lives here rather than in upstream's `AlbumSortBy` on purpose: the regular
 * /albums page iterates upstream's `sortOptionsMetadata`, and `linkedAt` does
 * not exist on `AlbumResponseDto`, so adding it upstream would surface a dead
 * option there (and dirty a file we keep byte-clean for rebases).
 */
export const SpaceAlbumSortBy = {
  ...AlbumSortBy,
  RecentlyLinked: 'RecentlyLinked',
} as const;

export interface SpaceAlbumSortOptionMetadata {
  id: string;
  defaultOrder: SortOrder;
  columnStyle: string;
}

export const spaceAlbumSortOptionsMetadata: SpaceAlbumSortOptionMetadata[] = [
  ...sortOptionsMetadata,
  {
    id: SpaceAlbumSortBy.RecentlyLinked,
    defaultOrder: SortOrder.Desc,
    columnStyle: 'text-center hidden xl:block xl:w-[15%] 2xl:w-[12%]',
  },
];

const defaultSortOption = spaceAlbumSortOptionsMetadata.at(-1) as SpaceAlbumSortOptionMetadata;

export const findSpaceAlbumSortOptionMetadata = (sortBy: string): SpaceAlbumSortOptionMetadata =>
  spaceAlbumSortOptionsMetadata.find(({ id }) => id === sortBy) ?? defaultSortOption;

/**
 * Resolve `sortBy` through the finder *before* delegating. Upstream's
 * `sortAlbums` falls back to `DateModified` for an unknown key while upstream's
 * `findSortOptionMetadata` falls back to `MostRecentPhoto` — passing an unknown
 * key straight through would show one option's label while applying another's
 * order.
 */
export const sortSpaceAlbums = (
  albums: SharedSpaceLinkedAlbumDto[],
  { sortBy, orderBy: order }: { sortBy: string; orderBy: string },
): SharedSpaceLinkedAlbumDto[] => {
  const { id } = findSpaceAlbumSortOptionMetadata(sortBy);

  if (id === SpaceAlbumSortBy.RecentlyLinked) {
    return orderBy(albums, [({ linkedAt }) => new Date(linkedAt)], [stringToSortOrder(order)]);
  }

  return sortAlbums(albums as unknown as AlbumResponseDto[], {
    sortBy: id,
    orderBy: order,
  }) as unknown as SharedSpaceLinkedAlbumDto[];
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm exec vitest run src/lib/utils/space-album-sort.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/utils/space-album-sort.ts web/src/lib/utils/space-album-sort.spec.ts
git commit -m "feat(web): add fork-only space album sort layer with Recently linked (#966)"
```

---

## Task 2: Web store default

Implements S22, S23.

**Files:**

- Modify: `web/src/lib/stores/space-album-view-settings.store.ts:22`
- Test: `web/src/lib/stores/space-album-view-settings.store.spec.ts:14`

**Interfaces:**

- Consumes: `SpaceAlbumSortBy` from Task 1.
- Produces: `spaceAlbumViewSettings` store whose default `sortBy` is `'RecentlyLinked'`.

- [ ] **Step 1: Write the failing test**

In `web/src/lib/stores/space-album-view-settings.store.spec.ts`, add the import and replace the existing `defaults sort to MostRecentPhoto desc and group to None` test (line 14) with:

```ts
import { SpaceAlbumSortBy } from '$lib/utils/space-album-sort';
```

```ts
it('defaults sort to RecentlyLinked desc and group to None', () => {
  const s = get(spaceAlbumViewSettings);
  expect(s.sortBy).toBe(SpaceAlbumSortBy.RecentlyLinked);
  expect(s.sortOrder).toBe(SortOrder.Desc);
  expect(s.groupBy).toBe(SpaceAlbumGroupBy.None);
  expect(s.collapsedGroups).toEqual({});
});

// S23 — a stored preference must survive the default change.
//
// `persisted()` reads localStorage once, when the module is evaluated. Writing
// to localStorage afterwards and calling `.update()` does NOT re-read it — this
// was verified empirically against this repo: the naive version leaves sortBy at
// the default and fails. The store must be re-imported after seeding storage.
//
// Keep this test LAST in the file: vi.resetModules() means later tests would
// otherwise get a different store instance than the one imported at the top.
it('prefers a stored sortBy over the new default', async () => {
  localStorage.setItem(
    'space-album-view-settings',
    JSON.stringify({
      view: AlbumViewMode.Cover,
      sortBy: AlbumSortBy.Title,
      sortOrder: SortOrder.Asc,
      groupBy: SpaceAlbumGroupBy.None,
      groupOrder: SortOrder.Desc,
      collapsedGroups: {},
    }),
  );
  vi.resetModules();
  const reloaded = await import('$lib/stores/space-album-view-settings.store');
  expect(get(reloaded.spaceAlbumViewSettings).sortBy).toBe(AlbumSortBy.Title);
  expect(get(reloaded.spaceAlbumViewSettings).sortOrder).toBe(SortOrder.Asc);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm exec vitest run src/lib/stores/space-album-view-settings.store.spec.ts`
Expected: FAIL — `expected 'MostRecentPhoto' to be 'RecentlyLinked'`.

- [ ] **Step 3: Write minimal implementation**

In `web/src/lib/stores/space-album-view-settings.store.ts`, change the import line and the default:

```ts
import { persisted } from 'svelte-persisted-store';
import { AlbumViewMode, SortOrder } from '$lib/stores/preferences.store';
import { SpaceAlbumSortBy } from '$lib/utils/space-album-sort';
```

```ts
export const spaceAlbumViewSettings = persisted<SpaceAlbumViewSettings>('space-album-view-settings', {
  view: AlbumViewMode.Cover,
  sortBy: SpaceAlbumSortBy.RecentlyLinked,
  sortOrder: SortOrder.Desc,
  groupBy: SpaceAlbumGroupBy.None,
  groupOrder: SortOrder.Desc,
  collapsedGroups: {},
});
```

`AlbumSortBy` is no longer referenced in this file — remove it from the import to keep `pnpm lint` (zero-warnings) green.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm exec vitest run src/lib/stores/space-album-view-settings.store.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/stores/space-album-view-settings.store.ts web/src/lib/stores/space-album-view-settings.store.spec.ts
git commit -m "feat(web): default space album sort to Recently linked (#966)"
```

---

## Task 3: Web controls

Implements S2, S3, and the label half of S26.

**Files:**

- Modify: `web/src/lib/components/spaces/space-albums-controls.svelte` (lines 2–4, 45, 80, 86–93, 127, 136, 144)
- Test: `web/src/lib/components/spaces/space-albums-controls.spec.ts`

**Interfaces:**

- Consumes: `spaceAlbumSortOptionsMetadata`, `findSpaceAlbumSortOptionMetadata`, `SpaceAlbumSortBy`, `type SpaceAlbumSortOptionMetadata` from Task 1.

- [ ] **Step 1: Write the failing test**

In `web/src/lib/components/spaces/space-albums-controls.spec.ts`: add the import, change `freshSpaceSettings()` to the new default, rename the six-label test, and add the label-correctness test.

```ts
import { SpaceAlbumSortBy } from '$lib/utils/space-album-sort';
```

```ts
const freshSpaceSettings = () => ({
  view: AlbumViewMode.Cover,
  sortBy: SpaceAlbumSortBy.RecentlyLinked,
  sortOrder: SortOrder.Desc,
  groupBy: SpaceAlbumGroupBy.None,
  groupOrder: SortOrder.Desc,
  collapsedGroups: {},
});
```

Replace the `renders all six sort option labels when dropdown is opened` test with:

```ts
it('renders all seven sort option labels when dropdown is opened', async () => {
  render(SpaceAlbumsControls);
  await userEvent.click(screen.getByTestId('space-albums-sort-btn'));
  const menu = screen.getByTestId('space-albums-sort-menu');
  expect(within(menu).getByText('Title')).toBeInTheDocument();
  expect(within(menu).getByText('Number of items')).toBeInTheDocument();
  expect(within(menu).getByText('Date modified')).toBeInTheDocument();
  expect(within(menu).getByText('Date created')).toBeInTheDocument();
  expect(within(menu).getByText('Most recent photo')).toBeInTheDocument();
  expect(within(menu).getByText('Oldest photo')).toBeInTheDocument();
  expect(within(menu).getByText('Recently linked')).toBeInTheDocument();
});

it('writes RecentlyLinked to the space store when "Recently linked" is selected', async () => {
  spaceAlbumViewSettings.set({ ...freshSpaceSettings(), sortBy: AlbumSortBy.Title, sortOrder: SortOrder.Asc });
  render(SpaceAlbumsControls);
  await userEvent.click(screen.getByTestId('space-albums-sort-btn'));
  await userEvent.click(screen.getByTestId('space-albums-sort-option-RecentlyLinked'));
  expect(get(spaceAlbumViewSettings).sortBy).toBe(SpaceAlbumSortBy.RecentlyLinked);
  // S3 — a newly selected option applies its own default direction
  expect(get(spaceAlbumViewSettings).sortOrder).toBe(SortOrder.Desc);
});

// The trigger previously resolved its label through upstream's
// findSortOptionMetadata, which falls back to MostRecentPhoto for any id it
// does not know — so RecentlyLinked rendered as "Most recent photo".
it('shows the Recently linked label on the trigger when that option is active', () => {
  spaceAlbumViewSettings.set({ ...freshSpaceSettings(), sortBy: SpaceAlbumSortBy.RecentlyLinked });
  render(SpaceAlbumsControls);
  expect(screen.getByTestId('space-albums-sort-btn')).toHaveTextContent('Recently linked');
});

// S2
it('toggles sort order when Recently linked is re-selected', async () => {
  spaceAlbumViewSettings.set({
    ...freshSpaceSettings(),
    sortBy: SpaceAlbumSortBy.RecentlyLinked,
    sortOrder: SortOrder.Desc,
  });
  render(SpaceAlbumsControls);
  await userEvent.click(screen.getByTestId('space-albums-sort-btn'));
  await userEvent.click(screen.getByTestId('space-albums-sort-option-RecentlyLinked'));
  expect(get(spaceAlbumViewSettings).sortOrder).toBe(SortOrder.Asc);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm exec vitest run src/lib/components/spaces/space-albums-controls.spec.ts`
Expected: FAIL — `Unable to find an element by: [data-testid="space-albums-sort-option-RecentlyLinked"]`.

- [ ] **Step 3: Write minimal implementation**

In `web/src/lib/components/spaces/space-albums-controls.svelte`:

Replace the album-utils import (line 4) with the fork-only one:

```svelte
  import {
    type SpaceAlbumSortOptionMetadata,
    SpaceAlbumSortBy,
    findSpaceAlbumSortOptionMetadata,
    spaceAlbumSortOptionsMetadata,
  } from '$lib/utils/space-album-sort';
```

Change `handleChangeSortBy`'s parameter type (line 45):

```svelte
  const handleChangeSortBy = ({ id, defaultOrder }: SpaceAlbumSortOptionMetadata) => {
```

Change the derived selection (line 80):

```svelte
  let selectedSortOption = $derived(findSpaceAlbumSortOptionMetadata($spaceAlbumViewSettings.sortBy));
```

Replace the label record (lines 86–93):

```svelte
  let albumSortByNames: Record<string, string> = $derived({
    [SpaceAlbumSortBy.Title]: $t('sort_title'),
    [SpaceAlbumSortBy.ItemCount]: $t('sort_items'),
    [SpaceAlbumSortBy.DateModified]: $t('sort_modified'),
    [SpaceAlbumSortBy.DateCreated]: $t('sort_created'),
    [SpaceAlbumSortBy.MostRecentPhoto]: $t('sort_recent'),
    [SpaceAlbumSortBy.OldestPhoto]: $t('sort_oldest'),
    [SpaceAlbumSortBy.RecentlyLinked]: $t('sort_recently_linked'),
  });
```

Drop the now-invalid casts at the two usage sites (lines 127 and 144):

```svelte
        <span class="hidden sm:inline">{albumSortByNames[selectedSortOption.id]}</span>
```

```svelte
              {albumSortByNames[option.id]}
```

And iterate the fork-only metadata (line 136):

```svelte
          {#each spaceAlbumSortOptionsMetadata as option (option.id)}
```

`AlbumSortBy` is still imported from `preferences.store` for other uses in this file; if `pnpm lint` reports it unused after these edits, remove it from the import.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm exec vitest run src/lib/components/spaces/space-albums-controls.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/spaces/space-albums-controls.svelte web/src/lib/components/spaces/space-albums-controls.spec.ts
git commit -m "feat(web): offer Recently linked in the space album sort menu (#966)"
```

---

## Task 4: Web list and grouping

Implements S21, S27, S28, S29, and S10–S12 at the list level.

**Files:**

- Modify: `web/src/lib/components/spaces/space-albums-list.svelte:53-58`
- Modify: `web/src/lib/utils/space-album-grouping.ts:40`, `:268-274`
- Test: `web/src/lib/utils/space-album-grouping.spec.ts`
- Test: `web/src/lib/components/spaces/space-albums-list.spec.ts`

**Interfaces:**

- Consumes: `sortSpaceAlbums`, `SpaceAlbumSortBy` from Task 1.

- [ ] **Step 1: Write the failing test**

In `web/src/lib/utils/space-album-grouping.spec.ts`, add the import and these tests:

Add `spaceGroupOptionsMetadata` to the file's **existing** `$lib/utils/space-album-grouping` import rather than adding a second import statement for the same module (ESLint's zero-warning policy flags duplicate imports), and add one new import:

```ts
import { SpaceAlbumSortBy } from '$lib/utils/space-album-sort';
```

```ts
// S27
describe('Year grouping availability', () => {
  const yearOption = () => spaceGroupOptionsMetadata.find(({ id }) => id === SpaceAlbumGroupBy.Year)!;

  it('is disabled while sorting by Recently linked', () => {
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: SpaceAlbumSortBy.RecentlyLinked }));
    expect(yearOption().isDisabled()).toBe(true);
  });

  it('stays disabled for Date created and Date modified', () => {
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.DateCreated }));
    expect(yearOption().isDisabled()).toBe(true);
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.DateModified }));
    expect(yearOption().isDisabled()).toBe(true);
  });

  it('is enabled for the photo-date sorts', () => {
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.MostRecentPhoto }));
    expect(yearOption().isDisabled()).toBe(false);
    spaceAlbumViewSettings.update((s) => ({ ...s, sortBy: AlbumSortBy.OldestPhoto }));
    expect(yearOption().isDisabled()).toBe(false);
  });
});

// S28
describe('grouped lists sort within each group by Recently linked', () => {
  it('orders each group by linkedAt descending', () => {
    const settings = {
      ...get(spaceAlbumViewSettings),
      groupBy: SpaceAlbumGroupBy.Owner,
      sortBy: SpaceAlbumSortBy.RecentlyLinked,
      sortOrder: SortOrder.Desc,
    };
    const albums = [
      A({ id: '1', albumName: 'OwnerA-Early', ownerId: 'a', linkedAt: '2026-01-01T00:00:00Z' }),
      A({ id: '2', albumName: 'OwnerA-Late', ownerId: 'a', linkedAt: '2026-06-01T00:00:00Z' }),
    ];
    // buildSpaceAlbumGroups returns SpaceAlbumGroup[] = { id, name, albums }.
    // Owner grouping keys the group by ownerId, so select it by id rather than
    // by album count — a length-based lookup would silently pick the wrong
    // group if grouping ever changed.
    const groups = buildSpaceAlbumGroups(albums, settings, CTX);
    const ownerAGroup = groups.find((g) => g.id === 'a');
    expect(ownerAGroup?.albums.map((a) => a.albumName)).toEqual(['OwnerA-Late', 'OwnerA-Early']);
  });
});
```

In `web/src/lib/components/spaces/space-albums-list.spec.ts`, add a list-level ordering test (place it beside the existing render tests, reusing that file's `makeAlbum` factory and its render harness):

```ts
// S10 at list level — the empty album renders last even though the sort is
// descending. `canManage` is a REQUIRED prop on this component; omitting it
// breaks the render.
it('renders albums with no photos last when sorting by Most recent photo', async () => {
  spaceAlbumViewSettings.update((s) => ({
    ...s,
    sortBy: AlbumSortBy.MostRecentPhoto,
    sortOrder: SortOrder.Desc,
    groupBy: SpaceAlbumGroupBy.None,
  }));
  render(SpaceAlbumsList, {
    props: {
      spaceId: 'space-1',
      canManage: false,
      albums: [
        makeAlbum({ id: 'empty', albumName: 'Empty', startDate: undefined, endDate: undefined }),
        makeAlbum({
          id: 'full',
          albumName: 'HasPhotos',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-01-10T00:00:00.000Z',
        }),
      ],
      members: [] as SharedSpaceMemberResponseDto[],
    },
  });

  // Assert DOM order via the card testid rather than a text regex, so the
  // assertion cannot be satisfied by incidental matches elsewhere in the tree.
  await waitFor(() => expect(screen.getAllByTestId('space-album-card')).toHaveLength(2));
  const order = screen.getAllByTestId('space-album-card').map((card) => card.textContent);
  expect(order[0]).toContain('HasPhotos');
  expect(order[1]).toContain('Empty');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm exec vitest run src/lib/utils/space-album-grouping.spec.ts src/lib/components/spaces/space-albums-list.spec.ts`
Expected: FAIL — `expected false to be true` on the Recently-linked Year-disabled test.

- [ ] **Step 3: Write minimal implementation**

In `web/src/lib/utils/space-album-grouping.ts`, add the import, extend the disabled list (line 40), and switch the per-group sort (around line 268):

```ts
import { sortSpaceAlbums, SpaceAlbumSortBy } from '$lib/utils/space-album-sort';
```

```ts
    isDisabled() {
      const disabledWithSortOptions: string[] = [
        AlbumSortBy.DateCreated,
        AlbumSortBy.DateModified,
        SpaceAlbumSortBy.RecentlyLinked,
      ];
      return disabledWithSortOptions.includes(get(spaceAlbumViewSettings).sortBy);
    },
```

Replace the `sortAlbums(...)` call in the per-group re-sort with `sortSpaceAlbums(...)`, dropping the `AlbumResponseDto` casts that call site currently needs.

In `web/src/lib/components/spaces/space-albums-list.svelte`, replace lines 53–58 with:

```svelte
  const sorted = $derived(
    sortSpaceAlbums(filtered, {
      sortBy: $spaceAlbumViewSettings.sortBy,
      orderBy: $spaceAlbumViewSettings.sortOrder,
    }),
  );
```

and update its imports: drop `sortAlbums` from `$lib/utils/album-utils` and the now-unused `AlbumResponseDto` type import, adding `import { sortSpaceAlbums } from '$lib/utils/space-album-sort';`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm exec vitest run src/lib/utils/space-album-grouping.spec.ts src/lib/components/spaces/space-albums-list.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole web suite and the type gates**

Run: `cd web && pnpm exec vitest run && pnpm check:typescript && pnpm check:svelte && pnpm lint`
Expected: all green. `check:svelte` can scan zero files locally — if it reports 0 files, rely on CI for that gate and note it.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/components/spaces/space-albums-list.svelte web/src/lib/components/spaces/space-albums-list.spec.ts web/src/lib/utils/space-album-grouping.ts web/src/lib/utils/space-album-grouping.spec.ts
git commit -m "feat(web): apply the space album sort layer to the list and groups (#966)"
```

---

## Task 5: Harden `EnumCodec` against unknown stored values

Implements S25. This protects the downgrade path that Task 7 creates by adding new enum values.

**Files:**

- Modify: `mobile/lib/domain/models/value_codec.dart:36-46`
- Modify: `mobile/lib/domain/models/settings_key.dart:44,46`
- Test: `mobile/test/domain/models/value_codec_test.dart` (create if absent)

**Interfaces:**

- Produces: `EnumCodec<T>(List<T> values, {T? fallback})` whose `decode` returns `fallback ?? values.first` instead of throwing.

- [ ] **Step 1: Write the failing test**

Create (or extend) `mobile/test/domain/models/value_codec_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/value_codec.dart';
import 'package:immich_mobile/pages/library/spaces/collection_sort.dart';

void main() {
  group('EnumCodec', () {
    test('round-trips a known value', () {
      const codec = EnumCodec(SpaceAlbumSortMode.values);
      expect(codec.encode(SpaceAlbumSortMode.photoCount), 'photoCount');
      expect(codec.decode('photoCount'), SpaceAlbumSortMode.photoCount);
    });

    // S25 — a value written by a newer build must not crash an older one at
    // startup. CachedKeyValueRepository._build calls decode unguarded and
    // SettingsRepository.ensureInitialized awaits it during app launch.
    test('returns the declared fallback for an unrecognised name', () {
      const codec = EnumCodec(SpaceAlbumSortMode.values, fallback: SpaceAlbumSortMode.recentlyLinked);
      expect(codec.decode('aModeFromTheFuture'), SpaceAlbumSortMode.recentlyLinked);
      expect(codec.decode(''), SpaceAlbumSortMode.recentlyLinked);
    });

    test('falls back to the first value when no fallback is declared', () {
      const codec = EnumCodec(SpaceAlbumSortMode.values);
      expect(codec.decode('nope'), SpaceAlbumSortMode.values.first);
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && flutter test test/domain/models/value_codec_test.dart`
Expected: FAIL — first on the compile error `No named parameter with the name 'fallback'`.

- [ ] **Step 3: Write minimal implementation**

In `mobile/lib/domain/models/value_codec.dart`:

```dart
final class EnumCodec<T extends Enum> extends ValueCodec<T> {
  final List<T> values;

  /// Value returned when a persisted name matches no enum value — e.g. after a
  /// downgrade, where an older build reads a mode a newer build wrote. Without
  /// this, `decode` threw `StateError` and `SettingsRepository`'s unguarded
  /// startup `refresh()` turned that into a launch crash.
  final T? fallback;

  const EnumCodec(this.values, {this.fallback});

  @override
  String encode(T value) => value.name;

  @override
  T decode(String raw) => values.firstWhere((v) => v.name == raw, orElse: () => fallback ?? values.first);
}
```

In `mobile/lib/domain/models/settings_key.dart`, declare the fallbacks so the space keys land on their real defaults rather than `values.first`:

```dart
  spaceAlbumsSortMode<SpaceAlbumSortMode>(
    codec: EnumCodec(SpaceAlbumSortMode.values, fallback: SpaceAlbumSortMode.recentlyLinked),
  ),
  spaceAlbumsIsReverse<bool>(),
  spacesSortMode<SpaceSortMode>(codec: EnumCodec(SpaceSortMode.values, fallback: SpaceSortMode.recentActivity)),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && flutter test test/domain/models/value_codec_test.dart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/domain/models/value_codec.dart mobile/lib/domain/models/settings_key.dart mobile/test/domain/models/value_codec_test.dart
git commit -m "fix(mobile): fall back instead of crashing on an unknown persisted enum (#966)"
```

---

## Task 6: Mobile model and query

Implements S13, S15 (query half), S20.

**Files:**

- Modify: `mobile/lib/domain/models/space_album.model.dart`
- Modify: `mobile/lib/infrastructure/repositories/space_album.repository.dart:25-72`
- Test: `mobile/test/medium/repositories/space_album_repository_test.dart`
- Modify (fixtures, compile-driven): `mobile/test/pages/library/spaces/collection_sort_test.dart`, `mobile/test/providers/infrastructure/collection_dispatch_test.dart`, `mobile/test/presentation/pages/space_detail_top_sliver_test.dart`, `mobile/test/presentation/pages/space_album_detail_page_test.dart`, `mobile/test/presentation/pages/space_albums_link_wiring_test.dart`, `mobile/test/presentation/pages/space_albums_page_test.dart`, `mobile/test/presentation/pages/space_b6_mutations_test.dart`, `mobile/test/presentation/widgets/collection/space_collection_section_test.dart`, `mobile/test/presentation/widgets/spaces/space_albums_shelf_test.dart`

**Interfaces:**

- Produces: `SpaceAlbum` with `required DateTime createdAt`, `DateTime? startDate`, `DateTime? endDate`, where the two date fields are truncated to a UTC calendar day.

- [ ] **Step 1: Write the failing test**

Add to the `watchLinkedAlbums` group in `mobile/test/medium/repositories/space_album_repository_test.dart`:

```dart
    test('projects the album createdAt from the metadata row', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'Hawaii', createdAt: DateTime.utc(2025, 6, 1));
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id);

      final albums = await repo.watchLinkedAlbums(space.id).first;
      expect(albums.single.createdAt, album.createdAt);
    });

    test('derives startDate/endDate from the album assets, truncated to a UTC day', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'Hawaii');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id);

      for (final at in [
        DateTime.utc(2026, 1, 5, 9, 30),
        DateTime.utc(2026, 1, 20, 17, 45),
        DateTime.utc(2026, 1, 12, 3, 0),
      ]) {
        final asset = await ctx.newRemoteAsset(ownerId: user.id, createdAt: at);
        await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset.id);
      }

      final albums = await repo.watchLinkedAlbums(space.id).first;
      // S15 — day precision, matching the server's ::date cast. Times of day gone.
      expect(albums.single.startDate, DateTime.utc(2026, 1, 5));
      expect(albums.single.endDate, DateTime.utc(2026, 1, 20));
    });

    test('leaves startDate/endDate null for an album with no assets', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'Empty');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id);

      final albums = await repo.watchLinkedAlbums(space.id).first;
      expect(albums.single.assetCount, 0);
      expect(albums.single.startDate, isNull);
      expect(albums.single.endDate, isNull);
    });

    test('excludes deleted and hidden assets from the date range', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'Hawaii');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id);

      final visible = await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime.utc(2026, 1, 10));
      final deleted = await ctx.newRemoteAsset(
        ownerId: user.id,
        createdAt: DateTime.utc(2026, 5, 1),
        deletedAt: DateTime.utc(2026, 5, 2),
      );
      final hidden = await ctx.newRemoteAsset(
        ownerId: user.id,
        createdAt: DateTime.utc(2026, 6, 1),
        visibility: AssetVisibility.hidden,
      );
      for (final a in [visible, deleted, hidden]) {
        await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: a.id);
      }

      final albums = await repo.watchLinkedAlbums(space.id).first;
      expect(albums.single.assetCount, 1);
      expect(albums.single.endDate, DateTime.utc(2026, 1, 10));
    });

    // S20
    test('reports the per-space link date when an album is linked to two spaces', () async {
      final user = await ctx.newUser();
      final s1 = await ctx.newSharedSpace(createdById: user.id);
      final s2 = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'Shared');
      await ctx.insertSharedSpaceAlbumLink(spaceId: s1.id, albumId: album.id, createdAt: DateTime.utc(2026, 1, 1));
      await ctx.insertSharedSpaceAlbumLink(spaceId: s2.id, albumId: album.id, createdAt: DateTime.utc(2026, 3, 1));

      final inS1 = await repo.watchLinkedAlbums(s1.id).first;
      final inS2 = await repo.watchLinkedAlbums(s2.id).first;
      expect(inS1.single.linkedAt, isNot(inS2.single.linkedAt));
    });
```

No helper changes are needed: `insertSharedSpaceAlbumLink` already accepts `createdAt` (`mobile/test/medium/repository_context.dart:484`), `newSharedSpaceAlbum` already accepts `createdAt` (`:460`), and `newRemoteAsset` sets `localDateTime` from the `createdAt` you pass (`:137`), so passing `createdAt:` is how you control an asset's photo date.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && flutter test test/medium/repositories/space_album_repository_test.dart`
Expected: FAIL — compile error, `The getter 'createdAt' isn't defined for the type 'SpaceAlbum'`.

- [ ] **Step 3: Write minimal implementation**

`mobile/lib/domain/models/space_album.model.dart`:

```dart
class SpaceAlbum {
  final String id;
  final String name;
  final String? thumbnailAssetId;
  final bool showInTimeline;
  final int assetCount;
  final DateTime linkedAt;
  final DateTime updatedAt;
  final DateTime createdAt;

  /// Oldest / newest photo in the album, truncated to a UTC calendar day to
  /// match the server's `MIN/MAX((localDateTime AT TIME ZONE 'UTC')::date)`.
  /// Null when the album has no visible assets, or when none of them carries a
  /// `localDateTime`.
  final DateTime? startDate;
  final DateTime? endDate;

  const SpaceAlbum({
    required this.id,
    required this.name,
    this.thumbnailAssetId,
    required this.showInTimeline,
    this.assetCount = 0,
    required this.linkedAt,
    required this.updatedAt,
    required this.createdAt,
    this.startDate,
    this.endDate,
  });
}
```

`mobile/lib/infrastructure/repositories/space_album.repository.dart` — add the aggregates and the mapper helper:

```dart
    final assetCountExp = asset.id.count();
    final minDateExp = asset.localDateTime.min();
    final maxDateExp = asset.localDateTime.max();
```

```dart
          ..addColumns([assetCountExp, minDateExp, maxDateExp])
```

```dart
        return SpaceAlbum(
          id: m.id,
          name: m.name,
          thumbnailAssetId: m.thumbnailAssetId,
          showInTimeline: l.showInTimeline,
          assetCount: row.read(assetCountExp) ?? 0,
          linkedAt: l.createdAt,
          updatedAt: m.updatedAt,
          createdAt: m.createdAt,
          startDate: _utcDay(row.read(minDateExp)),
          endDate: _utcDay(row.read(maxDateExp)),
        );
```

and at file scope:

```dart
/// Truncate to a UTC calendar day so the sort key matches the server's
/// `::date` cast (see the #966 design spec). Truncating in Dart rather than SQL
/// keeps this independent of how Drift stores `DateTime`.
DateTime? _utcDay(DateTime? value) {
  if (value == null) {
    return null;
  }
  final utc = value.toUtc();
  return DateTime.utc(utc.year, utc.month, utc.day);
}
```

- [ ] **Step 4: Fix every `SpaceAlbum(...)` construction site the compiler reports**

Run: `cd mobile && dart analyze lib test`

`createdAt` is now required, so each site listed under **Files** above needs it. Most are inside a single test factory, so one edit covers many call sites. Use a value that keeps each test's intent — for fixtures where creation date is irrelevant, mirror the existing `updatedAt`:

```dart
    createdAt: DateTime.utc(2026, 1, 1),
```

For `mobile/test/pages/library/spaces/collection_sort_test.dart`, give the six `sample` entries distinct `createdAt` values so Task 7 can assert Date-created ordering, and add `createdAt` (plus optional `startDate`/`endDate`) parameters to its `_album` helper.

For `mobile/test/presentation/pages/space_albums_page_test.dart`, add `createdAt` to its `_album` helper — Task 8 reuses that helper.

Repeat `dart analyze lib test` until clean.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mobile && flutter test test/medium/repositories/space_album_repository_test.dart`
Expected: PASS.

Run: `cd mobile && flutter test`
Expected: PASS — the fixture updates must leave the whole suite green.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/domain/models/space_album.model.dart mobile/lib/infrastructure/repositories/space_album.repository.dart mobile/test
git commit -m "feat(mobile): expose album createdAt and photo date range on SpaceAlbum (#966)"
```

---

## Task 7: Mobile sort modes

Implements S1–S12, S14–S19, S21 on mobile.

**Files:**

- Modify: `mobile/lib/pages/library/spaces/collection_sort.dart:6-19`, `:47-67`
- Test: `mobile/test/pages/library/spaces/collection_sort_test.dart`

**Interfaces:**

- Produces: `SpaceAlbumSortMode` with seven values — `name`, `photoCount`, `recentlyUpdated`, `dateCreated`, `mostRecentPhoto`, `oldestPhoto`, `recentlyLinked` — declared in contract order, and `filterAndSortSpaceAlbums` handling all seven.

- [ ] **Step 1: Write the failing test**

Add to `mobile/test/pages/library/spaces/collection_sort_test.dart`:

```dart
  group('space-album sort parity (#966)', () {
    SpaceAlbum a({
      required String id,
      required String name,
      DateTime? createdAt,
      DateTime? linkedAt,
      DateTime? startDate,
      DateTime? endDate,
      int assetCount = 0,
    }) => SpaceAlbum(
      id: id,
      name: name,
      showInTimeline: true,
      assetCount: assetCount,
      linkedAt: linkedAt ?? DateTime.utc(2026, 1, 1),
      updatedAt: DateTime.utc(2026, 1, 1),
      createdAt: createdAt ?? DateTime.utc(2026, 1, 1),
      startDate: startDate,
      endDate: endDate,
    );

    // The contract order from the design spec — the menu is built from
    // SpaceAlbumSortMode.values, so declaration order IS menu order.
    test('offers the seven contract options in order with the contract labels', () {
      expect(SpaceAlbumSortMode.values.map((m) => m.name), [
        'name',
        'photoCount',
        'recentlyUpdated',
        'dateCreated',
        'mostRecentPhoto',
        'oldestPhoto',
        'recentlyLinked',
      ]);
      expect(SpaceAlbumSortMode.values.map((m) => m.label), [
        'sort_title',
        'sort_items',
        'sort_modified',
        'sort_created',
        'sort_recent',
        'sort_oldest',
        'sort_recently_linked',
      ]);
    });

    test('defaults Title to ascending and every other option to descending', () {
      expect(SpaceAlbumSortMode.name.defaultOrder, SortOrder.asc);
      for (final mode in SpaceAlbumSortMode.values.where((m) => m != SpaceAlbumSortMode.name)) {
        expect(mode.defaultOrder, SortOrder.desc, reason: '${mode.name} should default to descending');
      }
    });

    // S6 / S9 — createdAt order is the reverse of linkedAt order here
    test('Date created and Recently linked read different fields', () {
      final items = [
        a(id: 'old', name: 'Old', createdAt: DateTime.utc(2026, 1, 1), linkedAt: DateTime.utc(2026, 3, 1)),
        a(id: 'new', name: 'New', createdAt: DateTime.utc(2026, 2, 1), linkedAt: DateTime.utc(2026, 2, 2)),
      ];
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.dateCreated, false)), ['New', 'Old']);
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.recentlyLinked, false)), ['Old', 'New']);
    });

    // S7 / S8 — B has the newest photo but also the oldest, so the two modes
    // must disagree at the same direction. Both default to descending:
    //   mostRecentPhoto desc -> B (Jan 20) then A (Jan 10)
    //   oldestPhoto     desc -> A (Jan 5)  then B (Jan 1)
    // A comparator reading the wrong field therefore fails rather than passing
    // by coincidence.
    test('Most recent photo and Oldest photo read different fields', () {
      final items = [
        a(id: 'a', name: 'A', startDate: DateTime.utc(2026, 1, 5), endDate: DateTime.utc(2026, 1, 10)),
        a(id: 'b', name: 'B', startDate: DateTime.utc(2026, 1, 1), endDate: DateTime.utc(2026, 1, 20)),
      ];
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.mostRecentPhoto, false)), ['B', 'A']);
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.oldestPhoto, false)), ['A', 'B']);
      // reversed
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.mostRecentPhoto, true)), ['A', 'B']);
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.oldestPhoto, true)), ['B', 'A']);
    });

    // S10 / S11 / S12 — matches upstream sortUnknownYearAlbums: last in BOTH directions
    test('albums with no photo dates sort last regardless of direction', () {
      final items = [
        a(id: 'empty', name: 'Empty'),
        a(id: 'full', name: 'HasPhotos', startDate: DateTime.utc(2026, 1, 1), endDate: DateTime.utc(2026, 1, 10)),
      ];
      for (final mode in [SpaceAlbumSortMode.mostRecentPhoto, SpaceAlbumSortMode.oldestPhoto]) {
        for (final isReverse in [false, true]) {
          expect(
            names(filterAndSortSpaceAlbums(items, '', mode, isReverse)),
            ['HasPhotos', 'Empty'],
            reason: '$mode isReverse=$isReverse',
          );
        }
      }
    });

    // S14
    test('keeps every album when none has photo dates', () {
      final items = [a(id: '1', name: 'One'), a(id: '2', name: 'Two'), a(id: '3', name: 'Three')];
      final sorted = filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.mostRecentPhoto, false);
      expect(sorted, hasLength(3));
      expect(names(sorted).toSet(), {'One', 'Two', 'Three'});
    });

    // S15 — the repository truncates to a UTC day, so same-day albums arrive equal
    // and must fall through to the name/id tie-break rather than to time of day.
    test('same-day albums fall through to the tie-break', () {
      final items = [
        a(id: 'z', name: 'Zebra', endDate: DateTime.utc(2026, 1, 10)),
        a(id: 'a', name: 'Antelope', endDate: DateTime.utc(2026, 1, 10)),
      ];
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.mostRecentPhoto, false)), [
        'Antelope',
        'Zebra',
      ]);
    });

    // S17
    test('bulk-linked albums sharing a linkedAt tie-break by name then id', () {
      final linked = DateTime.utc(2026, 4, 1);
      final items = [
        a(id: 'c', name: 'Charlie', linkedAt: linked),
        a(id: 'a', name: 'Alpha', linkedAt: linked),
        a(id: 'b', name: 'Bravo', linkedAt: linked),
      ];
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.recentlyLinked, false)), [
        'Alpha',
        'Bravo',
        'Charlie',
      ]);
    });

    // S18 / S19
    test('handles empty and single-item lists for every mode and direction', () {
      final one = [a(id: 'only', name: 'Only')];
      for (final mode in SpaceAlbumSortMode.values) {
        for (final isReverse in [false, true]) {
          expect(filterAndSortSpaceAlbums(const [], '', mode, isReverse), isEmpty);
          expect(names(filterAndSortSpaceAlbums(one, '', mode, isReverse)), ['Only']);
        }
      }
    });

    // S21 — filtering still runs before sorting, for the new modes too
    test('filters by query before sorting', () {
      final items = [
        a(id: '1', name: 'Italy 2022', endDate: DateTime.utc(2026, 1, 20)),
        a(id: '2', name: 'Alps Weekend', endDate: DateTime.utc(2026, 1, 10)),
      ];
      expect(names(filterAndSortSpaceAlbums(items, 'alps', SpaceAlbumSortMode.mostRecentPhoto, false)), [
        'Alps Weekend',
      ]);
    });
  });
```

Also update the existing `sort-mode enum shape` group so its `storeIndex` expectations match the reordered enum.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && flutter test test/pages/library/spaces/collection_sort_test.dart`
Expected: FAIL — compile error, `The getter 'dateCreated' isn't defined for the type 'SpaceAlbumSortMode'`.

- [ ] **Step 3: Write minimal implementation**

In `mobile/lib/pages/library/spaces/collection_sort.dart`, replace the enum:

```dart
/// Sort modes for a space's linked-albums grid ([SpaceAlbumsPage]).
///
/// Declaration order IS menu order — [SpaceAlbumsPage] builds the menu from
/// `values`. The set and order match the web sort dropdown (see the #966 design
/// spec).
///
/// The identifiers are persisted verbatim by `EnumCodec` (`value.name`), so
/// renaming one silently resets every user who had it selected. That is why
/// `name` is labelled "Title" and `recentlyUpdated` is labelled "Date modified"
/// rather than being renamed to match.
enum SpaceAlbumSortMode {
  name(0, 'sort_title', SortOrder.asc),
  photoCount(1, 'sort_items', SortOrder.desc),
  recentlyUpdated(3, 'sort_modified', SortOrder.desc),
  dateCreated(4, 'sort_created', SortOrder.desc),
  mostRecentPhoto(5, 'sort_recent', SortOrder.desc),
  oldestPhoto(6, 'sort_oldest', SortOrder.desc),
  recentlyLinked(2, 'sort_recently_linked', SortOrder.desc);

  const SpaceAlbumSortMode(this.storeIndex, this.label, this.defaultOrder);

  final int storeIndex;
  final String label;
  final SortOrder defaultOrder;

  SortOrder effectiveOrder(bool isReverse) => isReverse ? defaultOrder.reverse() : defaultOrder;
}
```

and the comparator:

```dart
/// Albums with no photo dates sort last in BOTH directions, matching upstream
/// web's `sortUnknownYearAlbums`. Returns null when neither side is missing, so
/// the caller can fall through to the normal comparison.
///
/// Upstream checks `endDate` for both photo-date sorts, including the one that
/// orders by `startDate`. This checks each mode's own field instead. The two
/// are equivalent in practice — both dates come from the same aggregate, so an
/// album has both or neither — so do not "fix" this to match upstream's quirk.
int? _unknownDateLast(DateTime? a, DateTime? b) {
  if (a == null && b == null) return null;
  if (a == null) return 1;
  if (b == null) return -1;
  return null;
}

List<SpaceAlbum> filterAndSortSpaceAlbums(
  List<SpaceAlbum> items,
  String query,
  SpaceAlbumSortMode mode,
  bool isReverse,
) {
  final sign = mode.effectiveOrder(isReverse) == SortOrder.asc ? 1 : -1;
  final out = items.where((a) => _matches(a.name, query)).toList();
  out.sort((a, b) {
    // Applied outside the sign so empty albums stay last in both directions.
    final unknown = switch (mode) {
      SpaceAlbumSortMode.mostRecentPhoto => _unknownDateLast(a.endDate, b.endDate),
      SpaceAlbumSortMode.oldestPhoto => _unknownDateLast(a.startDate, b.startDate),
      _ => null,
    };
    if (unknown != null) return unknown;

    final c = switch (mode) {
      SpaceAlbumSortMode.name => _byName(a.name, b.name),
      SpaceAlbumSortMode.photoCount => a.assetCount.compareTo(b.assetCount),
      SpaceAlbumSortMode.recentlyLinked => a.linkedAt.compareTo(b.linkedAt),
      SpaceAlbumSortMode.recentlyUpdated => a.updatedAt.compareTo(b.updatedAt),
      SpaceAlbumSortMode.dateCreated => a.createdAt.compareTo(b.createdAt),
      SpaceAlbumSortMode.mostRecentPhoto => a.endDate!.compareTo(b.endDate!),
      SpaceAlbumSortMode.oldestPhoto => a.startDate!.compareTo(b.startDate!),
    };
    if (c != 0) return sign * c;
    final n = _byName(a.name, b.name);
    return n != 0 ? n : a.id.compareTo(b.id);
  });
  return out;
}
```

The `!` assertions are safe: `_unknownDateLast` has already returned for every case where either side is null.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && flutter test test/pages/library/spaces/collection_sort_test.dart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/pages/library/spaces/collection_sort.dart mobile/test/pages/library/spaces/collection_sort_test.dart
git commit -m "feat(mobile): offer the full seven space album sort options (#966)"
```

---

## Task 8: Mobile page assertions

Implements S2, S3 on mobile.

**Files:**

- Test: `mobile/test/presentation/pages/space_albums_page_test.dart` (the sort group, around lines 248–360)

No production change — the menu is built from `SpaceAlbumSortMode.values` at `mobile/lib/pages/library/spaces/space_albums.page.dart:206`, so Task 7 already surfaced the new options.

- [ ] **Step 1: Update the label assertions and add the new coverage**

The existing `picking a different sort mode reorders the grid and persists the choice` test both taps `find.text('Photo count')` and asserts the literal `'Sort: Photo count'`. Both become `'Number of items'` / `'Sort: Number of items'`. Then add, using the same harness the file already uses (`tester.pumpConsumerWidget` + the file's `_overrides` and `_album` helpers):

```dart
  testWidgets('offers all seven sort options in the menu', (tester) async {
    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: _overrides(
        spaceId: spaceId,
        albums: [_album(id: 'a1', name: 'Alpha'), _album(id: 'a2', name: 'Bravo')],
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('collection-sort-button-pill')));
    await tester.pumpAndSettle();

    for (final label in [
      'Title',
      'Number of items',
      'Date modified',
      'Date created',
      'Most recent photo',
      'Oldest photo',
      'Recently linked',
    ]) {
      expect(find.text(label), findsWidgets, reason: 'missing sort option $label');
    }
  });
```

The menu needs at least one album to render — the page hides the search/sort chrome entirely when a space has zero linked albums (see the existing `a genuinely empty space still shows the empty state` test).

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `cd mobile && flutter test test/presentation/pages/space_albums_page_test.dart`
Expected: initially FAIL on the stale `'Sort: Photo count'` literal; PASS after the label update.

- [ ] **Step 3: Commit**

```bash
git add mobile/test/presentation/pages/space_albums_page_test.dart
git commit -m "test(mobile): assert the seven space album sort options on the page (#966)"
```

---

## Task 9: Mobile persistence

Implements S22, S23, S24.

**Files:**

- Test: `mobile/test/domain/models/config/app_config_test.dart`

No production change expected — `SpaceAlbumsConfig` already defaults to `recentlyLinked`. This task proves the default survived and that old and new stored values both round-trip.

- [ ] **Step 1: Write the test**

Add to the `AppConfig spaces & space-albums sort prefs` group:

```dart
    // S22
    test('space-album sort still defaults to recentlyLinked', () {
      const c = AppConfig();
      expect(c.spaceAlbums.sortMode, SpaceAlbumSortMode.recentlyLinked);
      expect(c.spaceAlbums.isReverse, false);
    });

    // S23 / S24 — every mode round-trips, including the pre-#966 identifiers
    // (name, photoCount, recentlyUpdated) that must never be renamed.
    test('every space-album sort mode round-trips', () {
      const c = AppConfig();
      for (final mode in SpaceAlbumSortMode.values) {
        final w = c.write(SettingsKey.spaceAlbumsSortMode, mode);
        expect(w.read(SettingsKey.spaceAlbumsSortMode), mode, reason: '${mode.name} did not round-trip');
      }
    });

    test('the persisted identifiers of the pre-existing modes are unchanged', () {
      expect(SpaceAlbumSortMode.name.name, 'name');
      expect(SpaceAlbumSortMode.photoCount.name, 'photoCount');
      expect(SpaceAlbumSortMode.recentlyUpdated.name, 'recentlyUpdated');
      expect(SpaceAlbumSortMode.recentlyLinked.name, 'recentlyLinked');
    });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd mobile && flutter test test/domain/models/config/app_config_test.dart`
Expected: PASS.

- [ ] **Step 3: Run the full mobile gates**

Run: `cd mobile && dart format --set-exit-if-changed lib test && dart analyze --fatal-infos lib test && flutter test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add mobile/test/domain/models/config/app_config_test.dart
git commit -m "test(mobile): cover space album sort persistence across all modes (#966)"
```

---

## Task 10: Final verification and PR

- [ ] **Step 1: Run every gate**

```bash
cd web && pnpm exec vitest run && pnpm check:typescript && pnpm check:svelte && pnpm lint
cd ../mobile && dart format --set-exit-if-changed lib test && dart analyze --fatal-infos lib test && flutter test
cd .. && npx prettier --check "docs/superpowers/**/*.md"
```

- [ ] **Step 2: Confirm upstream files are untouched**

```bash
git diff --name-only origin/main...HEAD
```

Expected: the list must NOT contain `web/src/lib/utils/album-utils.ts`, `web/src/lib/stores/preferences.store.ts`, `web/src/lib/components/spaces/space-albums-table.svelte`, any `server/` path, or any `i18n/` path.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin HEAD
gh pr create --title "fix(spaces): unify shared-space album sort options across web and mobile (#966)" --body "..."
```

The body should state the seven-option contract, the new shared default, that mobile now derives `createdAt` and truncated photo dates locally, and that no server or i18n change was needed. Link issue #966.

- [ ] **Step 4: Babysit CI to green**

Use the `babysit` skill.

- [ ] **Step 5: File the two follow-up issues**

- Web space-album table headers are static and non-clickable (`space-albums-table.svelte:80`), unlike `/albums`.
- Search scope differs: web matches album name or description, mobile matches name only.

---

## Self-Review

**Spec coverage.** Every scenario S1–S29 in the spec's coverage map has a task: S1/S4–S12/S14/S17–S19/S26 → Task 1 and Task 7; S2/S3 → Task 3 and Task 8; S13/S15/S20 → Task 6 and Task 7; S16 → Task 7; S21 → Task 4 and Task 7; S22–S24 → Task 2 and Task 9; S25 → Task 5; S27–S29 → Task 4. The spec's slice M0–M4 / W1–W4 map onto Tasks 5, 6, 7, 8, 9 and 1, 2, 3, 4 respectively.

**Type consistency.** `sortSpaceAlbums`, `findSpaceAlbumSortOptionMetadata`, `spaceAlbumSortOptionsMetadata`, `SpaceAlbumSortBy` and `SpaceAlbumSortOptionMetadata` are defined in Task 1 and used under those exact names in Tasks 2, 3 and 4. `SpaceAlbum.createdAt` / `.startDate` / `.endDate` are defined in Task 6 and consumed in Task 7. `EnumCodec(values, {fallback})` is defined in Task 5 and used in `settings_key.dart` in the same task.

**Known deviation from the spec's slice list.** The spec ordered M0 after W4; this plan keeps that relative order (Task 5 follows Task 4) but makes Task 5 a prerequisite of Task 7 rather than of Task 6, since it is Task 7 that adds the new enum values.
