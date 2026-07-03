# Slice 5 — M2: server People honors per-user `people.minimumFaces` (count == list)

**Finding:** M2 · `server/src/services/person.service.ts` · **Status target:** FIXED (slice S5)
**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §"Slice 5 — M2"

## Problem

Upstream v3 added a per-user `people.minimumFaces` preference
(`server/src/dtos/user-preferences.dto.ts:48`, optional int, default `3` in
`server/src/utils/preferences.ts:24`).

The **non-shared-space People _list_** (`personRepository.getAllForUser`) already
honors it: the `HAVING` clause reads it directly in SQL at
`server/src/repositories/person.repository.ts:333-339`:

```sql
COUNT(asset_face.assetId) >= COALESCE(
  (SELECT value -> 'people' ->> 'minimumFaces'
   FROM user_metadata WHERE "userId" = $userId AND key = 'preferences'),
  '3')::int
```

So the list threshold = **pref-if-set, else literal 3** (NOT the ML config).

But every _param-taking_ People surface in `person.service.ts` still passes
`minimumFaceCount: machineLearning.facialRecognition.minFaces` (ML config default,
also 3 out of the box). The repository methods that receive the param
(`getNumberOfPeople`, `getPeopleOverviewStatistics`, `getPeopleFaceStatistics`,
`faceIdentity.getAccessiblePeople*`) do NOT read the SQL pref — they use
`options.minimumFaceCount ?? 1`. So when a user sets `minimumFaces = 5`:

- non-shared **list** (SQL read) → 5
- non-shared **count**/stats (param = ML 3) → 3 → **count diverges from list**
- `withSharedSpaces` list + stats (param = ML 3) → 3 → **pref is a no-op**

## Call-sites to fix (all currently `machineLearning.facialRecognition.minFaces`)

| service line | method                                           | surface                     |
| ------------ | ------------------------------------------------ | --------------------------- |
| ~102         | `faceIdentity.getAccessiblePeople`               | withSharedSpaces LIST       |
| ~124         | `person.getNumberOfPeople`                       | non-shared COUNT (getAll)   |
| ~144         | `faceIdentity.getAccessiblePeopleStatistics`     | withSharedSpaces stats      |
| ~149         | `person.getPeopleOverviewStatistics`             | non-shared stats            |
| ~162         | `faceIdentity.getAccessiblePeopleFaceStatistics` | withSharedSpaces face-stats |
| ~167         | `person.getPeopleFaceStatistics`                 | non-shared face-stats       |

**Out of scope (do NOT touch):** face-recognition/clustering internals at
`person.service.ts` ~995/~1012/~1019 (`numResults`, match thresholds) — ML matching,
not the People count/list. `shared-space.service.ts` call-sites (not a `person.service`
People surface). The `getAllForUser` LIST call at ~119 (reads pref in SQL, takes no
`minimumFaceCount` param — leave as-is to avoid a double filter).

## Double-filter analysis (the "no double-filter" requirement)

- **Non-shared LIST** (`getAllForUser`, service ~119): reads pref in SQL (`:333`), takes
  **no** `minimumFaceCount` param → filtered **once**, value = `pref ?? 3`.
- **Non-shared COUNT/stats** (`getNumberOfPeople` etc.): param **only**, no SQL read →
  filtered **once**.
- **withSharedSpaces**: param only, no SQL read → filtered **once**.

Resolution: `const minimumFaceCount = getPreferences(metadata).people.minimumFaces ?? machineLearning.facialRecognition.minFaces`.
Because `getPreferences` **defaults `people.minimumFaces` to 3**, the resolved value is
`pref-if-set-else-3` — byte-identical to what the LIST's SQL `COALESCE(pref,'3')` applies.
So COUNT == LIST, no path filters twice, and the `?? mlMinFaces` fallback (defensive; only
fires if the whole `people` object were absent, which `getPreferences` guarantees it is not)
can never diverge from the SQL `'3'`.

## Preference accessor

Same pattern as `album.service.ts:151` / `download.service.ts:95-96`:

```ts
const preferences = getPreferences(await this.userRepository.getMetadata(auth.user.id));
```

Both `this.userRepository` (BaseService) and `getPreferences` (`src/utils/preferences`) are
already available. Load once per request in each of the 3 service methods.

## RED tests — `server/src/services/person.service.spec.ts`

New `describe('people.minimumFaces preference (M2)')` block. Add
`mocks.user.getMetadata.mockResolvedValue([])` to the top-level `beforeEach` (default prefs →
`minimumFaces = 3`) so existing `minimumFaceCount: 3` assertions stay valid once the service
starts reading metadata. Helper to build a pref metadata item:

```ts
const prefsMetadata = (minimumFaces: number) => [
  { key: UserMetadataKey.Preferences, value: { people: { minimumFaces } } },
];
```

Tests (all set ML `minFaces` = default 3):

1. `getAll({ withSharedSpaces: true })` + pref 5 → `getAccessiblePeople` called with `minimumFaceCount: 5`.
2. `getPeopleStatistics({ withSharedSpaces: true })` + pref 5 → `getAccessiblePeopleStatistics` `minimumFaceCount: 5`.
3. `getPeopleFaceStatistics({ withSharedSpaces: true })` + pref 5 → `getAccessiblePeopleFaceStatistics` `minimumFaceCount: 5`.
4. Non-shared `getPeopleStatistics` + pref 5 → `getPeopleOverviewStatistics` `minimumFaceCount: 5`; non-shared `getPeopleFaceStatistics` + pref 5 → `getPeopleFaceStatistics` `minimumFaceCount: 5`.
5. **count == list, no double filter:** non-shared `getAll` + pref 5 → `getNumberOfPeople` gets `minimumFaceCount: 5` (== the pref the LIST's SQL applies) AND `getAllForUser` is called with an object **not** containing `minimumFaceCount` (list still filters only in SQL).
6. Pref unset (`getMetadata` → `[]`) → `getAccessiblePeople` gets `minimumFaceCount: 3` (getPreferences default == list's SQL `'3'` fallback, no throw).
7. Edge values threaded: pref 1 → `minimumFaceCount: 1`; pref 50 → `minimumFaceCount: 50`.
8. Missing preference object (`getMetadata` → `[]`) does not throw and yields 3 (covered by 6; add an explicit no-throw assert).

**Expected RED:** current code passes ML `minFaces` (3) at all six call-sites → tests 1-5,7 fail
(receive 3, expect 5/1/50).

**Command:** `cd server && pnpm test -- --run src/services/person.service.spec.ts`

## Minimal implementation — `person.service.ts`

Add `import { getPreferences } from 'src/utils/preferences';`. Add private helper:

```ts
private async resolveMinimumFaceCount(auth: AuthDto): Promise<number> {
  const { machineLearning } = await this.getConfig({ withCache: false });
  const preferences = getPreferences(await this.userRepository.getMetadata(auth.user.id));
  return preferences.people.minimumFaces ?? machineLearning.facialRecognition.minFaces;
}
```

In `getAll`, `getPeopleStatistics`, `getPeopleFaceStatistics`: replace the inline
`const { machineLearning } = await this.getConfig(...)` (used only for minFaces in these
methods) with `const minimumFaceCount = await this.resolveMinimumFaceCount(auth);` and pass
`{ ..., minimumFaceCount }` to each of the six call-sites. Leave `getAllForUser` untouched.

## GREEN / verify

- `cd server && pnpm test -- --run src/services/person.service.spec.ts` — green.
- `cd server && npx tsc --noEmit -p tsconfig.json` — no new `error TS`.
- Ignore the 3 pre-existing `exif/audio-video.spec.ts` ffprobe failures if they surface.

## Commit

`fix(server): honor per-user people.minimumFaces on shared-space People + stats (M2)`
Stage: `person.service.ts`, `person.service.spec.ts`, the findings-doc Status line, this plan.
Do NOT stage `.sql`.
