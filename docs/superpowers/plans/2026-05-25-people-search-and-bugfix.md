# People Search AND Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multiple selected people filter assets with AND semantics by default, while preserving explicit internal OR behavior through `personMatchAny`.

**Architecture:** Keep the fix in server repository/query helpers so existing web URLs, SDK DTOs, and UI flows keep working. Add failing medium tests for real timeline result behavior first, then add unit SQL-shape tests for helper/query paths that are hard to exercise cheaply through services. Implement shared people-filter helpers in `server/src/utils/database.ts` and replace OR-only calls in asset/search repositories.

**Tech Stack:** TypeScript, NestJS repositories/services, Kysely SQL builders, Vitest unit specs, Vitest medium specs with Postgres fixtures, generated SQL snapshots via `server/src/queries/*.sql`.

---

## Source Spec

Design spec: `docs/superpowers/specs/2026-05-25-people-search-and-bugfix-design.md`.

Implementation rules from the spec:

1. Write one failing test for the next behavior.
2. Run the narrow test and confirm it fails for the expected OR-vs-AND reason.
3. Write the minimal production code to make that test pass.
4. Rerun the same focused test and keep it green.
5. Commit before moving to the next independent behavior.

No production code should be written before a failing test proves the behavior gap.

## Files

- Modify: `server/test/medium/specs/repositories/asset.repository.spec.ts`
  - Add real DB tests for timeline `personIds`, `spacePersonIds`, `identityIds`, hidden/deleted faces, duplicate IDs, and bucket counts.
- Modify: `server/src/repositories/asset.repository.ts`
  - Replace default OR people filters in `getTimeBuckets()` and `getTimeBucket()`.
- Modify: `server/src/utils/database.ts`
  - Normalize people-related filter IDs.
  - Add `hasSpacePeople()`.
  - Add reusable all/any people-filter helpers for `searchAssetBuilder()`.
- Modify: `server/src/repositories/search.repository.ts`
  - Use AND semantics for smart facet and suggestion filtered-asset builders.
- Modify: `server/src/repositories/search.repository.spec.ts`
  - Add SQL-shape tests for smart facets, suggestions, and `personMatchAny` preservation.
- Modify generated SQL if changed by query decorators:
  - `server/src/queries/asset.repository.sql`
  - `server/src/queries/search.repository.sql`
- Do not modify:
  - Web source files.
  - DTO schemas.
  - OpenAPI or TypeScript SDK files.

## Baseline

- [ ] **Step 1: Confirm the isolated worktree is clean**

Run:

```bash
git status --short --branch
```

Expected: branch is `fix/issue-628-people-search-and` and status is clean.

- [ ] **Step 2: Run the focused unit baseline**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/search.repository.spec.ts src/services/timeline.service.spec.ts src/services/search.service.spec.ts src/services/shared-space.service.spec.ts
```

Expected: all selected unit specs pass before new tests are added.

- [ ] **Step 3: Run the focused medium baseline**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts test/medium/specs/services/people-identity-rbac.spec.ts
```

Expected: all selected medium specs pass before new tests are added.

---

## Task 1: Timeline User-Person Filters Require Every Selected Person

**Files:**

- Modify: `server/test/medium/specs/repositories/asset.repository.spec.ts`
- Modify: `server/src/repositories/asset.repository.ts`
- Modify: `server/src/utils/database.ts`

- [ ] **Step 1: Write the failing `getTimeBucket()` user-person test**

In `server/test/medium/specs/repositories/asset.repository.spec.ts`, add this module-scope helper near `interface TimeBucketAssets` and `setup()`:

```ts
const createTimelineAssetWithPeople = async (
  ctx: ReturnType<typeof setup>['ctx'],
  ownerId: string,
  personIds: string[],
  localDateTime = new Date('2026-03-15T12:00:00.000Z'),
) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    visibility: AssetVisibility.Timeline,
    fileCreatedAt: localDateTime,
    localDateTime,
  });
  await ctx.newExif({ assetId: asset.id, timeZone: 'UTC' });
  for (const personId of personIds) {
    await ctx.newAssetFace({ assetId: asset.id, personId, isVisible: true });
  }
  return asset;
};
```

Then add a new `describe('people filters use AND semantics')` block before the existing `describe('getTimeBucket with spacePersonIds')` block:

```ts
describe('people filters use AND semantics', () => {
  it('requires every selected person for time bucket assets', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user: { id: user.id } });
    const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });

    await createTimelineAssetWithPeople(ctx, user.id, [alice.id]);
    await createTimelineAssetWithPeople(ctx, user.id, [bob.id]);
    const both = await createTimelineAssetWithPeople(ctx, user.id, [alice.id, bob.id]);

    const bucket = await sut.getTimeBucket(
      '2026-03-01',
      {
        userIds: [user.id],
        personIds: [alice.id, bob.id],
        visibility: AssetVisibility.Timeline,
      },
      auth,
    );

    const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
    expect(assets.id).toEqual([both.id]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts -t "requires every selected person for time bucket assets"
```

Expected: FAIL because the current OR filter returns the Alice-only and Bob-only assets as well as the asset containing both people.

- [ ] **Step 3: Implement minimal user-person AND for timeline bucket assets**

In `server/src/repositories/asset.repository.ts`, update the imports from `src/utils/database`:

```ts
import {
  anyUuid,
  asUuid,
  hasAnyFaceIdentity,
  hasAnyPerson,
  hasAnySpacePerson,
  hasPeople,
  isStaleAssetForeignKeyConstraint,
  removeUndefinedKeys,
  truncatedDate,
  unnest,
  withAnyTagId,
  withDefaultVisibility,
  withEdits,
  withExif,
  withFaces,
  withFacesAndPeople,
  withFiles,
  withLibrary,
  withOwner,
  withSmartSearch,
  withTags,
} from 'src/utils/database';
```

Then replace only the `getTimeBucket()` person filter line:

```ts
.$if(!!options.personIds?.length, (qb) => hasPeople(qb, options.personIds!))
```

Do not change `getTimeBuckets()`, `spacePersonIds`, or `identityIds` yet.

- [ ] **Step 4: Run the focused test again**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts -t "requires every selected person for time bucket assets"
```

Expected: PASS.

- [ ] **Step 5: Write the failing `getTimeBuckets()` count test**

Add this test in the same `people filters use AND semantics` block:

```ts
it('requires every selected person when counting time buckets', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
  const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });

  await createTimelineAssetWithPeople(ctx, user.id, [alice.id]);
  await createTimelineAssetWithPeople(ctx, user.id, [bob.id]);
  await createTimelineAssetWithPeople(ctx, user.id, [alice.id, bob.id]);

  await expect(
    sut.getTimeBuckets({
      userIds: [user.id],
      personIds: [alice.id, bob.id],
      visibility: AssetVisibility.Timeline,
    }),
  ).resolves.toEqual([{ count: 1, timeBucket: '2026-03-01' }]);
});
```

- [ ] **Step 6: Run the failing bucket-count test**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts -t "requires every selected person when counting time buckets"
```

Expected: FAIL because `getTimeBuckets()` still uses `hasAnyPerson()` and counts all three assets.

- [ ] **Step 7: Implement minimal user-person AND for timeline bucket counts**

In `server/src/repositories/asset.repository.ts`, replace only the `getTimeBuckets()` person filter line:

```ts
.$if(!!options.personIds?.length, (qb) => hasPeople(qb, options.personIds!))
```

- [ ] **Step 8: Run Task 1 tests**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts -t "requires every selected person"
```

Expected: PASS for both user-person AND tests.

- [ ] **Step 9: Commit Task 1**

Run:

```bash
git add server/test/medium/specs/repositories/asset.repository.spec.ts server/src/repositories/asset.repository.ts
git commit -m "fix(server): require all selected people in timeline buckets"
```

Expected: commit succeeds.

---

## Task 2: Space-Person And Identity Timeline Filters Require Every Selected ID

**Files:**

- Modify: `server/test/medium/specs/repositories/asset.repository.spec.ts`
- Modify: `server/src/utils/database.ts`
- Modify: `server/src/repositories/asset.repository.ts`

- [ ] **Step 1: Write the failing space-person AND test**

In `server/test/medium/specs/repositories/asset.repository.spec.ts`, add this test in the `people filters use AND semantics` block:

```ts
it('requires every selected space person for time bucket assets', async () => {
  const { ctx, sut } = setup();
  const sharedSpaceRepo = ctx.get(SharedSpaceRepository);
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user: { id: user.id } });
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  const bucketDate = new Date('2026-03-15T12:00:00.000Z');

  const aliceOnly = await createTimelineAssetWithPeople(ctx, user.id, [], bucketDate);
  const bobOnly = await createTimelineAssetWithPeople(ctx, user.id, [], bucketDate);
  const both = await createTimelineAssetWithPeople(ctx, user.id, [], bucketDate);

  const { assetFace: aliceOnlyFace } = await ctx.newAssetFace({ assetId: aliceOnly.id, isVisible: true });
  const { assetFace: bobOnlyFace } = await ctx.newAssetFace({ assetId: bobOnly.id, isVisible: true });
  const { assetFace: bothAliceFace } = await ctx.newAssetFace({ assetId: both.id, isVisible: true });
  const { assetFace: bothBobFace } = await ctx.newAssetFace({ assetId: both.id, isVisible: true });

  const alice = await sharedSpaceRepo.createPerson({
    spaceId: space.id,
    name: 'Alice',
    representativeFaceId: aliceOnlyFace.id,
    type: 'person',
  });
  const bob = await sharedSpaceRepo.createPerson({
    spaceId: space.id,
    name: 'Bob',
    representativeFaceId: bobOnlyFace.id,
    type: 'person',
  });
  await sharedSpaceRepo.addPersonFaces(
    [
      { personId: alice.id, assetFaceId: aliceOnlyFace.id },
      { personId: bob.id, assetFaceId: bobOnlyFace.id },
      { personId: alice.id, assetFaceId: bothAliceFace.id },
      { personId: bob.id, assetFaceId: bothBobFace.id },
    ],
    { skipRecount: true },
  );

  const bucket = await sut.getTimeBucket(
    '2026-03-01',
    {
      userIds: [user.id],
      spacePersonIds: [alice.id, bob.id],
      visibility: AssetVisibility.Timeline,
    },
    auth,
  );

  const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
  expect(assets.id).toEqual([both.id]);
});
```

- [ ] **Step 2: Run the failing space-person test**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts -t "requires every selected space person for time bucket assets"
```

Expected: FAIL because `hasAnySpacePerson()` returns all assets that contain Alice or Bob.

- [ ] **Step 3: Implement `hasSpacePeople()` and use it in `getTimeBucket()`**

In `server/src/utils/database.ts`, add this helper after `hasAnySpacePerson()`:

```ts
export function hasSpacePeople<O>(qb: SelectQueryBuilder<DB, 'asset', O>, spacePersonIds: string[]) {
  if (spacePersonIds.length === 0) {
    return qb;
  }

  return qb.where((eb) =>
    eb.and(
      spacePersonIds.map((spacePersonId) =>
        eb.exists(
          eb
            .selectFrom('shared_space_person_face')
            .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('shared_space_person_face.personId', '=', asUuid(spacePersonId)),
        ),
      ),
    ),
  );
}
```

In `server/src/repositories/asset.repository.ts`, import `hasSpacePeople` from `src/utils/database`, then replace only the `getTimeBucket()` space-person filter:

```ts
.$if(!!options.spacePersonIds?.length, (qb) => hasSpacePeople(qb, options.spacePersonIds!))
```

- [ ] **Step 4: Run the space-person test again**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts -t "requires every selected space person for time bucket assets"
```

Expected: PASS.

- [ ] **Step 5: Write the failing identity AND test**

Add this test in the same `people filters use AND semantics` block:

```ts
it('requires every selected identity for time bucket assets', async () => {
  const { ctx, sut } = setup();
  const faceIdentityRepository = ctx.get(FaceIdentityRepository);
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user: { id: user.id } });
  const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
  const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
  const aliceIdentity = await faceIdentityRepository.ensurePersonIdentity(alice.id);
  const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);

  const aliceOnly = await createTimelineAssetWithPeople(ctx, user.id, [], new Date('2026-03-15T12:00:00.000Z'));
  const bobOnly = await createTimelineAssetWithPeople(ctx, user.id, [], new Date('2026-03-15T12:00:00.000Z'));
  const both = await createTimelineAssetWithPeople(ctx, user.id, [], new Date('2026-03-15T12:00:00.000Z'));

  const { assetFace: aliceOnlyFace } = await ctx.newAssetFace({ assetId: aliceOnly.id, personId: alice.id });
  const { assetFace: bobOnlyFace } = await ctx.newAssetFace({ assetId: bobOnly.id, personId: bob.id });
  const { assetFace: bothAliceFace } = await ctx.newAssetFace({ assetId: both.id, personId: alice.id });
  const { assetFace: bothBobFace } = await ctx.newAssetFace({ assetId: both.id, personId: bob.id });

  await faceIdentityRepository.linkFace({
    assetFaceId: aliceOnlyFace.id,
    identityId: aliceIdentity.id,
    source: 'manual',
  });
  await faceIdentityRepository.linkFace({ assetFaceId: bobOnlyFace.id, identityId: bobIdentity.id, source: 'manual' });
  await faceIdentityRepository.linkFace({
    assetFaceId: bothAliceFace.id,
    identityId: aliceIdentity.id,
    source: 'manual',
  });
  await faceIdentityRepository.linkFace({ assetFaceId: bothBobFace.id, identityId: bobIdentity.id, source: 'manual' });

  const bucket = await sut.getTimeBucket(
    '2026-03-01',
    {
      userIds: [user.id],
      identityIds: [aliceIdentity.id, bobIdentity.id],
      visibility: AssetVisibility.Timeline,
    },
    auth,
  );

  const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
  expect(assets.id).toEqual([both.id]);
});
```

- [ ] **Step 6: Run the failing identity test**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts -t "requires every selected identity for time bucket assets"
```

Expected: FAIL because `hasAnyFaceIdentity()` returns all assets linked to Alice or Bob.

- [ ] **Step 7: Use AND identity and space-person helpers in both timeline queries**

In `server/src/repositories/asset.repository.ts`, remove unused imports `hasAnyFaceIdentity`, `hasAnyPerson`, and `hasAnySpacePerson` if they are no longer used. Import `hasFaceIdentities`, `hasPeople`, and `hasSpacePeople`.

Replace the people-related filter lines in both `getTimeBuckets()` and `getTimeBucket()` with:

```ts
.$if(!!options.personIds?.length, (qb) => hasPeople(qb, options.personIds!))
.$if(!!options.spacePersonIds?.length, (qb) => hasSpacePeople(qb, options.spacePersonIds!))
.$if(!!options.identityIds?.length, (qb) => hasFaceIdentities(qb, options.identityIds!))
```

- [ ] **Step 8: Run Task 2 tests**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts -t "people filters use AND semantics|spacePersonIds"
```

Expected: PASS. Existing single-space-person hidden/deleted test must still pass.

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add server/test/medium/specs/repositories/asset.repository.spec.ts server/src/repositories/asset.repository.ts server/src/utils/database.ts
git commit -m "fix(server): require all selected scoped people in timeline buckets"
```

Expected: commit succeeds.

---

## Task 3: Normalize Duplicate People IDs And Preserve Visible-Face Edge Cases

**Files:**

- Modify: `server/test/medium/specs/repositories/asset.repository.spec.ts`
- Modify: `server/src/utils/database.ts`

- [ ] **Step 1: Write the failing duplicate user-person ID test**

Add this test in `people filters use AND semantics`:

```ts
it('treats duplicate selected person ids as one selected person', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user: { id: user.id } });
  const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
  const asset = await createTimelineAssetWithPeople(ctx, user.id, [alice.id]);

  const bucket = await sut.getTimeBucket(
    '2026-03-01',
    {
      userIds: [user.id],
      personIds: [alice.id, alice.id],
      visibility: AssetVisibility.Timeline,
    },
    auth,
  );

  const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
  expect(assets.id).toEqual([asset.id]);
});
```

- [ ] **Step 2: Run the duplicate user-person ID test**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts -t "treats duplicate selected person ids as one selected person"
```

Expected: FAIL after Tasks 1 and 2 because `hasPeople()` compares `count(distinct personId)` to the raw array length, so duplicate person IDs become impossible.

- [ ] **Step 3: Normalize IDs in people helpers**

In `server/src/utils/database.ts`, add this helper near `anyUuid`:

```ts
const uniqueTruthyIds = (ids: string[] = []) => [...new Set(ids.filter(Boolean))];
```

Update `hasPeople()`, `hasAnyPerson()`, `hasFaceIdentities()`, `hasAnyFaceIdentity()`, `hasSpacePeople()`, and `hasAnySpacePerson()` to normalize first. `hasPeople()` must have this final shape:

```ts
export function hasPeople<O>(qb: SelectQueryBuilder<DB, 'asset', O>, personIds: string[]) {
  const ids = uniqueTruthyIds(personIds);
  if (ids.length === 0) {
    return qb;
  }

  return qb.innerJoin(
    (eb) =>
      eb
        .selectFrom('asset_face')
        .select('assetId')
        .where('personId', '=', anyUuid(ids))
        .where('deletedAt', 'is', null)
        .where('isVisible', 'is', true)
        .groupBy('assetId')
        .having((eb) => eb.fn.count('personId').distinct(), '=', ids.length)
        .as('has_people'),
    (join) => join.onRef('has_people.assetId', '=', 'asset.id'),
  );
}
```

Make these exact edits in each remaining helper:

1. In `hasAnyPerson()`, add `const ids = uniqueTruthyIds(personIds);` as the first statement.
2. In `hasFaceIdentities()` and `hasAnyFaceIdentity()`, add `const ids = uniqueTruthyIds(identityIds);` as the first statement.
3. In `hasSpacePeople()` and `hasAnySpacePerson()`, add `const ids = uniqueTruthyIds(spacePersonIds);` as the first statement.
4. Add `if (ids.length === 0) { return qb; }` immediately after it.
5. In `hasAnyPerson()`, replace `anyUuid(personIds)` with `anyUuid(ids)`.
6. In `hasFaceIdentities()` and `hasAnyFaceIdentity()`, replace `anyUuid(identityIds)` with `anyUuid(ids)`.
7. In `hasAnySpacePerson()`, replace `anyUuid(spacePersonIds)` with `anyUuid(ids)`.
8. In `hasSpacePeople()`, iterate over `ids` instead of `spacePersonIds`.
9. Replace the `hasFaceIdentities()` count comparison with `.having((eb) => eb.fn.count('face_identity_face.identityId').distinct(), '=', ids.length)`.

- [ ] **Step 4: Run the duplicate user-person ID test again**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts -t "treats duplicate selected person ids as one selected person"
```

Expected: PASS.

- [ ] **Step 5: Add identity and space-person duplicate-ID regression coverage**

Add these tests in `people filters use AND semantics`:

```ts
it('treats duplicate selected identity ids as one selected identity', async () => {
  const { ctx, sut } = setup();
  const faceIdentityRepository = ctx.get(FaceIdentityRepository);
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user: { id: user.id } });
  const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
  const identity = await faceIdentityRepository.ensurePersonIdentity(alice.id);
  const asset = await createTimelineAssetWithPeople(ctx, user.id, []);
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alice.id, isVisible: true });
  await faceIdentityRepository.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'manual' });

  const bucket = await sut.getTimeBucket(
    '2026-03-01',
    {
      userIds: [user.id],
      identityIds: [identity.id, identity.id],
      visibility: AssetVisibility.Timeline,
    },
    auth,
  );

  const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
  expect(assets.id).toEqual([asset.id]);
});

it('treats duplicate selected space person ids as one selected space person', async () => {
  const { ctx, sut } = setup();
  const sharedSpaceRepo = ctx.get(SharedSpaceRepository);
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user: { id: user.id } });
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  const asset = await createTimelineAssetWithPeople(ctx, user.id, []);
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, isVisible: true });
  const alice = await sharedSpaceRepo.createPerson({
    spaceId: space.id,
    name: 'Alice',
    representativeFaceId: assetFace.id,
    type: 'person',
  });
  await sharedSpaceRepo.addPersonFaces([{ personId: alice.id, assetFaceId: assetFace.id }], { skipRecount: true });

  const bucket = await sut.getTimeBucket(
    '2026-03-01',
    {
      userIds: [user.id],
      spacePersonIds: [alice.id, alice.id],
      visibility: AssetVisibility.Timeline,
    },
    auth,
  );

  const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
  expect(assets.id).toEqual([asset.id]);
});
```

- [ ] **Step 6: Run duplicate-ID regression tests**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts -t "treats duplicate selected .* ids as one selected"
```

Expected: PASS.

- [ ] **Step 7: Add multiple-faces-same-person coverage**

Add this test in `people filters use AND semantics`:

```ts
it('counts multiple visible faces for the same person as one selected person', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user: { id: user.id } });
  const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
  const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
  const asset = await createTimelineAssetWithPeople(ctx, user.id, [alice.id, alice.id, bob.id]);

  const bucket = await sut.getTimeBucket(
    '2026-03-01',
    {
      userIds: [user.id],
      personIds: [alice.id, bob.id],
      visibility: AssetVisibility.Timeline,
    },
    auth,
  );

  const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
  expect(assets.id).toEqual([asset.id]);
});
```

- [ ] **Step 8: Run all Task 3 tests**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts -t "duplicate selected .* ids|multiple visible faces"
```

Expected: PASS. If the multiple-face test passes immediately, keep it as edge coverage.

- [ ] **Step 9: Commit Task 3**

Run:

```bash
git add server/test/medium/specs/repositories/asset.repository.spec.ts server/src/utils/database.ts
git commit -m "fix(server): normalize duplicate people filters"
```

Expected: commit succeeds.

---

## Task 4: Search Builders Use AND By Default And Preserve Explicit OR

**Files:**

- Modify: `server/src/repositories/search.repository.spec.ts`
- Modify: `server/src/utils/database.ts`
- Modify: `server/src/repositories/search.repository.ts`

- [ ] **Step 1: Write SQL-shape tests for search and suggestion builders one at a time**

In `server/src/repositories/search.repository.spec.ts`, use the tests below as a queue. Add only one test, run it by exact title, make the smallest corresponding production change from Steps 3-5, rerun that same title, and then move to the next test. Do not paste the whole queue before seeing the first failing test.

In the existing `describe('smart facets query shape')` block:

```ts
it('space person filters emit one EXISTS per selected space person for smart facet totals', () => {
  const sql = buildFacetFilteredIdsSql(sut, {
    ...baseOptions,
    spacePersonIds: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
  });

  expect(countMatches(sql, /exists\s*\(select\b[\s\S]+?from\s+"shared_space_person_face"/gi)).toBe(2);
  expect(sql).not.toMatch(/"shared_space_person_face"\."personId"\s*=\s*any\(/i);
});
```

In the existing `describe('filter suggestions query shape')` block:

```ts
it('global person suggestion filters require every selected person', () => {
  const sql = compileFilteredAssetIds(sut, {
    personIds: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
  });

  expect(sql).toContain('"has_people"');
  expect(sql).toMatch(/having count\(distinct "personId"\) = \$\d+/i);
});

it('space person suggestion filters require every selected space person', () => {
  const sql = compileFilteredAssetIds(sut, {
    spaceId: '11111111-1111-1111-1111-111111111111',
    personIds: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
  });

  expect(countMatches(sql, /exists\s*\(select\b[\s\S]+?from\s+"shared_space_person_face"/gi)).toBe(2);
  expect(sql).not.toMatch(/"shared_space_person_face"\."personId"\s*=\s*any\(/i);
});
```

In a new `describe('searchAssetBuilder people semantics')` block:

```ts
it('uses AND semantics for space person filters by default', () => {
  const sql = buildAssetSearchSql({
    userIds: ['00000000-0000-0000-0000-000000000000'],
    spacePersonIds: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
  });

  expect(countMatches(sql, /exists\s*\(select\b[\s\S]+?from\s+"shared_space_person_face"/gi)).toBe(2);
  expect(sql).not.toMatch(/"shared_space_person_face"\."personId"\s*=\s*any\(/i);
});

it('keeps personMatchAny as OR for identity and space person filters', () => {
  const sql = buildAssetSearchSql({
    userIds: ['00000000-0000-0000-0000-000000000000'],
    personMatchAny: true,
    personIds: ['00000000-0000-0000-0000-000000000001'],
    identityIds: ['00000000-0000-0000-0000-000000000002'],
    spacePersonIds: ['00000000-0000-0000-0000-000000000003'],
  });

  expect(sql).toMatch(/\bor\b/i);
  expect(sql).toContain('"face_identity_face"');
  expect(sql).toContain('"shared_space_person_face"');
  expect(sql).not.toContain('"has_face_identities"');
  expect(sql).not.toContain('"has_people"');
});

it('does not apply people predicates for empty people arrays', () => {
  const sql = buildAssetSearchSql({
    userIds: ['00000000-0000-0000-0000-000000000000'],
    personIds: [],
    identityIds: [],
    spacePersonIds: [],
  });

  expect(sql).not.toContain('"asset_face"');
  expect(sql).not.toContain('"face_identity_face"');
  expect(sql).not.toContain('"shared_space_person_face"');
});

it('keeps mixed people categories cumulative by default', () => {
  const sql = buildAssetSearchSql({
    userIds: ['00000000-0000-0000-0000-000000000000'],
    personIds: ['00000000-0000-0000-0000-000000000001'],
    identityIds: ['00000000-0000-0000-0000-000000000002'],
    spacePersonIds: ['00000000-0000-0000-0000-000000000003'],
  });

  expect(sql).toContain('"has_people"');
  expect(sql).toContain('"has_face_identities"');
  expect(sql).toContain('"shared_space_person_face"');
  expect(sql).not.toMatch(/\bor\b/i);
});
```

- [ ] **Step 2: Run each SQL-shape test at the red and green points**

Run each command when its matching test is added:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/search.repository.spec.ts -t "space person filters emit one EXISTS per selected space person for smart facet totals"
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/search.repository.spec.ts -t "global person suggestion filters require every selected person"
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/search.repository.spec.ts -t "space person suggestion filters require every selected space person"
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/search.repository.spec.ts -t "uses AND semantics for space person filters by default"
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/search.repository.spec.ts -t "keeps personMatchAny as OR for identity and space person filters"
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/search.repository.spec.ts -t "does not apply people predicates for empty people arrays"
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/search.repository.spec.ts -t "keeps mixed people categories cumulative by default"
```

Expected red points: the smart facet, global suggestion, space suggestion, default space-person builder, and `personMatchAny` tests fail against current behavior. The empty-array and mixed-category tests may already pass; add them after the builder semantics are green and keep them as edge coverage.

- [ ] **Step 3: Add reusable AND/OR people filter helpers**

In `server/src/utils/database.ts`, add this type and helper after the individual people helpers:

```ts
type PeopleFilterIds = {
  personIds?: string[];
  identityIds?: string[];
  spacePersonIds?: string[];
};

export function hasAllPeople<O>(qb: SelectQueryBuilder<DB, 'asset', O>, filters: PeopleFilterIds) {
  const personIds = uniqueTruthyIds(filters.personIds);
  const identityIds = uniqueTruthyIds(filters.identityIds);
  const spacePersonIds = uniqueTruthyIds(filters.spacePersonIds);

  return qb
    .$if(personIds.length > 0, (qb) => hasPeople(qb, personIds))
    .$if(identityIds.length > 0, (qb) => hasFaceIdentities(qb, identityIds))
    .$if(spacePersonIds.length > 0, (qb) => hasSpacePeople(qb, spacePersonIds));
}

export function hasAnyPeople<O>(qb: SelectQueryBuilder<DB, 'asset', O>, filters: PeopleFilterIds) {
  const personIds = uniqueTruthyIds(filters.personIds);
  const identityIds = uniqueTruthyIds(filters.identityIds);
  const spacePersonIds = uniqueTruthyIds(filters.spacePersonIds);

  if (personIds.length === 0 && identityIds.length === 0 && spacePersonIds.length === 0) {
    return qb;
  }

  return qb.where((eb) => {
    const predicates: Expression<SqlBool>[] = [];

    if (personIds.length > 0) {
      predicates.push(
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('asset_face.personId', '=', anyUuid(personIds)),
        ),
      );
    }

    if (identityIds.length > 0) {
      predicates.push(
        eb.exists(
          eb
            .selectFrom('asset_face')
            .innerJoin('face_identity_face', 'face_identity_face.assetFaceId', 'asset_face.id')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('face_identity_face.identityId', '=', anyUuid(identityIds)),
        ),
      );
    }

    if (spacePersonIds.length > 0) {
      predicates.push(
        eb.exists(
          eb
            .selectFrom('shared_space_person_face')
            .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('shared_space_person_face.personId', '=', anyUuid(spacePersonIds)),
        ),
      );
    }

    return eb.or(predicates);
  });
}
```

- [ ] **Step 4: Use helpers in `searchAssetBuilder()`**

In `server/src/utils/database.ts`, remove these separate people filter calls from `searchAssetBuilder()`:

```ts
.$if(!!options.spacePersonIds?.length, (qb) => hasAnySpacePerson(qb, options.spacePersonIds!))
.$if(!!options.personIds && options.personIds.length > 0, (qb) =>
  options.personMatchAny ? hasAnyPerson(qb, options.personIds!) : hasPeople(qb, options.personIds!),
)
.$if(!!options.identityIds && options.identityIds.length > 0, (qb) => hasFaceIdentities(qb, options.identityIds!))
```

Insert this combined people filter call in the same position where those removed filters were applied:

```ts
.$if(
  !!options.personIds?.length || !!options.identityIds?.length || !!options.spacePersonIds?.length,
  (qb) =>
    options.personMatchAny
      ? hasAnyPeople(qb, {
          personIds: options.personIds,
          identityIds: options.identityIds,
          spacePersonIds: options.spacePersonIds,
        })
      : hasAllPeople(qb, {
          personIds: options.personIds,
          identityIds: options.identityIds,
          spacePersonIds: options.spacePersonIds,
        }),
)
```

- [ ] **Step 5: Use AND helpers in search repository filtered builders**

In `server/src/repositories/search.repository.ts`, update the import list from `src/utils/database`:

- Add `hasSpacePeople`.
- Remove `hasAnySpacePerson` after the replacements below if no references remain.

In `buildSmartFacetFilteredAssetIds()`, replace:

```ts
.$if(exclude !== 'people' && !!options.spacePersonIds?.length, (qb) =>
  hasAnySpacePerson(qb, options.spacePersonIds!),
)
```

with:

```ts
.$if(exclude !== 'people' && !!options.spacePersonIds?.length, (qb) =>
  hasSpacePeople(qb, options.spacePersonIds!),
)
```

In `buildFilteredAssetIds()`, replace the two `personIds` blocks:

```ts
.$if(!!options.personIds?.length && !!options.spaceId, (qb) =>
  qb.where((eb) =>
    eb.exists(
      eb
        .selectFrom('shared_space_person_face')
        .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
        .whereRef('asset_face.assetId', '=', 'asset.id')
        .where('asset_face.deletedAt', 'is', null)
        .where('asset_face.isVisible', 'is', true)
        .where('shared_space_person_face.personId', '=', anyUuid(options.personIds!)),
    ),
  ),
)
.$if(!!options.personIds?.length && !options.spaceId, (qb) =>
  qb.where((eb) =>
    eb.exists(
      eb
        .selectFrom('asset_face')
        .whereRef('asset_face.assetId', '=', 'asset.id')
        .where('asset_face.personId', '=', anyUuid(options.personIds!)),
    ),
  ),
)
```

with:

```ts
.$if(!!options.personIds?.length && !!options.spaceId, (qb) => hasSpacePeople(qb, options.personIds!))
.$if(!!options.personIds?.length && !options.spaceId, (qb) => hasPeople(qb, options.personIds!))
```

- [ ] **Step 6: Run Task 4 tests**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/search.repository.spec.ts -t "space person filters emit one EXISTS|global person suggestion filters require every selected person|space person suggestion filters require every selected space person|searchAssetBuilder people semantics|empty people arrays|mixed people categories"
```

Expected: PASS.

- [ ] **Step 7: Run full search repository unit spec**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/search.repository.spec.ts
```

Expected: PASS. This protects smart-search ordering constraints and existing explicit `personMatchAny` tests.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add server/src/repositories/search.repository.spec.ts server/src/repositories/search.repository.ts server/src/utils/database.ts
git commit -m "fix(server): align people filters in search builders"
```

Expected: commit succeeds.

---

## Task 5: Service-Level Regression Coverage For Scoped Resolution And OR Preservation

**Files:**

- Modify: `server/src/services/search.service.spec.ts`
- Modify only if a failing test proves it: `server/src/services/search.service.ts`
- Modify only if a failing test proves it: `server/src/services/shared-space.service.ts`

- [ ] **Step 1: Add duplicate-token normalization coverage for resolved scoped filters**

In `server/src/services/search.service.spec.ts`, add this test in the `searchMetadata` describe block:

```ts
it('deduplicates resolved scoped person filters before repository search', async () => {
  const token = `person:${newUuid()}`;
  mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
  mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });
  (mocks.faceIdentity as any).resolveScopedPersonTokens.mockResolvedValue({
    identityIds: ['00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000010'],
    legacyPersonIds: ['00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000020'],
    legacySpacePersonIds: ['00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000030'],
    hasInaccessibleToken: false,
  });

  await sut.searchMetadata(authStub.user1, { withSharedSpaces: true, personIds: [token, token] });

  expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      identityIds: ['00000000-0000-4000-8000-000000000010'],
      personIds: ['00000000-0000-4000-8000-000000000020'],
      spacePersonIds: ['00000000-0000-4000-8000-000000000030'],
    }),
  );
});
```

- [ ] **Step 2: Run the service duplicate test**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/services/search.service.spec.ts -t "deduplicates resolved scoped person filters before repository search"
```

Expected: FAIL if service-layer resolved arrays are not deduplicated before reaching repositories. If it passes because repository-level normalization is enough and service already dedupes `spacePersonIds`, keep it as coverage only.

- [ ] **Step 3: Implement only if the test fails semantically**

If the test fails, update `resolveScopedPersonFilters()` in `server/src/services/search.service.ts`:

```ts
const unique = <T>(items: T[]) => [...new Set(items)];

return {
  ...dto,
  personIds: unique(resolution.legacyPersonIds),
  identityIds: unique(resolution.identityIds),
  spacePersonIds: unique([...(dto.spacePersonIds ?? []), ...resolution.legacySpacePersonIds]),
  forceEmptyResult: dto.forceEmptyResult || resolution.hasInaccessibleToken,
};
```

If the test passes, do not edit production code.

- [ ] **Step 4: Run search and shared-space service OR preservation tests**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts -t "personMatchAny"
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/services/search.service.spec.ts -t "spacePersonIds|scoped person"
```

Expected: PASS. These tests ensure map marker callers still pass `personMatchAny: true` and search endpoints still reject invalid `spacePersonIds` combinations.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add server/src/services/search.service.spec.ts server/src/services/search.service.ts server/src/services/shared-space.service.ts
git commit -m "test(server): cover scoped people filter normalization"
```

Expected: commit succeeds. If no production files changed, commit only the spec file.

---

## Task 6: Regenerate SQL Snapshots And Run Focused Verification

**Files:**

- Modify if generated output changes:
  - `server/src/queries/asset.repository.sql`
  - `server/src/queries/search.repository.sql`

- [ ] **Step 1: Regenerate SQL snapshots**

Run:

```bash
pnpm --filter immich run sync:sql
```

Expected: generated SQL files update if query decorators cover changed methods. If the command reports no changes, continue.

- [ ] **Step 2: Inspect generated SQL diffs**

Run:

```bash
git diff -- server/src/queries/asset.repository.sql server/src/queries/search.repository.sql
```

Expected: any diff reflects AND semantics for people filters. Reject unrelated query churn.

- [ ] **Step 3: Run focused unit verification**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/repositories/search.repository.spec.ts src/services/timeline.service.spec.ts src/services/search.service.spec.ts src/services/shared-space.service.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run focused medium verification**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts test/medium/specs/services/people-identity-rbac.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck or server check if SQL/code changes touched shared helpers**

Run:

```bash
pnpm --filter immich run check
```

Expected: PASS.

- [ ] **Step 6: Commit generated SQL and any final fixes**

Run:

```bash
git status --short
git add server/src/queries/asset.repository.sql server/src/queries/search.repository.sql
git commit -m "chore(server): update people filter SQL snapshots"
```

Expected: commit succeeds if generated SQL changed. If no generated SQL changed, skip this commit.

---

## Task 7: Final Branch Verification

**Files:**

- No edits unless verification exposes a bug.

- [ ] **Step 1: Run full server unit suite**

Run:

```bash
pnpm --filter immich test
```

Expected: PASS.

- [ ] **Step 2: Run all touched medium specs**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts test/medium/specs/services/people-identity-rbac.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Review final diff**

Run:

```bash
git diff main...HEAD -- server/src/utils/database.ts server/src/repositories/asset.repository.ts server/src/repositories/search.repository.ts server/test/medium/specs/repositories/asset.repository.spec.ts server/src/repositories/search.repository.spec.ts server/src/services/search.service.spec.ts docs/superpowers/specs/2026-05-25-people-search-and-bugfix-design.md docs/superpowers/plans/2026-05-25-people-search-and-bugfix.md
```

Expected: diff matches the spec. There are no DTO, OpenAPI, SDK, or web changes.

- [ ] **Step 4: Confirm clean worktree**

Run:

```bash
git status --short
```

Expected: no uncommitted changes.

---

## Self-Review Notes

Spec coverage:

- Default AND semantics: Tasks 1, 2, and 4.
- Explicit OR preservation: Task 4 and Task 5.
- Legacy user-person IDs: Task 1.
- Identity IDs: Task 2 and Task 4.
- Shared-space person IDs: Task 2 and Task 4.
- Duplicate IDs: Task 3 and Task 5.
- Empty people arrays: Task 4.
- Hidden/deleted faces: existing medium test is preserved and rerun in Task 2.
- Mixed resolved categories: Task 4 default cumulative SQL test, Task 4 OR helper, and Task 5 service coverage.
- No API/UI changes: file list and final diff check in Task 7.
- Generated SQL consistency: Task 6.

Completeness scan: every production change above has concrete snippets and commands.

Type consistency: all new test snippets use existing `setup()`, `factory`, `AssetVisibility`, `SharedSpaceRepository`, `FaceIdentityRepository`, and `TimeBucketAssets` already present in `asset.repository.spec.ts`.
