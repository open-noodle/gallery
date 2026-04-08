# T03 — Timeline `/buckets` & `/bucket` Access Matrix

**Backlog row:** [T03 in 2026-04-06-e2e-coverage-backlog.md](./2026-04-06-e2e-coverage-backlog.md)
**Type:** Design (validates the helper API and sets the test pattern for T04–T39)
**Status:** draft
**Blocked by:** T02

## Goal

Create `e2e/src/specs/server/api/timeline.e2e-spec.ts` and cover the **access matrix** for `GET /timeline/buckets` and `GET /timeline/bucket` — the two endpoints that drive every timeline render in the web app and have **zero** current coverage.

This task is deliberately scoped to access only. Filter passthrough (T06), `withSharedSpaces` semantics (T04), and visibility filters (T05) are separate tasks so this PR stays small enough to be the second-ever consumer of the helpers and shake out any rough edges.

## Why this is the first real consumer

T02 (helpers) is unblocked work. T03 is the first PR that **uses** the helpers in earnest. Choosing it as #2 in the rollout serves three purposes:

1. **Validates the helper API.** If `forEachActor` is awkward to call against a real endpoint, we find out before 25 downstream PRs inherit the awkwardness.
2. **Catches the highest-impact bug class.** Most fork-recurring bugs (memory: PRs #163, #196, #200, #202, #260, #275, #276) are timeline / search scoping bugs. The first real test PR should probe that surface.
3. **Sets the template.** Every later spec file follows the same shape: `beforeAll` → `buildSpaceContext` → one `describe` per endpoint → `forEachActor` per access concern.

## Endpoints under test

| Method | Path                | Permission                                | Notes                                                              |
| ------ | ------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| `GET`  | `/timeline/buckets` | `Permission.AssetRead` (sharedLink: true) | Returns time-bucketed asset counts. Used by the timeline scrubber. |
| `GET`  | `/timeline/bucket`  | `Permission.AssetRead` (sharedLink: true) | Returns asset list for a single bucket. Used by the timeline grid. |

Buckets are always monthly — there is no `size` query parameter.

Query parameters from `server/src/dtos/time-bucket.dto.ts`:

- Singular: `userId`, `albumId`, `spaceId`, `personId`, **`spacePersonId`**, `tagId`
- Multi-value (OR semantics): `personIds`, **`spacePersonIds`**, `tagIds`
- Booleans: `isFavorite`, `isTrashed`, `withStacked`, `withPartners`, `withSharedSpaces`, `withCoordinates`
- Enums: `order` (`ASC`/`DESC`), `visibility` (`TIMELINE`/`ARCHIVE`/`HIDDEN`/`LOCKED`), `type` (`IMAGE`/`VIDEO`)
- BBox: `bbox`
- EXIF: `city`, `country`, `make`, `model`, `rating`, `takenAfter`, `takenBefore`

**`spacePersonId` and `spacePersonIds` are dedicated DTO fields** — distinct from `personId`/`personIds`. The fork's PR #260 bug was matching a global `personId` against a `shared_space_person.id`. T03 doesn't probe this directly (deferred to T06) but the param list documents it so T06 doesn't have to re-research the DTO shape.

`/timeline/bucket` extends `TimeBucketDto` with one extra required field: `timeBucket` (string, format `YYYY-MM-DD`).

## Test cases in this PR

All assertions go through `forEachActor`. The fixture work happens once in `beforeAll`.

### Setup (`beforeAll`)

```ts
ctx = await buildSpaceContext();
// ctx.spaceOwner owns ownerAssetId (NOT in space) and spaceAssetId (IN space)
// ctx.spaceEditor owns editorAssetId (NOT in space)
// ctx.spaceViewer owns no assets
// ctx.spaceNonMember owns no assets
```

The fixture shape is exactly what `buildSpaceContext` returns. **No partner setup in this PR** — the partner-share test was deferred (see "What is NOT in this PR" below).

### `describe('GET /timeline/buckets')`

1. **Auth required**.

   ```ts
   forEachActor([anonActor, ctx.spaceOwner], req('/timeline/buckets'), { anon: 401, spaceOwner: 200 });
   ```

2. **Owner sees own assets without filter.** Asserts the bucket count includes `ownerAssetId`.

3. **`spaceId` access matrix — status codes** — the core of this PR.

   ```ts
   forEachActor(
     [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anonActor],
     req(`/timeline/buckets?spaceId=${ctx.spaceId}`),
     { spaceOwner: 200, spaceEditor: 200, spaceViewer: 200, spaceNonMember: 400, anon: 401 },
   );
   ```

4. **`spaceId` returns only space-scoped assets for owner.** When called by `spaceOwner` with `spaceId=`, the bucket should include `spaceAssetId` but **not** `ownerAssetId` (which is owned by the same user but not in the space).

5. **Non-owner members actually see space content via `spaceId`.** When `spaceEditor` and `spaceViewer` (who own no assets in the space themselves) call `/timeline/buckets?spaceId=`, the response is non-empty AND includes `spaceAssetId`. Status alone is not enough — this is the assertion that probes the PR #163 / #202 bug shape where the access check passed but the query still scoped to `auth.user.id` instead of the space.

6. **`spaceNonMember` cannot see space assets even by id.** When called with `spaceId=` of a space they're not in, returns **400** (not 403, not an empty list). Reason: `timeline.service.ts:79` uses `requireAccess({ permission: SharedSpaceRead, ids: [spaceId] })`, which routes through `src/utils/access.ts:37-42` and throws `BadRequestException`. This is a deliberate Immich-wide pattern: bulk access checks return 400, not 403, to avoid leaking existence. The shared-space controllers are an exception — they use `requireMembership` and return 403. Tests in T07/T15/T09 will use 403; timeline tests use 400.

### `describe('GET /timeline/bucket')`

Same matrix as `/buckets`, but for the singular endpoint:

7. **Auth required.**
8. **`spaceId` access matrix** — identical to test 3 above. The risk being probed: forgetting to apply the same scoping check to the singular endpoint. This bug shape appears in PR #260's pattern.
9. **Non-owner member sees space asset via singular `/bucket`.** Same content assertion as test 5 above, against the singular endpoint. Pairs with test 8.
10. **Returns assets in the bucket, not counts.** Sanity check that `/bucket` returns the asset array (vs `/buckets` returning bucket metadata).

### Total

~10 tests. ~250-300 lines. One file, one `beforeAll`, two `describe` blocks.

## What is NOT in this PR

These are deliberately deferred to keep the first real consumer small:

- **`withSharedSpaces` semantics** — T04. Includes the `showInTimeline` interaction.
- **Visibility filters** (`Timeline`/`Archive`/`Hidden`/trash) — T05.
- **Filter passthrough with `spaceId`** (`spacePersonId`, `personId`-vs-`spacePersonId` mismatch, `tagIds`, country/city/make/model/rating combined with `spaceId`) — T06. This is where the PR #260 bug shape is fully probed; we get a foothold here with test 5 above and expand in T06.
- **Partner asset visibility** (`withPartners=true`). Requires a `partner` actor that doesn't exist in T02 yet — adding it would inflate this PR. Lands as part of T04 (which also extends `buildSpaceContext` with the partner actor when needed).
- **API key auth coverage**. `apiKeyLow`/`apiKeyEmpty` actors aren't in T02 yet. Add when the first task that genuinely needs them lands.
- **Shared link access.** `sharedLink: true` is set on the controller, but no current frontend uses timeline via shared links. Skip until a real consumer exists.
- **Stacked asset visibility** (`withStacked`). Not access-related. Skip.
- **`albumId` access.** Album scoping is pure upstream Immich behaviour, unchanged by the fork. Covered by `album.e2e-spec.ts`. Out of scope for fork-focused work.
- **EXIF filters with no `spaceId`.** Already covered in `search.e2e-spec.ts:711` (the only existing timeline coverage).

## Open implementation questions (decide during PR)

1. **Empty bucket vs missing bucket.** When `spaceOwner` calls with `spaceId=` and the space has no assets in a given month, does the response omit the bucket or include it with `count=0`? Doesn't affect access, but the assertion needs to pin behaviour either way. Confirm during writing.

## Risks

| Risk                                                                                                                           | Mitigation                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Helper API (`forEachActor`) turns out to be awkward when wired to real supertest calls.                                        | This PR is the validation. If awkward, fix in T02 before merging T03 — block T03 on the fix, not the other way round.                                               |
| Timeline behaviour differs subtly from the research doc's claims (e.g. `requireMembership` not actually called for `/bucket`). | The test will catch the discrepancy. Document the actual behaviour in the PR description and update the research doc if needed.                                     |
| Test cases overlap with existing `search.e2e-spec.ts:711` EXIF tests.                                                          | Acceptable overlap is none — that block tests filter passthrough only, not access. If during writing we find duplication, delete the duplicate from the older spec. |
| 30-test PR balloons because `forEachActor` ends up needing per-call wrappers.                                                  | Cap this PR at 12 tests. If we need more, split into T03a and T03b before merging.                                                                                  |

## Definition of done

- [ ] `e2e/src/specs/server/api/timeline.e2e-spec.ts` created.
- [ ] All tests pass locally and in CI.
- [ ] PR description links to this design doc and to the research doc §4 timeline section.
- [ ] Backlog row T03 ticked with the PR number.
- [ ] If implementation surfaces a real architectural decision (e.g. helper API change), append it to the Decision Log in the backlog doc.
