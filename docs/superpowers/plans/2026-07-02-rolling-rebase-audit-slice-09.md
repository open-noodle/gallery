# Slice 9 — LOW[11]/[13]: `peopleSortBy` StoreKey→SettingsKey upgrade migration

**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §"Slice 9"
**Findings:** `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` LOW bullet — "Mobile `peopleSortBy` preference dropped on upgrade"
**Branch / worktree:** `rebase/upstream-rolling-20260509-active`

---

## Step A — grounding

### Where `peopleSortBy` lives today

- **`main` (pre-v3, still-shipping fork code)** persists the People-page sort as
  a legacy Isar/Drift-`Store` row: `mobile/lib/domain/models/store.model.dart`
  on `main` has `peopleSortBy<int>._(1015)` — a plain int **ordinal** into
  whatever `PeopleSortBy` looked like at the time (fork PR #683, "user-controlled
  People view sort").
- **This rolling branch** carries a much larger upstream refactor
  (`refactor: rename metadata to settings (#28691)`, commit `14aff51da9`) that
  introduces the whole `SettingsKey`/`settings_entity` Drift-backed
  configuration system (`mobile/lib/domain/models/settings_key.dart`,
  `mobile/lib/infrastructure/repositories/settings.repository.dart`) plus a
  batch migration (`_migrateTo26` in `mobile/lib/utils/migration.dart`) that
  moves every other legacy `Store` key over. `SettingsKey.peopleSortBy`
  (`settings_key.dart:42`, `_EnumCodec(PeopleSortBy.values)`) already exists —
  the fork's #683 sort feature was carried forward to target the new key — but
  **no migration entry reads the old `Store` row 1015 into it**, and
  `StoreKey.peopleSortBy` (id 1015) itself is **gone** from
  `mobile/lib/domain/models/store.model.dart` on this branch (confirmed:
  `grep -n "1015" lib/domain/models/store.model.dart` → no hits; the highest
  legacy-cluster id present is `backgroundBackupStatus<String>._(1014)`). Any
  user who set a sort before upgrading to this branch silently loses it — the
  People page just falls back to `PeopleConfig`'s default
  (`PeopleSortBy.photoCount`, `people_config.dart:6`).

### `PeopleSortBy` enum

`mobile/lib/domain/models/person.model.dart:208`:

```dart
enum PeopleSortBy { photoCount, name }
```

Index 0 = `photoCount` (also the `PeopleConfig` default), index 1 = `name`.
Ordinal-compatible with the old int `Store` value (#683 stored the enum's
`.index` the same way every other legacy `migrateEnumIndex` key does).

### The closest analog: `migrateEnumIndex`

`mobile/lib/utils/migration.dart` `_StoreMigrator.migrateEnumIndex`:

```dart
Future<void> migrateEnumIndex<T extends Enum>(StoreKey<int> legacyKey, SettingsKey<T> newKey, List<T> values) async {
  final index = await readLegacyStoreInt(legacyKey.id);
  if (index == null) return;
  final enumValue = values.elementAtOrNull(index);
  if (enumValue == null) return;
  _cache[newKey] = enumValue;
  _migratedStoreIds.add(legacyKey.id);
}
```

This is exactly the shape needed: legacy `Store` int ordinal → new `Settings`
enum value, already used for `StoreKey.legacyLogLevel → SettingsKey.logLevel`
and four others in `_migrateTo26`. No new migrator method needed.

`readLegacyStoreInt`/`readLegacyStoreString` read directly off
`_db.storeEntity` by raw integer id — they do **not** require the id to be
declared as a "current" `StoreKey` for reading to work — but every other
legacy migration in this file **does** declare a `legacyXxx<T>._(id)` entry in
`store.model.dart` even though the corresponding real key was removed, purely
so `migrateEnumIndex`/`migrateBool`/etc. (which are typed on `StoreKey<T>`,
not a raw `int`) have a strongly-typed handle with the right `.id`. This slice
follows that same convention: add `legacyPeopleSortBy<int>._(1015)`.

`_StoreMigrator.complete()` only writes a `SettingsEntity` row when the staged
value differs from `defaultConfig.read(key)` (dedup against the target's
compile-time default), and only deletes the legacy `Store` row ids that were
actually staged (`_migratedStoreIds`). So:

- A legacy ordinal that resolves to `PeopleSortBy.photoCount` (the default) is
  staged but then **skipped on write** (`complete()`'s `if (entry.value ==
defaultConfig.read(entry.key)) continue;`) — and its legacy row **is still
  deleted** (staging happens before the write-skip check, and
  `_migratedStoreIds` was already appended in `migrateEnumIndex`). This is
  correct existing behavior, not something this slice needs to change.
- A legacy ordinal outside `PeopleSortBy.values`' range (`elementAtOrNull`
  returns `null`) is **never staged and never deleted** — the row is left
  behind, no crash, and the People page reads the compile-time default
  (`PeopleConfig.sortBy = PeopleSortBy.photoCount`) until/unless something else
  cleans it up. This matches every other `migrateEnumIndex` legacy key's
  existing behavior for out-of-range data — this slice reuses that behavior
  rather than inventing bespoke clamping.

### Version placement — add to `_migrateTo26`, no new `_migrateTo27`

`targetVersion = 26` in `mobile/lib/utils/migration.dart:21`. The entire
`SettingsKey`/`_migrateTo26` machinery was introduced by upstream commit
`14aff51da9` ("refactor: rename metadata to settings (#28691)"), which is
**not an ancestor of `main`**:

```
$ git merge-base --is-ancestor 14aff51da9 main && echo YES || echo NO
NO
```

`main` still uses the old Isar-style `StoreKey.peopleSortBy<int>._(1015)`
directly (no `SettingsKey`, no `settings_key.dart` file at all on `main`). This
rolling branch has not been merged to `main` or released, so **no Gallery
build has ever shipped `targetVersion = 26`** — there is no population of
already-upgraded users who ran `_migrateTo26` without this fix and would need
a follow-up `_migrateTo27` to catch up. Adding the `peopleSortBy` migration
directly into the existing `_migrateTo26` is therefore correct and simpler:
every user who upgrades through this rolling branch (whenever it ships) runs
the fixed `_migrateTo26` for the first time, migrating their legacy row 1015
in the same pass as every other legacy setting.

(If this reasoning is ever wrong — i.e. if `_migrateTo26` ships to users
_before_ this fix lands — the correct remediation would be a new
`_migrateTo27` + `targetVersion = 27`, per the task's stated fallback. Ground
truth checked above rules that out for now.)

---

## Step B — files / tests / impl

### Files changed

1. `mobile/lib/domain/models/store.model.dart` — add
   `legacyPeopleSortBy<int>._(1015)` to the "Legacy keys" cluster (after
   `legacyLogLevel<int>._(115)`, before the terminal
   `backgroundBackupStatus<String>._(1014)` entry — id 1015 continues that
   cluster's sequence and matches the exact id `main` used for
   `peopleSortBy`).
2. `mobile/lib/utils/migration.dart`:
   - add `import 'package:immich_mobile/domain/models/person.model.dart';`
     (for `PeopleSortBy`) — not currently imported in this file.
   - in `_migrateTo26`, add a `// People` group (mirroring `settings_key.dart`'s
     own `// People` comment) between the existing `// Album` and `// Backup`
     groups:
     ```dart
     // People
     await migrator.migrateEnumIndex(StoreKey.legacyPeopleSortBy, SettingsKey.peopleSortBy, PeopleSortBy.values);
     ```
3. `mobile/test/utils/migration_test.dart` — **new file**, RED-first tests
   (no existing `test/utils/` dir for this file; created fresh — no existing
   `migration_test.dart` collides, the only other `*migration*test*` is the
   unrelated Drift-schema-verifier suite at
   `test/drift/main/migration_test.dart`, which exercises DDL migrations, not
   `migrateDatabaseIfNeeded`'s `Store`→`Settings` data migration).
4. `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` — append
   ` — FIXED (slice S9)` to the existing single bullet covering both LOW#11
   and LOW#13 (`"Mobile peopleSortBy preference dropped on upgrade..."`, line
   129).

### Test harness pattern (grounded in existing tests)

`migrateDatabaseIfNeeded(Drift drift)` is the only public entry point (`_migrateTo26`
is file-private). It reads/writes the migration version through the **global**
`Store` singleton (`StoreService.I`, `entities/store.entity.dart`), not through
the `drift` parameter directly — so the test must wire `StoreService` to the
_same_ in-memory `Drift` instance passed to `migrateDatabaseIfNeeded`, exactly
like `test/medium/repository_context.dart` and
`test/infrastructure/repositories/store_repository_test.dart` construct a
fresh DB:

```dart
db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
storeService = await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
```

`StoreService` is a process-wide singleton (`_instance`), so `tearDown` must
call `storeService.dispose()` (which nulls `_instance` per its own
`identical(_instance, this)` guard) so the next test in the file gets a fresh
instance bound to its own fresh in-memory `db`.

Seed the legacy value with a direct `db.storeEntity` insert (same pattern as
`repository_context.dart`'s `_populateStore`); seed `StoreKey.version.id` = 25
so `migrateDatabaseIfNeeded` actually runs `_migrateTo26` (version defaults to
`targetVersion` i.e. 26 when absent, which would skip the migration entirely —
that's the "fresh install" case, not what these tests are probing). Read the
result back directly off `db.settingsEntity` (bypassing `SettingsRepository`,
which isn't wired up in this unit test) and decode with
`SettingsKey.peopleSortBy.decode(...)`.

`import 'package:drift/drift.dart' hide isNull;` is required (same as
`repository_context.dart`) because drift exports a `isNull` column-filter
helper that collides with `package:matcher`'s `isNull` matcher used in
`expect(...)`.

### RED tests — `mobile/test/utils/migration_test.dart`

```dart
group('migrateDatabaseIfNeeded — peopleSortBy StoreKey -> SettingsKey (LOW #11/#13)', () {
  test('migrates a legacy PeopleSortBy.name ordinal into SettingsKey.peopleSortBy', () async {
    await seedLegacyStoreInt(_legacyPeopleSortById, PeopleSortBy.name.index); // 1
    await migrateDatabaseIfNeeded(db);
    expect(await readMigratedPeopleSortBy(), PeopleSortBy.name);
    expect(await legacyRowExists(_legacyPeopleSortById), isFalse);
  });

  test('no legacy value leaves SettingsKey.peopleSortBy unset (default preserved)', () async {
    await migrateDatabaseIfNeeded(db); // no row seeded for id 1015
    expect(await readMigratedPeopleSortBy(), isNull);
  });

  test('legacy ordinal out of PeopleSortBy.values range does not throw, default preserved', () async {
    await seedLegacyStoreInt(_legacyPeopleSortById, 99);
    await expectLater(migrateDatabaseIfNeeded(db), completes);
    expect(await readMigratedPeopleSortBy(), isNull);
    expect(await legacyRowExists(_legacyPeopleSortById), isTrue); // left behind, matches existing generic behavior
  });

  test('running the migration twice is idempotent', () async {
    await seedLegacyStoreInt(_legacyPeopleSortById, PeopleSortBy.name.index);
    await migrateDatabaseIfNeeded(db);
    await expectLater(migrateDatabaseIfNeeded(db), completes);
    expect(await readMigratedPeopleSortBy(), PeopleSortBy.name);
  });

  test('fresh install (no legacy Store rows at all) is untouched', () async {
    // version row itself absent too -> Store.get defaults to targetVersion (26),
    // _migrateTo26 never runs.
    // (separate setUp variant: do not seed StoreKey.version at all)
    await migrateDatabaseIfNeeded(db);
    expect(await readMigratedPeopleSortBy(), isNull);
  });
});
```

(Exact test bodies/helper wiring finalized in the RED step below; the fresh-install
case needs its own `setUp`-less db/StoreService pairing since the shared `setUp`
seeds `version = 25` for the other four cases — see RED run for the final
file.)

Expected RED (pre-fix tree): test 1 fails —
`StoreKey.legacyPeopleSortBy` doesn't exist (compile error) until the
`store.model.dart` edit lands; once that edit is added standalone (impl not
yet wired into `_migrateTo26`), test 1 fails at the assertion:
`readMigratedPeopleSortBy()` returns `null`, not `PeopleSortBy.name`, because
nothing calls `migrator.migrateEnumIndex(...)` for it yet.

**Command:** `cd mobile && mise exec -- flutter test test/utils/migration_test.dart`

### Minimal impl (GREEN)

1. `store.model.dart`: add the `legacyPeopleSortBy<int>._(1015)` entry.
2. `migration.dart`: add the `person.model.dart` import + the one
   `migrateEnumIndex` call in `_migrateTo26`'s People group, as shown above.

No changes to `_StoreMigrator`, `SettingsKey`, or `PeopleSortBy` themselves —
this is purely wiring an existing legacy value through the existing generic
migrator method.

### Edge cases covered

- Legacy ordinal present, valid → mapped to the equivalent
  `SettingsKey.peopleSortBy` (test 1).
- No legacy value → default preserved, no write (test 2).
- Legacy ordinal out of range → no crash, default preserved, matches existing
  generic out-of-range behavior for every other `migrateEnumIndex` key (test 3).
- Migration run twice → idempotent (second run is a no-op because `Store.put`
  already bumped the version past 26) (test 4).
- Fresh install (no legacy rows, no version row) → untouched; `_migrateTo26`
  never runs because `Store.get(StoreKey.version, targetVersion)` defaults to
  `targetVersion` itself (test 5).

### GREEN commands

```
cd mobile && mise exec -- flutter test test/utils/migration_test.dart
cd mobile && mise exec -- dart analyze lib/domain/models/store.model.dart lib/utils/migration.dart test/utils/migration_test.dart
```

### Findings doc update

`docs/plans/2026-07-02-rolling-rebase-audit-findings.md` line 129 — append
` — FIXED (slice S9)` to the existing bullet (it already covers both LOW#11
and LOW#13; no separate bullet exists for #13, matching the task's expectation
that the abbreviated LOW list may fold them into one).

### Commit

`fix(mobile): migrate legacy peopleSortBy StoreKey to SettingsKey (LOW #11/#13)`
