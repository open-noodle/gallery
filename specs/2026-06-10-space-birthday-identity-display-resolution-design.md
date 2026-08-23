# Space-person birthday display resolution

**Date:** 2026-06-10
**Status:** Approved (design)
**Area:** server — `face-identity.repository.ts` read-time person resolution

## Problem

After the rc4 fix ("persist space people birthdays globally"), an editor in a shared
space can set a birthday and it is correctly stored on that space's
`shared_space_person` row. But the library owner (and other viewers) see an **empty**
birthday field for that person, even though a birthday exists on a sibling profile of
the same identity.

### Reproduction

1. Log in as a user with editor role in a shared space.
2. Open a named person in `/people`, set a birthday.
3. Log out; log in as the library owner (admin).
4. Open the same person in `/people` — the birthday field is empty.

### Observed data (one identity, 4 spaces)

| Profile                         | birthDate    | birthDateSource | note                                         |
| ------------------------------- | ------------ | --------------- | -------------------------------------------- |
| `shared_space_person` (Karolin) | `2014-02-14` | `manual`        | set today by an editor                       |
| `shared_space_person`           | `NULL`       | `none`          |                                              |
| `shared_space_person`           | `NULL`       | `none`          |                                              |
| `shared_space_person`           | `2013-02-14` | `manual`        | set earlier by a different user (wrong year) |
| `person` (owner library)        | `NULL`       | n/a             | never touched by space edits                 |

## Root cause

Person metadata is **resolved at read time**, not written back to `person`. The owner
seeing a space-set _name_ is not a write — it is a query-time `COALESCE` in
`FaceIdentityRepository.hydrateAccessiblePeople` (`face-identity.repository.ts`, the
`profiles` → `ranked_profiles` → final `SELECT` CTE chain). This same path serves both
the people list (`getAccessiblePeople`) and the single-person view
(`getAccessiblePersonByProfileId`).

The resolver builds a `profiles` CTE union of the owner's `person` row plus every
visible `shared_space_person` row for the identity, then ranks them:

- `display_rn` — "best **named** profile" (ordered by has-name, then `profileRank`
  where the owner's `person` = 0, then name alpha, then recency).
- `primary_rn` — "canonical profile" (ordered user-person-first → the owner's `person`).

The final projection resolves:

```sql
COALESCE(NULLIF(display_profiles.name, ''), primary_profiles.name, '') AS name,
COALESCE(display_profiles."birthDate", primary_profiles."birthDate") AS "birthDate",
```

**Name** has a dedicated "best name" ranking (`display_rn`), so it finds a name wherever
it lives. **Birthday has no ranking of its own** — it piggybacks on the name-winner and
the owner. In the reproduction, the owner's `person` row is named (so it wins both
`display_rn` and `primary_rn`) but has a NULL birthday, so `birthDate` resolves to
`COALESCE(NULL, NULL) = NULL`. The `2014-02-14` on Karolin's space-person — which is
neither the best-named profile nor the owner — is never consulted.

This is purely a **read/display** defect. Both the write path and the stored rows are
working as designed.

## Decision

Give `birthDate` its own selection across all profiles of the identity, symmetric to how
`name` has `display_rn`. **Read-time only — no write-back to `person`, no change to the
write-time backfill or stored rows.** This matches the existing name design exactly
(names are never persisted to `person`; they are resolved on read).

### Birthday precedence (when multiple profiles carry a birthday)

**Owner first, then most-recent manual.** If the owner's own `person` row has a birthday,
show it. Otherwise, among the visible profiles, prefer a `manual` birthday over an
`inherited` one, and within a tier pick the most recently edited
(`birthDateSourceUpdatedAt`). Implemented as an ordering where NULL birthdays sort last, so
the owner only "wins" when they actually have a value.

## Implementation

A single SQL change in `FaceIdentityRepository.hydrateAccessiblePeople`. Three edits:

### 1. `profiles` CTE — carry birthday provenance on both branches

The `person` table has only `birthDate` (no `birthDateSource` / `birthDateSourceUpdatedAt`
columns — confirmed in `person.table.ts`). The owner's value is authoritative by position,
so synthesize a source for it:

- **person branch:**
  ```sql
  CASE WHEN person."birthDate" IS NOT NULL THEN 'manual' ELSE 'none' END AS "birthDateSource",
  person."updatedAt" AS "birthDateSourceUpdatedAt",
  ```
- **space-person branch:**
  ```sql
  shared_space_person."birthDateSource",
  shared_space_person."birthDateSourceUpdatedAt",
  ```

### 2. `ranked_profiles` — add a `birthdate_rn` window (birthday analog of `display_rn`)

```sql
row_number() OVER (
  PARTITION BY profiles."identityId"
  ORDER BY
    profiles."birthDate" IS NULL,                                          -- birthday-bearing first
    CASE WHEN profiles."profileType" = 'user-person' THEN 0 ELSE 1 END,    -- owner/self first → owner wins IF present
    CASE profiles."birthDateSource"
      WHEN 'manual' THEN 0 WHEN 'inherited' THEN 1 ELSE 2 END,             -- manual over inherited
    profiles."birthDateSourceUpdatedAt" DESC NULLS LAST,                   -- most-recent manual
    profiles."updatedAt" DESC,
    profiles."profileId"                                                   -- stable tiebreak
) AS birthdate_rn
```

Because NULL birthdays sort last (line 1), the owner row only reaches `birthdate_rn = 1`
when it actually has a birthday. When the owner has none, the most-recent manual space
value wins — exactly "owner first, then most-recent manual."

### 3. Final SELECT — resolve from the new alias

```sql
COALESCE(birthdate_profiles."birthDate", primary_profiles."birthDate") AS "birthDate",
```

and add the join:

```sql
INNER JOIN ranked_profiles AS birthdate_profiles
  ON birthdate_profiles."identityId" = requested_identities."identityId"
  AND birthdate_profiles.birthdate_rn = 1
```

All other projected columns (`name`, thumbnail, hidden, favorite, counts, etc.) are
unchanged. `name` continues to resolve via `display_profiles` exactly as today.

## Scope / non-goals

- **No write-back to `person`.** The owner's library `person.birthDate` stays editor-immutable;
  the owner simply _sees_ the resolved identity birthday, identically to how they see a
  space-set name today.
- **No change to the write-time backfill** (`inheritSpacePersonMetadata`) or to the
  diverging stored `shared_space_person` rows. Space D's stale `2013-02-14` remains in the
  DB; it would only surface if it were the most-recent manual value _and_ no owner value
  existed — consistent and acceptable.
- **Search path is unaffected (verified).** `SearchRepository.searchFaces` /
  `getFilteredIdentityPeople` return only `id/name/profileType/profileId/spaceId` — no
  `birthDate`. (`minBirthDate` there is an age _filter_, not a displayed value.) No change.
- **`getMetadataInheritanceCandidates` is unchanged.** It feeds the write-time backfill,
  which is out of scope (above).
- **No schema migration.** All columns used already exist (`person.birthDate`;
  `shared_space_person.birthDate` / `birthDateSource` / `birthDateSourceUpdatedAt`). The
  `person` table has no source columns — hence the synthesized source in step 1.
- **No new endpoint or DTO change.** `PersonResponseDto.birthDate` is already populated by
  this resolver via `mapAccessiblePerson` (`birthDate: asBirthDateString(row.birthDate)`).
- **Visibility is not broadened.** `birthdate_rn` ranks only within the existing `profiles`
  CTE, which is already scoped to the viewer's own `person` rows and the spaces visible to
  them (`timeline_spaces`). A birthday in a space the viewer cannot see is never consulted.

## Build & regeneration (required)

- `hydrateAccessiblePeople` is decorated with `@GenerateSql` (`face-identity.repository.ts`
  ~line 1764). Any change to its SQL **requires running `make sql`** to regenerate
  `src/queries/face.identity.repository.sql`. **CI fails if this file is stale** — it must
  be committed alongside the code change.
- `face-identity-query-shape.spec.ts` asserts only keyword presence/absence
  (`face_identity_face`, `<=>`, `face_search.embedding`) — adding the `birthdate_rn` window
  and alias does **not** affect it. No change needed there.

## Testing (TDD)

`hydrateAccessiblePeople` is raw SQL whose behavior only exists against a real database, so
unit/mocked coverage cannot exercise it — all tests are **medium tests against a real
Postgres** (testcontainers) in
`test/medium/specs/repositories/face-identity.repository.spec.ts`. Fixture helpers already
used by that suite: `ctx.newUser`, `ctx.newPerson({ ownerId, name, birthDate, isHidden })`,
`ctx.newAsset`, `ctx.newAssetFace`, `ctx.newSharedSpace`, `ctx.newSharedSpaceMember`,
`ctx.newSharedSpaceAsset`, `sut.ensurePersonIdentity(personId)`,
`sut.linkFace({ assetFaceId, identityId, source })`, and a raw insert into
`shared_space_person` (+ `shared_space_person_face`). Assertions compare against the
formatted date string (e.g. `birthDate: '2014-02-14'`) so a timezone/off-by-one regression
is caught.

### TDD cadence (one test at a time; red → green → next)

**Behavior-driving tests** — each must be written and confirmed to fail before the
implementation step that makes it pass. They are constructed so a _partial_ implementation
cannot pass by accident:

1. **Repro — space-only birthday (the bug).** Owner `person`: named, NULL birthday. One
   space-person: manual `2014-02-14`. Siblings: NULL. → `getAccessiblePeople(owner)` returns
   the person with `birthDate: '2014-02-14'` **and** the correct name (name and birthday
   resolve from different profiles simultaneously). **Red today** (returns `null`). Drives
   adding `birthdate_rn` + the new alias/COALESCE.
2. **Single-person view parity.** Same fixture via `getAccessiblePersonByProfileId` → same
   `2014-02-14`. **Red today.** Confirms the shared SQL covers both entry points.
3. **Owner precedence over a space value.** Owner `person`: manual `1990-01-01`. A space:
   manual `2014-02-14` (with a _newer_ `birthDateSourceUpdatedAt`). → owner's `1990-01-01`
   wins. Drives the `user-person`-first ORDER BY term (a recency-only ranking would pick the
   space value and fail this test).
4. **Most-recent-manual tiebreak (recency is the deciding factor).** Owner: no birthday. Two
   spaces, both `manual`. The winning row is given the **older** `profileId`/`updatedAt` but
   the **newer** `birthDateSourceUpdatedAt`, so only the `birthDateSourceUpdatedAt DESC` term
   selects it — a naive `profileId`/`updatedAt` ordering would pick the wrong one. Asserts
   the newer-manual date.
5. **Manual beats inherited.** Owner: no birthday. One space `manual` = date A, another space
   `inherited` = date B with a _newer_ `birthDateSourceUpdatedAt`. → date A (manual) wins,
   proving the `manual < inherited` source tier outranks pure recency.

**Boundary / regression guards** — assert behavior that must be preserved:

6. **No birthday anywhere.** All profiles NULL → person is **still returned** with
   `birthDate: null` (verifies the new `INNER JOIN ranked_profiles AS birthdate_profiles`
   does not drop the identity).
7. **Hidden profile excluded.** A hidden space-person holds the only birthday;
   `withHidden: false` → `birthDate: null` (hidden rows are excluded from `profiles`, same as
   for name). With `withHidden: true` → the birthday resolves.
8. **Cross-space visibility — no leak.** The only birthday lives in a space the viewer is
   **not** a member of (absent from `timeline_spaces`) → `birthDate: null`. Confirms the fix
   does not broaden visibility.
9. **Owner-birthday-only (existing guard).** The existing test
   "uses a named accessible space profile for display while keeping a viewer-owned primary
   profile" (`face-identity.repository.spec.ts:1519` — owner has birthday, space supplies the
   name) must continue to pass. Verifies the fix preserves owner-only resolution.
10. **Name resolution unchanged.** Existing name-resolution assertions still pass (the `name`
    projection via `display_profiles` is untouched).

## Affected files

- `server/src/repositories/face-identity.repository.ts` — the `hydrateAccessiblePeople` SQL
  (3 edits: `profiles` CTE columns, `birthdate_rn` window, final SELECT + join).
- `server/src/queries/face.identity.repository.sql` — **regenerated via `make sql`** and
  committed (CI-enforced).
- `server/test/medium/specs/repositories/face-identity.repository.spec.ts` — new fixtures +
  assertions (tests 1–8 above; 9–10 are existing guards).
