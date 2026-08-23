# Slice 6 — Theme catalog + `ThemeSearchPort` + adapter + config

Spec: `docs/plans/2026-07-19-memory-types-tier3-spec.md` §3.4, §3.4.1, §4.2 (catalog/adapter halves),
§6.5, Slice 6. Prepares Slice 7 (`themed`). Registers **no** memory type.

## Part A — `theme.catalog.ts` (pure)

### A1. RED — `server/src/services/memory-rules/theme.catalog.spec.ts` (new)

- `THEMES` has 6 entries; every `key` is unique; every entry has a non-empty `query` and `label`.
- `themeForMonth` pinned for **all 12 months** (write out the expected key per month).
- Month 1 and month 7 give the **same** theme (6 themes, 12 months).
- The same month in **different years** gives the same theme — i.e. `themeForMonth` depends only on
  the month, so rotation is stable across year and leap boundaries. (Spec §4.2: this is exactly why
  rotation is month-based rather than day-of-year — `365 % 6 !== 0` would break stability.)

Run: `cd server && pnpm test --run src/services/memory-rules/theme.catalog.spec.ts`

### A2. GREEN — `server/src/services/memory-rules/theme.catalog.ts` (new)

```ts
export interface Theme {
  key: string;
  /** CLIP text prompt */
  query: string;
  /** human label used in the memory title */
  label: string;
}

export const THEMES: Theme[] = [
  { key: 'sunset', query: 'a beautiful sunset', label: 'Sunsets' },
  { key: 'beach', query: 'a beach with sand and ocean', label: 'Beach days' },
  { key: 'food', query: 'a plate of food at a meal', label: 'Food' },
  { key: 'mountains', query: 'mountains and hiking trails', label: 'Mountains' },
  { key: 'snow', query: 'a snowy winter landscape', label: 'Snow days' },
  { key: 'city_night', query: 'a city skyline at night', label: 'City lights' },
];

/** Deterministic for a given calendar month, forever. */
export const themeForMonth = (month: number): Theme => THEMES[(month - 1) % THEMES.length]!;
```

## Part B — `theme-search.port.ts` (interface only, no test)

Exactly spec §3.4:

```ts
export interface ThemeSearchAsset {
  id: string;
  localDateTime: Date;
}

export interface ThemeSearchPort {
  /** null when smart search is disabled or the embedding cannot be produced. Never throws. */
  resolveEmbedding(themeKey: string, query: string): Promise<string | null>;
  /** Assets ordered by similarity, best first. */
  searchByEmbedding(params: {
    ownerId: string;
    embedding: string;
    takenAfter: Date;
    takenBefore: Date;
    size: number;
  }): Promise<ThemeSearchAsset[]>;
}
```

## Part C — the adapter (TDD)

### C1. RED — `server/src/services/memory-rules/theme-search.adapter.spec.ts` (new)

Construct `MemoryThemeSearchAdapter` with fakes for its three collaborators (see C2). Cases from
spec §6.5:

1. `resolveEmbedding` returns `null` when `isSmartSearchEnabled(config.machineLearning)` is false
   (e.g. `machineLearning.enabled: false`, or `clip.enabled: false`) — and `encodeText` is **not called**.
2. `encodeText` is called **once** for two identical `(modelName, language, themeKey)` requests —
   the second is a cache hit returning the same string.
3. `encodeText` is called **again** when `clip.modelName` changes between calls.
4. `encodeText` is called **again** when `language` changes between calls.
   (3 and 4 prove the cache key is `${modelName}:${language ?? 'default'}:${themeKey}` — spec §4.2.)
5. `encodeText` rejects ⇒ `resolveEmbedding` returns `null`, does **not** throw.
6. `searchByEmbedding` forwards to `searchSmart` with: `userIds: [ownerId]`,
   `type: AssetType.Image`, `visibility: AssetVisibility.Timeline`, the given `size`,
   `maxDistance` from `config.memories.themeMaxDistance`, and **2-day-widened** date bounds.
   Assert the **exact** widened Dates (`takenAfter - 2d`, `takenBefore + 2d`) — spec §3.4.1.
7. `searchByEmbedding` maps `searchSmart`'s rows to `{ id, localDateTime }` only.

### C2. GREEN — `server/src/services/memory-rules/theme-search.adapter.ts` (new)

```ts
export const SEARCH_WINDOW_MARGIN_DAYS = 2;

export class MemoryThemeSearchAdapter implements ThemeSearchPort {
  private readonly cache = new Map<string, string>();

  constructor(
    private machineLearningRepository: Pick<MachineLearningRepository, 'encodeText'>,
    private searchRepository: Pick<SearchRepository, 'searchSmart'>,
    private getConfig: () => Promise<SystemConfig>,
    private logger: LoggingRepository,   // or a minimal { warn } shape
  ) {}
  ...
}
```

`resolveEmbedding(themeKey, query)`:

- `const config = await this.getConfig();`
- `if (!isSmartSearchEnabled(config.machineLearning)) return null;` (import from `src/utils/misc`)
- `const { modelName } = config.machineLearning.clip;` — `language` is `undefined` in this batch, but
  **include it in the cache key** so a future non-English deployment cannot serve a stale English
  embedding: `` const cacheKey = `${modelName}:${language ?? 'default'}:${themeKey}` ``
- return cached if present; else `await encodeText(query, { modelName, language })`, cache, return.
- wrap the `encodeText` call in try/catch → log and `return null`.

`searchByEmbedding({ ownerId, embedding, takenAfter, takenBefore, size })`:

- `const config = await this.getConfig();`
- widen: `takenAfter - SEARCH_WINDOW_MARGIN_DAYS days`, `takenBefore + SEARCH_WINDOW_MARGIN_DAYS days`
  (use Luxon or plain ms arithmetic — be consistent and testable).
- `const { items } = await searchSmart({ page: 1, size }, { embedding, userIds: [ownerId], takenAfter: widenedAfter, takenBefore: widenedBefore, type: AssetType.Image, visibility: AssetVisibility.Timeline, maxDistance: config.memories.themeMaxDistance })`
- `return items.map(({ id, localDateTime }) => ({ id, localDateTime }))`

> **Why widened:** `searchAssetBuilder` maps `takenAfter`/`takenBefore` to **`asset.fileCreatedAt`**
> (`server/src/utils/database.ts:725-726`), not `localDateTime`. The margin ensures no in-year asset
> is missed by that skew; the **rule** (Slice 7) then filters precisely by `localDateTime` year.

## Part D — config field

- `server/src/config.ts`: add `themeMaxDistance: number;` to the `memories` type (~line 179) and
  `themeMaxDistance: 0.3,` to the `memories` defaults (~line 443).
- `server/src/dtos/system-config.dto.ts`: `SystemConfigMemoriesSchema` (~line 267) adds
  `themeMaxDistance: z.coerce.number().min(0).max(2).default(0.3).describe('Max CLIP cosine distance for themed memories')`.
  Note `0 < maxDistance < 2` is the active range (`isActiveDistanceThreshold`); `0` disables the
  threshold entirely, which for themed means "no quality gate" — allowed but not the default.
- `server/src/services/system-config.service.spec.ts`: extend the defaults assertion if it pins the
  whole `memories` object.

## Part E — SDK regeneration

```bash
cd server && pnpm build && pnpm sync:open-api
cd .. && make open-api-typescript
```

Commit the regenerated `open-api/typescript-sdk/` output. Do **not** hand-edit generated files.

## Verification

```bash
cd server && pnpm test --run src/services/memory-rules/
cd server && pnpm test --run src/services/system-config.service.spec.ts
cd server && pnpm run check
cd server && npx eslint src/services/memory-rules/ src/config.ts src/dtos/system-config.dto.ts --max-warnings 0
cd server && npx prettier --check "src/services/memory-rules/**" src/config.ts src/dtos/system-config.dto.ts
```

## Out of scope

No `themed` rule, no registry/metadata entry, no wiring into `MemoryService` — all Slice 7.

## Commit

`feat(memories): add theme catalog and smart-search port for themed memories`
