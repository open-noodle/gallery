# Pi Agent Workflow Expansion (Phase 2) — Slice 1 Implementation Plan

> **For agentic workers:** Implement test-first (write the failing test, run it red,
> implement minimally, run it green). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a deterministic `parseEntitySource(source)` pure parser that classifies
which named-entity / metadata classes a free-text source mentions, and evolve
`isCleanSource` so entity tokens are ACCEPTED (clean) while subjective sources still
reject. **NO `resolveAssetSearchFilters` call yet** — this slice only classifies and
gates. The resolver short-circuits any detected entity source to `handoff` (the real
entity resolution lands in Slice 2), so every existing `resolveAssetSource` test stays
green.

**Spec scope:** Slice 1 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Tech stack:** Node.js ESM, `node:test`, `node:assert/strict`,
`mise exec -- pnpm --dir agent-runner test`. Pure in-memory parser — no
server/runtime/network side effects.

**Files (only two):**

- `agent-runner/src/strict-workflows/asset-source-resolver.mjs`
- `agent-runner/src/strict-workflows/asset-source-resolver.test.mjs`

## Three buckets the parser classifies

- **(a) NAME-LOOKUP** (resolver name fields, Slice 2): people (`of/with <Name>`), tags
  (`tagged <Tag>` / `<Tag>-tagged`), albums (`in the <Album> album`), cameras
  (`shot on/with <Make>`, or bare `my <Make> photos` where Make ∈ a camera allow-list).
- **(b) DIRECT metadata** (straight into `searchAssets.filters`): place (`my <Place>
photos`, `from/in <Place>`) → `city`; rating (`5-star`/`rated 5`) → `rating` (1..5);
  favorites (`favorites`/`favorite`) → `isFavorite:true`; visibility (`archived`) →
  `visibility:'archive'` (lowercase enum).
- **(c) SUBJECTIVE** (`best`/`blurry`/…) → NOT an entity (stays handled by the existing
  `SUBJECTIVE_PATTERN`, returns `undefined` from the parser).

`parseEntitySource` returns `undefined` when no entity is present (recency-only / type /
date / filler), or an object with any of `{ people, tags, albums, cameras, directFilters }`.

## Why the resolver must short-circuit entities in this slice

`isCleanSource` is called inside `resolveAssetSource`. Evolving it to accept entity
tokens would, on its own, make `resolveAssetSource('Berlin photos from last weekend')`
pass the clean gate and then search by **date only** (ignoring Berlin) — exactly the
over-resolution the existing handoff test guards against. So this slice adds a
**temporary** guard right after the subjective check: if `parseEntitySource(source)`
detects an entity, hand off (the Slice-2 entity search path replaces this). This keeps
the entity-handoff behavior identical while exposing the new pure functions for direct
unit testing. Slice 2/4 flip these to resolved.

## Implementation (exact)

### 1. `asset-source-resolver.mjs` — add module-level constants (near the other patterns)

```js
// --- named-entity / direct-metadata source detection (Phase 0) ---------------

// Camera makes recognized in the bare "my <Make> photos" form. An allow-list so a
// place ("my Berlin photos") is NOT mistaken for a camera. Explicit "shot on/with
// <X>" captures any make regardless of this list.
const CAMERA_MAKES = new Set([
  'sony',
  'canon',
  'nikon',
  'fuji',
  'fujifilm',
  'leica',
  'panasonic',
  'olympus',
  'pentax',
  'gopro',
  'dji',
  'hasselblad',
  'ricoh',
  'sigma',
  'kodak',
]);

// Capitalized words that are filler, never a place/camera even before a photo noun.
const NON_ENTITY_WORDS = new Set([
  'my',
  'the',
  'a',
  'an',
  'these',
  'those',
  'all',
  'some',
  'our',
  'recent',
  'newest',
  'latest',
  'last',
  'most',
  'best',
  'good',
]);

// Caps to keep the later resolveAssetSearchFilters strictObject within bounds.
const MAX_ENTITY_NAMES_PER_KIND = 20;
const MAX_ENTITY_NAME_LENGTH = 120;

const PHOTO_NOUN = '(?:photos?|pics?|pictures?|snaps?|shots?)';
```

### 2. `asset-source-resolver.mjs` — add and EXPORT `parseEntitySource`

Place after `parseMediaType`, before the clean-source gate section.

```js
// Classify which named-entity / direct-metadata classes a source mentions. Pure;
// proposes candidate name strings (the server/tool layer decides matched/ambiguous/
// not_found in Slice 2). Returns undefined when the source has no entity (recency /
// date / type / filler only). Operates on a mutable working copy, consuming each
// matched span so later rules don't re-match it (and so multiple kinds accumulate).
export const parseEntitySource = (source) => {
  let text = ` ${String(source ?? '')} `;
  const result = {};
  const pushName = (key, raw) => {
    const name = clean(raw);
    if (!name || name.length > MAX_ENTITY_NAME_LENGTH) {
      return;
    }
    const list = (result[key] ??= []);
    if (list.length < MAX_ENTITY_NAMES_PER_KIND && !list.includes(name)) {
      list.push(name);
    }
  };
  const setDirect = (key, value) => {
    (result.directFilters ??= {})[key] = value;
  };

  // (1) album: "in the <Album> album" — before place "in <X>".
  text = text.replace(/\bin\s+the\s+([A-Za-z][\w' -]*?)\s+albums?\b/gi, (_m, n) => (pushName('albums', n), ' '));
  // (2) tag: "tagged <Tag>" and "<Tag>-tagged".
  text = text.replace(/\btagged\s+([A-Za-z][\w'-]*)/gi, (_m, n) => (pushName('tags', n), ' '));
  text = text.replace(/\b([A-Za-z][\w']*)-tagged\b/gi, (_m, n) => (pushName('tags', n), ' '));
  // (3) camera (explicit): "shot on/with <Make>" — any token, consumed before people "with".
  text = text.replace(/\bshot\s+(?:on|with)\s+([A-Za-z][\w'-]*)/gi, (_m, n) => (pushName('cameras', n), ' '));
  // (4) people: "of/with <Capitalized Name>".
  text = text.replace(
    /\b(?:of|with)\s+([A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*)*)/g,
    (_m, n) => (pushName('people', n), ' '),
  );
  // (5) rating: "rated N" / "N-star(s)" / "N stars" (clamp 1..5; out-of-range left in place).
  text = text.replace(/\brated\s+([1-9]\d?)\b/gi, (m, n) =>
    Number(n) <= 5 ? (setDirect('rating', Number(n)), ' ') : m,
  );
  text = text.replace(/\b([1-9]\d?)[\s-]?stars?\b/gi, (m, n) =>
    Number(n) <= 5 ? (setDirect('rating', Number(n)), ' ') : m,
  );
  // (6) favorites.
  if (/\bfavou?rites?\b/i.test(text)) {
    setDirect('isFavorite', true);
    text = text.replace(/\bfavou?rites?\b/gi, ' ');
  }
  // (7) visibility.
  if (/\barchived\b/i.test(text)) {
    setDirect('visibility', 'archive');
    text = text.replace(/\barchived\b/gi, ' ');
  }
  // (8) camera (bare): "my <Make> photos" where Make is a known make.
  const bareNoun = new RegExp(`\\b([A-Z][A-Za-z]+)\\b(?=\\s+${PHOTO_NOUN}\\b)`, 'g');
  text = text.replace(bareNoun, (m, n) => (CAMERA_MAKES.has(n.toLowerCase()) ? (pushName('cameras', n), ' ') : m));
  // (9a) place: "my <Place> photos" (capitalized, not filler, not a known make).
  text = text.replace(new RegExp(`\\b([A-Z][A-Za-z]+)\\b(?=\\s+${PHOTO_NOUN}\\b)`, 'g'), (m, n) =>
    NON_ENTITY_WORDS.has(n.toLowerCase()) ? m : (setDirect('city', n), ' '),
  );
  // (9b) place: "from/in <Place>" (capitalized, not followed by "album", first wins).
  text = text.replace(/\b(?:from|in)\s+([A-Z][A-Za-z'-]*)\b(?!\s+albums?\b)/g, (m, n) => {
    if (NON_ENTITY_WORDS.has(n.toLowerCase())) {
      return m;
    }
    if (result.directFilters?.city === undefined) {
      setDirect('city', n);
    }
    return ' ';
  });

  return Object.keys(result).length > 0 ? result : undefined;
};
```

### 3. `asset-source-resolver.mjs` — replace `isCleanSource` with an entity-aware, EXPORTED version

Add the keyword strip constant, then export an evolved `isCleanSource`.

```js
// Entity connector/keyword tokens consumed alongside recognized entity names so an
// entity source reads as "clean".
const ENTITY_KEYWORD_STRIP = /\b(?:tagged|shot\s+(?:on|with)|rated|stars?|favou?rites?|archived|albums?)\b/gi;

// A source is "clean" when, after removing recency / date / generic-noun / filler AND
// recognized entity tokens, nothing substantive remains. Subjective qualifiers
// ("best") are NOT entity tokens, so they survive and keep the source un-clean.
export const isCleanSource = (source) => {
  let text = String(source ?? '').toLowerCase();
  const entity = parseEntitySource(source);
  if (entity) {
    const names = [
      ...(entity.people ?? []),
      ...(entity.tags ?? []),
      ...(entity.albums ?? []),
      ...(entity.cameras ?? []),
      ...(entity.directFilters?.city ? [entity.directFilters.city] : []),
    ];
    for (const name of names) {
      text = text.split(name.toLowerCase()).join(' ');
    }
    text = text.replace(ENTITY_KEYWORD_STRIP, ' ');
  }
  const residual = text
    .replace(DATE_STRIP, ' ')
    .replace(RECENCY_PATTERN_G, ' ')
    .replace(/\b\d{1,4}\b/g, ' ')
    .replace(GENERIC_NOUNS, ' ')
    .replace(TYPE_NOUNS, ' ')
    .replace(STOPWORDS, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim();
  return residual.length === 0;
};
```

(The old `const isCleanSource = (source) => { … }` block is removed; for non-entity
sources the residual computation is byte-for-byte identical to the old one, so nothing
regresses.)

### 4. `asset-source-resolver.mjs` — add the temporary entity short-circuit in `resolveAssetSource`

Right after the existing `SUBJECTIVE_PATTERN` handoff, BEFORE `parseRecencyLimit`:

```js
// Subjective sources hand off — never plan a guess.
if (SUBJECTIVE_PATTERN.test(source)) {
  return { status: 'handoff', reason: `Source "${source}" is subjective and cannot be resolved from metadata alone.` };
}

// Phase 0 (Slice 1): named-entity / direct-metadata sources are DETECTED here, but
// the resolution path (resolveAssetSearchFilters → searchAssets with entity filters)
// lands in Slice 2. Until then an entity source hands off rather than over-resolve by
// the recency/date part alone.
if (parseEntitySource(source)) {
  return { status: 'handoff', reason: `Source "${source}" names an entity this workflow resolves in a later step.` };
}
```

No other change to `resolveAssetSource` (recency/date/type path unchanged).

## TDD steps

### Task 1: write the new tests (red)

- [ ] In `asset-source-resolver.test.mjs`, extend the import on line 3 to:
      `import { isCleanSource, parseDateRange, parseEntitySource, parseMediaType, resolveAssetSource } from './asset-source-resolver.mjs';`
- [ ] Add a `describe('parseEntitySource')` block with these exact cases:
  - `'photos of Alex'` → `{ people: ['Alex'] }`
  - `'my Berlin photos'` → `{ directFilters: { city: 'Berlin' } }`
  - `'photos from Paris'` → `{ directFilters: { city: 'Paris' } }`
  - `'photos tagged Travel'` → `{ tags: ['Travel'] }`
  - `'my Travel-tagged photos'` → `{ tags: ['Travel'] }`
  - `'photos in the Italy album'` → `{ albums: ['Italy'] }`
  - `'my Sony photos'` → `{ cameras: ['Sony'] }`
  - `'shot on Canon'` → `{ cameras: ['Canon'] }`
  - `'my 5-star photos'` → `{ directFilters: { rating: 5 } }`
  - `'rated 5'` → `{ directFilters: { rating: 5 } }`
  - `'my favorites'` → `{ directFilters: { isFavorite: true } }`
  - `'my favorite photos'` → `{ directFilters: { isFavorite: true } }`
  - `'my archived photos'` → `{ directFilters: { visibility: 'archive' } }`
  - `'my newest 20 photos'` → `undefined`
  - `'the best ones'` → `undefined`
  - edge (no entity): `'photos from 2024'` → `undefined`; `'my videos'` → `undefined`; `'my photos'` → `undefined`
  - edge (rating clamp): `'rated 7'` → `undefined`; `'my 7-star photos'` → `undefined`
  - edge (name-length cap): a person name > 120 chars (`'photos of ' + 'A'.repeat(121)`) → `undefined`
  - Use `assert.deepEqual(parseEntitySource(input), expected)`.
- [ ] Add a `describe('isCleanSource')` block:
  - `isCleanSource('my Berlin photos')` → `true` (entity/direct detected, gate resolves)
  - `isCleanSource('my Sony photos')` → `true`; `isCleanSource('photos tagged Travel')` → `true`;
    `isCleanSource('photos in the Italy album')` → `true`; `isCleanSource('my 5-star photos')` → `true`;
    `isCleanSource('my archived photos')` → `true`
  - `isCleanSource('my newest 20 photos')` → `true` (recency-only path unchanged, regression guard)
  - `isCleanSource('the best ones')` → `false` (pure-subjective still un-clean)
  - `isCleanSource('the best Berlin photos')` → `false` (subjective survives even with an entity present)
  - `isCleanSource('my screenshots')` → `false` (non-type residual still un-clean)
- [ ] In the existing `describe('resolveAssetSource')`, add ONE case to lock
      "subjective beats entity": `resolveAssetSource({ client: makeContractClient(),
sourceDescription: 'the best Berlin photos', now: NOW })` → `status === 'handoff'`
      AND no `searchAssets` call (the `SUBJECTIVE_PATTERN` check precedes the entity
      short-circuit, so a subjective qualifier never resolves even with a place).
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → expect RED on the two new
      describe blocks (imports/functions referenced before they exist or before export).
      Capture the failing output.

### Task 2: implement (green)

- [ ] Apply edits 1–4 above to `asset-source-resolver.mjs`.
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → all green. Total = 539 +
      (new parseEntitySource + isCleanSource cases). The pre-existing
      `resolveAssetSource` "hands off an unbounded or qualified source" block
      (`Berlin photos from last weekend`, `newest 20 Berlin photos`,
      `photos of Alex from last week`) STAYS green via the new entity short-circuit.

## Edge cases (must be covered by the tests above)

- Place vs filler: `'my newest 20 photos'` → no entity (recency word + number, not a place).
- Place vs date/type: `'photos from 2024'` (date), `'my videos'` (type) → no entity.
- Camera allow-list: `'my Sony photos'` → camera; `'my Berlin photos'` → place (Berlin ∉ makes).
- Album beats place: `'photos in the Italy album'` → `albums`, not `city:'Italy'`.
- Rating clamp 1..5: `'rated 7'`/`'7-star'` → no rating (returns `undefined`).
- Name caps: a > 120-char name is dropped (parser returns `undefined`, never a giant arg).
- Subjective is not an entity: `'the best ones'` → `undefined`; subjective survives the
  clean gate so `isCleanSource` stays `false`.
- `resolveAssetSource` behavior for entity sources is UNCHANGED (still handoff) — only
  the reason text differs (existing tests assert status only).

## Acceptance

- `parseEntitySource` and `isCleanSource` exported and unit-tested directly.
- Every existing `asset-source-resolver.test.mjs` assertion stays green (the entity
  short-circuit preserves the prior handoff behavior).
- `mise exec -- pnpm --dir agent-runner test` green; no other module touched; no L1/L3
  changes (no routing change, no live tool).

## Commit

- One commit: `feat(agent): detect named-entity/metadata sources + entity-aware clean gate (phase 2 slice 1)`.
