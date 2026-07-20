# Per-user favorites — Slice 2 (write path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any user who can **read** an asset can favorite it for themselves, and no user can alter anyone else's favorite. This is the #763 capability at the API layer.

**Architecture:** A canonical `PUT /assets/favorites` guarded by `Permission.AssetRead` writes `asset_favorite` rows for `auth.user.id` only. The existing `UpdateAssetDto.isFavorite` / `AssetBulkUpdateDto` fields become a **deprecated alias** routing into the _same_ service method behind the stricter `Permission.AssetUpdate` route guard — a second door to one room, structurally incapable of being more permissive.

**Tech Stack:** NestJS 11, Kysely, Zod DTOs (`createZodDto`), Vitest (unit + medium), e2e (vitest), `make open-api`.

**Spec:** `docs/superpowers/specs/2026-07-20-per-user-favorites-design.md` §5.1, §8.1, slice 2. Edge cases E2–E9, E17, E18, E27, E28.

## Global Constraints

- Scoped test commands — `pnpm test -- --run <path>` and `pnpm test:medium -- --run <path>` both silently DROP the path filter:
  - unit: `cd server && npx vitest --config test/vitest.config.mjs run <path>`
  - medium: `cd server && npx vitest --config test/vitest.config.medium.mjs run <path> --maxWorkers=2`
- **Run medium suites with `--maxWorkers=2`** — default parallelism exhausts the PG pool and yields spurious `too many clients already`.
- **NEVER run `make sql` or `node dist/bin/sync-sql.js`.** It truncates all 38 files in `server/src/queries/` _before_ connecting and hangs forever if the DB is unreachable. It has destroyed that directory twice already. Report stale snapshots; do not regenerate.
- `make open-api` **is** required in this slice (new endpoint). It is a different tool from `make sql` and is safe. TS-only regeneration leaves the Dart client stale and fails CI — run the full `make open-api`.
- No relative imports in `server/`; `src/` alias. Prettier 120 cols. eslint `--max-warnings 0`.
- No `Co-Authored-By` / `Generated-with` trailers.
- `asset.isFavorite` the column must still exist (dropped in slice 3). This slice stops _writing_ it.
- Do not touch `sync.repository.ts` beyond what exists (slice 6), the `timeline.service.ts` guards (slice 4), web, or mobile.

## Known baselines

- unit **5099 passed / 9 skipped**; medium **137 files / ~1978 passed** at `--maxWorkers=2`.
- **Two pre-existing flakes**, both the same bug — `toEqual([...])` asserting a fixed order on rows created in the same clock tick, streamed by same-tick UUIDv7 `updateId`: `sync-partner.spec.ts` and `sync-album-user.spec.ts`. Verified present at prior commits. If one fails, re-run in isolation, confirm, and report — do **not** fix here.
- **Stale SQL snapshots carried from slice 1b** (report only): `search.repository.sql`, `view.repository.sql` genuinely stale; `asset/memory/stack` missing new example variants.

---

### Task 1: `AssetFavoriteRepository`

Slice 0 deliberately deferred the repository — it would have been dead code. The write path needs it now.

**Files:**

- Create: `server/src/repositories/asset-favorite.repository.ts`
- Modify: `server/src/services/base.service.ts` — **THREE sites**
- Modify: `server/test/medium.factory.ts` — the `newRealRepository` switch
- Test: `server/test/medium/specs/repositories/asset-favorite.repository.spec.ts` (extend)

**Interfaces:**

- Consumes: `asset_favorite` table (slice 0).
- Produces: `AssetFavoriteRepository` with
  `addAll(userId: string, assetIds: string[]): Promise<void>` and
  `removeAll(userId: string, assetIds: string[]): Promise<void>`. Task 2 calls these.

- [ ] **Step 1: Write the failing medium test**

Append to the existing spec:

```ts
describe('AssetFavoriteRepository', () => {
  it('addAll creates one row per asset for the given user', async () => {});

  it('addAll is idempotent — re-adding an existing favorite is a no-op, not a 500', async () => {
    // onConflict do nothing.  (E8)
  });

  it('removeAll deletes only the given users rows', async () => {
    // userA and userB both favorited assetX; removeAll(userA, [assetX])
    // -> userB row survives.  (E2)
  });

  it('removeAll on a never-favorited asset is a no-op', async () => {
    // (E9)
  });

  it('addAll with an empty id list does nothing and does not throw', async () => {});
});
```

- [ ] **Step 2: Run to verify red**

```bash
cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset-favorite.repository.spec.ts --maxWorkers=2
```

Expected: FAIL — repository does not exist.

- [ ] **Step 3: Implement the repository**

Model it on an existing simple repository — read `server/src/repositories/album-user.repository.ts` first and mirror its class shape, `@Injectable()`, constructor `@InjectKysely() private db: Kysely<DB>`, and `@GenerateSql` usage. `addAll` uses `.onConflict((oc) => oc.doNothing())`. Both methods early-return on an empty `assetIds`.

- [ ] **Step 4: Register in `BaseService` — all THREE sites**

`server/src/services/base.service.ts` requires the repository at **three** places: the import, the constructor parameter list, **and the `static create()` positional argument list**. Missing the third silently shifts every later repository — the failure surfaces only in medium tests, as a confusing unrelated error. Add all three, and keep the positional order identical between the constructor and `create()`.

Also add the class to the `newRealRepository` switch in `server/test/medium.factory.ts`, or medium tests fail with "Unable to create repository instance".

- [ ] **Step 5: Run to verify green**

The spec from Step 1, **plus** the full medium suite — the `BaseService` positional hazard is only detectable there:

```bash
cd server && npx vitest --config test/vitest.config.medium.mjs run --maxWorkers=2
```

Expected: 137 files, no new failures (the two known sync flakes aside).

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/asset-favorite.repository.ts server/src/services/base.service.ts server/test/medium.factory.ts server/test/medium/specs/repositories/asset-favorite.repository.spec.ts
git commit -m "feat(favorites): add AssetFavoriteRepository (#763)"
```

---

### Task 2: Canonical endpoint + deprecated alias

**Files:**

- Modify: `server/src/dtos/asset.dto.ts` — new `AssetFavoriteUpdateDto`; mark `isFavorite` deprecated on the two existing schemas
- Modify: `server/src/controllers/asset.controller.ts` — new route
- Modify: `server/src/services/asset.service.ts` — new method; `update`/`updateAll` reroute; remove `isFavorite` from the column write at `:341`
- Test: `server/src/services/asset.service.spec.ts`, `e2e/src/specs/server/api/asset-favorite.e2e-spec.ts` (new)

**Interfaces:**

- Consumes: `AssetFavoriteRepository.addAll` / `removeAll` from Task 1.
- Produces: `PUT /assets/favorites` accepting `{ ids: string[], isFavorite: boolean }`. Slice 5 (web) and slice 6 (mobile) call this endpoint.

- [ ] **Step 1: Write the failing e2e tests**

Create `e2e/src/specs/server/api/asset-favorite.e2e-spec.ts`. Space S; Alice owns asset X in S; Bob is a **viewer** of S; Carol is a non-member.

```
- Bob (VIEWER) PUT /assets/favorites {ids:[X], isFavorite:true} -> 200/204,
  Bob sees isFavorite true, Alice's view of X unchanged                      (E3)
- Alice unfavorites X -> Bob still sees true                                 (E2)
- Carol (non-member) -> 403, no row                                          (E5)
- shared-link session -> rejected, no row created for the link owner         (E6)
- admin with elevated permission favorites X -> only the ADMIN's row created (E7)
- favorite twice -> no-op, not 500                                           (E8)
- unfavorite never-favorited -> no-op, not 404                               (E9)
- deprecated PUT /assets/:id {isFavorite:true} from Alice (owner)
  -> identical result to the canonical endpoint                              (E17)
- deprecated alias from Bob (VIEWER) -> STILL 403; alias never widens access  (E18)
- empty ids -> 400 or clean no-op (assert whichever, explicitly)
- oversized ids array -> 400, bounded                                        (E28)
- nonexistent asset id -> 400/404, never 500
- no request shape allows naming another user as the subject                 (E4)
```

- [ ] **Step 2: Run to verify red**

```bash
cd e2e && npx vitest --config vitest.config.mjs run src/specs/server/api/asset-favorite.e2e-spec.ts
```

Verify the config filename first (`ls e2e/*.mjs e2e/*.ts`). Expected: FAIL — route does not exist (404), and the viewer cases 403 on the alias.

- [ ] **Step 3: Add the DTO**

In `server/src/dtos/asset.dto.ts`, following the existing `createZodDto` pattern:

```ts
const AssetFavoriteUpdateSchema = z
  .object({
    ids: z.array(z.uuidv4()).min(1).max(1000).describe('Asset IDs'),
    isFavorite: z.boolean().describe('Favorite state for the requesting user'),
  })
  .meta({ id: 'AssetFavoriteUpdateDto' });

export class AssetFavoriteUpdateDto extends createZodDto(AssetFavoriteUpdateSchema) {}
```

The `.max(1000)` bound is E28 — an explicit, documented limit rather than an unbounded statement. Mark the existing `isFavorite` fields deprecated in their `.describe(...)` text, pointing at the new route.

- [ ] **Step 4: Add the route**

In `asset.controller.ts`:

```ts
@Put('favorites')
@Authenticated({ permission: Permission.AssetRead })
@HttpCode(HttpStatus.NO_CONTENT)
@Endpoint({
  summary: 'Set favorite state for the requesting user',
  description:
    'Favorites are per-user. Requires only read access to the assets; a space viewer may favorite an asset they do not own. Never affects any other user.',
  history: new HistoryBuilder().added('v2'),
})
updateAssetFavorites(@Auth() auth: AuthDto, @Body() dto: AssetFavoriteUpdateDto): Promise<void> {
  return this.service.updateFavorites(auth, dto);
}
```

**Route ordering matters.** A static `'favorites'` path must be declared **before** any `@Put(':id')` in the same controller, or Nest matches `:id` first and the endpoint 404s with a UUID-validation error. Check the existing route order and place it accordingly; the e2e test from Step 1 catches this if wrong.

Confirm `HistoryBuilder().added(...)` accepts the version string used by other recently-added endpoints — copy from a neighbour rather than guessing.

- [ ] **Step 5: Implement the service method**

In `asset.service.ts`:

```ts
async updateFavorites(auth: AuthDto, dto: AssetFavoriteUpdateDto): Promise<void> {
  // #763 §5.1: shared-link sessions carry the LINK OWNER's identity (AuthDto.user is
  // non-optional; sharedLink is the optional field). Without this guard an anonymous
  // visitor holding a share link would create favorite rows attributed to the owner.
  if (auth.sharedLink) {
    throw new BadRequestException('Shared link sessions cannot set favorites');
  }

  await this.requireAccess({ auth, permission: Permission.AssetRead, ids: dto.ids });

  if (dto.isFavorite) {
    await this.assetFavoriteRepository.addAll(auth.user.id, dto.ids);
  } else {
    await this.assetFavoriteRepository.removeAll(auth.user.id, dto.ids);
  }
}
```

Verify the exact `requireAccess` helper signature used elsewhere in this service and match it. The subject is **always** `auth.user.id` — no request shape may name another user (E4), and elevated permission does not widen it (E7).

- [ ] **Step 6: Reroute the deprecated alias and stop writing the column**

In `asset.service.ts`:

- `update` (`:313`) and `updateAll` (`:341`): remove `isFavorite` from the `_.omitBy({ isFavorite, visibility, duplicateId }, _.isUndefined)` column write, and when `dto.isFavorite !== undefined` call the **same** `updateFavorites` logic for `auth.user.id`.
- The alias keeps its stricter `Permission.AssetUpdate` route guard — do **not** relax it. That is what makes E18 pass and keeps the alias structurally narrower (§8.1).

- [ ] **Step 7: Invert the bug-encoding e2e test**

`e2e/src/specs/server/api/shared-space-album.e2e-spec.ts:705` currently asserts an editor can bulk-favorite a victim asset, framed as "existing policy → 204". Rewrite it to assert the editor's write creates the **editor's own** row and leaves the owner's state untouched. This inversion is a required deliverable, not incidental churn — update the test name too, so review sees the intent.

- [ ] **Step 8: Regenerate the API clients**

```bash
make open-api
```

Both TypeScript and Dart. TS-only leaves the Dart client stale and fails CI. Commit the regenerated output.

- [ ] **Step 9: Run to verify green**

```bash
cd e2e && npx vitest --config vitest.config.mjs run src/specs/server/api/asset-favorite.e2e-spec.ts src/specs/server/api/shared-space-album.e2e-spec.ts
cd server && npx vitest --config test/vitest.config.mjs run
```

- [ ] **Step 10: Commit**

```bash
git commit -m "feat(favorites): add PUT /assets/favorites and deprecate the isFavorite alias (#763)"
```

---

### Task 3: Slice-2 verification gate

- [ ] **Step 1:** `cd server && npx vitest --config test/vitest.config.mjs run` → ≥5099 passed
- [ ] **Step 2:** `cd server && npx vitest --config test/vitest.config.medium.mjs run --maxWorkers=2` → 137 files; known sync flakes only
- [ ] **Step 3:** `cd server && npx tsc --noEmit && pnpm lint && npx prettier --check "src/**/*.ts"`
- [ ] **Step 4:** `cd e2e && pnpm test` — the full API suite. This slice changes authz, so e2e is the primary evidence.
- [ ] **Step 5: Concurrency check (E27)** — fire a favorite and an unfavorite for the same `(user, asset)` concurrently; assert deterministic convergence, no PK violation, no 500, no orphan row.
- [ ] **Step 6: Scope check**

```bash
git diff --stat main...HEAD -- web mobile server/src/services/timeline.service.ts
```

Expected: only the `timeline.service.ts` `authUserId` threading from slice 1. Any `web/` or `mobile/` change means drift into slices 5–6.

- [ ] **Step 7:** `git push`

---

## Self-Review

**Spec coverage.** E2, E8, E9 → Task 1 Step 1. E3–E7, E17, E18, E28, E4 → Task 2 Step 1. E27 → Task 3 Step 5. §5.1's explicit shared-link guard → Task 2 Step 5, with the reasoning inline so it is not "simplified away". §8.1's alias-is-narrower property → Task 2 Step 6, enforced by keeping the stricter guard.

**Highest-risk item: the `BaseService` three-site registration.** Missing the `static create()` positional entry shifts every subsequent repository and fails only in medium tests, with an error naming an unrelated repository. Task 1 Step 5 therefore runs the **full** medium suite, not just the new spec.

**Second risk: route ordering.** `@Put('favorites')` after `@Put(':id')` silently 404s with a UUID validation error. Called out in Task 2 Step 4 and caught by the Step 1 e2e.

**Placeholder scan.** No TBD/TODO. Two steps direct the implementer to read a neighbouring file for exact idiom (`album-user.repository.ts`, `HistoryBuilder` version) rather than trusting a snippet — slices 0 and 1 both proved my snippets drift from this checkout.

**Type consistency.** `AssetFavoriteUpdateDto { ids, isFavorite }` is used identically in the DTO, controller, service and tests. `addAll`/`removeAll` signatures match between Task 1 and Task 2.
