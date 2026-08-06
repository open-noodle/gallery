# Pi Agent Trip Candidate Detection Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conservative place-hint filtering to trip candidate detection so prompts like "recent trip to USA" can narrow trip windows without asking for dates.

**Architecture:** Keep place matching metadata-only and deterministic. Add a small place-hint normalization helper for exact normalized metadata matching and country aliases, then wire it into `TripCandidateService` before candidate scoring. Do not add MCP DTOs, selection handles, summaries, or geocoding in this slice; Slice 5 converts empty service results into model-facing response summaries.

**Tech Stack:** TypeScript, Luxon, Vitest unit tests, existing trip candidate service patterns.

---

## Scope

Spec: `docs/superpowers/specs/2026-05-28-pi-agent-trip-candidate-detection-design.md`

Slice 4 implements:

- `TripCandidateRequest.placeHint?: string`.
- Conservative normalization for place labels: trim, lowercase, remove diacritics, collapse punctuation/spacing.
- Accepted USA country aliases: `USA`, `US`, `U.S.`, `U.S.A.`, `United States`, and `United States of America`.
- Place hints match existing metadata country, state, or city labels only. No external geocoding and no inferred coordinates.
- Hints are applied before candidate scoring:
  - non-matching buckets/clusters are ignored;
  - matching buckets can be candidates even when they are in the home country;
  - matching home-city candidates are downgraded to `medium` confidence.
- Unknown valid hints return no candidates instead of throwing.
- Overlong hints are rejected before repository calls and return no candidates.

Out of scope:

- No MCP read tool or response summary. Slice 5 maps `[]` from a hinted search to the user-facing "no matching trip found" response.
- No selection handle creation.
- No prompt integration.
- No geocoding, fuzzy search, or semantic place matching.

## Files

- Create: `server/src/services/trip-place-hint.ts`
- Create: `server/src/services/trip-place-hint.spec.ts`
- Modify: `server/src/services/trip-candidate.service.ts`
- Modify: `server/src/services/trip-candidate.service.spec.ts`

## Baseline Commands

- [ ] **Step 1: Verify Slice 3 baseline**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-place-hint.spec.ts src/services/trip-candidate.service.spec.ts --run
```

Expected: FAIL only because `src/services/trip-place-hint.spec.ts` does not exist yet. Then run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-candidate.service.spec.ts --run
```

Expected: PASS with the current Slice 3 trip candidate tests.

## Task 1: Add Place-Hint Normalization Helper

**Files:**

- Create: `server/src/services/trip-place-hint.spec.ts`
- Create: `server/src/services/trip-place-hint.ts`

- [ ] **Step 1: Add failing helper tests**

Create `server/src/services/trip-place-hint.spec.ts`:

```ts
import {
  TRIP_PLACE_HINT_MAX_LENGTH,
  normalizeTripPlaceLabel,
  parseTripPlaceHint,
  tripPlaceMatchesHint,
} from 'src/services/trip-place-hint';

describe('trip place hints', () => {
  it('normalizes place labels conservatively', () => {
    expect(normalizeTripPlaceLabel('  París, Île-de-France!!  ')).toBe('paris ile de france');
  });

  it('treats empty hints as absent', () => {
    expect(parseTripPlaceHint(undefined)).toEqual({ status: 'none' });
    expect(parseTripPlaceHint('   ')).toEqual({ status: 'none' });
  });

  it('rejects overlong hints after trimming', () => {
    expect(parseTripPlaceHint('x'.repeat(TRIP_PLACE_HINT_MAX_LENGTH + 1))).toEqual({
      status: 'invalid',
      reason: 'too_long',
    });
  });

  it('matches USA aliases against country metadata equivalents', () => {
    const usa = parseTripPlaceHint('U.S.A.');
    const unitedStates = parseTripPlaceHint('United States');

    expect(usa.status).toBe('valid');
    expect(unitedStates.status).toBe('valid');

    if (usa.status !== 'valid' || unitedStates.status !== 'valid') {
      throw new Error('expected valid hints');
    }

    expect(tripPlaceMatchesHint({ country: 'United States of America' }, usa.hint)).toBe(true);
    expect(tripPlaceMatchesHint({ country: 'USA' }, unitedStates.hint)).toBe(true);
  });

  it('matches exact normalized city labels without geocoding unknown names', () => {
    const paris = parseTripPlaceHint('paris');
    const atlantis = parseTripPlaceHint('Atlantis');

    expect(paris.status).toBe('valid');
    expect(atlantis.status).toBe('valid');

    if (paris.status !== 'valid' || atlantis.status !== 'valid') {
      throw new Error('expected valid hints');
    }

    expect(tripPlaceMatchesHint({ country: 'France', city: 'Paris' }, paris.hint)).toBe(true);
    expect(tripPlaceMatchesHint({ country: 'France', city: 'Paris' }, atlantis.hint)).toBe(false);
  });
});
```

- [ ] **Step 2: Run helper tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-place-hint.spec.ts --run
```

Expected: FAIL because `src/services/trip-place-hint` does not exist.

- [ ] **Step 3: Implement the helper**

Create `server/src/services/trip-place-hint.ts`:

```ts
export const TRIP_PLACE_HINT_MAX_LENGTH = 80;

export interface TripPlaceHint {
  raw: string;
  normalized: string;
  aliases: string[];
}

export type TripPlaceHintParseResult =
  | { status: 'none' }
  | { status: 'invalid'; reason: 'too_long' }
  | { status: 'valid'; hint: TripPlaceHint };

type PlaceLike = {
  country?: string | null;
  state?: string | null;
  city?: string | null;
};

const UNITED_STATES_ALIASES = [
  'us',
  'u s',
  'usa',
  'u s a',
  'united states',
  'united states america',
  'united states of america',
];

const COUNTRY_ALIAS_GROUPS = [UNITED_STATES_ALIASES];

export const normalizeTripPlaceLabel = (value: string) => {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
};

const expandAliases = (normalized: string) => {
  const aliasGroup = COUNTRY_ALIAS_GROUPS.find((group) => group.includes(normalized));
  return aliasGroup ?? [normalized];
};

const uniqueValues = (values: string[]) => [...new Set(values)];

export const parseTripPlaceHint = (placeHint?: string): TripPlaceHintParseResult => {
  const raw = placeHint?.trim();
  if (!raw) {
    return { status: 'none' };
  }

  if (raw.length > TRIP_PLACE_HINT_MAX_LENGTH) {
    return { status: 'invalid', reason: 'too_long' };
  }

  const normalized = normalizeTripPlaceLabel(raw);
  if (!normalized) {
    return { status: 'none' };
  }

  return {
    status: 'valid',
    hint: {
      raw,
      normalized,
      aliases: uniqueValues(expandAliases(normalized)),
    },
  };
};

export const tripPlaceMatchesHint = (place: PlaceLike, hint: TripPlaceHint) => {
  const countryAliases = place.country ? expandAliases(normalizeTripPlaceLabel(place.country)) : [];
  const stateAndCityAliases = [place.state, place.city]
    .filter((value): value is string => !!value)
    .map((value) => normalizeTripPlaceLabel(value));

  return [...countryAliases, ...stateAndCityAliases].some((alias) => hint.aliases.includes(alias));
};
```

- [ ] **Step 4: Run helper tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-place-hint.spec.ts --run
```

Expected: PASS.

## Task 2: Add Place-Hint Service Tests

**Files:**

- Modify: `server/src/services/trip-candidate.service.spec.ts`

- [ ] **Step 1: Add failing service tests**

Update the import at the top of `server/src/services/trip-candidate.service.spec.ts`:

```ts
import { TRIP_PLACE_HINT_MAX_LENGTH } from 'src/services/trip-place-hint';
import { TripCandidateService } from 'src/services/trip-candidate.service';
```

Append these tests to `describe(TripCandidateService.name, () => { ... })` before the album-ready materialization tests:

```ts
it('matches USA place hints against accepted country metadata equivalents', async () => {
  const { assetRepository, service } = setup();
  assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
    cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
  ]);
  assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
    dayBucket({
      localDate: '2026-04-15',
      country: 'United States of America',
      state: 'New York',
      city: 'New York',
      assetCount: 4,
    }),
    dayBucket({
      localDate: '2026-04-16',
      country: 'United States of America',
      state: 'New York',
      city: 'New York',
      assetCount: 4,
    }),
  ]);

  const [candidate] = await service.findRecentTripCandidates({
    ownerId: 'user-1',
    targetDate: new Date('2026-04-23T12:00:00Z'),
    placeHint: 'USA',
  });

  expect(candidate).toMatchObject({
    title: 'Recent trip to New York, United States of America',
    countries: ['United States of America'],
    cities: ['New York'],
    confidence: 'high',
  });
});

it('filters trip windows by city hints without geocoding', async () => {
  const { assetRepository, service } = setup();
  assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
    cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
  ]);
  assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
    dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 4 }),
    dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 4 }),
    dayBucket({ localDate: '2026-04-17', country: 'Italy', city: 'Rome', assetCount: 4 }),
    dayBucket({ localDate: '2026-04-18', country: 'Italy', city: 'Rome', assetCount: 4 }),
  ]);

  const candidates = await service.findRecentTripCandidates({
    ownerId: 'user-1',
    targetDate: new Date('2026-04-23T12:00:00Z'),
    maxCandidates: 3,
    placeHint: 'Paris',
  });

  expect(candidates.map(({ dedupeKey }) => dedupeKey)).toEqual(['trip:france:paris:2026-04-15:2026-04-16']);
});

it('returns no candidates for unknown place hints instead of throwing', async () => {
  const { assetRepository, service } = setup();
  assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
    cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
  ]);
  assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
    dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 4 }),
    dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 4 }),
  ]);

  await expect(
    service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
      placeHint: 'Atlantis',
    }),
  ).resolves.toEqual([]);
});

it('allows place hints to find home-city trips with medium confidence', async () => {
  const { assetRepository, service } = setup();
  assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
    cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
  ]);
  assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
    dayBucket({ localDate: '2026-04-15', country: 'Germany', city: 'Berlin', assetCount: 4 }),
    dayBucket({ localDate: '2026-04-16', country: 'Germany', city: 'Berlin', assetCount: 4 }),
  ]);

  const [candidate] = await service.findRecentTripCandidates({
    ownerId: 'user-1',
    targetDate: new Date('2026-04-23T12:00:00Z'),
    placeHint: 'Berlin',
  });

  expect(candidate).toMatchObject({
    title: 'Recent trip to Berlin, Germany',
    assetCount: 8,
    dayCount: 2,
    confidence: 'medium',
    score: 58,
  });
});

it('rejects overlong place hints before repository calls', async () => {
  const { assetRepository, service } = setup();

  await expect(
    service.findRecentTripCandidates({
      ownerId: 'user-1',
      placeHint: 'x'.repeat(TRIP_PLACE_HINT_MAX_LENGTH + 1),
    }),
  ).resolves.toEqual([]);

  expect(assetRepository.getMemoryLocationClusters).not.toHaveBeenCalled();
  expect(assetRepository.getMemoryLocationDayBuckets).not.toHaveBeenCalled();
});

it('filters fallback recent clusters by place hints when day buckets are unavailable', async () => {
  const assetRepository = {
    getMemoryLocationClusters: vi
      .fn()
      .mockResolvedValueOnce([cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 })])
      .mockResolvedValueOnce([
        cluster({ country: 'France', city: 'Paris', assetCount: 8, dayCount: 2 }),
        cluster({ country: 'Italy', city: 'Rome', assetCount: 8, dayCount: 2 }),
      ]),
  };
  const service = new TripCandidateService(assetRepository);

  const candidates = await service.findRecentTripCandidates({
    ownerId: 'user-1',
    targetDate: new Date('2026-04-23T12:00:00Z'),
    placeHint: 'Rome',
  });

  expect(candidates.map(({ dedupeKey }) => dedupeKey)).toEqual(['trip:italy:rome:2026-04-15:2026-04-17']);
});
```

- [ ] **Step 2: Run service tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-candidate.service.spec.ts --run
```

Expected: FAIL because `placeHint` is not implemented and `medium` scoring is not handled.

## Task 3: Wire Place Hints Into TripCandidateService

**Files:**

- Modify: `server/src/services/trip-candidate.service.ts`

- [ ] **Step 1: Add imports and request field**

Add the helper imports:

```ts
import { parseTripPlaceHint, tripPlaceMatchesHint } from 'src/services/trip-place-hint';
import type { TripPlaceHint } from 'src/services/trip-place-hint';
```

Add `placeHint?: string;` to `TripCandidateRequest`:

```ts
export interface TripCandidateRequest {
  ownerId: string;
  targetDate?: Date;
  lookbackDays?: number;
  baselineDays?: number;
  maxCandidates?: number;
  placeHint?: string;
}
```

- [ ] **Step 2: Parse and reject hints before repository calls**

Update the `findRecentTripCandidates` parameter list:

```ts
  async findRecentTripCandidates({
    ownerId,
    targetDate,
    lookbackDays = 30,
    baselineDays = 90,
    maxCandidates = 3,
    placeHint,
  }: TripCandidateRequest): Promise<TripCandidate[]> {
```

At the top of `findRecentTripCandidates`, before date math and repository calls, add:

```ts
const parsedPlaceHint = parseTripPlaceHint(placeHint);
if (parsedPlaceHint.status === 'invalid') {
  return [];
}
const matchedPlaceHint = parsedPlaceHint.status === 'valid' ? parsedPlaceHint.hint : undefined;
```

- [ ] **Step 3: Pass hints into candidate builders**

Replace the candidate construction block with:

```ts
const candidates = Array.isArray(dayBuckets)
  ? this.findWindowCandidates(dayBuckets, home, matchedPlaceHint)
  : this.findClusterCandidates(
      await this.assetRepository.getMemoryLocationClusters(ownerId, recentRange),
      home,
      matchedPlaceHint,
    );
```

Update method signatures:

```ts
  private findClusterCandidates(
    recent: MemoryLocationCluster[],
    home: HomeBaseline,
    placeHint?: TripPlaceHint,
  ): TripCandidate[] {
```

```ts
  private findWindowCandidates(
    recent: MemoryLocationDayBucket[],
    home: HomeBaseline,
    placeHint?: TripPlaceHint,
  ): TripCandidate[] {
```

- [ ] **Step 4: Filter cluster candidates by hints and confidence**

Replace `findClusterCandidates` with:

```ts
  private findClusterCandidates(
    recent: MemoryLocationCluster[],
    home: HomeBaseline,
    placeHint?: TripPlaceHint,
  ): TripCandidate[] {
    return recent
      .filter((item) => this.isQualifyingCluster(item))
      .filter((item) => !placeHint || this.matchesPlaceHint(item, placeHint))
      .filter((item) => !!placeHint || !home.cluster || home.ambiguous || this.isAwayFromHome(item, home.cluster))
      .map((item) => this.toClusterTripCandidate(item, this.getPlaceConfidence(item, home, placeHint)));
  }
```

- [ ] **Step 5: Filter day buckets by hints before travel-window scoring**

Replace the top of `findWindowCandidates` through `travelBuckets` creation with:

```ts
  private findWindowCandidates(
    recent: MemoryLocationDayBucket[],
    home: HomeBaseline,
    placeHint?: TripPlaceHint,
  ): TripCandidate[] {
    const qualifyingBuckets = recent
      .filter((item) => this.isQualifyingTravelBucket(item))
      .filter((item) => !placeHint || this.matchesPlaceHint(item, placeHint))
      .toSorted(
        (left, right) => left.localDate.getTime() - right.localDate.getTime() || right.assetCount - left.assetCount,
      );
    const blockedGapDayKeys = new Set<string>();
    const travelBuckets = qualifyingBuckets.filter((item) => {
      if (placeHint || this.isTravelBucket(item, home)) {
        return true;
      }

      blockedGapDayKeys.add(this.dayKey(item.localDate));
      return false;
    });

    return this.buildTravelWindows(travelBuckets, blockedGapDayKeys)
      .filter((window) => window.assetCount >= 7 && window.dayKeys.size >= 2)
      .map((window) => this.toWindowTripCandidate(window, this.getWindowConfidence(window, home, placeHint)));
  }
```

- [ ] **Step 6: Add hint and confidence helpers**

Add these private methods before `isQualifyingTravelBucket`:

```ts
  private matchesPlaceHint(place: { country: string | null; state?: string | null; city: string | null }, hint: TripPlaceHint) {
    return tripPlaceMatchesHint(place, hint);
  }

  private getWindowConfidence(
    window: TravelWindow,
    home: HomeBaseline,
    placeHint?: TripPlaceHint,
  ): TripCandidateConfidence {
    if (home.ambiguous) {
      return 'low';
    }

    if (placeHint && window.places.some((place) => this.overlapsHomePlace(place, home.cluster))) {
      return 'medium';
    }

    return 'high';
  }

  private getPlaceConfidence(
    place: { country: string | null; city: string | null },
    home: HomeBaseline,
    placeHint?: TripPlaceHint,
  ): TripCandidateConfidence {
    if (home.ambiguous) {
      return 'low';
    }

    if (placeHint && this.overlapsHomePlace(place, home.cluster)) {
      return 'medium';
    }

    return 'high';
  }

  private overlapsHomePlace(
    place: { country: string | null; city?: string | null },
    home?: { country: string | null; city: string | null },
  ) {
    if (!home?.country || place.country !== home.country) {
      return false;
    }

    if (home.city && place.city) {
      return place.city === home.city;
    }

    return true;
  }
```

- [ ] **Step 7: Score medium-confidence candidates lower than high confidence**

Replace `scoreCandidate` with:

```ts
  private scoreCandidate(item: { assetCount: number; dayCount: number }, confidence: TripCandidateConfidence) {
    const baseScore = 50 + item.dayCount * 5 + Math.min(item.assetCount, 20);
    if (confidence === 'low') {
      return Math.max(1, baseScore - 20);
    }

    if (confidence === 'medium') {
      return Math.max(1, baseScore - 10);
    }

    return baseScore;
  }
```

- [ ] **Step 8: Run service tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-place-hint.spec.ts src/services/trip-candidate.service.spec.ts --run
```

Expected: PASS.

## Task 4: Verify Slice 4 And Commit

**Files:**

- Verify all files from Tasks 1-3.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/trip-place-hint.spec.ts src/services/trip-candidate.service.spec.ts src/services/memory-rules/recent-trip.rule.spec.ts --run
```

Expected: PASS.

- [ ] **Step 2: Run memory service regression tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/memory.service.spec.ts --run
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript and whitespace checks**

Run:

```bash
pnpm --dir server check
git diff --check
```

Expected: PASS and no whitespace output.

- [ ] **Step 4: Commit Slice 4**

Run:

```bash
git add server/src/services/trip-place-hint.ts server/src/services/trip-place-hint.spec.ts server/src/services/trip-candidate.service.ts server/src/services/trip-candidate.service.spec.ts
git commit -m "feat: filter trip candidates by place hint"
```

Expected: one commit containing only Slice 4 implementation and tests.

## Plan Self-Review

- Spec coverage: Slice 4 tests cover USA aliases, city metadata hints without geocoding, unknown valid hints returning no candidates, home-city hints with lower confidence, overlong hint rejection before repository calls, and fallback cluster filtering.
- Scope control: This does not create MCP DTOs, response summaries, selection handles, prompt integration, geocoding, or fuzzy matching.
- TDD: Helper and service behaviors start with failing tests, then minimal implementation, then focused green verification.
- Type consistency: `TripCandidateRequest.placeHint` maps to `parseTripPlaceHint`; service internals use `TripPlaceHint`, and existing `TripCandidate` response shape is unchanged.
- Placeholder scan: no forbidden placeholder language remains.
