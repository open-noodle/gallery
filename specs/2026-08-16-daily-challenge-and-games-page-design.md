# Daily challenge and the games page redesign

Date: 2026-08-16
Status: implemented

Implementation notes (where the build differed from this design):

- `dailyOn` is stored as a `date` column, which the driver returns as a `Date`. It is serialised
  through `asDateString()` and typed `Timestamp` on the table, matching `person.birthDate` — the DTO
  still promises `YYYY-MM-DD`. Response DTOs are not validated on the way out, so the mismatch was
  invisible to tsc and was caught only by an e2e assertion on the response shape.
- The daily's `name` column holds its UTC date purely to keep the column non-null. The play page
  titles a daily with the localised `game_daily_challenge` label instead, so that raw date never
  reaches the screen.

## Problem

`/spaces/[spaceId]/games` currently reads as a CRUD list. "New challenge" creates a row called
`Challenge 3`, the cards carry a name and a round count, and nothing about the page suggests a game.
There is also no reason to come back: a challenge is created once and sits there.

Two changes address that:

1. A **daily challenge** — the same generated challenge for every member of a space, every day,
   one attempt each, with a shared leaderboard.
2. A **custom challenge** flow that asks what kind of game you want (how many rounds, which round
   types) instead of silently creating a five-round mixed challenge.

## Decisions

| Decision         | Choice                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily scope      | **Per space.** The games page is already space-scoped and leaderboards are per challenge, so each space gets its own daily and competes among its members. |
| Attempts         | **One per person per day.** Already enforced by the existing `game_guess_round_user_uq` constraint; no new mechanism.                                      |
| Day boundary     | **UTC.** A shared leaderboard needs one canonical boundary for everyone; a per-viewer local day would give members different "todays" on the same board.   |
| Creation trigger | **Lazily, on first read of the day**, by any member. No scheduler, nothing to run for idle spaces, self-healing if a day is missed.                        |
| Concurrency      | A partial unique index on `(spaceId, dailyOn)`; the loser of a race catches the conflict and re-reads, mirroring the existing guess-conflict handling.     |
| Streaks          | **Out of scope.** Deliberately not built (see Out of scope).                                                                                               |
| Past dailies     | **Out of scope.** Today's only.                                                                                                                            |
| Challenge "type" | **Derived from the rounds actually generated**, not stored. A stored request type lies whenever the generator could not honour it.                         |

## Data model

One fork migration in `server/src/schema/migrations-gallery/`.

```sql
ALTER TABLE "game_challenge" ADD COLUMN "dailyOn" date;
CREATE UNIQUE INDEX "game_challenge_daily_uq"
  ON "game_challenge" ("spaceId", "dailyOn") WHERE "dailyOn" IS NOT NULL;
```

`dailyOn` is the UTC date a challenge is the daily for, and `NULL` for a custom challenge. A partial
unique index is what makes the lazy creation race-safe.

`createdById` also changes:

```sql
ALTER TABLE "game_challenge" ALTER COLUMN "createdById" DROP NOT NULL;
-- FK re-created as ON DELETE SET NULL
```

A daily has no human author, so `NOT NULL` cannot hold. The FK change is a genuine fix beyond that:
today `ON DELETE CASCADE` means deleting a user **destroys the challenges they created in a shared
space, and every other member's guesses and scores along with them**. Scores belong to the space,
not to whoever pressed the button. `SET NULL` keeps them.

## Server

### Generation

`GameService.create` already takes a seed and is fully deterministic, so the daily needs no separate
generator — only a different seed and a different round mix.

- Seed: `` `${spaceId}:daily:${isoDate}` `` (today's UTC date). Every member generating "first"
  produces an identical challenge, so the race is harmless even before the unique index resolves it.
- Custom challenges keep their existing `` `${spaceId}:${challengeCount}` `` seed.
- Daily defaults: 5 rounds, mixed.

### Round mix

`LOCATION_ROUND_SHARE = 0.6` becomes a function of the requested type:

| Type       | Location share          |
| ---------- | ----------------------- |
| `mixed`    | 0.6 (today's behaviour) |
| `location` | 1.0                     |
| `date`     | 0.0                     |

The existing fallback (a shortfall in one pool is made up from the other) stays for `mixed` only.
For `location` and `date` the request is explicit, so a shortfall must **not** be silently filled
with the other type: generate fewer rounds instead, and if the pool yields none, 400 with a message
naming the reason (a space with no GPS-tagged photos cannot make a location game).

### Endpoints

- `GET /shared-spaces/:spaceId/games/daily` — today's daily plus the caller's progress, creating it
  if absent. **Membership-gated, not editor-gated**: the system is the author, so any member
  triggering generation is not "creating" anything of their own.
- `GET /shared-spaces/:spaceId/games` — unchanged, except it now **excludes** dailies, so they never
  clutter the custom list.
- `POST /shared-spaces/:spaceId/games` — gains `type` alongside `roundCount`. Still editor-gated.
- `DELETE /games/:id` — must refuse a daily (400). It is shared state, not one member's row.

### DTO changes

- `GameCreateDto`: `type: 'mixed' | 'location' | 'date'`, default `mixed`.
- `GameChallengeResponseDto` / list item: `dailyOn: string | null` and `locationRoundCount: number`.
  The client derives the displayed type from `locationRoundCount` vs `roundCount`, so the label is
  always what the challenge actually contains.

These change the OpenAPI spec, so the TypeScript SDK and Dart client must be regenerated (unlike the
earlier param-pattern change, this alters real request/response shapes).

## Web

### Page structure

```
┌────────────────────────────────────────────┐
│  DAILY CHALLENGE            Tue 16 Aug     │  <- hero, full width
│  [round-0 photo as backdrop]               │
│  5 rounds · mixed                          │
│  ── not played ──   [ Play ]               │
│  ── played ──       18,420 · leaderboard   │
│                     next daily in 6h 12m   │
└────────────────────────────────────────────┘

  Your challenges                [ + New ]

  ┌─ rounds ──┐ ┌─ type ─────────────┐
  │ 3  5  10  │ │ Mixed Places Dates │      <- create panel, revealed by [ + New ]
  └───────────┘ └────────────────────┘
                              [ Create ]

  ┌──────────┐ ┌──────────┐ ┌──────────┐
  │ photo    │ │ photo    │ │ photo    │    <- challenge cards
  │ Challenge│ │ Challenge│ │ Challenge│
  │ 3/5 · ●●○│ │ done     │ │ new      │
  └──────────┘ └──────────┘ └──────────┘
```

### What makes it feel like a game rather than a table

- **The daily is a hero, not a row.** Full-width card, the round-0 photo as a dimmed backdrop, the
  date as a label, and a single large action. Once played it flips to the score in large numerals
  with the space leaderboard beneath it and a countdown to the next UTC midnight.
- **Cards carry their photo.** Each challenge card uses its round-0 image as a backdrop via the
  existing `/games/:id/rounds/0/image` endpoint. That endpoint already serves a generic, EXIF-free
  preview keyed by `(challenge, index)` and never discloses an asset id or filename, so this leaks
  nothing the player would not see on entering the round.
- **Progress is visual.** `answered / roundCount` renders as pips, not as the sentence it is now.
- **Choices are buttons, not a form.** Round count and game type are segmented controls with icons
  (shuffle / map-marker / calendar), not a number field and a select.
- **The empty state invites.** It leads with the daily, not with "no challenges".

### Components

| File                                                 | Purpose                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `lib/components/games/daily-challenge-card.svelte`   | The hero, in its three states: unplayed, played, unavailable. |
| `lib/components/games/challenge-create-panel.svelte` | Round-count and type pickers plus the create action.          |
| `lib/components/games/challenge-card.svelte`         | Extended with a photo backdrop and progress pips.             |
| `routes/.../games/+page.svelte`                      | Composes the two sections.                                    |

The countdown is derived from a `$state` clock ticking once a minute — not once a second, which
would re-render the hero 60× a minute for no visible gain at minute resolution.

## i18n

New keys in all ten maintained locales (`de fr it nl pl es ru zh_Hans zh_Hant` + `en`):
daily-challenge title, "next daily in {time}", played/unplayed states, the unavailable reason, the
round-count and type labels, and the location-only-impossible error. Month and date formatting
continues to come from `Intl`, not from keys.

## Testing

- **`game-scoring` / service unit tests**: the daily seed is stable for a given `(space, date)` and
  differs across dates; the type→share mapping; a location-only request against a GPS-less pool
  400s rather than quietly returning date rounds.
- **Repository/medium**: the partial unique index actually rejects a second daily for the same
  `(spaceId, dailyOn)`.
- **Web component tests**: the hero's three states; the create panel emits the chosen round count
  and type; cards render pips matching `answered/roundCount`.
- **E2E**: two different members reading the daily endpoint concurrently get the **same** challenge
  id; the daily is absent from the custom list; deleting a daily is refused; a custom challenge
  created with `type: 'date'` contains only date rounds.

E2E is the gate that matters most here — it is what would catch the concurrent-creation race, and
this repo has already shipped a game feature whose e2e spec had never been run.

## Out of scope

- **Streaks.** Explicitly declined; they add per-user state and timezone edge cases for a feature
  whose pull is already covered by a daily reset.
- **Past dailies / history.** Today's only. `dailyOn` makes an archive view cheap to add later.
- **Notifications** when a new daily is available.
- **Server-side challenge naming.** `Challenge N` is still hardcoded English on the server; it is a
  known gap, unchanged here, and the daily sidesteps it by not having a user-facing name.
