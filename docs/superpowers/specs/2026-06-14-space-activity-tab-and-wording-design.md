# Space Members Panel — Activity Tab Split + Activity Wording — Design

**Date:** 2026-06-14
**Status:** Design — ready for implementation (`/impl-loop`)
**Feature area:** Shared Spaces → Members / Activity
**Branch:** `feat/space-albums`

---

## 1. Summary

Two improvements to the space Members experience, as two independent, `/impl-loop`-able slices:

- **Slice 1 — Activity tab.** Move the "Recent Activity" feed out of the Members page into its own **Activity** space tab (placed after Members). Members keeps only the member list (+ per-member contribution counts).
- **Slice 2 — Activity wording.** Several space actions either log activities with no display wording (`PersonUpdate`, `PersonDelete`) or aren't logged at all (album link/unlink), so the feed shows the generic `"{name} performed an action"` fallback. Add proper wording for the logged-but-unworded person activities, **log** album link/unlink (new types) and `PersonMerge` (enum exists but is never logged), and give them all real descriptions.

The slices are independent (Slice 1 = web route/tab restructure; Slice 2 = activity logging + descriptions) and may be implemented in either order.

## 2. Method & conventions (both slices)

- **TDD, mandatory.** Each behavior: write the failing test first, run it RED for the right reason, implement minimally, run GREEN, refactor. Each slice below lists its tests explicitly.
- **No SDK/OpenAPI regen.** The activity DTO types `type` as `z.string()` (`server/src/dtos/shared-space.dto.ts:172`), and `logActivity` takes `type: string`. New `SharedSpaceActivityType` values are plain string constants used server-side; the web `getDescription` switch matches string literals. So adding activity types touches no DTO and needs no client regen.
- **No migrations.** `shared_space_activity.data` is free-form JSON; new fields (`albumName`, `personName`) need no schema change.
- **Wording is hardcoded English**, matching the existing `getDescription()` in `space-activity-feed.svelte` (all current cases are hardcoded). Converting the feed to i18n is out of scope (known debt).
- **Run** web commands from `web/`, server from `server/`. Defer the full `lint` to a final gate; keep `pnpm check` / `svelte-check` in the loop. Prettier-format every touched file before committing (the Docs/format checks are strict).

## 3. Current-state reference (verified)

| Concern                                 | Location                                                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space tabs (derived array)              | `web/src/lib/components/spaces/space-tabs.svelte` — `tabs = $derived<Tab[]>([...])`; rendered in `web/src/routes/(user)/spaces/[spaceId]/+layout.svelte`                                                |
| Members page (list **+** activity feed) | `web/src/routes/(user)/spaces/[spaceId]/members/+page.svelte` (activity section ~L146-154 renders `SpaceActivityFeed`; load-more logic ~L24-85)                                                         |
| Members load (fetches activities)       | `web/src/routes/(user)/spaces/[spaceId]/members/+page.ts` (`getSpaceActivities({id, limit, offset:0})`, `ACTIVITY_PAGE_SIZE`)                                                                           |
| Activity feed component (reusable)      | `web/src/lib/components/spaces/space-activity-feed.svelte` — `getDescription()` switch (hardcoded), impact tiers `HIGH_IMPACT_TYPES`/`MEDIUM_TYPES`/else                                                |
| Activity type enum                      | `server/src/enum.ts` `SharedSpaceActivityType` (asset*add/remove, member*\*, cover_change, space_rename, space_color_change, person_update, person_delete, person_merge)                                |
| `logActivity`                           | `server/src/repositories/shared-space.repository.ts` `logActivity({ spaceId, userId, type: string, data?: Record })`                                                                                    |
| Album link/unlink (NO activity today)   | `shared-space.service.ts` `linkAlbum` (~L634), `unlinkAlbum` (~L658)                                                                                                                                    |
| Person activities                       | `shared-space.service.ts` `updateSpacePerson` (logs `PersonUpdate { personId }`), `deleteSpacePerson` (logs `PersonDelete { personId, personName }`), `mergeSpacePeople` (~L1338, logs nothing)         |
| Album name source                       | `this.albumRepository.getById(albumId, { withAssets: false })` → `.albumName` (pattern: `notification.service.ts:309`)                                                                                  |
| i18n                                    | `i18n/en.json` has `spaces_activity` = "Activity", `spaces_recent_activity`, `spaces_activity_empty*`                                                                                                   |
| Tests                                   | `web/src/lib/components/spaces/space-tabs.spec.ts`; `web/src/routes/(user)/spaces/[spaceId]/members/space-members-page.spec.ts` (has activity + load-more tests); server `shared-space.service.spec.ts` |

Line numbers indicative; locate by symbol.

---

## 4. Slice 1 — Activity tab

### 4.1 Goal

A dedicated **Activity** tab (`/spaces/:spaceId/activity`) renders the recent-activity feed; the Members page no longer renders it.

### 4.2 Changes

1. **New route** `web/src/routes/(user)/spaces/[spaceId]/activity/`:
   - `+page.ts` — mirror the current `members/+page.ts` activity load: `authenticate(url)`, `await parent()`, `getSpaceActivities({ id: params.spaceId, limit: ACTIVITY_PAGE_SIZE, offset: 0 })`, return `{ activities, hasMoreActivities: activities.length === ACTIVITY_PAGE_SIZE, meta: { title: \`${space.name} - Activity\` } }`.
   - `+page.svelte` — render `SpaceActivityFeed` with the paged `activities` + a `loadMoreActivities()` that calls `getSpaceActivities` with the running offset (move this logic verbatim from `members/+page.svelte`). Use a `max-w-3xl` container with a heading (`spaces_recent_activity`).

2. **Tab** in `space-tabs.svelte`: add an entry **after** the Members entry:

   ```ts
   { key: 'activity', label: $t('spaces_activity'), href: `${base}/activity`, active: path.startsWith(`${base}/activity`) }
   ```

   No badge, no role gating (all members, same as Members). No new props needed (no badge).

3. **Slim the Members page**: remove the activity feed section from `members/+page.svelte` and the activity load + `loadMoreActivities` + `getSpaceActivities` import from both `members/+page.svelte` and `members/+page.ts`. Keep the members list and per-member contribution counts untouched. `members/+page.ts` returns only `{ meta }` (+ whatever non-activity data it already returned).

### 4.3 Edge cases

1. Activity tab visible to every member (owner/editor/viewer) — no gating, like Members.
2. Active-state highlight on `/spaces/:id/activity` (and not on `/members`).
3. Empty activity → `SpaceActivityFeed` renders its existing empty state (unchanged component).
4. Load-more pagination works on the new page (offset advances; `hasMore` flips off when a short page returns).
5. Deep-link / refresh directly on `/spaces/:id/activity` loads the feed (the `+page.ts` load runs).
6. Members page after the change shows the member list with **no** `SpaceActivityFeed` and makes **no** `getSpaceActivities` call.
7. Tab order: Photos, [People], Albums, Map, Members, **Activity**.

### 4.4 Test plan (RED first)

- **`space-tabs.spec.ts`** (extend): an Activity tab renders with `href` `…/activity`; it is `aria-current` when `path` starts with `…/activity`; it is present regardless of `faceRecognitionEnabled`.
- **New `…/spaces/[spaceId]/activity/space-activity-page.spec.ts`**: renders `SpaceActivityFeed` from `data.activities`; invoking load-more calls `getSpaceActivities` with the advanced offset and appends results (move the load-more test from the members spec). Mock `getSpaceActivities` via `sdkMock`.
- **`space-members-page.spec.ts`** (trim): remove the activity-section + load-more tests; add an assertion that the members page does **not** render the activity feed (`queryByTestId('members-activity')` / `SpaceActivityFeed` absent) and does **not** call `getSpaceActivities`.
- (If an `activity/+page.ts` load test fits the repo's `*-load.spec.ts` pattern, add one asserting it calls `getSpaceActivities` and returns `hasMoreActivities`.)

### 4.5 Acceptance criteria

- `/spaces/:id/activity` shows the feed; the Activity tab is present (after Members) and highlights correctly.
- The Members page shows only members (no feed, no activity fetch).
- `make check-web` clean; the tab + activity-page + members specs pass; no other web test regresses.

---

## 5. Slice 2 — Activity wording (album link/unlink + person activities)

### 5.1 Goal

Eliminate the generic `"{name} performed an action"` for real actions: **log** album link/unlink and person-merge (with denormalized names) and give album/person activities proper descriptions.

### 5.2 Backend changes (`server/`)

1. **Enum** (`src/enum.ts` `SharedSpaceActivityType`): add `AlbumLink = 'album_link'`, `AlbumUnlink = 'album_unlink'` (`PersonMerge = 'person_merge'` already exists).

2. **`linkAlbum`** (`shared-space.service.ts`): after a **newly-created** link only (the existing `if (result)` gate that already guards the face-sync queue), fetch the album name and log:

   ```ts
   const album = await this.albumRepository.getById(albumId, { withAssets: false });
   await this.sharedSpaceRepository.logActivity({
     spaceId,
     userId: auth.user.id,
     type: SharedSpaceActivityType.AlbumLink,
     data: { albumId, albumName: album?.albumName ?? '' },
   });
   ```

   (Reuse the album fetch if one is added; do not log on an idempotent re-link.)

3. **`unlinkAlbum`**: after `removeAlbum` succeeds, log `AlbumUnlink` with `{ albumId, albumName: album?.albumName ?? '' }` (fetch the album name before/around the removal — the album still exists; unlinking only drops the link row).

4. **`updateSpacePerson`** (`PersonUpdate`): include the person's resulting name — change the logged `data` from `{ personId }` to `{ personId, personName: <resulting name> }` (use the already-fetched `enriched.name`, reordering so the name is available, or `dto.name`).

5. **`deleteSpacePerson`** (`PersonDelete`): **no backend change** — already logs `{ personId, personName }`.

6. **`mergeSpacePeople`**: after the merge succeeds (`identityMergePropagationService.mergeSpacePeople(...)`), log:
   ```ts
   await this.sharedSpaceRepository.logActivity({
     spaceId,
     userId: auth.user.id,
     type: SharedSpaceActivityType.PersonMerge,
     data: { personName: target.name ?? '', count: dto.ids.length },
   });
   ```

### 5.3 Frontend changes (`web/`)

Add cases to `getDescription()` in `space-activity-feed.svelte` (hardcoded, matching existing style; all render as low-impact rows via the existing `else` tier):

```ts
case 'album_link':   return `${name} linked album "${data.albumName ?? ''}"`;
case 'album_unlink': return `${name} unlinked album "${data.albumName ?? ''}"`;
case 'person_update':return `${name} updated person "${data.personName ?? ''}"`;
case 'person_delete':return `${name} deleted person "${data.personName ?? ''}"`;
case 'person_merge': return `${name} merged ${data.count ?? 0} people into "${data.personName ?? ''}"`;
```

The `default: return \`${name} performed an action\`` stays for genuinely unknown/future types.

### 5.4 Edge cases

1. **New link only:** `linkAlbum` logs `AlbumLink` once for a newly-created link; an idempotent re-link (existing link) logs nothing (gated by the existing `if (result)`).
2. **Album name missing/deleted:** `getById` returns undefined → `albumName: ''` → wording renders `linked album ""` (graceful, no crash).
3. **Unlink logs** `AlbumUnlink` with the album name captured before the link row is dropped.
4. **`PersonUpdate` name:** logged with the resulting `personName`; empty name → `updated person ""`.
5. **`PersonMerge`:** logged only after a successful merge (not on the validation-error paths — no source ids, self-merge, type mismatch, person-not-found); `count` = number of source people merged.
6. **Backward compatibility:** activities logged **before** this change lack the new `data` fields (e.g. old `person_update` rows have no `personName`); `getDescription` uses `?? ''` so they render with empty quotes rather than crashing or falling back. (Acceptable; documented.)
7. **Impact tier:** album/person activities are low-impact (dot + truncated text) — no change to `HIGH_IMPACT_TYPES`/`MEDIUM_TYPES`.
8. **Unknown/future type** still hits the generic fallback (preserved).

### 5.5 Test plan (RED first)

- **Server unit (`shared-space.service.spec.ts`)** — auto-mocked repos:
  - `linkAlbum` on a new link calls `logActivity` with `type: AlbumLink`, `data: { albumId, albumName }` (mock `albumRepository.getById` → `{ albumName: 'Trip' }`, and `sharedSpaceRepository.addAlbum` → truthy result); on an idempotent re-link (`addAlbum` → falsy) it does **not** log `AlbumLink`.
  - `unlinkAlbum` calls `logActivity` with `type: AlbumUnlink`, `data: { albumId, albumName }`.
  - `updateSpacePerson` calls `logActivity` with `type: PersonUpdate` and `data.personName` set.
  - `mergeSpacePeople` (happy path) calls `logActivity` with `type: PersonMerge`, `data: { personName, count }`; the validation-error paths (empty ids / self-merge / type mismatch / not-found) do **not** log.
- **Web component (`space-activity-feed.spec.ts`, new or extend)** — render `SpaceActivityFeed` with one activity of each new type and assert the row text:
  - `album_link` → `… linked album "Trip"`; `album_unlink` → `… unlinked album "Trip"`; `person_update` → `… updated person "Alice"`; `person_delete` → `… deleted person "Alice"`; `person_merge` → `… merged 2 people into "Alice"`.
  - An unknown type still renders `… performed an action`.
  - A new-type activity **missing** its name field renders with empty quotes (no crash) — covers edge 6.

### 5.6 Acceptance criteria

- Linking/unlinking an album, editing/deleting/merging a space person each produce a feed row with correct, specific wording.
- No real action renders `"performed an action"` anymore.
- `make check-server` + `make check-web` clean; server unit + web component tests pass; no SDK regen needed (verify `pnpm sync:open-api` would produce no diff if run — the `type` field is `z.string()`).

---

## 6. Out of scope

- Converting the activity feed to i18n (whole-component refactor).
- Logging library link/unlink and the album show-in-timeline toggle (decided out for now).
- Activity badges/counts on the Activity tab.
