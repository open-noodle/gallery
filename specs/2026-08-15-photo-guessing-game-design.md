# Photo Guessing Game — Design

**Date:** 2026-08-15
**Status:** Design approved, spec under review
**Scope:** A multiplayer guessing game inside Gallery, played on a shared space's photos. Web only.

## 1. What this is

A GeoGuessr-style game built into Gallery. A challenge is a fixed set of rounds; each round shows one
photo and asks a question about it. Members of a shared space play the same round set on their own
time and land on a shared leaderboard.

Two round types ship in v1:

- **Location** — the player drops a pin on a map. Score falls off with great-circle distance to the
  photo's GPS coordinates.
- **Date** — the player picks a point on a timeline. Score falls off with the offset from the photo's
  capture date.

## 2. Why the design looks like this

Every significant decision below came out of a measurement spike against a real 62,235-photo library,
not from assumption. The findings that shaped the design:

| Finding                                                                                    | Consequence                                                        |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 48.5% of photos have GPS; 100% have a date                                                 | Date rounds keep a challenge playable when location can't          |
| Geography is not as clustered as feared — median 595 km from home, 15 countries            | Location rounds have real raw material                             |
| Naive sampling already yields 3.2 countries per 5-round set; only 3% single-country        | Spread rules are polish, not rescue — keep them cheap              |
| Naive sampling produces 1.24 answer-pairs under 50 km apart per set                        | A minimum-separation rule is the one spread rule that earns itself |
| **Most photos are people-centric — the place is background behind a face**                 | A scene gate is mandatory, not optional                            |
| 62% of GPS photos have no detected face; the one multi-member space has 0%                 | A space-only pool is thin — date rounds must carry it              |
| Face-area filtering passes indoor kitchens and bookshelves                                 | Face filtering alone is insufficient; CLIP gate needed             |
| CLIP + face gates are complementary — each catches what the other misses                   | Both gates, composed                                               |
| A fixed scoring constant collapses on narrow libraries (20-point spread on a city library) | Scoring scale must derive from the pool                            |
| Bounding-box diagonal is destroyed by five outlier photos                                  | Scale must be a robust percentile, never min/max                   |

## 3. Decisions

| Decision         | Choice                                                                        |
| ---------------- | ----------------------------------------------------------------------------- |
| Audience         | Members of a shared space — the space supplies the roster and the leaderboard |
| Play model       | Asynchronous: one shared round set, each player plays on their own time       |
| Round types      | Location and date, both in v1                                                 |
| Fairness         | No ownership handling — everyone plays every photo, own uploads included      |
| Round generation | Server-sampled under spread rules, gated for guessability                     |
| Scoring          | Exponential decay whose scale derives from the challenge pool                 |
| Platform         | Responsive web only (SvelteKit); no Flutter client in v1                      |
| Architecture     | In-tree fork feature — new files only, fork-owned migrations                  |

**Live synchronous play is explicitly out of scope for v1**, but the round-set model is chosen so that
adding it later is an addition rather than a rewrite: all players share one immutable round set, so a
live lobby only needs presence and timers layered on top.

## 4. Architecture

An in-tree fork feature, following the shape of `shared-space.service.ts` and
`classification.service.ts`. Everything is new files, so the rebase conflict surface is near zero. The
only upstream coupling is reading `asset`, `asset_exif`, `asset_face`, and `smart_search`.

### 4.1 Schema

Three tables. Migration goes in `server/src/schema/migrations-gallery/` with timestamp
`1791000000000`; table definitions in `server/src/schema/tables/`.

**`game_challenge`**

| Column                                 | Type         | Notes                                        |
| -------------------------------------- | ------------ | -------------------------------------------- |
| `id`                                   | uuid PK      |                                              |
| `spaceId`                              | uuid FK      | → `shared_space`, `ON DELETE CASCADE`        |
| `createdById`                          | uuid FK      | → `user`                                     |
| `name`                                 | varchar      | Human label, defaulted at creation           |
| `roundCount`                           | integer      | Denormalised for leaderboard maths           |
| `scaleKm`                              | double       | Location scoring scale, frozen at generation |
| `scaleDays`                            | integer      | Date scoring scale, frozen at generation     |
| `closedAt`                             | timestamptz? | Null while open                              |
| `createdAt` / `updatedAt` / `updateId` |              | Standard fork columns                        |

**`game_round`**

| Column        | Type         | Notes                                       |
| ------------- | ------------ | ------------------------------------------- |
| `id`          | uuid PK      |                                             |
| `challengeId` | uuid FK      | → `game_challenge`, `ON DELETE CASCADE`     |
| `index`       | integer      | 0-based; `UNIQUE (challengeId, index)`      |
| `type`        | varchar      | `location` \| `date`                        |
| `assetId`     | uuid FK      | → `asset`, `ON DELETE SET NULL` — see below |
| `answerLat`   | double?      | Denormalised at generation                  |
| `answerLon`   | double?      | Denormalised at generation                  |
| `answerDate`  | timestamptz? | Denormalised at generation                  |

`assetId` is nullable with `ON DELETE SET NULL`, and the answer columns are **denormalised copies**
rather than joins. This is deliberate: if an asset is deleted or its EXIF edited mid-challenge,
already-submitted scores must stay stable and comparable. A round whose asset has gone is still
scoreable for players who already saw it, and is skipped for those who have not.

**`game_guess`**

| Column                  | Type         | Notes                                    |
| ----------------------- | ------------ | ---------------------------------------- |
| `id`                    | uuid PK      |                                          |
| `roundId`               | uuid FK      | → `game_round`, `ON DELETE CASCADE`      |
| `userId`                | uuid FK      | → `user`, `ON DELETE CASCADE`            |
| `guessLat` / `guessLon` | double?      | Location rounds                          |
| `guessDate`             | timestamptz? | Date rounds                              |
| `distanceKm`            | double?      | Computed at submission                   |
| `offsetDays`            | integer?     | Computed at submission                   |
| `score`                 | integer      | Computed at submission, never recomputed |
| `createdAt`             | timestamptz  |                                          |

`UNIQUE (roundId, userId)` — one guess per player per round, and it is final.

### 4.2 Server

- `server/src/services/game.service.ts` — extends `BaseService`; challenge lifecycle, round
  generation, guess submission, leaderboard.
- `server/src/repositories/game.repository.ts` — Kysely queries, `@GenerateSqlQueries` decorated.
- `server/src/controllers/game.controller.ts` — HTTP surface.
- `server/src/dtos/game.dto.ts` — request/response DTOs.
- `server/src/utils/game-scoring.ts` — pure scoring and sampling functions, unit-testable without a DB.

### 4.3 Endpoints

| Method | Path                             | Purpose                                              |
| ------ | -------------------------------- | ---------------------------------------------------- |
| POST   | `/shared-spaces/:spaceId/games`  | Create a challenge; generates and freezes its rounds |
| GET    | `/shared-spaces/:spaceId/games`  | List challenges with the caller's progress           |
| GET    | `/games/:id`                     | Challenge detail, answers withheld (see §6)          |
| GET    | `/games/:id/rounds/:index/image` | The round photo, re-encoded and stripped             |
| POST   | `/games/:id/rounds/:index/guess` | Submit a guess; returns score and the answer         |
| GET    | `/games/:id/leaderboard`         | Per-player totals                                    |
| DELETE | `/games/:id`                     | Delete a challenge; cascades rounds and guesses      |

All endpoints require space membership, enforced through the existing access layer.

**Creating and deleting a challenge require the space-editor role**; playing one requires only
membership. This reuses the existing editor gate — the same check that governs who may edit a space's
people and albums (`SharedSpaceApiRepository.isSpaceEditor` on the client, the server-side role check
in `shared-space.service.ts`). Viewers can play every challenge but cannot create or remove one.

### 4.4 Web

Routes under `web/src/routes/(user)/spaces/[spaceId]/games/`, following the existing space route
structure. The map uses `maplibre-gl` / `svelte-maplibre`, both already dependencies. The layout is
responsive by requirement — a phone browser is the expected device.

## 5. The photo pool

**The pool is the space's own assets, and nothing else.** A challenge draws only from photos already
shared into the space, so the game never shows anyone a photo they could not already open in Gallery.
Playing a game grants no visibility that space membership did not already grant. This is a deliberate
constraint, chosen over a wider pool.

It has a real cost, and the design absorbs it rather than hiding it. In the reference library the only
multi-member space held 1,076 GPS photos, of which roughly 95 survived scene filtering, across 5
countries — enough for about 19 non-repeating five-round location sets, and skewed. Three consequences
follow:

- **Date rounds carry the game in thin spaces.** Every asset in a space is eligible for a date round,
  so the type mix (§7.4) shifts toward date as location candidates run out. A space with no GPS at all
  still yields a playable challenge.
- **Repeat avoidance matters more.** With a small pool, generation must actively avoid assets used by
  recent challenges in the same space, or the third challenge is the first one again.
- **Adding photos to the space makes the game better.** That is the correct incentive, and it is worth
  surfacing in the UI when a challenge comes out short.

Candidates are always filtered to `visibility = 'timeline'`, `deletedAt IS NULL`, `type = 'IMAGE'`.
Archived, hidden, and locked assets are never eligible.

## 6. Preventing answer leakage

A round is worthless if the answer is a right-click away. Four rules:

1. **Round images are served re-encoded**, stripped of EXIF, through
   `/games/:id/rounds/:index/image`. The original file is never served.
2. **The endpoint is keyed by challenge and round index**, never by asset ID. The response carries no
   asset identifier, so a round cannot be resolved back to `/api/assets/:id`.
3. **Answers are withheld until the player has guessed.** `GET /games/:id` returns answer fields only
   for rounds where a `game_guess` row already exists for the caller. This is enforced in the service,
   not the client.
4. **Filenames are not exposed.** The image response uses a generic content-disposition.

The photo's own content can still give the answer away — a street sign, a shopfront, an OCR-legible
address. That is accepted: it is the game working as intended, the same as GeoGuessr.

## 7. Round generation

Given a space and a round count, generation is deterministic for a given seed and produces a frozen
round set.

### 7.1 Candidate gating

Location candidates must clear both gates. They are complementary — measurement showed each catches
what the other misses:

- **Face-area gate.** Sum of face bounding-box areas from `asset_face`, divided by image area, must be
  ≤ 5%. This removes portraits where the location is background behind a face.
- **Scene gate.** Ranked by a CLIP "is this a picture of a place" score. `smart_search.embedding` is
  already a 512-dimension ViT-B-32 CLIP image vector with a `vector_cosine_ops` index, so this costs
  **one dot product per candidate and no new inference**. The prompt vectors are encoded once and
  shipped as constants.

The scene gate uses **rank-based selection within the pool, not an absolute threshold.** The measured
cosine margin between positive and negative prompts is thin (~0.24 vs ~0.22); an absolute cutoff
would pass everything in one library and nothing in another. Take the top-ranked candidates within
the pool instead.

Date candidates need only a capture date. Portraits are explicitly welcome — a photo of people is a
_better_ date round than a landscape, because faces, clothes, and phones carry the year.

### 7.2 Pool scale

Both scoring scales derive from the candidate pool, computed once per challenge and frozen:

- `scaleKm` = 90th percentile of pairwise great-circle distances over a bounded random sample of
  location candidates.
- `scaleDays` = 90th percentile of pairwise date differences over the same kind of sample.

**A percentile, never a bounding box.** Measurement: adding five holiday photos to a city library
pushed the bounding-box diagonal from 55 km to 6,238 km, at which point a lazy player scored 4,961 and
a good one 4,524 — the game inverted. The p90 statistic ignored the outliers and gave a 4,434-point
spread.

### 7.3 Spread rules

Derived from `scaleKm`, so they scale with the library rather than being hardcoded:

- Geographic cell size ≈ `scaleKm / 300`; at most one round per cell.
- Minimum separation between any two location answers ≈ `scaleKm / 75`.
- At most 2 rounds sharing a country (or coarse cell, for sub-national pools).
- No asset appears twice in a challenge, and generation avoids assets used by recent challenges in
  the same space.

If the constraints cannot be satisfied — a small or tightly clustered pool — they relax in a fixed
order (country cap, then minimum separation, then cell uniqueness) until the round set can be filled.
A challenge that still cannot be filled with the requested count is created shorter, and the response
says so rather than failing silently.

### 7.4 Round type mix

The mix follows what the pool can support. With enough gated location candidates, the default is 3
location and 2 date per 5 rounds. As location candidates run short the mix shifts toward date rounds,
down to an all-date challenge. This is the mechanism that keeps the game playable for a library with
little or no GPS.

## 8. Scoring

Both round types use the same curve, GeoGuessr's shape with the scale taken from the pool:

```
score = round(5000 · exp(−10 · error / scale))

location: error = great-circle km,     scale = challenge.scaleKm
date:     error = |offset| in days,    scale = challenge.scaleDays
```

The scale-derived form is what makes this work for any library. Measured across three archetypes cut
from the reference library:

| Archetype              | Pool scale | Adaptive spread | Fixed-constant spread |
| ---------------------- | ---------- | --------------- | --------------------- |
| Globetrotter           | 17,755 km  | 2,838           | 2,910                 |
| Regional (one country) | 901 km     | 3,675           | 772                   |
| City-only              | 55 km      | 2,352           | 20                    |

"Spread" is the gap between a player who always pins the pool centre and one who guesses within 1% of
the pool scale. A fixed constant works only for a globe-spanning library and collapses to 20 points on
a city library. The adaptive curve holds 2,350–3,675 everywhere, and a player of a given relative
skill scores the same 4,524 in all three — the signature of a scale-free curve.

These three archetypes were outlier-free, so the scale above was measured as a bounding-box diagonal.
The separate outlier experiment in §7.2 is what rules that statistic out in general; the p90 mandated
there produces the same scale on clean pools and survives the dirty ones.

Scores are computed once at submission and stored. They are never recomputed, so changing the curve
later cannot rewrite historical leaderboards.

## 9. Error handling

| Situation                                    | Behaviour                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| Not a member of the space                    | 403 from the existing access layer                                           |
| Pool too small to generate any round         | 400 naming the reason, and suggesting adding photos to the space             |
| Pool fills fewer rounds than requested       | Challenge created shorter; response reports the actual count                 |
| Guess submitted twice for a round            | 409; the first guess stands                                                  |
| Guess on a round whose asset was deleted     | Allowed if the player already loaded it; scored from the denormalised answer |
| Round image requested for an unguessed round | Served — the image is the question                                           |
| Answer requested for an unguessed round      | Answer fields omitted from the response                                      |

## 10. Testing

- **Unit** (`game-scoring.spec.ts`, no DB): scoring curve properties, most importantly **scale
  invariance** — the same relative error must score the same across wildly different pool scales.
  Sampler determinism under a fixed seed. Spread-rule relaxation order. Gate composition.
- **Medium** (real DB via testcontainers): repository queries, including the CLIP dot-product ranking
  and the face-area aggregation, plus the space-membership filtering of candidates.
- **Service** (`game.service.spec.ts`, mocked repositories): answer withholding, duplicate-guess
  rejection, deleted-asset handling.
- **E2E**: create a challenge, play it as two users, assert the leaderboard. Plus an explicit
  **leakage test**: assert that the challenge detail response for an unguessed round contains no
  coordinates, no date, no asset ID, and no filename.

## 11. Out of scope for v1

- Live synchronous lobbies — deliberately deferred; the round-set model accommodates them later.
- Flutter mobile client.
- Themed challenges (by year, place, or person).
- Ownership-based fairness handling.
- Round types beyond location and date, though the typed round model leaves room.

## 12. Open questions

1. **Scene-gate prompt wording** is empirical. The prompts used in the spike separated the extremes
   well but left a wide ambiguous middle. They should be treated as tunable constants and revisited
   with a broader photo sample than the 54 used in the spike.

Resolved during review:

- **Pool scope** — the pool is the space's own assets only (§5). A wider, consent-gated pool was
  considered and rejected: the game must not widen photo visibility beyond space membership.
- **Who may create and delete a challenge** — space editors (§4.3). Deleting cascades to the
  challenge's rounds and guesses.
