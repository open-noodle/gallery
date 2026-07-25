# Selection-toolbar consistency for Shared Spaces (web)

- **Discussion:** [open-noodle/gallery#839](https://github.com/open-noodle/gallery/discussions/839)
  — "Inconsistent selection toolbar across timelines (missing in Shared Space timeline/albums)"
- **Date:** 2026-07-24
- **Scope:** web only (`web/`). Mobile is a deliberate follow-up (see Out of scope).
- **Status:** design approved; implementation sliced for `impl-loop`.

## Problem

When a user multi-selects assets, the action toolbar that appears differs by surface:

- **Personal timeline & regular albums** — full toolbar (Share, Select-all, Add-to-album,
  Favorite, Download, and a context menu of edits/tags/delete).
- **Shared Space timeline & space person** — reduced: Select-all, Remove-from-space (editor),
  Favorite (own), Download + a partial context menu. No Share, no Add-to-album.
- **Shared Space albums** — gutted: only Download and (for managers) Remove-from-album. No
  Select-all, no Favorite, no context menu at all.

A space member therefore "loses access to basic actions simply because they're browsing through a
Shared Space." A viewer inside a space album bottoms out at a single Download icon.

### Root cause

`web/src/lib/components/timeline/AssetSelectControlBar.svelte` is a thin wrapper that renders
whatever `children` a page passes into its `trailing` snippet. There is **no shared source of truth**
for "which actions apply." Each of the five selection surfaces hand-wires its own list of action
components, so they drifted apart:

| Surface                                                           | Renders                         | Provenance |
| ----------------------------------------------------------------- | ------------------------------- | ---------- |
| `routes/(user)/photos/…/+page.svelte`                             | full list                       | upstream   |
| `routes/(user)/albums/[albumId]/…/+page.svelte`                   | full list (+ Remove-from-album) | upstream   |
| `routes/(user)/spaces/[spaceId]/…/+page.svelte`                   | reduced list                    | **fork**   |
| `routes/(user)/spaces/[spaceId]/people/[personId]/…/+page.svelte` | reduced list                    | **fork**   |
| `routes/(user)/spaces/[spaceId]/albums/[albumId]/…/+page.svelte`  | Download + Remove only          | **fork**   |

The fork already has a **unified capability model** for the ⌘K command palette
(`command-context-manager.svelte.ts` → `CommandContext` with album/space/selection sub-contexts and
per-item `isAvailable(ctx)` predicates in `command-items.ts`). The bulk toolbar is the one selection
surface that ignores it.

## Goal / guiding principle

**The regular shared album is the reference model.** Give every user, on every space surface,
exactly the actions they would have on the same assets in a regular shared album — same per-action
gates — mapping **space role → album role** (Owner/Editor/Viewer), with **Remove-from-space**
substituted for **Remove-from-album** on the direct-space surfaces (space timeline / space person).

"Consistent by rule": an action appears whenever the same conditions hold (surface + role +
ownership + asset state). Differences survive **only** where a real permission constraint forces them.
No surface hides an action it is allowed to show.

## Reference model — what a shared album grants today

From `albums/[albumId]/…/+page.svelte:734-780` (the untouched reference):

| Action                                                                                           | Gate in a shared album                                                    |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Download                                                                                         | **Unconditional** — you can download a photo another user shared with you |
| Select-all                                                                                       | Unconditional                                                             |
| Create-shared-link (Share)                                                                       | Unconditional¹                                                            |
| Add-to-album                                                                                     | Unconditional¹                                                            |
| Favorite                                                                                         | Own assets only (`isAllUserOwned`)                                        |
| Edit metadata: Rotate, Change date, Change description, Change location, Archive, Set-visibility | Own assets only                                                           |
| Tag                                                                                              | Own assets only, and tags preference enabled                              |
| Set-as-cover                                                                                     | Album editor (owner/editor role), single selection                        |
| Remove-from-album                                                                                | Album owner (`isOwned`) **or** own assets                                 |
| Delete                                                                                           | Own assets only                                                           |

¹ The album _page_ renders these buttons unconditionally, but Slice 1 proved the **server** honours
create-shared-link / add-to-album only for **owned (∪ partner)** assets (`Permission.AssetShare`,
`access.ts:127-131`). So our space toolbar owner-gates them (`isAllUserOwned`) to stay honest rather
than reproduce the album page's unconditional-but-sometimes-400 buttons — see the Share/Add-to-album
note under Capability rules.

We deliberately mirror the **album's** metadata set (Rotate + date/description/location + Archive +
Set-visibility), **not** the personal timeline's richer set (Stack, Link-live-photo, and library job
actions). Those are personal-library operations that do not belong inside a shared space.

## Non-goals / Out of scope (YAGNI)

- **Mobile (iOS/Android).** The discussion notes the mobile app diverges too. It is a separate
  codebase (Flutter/Riverpod) and a separate spec that will reuse these capability rules conceptually.
- **Refactoring the upstream `photos` and `albums` pages onto the shared toolbar.** They are the
  reference and already correct; patching two of Immich's hottest files buys recurring rebase
  conflicts for no user-visible gain. They stay untouched. (A parity guard test — Slice 2 — protects
  against silent drift if upstream restructures the album toolbar.)
- **New actions** beyond the album model (no Stack / Link-live-photo / library jobs in spaces).
- **Exposing space-editor edits of non-owned _direct_ space assets.** The server permits an Editor to
  favorite/edit assets in the space's direct pool even when they don't own them (Slice 1). We do NOT
  surface this: the merged space timeline has no per-asset direct-vs-album-path origin signal, so
  editor-edit on a mixed selection would partially 400. Owner-gating (`isAllUserOwned`) matches the
  current behaviour and the album model. Revisiting this needs a per-asset origin signal — future work.
- **Changing the ⌘K command palette itself.** We reuse its context; we do not alter its items.
- **Trashed-asset actions (restore/permanent-delete).** Space timelines do not surface trash;
  `isAllTrashed` selections are not a reachable state here.

## Architecture

Two new fork files, one rule set, **zero upstream edits**. The toolbar's upstream action components
(`DownloadAction`, `FavoriteAction`, `AssetSelectControlBar`, …) are imported and rendered, never
modified — rebase-safe.

### 1. `getSelectionCapabilities(ctx: CommandContext): SelectionCapabilities` — the rule engine

New pure fork module (proposed: `web/src/lib/managers/selection-capabilities.ts`). Consumes the
`CommandContext` the fork already assembles (`commandContextManager.getContext()`), returns one
struct of booleans. It encodes the album model **once**; because it reads `ctx.album` / `ctx.space`,
it yields the album answer in album context and the mirrored answer in space context.

```ts
export interface SelectionCapabilities {
  canSelectAll: boolean;
  canDownload: boolean;
  canShare: boolean; // CreateSharedLink
  canAddToAlbum: boolean;
  canFavorite: boolean;
  canEditMetadata: boolean; // Rotate, ChangeDate/Description/Location, Archive, SetVisibility
  canTag: boolean;
  canDelete: boolean;
  canSetCover: boolean;
  canRemoveFromAlbum: boolean;
  canRemoveFromSpace: boolean;
}
```

Surface discriminators derived from `ctx` (no new signal needed):

```
sel            = ctx.selection            // null ⇒ no toolbar rendered at all
inAlbum        = ctx.album !== null
inSpace        = ctx.space !== null
isRegularAlbum = inAlbum && !inSpace
isDirectSpace  = inSpace && !inAlbum      // space timeline & space person
isSpaceAlbum   = inAlbum && inSpace
isPersonal     = !inAlbum && !inSpace
```

Predicates (the single rule set):

```
canSelectAll       = sel !== null
canDownload        = true            // download-disable is a shared-link-only flag (out of scope); auth toolbar downloads unconditionally
canShare           = sel.isAllUserOwned   // RESOLVED Slice 1 Q1: server AssetShare = owner∪partner only (no space/album arm)
canAddToAlbum      = sel.isAllUserOwned   // RESOLVED Slice 1 Q2: same owner∪partner gate (the #764 space-editor contribution is a separate flow, out of scope)
canFavorite        = sel.isAllUserOwned
canEditMetadata    = sel.isAllUserOwned
canTag             = sel.isAllUserOwned && tagsEnabled
canDelete          = sel.isAllUserOwned
isEditorOfContext  = isRegularAlbum ? (ctx.album.isOwner || ctx.album.isEditor)
                   : isDirectSpace  ? ctx.space.canWrite
                   : isSpaceAlbum   ? (ctx.space.canWrite || ctx.album.isEditor)   // == canManage
                   : /* personal */   false
canSetCover        = isEditorOfContext && sel.selectedAssetIds.length === 1   // ROLE gate only; see cover note
canRemoveFromAlbum = isRegularAlbum ? (ctx.album.isOwner || sel.isAllUserOwned)
                   : isSpaceAlbum   ? (ctx.space.canWrite || ctx.album.isEditor)   // RESOLVED Slice 1 Q3 (decision C): canManage ONLY — server AlbumAssetDelete is role-gated, ownership grants nothing
                   : false
canRemoveFromSpace = isDirectSpace && ctx.space.canWrite
```

**On owner-gating Share and Add-to-album (resolved Slice 1, Q1/Q2):** the server's `Permission.AssetShare`
(used by both create-shared-link and the ordinary add-assets-to-album path) is **owner ∪ partner
only** — it has no album or space arm (`server/src/utils/access.ts:127-131`, deliberate per the
`shared-space.service.ts:669-671` comment). So a shared link or album-add referencing a non-owned
space asset is refused server-side. Gating `canShare`/`canAddToAlbum` by `isAllUserOwned` keeps the
toolbar **honest** (it never offers a button the server would 400). On the personal timeline and
regular album this is always true, so those reference surfaces are unaffected; in a space the buttons
appear only for your own selected assets. This is stricter than the album _page_'s unconditional
buttons (a latent album quirk we deliberately do not reproduce), but it is exactly "show whatever the
user is **able** to do." (Partner-shared assets are a rare extra the server also allows; the toolbar's
`isAllUserOwned` signal conservatively omits them — acceptable, never offers a 400.)

**Cover note (fixes a space-person over-grant):** `canSetCover` is only the _role+single_ gate — it is
surface-agnostic. Not every surface has a cover: the **space-timeline** sets the space cover, a
**space-album** sets the album cover, but the **space-person** page has **no cover action**
(verified: no `set_as_space_cover`, context menu at `people/[personId]/…:716-741`). So the component
renders Set-cover only when `caps.canSetCover && onSetCover != null`; the space-person page passes no
`onSetCover`, so cover never appears there even for an editor. `canSetCover` never returns true on the
personal timeline because `isEditorOfContext` is false there.

**Space-album Remove-from-album (decision C — RESOLVED Slice 1, Q3):** removing an asset from a space
album goes through `Permission.AlbumAssetDelete`, whose server check is **strictly role-gated** —
album owner/editor **or** space owner/editor of the linked space (`server/src/utils/access.ts:247-257`

- `access.repository.ts:144-161`, which excludes a space Viewer's membership row). Asset **ownership
  grants nothing**: a plain viewer/member is refused (403) before any per-asset logic runs, even for
  their own asset. So `canRemoveFromAlbum` in a space album is `canManage` **only** — no `isAllUserOwned`
  arm. This is a **server-enforced deviation** from the regular album (which does allow own-asset
  removal); the parity guard (Slice 2) encodes this space-album exception explicitly.

**Orthogonality invariant (critical):** _space role_ (Owner/Editor/Viewer, from
`ctx.space.canWrite`/`isOwner`) and _asset ownership_ (`sel.isAllUserOwned`, i.e.
`asset.ownerId === userId`) are independent axes. A space **Owner** viewing **another member's**
asset must NOT get owner-gated actions (they don't own the asset); a space **Viewer** who happens to
own the selected asset DOES get them. Every owner-gated capability keys off `isAllUserOwned`, never
off space role, and vice-versa.

**Context extension (fork files only):** `AlbumContext` currently exposes `isOwner` but not
`isEditor`. Add `isEditor` to `AlbumContext` and compute it in `registerAlbumContext` from
`album.albumUsers` (mirrors the existing `isAlbumEditor` derivation in the space-album page). This is
a fork file (`command-context-manager.svelte.ts`), so it is rebase-safe. `SpaceContext.canWrite`
(owner||editor) already exists.

### 2. `<SelectionToolbar>` component

New fork component (proposed:
`web/src/lib/components/timeline/SelectionToolbar.svelte`). Responsibilities:

- Wrap the upstream `<AssetSelectControlBar>`.
- Own the `<CommandPaletteDefaultProvider>` + `getAssetBulkActions($t)` block (today only
  personal/album pages render it; spaces must too, so Add-to-album registers).
- Compute `caps = getSelectionCapabilities(commandContextManager.getContext())` reactively and render
  the album-page layout — top row (Share, Select-all, Add-to-album, Favorite) + overflow
  `ButtonContextMenu` (Download, metadata edits, Set-cover, Tag, Remove-from-album/space, Delete) —
  each action wrapped in `{#if caps.canX}`.
- Two render gates depend on props as well as caps: **Set-cover** renders only when
  `caps.canSetCover && onSetCover != null` (so the space-person page, which passes no `onSetCover`,
  never shows it); **Remove** renders `RemoveFromSpaceAction` when `spaceId` is set and
  `caps.canRemoveFromSpace`, else `RemoveFromAlbum` when `album` is set and `caps.canRemoveFromAlbum`.

**Separation of concerns:** capabilities decide _what to show_; the page passes a typed props bundle
for _what to do_. Proposed props:

```ts
interface SelectionToolbarProps {
  timelineManager: TimelineManager;
  assetInteraction: AssetInteraction; // the assetMultiSelectManager singleton
  album?: AlbumResponseDto; // present on album surfaces (for Remove-from-album, download filename)
  spaceId?: string; // present on direct-space surfaces (for Remove-from-space)
  downloadFilename?: string;
  onRemove?: (ids: string[]) => void; // remove-from-album / remove-from-space result handler
  onSetCover?: () => void; // per-surface cover setter (album cover vs space cover)
  onFavorite?: OnFavorite; // defaults to timelineManager.update
  onArchive?: OnArchive;
  onDelete?: OnDelete;
}
```

The component never decides permissions from props — only `getSelectionCapabilities` does. Props that
correspond to a disabled capability are simply never reached.

### 3. Space page integration

Each of the three fork space routes replaces its bespoke control-bar block with a single
`<SelectionToolbar {...} />`. Note two **separate** mechanisms (verified — do not conflate them):

- **Toolbar Add-to-album** works because `<SelectionToolbar>` owns the `CommandPaletteDefaultProvider`
  - `getAssetBulkActions($t)` block. This is self-contained and works on all three space surfaces
    regardless of any selection-context registration.
- **⌘K palette parity** is a different surface. Only the **space-timeline** page registers a
  `registerSelectionContext` (`canAddToAlbum: () => false` at line 522); the space-person and
  space-album pages register **none**. Flipping the space-timeline flag to `true` is a 1-line
  palette-consistency nicety included here; _adding_ a selection context to the other two pages is a
  separate palette-parity concern and is **out of scope** (it does not affect the toolbar fix).

Net result per surface:

| Surface        | Before                                                           | After                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Space album    | Download + Remove-from-album only                                | Full album-equivalent toolbar; Select-all + Download always; owner-gated actions on own assets; Remove-from-album gated `canManage` (Q3); **no** Remove-from-space |
| Space timeline | Select-all, Remove-from-space, Favorite, Download + partial menu | Full album-equivalent; adds Share/Add-to-album (own assets only), Rotate, Set-visibility, Delete, Set-cover (space cover)                                          |
| Space person   | same as space timeline                                           | same as space timeline **except no Set-cover** (page has no cover action)                                                                                          |

## RBAC safety invariants & verifications

Reversing the deliberate space-album strip (`rbac-5/albums-8` comment at
`spaces/[spaceId]/albums/…/+page.svelte:405-411`) is safe because:

1. **Every cross-owner mutation stays behind `isAllUserOwned`.** Favorite/metadata/Tag/Delete fire
   only when the whole selection is the current user's own assets → owner-path → the server always
   permits it, regardless of album-path. The concern the review closed — a space _editor_ editing
   _another member's_ album-path asset — is a capability the album model never offers, so mimicking
   the album never re-opens it. `checkSpaceEditAccess`'s album-arm omission and its guard
   (`shared-space-album-scope.guard.spec.ts`) remain valid and untouched.
2. **Editor/owner-role actions** (Set-cover, Remove-from-album/space) are gated by container role and
   independently enforced server-side.
3. **Share / Add-to-album** are owner-gated (`isAllUserOwned`) to match the server's owner∪partner
   `AssetShare` rule (Q1/Q2), so they too never fire on a non-owned asset.

Both verifications are now **resolved by Slice 1's server-code investigation** (evidence in the API
matrix section) and re-asserted by tests:

- **V1 — `TimelineAsset.ownerId` is correct on space-projected assets.** RESOLVED (Q4): traced
  end-to-end (`asset.repository.ts:1439/1502`, no mask/override), so the owner-gate is reliable. The
  web e2e owner/other cases (Slice 6) re-assert it as a tripwire.
- **V2 — owner-scoped Share / Add-to-album / edit / delete / remove endpoints enforce ownership/role
  for space-accessed asset IDs.** RESOLVED (Q1–Q3): create-shared-link and add-to-album are
  owner∪partner-only; metadata/favorite/delete are owner-only; remove-from-space-album is role-gated.
  Codified by the server/API RBAC matrix (Slice 1).

### Share / Add-to-album note (RESOLVED — Slice 1, Q1/Q2)

The server's `Permission.AssetShare` (used by both create-shared-link and add-assets-to-album) is
**owner ∪ partner only** — no album/space arm (`server/src/utils/access.ts:127-131`, deliberate per
`shared-space.service.ts:669-671`). So we gate `canShare`/`canAddToAlbum` by `sel.isAllUserOwned`:
always true on personal/regular-album (reference surfaces unaffected), and in a space the buttons
appear only for your own selected assets. The toolbar therefore never offers a button the server would
400 — stricter than the album _page_'s unconditional buttons (a latent quirk we intentionally do not
reproduce), and exactly "show whatever the user is **able** to do." The fork's #764 cross-owner
contribution (space Owner/Editor adding others' assets to a space-linked album) is a **separate
existing flow**, not this generic toolbar button, and stays out of scope.

## Testing strategy (TDD + BDD)

TDD throughout: for every slice, write the failing test(s) first, watch them fail for the right
reason, then implement to green. RBAC coverage is exhaustive on the pure rule engine (cheap) and
representative on e2e (expensive).

**BDD convention (applies to unit, component, and e2e):** every scenario is named and structured
Given/When/Then — the `describe`/`it` (or Playwright `test`) titles read as behaviour, and each edge
in the catalogue below maps to exactly one scenario. Example for E4:

```
describe('getSelectionCapabilities — space timeline')
  it('Given a space OWNER who does not own the selected asset, When capabilities resolve, Then role
      actions (remove-from-space, set-cover) are allowed but owner-gated actions (favorite/edit/
      delete) are denied')
```

The "Given" fixes the context (surface + role + ownership + asset state), the "When" is the single
`getSelectionCapabilities(ctx)` call (or the toolbar render / UI selection), and the "Then" asserts
the exact allowed/denied set. No scenario asserts more than one behaviour.

### Layers

- **a. Unit — capability matrix (core + parity guard):** `getSelectionCapabilities` over the full
  cross-product `{personal, regular-album, space-timeline, space-album} × {owner, editor, viewer} ×
{all-owned, mixed, none-owned} × {single, multi}`, plus asset-state axes (all-favorite,
  all-archived, tags on/off). Includes the **parity assertion**: for equivalent role+ownership, the
  space capability set equals the album capability set except for two documented, server-enforced
  deviations — (i) on **direct-space** surfaces (space timeline/person) `canRemoveFromAlbum` is
  replaced by `canRemoveFromSpace`; (ii) on a **space album** `canRemoveFromAlbum` is `canManage`
  ONLY (no own-asset arm — Q3), unlike the regular album's `owns-container || own asset`. Share and
  Add-to-album are `isAllUserOwned` on every surface (so album-context and space-context agree). This
  is what fails CI if upstream restructures the album toolbar.
- **b. Component — `<SelectionToolbar>`:** given a capability set, renders exactly the permitted
  buttons and no others (reuse the `register-selection-context-harness.svelte` pattern). Asserts
  the ⌘K provider is present so Add-to-album registers.
- **c. Web e2e RBAC matrix (Playwright):** new spec mirroring `spaces-albums-timeline.e2e-spec.ts`,
  driving the real UI and asserting toolbar visibility via `page.locator('#control-bar')` +
  `getByLabel` / `data-testid`.
- **d. Server/API RBAC matrix (supertest):** `buildSpaceContext()` + `forEachActor()` proving the
  underlying endpoints enforce owner/role rules for space-accessed asset IDs (backs V2, and pins the
  Share/Add-to-album behaviour that decides the capability gate).
- **e. Keep green:** `command-items.spec.ts`, `selection-command-handlers.spec.ts`,
  `shared-space-album-scope.guard.spec.ts`, `selection-command-page-boundaries.spec.ts`,
  `archive-page.spec.ts`.

### RBAC edge-case catalogue (must all be covered — unit at minimum)

| #   | Scenario                                                                     | Expected                                                                                                                            |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Space **viewer** selects an owner's (not their) asset — space timeline       | Select-all, Download ✓; Share/Add-to-album ✗ (not owner — Q1/Q2); Favorite/edit/Tag/Delete ✗; Remove-from-space ✗; Set-cover ✗      |
| E2  | Space **editor** selects their **own** asset — space timeline                | Select-all, Download ✓ + Share, Add-to-album, Favorite, edit, Tag, Delete ✓ + Remove-from-space ✓ + Set-cover ✓ (if single)         |
| E3  | Space **editor** selects an owner's (not their) asset                        | Select-all, Download ✓ + Remove-from-space ✓ + Set-cover ✓; Share/Add-to-album, Favorite/edit/Tag/Delete ✗ (not owner)              |
| E4  | Space **owner** selects **another member's** asset                           | Remove-from-space ✓, Set-cover ✓ (role); Share/Add-to-album, Favorite/edit/Delete ✗ (**not** the asset owner) — orthogonality       |
| E5  | Space **viewer** who is the space album's **album-editor**, in a space album | Remove-from-album ✓ (canManage via `isAlbumEditor`) even though space viewer                                                        |
| E6  | Space **editor**, not an album member, in a space album                      | Remove-from-album ✓ (canManage via `isSpaceEditor`)                                                                                 |
| E7  | **Mixed** selection (some owned, some not)                                   | owner-gated + Share/Add-to-album all ✗ (`isAllUserOwned` false); Select-all + Download ✓ (the only truly-always actions)            |
| E8  | **Multi** selection                                                          | Set-cover ✗ (single only); everything else per role/ownership                                                                       |
| E9  | All-favorite selection                                                       | Favorite renders as "remove from favorites"; else "favorite"                                                                        |
| E10 | All-archived selection                                                       | Archive renders as "unarchive"; else "archive"                                                                                      |
| E11 | Tags preference disabled                                                     | Tag ✗ even when `isAllUserOwned`                                                                                                    |
| E12 | Empty selection                                                              | toolbar not rendered (`sel === null`)                                                                                               |
| E13 | Space **non-member** hits a space URL                                        | cannot reach the page (existing visibility specs); toolbar N/A — cross-referenced, not re-tested                                    |
| E14 | Regression: personal timeline unchanged                                      | full personal set unchanged (function returns personal answer; pages untouched)                                                     |
| E15 | Regression: regular album unchanged                                          | full album set unchanged                                                                                                            |
| E16 | Space **viewer** (non-manager) selects their **own** asset in a space album  | Remove-from-album ✗ (Q3: role-gated, viewer is not a manager); owner-gated (Favorite/edit/Delete/Share/Add-to-album) ✓; Set-cover ✗ |
| E17 | **Admin** (not the asset owner, not a space/album role) selects an asset     | no special power — owner/role gates apply exactly as for any user (`isAdmin` is never consulted by the rule engine)                 |

### Web e2e matrix (subset of the catalogue that is reachable through the UI)

| #   | Surface        | Actor                | Selection                   | Assert SHOW                                                                                          | Assert HIDE                                                               | Catalogue |
| --- | -------------- | -------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------- |
| 1   | Space timeline | Viewer               | owner's asset               | Select-all, Download                                                                                 | Share, Add-to-album, Favorite, edit, Delete, Remove-from-space, Set-cover | E1        |
| 2   | Space timeline | Editor               | own asset (editor adds it)  | Select-all, Download, Share, Add-to-album, Favorite, edit, Tag, Delete, Remove-from-space, Set-cover | —                                                                         | E2        |
| 3   | Space timeline | Editor               | owner's asset               | Select-all, Download, Remove-from-space, Set-cover                                                   | Share, Add-to-album, Favorite, edit, Delete                               | E3        |
| 4   | Space timeline | Owner                | own asset                   | everything                                                                                           | —                                                                         | E2/E4     |
| 5   | Space album    | Viewer/member        | album asset (not theirs)    | Select-all, Download                                                                                 | Share, Add-to-album, Remove-from-album, owner-gated                       | E1/E7     |
| 6   | Space album    | Editor (canManage)   | album asset (not theirs)    | Select-all, Download, Remove-from-album, Set-cover                                                   | Share, Add-to-album, Favorite, edit, Delete                               | E6        |
| 7   | Space album    | member (non-manager) | **own** asset in album      | Select-all, Download, Share, Add-to-album, Favorite, edit, Tag, Delete                               | Remove-from-album, Set-cover                                              | E16       |
| 8   | Space person   | Viewer               | person's asset (not theirs) | Select-all, Download                                                                                 | Share, Add-to-album, owner-gated, Remove-from-space                       | smoke     |

Cases 1 and 5 are the reporter's exact regressions (Select-all + Download were missing there). Case 7
covers E16 and is reachable because a space Owner/Editor can add another member's asset to a
space-linked album (fork #764 contribution). **E17** (admin has no special power) lives in the unit
matrix only — there is no UI surface where admin-ness would change the toolbar, so an e2e fixture adds
no signal.

### Server/API RBAC matrix (Slice 1 — runs first, gates now RESOLVED)

Using `buildSpaceContext()` (gives `spaceOwner`/`spaceEditor`/`spaceViewer`/`spaceNonMember` +
`spaceAssetId` owned by owner) and `forEachActor()` (asserts a status per actor, names the failing
actor). The expected statuses below are the **resolved** server behaviour (evidence file:line noted);
the e2e spec codifies them and is the regression tripwire:

- **Download** of `spaceAssetId`: owner/editor/viewer → 200; non-member → 400.
- **Create-shared-link** referencing a **non-owned** `spaceAssetId`: owner → 201; editor/viewer/
  non-member → **400**. `Permission.AssetShare` = owner∪partner only (`access.ts:127-131`). →
  `canShare = isAllUserOwned`.
- **Add-to-album** of a **non-owned** `spaceAssetId` into the actor's own (non-space) album: the
  request is **HTTP 200 for everyone** (they own the target album), but the non-owned asset is denied
  **per-item in the body** (`success:false, error:no_permission`) via the non-throwing `AssetShare`
  check — only the owner's item is `success:true`. So the honest client gate is `canAddToAlbum =
isAllUserOwned` (a non-owned add would silently no-op).
- **Favorite / metadata update** of a **direct** `spaceAssetId`: owner **AND space editor** → 204;
  viewer/non-member → 400. `Permission.AssetUpdate` = `isOwner ∪ checkSpaceEditAccess`
  (`access.ts:155-159`); `checkSpaceEditAccess` grants an Editor/Owner write over the space's **direct**
  pool (`shared_space_asset`) regardless of asset owner (visibility/livePhoto are the one owner-only
  exception — rbac-3). **Delete** is owner-only (`AssetDelete` has no space arm, `access.ts:161-163`).
  **Client note:** despite the server allowing an editor to edit a non-owned _direct_ asset, the rule
  engine still gates `canFavorite`/`canEditMetadata`/`canTag` by `isAllUserOwned`. The merged space
  timeline carries no per-asset direct-vs-album-path origin signal (rbac-5/albums-8), so exposing
  editor-edit would produce partial 400/`success:false` on any mixed selection — matching the current
  space-timeline behaviour and the album model. Owner-path edits are always safe (Q5), which is what
  the toolbar surfaces.
- **Remove-from-space** (`shared_space_asset`, `requireRole(Editor)`): editor/owner → 200;
  viewer/non-member → **403** (role guard, not an access check).
- **Remove-from-space-album (decision C — two-layer gate):** removal has an album-level gate AND a
  per-asset gate. (1) Album-level `AlbumAssetDelete` (`access.ts:247-257` + `access.repository.ts:144-161`)
  is role-gated: a **non-manager** (plain space/album Viewer) is refused outright → **400**, so a
  non-manager can't remove even their **own** asset. (2) For a caller who passes the album gate, the
  shared `removeAssets` util applies removal **per asset**: it bypasses per-asset ownership only for a
  caller holding `Permission.AlbumDelete` (the **album owner**); otherwise each asset is re-checked
  against `AssetShare` (owner ∪ partner). So a **space Editor** who owns neither the album nor the
  asset passes the gate (**200**) but the item is denied in the body (`success:false`); only the
  **album owner** (or the asset's owner, if they also clear the album gate) actually removes it. →
  `canRemoveFromAlbum` (space album) `= canManage`, **no** own-asset arm — this is a UI-affordance gate
  (matching the pre-existing space-album page); the server remains the per-asset authority.

### Infra notes (folded in from prior e2e pain)

- Run the web suite on the `:2285` e2e stack (`--project=web`); the `:2283` dev stack serves empty
  bodies and yields bogus "element not found".
- Space role text is a raw lowercase enum under CSS `capitalize` → match with `{ ignoreCase: true }`.
- Assert absence with `toHaveCount(0)` / `.not.toBeVisible()`, not a bare negation.
- Do not trust `waitForQueueFinish`'s false-"done"; settle uploads via the established websocket/event
  helpers.
- Fresh worktree needs SDK build + test-assets + `playwright install` before the web suite runs.

## Implementation slices (impl-loop)

Each slice is a vertical, independently green increment. TDD order inside every slice: **tests first
→ fail → implement → green → refactor**. A slice is "done" only when its acceptance criteria hold and
the full web gate (`check:typescript` + `check:svelte` + `pnpm lint`) is clean.

**Ordering rationale:** the server/API matrix runs **first** because it resolves the two open gate
decisions (Share/Add-to-album owner-scoping, and decision C) that the rule engine and every web e2e
assertion depend on. Then rules → component → page wirings (each with its own web e2e) → cleanup.
Slices 4–6 each mutate one fork page and are independent of each other (any order), but all follow
Slices 1–3.

### Slice 1 — Server/API RBAC matrix (decides the gates; runs first)

- **Tests first + implement (test-only slice):** `spaces-selection-actions.e2e-spec.ts` under
  `e2e/src/specs/server/api/` using `buildSpaceContext()` + `forEachActor()`, covering every row of
  the "Server/API RBAC matrix" above (download, create-shared-link, add-to-album, favorite, metadata
  update, delete, remove-from-space, and **own-asset remove-from-space-album**) against
  space-accessed asset IDs.
- **Gate decisions (already resolved by server-code investigation; this slice codifies them as
  executable assertions):** (i) `canShare = canAddToAlbum = isAllUserOwned` (`AssetShare` is
  owner∪partner-only, Q1/Q2); (ii) **decision C** — `canRemoveFromAlbum` in a space album is
  `canManage` ONLY, no own-asset arm (`AlbumAssetDelete` role-gated, Q3); (iii) owner mutations are
  never album-path-blocked (Q5). If any assertion turns out red against a running server, the fix is
  to correct the rule engine (Slice 2) — the e2e is the source of truth.
- **Acceptance:** matrix green; the three findings stand as executable tests; V2 satisfied.
- **Files:** `e2e/src/specs/server/api/spaces-selection-actions.e2e-spec.ts` (new).
- **Note on local execution:** this suite needs the e2e API stack (testcontainers/Docker). The shared
  e2e stack is a machine-wide singleton; if it is not safely available locally, push and let CI run it
  — the gate decisions are already resolved from server code, so Slices 2–6 are not blocked on a local
  red/green here.

### Slice 2 — `getSelectionCapabilities` rule engine + unit matrix + parity guard

- **Tests first:** `selection-capabilities.spec.ts` — the full RBAC edge catalogue **E1–E17** as
  Given/When/Then scenarios over synthetic `CommandContext` fixtures, plus the album↔space parity
  assertion. Encodes the Slice-1 gate decisions.
- **Implement:** `selection-capabilities.ts` (pure function + `SelectionCapabilities` type). Extend
  `AlbumContext` with `isEditor` and compute it in `registerAlbumContext` (fork file). Reuse existing
  handlers (`canFavoriteSelected`, `canDeleteSelected`, `canAddSelectedToAlbum`) where they align.
- **Acceptance:** every E1–E17 scenario passes; parity assertion passes; no UI touched yet.
- **Files:** `web/src/lib/managers/selection-capabilities.ts` (new),
  `…/selection-capabilities.spec.ts` (new), `…/command-context-manager.svelte.ts` (extend
  `AlbumContext`), `…/command-context-manager.spec.ts` (extend for `isEditor`).

### Slice 3 — `<SelectionToolbar>` component + component tests

- **Tests first:** `SelectionToolbar.spec.ts` — Given a capability set (drive via a stubbed
  context/harness), Then exactly the permitted buttons render; assert the two prop-dependent render
  gates (Set-cover hidden when `onSetCover` absent — the space-person case; Remove picks
  space-vs-album by which of `spaceId`/`album` is set) and that the ⌘K default provider is present so
  Add-to-album registers.
- **Implement:** `SelectionToolbar.svelte` wrapping `AssetSelectControlBar`, owning
  `CommandPaletteDefaultProvider`, rendering album-layout actions gated by
  `getSelectionCapabilities`, taking the props bundle.
- **Acceptance:** component renders correct buttons per caps + props; no page wired yet; existing
  suites green.
- **Files:** `web/src/lib/components/timeline/SelectionToolbar.svelte` (new), spec (new).

### Slice 4 — Wire space timeline page + web e2e cases 1–4

- **Tests first:** new Playwright spec `spaces-selection-toolbar.e2e-spec.ts` cases 1–4. The
  own-asset cases (2, 4) fail today (Share/Add-to-album/Delete absent for owners); the others'-asset
  cases (1, 3) assert the viewer/editor behaviour that must be preserved (mostly already correct — they
  guard against regressions in the rewrite).
- **Implement:** replace the control-bar block (`spaces/[spaceId]/…/+page.svelte:877-911`) with
  `<SelectionToolbar>`; pass space wiring (`spaceId`, `onRemove=handleRemoveAssets`,
  `onSetCover=handleSetAsCover`, `onFavorite`, `onArchive`). Toolbar Add-to-album comes from the
  component's own provider. Separately, flip this page's `registerSelectionContext` `canAddToAlbum`
  (line 522) `false → true` for ⌘K-palette parity (1 line; the only page that has a selection context
  to flip).
- **Acceptance:** cases 1–4 green; old inline action imports removed; web gate clean.
- **Files:** `spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`, e2e spec (new).

### Slice 5 — Wire space person page + smoke e2e case 8

- **Tests first:** e2e case 8 (space-person viewer sees the always-set, not owner-gated /
  Remove-from-space; **no Set-cover** even for an editor).
- **Implement:** same swap at `spaces/[spaceId]/people/[personId]/…/+page.svelte:715-742`; pass
  `spaceId` + handlers but **no `onSetCover`** (this page has no cover). This page registers no
  selection context — do not add one (out of scope).
- **Acceptance:** case 8 green; toolbar matches space timeline minus Set-cover; web gate clean.
- **Files:** the space-person page, e2e spec (append).

### Slice 6 — Wire space album page (the reversal) + web e2e cases 5–7 + V1

- **Tests first:** e2e cases 5–7 (all fail today — space album shows only Download (+Remove for
  managers); Select-all, the context menu, Share/Add, Favorite are all absent). Cases 5 (others'
  asset → owner-gated hidden) vs 7 (own asset → owner-gated shown) together are the **V1 tripwire**;
  case 7 also confirms decision C (Remove-from-album stays hidden for the non-manager owner).
- **Implement:** replace the Download+Remove-only bar
  (`spaces/[spaceId]/albums/[albumId]/…/+page.svelte:412-419`) with `<SelectionToolbar>`; album wiring
  (`album` DTO, `onRemove=handleRemoveAssets`, `onSetCover=`album cover); `canRemoveFromAlbum` =
  `canManage` only (resolved decision C — **no** own-asset arm); **no** `spaceId`/Remove-from-space.
  Replace the `rbac-5/albums-8` comment to document the new invariant (owner-gated mutations are safe
  via the owner path — Q5; space-editor cross-owner edit still never offered; remove stays role-gated
  — Q3). This page registers no selection context — do not add one.
- **Acceptance:** cases 5–7 green; verify no owner-gated button shows on a non-owned album asset and
  no Remove-from-album shows for a non-manager (V1 + decision C); web gate clean.
- **Files:** the space-album page, e2e spec (append).

### Slice 7 — Cleanup, i18n, parity guard confirmation, full verify

- **Implement:** remove now-dead action imports from all three space pages; add any new i18n keys
  (en.json only — web+mobile share `i18n/`); confirm the parity guard from Slice 2 is explicit and
  named.
- **Acceptance:** `make check-web` + `make lint-web` clean; unit + component + web e2e + API e2e all
  green; a final skim confirms the three space surfaces match the album reference per the catalogue.
- **Files:** the three space pages, `i18n/en.json` (if needed).

## Risks & open questions

- **R1 — Share/Add-to-album server behaviour.** RESOLVED (Q1/Q2): `AssetShare` is owner∪partner-only,
  so `canShare = canAddToAlbum = isAllUserOwned`. No user-visible regression on album/personal
  (always all-owned there). Closed.
- **R2 — `ownerId` fidelity on space-projected assets (V1).** RESOLVED (Q4): `ownerId` is the genuine
  owner, never masked. Slice 6 e2e (owner vs other) re-asserts it as a tripwire. Closed.
- **R3 — Drift from the untouched upstream album.** Mitigated by the Slice 2 parity guard: if upstream
  restructures the album toolbar, the assertion fails in CI rather than shipping silent divergence.
  (Two deviations are encoded intentionally: Share/Add owner-gating, and the space-album `canManage`-only
  remove.)
- **R4 — Decision C (own-asset remove from a space album).** RESOLVED (Q3): `AlbumAssetDelete` is
  role-gated, ownership grants nothing → `canManage`-only, no own-asset arm. Closed.
- **R5 — Owner mutations on album-path assets.** RESOLVED (Q5): the owner path (`checkOwnerAccess`) is
  never subtracted by `checkSpaceEditAccess`, so owner-gated actions are safe in the space album.
  Closed.
- **R6 — `check:svelte` local blindness.** It has been observed to scan 0 files locally; rely on the
  push-time CI gate for the svelte check, and don't treat a local 0-file run as proof.
- **R7 — e2e stack is a shared machine-wide singleton.** The Slice 1 API suite and Slices 4–6
  Playwright suites need the Docker e2e stack. To avoid clobbering other sessions, the loop validates
  unit/component/typecheck/lint/svelte-check locally and relies on **CI (babysit)** to run the e2e
  suites, rather than spinning the shared stack up locally.
