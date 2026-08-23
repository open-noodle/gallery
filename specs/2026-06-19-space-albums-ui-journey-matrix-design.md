# Space Albums — UI Journey & Permission Matrix (web e2e)

**Date:** 2026-06-19
**Branch:** `feat/space-albums-mobile`
**Status:** Design — awaiting implementation plan
**Scope:** Web (SvelteKit) Playwright e2e only. No production code changes.

## Problem

Server and API tests for shared spaces and space-linked albums are thorough and
green (`shared-space.service.spec.ts` ~497 tests, `shared-space.e2e-spec.ts`
~70 tests, `shared-space-album.e2e-spec.ts` ~45 tests). Permission **enforcement**
is well covered. Yet the web UI repeatedly feels broken: roles can't actually
click through to the albums shared with them.

The root cause is a test-design gap, not a logic gap: **every existing web
spec uses `page.goto('/spaces/:id/albums/...')` to jump straight to deep
URLs.** A `goto` bypasses the navigation chain entirely, so a dead sidebar
link, a mis-wired tab anchor, or a broken card `href` is invisible to the
test while being exactly what a user hits in the browser. The symptom lives
in the navigation wiring, which no current test exercises by clicking.

## Goal

One Playwright spec that walks the **real navigation chain by clicking** —
never `goto` to a deep URL — so broken menu wiring fails the test. Structured
as a matrix: rows = roles, columns = the journey hops (get into the spaces
menu → open the space → open the album shared with them → see the photos).

## Personas (matrix rows)

Maps to the code's `SharedSpaceRole` model plus a non-member.

- **Owner** — the space creator (the "admin" persona). Full control.
- **Editor** — space Editor; can add/remove photos, link/unlink albums.
- **Viewer** — space Viewer; read-only.
- **Stranger** — authenticated user who is not a space member.

## Fixture (one shared `beforeAll`)

Mirrors the proven setup in `spaces-albums.e2e-spec.ts`:

- `admin` (setup only), `owner`, `editor`, `viewer`, `stranger` users.
- One space owned by `owner`; `editor` added as `Editor`, `viewer` as
  `Viewer`; `stranger` is **not** added.
- Two assets owned by `owner`.
- One album `"Linked Album"` owned by `owner`, with `editor` added as album
  `Editor` (so `editor` satisfies the two-gate link rule: space Editor + album
  Editor), both assets attached.
- The album is linked into the space (`utils.linkSpaceAlbum`).

**Key invariant under test:** `viewer` has **no** `album_user` share on the
album. The viewer reaching the album and its photos therefore proves access
flows purely through the **space grant** — i.e. "an album shared with them via
the space," which is the exact behavior in question.

## The matrix

Each cell is reached by **clicking** the prior hop's element (not `goto`),
except where noted for the stranger.

For the **Stranger** column, `n/a` / `—` means the click-funnel is impossible
(no space card exists at hop 2); the stranger's actual coverage is the
deep-link probe list below the table, **not** "untested."

| Funnel hop (clicked, not goto)                      | Owner   | Editor  | Viewer     | Stranger      |
| --------------------------------------------------- | ------- | ------- | ---------- | ------------- |
| 1. Left-nav **Spaces** link → `/spaces`             | reach   | reach   | reach      | reach         |
| 2. `/spaces` list shows **the space**               | visible | visible | visible    | **absent**    |
| 3. Click space → space detail + role badge          | Owner   | Editor  | Viewer     | n/a (no card) |
| 4. Click **Albums** tab → `/spaces/:id/albums`      | reach   | reach   | reach      | —             |
| 5. Albums grid shows the **linked album** card      | visible | visible | visible    | —             |
| 6. Click album card → album detail (timeline loads) | reach   | reach   | reach      | —             |
| 7. Known asset thumb present → click → asset viewer | opens   | opens   | opens      | —             |
| 8. Gating @ grid: link-album button + card ⋮ menu   | visible | visible | **hidden** | —             |
| 9. Gating @ detail: add-photos control              | visible | visible | **hidden** | —             |

Hop 2 targets the view-agnostic `a[href$="/spaces/:id"]` anchor (rendered by
both the default `card` grid and the `list`/table view — `space-view.store.ts`
defaults to `card`, and Playwright contexts start with empty localStorage).
Hop 7 first asserts the known `[data-asset="<assetId>"]` thumbnail is present
(proving the album's own photos render), then clicks it. Hops 8–9 are asserted
**within** each member's journey test, since it is already on the page — this
folds the negative control-gating into the matrix.

**Members (Owner/Editor/Viewer):** one test each walks hops 1→7 by clicking,
asserting the URL/element produced at every hop, then asserts the role's
control gating (hops 8–9) on the pages it already loaded. This is the
positive, journey-first coverage plus the negative gating, in one pass.

**Stranger:** cannot click-funnel (no space card exists at hop 2), so its test
asserts:

1. The space card is **absent** from `/spaces`.
2. `expectBlockedAt` for each deep URL via `goto` — **all four depths**:
   - `/spaces/:id`
   - `/spaces/:id/albums`
   - `/spaces/:id/albums/:albumId`
   - `/spaces/:id/albums/:albumId/photos/:assetId`

   Blocked = 403 ∨ redirected away ∨ a blocked-text locator is visible,
   reusing the established pattern from `permission-matrix.e2e-spec.ts` Test 7.
   Hops 4/6/7 for the stranger are the genuinely **untested security cells**
   today (only `/spaces/:id` is currently covered).

## Control gating (matrix hops 8–9)

Gating is folded into each member's journey test rather than split into a
separate block, because the test is already on the relevant page. Per role:

- **Owner / Editor** — on the albums grid: `link-album-button` visible and the
  `space-album-card-menu` present; in album detail: `add-photos-button`
  visible.
- **Viewer** — all three **absent** (read-only).

This deliberately overlaps a little with the editor/viewer gating already in
`spaces-albums.e2e-spec.ts`, which is acceptable: it makes this matrix the
single, self-contained source of truth for "role X sees exactly these
controls." Gating that is **not** re-tested here (covered elsewhere, referenced
by comment): the asset detail-panel edit controls, the space delete menu, and
the `/photos` filter-panel / map behavior — all in
`permission-matrix.e2e-spec.ts`.

## In-file funnel helpers (DRY; no page-object module)

Small local helpers, not a separate page-object — consistent with the
suite's `utils` + inline-locator style. Each helper performs its click and
asserts the URL/element it produced:

- `gotoSpacesList(page)` — clicks the left-nav Spaces link
  (`page.locator('nav').getByRole('link', { name: 'Spaces' })`, the established
  `spaces-sidebar.e2e-spec.ts` pattern — no production change) and waits for
  `/spaces`.
- `openSpaceFromList(page, spaceId)` — clicks the view-agnostic
  `nav`-excluded `a[href$="/spaces/${spaceId}"]` anchor (rendered by both the
  default card grid and the table view) and waits for `/spaces/:id`. Also
  asserts the anchor exists (= the space is listed for this member).
- `openAlbumsTab(page, spaceId)` — clicks
  `[data-testid="space-tab-albums"]` and waits for `/spaces/:id/albums`.
- `openAlbumCard(page, name)` — clicks the
  `[data-testid="space-album-card-link"]` filtered by album name and waits for
  `/spaces/:id/albums/:albumId`.
- `openPhoto(page, assetId)` — asserts the known
  `[data-thumbnail-focus-container][data-asset="${assetId}"]` is present
  (proves the album's photo renders), clicks it, and waits for the
  `/photos/:assetId` URL + `#immich-asset-viewer`.
- `expectBlockedAt(page, url)` — `goto`s `url` and asserts
  403 ∨ redirected-away ∨ blocked-text (Test-7 pattern), for the stranger.
  Auth cookies are set once per test before the probes, so no `context` is
  needed here.

## Out of scope (YAGNI)

- **`showInTimeline=false` timeline exclusion** — a timeline-composition
  concern (already pinned on mobile in B6's regression test), not an access
  concern. Excluded to keep this spec focused on the stated goal. Easy to add
  later.
- **System-admin (`isAdmin`) persona and the admin-only Libraries tab**
  (`space-tabs.svelte:61`) — out of scope per the agreed persona set (space
  roles + stranger). A system admin who is not a space member has no special
  space access; if that ever needs proving, it is a separate row.
- **Recent-spaces sidebar dropdown** as an alternate entry to a space — the
  canonical menu path (left-nav Spaces → `/spaces` list → space) is the one
  under test; the dropdown is partially covered by `spaces-sidebar.e2e-spec.ts`
  and is a redundant route to the same destination.
- **Asset detail-panel edit controls, space delete menu, `/photos` filter
  panel and `/map`** — covered by `permission-matrix.e2e-spec.ts`; referenced,
  not duplicated.

## File & verification

- New file: `e2e/src/specs/web/spaces-albums-journey.e2e-spec.ts`.
- Imports: `@immich/sdk` (DTOs/enums), `@playwright/test`, `src/fixtures`
  (`createUserDto`), `src/utils` (`utils`, `asBearerAuth`).
- Verify: `cd e2e && pnpm test:web -- spaces-albums-journey` against a
  `make dev` stack on :2283 (or the `make e2e` stack), plus the e2e tsc check.
- Expected production code changes: **none**.

## Risks & mitigations

- **Thumbnail rendering races (hop 7).** The thumbnail focus container is
  present in the timeline regardless of generated-thumbnail state, so clicking
  it does not require draining the thumbnail queue; the existing
  `spaces-albums.e2e-spec.ts` photo-viewer tests rely on the same selector
  without a queue drain. If hop 7 proves flaky, drain
  `thumbnailGeneration` with the admin token in `beforeAll`.
- **List view shape (resolved).** The `/spaces` list renders as a card grid
  (`space-card`) or a table (`space-row`) per the persisted `spaceViewSettings`
  store. Both render an `a[href="/spaces/:id"]` for each space, and the store
  defaults to `card` with Playwright contexts starting from empty localStorage.
  `openSpaceFromList` therefore targets the `href` anchor (view-agnostic) so
  the test is correct regardless of which view is active.
- **Stranger deep-link semantics.** SvelteKit serves a 200 shell and renders
  the error client-side, so `response.status() === 403` may be false; the
  `expectBlockedAt` disjunction (403 ∨ redirect ∨ blocked-text) handles this,
  matching `permission-matrix.e2e-spec.ts` Test 7. All four stranger depths
  are blocked at the shared `[spaceId]` layout load, which throws 403 for
  non-members before any child route renders.
