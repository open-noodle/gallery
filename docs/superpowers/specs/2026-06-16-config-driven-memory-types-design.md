# Config-Driven Memory Types Design

## Summary

Today the set of generated memory types is hardcoded in `MemoryService.getMemoryRules()`
(`if (config.birthday) rules.push(new BirthdayMemoryRule(...))`), and the only per-user control is
a single master `memories.enabled` switch. Adding a new memory type requires editing the generation
loop, the `SystemConfig` shape, the system-config DTO, and both settings UIs.

This change introduces a declarative **memory-type registry** as the single source of truth for which
memory types exist, plus a **layered enable model**:

- **Admin gate** (system config): a global per-type availability map. An admin can globally disable an
  expensive or unwanted type (e.g. recent trips).
- **Per-user toggle** (user preferences): for any globally-available type, each user enables or disables
  whether they receive it.

The three existing types — `on_this_day` ("X years ago"), `birthday`, and `recent_trip` — all become
first-class registry entries with the same admin-gate + per-user toggle. The current master
`memories.enabled` switch keeps its existing display-only semantics, unchanged.

Adding a future memory type becomes: add one registry entry (plus a `MemoryRule` class for rule-kind
types) and three i18n label strings (EN/DE/FR). No edits to the generation loop or the config DTO shapes.

## Goals

- Make the available memory types declarative via a single registry; new types plug in with one entry.
- Let admins globally enable/disable each memory type (layered kill-switch).
- Let each user enable/disable which globally-available memory types they receive.
- Disabling a type immediately stops generating it **and** hides already-generated (non-saved) memories
  of that type from that user's feed.
- Preserve today's behavior for existing users and existing admin configs (all three current types
  default on; legacy `birthday`/`recentTrips` admin overrides still honored).
- Keep `on_this_day`'s existing generation code path intact (gate it; do not rewrite it into a rule).

## Non-Goals

- No rewrite of `on_this_day` generation into the `MemoryRule` interface (Approach C, rejected).
- No per-type tunable parameters in this change (e.g. user-adjustable trip distance thresholds).
- No memory-type priority/reorder UI.
- No external/plugin loading — the registry is compile-time, which is the correct granularity.
- No mobile settings UI in this change. Mobile keeps working via the same preferences API + regenerated
  OpenAPI client; surfacing per-type toggles in mobile is a deliberate follow-up.
- No database schema change. `MemoryType` enum and the `memory` table are unchanged.
- No type-filtering of `statistics()` (the `{ total }` aggregate); its count may include disabled types.

## Existing Context

Files and behavior as they exist today:

- **Generation service:** `server/src/services/memory.service.ts`
  - `onMemoriesCreate()` (`@OnJob MemoryGenerate`) runs nightly. It generates `OnThisDay` memories over a
    ±3-day window (state cursor `lastOnThisDayDate`) and `Rule` memories per day (cursor `lastRuleDate`,
    `RULE_DAILY_LIMIT = 2`, scoring + dedupe).
  - `getMemoryRules(config)` hardcodes rule instantiation behind `config.birthday` / `config.recentTrips`.
  - `createOnThisDayMemories(ownerId, target)` generates `OnThisDay` memories with no per-user gate.
  - `createRuleMemories(ownerId, target, config)` evaluates rules, sorts by score, inserts up to the daily
    limit, dedupes via `memoryRepository.hasRuleMemory`.
  - `search(auth, dto)` returns mapped memories; access-filtered by asset permission only.
- **Rule interface:** `server/src/services/memory-rules/memory-rule.interface.ts` — `MemoryRule { id; evaluate() }`,
  `MemoryRuleCandidate`, `MemoryRuleContext`.
- **Rule classes:** `birthday.rule.ts` (`id = 'birthday'`, ctor `(personRepository, assetRepository)`),
  `recent-trip.rule.ts` (`id = 'recent_trip'`, ctor `(assetRepository, memoryRepository)`).
- **Memory types:** `server/src/enum.ts` — `MemoryType { OnThisDay = 'on_this_day', Rule = 'rule' }`.
- **Memory data:** `server/src/types.ts` — `OnThisDayData { year }`, `RuleMemoryData { ruleId, dedupeKey,
title, subtitle?, score?, context? }`.
- **System config:** `server/src/config.ts` — `memories: { retentionDays, birthday, recentTrips }`
  (type at ~155, defaults at ~392: `retentionDays: 365, birthday: true, recentTrips: true`).
- **System-config DTO:** `server/src/dtos/system-config.dto.ts` — `SystemConfigMemoriesSchema`
  (`retentionDays`, `birthday`, `recentTrips`).
- **User preferences:** `server/src/types.ts` `UserPreferences.memories { enabled, duration }`;
  defaults in `server/src/utils/preferences.ts` `getDefaultPreferences()` (`enabled: true, duration: 5`).
  - `getPreferences(metadata)` overlays stored sparse overrides onto the full default object by leaf path.
  - `getPreferencesPartial(prefs)` persists only leaf values that differ from default — **it iterates the
    default object's keys**, so any field that must be persisted has to exist in the default object.
  - `mergePreferences(prefs, dto)` applies the update DTO by leaf path (partial-merge friendly).
- **User-preferences DTO:** `server/src/dtos/user-preferences.dto.ts` — `MemoriesUpdateSchema { enabled?,
duration? }`, `MemoriesResponseSchema { enabled, duration }`.
- **User repository:** `getList({ withDeleted })` already selects `withMetadata`, so listed users carry
  `.metadata`. `getPreferences(user.metadata)` yields full preferences with no extra query.
- **Server config DTO:** `server/src/dtos/server.dto.ts` `ServerConfigSchema` (the unauthenticated global
  config the web reads); populated by `server.service.ts`.
- **Web admin UI:** `web/src/routes/admin/system-settings/MemoriesSettings.svelte`
  (+ `.spec.ts`) — hardcoded switches for birthday/recentTrips + retention number input.
- **Web user UI:** `web/src/routes/(user)/user-settings/feature-settings.svelte` — `memories` accordion
  with the master enable `Switch` + duration `NumberInput`; save payload builds `memories: { enabled, duration }`.
- **Web i18n:** the source-of-truth locale JSON is at the repo root `/i18n/` — `i18n/en.json` (EN source),
  `i18n/de.json`, `i18n/fr.json` (DE/FR maintained by the fork). Admin-settings strings use an `admin.`
  prefix (e.g. `admin.birthday_memories_setting`); user-facing strings are top-level (e.g. `time_based_memories`).
- **Web managers:** `web/src/lib/managers/server-config-manager.svelte.ts` exposes the server config via
  `serverConfigManager.value` (loaded with `getServerConfig` from `@immich/sdk`). User prefs are held by
  `authManager.preferences` and saved with `updateMyPreferences({ userPreferencesUpdateDto })`, then
  `authManager.setPreferences(response)`.
- **Server-config build:** `server/src/services/server.service.ts` `getSystemConfig()` builds the public
  `ServerConfigDto` from `await this.getConfig({ withCache: true })`, so it can read `config.memories`.
  `server.service.spec.ts` asserts the whole DTO with an exact `toEqual({...})`.

## Architecture Overview

### The registry (two modules to avoid import cycles)

`config.ts` and `preferences.ts` need the registry's _metadata_ (keys, defaults). The rule classes import
repositories, which transitively import `config.ts`. To prevent a cycle, the registry is split:

1. **`server/src/services/memory-rules/memory-type.metadata.ts`** — pure data + pure resolver functions.
   Imports only `MemoryType` from `src/enum`. No rule classes, no repositories. Safe for `config.ts` and
   `preferences.ts` to import.
2. **`server/src/services/memory-rules/memory-type.registry.ts`** — imports the metadata module and the
   rule classes; provides the rule-instantiation factory. Imported only by `MemoryService`.

#### `memory-type.metadata.ts`

```ts
import { MemoryType } from 'src/enum';

export type MemoryTypeKind = 'on_this_day' | 'rule';

export interface MemoryTypeMetadata {
  /** stable config key; for rule-kind it MUST equal the rule's `id` */
  key: string;
  kind: MemoryTypeKind;
  /** default enable state for both admin availability and per-user toggle */
  defaultEnabled: boolean;
  /** whether an admin can globally disable this type */
  adminConfigurable: boolean;
}

export const MEMORY_TYPE_METADATA: MemoryTypeMetadata[] = [
  { key: 'on_this_day', kind: 'on_this_day', defaultEnabled: true, adminConfigurable: true },
  { key: 'birthday', kind: 'rule', defaultEnabled: true, adminConfigurable: true },
  { key: 'recent_trip', kind: 'rule', defaultEnabled: true, adminConfigurable: true },
];

export const MEMORY_TYPE_KEYS = MEMORY_TYPE_METADATA.map((m) => m.key);

/** legacy SystemConfig.memories boolean field name per type key, for back-compat folding */
export const LEGACY_MEMORY_CONFIG_KEYS: Record<string, 'birthday' | 'recentTrips'> = {
  birthday: 'birthday',
  recent_trip: 'recentTrips',
};

export const getMemoryTypeMetadata = (key: string): MemoryTypeMetadata | undefined =>
  MEMORY_TYPE_METADATA.find((m) => m.key === key);

/** full map of key -> defaultEnabled; used as the per-user preferences default */
export const buildDefaultMemoryTypeMap = (): Record<string, boolean> =>
  Object.fromEntries(MEMORY_TYPE_METADATA.map((m) => [m.key, m.defaultEnabled]));

/** derive the config key of a persisted memory record */
export const getMemoryTypeKeyForMemory = (type: MemoryType, data: unknown): string | undefined => {
  if (type === MemoryType.OnThisDay) {
    return 'on_this_day';
  }
  if (type === MemoryType.Rule) {
    const ruleId = (data as { ruleId?: unknown } | null | undefined)?.ruleId;
    return typeof ruleId === 'string' ? ruleId : undefined;
  }
  return undefined;
};

type AdminMemoriesConfig = {
  types?: Record<string, boolean>;
  // deprecated legacy fields, still honored for back-compat
  birthday?: boolean;
  recentTrips?: boolean;
};

/** resolve which type keys are globally available, applying precedence:
 *  explicit types[key] > legacy bool (birthday/recentTrips) > metadata.defaultEnabled */
export const getAdminAvailableMemoryTypeKeys = (config: AdminMemoriesConfig): Set<string> => {
  const available = new Set<string>();
  for (const meta of MEMORY_TYPE_METADATA) {
    const explicit = config.types?.[meta.key];
    if (explicit !== undefined) {
      if (explicit) {
        available.add(meta.key);
      }
      continue;
    }
    const legacyField = LEGACY_MEMORY_CONFIG_KEYS[meta.key];
    const legacy = legacyField ? config[legacyField] : undefined;
    if (legacy !== undefined) {
      if (legacy) {
        available.add(meta.key);
      }
      continue;
    }
    if (meta.defaultEnabled) {
      available.add(meta.key);
    }
  }
  return available;
};

/** per-user enable for a known key: override > metadata.defaultEnabled. Unknown key -> false. */
export const isMemoryTypeEnabledForUser = (userTypes: Record<string, boolean> | undefined, key: string): boolean => {
  const override = userTypes?.[key];
  if (override !== undefined) {
    return override;
  }
  return getMemoryTypeMetadata(key)?.defaultEnabled ?? false;
};
```

#### `memory-type.registry.ts`

```ts
import { AssetRepository } from 'src/repositories/asset.repository';
import { MemoryRepository } from 'src/repositories/memory.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { BirthdayMemoryRule } from 'src/services/memory-rules/birthday.rule';
import { MemoryRule } from 'src/services/memory-rules/memory-rule.interface';
import { MEMORY_TYPE_METADATA } from 'src/services/memory-rules/memory-type.metadata';
import { RecentTripMemoryRule } from 'src/services/memory-rules/recent-trip.rule';

export interface MemoryRuleDeps {
  personRepository: PersonRepository;
  assetRepository: AssetRepository;
  memoryRepository: MemoryRepository;
}

/** per rule-kind key, how to construct its MemoryRule */
const RULE_FACTORIES: Record<string, (deps: MemoryRuleDeps) => MemoryRule> = {
  birthday: (deps) => new BirthdayMemoryRule(deps.personRepository, deps.assetRepository),
  recent_trip: (deps) => new RecentTripMemoryRule(deps.assetRepository, deps.memoryRepository),
};

/** instantiate the rule-kind memory rules whose key is in `enabledKeys` */
export const createMemoryRules = (enabledKeys: Iterable<string>, deps: MemoryRuleDeps): MemoryRule[] => {
  const keys = new Set(enabledKeys);
  return MEMORY_TYPE_METADATA.filter((m) => m.kind === 'rule' && keys.has(m.key)).map((m) =>
    RULE_FACTORIES[m.key](deps),
  );
};
```

### Resolution semantics (precedence)

**Admin availability** for key `k` (`getAdminAvailableMemoryTypeKeys`):

1. `systemConfig.memories.types[k]` if defined, else
2. legacy `systemConfig.memories.birthday` / `recentTrips` (only for `birthday` / `recent_trip`) if defined, else
3. `metadata(k).defaultEnabled`.

Keys not in `MEMORY_TYPE_METADATA` are ignored.

**Per-user enable** for key `k` (`isMemoryTypeEnabledForUser`):

1. `userPreferences.memories.types[k]` if defined, else
2. `metadata(k).defaultEnabled`. Unknown key → `false`.

**Effective generate** `(user, k)` = `adminAvailable(k) AND userEnabled(user, k)`.

**Effective show** of a persisted memory in `search`:
`memory.isSaved OR (key !== undefined AND adminAvailable(key) AND userEnabled(user, key))`,
where `key = getMemoryTypeKeyForMemory(memory.type, memory.data)`. A memory whose key is `undefined`
(unknown/foreign `ruleId`) is always shown (we cannot reason about it, so do not hide it).

### Why two different `types` defaults

- **System config** `memories.types` default is the **empty map `{}`** (sparse). This is required so that
  the resolver's legacy fold actually applies: if `types` defaulted to a full all-true map, the
  `types[k]` branch would always win and an instance's pre-existing `birthday: false` admin override would
  be silently ignored. With a sparse default, `types[k]` is only present when an admin explicitly set it.
- **User preferences** `memories.types` default is the **full registry map** (`buildDefaultMemoryTypeMap()`).
  Users never had per-type prefs before, so there is no legacy to honor, and a full default is required for
  `getPreferencesPartial()` to persist a user's overrides (it only stores leaf keys that exist in the
  default object). A newly-added type appears in the default map automatically → every user inherits its
  `defaultEnabled` with no migration; only explicit user overrides are stored.

### Generation flow (after this change)

In `onMemoriesCreate()`:

- Compute `adminAvailable = getAdminAvailableMemoryTypeKeys(config.memories)` once (the job already loads
  `config` via `getConfig`).
- Resolve preferences **once** into a per-user map before the loops:
  `userTypesById = new Map(users.map((u) => [u.id, getPreferences(u.metadata ?? []).memories.types]))`.
  The `?? []` guard matters: `getPreferences` calls `metadata.find`, and although `userRepository.getList`
  returns `withMetadata` at runtime, defensiveness keeps it crash-free for any user lacking metadata.
- **OnThisDay window loop:** call `createOnThisDayMemories(owner.id, target)` for a user only when
  `adminAvailable.has('on_this_day') && isMemoryTypeEnabledForUser(userTypesById.get(owner.id), 'on_this_day')`.
- **Rule loop:** for each user compute the enabled rule keys
  `enabledRuleKeys = [...adminAvailable].filter((k) => getMemoryTypeMetadata(k)?.kind === 'rule' && isMemoryTypeEnabledForUser(userTypesById.get(owner.id), k))`
  and pass them into rule creation. `getMemoryRules(enabledKeys)` (renamed/retained seam) returns
  `createMemoryRules(enabledKeys, deps)`. Scoring, daily limit, and dedupe logic are unchanged.

**Gating happens only at `getMemoryRules(enabledKeys)`** — do NOT add a secondary post-evaluation filter
that drops candidates whose `ruleId` is not in `enabledKeys`. The real `getMemoryRules` already filters by
instantiating only enabled rules; a post-filter would also discard the fake rules used by the existing
spy-based scheduling/scoring tests (rule ids `'scoring'`, `'broken'`), breaking them.

The master `memories.enabled` switch is **not** consulted during generation (kept display-only, matching
today's behavior — generation already ignores it). Per-type toggles are the generation gate.

### Read-time filtering (`search`)

`MemoryService.search(auth, dto)` additionally:

- Loads the auth user's preferences via `getPreferences((await userRepository.getMetadata(auth.user.id)) ?? [])`
  (single query; memories search is not a hot path) → `userTypes`. `auth.user` does **not** carry metadata,
  so a `getMetadata` round-trip is required; the `?? []` guard keeps it safe when the repo returns nothing.
- Computes `adminAvailable` from `getConfig()`.
- After mapping, filters out any memory where `!memory.isSaved` and the effective-show predicate is false.
  The mapped `MemoryResponseDto` retains `type`, `data` (incl. `ruleId`), and `isSaved`, so the key is
  derived with `getMemoryTypeKeyForMemory(memory.type, memory.data)`. Saved memories are always shown (a
  user who curated a memory keeps it even if its type is later disabled). Unknown-key memories are always shown.

`statistics()` is **not** type-filtered in this change (it returns a DB aggregate `{ total }`); its count may
include disabled-type memories. This is a documented limitation, not a goal of this change.

## Data Model

No schema change. The persisted `MemoryType` enum stays `{ OnThisDay, Rule }`; rule memories already carry
their type key in `RuleMemoryData.ruleId`, and `OnThisDay` maps to the constant key `'on_this_day'`.

## Config & Preference Shapes (exact)

### System config (`config.ts`)

```ts
memories: {
  retentionDays: number;
  /** @deprecated kept for back-compat; superseded by `types['birthday']` */
  birthday: boolean;
  /** @deprecated kept for back-compat; superseded by `types['recent_trip']` */
  recentTrips: boolean;
  /** sparse admin availability overrides, key -> enabled */
  types: Record<string, boolean>;
}
```

Defaults (unchanged legacy fields kept so generation never regresses between slices):
`retentionDays: 365, birthday: true, recentTrips: true, types: {}`.

### System-config DTO (`system-config.dto.ts`)

`SystemConfigMemoriesSchema` adds `types: z.record(z.string(), z.boolean())` (defaulting to `{}`), and keeps
`birthday` / `recentTrips` as before (now logically deprecated but still validated/persisted).

### User preferences (`types.ts`)

```ts
memories: {
  enabled: boolean;
  duration: number;
  /** full map of type key -> enabled; default built from the registry */
  types: Record<string, boolean>;
}
```

Default (`getDefaultPreferences()` in `preferences.ts`): `enabled: true, duration: 5, types: buildDefaultMemoryTypeMap()`.

### User-preferences DTO (`user-preferences.dto.ts`)

- `MemoriesUpdateSchema` adds `types: z.record(z.string(), z.boolean()).optional()`.
- `MemoriesResponseSchema` adds `types: z.record(z.string(), z.boolean())`.

### Server config DTO (`server.dto.ts`)

`ServerConfigSchema` adds `availableMemoryTypes: z.array(z.string())` — the globally-available type keys,
so the web user-settings UI knows which toggles to render. Populated in `server.service.ts` from
`getAdminAvailableMemoryTypeKeys(config.memories)` (sorted in registry order for stable output).

## API & Web Surfaces

- **Server config** exposes `availableMemoryTypes`. The user-settings page renders a per-type toggle for
  each available key.
- **User settings** (`feature-settings.svelte`): inside the existing memories accordion, below the master
  switch + duration, render a `Switch` per `availableMemoryTypes` key bound to
  `preferences.memories.types[key]`. Labels via i18n key `memory_type_<key>`, descriptions via
  `memory_type_<key>_description`. The save payload includes `memories.types`.
- **Admin settings** (`MemoriesSettings.svelte`): replace the two hardcoded birthday/recentTrips switches
  with a loop over `MEMORY_TYPE_KEYS` (a small web-side constant mirroring the registry keys), each bound to
  `config.memories.types[key]` with effective fallback to the metadata default; keep the retention number
  input. On save, write the explicit `types` map. Reuse the same `memory_type_<key>` labels.

## i18n

Add keys to the root locale files `i18n/en.json` (source), `i18n/de.json`, and `i18n/fr.json` (the fork
maintains all three; keep the key set identical across files).

**User-settings labels (top-level keys)** — used by `feature-settings.svelte` via `$t('memory_type_' + key)`:

- `memory_type_on_this_day` / `memory_type_on_this_day_description`
- `memory_type_birthday` / `memory_type_birthday_description`
- `memory_type_recent_trip` / `memory_type_recent_trip_description`

**Admin-settings labels (`admin.` prefix)** — used by `MemoriesSettings.svelte` via `$t('admin.memory_type_' + key + '_setting')`:

- `admin.memory_type_on_this_day_setting` / `admin.memory_type_on_this_day_setting_description`
- `admin.memory_type_birthday_setting` / `admin.memory_type_birthday_setting_description`
- `admin.memory_type_recent_trip_setting` / `admin.memory_type_recent_trip_setting_description`

The existing `admin.birthday_memories_setting` / `admin.recent_trip_memories_setting` keys may be left in
place (harmless) or removed once the admin UI no longer references them.

Suggested EN copy (user-facing):

- on_this_day: "On this day" / "Photos taken on this date in previous years."
- birthday: "Birthdays" / "Memories on the birthdays of people you've named."
- recent_trip: "Recent trips" / "Memories from places you recently visited away from home."

## Back-Compat & Rollout

- Existing users: `memories.types` default is all-true → every current type stays on. The new `types` field
  is absent from their stored preferences until they toggle something.
- Existing admin configs: instances that set legacy `memories.birthday` / `memories.recentTrips` keep those
  honored via the resolver's legacy fold (sparse `types` default). Instances that never touched them get
  the registry defaults.
- OpenAPI: every slice that changes a DTO (system-config, user-preferences, server-config) regenerates the
  SDK in the same slice and commits the generated output, so the in-repo SDK stays in sync with CI checks.
- Mobile: the regenerated client gains the new fields but no mobile UI changes ship here.

## OpenAPI Regeneration Commands

Run from the repo root after server DTO changes, per `CLAUDE.md`:

```bash
cd server && pnpm build && pnpm sync:open-api
cd .. && make open-api-typescript   # TS SDK is what web consumes
```

Commit the regenerated `open-api/typescript-sdk/` output as part of the slice.

## TDD Discipline

Every slice follows red → green → refactor:

1. Write the listed tests first. Run the named command and confirm they **fail for the expected reason**
   (red) — capture the failure summary.
2. Implement the minimal code to make them pass.
3. Run the command again and confirm green; run the type/lint check named in the slice.
4. Commit with the message in the slice.

Server unit tests use the `newTestService(MemoryService)` factory (auto-mocked repositories) — see the
existing `memory.service.spec.ts`. Web tests use Vitest + `@testing-library/svelte`.

---

## Slice 1 — Memory-type metadata module (pure, additive)

**Goal:** Introduce the registry's pure metadata + resolver functions with full unit coverage. No behavior
change anywhere else.

**Files:**

- Add `server/src/services/memory-rules/memory-type.metadata.ts` (content per Architecture Overview).
- Add `server/src/services/memory-rules/memory-type.metadata.spec.ts`.

**Tests (write first — red):** `cd server && pnpm test -- --run src/services/memory-rules/memory-type.metadata.spec.ts`

- `MEMORY_TYPE_METADATA` integrity:
  - keys are unique.
  - contains exactly `on_this_day`, `birthday`, `recent_trip` with the expected `kind` and
    `defaultEnabled: true`, `adminConfigurable: true`.
  - every `kind: 'rule'` entry's `key` is a non-empty string (rule-id parity is asserted in Slice 4 where
    the rule classes are imported).
- `buildDefaultMemoryTypeMap()` returns `{ on_this_day: true, birthday: true, recent_trip: true }`.
- `getMemoryTypeMetadata('birthday')` returns the entry; `getMemoryTypeMetadata('nope')` returns `undefined`.
- `getMemoryTypeKeyForMemory`:
  - `(MemoryType.OnThisDay, { year: 2020 })` → `'on_this_day'`.
  - `(MemoryType.Rule, { ruleId: 'birthday' })` → `'birthday'`.
  - `(MemoryType.Rule, {})` and `(MemoryType.Rule, null)` → `undefined`.
  - `(MemoryType.Rule, { ruleId: 42 })` (non-string) → `undefined`.
- `getAdminAvailableMemoryTypeKeys` precedence:
  - `{}` (no types, no legacy) → all three available.
  - `{ types: { recent_trip: false } }` → `recent_trip` not available, others available.
  - `{ birthday: false }` (legacy only) → `birthday` not available, others available.
  - `{ birthday: false, types: { birthday: true } }` → explicit `types` wins → `birthday` available.
  - `{ types: { unknown_key: true } }` → ignored (result is the three defaults).
- `isMemoryTypeEnabledForUser`:
  - `(undefined, 'birthday')` → `true` (default).
  - `({ birthday: false }, 'birthday')` → `false`.
  - `({}, 'recent_trip')` → `true` (falls back to default).
  - `(undefined, 'unknown_key')` → `false`.

**Implement (green):** create the metadata module exactly as specified.

**Verify:** test command green; `cd server && pnpm check` clean.

**Commit:** `feat(memories): add declarative memory-type metadata registry`

---

## Slice 2 — System-config admin gate (`memories.types` + resolver wiring)

**Goal:** Add the admin availability map to system config and DTO without touching generation (generation
still reads legacy fields until Slice 4). Regenerate SDK.

**Files:**

- `server/src/config.ts` — add `types: Record<string, boolean>` to the `memories` type; add `types: {}` to
  the `memories` defaults. Keep `birthday`/`recentTrips` (and their `true` defaults) intact.
- `server/src/dtos/system-config.dto.ts` — `SystemConfigMemoriesSchema` adds
  `types: z.record(z.string(), z.boolean()).default({})`; keep existing fields.
- `server/src/services/system-config.service.spec.ts` — extend (this is the file that asserts config
  defaults and validates the `memories` section; there is no `config.service.spec.ts` / `system-config.dto.spec.ts`).
- The `defaults.memories` object lives in `server/src/config.ts` and is exported as `defaults`.
- Regenerate SDK (commands above).

**Tests (write first — red):** `cd server && pnpm test -- --run src/services/system-config.service.spec.ts`

- Defaults: `defaults.memories.types` equals `{}`; `defaults.memories.retentionDays === 365`,
  `birthday === true`, `recentTrips === true` (unchanged).
- Validation: a stored override `{ memories: { types: { recent_trip: false } } }` round-trips through
  `getConfig` and yields `config.memories.types.recent_trip === false`.
- Validation: with no `types` in the stored override, `config.memories.types` resolves to `{}` (the schema
  default), and `birthday`/`recentTrips` booleans still validate.

Note: `getConfig` merges the stored override over `defaults`, `safeParse`s, and only logs (does not throw on)
unknown keys, so this is additive and safe for existing stored configs.

**Implement (green):** add the field + default; extend the zod schema.

**Verify:** test command green; `pnpm check` clean; SDK regenerated and committed; confirm `git status`
shows only intended generated changes.

**Commit:** `feat(memories): add per-type admin availability map to system config`

---

## Slice 3 — Per-user preference type map

**Goal:** Add `memories.types` to user preferences (full registry default), update DTOs, confirm the
existing partial-storage util round-trips sparse overrides. Regenerate SDK.

**Files:**

- `server/src/types.ts` — add `types: Record<string, boolean>` to `UserPreferences.memories`.
- `server/src/utils/preferences.ts` — `getDefaultPreferences().memories.types = buildDefaultMemoryTypeMap()`
  (import from the metadata module).
- `server/src/dtos/user-preferences.dto.ts` — `MemoriesUpdateSchema` adds optional `types` record;
  `MemoriesResponseSchema` adds required `types` record.
- `server/src/utils/preferences.spec.ts` — extend.
- Regenerate SDK.

**Tests (write first — red):** `cd server && pnpm test -- --run src/utils/preferences.spec.ts`

- `getPreferences([])` → `memories.types` equals `{ on_this_day: true, birthday: true, recent_trip: true }`.
- Sparse override round-trip: given stored metadata
  `[{ key: Preferences, value: { memories: { types: { birthday: false } } } }]`,
  `getPreferences(...)` → `memories.types.birthday === false` and the other keys remain `true`.
- `getPreferencesPartial`: a preferences object with only `memories.types.birthday` flipped to `false`
  produces partial `{ memories: { types: { birthday: false } } }` and does **not** include unchanged type
  keys (proves the full default enables sparse persistence).
- `mergePreferences`: applying update DTO `{ memories: { types: { recent_trip: false } } }` flips only
  `recent_trip` and leaves `birthday`/`on_this_day` at their prior values (partial-merge, no clobber).
- A new/unknown future key present in stored value (e.g. `types: { future_type: true }`) is preserved by
  `getPreferences` (overlay sets it) without throwing.

**Implement (green):** add the type field, the registry-derived default, and the DTO fields.

**Verify:** test command green; `pnpm check` clean; SDK regenerated/committed.

**Commit:** `feat(memories): add per-user memory-type preference map`

---

## Slice 4 — Generation gating via the registry

**Goal:** Replace hardcoded rule instantiation with the registry and apply the admin-gate + per-user gate to
both `OnThisDay` and rule generation. Preserve a spy-able `getMemoryRules` seam for the existing
scheduling/scoring tests.

**Files:**

- Add `server/src/services/memory-rules/memory-type.registry.ts` (content per Architecture Overview).
- Add `server/src/services/memory-rules/memory-type.registry.spec.ts`.
- `server/src/services/memory.service.ts`:
  - Replace `getMemoryRules(config)` with `getMemoryRules(enabledKeys: Iterable<string>): MemoryRule[]`
    returning `createMemoryRules(enabledKeys, { personRepository, assetRepository, memoryRepository })`.
    (Keep it a private method so existing tests can `vi.spyOn(sut, 'getMemoryRules')`.)
  - In `onMemoriesCreate`, compute `adminAvailable` once; resolve `userTypesById` once via
    `getPreferences(owner.metadata ?? []).memories.types` (per the Generation flow section).
  - Gate `createOnThisDayMemories` per user on `on_this_day` effective-generate.
  - Compute per-user `enabledRuleKeys` and pass them through `createRuleMemories` →
    `evaluateRuleCandidates` → `getMemoryRules(enabledRuleKeys)`. No secondary `ruleId` post-filter.
  - Remove direct reads of `config.memories.birthday` / `recentTrips` from generation (they now flow only
    through `getAdminAvailableMemoryTypeKeys`). Keep `getMemoryRules` and `createRuleMemories` as private
    methods so the existing arg-agnostic spies keep working.
- `server/src/services/memory.service.spec.ts` — add new gating tests; the three existing legacy-disable
  tests should continue to pass **unchanged** (see below).

**Tests (write first — red):**

Registry: `cd server && pnpm test -- --run src/services/memory-rules/memory-type.registry.spec.ts`

- `createMemoryRules(['birthday'], deps)` returns one rule whose `id === 'birthday'`.
- `createMemoryRules(['birthday','recent_trip'], deps)` returns rules with ids `['birthday','recent_trip']`.
- `createMemoryRules(['on_this_day'], deps)` returns `[]` (not a rule-kind).
- `createMemoryRules([], deps)` returns `[]`.
- Rule-id parity: for every `kind: 'rule'` metadata entry, `createMemoryRules([key], deps)[0].id === key`.
- Registry completeness guard: `createMemoryRules(MEMORY_TYPE_KEYS, deps)` returns exactly one rule per
  `kind: 'rule'` metadata entry (count equals the number of rule-kind entries) — catches a rule-kind key
  with no factory. Combined with the per-key id check above, this asserts factory↔metadata parity in both
  directions (no orphan factory, no rule-kind metadata without a working factory).
- `createMemoryRules(['birthday','birthday'], deps)` returns a single birthday rule (duplicate keys
  deduped by the internal `Set`).

Service: `cd server && pnpm test -- --run src/services/memory.service.spec.ts`

**Existing tests that must stay green unchanged (regression guard, do NOT rewrite):**

- The three legacy-disable tests (`...when birthday memories are disabled`, `...when recent trip memories are
disabled`, `...when all generated memory rules are disabled`) feed `SystemConfig` overrides
  `{ memories: { birthday: false, recentTrips: true } }` etc. Via the legacy fold these still exclude the
  corresponding rule, so `getBirthdaysForDay` / `getMemoryLocationClusters` assertions hold as-is. This is
  the back-compat proof.
- The spy-based scheduling/scoring tests (`...not future precompute dates`, `...top two surviving...`,
  `...daily rule cap...`, `prefers a fallback...`, `...not advance the rule cursor...`) `vi.spyOn` the private
  `getMemoryRules` / `createRuleMemories` with arg-agnostic mocks, so the new `(enabledKeys)` signature does
  not change them. Their users come from `factory.userAdmin()` (metadata `[]` → all types enabled by
  default) so the per-user gate does not filter their fake rules. Confirm green; no edits expected.

**New tests to add:**

- **OnThisDay per-user gate:** with `on_this_day` admin-available and user pref enabled → `createOnThisDayMemories`
  runs (memoryRepository.create called for OnThisDay). With a user whose metadata encodes
  `memories.types.on_this_day = false` → OnThisDay generation skipped for that user. With admin
  `memories.types.on_this_day = false` (SystemConfig override) → skipped for all users.
- **Rule per-user gate:** two users from `factory.userAdmin()`, user A metadata with `types.birthday = true`,
  user B metadata with `types.birthday = false`; assert the birthday rule is evaluated for A but not B
  (e.g. via a `getMemoryRules` spy that records the `enabledKeys` it was called with per user, or by
  asserting `getBirthdaysForDay` call count tracks only A).
- **Admin gate over rules:** SystemConfig `memories.types.recent_trip = false` → recent-trip rule never
  instantiated for any user, regardless of user prefs (`getMemoryLocationClusters` not called).
- **Master switch is display-only:** a user whose metadata sets `memories.enabled = false` but
  `types.birthday = true` still has birthday generation attempted (generation ignores the master switch).

Mocking notes: build user metadata with the existing factories — a user metadata item
`{ key: UserMetadataKey.Preferences, value: { memories: { types: { birthday: false } } } }` on
`factory.userAdmin({ metadata: [...] })` drives `getPreferences`. `userRepository.getList` returns those
users. SystemConfig overrides go through `mocks.systemMetadata.get` keyed on `SystemMetadataKey.SystemConfig`
exactly as the existing legacy tests do.

**Implement (green):** add the registry module; rewire `MemoryService` as specified.

**Verify:** both test commands green; `pnpm check` clean.

**Commit:** `feat(memories): gate generation by admin + per-user memory-type config`

---

## Slice 5 — Read-time filtering in `search`

**Goal:** Hide non-saved memories of disabled types from a user's feed immediately.

**Files:**

- `server/src/services/memory.service.ts` — extend `search`:
  - load `userTypes` via `getPreferences((await userRepository.getMetadata(auth.user.id)) ?? []).memories.types`.
  - compute `adminAvailable` from `getConfig()`.
  - filter mapped memories: keep when `memory.isSaved`, or `key === undefined`, or
    `adminAvailable.has(key) && isMemoryTypeEnabledForUser(userTypes, key)`, where
    `key = getMemoryTypeKeyForMemory(memory.type, memory.data)`.
- `server/src/services/memory.service.spec.ts` — **first** make the existing search tests safe, then add cases.

**Required fix to existing tests (do this before adding new ones):** the new `search` calls
`userRepository.getMetadata`, whose auto-mock returns `undefined` by default → `getPreferences(undefined)`
would throw and break ALL five existing `describe('search')` tests. Add
`mocks.user.getMetadata.mockResolvedValue([])` to the `search` describe's setup (a local `beforeEach` or in
each existing test). `getConfig` is safe by default (no SystemConfig override → defaults → all available),
so the existing search assertions then pass unchanged.

**Tests (write first — red):** `cd server && pnpm test -- --run src/services/memory.service.spec.ts`

- Returns an `OnThisDay` memory when `on_this_day` is enabled for the user; excludes it when the user's
  metadata sets `memories.types.on_this_day = false` (mock `userRepository.getMetadata` to return that
  preferences metadata).
- Returns a `Rule` memory with `ruleId: 'birthday'` when `birthday` enabled; excludes it when the user's
  metadata disables birthday.
- Excludes a memory when its type is admin-unavailable (SystemConfig `memories.types.recent_trip = false`
  via `mocks.systemMetadata.get` on `SystemMetadataKey.SystemConfig`) even if the user pref would allow it.
- **Saved exemption:** a saved (`isSaved: true`) birthday memory is still returned even when the user has
  birthday disabled.
- **Unknown key passthrough:** a `Rule` memory with `ruleId: 'foreign_rule'` (not in metadata) is always
  returned.
- Existing asset-permission filtering still applies (the existing `search` tests stay green after the
  `getMetadata` mock fix).

Mocking notes: `MemoryFactory.create({ type, data, isSaved })` builds the memory; `getForMemory(...)` wraps
it for `searchAccessible`. The mapped DTO keeps `type`/`data`/`isSaved`, so the filter can derive the key.

**Implement (green):** add the filter.

**Verify:** test command green; `pnpm check` clean.

**Commit:** `feat(memories): hide disabled memory types from the memories feed`

---

## Slice 6 — Server-config exposure + web user-settings toggles + i18n

**Goal:** Expose available type keys to the web and render per-type user toggles. Regenerate SDK.

Do the server side first, regenerate the SDK, then the web side (the web code/tests need the regenerated
`availableMemoryTypes` / `memories.types` SDK types to type-check).

**Files (server, then regen, then web):**

- `server/src/dtos/server.dto.ts` — `ServerConfigSchema` adds
  `availableMemoryTypes: z.array(z.string()).describe('Globally-available memory type keys')`.
- `server/src/services/server.service.ts` — in `getSystemConfig()`, add `availableMemoryTypes` populated
  from `getAdminAvailableMemoryTypeKeys(config.memories)` in registry order:
  `availableMemoryTypes: MEMORY_TYPE_KEYS.filter((k) => available.has(k))`.
- `server/src/services/server.service.spec.ts` — the `getSystemConfig` test asserts the whole DTO with an
  exact `toEqual({...})`; **add `availableMemoryTypes: ['on_this_day','birthday','recent_trip']` to that
  expected object** (otherwise it goes red on an unrelated field), and add a case for the admin-disabled path.
- Regenerate SDK (server build + `make open-api-typescript`); commit generated output.
- i18n: add the user-facing `memory_type_*` keys to `i18n/en.json`, `i18n/de.json`, `i18n/fr.json`.
- `web/src/routes/(user)/user-settings/feature-settings.svelte` — read the key list from
  `serverConfigManager.value.availableMemoryTypes`; inside the memories accordion render a `Switch` per key
  bound to a local `memoriesTypes` state seeded from `authManager.preferences.memories?.types`; include
  `memories: { enabled, duration, types: memoriesTypes }` in the `updateMyPreferences` payload. Label via
  `$t('memory_type_' + key)`, subtitle via `$t('memory_type_' + key + '_description')`.
- `web/src/routes/(user)/user-settings/feature-settings.spec.ts` — **new file** (none exists today).

**Tests (write first — red):**

- Server: `cd server && pnpm test -- --run src/services/server.service.spec.ts`
  - `getSystemConfig()` returns `availableMemoryTypes: ['on_this_day','birthday','recent_trip']` by default.
  - with `mocks.systemMetadata.get` returning a SystemConfig override `{ memories: { types: { recent_trip: false } } }`,
    the array omits `recent_trip`.
- Web: `cd web && pnpm test -- --run 'src/routes/(user)/user-settings/feature-settings.spec.ts'`
  (mock `serverConfigManager` to expose `value.availableMemoryTypes` and `authManager` to expose
  `preferences`, mirroring how `MemoriesSettings.spec.ts` mocks `systemConfigManager`)
  - given `availableMemoryTypes = ['on_this_day','birthday','recent_trip']` and preferences `memories.types`,
    renders one labelled toggle per key reflecting the pref value.
  - toggling a type updates the outgoing `updateMyPreferences` payload's `memories.types[key]` without
    altering `enabled` / `duration`.
  - a type absent from `availableMemoryTypes` is not rendered.

**Implement (green):** server field + population (+ fix the exact-match test); regen SDK; web toggles +
i18n strings.

**Verify:** server + web test commands green; `pnpm check` (server) and `make check-web` clean; SDK
regenerated/committed; i18n JSON valid (all three locales have the new keys).

**Commit:** `feat(memories): per-type user toggles in settings`

---

## Slice 7 — Admin settings dynamic UI

**Goal:** Replace the hardcoded admin birthday/recentTrips switches with a registry-driven list.

No SDK regen here (no server DTO change — `SystemConfigMemoriesDto.types` already shipped in Slice 2).

**Files:**

- `web/src/routes/admin/system-settings/MemoriesSettings.svelte` — the component reads
  `config = systemConfigManager.value` and edits a clone `configToEdit = systemConfigManager.cloneValue()`,
  with `SettingButtonsRow keys={['memories']}`. Keep the `retentionDays` `SettingInputField`. Replace the two
  hardcoded `SettingSwitch`es (birthday / recentTrips) with a loop over a small web constant mirroring
  `MEMORY_TYPE_KEYS` (`['on_this_day','birthday','recent_trip']`); each `SettingSwitch` is `bind:checked` to a
  derived getter/setter over `configToEdit.memories.types[key]` that **falls back to `true`** (the metadata
  default) when the key is unset, and writes the explicit boolean on toggle. Titles/subtitles via
  `$t('admin.memory_type_' + key + '_setting')` / `_setting_description`.
- `web/src/routes/admin/system-settings/MemoriesSettings.spec.ts` — update the `makeConfig` factory so
  `memories` includes `types: {}` (alongside `retentionDays`, `birthday`, `recentTrips`), and rewrite the
  switch assertions to the dynamic list. Keep the same mocking shape (`featureFlagsManager`,
  `systemConfigManager`) and the `handleSystemConfigSave` assertion pattern.

**Tests (write first — red):** `cd web && pnpm test -- --run src/routes/admin/system-settings/MemoriesSettings.spec.ts`

- Renders one switch per memory-type key (`on_this_day`, `birthday`, `recent_trip`) plus the retention input.
- A key unset in `config.memories.types` renders **on** (metadata default); a key set to `false` renders off.
- Toggling a type writes `configToEdit.memories.types[key]` and does not disturb `retentionDays`.
- Saving emits the updated `memories.types` through `handleSystemConfigSave` (the existing save flow).

**Implement (green):** rewrite the component's memory-type section as a loop; keep retention handling.

**Verify:** web test command green; `make check-web` clean.

**Commit:** `feat(memories): registry-driven admin memory-type settings`

---

## Edge-Case Catalog (cross-slice)

| #   | Edge case                                     | Handling                                                                               | Covered in |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------- | ---------- |
| 1   | New future type added                         | full user default map + sparse admin default → inherits `defaultEnabled`, no migration | 1, 3       |
| 2   | Pre-existing admin `birthday: false` (legacy) | resolver legacy fold (sparse admin default)                                            | 1, 2, 4    |
| 3   | Admin `types[k]` vs legacy conflict           | explicit `types[k]` wins                                                               | 1          |
| 4   | Unknown key in admin `types`                  | ignored                                                                                | 1          |
| 5   | Unknown `ruleId` on a persisted memory        | `getMemoryTypeKeyForMemory` → `undefined` → always shown                               | 1, 5       |
| 6   | Saved memory of a disabled type               | exempt from read-time filter (always shown)                                            | 5          |
| 7   | Master `enabled: false` but type enabled      | generation still runs (display-only master)                                            | 4          |
| 8   | User disables a type                          | future generation stops AND non-saved existing memories hidden                         | 4, 5       |
| 9   | Admin disables a type globally                | no generation for anyone; non-saved existing hidden on read                            | 4, 5       |
| 10  | Sparse user override persistence              | full user default map enables `getPreferencesPartial` to store diffs only              | 3          |
| 11  | Partial preferences update (one toggle)       | `mergePreferences` leaf-merge does not clobber other type values                       | 3          |
| 12  | `on_this_day` toggled like any rule type      | gated in the OnThisDay window loop, code path otherwise unchanged                      | 4          |
| 13  | Import cycle risk (config↔registry)           | metadata module imports only `enum`; rule classes isolated in registry module          | 1, 4       |
| 14  | `auth.user` has no metadata in `search`       | `userRepository.getMetadata(auth.user.id)` round-trip, guarded with `?? []`            | 5          |
| 15  | Existing `search`/`getSystemConfig` tests     | update `getMetadata` mock + the exact-match `toEqual` expectation in the same slice    | 5, 6       |
| 16  | `statistics()` count vs hidden types          | NOT filtered in v1 (DB aggregate) — documented limitation, count may include disabled  | —          |

## Out of Scope (restated)

Per-type tunable parameters, priority/reorder UI, external plugin loading, mobile per-type toggle UI,
`MemoryType`/table schema changes, and changing the master `memories.enabled` switch's display-only meaning.
