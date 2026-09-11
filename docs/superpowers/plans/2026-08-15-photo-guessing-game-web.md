# Photo Guessing Game — Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the responsive web surface for the photo guessing game — challenge list, a location round played by dropping a pin on a map, a date round played on a timeline, score reveal, and a leaderboard.

**Architecture:** SvelteKit routes nested under the existing space route tree, with presentational components in `web/src/lib/components/games/`. The play page is the only stateful piece; round components are dumb and emit a guess upward. All server calls go through the already-generated `@immich/sdk`. The map is the existing `Map.svelte` — it already supports click-to-place — so no new map code is written.

**Tech Stack:** SvelteKit, Svelte 5 runes (`$state`/`$derived`/`$props`), TypeScript, Tailwind 4, `@immich/ui`, `maplibre-gl` via the existing `Map.svelte`, Vitest + `@testing-library/svelte`.

**Spec:** `docs/superpowers/specs/2026-08-15-photo-guessing-game-design.md` (§4.4 is the web section; §6 answer-withholding and §8 scoring bind the UI too)

**Server plan (already complete, merged on this branch):** `docs/superpowers/plans/2026-08-15-photo-guessing-game-server.md`

## Global Constraints

- **Svelte 5 runes** (`$state`, `$derived`, `$props`, `$effect`) in new code — not the older store idiom.
- **Every user-facing string is an i18n key**, and per `CLAUDE.md` a new key must be added to **`en.json` plus all nine** of: `de` · `fr` · `it` · `nl` · `pl` · `es` · `ru` · `zh_Hans` · `zh_Hant`, in the same commit. Keys are alphabetically sorted, 2-space indent, unescaped Unicode. Finish with `npx prettier --write i18n/*.json` — CI checks the formatting.
- **Match each locale's register:** German, Italian and Spanish address the user informally (`du` / `tu` / `tú`); French and Russian use formal `vous` / `вы`. Reuse the word a file already uses for a concept rather than inventing a synonym.
- **`@immich/ui`'s `ghost` button variant renders in THEME INK and is invisible over a photo.** The game places controls over photographs — never use `ghost` there. Use a variant with its own opaque backing, or a plain element with an explicit background.
- **`svelte-check` can silently scan 0 files locally.** After running it, confirm from its output that it actually checked files; a "0 errors" line over 0 files is not a pass.
- **Web vitest does not clear mocks between tests in a file** — mock call history leaks across cases. Reset explicitly in `beforeEach` where it matters.
- **Assertions that cannot fail are a defect.** `queryBy…` returning `null` makes `expect(x).not.toBeInTheDocument()` pass whether or not the component rendered. Prove a negative by first asserting the positive case renders.
- Web checks: `cd web && pnpm check:typescript`, `pnpm check:svelte`, `pnpm lint`, `pnpm format`.
- **To run ONE spec file, use `cd web && pnpm exec vitest run <path>`.** `pnpm test -- --run <path>` SILENTLY DROPS the path filter and runs the whole 364-file suite (~63s) — verified. That wastes a minute per iteration and buries your file's result in thousands of lines, which has already caused one implementer to wrongly conclude the harness was broken.
- **`pnpm test` without `--run` starts watch mode** and will hang a non-interactive session. The whole suite, when you want it, is `cd web && pnpm exec vitest run`.
- **NEVER use `git stash`** — this repo's stash stack is shared across ~100 worktrees and concurrent sessions.
- **NEVER use a `//`-prefixed mise task** — `//` resolves to the MAIN CHECKOUT, not this worktree.

---

## Verified facts (checked against the tree before writing — do not re-derive)

**Generated SDK functions** (`packages/sdk/src/fetch-client.ts`), already exist:

```ts
getChallenges({ spaceId }); // list
createChallenge({ spaceId, gameCreateDto }); // create
getChallenge({ id }); // detail, answers withheld
guessRound({ id, index, gameGuessDto }); // submit a guess
getLeaderboard({ id });
deleteChallenge({ id });
getRoundImage({ id, index }); // the round photo
```

**`Map.svelte`** (`web/src/lib/components/shared-components/map/Map.svelte`) already exposes everything needed:

```ts
clickable?: boolean
onClickPoint?: ({ lat, lng }: { lat: number; lng: number }) => void
useLocationPin?: boolean
mapMarkers?: MapMarkerResponseDto[]
center?: LngLatLike            // $bindable
zoom?: number
autoFitBounds?: boolean
simplified?: boolean
rounded?: boolean
showSimpleControls?: boolean
```

So the pin-drop is `<Map clickable useLocationPin onClickPoint={…} />`. **Write no new map code.**

**Precedent to read:** `web/src/lib/modals/GeolocationPointPickerModal.svelte` wraps `Map.svelte` for point-picking with `onClose: (point?: LatLng) => void`.

**Component test idiom** (`web/src/lib/components/spaces/role-badge.spec.ts`): `@testing-library/svelte`'s `render` + `screen`, asserting on `data-testid`.

---

## File Structure

**Create:**

- `web/src/lib/utils/game.ts` — pure formatting/derivation: distance, score bar percentage, timeline position. No Svelte, no SDK.
- `web/src/lib/utils/game.spec.ts`
- `web/src/lib/components/games/challenge-card.svelte` — one row in the challenge list.
- `web/src/lib/components/games/challenge-card.spec.ts`
- `web/src/lib/components/games/round-photo.svelte` — the round image surface.
- `web/src/lib/components/games/location-round.svelte` — map + pin + guess button.
- `web/src/lib/components/games/location-round.spec.ts`
- `web/src/lib/components/games/date-round.svelte` — timeline + guess button.
- `web/src/lib/components/games/date-round.spec.ts`
- `web/src/lib/components/games/round-result.svelte` — score reveal.
- `web/src/lib/components/games/round-result.spec.ts`
- `web/src/lib/components/games/game-leaderboard.svelte`
- `web/src/lib/components/games/game-leaderboard.spec.ts`
- `web/src/routes/(user)/spaces/[spaceId]/games/+page.ts` + `+page.svelte` — list & create.
- `web/src/routes/(user)/spaces/[spaceId]/games/[challengeId]/+page.ts` + `+page.svelte` — play.

**Modify:**

- `i18n/en.json` and the nine mandated locale files.

**Design note — why round components are dumb:** the play page owns all state (current index, submitted guesses, results) and passes each round component only what it renders plus an `onGuess` callback. That keeps every round component synchronously testable with no SDK mocking, and confines async/error handling to one file.

---

## Task 1: i18n keys in all ten locale files

**Files:**

- Modify: `i18n/en.json`, `i18n/de.json`, `i18n/fr.json`, `i18n/it.json`, `i18n/nl.json`, `i18n/pl.json`, `i18n/es.json`, `i18n/ru.json`, `i18n/zh_Hans.json`, `i18n/zh_Hant.json`

**Interfaces:**

- Produces: the key names every later task's markup references. Later tasks must use these exact keys and add no new ones without also adding all ten translations.

Keys to add (English values shown; translate the rest into each file's own register):

| Key                                | English                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `game_challenges`                  | Challenges                                                                  |
| `game_new_challenge`               | New challenge                                                               |
| `game_no_challenges`               | No challenges yet                                                           |
| `game_no_challenges_description`   | Create one to start guessing where and when your space's photos were taken. |
| `game_round_count`                 | Rounds                                                                      |
| `game_play`                        | Play                                                                        |
| `game_continue`                    | Continue                                                                    |
| `game_completed`                   | Completed                                                                   |
| `game_round_progress`              | Round {current} of {total}                                                  |
| `game_where_was_this`              | Where was this?                                                             |
| `game_when_was_this`               | When was this?                                                              |
| `game_place_your_pin`              | Tap the map to place your pin                                               |
| `game_guess`                       | Guess                                                                       |
| `game_guess_year`                  | Guess {year}                                                                |
| `game_next_round`                  | Next round                                                                  |
| `game_you_were_away`               | You were {distance} away                                                    |
| `game_you_were_off`                | You were {offset} off                                                       |
| `game_points`                      | {score} pts                                                                 |
| `game_actual`                      | Actual                                                                      |
| `game_leaderboard`                 | Leaderboard                                                                 |
| `game_leaderboard_answered`        | {answered} of {total} answered                                              |
| `game_challenge_created`           | Challenge created                                                           |
| `game_challenge_deleted`           | Challenge deleted                                                           |
| `game_delete_challenge`            | Delete challenge                                                            |
| `game_create_failed`               | Could not create a challenge from this space's photos                       |
| `game_rounds_fewer_than_requested` | This space's photos filled {actual} of {requested} rounds                   |

- [ ] **Step 1: Add the keys to `en.json`**

Insert each key in **alphabetical position** — do not append. They sort among the existing `g…` keys.

- [ ] **Step 2: Add translations to the nine locale files**

Same alphabetical placement in each. Match the file's existing register and terminology: `du`/`tu`/`tú` for German/Italian/Spanish, `vous`/`вы` for French/Russian. Look up the nearest existing key for a concept (e.g. how each file already renders "photos", "space", "delete") and reuse that wording rather than inventing a synonym.

- [ ] **Step 3: Format and verify**

Run:

```bash
npx prettier --write i18n/*.json
npx prettier --check i18n/*.json
```

Expected: check passes.

- [ ] **Step 4: Verify no key was missed**

Run this and confirm every count is identical:

```bash
for f in en de fr it nl pl es ru zh_Hans zh_Hant; do printf '%s %s\n' "$f" "$(grep -c '"game_' i18n/$f.json)"; done
```

Expected: all ten report the same number (26).

- [ ] **Step 5: Commit**

```bash
git add i18n/
git commit -m "feat(i18n): add photo guessing game strings"
```

---

## Task 2: Pure formatting helpers

**Files:**

- Create: `web/src/lib/utils/game.ts`
- Test: `web/src/lib/utils/game.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `formatDistanceKm(km: number): string`
  - `scorePercent(score: number): number`
  - `yearFromIso(iso: string): number`
  - `MAX_ROUND_SCORE: 5000`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/utils/game.spec.ts`:

```ts
import { formatDistanceKm, MAX_ROUND_SCORE, scorePercent, yearFromIso } from '$lib/utils/game';

describe('formatDistanceKm', () => {
  it('uses metres below one kilometre', () => {
    expect(formatDistanceKm(0)).toBe('0 m');
    expect(formatDistanceKm(0.42)).toBe('420 m');
  });

  it('uses one decimal between 1 and 10 km', () => {
    expect(formatDistanceKm(1.24)).toBe('1.2 km');
  });

  it('rounds to whole kilometres above 10', () => {
    expect(formatDistanceKm(550.4)).toBe('550 km');
    expect(formatDistanceKm(17755)).toBe('17,755 km');
  });
});

describe('scorePercent', () => {
  it('maps the score range onto 0-100', () => {
    expect(scorePercent(0)).toBe(0);
    expect(scorePercent(MAX_ROUND_SCORE)).toBe(100);
    expect(scorePercent(2500)).toBe(50);
  });

  it('clamps out-of-range input rather than overflowing the bar', () => {
    expect(scorePercent(-10)).toBe(0);
    expect(scorePercent(99_999)).toBe(100);
  });
});

describe('yearFromIso', () => {
  it('reads the calendar year', () => {
    expect(yearFromIso('2020-07-01T14:23:00.000Z')).toBe(2020);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && pnpm exec vitest run src/lib/utils/game.spec.ts`

Expected: FAIL — cannot resolve `$lib/utils/game`.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/utils/game.ts`:

```ts
/** Points a perfect guess earns. Mirrors MAX_ROUND_SCORE on the server. */
export const MAX_ROUND_SCORE = 5000;

/**
 * Human-readable distance. Precision shrinks as distance grows: metres are
 * meaningful for a near-miss, decimals are noise at continental scale.
 */
export const formatDistanceKm = (km: number): string => {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  if (km < 10) {
    return `${km.toFixed(1)} km`;
  }
  return `${Math.round(km).toLocaleString()} km`;
};

/** Score as a 0-100 bar width, clamped so a bad value cannot overflow the bar. */
export const scorePercent = (score: number): number =>
  Math.max(0, Math.min(100, Math.round((100 * score) / MAX_ROUND_SCORE)));

export const yearFromIso = (iso: string): number => new Date(iso).getUTCFullYear();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && pnpm exec vitest run src/lib/utils/game.spec.ts`

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/utils/game.ts web/src/lib/utils/game.spec.ts
git commit -m "feat(web): add game formatting helpers"
```

---

## Task 3: Challenge card

**Files:**

- Create: `web/src/lib/components/games/challenge-card.svelte`
- Test: `web/src/lib/components/games/challenge-card.spec.ts`

**Interfaces:**

- Consumes: `$t` for the keys from Task 1.
- Produces: a component taking

```ts
type Props = {
  name: string;
  roundCount: number;
  answered: number;
  href: string;
  onDelete?: () => void; // omitted for non-editors
};
```

It renders `data-testid="challenge-card"`, and a delete control with `data-testid="challenge-card-delete"` **only when `onDelete` is provided**.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/components/games/challenge-card.spec.ts`:

```ts
import { render, screen } from '@testing-library/svelte';
import ChallengeCard from '$lib/components/games/challenge-card.svelte';

describe('ChallengeCard', () => {
  const base = { name: 'Summer', roundCount: 5, answered: 0, href: '/x' };

  it('renders the challenge name', () => {
    render(ChallengeCard, base);
    expect(screen.getByTestId('challenge-card')).toBeInTheDocument();
    expect(screen.getByText('Summer')).toBeInTheDocument();
  });

  it('shows a delete control when a delete handler is supplied', () => {
    render(ChallengeCard, { ...base, onDelete: () => {} });
    expect(screen.getByTestId('challenge-card-delete')).toBeInTheDocument();
  });

  // Proves the negative honestly: the positive case above shows the control CAN
  // render, so its absence here is a real signal rather than a always-null query.
  it('hides the delete control for a viewer', () => {
    render(ChallengeCard, base);
    expect(screen.queryByTestId('challenge-card-delete')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && pnpm exec vitest run src/lib/components/games/challenge-card.spec.ts`

Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the component**

Create `web/src/lib/components/games/challenge-card.svelte` using Svelte 5 runes (`let { name, roundCount, answered, href, onDelete }: Props = $props();`). It links to `href`, shows the name, shows progress using the `game_leaderboard_answered` key with `{answered}` / `{total}`, and renders the delete button only when `onDelete` is set. Model the markup and classes on an existing card in `web/src/lib/components/spaces/` so it matches house style. Add the two `data-testid`s the test requires.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && pnpm exec vitest run src/lib/components/games/challenge-card.spec.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/games/challenge-card.svelte web/src/lib/components/games/challenge-card.spec.ts
git commit -m "feat(web): add the game challenge card"
```

---

## Task 4: Round photo surface

**Files:**

- Create: `web/src/lib/components/games/round-photo.svelte`

**Interfaces:**

- Produces:

```ts
type Props = {
  challengeId: string;
  index: number;
  alt: string;
  dimmed?: boolean; // the result view dims the photo behind the reveal
};
```

The image `src` is the round-image endpoint for `(challengeId, index)`. **Never** construct a URL containing an asset id — the endpoint is keyed by challenge and round index precisely so the client never learns which asset it is (spec §6).

- [ ] **Step 1: Find how the app builds an authenticated asset URL**

Read how an existing component sources an image from the API (for example the space hero or a person thumbnail) and follow that convention — whether it uses a helper that appends credentials, a plain relative `/api/...` path, or the SDK's URL builder. Use the same mechanism; do not invent one.

- [ ] **Step 2: Implement the component**

`object-fit: cover`, fills its container, `alt` from the caller. When `dimmed` is true apply a brightness filter so overlaid text stays legible. No `ghost`-variant controls over the photo (see Global Constraints).

- [ ] **Step 3: Typecheck**

Run: `cd web && pnpm check:svelte`

Expected: no errors — **and confirm from the output that it actually scanned files**; a run over 0 files is not a pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/components/games/round-photo.svelte
git commit -m "feat(web): add the round photo surface"
```

---

## Task 5: Location round

**Files:**

- Create: `web/src/lib/components/games/location-round.svelte`
- Test: `web/src/lib/components/games/location-round.spec.ts`

**Interfaces:**

- Consumes: `round-photo.svelte` (Task 4); `Map.svelte`.
- Produces:

```ts
type Props = {
  challengeId: string;
  index: number;
  onGuess: (point: { lat: number; lon: number }) => void;
};
```

Renders `data-testid="location-round"`; the guess button is `data-testid="location-round-guess"` and is **disabled until a pin is placed**.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/components/games/location-round.spec.ts`:

```ts
import { render, screen } from '@testing-library/svelte';
import LocationRound from '$lib/components/games/location-round.svelte';

// Map.svelte pulls in maplibre-gl, which needs a WebGL canvas happy-dom lacks.
// This is the repo's canonical incantation - copied verbatim from
// src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts:58-61.
// Note the @test-data ALIAS; a relative path to the stub does not resolve.
vi.mock('$lib/components/shared-components/map/Map.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/map-component.stub.svelte');
  return { default: MockComponent };
});

describe('LocationRound', () => {
  const base = { challengeId: 'c1', index: 0, onGuess: () => {} };

  it('renders the round surface', () => {
    render(LocationRound, base);
    expect(screen.getByTestId('location-round')).toBeInTheDocument();
  });

  it('disables the guess button until a pin is placed', () => {
    render(LocationRound, base);
    expect(screen.getByTestId('location-round-guess')).toBeDisabled();
  });
});
```

The mock above is **verified**, not a guess: it is copied from `map-page.spec.ts:58-61`, and the same pattern appears in `detail-panel.spec.ts` and `contextual-filter-p1.spec.ts`. Use it as written.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && pnpm exec vitest run src/lib/components/games/location-round.spec.ts`

Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the component**

Compose `round-photo.svelte` with `Map.svelte`:

```svelte
<Map clickable useLocationPin simplified rounded showSimpleControls={false}
     onClickPoint={({ lat, lng }) => (pin = { lat, lon: lng })} />
```

Note the axis name change: `Map.svelte` emits `lng`, the game's API takes `lon`. Hold the pin in `$state`, keep the guess button disabled while `pin` is undefined, and call `onGuess(pin)` on click. The map sits as an inset over the photo per the approved mockup; use the `game_place_your_pin` key as its hint and `game_guess` on the button.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && pnpm exec vitest run src/lib/components/games/location-round.spec.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/games/location-round.svelte web/src/lib/components/games/location-round.spec.ts
git commit -m "feat(web): add the location round"
```

---

## Task 6: Date round

**Files:**

- Create: `web/src/lib/components/games/date-round.svelte`
- Test: `web/src/lib/components/games/date-round.spec.ts`

**Interfaces:**

- Consumes: `round-photo.svelte`; `yearFromIso` from Task 2.
- Produces:

```ts
type Props = {
  challengeId: string;
  index: number;
  minYear: number;
  maxYear: number;
  onGuess: (isoDate: string) => void;
};
```

Renders `data-testid="date-round"`, a range input `data-testid="date-round-slider"`, and a guess button `data-testid="date-round-guess"`.

**The emitted value must be a UTC calendar day** — the server scores by UTC day index, so send midnight UTC for the chosen year (e.g. `new Date(Date.UTC(year, 0, 1)).toISOString()`). Sending a local-midnight value silently loses a day.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/components/games/date-round.spec.ts`:

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import DateRound from '$lib/components/games/date-round.svelte';

describe('DateRound', () => {
  const base = { challengeId: 'c1', index: 0, minYear: 2009, maxYear: 2026 };

  it('renders the timeline', () => {
    render(DateRound, { ...base, onGuess: () => {} });
    expect(screen.getByTestId('date-round')).toBeInTheDocument();
    expect(screen.getByTestId('date-round-slider')).toBeInTheDocument();
  });

  it('emits a UTC calendar day for the selected year', async () => {
    const onGuess = vi.fn();
    render(DateRound, { ...base, onGuess });

    await userEvent.click(screen.getByTestId('date-round-guess'));

    expect(onGuess).toHaveBeenCalledTimes(1);
    const iso = onGuess.mock.calls[0][0] as string;
    // Must be midnight UTC - the server scores by UTC day index, so a local
    // midnight would silently land on the previous or next day.
    expect(iso).toMatch(/T00:00:00\.000Z$/);
    expect(new Date(iso).getUTCFullYear()).toBeGreaterThanOrEqual(2009);
    expect(new Date(iso).getUTCFullYear()).toBeLessThanOrEqual(2026);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && pnpm exec vitest run src/lib/components/games/date-round.spec.ts`

Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the component**

A native `<input type="range">` bound to a `$state` year, defaulting to the midpoint of `[minYear, maxYear]`. Show the selected year above the handle and tick labels at both ends, per the approved mockup. On guess, emit `new Date(Date.UTC(year, 0, 1)).toISOString()`. Use `game_guess_year` for the button label.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && pnpm exec vitest run src/lib/components/games/date-round.spec.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/games/date-round.svelte web/src/lib/components/games/date-round.spec.ts
git commit -m "feat(web): add the date round"
```

---

## Task 7: Round result and leaderboard

**Files:**

- Create: `web/src/lib/components/games/round-result.svelte`
- Create: `web/src/lib/components/games/game-leaderboard.svelte`
- Test: `web/src/lib/components/games/round-result.spec.ts`
- Test: `web/src/lib/components/games/game-leaderboard.spec.ts`

**Interfaces:**

- Consumes: `formatDistanceKm`, `scorePercent` (Task 2); `Map.svelte`.
- Produces:

```ts
// round-result.svelte
type Props = {
  type: 'location' | 'date';
  score: number;
  distanceKm?: number; // location rounds
  offsetDays?: number; // date rounds
  answerLabel: string; // e.g. "Colchester, South Africa - March 2026"
  guess?: { lat: number; lon: number };
  answer?: { lat: number; lon: number };
  onNext: () => void;
};

// game-leaderboard.svelte
type Props = {
  entries: Array<{ userId: string; name: string | null; total: number; answered: number }>;
  roundCount: number;
};
```

`round-result` renders `data-testid="round-result"` and a score bar `data-testid="round-result-bar"` whose width is `scorePercent(score)`. For a location round it shows a `Map.svelte` with both markers, `autoFitBounds` so the view frames guess and answer together. `game-leaderboard` renders `data-testid="game-leaderboard"` and one `data-testid="leaderboard-row"` per entry.

- [ ] **Step 1: Write the failing tests**

`round-result.spec.ts` must cover: renders for a location round with the distance text; renders for a date round with the offset text; and the score bar width tracks the score (assert `0` → `0%` and `5000` → `100%`, so a hardcoded width fails). Mock `Map.svelte` the same way Task 5 does.

`game-leaderboard.spec.ts` must cover: one row per entry; and that a `null` name renders a fallback rather than the literal string "null" — the server deliberately returns `null` for a departed member so the client localises it.

Write the actual assertions using `screen.getByTestId` / `getAllByTestId`, following the Task 3 and Task 6 test style.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm exec vitest run src/lib/components/games/round-result.spec.ts src/lib/components/games/game-leaderboard.spec.ts`

Expected: FAIL — components do not exist.

- [ ] **Step 3: Implement both components**

`round-result`: score prominent, bar width from `scorePercent`, distance via `formatDistanceKm` (`game_you_were_away`) or the day offset (`game_you_were_off`), the actual answer via `game_actual`, and a `game_next_round` button. `game-leaderboard`: a simple ordered table using `game_leaderboard` and `game_leaderboard_answered`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && pnpm exec vitest run src/lib/components/games/round-result.spec.ts src/lib/components/games/game-leaderboard.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/games/
git commit -m "feat(web): add the round result and leaderboard"
```

---

## Task 8: Challenge list route

**Files:**

- Create: `web/src/routes/(user)/spaces/[spaceId]/games/+page.ts`
- Create: `web/src/routes/(user)/spaces/[spaceId]/games/+page.svelte`

**Interfaces:**

- Consumes: `challenge-card.svelte` (Task 3); `getChallenges`, `createChallenge`, `deleteChallenge` from `@immich/sdk`.

- [ ] **Step 1: Read the sibling routes first**

Open `web/src/routes/(user)/spaces/[spaceId]/albums/+page.ts` and `+page.svelte` (and the `members` route). Follow their conventions exactly for: the `load` function's shape and error handling, how the page title is set, how the space's `currentUserRole` reaches the page, and how a create action opens a modal and refreshes. **Do not invent a pattern these files already establish.**

- [ ] **Step 2: Implement the load function**

`+page.ts` loads the space's challenges via `getChallenges({ spaceId: params.spaceId })`, following the sibling route's error convention.

- [ ] **Step 3: Implement the page**

Renders a `challenge-card` per challenge linking to `./games/{id}`. Empty state uses `game_no_challenges` / `game_no_challenges_description`. A "new challenge" action calls `createChallenge` and navigates to the new challenge.

**Gate create and delete on the editor role**, matching how the sibling space routes decide whether to show an editing affordance — the server enforces it regardless, so the UI must simply not offer what will 403. Pass `onDelete` to `challenge-card` only for editors.

Handle the two documented server responses: a `400` when the space has no usable photos → show `game_create_failed`; and a challenge whose `roundCount` came back lower than requested → show `game_rounds_fewer_than_requested`.

- [ ] **Step 4: Verify**

Run:

```bash
cd web && pnpm check:svelte
cd web && pnpm check:typescript
```

Expected: clean, and confirm `check:svelte` actually scanned files.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/\(user\)/spaces/\[spaceId\]/games/
git commit -m "feat(web): add the challenge list page"
```

---

## Task 9: Play route

**Files:**

- Create: `web/src/routes/(user)/spaces/[spaceId]/games/[challengeId]/+page.ts`
- Create: `web/src/routes/(user)/spaces/[spaceId]/games/[challengeId]/+page.svelte`

**Interfaces:**

- Consumes: every component from Tasks 4–7; `getChallenge`, `guessRound`, `getLeaderboard` from `@immich/sdk`.

This is the only stateful piece. It owns: which round is current, which rounds are already guessed, and the result being shown.

- [ ] **Step 1: Implement the load function**

`+page.ts` loads `getChallenge({ id: params.challengeId })`. That response already tells you which rounds the caller has answered — a round carries `answer`/`score` only once guessed (spec §6). Derive the first unanswered index from that; do not track it client-side across reloads.

- [ ] **Step 2: Implement the play page**

- Render `location-round` or `date-round` by the current round's `type`.
- On guess, call `guessRound({ id, index, gameGuessDto })` — `{ lat, lon }` for a location round, `{ date }` for a date round — then show `round-result` with the response's `score`, `distanceKm`/`offsetDays`, and the revealed answer.
- `game_next_round` advances; after the last round show `game-leaderboard` from `getLeaderboard({ id })`.
- Show progress with `game_round_progress`.
- Derive `minYear`/`maxYear` for `date-round` from the challenge's own data rather than hardcoding.
- **A duplicate guess returns 409.** That happens when a page is left open and replayed. Treat it as "already answered": reload the challenge and move on rather than surfacing a raw error.
- Responsive by requirement — a phone browser is the expected device.

- [ ] **Step 3: Verify**

Run:

```bash
cd web && pnpm check:svelte
cd web && pnpm check:typescript
cd web && pnpm exec vitest run
```

Expected: all clean; the web suite passes with no regressions.

- [ ] **Step 4: Commit**

```bash
git add web/src/routes/\(user\)/spaces/\[spaceId\]/games/
git commit -m "feat(web): add the play page"
```

---

## Task 10: Entry point and final gate

**Files:**

- Modify: whichever space navigation component lists a space's sections

- [ ] **Step 1: Add the games entry point**

Find how the space route tree surfaces its sections (albums, members, people, activity) in navigation and add a Games entry the same way, using `game_challenges`. Read the existing component first; do not add a bespoke navigation mechanism.

- [ ] **Step 2: Full verification**

Run each and confirm clean:

```bash
cd web && pnpm exec vitest run
cd web && pnpm check:typescript
cd web && pnpm check:svelte
cd web && pnpm lint
cd web && pnpm format
npx prettier --check i18n/*.json
```

`check:svelte` must report having scanned files.

- [ ] **Step 3: Confirm scope**

Run: `git diff --stat 690fd44e12c..HEAD -- web/ i18n/`

Expected: only the files this plan names. Anything else needs justifying.

- [ ] **Step 4: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore(web): formatting"
```

---

## Self-Review Notes

**Spec coverage.** §4.4 web routes → Tasks 8, 9, 10. The approved mockup's location round → Task 5; date round → Task 6; result screen → Task 7; challenge list → Tasks 3, 8. §6 answer-withholding is respected by Task 4 (image keyed by challenge+index, never asset id) and Task 9 (answers come only from the server's post-guess response). §8 scoring is display-only here — the client never computes a score, it renders what the server returned. i18n obligations from `CLAUDE.md` → Task 1.

**Deliberately not in this plan:** live/synchronous play (spec §11 defers it), a Flutter client (§11), and themed challenges (§11).

**Resolved during self-review:** Task 5's `Map.svelte` mock was initially written with a relative import path, which does not resolve. The repo's canonical form uses the `@test-data` alias (`map-page.spec.ts:58-61`, also `detail-panel.spec.ts`, `contextual-filter-p1.spec.ts`); the plan now carries that verbatim. Every other file path the plan tells an implementer to read was confirmed to exist.
