# Smart Search Relevance Threshold

**Issue:** [#290](https://github.com/open-noodle/gallery/issues/290)
**Date:** 2026-04-06

## Problem

When combining CLIP smart search with metadata filters (location, camera, people, etc.),
results include visually irrelevant photos. Searching "Forest" returns 100 great forest photos,
but "Forest" + country="Qatar" returns 15 Qatar city photos — none are forests.

The system returns ALL photos matching the metadata filter, ranked by CLIP similarity, with no
minimum relevance cutoff. If the user has 15 Qatar photos and none contain forests, all 15 are
returned anyway because they are the "most forest-like" Qatar photos — even if their similarity
scores are terrible.

## Solution

Add a `maxDistance` field to `machineLearning.clip` in SystemConfig. This is applied as a WHERE
clause in `searchSmart()` to exclude results whose cosine distance exceeds the threshold.
Configurable via the admin UI and YAML config file.

## Default Value: 0 (disabled)

This feature is **opt-in**. The default value of `0` means no relevance threshold is applied,
preserving the original search behavior. Users who experience irrelevant results when combining
text search with filters can enable it by setting a value.

The `<=>` cosine distance operator ranges from 0 (identical) to 2 (opposite). Reference points:

- `facialRecognition.maxDistance` defaults to 0.5 (face-to-face embeddings cluster tightly)
- `duplicateDetection.maxDistance` defaults to 0.01 (near-identical images)
- CLIP text-to-image matching is inherently fuzzier — cross-modal distances are noisier than
  same-modal comparisons, so a looser threshold is needed

Recommended starting value: **0.75**. Users can tune from there via admin settings.

## Changes

### 1. Config Type

**File:** `server/src/config.ts`

Add `maxDistance: number` to the `machineLearning.clip` type and set default to `0` (disabled):

```typescript
clip: {
  enabled: boolean;
  modelName: string;
  maxDistance: number; // new — 0 means disabled
}
```

```typescript
clip: {
  enabled: true,
  modelName: 'ViT-B-32__openai',
  maxDistance: 0,  // new — 0 = disabled, recommended: 0.75
},
```

### 2. DTO Validation

**File:** `server/src/dtos/model-config.dto.ts`

Add `maxDistance` to `CLIPConfig` class, following the `FacialRecognitionConfig.maxDistance` pattern:

```typescript
export class CLIPConfig extends ModelConfig {
  @IsNumber()
  @Min(0)
  @Max(2)
  @Type(() => Number)
  @ApiProperty({
    type: 'number',
    format: 'double',
    description: 'Maximum cosine distance for smart search results. 0 = disabled.',
  })
  maxDistance!: number;
}
```

Min is 0 (disabled). Active range is roughly 0.3–2.0. Values below 0.3 would return zero
results for most queries since CLIP text-to-image distances rarely go below ~0.4 even for
strong matches. Note: image-to-image similarity (via `queryAssetId`) produces different
distance distributions than text-to-image — users should tune separately if using both.

### 3. Search Options Type

**File:** `server/src/repositories/search.repository.ts`

Add `maxDistance` to `SearchEmbeddingOptions`:

```typescript
export interface SearchEmbeddingOptions {
  embedding: string;
  userIds: string[];
  maxDistance?: number; // new
}
```

This flows into `SmartSearchOptions` via the existing type intersection.

### 4. Search Service

**File:** `server/src/services/search.service.ts`

Pass `machineLearning.clip.maxDistance` into the repository call (line ~165):

```typescript
const { hasNextPage, items } = await this.searchRepository.searchSmart(
  { page, size },
  {
    ...dto,
    userIds: await userIds,
    embedding,
    orderDirection: dto.order,
    maxDistance: machineLearning.clip.maxDistance,
  },
);
```

### 5. Search Repository

**File:** `server/src/repositories/search.repository.ts`

Modify `searchSmart()` to apply the threshold. Also update the `@GenerateSql` decorator params
to include `maxDistance: 0.75` so `make sql` generates representative SQL with the WHERE clause.

Two sub-cases based on ordering:

#### Case A: Relevance Ordering (no `orderDirection`)

Add a WHERE clause directly — no CTE needed. The threshold is applied before LIMIT so
pagination stays correct. Use Kysely's `.$if()` pattern with explicit parentheses in the
`sql` template to avoid operator precedence ambiguity between `<=>` and `<=`:

```sql
SELECT asset.*
FROM asset
  INNER JOIN smart_search ON asset.id = smart_search.assetId
WHERE [all existing filters]
  AND (smart_search.embedding <=> $embedding) <= $maxDistance
ORDER BY smart_search.embedding <=> $embedding
LIMIT $size + 1
OFFSET $offset
```

#### Case B: Date Ordering (with `orderDirection`)

Add the threshold inside the existing CTE that fetches top 500 by similarity:

```sql
WITH candidates AS (
  SELECT asset.*
  FROM asset
    INNER JOIN smart_search ON asset.id = smart_search.assetId
  WHERE [all existing filters]
    AND (smart_search.embedding <=> $embedding) <= $maxDistance
  ORDER BY smart_search.embedding <=> $embedding
  LIMIT 500
)
SELECT * FROM candidates
ORDER BY fileCreatedAt $direction NULLS LAST
LIMIT $size + 1
OFFSET $offset
```

#### Skip Condition

Skip the threshold clause entirely when `maxDistance` is `0` (disabled) or `>= 2.0` (no-op).
This preserves original behavior and avoids unnecessary computation.

#### Known Limitation

The 500-row window in date ordering is pre-existing. The threshold makes under-filling more
likely (if many results exceed the threshold, fewer than 500 candidates survive). This is
acceptable because date ordering is a secondary use case and the window was already arbitrary.

### 6. Admin UI

**File:** `web/src/lib/components/admin-settings/MachineLearningSettings.svelte`

Add a `SettingInputField` inside the "smart-search" accordion (after the model name field):

```svelte
<SettingInputField
  inputType={SettingInputFieldType.NUMBER}
  label={$t('admin.machine_learning_clip_max_distance')}
  description={$t('admin.machine_learning_clip_max_distance_description')}
  bind:value={configToEdit.machineLearning.clip.maxDistance}
  step="0.05"
  min={0}
  max={2}
  disabled={disabled || !configToEdit.machineLearning.enabled || !configToEdit.machineLearning.clip.enabled}
  isEdited={configToEdit.machineLearning.clip.maxDistance !== config.machineLearning.clip.maxDistance}
/>
```

### 7. i18n Keys

Add to the English locale file:

- `admin.machine_learning_clip_max_distance`: "Max search distance"
- `admin.machine_learning_clip_max_distance_description`: "Maximum cosine distance for smart
  search results. Lower values return fewer but more relevant results. Values below 0.3 will
  likely return no results. Set to 0 to disable (default). Recommended: 0.75"

### 8. Generated Files

- `make open-api` — regenerate TypeScript SDK and Dart client (CLIPConfig schema changed)
- `make sql` — regenerate SQL query documentation

### 9. Documentation

**File:** `docs/docs/install/config-file.md`

Add `maxDistance` to the clip section in the example config:

```json
"clip": {
  "enabled": true,
  "modelName": "ViT-B-32__openai",
  "maxDistance": 0
}
```

**File:** `docs/docs/features/searching.md`

Add a section explaining the relevance threshold:

> **Relevance threshold:** Smart search can optionally exclude results with low similarity to
> the search query. This prevents irrelevant photos from appearing when combining text search
> with metadata filters (e.g., searching "forest" filtered to a specific country that has no
> forest photos).
>
> By default this is disabled (set to 0). To enable, set `machineLearning.clip.maxDistance` in
> Administration > Machine Learning > Smart Search, or in your config file.
>
> Examples:
>
> - `0` — Disabled (default). All results returned regardless of similarity.
> - `0.5` — Very strict. Only strong visual matches. May miss borderline-relevant results.
> - `0.75` — Recommended. Good balance of relevance and recall.
> - `1.0` — Permissive. Includes weaker matches. Useful for broad or abstract queries.

### 10. Tests

**Existing test updates** (`server/src/services/search.service.spec.ts`):

The `'should work'` test uses exact object matching on the `searchSmart` call args. Adding
`maxDistance` to the options will break it. Update this test (and any others using exact
matching instead of `expect.objectContaining`) to include `maxDistance: 0` in the expected
options.

**New service tests** (`server/src/services/search.service.spec.ts`):

- Verify `maxDistance` from config is passed to `searchRepository.searchSmart()` (text query path)
- Verify `maxDistance` from config is passed to `searchRepository.searchSmart()` (queryAssetId path)

**Repository tests** (medium tests with real DB preferred, since mocking Kysely doesn't verify SQL):

- Verify distance WHERE clause is applied for relevance ordering (Case A)
- Verify distance WHERE clause is applied for date ordering (Case B)
- Verify `maxDistance` of `0` skips the threshold clause (disabled)
- Verify `maxDistance >= 2.0` skips the threshold clause (no-op)
- Verify pagination correctness: when threshold filters results, `hasNextPage` is correct

## What This Does NOT Change

- Embedding generation or storage
- Machine learning service
- Search API contract (no new query parameter — server-side config only)
- `searchFaces`, duplicate detection, or any other search method
- Frontend search behavior (already handles variable result counts and "no results" state)
