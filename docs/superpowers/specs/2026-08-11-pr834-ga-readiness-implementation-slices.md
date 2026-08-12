# PR #834 GA-Readiness Implementation Plan

> **For agentic workers:** This spec is written for `/impl-loop`. It is organised into numbered slices (`## Slice 1` … `## Slice 15`); each slice is independently plannable, testable and committable. `/impl-loop` will produce one plan per slice under `docs/superpowers/plans/2026-08-11-pr834-ga-readiness-slice-<n>.md` and execute it with superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking. Slices may be started at any point; the only ordering constraints are recorded under "Ordering constraints between slices" below.

**Goal:** Close the four blockers, six high-severity defects, mutation-verified test gaps, and the worst of the upstream-conflict surface found in the #834 correctness review, so the unified face-verdict layer can ship to GA.

**Architecture:** Three kinds of change, deliberately kept separate. (1) Behavioural fixes to the verdict layer and its config, each one small and each one guarded by a test that fails first. (2) Test hardening, where the "failing test" is literally the mutation that currently survives — write the assertion, prove it catches the mutation, restore. (3) A mechanical extraction of the fork's suggestion engine out of upstream-owned files into fork-owned ones, with no behaviour change at all.

**Tech Stack:** NestJS 11 + Kysely (server), SvelteKit + Svelte 5 runes (web), Vitest (unit + medium), Playwright (e2e), Zod DTOs, BullMQ, PostgreSQL 14.

---

## Global Constraints

- **Fork migrations go in `server/src/schema/migrations-gallery/`**, never `server/src/schema/migrations/`. Use round timestamps (e.g. `1790000000000`) that collide with nothing in either directory.
- **A migration that changes an index or constraint whose SQL does not round-trip through `pg_get_expr` must also write a `migration_overrides` row**, following the exact pattern in `1783050000000-AddFaceRepairScanInFlightIndex.ts`. Otherwise `schema-drift.spec.ts` goes red.
- **Any new or edited user-facing string must land in all ten locales in the same commit**: `en` plus `de · fr · it · nl · pl · es · ru · zh_Hans · zh_Hant`. Keys are alphabetically sorted, 2-space indent, unescaped Unicode. Run `npx prettier --write i18n/*.json` from the repo root afterwards.
- **Never hand-edit the ~80 translator-owned locale files** (`mr.json`, `ms.json`, etc.).
- **Never add `Co-Authored-By` or `Generated-with` trailers to commits.**
- **New tables/indexes/migrations must be added to `scripts/revert-to-immich.sql`.** This plan adds no new tables; slice 7 adds one index and one migration name, which must be appended there.
- **Every slice ends green on its own gates.** A slice is not done until its own tests pass _and_ `pnpm exec eslint <changed files> --max-warnings 0` and `pnpm exec prettier --check <changed files>` are clean.
- **Do not "fix" `lock`-related behaviour beyond slice 2.** The decision recorded there (unlocked moves write `owner-person`) is deliberate and other slices depend on it.

## Ordering constraints between slices

Everything else is independent and may be done in any order, or in parallel.

- **Slice 5 after slice 2** — both edit `executeRepair`'s transaction body. Re-run `face-repair.resolve.spec.ts` after each.
- **Slice 9 step 0 before slice 9 steps 1-4** — the shared `FORK_LOCALES` module must exist before either i18n spec imports it.
- **Slice 13 after slices 1-12** — the extraction moves ~1,700 spec lines; doing it first would force every earlier slice to be written against files that are about to move.
- **Phase 1 (slices 1-4) is independently shippable.** If GA timing gets tight, it alone removes every user-visible data hazard.

## Test conventions — TDD and BDD

**TDD is mandatory and literal.** Every slice writes the test first, runs it to observe a _specific_ named failure, implements the minimum to pass, and re-runs. A test that passes on its first run is a red flag: it means the test does not exercise the defect, and it must be fixed before the implementation is written. Phase 3 inverts this — the "red" step is applying a mutation and confirming the suite is green — but the discipline is the same: never write an assertion you have not watched fail.

**BDD is expressed in the idiom this codebase already uses**, not in Gherkin. The repo has no Cucumber runner, and introducing one for fifteen slices would conflict with the "consistent with the codebase" requirement. Instead, every test in this spec follows:

- `describe(...)` names the **context** — the unit and the state it is in.
- `it(...)` states an **observable behaviour in plain language**, phrased as what the system does, never as what the code contains. `it('refuses a space reject on a face the caller does not own')`, not `it('calls requireAccess')`.
- Where the behaviour is not obvious from the name, a **GIVEN / WHEN / THEN comment** sits directly above the test, as in slices 1, 7, 8 and 10. Use it whenever the scenario has preconditions a reader cannot infer.
- The body follows **arrange / act / assert** in that order, with no assertions interleaved into setup.

**Every behavioural test needs a positive control.** An assertion that something is absent, excluded, skipped or rejected proves nothing on its own — a broken fixture, a typo'd testid or a query that returns nothing produces the same green. Pair it with the case that _should_ be present. This is not a stylistic preference: the review that produced this spec found three assertions targeting testids that exist in no component, and a medium test whose act was a proven no-op. Both classes were green.

## Verification Commands (use these exact forms)

These are the invocations that actually work in this repo. Two obvious-looking alternatives are traps and must not be used.

```bash
# Server unit — a SINGLE file. The --config flag is required; without it vitest
# runs without globals and every spec dies with "describe is not defined".
cd server && pnpm exec vitest run --config test/vitest.config.mjs src/path/to/file.spec.ts

# TRAP — do NOT use. The file filter is silently dropped and all ~5,600 tests run:
#   pnpm test -- --run src/path/to/file.spec.ts

# Server medium (needs Docker running)
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/path/file.spec.ts

# Server whole unit suite
cd server && pnpm test

# Web — single file, and the whole face-cleanup tree
cd web && pnpm exec vitest run src/routes/admin/face-cleanup/resolutions/page.spec.ts
cd web && pnpm exec vitest run src/routes/admin/face-cleanup/

# Web gates. check:svelte MUST be run via the script — a bare `svelte-check` uses a
# different file set (it pulls in .spec.ts files CI never checks) and reports
# hundreds of pre-existing errors that are not real.
cd web && pnpm run check:svelte && pnpm run check:typescript

# Server type check
cd server && pnpm exec tsc --noEmit
```

---

# Phase 1 — Blockers

## Slice 1: Stop the suggestion band inverting on upgrade (B1)

An existing install with `machineLearning.facialRecognition.maxDistance >= 0.7` has no `suggestions` block, so `buildConfig` fills in the new default `0.7`, which is `<=` their own `maxDistance`. `utils/config.ts` then **throws** in config-file mode (boot crash-loop), and on DB config `person.service.ts` `onConfigValidate` throws on every `updateSystemConfig` — and because `handleSystemConfigSave` PUTs the whole config, _every_ admin settings page returns 400.

Decision: **derive** the default so the band is always valid, clamped to the schema maximum of 2.

**Files:**

- Modify: `server/src/utils/config.ts` (add `deriveSuggestionBand`, call it in `buildConfig`)
- Test: `server/src/utils/config.spec.ts`

**Interfaces:**

- Produces: `export const deriveSuggestionBand = (partial: unknown, merged: SystemConfig): SystemConfig` — mutates nothing, returns a config whose `machineLearning.facialRecognition.suggestions.maxDistance` is guaranteed `> maxDistance` unless the admin set it explicitly.

- [ ] **Step 1: Write the failing tests**

Add to `server/src/utils/config.spec.ts`:

```ts
describe('deriveSuggestionBand', () => {
  const build = (facialRecognitionMaxDistance: number, partialSuggestions?: object) => ({
    machineLearning: {
      facialRecognition: {
        maxDistance: facialRecognitionMaxDistance,
        suggestions: { enabled: true, maxDistance: 0.7, ...partialSuggestions },
      },
    },
  });

  it("raises the default band above an upgraded install's recognition distance", () => {
    // The B1 upgrade shape: a config that predates `suggestions` entirely.
    const partial = { machineLearning: { facialRecognition: { maxDistance: 0.8 } } };
    const result = deriveSuggestionBand(partial, build(0.8) as never);
    expect(result.machineLearning.facialRecognition.suggestions.maxDistance).toBe(1);
  });

  it('leaves the default alone when the band is already valid', () => {
    const partial = { machineLearning: { facialRecognition: { maxDistance: 0.5 } } };
    const result = deriveSuggestionBand(partial, build(0.5) as never);
    expect(result.machineLearning.facialRecognition.suggestions.maxDistance).toBe(0.7);
  });

  it('never derives above the schema maximum of 2', () => {
    const partial = { machineLearning: { facialRecognition: { maxDistance: 2 } } };
    const result = deriveSuggestionBand(partial, build(2) as never);
    expect(result.machineLearning.facialRecognition.suggestions.maxDistance).toBe(2);
    // At the ceiling the band cannot be valid, so the feature must switch itself off
    // rather than leave a config that fails its own invariant.
    expect(result.machineLearning.facialRecognition.suggestions.enabled).toBe(false);
  });

  it('does NOT override a band the admin set explicitly, even an invalid one', () => {
    // An explicit inverted band is a real misconfiguration and must still be reported,
    // not silently repaired — otherwise the admin never learns their setting is wrong.
    const partial = {
      machineLearning: { facialRecognition: { maxDistance: 0.8, suggestions: { enabled: true, maxDistance: 0.6 } } },
    };
    const result = deriveSuggestionBand(partial, build(0.8, { maxDistance: 0.6 }) as never);
    expect(result.machineLearning.facialRecognition.suggestions.maxDistance).toBe(0.6);
  });

  it('does not touch a partial that has no facialRecognition section at all', () => {
    const partial = { server: { externalDomain: 'https://example.com' } };
    const result = deriveSuggestionBand(partial, build(0.5) as never);
    expect(result.machineLearning.facialRecognition.suggestions.maxDistance).toBe(0.7);
  });
});

describe('buildConfig (B1 upgrade path)', () => {
  // GIVEN a config-file install that raised the recognition distance before `suggestions` existed
  // WHEN the server boots on the new image
  // THEN it must start, rather than throwing the band-inversion error and crash-looping.
  it('boots a config-file install whose recognition distance exceeds the suggestion default', async () => {
    const configMock = newConfigRepositoryMock();
    configMock.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich.yaml' }));
    const metadataMock = newSystemMetadataRepositoryMock();
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      'machineLearning:\n  facialRecognition:\n    maxDistance: 0.8\n',
    );

    await expect(
      getConfig({ configRepo: configMock, metadataRepo: metadataMock, logger: newLoggerMock() }, { withCache: false }),
    ).resolves.toBeDefined();
  });
});
```

Build the repos from the mocks this file already imports — `newConfigRepositoryMock`, `newSystemMetadataRepositoryMock` and `mockEnvData` (`server/src/utils/config.spec.ts:1-7`). Do **not** invent a new harness. `getConfig(repos, { withCache })` is the real signature (`utils/config.ts:28`); pass `withCache: false` or the module-level cache leaks between tests.

- [ ] **Step 2: Run to verify they fail**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.mjs src/utils/config.spec.ts
```

Expected: FAIL — `deriveSuggestionBand is not defined`, and the `buildConfig` test fails with the "must be greater than" throw.

- [ ] **Step 3: Implement**

In `server/src/utils/config.ts`, directly below `foldLegacyFaceSuggestionConfig`:

```ts
const SUGGESTIONS_MAX_DISTANCE_PATH: string = 'machineLearning.facialRecognition.suggestions.maxDistance';
const FACIAL_RECOGNITION_MAX_DISTANCE_PATH: string = 'machineLearning.facialRecognition.maxDistance';
// FaceSuggestionConfigSchema caps maxDistance at 2 (dtos/model-config.dto.ts).
const SUGGESTION_MAX_DISTANCE_CEILING = 2;
const SUGGESTION_BAND_HEADROOM = 0.2;

/**
 * Keeps the suggestion band valid for installs that raised `facialRecognition.maxDistance` before
 * `suggestions` existed. Their partial carries no suggestions block, so the merge fills in the 0.7
 * default — which inverts against any recognition distance >= 0.7 and hard-fails `buildConfig` in
 * config-file mode. Only ever adjusts a band the admin did NOT set: an explicitly configured inverted
 * band is a real misconfiguration and must still surface.
 */
export const deriveSuggestionBand = (partial: unknown, merged: SystemConfig): SystemConfig => {
  if (_.get(partial, SUGGESTIONS_MAX_DISTANCE_PATH) !== undefined) {
    return merged;
  }

  const maxDistance = merged.machineLearning.facialRecognition.maxDistance;
  const { suggestions } = merged.machineLearning.facialRecognition;
  if (suggestions.maxDistance > maxDistance) {
    return merged;
  }

  const derived = Math.min(maxDistance + SUGGESTION_BAND_HEADROOM, SUGGESTION_MAX_DISTANCE_CEILING);
  const config = _.cloneDeep(merged);
  config.machineLearning.facialRecognition.suggestions.maxDistance = derived;
  // At the ceiling no valid band exists. Disable rather than ship a config that fails its own
  // invariant on every save.
  if (derived <= maxDistance) {
    config.machineLearning.facialRecognition.suggestions.enabled = false;
  }
  return config;
};
```

Then in `buildConfig`, replace the single line

```ts
const config = (result.success ? result.data : rawConfig) as SystemConfig;
```

with

```ts
const config = deriveSuggestionBand(partial, (result.success ? result.data : rawConfig) as SystemConfig);
```

- [ ] **Step 4: Run to verify they pass**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.mjs src/utils/config.spec.ts
cd server && pnpm exec vitest run --config test/vitest.config.mjs src/services/system-config.service.spec.ts
```

Expected: PASS both.

- [ ] **Step 5: Document the derivation**

`docs/docs/administration/face-cleanup.md` — in the suggestions section, add one sentence: the suggestion distance defaults to 0.2 above the recognition distance (minimum 0.7), and an install already above that keeps a valid band automatically.

- [ ] **Step 6: Commit**

```bash
git add server/src/utils/config.ts server/src/utils/config.spec.ts docs/docs/administration/face-cleanup.md
git commit -m "fix(face-suggestions): derive the suggestion band so upgraded installs still boot"
```

---

## Slice 2: Make `lock: false` mean something (B2)

`executeRepair` writes `source: 'manual'` for **every** moved face. A manual link is the strongest verdict in the system — `getManualLinkedFaceIds` and the pending-eligibility anti-join (`face-person-verdict.repository.ts:150`) both exclude those faces from every scan and every suggestion queue, permanently. Meanwhile `MoveGroupSchema.lock` defaults to `false` and documents "plain moves stay undurable unless the caller opts in", the web client deliberately passes `lock: false` for suggested-owner moves, and the response reports `locked: 0` for faces it just made unreviewable.

Decision: **honour the flag.** An unlocked move still re-points the identity link (not doing so would leave the face carrying the _source_ person's identity — the torn state `FaceIdentityBackfill` can silently revert), but writes `source: 'owner-person'`, the ordinary "this face sits on this owner's person" link, which no engine treats as settled.

Edge case, decided and tested below: an unlocked move of a face that **already** carries `source='manual'` writes `owner-person` too — it does _not_ preserve the old manual flag. A lock is a statement about a (face, person) pairing; moving the face to a different person invalidates it, and preserving `manual` would fabricate a human confirmation for a target no human ever confirmed.

**Files:**

- Modify: `server/src/services/face-repair.service.ts` (`FlaggedFace`, `executeRepair`, `resolveFaces`, the `moveLocked` tally)
- Test: `server/src/services/face-repair.execute-repair.spec.ts`, `server/test/medium/specs/services/face-repair.resolve.spec.ts`

**Interfaces:**

- Produces: `FlaggedFace` gains `lock?: boolean`. Absent means `true` (the scan's own auto-repair path keeps today's durable behaviour). `executeRepair` groups routes by `from|to|lock`.

- [ ] **Step 1: Write the failing tests**

In `server/src/services/face-repair.execute-repair.spec.ts`:

```ts
it('writes a manual link for a locked move', async () => {
  mocks.person.getById.mockImplementation((id: string) => Promise.resolve({ id, ownerId: 'u1' } as never));
  mocks.faceRepair.reattributeFaces.mockResolvedValue(['f1']);
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as never);

  await sut.executeRepair({
    toRepair: [{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'p2', lock: true }],
    reviewOnlyFaces: [],
    reviewOnlyPersonIds: [],
    unAttributableFaces: [],
    perPerson: [],
  });

  expect(mocks.faceIdentity.replaceFaceIdentities).toHaveBeenCalledWith(
    { assetFaceIds: ['f1'], identityId: 'identity-1', source: 'manual' },
    expect.anything(),
  );
});

it('writes an owner-person link for an UNLOCKED move, so a future scan may still question it', async () => {
  mocks.person.getById.mockImplementation((id: string) => Promise.resolve({ id, ownerId: 'u1' } as never));
  mocks.faceRepair.reattributeFaces.mockResolvedValue(['f1']);
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as never);

  await sut.executeRepair({
    toRepair: [{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'p2', lock: false }],
    reviewOnlyFaces: [],
    reviewOnlyPersonIds: [],
    unAttributableFaces: [],
    perPerson: [],
  });

  expect(mocks.faceIdentity.replaceFaceIdentities).toHaveBeenCalledWith(
    { assetFaceIds: ['f1'], identityId: 'identity-1', source: 'owner-person' },
    expect.anything(),
  );
});

it('still re-points the identity on an unlocked move — never leaves the source identity attached', async () => {
  // Without the relink the face sits on p2 carrying p1's identity, which FaceIdentityBackfill
  // resolves back to p1 and silently reverts the move.
  mocks.person.getById.mockImplementation((id: string) => Promise.resolve({ id, ownerId: 'u1' } as never));
  mocks.faceRepair.reattributeFaces.mockResolvedValue(['f1']);
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-of-p2' } as never);

  await sut.executeRepair({
    toRepair: [{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'p2', lock: false }],
    reviewOnlyFaces: [],
    reviewOnlyPersonIds: [],
    unAttributableFaces: [],
    perPerson: [],
  });

  expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith('p2', expect.anything());
  expect(mocks.faceIdentity.replaceFaceIdentities).toHaveBeenCalledWith(
    expect.objectContaining({ identityId: 'identity-of-p2' }),
    expect.anything(),
  );
});

it('defaults an omitted lock flag to durable, preserving the scan auto-repair path', async () => {
  mocks.person.getById.mockImplementation((id: string) => Promise.resolve({ id, ownerId: 'u1' } as never));
  mocks.faceRepair.reattributeFaces.mockResolvedValue(['f1']);
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as never);

  await sut.executeRepair({
    toRepair: [{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'p2' }],
    reviewOnlyFaces: [],
    reviewOnlyPersonIds: [],
    unAttributableFaces: [],
    perPerson: [],
  });

  expect(mocks.faceIdentity.replaceFaceIdentities).toHaveBeenCalledWith(
    expect.objectContaining({ source: 'manual' }),
    expect.anything(),
  );
});

it('does not collapse locked and unlocked faces on the same route into one write', async () => {
  // Route keys must include the lock flag, or one bucket silently inherits the other's durability.
  mocks.person.getById.mockImplementation((id: string) => Promise.resolve({ id, ownerId: 'u1' } as never));
  mocks.faceRepair.reattributeFaces.mockImplementation((_f, _t, ids: string[]) => Promise.resolve(ids));
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as never);

  await sut.executeRepair({
    toRepair: [
      { assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'p2', lock: true },
      { assetFaceId: 'f2', currentPersonId: 'p1', suspectedOwnerId: 'p2', lock: false },
    ],
    reviewOnlyFaces: [],
    reviewOnlyPersonIds: [],
    unAttributableFaces: [],
    perPerson: [],
  });

  expect(mocks.faceIdentity.replaceFaceIdentities).toHaveBeenCalledWith(
    { assetFaceIds: ['f1'], identityId: 'identity-1', source: 'manual' },
    expect.anything(),
  );
  expect(mocks.faceIdentity.replaceFaceIdentities).toHaveBeenCalledWith(
    { assetFaceIds: ['f2'], identityId: 'identity-1', source: 'owner-person' },
    expect.anything(),
  );
});
```

Add the medium test in `server/test/medium/specs/services/face-repair.resolve.spec.ts` — this is the one that proves the user-visible consequence:

```ts
it('an unlocked move leaves the face re-flaggable, a locked move does not', async () => {
  const { personA, personB, faceUnlocked, faceLocked } = await seedTwoPersonCluster();

  await sut.resolveFaces(auth, personA.id, {
    moveToPerson: [
      { destinationPersonId: personB.id, faceIds: [faceUnlocked], lock: false },
      { destinationPersonId: personB.id, faceIds: [faceLocked], lock: true },
    ],
  });

  const manual = await ctx.get(FaceIdentityRepository).getManualLinkedFaceIds([faceUnlocked, faceLocked]);
  expect(manual.has(faceLocked)).toBe(true);
  expect(manual.has(faceUnlocked)).toBe(false); // positive control above proves the query works
});

it('an unlocked move of an already-locked face clears the lock rather than moving it', async () => {
  const { personA, personB, face } = await seedTwoPersonCluster();
  await sut.resolveFaces(auth, personA.id, { lock: [face] });
  expect((await ctx.get(FaceIdentityRepository).getManualLinkedFaceIds([face])).has(face)).toBe(true);

  await sut.resolveFaces(auth, personA.id, {
    moveToPerson: [{ destinationPersonId: personB.id, faceIds: [face], lock: false }],
  });

  // Preserving 'manual' here would fabricate a human confirmation for personB, whom no human confirmed.
  expect((await ctx.get(FaceIdentityRepository).getManualLinkedFaceIds([face])).has(face)).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.mjs src/services/face-repair.execute-repair.spec.ts
```

Expected: FAIL — the unlocked cases receive `source: 'manual'`.

- [ ] **Step 3: Implement**

`server/src/services/face-repair.service.ts`:

```ts
export interface FlaggedFace {
  assetFaceId: string;
  currentPersonId: string;
  suspectedOwnerId: string;
  // Whether this move should write the durable `manual` identity link. Omitted means true: the scan's own
  // auto-repair path has always been durable and stays that way. The interactive resolve path threads the
  // caller's MoveGroup.lock, which defaults to false.
  lock?: boolean;
}
```

In `executeRepair`, key routes by the flag and carry it through:

```ts
const routes = new Map<string, { from: string; to: string; lock: boolean; faceIds: string[] }>();
for (const face of plan.toRepair) {
  const lock = face.lock ?? true;
  const key = `${face.currentPersonId}|${face.suspectedOwnerId}|${lock}`;
  const route = routes.get(key) ?? { from: face.currentPersonId, to: face.suspectedOwnerId, lock, faceIds: [] };
  route.faceIds.push(face.assetFaceId);
  routes.set(key, route);
}
```

```ts
    for (const { from, to, lock, faceIds } of routes.values()) {
```

and inside the transaction:

```ts
await this.faceIdentityRepository.replaceFaceIdentities(
  { assetFaceIds: ids, identityId: identity.id, source: lock ? 'manual' : 'owner-person' },
  trx,
);
```

In `resolveFaces`, thread the group's flag into both push sites:

```ts
toRepair.push({
  assetFaceId,
  currentPersonId: personId,
  suspectedOwnerId: group.destinationPersonId,
  lock: group.lock,
});
```

```ts
for (const assetFaceId of clusterFaceIds) {
  // `entireCluster` carries no lock field, by design: PersonPicker hides the lock toggle for a
  // whole-cluster move "rather than showing a toggle its request cannot carry". Omitting `lock`
  // here falls through to the `?? true` default, preserving exactly today's durable behaviour —
  // this slice changes only the buckets whose caller actually expressed a preference.
  toRepair.push({
    assetFaceId,
    currentPersonId: personId,
    suspectedOwnerId: entireCluster.destinationPersonId,
  });
}
```

The `moveLocked` tally already filters on `group.lock`, so it becomes correct for free once the write honours the flag. Leave it as is.

Pin the `entireCluster` decision so a later change is deliberate rather than accidental:

```ts
it('keeps a whole-cluster move durable, since its request carries no lock preference', async () => {
  mocks.person.getById.mockImplementation((id: string) => Promise.resolve({ id, ownerId: 'u1' } as never));
  mocks.faceRepair.reattributeFaces.mockResolvedValue(['f1']);
  mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as never);

  await sut.executeRepair({
    toRepair: [{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'p2' }],
    reviewOnlyFaces: [],
    reviewOnlyPersonIds: [],
    unAttributableFaces: [],
    perPerson: [],
  });

  expect(mocks.faceIdentity.replaceFaceIdentities).toHaveBeenCalledWith(
    expect.objectContaining({ source: 'manual' }),
    expect.anything(),
  );
});
```

- [ ] **Step 4: Run to verify they pass**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.mjs src/services/face-repair.execute-repair.spec.ts
cd server && pnpm exec vitest run --config test/vitest.config.mjs src/services/face-repair.service.spec.ts
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/services/face-repair.resolve.spec.ts
```

Expected: PASS. `face-repair.resolve.spec.ts` asserts exact result tuples — if `locked` counts shift, that is the tally becoming honest; update those expectations and say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/face-repair.service.ts server/src/services/face-repair.execute-repair.spec.ts server/test/medium/specs/services/face-repair.resolve.spec.ts
git commit -m "fix(face-cleanup): honour lock:false instead of permanently locking every moved face"
```

---

## Slice 3: Stop rendering NaN in destructive confirmations (B3)

Five call sites pass `.toLocaleString()` into an ICU `plural` argument. ICU computes `#` as `value - offset`, so `"2,952" - 0` is `NaN`. Verified with the app's own `intl-messageformat`: `face_cleanup_review_move_entire_confirm_cta` renders **"Move all NaN"**. It only breaks above 1,000 — exactly the clusters where a whole-cluster move is least reversible.

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/[personId]/+page.svelte:348,351,735`
- Modify: `web/src/routes/admin/face-cleanup/people/[personId]/+page.svelte:296,299`
- Test: `web/src/lib/i18n/face-cleanup-plurals.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `web/src/lib/i18n/face-cleanup-plurals.spec.ts`:

```ts
// B3: `#` in an ICU plural is `value - offset`, so a pre-formatted "2,952" yields NaN. Every
// count-bearing call site must pass the raw number. 2952 is above the thousands separator
// threshold; 952 renders fine either way and would not catch the bug.
describe('count arguments are raw numbers, not formatted strings', () => {
  const COUNT_KEYS = [
    'face_cleanup_review_rest_title',
    'face_cleanup_review_move_entire_confirm_body',
    'face_cleanup_review_move_entire_confirm_cta',
    'face_cleanup_manual_review_move_entire_confirm_body',
    'face_cleanup_manual_review_move_entire_confirm_cta',
  ];

  it.each(COUNT_KEYS)('%s renders a formatted count without NaN', (key) => {
    const rendered = get(_)(`admin.${key}`, {
      values: { count: 2952, name: 'Anna', owner: 'Anna' },
    });
    expect(rendered).not.toContain('NaN');
    expect(rendered).toContain('2,952');
  });

  it('proves the guard is discriminating: a formatted string DOES produce NaN', () => {
    const rendered = get(_)('admin.face_cleanup_review_move_entire_confirm_cta', {
      values: { count: '2,952' as unknown as number },
    });
    expect(rendered).toContain('NaN');
  });
});
```

Then add a source-level assertion so a future call site cannot regress:

```ts
it('no face-cleanup route passes toLocaleString() into a translation count', () => {
  const routeDir = path.resolve(process.cwd(), 'src/routes/admin/face-cleanup');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.svelte') && !entry.name.endsWith('.ts')) {
        continue;
      }
      const source = fs.readFileSync(full, 'utf8');
      if (/count:\s*[^,}]*toLocaleString\(\)/.test(source)) {
        offenders.push(full);
      }
    }
  };
  walk(routeDir);
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd web && pnpm exec vitest run src/lib/i18n/face-cleanup-plurals.spec.ts
```

Expected: FAIL — the source scan lists five offenders.

- [ ] **Step 3: Implement**

In both files, drop `.toLocaleString()` from the five `count:` arguments only. Leave every other `.toLocaleString()` (standalone numeric display outside a translation) untouched:

```ts
        values: { count: clusterTotal, owner: destinationName },
```

```ts
        values: { count: clusterTotal },
```

```svelte
            {$t('admin.face_cleanup_review_rest_title', { values: { count: restTotal } })}
```

```ts
        values: { count: vm.total, name: destination.name },
```

```ts
        values: { count: vm.total },
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd web && pnpm exec vitest run src/lib/i18n/face-cleanup-plurals.spec.ts
cd web && pnpm exec vitest run src/routes/admin/face-cleanup/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/admin/face-cleanup web/src/lib/i18n/face-cleanup-plurals.spec.ts
git commit -m "fix(face-cleanup): pass raw counts to ICU plurals so large clusters stop rendering NaN"
```

---

## Slice 4: Close the cross-owner write asymmetry (B4)

> **STATUS: REVERTED — needs a product decision before re-attempting.**
>
> The fix below (port the personal path's `Permission.PersonCreate` face check to the space path) was
> implemented, reviewed, and reverted in `ac44adb1bfe`. It is **wrong as specified**, for a reason the
> original review missed: `checkFaceOwnerAccess` is strict `asset.ownerId = userId`, but shared-space
> face suggestions are **cross-owner by design**. The canonical fixture
> (`shared-space-face-suggestions.service.spec.ts:54`) has three distinct users — a space owner, an
> Editor who acts, and a third user who owns the asset — and `getPendingForSpacePerson` deliberately
> spans "all three space access paths, including cross-owner contributions". An Editor curating people
> across everyone's contributed photos IS the feature. The guard denied every action on every face the
> Editor did not personally own, and shipped 15 red medium tests (the specs' `newMediumService` calls
> do not register `AccessRepository`, so the guard threw a TypeError rather than returning a denial).
>
> The underlying hazard is still real: a space Editor who owns nothing can write a verdict stamped with
> a **cross-owner** `identityId`, and `getPendingForPerson`'s anti-join matches on `identityId` with no
> ownership filter — so it suppresses the asset owner's _personal_ suggestion queue for their own face.
> A confirm additionally runs `clearNegativeForTarget`, whose identity arm can delete a rejection that
> owner recorded.
>
> Three candidate fixes, none of which should be chosen without a product call:
>
> 1. **Stop stamping the cross-owner identity on space verdicts** (write `spacePersonId` only). Closes
>    the leak at the source, but weakens the D3 self-heal that intentionally propagates a rejection
>    across scopes sharing an identity.
> 2. **Owner-scope the identity arm of `getPendingForPerson`** — honour an identity-matched negative
>    only when it was recorded by (or against a face owned by) that person's owner. Preserves the space
>    feature and same-owner cross-scope propagation; changes a deliberate read-path design.
> 3. **Guard only `clearNegativeForTarget`'s identity arm**, leaving suppression alone. Smallest change,
>    but fixes only the destructive half.
>
> Everything below this line is the original, superseded plan text.

`person.service.ts:584-599` requires the caller to own **both** the person and the face, with a comment explaining that `face_identity.id` is a cross-owner key and `getPendingForPerson`'s anti-join matches on `identityId` with no owner filter — so a verdict written against someone else's face suppresses _their_ queue. Its space twin, `resolveSpacePersonFaceSuggestion`, checks only Editor role and reachability. A space Editor who owns nothing can therefore suppress the asset owner's personal suggestions, and (via `clearNegativeForTarget`'s identity arm) destroy a rejection the owner recorded.

**Files:**

- Modify: `server/src/services/shared-space.service.ts` (`resolveSpacePersonFaceSuggestion`, and the confirm twin that calls `clearNegativeForTarget`)
- Test: `server/src/services/shared-space.service.spec.ts`, `server/test/medium/specs/services/face-review-cross-flow.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `server/src/services/shared-space.service.spec.ts`:

```ts
it('refuses a space reject on a face the caller does not own', async () => {
  mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set());
  await expect(
    sut.rejectSpacePersonFaceSuggestion(editorAuth, 'space-1', 'space-person-1', 'face-owned-by-alice'),
  ).rejects.toBeInstanceOf(BadRequestException);
  expect(mocks.facePersonVerdict.markRejectedForSpacePerson).not.toHaveBeenCalled();
});

it('refuses a space ignore on a face the caller does not own', async () => {
  mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set());
  await expect(
    sut.ignoreSpacePersonFaceSuggestion(editorAuth, 'space-1', 'space-person-1', 'face-owned-by-alice'),
  ).rejects.toBeInstanceOf(BadRequestException);
  expect(mocks.facePersonVerdict.markIgnoredForSpacePerson).not.toHaveBeenCalled();
});

it('allows the same call when the editor owns the face (positive control)', async () => {
  mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set(['face-owned-by-editor']));
  mocks.facePersonVerdict.isFaceReachableInSpace.mockResolvedValue(true);
  mocks.faceIdentity.ensureSpacePersonIdentity.mockResolvedValue({ id: 'identity-1' } as never);
  mocks.facePersonVerdict.markRejectedForSpacePerson.mockResolvedValue(1);

  await expect(
    sut.rejectSpacePersonFaceSuggestion(editorAuth, 'space-1', 'space-person-1', 'face-owned-by-editor'),
  ).resolves.toBe(true);
});
```

In `server/test/medium/specs/services/face-review-cross-flow.spec.ts`, the interaction test that proves the actual consequence:

```ts
it("a space editor cannot suppress the asset owner's personal suggestion queue", async () => {
  const { alice, editor, space, aliceFace, alicePerson } = await seedSpaceWithContributedFace();
  const before = await ctx
    .get(FacePersonVerdictRepository)
    .getPendingForPerson({ personId: alicePerson.id, page: 1, size: 50 });
  expect(before.items.some((i) => i.assetFaceId === aliceFace)).toBe(true); // positive control

  await expect(
    sharedSpaceService.rejectSpacePersonFaceSuggestion(editorAuth, space.id, spacePerson.id, aliceFace),
  ).rejects.toThrow();

  const after = await ctx
    .get(FacePersonVerdictRepository)
    .getPendingForPerson({ personId: alicePerson.id, page: 1, size: 50 });
  expect(after.items.some((i) => i.assetFaceId === aliceFace)).toBe(true);
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.mjs src/services/shared-space.service.spec.ts
```

Expected: FAIL — the reject/ignore calls resolve instead of throwing.

- [ ] **Step 3: Implement**

In `resolveSpacePersonFaceSuggestion`, immediately after `requireRole`:

```ts
await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
// B4: the same owner-only face gate the personal twin applies (person.service.ts rejectFaceSuggestion).
// Every verdict row is stamped with the target's identity, and `face_identity.id` is a CROSS-OWNER key
// whose anti-join in getPendingForPerson has no ownership filter — so a row written against a face the
// caller does not own suppresses the ASSET OWNER's personal queue. Space membership grants rights inside
// the space; it does not grant the right to record a durable verdict about another user's face.
await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [assetFaceId] });
```

Apply the identical guard to the space **confirm** path before its `clearNegativeForTarget` call (`shared-space.service.ts:1369`) — that call deletes negative verdicts by identity, so an unowned confirm destroys another owner's rejection.

- [ ] **Step 4: Run to verify they pass**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.mjs src/services/shared-space.service.spec.ts
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/services/face-review-cross-flow.spec.ts
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/services/people-identity-rbac.spec.ts
```

Expected: PASS. If an existing space-suggestion medium test seeds a face owned by a non-editor, it will now correctly fail — fix the fixture, do not relax the guard.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts server/test/medium/specs/services/face-review-cross-flow.spec.ts
git commit -m "fix(spaces): require face ownership before a space verdict can suppress another user's queue"
```

---

# Phase 2 — High severity

## Slice 5: Add the missing write-time guard to confirm/lock (H5)

`getEligibleFaceIdsForPerson` runs **outside** the transaction and its own comment calls itself "advisory only: the write-time guards in reattributeFaces/detachFaces remain authoritative". But the lock path's write, `replaceFaceIdentities`, is keyed on `assetFaceId` alone and re-checks nothing. A concurrent reassign between the read and the write leaves `asset_face.personId = Q` with the identity link pointing at P — the exact torn state the move and detach paths transact against.

**Files:**

- Modify: `server/src/repositories/face-identity.repository.ts` (`replaceFaceIdentities` gains an optional `requirePersonId`)
- Modify: `server/src/services/face-repair.service.ts` (lock bucket passes it)
- Test: `server/src/repositories/face-identity.repository.spec.ts`, `server/test/medium/specs/repositories/face-identity.repository.spec.ts`

**Interfaces:**

- Produces: `replaceFaceIdentities(input: { assetFaceIds: string[]; identityId: string; source: FaceIdentityFaceSource; confidence?: number | null; requirePersonId?: string }, db?)`. When `requirePersonId` is set, only faces still assigned to that person are written; the return type becomes `Promise<string[]>` (the ids actually written) so callers can count honestly.

- [ ] **Step 1: Write the failing test (medium — this needs real concurrency semantics)**

```ts
it('does not re-point a face that left the person between the eligibility read and the write', async () => {
  const { personP, personQ, face } = await seedFace();
  // Simulate the race: the face moves to Q after the caller's eligibility read.
  await ctx.database.updateTable('asset_face').set({ personId: personQ.id }).where('id', '=', face).execute();

  const written = await sut.replaceFaceIdentities({
    assetFaceIds: [face],
    identityId: identityOfP.id,
    source: 'manual',
    requirePersonId: personP.id,
  });

  expect(written).toEqual([]);
  const link = await ctx.database
    .selectFrom('face_identity_face')
    .selectAll()
    .where('assetFaceId', '=', face)
    .executeTakeFirst();
  expect(link?.identityId).not.toBe(identityOfP.id);
});

it('writes normally when the face is still on the required person (positive control)', async () => {
  const { personP, face } = await seedFace();
  const written = await sut.replaceFaceIdentities({
    assetFaceIds: [face],
    identityId: identityOfP.id,
    source: 'manual',
    requirePersonId: personP.id,
  });
  expect(written).toEqual([face]);
});

it('writes unconditionally when requirePersonId is omitted', async () => {
  const { face } = await seedFace();
  const written = await sut.replaceFaceIdentities({ assetFaceIds: [face], identityId: 'i1', source: 'ml' });
  expect(written).toEqual([face]);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/face-identity.repository.spec.ts
```

Expected: FAIL — `requirePersonId` is not a known property; the face is re-pointed regardless.

- [ ] **Step 3: Implement**

In `replaceFaceIdentities`, filter the chunk through the guard before inserting, inside the same transaction handle:

```ts
let chunk = assetFaceIds.slice(index, index + 1000);
if (input.requirePersonId) {
  // H5: the caller's eligibility read happened outside this transaction. Re-check inside it, the same
  // way reattributeFaces and detachFaces do, so a concurrent reassign cannot leave the face on one
  // person with another person's identity attached.
  const stillThere = await db
    .selectFrom('asset_face')
    .select('id')
    .where('id', 'in', chunk)
    .where('personId', '=', input.requirePersonId)
    .execute();
  chunk = stillThere.map((row) => row.id);
  if (chunk.length === 0) {
    continue;
  }
}
written.push(...chunk);
```

Return `written`. Then in `face-repair.service.ts`'s lock bucket, pass `requirePersonId: personId` and count the returned ids rather than `lock.length` (this also fixes L3's inflated tally):

```ts
const writtenIds = await this.faceIdentityRepository.replaceFaceIdentities(
  { assetFaceIds: lock, identityId: identity.id, source: 'manual', requirePersonId: personId },
  trx,
);
await this.facePersonVerdictRepository.drainPendingForFaces(writtenIds, trx);
await this.facePersonVerdictRepository.clearNegativeForTarget({ personId, identityId: identity.id }, writtenIds, trx);
locked += writtenIds.length;
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/face-identity.repository.spec.ts
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/services/face-repair.resolve.spec.ts
cd server && pnpm test
```

Expected: PASS. `replaceFaceIdentities` has exactly **two** callers, both in `face-repair.service.ts` (`:299` the move path, `:1065` the lock path) — verified with `grep -rn "replaceFaceIdentities(" server/src --include="*.ts"`. Only the lock path passes `requirePersonId`; the move path already re-checks placement inside `reattributeFaces`, so it must keep passing nothing. The narrow blast radius is why this change is safe; the whole-suite run is a backstop, not the argument.

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/face-identity.repository.ts server/src/services/face-repair.service.ts server/test/medium/specs
git commit -m "fix(face-cleanup): re-check face placement inside the confirm transaction"
```

---

## Slice 6: Chunk the four library-sized IN lists (H6)

`face-verdict.service.ts` fans out to four reads that bind one parameter per id and are never chunked, while every sibling write path in the same feature chunks at 1000 with an explicit 65,535 comment. `minFaces` is admin-settable, and `decideReattribution` flags on `ownCount < minFaces` — so a high value on a large library flags enough faces to exceed Postgres's bind-parameter ceiling and permanently fails scans at those settings.

**Files:**

- Modify: `server/src/repositories/face-identity.repository.ts` (`getManualLinkedFaceIds`, `getPersonVerdictTokens`)
- Modify: `server/src/repositories/face-person-verdict.repository.ts` (`getNegativeVerdictTokens`)
- Modify: `server/src/repositories/face-repair-decline.repository.ts` (`getClusterMuteMap`)
- Test: the matching `.spec.ts` for each

- [ ] **Step 1: Write the failing tests**

For each of the four, a medium test at a size that exceeds the ceiling. Example for `getManualLinkedFaceIds`:

```ts
it('handles an id list larger than the Postgres bind-parameter ceiling', async () => {
  // 70,000 > 65,535. The four sibling write paths already have this exact test.
  const ids = Array.from({ length: 70_000 }, () => randomUUID());
  await expect(sut.getManualLinkedFaceIds(ids)).resolves.toBeInstanceOf(Set);
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/face-identity.repository.spec.ts
```

Expected: FAIL — Postgres rejects the bind message.

- [ ] **Step 3: Implement**

The repo already has the decorators. Apply `@ChunkedSet` / `@ChunkedArray` (`server/src/decorators.ts:102-106`) to the four methods, matching how the existing chunked read paths in this codebase declare them. Where the decorator cannot express the merge (a `Map` return, as in `getClusterMuteMap` and `getPersonVerdictTokens`), write the explicit loop instead:

```ts
const merged = new Map<string, string[]>();
for (let index = 0; index < personIds.length; index += 1000) {
  const rows = await this.db
    .selectFrom('face_repair_decline')
    .selectAll()
    .where('personId', 'in', personIds.slice(index, index + 1000))
    .execute();
  for (const row of rows) {
    /* existing merge body, unchanged */
  }
}
return merged;
```

- [ ] **Step 4: Run to verify they pass**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/
cd server && pnpm run sql   # requires a running DB — regenerates the query docs the decorators emit
```

Expected: PASS. `pnpm run sql` **must** be run with a database up; without one it deletes every query file.

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories server/src/queries server/test/medium/specs/repositories
git commit -m "fix(face-cleanup): chunk the four library-sized verdict reads"
```

---

## Slice 7: Make the in-flight scan index actually enforce single-flight (H7)

`UNIQUE (status) WHERE status IN ('pending','running')` is unique on the _value_ of `status`, so one `pending` and one `running` row coexist. Confirmed against the live database. Two admins clicking Scan across the `pending → running` transition both succeed; `pruneSupersededScans` then deletes the loser's `face_repair_scan_flagged_face` rows mid-flight.

**Files:**

- Create: `server/src/schema/migrations-gallery/1790000000000-FixFaceRepairScanInFlightIndex.ts`
- Modify: `server/src/schema/tables/face-repair-scan.table.ts`
- Modify: `scripts/revert-to-immich.sql`
- Test: `server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts`, `server/test/medium/specs/schema-drift.spec.ts` (must stay green, not be edited)

- [ ] **Step 1: Write the failing test**

```ts
// RepairScanParams (face-repair-scan.repository.ts:14-23) requires all seven fields — `params: {}`
// does not typecheck. Reuse the instance defaults so the fixture cannot drift from the real shape.
const SCAN_PARAMS: RepairScanParams = {
  maxDistance: 0.5,
  minFaces: 3,
  voteWindow: 200,
  voteMargin: 2,
  maxAttributionDistance: 0.35,
  maxFlaggedFraction: 0.5,
  largeClusterThreshold: 50,
};

// GIVEN a scan that has already moved from `pending` to `running`
// WHEN a second scan row is inserted directly, bypassing createScan's advisory SELECT
// THEN the unique index itself must reject it — the SELECT is advisory, the index is the backstop.
it('refuses a second in-flight scan across the pending -> running transition', async () => {
  const first = await sut.createScan({ requestedBy: null, params: SCAN_PARAMS });
  await sut.updateScanProgress(first.id, { status: 'running', scanned: 0 });

  await expect(
    ctx.database.insertInto('face_repair_scan').values({ status: 'pending', persons: '[]' }).execute(),
  ).rejects.toThrow(/face_repair_scan_in_flight_uq/);
});

// Positive control: without this, an index that rejected EVERY insert would also pass the test above.
it('still allows a new scan once the previous one completed', async () => {
  const first = await sut.createScan({ requestedBy: null, params: SCAN_PARAMS });
  await sut.completeScan(first.id, { totals: EMPTY_TOTALS, persons: [] });
  await expect(sut.createScan({ requestedBy: null, params: SCAN_PARAMS })).resolves.toBeDefined();
});
```

`completeScan(id, { totals, persons })` is the real signature (`face-repair-scan.repository.ts:136`); build `EMPTY_TOTALS` from the `RepairScanTotals` shape the file already uses in its existing tests rather than passing `{}`.

- [ ] **Step 2: Run to verify it fails**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/face-repair-scan.repository.spec.ts
```

Expected: FAIL — the second insert succeeds.

- [ ] **Step 3: Implement**

New migration, modelled exactly on `1783050000000`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "face_repair_scan_in_flight_uq"`.execute(db);
  // A constant expression, so ALL in-flight rows share one key and at most one can exist. The previous
  // index was UNIQUE on the VALUE of status, which let one 'pending' and one 'running' row coexist —
  // exactly the race the comment claimed it closed.
  await sql`CREATE UNIQUE INDEX "face_repair_scan_in_flight_uq" ON "face_repair_scan" ((true)) WHERE "status" IN ('pending', 'running')`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_face_repair_scan_in_flight_uq', '{"type":"index","name":"face_repair_scan_in_flight_uq","sql":"CREATE UNIQUE INDEX \\"face_repair_scan_in_flight_uq\\" ON \\"face_repair_scan\\" ((true)) WHERE \\"status\\" IN (''pending'', ''running'');"}'::jsonb) ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value";`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "face_repair_scan_in_flight_uq"`.execute(db);
  await sql`CREATE UNIQUE INDEX "face_repair_scan_in_flight_uq" ON "face_repair_scan" ("status") WHERE "status" IN ('pending', 'running')`.execute(
    db,
  );
}
```

**Before writing `up`, deduplicate.** An instance may already hold one `pending` _and_ one `running` row, in which case the index creation fails. Prepend:

```ts
await sql`UPDATE "face_repair_scan" SET "status" = 'failed', "error" = 'superseded by in-flight uniqueness repair'
            WHERE "status" IN ('pending','running')
              AND "id" <> (SELECT "id" FROM "face_repair_scan" WHERE "status" IN ('pending','running') ORDER BY "createdAt" DESC LIMIT 1)`.execute(
  db,
);
```

Update `face-repair-scan.table.ts` to declare the expression index, and correct the table comment which currently claims uniqueness it did not have. Append the migration name and the override name to `scripts/revert-to-immich.sql`.

- [ ] **Step 4: Run to verify it passes**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/face-repair-scan.repository.spec.ts
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/schema-drift.spec.ts
```

Expected: PASS both. Schema drift must be **zero** — if it reports the index, the `migration_overrides` payload does not match what Postgres stores.

- [ ] **Step 5: Commit**

```bash
git add server/src/schema scripts/revert-to-immich.sql server/test/medium/specs
git commit -m "fix(face-cleanup): make the in-flight scan index enforce a single scan"
```

---

## Slice 8: Stop a failed suggestion scan from silently killing a person's queue (H8)

`PersonSuggestionScan` and `SpacePersonSuggestionScan` set `removeOnComplete` but not `removeOnFail`, unlike all three siblings added beside them. `job.repository.ts:271` documents the hazard: a failed job holds its stable dedup jobId forever and BullMQ silently ignores every later `add()`. One transient failure and that person's suggestion queue never refills again, with no log and no admin-visible symptom.

**Files:**

- Modify: `server/src/repositories/job.repository.ts:594-602`
- Modify: `server/src/services/person.service.ts` (extend the existing prefix sweep)
- Test: `server/src/repositories/job.repository.spec.ts`

- [ ] **Step 1: Write the failing test**

`getJobOptions` is **private** (`job.repository.ts:551`), so it cannot be called directly. Assert through `queue.add`, which is exactly how the existing job-options tests in this file work (`job.repository.spec.ts:457-470`):

```ts
// GIVEN a per-person suggestion scan is enqueued
// WHEN BullMQ receives it
// THEN it must carry removeOnFail, or a single failure occupies the stable dedup jobId forever and
// every later enqueue for that person is silently dropped.
it.each([
  [JobName.PersonSuggestionScan, 'person-suggestion-scan/person-1'],
  [JobName.SpacePersonSuggestionScan, 'space-person-suggestion-scan/person-1'],
])('%s is enqueued with removeOnFail', async (name, expectedJobId) => {
  await sut.queue({ name, data: { id: 'person-1' } } as never);

  expect(queue.add).toHaveBeenCalledWith(
    name,
    { id: 'person-1' },
    expect.objectContaining({ jobId: expectedJobId, removeOnFail: true }),
  );
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.mjs src/repositories/job.repository.spec.ts
```

Expected: FAIL — `removeOnFail` is `undefined`.

- [ ] **Step 3: Implement**

```ts
      case JobName.PersonSuggestionScan: {
        return { jobId: `person-suggestion-scan/${item.data.id}`, removeOnComplete: true, removeOnFail: true };
      }
      case JobName.SpacePersonSuggestionScan: {
        return { jobId: `space-person-suggestion-scan/${item.data.id}`, removeOnComplete: true, removeOnFail: true };
      }
```

`removeOnFail` protects new failures only; already-stuck jobIds need sweeping. Extend the existing `removeFailedJobsByJobIdPrefix` call so the two new prefixes are covered on boot, alongside the shared-space prefixes it already handles.

- [ ] **Step 4: Run to verify it passes**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.mjs src/repositories/job.repository.spec.ts
cd server && pnpm exec vitest run --config test/vitest.config.mjs src/services/person.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/job.repository.ts server/src/repositories/job.repository.spec.ts server/src/services/person.service.ts
git commit -m "fix(face-suggestions): let a failed per-person scan be re-enqueued"
```

---

## Slice 9: Restore the ICU plurals in nine locales, and make the guard see them (H9)

Twelve to eighteen count-bearing keys were flattened to bare `{count}` in de/fr/it/nl/pl/es/ru/zh_Hans/zh_Hant, so they render "1 Gesichter", "1 visages", "1 лиц". The guard written for exactly this, `face-cleanup-plurals.spec.ts`, registers **only `en`** and reads only `en.json` — the bug is fixed in English, shipped in nine translations, and the spec is green.

Also in scope: `i18n/nl.json` `"Nieuwe persoon '{query}' aanmaken"` — the apostrophe before `{` opens an ICU literal, so Dutch renders the placeholder raw.

**Files:**

- Create: `web/src/lib/i18n/fork-locales.ts`
- Modify: `web/src/lib/i18n/face-cleanup-plurals.spec.ts` (iterate the fork's nine locales)
- Modify: `web/src/lib/i18n/fork-string-parity.spec.ts` (import the shared list instead of its own copy)
- Modify: `i18n/{de,fr,it,nl,pl,es,ru,zh_Hans,zh_Hant}.json`
- Test: the same spec

- [ ] **Step 0: Extract the locale list so two specs cannot disagree**

`fork-string-parity.spec.ts:19` declares `const TRANSLATED = [...]` — module-private and **not exported**, so it cannot be imported. Rather than copy the list (it will drift), lift it into a real module:

```ts
// web/src/lib/i18n/fork-locales.ts
/**
 * The nine locales the fork maintains by hand. Every fork-added string must exist in all of them.
 * The remaining ~80 locale files belong to translators and must never be hand-edited — see
 * placeholders.spec.ts, which is scoped to this list for exactly that reason.
 */
export const FORK_LOCALES = ['de', 'es', 'fr', 'it', 'nl', 'pl', 'ru', 'zh_Hans', 'zh_Hant'] as const;
```

Then replace the `const TRANSLATED` declaration in `fork-string-parity.spec.ts` with an import of `FORK_LOCALES`, leaving its own assertions untouched. Run `pnpm exec vitest run src/lib/i18n/` and confirm it is still green before changing anything else — this step must be behaviour-neutral.

- [ ] **Step 1: Fix the guard so it fails**

```ts
import { FORK_LOCALES } from '$lib/i18n/fork-locales';

beforeAll(async () => {
  for (const locale of ['en', ...FORK_LOCALES]) {
    register(locale, () => import(`$i18n/${locale}.json`));
  }
  await init({ fallbackLocale: 'en', initialLocale: 'en' });
  await Promise.all(['en', ...FORK_LOCALES].map((l) => waitLocale(l)));
});

// Derive the key list from en.json instead of hardcoding 17 — a hardcoded list silently stops
// covering every key added after it was written.
const PLURAL_KEYS = Object.entries(en.admin)
  .filter(([key, value]) => key.startsWith('face_cleanup_') && /\{count,\s*plural/.test(value))
  .map(([key]) => key);

describe.each(FORK_LOCALES)('%s', (locale) => {
  it.each(PLURAL_KEYS)('%s keeps an ICU plural clause', (key) => {
    const translated = read(`${locale}.json`)[`admin.${key}`];
    if (translated === undefined) {
      return;
    } // missing keys fall back to en and are a separate check
    expect(translated).toMatch(/\{count,\s*plural/);
  });

  it.each(PLURAL_KEYS)('%s renders a grammatical singular at count=1', async (key) => {
    await locale_.set(locale);
    const rendered = get(_)(`admin.${key}`, { values: { count: 1, name: 'X', owner: 'X' } });
    expect(rendered).not.toContain('NaN');
  });
});

it('no locale opens an ICU literal with an apostrophe before a placeholder', () => {
  for (const locale of FORK_LOCALES) {
    for (const [key, value] of Object.entries(read(`${locale}.json`))) {
      expect(`${locale}:${key}:${value}`).not.toMatch(/'\{/);
    }
  }
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd web && pnpm exec vitest run src/lib/i18n/face-cleanup-plurals.spec.ts
```

Expected: FAIL — 12+ keys × 7 locales, plus the nl apostrophe.

- [ ] **Step 3: Implement**

Restore an ICU plural clause in each locale, using that language's real plural categories — **not** a mechanical copy of English's two-branch form. Polish and Russian need `one/few/many/other`; Chinese needs only `other`. Examples:

```jsonc
// de
"face_cleanup_review_apply_label": "Anwenden · {count, plural, one {# Gesicht} other {# Gesichter}}",
// fr
"face_cleanup_review_apply_label": "Appliquer · {count, plural, one {# visage} other {# visages}}",
// ru
"face_cleanup_review_apply_label": "Применить · {count, plural, one {# лицо} few {# лица} many {# лиц} other {# лица}}",
// pl
"face_cleanup_review_apply_label": "Zastosuj · {count, plural, one {# twarz} few {# twarze} many {# twarzy} other {# twarzy}}",
// zh_Hans — no plural inflection; a single `other` branch is correct and keeps the guard satisfied
"face_cleanup_review_apply_label": "应用 · {count, plural, other {# 张人脸}}",
```

And fix nl by removing the ICU-significant apostrophes:

```jsonc
"face_cleanup_picker_create": "Nieuwe persoon \"{query}\" aanmaken",
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx prettier --write i18n/*.json
cd web && pnpm exec vitest run src/lib/i18n/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add i18n web/src/lib/i18n
git commit -m "fix(i18n): restore ICU plurals in nine locales and make the guard check them"
```

---

## Slice 10: Preserve cluster mutes across a person merge (H10)

`face_repair_decline_personId_fkey` is `ON DELETE CASCADE` — confirmed on the live database — and `mergePersonProfile` deletes the source person. So merging two people silently destroys the console's cluster mute and the cluster resurfaces on the next scan, while `face-repair.merge-consistency.spec.ts`'s header claims both durable Face Cleanup facts survive merges.

**Files:**

- Modify: `server/src/repositories/person.repository.ts` (`mergePersonProfile`, beside the existing `retargetVerdictPersonId` call)
- Create: `server/src/utils/face-decline-merge.ts` (`retargetDeclinePersonId`, mirroring `face-verdict-merge.ts`)
- Test: `server/test/medium/specs/services/face-repair.merge-consistency.spec.ts`

- [ ] **Step 1: Write the failing test**

A cluster mute is one `type='person'` row per person, keyed by `personId`, carrying `suspectedOwnerIds: string[]` in jsonb — there is **no** fingerprint column. `createClusterMutes({ persons, declinedBy })` is last-write-wins: it deletes the person's existing row and inserts a fresh one, so a person has at most one. `getClusterMuteMap(personIds)` returns `Map<personId, Set<suspectedOwnerId>>`.

```ts
// GIVEN an admin muted a cluster on the person that is about to be merged away
// WHEN that person is merged into a survivor
// THEN the mute must move with it — CASCADE on personId otherwise deletes it silently.
it('carries a cluster mute onto the survivor when its person is merged away', async () => {
  const { source, survivor, ownerA } = await seedTwoPeople();
  await declineRepository.createClusterMutes({
    persons: [{ personId: source.id, suspectedOwnerIds: [ownerA.id] }],
    declinedBy: admin.id,
  });
  // Positive control: without this, a broken seed produces the same green as a broken merge.
  expect((await declineRepository.getClusterMuteMap([source.id])).get(source.id)).toEqual(new Set([ownerA.id]));

  await personRepository.mergePersonProfile(survivor.id, source.id);

  expect((await declineRepository.getClusterMuteMap([survivor.id])).get(survivor.id)).toEqual(new Set([ownerA.id]));
});

// GIVEN BOTH people carry a mute, each naming a different suspected owner
// WHEN they merge
// THEN the survivor keeps ONE row whose suspected owners are the union — the merged cluster contains
// both sets of faces, so both mutes still apply. Two rows would make getClusterMuteMap's `set()`
// nondeterministic (last row read wins) and an Undo would clear only half the mute.
it('unions the suspected owners when both people muted their clusters', async () => {
  const { source, survivor, ownerA, ownerB } = await seedTwoPeople();
  await declineRepository.createClusterMutes({
    persons: [{ personId: source.id, suspectedOwnerIds: [ownerA.id] }],
    declinedBy: admin.id,
  });
  await declineRepository.createClusterMutes({
    persons: [{ personId: survivor.id, suspectedOwnerIds: [ownerB.id] }],
    declinedBy: admin.id,
  });

  await personRepository.mergePersonProfile(survivor.id, source.id);

  const rows = await ctx.database
    .selectFrom('face_repair_decline')
    .selectAll()
    .where('type', '=', 'person')
    .where('personId', '=', survivor.id)
    .execute();
  expect(rows).toHaveLength(1);
  expect(new Set(rows[0].suspectedOwnerIds as unknown as string[])).toEqual(new Set([ownerA.id, ownerB.id]));
});

it('leaves the survivor untouched when only the survivor had a mute', async () => {
  const { source, survivor, ownerB } = await seedTwoPeople();
  await declineRepository.createClusterMutes({
    persons: [{ personId: survivor.id, suspectedOwnerIds: [ownerB.id] }],
    declinedBy: admin.id,
  });

  await personRepository.mergePersonProfile(survivor.id, source.id);

  expect((await declineRepository.getClusterMuteMap([survivor.id])).get(survivor.id)).toEqual(new Set([ownerB.id]));
});

it('is a no-op when neither person had a mute', async () => {
  const { source, survivor } = await seedTwoPeople();
  await expect(personRepository.mergePersonProfile(survivor.id, source.id)).resolves.not.toThrow();
  expect((await declineRepository.getClusterMuteMap([survivor.id])).size).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/services/face-repair.merge-consistency.spec.ts
```

Expected: FAIL — the mute is gone after the merge.

- [ ] **Step 3: Implement**

`server/src/utils/face-decline-merge.ts`, following `face-verdict-merge.ts`'s delete-collisions-then-retarget shape:

```ts
/**
 * Re-keys the source person's cluster mute onto the survivor before the merge deletes that person.
 * `face_repair_decline.personId` is ON DELETE CASCADE (verified against a live database), so without
 * this a merge silently destroys the admin's "stop showing me this cluster" decision and the cluster
 * resurfaces on the next scan.
 *
 * A person has at most ONE `type='person'` row — createClusterMutes deletes and re-inserts rather than
 * appending — so this reduces to three cases. When both people have one, the survivor's row absorbs the
 * union of the suspected owners: the merged cluster contains both sets of faces, so both mutes still
 * apply. Leaving two rows instead would be worse than the bug, since getClusterMuteMap does a plain
 * `set()` per row and would keep whichever the scan happened to read last.
 */
export const retargetDeclinePersonId = async (trx: Transaction<DB>, sourceId: string, survivorId: string) => {
  const rows = await trx
    .selectFrom('face_repair_decline')
    .select(['id', 'personId', 'suspectedOwnerIds'])
    .where('type', '=', 'person')
    .where('personId', 'in', [sourceId, survivorId])
    .execute();

  const source = rows.find((row) => row.personId === sourceId);
  if (!source) {
    return;
  }

  const survivor = rows.find((row) => row.personId === survivorId);
  if (!survivor) {
    await trx.updateTable('face_repair_decline').set({ personId: survivorId }).where('id', '=', source.id).execute();
    return;
  }

  const union = [
    ...new Set([
      ...((survivor.suspectedOwnerIds ?? []) as unknown as string[]),
      ...((source.suspectedOwnerIds ?? []) as unknown as string[]),
    ]),
  ];
  await trx
    .updateTable('face_repair_decline')
    .set({ suspectedOwnerIds: union as unknown as Insertable<FaceRepairDeclineTable>['suspectedOwnerIds'] })
    .where('id', '=', survivor.id)
    .execute();
  await trx.deleteFrom('face_repair_decline').where('id', '=', source.id).execute();
};
```

Call it inside the merge transaction, immediately after `retargetVerdictPersonId`, so the retarget and the merge commit or roll back together. Match the `suspectedOwnerIds` jsonb cast that `createClusterMutes` already uses (`face-repair-decline.repository.ts:37`) rather than inventing a different one.

- [ ] **Step 4: Run to verify it passes**

```bash
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/services/face-repair.merge-consistency.spec.ts
cd server && pnpm exec vitest run --config test/vitest.config.mjs src/repositories/person.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/face-decline-merge.ts server/src/repositories/person.repository.ts server/test/medium/specs
git commit -m "fix(face-cleanup): keep cluster mutes when their person is merged away"
```

---

# Phase 3 — Test hardening

Every item here has been **mutation-verified**: the mutation named is one that currently survives the whole suite. The workflow for each is the same and is genuinely TDD, just inverted — the "failing test" is the assertion that should have existed:

1. Apply the mutation to the implementation.
2. Run the named suite. Confirm it is **green** (proving the gap is real).
3. Write the assertion. Run again — it must now be **red**.
4. Revert the mutation. Run again — **green**.
5. Commit the test only.

Do not skip step 2. A test written without seeing the mutation survive is a test you have not proven discriminating.

## Slice 11: Close the six highest-value server unit gaps

**Files:** `server/src/services/person.service.spec.ts`, `server/src/services/shared-space.service.spec.ts`, `server/src/services/face-repair.execute-repair.spec.ts`, `server/src/services/face-repair.scan.spec.ts`

- [ ] **Step 1: `confirmFaceSuggestion` face-ownership denial**
      Mutation: delete `await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [assetFaceId] })` from `person.service.ts:437`. Currently 349/349 pass.
      Assertion: mirror the reject/ignore denial tests at `person.service.spec.ts:7217` — `checkFaceOwnerAccess` returns an empty set, expect a rejection, and expect `markConfirmed`/`reassignFace` **not** to have been called.

- [ ] **Step 2: Suggestion visibility scoping**
      Mutation: remove `visibility: spaceVisibleAssetVisibilities` from both `searchFaces` calls (`person.service.ts:463`, `:551`). Currently 349/349 pass — and the real consequence is that faces on **Locked** and Hidden assets become suggestable.
      Assertion: replace `expect.objectContaining({ userIds: ['u'], hasPerson: false })` with a full `toHaveBeenCalledWith` that pins `visibility: spaceVisibleAssetVisibilities`, at `:4374` and `:4637`.

- [ ] **Step 3: `identityId` on every verdict write**
      Mutation: `identityId: 'WRONG-' + auth.user.id` in `verdictOpts` (`person.service.ts:511`); space side, `ensureSpacePersonIdentity(spaceId)` instead of `(person.id)` (`shared-space.service.ts:1441`).
      Assertion: replace `expect.any(String)` at `person.service.spec.ts:7258/7273/7291/7313/7318/7335` and `shared-space.service.spec.ts:7628/7646` with the concrete identity id the mocked `ensure*Identity` returned. This is the cross-scope key the whole design rests on and it is currently unpinned everywhere.

- [ ] **Step 4: `clearNegativeForTarget` call sites**
      Mutation: delete the call at `person.service.ts:328`, `:351`, `:549` and `shared-space.service.ts:1369`. All four currently survive at unit level.
      Assertion: at each site, `expect(mocks.facePersonVerdict.clearNegativeForTarget).toHaveBeenCalledWith({ personId, identityId }, [faceId])` — arguments, not bare `toHaveBeenCalled()`.

- [ ] **Step 5: The C6 cross-owner guard in `executeRepair`**
      Mutation: delete the `if (fromOwner !== toOwner)` block (`face-repair.service.ts:283-287`).
      Cause: `face-repair.execute-repair.spec.ts:26` uses one `getById` mock for both source and destination, so the owners are always equal and the guard can never fire.
      Assertion: give `getById` a per-id implementation returning different `ownerId`s, then assert the route is skipped and nothing is written.

- [ ] **Step 6: The seven-field scan-override merge**
      Mutation: hardcode all seven params to their defaults, ignoring `overrides` (`face-repair.service.ts:562-570`) — this makes the entire Advanced Scan modal decorative.
      Assertion: `expect(mocks.faceRepairScan.createScan).toHaveBeenCalledWith(expect.objectContaining({ params: { maxDistance: 0.42, minFaces: 7, voteMargin: 3, voteWindow: 150, maxFlaggedFraction: 0.25, largeClusterThreshold: 20, maxAttributionDistance: 0.3 } }))` — all seven, with non-default values so a default cannot satisfy it.

- [ ] **Step 7: Delete the two tests that assert nothing**
      `face-repair.scan.spec.ts:182` (body is `expect(QueueName.FacialRecognition).toBeDefined()` under a title about admin guards — the controller spec already covers it) and `face-repair.scan-defaults.spec.ts` (asserts its own mock; only `maxFlaggedFraction`, a constant, is real code). Removing a test that cannot fail is a net gain in signal.

- [ ] **Step 8: Run and commit**

```bash
cd server && pnpm test
git add server/src/services
git commit -m "test(face-review): pin the six assertions that survived mutation"
```

## Slice 12: Close the web and coverage gaps

**Files:** `web/src/routes/admin/face-cleanup/**/*.spec.ts`, `web/src/lib/components/**`, `web/vite.config.ts`

- [ ] **Step 1: Enable `clearMocks` globally**
      `web/vite.config.ts` sets none, and 22 PR spec files never clear. Add `test: { clearMocks: true }` and run the whole web suite — any test that then fails was passing on another test's leftovers and must be fixed, not reverted.

- [ ] **Step 2: Delete the three assertions that can never fail**
      `resolutions/page.spec.ts:196` (`locks-section`), `people/[personId]/page.spec.ts:442` (`manual-review-load-more`), `[personId]/page.spec.ts:1074` (`move-rest-selection-btn`) — none of these testids exists in any component. Either delete the line or point it at the real testid. Add a guard test that every `queryByTestId(...).not.toBeInTheDocument()` string in the face-cleanup specs appears somewhere in `web/src` as a `data-testid`.

- [ ] **Step 3: Fix the polling test that never tests the stop**
      `scan/page.spec.ts:292`. Mutation: delete `stopPolling()` from the `!isActive(scan.status)` branch (`scan/+page.svelte:169`) — the page polls forever and the test stays green. Assertion: after the completed-scan mock resolves, advance timers again and assert `getLatestScan` call count is **unchanged**.

- [ ] **Step 4: Assert post-Apply navigation positively**
      `[personId]/page.spec.ts:461,885,1124` only ever assert `goto` was _not_ called. Mutation: delete `void goto(Route.faceCleanupScan())` at `[personId]/+page.svelte:387` and `:460`. Assertion: copy the manual-review sibling's shape at `people/[personId]/page.spec.ts:1049` — `expect(goto).toHaveBeenCalledWith(Route.faceCleanupScan())`.

- [ ] **Step 5: Add the missing page-load specs**
      The repo has a `page-load.spec.ts` convention (7 existing files) and none of the 7 face-cleanup `+page.ts` files has one. Add them, covering `authenticate(url, { admin: true })` on every console route and the `declined/+page.ts` 307 redirect.

- [ ] **Step 6: Cover the deletion cascades nothing exercises**
      Add medium tests for: deleting an `asset_face` cascades its verdicts; deleting a `user` degrades `actorId`/`requestedBy` to NULL and `listNegativeVerdicts` still renders the row; **deleting a shared space** degrades `spacePersonId` to NULL while `identityId` survives. Space deletion currently has zero coverage anywhere in the PR.

- [ ] **Step 7: Run and commit**

```bash
cd web && pnpm exec vitest run && pnpm run check:svelte && pnpm run check:typescript
cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/
git add web server/test
git commit -m "test(face-review): clear mocks, fix vacuous assertions, cover the deletion cascades"
```

---

# Phase 4 — Fork isolation

Mechanical, no behaviour change. Each slice must end with the full server suite green and **zero** diff in generated artifacts.

## Slice 13: Extract the suggestion engine into fork-owned files

`person.service.ts` carries +522 lines against upstream, of which ~470 are four self-contained `@OnJob` handlers plus five endpoint methods that never interleave with upstream logic. The fork already does exactly this for `face-repair.service.ts`, `classification.service.ts` and `shared-space.service.ts`.

**Files:**

- Create: `server/src/services/face-suggestion.service.ts`
- Create: `server/src/controllers/face-suggestion.controller.ts`
- Modify: `server/src/services/person.service.ts` (down to the ~50 lines of genuine in-place hooks)
- Modify: `server/src/controllers/person.controller.ts` (**to zero diff against upstream**)
- Move: the ~1,700 corresponding spec lines out of `person.service.spec.ts` into `face-suggestion.service.spec.ts`

- [ ] **Step 1: Record the baseline** — `cd server && pnpm test 2>&1 | tail -3`. Note the exact pass count; it must be identical at the end.
- [ ] **Step 2: Move `handlePersonSuggestionScan`, `handleSpacePersonSuggestionScan` and both `QueueAll` twins** into `FaceSuggestionService`, keeping the `@OnJob` decorators and signatures byte-identical. Register the service in `base.service.ts` **in the fork block**, next to the other fork services — not in upstream's alphabetized region (see slice 15).
- [ ] **Step 3: Move `getFaceSuggestions`, `confirmFaceSuggestion`, `rejectFaceSuggestion`, `ignoreFaceSuggestion`, `dismissFaceSuggestions`** across, with their guards intact — including the `Permission.PersonCreate` face check slice 4 relies on.
- [ ] **Step 4: Move the four endpoints** to `face-suggestion.controller.ts`, preserving each route path, `@Authenticated` decorator and `HistoryBuilder` lifecycle **exactly**, so the OpenAPI output is unchanged.
- [ ] **Step 5: Leave behind only the genuine hooks** in `person.service.ts`: verdict clearing in `reassignFaces`/`reassignFacesById`, the re-scan queue in `update()`, the backfill-completion queue, and the bootstrap sweep.
- [ ] **Step 6: Prove nothing moved on the wire**

```bash
cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api
git status --porcelain open-api packages/sdk mobile/openapi
```

Expected: **empty**. Any diff means a route, DTO or lifecycle changed and must be reverted to match.

- [ ] **Step 7: Verify and commit**

```bash
cd server && pnpm test          # identical pass count to step 1
git diff --stat origin/main...HEAD -- server/src/controllers/person.controller.ts   # expect no output
git add server web
git commit -m "refactor(face-suggestions): move the suggestion engine into fork-owned files"
```

## Slice 14: Take the Redis repair out of upstream's `getJobCounts`

Upstream's `getJobCounts` is a pure delegate. The fork made it `async` and prepended `removeDanglingActiveJobs`, so upstream's own callers — `queue.service.ts:194` (the admin queue poll, once per queue on every request) and `media.service.ts:167` — now mutate Redis on a read, and `job.repository.ts:371,501` call it in loops.

- [ ] **Step 1:** Add `getJobCountsWithRepair(name)` in the fork region of `job.repository.ts`, containing today's `removeDanglingActiveJobs` + delegate body.
- [ ] **Step 2:** Restore `getJobCounts` to upstream's exact pure form.
- [ ] **Step 3:** Point the fork's own callers (the face-cleanup console's queue read) at `getJobCountsWithRepair`; leave upstream callers on the pure method.
- [ ] **Step 4:** Add a test asserting `getJobCounts` performs **no** Redis writes, and that `getJobCountsWithRepair` does.
- [ ] **Step 5:** `cd server && pnpm test` then commit.

## Slice 15: Three ten-minute isolation fixes

- [ ] **Step 1: Move `FacePersonVerdictRepository` to the fork block.** It sits at `base.service.ts:136` between `PartnerRepository` and `PersonRepository`, inside upstream's alphabetized region, while its three siblings are correctly parked at `:122`. The list is **positional** — an upstream insertion there conflicts, and a careless resolve silently injects the wrong repositories into every service. Move it in all six lists (`repositories/index.ts` ×2, `base.service.ts` ×3, `test/utils.ts`, `test/medium.factory.ts` ×2) and run `pnpm test` to confirm the positional lists still agree.
- [ ] **Step 2: Scope `placeholders.spec.ts` to the fork's locales.** It currently runs `readdirSync(I18N_DIR)` over all ~90 translator-owned files, which is why this PR had to hand-patch `mr.json` and `ms.json`. Weblate will reintroduce those patterns and the web suite will go red on a future rebase for content the fork does not own. Scope it to `en` + `FORK_LOCALES`, then revert the `mr.json`/`ms.json` edits.
- [ ] **Step 3: Revert the upstream e2e edits.** `e2e/src/specs/server/api/asset.e2e-spec.ts` is an upstream test edited to load a fork fixture across directories, and `e2e/src/utils.ts`'s `isQueueEmpty` change alters semantics for every upstream e2e. Restore both to upstream, and add a fork-owned `isQueueEmptyIgnoringPaused` used only by fork specs. If the real-video fixture is genuinely required, cover it in a fork-owned spec.
- [ ] **Step 4:** `cd e2e && pnpm test` (or the API subset), then commit.

---

## Out of scope (deliberately)

- **Wiring `/admin/face-repair/unconfirm` into the UI.** It has zero callers in `web/src`, so a mistaken lock is currently only reversible via the API. Slice 2 removes the _default_ one-way door, which is the GA-blocking part; the undo affordance is a follow-up.
- **The `faces` payload silently discarded by `POST/DELETE /admin/face-repair/decline`.** External-consumer-facing only; web never sends it. Either wire it or delete the DTO fields in a follow-up.
- **Suggestion pagination tiebreaker, the unused `1789` index, and the `LIMIT/OFFSET` instability on the resolutions list.** Real but low-impact at current data sizes; group them into one follow-up.
- **Whether a whole-cluster move should be lockable at all.** `entireCluster` carries no lock field and is therefore always durable, which is the B2 hazard at its largest scale — a mis-picked destination permanently locks the entire cluster. Slice 2 deliberately does not change this, because the request expresses no preference and inventing one is a product decision, not a bug fix. Worth deciding separately, together with exposing `/unconfirm` in the UI.
- **The remaining lower-severity findings** (raw UUIDs in ribbons, `PersonPicker` create-on-type orphans, deleted users in the owner selector) — cosmetic or narrow, and none of them block GA.

## Self-review notes

- Slices 2 and 5 both touch `executeRepair`'s transaction body; do them in order, and re-run `face-repair.resolve.spec.ts` after each.
- Slice 4's guard will make any existing space-suggestion medium fixture that seeds a non-owned face fail. That failure is correct — fix the fixture.
- Slice 9 changes translated strings only; no `en.json` value changes, so no stale-translation exposure elsewhere.
- Slice 13 must not change any route path or DTO. The `git status --porcelain` check on generated artifacts in step 6 is the gate, not a formality.
- Phases 1 and 2 are independently shippable. If GA timing gets tight, Phase 1 alone removes every user-visible data hazard; Phases 3 and 4 can follow.
