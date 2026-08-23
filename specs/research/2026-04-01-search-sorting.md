# Research: Sorting CLIP Search Results

**Date:** 2026-04-01
**Context:** [immich-app/immich#8377](https://github.com/immich-app/immich/discussions/8377) — 55+ participants requesting sort options for search results
**Status:** Research only — no implementation

---

## The Problem

Smart search (CLIP) results are ordered exclusively by vector cosine distance. Users want to browse semantically relevant results chronologically (e.g., "show all beach photos, newest first"). The current behavior returns the entire library ranked by similarity with no cutoff or alternative sort.

**Key quote from discussion:** "The lack of this feature is the primary reason why I cannot get my family and friends to use my Immich instance."

**Maintainer concern:** "Relevance score curve varies drastically depending on search... threshold being off by just 0.01 is enough to cleave off hundreds of relevant assets or include hundreds of irrelevant assets."

---

## Current Architecture

### Smart Search Flow

1. `POST /search/smart` → `SmartSearchDto` (query text or reference assetId)
2. Service encodes text via ML (CLIP) → 512D embedding, cached in LRU
3. Repository queries PostgreSQL:
   ```sql
   SELECT asset.*
   FROM asset
   INNER JOIN smart_search ON asset.id = smart_search."assetId"
   ORDER BY smart_search.embedding <=> $embedding  -- cosine distance
   LIMIT $size + 1 OFFSET $offset
   ```
4. Vector index (HNSW or VectorChord) is used **only** when the pattern is `ORDER BY distance LIMIT K`
5. Response: `AssetResponseDto[]` — distance/score is **not returned**

### Key Constraints

| Constraint             | Detail                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Vector index trigger   | Requires `ORDER BY distance LIMIT K` — any other pattern causes sequential scan     |
| Pagination             | Offset-based (`OFFSET n`), degrades at scale                                        |
| Distance hidden        | Cosine distance computed for ORDER BY but not SELECTed (face search does return it) |
| No sort param          | `SmartSearchDto` has no `order` field (unlike `MetadataSearchDto`)                  |
| Server-driven ordering | Frontend `GalleryViewer` is presentation-only, no client-side reorder               |

### Relevant Code Locations

| Component                      | File                                               | Lines   | Notes                                   |
| ------------------------------ | -------------------------------------------------- | ------- | --------------------------------------- |
| Smart search query             | `server/src/repositories/search.repository.ts`     | 343-358 | CTE + `<=>` operator                    |
| Metadata search (has order)    | same file                                          | 249-259 | `ORDER BY fileCreatedAt $dir`           |
| Search asset builder           | `server/src/utils/database.ts`                     | 348-488 | 80+ filters, no ORDER BY                |
| SmartSearchDto                 | `server/src/dtos/search.dto.ts`                    | 236-255 | No order field                          |
| MetadataSearchDto              | same file                                          | 168-229 | Has `order?: AssetOrder`                |
| AssetOrder enum                | `server/src/enum.ts`                               | 82-85   | `Asc` / `Desc`                          |
| Smart search table             | `server/src/schema/tables/smart-search.table.ts`   | —       | HNSW index, 512D, cosine ops            |
| Frontend search page           | `web/src/routes/(user)/search/.../+page.svelte`    | 145-149 | Routes to smart or metadata             |
| GalleryViewer                  | `web/src/lib/components/.../gallery-viewer.svelte` | —       | No reordering support                   |
| Face search (returns distance) | `search.repository.ts`                             | 371-405 | Existing pattern for returning distance |

---

## How Other Apps Handle This

| App                 | Approach             | Details                                                                                |
| ------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| **Google Photos**   | Hybrid two-tier      | "Top Results" by relevance, remainder chronological. No user toggle. Changed Sep 2024. |
| **Apple Photos**    | Always chronological | ML for filtering, but results always sorted by EXIF date                               |
| **PhotoPrism**      | No vector search     | Label-based search, sorted by date/name/size (9 sort options)                          |
| **LibrePhotos**     | Relevance only       | CLIP search, threshold ~0.27 cosine similarity, no date sort                           |
| **Immich upstream** | Relevance only       | Pure cosine distance, no sort toggle                                                   |

**Takeaway:** No app offers a user-facing relevance/date toggle. Google's two-tier approach is the most sophisticated in production. Nobody has "solved" this well.

---

## Approaches

### Approach 1: User-Selectable Sort Mode ⭐ Recommended

Add a sort dropdown to search UI: **Relevance** (default) / **Newest First** / **Oldest First**.

**Backend — Two-Phase CTE Query:**

```sql
WITH candidates AS (
  SELECT asset.*, smart_search.embedding <=> $embedding AS distance
  FROM asset
  INNER JOIN smart_search ON asset.id = smart_search."assetId"
  WHERE ... (all existing filters)
  ORDER BY distance
  LIMIT 500  -- recall budget
)
SELECT * FROM candidates
ORDER BY "fileCreatedAt" DESC
LIMIT $size + 1 OFFSET $offset;
```

- **Phase 1** (inner CTE): Uses vector index to recall top-N by similarity
- **Phase 2** (outer query): Re-sorts the recalled set by date

**Changes needed:**

1. Add `order?: AssetOrder` to `SmartSearchDto`
2. Modify `searchRepository.searchSmart()` — CTE when `order` specified, current behavior otherwise
3. Add sort dropdown to web search page
4. Regenerate OpenAPI specs + Dart client

**Assessment:**

| Dimension   | Rating    | Notes                                                             |
| ----------- | --------- | ----------------------------------------------------------------- |
| Complexity  | Low       | Single CTE wrapping existing query                                |
| Performance | Excellent | Vector index used in inner CTE, outer sort on 500 rows is trivial |
| UX value    | High      | Directly solves the #8377 request                                 |
| Risk        | Low       | Default behavior unchanged                                        |

**Trade-offs:**

- Hard cutoff at recall budget (500) — can't page beyond it in date-sorted mode
- Different total counts per sort mode (confusing UX — could show "~500 results" or hide total)
- Recall budget is arbitrary — too small misses relevant results, too large includes noise

---

### Approach 2: Google-Style Two-Tier Layout

Return results in two sections: "Top Results" (10-20 best by relevance) + "More Results" sorted chronologically.

**Implementation:** Same CTE, split response:

```typescript
{
  topResults: items.slice(0, 10),                      // distance ordering preserved
  moreResults: items.slice(10).sort(byDateDesc),       // re-sorted by date
}
```

**Assessment:**

| Dimension   | Rating    | Notes                             |
| ----------- | --------- | --------------------------------- |
| Complexity  | Medium    | New response DTO, two-section UI  |
| Performance | Excellent | Same CTE pattern                  |
| UX value    | High      | Familiar Google-like experience   |
| Risk        | Medium    | Breaking API change, more UI work |

**Trade-offs:**

- New `SearchResponseDto` structure (breaking change or new endpoint)
- Frontend needs two-section layout with different rendering
- Pagination boundary is awkward (where does page 2 start?)
- "Top Results" count is another magic number

---

### Approach 3: Adaptive Threshold with Stddev

Dynamically determine how many results are "relevant" per query using statistical analysis of distance distribution.

**Algorithm:**

```typescript
const results = await getTopN(500); // with distances
const topK = results.slice(0, 20);
const mean = avg(topK.map((r) => r.distance));
const stddev = std(topK.map((r) => r.distance));
const cutoff = mean + 1.5 * stddev;
const relevant = results.filter((r) => r.distance <= cutoff);
return relevant.sort(byDate);
```

**Why it adapts:**

- Specific query ("red Toyota in parking lot") → tight distance cluster → low stddev → few results
- Vague query ("things") → spread distances → high stddev → many results

**Assessment:**

| Dimension   | Rating | Notes                                                 |
| ----------- | ------ | ----------------------------------------------------- |
| Complexity  | Medium | Distance in SELECT, service-layer post-processing     |
| Performance | Good   | Fetches 500, returns variable count                   |
| UX value    | High   | "Smart" result count that feels right                 |
| Risk        | Medium | Magic numbers (1.5σ, K=20) need tuning per CLIP model |

**Trade-offs:**

- Must SELECT distance (minor change, face search already does this)
- Magic numbers (1.5 stddev multiplier, K=20 sample size) need empirical tuning
- Harder to paginate — total varies per query
- Can combine with Approach 1 (threshold first, then let user sort)

---

### Approach 4: Hybrid RRF (Reciprocal Rank Fusion)

Blend similarity rank with date rank using a standard IR technique.

```sql
WITH
  semantic AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY smart_search.embedding <=> $embedding) AS rank
    FROM asset INNER JOIN smart_search ... LIMIT 500
  ),
  recency AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY "fileCreatedAt" DESC) AS rank
    FROM asset WHERE id IN (SELECT id FROM semantic)
  )
SELECT id,
  $alpha / (60 + s.rank) + (1 - $alpha) / (60 + r.rank) AS score
FROM semantic s JOIN recency r USING (id)
ORDER BY score DESC;
```

**Assessment:**

| Dimension   | Rating | Notes                                       |
| ----------- | ------ | ------------------------------------------- |
| Complexity  | High   | Two CTEs + join + RRF formula               |
| Performance | Good   | Both CTEs on small sets                     |
| UX value    | Medium | Blended ranking is hard to explain to users |
| Risk        | Medium | k=60 constant and alpha need tuning         |

**Trade-offs:**

- Most complex query of all approaches
- Results are neither purely relevant nor purely chronological — harder to reason about
- Well-proven in IR literature but overkill for photo browsing
- Could expose alpha as "balance" slider for power users

---

### Approach 5: Expose Distance + Client-Side Sort

Return similarity score in the API response. Let the frontend sort within loaded pages.

**Assessment:**

| Dimension   | Rating     | Notes                                       |
| ----------- | ---------- | ------------------------------------------- |
| Complexity  | Low        | Add distance to SELECT and DTO              |
| Performance | Excellent  | No extra queries                            |
| UX value    | Low-Medium | Only sorts within loaded page, not globally |
| Risk        | Low        | Additive change                             |

**Trade-offs:**

- Only sorts within a single loaded page — cross-page sorting requires server
- Pagination becomes meaningless if client reorders
- Good as a building block (expose score) but not a standalone solution
- Power users would appreciate seeing relevance scores

---

## Recommended Implementation Path

### Phase 1: Two-Phase Sort (Approach 1)

Highest value, lowest risk. Add `order` param to `SmartSearchDto`, CTE query pattern, sort dropdown in UI.

**Recall budget:** 500 default. Could be made configurable via system settings later.

**Pagination in date-sorted mode:** Standard offset pagination within the 500 candidates. If user reaches end, show "showing top 500 most relevant results" rather than pretending there are no more.

### Phase 2: Adaptive Threshold (Approach 3) — Optional Enhancement

Add distance to SELECT and response. Implement stddev-based cutoff. Add "Auto" mode that thresholds then sorts by date. Makes recall budget self-adjusting.

### Phase 3: Score Exposure (Approach 5 element)

Add optional `score` field to response. Show relevance indicator in search UI. Enables future experimentation.

---

## Open Questions

1. **Should date-sorted mode show total count?** Capped at recall budget — could show "~500 results" or hide total.
2. **Sort by other fields?** Rating, filename? The CTE pattern supports any `ORDER BY` on the outer query.
3. **User-configurable recall budget?** Slider or "show more" button. Adds complexity.
4. **Mobile app sort toggle?** Same API change works, but needs mobile UI.
5. **Map view sort?** Map pins don't have a natural "sort" but could benefit from threshold (only show relevant pins).
6. **Interaction with existing filters?** Temporal filters + date sort is redundant but harmless. People filter + date sort is the primary use case from #8377.
