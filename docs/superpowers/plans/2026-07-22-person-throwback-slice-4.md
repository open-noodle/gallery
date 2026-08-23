# Slice 4 — server registration

Spec: `docs/plans/2026-07-22-memory-person-throwback-spec.md` §3.1 rows 1–4, 7, 8, 10; §9 Slice 4.
Depends on Slice 3 (the rule class).

## Goal

Register `person_throwback` so the engine, the config, and the API all know about it. This slice is
mechanical but touches **shared lists** — the risk is missing one, not getting one wrong.

## Part A — registration (2 files)

**`server/src/services/memory-rules/memory-type.metadata.ts`** — append **last** in
`MEMORY_TYPE_METADATA` (registry order is the `availableMemoryTypes` order):

```ts
{ key: 'person_throwback', kind: 'rule', defaultEnabled: true, adminConfigurable: true },
```

**`server/src/services/memory-rules/memory-type.registry.ts`** — import the rule and add:

```ts
person_throwback: (deps) => new PersonThrowbackMemoryRule(deps.personRepository, deps.assetRepository),
```

`MemoryRuleDeps` needs **no** change — `personRepository` and `assetRepository` are already there.
Keep imports alphabetically ordered (prettier-plugin-organize-imports enforces this).

## Part B — the shared lists (4 spec files, 7 sites)

These fail as soon as Part A lands. Fix each; do not skip one because another already passed.

**`memory-type.metadata.spec.ts`** — four separate lists, all verified by grep before editing:

- ~line 31 — the full `MEMORY_TYPE_METADATA` literal: add the new entry last
- ~line 54 — key list
- ~line 72 — the `types` object literal: `person_throwback: true`
- ~lines 121, 167 — two more key lists

Run `grep -n "themed" server/src/services/memory-rules/memory-type.metadata.spec.ts` first and add
`person_throwback` after **every** `themed` occurrence. There are five.

**`memory-type.registry.spec.ts`**

- Add an `it('instantiates person_throwback by key')` mirroring the `themed` test at ~line 33.
- The completeness guard at ~line 57 is `expect(rules).toHaveLength(ruleKeys.length)` — it derives
  its own count, so it needs no edit, but it **will** fail if the factory is missing. That is the
  point of it.

**`server/src/utils/preferences.spec.ts`** — two sites (~lines 29 and 187): add
`person_throwback: true` to the default memory-types map.

**`server/src/services/server.service.spec.ts`** — **two** `availableMemoryTypes` assertions
(~lines 196 and 223). Both become 12 entries, `person_throwback` last.

**`e2e/src/specs/server/api/server.e2e-spec.ts`** — the same fixture at ~line 148. **The server unit
suite does not cover this file.** It is the single most-missed site when adding a memory type; if
you skip it, CI fails and the server suite stays green, which is confusing. Do it.

Expected `availableMemoryTypes`, in order (12):

```
on_this_day, birthday, recent_trip, month_recap, favorites_throwback, on_this_day_place,
season_recap, people_together, video_moments, trip_anniversary, themed, person_throwback
```

## Part C — VERIFY

```
cd server && pnpm test --run src/services/memory-rules src/utils/preferences.spec.ts src/services/server.service.spec.ts
cd server && pnpm test          # FULL suite — shared lists mean a miss can surface anywhere
cd server && pnpm check
cd server && pnpm lint
cd server && pnpm format
```

The full server suite is not optional here. The whole risk of this slice is a shared list you did
not know about; only the full run proves you found them all.

E2E is not runnable locally in this slice (it needs the docker stack) — the fixture edit is verified
by inspection against the 12-entry list above, and by CI.

## Commit

```
feat(memories): register person_throwback memory type
```

## Do not

- Touch `MemoriesSettings.svelte` or `i18n/en.json` — Slice 5.
- Touch the medium tests or docs — Slice 6.
- Change `RULE_DAILY_LIMIT`, the multi-day slot cap, or anything else in `memory.service.ts`.
