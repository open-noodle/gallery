# Space-person birthday display resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a person's birthday display correctly for any viewer when it was set on any profile of the shared face identity (e.g. by a space editor), not only when it sits on the name-winner or the owner's own `person` row.

**Architecture:** Pure read-time fix. `FaceIdentityRepository.hydrateAccessiblePeople` already resolves person metadata across the `person` + `shared_space_person` profiles of an identity via two ranking windows (`display_rn` for name, `primary_rn` for the canonical profile). Birthday currently piggybacks on those, so it is invisible unless it lives on the name-winner or the owner. We add a third window, `birthdate_rn` (the birthday analog of `display_rn`), and resolve `birthDate` from it. No writes to `person`, no schema change, no backfill change. Precedence: owner first, else most-recent `manual` (then `inherited`).

**Tech Stack:** NestJS, Kysely (raw `sql` template), PostgreSQL, Vitest medium tests against a real DB (testcontainers). The method carries `@GenerateSql`, so its SQL is mirrored into `src/queries/face.identity.repository.sql` and must be regenerated.

**Reference spec:** `docs/superpowers/specs/2026-06-10-space-birthday-identity-display-resolution-design.md`

---

## File structure

| File                                                                     | Responsibility                                                                                                                            | Change                                 |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `server/src/repositories/face-identity.repository.ts`                    | The `hydrateAccessiblePeople` raw SQL (the only birthday-display resolver; search/other paths do not return birthDate — verified in spec) | Modify — 3 edits inside one SQL string |
| `server/src/queries/face.identity.repository.sql`                        | Auto-generated SQL mirror (CI-enforced fresh)                                                                                             | Regenerate via `pnpm sync:sql`         |
| `server/test/medium/specs/repositories/face-identity.repository.spec.ts` | Real-DB coverage for `getAccessiblePeople` / `getAccessiblePersonByProfileId`                                                             | Modify — add tests                     |

All edits to the SQL live inside the single template literal in `hydrateAccessiblePeople` (currently ~lines 1777–1927). Line numbers below are approximate — anchor on the quoted strings.

---

## Task 0: Environment setup (one-time)

This is a fresh worktree with no `node_modules`. Medium tests need Docker (testcontainers), and `sync:sql` needs the server built.

**Files:** none (setup only)

- [ ] **Step 1: Install workspace dependencies**

Run from repo root:

```bash
pnpm install
```

Expected: completes; `server/node_modules` exists.

- [ ] **Step 2: Confirm Docker is available (medium tests need it)**

Run:

```bash
docker info >/dev/null 2>&1 && echo "docker ok" || echo "docker MISSING"
```

Expected: `docker ok`. If `docker MISSING`, start Docker Desktop before running any medium test.

- [ ] **Step 3: Sanity-run the target medium spec (baseline, all green)**

Run from `server/`:

```bash
pnpm test:medium -- --run test/medium/specs/repositories/face-identity.repository.spec.ts
```

Expected: the existing suite passes (this confirms the harness/DB works before we touch anything). Do not proceed until green.

---

## Task 1: Failing repro test — space-set birthday is invisible to the owner

This is the genuine red test. Owner's `person` row supplies the **name** but has **no birthday**; a space-person of the same identity holds a `manual` birthday. The birthday must resolve onto the owner's view. It does not today (returns `null`), because birthday is read from `display_profiles` (the owner row, NULL) / `primary_profiles` (the owner row, NULL).

**Files:**

- Test: `server/test/medium/specs/repositories/face-identity.repository.spec.ts`

- [ ] **Step 1: Add the failing test**

Add this `it(...)` block immediately after the existing test that ends at the line containing `'uses a named accessible space profile for display while keeping a viewer-owned primary profile'` (the block closing near line 1570). Insert after its closing `});`:

```ts
it('resolves a space-set birthday for the owner when only a sibling space profile carries it', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
  // Owner's library person: has the NAME, but no birthday.
  const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ina' });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  const identity = await sut.ensurePersonIdentity(person.id);
  await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
  // Space profile (set by an editor): carries the manual birthday, no name.
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: space.id,
      identityId: identity.id,
      name: '',
      representativeFaceId: assetFace.id,
      type: 'person',
      birthDate: '2014-02-14',
      birthDateSource: 'manual',
      birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
    .execute();

  try {
    const result = await sut.getAccessiblePeople(user.id, { withHidden: false, page: 1, size: 50 });

    expect(result.people).toEqual([
      expect.objectContaining({
        id: person.id,
        name: 'Ina', // name still resolves from the owner profile
        birthDate: '2014-02-14', // birthday resolves from the sibling space profile
        primaryProfile: { type: 'user-person', id: person.id },
      }),
    ]);
  } finally {
    await ctx.database.deleteFrom('shared_space_person').where('id', '=', spacePerson.id).execute();
    await ctx.database
      .deleteFrom('shared_space_asset')
      .where('spaceId', '=', space.id)
      .where('assetId', '=', asset.id)
      .execute();
  }
});
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run from `server/`:

```bash
pnpm test:medium -- --run test/medium/specs/repositories/face-identity.repository.spec.ts -t "resolves a space-set birthday for the owner"
```

Expected: FAIL. The received person has `birthDate: null` (name `'Ina'` is correct; birthday is the gap). This proves the bug.

- [ ] **Step 3: Commit the failing test**

```bash
git add server/test/medium/specs/repositories/face-identity.repository.spec.ts
git commit -m "test(face-identity): failing repro — space-set birthday invisible to owner"
```

---

## Task 2: Implement the SQL fix (the `birthdate_rn` window)

Three edits inside the `hydrateAccessiblePeople` template literal, then regenerate the SQL mirror.

**Files:**

- Modify: `server/src/repositories/face-identity.repository.ts` (the `hydrateAccessiblePeople` SQL, ~lines 1824–1927)
- Regenerate: `server/src/queries/face.identity.repository.sql`

- [ ] **Step 1: Carry birthday provenance on the `person` branch of the `profiles` CTE**

Find (the `person` UNION branch):

```ts
          person."identityId",
          person.name,
          person."birthDate",
          person."thumbnailPath",
```

Replace with:

```ts
          person."identityId",
          person.name,
          person."birthDate",
          CASE WHEN person."birthDate" IS NOT NULL THEN 'manual' ELSE 'none' END AS "birthDateSource",
          person."updatedAt" AS "birthDateSourceUpdatedAt",
          person."thumbnailPath",
```

(The `person` table has no source columns; the owner's value wins by position regardless, so a synthesized `'manual'`/`'none'` and `updatedAt` proxy are sufficient and never decision-critical.)

- [ ] **Step 2: Carry birthday provenance on the `shared_space_person` branch**

Find (the space-person UNION branch):

```ts
          COALESCE(NULLIF(shared_space_person_alias.alias, ''), shared_space_person.name, '') AS name,
          shared_space_person."birthDate",
          ''::text AS "thumbnailPath",
```

Replace with:

```ts
          COALESCE(NULLIF(shared_space_person_alias.alias, ''), shared_space_person.name, '') AS name,
          shared_space_person."birthDate",
          shared_space_person."birthDateSource",
          shared_space_person."birthDateSourceUpdatedAt",
          ''::text AS "thumbnailPath",
```

(Both branches now project the two new columns in the same position, so the UNION stays aligned. Column names come from the first branch: `"birthDateSource"`, `"birthDateSourceUpdatedAt"`.)

- [ ] **Step 3: Add the `birthdate_rn` window to `ranked_profiles`**

Find:

```ts
          ) AS primary_rn
        FROM profiles
```

Replace with:

```ts
          ) AS primary_rn,
          row_number() OVER (
            PARTITION BY profiles."identityId"
            ORDER BY
              profiles."birthDate" IS NULL,
              CASE WHEN profiles."profileType" = 'user-person' THEN 0 ELSE 1 END,
              CASE profiles."birthDateSource"
                WHEN 'manual' THEN 0
                WHEN 'inherited' THEN 1
                ELSE 2
              END,
              profiles."birthDateSourceUpdatedAt" DESC NULLS LAST,
              profiles."updatedAt" DESC,
              profiles."profileId"
          ) AS birthdate_rn
        FROM profiles
```

(`profiles."birthDate" IS NULL` sorts birthday-bearing rows first — `false` before `true` in Postgres — so the owner only reaches rank 1 when they actually have a birthday; otherwise the most-recent `manual` space value wins.)

- [ ] **Step 4: Resolve `birthDate` from the new window in the final SELECT**

Find:

```ts
        COALESCE(display_profiles."birthDate", primary_profiles."birthDate") AS "birthDate",
```

Replace with:

```ts
        COALESCE(birthdate_profiles."birthDate", primary_profiles."birthDate") AS "birthDate",
```

- [ ] **Step 5: Join the new ranked alias**

Find:

```ts
      INNER JOIN ranked_profiles AS display_profiles
        ON display_profiles."identityId" = requested_identities."identityId"
        AND display_profiles.display_rn = 1
```

Replace with:

```ts
      INNER JOIN ranked_profiles AS display_profiles
        ON display_profiles."identityId" = requested_identities."identityId"
        AND display_profiles.display_rn = 1
      INNER JOIN ranked_profiles AS birthdate_profiles
        ON birthdate_profiles."identityId" = requested_identities."identityId"
        AND birthdate_profiles.birthdate_rn = 1
```

(Every identity that has any profile has a `birthdate_rn = 1` row drawn from the same `profiles` population as `display_rn`/`primary_rn`, so this INNER JOIN never drops an identity the query already returned. Guarded by Task 6.)

- [ ] **Step 6: Type-check**

Run from `server/`:

```bash
pnpm exec tsc --noEmit
```

Expected: no errors. (The output row type `HydratedAccessiblePersonRow` is unchanged — we added no projected output columns, only internal CTE columns.)

- [ ] **Step 7: Run the repro test and confirm it now PASSES**

Run from `server/`:

```bash
pnpm test:medium -- --run test/medium/specs/repositories/face-identity.repository.spec.ts -t "resolves a space-set birthday for the owner"
```

Expected: PASS.

- [ ] **Step 8: Run the whole face-identity medium spec (no regression)**

Run from `server/`:

```bash
pnpm test:medium -- --run test/medium/specs/repositories/face-identity.repository.spec.ts
```

Expected: all pass — including the existing `'uses a named accessible space profile for display while keeping a viewer-owned primary profile'` test (owner-birthday-only still resolves; name projection untouched).

- [ ] **Step 9: Regenerate the SQL mirror**

The `@GenerateSql` decorator means CI re-runs generation and fails if `src/queries/face.identity.repository.sql` is stale. Build, then regenerate. From repo root:

```bash
make sql
```

If `make sql` is unavailable in this environment, run from `server/`:

```bash
pnpm build && pnpm sync:sql
```

Then confirm the mirror picked up the change:

```bash
git --no-pager diff --stat server/src/queries/face.identity.repository.sql
git --no-pager diff server/src/queries/face.identity.repository.sql | grep -E "birthdate_rn|birthDateSource" | head
```

Expected: the file is modified and contains `birthdate_rn` and `birthDateSource`.

- [ ] **Step 10: Commit the fix + regenerated SQL together**

```bash
git add server/src/repositories/face-identity.repository.ts server/src/queries/face.identity.repository.sql
git commit -m "fix(face-identity): resolve birthday from any identity profile, not just the name-winner"
```

---

## Task 3: Single-person view parity

Same SQL backs `getAccessiblePersonByProfileId`. Lock that the single-person endpoint resolves the space birthday too.

**Files:**

- Test: `server/test/medium/specs/repositories/face-identity.repository.spec.ts`

- [ ] **Step 1: Add the test (place after the Task 1 test block)**

```ts
it('resolves a space-set birthday via the single-person view', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
  const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ina' });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  const identity = await sut.ensurePersonIdentity(person.id);
  await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: space.id,
      identityId: identity.id,
      name: '',
      representativeFaceId: assetFace.id,
      type: 'person',
      birthDate: '2014-02-14',
      birthDateSource: 'manual',
      birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
    .execute();

  try {
    const result = await sut.getAccessiblePersonByProfileId(user.id, person.id);

    expect(result).toEqual(expect.objectContaining({ id: person.id, name: 'Ina', birthDate: '2014-02-14' }));
  } finally {
    await ctx.database.deleteFrom('shared_space_person').where('id', '=', spacePerson.id).execute();
    await ctx.database
      .deleteFrom('shared_space_asset')
      .where('spaceId', '=', space.id)
      .where('assetId', '=', asset.id)
      .execute();
  }
});
```

- [ ] **Step 2: Run and confirm PASS**

```bash
pnpm test:medium -- --run test/medium/specs/repositories/face-identity.repository.spec.ts -t "resolves a space-set birthday via the single-person view"
```

Expected: PASS (shared SQL).

- [ ] **Step 3: Commit**

```bash
git add server/test/medium/specs/repositories/face-identity.repository.spec.ts
git commit -m "test(face-identity): single-person view resolves space-set birthday"
```

---

## Task 4: Owner precedence over a space value

Guards the `user-person`-first ORDER BY term. Owner has a birthday; a space has a _different_ `manual` birthday with a _newer_ source timestamp. The owner's value must still win (a recency-only ranking would wrongly pick the space value).

**Files:**

- Test: `server/test/medium/specs/repositories/face-identity.repository.spec.ts`

- [ ] **Step 1: Add the test**

```ts
it('prefers the owner birthday over a more-recent space birthday', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
  const { person } = await ctx.newPerson({
    ownerId: user.id,
    name: 'Ina',
    birthDate: new Date('1990-01-01T00:00:00.000Z'),
  });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  const identity = await sut.ensurePersonIdentity(person.id);
  await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: space.id,
      identityId: identity.id,
      name: '',
      representativeFaceId: assetFace.id,
      type: 'person',
      birthDate: '2014-02-14',
      birthDateSource: 'manual',
      birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'), // newer than the owner
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
    .execute();

  try {
    const result = await sut.getAccessiblePeople(user.id, { withHidden: false, page: 1, size: 50 });

    expect(result.people).toEqual([expect.objectContaining({ id: person.id, birthDate: '1990-01-01' })]);
  } finally {
    await ctx.database.deleteFrom('shared_space_person').where('id', '=', spacePerson.id).execute();
    await ctx.database
      .deleteFrom('shared_space_asset')
      .where('spaceId', '=', space.id)
      .where('assetId', '=', asset.id)
      .execute();
  }
});
```

- [ ] **Step 2: Run and confirm PASS**

```bash
pnpm test:medium -- --run test/medium/specs/repositories/face-identity.repository.spec.ts -t "prefers the owner birthday"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/test/medium/specs/repositories/face-identity.repository.spec.ts
git commit -m "test(face-identity): owner birthday wins over a newer space birthday"
```

---

## Task 5: Cross-space ordering — recency tiebreak + manual-over-inherited

Two guards for the two cross-space ORDER BY terms. (a) Recency: two `manual` spaces, owner has none — the winner is given the **older** `updatedAt`/`profileId` but the **newer** `birthDateSourceUpdatedAt`, so only the `birthDateSourceUpdatedAt DESC` term selects it. (b) Source tier: a `manual` value must beat an `inherited` value even when the inherited one is more recent.

**Files:**

- Test: `server/test/medium/specs/repositories/face-identity.repository.spec.ts`

- [ ] **Step 1: Add a helper to build a second accessible space-person on the same identity, then the test**

Add this test (it creates two spaces the user owns, both linked to the same identity via the same asset face):

```ts
it('picks the most-recently edited manual birthday across spaces', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ina' }); // owner: no birthday
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  const identity = await sut.ensurePersonIdentity(person.id);
  await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });

  const { space: spaceA } = await ctx.newSharedSpace({ createdById: user.id });
  await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: user.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceAsset({ spaceId: spaceA.id, assetId: asset.id, addedById: user.id });
  const { space: spaceB } = await ctx.newSharedSpace({ createdById: user.id });
  await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: user.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceAsset({ spaceId: spaceB.id, assetId: asset.id, addedById: user.id });

  // Older edit, but inserted LAST (so a profileId/updatedAt-only ordering would pick it).
  const newerWinner = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: spaceA.id,
      identityId: identity.id,
      name: '',
      representativeFaceId: assetFace.id,
      type: 'person',
      birthDate: '2014-02-14',
      birthDateSource: 'manual',
      birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'), // most recent
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: newerWinner.id, assetFaceId: assetFace.id })
    .execute();

  const olderLoser = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: spaceB.id,
      identityId: identity.id,
      name: '',
      representativeFaceId: assetFace.id,
      type: 'person',
      birthDate: '2013-02-14',
      birthDateSource: 'manual',
      birthDateSourceUpdatedAt: new Date('2025-01-01T00:00:00.000Z'), // older
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: olderLoser.id, assetFaceId: assetFace.id })
    .execute();

  try {
    const result = await sut.getAccessiblePeople(user.id, { withHidden: false, page: 1, size: 50 });
    expect(result.people).toEqual([expect.objectContaining({ id: person.id, birthDate: '2014-02-14' })]);
  } finally {
    await ctx.database.deleteFrom('shared_space_person').where('id', 'in', [newerWinner.id, olderLoser.id]).execute();
  }
});

it('prefers a manual birthday over a more-recent inherited one', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ina' }); // owner: no birthday
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  const identity = await sut.ensurePersonIdentity(person.id);
  await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });

  const { space: spaceA } = await ctx.newSharedSpace({ createdById: user.id });
  await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: user.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceAsset({ spaceId: spaceA.id, assetId: asset.id, addedById: user.id });
  const { space: spaceB } = await ctx.newSharedSpace({ createdById: user.id });
  await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: user.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceAsset({ spaceId: spaceB.id, assetId: asset.id, addedById: user.id });

  const manualWinner = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: spaceA.id,
      identityId: identity.id,
      name: '',
      representativeFaceId: assetFace.id,
      type: 'person',
      birthDate: '2014-02-14',
      birthDateSource: 'manual',
      birthDateSourceUpdatedAt: new Date('2025-01-01T00:00:00.000Z'), // older
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: manualWinner.id, assetFaceId: assetFace.id })
    .execute();

  const inheritedLoser = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: spaceB.id,
      identityId: identity.id,
      name: '',
      representativeFaceId: assetFace.id,
      type: 'person',
      birthDate: '2013-02-14',
      birthDateSource: 'inherited',
      birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'), // newer, but inherited
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: inheritedLoser.id, assetFaceId: assetFace.id })
    .execute();

  try {
    const result = await sut.getAccessiblePeople(user.id, { withHidden: false, page: 1, size: 50 });
    expect(result.people).toEqual([expect.objectContaining({ id: person.id, birthDate: '2014-02-14' })]);
  } finally {
    await ctx.database
      .deleteFrom('shared_space_person')
      .where('id', 'in', [manualWinner.id, inheritedLoser.id])
      .execute();
  }
});
```

- [ ] **Step 2: Run both and confirm PASS**

```bash
pnpm test:medium -- --run test/medium/specs/repositories/face-identity.repository.spec.ts -t "most-recently edited manual birthday"
pnpm test:medium -- --run test/medium/specs/repositories/face-identity.repository.spec.ts -t "manual birthday over a more-recent inherited"
```

Expected: both PASS (resolve `2014-02-14`).

- [ ] **Step 3: Commit**

```bash
git add server/test/medium/specs/repositories/face-identity.repository.spec.ts
git commit -m "test(face-identity): most-recent manual + manual-over-inherited birthday selection"
```

---

## Task 6: Boundary guards — no-birthday, hidden exclusion, no cross-space leak

Three guards in one task (each its own `it`): they assert behavior the new INNER JOIN and visibility scoping must preserve.

**Files:**

- Test: `server/test/medium/specs/repositories/face-identity.repository.spec.ts`

- [ ] **Step 1: Add the three guard tests**

```ts
it('returns the person with a null birthday when no profile has one', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
  const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ina' });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  const identity = await sut.ensurePersonIdentity(person.id);
  await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: space.id,
      identityId: identity.id,
      name: '',
      representativeFaceId: assetFace.id,
      type: 'person',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
    .execute();

  try {
    const result = await sut.getAccessiblePeople(user.id, { withHidden: false, page: 1, size: 50 });
    expect(result.people).toEqual([expect.objectContaining({ id: person.id, name: 'Ina', birthDate: null })]);
  } finally {
    await ctx.database.deleteFrom('shared_space_person').where('id', '=', spacePerson.id).execute();
    await ctx.database
      .deleteFrom('shared_space_asset')
      .where('spaceId', '=', space.id)
      .where('assetId', '=', asset.id)
      .execute();
  }
});

it('does not surface a birthday from a hidden space profile unless withHidden is set', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
  const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ina' });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  const identity = await sut.ensurePersonIdentity(person.id);
  await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: space.id,
      identityId: identity.id,
      name: '',
      representativeFaceId: assetFace.id,
      type: 'person',
      isHidden: true,
      birthDate: '2014-02-14',
      birthDateSource: 'manual',
      birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
    .execute();

  try {
    const hiddenExcluded = await sut.getAccessiblePeople(user.id, { withHidden: false, page: 1, size: 50 });
    expect(hiddenExcluded.people).toEqual([expect.objectContaining({ id: person.id, birthDate: null })]);

    const hiddenIncluded = await sut.getAccessiblePeople(user.id, { withHidden: true, page: 1, size: 50 });
    expect(hiddenIncluded.people).toEqual([expect.objectContaining({ id: person.id, birthDate: '2014-02-14' })]);
  } finally {
    await ctx.database.deleteFrom('shared_space_person').where('id', '=', spacePerson.id).execute();
    await ctx.database
      .deleteFrom('shared_space_asset')
      .where('spaceId', '=', space.id)
      .where('assetId', '=', asset.id)
      .execute();
  }
});

it('does not leak a birthday from a space hidden from the viewer timeline', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
  const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ina' });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  const identity = await sut.ensurePersonIdentity(person.id);
  await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: space.id,
      identityId: identity.id,
      name: '',
      representativeFaceId: assetFace.id,
      type: 'person',
      birthDate: '2014-02-14',
      birthDateSource: 'manual',
      birthDateSourceUpdatedAt: new Date('2026-06-10T20:41:12.000Z'),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
    .execute();
  // Hide the space from the viewer's timeline -> excluded from timeline_spaces.
  await setMemberTimeline(ctx, { spaceId: space.id, userId: user.id, showInTimeline: false });

  try {
    const result = await sut.getAccessiblePeople(user.id, { withHidden: false, page: 1, size: 50 });
    expect(result.people).toEqual([expect.objectContaining({ id: person.id, birthDate: null })]);
  } finally {
    await ctx.database.deleteFrom('shared_space_person').where('id', '=', spacePerson.id).execute();
    await ctx.database
      .deleteFrom('shared_space_asset')
      .where('spaceId', '=', space.id)
      .where('assetId', '=', asset.id)
      .execute();
  }
});
```

- [ ] **Step 2: Run the three guards and confirm PASS**

```bash
pnpm test:medium -- --run test/medium/specs/repositories/face-identity.repository.spec.ts -t "null birthday"
pnpm test:medium -- --run test/medium/specs/repositories/face-identity.repository.spec.ts -t "hidden space profile"
pnpm test:medium -- --run test/medium/specs/repositories/face-identity.repository.spec.ts -t "hidden from the viewer timeline"
```

Expected: all PASS.

> Note: if the no-birthday guard fails because the person row is _missing entirely_ (not just `birthDate: null`), the new `INNER JOIN ranked_profiles AS birthdate_profiles` is dropping the identity — revisit Task 2 Step 5 (it must not filter out identities that have profiles).

- [ ] **Step 3: Commit**

```bash
git add server/test/medium/specs/repositories/face-identity.repository.spec.ts
git commit -m "test(face-identity): birthday resolution boundary guards (none/hidden/visibility)"
```

---

## Task 7: Full-suite verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the complete face-identity medium spec**

```bash
pnpm test:medium -- --run test/medium/specs/repositories/face-identity.repository.spec.ts
```

Expected: all tests pass (existing + 8 new).

- [ ] **Step 2: Run the related shared-space medium specs (no regression)**

```bash
pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts test/medium/specs/services/shared-space-person-metadata-rbac.spec.ts
```

Expected: pass.

- [ ] **Step 3: Confirm generated SQL is committed and not stale**

```bash
make sql
git --no-pager status --porcelain server/src/queries/face.identity.repository.sql
```

Expected: empty output (no diff — the mirror was already regenerated and committed in Task 2).

- [ ] **Step 4: Type-check the server**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: (Optional) Manual smoke against a running stack**

If a `make dev` stack is available: as a space editor, set a birthday on a named person; log in as the library owner; open the same person in `/people` — the birthday now shows. (This mirrors the spec's reproduction, expecting the field to be populated rather than empty.)

---

## Notes for the implementer

- **Do not** add a write to the `person` table or change `inheritSpacePersonMetadata` / the backfill — this is a read-time-only fix by design (see spec "Scope / non-goals"). Stored per-space rows may still diverge; that is intentional and out of scope.
- **Lint gate is deferred:** run `pnpm exec tsc --noEmit` in the loop; the full `pnpm lint` (eslint, slow) is a single final gate, not per-task.
- The eight new tests are all in one file; keep them grouped near the existing `getAccessiblePeople` display tests (after the `'uses a named accessible space profile…'` test).
- If `pnpm test:medium` cannot pull/start the Postgres testcontainer, ensure Docker is running (Task 0 Step 2) — the failure is environmental, not a code regression.
