# Shared Spaces Mobile-Web Parity — Review Checklist

## Summary of Changes

This branch (`claude/mobile-web-parity-W5rzC`) adds missing shared spaces functionality to bring the mobile app closer to feature parity with the web UI. Changes span the server, OpenAPI spec, generated clients, and mobile Flutter code.

---

## Server Changes

### New endpoint: `GET /shared-spaces/:id/map-markers`
- **File:** `server/src/controllers/shared-space.controller.ts` — new route handler
- **File:** `server/src/services/shared-space.service.ts` — `getMapMarkers()` service method
- **File:** `server/src/repositories/shared-space.repository.ts` — `getMapMarkers()` query
- **File:** `server/src/queries/shared.space.repository.sql` — auto-generated SQL docs

### Search infrastructure: `spaceId` filter
- **File:** `server/src/dtos/search.dto.ts` — added `spaceId` to `MetadataSearchDto`, `SmartSearchDto`, `RandomSearchDto`, `StatisticsSearchDto`
- **File:** `server/src/repositories/search.repository.ts` — applies `spaceId` filter via `withSpaceId()` helper
- **File:** `server/src/utils/database.ts` — `withSpaceId()` Kysely helper for subquery filtering

### Server tests added
- **File:** `server/src/services/shared-space.service.spec.ts` — tests for `getMapMarkers()`
- **File:** `server/src/services/search.service.spec.ts` — tests for `spaceId` filtering in search

### Items to verify
- [ ] `make check-server` passes (TypeScript type check)
- [ ] `make lint-server` passes
- [ ] `cd server && pnpm test` passes (unit tests)
- [ ] `cd server && pnpm test:medium` passes (medium tests with DB)
- [ ] New `getMapMarkers` endpoint returns correct data for spaces the user belongs to
- [ ] `spaceId` search filter correctly restricts results to assets in the given space

---

## OpenAPI / SDK Changes

### Regenerated specs and clients
- **File:** `open-api/immich-openapi-specs.json` — new `getMapMarkers` operation, `spaceId` params in search DTOs, `updateMemberTimeline` and `updateSpace` operations
- **File:** `open-api/typescript-sdk/src/fetch-client.ts` — TypeScript SDK updated
- **File:** `mobile/openapi/lib/api/shared_spaces_api.dart` — Dart client updated
- **File:** `mobile/openapi/lib/api/search_api.dart` — Dart client updated with `spaceId`
- **File:** `mobile/openapi/lib/model/` — Several DTOs updated

### Items to verify
- [ ] `make open-api` regeneration is idempotent (running it again produces no diff)
- [ ] TypeScript SDK builds: `make build-sdk`

---

## Mobile (Flutter/Dart) Changes

### Repository layer
- **File:** `mobile/lib/repositories/shared_space_api.repository.dart`
  - Added `updateMemberTimeline()` — toggles timeline visibility for current user
  - Added `update()` — updates space name/description
  - Added `getSpaceAssets()` — fetches all assets in a space via the timeline API
  - Added `addAssets()`, `removeAssets()`, `addMember()`, `removeMember()`, `updateMember()`

### Providers
- **File:** `mobile/lib/providers/shared_space.provider.dart`
  - Added `spaceAssetsProvider` — fetches assets for a space
  - Added `sharedSpaceMembersProvider` — fetches members for a space

### UI Pages
- **File:** `mobile/lib/pages/library/spaces/space_detail.page.dart`
  - Rewritten with timeline-based asset grid display
  - Role-based actions (edit, delete, manage members)
  - Timeline visibility toggle in app bar
  - Space info section (name, description, member count, asset count)
  - Pull-to-refresh support

- **File:** `mobile/lib/pages/library/spaces/spaces.page.dart`
  - Added asset count display on space list items

- **File:** `mobile/lib/pages/library/spaces/space_members.page.dart` (new)
  - Full member management page with role editing and removal

- **File:** `mobile/lib/pages/library/spaces/space_member_selection.page.dart` (new)
  - User picker for adding new members to a space

### Widgets
- **File:** `mobile/lib/widgets/asset_grid/remove_from_space_action_button.widget.dart` (new)
  - Action button for removing selected assets from a space

- **File:** `mobile/lib/widgets/common/bottom_sheet/space_bottom_sheet.widget.dart` (new)
  - Bottom sheet with space actions (edit, manage members, leave/delete)

### Navigation
- **File:** `mobile/lib/routing/router.dart` — registered `SpaceMembersRoute` and `SpaceMemberSelectionRoute`
- **File:** `mobile/lib/routing/router.gr.dart` — auto-generated route definitions

### Action service
- **File:** `mobile/lib/services/action.service.dart` — added `removeFromSpace()` action
- **File:** `mobile/lib/providers/infrastructure/action.provider.dart` — registered action provider

### Mobile tests
- **File:** `mobile/test/modules/spaces/shared_space_api_repository_test.dart` (new, 511 lines)
  - Tests for all repository methods: getAll, get, create, delete, getMembers, addMember, removeMember, updateMember, addAssets, removeAssets, updateMemberTimeline, update, getSpaceAssets

- **File:** `mobile/test/modules/spaces/shared_space_provider_test.dart` (new, 143 lines)
  - Tests for all providers: sharedSpacesProvider, sharedSpaceProvider, sharedSpaceMembersProvider, spaceAssetsProvider

- **File:** `mobile/test/services/action.service_test.dart` — added `removeFromSpace` action test

### Items to verify
- [ ] `cd mobile && flutter analyze` passes (no Dart analysis errors)
- [ ] `cd mobile && flutter test` passes (all unit tests)
- [ ] `cd mobile && flutter test test/modules/spaces/` passes (space-specific tests)
- [ ] Space detail page renders correctly on device/emulator
- [ ] Timeline grid shows assets belonging to the space
- [ ] Timeline visibility toggle works (app bar icon)
- [ ] Space info section displays correct member/asset counts
- [ ] Member management page shows all members with roles
- [ ] Adding/removing members works end-to-end
- [ ] Role editing works (owner can change viewer to editor, etc.)
- [ ] Remove-from-space action works in multi-select mode
- [ ] Pull-to-refresh reloads space data
- [ ] Navigation between pages works (back button, deep links)

---

## Documentation (for reference only)
- `docs/plans/2026-03-06-shared-spaces-mobile-design.md`
- `docs/plans/2026-03-06-shared-spaces-mobile-plan.md`
- `docs/plans/2026-03-06-shared-spaces-phase1-completion-design.md`
- `docs/plans/2026-03-06-shared-spaces-phase1-completion-plan.md`

---

## Quick Verification Commands

```bash
# Server
make check-server && make lint-server && cd server && pnpm test

# Web/SDK
make build-sdk

# OpenAPI idempotency
make open-api && git diff --exit-code

# Mobile (requires Flutter SDK)
cd mobile && flutter analyze && flutter test

# E2E (requires running stack)
make e2e && cd e2e && pnpm test
```
