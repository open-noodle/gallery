# Space editors may edit space members' assets (web)

- **Discussion:** [open-noodle/gallery#734](https://github.com/open-noodle/gallery/discussions/734)
  — "[Feature] Expose full asset action menu to users with editor permissions"
- **Date:** 2026-08-14
- **Scope:** server (`server/`) + web (`web/`). Mobile is a deliberate follow-up (see Non-goals).
- **Status:** design approved; awaiting spec review before implementation planning.
- **Predecessor:** [`2026-07-24-selection-toolbar-consistency-design.md`](./2026-07-24-selection-toolbar-consistency-design.md)
  parked this work under "Out of scope — exposing space-editor edits of non-owned direct space
  assets … revisiting this needs a per-asset origin signal — future work." This spec is that work.

---

## 1. Problem

### 1.1 What the report says, and what it actually is

The discussion reports that "users with editor permissions" see 5 asset actions where "the admin"
sees 13, and lists the 8 missing ones: Rotate left, Rotate 180°, Add upload to stack, Archive, View
in timeline, Move to locked folder, Refresh faces, Refresh metadata.

**The framing is off in a way that changes the design.** Those 8 are precisely the `isOwner`-gated
items in `web/src/lib/components/asset-viewer/AssetViewerNavBar.svelte:140-210`. Instance-admin
status is not consulted anywhere in that file. The reporter's "admin" screenshot is simply **the
owner of that photo**; their "editor" screenshot is a Space editor looking at **someone else's**
photo.

So the real request is: **a Shared Space editor acting on another member's asset.** Every decision
below follows from that reading, not from the admin/user distinction.

### 1.2 The server is already more permissive than the client

`Permission.AssetUpdate` resolves to owner ∪ `checkSpaceEditAccess` (`server/src/utils/access.ts:155-159`).
The web never surfaced that. Current truth:

| Action                                            | Server: editor on a member's asset?                                                   | Web gate today                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| Description / date / location / rating            | **allowed** — `updateExif` under `AssetUpdate`                                        | `isOwner` (`DetailPanel.svelte:60`)        |
| Refresh faces / metadata / thumbnails / transcode | **allowed** — `asset.service.ts:769-770` gates `run()` on `AssetUpdate`               | `isOwner` (`AssetViewerNavBar.svelte:204`) |
| Tag with your own tag                             | **allowed** — `tag.service.ts:81-82` (`TagAsset` on tags ∧ `AssetUpdate` on assets)   | `isOwner`                                  |
| Add to stack                                      | **allowed** to create (`stack.service.ts:21`); `StackUpdate`/`StackDelete` owner-only | `isOwner`                                  |
| Rotate / crop / trim                              | denied — `AssetEditCreate` is `checkOwnerAccess` (`access.ts:169-179`)                | `isOwner`                                  |
| Archive / Hidden / Locked                         | denied — deliberate `rbac-3` guard (`asset.service.ts:214-224`, `:314-327`)           | `isOwner`                                  |
| Delete                                            | denied — `AssetDelete` is owner-only                                                  | `isOwner`                                  |

Roughly half the request is already legal server-side and merely unsurfaced. The other half needs a
rule change.

### 1.3 Why the client cannot simply be un-gated

A space surfaces assets by **three** paths — `spaceAssetPathBranches` (`shared-space-album-scope.ts:323-336`):
directly-added assets, linked libraries, and linked albums. `checkSpaceEditAccess`
(`access.repository.ts:491`) covers only the **first two**. An asset that reached the space through a
linked album is therefore not editor-writable, and nothing in the merged timeline tells the client
which path any given asset took. Un-gating the UI blindly produces buttons that 403 on an
unpredictable subset — the exact outcome the predecessor spec refused.

---

## 2. The authority rule

> **You may edit an asset if you own it, or if you are Owner/Editor of a space that shows it _and_
> its owner is a member of that space.**

One sentence, total over all three paths, no per-asset path analysis in the client.

### 2.1 Why owner-is-member, and not album role

The rejected alternative was "…or you are owner/editor of the linked album it arrived through."
Album editorship grants **no** asset-write rights anywhere in the product today — `AssetUpdate` is
owner ∪ space-edit, and album role appears in neither arm. That alternative is therefore not an
extension of the space model but a **separate feature** ("album editors may edit other members'
assets"), unrequested, and it would either leak into regular shared albums or create a new
spaces-only inconsistency.

Anchoring on the owner's membership instead means authority derives from **the owner having opted
into the space**, which is the same consent that already justifies arms 1 and 2. It also removes the
arbitrary-looking wart that dropping arm 3 bare would leave: Bob's photo behaves identically whether
it reached the space directly, via his library, or via his linked album.

### 2.2 Consequences

| Case                                                 | Today | Under this rule  |
| ---------------------------------------------------- | ----- | ---------------- |
| Bob's photo, added directly (`shared_space_asset`)   | ✅    | ✅               |
| Bob's photo, via Bob's linked library                | ✅    | ✅               |
| Bob's photo, via Bob's linked album                  | ❌    | ✅ **(new)**     |
| Carol's photo — album member, **not** a space member | ❌    | ❌               |
| Dave's photo — Bob's **partner**, not a space member | ✅    | ❌ **(removed)** |

### 2.3 The removal in row 5 is a security fix, and must be called out

Direct-add to a space requires `Permission.AssetShare` = owner ∪ **partner**
(`shared-space.service.ts:687`, the `rbac-2` comment). So today a member may add their _partner's_
asset to a space, after which every space Owner/Editor gains `AssetUpdate` over it — although the
partner never joined the space and partner-sharing conveys read access only.

Requiring owner-is-member closes that. Nothing legitimate is lost: the adder cannot edit their
partner's assets anywhere else in the product either (`AssetUpdate` has no partner arm). This is a
behaviour **removal** that no one requested, so it belongs in the PR description, not buried in a
diff.

### 2.4 What "member of that space" binds to

The membership check binds to **the same space** that grants the actor their Owner/Editor role — not
"any space". Each access branch already has that `spaceId` in scope, so the check is a correlated
`EXISTS` inside each branch, never a global lookup.

---

## 3. Scope

### 3.1 Granted to space Owner/Editor over a member's asset

Rotate ×3 · image editor · video trim · revert-to-original · refresh faces · refresh metadata ·
refresh thumbnails · transcode video · description · date · location · rating · tags.

Every one of these routes through `Permission.AssetUpdate` or `Permission.AssetEdit*`, which §4.1
and §4.2 widen together. **Nothing is granted here whose server path is not widened by this spec** —
see §3.2's face-tagging row for the capability that failed that test.

Measured against the reporter's list of 8 missing actions: **4 are granted** — rotate left, rotate
180°, refresh faces, refresh metadata — and **4 are withheld** — add upload to stack, archive, move
to locked folder, view in timeline — for the reasons in §3.2. The grant also reaches well beyond
their list, which covered only the kebab menu: the entire detail panel (description, date, location,
rating, tags, people), the full image editor, video trim, thumbnail regeneration and transcode.

### 3.2 Withheld, and why

| Action                    | Reason                                                                                                                                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delete / trash            | Excluded by decision — destruction stays with the owner. This is the one boundary the feature was scoped around from the outset.                                                                                                                                             |
| Archive / Hidden / Locked | `rbac-3`'s own reasoning: visibility strips the asset from the owner's albums (`removeAssetsFromAll`) and #757-tombstones it off every one of their devices. Fleet-wide and invisible to whoever triggered it.                                                               |
| Stack / unstack           | Personal filing under the chosen rule; and the owner cannot manage a stack another user created (`StackUpdate`/`StackDelete` are stack-owner-only). See §4.5.                                                                                                                |
| Favorite                  | Not this feature's problem. PR #819 (per-user favorites, `asset_favorite` overlay, drops `asset.isFavorite`) is open against `main` and dissolves the question — everyone favorites into their own list. Designing a rule for a column that is being deleted would be waste. |
| View in timeline          | Navigates to _your_ timeline, where another user's asset does not appear. The reporter lists it as missing; it is correctly absent.                                                                                                                                          |
| Set as profile picture    | Already ungated (`asset.service.ts:323-328`) and unrelated to space role — your own profile.                                                                                                                                                                                 |
| People / face tagging     | **Has no server path, and adding one is a different feature.** See below.                                                                                                                                                                                                    |

**Why face tagging is out of the web UI**, in detail: `TagPeople` (`AssetViewerNavBar.svelte:307-313`)
and `DetailPanelPeople` stay gated on the real `isOwner`, never `canEdit`, and that decision is
unchanged and correct. Naming people inside a space is already solved by a **separate layer** — the
`shared_space_person` model, with its own editor gate at `checkSharedSpaceEditAccess`
(`access.repository.ts:832`) and its own update path. `CLAUDE.md` states the rule directly: _"Never
send a space-person edit to the owner-only person endpoint."_ Routing space editors into the
owner-only person endpoints would be that exact mistake. If space editors should be able to tag
faces on members' assets through that layer, that belongs in the space-person layer as its own spec.

**An earlier draft of this spec claimed person and face writes do not go through `AssetUpdate` at
all, and widening `checkSpaceEditAccess` does not reach them. That is false, and worth correcting
precisely.** `PersonService.createFace` (`server/src/services/person.service.ts:1503-1507`) gates
`POST /faces` on `Permission.AssetUpdate` for `dto.assetId` and `Permission.PersonRead` for
`dto.personId` — no `checkFaceOwnerAccess` is involved in creation at all. So a space editor **can**
create a face box on a member's asset via the API today, whether or not the web offers a control for
it. This is not new behaviour introduced by this branch: it was already true for direct- and
library-path assets, because `AssetUpdate` already carried a space-edit arm before this spec; §4.1
only extends the set of assets that arm reaches to the album path, exactly as it extends every other
`AssetUpdate` consumer. See §4.7 for this consumer recorded alongside the others.

There is a real asymmetry worth recording as accepted-and-known rather than silently living with:
`DELETE /faces/:id` gates on `Permission.FaceDelete` → `access.person.checkFaceOwnerAccess`
(`server/src/repositories/access.repository.ts:928-941`), which resolves to the **asset owner**, not
the id of whoever created the face. So an editor who creates a face box on a member's asset cannot
remove it — the same create-without-manage shape §4.5 closes for stacks, left open here because
nothing in the reported request touches face tagging. It deserves a follow-up, best scoped together
with the space-person layer work above rather than as a narrow guard bolted onto `createFace`.

### 3.3 Non-goals (YAGNI)

- **Mobile.** Separate codebase, separate spec. Cheap to add later _because_ the capability is
  computed server-side rather than inferred client-side. `mobile/lib/utils/action_button.utils.dart`
  already funnels all 13 gates through a single `ActionButtonContext.isOwner`, so the follow-up is
  one struct field plus gate swaps.
- **Album editors editing other members' assets.** See §2.1.
- **Changing the regular-album or personal-timeline surfaces.** They are the reference model and stay
  untouched, per the predecessor spec's rebase-safety reasoning.
- **A `capabilities` object on the asset DTO.** Under this rule, metadata-edit and content-edit are
  granted together, and everything still owner-only is derivable client-side from `ownerId`. One
  boolean suffices; a struct would be speculative generality.
- **Per-asset origin exposure.** The client never learns _which_ of the three paths carried an asset.
  It learns only the answer.

---

## 4. Architecture — server

### 4.1 `checkSpaceEditAccess` (`server/src/repositories/access.repository.ts:489-545`)

Two changes: **add the linked-album arm**, and **add the owner-is-member condition to all three arms.**

**Do not swap the method wholesale onto `spaceAssetPathBranches`.** That helper family carries
neither `spaceVisibilityGate` nor `asset.deletedAt`/`asset.isOffline` filtering — its callers apply
those on the outer query, and it is documented for "the 'clean' asset-outer sites … with no per-arm
`isOffline` quirk; other sites route just the album arm through `spaceAlbumAssetExists` and keep
their bespoke direct/library arms inline" (`shared-space-album-scope.ts:318-321`).

`checkSpaceEditAccess` **is** such a site: it is an inner `UNION` of per-arm subqueries, and its
library arm carries `asset.isOffline = false` while its direct arm does not. A wholesale swap would
silently drop:

- `spaceVisibilityGate` → a space editor could edit another member's **Hidden or Locked** asset
- `asset.deletedAt IS NULL` → editing **trashed** assets
- `asset.isOffline = false` on the library arm → editing assets whose files are gone

None of those three would fail to compile, and none would fail an existing unit test. This is the
"dropped gate hidden behind a helper's defaults" failure mode; the medium tests in §7.1 exist
specifically to catch it.

Therefore:

- Keep the existing direct and library arms **verbatim**, including each arm's own
  `spaceVisibilityGate`, `deletedAt`, and (library only) `isOffline` predicates.
- Add a **third `UNION` arm** for the linked-album path, routed through
  `spaceAlbumAssetExists(eb, { correlateAssetId: 'asset.id', scope: { memberUserId: userId, memberRole: [SharedSpaceRole.Owner, SharedSpaceRole.Editor] } })`,
  joined to `asset` with the same `deletedAt` + `spaceVisibilityGate` predicates the sibling arms use.
  **No `requireShowInTimeline`** — editability must not evaporate because the album owner unticked
  "show in timeline" on an album they still share with the space.
- Add to **each** arm a correlated `EXISTS` on `shared_space_member` requiring
  `shared_space_member.userId = asset.ownerId` **and** `shared_space_member.spaceId` equal to that
  arm's own space id (§2.4).

Preserved as-is: the `livePhotoVideoId` fan-out in the result reducer (the motion half of a live
photo stays reachable), `@GenerateSql`, and `@ChunkedSet({ paramIndex: 1 })`.

The scope shape `{ memberUserId, memberRole }` is already established in this file —
`checkSharedSpaceEditAccess` at `:832` uses exactly it for persons.

### 4.2 Widen the three asset-edit permissions (`server/src/utils/access.ts:169-179`)

`AssetEditGet`, `AssetEditCreate`, and `AssetEditDelete` each change from bare `checkOwnerAccess` to
the same owner ∪ `checkSpaceEditAccess` union `AssetUpdate` already uses at `:155-159`.

**`AssetEditGet` is included for consistency, not because a call site needs it today — Task 2
disproved the original "load-bearing" reasoning below.** The original justification claimed
`handleQuickRotate` reads the edit list through `AssetEditGet` before writing, so omitting it would
fail editor rotate on the read. That is not what happens: `AssetService.getAssetEdits`
(`server/src/services/asset.service.ts:945-946`) gates per-asset on `Permission.AssetRead`, which
already admits space members via `checkSpaceAccess` — not on `AssetEditGet` at all. `AssetEditGet`
currently reaches only the controller's route-scope decorator, never `checkAccess`, so no call site
is actually gated by it yet.

The widening is kept anyway, and the real reason is the one now recorded directly in the code
comment at `server/src/utils/access.ts:169-179`: leaving `AssetEditGet` owner-only would make it
**narrower** than the read path it names, so a future call site routed through it would silently
disagree with `AssetEditCreate` and `AssetEditDelete`. Widening it now is a consistency guarantee for
that future call site, not a fix for a load-bearing read today.

Including `AssetEditDelete` is deliberate: revert-to-original is the undo for an edit editors may now
make, and it is non-destructive by construction (`asset_edit` rows; the original file is never
mutated). Asymmetry would strand an editor's own mistake.

The `mergeRotation` composition also means an editor's rotate **does not clobber** an owner's
existing crop — the two compose. The one path that removes edits wholesale is
`removeAssetEdits`, reached only when the merged edit list is empty.

### 4.3 `canEdit` on `AssetResponseDto`

Add **optional** `canEdit?: boolean` to `AssetResponseSchema`, beside the fork's existing
`resolvedSpaceId` (`server/src/dtos/asset-response.dto.ts:116`).

**Optional, not required, and this matters.** `mapAsset` (`:194`) has no `AuthDto` and is called from
many list paths (albums, search, …); computing real editability there would be an N+1 access check
per asset. A required field would force those paths to emit a _wrong_ `false` for owners.

So: `mapAsset` never sets it. It is populated **only** in `getAssetInfo`
(`server/src/services/asset.service.ts:100-148`), where the space context is already resolved and one
more access call is proportionate. Absent means _"not resolved"_, and the client falls back (§5.3) —
the same contract `resolvedSpaceId` already uses.

The `stripMetadata` shared-link branch (`:197-211`) constructs its own object and so never carries
the field; a shared-link viewer therefore falls back to ownership, which is `false`. Pin that
explicitly (§6, scenario S-14) rather than relying on it.

### 4.4 `POST /assets/editable`

New fork-only route on `server/src/controllers/asset.controller.ts`:

```
POST /assets/editable
body     { assetIds: string[] }
returns  { editableAssetIds: string[] }
```

**Shipped without `spaceId`.** An earlier draft of this section specified an optional `spaceId` on
the request body, justified for symmetry with `getAssetInfo` and for the activity attribution in
§4.6. It was dropped during implementation: the shipped `AssetEditableSchema`
(`server/src/dtos/asset.dto.ts:174-178`) takes `assetIds` only, and `AssetService.getEditable`
(`:164-168`) never reads a `spaceId` — the access check is space-agnostic by construction (the union
already spans every space the caller belongs to), so the field had no consumer. Do not re-add it
without a concrete use.

The handler body is a bare `this.checkAccess({ auth, permission: Permission.AssetUpdate, ids })` —
**deliberately not a second implementation of the rule**, but a direct call to the same access path
the write itself will take. It cannot drift from enforcement because it _is_ enforcement, minus the
write.

Batch size is bounded by `@ChunkedSet` inside the access repository, so a large selection chunks
rather than building one enormous `IN` list — in practice a request is already capped well below
that by Nest's default 10MB JSON body limit, which holds roughly 250,000 ids.

### 4.5 Harden `stack.service.ts:21`

Stack creation gates on `Permission.AssetUpdate`, which under §4.1 covers a member's assets. An
editor could therefore create a stack over Bob's photos that Bob cannot unstack, promote, or delete
(`StackUpdate`/`StackDelete` are stack-owner-only).

This hole is **live today** for direct-pool assets; §4.1 widens which assets it reaches. Since §3.2
places stacking on the owner-only side, add an explicit owned-ids guard to `StackService.create`
mirroring the `rbac-3` shape at `asset.service.ts:220-223`: resolve
`checkAccess({ permission: AssetDelete, ids })` (the pure owner arm) and reject the whole request if
any id is not owned.

### 4.6 Attribution — `SharedSpaceActivityType.AssetEdit`

The premise of this feature is that an editor may change **shared truth**. The corollary is that Bob
can find a different date on his photo with no way to learn who changed it, or that it changed.

The machinery exists: `shared_space_activity`, a user-visible feed
(`web/src/lib/components/spaces/space-activity-feed.svelte`), and that feed's `spaces_activity_default`
branch at `:93` ("{name} performed an action"), which degrades gracefully for types the web does not
yet render — so a server-side row is never orphaned even if the web slice lands separately.

Log **only cross-owner edits** — where `auth.user.id !== asset.ownerId` — into the space resolved for
that asset, via the existing
`sharedSpaceRepository.logActivity({ spaceId, userId, type, data })` (`shared-space.service.ts:694-699`).
Low-volume by construction: owners editing their own assets, which is nearly all editing, logs
nothing.

- Space resolution reuses `sharedSpaceRepository.findSpaceForAssetAndUser(assetId, auth.user.id)`
  (`asset.service.ts:131`) — the actor's id, so the row lands in a space the actor is actually in.
  No space resolved ⇒ no row, never a throw.
- Write paths that log: `update`, `updateAll`, `editAsset`, `removeAssetEdits` — all in
  `AssetService`, via the private `logCrossOwnerEdit` helper (`server/src/services/asset.service.ts:857-900`).
  **Job dispatch (`run`) does not log** — refresh-thumbnails is maintenance, not a change to shared
  truth, and an activity row reading "Anna edited 40 photos" after a thumbnail refresh is worse than
  no row.
- **Known gap: tag add/remove does not log.** An earlier draft of this section listed tag add/remove
  among the logging write paths. That attribution was dropped during implementation — `TagService`
  has no `logActivity`/`logCrossOwnerEdit` call anywhere, so an editor tagging Bob's asset produces no
  activity row today. This is an accepted omission, not a design decision: tagging is exactly the
  kind of "shared truth changed silently" case this section exists to cover, so it is a candidate for
  a follow-up rather than something to reintroduce quietly inside an unrelated change.
- `data` carries `{ count, assetIds: assetIds.slice(0, 4) }`, matching the existing `AssetAdd`
  convention at `:698`.
- **Coalesce per call _and per space_.** A bulk `updateAll` can span assets belonging to several
  different spaces, or to none. Group the cross-owner ids by resolved space and write **one row per
  space**, each with that space's own `count`. Assets that resolve to no space contribute no row.
  A single-space bulk edit therefore still writes exactly one row — the common case — without the
  multi-space case silently attributing 30 assets to whichever space happened to resolve first.
- **Logging must never fail the write.** Attribution is secondary; a failed activity insert is
  swallowed and logged, not propagated.

**No migration is required, and it is worth saying so explicitly.** `shared_space_activity.type` is
`character varying(30)`, not a Postgres enum
(`server/src/schema/tables/shared-space-activity.table.ts:26-27`), so a new `SharedSpaceActivityType`
member is a TypeScript-only change. A reader who assumes an enum would go looking for a
`migrations-gallery/` file that should not exist. The 30-character cap does bind the value:
`asset_edit` is 10.

### 4.7 Everything else §4.1 widens, deliberately

`checkSpaceEditAccess` sits behind `Permission.AssetUpdate`, so widening it widens **every**
`AssetUpdate` consumer at once — not only the ones this feature surfaces. The full set, and the
decision for each:

| Consumer                                                                              | Effect of §4.1                | Decision                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AssetService.update` / `updateAll` (`asset.service.ts:211`, `:298`)                  | reaches album-path assets     | intended — the feature                                                                                                                                                     |
| `AssetService.run` (jobs) (`:769`)                                                    | reaches album-path assets     | intended — the feature                                                                                                                                                     |
| `TagService.bulkTagAssets` (`tag.service.ts:82`)                                      | reaches album-path assets     | intended — the feature                                                                                                                                                     |
| `AssetService.upsertMetadata` / `deleteBulkMetadata` (`:719`, `:735`, `:760`, `:765`) | reaches album-path assets     | accepted — already editor-reachable for direct/library assets today; this is the same capability over one more path, and it is app-sync key/value data, not shared content |
| `StackService.create` (`stack.service.ts:21`)                                         | would reach album-path assets | **blocked** by the new guard, §4.5                                                                                                                                         |
| `PersonService.createFace` (`person.service.ts:1505`)                                 | reaches album-path assets     | accepted — pre-existing for the other two paths (direct/library) before this branch; the web UI never offers face tagging (§3.2)                                           |

The `rbac-3` visibility guards (`asset.service.ts:219-224`, `:322-327`) sit _inside_ `update` and
`updateAll`, downstream of the permission check, so they continue to reject regardless of how wide
`AssetUpdate` becomes. That is why §6.3 pins them as regressions rather than treating them as
untouched.

---

## 5. Architecture — web

### 5.1 Asset viewer and detail panel

`getAssetActions` already receives the full `AssetResponseDto`
(`AssetViewerNavBar.svelte:95` spreads the asset into it), so `asset.canEdit` is available with no
signature change and no prop drilling.

Introduce one shared helper so the fallback (§5.3) lives in exactly one place:

```ts
// web/src/lib/utils/asset-editability.ts  (new, pure)
export function canEditAsset(
  asset: { ownerId?: string; canEdit?: boolean },
  ctx: { userId?: string; space?: { canWrite: boolean; members: { userId: string }[] } | null },
): boolean;
```

Resolution order: `asset.canEdit` when present → else `ownerId === userId` → else the space
derivation → else `false`.

| Site                                                                                                                                                       | Today     | Becomes              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------- |
| `canEditImage` / `canEditVideo` (`asset.service.ts:284-305`)                                                                                               | `isOwner` | `canEdit`            |
| `RatingAction` (`AssetViewerNavBar.svelte:140`)                                                                                                            | `isOwner` | `canEdit`            |
| Job block (`AssetViewerNavBar.svelte:204-210`)                                                                                                             | `isOwner` | `canEdit`            |
| `DetailPanel.svelte:60` → 6 rows (`:236,:237,:238,:249,:400,:538`)                                                                                         | `isOwner` | `canEdit`            |
| `TagPeople` (`:307-313`)                                                                                                                                   | `isOwner` | **unchanged** (§3.2) |
| `DeleteAction` (`:147`), stack block (`:169-181`), `ArchiveAction` (`:192`), `SetVisibilityAction` (`:198`), `ViewInTimeline` (`asset.service.ts:330-335`) | `isOwner` | **unchanged**        |

`isOwner` stays defined and in use — this adds a second, wider gate rather than replacing the
existing one.

`getAssetActions` has two further call sites — `AssetViewer.svelte:471` and
`DetailPanelTags.svelte:45` — which pass **no** space context. Both pass a full `AssetResponseDto`,
so `asset.canEdit` is present there and nothing breaks; the helper's `ctx` argument is therefore
optional, and omitting it must degrade to the ownership check rather than throwing.

### 5.2 Bulk selection

`SelectionCommandContext` (`command-context-manager.svelte.ts:44-61`) gains:

```ts
editableSelectedAssetIds: string[] | undefined; // undefined ⇒ not yet resolved
```

Resolution on selection change:

- **all-owned selection** → resolve synchronously to all selected ids, **no request**
- **otherwise** → debounced `POST /assets/editable`, so the round-trip fires only for mixed or
  non-owned selections on a space surface

**`canEditMetadata` must split.** Today `caps.canEditMetadata` wraps a block in
`SelectionToolbar.svelte:209-215` that includes `ArchiveAction` **and** `SetVisibilityAction`.
Flipping that one flag to the editable subset would hand editors Archive, violating `rbac-3` and
producing guaranteed 403s. So `SelectionCapabilities` becomes:

| Capability                                | Wraps                                                 | Gate                                     |
| ----------------------------------------- | ----------------------------------------------------- | ---------------------------------------- |
| `canEditMetadata`                         | Rotate, ChangeDate, ChangeDescription, ChangeLocation | editable subset non-empty                |
| `canSetVisibility` _(new)_                | Archive, SetVisibility                                | `sel.isAllUserOwned` (unchanged)         |
| `canTag`                                  | TagAction                                             | editable subset non-empty ∧ tags enabled |
| `canDelete`, `canFavorite`, `canShare`, … | —                                                     | unchanged                                |

Subset semantics are not a new idea in this file: `canShare` already means "acts on the owned
subset" (`selection-capabilities.ts:94-96`).

**Partial application must be visible.** Selecting 10 with 7 editable and choosing Change date
applies to 7, and the success toast reports 3 skipped. Silently editing a subset is the worst
available outcome.

**Shipped behaviour differs from an earlier draft here.** That draft specified that while
`editableSelectedAssetIds` is `undefined`, the affected actions should render **disabled-pending**
rather than appearing late, on the reasoning that a moving menu is worse than a briefly inert one.
That was overridden during implementation: the shared, app-wide `MenuOption` component these actions
render through has no `disabled` prop, and extending it just to support this one pending state was
judged not worth it against a pop-in window of roughly 250ms — the debounce window itself. So the
shipped behaviour is that `canEditMetadata` (and `canTag`) gate the whole block, and the affected
actions are simply **hidden** until `editableSelectedAssetIds` resolves and the subset is non-empty
(`SelectionToolbar.svelte:263`), then they appear. No disabled state exists for them.

`getSelectionCapabilities` stays **pure** (its header contract: no `authManager` reads, no `$state`),
so the resolved id list is passed in through `ctx.selection`, never fetched inside it.

### 5.3 Fallback

`SpaceContext` already carries the full member list (`command-context-manager.svelte.ts:37`), whose
entries are `SharedSpaceMemberResponseDto` — the id field is **`userId`**, not `user.id`
(`server/src/dtos/shared-space.dto.ts:47-52`).

So the client can derive `space.canWrite && space.members.some((m) => m.userId === asset.ownerId)`.
On a space surface this is near-exact, since every visible asset reached it through one of that
space's three paths. Failing to it is safe because the server enforces regardless.

The endpoint is still required, because the derivation only works where a space context and member
list exist. **Search results, the People page, and memories** surface space assets with neither —
there the server answer is the only answer.

---

## 6. BDD scenarios

Cast, used throughout: **Anna** = space Editor · **Bob** = space Member (asset owner) · **Carol** =
member of an album linked into the space, **not** a space member · **Dave** = Bob's partner, not a
space member · **Vic** = space Viewer.

Scenario ids are **stable identifiers, not an ordering** — S-43…S-46 were added during spec review
and sit in the subsection they belong to rather than at the end. Cite them by id; never renumber, or
the §7 slice mapping silently rots.

### 6.1 The authority rule (server)

| #    | Given                                                                                                                                                      | When                                    | Then                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| S-1  | Bob's asset added **directly** to the space                                                                                                                | Anna requests `AssetUpdate`             | granted                                                                                |
| S-2  | Bob's asset via Bob's **linked library**                                                                                                                   | Anna requests `AssetUpdate`             | granted                                                                                |
| S-3  | Bob's asset via Bob's **linked album**                                                                                                                     | Anna requests `AssetUpdate`             | granted _(new)_                                                                        |
| S-4  | **Carol's** asset, via the linked album, Carol not a space member                                                                                          | Anna requests `AssetUpdate`             | denied                                                                                 |
| S-5  | **Dave's** asset, direct-added by Bob under `AssetShare`'s partner arm                                                                                     | Anna requests `AssetUpdate`             | denied _(tightened, §2.3)_                                                             |
| S-6  | Bob's asset in the space                                                                                                                                   | **Vic** (Viewer) requests `AssetUpdate` | denied                                                                                 |
| S-7  | Bob's asset, `visibility = Hidden`                                                                                                                         | Anna requests `AssetUpdate`             | denied — `spaceVisibilityGate`                                                         |
| S-8  | Bob's asset, `visibility = Locked`                                                                                                                         | Anna requests `AssetUpdate`             | denied — `spaceVisibilityGate`                                                         |
| S-9  | Bob's asset, **trashed** (`deletedAt` set)                                                                                                                 | Anna requests `AssetUpdate`             | denied — `deletedAt IS NULL`                                                           |
| S-10 | Bob's library asset, `isOffline = true`                                                                                                                    | Anna requests `AssetUpdate`             | denied — library arm's `isOffline = false`                                             |
| S-11 | Bob's asset via a linked album with `showInTimeline = false`                                                                                               | Anna requests `AssetUpdate`             | granted — no `requireShowInTimeline` (§4.1)                                            |
| S-12 | Bob's **live photo**; Anna passes the motion `livePhotoVideoId`                                                                                            | Anna requests `AssetUpdate`             | granted — reducer fan-out preserved                                                    |
| S-13 | Anna is Editor of space **A**. Bob's asset reaches A through an album Carol linked into A, to which Bob contributed. Bob is a member of space **B**, not A | Anna requests `AssetUpdate`             | denied — membership binds to the space granting Anna her role, not to any space (§2.4) |
| S-14 | A shared-link (unauthenticated) viewer                                                                                                                     | fetches asset info                      | `canEdit` absent ⇒ client resolves `false`                                             |
| S-43 | Bob's asset via Bob's linked album; the actor is a space **Owner**, not an Editor                                                                          | Owner requests `AssetUpdate`            | granted — `memberRole` includes both roles, and only Editor was otherwise exercised    |
| S-44 | Bob's asset via Bob's **linked album**                                                                                                                     | **Vic** (Viewer) requests `AssetUpdate` | denied — the new album arm is role-gated like its siblings (S-6 only covered direct)   |
| S-45 | Anna, Bob's album-path asset                                                                                                                               | `PUT /assets/:id/metadata`              | 200 — `upsertMetadata` widens with `AssetUpdate` (§4.7), accepted deliberately         |

### 6.2 Widened edit permissions (server)

| #    | Given                                             | When                              | Then                                                       |
| ---- | ------------------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| S-15 | Anna, Bob's space asset                           | `GET /assets/:id/edits`           | 200 — `AssetEditGet` widened (§4.2)                        |
| S-16 | Anna, Bob's space asset                           | `PUT /assets/:id/edits` rotate 90 | 200; `asset_edit` rows replaced; thumbnail job queued      |
| S-17 | Anna, Bob's space asset with an existing **crop** | quick-rotate 90                   | crop preserved — `mergeRotation` composes, no clobber      |
| S-18 | Anna, Bob's space asset                           | `DELETE /assets/:id/edits`        | 200 — revert-to-original allowed                           |
| S-19 | **Carol's** asset (S-4)                           | `PUT /assets/:id/edits`           | 403                                                        |
| S-20 | Anna, Bob's space **video**                       | trim                              | 200; existing trim validations unchanged                   |
| S-21 | Anna, Bob's space asset                           | `POST /assets/jobs` refresh-faces | 200 — already `AssetUpdate`, now reaches album-path assets |

### 6.3 Guards that must still hold (server)

| #    | Given                    | When                                      | Then                                                         |
| ---- | ------------------------ | ----------------------------------------- | ------------------------------------------------------------ |
| S-22 | Anna, Bob's space asset  | `PUT /assets/:id` with `visibility`       | 403 — `rbac-3` (`asset.service.ts:219-224`)                  |
| S-23 | Anna, Bob's space asset  | `PUT /assets` bulk with `visibility`      | 403, whole request rejected (`:322-327`)                     |
| S-24 | Anna, Bob's space asset  | `PUT /assets/:id` with `livePhotoVideoId` | 403 — `rbac-3`                                               |
| S-25 | Anna, Bob's space asset  | `DELETE /assets`                          | 403 — `AssetDelete` owner-only                               |
| S-26 | Anna, Bob's space asset  | `POST /stacks`                            | 403 — new guard (§4.5)                                       |
| S-27 | Anna, own + Bob's assets | `POST /stacks` mixed                      | 403, whole request rejected (all-or-nothing, `rbac-3` shape) |
| S-28 | Bob                      | `POST /stacks` over his own assets        | 200 — no regression                                          |

### 6.4 Capability signal (server)

| #    | Given                                      | When                                 | Then                                      |
| ---- | ------------------------------------------ | ------------------------------------ | ----------------------------------------- |
| S-29 | Anna, Bob's space asset                    | `GET /assets/:id`                    | `canEdit === true`                        |
| S-30 | Anna, Carol's asset                        | `GET /assets/:id`                    | `canEdit === false`                       |
| S-31 | Bob, his own asset, no space context       | `GET /assets/:id`                    | `canEdit === true`                        |
| S-32 | any caller                                 | any **list** endpoint via `mapAsset` | `canEdit` **absent** (§4.3, no N+1)       |
| S-33 | Anna, mixed ids (owned, Bob's, Carol's)    | `POST /assets/editable`              | returns owned + Bob's, excludes Carol's   |
| S-34 | Anna, empty `assetIds`                     | `POST /assets/editable`              | `{ editableAssetIds: [] }`, no error      |
| S-35 | Anna, id that does not exist               | `POST /assets/editable`              | silently excluded, no 404                 |
| S-36 | Anna, selection larger than the chunk size | `POST /assets/editable`              | chunks via `@ChunkedSet`; complete result |

### 6.5 Attribution (server)

| #    | Given                                                                     | When                   | Then                                                                                                            |
| ---- | ------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| S-37 | Anna edits Bob's asset date                                               | `PUT /assets/:id`      | one `AssetEdit` activity row in Bob's asset's space                                                             |
| S-38 | **Bob** edits his own asset                                               | `PUT /assets/:id`      | **no** activity row                                                                                             |
| S-39 | Anna bulk-edits 30 of Bob's                                               | `PUT /assets`          | exactly **one** row, `data.count = 30`, ≤ 4 ids                                                                 |
| S-40 | Anna edits an asset in no space                                           | `PUT /assets/:id`      | no row, no throw                                                                                                |
| S-41 | `logActivity` rejects                                                     | Anna edits Bob's asset | the **edit still succeeds**; failure logged, not propagated                                                     |
| S-42 | Web renders an unknown type                                               | activity feed          | falls back to `spaces_activity_default`                                                                         |
| S-46 | Anna bulk-edits Bob's assets spanning **two** spaces plus one in no space | `PUT /assets`          | **two** rows, one per space, counts summing to the in-space assets; the spaceless asset contributes none (§4.6) |

### 6.6 Web

| #    | Given                                                         | When                | Then                                                                                                                    |
| ---- | ------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| W-1  | `canEdit === true`, viewer open                               | render nav bar      | rotate ×3, editor, rating, and the 4 job items are present                                                              |
| W-2  | `canEdit === true`, non-owner                                 | render nav bar      | delete, archive, set-visibility, stack, view-in-timeline **absent**                                                     |
| W-3  | `canEdit === false`                                           | render nav bar      | reduced menu, as today                                                                                                  |
| W-4  | `canEdit === true`                                            | render detail panel | description, rating, date, location, tags editable; **people not** (§3.2)                                               |
| W-5  | `canEdit` **absent**, user is owner                           | render              | editable — ownership fallback (§5.3)                                                                                    |
| W-6  | `canEdit` absent, non-owner, space Editor, owner in `members` | render              | editable — space derivation                                                                                             |
| W-7  | `canEdit` absent, non-owner, owner **not** in `members`       | render              | not editable                                                                                                            |
| W-8  | `canEdit` absent, no space context, non-owner                 | render              | not editable                                                                                                            |
| W-9  | mixed selection, 7 of 10 editable                             | open toolbar        | `canEditMetadata` true; `canSetVisibility` **false**                                                                    |
| W-10 | mixed selection                                               | Change date         | applies to 7; toast reports 3 skipped                                                                                   |
| W-11 | `editableSelectedAssetIds === undefined`                      | open toolbar        | edit actions **hidden** until the subset resolves and is non-empty (§5.2; shipped behaviour, not disabled-pending)      |
| W-12 | all-owned selection                                           | select              | resolves synchronously; **no** `POST /assets/editable` issued                                                           |
| W-13 | `POST /assets/editable` rejects                               | select              | falls back to the §5.3 derivation; no error toast                                                                       |
| W-14 | rapid selection changes                                       | select repeatedly   | debounced; only the final selection's response is applied                                                               |
| W-15 | Viewer role (`space.canWrite === false`)                      | render anywhere     | no edit affordances                                                                                                     |
| W-16 | shared-link surface                                           | render              | no edit affordances (S-14)                                                                                              |
| W-17 | mixed selection, editor on a space surface                    | bulk **Rotate**     | applies to the editable subset — the one bulk action routing through `AssetEditCreate` rather than `AssetUpdate` (§4.2) |
| W-18 | `canEdit === true`, non-owner                                 | render detail panel | the people row is present but **read-only** — no add-a-name, no rename                                                  |

---

## 7. TDD plan

Every slice is **red → green → refactor**: the listed spec is written and observed failing before
the implementation lands. Slices are ordered so each is independently reviewable and leaves the tree
green.

### 7.1 Slice 1 — the rule, pinned against a real database

**Tests first.** New `server/test/medium/specs/utils/space-edit-access.medium.spec.ts`, beside the
existing `shared-space-album-scope.medium.spec.ts`.

This slice is **medium-only by necessity**: the rule is SQL. Unit mocks of `AccessRepository` prove
nothing about a three-arm `UNION` with correlated `EXISTS` and per-arm visibility gates. Table-driven
over **S-1 … S-13**, plus **S-43** (the actor is a space Owner, not an Editor — `memberRole` admits
both and only Editor is otherwise exercised) and **S-44** (a Viewer against the _new_ album arm; S-6
only covers the direct arm, so without S-44 the new arm's role gate is untested).

S-4 (Carol), S-5 (Dave), S-7/S-8 (Hidden/Locked), S-9 (trashed) and S-10 (offline) are the rows that
matter most — they are precisely what a helper-swap refactor would silently relax, and they can only
fail against Postgres.

Then implement §4.1.

`checkSpaceEditAccess` is `@GenerateSql`-decorated (`:489`), so this slice regenerates
`server/src/queries/*.sql`. See §8 for the ordering trap.

### 7.2 Slice 2 — widen the edit permissions

Tests: **S-15 … S-21** and **S-45** (the deliberately-widened `upsertMetadata` consumer from §4.7) in
`server/src/services/asset.service.spec.ts`. Then §4.2.

The S-15 (`AssetEditGet`) case is written **first**, because forgetting Get is the failure mode this
slice exists to prevent, and it fails in a way that misdirects.

### 7.3 Slice 3 — guards that must not move

Tests: **S-22 … S-25** (asset service), **S-26 … S-28** (`stack.service.spec.ts`). Then §4.5.

S-22/S-23 are regression pins on `rbac-3`, not new behaviour — they exist because Slice 1 widened the
permission those guards sit behind. They should pass before Slice 4 and keep passing after.

### 7.4 Slice 4 — the capability signal

Tests: **S-29 … S-36** (`asset.service.spec.ts` for the DTO field; controller/e2e for the route).
Then §4.3 + §4.4.

S-32 (list endpoints omit `canEdit`) is the N+1 guard and belongs in this slice, not a later one.

### 7.5 Slice 5 — attribution

Tests: **S-37 … S-42** and **S-46** (the multi-space bulk grouping) in `asset.service.spec.ts` and
`shared-space.service.spec.ts`. Then §4.6.

S-46 is written before the grouping exists, because the naive one-row-per-call implementation passes
S-39 and fails only S-46 — the multi-space case is the whole reason the grouping is specified.

S-41 (a failing `logActivity` must not fail the edit) is written before the logging call exists, so
the swallow is designed in rather than patched on.

### 7.6 Slice 6 — web viewer and detail panel

Tests: **W-1 … W-8** and **W-18** (the people row stays read-only for a non-owner, guarding §3.2)
across `AssetViewerNavBar.spec.ts`, the detail-panel specs, and a new `asset-editability.spec.ts` for
the pure helper. Then §5.1.

W-2 is the important negative: it asserts the owner-only items stay **absent** when `canEdit` is
true, which is the assertion that would otherwise silently pass in either direction.

### 7.7 Slice 7 — web bulk selection

Tests: **W-9 … W-17** in `selection-capabilities.spec.ts` (extending the existing file) plus toolbar
tests. Then §5.2.

W-17 (bulk rotate) is the one bulk action whose server path is `AssetEditCreate` rather than
`AssetUpdate`, so it depends on Slice 2 having landed; it fails for a different reason than the rest
of the toolbar if §4.2 is incomplete.

W-9 pins the `canEditMetadata` / `canSetVisibility` split — the split's whole purpose is that one
assertion.

### 7.8 Slice 8 — i18n and e2e

The two new keys across all ten locales (§9), then the end-to-end journey: Anna opens Bob's photo in
a space, rotates it, corrects the date, and sees the activity row.

### 7.9 Test-quality rules for this work

- **No pass-either-way assertions.** `queryBy*` + a truthiness check passes whether or not the gate
  works. Assert presence with `getBy*` and absence with an explicit `expect(...).toBeNull()`.
- **Prove red before green.** Each capability test must be observed failing with the flag inverted —
  the local record of mobile/web widget tests silently passing against a component that never
  rendered is the reason this is written down.
- **Reset mocks per file.** The web vitest config does not clear mocks between tests; call history
  leaks within a file.
- **`dart analyze` has no analogue here, but `pnpm check:svelte` does**: it can scan **0 files**
  locally and report success. Web type-safety on `canEdit` is confirmed in CI, not from a clean local
  run.

---

## 8. Edge cases and known traps

| Trap                                                                                                                          | Handling                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Helper swap silently drops `spaceVisibilityGate` / `deletedAt` / `isOffline`                                                  | §4.1 keeps the bespoke arms; S-7 … S-10 pin it against a real DB                                                                                                                                                                                                                                              |
| `AssetEditGet` left owner-only                                                                                                | S-15, written first in Slice 2                                                                                                                                                                                                                                                                                |
| `canEditMetadata` also wrapping Archive + SetVisibility                                                                       | Capability split, §5.2; pinned by W-9                                                                                                                                                                                                                                                                         |
| Required `canEdit` forcing wrong `false` from `mapAsset`                                                                      | Optional field, §4.3; pinned by S-32                                                                                                                                                                                                                                                                          |
| Editor rotate clobbering an owner's crop                                                                                      | `mergeRotation` composes; pinned by S-17                                                                                                                                                                                                                                                                      |
| Activity logging failing a legitimate edit                                                                                    | Swallowed; pinned by S-41                                                                                                                                                                                                                                                                                     |
| Membership matched against the wrong space                                                                                    | Correlated per-arm `EXISTS`, §2.4; pinned by S-13                                                                                                                                                                                                                                                             |
| `make sql` run without a database                                                                                             | **Deletes every query file.** Requires a live Postgres, and the order is fresh DB → `pnpm build` → `migrations:run` → sync, or the regen runs against the previous build's schema and produces a large bogus diff                                                                                             |
| The `ui` Playwright project mocks API routes by glob                                                                          | Adding `POST /assets/editable` and changing viewer fetches is the shape that timed out the #819 suite. `grep -rn "assets" e2e/src/ui` for route mocks before claiming green — neither web unit tests nor `--project=web` catch it                                                                             |
| `getSelectionCapabilities` purity contract                                                                                    | Ids are passed in via `ctx.selection`; no fetching inside the pure function                                                                                                                                                                                                                                   |
| Debounce races on rapid selection change                                                                                      | Only the final selection's response is applied; pinned by W-14                                                                                                                                                                                                                                                |
| Live-photo motion half                                                                                                        | Reducer fan-out preserved; pinned by S-12                                                                                                                                                                                                                                                                     |
| **TOCTOU** — role revoked, membership removed, or the asset pulled from the space between the capability answer and the write | The capability response is **advisory only**; every write re-runs `requireAccess`, so a stale `true` yields a clean 403 rather than an unauthorized write, surfacing through the partial-application path (§5.2). Stated because it is the first question a reviewer will ask of any cached permission answer |
| A capability answer stale in the **other** direction (a `false` that has since become true)                                   | Costs a hidden button until the next selection change. No invalidation machinery — deliberately, per YAGNI                                                                                                                                                                                                    |
| Face tagging exposed to editors                                                                                               | Out of scope (§3.2) — no server path exists. W-18 pins the people row staying read-only for non-owners                                                                                                                                                                                                        |
| A new `AssetUpdate` consumer added later inherits the widened rule silently                                                   | §4.7 enumerates today's consumers with a decision each; a future consumer must be added to that table                                                                                                                                                                                                         |

---

## 9. i18n

Per `CLAUDE.md`, the same commit updates **`de · fr · it · nl · pl · es · ru · zh_Hans · zh_Hant`**
alongside `en`:

1. the partial-application toast from §5.2 (n photos skipped)
2. the `AssetEdit` activity-feed string from §4.6

Both are **new** keys, so there is no stale-translation hazard. They must still match each file's
register (informal `du` / `tu` / `tú`; formal `vous` / `вы`), insert in alphabetical position, and be
followed by `npx prettier --write i18n/*.json`.

---

## 10. Gates before PR

`make lint-all` · `make format-all` · `make check-all` · server unit · server medium · web unit ·
`e2e` incl. the `ui` project · OpenAPI regeneration (`pnpm build` → `pnpm sync:open-api` →
`make open-api`), required because both the DTO field and the new route change the spec.

---

## 11. Risks

- **§2.3 removes a live behaviour.** Anyone relying on space editors editing a member's
  partner-shared assets loses that. Assessed as an accidental grant, not a feature; must be stated in
  the PR description.
- **§4.1 adds a third `UNION` arm to a permission check on hot paths.** The album arm's `EXISTS`
  subqueries are the shape that previously produced a PostgreSQL JIT blowup on the People page. Worth
  an `EXPLAIN` on a realistic dataset during Slice 1 rather than after release.
- **Mobile diverges until its follow-up lands.** Mobile keeps the current owner-only menu, so an
  editor sees actions on web that are absent on their phone. Acceptable and precedented, but it will
  generate a "the app is missing features" report; worth a line in the release notes.
