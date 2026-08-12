# Face Verdict Remediation — Slice 3: The suggestion engine reads the shared verdict layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close **D3** — make §5.2's "both engines, same checks" true. The suggestion engine (a) excludes manual-linked + negatively-verdicted faces at scan **write** time, (b) self-heals settled faces out of the pending **reads**, and (c) space confirm writes the `shared_space_person_face` projection so the same space's next scan can't re-propose it. Closes the parent's defect 5 in **both** directions.

**Architecture:** Extract `buildVerdictMaps` from `FaceRepairService` into a thin **plain-class** `FaceVerdictService` (repos only) built in `BaseService`'s constructor — the exact pattern the already-shared `IdentityMergePropagationService` uses, so no DI/`BASE_SERVICE_DEPENDENCIES`/`BaseService.create`/medium-factory changes and no circular dependency. `FaceRepairService` delegates (behaviour-neutral; its specs stay green). The two suggestion scan handlers consult a narrow `getFaceSettlementInputs(assetFaceIds)` before upserting; the two pending reads gain SQL anti-joins; space confirm calls `addPersonFaces`.

**Tech Stack:** NestJS 11, Kysely (`NOT EXISTS` anti-joins, `sql`), Vitest medium (testcontainers).

## Global Constraints

- `src/` alias imports; eslint `--max-warnings 0`; Prettier 120-col.
- Unit run: `cd server && pnpm exec vitest --config test/vitest.config.mjs --run <path>`. Medium run: `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run <path>`. NEVER `pnpm test:medium -- --run` / `pnpm test -- --run` (drop the filter). Confirm each file executed.
- `FaceVerdictService` is a plain class (NOT `@Injectable`, NOT in `src/services/index.ts`), constructed in `BaseService`'s constructor and exposed as `this.faceVerdictService`. Model it on `IdentityMergePropagationService` (`base.service.ts:243-250`).
- The extraction is behaviour-neutral: `face-repair.person.spec.ts` (unit) and every `face-repair.*` medium spec MUST stay green **unchanged**. If any needs changing, the extraction is wrong.
- Scope: Slice 3 only. Do NOT change verdict-write opts (Slice 2, done), owner-only read gates or personal asset-state gates (Slice 6), or manual-source preservation (Slice 4).
- One commit at the end. No `Co-Authored-By` trailers.

---

## File Structure

- **Create** `server/src/services/face-verdict.service.ts` — plain class. `buildVerdictMaps(scope)` (moved verbatim from FaceRepairService, returns the full `VerdictMaps`) + a narrow `getFaceSettlementInputs(assetFaceIds: string[]): Promise<{ manualLinkedFaceIds: Set<string>; negativeFaceTargets: Map<string, Set<string>> }>` for the suggestion engine.
- **Modify** `server/src/services/base.service.ts` — construct `this.faceVerdictService = new FaceVerdictService({ faceIdentityRepository, facePersonVerdictRepository, faceRepairDeclineRepository, logger: this.logger })` (mirror the `identityMergePropagationService` block ~243-250; add the field declaration).
- **Modify** `server/src/services/face-repair.service.ts` — delete the private `buildVerdictMaps` body; replace with a one-line delegate to `this.faceVerdictService.buildVerdictMaps`. No other change (the 3 call sites keep calling `this.buildVerdictMaps`).
- **Modify** `server/src/services/person.service.ts` — `handlePersonSuggestionScan` (~805-846) and `handleSpacePersonSuggestionScan` (~868-928): drop excluded candidates before `upsertPending`/`upsertPendingForSpacePerson`, using `faceVerdictService.getFaceSettlementInputs` + the scan target's identity token.
- **Modify** `server/src/repositories/face-person-verdict.repository.ts` — add manual-link + identity-negative `NOT EXISTS` anti-joins to `getPendingForPerson` (~323-384) and `getPendingForSpacePerson` (~389-467).
- **Modify** `server/src/services/shared-space.service.ts` — `confirmSpacePersonFaceSuggestion` (~1296-1325): add `await this.sharedSpaceRepository.addPersonFaces([{ personId: person.id, assetFaceId }])`.
- **Create** `server/test/medium/specs/services/face-suggestion-exclusions.spec.ts` — the red-first exclusion suite.
- **Modify** `server/test/medium/specs/services/face-review-cross-flow.spec.ts` — add a `setupSpace` helper + the two defect-5 BDD scenarios.

**Interfaces produced:**

```ts
// face-verdict.service.ts
class FaceVerdictService {
  constructor(deps: { faceIdentityRepository; facePersonVerdictRepository; faceRepairDeclineRepository; logger });
  buildVerdictMaps(scope: {
    assetFaceIds: string[];
    personIds: string[];
    suspectedOwnerIds: string[];
  }): Promise<VerdictMaps>;
  getFaceSettlementInputs(
    assetFaceIds: string[],
  ): Promise<{ manualLinkedFaceIds: Set<string>; negativeFaceTargets: Map<string, Set<string>> }>;
}
```

---

## Task 1: Red — suggestion-exclusions medium suite

**Files:** Create `server/test/medium/specs/services/face-suggestion-exclusions.spec.ts`.

Drive REAL handlers on one DB: construct `PersonService` (for `handlePersonSuggestionScan`/`handleSpacePersonSuggestionScan`/`confirmFaceSuggestion`) and `SharedSpaceService` (for `confirmSpacePersonFaceSuggestion`) via `newMediumService`, sharing `db`. Seed people/spaces/faces + embeddings so a scan would propose a face, then assert exclusion. Copy embedding/search seeding from `person.service.spec.ts:3833-3982` (`handlePersonSuggestionScan` describe — note it's unit/mock; for medium you need real `searchFaces`, so seed real face embeddings via `ctx.newAssetFace` with an `embedding`, mirroring how `shared-space-face-suggestions.service.spec.ts` seeds space suggestion fixtures). Read the pending queue via `facePersonVerdictRepository.getPendingForPerson`/`getPendingForSpacePerson` or a direct `db.selectFrom('face_person_verdict')`.

- [ ] **Step 1: Write these `it(...)` (all RED today):**
  1. **"a manual-linked face is proposed to no one"** — face F has `face_identity_face.source='manual'` (any identity). Run `handlePersonSuggestionScan` for a person whose embedding matches F → no pending row for F. Run `handleSpacePersonSuggestionScan` for a space person (same space) → none. Run it for a person in a **second** space → none.
  2. **"a negative verdict toward I(Anna) is honoured in every scope sharing that identity"** — reject F toward personal Anna (writes `I(Anna)` per Slice 2). Personal scan for Anna → F not proposed; space scan for a space-Anna whose `identityId = I(Anna)` → F not proposed.
  3. **"an admin keep-here suppresses a later suggestion"** — cleanup keep-here `(F, O, I(O))`; F later unassigned (no `personId`); personal scan for O → F not proposed; space scan for O's space profile (same identity) → not proposed.
  4. **"space confirm makes the same space's next scan skip the face"** — confirm F for space-person P (writes the projection row); re-run `handleSpacePersonSuggestionScan` for another space person in the same space → F not proposed. Assert a `shared_space_person_face` row `(P.id, F)` exists.
  5. **"a face settled after the scan leaves both pending reads"** — scan proposes F (pending row exists); THEN manual-link F (or reject it toward the target); `getPendingForPerson`/`getPendingForSpacePerson` no longer return F (anti-join self-heal), without a re-scan.

- [ ] **Step 2: Run RED** — `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-suggestion-exclusions.spec.ts`. Expected: every scenario proposes/returns F today. Confirm the file executed.

---

## Task 2: Red — cross-flow defect-5 scenarios (both directions)

**Files:** Modify `server/test/medium/specs/services/face-review-cross-flow.spec.ts`.

- [ ] **Step 1:** Add a `setupSpace` helper mirroring the file's existing `setupPerson` (real `SharedSpaceRepository`, `FaceIdentityRepository`, `FacePersonVerdictRepository`, `FaceVerdictService`-dependent services), pointing at the same shared `db`. Add two tests:
  - **"one rejection answers personal and space scope" (defect 5)** — reject F toward personal Anna; then run the **space** suggestion scan for a space-Anna sharing `I(Anna)` → F not proposed. And the reverse: a space reject suppresses the personal scan.
  - **"keep-here suppresses a later suggestion"** — cleanup keep-here on F toward O; later personal scan → F not proposed.
- [ ] **Step 2: Run RED** — `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-review-cross-flow.spec.ts`. Expected: new tests fail (re-proposed today). Confirm the 4 pre-existing tests still pass (do not touch the `.catch(() => {})` at 186-189 — Slice 10).

---

## Task 3: Green — extract FaceVerdictService (behaviour-neutral)

**Files:** Create `server/src/services/face-verdict.service.ts`; Modify `base.service.ts`, `face-repair.service.ts`.

- [ ] **Step 1:** Create the plain class. Move `buildVerdictMaps` verbatim (same repo calls, same `VerdictMaps` from `src/utils/face-repair`). Add the narrow method:

```ts
import { LoggingRepository } from 'src/repositories/logging.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { FaceRepairDeclineRepository } from 'src/repositories/face-repair-decline.repository';
import { VerdictMaps } from 'src/utils/face-repair';

export interface FaceVerdictServiceDependencies {
  faceIdentityRepository: FaceIdentityRepository;
  facePersonVerdictRepository: FacePersonVerdictRepository;
  faceRepairDeclineRepository: FaceRepairDeclineRepository;
  logger: LoggingRepository;
}

export class FaceVerdictService {
  constructor(private deps: FaceVerdictServiceDependencies) {}

  async buildVerdictMaps(scope: {
    assetFaceIds: string[];
    personIds: string[];
    suspectedOwnerIds: string[];
  }): Promise<VerdictMaps> {
    // ... moved verbatim from FaceRepairService, using this.deps.* ...
  }

  // Narrow inputs for the suggestion engine — no cluster-mute / owner-token machinery.
  async getFaceSettlementInputs(
    assetFaceIds: string[],
  ): Promise<{ manualLinkedFaceIds: Set<string>; negativeFaceTargets: Map<string, Set<string>> }> {
    const unique = [...new Set(assetFaceIds)];
    if (unique.length === 0) {
      return { manualLinkedFaceIds: new Set(), negativeFaceTargets: new Map() };
    }
    const [manualLinkedFaceIds, negativeFaceTargets] = await Promise.all([
      this.deps.faceIdentityRepository.getManualLinkedFaceIds(unique),
      this.deps.facePersonVerdictRepository.getNegativeVerdictTokens(unique),
    ]);
    return { manualLinkedFaceIds, negativeFaceTargets };
  }
}
```

- [ ] **Step 2:** In `base.service.ts`, add the field + construct it in the constructor next to `identityMergePropagationService`:

```ts
protected faceVerdictService: FaceVerdictService;
// ... in the constructor, after the repos are assigned:
this.faceVerdictService = new FaceVerdictService({
  faceIdentityRepository, facePersonVerdictRepository, faceRepairDeclineRepository, logger: this.logger,
});
```

Confirm all three repos are already in the `BaseService` constructor scope (they are — `faceRepairDeclineRepository` too). Do NOT add to `BASE_SERVICE_DEPENDENCIES` / `BaseService.create` / `src/services/index.ts` — this is a plain member, not a repo/service dep.

- [ ] **Step 3:** In `face-repair.service.ts`, replace the private `buildVerdictMaps` body with:

```ts
private buildVerdictMaps(scope: { assetFaceIds: string[]; personIds: string[]; suspectedOwnerIds: string[] }): Promise<VerdictMaps> {
  return this.faceVerdictService.buildVerdictMaps(scope);
}
```

- [ ] **Step 4: Behaviour-neutral proof** — run the cleanup suites UNCHANGED, all green:

```
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/face-repair.person.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/services/face-repair.service.spec.ts \
  test/medium/specs/services/face-repair.resolutions.spec.ts \
  test/medium/specs/services/face-repair.resolve.spec.ts \
  test/medium/specs/services/face-repair.merge-consistency.spec.ts
```

If any needs editing, STOP — the extraction changed behaviour.

---

## Task 4: Green — write-time exclusion in both scan handlers

**Files:** Modify `server/src/services/person.service.ts`.

- [ ] **Step 1:** In `handlePersonSuggestionScan`, after building `bestByFace` and before `upsertPending` (~844):

```ts
const candidateFaceIds = [...bestByFace.keys()];
const { manualLinkedFaceIds, negativeFaceTargets } =
  await this.faceVerdictService.getFaceSettlementInputs(candidateFaceIds);
const targetTokens = new Set([`person:${id}`, ...(person.identityId ? [`identity:${person.identityId}`] : [])]);
for (const faceId of candidateFaceIds) {
  const negatives = negativeFaceTargets.get(faceId);
  if (manualLinkedFaceIds.has(faceId) || (negatives && [...negatives].some((t) => targetTokens.has(t)))) {
    bestByFace.delete(faceId);
  }
}
const rows = [...bestByFace].map(([assetFaceId, distance]) => ({ personId: id, assetFaceId, distance }));
await this.facePersonVerdictRepository.upsertPending(rows);
```

> Confirm the exact token strings `getNegativeVerdictTokens` emits (`person:`/`space-person:`/`identity:` prefixes) by reading `face-person-verdict.repository.ts:291-318`, and match them exactly. Personal scan target tokens are `person:<id>` and `identity:<person.identityId>`.

- [ ] **Step 2:** In `handleSpacePersonSuggestionScan`, after the existing `getAssignedFaceIdsForSpace` exclusion and before `upsertPendingForSpacePerson` (~926), add the same manual-link + negative-verdict filter, with target tokens `space-person:${id}` and `identity:${person.identityId}`:

```ts
const candidateFaceIds = [...bestByFace.keys()];
const { manualLinkedFaceIds, negativeFaceTargets } =
  await this.faceVerdictService.getFaceSettlementInputs(candidateFaceIds);
const targetTokens = new Set([`space-person:${id}`, ...(person.identityId ? [`identity:${person.identityId}`] : [])]);
for (const faceId of candidateFaceIds) {
  const negatives = negativeFaceTargets.get(faceId);
  if (manualLinkedFaceIds.has(faceId) || (negatives && [...negatives].some((t) => targetTokens.has(t)))) {
    bestByFace.delete(faceId);
  }
}
```

- [ ] **Step 3:** Run the personal-scan unit spec (`person.service.spec.ts` `handlePersonSuggestionScan` block) — update its mocks to stub `faceVerdictService.getFaceSettlementInputs` (or the underlying repo methods) returning empty maps so existing assertions hold, and add a case asserting a manual-linked/negatively-verdicted candidate is dropped. Run `cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/person.service.spec.ts`.

---

## Task 5: Green — read-time anti-joins

**Files:** Modify `server/src/repositories/face-person-verdict.repository.ts`.

- [ ] **Step 1:** Add to the `base` query in `getPendingForPerson` (and mirror in `getPendingForSpacePerson`) two `NOT EXISTS` predicates. The negative-verdict anti-join must match identity-first: resolve the target's identity via the person/space-person row.

```ts
.where((eb) => eb.not(eb.exists(
  eb.selectFrom('face_identity_face as fif')
    .select(sql`1`.as('one'))
    .whereRef('fif.assetFaceId', '=', 'fpv.assetFaceId')
    .where('fif.source', '=', 'manual'),
)))
.where((eb) => eb.not(eb.exists(
  eb.selectFrom('face_person_verdict as neg')
    .select(sql`1`.as('one'))
    .whereRef('neg.assetFaceId', '=', 'fpv.assetFaceId')
    .where('neg.status', 'in', ['rejected', 'ignored'])
    .where((inner) => inner.or([
      inner('neg.personId', '=', personId),
      inner.and([
        inner('neg.identityId', 'is not', null),
        inner('neg.identityId', '=', eb.selectFrom('person').select('person.identityId').where('person.id', '=', personId)),
      ]),
    ])),
)))
```

> For `getPendingForSpacePerson`, swap `neg.personId = spacePersonId` and resolve the identity via `shared_space_person`. Adjust the exact `eb`/`sql` idioms to type-check (the digest confirms `face_identity_face_assetFaceId` + `face_person_verdict_*` indexes back these). Keep the existing self-heal (`af.personId IS NULL`) and RBAC/asset gates untouched.

- [ ] **Step 2:** Run the verdict repo medium spec + the Task-1 self-heal scenario:

```
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/repositories/face-person-verdict.repository.spec.ts \
  test/medium/specs/services/face-suggestion-exclusions.spec.ts
```

---

## Task 6: Green — space confirm writes the projection row

**Files:** Modify `server/src/services/shared-space.service.ts`.

- [ ] **Step 1:** In `confirmSpacePersonFaceSuggestion`, after `replaceFaceIdentity` + `resolveAssignedFace` (~1323-1324):

```ts
// D3: write the space projection so getAssignedFaceIdsForSpace excludes this face from the same space's next scan.
await this.sharedSpaceRepository.addPersonFaces([{ personId: person.id, assetFaceId }]);
```

- [ ] **Step 2:** Run the space suggestion + exclusion specs:

```
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/services/shared-space-face-suggestions.service.spec.ts \
  test/medium/specs/services/face-suggestion-exclusions.spec.ts
```

Expected: scenario 4 (same-space re-scan skips) + the projection-row assertion pass.

---

## Task 7: Refactor + done gate + commit

- [ ] **Step 1: Refactor check** — cleanup's three `buildVerdictMaps` call sites now delegate through `FaceVerdictService`; the private copy is deleted (Task 3). No duplicated exclusion logic remains. Re-run Task 3 Step 4 (cleanup suites) — still green.
- [ ] **Step 2: Full done gate** (in full):

```
cd server && pnpm check && pnpm lint
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/services/face-suggestion-exclusions.spec.ts \
  test/medium/specs/services/face-review-cross-flow.spec.ts \
  test/medium/specs/services/shared-space-face-suggestions.service.spec.ts \
  test/medium/specs/repositories/face-person-verdict.repository.spec.ts \
  test/medium/specs/services/face-repair.service.spec.ts \
  test/medium/specs/services/face-repair.resolutions.spec.ts \
  test/medium/specs/services/face-repair.resolve.spec.ts \
  test/medium/specs/services/face-repair.merge-consistency.spec.ts \
  test/medium/specs/services/face-verdict.merge-durability.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/person.service.spec.ts src/services/face-repair.person.spec.ts
```

- [ ] **Step 3: Commit:**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/face-unified
git add server/src/services/face-verdict.service.ts server/src/services/base.service.ts \
        server/src/services/face-repair.service.ts server/src/services/person.service.ts \
        server/src/services/shared-space.service.ts server/src/repositories/face-person-verdict.repository.ts \
        server/test/medium/specs/services/face-suggestion-exclusions.spec.ts \
        server/test/medium/specs/services/face-review-cross-flow.spec.ts \
        server/src/services/person.service.spec.ts \
        docs/superpowers/plans/2026-07-23-face-verdict-remediation-slice-3.md
git commit -m "feat(server): suggestion engine consults the shared verdict layer"
```

---

## Edge-case coverage map (spec §Slice 3 table → test)

| Edge case                                                       | Covered by                                                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Negative toward O only                                          | Task 1 scenario 2 variant: F still proposable toward Q (target-scoped — assert a different person Q still gets F)                                                  |
| Manual link to identity X, scan proposes person with identity X | Task 1 scenario 1 (excluded — already settled positively)                                                                                                          |
| Manual link to X, scan proposes person with identity Y          | Task 1 scenario 1 (excluded — manual-link is owner-agnostic; `getFaceSettlementInputs` returns the face regardless of which identity)                              |
| Scan config gate off / band empty                               | handlers `return JobStatus.Skipped` before the exclusion — no `getFaceSettlementInputs` call on the skip path (assert not called via a spy, or that no query runs) |
| Provider scope discipline                                       | `getFaceSettlementInputs` is called with exactly `candidateFaceIds` (the bestByFace set) — never unscoped; assert in the unit test                                 |
| Projection row already exists (face-match raced confirm)        | `addPersonFaces` uses `onConflict().doNothing()` — idempotent; Task 6 test confirms no duplicate/throw                                                             |

## Self-review (author)

- **Spec coverage:** write-time exclusion (both handlers), read-time anti-joins (both reads), space-confirm projection, FaceVerdictService extraction + delegation, cross-flow defect-5 both directions — each has a task + test. ✅
- **Placeholder scan:** the FaceVerdictService code, the exclusion loop, the anti-join SQL, and the confirm one-liner are concrete. The two medium suites describe scenarios with the exact seeding sources named (they're new files against real `searchFaces`, so fixture code is transcribed from the named sibling specs). ⚠️ The anti-join `eb`/`sql` idioms may need adjustment to type-check — the plan names the indexes and the exact predicate; the implementer makes it compile. Acceptable.
- **Type consistency:** `getFaceSettlementInputs` signature identical in the interface block, Task 3 def, and Task 4 call sites. `faceVerdictService` field name consistent. ✅
- **Scope:** no Slice 2 re-work, no owner/asset read gates (Slice 6), no manual-source preservation (Slice 4). ✅
- **R2 (measure-first):** the digest establishes the write-time exclusion is index-backed and scoped to the ≤2000-id candidate set (same class as the existing `getAssignedFaceIdsForSpace`), dwarfed by the ANN searches — so the write-time exclusion stays. Fallback (drop write-time, rely on read-time anti-join) is NOT needed; document this finding in the commit/report. Add a `face-suggestion-exclusions` timing note if a 1k-face fixture is cheap to add; otherwise the reasoning above is the recorded decision.
