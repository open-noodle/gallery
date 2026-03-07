# FE/BE Testing — Review Checklist

Branch: `claude/plan-fe-be-testing-b1UPO`

## Summary of Changes

### 3 Commits Added

| Commit | Description |
|--------|-------------|
| `8aaaa22` | feat(e2e): add FE/BE integration testing with fast local feedback loop |
| `9cf35b1` | feat(e2e): add comprehensive e2e tests for spaces, favorites, trash, archive, tags, and explore |
| `e55e43c` | feat(e2e): add e2e tests for locked folder, people, map, folders, sharing, and user settings |

### Files Changed

| File | Type | Description |
|------|------|-------------|
| `Makefile` | Modified | Added `e2e-integration-dev` and `e2e-integration-dev-ui` targets |
| `e2e/package.json` | Modified | *(if any deps added)* |
| `e2e/playwright.config.ts` | Modified | Added `integration` project pointing to `src/specs/integration/` |
| `e2e/src/utils.ts` | Modified | *(if utility functions added)* |

### New Test Files — Web E2E (12 files)

| File | Tests | What It Covers |
|------|-------|----------------|
| `e2e/src/specs/web/spaces.e2e-spec.ts` | 10 | Create/delete spaces, member access, timeline toggle, asset counts, members modal |
| `e2e/src/specs/web/favorites.e2e-spec.ts` | 3 | Empty state, favorited asset visibility, non-favorited exclusion |
| `e2e/src/specs/web/trash.e2e-spec.ts` | 3 | Page load, trashed asset visibility, timeline exclusion |
| `e2e/src/specs/web/archive.e2e-spec.ts` | 3 | Page load, archived asset visibility, timeline exclusion |
| `e2e/src/specs/web/tags.e2e-spec.ts` | 2 | Page load, tagged asset accessibility |
| `e2e/src/specs/web/explore.e2e-spec.ts` | 2 | Explore page load, places page load |
| `e2e/src/specs/web/locked.e2e-spec.ts` | 4 | Page load, locked asset visibility, timeline exclusion, empty state |
| `e2e/src/specs/web/people.e2e-spec.ts` | 5 | Page load, empty state, API-created person visibility, navigation, show/hide toggle |
| `e2e/src/specs/web/sharing.e2e-spec.ts` | 5 | Page load, empty state, partner visibility, shared links page, shared link listing |
| `e2e/src/specs/web/map.e2e-spec.ts` | 1 | Map page load |
| `e2e/src/specs/web/folders.e2e-spec.ts` | 1 | Folders page load |
| `e2e/src/specs/web/user-settings.e2e-spec.ts` | 2 | Page load, settings sections visibility |

### New Test Files — Integration (5 files)

| File | Tests | What It Covers |
|------|-------|----------------|
| `e2e/src/specs/integration/auth-flow.e2e-spec.ts` | 4 | Admin registration, invalid login, logout redirect, unauthenticated redirect |
| `e2e/src/specs/integration/asset-upload.e2e-spec.ts` | 3 | Asset in timeline, metadata detail view, delete flow |
| `e2e/src/specs/integration/album-management.e2e-spec.ts` | 4 | Create album, add asset, rename album, API-created album visibility |
| `e2e/src/specs/integration/search.e2e-spec.ts` | 3 | Search page load, empty results, explore categories |
| `e2e/src/specs/integration/navigation.e2e-spec.ts` | 3 | Sidebar navigation, admin settings access, server info page |

**Total new tests: ~57 across 17 new files**

---

## What to Verify

### 1. Linting & Formatting (Quick, Local)

```bash
cd e2e && npx eslint src/specs/web/spaces.e2e-spec.ts src/specs/web/favorites.e2e-spec.ts src/specs/web/trash.e2e-spec.ts src/specs/web/archive.e2e-spec.ts src/specs/web/tags.e2e-spec.ts src/specs/web/explore.e2e-spec.ts src/specs/web/locked.e2e-spec.ts src/specs/web/people.e2e-spec.ts src/specs/web/sharing.e2e-spec.ts src/specs/web/map.e2e-spec.ts src/specs/web/folders.e2e-spec.ts src/specs/web/user-settings.e2e-spec.ts src/specs/integration/*.e2e-spec.ts
```

```bash
cd e2e && npx prettier --check src/specs/web/*.e2e-spec.ts src/specs/integration/*.e2e-spec.ts
```

### 2. Run Web E2E Tests (Requires E2E Stack)

```bash
make e2e                       # Start the E2E Docker stack
cd e2e && pnpm test:web        # Run all web e2e tests (includes new ones)
```

To run only the new tests:
```bash
cd e2e && pnpm exec playwright test --project=web src/specs/web/spaces.e2e-spec.ts
cd e2e && pnpm exec playwright test --project=web src/specs/web/favorites.e2e-spec.ts
# ... etc for each file
```

### 3. Run Integration Tests Against Dev Stack

```bash
make dev                       # Start the dev Docker stack
make e2e-integration-dev       # Run integration tests against localhost:2283
make e2e-integration-dev-ui    # Same but with Playwright UI for debugging
```

### 4. Spaces-Specific Checks

The spaces tests are the most complex. Verify:
- [ ] Space creation via UI (fills form, submits, checks redirect/listing)
- [ ] Space deletion (owner-only, confirmation dialog)
- [ ] Member access control (non-owner cannot see delete button)
- [ ] Member can view a space they're added to
- [ ] Members modal opens and shows member list
- [ ] Timeline visibility toggle works
- [ ] Asset count displays correctly after adding assets via API

### 5. Check for Flaky Tests

These patterns may need adjustment depending on environment timing:
- **WebSocket wait patterns** — tests using `utils.connectWebsocket()` and waiting for `on_asset_upload` events
- **Page navigation timing** — tests that click links and assert content on the next page
- **API-then-UI patterns** — tests that create data via API then check the web UI (may need page reload)

### 6. Existing Tests Still Pass

Confirm the existing web e2e tests were not broken:
```bash
cd e2e && pnpm exec playwright test --project=web src/specs/web/auth.e2e-spec.ts
cd e2e && pnpm exec playwright test --project=web src/specs/web/album.e2e-spec.ts
cd e2e && pnpm exec playwright test --project=web src/specs/web/shared-link.e2e-spec.ts
```

### 7. Playwright Config

- [ ] The `integration` project was added correctly to `e2e/playwright.config.ts`
- [ ] It points to `./src/specs/integration` with `workers: 1`
- [ ] It does not interfere with existing `web` project configuration

### 8. Makefile Targets

- [ ] `make e2e-integration-dev` runs integration tests against `http://127.0.0.1:2283`
- [ ] `make e2e-integration-dev-ui` opens Playwright UI mode
- [ ] Both set `PLAYWRIGHT_DISABLE_WEBSERVER=1` to skip starting the built-in server

---

## Architecture Notes

- **Web E2E tests** (`e2e/src/specs/web/`) follow the existing pattern: `test.beforeAll` for setup, `utils.initSuite()` for auth, Playwright page interactions
- **Integration tests** (`e2e/src/specs/integration/`) are designed to run against `make dev` for a fast local feedback loop without needing the full E2E Docker stack
- All tests use the existing `utils` module from `e2e/src/utils.ts` for admin login, user creation, asset uploads, and websocket connections
- Tests that modify asset visibility (archive, trash, locked) use the `@immich/sdk` directly to set up state, then verify the web UI reflects it
