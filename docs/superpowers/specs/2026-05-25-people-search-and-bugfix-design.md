# People Search AND Bugfix Design

Status: reviewed for TDD implementation planning; pending user approval
Date: 2026-05-25
Worktree: `/Users/pierre/dev/gallery/.worktrees/issue-628-people-search-and`
Branch: `fix/issue-628-people-search-and`
Issue: https://github.com/open-noodle/gallery/issues/628

## Problem

When a user selects two or more people in Gallery search/filter flows, results can include assets containing any selected person. Issue #628 reports that Immich returns photos containing all selected people, while Gallery returns photos containing either selected person.

This is a bugfix, not an OR/AND feature. The default meaning of multiple selected people should be "contains every selected person".

## Goals

- Make multi-person asset filtering use AND semantics by default.
- Preserve the existing explicit OR escape hatch where code already passes `personMatchAny`.
- Cover legacy user-person IDs, identity-group filters, and shared-space person filters.
- Avoid API, URL, SDK, or UI changes.
- Keep the fix server-side so every caller gets consistent behavior.

## Non-Goals

- Do not add a user-facing OR/AND toggle.
- Do not add a new DTO field or query parameter.
- Do not change tag, album, camera, location, rating, favorite, or media filters.
- Do not refactor unrelated search or timeline code.

## Current Behavior

The search repository already has both semantics:

- `hasPeople()` and `hasFaceIdentities()` require all selected people or identities.
- `hasAnyPerson()` and `hasAnyFaceIdentity()` match any selected person or identity.
- `searchAssetBuilder()` uses `personMatchAny` to choose OR, otherwise it uses AND for normal `personIds`.
- Smart search also defaults to one visible-face `EXISTS` predicate per selected person unless `personMatchAny` is set.

The inconsistent result path is timeline browsing. `AssetRepository.getTimeBuckets()` and `AssetRepository.getTimeBucket()` currently use the OR helpers for `personIds`, `identityIds`, and `spacePersonIds`. That means URLs such as `/photos?people=a,b` can show timeline results containing either person.

Shared-space person filters are also OR-only in the shared helper `hasAnySpacePerson()`. `searchAssetBuilder()` and smart-search facet filtering currently apply that helper whenever `spacePersonIds` are present. Search/filter suggestion queries have their own filtered-asset builder and also need the same default semantics so counts and suggestions do not describe an OR-filtered result set.

## Design

### Repository Semantics

Default people filters should be AND:

- `personIds`: use `hasPeople()`.
- `identityIds`: use `hasFaceIdentities()`.
- `spacePersonIds`: add and use a new `hasSpacePeople()` helper.

Each people-related ID list should be normalized to unique, truthy IDs before applying AND helpers. This avoids the existing `count(distinct ...) = ids.length` pattern turning duplicate URL or typed-search IDs into an impossible filter.

`hasSpacePeople()` should mirror the existing `hasSpacePerson()` predicate for each selected shared-space person and combine those predicates with `AND`. This avoids relying on grouping across `shared_space_person_face` joins and keeps the intended semantics easy to read.

Explicit OR should remain possible only through existing OR-specific helpers:

- `personMatchAny` continues to select OR matching in `searchAssetBuilder()`.
- When `personMatchAny` is set, `personIds`, `identityIds`, and `spacePersonIds` should all use their OR helpers.
- Existing callers that intentionally pass `personMatchAny: true` keep their behavior.

There is no new public API flag.

### Affected Query Paths

Update these paths to use default AND semantics:

- `searchAssetBuilder()` for `spacePersonIds`, while preserving `personMatchAny` OR behavior for all people-related filters.
- `SearchRepository.buildSmartFacetFilteredAssetIds()` for `spacePersonIds`.
- `SearchRepository.buildFilteredAssetIds()` for filter/search suggestion queries that apply `personIds` in either global or space scope.
- `AssetRepository.getTimeBuckets()` for `personIds`, `spacePersonIds`, and `identityIds`.
- `AssetRepository.getTimeBucket()` for `personIds`, `spacePersonIds`, and `identityIds`.

Metadata search and smart search already use AND for normal `personIds` and `identityIds`; they should be covered by regression tests and duplicate-ID normalization, not redesigned.

### Data Flow

The frontend continues to serialize selected people as it does today:

- Global photos filters put selected people in `personIds`.
- Space pages pass selected space people as `spacePersonIds`.
- Scoped tokens are resolved by service-layer logic into legacy person IDs, identity IDs, and/or space person IDs.

After resolution reaches repositories, each selected people-related ID narrows the candidate asset set.

Mixed resolved categories are cumulative. If a request resolves to `personIds`, `identityIds`, and `spacePersonIds`, an asset must satisfy every non-empty category unless the repository path was explicitly called with `personMatchAny`.

### Error Handling

No new error cases are introduced. Existing invalid-token, inaccessible-token, and empty-result behavior remains unchanged.

If a selected scoped person token resolves to an inaccessible person, existing `forceEmptyResult` behavior still applies.

## TDD Requirements

Implementation must follow red-green-refactor.

1. Write one failing test for the next behavior.
2. Run the narrow test command and confirm it fails for the expected OR-vs-AND reason.
3. Implement the smallest production change that makes that test pass.
4. Re-run the narrow test and keep it green.
5. Repeat for the next edge case.

Do not write production code for this bugfix before a failing test demonstrates the bug. Tests written after implementation are acceptable only as additional regression coverage, not as the first proof for a changed behavior.

### Testing

Add focused tests in this order:

1. `AssetRepository.getTimeBucket()` with three assets: person A only, person B only, and A+B. Filtering by `[A, B]` must return only A+B. This should fail against the current OR implementation.
2. `AssetRepository.getTimeBuckets()` with the same shape, using different bucket dates where useful, must count only assets that contain every selected person.
3. `AssetRepository.getTimeBucket()` with two selected `spacePersonIds` must return only assets containing both space people.
4. `AssetRepository.getTimeBucket()` with two selected `identityIds` must return only assets linked to both identities.
5. `SearchRepository.buildSmartFacetFilteredAssetIds()` through `searchSmartFacets()` must apply selected `spacePersonIds` as AND so facet totals match result semantics.
6. `SearchRepository.buildFilteredAssetIds()` through search/filter suggestion endpoints must apply selected people as AND in both global and space-scoped requests.
7. Duplicate IDs such as `[A, A]` must behave like `[A]`, not as an impossible two-person filter.
8. Existing explicit OR paths using `personMatchAny: true` must still return assets matching any selected `personIds`, `identityIds`, or `spacePersonIds`.
9. Existing inaccessible scoped-token tests must continue returning empty results through `forceEmptyResult`.

Coverage must include these edge cases:

| Edge Case                                               | Expected Behavior                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Empty or undefined people arrays                        | No people filter is applied.                                                                             |
| Single selected person                                  | Same results as today for visible, non-deleted faces.                                                    |
| Duplicate selected IDs                                  | Deduplicate before applying AND.                                                                         |
| Multiple visible faces for the same person on one asset | Counts as satisfying that one selected person once.                                                      |
| Hidden or deleted faces                                 | Do not satisfy any people filter.                                                                        |
| One selected person has no visible matching face        | Result set is empty unless another OR path was explicitly requested.                                     |
| Mixed `personIds`, `identityIds`, and `spacePersonIds`  | Asset must satisfy every non-empty category by default.                                                  |
| `personMatchAny: true`                                  | Preserve intentional OR behavior for every people-related ID category in `searchAssetBuilder()` callers. |
| Shared-space timeline opt-out or inaccessible token     | Existing access filtering and `forceEmptyResult` behavior wins.                                          |
| Pagination, ordering, and bucket grouping               | Existing order and grouping behavior stays unchanged after the narrower filter is applied.               |

Suggested verification commands:

```bash
pnpm --filter immich test:medium -- asset.repository.spec.ts search.service.spec.ts people-identity-rbac.spec.ts
pnpm --filter immich test -- search.repository.spec.ts timeline.service.spec.ts shared-space.service.spec.ts search.service.spec.ts
```

The exact narrow commands can be adjusted to match Vitest file filtering, but every new failing test must be run alone or in a small focused group before production code changes.

## Implementation Notes

The likely implementation is small:

1. Add `hasSpacePeople()` in `server/src/utils/database.ts`.
2. Normalize people-related ID arrays before count-based AND comparisons.
3. Replace default timeline `hasAnyPerson()` calls with `hasPeople()`.
4. Replace default timeline `hasAnyFaceIdentity()` calls with `hasFaceIdentities()`.
5. Replace default `spacePersonIds` filters with `hasSpacePeople()`.
6. Teach `searchAssetBuilder()` to honor `personMatchAny` for `identityIds` and `spacePersonIds`, preserving internal OR callers.
7. Update smart-facet and suggestion filtering to use default AND semantics.
8. Add the red-first tests listed above.

No generated OpenAPI or SDK updates are expected.
