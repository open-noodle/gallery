# Slice 11 — Product / UX completeness (M9, L9, L10, L14, L15, L16, L17) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD for the
> server-testable behaviors. Phase 2 (deferred). Executed in two halves: **A (server)** then **B
> (web + mobile + i18n)**.

**Goal:** Close the product/UX gaps: a departing member's trashed album re-sharing on restore (M9,
MEDIUM), web link-list staleness (L9), always-failing affordances (L10), hardcoded English (L14),
missing album→space entry point (L15), invisible auto-unlink (L16), broken cover tiles (L17).

## Global Constraints (spec §0)

- TDD where server behavior changes. No co-author trailers. Per-half gates: server `pnpm check` +
  `pnpm lint` + `prettier --check`; web `pnpm check:typescript` + `check:svelte` + `pnpm lint` +
  `pnpm test`; mobile `dart analyze --fatal-infos lib test` + `flutter test`. i18n: add keys to
  `i18n/en.json` (repo root) only — other locales fall back (no machine translation). SDK regen only if
  a server DTO changes (none expected). Re-confirm lines.

---

## HALF A — Server (M9, L16, L17)

### M9 (MEDIUM) — departing member's TRASHED own album re-shares on restore

**File:** `server/src/repositories/shared-space.repository.ts` — `removeOwnedAlbumLinksAddedBy` (`:622`),
the `album.deletedAt IS NULL` filter at `:638`.
**Problem (verified):** `removeOwnedAlbumLinksAddedBy` unlinks a departing member's own albums but its
subquery filters `album.deletedAt IS NULL`, so a link to the member's **trashed** own album survives
departure. The soft-delete trigger keeps the `shared_space_album` row; a later restore re-creates grants
for current members → all of S's members regain the album. Deleting a trashed album's link on departure
is safe (grants already revoked by the soft-delete trigger; the delete-audit tombstone is idempotent).

- [ ] **Test (medium) RED:** member D links their own album into space S, **trashes** it, then leaves S;
      later D **restores** it → the album does NOT reappear for S's members and no grants exist (belongs in
      `shared-space-member-album-lifecycle.spec.ts`, which has zero trash coverage). RED today (the trashed
      link survives departure → restore re-shares).
- [ ] **Implement:** drop the `.where('album.deletedAt', 'is', null)` at `:638` from
      `removeOwnedAlbumLinksAddedBy` so it also removes links to the departing member's trashed own albums.
      Update the method's comment block. (The method now also takes a `trx` from Slice 8 — keep that.)
- [ ] `make sql` only if the decorated query doc changed (Docker scratch DB). Commit:
      `fix(spaces): unlink a departing member's trashed own albums too (M9)`

### L16 — auto-unlink on member departure is invisible

**File:** `server/src/services/shared-space.service.ts` — `cleanupDepartingMemberAlbums` (~`:564`), which
logs only `MemberLeave`/`MemberRemove` (`:581`/`:607`).

- [ ] **Implement:** `cleanupDepartingMemberAlbums` already returns the unlinked album ids — log one
      `SharedSpaceActivityType.AlbumUnlink` activity per auto-removed album (fallback name for deleted
      albums), so remaining members see which/why. (i18n copy for the leave-confirmation warning is in Half B.)
- [ ] **Test (unit/medium):** removing a member whose own album was linked → an `AlbumUnlink` activity is
      logged for it (in addition to `MemberRemove`).
- [ ] Commit: `feat(spaces): log AlbumUnlink for auto-removed departing-member albums (L16)`

### L17 — broken cover tile when the album cover is not space-visible

**File:** `server/src/repositories/shared-space.repository.ts` — `getLinkedAlbums` (`:646`), returns
`albumThumbnailAssetId` verbatim → the member's gated thumbnail request 403s → web renders BrokenAsset.
Persistent for a **Hidden** cover (stays in the album with `deletedAt NULL`).

- [ ] **Test (medium) RED:** a linked album whose cover asset is Hidden → `getLinkedAlbums` for a member
      returns a cover id that is space-visible (or null), NOT the Hidden cover. RED today.
- [ ] **Implement:** in `getLinkedAlbums`, substitute the cover per-viewer — COALESCE
      `albumThumbnailAssetId` only when it passes the flat `spaceVisibilityGate` + `deletedAt IS NULL`, else
      fall back to the newest space-visible album asset, else null (NoCover).
- [ ] `make sql` if the decorated query changed. Commit:
      `fix(spaces): per-viewer space-visible cover for linked albums (L17)`

**Half-A done:** M9/L16/L17 with tests; server gates green; `make sql` run/flagged; committed + pushed.

---

## HALF B — Web + Mobile + i18n (L9, L10, L14, L15)

### L9 (web) — `AlbumSharedSpaceLinks.svelte` snapshots links once → stale/wrong-target unlink

**File:** `web/src/lib/components/album-page/AlbumSharedSpaceLinks.svelte` (`let links = $state([...])` at
~`:17`). **Fix:** replace the snapshot with `$derived((album.sharedSpaceLinks ?? []).filter(l =>
!removed.has(l.spaceId)))` + a `removedSpaceIds` `$state` for optimistic unlink, and/or `{#key album.id}`
on the parent. **Test:** vitest/component test that navigating albums doesn't render the prior album's
links; unlink targets the correct `{spaceId, albumId}`.

### L10 (web) — global `/albums/:id` shows always-failing manage affordances to space-only readers

**File:** `web/src/routes/(user)/albums/[albumId=id]/.../+page.svelte` (~`:725`). **Fix:** gate the
"Set as album cover" MenuOption behind the existing `isEditor` derived (`+page.svelte:368`, = the
server's `AlbumUpdate` set — NOT `isOwned`, which would regress album editors). Optionally hide the two
selection-bar options when `!isAllUserOwned`. **Test:** the option is absent for a space-only reader.

### L15 (web + mobile) — no "link to a space" entry point from the album itself

**Files:** web album share/context menu + `web/src/lib/modals/SpaceLinkAlbumModal.svelte` (reuse if it
exists); mobile album options sheet + `mobile/lib/.../space_link_album.page.dart`. **Fix:** add a "Link to
space" option to the album share/context menu (web) and album options sheet (mobile) opening a space
picker (Owner/Editor spaces) → `PUT /shared-spaces/{id}/albums/{albumId}`. **Build minimally** — reuse
the existing space-picker + `linkAlbum` SDK call already used from inside a space; this is a second entry
point, not new backend. **Test:** the option renders on an owned album; picking a space calls
`linkAlbum`. (If a `SpaceLinkAlbumModal`/picker already exists, wire to it; do not build a new modal.)

### L14 (i18n) — album-in-space UI strings hardcoded English

**Files:** `web/src/lib/components/spaces/space-activity-feed.svelte` (~`:75`, raw template literals for
album*link/unlink/person*_ entries) + the mobile `mobile/lib/.../spaces/_`pages/widgets ('Link Albums',
'Add photos', 'Unlink from space', 'Albums (N)', '$count photos', …). **Fix:** add keys to`i18n/en.json`and route web strings through`$t`; use `.tr()`consistently on the mobile space-album
pages. Include the L16 leave-confirmation warning key ("albums you linked will be removed"), conditioned
on the leaver having such links, extending`spaces_leave_confirmation`. **English keys only** — other
locales fall back. Regenerate mobile localization (`dart run easy_localization:generate -S ../i18n`)
after adding keys. **Test:** `dart analyze`clean; web`check:svelte`clean; a couple of the routed
strings resolve via`$t`/`.tr()`.

**Half-B gates:** web `pnpm check:typescript` + `check:svelte` + `pnpm lint` + `pnpm test`; mobile
`dart analyze --fatal-infos lib test` + `flutter test` for touched files. Commit per finding (L9, L10,
L15, L14). No visual verification possible in this environment — rely on the static/unit gates + CI +
later manual review.

---

## Definition of done

- M9/L16/L17 (server) with TDD + green medium tests; L9/L10 (web) + L15 (web+mobile) + L14 (i18n) with
  green static/unit gates. All package gates + CI green. Commits pushed. L15 built minimally (flag to the
  controller if a design decision is needed). Scope-clean.
