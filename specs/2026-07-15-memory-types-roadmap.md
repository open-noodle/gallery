# Memory Types Roadmap

> Living tracker for new Gallery "memory" types layered on top of the fork's rule engine.
> Created 2026-07-15. Update the **Status** column as tiers ship.

## Background

Gallery extends Immich's memories with a rule engine. Each memory type beyond the
original `on_this_day` is a `MemoryRule` in `server/src/services/memory-rules/` that
implements `evaluate({ ownerId, target }) → MemoryRuleCandidate[]`. Candidates carry a
`title`, `subtitle`, `score`, `assetIds`, `dedupeKey`, and `memoryAt`. The service:

- runs every rule once per day per user (catching up from `lastRuleDate` → today),
- sorts all candidates by `score` descending,
- de-duplicates by `dedupeKey` and by `hasRuleMemory(ownerId, ruleId, dedupeKey)` (a
  given memory is only ever inserted once),
- inserts up to `RULE_DAILY_LIMIT` (currently **6**) rule memories per day.

Registering a new type is two lines: an entry in `MEMORY_TYPE_METADATA`
(`memory-type.metadata.ts`) and a factory in `RULE_FACTORIES`
(`memory-type.registry.ts`). Everything downstream — admin availability, per-user
toggles, `availableMemoryTypes`, and the visibility filter — derives from the registry.

**Cross-cutting facts** that apply to every idea below:

- **Titles/subtitles are English strings baked into each rule server-side** (same as the
  existing `birthday`/`recent_trip` rules). Localizing memory _content_ is out of scope;
  only settings _labels_ are localized.
- Adding rules **increases competition for the daily slots** — weak candidates simply
  lose on score. This is by design. `RULE_DAILY_LIMIT` is the tuning knob if the surface
  ever feels starved; it was raised from 2 to 6 once the multi-day recaps landed, since
  four lingering windows could otherwise crowd out the date-anchored 1-day rules.
- The **admin settings list is hardcoded** (`memoryTypeKeys` in
  `MemoriesSettings.svelte`); user settings auto-derive from `availableMemoryTypes`.
  Every new type needs 4 i18n keys (admin label+desc, user label+desc) in `en.json`.

## Ranked idea menu

Effort is relative to the rule engine: 🟢 reuses existing queries · 🟡 one new moderate
SQL query · 🟠 new query + data-model work · 🔴 ML / embeddings / new infra.

### 🟢 Tier 1 — Very easy (shipped)

| #   | Idea                    | Surfaces                                            | Effort | Impact      | Status                              |
| --- | ----------------------- | --------------------------------------------------- | ------ | ----------- | ----------------------------------- |
| 1   | Favorites throwback     | `isFavorite` photos from this month in a past year  | 🟢     | High        | **Shipped** — `favorites_throwback` |
| 2   | This month, X years ago | All photos from this calendar month in a past year  | 🟢     | High        | **Shipped** — `month_recap`         |
| 3   | On this day, in a place | On-this-day photos dominated by one city → labelled | 🟢/🟡  | Medium-high | **Shipped** — `on_this_day_place`   |
| 4   | Season recap            | Photos from a past meteorological season            | 🟢/🟡  | Medium      | **Shipped** — `season_recap`        |

Spec: [`2026-07-15-memory-types-tier1-spec.md`](./2026-07-15-memory-types-tier1-spec.md)

### 🟡 Tier 2 — Easy (planned)

| #   | Idea                    | Surfaces                                                 | Effort | Impact     | Notes                                                                                |
| --- | ----------------------- | -------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------ |
| 5   | You & [person]          | Two named people who co-occur often                      | 🟡     | High       | **Shipped** — `people_together` (reframed to a pair, month-anchored)                 |
| 6   | Trip anniversary        | A _past_ trip resurfaced on its anniversary              | 🟡     | High       | **Shipped** — `trip_anniversary`                                                     |
| 7   | Themed / classification | "Sunsets", "Food", "Beach days" from auto-classification | 🟡     | High       | **Shipped** — `themed` (reframed onto smart-search CLIP embeddings, not `tag_asset`) |
| 8   | Shot on [camera/lens]   | Gear nostalgia grouped by `make`/`model`                 | 🟡     | Low-medium | Niche; photographers only                                                            |

Spec (#5): [`2026-07-16-memory-types-tier2-people-together-spec.md`](./2026-07-16-memory-types-tier2-people-together-spec.md)

### 🟠 Tier 3 — Medium (planned)

| #   | Idea                     | Surfaces                                           | Effort | Impact         | Notes                                                                              |
| --- | ------------------------ | -------------------------------------------------- | ------ | -------------- | ---------------------------------------------------------------------------------- |
| 9   | Someone you haven't seen | A person whose most-recent photo is > N months old | 🟠     | High but risky | **Shipped** — `person_throwback` (reframed: gap is a silent selector, never shown) |
| 10  | Your pet [name]          | Leverages Gallery's pet detection                  | 🟠     | High           | Fork differentiator; needs a look at how pets are stored                           |
| 11  | Video moments            | Memorable videos, not just stills                  | 🟠     | Medium         | **Shipped** — `video_moments`                                                      |

### 🔴 Tier 4 — Hard (north star)

| #   | Idea                     | Surfaces                                                    | Effort | Impact    | Notes                                                                                                                                                                                                                                           |
| --- | ------------------------ | ----------------------------------------------------------- | ------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12  | Semantic themes (CLIP)   | "Time in nature", "City lights" with no tag, via embeddings | 🔴     | Very high | The real Apple/Google magic; keep the rule interface plug-ready. Note: `themed` (PR #812) already rides smart-search CLIP embeddings — the remaining work here is vocabulary breadth and `themeMaxDistance` calibration, not new infrastructure |
| 13  | "Best of" aesthetic rank | Auto-picks your most beautiful shots                        | 🔴     | High      | Needs an aesthetic-scoring model (none today)                                                                                                                                                                                                   |
| 14  | Named trip stories       | Full trip recap with map + day-by-day route                 | 🔴     | High      | A feature, not a rule                                                                                                                                                                                                                           |

## Sequencing

1. **Now:** Tier 1 (#1–#4) — near-zero-risk pure-reuse rules that keep the memories
   surface populated (empty surface = dead feature).
2. **Fast follow:** #5 You & [person], #6 Trip anniversary — highest emotional payoff for
   modest query work.
3. **Spike next:** #7 Themed (gate on classification quality), #10 Pet (data-model look) —
   the differentiators worth designing carefully.
4. **North star:** #12 Semantic themes. Keep `MemoryRule` shaped so an embedding-backed
   rule plugs in without engine changes.
