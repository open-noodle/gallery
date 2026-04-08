# T02 — E2E Test Helpers (Phase 0)

**Backlog row:** [T02 in 2026-04-06-e2e-coverage-backlog.md](./2026-04-06-e2e-coverage-backlog.md)
**Type:** Design (architectural — sets the API every downstream PR depends on)
**Status:** draft

## Goal

Add a small set of helpers to `e2e/` that turn the Permission/Actor matrix from §3 of the [research doc](./2026-04-06-e2e-api-coverage-research.md) into a one-liner per endpoint, so that every downstream PR (T03–T39) can write `forEachActor(...)` instead of hand-rolling six describe blocks per endpoint.

## Why now (and why before T03)

The research doc identified 30+ test files that need actor-matrix coverage. Without shared helpers:

- Each spec hand-rolls user setup (admin → user1 → user2 → space → addMember → addAsset). ~30 lines of boilerplate per file.
- "What does my actor map look like" is reinvented per file with subtle differences.
- 401/403/200 expectations are written as separate `it()` blocks rather than data-driven, so adding a new actor (e.g. `partner`) means editing every file.

The helpers exist to make the matrix the unit of test, not the individual `it`.

## Scope

### In scope

1. New file `e2e/src/actors.ts` exporting:
   - `Actor` and `ActorId` types
   - `SpaceContext` type
   - `buildSpaceContext()` — fully wires up admin + space owner + editor + viewer + non-member + a space + three assets. Returns a typed bag. **Internally calls existing `utils.userSetup`, `utils.createSpace`, `utils.addSpaceMember`, and the existing asset upload helpers — no parallel implementations.**
   - `forEachActor(actors, run, expected)` — runs an HTTP call once per actor, asserts each got the expected status code.
2. **Extend `e2e/src/utils.ts:createSpacePerson`** (already exists at line 544) to:
   - Insert the missing `shared_space_person_face` junction row (the existing helper sets `representativeFaceId` only — that works for the listing JOIN but breaks T10's assets endpoint, T11's reassign, T12's merge, T14's dedup, all of which query via the junction).
   - Accept a `type?: 'person' | 'pet'` parameter (default `'person'`).
   - Return `{ globalPersonId, spacePersonId, faceId }` instead of just `spacePersonId` (T09 test 11 needs `globalPersonId` to mutate `person.thumbnailPath`).
3. New smoke test `e2e/src/specs/server/api/_helpers.e2e-spec.ts` that exercises `buildSpaceContext`, `forEachActor`, and the role assignments against `GET /server/ping`, `GET /users/me`, and one role-distinguishing endpoint.

`addPartner` is **deferred** — no upfront design needs it. It lands with the first task that introduces a `partner` actor (probably T04 or T31).

### Out of scope

- Retrofitting any existing spec to use the new helpers. Existing specs work; rewriting them is a separate decision.
- Helpers for actors not in the upfront 8 (`partner`, `libraryOwner`, `apiKey*`, `sharedLink`, plus existing one-offs like `quotaUser`, `timeBucketUser`). Add those when a downstream task needs them.
- Re-exporting from `e2e/src/utils.ts`. Imports go directly through `src/actors`. No barrel.
- Generic `forEachEndpoint` matrix runners. The actor matrix is the only axis we're abstracting now.

## API design

### `Actor` type

```ts
// e2e/src/actors.ts
export type ActorId =
  | 'anon'
  | 'regularA'
  | 'regularB'
  | 'spaceOwner'
  | 'spaceEditor'
  | 'spaceViewer'
  | 'spaceNonMember'
  | 'admin';

export type Actor = {
  id: ActorId;
  /** Bearer token; undefined for `anon`. */
  token?: string;
  /** Owning user ID; undefined for `anon`. */
  userId?: string;
};
```

**Why this set and no more:** §3.1 of the research doc lists 13 possible actors. T02 ships only the 8 that the upfront designs (T03, T09) actually consume. `partner`, `libraryOwner`, `apiKeyLow`, `apiKeyEmpty`, `sharedLink` are added when their first consumer task lands — extending the union later is mechanical, but predicting their needs now would freeze the wrong shape.

### `buildSpaceContext`

```ts
export type SpaceContext = {
  admin: Actor;
  spaceOwner: Actor;
  spaceEditor: Actor;
  spaceViewer: Actor;
  spaceNonMember: Actor;
  spaceId: string;
  /** Asset owned by spaceOwner, NOT in the space. Use to test "own asset must not leak into space view". */
  ownerAssetId: string;
  /** Asset owned by spaceEditor, NOT in the space. */
  editorAssetId: string;
  /** Asset owned by spaceOwner AND added to the space via shared_space_asset. */
  spaceAssetId: string;
};

export const buildSpaceContext = async (): Promise<SpaceContext> => {
  // Reuses utils.adminSetup, utils.userSetup, utils.createSpace,
  // utils.addSpaceMember, and the existing asset upload helper.
  // No supertest calls are made directly from this function.
};
```

A single call sets everything up. The shape is deliberately flat — destructuring four actors and three asset IDs is acceptable; nesting them under `actors.{owner,editor,viewer}` adds friction to every call site.

**No reinvention.** `buildSpaceContext` is a composition of existing `utils.ts` helpers. If `utils.userSetup`, `utils.createSpace`, `utils.addSpaceMember` change shape upstream during a rebase, this function adapts; the call sites (T03+) don't notice.

**Fixture lifetime contract.** `buildSpaceContext` is meant to be called **once per spec file in `beforeAll`**. The returned fixtures are read-only — tests should not mutate the space, members, or these three asset IDs without owning the cleanup. Tests that need mutation (e.g. T09's "toggle showPets" case) MUST either:

- Create new resources via direct DB inserts and clean them up in `afterEach`, OR
- Snapshot the field they're about to mutate, mutate, run their assertion, and restore in a `try/finally`.

The reason is that vitest runs `it` blocks in declaration order within a file but the fixtures are shared across them — accidentally mutating `space.showPets` in test 5 will leak into test 6. Pin this in the spec template via a comment in the smoke test.

### `forEachActor`

```ts
import type { Response } from 'supertest';

type ExpectedMap = Partial<Record<ActorId, number>>;

export const forEachActor = async (
  actors: Actor[],
  run: (actor: Actor) => Promise<Response>,
  expected: ExpectedMap,
): Promise<void> => {
  for (const actor of actors) {
    const exp = expected[actor.id];
    if (exp === undefined) {
      throw new Error(`forEachActor: no expected status for actor ${actor.id}`);
    }
    const res = await run(actor);
    if (res.status !== exp) {
      throw new Error(`actor=${actor.id} expected status ${exp}, got ${res.status}. Body: ${JSON.stringify(res.body)}`);
    }
  }
};
```

The `run` callback returns a supertest `Response` directly — call sites just `return request(app).get(...).set(...)` and `forEachActor` reads `.status` / `.body` off the resolved response. This matches how supertest is already used elsewhere in the suite (`asset.e2e-spec.ts` etc.) and avoids forcing every call site to map into a `{status, body}` shape.

Three things to call out:

1. **Sequential, not parallel.** Tests share a database. Parallel actor runs would race on the same fixtures. Sequential is fine — the actor matrix is small (≤6 in practice).
2. **Throws with the actor ID in the message.** This is the single most important UX detail — without it, a failing matrix test reads "expected 200, got 403" with no clue which actor it was. A custom Error wins over `expect(status).toBe(exp)` here because it surfaces the actor name.
3. **Explicit `expected` map.** Forcing the test author to spell out an expected status for every actor is more verbose than a default — but the verbosity is intentional. It prevents "I forgot to think about what `spaceViewer` should see" bugs.

### Calling pattern from a downstream test

```ts
import { buildSpaceContext, forEachActor } from 'src/actors';

describe('GET /timeline/buckets', () => {
  let ctx: SpaceContext;

  beforeAll(async () => {
    ctx = await buildSpaceContext();
  });

  it('access matrix for spaceId scoping', async () => {
    await forEachActor(
      [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anonActor],
      (actor) =>
        request(app)
          .get(`/timeline/buckets?spaceId=${ctx.spaceId}`)
          .set(actor.token ? { Authorization: `Bearer ${actor.token}` } : {}),
      {
        spaceOwner: 200,
        spaceEditor: 200,
        spaceViewer: 200,
        spaceNonMember: 400,
        anon: 401,
      },
    );
  });
});
```

That's the goal: ~10 lines for what would otherwise be 5 separate `it` blocks plus shared setup.

(Note: `TimeBucketDto` has no `size` parameter — buckets are always monthly. Note also `spaceNonMember: 400` for timeline endpoints, not 403 — see T03 for the taxonomic split between `requireAccess` and `requireMembership`.)

### Extension to `utils.createSpacePerson`

The existing helper at `e2e/src/utils.ts:544-571` does most of what we need:

```ts
// Existing implementation
createSpacePerson: async (spaceId, name, ownerId, assetId) => {
  // 1. INSERT person with thumbnailPath = '/my/awesome/thumbnail.jpg' (the listing's hard requirement)
  // 2. INSERT asset_face (assetId, personId)
  // 3. INSERT shared_space_person (spaceId, name, representativeFaceId = faceId)
  return spacePersonId;
};
```

T02 extends it to:

```ts
createSpacePerson: async (
  spaceId: string,
  name: string,
  ownerId: string,
  assetId: string,
  options?: { type?: 'person' | 'pet' },
): Promise<{ globalPersonId: string; spacePersonId: string; faceId: string }> => {
  // 1-3 as before, plus:
  // 4. INSERT shared_space_person_face (personId = spacePersonId, assetFaceId = faceId)
  // 5. Accept options.type and pass to shared_space_person.type column (default 'person')
  // 6. Return { globalPersonId, spacePersonId, faceId } instead of just spacePersonId
};
```

**Why step 4 (the junction).** The listing endpoint at `shared-space.repository.ts:503-508` JOINs through `representativeFaceId` directly, so the existing helper works for T09's basic listing. **But** every other space-person query goes through `shared_space_person_face`:

- `getPersonAssetIds` (lines 599-607) — used by T10's `/people/:personId/assets`
- `reassignPersonFaces` (lines 609+) — used by T11/T12
- `isPersonFaceAssigned` (lines 952-961) — dedup check
- `getPersonsForDedup` (lines 977-983) — used by T14
- `faceCount`/`assetCount` denormalization (lines 693-708)
- The `takenAfter`/`takenBefore` EXISTS subquery (lines 522-528) — even within the listing, date filters traverse the junction.

Without the junction insert, T10's "list assets for this space person" returns empty, T11's reassign moves nothing, T12's merge consolidates nothing, and T14's dedup sees no candidates. T09's basic listing (without date filters) is the only test that _would_ work without the junction — which is exactly why the gap hasn't been caught yet.

**Why step 6 (the return shape).** T09 test 11 needs `globalPersonId` to mutate `person.thumbnailPath` directly via DB. T11 will need `faceId` to delete the underlying face and assert cascade behaviour. Returning all three from the helper avoids hand-rolling extra queries in test setup.

**Why this is in T02 and not T09.** All space-people tasks (T07–T14) depend on this helper being correct. Adding the junction in T02 means every downstream task can trust it. Adding it inside T09 would make T10/T11/T12 each carry their own duplication.

**Signature change is risk-free.** Verified via grep — `createSpacePerson` currently has zero callers anywhere in `e2e/`. It was added by the [2026-03-30 hide-space-person plan](./2026-03-30-hide-space-person-plan.md) (Task 2) but the planned test was never written, so the helper is dead code. T02 can change the signature freely.

**Cascade behaviour to know:**

- `shared_space_person.representativeFaceId` → `asset_face.id` is `ON DELETE SET NULL`. Deleting the face nulls the representative pointer but does NOT delete the space person row.
- `shared_space_person_face` has `ON DELETE CASCADE` on both FKs. Deleting the underlying face row removes the junction row but the space person stays (with null representative).
- Deleting the global `person` row does NOT cascade to `shared_space_person`. T09 test 10 validates that the read-through JOIN still returns the space person via the junction.

## The smoke test

`e2e/src/specs/server/api/_helpers.e2e-spec.ts`:

```ts
import { describe, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app, asBearerAuth } from 'src/utils';
import { buildSpaceContext, forEachActor, type SpaceContext, type Actor } from 'src/actors';

describe('test helpers smoke', () => {
  let ctx: SpaceContext;
  const anonActor: Actor = { id: 'anon' };

  // FIXTURE LIFETIME: ctx is built once and treated as read-only.
  // If a test needs to mutate the space, it must restore the field in a try/finally
  // (see fixture lifetime section of T02 design doc).
  beforeAll(async () => {
    ctx = await buildSpaceContext();
  });

  // Smoke test 1 — auth threading: bearer token reaches the server.
  it('GET /server/ping is reachable for every actor', async () => {
    await forEachActor(
      [anonActor, ctx.spaceOwner, ctx.spaceViewer, ctx.spaceNonMember],
      (actor) =>
        request(app)
          .get('/server/ping')
          .set(actor.token ? asBearerAuth(actor.token) : {}),
      { anon: 200, spaceOwner: 200, spaceViewer: 200, spaceNonMember: 200 },
    );
  });

  // Smoke test 2 — anonymous vs authenticated split.
  it('GET /users/me requires auth and returns the right user per actor', async () => {
    await forEachActor(
      [anonActor, ctx.spaceOwner, ctx.spaceViewer],
      (actor) =>
        request(app)
          .get('/users/me')
          .set(actor.token ? asBearerAuth(actor.token) : {}),
      { anon: 401, spaceOwner: 200, spaceViewer: 200 },
    );
  });

  // Smoke test 3 — role assignment in buildSpaceContext.
  // Without this, a regression that creates spaceEditor as spaceViewer would silently
  // pass smoke tests 1 and 2 (both return 200 regardless of role) and break every
  // downstream PR that depends on the role distinction.
  // We probe a write-shaped endpoint where the expected status differs by role.
  it('buildSpaceContext assigns the right role to each member', async () => {
    // PATCH /shared-spaces/:id with {thumbnailCropY: 0} is an Editor-level update.
    // shared-space.service.ts:197-203 — only `name`/`description`/`color`/
    // `faceRecognitionEnabled`/`petsEnabled` count as "metadata" and require Owner.
    // `thumbnailCropY` is Editor-or-above. Viewer must be rejected; Editor and Owner pass.
    // Don't use {name: ...} here — that would require Owner and the smoke test would
    // not distinguish Editor from Viewer (both would 403).
    await forEachActor(
      [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer],
      (actor) =>
        request(app).patch(`/shared-spaces/${ctx.spaceId}`).set(asBearerAuth(actor.token!)).send({ thumbnailCropY: 0 }),
      { spaceOwner: 200, spaceEditor: 200, spaceViewer: 403 },
    );
  });
});
```

The underscore prefix on the filename keeps the smoke test grouped at the top of the directory listing without occupying a "real" spec slot.

## Why these specific helpers (and not more)

- **Why no `forEachScope`?** Scopes (own / partner / space / library / sharedLink) are too varied to abstract. Each test asserts on resource visibility differently. Forcing a uniform scope abstraction would push the complexity into the helper.
- **Why no auto-cleanup?** `resetDatabase` already runs between tests. Helpers don't need to track what they created.
- **Why no `forEachEndpoint`?** Most tests need to run different bodies / query strings per endpoint. Abstracting that loses the specificity that makes failures debuggable.
- **Why no fluent builder for `Actor`?** Same reason — keeps the surface tiny. If a downstream task needs a one-off actor (e.g. quota user), it can construct one inline.

## Risks & mitigations

| Risk                                                                                     | Mitigation                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildSpaceContext` becomes a god-helper that grows uncontrollably.                      | Keep it scoped to the upfront 8 actors. New actor types land with the first task that genuinely needs them (e.g. `partner` with T04).                     |
| Sequential `forEachActor` is too slow for matrices > 10 actors.                          | Acceptable. The §3.1 matrix has 13 actors total but no single test exercises all of them — most tests cover 3–5.                                          |
| `attachSpacePerson` schema drifts as the fork evolves face/dedup tables.                 | The helper lives next to the test code and gets touched as part of any face-related task. Treat as load-bearing but stable.                               |
| Existing specs reinvent helpers because the new ones aren't discoverable.                | Backlog doc lists the helpers explicitly. New specs import from `src/actors`. Discoverability is via the backlog, not via barrel exports.                 |
| Future task adds an `Actor` field (apiKey, sharedLinkKey) that doesn't apply to all IDs. | When that task lands, decide between optional-field-on-`Actor` (simple, current pattern) and discriminated union (cleaner, more verbose). Defer the call. |

## Definition of done

- [ ] `e2e/src/actors.ts` created with `buildSpaceContext`, `forEachActor`, `Actor`, `ActorId`, `SpaceContext`. `buildSpaceContext` calls into `utils.ts` helpers, no parallel implementations.
- [ ] `e2e/src/utils.ts:createSpacePerson` extended: adds `shared_space_person_face` junction insert, accepts `type?: 'person' | 'pet'`, returns `{ globalPersonId, spacePersonId, faceId }`.
- [ ] `e2e/src/specs/server/api/_helpers.e2e-spec.ts` with the 3 smoke tests passes.
- [ ] CI green (no other specs touched).
- [ ] PR description links to this design doc.
