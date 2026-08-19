# PhotoGuesser — Solo Play Design

**Date:** 2026-08-19
**Status:** Design approved, spec under review
**Scope:** Single-player photo guessing on web and mobile, plus two measured performance fixes to the
existing space-scoped game.
**Builds on:** [Photo Guessing Game](./2026-08-15-photo-guessing-game-design.md) (PR #1000),
[Daily Challenge and Games Page](./2026-08-16-daily-challenge-and-games-page-design.md),
[Mobile Photo Guessing Game](./2026-08-18-mobile-photo-guessing-game-design.md)

## 1. What this is

PR #1000 ships a guessing game that only exists inside a shared space. To play, you must belong to a
space, and every challenge is a multiplayer artifact with a leaderboard.

**PhotoGuesser** is the same game played alone, reachable from the top-level navigation on both
clients. Same rounds, same scoring, same anti-leakage rules. What changes is the scope: the photo
pool is your own library rather than a space's, authorization is ownership rather than membership,
and the social layer (leaderboard, monthly standings) is replaced by personal stats.

The feature is named **PhotoGuesser**. It is a proper noun and is **not translated** — all nine
locale files carry the same literal, so the docs slug, marketing page, app copy, and URL agree.

## 2. Why the design looks like this

Three findings drove it. The first two came out of measurement against the reference personal
instance (62,235 timeline images, 30,212 with GPS, 27,227 surviving the face gate, SigLIP2 1152-dim
embeddings, `smart_search` at 757 MB against `shared_buffers` of 128 MB). The third came out of
reading the access layer.

| Finding                                                                                                 | Consequence                                                           |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| The shipped candidate query touches 3.7–3.9 GB of buffers and is **bimodal**: ~0.5 s warm, 14–19 s cold | The perf fix is not a solo-mode concern; it is a shipped defect       |
| Cost is independent of space size — the 1.3k space and the 56.5k space both scan all 62k assets         | The space scope is scan-and-test; stage 1 must be driven differently  |
| The CLIP ordering cannot use an index and scores every eligible candidate                               | Sample first, then rank the sample                                    |
| A 4,000-row sample keeps 91% of mean placeyness; worst drawn photo is top 1.1% of the library           | 4,000 is the knee of the quality/latency curve                        |
| The face gate removes only 9.9% of GPS photos (30,212 → 27,227)                                         | The CLIP gate is doing nearly all the work; noted, not acted on       |
| There is **no composable "assets user X may read" predicate** in the codebase                           | The solo pool must compose read arms explicitly, and gate them itself |
| Every existing read helper leaks a visibility class the game must exclude                               | The visibility clause lives outside the OR and is never inherited     |

`jit` was measured at +350–430 ms but is **already fixed** in production: the `gallery` role carries
`ALTER ROLE … SET jit = off` from migration `1783628194057-DisablePostgresJit`. All figures in this
document are measured with `jit = off`.

Caveat on generality: the reference instance runs `ViT-SO400M-14-SigLIP2__webli` at 1152 dimensions,
2.25× the bytes per row of the default `ViT-B-32__openai` at 512. A default install scans
proportionally less vector data. The _shape_ of the problem — full scan of every candidate's
embedding, bimodal on page-cache residency, and a scan-and-test space predicate whose cost ignores
space size — is model-independent.

## 3. Decisions

| Decision      | Choice                                                                                |
| ------------- | ------------------------------------------------------------------------------------- |
| Name          | PhotoGuesser — a proper noun, identical in all nine locales                           |
| Photo pool    | Own library always; partner and shared-space photos behind user toggles               |
| Shared albums | Excluded. No composable predicate exists, and no other listing surface includes them  |
| Visibility    | `visibility = 'timeline'` only — archived, hidden and locked are never eligible       |
| State         | Stored in the same tables, surfaced as personal history and stats                     |
| Daily         | A personal daily plus unlimited free play                                             |
| Placement     | Web: top-level sidebar after Map. Mobile: Library page card                           |
| Architecture  | Scope-agnostic core behind a `ChallengePool` strategy; `SpacePool` and `PersonalPool` |
| Generation    | Two-stage: seeded sample of 4,000, then face gate and CLIP ranking over the sample    |
| Perf fixes    | Folded into PR #1000 rather than shipped as a follow-up                               |

## 4. Performance: the two fixes

Both are independent of solo mode and both fold into PR #1000, which has not merged.

### 4.1 Two-stage candidate selection

The location-candidate query orders by `(embedding <=> notPlace) - (embedding <=> place)`. This
two-term expression cannot use `clip_index`, so the `LIMIT 200` is a top-N sort _after_ scoring every
eligible row. The shipped code justifies this as "acceptable here because the candidate set is
already scoped to one space" — a premise that is false for a large space and absent entirely for a
personal library.

Stage 1 selects a seeded sample using narrow columns only — no vectors, no face aggregate. Stage 2
applies the face gate and CLIP ranking to the sample and keeps the top 200. The expensive work
becomes bounded by the sample size instead of the library size.

Stage 2 also replaces the uncorrelated `LEFT JOIN (… GROUP BY assetId)` face aggregate — which
aggregates every visible face row in the database regardless of scope — with a correlated
`NOT EXISTS … HAVING`, scoping it to the sample. The two are logically equivalent: no faces produces
no group, a zero denominator produces `NULL > 0.05` which is `NULL`, and both cases keep the row.

### 4.2 Space-driven stage 1

`eligibleSpaceAsset` composes four correlated `EXISTS` arms, evaluated per asset across the whole
table. Driving stage 1 _from_ the space membership tables instead — a `UNION` of
`shared_space_asset`, the connected-library path, and the two album paths, joined back to `asset` —
makes cost proportional to the space rather than to the library.

### 4.3 Measured results

Warm timings, `jit = off`, on the reference instance.

| Query                                   | Data touched | Warm           | Cold         |
| --------------------------------------- | ------------ | -------------- | ------------ |
| current / big space (56.5k)             | 3.7 GB       | 490–532 ms     | 13.9 s       |
| big space, two-stage only               | 2.4 GB       | 203–240 ms     | 513 ms       |
| **big space, two-stage + space-driven** | **406 MB**   | **143–154 ms** | 169 ms       |
| current / solo whole library            | 3.9 GB       | 482 ms         | 17–19 s      |
| **solo whole library, two-stage**       | **400 MB**   | **117–154 ms** | ~3.6 s first |
| current / small space (1.3k)            | —            | 240–263 ms     | 397 ms       |

The cold column matters more than the warm one: it is the first game of the day, and it is the
experience users actually report.

### 4.4 Sample size

Measured over 8 seeds against 27,227 gated candidates, reporting the top 40 of the pool — the region
`selectLocationRounds`'s rank-biased draw actually reaches.

| Sample       | Mean placeyness | Worst photo's global rank | Warm       |
| ------------ | --------------- | ------------------------- | ---------- |
| full (today) | 0.1158          | 40                        | 482 ms     |
| 1,000        | 0.0965          | 1,693                     | 61 ms      |
| 2,000        | 0.1016          | 692                       | 88 ms      |
| **4,000**    | **0.1055**      | **302**                   | **117 ms** |
| 8,000        | 0.1094          | 150                       | 265 ms     |

**4,000 is the knee.** It retains 91% of the mean placeyness score and the worst photo the draw can
reach sits in the top 1.1% of the library. For calibration, the original spike validated the gate on
photos ranked in the top 37%.

The trade is real and should be stated plainly: the pool is the top 200 of a random 4,000 rather than
the global top 200, so it spans global ranks ~1–300 instead of ~1–200. It also _improves_
cross-challenge variety, which §7.1 of the original design explicitly worried about.

## 5. Architecture

`GameService` stops knowing what a shared space is. Candidate fetching and asset eligibility move
behind one interface:

```ts
interface ChallengePool {
  locationCandidates(limit: number, seed: string): Promise<GameCandidate[]>;
  dateCandidates(limit: number, seed: string): Promise<GameCandidate[]>;
  resolveRoundAsset(assetId: string): Promise<{ previewPath: string } | undefined>;
  recentlyUsedAssetIds(lookback: number): Promise<string[]>;
}
```

Two implementations: `SpacePool(spaceId)` and
`PersonalPool(userId, { withPartners, withSpaces })`. Each owns its own stage-1 driver, which is what
makes §4's fixes land as part of the structure rather than as a bolt-on.

Everything downstream is already scope-blind and is not touched: pool scale percentiles, spread
rules, round type mix, the scoring curve, round freezing, and answer withholding.

Two controllers, because the authorization models genuinely differ: the existing space routes gate on
membership, the new solo routes gate on ownership. Both delegate to the same service.

**Why not the alternatives.** Branching on a nullable scope inside `GameService` would grow an
already 870-line file toward ~1300 lines interleaving two concepts. Separate solo tables and a
separate service would duplicate the scoring, leakage, and round-image machinery, giving the
anti-leakage rules two implementations that can drift — the one thing the original design was most
careful about.

## 6. Schema

Folded into PR #1000's migration, since it has not merged.

```
game_challenge
  spaceId          uuid NULL          -- was NOT NULL
  ownerId          uuid NULL          -- new, FK user ON DELETE CASCADE
  includePartners  boolean NOT NULL DEFAULT false   -- frozen at generation
  includeSpaces    boolean NOT NULL DEFAULT false   -- frozen at generation
  CHECK (num_nonnulls("spaceId", "ownerId") = 1)

  UNIQUE (spaceId, dailyOn) WHERE spaceId IS NOT NULL AND dailyOn IS NOT NULL
  UNIQUE (ownerId, dailyOn) WHERE ownerId IS NOT NULL AND dailyOn IS NOT NULL
```

Three points that are load-bearing:

- **The second partial unique index is not optional.** Postgres treats NULLs as distinct in unique
  indexes, so once `spaceId` is nullable the existing index permits unlimited solo dailies for the
  same date. The lazy-generation race that index exists to lose would start winning twice, producing
  divergent dailies for one user.
- **The source toggles are frozen onto the row**, for the same reason `scaleKm` and `scaleDays` are.
  If a daily is generated with partner photos included and the user then switches partners off,
  re-resolving eligibility from live settings would 404 every round image mid-game.
- **Both partial indexes need `INSERT INTO migration_overrides` rows**, with payloads matched
  verbatim and generated via sql-tools. Without them the schema-drift check fails.

`ownerId` cascades on user deletion because a solo challenge is personal and has no other
stakeholder. `createdById` keeps its existing `ON DELETE SET NULL`, which exists so that deleting a
user does not destroy other members' guesses in a shared space.

## 7. Eligibility and the visibility invariant

One helper, with the visibility clause **outside** the OR so that no read arm can widen it:

```
AND deletedAt IS NULL
AND type = 'IMAGE'
AND visibility = 'timeline'          -- excludes archive, hidden, locked
AND (   ownerId = :userId
     OR  <partner arm>   if withPartners    -- partner.sharedWithId = me, inTimeline = true
     OR  <4 space paths> if withSpaces      -- spaceAssetPathBranches({ memberUserId })
    )
```

This is deliberately not composed from the existing read helpers, each of which admits a visibility
class the game must exclude:

| Helper                                                   | Leak                                                  |
| -------------------------------------------------------- | ----------------------------------------------------- |
| `spaceVisibilityGate` (`shared-space-album-scope.ts:41`) | `visibility IN (archive, timeline)` — admits archived |
| `checkPartnerAccess` (`access.repository.ts:250`)        | `visibility IN (timeline, hidden)` — admits hidden    |
| `checkAlbumAccess` (`access.repository.ts:192`)          | no visibility clause at all — admits locked           |

The same predicate is re-run in `resolveRoundAsset`, so access revoked mid-game 404s the image while
the round remains scoreable from its denormalised answer — the contract the space game already has
for a photo removed from a space.

The partner arm respects `inTimeline`, matching timeline and search rather than map.

**Shared albums are excluded.** No composable predicate exists for `album_user`; the authoritative
definition of read access (`utils/access.ts:116`) is an id-list checker, unusable as a candidate-pool
`WHERE` clause. No other listing surface — timeline, search, map, memories, folders, people —
includes them either. Including them would mean authoring a new predicate in the most
access-sensitive code in the repository for the pool with the weakest product justification.

## 8. Endpoints and permissions

Every game route in PR #1000 is `@Authenticated({ permission: Permission.SharedSpaceRead })`. That is
wrong for solo play: an API key scoped to shared spaces should not be required to play alone. Since
the PR has not shipped, introduce `Permission.GameRead` / `GameCreate` / `GameDelete` and apply them
to **all** game routes. Membership and ownership checks stay in the service, where they already are.
The API-key scope and the ACL are different layers, and the current conflation is a latent smell.

```
POST   /games/solo                start free play  { roundCount, type, sources }
GET    /games/solo/daily          today's daily, generated on first read
GET    /games/solo/history        finished games, newest first, paged
GET    /games/solo/stats          streak, best, average, played
GET    /games/:id                 unchanged — auth branches on scope
POST   /games/:id/rounds/:i/guess unchanged
GET    /games/:id/rounds/:i/image unchanged
DELETE /games/:id                 unchanged
```

## 9. Daily, stats, and retention

The personal daily is keyed to the **UTC calendar day**, the same boundary the space daily uses and
the same one `dailyKeyFor` already implements on mobile. It is generated lazily on first read.

Stats are computed, never stored, so they cannot drift from their inputs:

- **current / best streak** — consecutive UTC `dailyOn` dates with a completed daily
- **best score, average, games played** — from the guess totals

Retention: a solo game is about 11 rows, so a daily every day costs roughly 4,000 rows per user per
year. Games are kept indefinitely — history and stats need them, and nothing browses a list that
could become cluttered.

The one exception is a challenge that was generated but **never played at all**: zero `game_guess`
rows and `createdAt` older than 7 days. Those are pruned on the existing nightly job. The rule is
deliberately "zero guesses" rather than "not finished": a partially played game still contributes a
real score to history and stats, and pruning it would silently rewrite numbers the player has already
seen. Unplayed dailies accumulate on their own for anyone who enables the daily and then stops
playing, which is exactly what this clears.

## 10. Source toggles are a server-side preference

The daily is generated lazily on first read, so the server must know the source toggles at that
moment. If they live in browser local storage, two devices race to generate different dailies and the
unique index picks a winner arbitrarily.

So the toggles are user preferences —
`preferences.photoGuesser.includePartners` / `.includeSpaces` — on the existing user-preferences DTO,
alongside `people` and `sharedLinks`. Free play may override per-game in the request body; the daily
always reads the preference and freezes the result onto the row.

Default is **own library only**. The wider pool is opt-in.

## 11. Web

- **Nav.** `SidebarNavItem` between Map and People, using the existing outline/filled convention
  (`mdiMapMarkerQuestionOutline` / `mdiMapMarkerQuestion`). No preference gate.
- **Routes.** `/photoguesser` (landing) and `/photoguesser/[challengeId=id]` (play), with
  `Route.photoGuesser()` and `Route.viewPhotoGuesserGame()` helpers.
- **Reused unchanged:** `location-round`, `date-round`, `round-result`, `round-photo`,
  `challenge-create-panel` (extended with the source toggles).
- **Not reused:** `game-leaderboard`, `standings-section` — multiplayer only.
- **New:** `solo-stats.svelte`, `solo-history.svelte`.

**One targeted extraction.** The space play page is 255 lines of play machinery ending in a
leaderboard. That machinery moves into a `game-play.svelte` that takes the end-of-game panel as a
snippet: the space route passes a leaderboard, the solo route passes a score summary with "play
again". One play loop and one set of leakage behaviours, two endings.

## 12. Mobile

- Library page card → a new `PhotoGuesserPage` route.
- `game_play.page.dart` moves from `pages/library/spaces/games/` to `pages/games/`; it is no longer
  space-only. auto_route regenerates `router.gr.dart`.
- **The daily reminder starts working for users with no shared spaces.**
  `dailyReminderOccurrences` gates on `hasOptedInSpace`, so today those users can never be reminded.
  That becomes `hasOptedInSpace || soloDailyEnabled`. `dailyLastPlayed` is already a single global UTC
  date and needs no change — it was written for exactly this.
- Notification destination: the solo daily when enabled, otherwise the existing space route. One
  notification, one unambiguous tap.

## 13. i18n

`PhotoGuesser` is a proper noun and carries the same literal in all nine locales — `de`, `fr`, `it`,
`nl`, `pl`, `es`, `ru`, `zh_Hans`, `zh_Hant`. Translating it would give the feature a different name
per language and break agreement with the docs slug, marketing page, and URL.

New keys are needed for the stats labels, history, source toggles, free play, play again, and the
empty states. All nine locales in the same commit, alphabetically sorted, formatted with
`npx prettier --write i18n/*.json`.

## 14. Testing

### 14.1 Leakage — where the archived/locked constraint is enforced

The existing e2e asserts an unguessed round leaks no coordinates, date, asset id, or filename. That
extends to solo, plus one case per way the wider pool could admit something it should not:

| Case                                                   | Why it is the case that could slip through                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Own asset, `visibility = archive`                      | The one users hit most; archived is the "not in my timeline" bucket              |
| Own asset, `visibility = locked`                       | Locked folder — the most sensitive class in the product                          |
| Own asset, `visibility = hidden`                       | Live/motion photo video parts                                                    |
| **Locked asset in an album linked to a space I am in** | `spaceAlbumAssetExists` is an arm we _do_ use, and it carries no visibility gate |
| **Archived asset in a shared space**                   | `spaceVisibilityGate` admits `archive` by design                                 |
| Partner asset with `inTimeline = false`                | The partner arm must respect `inTimeline`, unlike `checkPartnerAccess`           |
| Partner asset with `visibility = hidden`               | `checkPartnerAccess` admits `hidden`                                             |
| Asset shared with me only via `album_user`             | That arm is deliberately excluded from the pool entirely (§7)                    |

The two bolded rows are the ones that matter most: they exercise arms the predicate genuinely uses,
whose upstream helpers would admit the asset on their own. The rest are regression guards.

Plus: after a partner revokes sharing mid-game, the round image 404s while the round stays scoreable.

### 14.2 Other coverage

- **Server unit** — one suite per `ChallengePool` implementation.
- **Server medium** — both partial unique indexes reject a second daily. This is the constraint a
  nullable `spaceId` quietly breaks, so it must be proven against a real Postgres.
- **Perf guard** — assert stage-1 SQL does not reference `smart_search`. One cheap structural
  assertion, and it is what stops someone silently reintroducing the 14-second path.
- **Web** — vitest for the landing page, stats, history, and the create panel's source toggles, plus
  page-load tests. Assertions must be able to fail: prefer `getBy` over `queryBy` for presence.
- **Mobile** — widget tests, each proven red by flipping the condition under test before being
  committed green.

## 15. Out of scope

- Shared-album photos in the pool (§7).
- Themed pools — by album, year, person, or place. The `ChallengePool` interface is the extension
  point; a themed pool is a third implementation rather than a rewrite.
- Live synchronous play, still deferred from the original design.
- An admin feature flag. The space game has none, and solo adds a nav row for every user.
- Marketing and README work. The upstream-comparison section and the marketing site need a
  PhotoGuesser entry in seven locales via the `launch-new-feature` flow. Real, but launch work rather
  than part of this change.

## 16. Open questions

1. **`PersonalPool` stage 1 with the toggles enabled is unmeasured.** All figures in §4 are
   own-library-only, where `ownerId` is indexed. With `withPartners` or `withSpaces` on, the OR arms
   defeat that index, and stage 1 likely needs to become a `UNION` of three id sources — the same
   lesson `SpacePool` taught. Measure before settling the query shape.
2. **The face gate removes only 9.9% of GPS candidates** on the reference library. The original design
   treats the two gates as complementary and load-bearing; the measurement suggests CLIP is doing
   nearly all the work. Not acted on here, but worth revisiting with a broader sample than the 54
   images used in the original spike.
3. **The sidebar icon** (`mdiMapMarkerQuestionOutline`) leans toward location, while the game is
   equally about dates. A better icon would be welcome; this is a cosmetic swap.
