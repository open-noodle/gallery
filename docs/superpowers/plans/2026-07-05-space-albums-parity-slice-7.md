# Space Albums Parity — Slice 7: E2E web journeys

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Playwright journeys covering the space Albums tab: search, sort, group + collapse, view toggle, create album (lands on the space album route), link existing, and viewer role gating.

**Architecture:** Extend the existing `e2e/src/specs/web/spaces-albums.e2e-spec.ts` (seeds a space with owner/editor/viewer + linked album). Add journeys that drive the fork controls by their `data-testid`s.

**Note on verification:** e2e requires the running e2e stack (`make e2e` / port 2285), which is not available in the unit dev loop. Write the specs faithfully against the real testids + existing patterns; they are verified on CI and fixed via `/babysit` if any timing/selector mismatch surfaces. Do NOT invent testids — read them from the fork components.

## Global Constraints

- Spec §8 Slice 7. Fork-only e2e file. Follow the existing spec's setup helpers (`utils.createSpace`, `addSpaceMember`, `createAlbum`, `linkSpaceAlbum`, `setAuthCookies`) and its role fixtures.
- Base: `4a84415f59`.

## Fork testids (read the components to confirm exact strings)

- Controls: `space-albums-search`, `space-albums-sort-btn`/`-sort-menu`/`-sort-option-{AlbumSortBy}`, `space-albums-group-btn`/`-group-menu`/`-group-option-{SpaceAlbumGroupBy}`, `space-albums-view-toggle`, `create-album-button`, `link-album-button`.
- List/cards: `space-album-card`, `space-album-card-link` (`/spaces/{id}/albums/{albumId}`), `space-album-group-{groupId}` (cover group header), `space-album-row-{albumId}` (list mode), `space-albums-no-results`.
- Empty state: `empty-state-message`, `empty-link-album-button`.

## File Structure

- Modify `e2e/src/specs/web/spaces-albums.e2e-spec.ts` (add a `describe` block of journeys). Seed several linked albums (varying names/asset counts) if the existing fixture only links one — add albums via `utils.createAlbum` + `utils.linkSpaceAlbum` in a `beforeAll`/`beforeEach` for the new block.

---

## Task 1: Add the journey specs

**Files:** `e2e/src/specs/web/spaces-albums.e2e-spec.ts`.

- [ ] **Step 1: Read the existing spec** to reuse its fixture setup (space id, owner/editor/viewer tokens, `page.goto('/spaces/${space.id}/albums')`, cookie auth per role) and match its style.

- [ ] **Step 2: Add journeys** (one `test(...)` each), seeding ≥3 linked albums with distinct names:
  - **Search:** type in `space-albums-search`; assert the visible `space-album-card` count drops to the matching album(s); clear → all return.
  - **Sort:** open `space-albums-sort-btn`, pick `space-albums-sort-option-Title`; assert the `space-album-card-link` href order changes accordingly.
  - **Group by:** open `space-albums-group-btn`, pick `space-albums-group-option-Year` (or `Owner`/`LinkedBy`); assert group headers (`space-album-group-*`) render; click a header to collapse and assert its cards hide.
  - **View toggle:** click `space-albums-view-toggle`; assert list-mode rows (`space-album-row-*`) appear and link to `/spaces/{id}/albums/{albumId}`.
  - **Create album (owner):** click `create-album-button`; assert navigation to `/spaces/{space.id}/albums/{newId}` (a new album route).
  - **Link existing (owner):** click `link-album-button`; assert the link modal opens (its existing testid/heading).
  - **Viewer gating:** as viewer, assert `create-album-button` and `link-album-button` are absent, but `space-albums-search`, `space-albums-sort-btn`, `space-albums-group-btn`, `space-albums-view-toggle` are present.

- [ ] **Step 3: Local sanity** (if the e2e stack is up): `cd e2e && pnpm test:web -- spaces-albums`. If the stack is NOT up, do NOT block — commit and rely on CI + `/babysit`. State clearly in the report whether they were run or only authored.

- [ ] **Step 4: Commit.**

```bash
git add e2e/src/specs/web/spaces-albums.e2e-spec.ts
git commit -m "test(spaces): e2e journeys for space albums (search/sort/group/view/create/link/viewer)"
```

## Slice 7 exit gate

- The journeys are authored against real testids and follow the existing spec's setup. Verified on CI (babysit).

## Self-review (author)

- Journeys cover search, sort, group+collapse, view toggle, create→space-route, link modal, viewer gating (spec §8 Slice 7) ✓; no invented testids (read from components) ✓.
