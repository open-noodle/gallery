# Editable album creation date

Design spec for [discussion #520](https://github.com/open-noodle/gallery/discussions/520).

Date: 2026-08-14

## 1. Problem

> Can **Change Album creation date** feature be implemented, as for example I am uploading many
> albums from previous years and only option to sort them by chronological time is to create albums
> in certain order, it would be nice to change creation date and time as if other shared album from
> another user was from lets say from 1996 but photos were digitized in current year it would appear
> on top and there is no way to change that.
>
> — jjaard, 2026-05-05

The requester wants albums to sort by _when the album's content is from_, not by when the album row
was inserted.

Gallery already offers two sorts that read content dates — `MostRecentPhoto` and `OldestPhoto`, both
driven by `startDate` / `endDate` which `mapAlbum` derives from asset `localDateTime`
(`server/src/dtos/album.dto.ts:213-218`). Those do not help here: the photos were digitized this
year, so their asset dates _are_ current-year, and for an album shared **with** him he cannot
correct another user's asset dates.

`album.createdAt` is the only per-album date, and today nothing can write it.

## 2. Decision

Make `album.createdAt` user-editable.

`createdAt` is already plumbed end to end — it is on `AlbumTable`
(`server/src/schema/tables/album.table.ts:36`), in `AlbumResponseDto`
(`album.dto.ts:124`), in the `SyncAlbumV1` sync stream (`sync.repository.ts:214`), on mobile's
`RemoteAlbum` model, rendered by the albums table (`AlbumsTableRow.svelte:61`) and the fork's space
albums table (`space-albums-table.svelte:56`), and sorted on by `AlbumSortBy.DateCreated` (web),
`AlbumSortMode.created` (mobile) and the fork's space-album sort.
The single missing link is that it is absent from `UpdateAlbumSchema` (`album.dto.ts:57`).

The change is therefore one optional DTO field, one service pass-through, a date field in each of
the two existing album-edit surfaces, and a relaxation of three ownership gates.

### 2.1 Rejected alternatives

**A separate nullable `album.date` column.** Semantically cleaner — `createdAt` stays an audit
field — but it costs a fork migration, an `AlbumTable` change, a `SyncAlbumV1` payload change, a
mobile Drift column plus migration, a new sort option in three sort implementations, and nine
locales. It adds divergence in `sync.repository.ts` / `sync.dto.ts`, files upstream churns heavily,
in exchange for semantics no user sees. Rejected on cost.

**Do nothing; point at asset date editing.** Correcting the assets' `dateTimeOriginal` is arguably
the _right_ fix — it also puts the photos in the right place on the timeline — but it does not
address the shared-album case, and it is a large manual chore for the "many albums from previous
years" workflow the requester describes. Rejected as insufficient.

**A private per-viewer override.** Fixes every case including pure viewers, but needs a new
per-user table, endpoints, sync, and a merge rule in every sort path. Rejected as out of proportion.

### 2.2 Accepted consequences

- `createdAt` stops being an audit field. The previous value is overwritten with no undo.
- `album.repository.ts:148,283,421` order by `album.createdAt desc`. Web and mobile re-sort
  client-side so they are unaffected, but raw API and CLI consumers will see backdated albums move
  to the bottom of unsorted listings.
- Year grouping is disabled whenever sort is `DateCreated` (`album-utils.ts:130-133`). Once the date
  is meaningful users will plausibly want it enabled. Out of scope; see §10.

## 3. Scope

In scope: server DTO + service, generated SDKs, web `AlbumEditModal`, mobile `_EditAlbumDialog`,
and the ownership gates guarding both.

Out of scope: a new sort option (`DateCreated` already exists on all three surfaces); bulk
multi-album date editing; per-viewer overrides; adding a `createdAt` display to the album detail
page (it shows the asset date range and keeps doing so); enabling year grouping under `DateCreated`.

### 3.1 Which surfaces reach the editor

Web reaches `AlbumEditModal` from exactly two places, and neither is on an album page:

| Surface                                                                            | Edits name/description via                                   | Reaches the date editor? |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------ |
| `/albums` list, right-click → Edit album (`AlbumsList.svelte:205`)                 | `AlbumEditModal`                                             | yes                      |
| Command palette `cmd:album_rename` (`command-items.ts:265`)                        | `AlbumEditModal`                                             | yes                      |
| Album detail page                                                                  | inline `AlbumTitle` / `AlbumDescription`                     | **no**                   |
| Space album detail page (`spaces/[spaceId]/albums/[albumId]/+page.svelte:431-443`) | inline `AlbumTitle` / `AlbumDescription`, gated on `isOwned` | **no**                   |
| Space albums list (`space-albums-table.svelte:56`)                                 | not editable; renders `createdAt` only                       | **no**                   |

**Decision: leave it at those two entry points for this change.** Adding an inline date affordance
to the album detail pages means inventing a display element next to `AlbumSummary`, which currently
shows the asset date range — a bigger UI question than this feature warrants, and one that would
have to be answered twice (regular and space album pages).

This is an accepted asymmetry with mobile, where the date sits in the kebab menu's Edit dialog and
is therefore visible. Call it out in the PR description: on web, an album's date is changed from the
albums list, not from the album. If that proves too hidden, the follow-up is an inline affordance on
both detail pages (§10), not a second modal.

Note the consequence for #520 specifically: an album shared **into a Space** is most naturally
reached through the space album page, which cannot open the modal. The requester's own workflow
therefore routes through `/albums`, where the album also appears.

## 4. Behaviour specification

Written as Given/When/Then. Every scenario below maps to a test in §6 and the numbering is shared.
Each scenario is owned by exactly one slice, with one deliberate exception: S1, S5 and S6 are
asserted twice — Slice 1 pins the service pass-through against a mock, Slice 2 pins the HTTP
behaviour against a real database. Both halves are named where they appear.

Two groups deliberately use a compact input → outcome form instead: §4.2 (grammar validation) and
M1–M4/M11 (one affordance, varying only by the caller's role). Each is a single input with no
meaningful Given, and spelling out three lines apiece would obscure the boundary table rather than
clarify it.

### 4.1 Server — writing the field

**S1 — an owner sets the date**
Given an album owned by the caller
When the caller sends `PATCH /albums/:id` with `{ "createdAt": "1996-06-15T14:30:00.000Z" }`
Then the response is 200, `body.createdAt` is `1996-06-15T14:30:00.000Z`, and `body.updatedAt` has
advanced.

**S2 — an editor sets the date**
Given an album shared with the caller with role `editor`
When the caller sends the same request
Then the response is 200 and the date is applied.
(`Permission.AlbumUpdate` already grants owner ∪ editor — `server/src/utils/access.ts:208-216`.)

**S3 — a viewer is refused**
Given an album shared with the caller with role `viewer`
When the caller sends the same request
Then the response is 400 with `Not found or no album.update access`.

**S4 — a non-member is refused**
Given an album the caller has no relationship to
Then the response is 400 with the same message.

**S5 — the field is optional**
Given an existing album with a known `createdAt`
When the caller sends `PATCH /albums/:id` with only `{ "albumName": "…" }`
Then the name changes and `createdAt` is **unchanged**.
(Kysely omits `undefined` properties from `set()`; the service already relies on this for every
other optional field.)

**S6 — combined update**
When the caller sends `albumName` and `createdAt` in one request
Then both are applied.

**S7 — millisecond precision survives the round trip**
When the caller sends `1996-06-15T14:30:00.123Z`
Then `GET /albums/:id` returns `1996-06-15T14:30:00.123Z`.
This matters: sub-second precision is what keeps backdated albums from tying in `DateCreated` sorts.

**S8 — the sync stream emits the album**
Given a mobile client with a sync checkpoint taken before the edit
When the date is changed
Then the album appears in the next `SyncAlbumV1` batch carrying the new `createdAt`.
(The `@UpdatedAtTrigger('album_updatedAt')` on `AlbumTable` bumps `updatedAt` and `updateId`.)

### 4.2 Server — input validation

`createdAt` uses the existing `isoDatetimeToDate` codec (`server/src/validation.ts:139-152`), which
is `z.iso.datetime({ offset: true })` decoded to a `Date`.

Read `offset: true` correctly: it **permits** `±HH:MM` _in addition to_ `Z`. It does not require a
timezone — that is the default, and `local` (which would permit a bare local datetime) is left
false. Removing `offset: true` would make the grammar stricter, not looser.

The accepted grammar is not a matter of interpretation: Zod emits the regex below into
`open-api/immich-openapi-specs.json`, where it also becomes the generated clients' validation. Every
scenario here was checked against it rather than reasoned about.

```
^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29
   |\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])
           |(?:0[469]|11)-(?:0[1-9]|[12]\d|30)
           |(?:02)-(?:0[1-9]|1\d|2[0-8])))
T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$
```

| #   | Input                         | Result                  | Why                                                                                                                                                          |
| --- | ----------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S9  | `1996-06-15T14:30:00.000Z`    | accepted                | baseline                                                                                                                                                     |
| S10 | `1996-06-15T14:30:00+02:00`   | accepted                | stored as the equivalent UTC instant                                                                                                                         |
| S11 | `1996-06-15T14:30:00`         | **400**                 | the `(?:Z\|offset)` group is required — the API trap                                                                                                         |
| S12 | `1996-06-15`                  | 400                     | no `T` segment                                                                                                                                               |
| S13 | `not-a-date`                  | 400                     | —                                                                                                                                                            |
| S14 | `""`                          | 400                     | —                                                                                                                                                            |
| S15 | `null`                        | 400                     | the field is optional, not nullable                                                                                                                          |
| S16 | `12345-06-15T14:30:00Z`       | 400                     | `\d{4}-` requires the dash at position 5                                                                                                                     |
| S17 | `0001-01-01T00:00:00.000Z`    | accepted                | `\d{4}` matches `0001`; within `timestamptz` range                                                                                                           |
| S18 | a future date                 | accepted                | **deliberate** — see §5                                                                                                                                      |
| S19 | `1996-06-15T14:30Z`           | accepted                | seconds are optional in the pattern                                                                                                                          |
| S20 | `1996-06-31T00:00:00Z`        | 400                     | June is in the 30-day branch — real calendar validation                                                                                                      |
| S21 | `1997-02-29T00:00:00Z`        | 400                     | 1997 is not a leap year                                                                                                                                      |
| S22 | `1996-02-29T00:00:00Z`        | accepted                | 1996 **is** — the leap branch matches                                                                                                                        |
| S23 | `1996-06-15T24:00:00Z`        | 400                     | hours cap at `2[0-3]`                                                                                                                                        |
| S24 | `1996-06-15T14:30:00.123456Z` | accepted, **truncated** | the pattern allows `\.\d+`, but `new Date()` keeps only milliseconds. Assert the stored value is `…123Z`, so the loss is pinned rather than discovered later |
| S25 | `1996-06-15t14:30:00z`        | 400                     | the pattern requires uppercase `T` / `Z`, though ISO 8601 permits lowercase                                                                                  |

S20–S22 matter more than they look: this feature exists to backdate albums into the 1990s, and
February 29 is exactly the input that quietly breaks naive date handling.

**S26 — an empty body is a no-op-ish update**
Given any album the caller may update
When the caller sends `PATCH /albums/:id` with `{}`
Then the response is 200, no field changes, and `updatedAt` still advances (the service always sets
`id`, so the `UPDATE` runs and the `album_updatedAt` trigger fires). Pre-existing behaviour, pinned
here because adding a field to the DTO is when someone would think to change it.

### 4.3 Web

**W1 — the modal pre-fills in local time**
Given an album with `createdAt` `1996-06-15T12:30:00.000Z` and a browser in `Europe/Berlin`
When `AlbumEditModal` opens
Then the date input shows `1996-06-15T14:30:00.000`.

Local time is the right interpretation, but note it is **not** what the albums table shows. That
column renders `dateLocaleString` — a local closure in `AlbumsTableRow.svelte:24`, duplicated in
`space-albums-table.svelte:31` — which formats with `dateFormats.album`
(`constants.ts:35-39`): `{ month, day, year }`, **date only**. See §4.5.

**W2 — editing submits a zoned ISO string**
When the user changes the input to `1996-06-15T14:30:00.000` and submits
Then `updateAlbumInfo` is called with a `createdAt` carrying an offset
(Luxon `DateTime.fromISO(local).toISO()`), never a bare local string — S11 would otherwise 400.

The offset must be the **historical** one for that instant, not today's: Luxon resolves
`Europe/Berlin` in June 1996 to `+02:00` via the IANA database. A hand-rolled
`new Date().getTimezoneOffset()` would stamp the _current_ offset onto a 1996 date and land the
album an hour off. Assert the full string, not just that an offset is present.

**W3 — no blur required**
When the user types a date and clicks Save without blurring the input first
Then the typed value is submitted.
(`DateInput` uses `bind:value`, so this should already hold; the fork has been bitten by the
equivalent bug on `@immich/ui`'s `DatePicker` — `PersonEditBirthDateModal.spec.ts` — so it gets
pinned rather than assumed.)

**W4 — an unchanged date is not sent**
When the user edits only the name and submits
Then the DTO contains `albumName` and no `createdAt`.

"Unchanged" must be decided on **instants**, not strings:
`DateTime.fromISO(input).toMillis() !== DateTime.fromISO(album.createdAt).toMillis()`.
The input is local-zone and `album.createdAt` is normally `…Z`, so string comparison would report
every album as changed. Include a test where the user opens and closes the modal untouched, in a
non-UTC zone, and assert `createdAt` is absent — that is the case string comparison fails.

**W5 — an emptied or invalid date is not sent**
When the user clears the date input and submits
Then the DTO omits `createdAt` and the name/description edits still apply.

**W6 — gating: owner**
Given an album owned by the caller
When the caller right-clicks it in the albums list
Then the context menu shows Edit, Share, Download and Delete.

**W7 — gating: editor**
Given an album shared with the caller as `editor`
When the caller right-clicks it in the albums list
Then the context menu shows Edit and Download, and **not** Share or Delete.
This is the change: `showFullContextMenu` (`AlbumsList.svelte:173`) is one flag covering Edit,
Share and Delete, gated on `albumUsers[0].user.id === authManager.user.id`. It splits into
`canEdit` (owner ∪ editor) and `isOwner` (Share, Delete).

**Correction (found during implementation, Task 5 review).** An earlier draft of this spec
claimed sharing and deletion are both owner-only on the server. Only deletion is:
`Permission.AlbumDelete` (`access.ts:218-220`) is a bare `checkOwnerAccess`, but
`Permission.AlbumShare` (`:222-230`) is byte-identical to `AlbumUpdate` — owner ∪ editor —
and it gates `addUsers`/`removeUser`/`updateUser` plus shared-link creation.

Share nevertheless stays owner-gated in this UI. Not because the server demands it, but
because the albums-list menu has always gated it that way; widening it would be an
unrequested behaviour change riding along with a date picker. The UI is deliberately the
stricter of the two, which is the safe direction — it can never offer an action the server
would refuse. Any comment justifying the gate must say that, rather than mis-describing the
server's RBAC.

**W8 — gating: viewer**
Given an album shared with the caller as `viewer`
When the caller right-clicks it in the albums list
Then the context menu shows Download only.

**W9 — gating: command palette**
Given the album detail page for an album the caller edits but does not own
Then `cmd:album_rename` is available.
`AlbumContext` already carries `isEditor`, documented as "Owner or Editor"
(`command-context-manager.svelte.ts:20-21`), so this is `ctx.album.isOwner` → `ctx.album.isEditor`
at `command-items.ts:260`.

**W10 — `DateCreated` sort honours the edited value**
Given three albums with `createdAt` 1996, 2010 and 2026
When sorted by `AlbumSortBy.DateCreated` descending
Then the order is 2026, 2010, 1996.
Characterization test over untouched code (`album-utils.ts:243`), included because the feature's
entire value rests on it.

**W11 — the list re-sorts after an edit**
Given `/albums` sorted by Date created
When the user changes an album's date through the context menu
Then the list reflects the new position without a reload.
`handleUpdateAlbum` emits `eventManager.emit('AlbumUpdate', response)` (`album.service.ts:310`) and
`sortAlbums` runs on the derived album list, so this should follow — but it is the user-visible
payoff of the whole feature, so it gets asserted rather than assumed.

### 4.4 Mobile

Mobile already answers "may this user edit?" **twice, differently**, on this one screen, and the
spec must not add a third answer:

- `_RemoteAlbumPageState.build` (`drift_remote_album.page.dart:204`) computes
  `isOwner = user.id == _album.ownerId` and gates `onEditTitle` on it. Synchronous, no role lookup.
- `_AlbumKebabMenu` (`:442-450`) computes `isOwner` the same way **and** resolves editor-ness
  asynchronously — `FutureBuilder` over `remoteAlbumServiceProvider.getUserRole(album.id, user.id)`,
  combined as `isOwner || canAddPhotos`, defaulting to **false** while the future is pending
  (`snapshot.data ?? false`).

So the kebab menu already has a working owner-or-editor signal that **fails closed**, three lines
above the callback this change re-gates.

**Decision: reuse `getUserRole`, do not introduce a `currentUserRole` predicate.** `onEditAlbum`
moves inside the existing `FutureBuilder` and is gated on the same `isOwner || canAddPhotos`
expression that already gates `onAddPhotos`. Nothing new is invented, and the two adjacent
affordances cannot disagree.

`RemoteAlbum.currentUserRole` is explicitly **not** used here. It is null unless `getAll` was passed
`currentUserId` (#985), and `updateAlbum` replaces the state album with `toRemoteAlbum()` output,
which carries no role at all — so an edit would silently revoke the affordance it just used. A
fail-open predicate over that field would also contradict the fail-closed `FutureBuilder` beside it.

`onEditTitle` (`:226`) stays gated on `isOwner`: that widget has no `FutureBuilder`, and adding one
to the app bar to relax a title-tap is out of proportion. Editors reach the dialog through the kebab.

**M1 — kebab Edit album for an owner** → shown (`isOwner` true, no lookup needed).
**M2 — for an `editor`** → shown once `getUserRole` resolves to `editor`.
**M3 — for a `viewer`** → hidden.
**M4 — while `getUserRole` is pending** → **hidden**, then shown if the role resolves to editor.
Fail-closed, matching `onAddPhotos`. A brief flicker into existence is the accepted cost of
consistency with the affordance beside it.
**M11 — with no current user** (`currentUserProvider` null) → hidden; `isOwner` is false and
`getUserRole` is called with `''`, which cannot match a role.

**M5 — the dialog shows the current date**
Given `_EditAlbumDialog` opened for an album created 1996-06-15
Then a date row displays that date alongside the title and description fields.

**M6 — picking a date saves it**
When the user picks a new date and taps Save
Then `updateAlbum` is called with `createdAt` set to the picked instant.

**M7 — cancelling the picker changes nothing**
When the user opens the picker and dismisses it
Then the pending date is unchanged and Save sends the original value.
`showDateTimePicker` returns `null` on dismiss; `action.service.dart:209-211` is the established
handling to mirror.

**M8 — the API repository maps it**
When `updateAlbum(albumId, owner, createdAt: dt)` is called
Then `UpdateAlbumDto.createdAt` is `Optional.present(dt)`; when `createdAt` is null it is
`Optional.absent()`, matching every other field in `drift_album_api_repository.dart:71-99`.

**M9 — the wire format carries an offset**
Given a `createdAt` picked in any timezone the picker offers
When `UpdateAlbumDto` is serialized
Then the JSON value ends in `Z`.
The Dart generator emits `value.toUtc().toIso8601String()` (verified in
`mobile/openapi/lib/model/shared_link_create_dto.dart`), so S11 cannot be tripped from mobile
regardless of the picker's timezone selection. Pinned because it is invisible generated code.

**M10 — the local Drift row is updated**
Then the album's `createdAt` in `remoteAlbumEntity` matches the new value.
`remote_album.repository.dart:227-240` already writes `createdAt: Value(album.createdAt)`, and
`toRemoteAlbum` already maps it (`drift_album_api_repository.dart:143`), so this is a pin on an
existing path rather than new code.

### 4.5 Date, or date and time?

`createdAt` is displayed in exactly two places, both date-only (`dateFormats.album`). A
`datetime-local` editor therefore lets a user set a time they can never read back.

**Decision: keep date _and_ time.** The requester asked for "creation date and time"; more
importantly, minute-or-coarser precision makes ties likely precisely in the bulk-backdating workflow
this exists for (a dozen albums all stamped 1996-01-01T00:00), and `DateCreated` ties resolve
arbitrarily. Time is doing real work as a tiebreaker even when invisible.

The alternative — a date-only editor writing local midnight — is simpler and matches every display
surface, at the cost of unbreakable ties. If we take it, S24's truncation scenario and W2's
historical-offset trap both disappear, and `@immich/ui`'s `DatePicker` replaces `DateInput`. Revisit
only if the datetime input tests badly.

## 5. Future dates

Mobile's shared `showDateTimePicker` hard-codes `lastDate: now`
(`mobile/lib/widgets/common/date_time_picker.dart`), so future dates are unreachable there. Web's
`DateInput` allows anything up to `9999-12-31T23:59`.

**Decision: leave the asymmetry, add no server-side future check.** Reasons: it is exactly the
behaviour asset date editing already has (`AssetChangeDateModal` uses the same unbounded
`DateInput` against the same capped mobile picker), a server-side check would produce spurious 400s
under client/server clock skew, and a permissive API keeps scripted bulk backdating viable — which
is the requester's actual workflow. S18 pins acceptance so this stays a decision rather than an
accident.

## 6. Implementation slices

TDD throughout: each slice writes the failing test first, confirms it fails for the stated reason,
then makes it pass. Slices are ordered so each one is independently green.

`pnpm install` is required first — a fresh worktree has no `node_modules`.

### Slice 1 — server contract

1. **Red.** Add the service-level halves of S1, S5 and S6 to `describe('update')` in
   `server/src/services/album.service.spec.ts:525` — that `mocks.album.update` receives `createdAt`
   when the DTO carries it, and receives no `createdAt` key when it does not. The HTTP-level
   assertions of those same scenarios (status codes, response body, persistence) belong to Slice 2;
   the unit test only pins the pass-through.
   Note the existing assertion style at :573-577 passes an exact object literal;
   `toHaveBeenCalledWith` uses `toEqual` semantics, which ignore `undefined`-valued keys, so the
   existing tests keep passing once the service gains the field.
2. **Green.** `album.dto.ts:57` — add to `UpdateAlbumSchema`:
   ```ts
   createdAt: isoDatetimeToDate
     .optional()
     .describe('Album creation date. Must be an ISO 8601 string including a UTC offset.'),
   ```
   `album.service.ts:231-240` — add `createdAt: dto.createdAt` to the object handed to
   `albumRepository.update`.
3. No repository change: `update(id, album: Updateable<AlbumTable>, authUserId)`
   (`album.repository.ts:621`) already accepts it because `createdAt` is `Generated<Timestamp>`.
4. Regenerate both clients. **Do not use `make open-api` or `mise open-api`** — the make target is a
   removed stub that exits 1, and mise's composite task hardcodes `//server:install`,
   `//server:build`, `//server:sync-open-api`, where `//` resolves to the **main checkout**, so it
   would silently generate clients from main's server source rather than this branch's. From the
   worktree:
   ```bash
   cd server && pnpm build && node ./dist/bin/sync-open-api.js
   cd .. && mise run open-api-typescript && mise run open-api-dart   # needs JDK 21
   ```
   Regenerating a second time must be byte-identical. `mobile/openapi/**/*.dart` is marked
   `-diff -merge` in `.gitattributes`, so git reports those files as `Bin N -> M bytes` with no
   textual diff — verify the new field landed with `grep`, not `git diff`. Skipping the Dart half
   passes locally and fails CI's **OpenAPI Clients** job.

### Slice 2 — server validation and permissions (e2e)

1. **Red.** Add the HTTP halves of S1, S5, S6 plus S2, S3, S4, S7 and S9–S26 to
   `describe('PATCH /albums/:id')` in `e2e/src/specs/server/api/album.e2e-spec.ts:589`. Written
   before Slice 1 ships they fail on the field being stripped by Zod; confirm that is the failure
   reason, not a fixture problem.
   The suite already has the fixtures: `user1Albums[0]` is shared with `user2` as editor,
   `user1Albums[3]` as viewer, and the existing "should be able to update as an editor" / "should
   not be able to update as a viewer" tests give the exact shape and error string
   (`Not found or no album.update access`) to mirror.
2. **Green.** Slice 1 already satisfies these; if any fail, the DTO or service is wrong, not the test.
3. Drive S9–S25 from a table rather than 17 hand-written cases — the scenarios are `(input,
expectedStatus)` pairs and read better as `it.each`. Assert the **stored** value for the accepted
   ones, not just the status, or S24's truncation passes silently.

S5 in particular has to be proved here rather than in the unit test — "an omitted `createdAt` leaves
the stored value alone" is a claim about Kysely's `set()` dropping `undefined` keys. The existing
"should update an album" test at :590 is the empirical precedent (it sends only `albumName` and
`description` and expects every other field untouched), but only a real database settles it.

S8 goes in `server/test/medium/specs/sync/sync-album.spec.ts`, next to the existing album sync
coverage: assert the album appears in the next `SyncEntityType.AlbumV1` batch carrying the new
`createdAt`. Medium tests need Docker plus, in a fresh worktree, `@immich/sdk` and
`@immich/plugin-sdk` built first (`pnpm --filter @immich/sdk build`, then `@immich/plugin-sdk`, or
`mise run plugins`).

### Slice 3 — web modal

1. **Red.** New `web/src/lib/modals/AlbumEditModal.spec.ts` covering W1–W5. Mock
   `$lib/services/album.service`'s `handleUpdateAlbum` (the modal's actual dependency) with
   `vi.hoisted` + `vi.mock` and assert the exact DTO. `SpaceEditModal.spec.ts` is the closest model:
   it documents why queries must be pinned to `data-testid` (`@immich/ui`'s `Field`/`Label` wiring
   uses `aria-labelledby`, which happy-dom does not reliably associate) and why the submit button is
   `Save` capitalised (that string comes from `@immich/ui`'s own translation service, not
   svelte-i18n, so it is real English in tests while `$t()` keys are not).

   `web/vite.config.ts` pins `TZ: 'UTC'` for unit tests, so the runner's zone cannot exercise the
   local↔UTC conversion W1 and W2 are about. Force the zone through Luxon instead —
   `Settings.defaultZone = 'Europe/Berlin'`, restored afterwards — which is what the component
   reads. The same config sets `clearMocks: true`, so mock **call history** is cleared between
   tests; implementations are not, so re-stub `mockResolvedValue` in `beforeEach`.

2. **Green.** `AlbumEditModal.svelte` — a third `Field` labelled `$t('date_created')` between Name
   and Description, holding `DateInput` with `type="datetime-local"`. Keep local state as a Luxon
   `DateTime` string in `yyyy-MM-dd'T'HH:mm:ss.SSS`, seeded from `album.createdAt`; on submit
   include `createdAt: DateTime.fromISO(value).toISO()` only when the parsed value is valid **and**
   its `.toMillis()` differs from `DateTime.fromISO(album.createdAt).toMillis()` (W4 — never compare
   the strings).
3. `DateInput` (`web/src/lib/elements/DateInput.svelte`) is the right element rather than
   `@immich/ui`'s `DatePicker`: it is what `AssetChangeDateModal` uses for date **and** time, and
   `step=".001"` preserves the milliseconds S7 protects. No timezone combobox — unlike an asset's
   `dateTimeOriginal`, an album's `createdAt` is a plain instant, so the browser's local zone is the
   correct and only interpretation.
4. `handleUpdateAlbum` (`album.service.ts:305`) passes `UpdateAlbumDto` through verbatim and needs
   no change.

### Slice 4 — web gating

1. **Red.** W6–W8 against `AlbumsList.svelte`, W9 against `command-items.ts` (extend
   `command-items.spec.ts:604`, which already asserts the modal opens with the raw DTO).
2. **Green.** In `AlbumsList.svelte`, split `showFullContextMenu` (:173) into `canEditSelectedAlbum`
   (owner ∪ editor, computed the way `isAlbumEditor` is on the space-album page,
   `spaces/[spaceId]/albums/[albumId]/+page.svelte:94-99`) and `isSelectedAlbumOwner` (the existing
   check). Edit uses the former; Share and Delete keep the latter. In `command-items.ts:260`, switch
   `cmd:album_rename` from `ctx.album.isOwner` to `ctx.album.isEditor`.
   **Both derived flags keep the `allowEdit &&` conjunct.** It is the prop that makes the whole
   context menu conditional (`AlbumsList.svelte:35,46`) and only `/albums` passes it
   (`routes/(user)/albums/+page.svelte:50`); dropping it from the edit branch would surface Edit on
   a list that opted out of editing entirely.
3. Leave `cmd:album_share` on `isOwner`.

### Slice 5 — mobile plumbing

1. **Red.** M8 in `mobile/test/repositories/drift_album_api_repository_test.dart`, including M9's
   wire assertion — serialize the DTO and assert the JSON string ends in `Z`, rather than trusting
   the generated code. M10 in `mobile/test/domain/services/remote_album_service_test.dart`.
2. **Green.** Thread `DateTime? createdAt` through
   `drift_album_api_repository.dart:71` → `UpdateAlbumDto(createdAt: …)`,
   `remote_album.service.dart:137`, and `remote_album.provider.dart:154`, following the
   `Optional.present` / `Optional.absent` shape every sibling field already uses. Nothing else
   changes: `toRemoteAlbum` (`drift_album_api_repository.dart:143`) and
   `RemoteAlbumRepository.update` (`remote_album.repository.dart:227-240`) already carry `createdAt`.

No `canEditAlbum` predicate is added to `mobile/lib/utils/album_permissions.dart`. See §4.4 — the
kebab menu already resolves owner-or-editor through `getUserRole`, and a second, differently-failing
answer beside it would be worse than no helper at all.

### Slice 6 — mobile dialog and gating

1. **Red.** M1–M7 and M11 in `mobile/test/presentation/pages/drift_remote_album_page_test.dart`.
   Widget tests here have a documented history of passing vacuously — prove each one red first by
   inverting the expectation, and assert on the mock call rather than on rendered text where the
   text could match an unrelated widget. M4 needs a pending `getUserRole` future, not a resolved
   one, or it silently becomes a duplicate of M2.
2. **Green.** Add a date row to `_EditAlbumDialog` (`drift_remote_album.page.dart:242`) driven by
   `showDateTimePicker`, which returns `String?` — an ISO value with a `+HH:MM` offset from
   `formatAsOffset` (`duration_extensions.dart:3-4`), or `null` on dismiss. Parse with
   `DateTime.parse` and pass to `updateAlbum`; `action.service.dart:202-219` is the existing
   consumer to mirror, including its null-means-cancelled handling.
3. Move `onEditAlbum` (`:459`) inside the existing `FutureBuilder` and gate it on the same
   `isOwner || canAddPhotos` expression that already gates `onAddPhotos` (`:457`). Leave
   `onDeleteAlbum`, `onAddUsers`, `onCreateSharedLink`, `onToggleAlbumOrder` and `onLinkToSpace`
   owner-gated, and leave `onEditTitle` (`:226`) on `isOwner` — §4.4 explains why the app bar does
   not get a role lookup.

### Slice 7 — sort regression guard

1. **Red.** W10 in a new `web/src/lib/utils/album-utils.spec.ts`, and W11 wherever the `/albums`
   list is exercised. W10 passes against today's code — that is the point of a characterization
   test — so prove it meaningful by flipping the expected order and watching it fail.
2. It is small, and it is the assertion the whole feature exists to satisfy.

## 7. i18n

**No new keys.** `date_created` already exists in `en` and all nine required locales
(verified), the mobile picker's own strings (`date_and_time`, `timezone`, `cancel`,
`action_common_update`) exist, and the error paths reuse `errors.unable_to_update_album_info` (web)
and `album_update_error` (mobile).

If implementation turns up a genuinely new string, it lands in `de fr it nl pl es ru zh_Hans
zh_Hant` in the same commit, inserted in alphabetical position, followed by
`npx prettier --write i18n/*.json`.

## 8. Verification

`pnpm install` first — a fresh worktree has none.

Several documented gates in `CLAUDE.md` do not do what they say. The commands below are the
corrected forms, verified against this worktree:

```bash
# server — NOTE: `pnpm test -- --run <path>` silently runs the WHOLE suite (pnpm passes the
# literal `--` through and vitest drops the path filter). Omit the `--`.
cd server && pnpm test --run src/services/album.service.spec.ts
cd server && pnpm test:medium --run test/medium/specs/sync/sync-album.spec.ts   # needs Docker
cd server && pnpm check && pnpm lint && pnpm format

# web
cd web && pnpm test --run src/lib/modals/AlbumEditModal.spec.ts
cd web && pnpm test --run src/lib/utils/album-utils.spec.ts src/lib/managers/command-items.spec.ts
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm format

# e2e — needs a running stack; `make e2e-api-dev` does not exist
cd e2e && pnpm test src/specs/server/api/album.e2e-spec.ts

# mobile
cd mobile && flutter test test/repositories/drift_album_api_repository_test.dart \
                          test/domain/services/remote_album_service_test.dart \
                          test/presentation/pages/drift_remote_album_page_test.dart
cd mobile && dart analyze --fatal-infos
cd mobile && dart format --set-exit-if-changed --output=none <only the files you touched>
```

Traps this list is built to avoid:

- `pnpm test -- --run <path>` runs everything and reports unrelated pre-existing failures.
  `pnpm exec vitest run <path>` from `server/` is the opposite failure — it loads no config and dies
  with `describe is not defined` before running anything. Both forms appear in `CLAUDE.md`.
- **Check the reported file and test counts.** A vitest run of zero files is green.
- `vitest` does not typecheck. `pnpm check` (`tsc --noEmit`), `pnpm lint` and `pnpm format` are
  three separate CI gates; eslint-green is not prettier-green.
- `dart format .` across `mobile/` reformats hundreds of files, because the local Flutter formats
  differently from CI and CI's task covers `lib` only. Format only the files this change touches.
- `dart analyze` is not a substitute for `flutter test` — generated-code compile errors only surface
  when a test actually compiles.

Mobile prerequisites: use the Flutter version pinned in `mobile/mise.toml` (read it — this worktree
says 3.44.8, and the pin has moved before), then `flutter pub get` and generate localization/keys
once: `dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart`. If a
`mise install` symlinks a patch that self-reports the wrong version, invoke the binary directly from
`~/.local/share/mise/installs/aqua-flutter-flutter/<version>/flutter/bin/`. Export `PATH` _before_
`cd`, not chained after it — a failed `cd` short-circuits the `&&` and you silently get the default
toolchain.

Prettier must also run over this spec before committing; CI's Docs Build is strict about markdown
under `docs/`.

Manual check, both platforms: backdate an album to 1996, sort the albums list by Date created
descending, confirm it lands last; confirm the mobile list agrees after a sync.

## 9. Risks

- **`createdAt` loses its audit meaning**, irreversibly per album. Accepted (§2.2).
- **Unsorted API listings reorder.** `album.repository.ts:148,283,421`. Web and mobile re-sort
  client-side; CLI and third-party consumers may notice.
- **Rebase surface.** Upstream files touched: `album.dto.ts`, `album.service.ts`,
  `AlbumEditModal.svelte`, `AlbumsList.svelte`, `drift_remote_album.page.dart`,
  `drift_album_api_repository.dart`, `remote_album.service.dart`, `remote_album.provider.dart` — one
  or two lines each. Fork-only file: `command-items.ts`. If upstream ever adds its own album date
  field, reconcile then.
- **The mobile affordance fails closed.** Gating `onEditAlbum` on the `getUserRole` future (M4) means
  that if the lookup is slow or errors, an editor sees no Edit entry rather than one the server would
  refuse. That is the deliberate cost of matching `onAddPhotos` beside it; the alternative was two
  affordances on one screen disagreeing about the same permission.
- **Concurrent edits are last-write-wins.** Two clients editing the same album's date race with no
  detection — same as every other field on this endpoint, which carries no `updatedAt` precondition.
  Not introduced here, not addressed here.
- **Millisecond truncation is silent.** An API client sending microsecond precision gets it rounded
  to milliseconds with a 200 (S24). Pinned by test so it is documented behaviour.

## 10. Follow-ups (not this change)

- Enable year grouping under the `DateCreated` sort once the date is meaningful
  (`album-utils.ts:130-133`).
- **`createdAt` on `CreateAlbumSchema`** (`album.dto.ts:34`), so an importer can create a
  correctly-dated album in one call instead of create-then-patch. This is the closest thing to what
  the requester actually described ("uploading many albums from previous years") and is a smaller
  change than bulk editing — but it widens the create contract, so it gets its own decision.
- Bulk date editing across selected albums.
- An inline date affordance on the album detail pages, if the albums-list-only entry point (§3.1)
  proves too hidden. It would have to be answered for the space album page too.
- Reply to #520 explaining that a viewer of someone else's album still cannot reorder it, and what
  would be needed (per-viewer override, §2.1).
