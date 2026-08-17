# Daily challenge opt-in per space

## Problem

The daily challenge switches itself on. Opening a space's Challenges page calls `getDailyChallenge`,
which generates that day's challenge as a side effect of the read — so a space acquires a daily, and a
monthly standings board, because somebody looked at a page. Nobody agreed to it.

The generation is not free either: it runs the candidate queries and the CLIP scene prompts, and the
first reader of the day pays for it. Doing that for spaces whose members never wanted the feature is
waste on top of a decision made on their behalf.

Make it opt-in per space: ask once, remember the answer, and let it be changed later.

## Decisions

| Question                                       | Decision                                                    |
| ---------------------------------------------- | ----------------------------------------------------------- |
| Who is prompted, and who can change it         | Editors and owners                                          |
| What a decline means                           | Sticky and reversible — never prompted again for that space |
| What turning it off does to played dailies     | Nothing: generation stops, scores stay in the standings     |
| Where the control lives                        | The Challenges page                                         |
| Unplayed dailies carrying over to the next day | Out of scope — today's behaviour is kept                    |

Editors rather than owners because the daily is generated content, and creating an ordinary challenge
already requires editor (`GameService.create` → `requireEditor`). Gating the daily higher than the
thing it is a variant of would be inconsistent.

## Data model

One nullable column on `shared_space`, beside the existing per-space toggles:

```ts
@Column({ type: 'boolean', nullable: true })
dailyChallengeEnabled!: boolean | null;
```

Three states, and all three are needed:

| Value   | Meaning     | Page shows                |
| ------- | ----------- | ------------------------- |
| `null`  | Never asked | The prompt (editors only) |
| `true`  | On          | The daily card            |
| `false` | Declined    | Nothing                   |

A two-state boolean cannot express this. With `default false` there is no way to tell "nobody has been
asked" from "an editor said no", so the prompt would either nag forever or need a second column to
record the dismissal. The absence of a default is the feature.

Migration: `server/src/schema/migrations-gallery/1793000000000-AddSpaceDailyChallengeEnabled.ts`, a
plain `ADD COLUMN`. No index and no expression, so **no `migration_overrides` row is required** —
unlike `1792000000000`'s partial unique index, whose missing override caused schema drift on every
boot. `server/test/medium/specs/schema-drift.spec.ts` is the check that settles this either way; it
must be run, not assumed.

Existing spaces get `null` and are therefore asked. That is correct rather than merely convenient: the
games feature is unreleased, so no space has a daily anyone has agreed to keep.

## API

No new endpoint. `dailyChallengeEnabled` is added to both space DTOs:

- `SharedSpaceUpdateDto`: `z.boolean().optional()` — omitted means "leave it alone"; there is no way
  to write the column back to `null`, and none is wanted.
- `SharedSpaceResponseDto`: `z.boolean().nullable().optional()` — nullable is load-bearing here, since
  `null` is the state the prompt keys off.

Permissions come free from machinery that already exists. `SharedSpaceService.update` computes a
minimum role per payload:

```ts
const isOwnerOnlySettingsUpdate = dto.faceRecognitionEnabled !== undefined || dto.petsEnabled !== undefined;
const minimumRole = isOwnerOnlySettingsUpdate ? SharedSpaceRole.Owner : SharedSpaceRole.Editor;
```

The default minimum is already Editor. **`dailyChallengeEnabled` must not be added to
`isOwnerOnlySettingsUpdate`** — leaving it out is what makes it editor-or-owner. This is the one line
where a plausible-looking "consistency" edit silently changes the feature's permissions, so it is
worth a test rather than a comment.

Regenerate the spec, the TypeScript SDK and the Dart client. All three, in one pass.

## Server behaviour

`GameService.getDaily` gains a single guard, placed **before** the lookup and generation:

```ts
if (space.dailyChallengeEnabled !== true) {
  return { challenge: null };
}
```

`!== true` rather than `=== false`: un-asked and declined behave identically, and only an explicit
`true` generates anything. The placement is the whole point — after the lookup it would still generate.

The test that matters is not that the response is null but that **no row is created**: assert the
challenge count for the space is unchanged after the call.

Standings need no server change. They aggregate whatever daily scores exist, so a space that turns the
daily off keeps every score already earned, and one that never turned it on has nothing to aggregate.

**Consequence, accepted:** turning the daily off at midday hides a daily that is already generated and
possibly part-played. Scores already earned survive in the standings. "Off means no daily card" is
predictable, and turning it off is a deliberate act by an editor.

## Web

`+layout.ts` already returns `space` and `members`, so the Challenges page derives `isEditor` exactly
as `+layout.svelte` does. No extra request.

**Load** (`games/+page.ts`): when `space.dailyChallengeEnabled !== true`, skip both
`getDailyChallenge` and the `getLeaderboard` call that depends on it. A disabled space stops paying
for two requests, and the client stops asking for something the server would refuse anyway.

**The three states must not collapse into two.** `daily-challenge-card.svelte` renders
`game_daily_unavailable` — "No daily challenge today - add photos with GPS data or capture dates" —
whenever its challenge is null. That message is about a space that _has_ the daily on and lacks usable
photos. Rendering it for a space that simply has not enabled the feature would tell users to fix a
problem they do not have. So:

| State                    | Editor sees                   | Viewer sees |
| ------------------------ | ----------------------------- | ----------- |
| `null`                   | The prompt                    | Nothing     |
| `true`, no usable photos | The existing unavailable card | Same        |
| `true`, daily exists     | The daily card                | Same        |
| `false`                  | Nothing                       | Nothing     |

**Prompt** — a new `daily-challenge-prompt.svelte`, rendered where the daily card would go, only when
`dailyChallengeEnabled === null` and the viewer is an editor. Both buttons write through
`updateSpace` and then `invalidateAll()`; "No thanks" sends `false`, not nothing, because a decline is
a decision.

**Control** — a page-level overflow beside **New challenge**, present for editors in every state,
reading "Turn on daily challenge" or "Turn off daily challenge". It is deliberately not on the daily
card: when the daily is off there is no card, so a card-mounted control could not turn it back on.

**Standings visibility** — render iff `dailyChallengeEnabled === true || entries.some((e) => e.daysPlayed > 0)`.
A small pure helper, unit-tested, so a never-enabled space does not show every member sitting on zero,
while a space that turned it off keeps the board its members earned.

**i18n** — seven new keys: `game_daily_decline`, `game_daily_enable`, `game_daily_enable_description`,
`game_daily_enable_title`, `game_daily_toggle_failed`, `game_daily_turn_off`, `game_daily_turn_on`.
All ten maintained locales in the same commit, inserted in alphabetical position, then
`npx prettier --write i18n/*.json`.

## Testing

- **Server unit** — the guard generates nothing for `null` and for `false` (assert the row count, not
  just the response); generates for `true`. Editor may set the field; viewer is rejected; setting it
  does not escalate to owner-only.
- **Medium** — the schema-drift spec, to prove the new column needs no override row.
- **e2e** — an editor enables and the daily appears; a viewer's write is rejected; an un-asked space
  returns `challenge: null` and creates no challenge row.
- **Web** — the prompt visibility matrix above, both buttons writing the right value, the overflow
  toggle in both directions, and the standings-visibility helper.

Note for whoever writes the e2e tests: in `e2e/` the scoped run is `pnpm test <path>` — that package's
`test` script already carries `--run`, and adding it again crashes. `server/` and `web/` take
`pnpm test --run <path>`.

## Out of scope

- Carrying an unplayed daily over to the next day. Today a fresh daily is generated each UTC day and
  yesterday's becomes unreachable — `getChallengesForSpace` filters `dailyOn IS NULL`, so dailies
  never appear in the challenges list. Worth revisiting; not part of this change.
- Any per-user prompt state. The decision is the space's.
- Disabling player-created challenges. Only the daily is opt-in.
