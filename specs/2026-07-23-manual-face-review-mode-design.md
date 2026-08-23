# Manual face review mode — design

**Date:** 2026-07-23
**Branch:** `feat/face-manual-review` (off `feat/face-review-unified`, PR #834)
**Depends on:** the unified verdict layer from [face review unification](./2026-07-22-face-review-unification-design.md) and its [remediation](./2026-07-23-face-verdict-layer-remediation-design.md).

> **Revision note (post-review).** The first draft of this spec claimed manual mode could reuse the
> guided review page behind a mode flag. A verification pass against `review.svelte.ts` disproved
> that — see §6.5. The design now **forks the review UI**. Several other first-draft claims were also
> wrong and are corrected inline; §11 lists them so reviewers can see what changed and why.

## 1. Context

The admin face cleanup console is **scan-driven end to end**. An admin runs a scan, the scan persists
a flagged-face snapshot, and every review surface reads back from that snapshot. Open a person the
scan did not flag and the console renders "no flagged faces" — there is no way to say "I know this
person's cluster is dirty, show me everything."

This adds a second entry path — **manual review** — letting an admin pick any person and audit **all**
of that person's faces, with the same tile-grid / bulk-select / apply interaction and the same verdict
writes. The guided flow is not modified.

## 2. Goals / non-goals

**Goals**

- An admin can open **any** person, with no scan in existence, and see **all** of that person's faces.
- The per-face actions are the ones that already exist, writing the rows they already write.
- Manual mode introduces **no new table, column, or status**.
- **The guided flow is untouched.** It is shipped and CI-green; this feature must not destabilise it.

**Non-goals**

- **Not user-facing.** Admin-only; regular users keep their per-person suggestion queue. (Rejected:
  user-scoped manual review would mean generalising ~15 admin endpoints to owner-scope + space-editor
  RBAC.)
- **Shared-space people are out of scope.** The verdict table has a `spacePersonId` arm, but the
  people browser is built on `searchOwnerPeople`, which is `person`-table and owner-scoped. Manual
  review covers **personal people only**. Space-person cleanup remains the suggestion flow's job.
- **No cross-owner face reassignment.** `resolveFaces` refuses destinations owned by another user and
  that guard stays. "Change the owner" means "reassign to a different person in the same owner's
  library" — the existing `moveToPerson`.
- No new scan tuning, scheduling, or bulk-across-people manual mode.
- **No migration.** This feature adds no table and no column.

## 3. The model — how manual decisions fit the existing schema

The verdict layer stores three facts, each with exactly one home:

| Fact                                           | Home                                                    |
| ---------------------------------------------- | ------------------------------------------------------- |
| positive — "a human placed face F on person P" | `face_identity_face.source = 'manual'`                  |
| negative — "F is not P"                        | `face_person_verdict` row (status `rejected`/`ignored`) |
| not-a-face                                     | `asset_face.deletedAt`                                  |

Manual mode writes **only these**:

| Manual action                    | Writes                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Move to person**               | `asset_face.personId` → destination; `face_identity_face.source='manual'` on the destination identity; drain pending verdicts |
| **Lock** ("verified, this is P") | `face_identity_face.source='manual'` on the current person's identity; drain pending                                          |
| **Unknown person**               | create a new unnamed person, move the faces there with manual links                                                           |
| **Not a face**                   | `asset_face.deletedAt = now()`, `personId = NULL`, delete the identity link, drain pending                                    |
| **Keep** (default)               | **nothing** — the face is omitted from the request entirely                                                                   |
| ~~Stay~~                         | **not offered** — see §3.2                                                                                                    |

### 3.1 "Keep" deliberately writes nothing

An admin who eyeballs 400 faces and finds them correct writes zero rows. Auto-locking everything
reviewed would mass-stamp `source='manual'`, and manual-linked faces are excluded from all future
scan flagging — blinding the cleanup engine across the cluster. This is the same reasoning as the
signed-off R1 decision that people-merges preserve each face's prior source.

**Consequence (accepted):** re-auditing later starts fresh; there is no "already checked" record.
**Lock** is the deliberate opt-in for durability.

This is also why manual mode needs its own view-model: the guided model has **no neutral state**
(§6.5).

### 3.2 "Stay" is scan-only, by construction

Guided "stay" means _"the scan suspected this face is person Q; it is not, it is correctly P"_ and
writes a negative verdict **against Q**, read from the snapshot via
`snapshotOwnerByFace.get(assetFaceId)!` (`face-repair.service.ts:917,923`). With no scan there is no
Q — the non-null assertion would yield `undefined` and produce a 500 / FK violation. So `stay` keeps
its snapshot gate on the server **and** is absent from the manual UI. "I looked and it's fine" is
expressed by leaving the face on the default `keep` state.

## 4. What already works, and what does not

Verified against the tree at `7945a12dff7`.

| Capability                                                | Status without a scan                                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `getClusterFaces(personId, {excludeFaceIds, page, size})` | **works** — personId + paging only; no scan dependency (merely _routed_ under `scan/`)                     |
| `getPersonFlaggedFaces` with no scan                      | **works** — returns `{ flaggedFaces: [] }`, does not throw                                                 |
| `moveToPerson` on a non-flagged face                      | **works** — explicitly accepts any eligible face currently on personId                                     |
| `entireCluster` move                                      | **works server-side** — not snapshot-gated (but see §6.4: the guided _UI_ binds it to the scan)            |
| `lock` / `unknown` / `detach`                             | **blocked** by guard E15                                                                                   |
| `stay`                                                    | blocked by E15 **and** semantically undefined (§3.2)                                                       |
| Person name + `ownerId` for the review page               | **missing** — both read off `getLatestScan()`                                                              |
| Owner-scoped people list                                  | **works** — `getFaceRepairOwnerPeople`, optional `query`, paginated, `{id,name,faceCount,thumbnailFaceId}` |
| Face crops for non-owned clusters                         | **works** — `GET admin/face-repair/faces/:assetFaceId/thumbnail`, join-free, admin-gated                   |

## 5. Server changes

### 5.1 Relax guard E15 for `lock` / `unknown` / `detach`

`face-repair.service.ts:841-845`:

```ts
// stay/lock/detach/unknown (E15) act only on this person's raw flagged snapshot.
const unresolvable = findUnresolvableIds([...stay, ...lock, ...detach, ...unknown], flaggedIds);
if (unresolvable.length > 0) {
  throw new BadRequestException('Some faces are not in the flagged snapshot for this person');
}
```

E15's rationale — _"a face never flagged has no suspected owner and no keep/lock/detach meaning"_ —
holds for `stay` (§3.2) but is stricter than necessary for the other three: locking, parking, and
binning are well-defined for any face on the person.

**Change:** `stay` keeps the gate. `lock` / `unknown` / `detach` accept any face **currently eligible
on `personId`**.

This is a **permissive** server change with respect to every existing client: the guided web client
only ever puts flagged ids into those buckets (`review.svelte.ts:93-94`), so no web or e2e test
depends on the rejection.

### 5.2 The eligibility check this requires (safety-critical)

Snapshot membership implicitly proved _"this face is on this person"_ — and the mechanism is more
specific than "the id was in a stored list". `getScanFlaggedFacesForPersons`
(`face-repair-scan.repository.ts:293-316`) INNER JOINs `asset_face` and re-validates `personId`,
`deletedAt`, `isVisible` and `sourceType` **at snapshot-read time**, inside the resolve call itself.
So today a foreign, deleted, or nonexistent id cannot reach the write path at all: it never enters
`flaggedIds`, and the snapshot gate rejects it.

That is why lifting the gate is not merely permissive — it **removes a live guard**. Dropping it for
three buckets removes that proof:

- `detach` — **already person-scoped**: `detachFaces` filters `WHERE personId = personId`
  (`face-repair.repository.ts:275-284`), and the identity-strip is keyed on the `RETURNING` output,
  not the caller's raw ids, so it inherits the same scope. A foreign id is inert.
- `unknown` — routed through `executeRepair`, whose `reattributeFaces` has a still-on-source guard
  (`face-repair.repository.ts:228-237`). A foreign id is skipped at write time.
- `lock` — **not scoped.** `replaceFaceIdentities` is a bare insert with no join to `asset_face` and
  no person/owner predicate (`face-identity.repository.ts:2369-2402`); the only constraints are two
  FKs. Any existing `asset_face.id`, including another user's, would be linked to this identity.
  (Contrast `linkPersonFaces` at `:2405-2443`, which _is_ person-scoped — the codebase has both
  shapes.)

**Add** `FaceRepairRepository.getEligibleFaceIdsForPerson(personId, faceIds)` returning the subset
currently on `personId`, not soft-deleted, on a visible asset. `resolveFaces` **rejects** (400) when
any `lock` id is not eligible — a rejection, not a silent skip, because a manual lock is an explicit
human assertion and silently dropping it would misreport what was applied.

Two constraints on the implementation:

- **Mirror `getClusterFacePage`'s predicate** (`face-repair.repository.ts:181-190`) exactly. That is
  the canonical "eligible faces of a person" filter; a third subtly-different variant is a bug farm.
- **Do not add `@GenerateSql`.** `FaceRepairRepository` carries zero SQL-generation decorators, so no
  `mise sql` regeneration is required. (The first draft said otherwise and named a non-existent
  decorator.)
- The read is **advisory** — it races the write-time guards, which remain authoritative. It exists to
  turn a silent no-op into an explicit 400, not to be the safety mechanism of record.

### 5.3 Lock is an upsert that overwrites — a real hazard, not a no-op

`face_identity_face` is keyed by `assetFaceId` as its **PRIMARY KEY**
(`face-identity-face.table.ts:26-27`; migration `1778400000000:44`) — not "a plain unique index", and
the only other index is non-unique. The upsert is `ON CONFLICT … DO UPDATE` **with no `WHERE` on the
conflict action** (`face-identity.repository.ts:2393-2399`). Therefore re-locking a face that is
already linked **to a different identity silently re-points it**, overwrites `source`/`confidence`,
and churns `updatedAt`/`updateId` via the trigger.

Guided mode barely reaches this (its lock targets are snapshot faces already on the person). **Manual
mode makes it reachable**, since an admin can lock any face on the person. The eligibility check in
§5.2 constrains the face to this person, which is the meaningful mitigation; the identity-steal case
must still be covered by an explicit test (§8).

Also note `replaceFaceIdentities` (plural) omits the `preserveManualSource` guard its singular
sibling `replaceFaceIdentity` applies (`:2361` vs `:2396`). Both current callers pass `'manual'`, so
it is latent — but do not add a non-manual caller without revisiting it.

### 5.4 Relaxing `unknown` changes one existing behaviour

Medium test `face-repair.resolve.spec.ts:2003` covers a face that was **moved off the person since
the scan**, not a rest-of-cluster face. Today E15 rejects it with a 400. After relaxation the guard
no longer fires, `executeRepair`'s still-on-source check skips it, and the fresh cluster is deleted
because nothing moved (`face-repair.service.ts:1049-1054`) — so the admin gets a **success with
`unknown: 0`** instead of an error. That is acceptable (the response count truthfully reports zero
parks) but it is a deliberate behaviour change and gets its own test.

### 5.5 New endpoint — admin person metadata

The review page derives `personName` and `ownerId` from the scan (`[personId]/+page.svelte:105,222`),
and `ownerId` scopes the move-picker. With no scan both are unavailable, and user-scoped
`GET /people/:id` does not admin-bypass for non-owned people.

**Add** `GET admin/face-repair/person/:personId` → `{ id, name, ownerId, faceCount, thumbnailFaceId }`,
`@Authenticated({ admin: true })`, 404 on unknown person. Requires OpenAPI regen (`mise open-api`).

## 6. Web changes

### 6.1 Routes

| Route                                   | Change                                                       |
| --------------------------------------- | ------------------------------------------------------------ |
| `/admin/face-cleanup`                   | **new** — two-card mode chooser                              |
| `/admin/face-cleanup/scan`              | existing guided dashboard, **moved verbatim** (10 files)     |
| `/admin/face-cleanup/people`            | **new** — manual people browser                              |
| `/admin/face-cleanup/people/[personId]` | **new** — manual review page (own view-model)                |
| `/admin/face-cleanup/[personId]`        | guided review page — **untouched** except navigation targets |

Nesting manual review under `/people/` keeps it entirely clear of the guided `[personId]` route.
SvelteKit resolves static segments before dynamic ones, and person ids are UUIDs, so `scan`/`people`
cannot collide.

### 6.2 The chooser

Two **equal-weight** cards in a `lg:grid-cols-2` grid — identical footprint, and **neither is marked
recommended**. We do not know which mode a given admin lives in: some will triage scans, others will
spend all their time in manual review. The chooser must not pick a winner.

The page is a **status board that happens to be a fork**: a chooser that is only two links taxes the
flow you use most, so the guided card carries the scan's live state, letting an admin see whether
guided work is even waiting without clicking in.

It has two distinct presentations:

**First visit (no scan has ever run).** The honest difference here is not visual weight but
_readiness_: guided needs setup, manual does not. An explanatory header introduces both modes, the
guided card reads "Needs a scan first — runs in the background" with a **Run first scan** action, and
the manual card reads "No scan needed — start right away" with **Browse people**. This matters because
manual review is fully usable on a brand-new instance, and a first-time admin should not conclude the
feature is unavailable until a scan finishes.

**Returning (a scan exists).** The same grid compacts into a status board: scan age and a re-scan
action in the header, live counts on the guided card, user count on the manual card.

Card states:

| Scan state             | Guided card                               | Manual card                                   |
| ---------------------- | ----------------------------------------- | --------------------------------------------- |
| Never scanned          | "Needs a scan first" → **Run first scan** | "No scan needed" → **Browse people**          |
| Running                | progress + heartbeat → **View progress**  | **disabled** — "available when scan finishes" |
| Completed, flagged > 0 | amber counts → **Continue**               | **Browse**                                    |
| Completed, 0 flagged   | green "Nothing flagged" → **Re-scan**     | **Browse**                                    |
| Failed                 | red error line → **View details**         | **Browse**                                    |

Two deliberate decisions:

- **The disabled manual card during a running scan is load-bearing, not decoration.** `resolveFaces`
  returns 409 while a scan runs (§7). Without this state an admin can enter manual review, stage
  dozens of decisions across a server-paged cluster, hit Apply, and lose all of it to a conflict.
  Surfacing the constraint at the fork turns a data-loss trap into a sentence.
- **"Run first scan" navigates to `/scan`; it does not trigger inline.** The dashboard already owns
  the trigger, the Advanced modal, and the concurrency rules, and its no-scan empty state is already
  tested (`face-cleanup/page.spec.ts:176`). Duplicating a trigger on the chooser would fork that
  logic.

Counts come from calls that already exist: `getLatestScan()` for the guided card, `searchUsersAdmin`
for the user count. **No global people total is shown** — no endpoint produces one (people are only
counted per owner), and an aggregate endpoint purely to decorate a card is not worth it.

Visually the page reuses the dashboard's established vocabulary rather than inventing one: the card
shell (`rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800`), the
dot + label + `text-2xl font-semibold tabular-nums` value + `text-xs text-gray-400` sub rhythm, the
dashed empty-state treatment, and the existing semantic colours (amber = flagged, green = done,
red = failure). Only `Button` and `Icon` come from `@immich/ui`; cards are hand-rolled Tailwind, as
they already are on the dashboard.

Both destinations are directly linkable. **The admin navbar needs no change** — it already points at
`/admin/face-cleanup` and `NavbarItem` highlights by `pathname.startsWith(href)`, so it stays active
across `/scan` and `/people`. (The first draft listed repointing the navbar as work; it is a no-op.)

### 6.3 Manual people browser

Owner selector (`searchUsersAdmin`) → paginated people grid via `getFaceRepairOwnerPeople(ownerId,
{query, page})`, rendering `name`, `faceCount`, and a crop from `thumbnailFaceId` via the admin
face-thumbnail route. Search drives the endpoint's optional `query`. Single-user instances
auto-select the owner. Clicking a person → `/admin/face-cleanup/people/{id}`.

The browser shows whatever `searchOwnerPeople` returns; its treatment of hidden and non-`person`-type
rows is pinned by test rather than changed (§8).

### 6.4 Manual review page

A **new page with its own view-model**, reusing the guided page's tile presentation, `PersonPicker`,
and the `resolveFaces` SDK call. Interaction is identical to guided: tile grid → bulk select → Apply.

Person name and `ownerId` come from the §5.5 endpoint, fetched from the URL so refresh and deep-links
work. Faces come from `getFaceRepairClusterFaces(personId, {excludeFaceIds: [], page, size})`.

#### The visual inversion

In guided, **every tile always carries a badge and a ribbon**, because every face always holds one of
six terminal states — the grid is a wall of colour the admin audits. Manual inverts this: the default
is `keep`, which writes nothing (§3.1), so **tiles start clean and colour appears only where the admin
has acted**. The page reads calm, and the admin's work is legible as the exceptions.

This is not styling preference; it falls directly out of the data model. It is also why `keep` needs
no colour token: it is signalled by **absence**, which satisfies the guided page's existing rule that
_state is never encoded in colour alone_ without inventing a seventh swatch.

#### Tile states — reusing guided's exact tokens

| State                     | Colour           | Icon                   | Tile treatment                                            |
| ------------------------- | ---------------- | ---------------------- | --------------------------------------------------------- |
| **`keep`** (default)      | —                | —                      | **clean crop — no badge, no ribbon**                      |
| `move` (to picked person) | `#d97706` amber  | `mdiAccountArrowRight` | badge + ribbon showing the destination name               |
| `lock`                    | `#7c3aed` violet | `mdiLock`              | badge + ribbon                                            |
| `unknown`                 | `#0d9488` teal   | `mdiAccountQuestion`   | badge + ribbon                                            |
| `detach`                  | `#475569` slate  | `mdiImageOff`          | badge + ribbon + `grayscale(1) opacity(0.55)` on the crop |
| ~~`owner`~~ / ~~`stay`~~  | —                | —                      | **absent** — both require a suspected owner               |

Badge, ribbon, and selection markup are identical to the guided tile (`[personId]/+page.svelte:491-531`),
reusing `STATE_COLOR` / `STATE_ICON` so one glyph means one thing across both pages.

#### `manual-review.svelte.ts`

- `ManualFace = { assetFaceId: string }` — **no `suspectedOwnerId`**.
- `ManualFaceState = 'keep' | 'move' | 'lock' | 'unknown' | 'detach'`, **default `'keep'`**.
- **Stable across pagination.** The model owns its face list and exposes `appendFaces(...)`; it is
  **not** `$derived` over the array. This is the direct fix for the guided page's latent state-loss
  bug (§6.5), and is why manual paging is safe where reusing the guided model would not be.
- `buildResolveRequest`: `keep` faces are **omitted entirely**; `move` groups by destination (+lock
  flag); `lock`/`unknown`/`detach` become id lists. **`stay` is never emitted.**
- Apply is **disabled when every face is `keep`** — an all-keep request would be an empty resolve,
  which the server 400s. Hint: "mark at least one face".

#### Two interaction problems specific to this page

**Selection cannot claim the whole cluster.** Guided holds its entire flagged set in memory, so
"select all 47" is truthful. Manual server-pages a cluster that may hold thousands, so an unqualified
"select all" would either lie or force loading everything. **Selection therefore always means _loaded_
faces** — labelled `Select all loaded (120)`, with `showing 120 of 1,204` in the header. Whole-cluster
work goes through the separate **Move entire cluster…** action, which uses the server's `entireCluster`
(enumerated server-side, no client paging) and — unlike guided, where it rides the scan's suspected
owner — requires picking a destination through `PersonPicker`.

**A `keep` default needs an undo.** Guided never needs one: every face is already stamped, so the
admin only ever swaps one stamp for another. In manual, marking is a deliberate act, so mis-marking
needs reversing — hence an **Unmark** bulk action returning a selection to `keep`. Without it the only
recovery is Reset, which discards every staged decision on the page.

#### Remaining behaviour

- **Load more appends without disturbing staged marks or selection** — the whole reason the model owns
  its list.
- **Not-a-face keeps guided's destructive confirm.** It is the one irreversible action and it sits
  beside Unknown, which means the opposite (_bin this crop_ vs _this is a real person I cannot name_).
- **Empty vs error are distinct states**: a zero-face person gets the dashed empty treatment; a failed
  load gets an error + Retry. Conflating them was defect D17 on the guided page — do not repeat it.
- The dock summarises staged work (`3 move · 2 lock · 7 not a face`) so the admin can see the shape of
  a submission before applying it.

**Reused:** tile markup, `STATE_COLOR`/`STATE_ICON`, `PersonPicker`, the destructive-confirm modal, the
footer-dock shell, `AdminPageLayout` + breadcrumbs, the admin face-thumbnail route.
**New:** the view-model, loaded-vs-total selection semantics, Unmark, and a manual-mode help modal
(guided's `ActionsHelpModal` is left alone — its "names all six actions" test is load-bearing).

### 6.5 Why a separate page (the finding that changed this design)

The guided view-model cannot serve manual mode without being rewritten:

- `FlaggedFace.suspectedOwnerId` is **required** (`review.svelte.ts:42-47`); the cluster endpoint
  returns only `{ assetFaceId }`, so `createReviewModel(restFaces)` does not typecheck.
- Every face initialises to `'owner'` (`review.svelte.ts:100`) and `buildResolveRequest` dereferences
  `face.suspectedOwnerId` for that state (`:229-235`). With no scan, an **untouched** manual review
  would POST `moveToPerson: [{ destinationPersonId: undefined, faceIds: [all] }]` — silent mass
  mis-assignment.
- There is **no neutral state**: six terminal states (`:13`) with a tested invariant that the tally
  always sums to total (`review.spec.ts:172`). §3.1 requires one.
- `vm = $derived(createReviewModel(flaggedFaces))` (`+page.svelte:102`) — feeding a growing paginated
  list rebuilds the model and **wipes staged decisions**.
- `scanPerson` gates the move-picker (`+page.svelte:217-225`) and `flaggedFaces.length` gates the page
  body, the dock, and `loadRestPage` (`:402,:655,:162`).
- "Move entire cluster" is hard-bound to `ownerPersonId` client-side (`:262-274`, `:571`, `:580`),
  which is always null without a scan.

Generalising would also require rewriting five **load-bearing characterization tests** that encode the
guided defaults (`[personId]/page.spec.ts:186,:316`; `review.spec.ts:36,:172`;
`ActionsHelpModal.spec.ts:38`). Forking leaves all nine guided web specs untouched.

The two modes genuinely differ in default semantics — guided: _every face is a pending decision_;
manual: _every face is fine until I say otherwise_ — and one model cannot hold both defaults.

### 6.6 Navigation targets to repoint (guided page, unavoidable)

The route move requires updating, in `web/src/lib/route.ts` (add `faceCleanupScan()`; `faceCleanup()`
becomes the chooser) and its call sites:

- `[personId]/+page.svelte:278` (Cancel `goto`), `:305` (post-Apply `goto`), `:347` (breadcrumb),
  `:351` (back link)
- `resolutions/+page.svelte:97` (breadcrumb), `:145` (back button)

Ten dashboard files move to `scan/` (`+page.svelte`, `+page.ts`, `page.spec.ts`, `FaceCleanupTable`,
`face-cleanup.svelte.ts`, `face-cleanup.spec.ts`, `ScanChecklist` + spec, `AdvancedScanModal` + spec);
they are a self-contained cluster with no cross-imports from `[personId]/` or `resolutions/`.
`declined/+page.ts` redirects to `resolutions`, not the dashboard, and is unaffected.

## 7. Invariants and edge cases

**Cross-engine invariant (the point of the feature).** A manual decision must be honoured by a later
scan exactly as a guided one: a locked face is never re-flagged, a detached face is gone, a moved face
is not re-proposed. Free _if_ manual writes the same rows (§3), and worth an explicit e2e test rather
than trusting the argument.

**Preserved guards (must not regress).** Empty resolve → 400. Face in two buckets → 400.
`entireCluster` + per-face buckets → 400. Cross-owner destination → 400. Facial recognition active → 409. Scan running → 409 — note this now also blocks manual review mid-scan, which is intended.

**Manual mode ignores scan state entirely.** Opening the manual page for a person the scan _did_ flag
shows all faces with no flagged badging. Manual is a separate lens, not an overlay; mixing them would
reintroduce the suspected-owner coupling this design removes.

**Concurrency.** Two admins resolving the same person simultaneously is not locked out. The write-time
guards (`reattributeFaces` still-on-source, `detachFaces` person scope) make the outcome converge —
the second resolve's already-moved faces are skipped and truthfully reported as not moved.

**Edge cases to cover.**

_E15 relaxation:_ lock a non-flagged on-person face succeeds; lock a face on a **different** person is
rejected 400; lock a nonexistent id → 400; lock a soft-deleted face → 400; **re-locking a face already
linked to a different identity** (§5.3 hazard); detach a non-flagged face succeeds and does not touch
other clusters; unknown on non-flagged faces creates the parked person; unknown on a **moved-since-scan**
face returns success with `unknown: 0` (§5.4); unknown on every face empties the source person, whose
cleanup is gated on `countAllFaces` (not `countEligibleFaces`) plus unnamed; `stay` on a non-flagged
face still 400s; `stay` with no scan still 400s; mixed request (move + lock + detach) applies every
bucket; guided resolution unchanged.

_Metadata endpoint:_ existing person returns the row; 404 unknown; succeeds for another user's person;
unnamed person returns a null/empty name; zero-face person returns `faceCount: 0` + null
`thumbnailFaceId`; non-admin → 403.

_Manual view-model (pure):_ default state is `keep` for every face; an all-keep request builds to
empty and Apply is disabled; `keep` faces never appear in any bucket; `stay` is never emitted;
`appendFaces` preserves existing states **and** selection; move groups by destination and threads the
lock flag; a face cannot occupy two buckets.

_Manual page:_ loads all cluster faces with no scan; pages a large cluster without losing staged
decisions or selection; move-picker receives `ownerId` from the metadata endpoint; hard refresh
resolves name/owner; unnamed person renders the fallback heading; detach requires the destructive
confirm; entire-cluster move requires a picked destination; a person the scan flagged shows no flagged
badging.

_Chooser:_ first visit (no scan ever) renders the explanatory header, the guided card's "needs a scan
first" form, and the manual card's "no scan needed" affordance — manual must be **reachable** on a
brand-new instance; returning renders live counts; **during a running scan the manual card is
disabled** and the guided card shows progress; zero-flagged renders the green state; a failed scan
renders the error state; neither card is marked recommended.

_Browser:_ owner selector auto-selects on single-user; search filters; pagination loads further pages;
hidden / non-`person`-type rows behave as `searchOwnerPeople` already returns (pinned, not changed).

## 8. Test plan

**Where tests live** — corrected from the first draft: **there are no unit specs for `resolveFaces`.**
All of its coverage is medium (`server/test/medium/specs/services/face-repair.resolve.spec.ts`, 2,363
lines) plus a controller spec that mocks the service. Server behaviour work therefore lands in
**medium**, not unit.

- **Server medium** — real DB; assert the actual rows (`source='manual'`, `deletedAt`, verdict drains,
  person emptying). Run from `server/` as
  `pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-repair.resolve.spec.ts`.
  The path must be **relative to `serverRoot`**. `pnpm test:medium -- --run <path>` silently drops the
  filter and runs everything — and so does the bare-substring form `pnpm test:medium -- <name>`.
- **Server controller** (`face-repair-admin.controller.spec.ts`) — DTO validation + admin-gating for
  the new metadata endpoint.
- **Web unit** (vitest + testing-library) — the manual view-model is a pure module and should carry the
  bulk of the logic coverage, as `review.spec.ts` does for guided. Avoid asserting on an
  `onMount`-awaits-rejected-promise path: untestable under vitest 4 + happy-dom, already a known
  time-sink on this feature.
- **e2e** — one spec file exists (`e2e/src/specs/web/face-cleanup.e2e-spec.ts`, `describe.serial`).
  Seed with the existing `seedFlaggedScan` helper; note `utils.createFace` links faces
  `source='manual'` (`utils.ts:529-530`), which the verdict layer excludes from flagging, so seeds are
  downgraded to `'ml'` — there is a `preserveSource` escape hatch for durability tests.
  `waitForQueueFinish` needs the **admin** token (the queue endpoint is admin-only) and can return
  "done" before a job is enqueued, so poll the post-condition. A failure in a `.serial` file skips
  everything after it.

**TDD.** Every slice except 12 is **red-first**: write the failing test, confirm it fails for the right
reason, then implement. Slice 12 is a verification sweep and carries no new red test. Within slice 1,
the `stay` regression guard is written **first and must be green on arrival** — it pins the invariant
before the same slice relaxes the guard around it.

## 9. Slices

Sliced on one test: **can it ship on its own without leaving the tree broken or dead?** Work that
fails that test is merged — a route move without its e2e repair leaves CI red, an endpoint without its
SDK regen has no caller, a page shell without its grid renders nothing. Conversely the pure
view-model stays separate despite being small, because it carries the most logic risk on the branch
and deserves its own red-first cycle.

Each web slice adds the i18n keys it needs; there is no separate i18n slice (nothing renders without
them).

**Server**

1. **Relax E15 for `lock`, with the eligibility read.** Add
   `getEligibleFaceIdsForPerson` (mirroring `getClusterFacePage`'s predicate; **no `@GenerateSql`**),
   relax the guard for `lock`, and reject non-eligible ids. Write the `stay` regression guard **first**
   (`stay`-on-non-flagged → 400, `stay` with no scan → 400; green on arrival) so the invariant is
   pinned before the guard around it moves. Rewrite medium `:1372` from rejection to success and invert
   its side-effect assertions. Covers the §5.3 identity-steal hazard and the
   foreign/deleted/nonexistent rejections.
2. **Relax E15 for `detach` and `unknown`.** One guard change, two buckets. Rewrite medium `:1467`
   (prove person-scoping leaves other clusters untouched) and `:2003` to the §5.4 semantics (success
   with `unknown: 0`, no orphan cluster). Cover park-everything and the `countAllFaces`-gated source
   cleanup.
3. **Person metadata endpoint + SDK regen.** Repo + service + DTO + route with the §7 edge cases and
   the controller admin gate, then `mise open-api` (TS SDK + Dart) in the same slice — the endpoint has
   no caller until the client is regenerated.

**Web — route move (must precede the new surfaces)**

4. **Move the dashboard to `/admin/face-cleanup/scan`, and repair the e2e it breaks.** `git mv` the
   10-file cluster, add `Route.faceCleanupScan()`, repoint the six §6.6 call sites, and leave
   `/admin/face-cleanup` as a temporary 307 redirect. **The four e2e fixes ship in this slice** —
   `:151`/`:295` (`goto`) and `:361`/`:541` (`waitForURL('**/admin/face-cleanup')`, which will not
   match `/scan`) — because the move alone leaves CI red. **`:363-365` must be fixed, not repointed**:
   aimed at a chooser it would pass vacuously, silently gutting the drain check. Navbar unchanged.

**Web — new surfaces**

5. **Chooser landing, all states.** Replace slice 4's redirect with the two equal-weight cards and the
   full §6.2 state matrix: first-visit (explanatory header, "needs a scan first" vs "no scan needed"),
   returning with live counts, running (**manual card disabled** — the UI half of the 409 guard),
   zero-flagged, and failed. One component, one state machine, one slice. Novel UI in admin; only the
   307-redirect pattern is precedent.
6. **People browser.** Route, owner selector (`searchUsersAdmin`, single-user auto-select), paginated
   grid with thumbnails and face counts, and search via the optional `query`. Pin hidden /
   non-`person`-type behaviour. No-results and load-error states.
7. **Manual view-model (pure).** `manual-review.svelte.ts` per §6.4 — `keep` default, `appendFaces`
   preserving state **and** selection, `buildResolveRequest` omitting `keep` and never emitting
   `stay`, all-keep building to empty. Kept separate deliberately: highest logic risk on the branch,
   and it is a pure module, so it carries the bulk of the coverage cheaply.
8. **Manual page + grid + paging.** Route, person metadata from slice 3, navigation in from the
   browser, refresh/deep-link, unnamed fallback, the tile grid with §6.4's clean-`keep` treatment,
   selection (click / shift-range), server paging that **preserves staged marks**, and the honest
   `Select all loaded (N)` / `showing N of M` semantics. Empty vs error distinguished (D17).
9. **Manual bulk actions + Apply.** Move via `PersonPicker`, lock, unknown, not-a-face with its
   destructive confirm, **Unmark**, the staged-work tally, submit, result reporting, 409 surfacing,
   and Apply disabled while everything is `keep`.
10. **Manual entire-cluster move + help modal.** `entireCluster` with its own destination picker (no
    suspected owner to ride), plus a manual-mode actions help modal. Guided's `ActionsHelpModal` and
    its "names all six actions" test are left alone.

**Integration**

11. **e2e: manual flow + cross-engine invariant.** Browse → pick a person with no scan → move, lock,
    not-a-face → assert the rows; then prove a manual decision survives a later scan (locked faces are
    not re-flagged, detached faces stay gone). Both live in the same `.serial` spec file, so they land
    together.
12. **Final gate + docs.** `pnpm lint` (server is `--max-warnings 0`), `prettier --check .` across the
    server package **and** `cd docs && pnpm format` — prettier is a CI gate separate from eslint and
    docs prettier reaches this file — type checks, web checks, the full server/web/e2e suites, and a
    docs note on the two modes.

## 10. Accepted tradeoffs

1. **"Keep" is not recorded** (§3.1) — re-audits start fresh; Lock is the opt-in.
2. **Manual review is blocked while a scan runs** — inherited from `resolveFaces`'s concurrency guard;
   correct against conflicting writes.
3. **The chooser adds a click** in front of the dashboard, mitigated by `/scan` being directly
   linkable.
4. **Moving a face writes no negative verdict against the source** — unnecessary; the face ends up
   assigned and the suggestion engine only proposes unassigned faces.
5. **Some duplication between the guided and manual review UIs** — accepted deliberately in exchange
   for zero regression risk to the shipped guided flow (§6.5).

## 11. Corrections from the first draft

Recorded so reviewers can see what was verified rather than assumed:

| First-draft claim                                       | Reality                                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Manual mode reuses the guided page behind a mode flag   | **False** — model has a required `suspectedOwnerId`, no neutral state, and a `$derived` rebuild bug (§6.5) |
| Re-lock is an idempotent no-op via a plain unique index | **False** — PRIMARY KEY, and `DO UPDATE` that can steal a face from another identity (§5.3)                |
| Adding a repo method needs `mise sql` regeneration      | **False** — decorator is `@GenerateSql`; `FaceRepairRepository` has none                                   |
| The route move must repoint the navbar                  | **False** — `NavbarItem` matches by prefix; no-op                                                          |
| `resolveFaces` has server unit-test coverage            | **False** — medium only; unit specs cover other seams                                                      |
| "Move entire cluster remains available" in manual mode  | **False client-side** — bound to a null `ownerPersonId`; needs its own picker (§6.4)                       |
| Relaxing `unknown` is purely permissive                 | **Incomplete** — it converts one 400 into a success with `unknown: 0` (§5.4)                               |

The lock claim originated from a **stale code comment** (`face-repair.service.ts:949`) referencing
`insertLocks`, a function that no longer exists in `server/src`.
