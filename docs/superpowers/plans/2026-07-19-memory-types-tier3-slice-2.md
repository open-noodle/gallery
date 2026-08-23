# Slice 2 — `video_moments` memory type (end-to-end)

Spec: `docs/plans/2026-07-19-memory-types-tier3-spec.md` §3.1, §4.3, §6.6, §6.7, Slice 2.
Depends on Slice 1 (`type`/`duration` on `MemoryPeriodAsset`, `type` filter) — already committed.

This is the **pattern-setter** for registering a memory type. Slices 5 and 7 repeat this shape.

## Part A — the rule (TDD)

### A1. RED — `server/src/services/memory-rules/video-moments.rule.spec.ts` (new)

Model the file on the existing `month-recap.rule.spec.ts` (same fixture/mock style). Fixtures build
`MemoryPeriodAsset[]` literals — remember `type` and `duration` are now **required** fields.

Cases (all from spec §6.6 — every one must be present):

1. **Trigger day** — returns `[]` on days 1, 7, 9, 15, 22; fires on day 8.
2. **Fires** — pinned `title` `'Video moments from July 2023'`, `subtitle`, `dedupeKey`
   `'video_moments:2023-07'`, `visibleForDays: 5`, `ruleId: 'video_moments'`.
3. **Worked score = 94** — 9 in-band videos, 3 favourites, `Y=2023`, `target.year=2026` ⇒
   `60 + min(9,15)*2 + min(3,10)*3 + max(0,10-3)` = `60+18+9+7` = **94**. Pin this exact number.
4. **Duration band** — `2_999` excluded, `3_000` included, `180_000` included, `180_001` excluded,
   `null` excluded.
5. **MIN_ASSETS boundary pair** — 2 survivors ⇒ `[]`; exactly 3 ⇒ fires.
6. **Selection (given/when/then)** — _Given_ 4 favourites and 10 non-favourites in band, _Then_
   `assetIds` equals a **pinned array**: all 4 favourite ids plus 4 evenly-spaced non-favourite ids,
   sorted chronologically. Compute the expected `pickEvenlySpaced(others, 4)` indices by hand
   (`Math.round(i*(n-1)/(count-1))` for n=10,count=4 ⇒ indices 0,3,6,9) and pin those ids.
7. **Favourites exceed cap** — 12 favourites ⇒ exactly 8 ids, evenly spaced.
8. **Favourite bonus capped** — 20 favourites and 10 favourites yield the **same** score.
9. **`count`/`favoriteCount` are pre-selection** — 12 in-band videos ⇒ subtitle says `12 videos`
   even though `assetIds.length === 8`.
10. **Pluralization** — `1 video` vs `6 videos`.
11. Skips current and future years; caps candidates at `MAX_YEARS` (3).
12. **Passes `type: AssetType.Video`** to the repository — assert the mock call argument.
13. **Zero assets** — empty repository result ⇒ `[]`, no throw (guards `medianTime([])`).

Run: `cd server && pnpm test --run src/services/memory-rules/video-moments.rule.spec.ts`
**Expected red:** module not found / all cases fail. Capture the output.

> ⚠️ Use `pnpm test --run <path>` — NOT `pnpm test -- --run <path>`. This pnpm version passes the
> literal `--` to vitest, which silently drops the path filter and runs the whole suite.

### A2. GREEN — `server/src/services/memory-rules/video-moments.rule.ts` (new)

Follow spec §4.3 exactly. Structure mirrors `month-recap.rule.ts`.

**Export the constants** (spec D8 — module-level `export const`, not private statics):
`TRIGGER_DAY = 8`, `MIN_DURATION_MS = 3_000`, `MAX_DURATION_MS = 180_000`, `MIN_ASSETS = 3`,
`MAX_YEARS = 3`, `ASSET_CAP = 8`, `VISIBLE_FOR_DAYS = 5`, `MAX_FAVORITE_BONUS = 10`,
`SCORE_BASE = 60`.

```ts
export class VideoMomentsMemoryRule implements MemoryRule {
  readonly id = 'video_moments';
  constructor(private assetRepository: Pick<AssetRepository, 'getMemoryAssetsForPeriod'>) {}
  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> { ... }
}
```

Algorithm (§4.3): trigger-day guard → `getMemoryAssetsForPeriod({ months: [target.month],
type: AssetType.Video, takenBefore: target.endOf('day').toJSDate() })` → bucket by year, drop
`year >= target.year` → band filter → skip `< MIN_ASSETS` → selection → candidate.

Selection (exact):

```ts
const favourites = survivors.filter((a) => a.isFavorite).sort(byTime);
const others = survivors.filter((a) => !a.isFavorite).sort(byTime);
const selected =
  favourites.length >= ASSET_CAP
    ? pickEvenlySpaced(favourites, ASSET_CAP)
    : [...favourites, ...pickEvenlySpaced(others, ASSET_CAP - favourites.length)];
// then sort `selected` chronologically for assetIds
```

`count` = band survivors for the year (pre-selection). `favoriteCount` = favourite survivors
(pre-selection). Reuse `pickEvenlySpaced`, `medianTime`, `monthName`, `recencyBonus` from
`curation.util`. Sort candidates by score desc, `.slice(0, MAX_YEARS)`.

## Part B — register the type at all 16 sites

Exactly **one** new key: `video_moments`, appended **last** in registry order.

| Site | File                                                           | Change                                                                                                                                                 |
| ---- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `server/src/services/memory-rules/memory-type.metadata.ts`     | append `{ key: 'video_moments', kind: 'rule', defaultEnabled: true, adminConfigurable: true }`                                                         |
| 2    | `.../memory-type.metadata.spec.ts`                             | append to **all three** lists: the full metadata array (~line 28), the `MEMORY_TYPE_KEYS` array (~line 48), and `buildDefaultMemoryTypeMap` (~line 63) |
| 3    | `.../memory-type.registry.ts`                                  | `video_moments: (deps) => new VideoMomentsMemoryRule(deps.assetRepository)`                                                                            |
| 4    | `.../memory-type.registry.spec.ts`                             | add an id-parity case. The completeness guard uses `ruleKeys.length` (derived) so it needs no manual count change — verify it still passes             |
| 7    | `server/src/utils/preferences.spec.ts`                         | default `memories.types` gains `video_moments: true`                                                                                                   |
| 8    | `server/src/services/server.service.spec.ts`                   | **BOTH** assertions: line ~196 and line ~220                                                                                                           |
| 10   | `e2e/src/specs/server/api/server.e2e-spec.ts`                  | `availableMemoryTypes` fixture (~line 148)                                                                                                             |
| 11   | `web/src/routes/admin/system-settings/MemoriesSettings.svelte` | `memoryTypeKeys` array (line 12)                                                                                                                       |
| 12   | `.../MemoriesSettings.spec.ts`                                 | switch count **and** the full `types` object literal in the save-payload test (~lines 92-107)                                                          |
| 13   | `i18n/en.json`                                                 | 4 keys (below)                                                                                                                                         |
| 14   | `docs/docs/features/memories.md`                               | add to the user-facing type list                                                                                                                       |
| 15   | `docs/docs/install/config-file.md`                             | add to the `memories.types` keys                                                                                                                       |
| 16   | `docs/plans/2026-07-15-memory-types-roadmap.md`                | row #11 Status → **Shipped** — `video_moments`                                                                                                         |

Expected `availableMemoryTypes` after this slice (**9** entries, registry order):

```
on_this_day, birthday, recent_trip, month_recap, favorites_throwback,
on_this_day_place, season_recap, people_together, video_moments
```

i18n keys (`i18n/en.json`, EN only — keep the file's existing alphabetical ordering within its
sections):

```
"memory_type_video_moments": "Video moments"
"memory_type_video_moments_description": "Videos you filmed in this month of a past year."
"admin.memory_type_video_moments_setting": "Video moments"
"admin.memory_type_video_moments_setting_description": "Surface videos from this month in a past year."
```

Note `admin.*` keys live nested under the `admin` object in `en.json` — match the existing
`memory_type_people_together` entries' placement exactly.

## Verification

```bash
cd server && pnpm test --run src/services/memory-rules/          # all green incl. new spec
cd server && pnpm test --run src/utils/preferences.spec.ts src/services/server.service.spec.ts
cd server && pnpm run check                                      # tsc --noEmit
cd server && npx prettier --check "src/services/memory-rules/**"
cd web && pnpm test --run src/routes/admin/system-settings/MemoriesSettings.spec.ts
npx prettier --check "docs/**/*.md" "i18n/en.json"               # from worktree root
```

`make check-server` does NOT exist in this repo (the Makefile has stubs) — use `cd server && pnpm run check`.

## Out of scope

No medium test (Slice 8). No `trip_anniversary`/`themed`. No mobile change (Slice 3).

## Commit

`feat(memories): add video_moments memory type`
