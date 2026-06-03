# Face re-attribution repair — Slice 1 (Detector core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
> Follow TDD strictly: write the failing test, RUN it and confirm the expected red, then minimal impl, RUN green.
> Report red and green command output for every behavior. Do not implement Slice 2+ (the flag rule / margins).

**Goal:** Produce the re-attribution detector's raw signal — for each eligible face, a vote tally of its
same-owner assigned neighbors identifying the dominant _other_ owner `Q` — with no flag decision yet.

**Architecture:** A pure tally function (no DB) + a repository that streams eligible faces (machine-learning,
visible, assigned, non-deleted, embedded) + a service method that, per eligible face, reuses the existing
prod-proven k-NN `SearchRepository.searchFaces` and applies the tally. Reusing `searchFaces` (which already runs
on Hagen's pgvecto.rs box in recognition) means **no new vector SQL**, so no engine-compat risk in this slice.

**Tech stack:** NestJS, Kysely, Vitest (unit + medium/testcontainers). Spec:
`docs/plans/2026-05-31-face-reattribution-repair-design.md`.

**Verify-before-coding (read these, confirm exact names):**

- `server/src/repositories/search.repository.ts:901` — `searchFaces(FaceEmbeddingSearch)`: confirm the **return
  row shape** (field names for the asset-face id, `personId`, `distance`) and that `hasPerson: true` restricts to
  assigned faces. Use those exact field names below.
- `server/src/repositories/person.repository.ts:148` — `getAllFaces` filter style to mirror.
- `server/src/enum.ts` — `SourceType.MachineLearning`.
- `server/test/medium.factory.ts` — `newMediumService`, `newRealRepository` switch (register new repos here, per
  `feedback_medium_factory_repo_registration`), `ctx.newPerson/newAsset/newAssetFace`.
- `server/test/medium/specs/repositories/face-identity.repository.spec.ts:184` — reuse `axisEmbedding`,
  `newPersonalIdentityCluster` patterns (disjoint axes = distinct people).

---

### Task 1: Pure tally function

**Files:**

- Create: `server/src/utils/face-repair.ts`
- Test: `server/src/utils/face-repair.spec.ts`

- [ ] **Step 1: Write the failing unit test**

```typescript
import { ReattributionNeighbor, tallyReattribution } from 'src/utils/face-repair';

const n = (personId: string | null, distance: number): ReattributionNeighbor => ({
  assetFaceId: `${personId}-${distance}`,
  personId,
  distance,
});

describe('tallyReattribution', () => {
  it('reports the dominant other owner by neighbor count', () => {
    const tally = tallyReattribution('P', [n('Q', 0.1), n('Q', 0.2), n('Q', 0.3), n('P', 0.4)]);
    expect(tally.ownCount).toBe(1);
    expect(tally.topOtherPersonId).toBe('Q');
    expect(tally.topOtherCount).toBe(3);
    expect(tally.topOtherNearest).toBeCloseTo(0.1);
  });

  it('breaks ties on nearest distance', () => {
    const tally = tallyReattribution('P', [n('Q', 0.5), n('R', 0.2)]);
    expect(tally.topOtherPersonId).toBe('R');
  });

  it('returns no other owner when only the current person is nearby', () => {
    const tally = tallyReattribution('P', [n('P', 0.1), n('P', 0.2)]);
    expect(tally.ownCount).toBe(2);
    expect(tally.topOtherPersonId).toBeNull();
    expect(tally.topOtherCount).toBe(0);
  });

  it('ignores neighbors with no person', () => {
    const tally = tallyReattribution('P', [n(null, 0.1), n('Q', 0.2)]);
    expect(tally.topOtherPersonId).toBe('Q');
    expect(tally.topOtherCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run, confirm red**

Run: `cd server && pnpm test -- --run src/utils/face-repair.spec.ts`
Expected: FAIL — cannot find module `src/utils/face-repair` / `tallyReattribution` not a function.

- [ ] **Step 3: Minimal implementation**

```typescript
export interface ReattributionNeighbor {
  assetFaceId: string;
  personId: string | null;
  distance: number;
}

export interface ReattributionTally {
  ownCount: number;
  ownNearest: number | null;
  topOtherPersonId: string | null;
  topOtherCount: number;
  topOtherNearest: number | null;
}

// Tally a face's already-self-excluded, within-maxDistance assigned neighbors by person.
export const tallyReattribution = (currentPersonId: string, neighbors: ReattributionNeighbor[]): ReattributionTally => {
  const byPerson = new Map<string, { count: number; nearest: number }>();
  for (const neighbor of neighbors) {
    if (!neighbor.personId) {
      continue;
    }
    const entry = byPerson.get(neighbor.personId);
    if (entry) {
      entry.count += 1;
      entry.nearest = Math.min(entry.nearest, neighbor.distance);
    } else {
      byPerson.set(neighbor.personId, { count: 1, nearest: neighbor.distance });
    }
  }

  let topOtherPersonId: string | null = null;
  let topOtherCount = 0;
  let topOtherNearest: number | null = null;
  for (const [personId, { count, nearest }] of byPerson) {
    if (personId === currentPersonId) {
      continue;
    }
    const wins = count > topOtherCount || (count === topOtherCount && nearest < (topOtherNearest ?? Infinity));
    if (wins) {
      topOtherPersonId = personId;
      topOtherCount = count;
      topOtherNearest = nearest;
    }
  }

  const own = byPerson.get(currentPersonId);
  return {
    ownCount: own?.count ?? 0,
    ownNearest: own?.nearest ?? null,
    topOtherPersonId,
    topOtherCount,
    topOtherNearest,
  };
};
```

- [ ] **Step 4: Run, confirm green** — `cd server && pnpm test -- --run src/utils/face-repair.spec.ts` → PASS.
- [ ] **Step 5: Commit** — `git add server/src/utils/face-repair.ts server/src/utils/face-repair.spec.ts && git commit -m "feat(server): add face re-attribution tally util"`

---

### Task 2: Eligible-face enumerator repository

**Files:**

- Create: `server/src/repositories/face-repair.repository.ts`
- Modify: `server/test/medium.factory.ts` (register `FaceRepairRepository` in the `newRealRepository` switch — copy
  the style of a simple `new key(db)` repo registration).
- Test: `server/test/medium/specs/repositories/face-repair.repository.spec.ts`

- [ ] **Step 1: Write the failing medium test.** Build, for one owner: (a) a person with 2 ML faces + embeddings
      (eligible); (b) a `manual`-sourced face and an `exif`-sourced face (skipped); (c) a soft-deleted face and a
      not-visible face (skipped); (d) a face with no `face_search` row (skipped). Assert `streamEligibleFaces({ownerId})`
      yields exactly the 2 eligible faces with `{assetFaceId, personId, ownerId, embedding}` populated. Use
      `ctx.newPerson/newAsset/newAssetFace`, raw `face_search` inserts, and set `sourceType` via `newAssetFace` dto.
      (Confirm `newAssetFace` accepts `sourceType`, `deletedAt`, `isVisible`; if not, set them via a follow-up
      `ctx.database.updateTable('asset_face')`.)

- [ ] **Step 2: Run, confirm red** — `cd server && pnpm test:medium run test/medium/specs/repositories/face-repair.repository.spec.ts` → FAIL (repository/method missing; or factory "Unable to create repository instance" until registered).

- [ ] **Step 3: Implement** the repository:

```typescript
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { SourceType } from 'src/enum';
import { DB } from 'src/schema';

export interface EligibleFaceRow {
  assetFaceId: string;
  personId: string;
  ownerId: string;
  embedding: string;
}

export class FaceRepairRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  streamEligibleFaces(options: { ownerId?: string; personId?: string }) {
    return this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .select([
        'asset_face.id as assetFaceId',
        'asset_face.personId as personId',
        'asset.ownerId as ownerId',
        'face_search.embedding as embedding',
      ])
      .where('asset_face.personId', 'is not', null)
      .where('asset_face.sourceType', '=', sql.lit(SourceType.MachineLearning))
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .$if(!!options.ownerId, (qb) => qb.where('asset.ownerId', '=', options.ownerId!))
      .$if(!!options.personId, (qb) => qb.where('asset_face.personId', '=', options.personId!))
      .$narrowType<{ personId: string }>()
      .stream();
  }
}
```

Register in `newRealRepository` (medium.factory.ts) in the simple `new key(db)` block.

- [ ] **Step 4: Run, confirm green** — same command → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(server): enumerate re-attribution-eligible faces"`

---

### Task 3: Detector composition (service)

**Files:**

- Create: `server/src/services/face-repair.service.ts` (extends `BaseService`).
- Test: `server/test/medium/specs/services/face-repair.service.spec.ts`

- [ ] **Step 1: Write the failing medium test.** Using disjoint-axis embeddings (`axisEmbedding('first')` = person
      Karina-main with many faces; a small set of `axisEmbedding('first')` faces wrongly assigned to person Alexia =
      the leak; `axisEmbedding('second')` = a clean unrelated person). For one owner, collect
      `findReattributionCandidates({ ownerId, maxDistance: 0.6, voteWindow: 50 })` into an array. Assert:
  - the leaked faces (on Alexia) each have `topOtherPersonId === Karina.id` with `topOtherCount > 0`;
  - a clean Karina-main face has `topOtherPersonId === null` (or its own person dominates and no other is present);
  - a face is **never** its own neighbor (self excluded): a person with a single face has `ownCount === 0`;
  - **owner isolation**: a near-identical face owned by a _different_ user does not appear as `Q` (build a second
    owner with `axisEmbedding('first')` faces; the first owner's candidates must not reference the second owner's
    person).

- [ ] **Step 2: Run, confirm red** — `cd server && pnpm test:medium run test/medium/specs/services/face-repair.service.spec.ts` → FAIL (service/method missing).

- [ ] **Step 3: Implement** the service method (confirm `searchFaces` field names first):

```typescript
import { Injectable } from '@nestjs/common';
import { BaseService } from 'src/services/base.service';
import { ReattributionTally, tallyReattribution } from 'src/utils/face-repair';

export interface ReattributionCandidate extends ReattributionTally {
  assetFaceId: string;
  currentPersonId: string;
}

@Injectable()
export class FaceRepairService extends BaseService {
  async *findReattributionCandidates(options: {
    ownerId?: string;
    personId?: string;
    maxDistance: number;
    voteWindow: number;
  }): AsyncIterableIterator<ReattributionCandidate> {
    for await (const face of this.faceRepairRepository.streamEligibleFaces(options)) {
      const matches = await this.searchRepository.searchFaces({
        userIds: [face.ownerId],
        embedding: face.embedding,
        maxDistance: options.maxDistance,
        numResults: options.voteWindow,
        hasPerson: true,
      });
      // searchFaces includes the query face itself — drop it. Use the confirmed field names.
      const neighbors = matches
        .filter((match) => match.id !== face.assetFaceId)
        .map((match) => ({ assetFaceId: match.id, personId: match.personId, distance: match.distance }));
      yield {
        assetFaceId: face.assetFaceId,
        currentPersonId: face.personId,
        ...tallyReattribution(face.personId, neighbors),
      };
    }
  }
}
```

`faceRepairRepository` and `searchRepository` must be available on `BaseService` — add `FaceRepairRepository` to
the BaseService repository injection list (follow how `searchRepository`/`faceIdentityRepository` are wired in
`src/services/base.service.ts`). In the test, `newMediumService(FaceRepairService, { real: [FaceRepairRepository,
SearchRepository], mock: [LoggingRepository] })`.

- [ ] **Step 4: Run, confirm green** — same command → PASS.
- [ ] **Step 5: Run the full guard suites to confirm no regression** —
      `cd server && pnpm test:medium run test/medium/specs/repositories/face-repair.repository.spec.ts test/medium/specs/services/face-repair.service.spec.ts` → PASS; `pnpm exec tsc --noEmit` clean; `pnpm exec eslint <new files> --max-warnings 0` clean; `pnpm exec prettier --write <new files>`.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(server): re-attribution detector candidate stream"`

---

## Self-review (run after writing, fix inline)

- Spec coverage (Slice 1 row of the matrix): leak→Q ✓ (T3); clean flags nothing ✓ (T3); manual/exif skipped ✓
  (T2); no-embedding skipped ✓ (T2); deleted/invisible/deleted-asset excluded ✓ (T2); cross-owner ignored ✓ (T3);
  isolated/self-excluded ✓ (T1, T3). No new vector SQL ⇒ the "pgvecto.rs engine-compat" matrix item does not apply
  to this slice (searchFaces is already prod-proven on pgvecto.rs); note this in the slice PR description.
- No flag decision / margins here (that is Slice 2). No placeholders. Type names consistent
  (`ReattributionNeighbor`, `ReattributionTally`, `ReattributionCandidate`, `EligibleFaceRow`).
