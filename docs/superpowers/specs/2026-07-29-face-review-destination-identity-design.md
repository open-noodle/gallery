# Face cleanup review: give the destination an identity

**Date:** 2026-07-29
**Branch:** `feat/face-review-unified` (PR #834)
**Status:** design approved; open questions C2–C5 settled 2026-07-29

## Problem

An admin opened a flagged cluster in the face-cleanup console and was told, in full:

> Default is → Unbenannter Cluster

One face, flagged, routed to an unnamed cluster. Nothing on the page said which cluster, how big it
was, what it looked like, or how to go and see it. The suggestion was unactionable — the only honest
response to it is "I have no idea", and the admin cannot get to one from this page.

The review page (`web/src/routes/admin/face-cleanup/[personId]/+page.svelte`) receives everything it
needs to identify the destination and renders almost none of it. `scanPerson.suspectedOwners[]`
already carries `{ ownerPersonId, ownerName, thumbnailFaceId, count }` per suspected owner
(`server/src/dtos/face-repair.dto.ts:82`). The page reads exactly one field off exactly one element:

```ts
const primaryOwner = $derived(scanPerson?.suspectedOwners?.[0] ?? null);
const ownerName = $derived(primaryOwner?.ownerName ?? $t('admin.face_cleanup_review_unnamed'));
```

That bare string is then interpolated into five places: the banner body, the `owner` tally chip, the
`owner`/`other` tile ribbons, the rest-of-cluster hint, and the move-entire-cluster confirmation.

Four defects follow from it.

### D1 — the destination has no identity

No thumbnail, no size, no link. `thumbnailFaceId` arrives on every suspected owner and is discarded.
The destination cluster's own face count is not in the payload at all — `suspectedOwners[].count` is
_the number of flagged faces routing to that owner_, which is a different number and, on the reported
case, was `1`.

### D2 — `suspectedOwners[0]` is treated as the only destination

A cluster can flag faces toward several owners; `multiple-owners` is one of the scan's own review
reasons. Per-face routing already respects this — `FlaggedFace.suspectedOwnerId` is per face, and
`buildResolveRequest` groups by each face's own owner (`review.svelte.ts:233`). But every _summary_
surface on the page hardcodes `[0]`:

- the banner names one destination for a cluster that has several;
- the `owner` tally chip counts faces bound for **all** owners and labels them with `[0]`'s name;
- **`Move entire cluster` sends every eligible face to `[0]`** (`+page.svelte:287`), silently
  overriding the routing of every face the scan attributed to a secondary owner;
- **rest-of-cluster staging** has the same hardcoded destination (`+page.svelte:384`), and offers no
  way to send those faces anywhere else.

The last two are not display problems: they mis-route data, and the confirmation dialog does not
mention it.

### D3 — the zero-owner and deleted-owner cases render as lies

With no suspected owners at all, `ownerName` falls through `?? $t(…unnamed)` and the page announces
"Default is → Unnamed cluster" — a destination that does not exist. If the destination person was
deleted or merged after the scan, the page looks entirely normal and Apply fails with
`face-repair:destination-missing`, discovered only after the admin commits.

### D4 (adjacent) — the dashboard prints the wrong number under the destination

`ReviewFirstLane.svelte:166` renders `{dest.count} faces` directly beneath the destination's name,
where `dest.count` is the flagged-routing count. It reads as the destination cluster's size. On the
reported case the console said `Unbenannter Cluster / 1 faces`, describing a cluster that may hold
thousands. Same ambiguity, same root cause: one field named `count` doing duty for two concepts.

## Non-goals

- **Why the scan matched.** Surfacing per-face evidence (nearest matching faces, distance, vote
  margin) is a separate feature: the scan does not persist that evidence today. This spec answers
  "what is this destination", not "why was it suggested".
- **Renaming `suspectedOwners[].count`.** The name is the root of D4, but the field is persisted
  inside `face_repair_scan.persons` JSON. Renaming it needs a data migration or a read-time fallback
  for every existing scan row, for a cosmetic gain. It stays `count`, documented.
- **Changing flagged-tile routing.** `owner`-state faces continue to move to their own
  `face.suspectedOwnerId`. Nothing here alters where an individual flagged face goes.
- **Reconciling the two read paths.** The review page's flagged faces come from
  `getPersonFlaggedFaces` (pure snapshot, deliberately no recompute — pinned by
  `face-repair-flagged-faces.spec.ts:212`, E13), while its `scanPerson` comes from `getLatestScan`
  (live). They can disagree; see the edge-case table. Unifying their lifetimes is out of scope.

## Design

### 1. Server: live counts on the scan overlay

`ScanSuspectedOwnerSchema` (`server/src/dtos/face-repair.dto.ts:82`) and its repository twin
`RepairScanSuspectedOwner` (`face-repair-scan.repository.ts:24`) gain:

| field            | type      | meaning                                |
| ---------------- | --------- | -------------------------------------- |
| `ownerFaceCount` | `number`  | the destination cluster's **own** size |
| `ownerMissing`   | `boolean` | the `person` row no longer exists      |

Both are **overlay-only**: computed at read time, never written into the persisted scan JSON. Nothing
about existing `face_repair_scan` rows changes, so there is no migration and no backfill.

The schema gets a comment fixing the distinction in place, because conflating these two numbers is
what produced D4:

```
count          — flagged faces on THIS cluster routing to this owner (persisted, scan-time)
ownerFaceCount — the destination person's own face count (overlay, live)
```

**`RepairScanPerson.faceCount` becomes live too** (settled: C2). `withCurrentNames` builds one `ids`
list containing the reviewed persons _and_ their suspected owners (`face-repair-scan.repository.ts:216`),
so the person's live count falls out of the same aggregate. This gives one rule worth stating in the
code:

```
live   → name, thumbnail, faceCount, flagged, flaggedFraction, suspectedOwners[].count
frozen → eligible, and the set of flagged faces the scan recorded
```

`flaggedFraction` is unaffected: it is denominated on `eligible`, which stays frozen by design
(`face-repair.service.ts:594`). Fixtures that set `faceCount` without inserting matching `asset_face`
rows will need re-baselining — see Slice 1.

**Where they are filled.** `FaceRepairScanRepository.withCurrentNames` (`:211`) already re-fetches
every person and suspected-owner row on read to overlay live names and thumbnails. The same query
grows a left join and an aggregate:

```ts
.leftJoin('asset_face', (join) =>
  join
    .onRef('asset_face.personId', '=', 'person.id')
    .on('asset_face.deletedAt', 'is', null)
    .on('asset_face.isVisible', '=', true),
)
.select((eb) => eb.fn.count('asset_face.id').as('faceCount'))
.groupBy(['person.id'])
```

…and every count is converted with `Number(...)` before it leaves the repository. **This is not
optional.** Postgres `count()` returns `bigint`, which the driver hands back as a **string**;
`getPersonMetadata` already does exactly this (`face-repair.repository.ts:108`). Without the
conversion `ownerFaceCount` is `"1204"`, which fails `z.number()` and makes `{count, number}`
formatting unavailable in the web.

`ownerMissing` is `!byId.has(ownerPersonId)` — free from the map the method already builds. A
destination whose person row is gone reports `ownerFaceCount: 0, ownerMissing: true`.

Three constraints on this query:

- **The join predicate must match `getPersonMetadata` and `searchOwnerPeople` exactly**
  (`deletedAt is null`, `isVisible = true`). `face-repair.repository.ts:85` already documents why: a
  face count that disagrees between the picker, the review header and this card reads as a bug. The
  picker matters concretely here — §3's chooser labels its options with the same number.
- **Cost.** The predicate is covered by the partial index
  `asset_face_personId_assetId_notDeleted_isVisible_idx` (`asset-face.table.ts:31`, predicate
  `"deletedAt" IS NULL AND "isVisible" IS TRUE`), so this is one index-backed aggregate over the
  scan's distinct person ids, once per scan read.
- **The spread is load-bearing.** `getLatestScanStatus` runs `withCurrentNames` **then**
  `withLiveFlaggedCounts` (`face-repair.service.ts:581-582`), and the latter _rebuilds_ each
  suspected owner via `.map((owner) => ({ ...owner, count }))`. That spread is what carries
  `ownerFaceCount` / `ownerMissing` through; replacing it with an explicit object literal silently
  drops both fields. This gets a comment at both sites and a test.

  **Corrected 2026-07-29, during implementation.** This spec originally claimed the _call order_ was
  load-bearing too. That is false, and was proven so: `withCurrentNames` sets both fields
  unconditionally on whatever list it is handed, so whichever pass runs last wins and either order
  yields a correct payload. Only the spread matters. The regression test pins the spread; there is
  deliberately no order-specific pin, because there is no order-specific defect to catch.

`withLiveFlaggedCounts` also `.filter((owner) => owner.count > 0)` (`:633`), so an owner whose flagged
faces have all been settled since the scan disappears from `suspectedOwners` entirely. The card list
inherits that pruning for free — and the "no suspected owners" state below can therefore arise from
live filtering, not only from the scan.

### 2. Review page: the destination card

The banner's leading sentence (`Default is → {ownerName}.`) is removed from
`face_cleanup_review_banner_body`; the destination is promoted out of prose into an object:

```
⚠  2,382 faces flagged on this cluster

Destinations →
 ┌────┐  Katrin                          [open ↗]
 │ 🙂 │  a3f10c2e · 1,204 faces
 └────┘  2,201 flagged faces route here
 ┌────┐  Unnamed cluster                 [open ↗]
 │ 🙂 │  9f21b40e · 88 faces
 └────┘  181 flagged faces route here

Select the exceptions and re-route them: keep here, confirm-lock an age-gap face, …
```

Per card:

- **Thumbnail** via the page's existing `personThumbUrl` helper (`+page.svelte:130`) — the face-keyed
  admin route. When `thumbnailFaceId` is null that helper falls back to the person-scoped route,
  which 403s for a cluster the admin does not own (`PersonPicker.svelte:57` documents this), so the
  card renders a **neutral placeholder** instead of a knowingly-broken `<img>`. An unnamed,
  thumbnail-less destination is precisely the case this feature exists for; it must not show a broken
  image.
- **Name**, or `face_cleanup_review_unnamed` in the page's gray-italic unnamed idiom.
- **Short id** (`id.slice(0, 8)`, font-mono) — matches the page header and the picker, and is the
  only thing that distinguishes two unnamed clusters from each other.
- **`{ownerFaceCount, number} faces`** — the destination's own size, `number`-formatted to match the
  page header's `.toLocaleString()` (`+page.svelte:442`). `1,204`, never `1204`.
- **`{count, number} flagged faces route here`** — the routing share, stated as such so it can never
  be read as the size.
- **`[open ↗]`** → `Route.viewFaceCleanupManualPerson({ id })`, the manual review page from #838,
  with `target="_blank" rel="noopener"`.

**The new tab is load-bearing, not a preference.** Every staged decision on this page lives in
`createReviewModel`'s in-memory maps. A same-tab navigation discards the entire review.

**Ordering and volume.** Cards sort by `count` descending, tie-broken on `ownerPersonId` so the order
is stable across re-renders. The first three render; the remainder collapse behind a `+{n} more`
toggle. `suspectedOwners` is unbounded (a group-by over flagged faces), and this block sits inside the
banner above the grid.

**Degenerate states**, replacing today's misleading fallbacks (D3):

- **No suspected owners** — the card list is replaced by an explicit statement that the scan could
  not attribute these faces to anyone. The page must not name a destination that does not exist. This
  state is reachable both from the scan and from live pruning (§1).
- **`ownerMissing`** — the card renders in a warning treatment saying the person no longer exists.
  This is the same condition that makes Apply fail with `face-repair:destination-missing`; the admin
  now sees it before committing rather than after.

### 3. Review page: a real destination chooser for the two bulk actions

`Move entire cluster` and rest-of-cluster staging stop hardcoding `suspectedOwners[0]`. The page gets
one `destination` state:

```
Rest of this cluster (570)
  Send to: [ Katrin · 1,204 faces  ▾ ]     [Select all]  [Move entire cluster →]
           ├─ Katrin · 1,204 faces
           ├─ Unnamed cluster · 88 faces
           └─ Choose someone else…
```

- A native `<select>`: keyboard-accessible for free, and the page has no dropdown idiom to match
  (`PersonPicker` is a modal).
- Options are the suspected owners, each with its `ownerFaceCount`, plus `Choose someone else…`,
  which opens the existing owner-scoped `PersonPicker` (search, plus create-a-new-person). Cancelling
  the picker reverts the select to its previous value.
- **`ownerMissing` owners are not offered** (settled: C4). The card above already explains why a
  destination is unusable; a dead option in the select adds only a chance to misclick. The default is
  the first _surviving_ suspected owner; when every owner is missing, or there are none, there is no
  default and both bulk actions stay disabled until the admin picks someone.
- `PersonPicker` gains a `showLock` prop (default `true`, so its current call site is unchanged). The
  chooser passes `false`: this destination feeds `entireCluster` (which has no lock field) and
  rest-staging (hardcoded `lock: false` in `review.svelte.ts:266`), so offering "Lock so it won't
  re-flag" here would promise something the request cannot carry.

**Self-move guard** (settled: C3). Scan-derived options can never be the reviewed cluster —
`tallyReattribution` skips `personId === currentPersonId` (`face-repair.ts:72`) — but `PersonPicker`
searches all of the owner's people with no exclusion, so `Choose someone else…` can select the
cluster being reviewed. `Move entire cluster` would then move a cluster into itself and, per its own
confirm text, "remove the empty cluster".

Both bulk buttons therefore disable when `destination.personId === personId`, with an inline reason.
This is a UI guard rather than a picker exclusion or a server rejection: it catches the case however
the admin arrived at it, needs no second DTO change (the picker's list is paginated, so client-side
filtering leaves short pages), and it tells the admin _before_ Apply rather than after — which is the
point of this whole spec.

**Staged rest faces follow the destination** (settled: C5). `restSelected` holds bare ids and the
destination is read at build time, so changing the chooser re-routes anything already staged. That is
the right behavior — the admin ticked those faces deliberately and discarding the work over a
dropdown change is worse. The defect is that the count is shown without its destination, so the
dock's chip gains one: `+12 added` becomes `+12 added → Katrin`, re-rendering when the chooser
changes. Tile ribbons already update reactively.

Consumers switched from `ownerPersonId` to the chosen destination: `buildApplyRequest` (`:384`),
`confirmMoveEntireCluster` (`:287`), the rest-section hint, the selected rest-tile ribbon, the dock's
added-chip, and the move-entire confirmation body.

**Both buttons now gate on the chosen destination, not on `ownerPersonId`.** They are
`disabled={!ownerPersonId}` today, so an unattributable cluster offers no whole-cluster action at all.
With a chooser, picking a person enables them. This is a deliberate behavior change and it removes a
dead end.

**The `owner` tally chip** (`face_cleanup_review_tally_owner`, `"→ {name}"`) also drops its `[0]`
assumption: with more than one suspected owner it counts faces bound for several destinations, so it
renders a generic "→ suggested owner". With exactly one owner it keeps naming that owner.

Flagged-tile routing is untouched: `owner`-state faces still move to their own `suspectedOwnerId`,
and the tile ribbons still name each face's own destination via `ownerNameById`.

### 4. Dashboard: the destination column shows the destination's size

`ReviewFirstLane.svelte:166` switches from `dest.count` to `dest.ownerFaceCount`, so the number under
the destination's name is the destination's size. The routing share moves into the row's existing
`title` tooltip. The `bad-target` red state keeps its precedence over the count.

`ConfidentLane` renders `{pct}% → {ownerName}` with no count and needs no change.

### 5. i18n

New keys in the existing `admin.face_cleanup_review_*` namespace:

| key                                     | English                                                               |
| --------------------------------------- | --------------------------------------------------------------------- |
| `face_cleanup_review_dest_heading`      | `{count, plural, one {Destination} other {Destinations}}`             |
| `face_cleanup_review_dest_size`         | `{count, number} faces`                                               |
| `face_cleanup_review_dest_routes`       | `{count, number} flagged faces route here`                            |
| `face_cleanup_review_dest_open`         | `Open this cluster in a new tab` (title/aria)                         |
| `face_cleanup_review_dest_more`         | `+{count, number} more`                                               |
| `face_cleanup_review_dest_none`         | `The scan couldn't attribute these faces to anyone.`                  |
| `face_cleanup_review_dest_gone`         | `This person no longer exists — deleted or merged since the scan.`    |
| `face_cleanup_review_dest_send_to`      | `Send to`                                                             |
| `face_cleanup_review_dest_choose_other` | `Choose someone else…`                                                |
| `face_cleanup_review_dest_option`       | `{name} · {count, number} faces`                                      |
| `face_cleanup_review_dest_self`         | `That's the cluster you're reviewing — pick a different destination.` |
| `face_cleanup_review_tally_owner_multi` | `→ suggested owner`                                                   |

Edited:

- `face_cleanup_review_banner_body` loses its leading `Default is → {ownerName}.` sentence, and
  therefore its only placeholder.
- `face_cleanup_review_tally_added` gains one: `added from cluster` → `added → {name}` (C5).

**All nine locales.** `40ac487f52a` established that this feature ships fully translated; exactly ten
files carry `face_cleanup_review_banner_body` today (en + de, fr, es, it, nl, pl, ru, zh_Hans,
zh_Hant), and the admin who reported this reads the console in German. pl/ru use one/few/many/other
plural forms, zh uses one/other.

This edit has a test waiting for it: `web/src/lib/i18n/placeholders.spec.ts` asserts that no locale
references a placeholder `en.json` does not supply. It exists because a rewritten Face Cleanup banner
once shipped literal `{braces}` to a German admin. Removing `{ownerName}` from `banner_body` in
`en.json` turns all nine locales red until they are updated — see Slice 5.

## Implementation slices (TDD)

Red first, every slice: write the failing test, run it, confirm it fails for the stated reason, then
write the minimum to pass. Web tests follow the register already established in `page.spec.ts` —
`it('folds the staged rest faces into the single Apply, in ONE resolve alongside the flagged faces')`
— behavior sentences describing what the admin observes, not checklists of rendered fields.

### Slice 1 — live counts on the overlay (server)

**Red** — `server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts`, extending the
existing `withCurrentNames` describe (`:209`):

- `it('reports a destination's live face count, not the number the scan recorded')`
- `it('reports the count as a number, not the bigint string Postgres returns')` — fails today on
  `typeof`, and is the whole guard for the `Number()` conversion
- `it('counts only visible, undeleted faces — agreeing with getPersonMetadata on the same fixture')`
- `it('agrees with searchOwnerPeople for the same person')` — the chooser labels its options with
  that number
- `it('marks a suspected owner whose person row was deleted as missing, with a zero count')`
- `it('reports zero for a person with no faces rather than dropping the destination')`
- `it('overlays the reviewed cluster's own face count live as well')`
- `it('leaves eligible and the recorded flagged faces at their scan-time values')`

**Red** — `server/src/dtos/face-repair.dto.spec.ts`: the scan schema requires both new fields and
rejects a string count.

**Green** — the join, groupBy and `Number()` conversion. Expect to re-baseline fixtures that set
`faceCount` without inserting matching `asset_face` rows (the existing `withCurrentNames` test at
`:210` sets `faceCount: 35` against zero real faces; it does not assert on it today, but the D12 test
in `face-repair.scan.spec.ts:150` and any fixture that does will need updating).

### Slice 2 — the fields survive the live-count pass (server)

**Red** — a medium test through `getLatestScan`, not the repository in isolation:

- `it('carries ownerFaceCount and ownerMissing through the live flagged-count recompute')` — fails if
  `withLiveFlaggedCounts`' `{ ...owner }` spread is ever replaced with an explicit literal
- `it('drops a suspected owner whose flagged faces have all been settled since the scan')` — existing
  behavior (`:633`), newly load-bearing because the card list inherits it

**Green** — comments at both sites recording the ordering dependency. No production change expected;
if these pass immediately, that is the one acceptable case — they are regression pins for §1's stated
constraint, and the first must be shown to fail by temporarily reversing the two calls.

### Slice 3 — the destination card (web)

**Red** — `web/src/routes/admin/face-cleanup/[personId]/page.spec.ts`:

- `it('identifies the destination by thumbnail, name, short id and its own face count')`
- `it('states the routing share separately from the destination's size')`
- `it('links each destination to its cluster page, opening in a new tab so staged decisions survive')`
- `it('lists every suspected owner, largest routing share first, collapsing past the third')`
- `it('orders two equally-sized destinations deterministically across re-renders')`
- `it('names no destination at all when the scan could not attribute the faces')`
- `it('warns that a destination no longer exists instead of rendering it as usable')`
- `it('renders a placeholder rather than a broken image when a destination has no thumbnail')`
- `it('formats large face counts with thousands separators')`

### Slice 4 — the destination chooser (web)

**Red** — `page.spec.ts`:

- `it('defaults to the largest suspected owner and sends the whole cluster there')`
- `it('sends staged rest-of-cluster faces to the chosen destination, not to the scan's first guess')`
- `it('re-routes already-staged faces when the destination changes, and says so on the dock chip')`
- `it('names the chosen destination in the move-entire confirmation')`
- `it('offers no destination that no longer exists')`
- `it('defaults past a deleted first suggestion to the next surviving one')`
- `it('leaves both bulk actions disabled when no destination survives, until one is picked')`
- `it('enables the bulk actions on an unattributable cluster once a person is chosen')`
- `it('refuses to move a cluster into itself, explaining why')`
- `it('reverts the selection when the picker is dismissed without choosing')`
- `it('labels the tally generically when faces are bound for several destinations')`
- `it('keeps naming the owner in the tally when there is only one destination')`

**Red** — `PersonPicker.spec.ts`: `it('offers the re-flag lock by default')` and
`it('hides the re-flag lock when the caller cannot honour it')` — the default-true case is what proves
the existing "Move → person…" call site is unchanged.

### Slice 5 — dashboard and translations

**Red** — `ReviewFirstLane.spec.ts` (its fixture at `:50` already carries a suspected owner):

- `it('shows the destination's own size beneath its name, not the number of faces routing there')`
- `it('keeps the bad-target warning in place of the count')`
- `it('puts the routing share in the row tooltip')`

**Red** — `web/src/lib/i18n/placeholders.spec.ts` goes red across all nine locales the moment
`{ownerName}` leaves `banner_body` in `en.json`. **Green** = the translations.

### Gate before push

Server `pnpm lint` (`--max-warnings 0`) **and** `prettier --check .` — separate CI gates. Web
`check:typescript`, `check:svelte`, `pnpm lint`. Prettier over this file: CI Docs Build reaches
`docs/superpowers/specs/`. Regen: `mise open-api` (TypeScript SDK + Dart) for the DTO change; **not**
`mise sql` — `face-repair-scan.repository.ts` carries no `@GenerateSql` decorators.

## Edge cases

| Case                                               | Handling                                                                                                                                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `count()` returns a bigint string                  | `Number()` in the repository; pinned by a `typeof` test (Slice 1)                                                                                                                                                      |
| Suspected owner deleted since the scan             | `ownerMissing` → card warns, chooser omits, default skips (§1–3)                                                                                                                                                       |
| Every suspected owner deleted                      | No default; both bulk actions disabled until a person is picked                                                                                                                                                        |
| No suspected owners at all                         | Explicit none-state; names no destination                                                                                                                                                                              |
| All of an owner's flagged faces settled since scan | `withLiveFlaggedCounts` prunes the owner; may produce the none-state                                                                                                                                                   |
| Destination = the cluster under review             | Bulk actions disabled with an inline reason (C3)                                                                                                                                                                       |
| Destination changed after staging rest faces       | Faces follow; dock chip names the destination (C5)                                                                                                                                                                     |
| Destination with no `thumbnailFaceId`              | Neutral placeholder, not the 403-ing person-scoped route                                                                                                                                                               |
| Two destinations with equal routing share          | Tie-broken on `ownerPersonId` for stable ordering                                                                                                                                                                      |
| Person with zero faces                             | `0`, via left join — the destination is not dropped                                                                                                                                                                    |
| Soft-deleted / invisible faces                     | Excluded, matching `getPersonMetadata` and `searchOwnerPeople`                                                                                                                                                         |
| Large counts                                       | `{count, number}` formatting, matching the page header                                                                                                                                                                 |
| Flagged face whose owner has no card               | Pre-existing and deliberate: tiles read the frozen snapshot, cards read the live list (E13). Tile ribbon keeps its `ownerNameById` fallback; the two are pinned by separate tests so neither is "fixed" into the other |
| Scan completes while the page is open              | Unchanged — `faces-not-in-snapshot` already handled                                                                                                                                                                    |

## Manual verification

Needs a real library with a mixed cluster — the reported case is a 2,952-face cluster flagging 2,382
faces toward one owner.

1. Open a flagged cluster whose destination is an unnamed cluster: the card shows a thumbnail, the
   short id, the destination's own face count, and the routing share. This is the case that was
   unactionable.
2. `[open ↗]` opens the destination's manual review page **in a new tab**; return to the original tab
   and confirm every staged decision survived.
3. On a cluster with several suspected owners: all destinations are listed, `Move entire cluster`
   names the chosen one, and switching the chooser changes where the rest-of-cluster faces go — with
   the dock chip following.
4. On an unattributable cluster: the banner says so and names nobody; choosing a person enables the
   bulk actions.
5. Pick the reviewed cluster itself via `Choose someone else…`: both bulk actions disable with a
   reason.
6. Delete the destination person, reload: the card says it no longer exists, it is gone from the
   chooser, and the default has moved on — all before Apply is pressed.
7. German UI: every new string is translated, no raw keys, no English fallbacks, no literal `{braces}`.
8. Dashboard review lane: the number under the destination name is the destination's size; the routing
   share is in the row tooltip.
