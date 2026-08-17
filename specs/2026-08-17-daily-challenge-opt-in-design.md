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
plain `ADD COLUMN` up and a `DROP COLUMN IF EXISTS` down. No index and no expression, so **no
`migration_overrides` row is required** — unlike `1792000000000`'s partial unique index, whose missing
override caused schema drift on every boot. `server/test/medium/specs/schema-drift.spec.ts` is the
check that settles this either way; it must be run, not assumed.

`scripts/revert-to-immich.sql` needs **one** change, and the reasoning that says otherwise is a trap
worth spelling out. The column itself needs no teardown — the script already drops `shared_space`
wholesale (`DROP TABLE IF EXISTS "shared_space" CASCADE`). But that file carries a _second, unrelated_
obligation: a `DELETE FROM "kysely_migrations"` block naming every fork migration, so a user reverting
to upstream Immich has the fork's migration rows removed. **Every new `migrations-gallery` migration must
be added there**, regardless of whether its schema change needs undoing.

`server/src/schema/revert-to-immich.spec.ts` enforces this and is the only thing that catches it. It is
a plain unit test, so it fails in the full `pnpm test --run` and not in any scoped run — which is
exactly how this was missed until the final gate.

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
where a plausible-looking "consistency" edit silently changes the feature's permissions, so it gets a
test rather than a comment.

### The mapper is where this feature is most likely to die silently

`SharedSpaceService.mapSpace` is the single place a space row becomes a `SharedSpaceResponseDto` —
`create`, `getAll`, `get` and `update` all go through it (`get` spreads it). Two edits are needed, and
one of them has a trap:

```ts
// in mapSpace's inline parameter type, beside faceRecognitionEnabled?: boolean
dailyChallengeEnabled?: boolean | null;

// in the returned object — NOT `?? true`
dailyChallengeEnabled: space.dailyChallengeEnabled ?? null,
```

The two lines immediately above this one read `faceRecognitionEnabled: space.faceRecognitionEnabled ?? true`
and `petsEnabled: space.petsEnabled ?? true`, because those columns are `default true` and the `??` is
harmless there. Copying that idiom here **collapses `null` into `true`, silently opting every space in
and making the prompt unreachable** — the feature would appear to work while never asking anyone.

`tsc` cannot catch it: `boolean | null ?? true` is well-typed. Only a test on the mapper does. Omitting
the field from the parameter type, by contrast, _is_ a compile error, so that half looks after itself.

(Recorded so nobody re-derives it: `petsEnabled` also appears at three other service call sites, but
those pass it as a repository query option and are not mapping. There is one mapping site, not four.)

Regenerate the spec, the TypeScript SDK and the Dart client. All three, in one pass.

## Server behaviour

`GameService.getDaily` gains a guard, placed **before** the lookup and generation. It has to fetch the
space first: `getDaily` currently calls `requireMember`, which returns a _member_ row and never loads
the space, so there is no `space` in scope to read.

```ts
async getDaily(auth: AuthDto, spaceId: string): Promise<GameDailyResponseDto> {
  await this.requireMember(spaceId, auth.user.id);

  // Opt-in gate. Ahead of the lookup because the lookup is what GENERATES the daily.
  const space = await this.sharedSpaceRepository.getById(spaceId);
  if (space?.dailyChallengeEnabled !== true) {
    return { challenge: null };
  }
  ...
```

Three things about that snippet are deliberate:

- **`?.` on `space`.** `requireMember` has already passed, so a missing space means it was deleted
  between the two queries. Returning `{ challenge: null }` is right for a page that is about to
  redirect anyway; throwing would surface a 500 for an ordinary race.
- **`!== true` rather than `=== false`.** Un-asked and declined behave identically here; only an
  explicit `true` generates anything. With `?.` this also covers the deleted-space case in one
  expression.
- **Placement.** After the lookup, the daily would already have been generated. The guard's whole
  purpose is to sit in front of it.

`GameService` already holds `sharedSpaceRepository` (it uses it in `requireMember`) and
`getById` already exists, so no new plumbing — but this **does add one query to every daily read**.
That is the honest cost of the feature and it is worth it: the query it prevents on a disabled space is
far more expensive.

The test that matters is not that the response is null but that **no row is created**: assert the
challenge count for the space is unchanged after the call.

Standings need no server change. They aggregate whatever daily scores exist, so a space that turns the
daily off keeps every score already earned, and one that never turned it on has nothing to aggregate.

### Turning it off does not close an open daily

`guess` gates on membership only. A member who already has today's daily open can therefore keep
answering rounds after an editor disables the feature, and those points land in the standings as
normal. **This is intended and must not be "fixed" into a rejection.** Blocking it would take a game
away from someone mid-play, which is exactly what the "keep everything" decision rules out; the
challenge exists, and finishing it harms nothing. What disabling stops is _generation_ and the card —
not a game already in someone's hands.

The daily also stays reachable by direct URL for the rest of that UTC day. Tomorrow no new one is
generated, so the feature goes quiet on its own.

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

**Enable is slow, and the button must say so.** `invalidateAll()` re-runs the page load, which now
passes the guard and therefore _generates_ the daily — candidate queries plus the CLIP scene prompts.
That is seconds, not milliseconds. The Enable button needs a pending state for the whole
update-then-reload round trip, or it looks broken on exactly the click that matters most. "No thanks"
is a plain column write and needs nothing.

**Control** — a page-level overflow beside **New challenge**, present for editors in every state,
reading "Turn on daily challenge" or "Turn off daily challenge". It is deliberately not on the daily
card: when the daily is off there is no card, so a card-mounted control could not turn it back on.

**Standings visibility** — while the space is un-asked the page shows the prompt and nothing else:

```ts
dailyChallengeEnabled === null
  ? false // un-asked: the prompt is the only thing on the page
  : dailyChallengeEnabled || entries.some((e) => e.daysPlayed > 0);
```

A small pure helper, unit-tested. The `null` branch is not redundant. Any space where a daily was
generated during RC testing arrives at this release un-asked **and** with history, and the plain
`enabled || some(daysPlayed > 0)` rule would render a populated standings board directly beneath a
prompt asking whether to turn the feature on. The prompt wins; the board comes back the moment it is
answered, because nothing was deleted.

Otherwise: an enabled space always shows the board, and a declined space shows it only if its members
actually earned something.

**i18n** — seven new keys: `game_daily_decline`, `game_daily_enable`, `game_daily_enable_description`,
`game_daily_enable_title`, `game_daily_toggle_failed`, `game_daily_turn_off`, `game_daily_turn_on`.
All ten maintained locales in the same commit, inserted in alphabetical position, then
`npx prettier --write i18n/*.json`.

## Testing

**Server unit — the guard**

- `null` and `false` each return `{ challenge: null }` **and create no row**. Assert the space's
  challenge count is unchanged, not merely that the response is null: a guard placed after the lookup
  would satisfy the response assertion while still generating.
- `true` generates as before.
- A space deleted between `requireMember` and `getById` returns `{ challenge: null }` rather than
  throwing.

**Server unit — the mapper.** `mapSpace` passes `null` through as `null`. This is the single most
valuable test here: it is the only thing standing between the feature and the `?? true` mistake, which
`tsc` cannot see and which would silently opt in every space.

**Server unit — permissions**

- An **editor** (not owner) successfully sets `dailyChallengeEnabled`. This is the test that pins the
  chosen permission level.
- A viewer is rejected.
- `dailyChallengeEnabled` sent **together with** `petsEnabled` still requires owner — proving the
  existing escalation was not weakened by adding a field beside it.

**Server unit — guesses survive disabling.** With the daily generated and then disabled, a guess still
succeeds and still scores. Locks in the "does not close an open daily" decision so a later reading of
"off means no daily" cannot quietly turn it into a rejection.

**Medium** — the schema-drift spec, proving the new column needs no override row.

**e2e**

- An editor enables and the daily appears.
- A viewer's write is rejected.
- An un-asked space returns `challenge: null` and creates no challenge row.
- **Disable → re-enable preserves the board.** Play a daily, read the standings, disable, confirm the
  scores are still there, re-enable, confirm the board is unchanged. This is the end-to-end proof of
  the "keep everything" decision, which nothing else covers.

**Web**

- The four-state visibility matrix, for an editor and for a viewer.
- Each prompt button writes the right value — `true` for Enable, `false` (not `undefined`) for
  No thanks.
- The overflow toggle in both directions.
- The standings-visibility helper, including the `null`-with-history case, which is the branch a
  simplification would delete.
- The Enable button's pending state.

Note for whoever writes the e2e tests: in `e2e/` the scoped run is `pnpm test <path>` — that package's
`test` script already carries `--run`, and adding it again crashes with
`Expected a single value for option "--run"`. `server/` and `web/` take `pnpm test --run <path>`.

## Edge cases

Everything considered, including the ones needing no code — so a later reader can tell "handled" from
"never thought about".

| Case                                                      | Behaviour                                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Enable on a space with no usable photos                   | Enable succeeds, daily is `null`, existing unavailable card explains why            |
| Space deleted between `requireMember` and `getById`       | `{ challenge: null }` via `space?.` — no 500 for an ordinary race                   |
| Two editors enable and decline at the same moment         | Last write wins. Both are legitimate decisions and either is reversible; no locking |
| Member mid-play when an editor disables                   | Keeps playing, keeps scoring — see "does not close an open daily"                   |
| Editor demoted to viewer after enabling                   | Nothing happens. The setting is the space's, not theirs; no action needed           |
| Space already has daily history while still un-asked      | Prompt only; the board returns once answered. Nothing is deleted                    |
| Daily disabled, then a member opens yesterday's daily URL | Still playable that day; no new daily tomorrow. The feature goes quiet on its own   |
| Viewer in an un-asked space                               | Sees neither prompt nor card, and cannot change the setting                         |

## Out of scope

- Carrying an unplayed daily over to the next day. Today a fresh daily is generated each UTC day and
  yesterday's becomes unreachable — `getChallengesForSpace` filters `dailyOn IS NULL`, so dailies
  never appear in the challenges list. Worth revisiting; not part of this change.
- Any per-user prompt state. The decision is the space's.
- Disabling player-created challenges. Only the daily is opt-in.
