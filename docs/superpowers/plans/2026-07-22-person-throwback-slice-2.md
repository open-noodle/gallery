# Slice 2 — repository queries

Spec: `docs/plans/2026-07-22-memory-person-throwback-spec.md` §3.3, §9 Slice 2.
Independent of Slice 1. No rule code in this slice.

## Goal

Three `@GenerateSql`-decorated queries that feed the rule, plus their regenerated `.sql` docs.

## Part A — `getDormantPeople`

In `server/src/repositories/person.repository.ts`, next to `getBirthdaysForDay` (~line 297).

```ts
export interface DormantPerson {
  id: string;
  name: string;
}
```

`id` and `name` only — the rule consumes nothing else, and `lastSeenAt` is exactly the dormancy
figure the spec keeps out of stored data (§2 D1).

```ts
@GenerateSql({
  params: [DummyValue.UUID, { lastSeenBefore: DummyValue.DATE, minAssets: 10, limit: 10 }],
})
getDormantPeople(
  ownerId: string,
  { lastSeenBefore, minAssets, limit }: { lastSeenBefore: Date; minAssets: number; limit: number },
): Promise<DormantPerson[]>
```

Query shape — `person` → `asset_face` → `asset`:

| Side   | Predicates                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------- |
| person | `ownerId = :ownerId`, `type = 'person'`, `name != ''`, `isHidden = false`                       |
| face   | `deletedAt is null`, `isVisible = true`                                                         |
| asset  | `ownerId = :ownerId`, `visibility = Timeline`, `deletedAt is null`, Preview `asset_file` EXISTS |

Then:

```
GROUP BY person.id
HAVING max(asset."localDateTime") < :lastSeenBefore
   AND count(DISTINCT asset.id) >= :minAssets
ORDER BY count(DISTINCT asset.id) DESC, person.id ASC
LIMIT :limit
```

`ORDER BY` on an aggregate needs no matching `SELECT` — do not add one.

**Copy the asset-side predicate block from `getMemoryFacesForPeriod`** (`asset.repository.ts`,
~line 1001) rather than retyping it. Predicate parity is the point: a missing `Preview EXISTS` makes
people look dormant who are not. That includes the `eb.exists(...)` subquery on `asset_file` with
`type = AssetFileType.Preview`.

`HAVING` with Kysely: use `.having(...)` with `sql` fragments or `eb.fn.max`/`eb.fn.count` as the
surrounding code does. `person.type = 'person'` is a plain string literal — there is no enum
(`person.repository.ts` already filters `'pet'` this way elsewhere).

## Part B — the two asset queries

In `server/src/repositories/asset.repository.ts`, next to `getMemoryFacesForPeriod`.

```ts
export interface MemoryPersonDayCount {
  personId: string;
  day: Date;
  count: number;
}

@GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID], { takenBefore: DummyValue.DATE }] })
getMemoryPersonDailyCounts(
  ownerId: string,
  personIds: string[],
  { takenBefore }: { takenBefore: Date },
): Promise<MemoryPersonDayCount[]>

@GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, { from: DummyValue.DATE, to: DummyValue.DATE }] })
getMemoryAssetsForPersonWindow(
  ownerId: string,
  personId: string,
  { from, to }: { from: Date; to: Date },
): Promise<MemoryAsset[]>
```

`getMemoryPersonDailyCounts`:

- Same person/face/asset predicates as Part A, plus `asset_face.personId in personIds` and
  `asset.localDateTime <= takenBefore`.
- Select `asset_face.personId`, the UTC-truncated day, and a distinct asset count:
  `date_trunc('day', asset."localDateTime" at time zone 'UTC')` as `day`,
  `count(DISTINCT asset.id)::int` as `count`.
- `GROUP BY asset_face."personId", day`, `ORDER BY personId, day ASC`.
- `count(DISTINCT asset.id)`, not `count(*)` — two faces of the same person on one asset must not
  double-count.

`getMemoryAssetsForPersonWindow`:

- Returns the existing `MemoryAsset` type (`id`, `localDateTime`) — already exported.
- Same predicates, plus `asset_face.personId = personId` and
  `asset.localDateTime >= from AND asset.localDateTime <= to` (inclusive both ends — `from`/`to`
  are the chapter's first and last day at UTC midnight, so `to` must be taken as end-of-day:
  filter `< to + 1 day` rather than `<= to`, otherwise assets later on the final day are dropped).
- `distinctOn(['asset.id'])` to collapse multiple faces, then `ORDER BY asset."localDateTime" ASC`.
  Note Postgres requires `DISTINCT ON` expressions to lead `ORDER BY` — mirror how
  `getMemoryAssetsForPerson` handles this, but **do not copy its `ORDER BY asset.id … LIMIT 60`**;
  that is the arbitrary-UUID-sample bug the spec calls out (§7.3). No `LIMIT` here — the window is
  already bounded.

## Part C — regenerate the SQL docs

**`make sql` no longer exists** (the Makefile target prints a removal notice). The command is
`mise sql`, which runs `server/dist/bin/sync-sql.js` — so it needs a **build** and a **live DB**.

A Postgres matching CI is already running on `localhost:5432`
(`ghcr.io/immich-app/postgres:14-vectorchord0.4.3`, user/pass `postgres`, db `immich`).

From the repo root, in order:

```
mise //:plugins
mise //server:build
pnpm --filter immich migrations:run
DB_URL=postgres://postgres:postgres@localhost:5432/immich mise sql
```

Then confirm:

```
git diff --stat server/src/queries
```

Expect exactly two **modified** files: `person.repository.sql` (+1 query) and
`asset.repository.sql` (+2). New files, deletions, or a wholesale rewrite mean the generator ran
without a DB — `git checkout server/src/queries` and retry after fixing the connection.

CI verifies this directory is in sync (`test.yml` `sql-schema-up-to-date`), so it is not optional.

## Part D — VERIFY

```
cd server && pnpm check
cd server && npx eslint src/repositories/person.repository.ts src/repositories/asset.repository.ts --max-warnings 0
cd server && npx prettier --check src/repositories/person.repository.ts src/repositories/asset.repository.ts
git diff --stat server/src/queries
```

There are no unit tests in this slice — these queries are exercised by the rule's unit tests
(Slice 3, via mocks) and their SQL behaviour by the medium tests (Slice 6). Do not add a
repository spec.

## Commit

```
feat(memories): add dormant-person and chapter-window queries
```

Files: the two repository files plus the two regenerated `.sql` files. Nothing else.
