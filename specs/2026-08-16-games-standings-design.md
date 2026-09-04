# Games standings: a daily board and a monthly board

Date: 2026-08-16
Status: designed

## Problem

Once you finish the daily challenge you cannot see how anyone else did. The per-challenge
leaderboard exists — `GET /games/:id/leaderboard` and `game-leaderboard.svelte` — but it is only
rendered at the end of a play-through, and `daily-challenge-card.svelte` drops its link the moment
`answered >= roundCount`. The score you just earned has nowhere to be compared.

Today's board alone is not enough, though. A daily resets every night, so a board that only ever
shows today gives no reason to keep playing past today. What is missing is a standing that
accumulates.

That raises the question this design exists to answer: **how do you rank players who have not
played the same number of games?**

## Why the answer is "dailies only"

Two properties of the existing implementation constrain any long-term ranking:

1. **Scores are not comparable across challenges.** `scaleKm` / `scaleDays` are frozen per
   challenge and derived from a percentile of the space's photo pool (`game-scoring.ts`), and a
   `mixed` challenge's location/date split varies. A sum over arbitrary challenges therefore
   compares two different units.
2. **Custom challenges are self-selected.** They are created on demand by editors, in any number,
   with a chosen round count and type. Whoever creates more, scores more.

The daily has neither problem: every member of the space gets the identical challenge, on the same
day, with one attempt each — enforced by `game_guess_round_user_uq`. It is the only thing in the
feature that is a level field, so it is the only thing that gets ranked.

Custom challenges keep their existing per-challenge leaderboard and contribute nothing to the
standings.

## Decisions

| Decision           | Choice                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What counts        | **Dailies only.** Custom challenges never contribute (see above).                                                                                                                     |
| Metric             | **Total points over the window.** Missing days costs you, because showing up is the game.                                                                                             |
| Window             | **Calendar month, UTC** — the same boundary the daily already uses. Resets on the 1st.                                                                                                |
| Why not an average | An average needs an arbitrary minimum-plays qualifier or one lucky day tops the board forever. The window already bounds volume: everyone gets the same number of chances in a month. |
| Average anyway     | Shown as a **secondary column**, not the sort key, so a strong occasional player can still see it.                                                                                    |
| Visibility         | **Always.** A score is not a spoiler and the endpoint returns no answers; seeing a target to beat is the reason to open the app.                                                      |
| Placement          | **One `Standings` section** on the games page under the daily hero, tabbed `Today` / `This month`.                                                                                    |
| Past months        | **Out of scope.** The response carries the month it covers, so an archive is additive later.                                                                                          |

## What a row means

A row on either board is one **current member** of the space.

| Column | Today                   | This month                                 |
| ------ | ----------------------- | ------------------------------------------ |
| avatar | member avatar           | member avatar                              |
| name   | member name             | member name                                |
| detail | `answered / roundCount` | `days` played, and `avg` = `total / days`  |
| value  | score on today's daily  | `total` points across this month's dailies |

Ordering on both, in this order:

1. **Anyone who has not played sorts last**, regardless of anything else.
2. `total` descending.
3. `days` (or `answered`) **ascending** — the same points from fewer rounds is the better
   performance.
4. Name, so the order is stable.

Step 1 is not redundant with step 2. A guess can legitimately score `0` (`scoreFromError` floors at
zero), so a member who played and scored nothing has `total: 0, daysPlayed: 1` and would otherwise
sort _below_ a member who never opened the game at all — `daysPlayed: 0` wins the ascending
tie-break. Someone who showed up must never rank beneath someone who did not.

Members who have not played render `—` in both the detail and value columns.

Ranks are **competition ranks**: `1, 2, 2, 4`. The current component renders the array index plus
one (`game-leaderboard.svelte`), which invents a winner out of a tie.

Three cases resolve without special handling:

- **Partial plays count as they stand.** Answering 3 of 5 rounds earns the points for 3 rounds and
  counts the day as played. The incentive to finish is the points left on the table; no extra rule
  is needed, and any rule that voided partial plays would punish a dropped connection.
- **Custom challenges are excluded by the query**, via `dailyOn IS NOT NULL` and the month range —
  not by a separate flag that could drift from the definition of a daily.
- **Only current members appear.** A member who leaves the space drops off both boards; their
  `game_guess` rows survive (they cascade on user deletion, not on leaving a space), so re-joining
  restores their history. This also removes the `?? 'Unknown'` name fallback in
  `GameService.leaderboard`, which existed only for this case and rendered an untranslated English
  string.

## Server

No migration. Every column and index this needs already exists.

### New endpoint

```
GET /shared-spaces/:spaceId/games/standings        (membership-gated, like the daily)

GameStandingsResponseDto {
  month: string                      // 'YYYY-MM', UTC — the client renders the name via Intl
  entries: Array<{
    userId: string
    name: string
    total: number                    // points across this month's dailies
    daysPlayed: number               // distinct dailies with at least one guess
  }>
}
```

`avg` is **not** a field: it is `total / daysPlayed`, and duplicating a derived value in the DTO
invites the two to disagree. The client divides.

There is deliberately **no `month` query parameter**. Past months are out of scope, and adding the
parameter later is additive — adding it now would mean shipping a range validator, a bound on how
far back a client may ask, and tests for all of it, for a view nothing renders.

### Repository

`GameRepository.getMonthlyStandings(spaceId, monthStart, monthEndExclusive)`:

```sql
SELECT g."userId", SUM(g.score) AS total, COUNT(DISTINCT r."challengeId") AS days
FROM game_guess g
JOIN game_round r     ON r.id = g."roundId"
JOIN game_challenge c ON c.id = r."challengeId"
WHERE c."spaceId" = $1
  AND c."dailyOn" IS NOT NULL
  AND c."dailyOn" >= $2 AND c."dailyOn" < $3
GROUP BY g."userId"
```

The range is **half-open** — `[first of month, first of next month)` — so no row can be claimed by
two months and no `23:59:59` boundary has to be written down. Both bounds are UTC, matching the
`dailyOn` column and the daily's own day boundary.

`COUNT(DISTINCT r."challengeId")` rather than `dailyOn`: the unique index already makes them
equivalent, and counting the key the join is on keeps the query readable without depending on that
index for correctness.

Existing indexes cover this: `game_challenge.spaceId`, the partial unique on
`(spaceId, dailyOn)`, `game_round.challengeId`, `game_guess.roundId`. Decorated with `@GenerateSql`
like its neighbours, so the generated query file must be refreshed — and `make sql` **deletes every
query file when no database is running**, so it is run against a live stack or not at all.

### Service

`GameService.standings(auth, spaceId)`:

1. `requireMember(spaceId, auth.user.id)`.
2. Compute the current UTC month bounds.
3. `getMonthlyStandings` and `sharedSpaceRepository.getMembers` in parallel.
4. Zero-fill: every member with no aggregate row becomes `total: 0, daysPlayed: 0`; every
   aggregate row for a non-member is dropped.
5. Sort as described above.

`GameService.leaderboard` changes the same way — zero-filled from the member list, non-members
dropped, same ordering — so both tabs render the same set of people and `Kim —` is a row on each.

DTO changes alter real response shapes, so the OpenAPI spec, the TypeScript SDK and the Dart client
must be regenerated (`pnpm build`, `pnpm sync:open-api`, `make open-api`).

## Web

```
┌────────────────────────────────────────┐
│ 🏆 DAILY CHALLENGE          5 rounds   │
│ 18,420                                 │
│ played · next daily in 6h 12m          │
└────────────────────────────────────────┘

  STANDINGS         ┌ Today ┐ This month
  ┌────────────────────────────────────────┐
  │ 1  (A) Ana        5/5          21,400  │
  │ 2  (P) Pierre     5/5          18,420  │   <- caller's row, highlighted
  │ 3  (B) Ben        3/5           9,110  │
  │ 4  (K) Kim         —                —  │
  └────────────────────────────────────────┘

  Your challenges                 [ + New ]
```

| File                                            | Change                                                  |
| ----------------------------------------------- | ------------------------------------------------------- |
| `lib/components/games/standings-section.svelte` | New. The tabbed shell; owns which tab is active.        |
| `lib/components/games/game-leaderboard.svelte`  | Generalised to render either board.                     |
| `routes/.../games/+page.svelte` / `+page.ts`    | Loads both boards, composes the section under the hero. |

**Tabs** follow the segmented-control pattern already in `challenge-create-panel.svelte` —
`aria-pressed` on plain buttons inside a rounded border — rather than introducing a new control for
two options.

**`game-leaderboard.svelte`** takes `rows: Array<{ user, detail, value, rank, isMe }>` so one table
serves both tabs and the play page's completed screen. `user` is the shape `UserAvatar` wants and
carries the id and name, so neither is repeated on the row; the parent adapts a
`SharedSpaceMemberResponseDto` into it exactly as
`space-activity-feed.svelte` does (`profileImagePath ?? ''`, `avatarColor as UserAvatarColor ??
Primary`) — with the difference that a member carries a real `profileChangedAt`, so it is passed
through rather than left `''`, keeping the profile-image cache-buster correct.

**Avatars come from the page's `members` array, not from the standings DTO.** The page already
loads members with `profileImagePath`, `avatarColor` and `profileChangedAt`, and standings entries
are by definition exactly the current members, so the client-side join by `userId` is total. Adding
avatar fields to the new DTO would duplicate them on every response for nothing.

**The caller's row is highlighted, not renamed "You".** Renaming needs a key in ten locales and
makes the row inconsistent with every other place the space shows member names.

**Loading.** `+page.ts` fetches the standings in parallel with space, members, challenges and the
daily; today's board follows once the daily's id is known. Both are page-load data rather than
on-mount fetches, so the section does not flash empty on a page whose whole point is the numbers.

**An untouched month shows every member at zero** rather than an empty state. A row reading `—` is
an invitation; "no scores yet" is a dead end.

## i18n

Six new keys across `en` plus the nine maintained locales (`de fr it nl pl es ru zh_Hans
zh_Hant`): the section title, the two tab labels, the days-played label, the average label, and an
accessible label for the `—` shown against a member who has not played.

The month name comes from `Intl.DateTimeFormat`, never from a key.

## Testing

- **Repository / medium** — the month boundary holds: a daily dated the last day of the previous
  month is excluded and one dated the 1st is included; custom challenges contribute nothing;
  `daysPlayed` counts a daily once when a user answered three of its rounds.
- **Service unit** — members with no guesses are zero-filled; a user who has left the space is
  dropped even though their guesses remain; the tie-break ordering holds; and a member who played
  and scored `0` ranks **above** a member who never played, which the ordering only gets right
  because of the explicit not-played step.
- **Web component** — switching tabs swaps the rows; the caller's row is highlighted; a tie renders
  `1, 2, 2, 4` and not `1, 2, 3, 4`; a member who has not played renders `—` and sorts last.
- **E2E** — two members play the same daily and the standings order matches their scores; points
  earned on a custom challenge never appear in the standings response.

The tie-rank and boundary tests are the ones that must be seen to fail first: both are cases where
a plausible-looking implementation returns plausible-looking numbers.

## Out of scope

- **Past months / a season archive.** `month` in the response makes it additive.
- **An all-time board.** It re-introduces exactly the volume problem this design removes: whoever
  has been in the space longest wins forever.
- **Streaks**, already declined in the daily-challenge design.
- **Notifications** when someone overtakes you.
- **A "last month's winner" moment.** Worth revisiting once a month of real data exists.
