# Upstream Sync Report — 2026-04-07

## Summary

- **Upstream commits pulled**: 43 (Immich v2.7.0)
- **Previous base**: v2.6.3
- **Fork commits rebased**: 206
- **Conflicts resolved**: 5 (all LOW risk, auto-resolved by rerere on retry)
- **Post-rebase fixes**: 4 commits (lockfile regen, CI restore, test fixes + version bump, migration idempotency)
- **Risk level**: LOW
- **Recommendation**: PROCEED

## Key Upstream Changes

- **TypeScript v6** — major version bump, all fork code compiles cleanly
- **MonthGroup → TimelineMonth** — 16-file rename, 3 stale refs fixed in fork test
- **Person face editor** — new `findOrFail()` call in `createFace`, 2 test mocks added
- **Version checks** — moved to `version.immich.cloud`, API method renamed
- **withExif → withExifInner** — search repo import merged with fork's `asUuid`
- **Migration rename** — `1773846750001-AddPersonNameTrigramIndex` renamed to `1775165531374-AddPersonNameTrigramIndex`, made idempotent for existing databases (see below)

## Conflict Resolutions

All conflicts were identical to the first rebase attempt and auto-resolved by git rerere:

1. **pnpm-lock.yaml** — took upstream, regenerated with fork deps
2. **server/test/medium person.service.spec.ts** — upstream reordered mock array
3. **storage-space.svelte** — upstream's @immich/ui Meter import kept
4. **timeline-manager files** (3 files) — MonthGroup→TimelineMonth naming preserved with fork's space loading block
5. **mobile/pubspec.yaml** — kept fork's 1.0.0+1 version
6. **search.repository.ts** — combined asUuid (fork) + withExifInner (upstream)
7. **mobile/openapi/README.md** — binary, took fork's version

## Local CI Verification

| Check               | Status | Notes                |
| ------------------- | ------ | -------------------- |
| `make build-server` | PASS   |                      |
| `make build-sdk`    | PASS   |                      |
| `make check-server` | PASS   | 0 errors             |
| `make check-web`    | PASS   | 0 errors, 0 warnings |
| Server unit tests   | PASS   | 3780 passed          |
| Web unit tests      | PASS   | 1248 passed          |

## Migration Rename Fix

Upstream commit `adb6b39ee` renamed migration `1773846750001-AddPersonNameTrigramIndex` to `1775165531374-AddPersonNameTrigramIndex` (same content, different timestamp). This causes a failure on any existing database because:

1. The old migration name is recorded in `kysely_migrations`
2. The migrator sees the new filename as a new, unapplied migration
3. `CREATE INDEX "idx_person_name_trigram"` fails because the index already exists

**Fix applied:** Made the upstream migration idempotent by adding `IF NOT EXISTS` to the `CREATE INDEX` and `ON CONFLICT DO NOTHING` to the `INSERT INTO migration_overrides`. This is safe because:

- The migration file (`1775165531374`) is already released in upstream v2.7.0 and will never be modified again, so no future rebase conflicts
- On fresh databases: `IF NOT EXISTS` is a no-op since the index doesn't exist yet
- On existing databases: the index already exists, `IF NOT EXISTS` skips creation, and the migration is recorded under the new name

**File modified:** `server/src/schema/migrations/1775165531374-AddPersonNameTrigramIndex.ts`

## Post-Rebase Verification

- Fork commits ahead of upstream: 210
- Commits behind upstream: 0
