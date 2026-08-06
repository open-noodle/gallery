# Pi Agent Workflow Expansion (Phase 2) — Slice 7 Implementation Plan

> **For agentic workers:** Implement test-first. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `update_asset_metadata` (hybrid) router — `match()` + `parseSlots()` —
that extracts a metadata FIELD + VALUE and a loose-asset `sourceDescription`, declining
album/space refs (owned by `rename_or_describe_*`), subjective/recent-trip sources,
unsupported fields, and place-name-only location prompts. `run()` is a stub here (full
execution in Slice 8); the workflow is registered in Slice 9.

**Spec scope:** Slice 7 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Tech stack:** Node.js ESM, `node:test`, `mise exec -- pnpm --dir agent-runner test`.

**Files (new):**

- `agent-runner/src/strict-workflows/workflows/update-asset-metadata.mjs`
- `agent-runner/src/strict-workflows/workflows/update-asset-metadata.test.mjs`

## Slot flow (verified)

`dispatcher.mjs` calls `wf.parseSlots(decision.slots, prompt)` for BOTH the regex path
(`decision.slots = match().slots`) and the LLM path, then `run({ slots })`. So
`parseSlots` is the universal normalizer: it must accept the typed `match()` output
(`{ field, description|rating|timeZone|latitude+longitude, sourceDescription }`) AND the
LLM form (`{ field, value, sourceDescription }`), and return `{ sourceDescription,
payload }` (the shape `run()` consumes) or `null`.

The loose-asset gate is the INVERSE of `rename_or_describe_album.looksLikeLooseAssetReference`:
here we REQUIRE a loose-asset reference and DECLINE album/space.

## Implementation — full module

Create `update-asset-metadata.mjs`:

```js
import { SUBJECTIVE_PATTERN, parseDateRange } from '../asset-source-resolver.mjs';
import { handoffOpen } from '../protocol.mjs';

const KIND = 'update_asset_metadata';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) =>
  clean(value)
    .replace(/[.?!]+$/u, '')
    .trim();
const stripQuotes = (value) =>
  clean(value)
    .replace(/^["'“”‘’]+/, '')
    .replace(/["'“”‘’]+$/, '')
    .trim();

const tripSourcePattern = /\brecent\s+trip\b/i;
const LOOSE_ASSET_HINT = /\b(?:photos?|pics?|pictures?|images?|snaps?|shots?|videos?|clips?|these|those)\b/i;
const RECENCY_HINT = /\b(?:newest|latest|last|recent|most\s+recent)\b/i;

// update_asset_metadata edits LOOSE assets — the inverse of rename_or_describe_*'s
// album/space gate. Require a photo/recency reference; decline album/space refs,
// subjective sources, and recent-trip sources.
const declinesTarget = (source) =>
  /\b(?:album|space)\b/i.test(source) || SUBJECTIVE_PATTERN.test(source) || tripSourcePattern.test(source);
const isLooseAssetSource = (source) => {
  const s = clean(source);
  if (!s || declinesTarget(s)) {
    return false;
  }
  return LOOSE_ASSET_HINT.test(s) || RECENCY_HINT.test(s);
};

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const CLEAR_WORDS = new Set(['clear', 'remove', 'delete', 'none', 'reset', 'no']);
const parseRatingValue = (raw) => {
  const text = clean(raw).toLowerCase();
  if (WORD_NUMBERS[text] !== undefined) {
    return WORD_NUMBERS[text];
  }
  const digits = text.match(/\d+/)?.[0];
  if (digits === undefined) {
    return undefined;
  }
  const n = Number(digits);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined;
};

const NUM = '-?\\d+(?:\\.\\d+)?';
const LOCATION_RE = new RegExp(
  `\\bset\\s+(?:the\\s+location\\s+(?:on|of|for)\\s+)?(?<source>.+?)\\s+to\\s+lat(?:itude)?\\s+(?<lat>${NUM})\\s+and\\s+lon(?:g|gitude)?\\s+(?<lng>${NUM})`,
  'i',
);

// Each extractor returns { field, ...typed, source } | undefined.
const EXTRACTORS = [
  (p) => {
    const m =
      /\b(?:clear|remove|delete)\s+(?:the\s+)?(?:description|caption)\s+(?:on|of|for|from)\s+(?<source>.+)$/i.exec(p);
    return m?.groups ? { field: 'description', description: '', source: m.groups.source } : undefined;
  },
  (p) => {
    const m =
      /\b(?:set|change|update|add|edit|give)\s+(?:the\s+|a\s+|its\s+|it\s+a\s+)?(?:new\s+)?(?:description|caption)\s+(?:on|of|for)\s+(?<source>.+?)\s+to\s+(?<value>.+)$/i.exec(
        p,
      );
    return m?.groups
      ? { field: 'description', description: stripQuotes(m.groups.value), source: m.groups.source }
      : undefined;
  },
  (p) => {
    const m = /\b(?:clear|remove|delete)\s+(?:the\s+)?(?:star\s+)?rating\s+(?:on|of|for|from)\s+(?<source>.+)$/i.exec(
      p,
    );
    return m?.groups ? { field: 'rating', rating: null, source: m.groups.source } : undefined;
  },
  (p) => {
    const m =
      /\brate\s+(?<source>.+?)\s+(?<rating>\d+|one|two|three|four|five)(?:\s*(?:out\s+of\s+5|\/\s*5))?\s+stars?\b/i.exec(
        p,
      );
    if (!m?.groups) return undefined;
    const rating = parseRatingValue(m.groups.rating);
    return rating === undefined ? undefined : { field: 'rating', rating, source: m.groups.source };
  },
  (p) => {
    const m =
      /\bset\s+(?:the\s+)?(?:star\s+)?rating\s+(?:on|of|for)\s+(?<source>.+?)\s+to\s+(?<rating>\d+|one|two|three|four|five)\b/i.exec(
        p,
      );
    if (!m?.groups) return undefined;
    const rating = parseRatingValue(m.groups.rating);
    return rating === undefined ? undefined : { field: 'rating', rating, source: m.groups.source };
  },
  (p) => {
    const m =
      /\bset\s+(?:the\s+)?(?:time\s?zone|tz)\s+(?:on|of|for)\s+(?<source>.+?)\s+to\s+(?<tz>[A-Za-z]+(?:\/[A-Za-z_]+)+)\b/i.exec(
        p,
      );
    return m?.groups ? { field: 'timeZone', timeZone: clean(m.groups.tz), source: m.groups.source } : undefined;
  },
  (p) => {
    const m = LOCATION_RE.exec(p);
    return m?.groups
      ? { field: 'location', latitude: Number(m.groups.lat), longitude: Number(m.groups.lng), source: m.groups.source }
      : undefined;
  },
  (p) => {
    const m =
      /\bset\s+(?:the\s+)?(?:date|datetime|date\s*time|timestamp)\s+(?:on|of|for)\s+(?<source>.+?)\s+to\s+(?<date>.+)$/i.exec(
        p,
      );
    if (!m?.groups) return undefined;
    const range = parseDateRange(m.groups.date);
    return range
      ? { field: 'date', dateTimeOriginal: range.takenAfter.toISOString(), source: m.groups.source }
      : undefined;
  },
  (p) => {
    const m =
      /\b(?:shift|move|adjust)\s+(?<source>.+?)\s+(?<dir>forward|back|backward|ahead|earlier|later)\s+by\s+(?<amt>\d+)\s+(?<unit>hours?|hrs?|minutes?|mins?)\b/i.exec(
        p,
      );
    if (!m?.groups) return undefined;
    const amount = Number(m.groups.amt);
    const minutes = /^h/i.test(m.groups.unit) ? amount * 60 : amount;
    const sign = /back|backward|earlier/i.test(m.groups.dir) ? -1 : 1;
    return { field: 'date', dateTimeRelative: sign * minutes, source: m.groups.source };
  },
];

const tryMatch = (prompt) => {
  for (const extractor of EXTRACTORS) {
    const result = extractor(prompt);
    if (!result) {
      continue;
    }
    const source = cleanSource(result.source);
    if (!isLooseAssetSource(source)) {
      continue; // album/space/subjective/trip → let rename_* / open handling own it
    }
    const { source: _ignored, ...rest } = result;
    return { ...rest, sourceDescription: source };
  }
  return undefined;
};

const buildPayload = (rawSlots) => {
  if (!rawSlots || typeof rawSlots !== 'object') {
    return null;
  }
  if (rawSlots.description !== undefined) {
    return { description: stripQuotes(rawSlots.description) }; // '' is valid (clear)
  }
  if (rawSlots.rating !== undefined) {
    if (rawSlots.rating === null) {
      return { rating: null };
    }
    const rating = parseRatingValue(rawSlots.rating);
    return rating === undefined ? null : { rating };
  }
  if (rawSlots.timeZone !== undefined || rawSlots.timezone !== undefined) {
    const tz = clean(rawSlots.timeZone ?? rawSlots.timezone);
    return tz ? { timeZone: tz } : null;
  }
  if (rawSlots.latitude !== undefined || rawSlots.longitude !== undefined) {
    const lat = Number(rawSlots.latitude);
    const lng = Number(rawSlots.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
  }
  if (rawSlots.dateTimeOriginal !== undefined) {
    const iso = clean(rawSlots.dateTimeOriginal);
    return iso ? { dateTimeOriginal: iso } : null;
  }
  if (rawSlots.dateTimeRelative !== undefined) {
    const n = Number(rawSlots.dateTimeRelative);
    return Number.isInteger(n) ? { dateTimeRelative: n } : null;
  }
  const field = clean(rawSlots.field).toLowerCase();
  if (!field) {
    return null;
  }
  const value = rawSlots.value;
  if (field === 'description' || field === 'caption') {
    if (CLEAR_WORDS.has(clean(value).toLowerCase())) {
      return { description: '' };
    }
    return { description: stripQuotes(value) };
  }
  if (field === 'rating') {
    if (value === null || CLEAR_WORDS.has(clean(value).toLowerCase())) {
      return { rating: null };
    }
    const rating = parseRatingValue(value);
    return rating === undefined ? null : { rating };
  }
  if (field === 'timezone') {
    const tz = clean(value);
    return tz ? { timeZone: tz } : null;
  }
  if (field === 'location') {
    const lat = Number(rawSlots.latitude);
    const lng = Number(rawSlots.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
  }
  if (field === 'date') {
    const range = parseDateRange(clean(value));
    return range ? { dateTimeOriginal: range.takenAfter.toISOString() } : null;
  }
  return null;
};

export const updateAssetMetadataWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }
    const matched = tryMatch(text);
    return matched ? { slots: matched } : undefined;
  },

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!sourceDescription) {
      return null;
    }
    const payload = buildPayload(rawSlots);
    return payload ? { sourceDescription, payload } : null;
  },

  // Execution lands in Slice 8.
  async run() {
    return handoffOpen({ reason: 'update_asset_metadata execution is implemented in Slice 8.' });
  },
});
```

## TDD steps

### Task 1: tests (red)

Create `update-asset-metadata.test.mjs`. `const wf = updateAssetMetadataWorkflow();`

- [ ] match cases (assert `wf.match(prompt)`):
  - `'set the description on my newest 20 photos to Berlin weekend'` → `{ slots: { field:'description', description:'Berlin weekend', sourceDescription:'my newest 20 photos' } }`
  - `'rate my newest 12 photos five stars'` → `{ slots: { field:'rating', rating:5, sourceDescription:'my newest 12 photos' } }`
  - `'clear the rating from my newest 20 photos'` → `{ slots: { field:'rating', rating:null, sourceDescription:'my newest 20 photos' } }`
  - `'set the description on these photos to "Berlin"'` → `slots.description === 'Berlin'` (quotes stripped)
  - `'set the timezone on my newest 20 photos to Europe/Berlin'` → `{ slots: { field:'timeZone', timeZone:'Europe/Berlin', sourceDescription:'my newest 20 photos' } }`
  - `'set my newest 20 photos to latitude 48.8566 and longitude 2.3522'` → `{ slots: { field:'location', latitude:48.8566, longitude:2.3522, sourceDescription:'my newest 20 photos' } }`
  - `'set the description on the Family album to Summer'` → `undefined`
  - `'set the description on the Trips space to X'` → `undefined`
  - `'rename my newest 20 photos to Foo'` → `undefined`
  - `'set the location on these photos to Paris'` → `undefined`
  - `'set the title on these photos to Foo'` → `undefined`
  - `'set the description on the best photos to X'` → `undefined`
  - `''` → `undefined`
- [ ] extra edge match cases:
  - `'rate my newest 20 photos zero stars'` → `undefined` (0 out of range)
  - `'rate my newest 20 photos six stars'` → `undefined` (6 out of range)
  - `'clear the description from my newest 20 photos'` → `slots.field==='description'`, `slots.description===''`
  - `'shift my newest 20 photos forward by 2 hours'` → `{ slots: { field:'date', dateTimeRelative:120, sourceDescription:'my newest 20 photos' } }`
  - `'shift my newest 20 photos back by 90 minutes'` → `dateTimeRelative===-90`
- [ ] parseSlots cases:
  - `parseSlots({ field:'description', value:'Berlin', sourceDescription:'my newest 20 photos' })` → `{ sourceDescription:'my newest 20 photos', payload:{ description:'Berlin' } }`
  - `parseSlots({ field:'rating', value:'5', sourceDescription:'x' }).payload` → `{ rating:5 }`
  - `parseSlots({ field:'rating', value:'clear', sourceDescription:'x' }).payload` → `{ rating:null }`
  - `parseSlots({ latitude:48.8566, sourceDescription:'x' })` → `null` (lng missing)
  - `parseSlots({ sourceDescription:'x' })` → `null`
  - `parseSlots({ field:'description', value:'Berlin' })` → `null` (no source)
  - `parseSlots({ field:'description', description:'Berlin weekend', sourceDescription:'my newest 20 photos' })` → `{ sourceDescription:'my newest 20 photos', payload:{ description:'Berlin weekend' } }` (match-output form normalizes too)
- [ ] identity: `wf.kind === 'update_asset_metadata'`, `wf.flow === 'hybrid'`, `typeof wf.run === 'function'`
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → RED (module doesn't exist).

### Task 2: implement (green)

- [ ] Create `update-asset-metadata.mjs` per the module above.
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → all green (619 + the new cases).

## Edge cases (covered above)

- album/space-qualified describe declines (inverted loose-asset gate).
- place-name location prompt declines at match (only explicit numeric lat+lng captured).
- word-number rating normalizes 1..5; 0/6 → no match.
- clear rating → `rating:null`; clear description → `description:''`.
- relative date shift hours→minutes with sign; absolute date parsed via `parseDateRange`.
- trailing punctuation stripped from value and source (`cleanSource`/`stripQuotes`).
- `parseSlots` normalizes BOTH the typed `match()` output and the LLM `{field,value}` form.

## Acceptance

- `match`/`parseSlots` behave per the tests; `run` is a present (stub) function.
- `mise exec -- pnpm --dir agent-runner test` green; no other module touched (not yet
  registered — Slice 9).

## Commit

- One commit: `feat(agent): add update_asset_metadata router (match + parseSlots) (phase 2 slice 7)`.
