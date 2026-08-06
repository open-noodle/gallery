# Pi Agent Workflow Expansion (Phase 2) — Slice 2 Implementation Plan

> **For agentic workers:** Implement test-first (write the failing test, run it red,
> implement minimally, run it green). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the entity-resolution PATH into `resolveAssetSource`. NAME-LOOKUP
entities (people/tags/albums/cameras) resolve to id-based filters via the REAL
`resolveAssetSearchFilters` tool (structured args, never a free-text `query`); DIRECT
metadata (place→`city`, rating, favorites→`isFavorite`, visibility) maps straight into
`searchAssets.filters`. All merge into ONE filters object → metadata `searchAssets`
handle. This REPLACES the Slice-1 temporary "entity → handoff" short-circuit. Upgrade
the contract fixture's `resolveAssetSearchFilters` to validate the strictObject arg
shape + name caps and return a configurable `{ resolvedFilters, results }`.

**Spec scope:** Slice 2 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.
Ambiguity/not-found → `needs_input` is **Slice 3** (not here — Slice 2 is the
all-matched happy path + direct sources). The full combination matrix is Slice 4.

**Tech stack:** Node.js ESM, `node:test`, `mise exec -- pnpm --dir agent-runner test`.

**Files (three):**

- `agent-runner/src/strict-workflows/asset-source-resolver.mjs`
- `agent-runner/src/strict-workflows/asset-source-resolver.test.mjs`
- `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`

## Verified real contracts (from `server/src/dtos/agent-tool.dto.ts`)

- **`resolveAssetSearchFilters` request** = `z.strictObject({ people?, tags?, albums?,
spaces?, cameraMakes?, cameraModels?, lensModels?, scope?, toolCallId? })`; each name
  field is `resolverNameList` = `array(string.trim().min(1).max(120)).min(1).max(20)`.
  **No `query` field.**
- **`resolveAssetSearchFilters` success response** = `{ status:'success', toolCall,
resolvedFilters, resultSize, results }`. `resolvedFilters` is the full
  `AgentSearchAssetsFilters`. `results[]` element = `{ kind:'person'|'tag'|'album'|
'space'|'cameraMake'|'cameraModel'|'lensModel', query, status:'matched'|'ambiguous'|
'not_found', value?, id?, searchFilter?, choices:[…] (required), message (required) }`.
  (Slice 2 reads `resolvedFilters`; the `results[].status` inspection is Slice 3.)
- **searchAssets metadata filters** (`AgentSearchAssetsFilters`, a strictObject) accept
  `personIds`, `tagIds`, `albumIds`, `make`, `city`, `rating` (int 1..5 nullable),
  `isFavorite`, `visibility`, `type`, `takenAfter/Before`. The fixture's
  `KNOWN_SEARCH_FILTER_KEYS` ALREADY lists all of these — no change needed there.
- Entity-kind → resolver-request-field mapping: people→`people`, tags→`tags`,
  albums→`albums`, cameras→`cameraMakes`.

## Implementation (exact)

### A. `asset-source-resolver.mjs`

**A1. Reclassify favorites out of the subjective gate.** `favorites` IS
metadata-resolvable (`isFavorite`), so it must not hand off as subjective. Change the
exported `SUBJECTIVE_PATTERN` to drop `favou?rite|favou?rites`:

```js
export const SUBJECTIVE_PATTERN =
  /\b(?:best|good|nice|great|highlights?|blurry|bad|cute|pretty|beautiful|nicest|prettiest)\b/i;
```

(No agent-runner test treats a "favorites" source as a subjective decline — verified;
favorite-assets uses `'the best ones'` for that. `favorite-assets.mjs` still parses the
favorite/unfavorite ACTION verb separately, unaffected.)

**A2. Add resolver-request + fallback helpers** (after `parseEntitySource`, before the
clean-gate section):

```js
// Map parser entity kinds → resolveAssetSearchFilters request fields (name-lookup only).
const ENTITY_TO_RESOLVER_FIELD = { people: 'people', tags: 'tags', albums: 'albums', cameras: 'cameraMakes' };

const buildResolverNameRequest = (entity) => {
  const request = {};
  for (const [entityKey, requestKey] of Object.entries(ENTITY_TO_RESOLVER_FIELD)) {
    if (entity?.[entityKey]?.length) {
      request[requestKey] = entity[entityKey];
    }
  }
  return request;
};

// Fallback when resolvedFilters comes back empty but per-query results carry a
// searchFilter (server omitted the merged object). Never used to broaden a search.
const mergeResultSearchFilters = (results) => {
  const merged = {};
  for (const result of results ?? []) {
    if (result?.searchFilter && typeof result.searchFilter === 'object') {
      Object.assign(merged, result.searchFilter);
    }
  }
  return merged;
};
```

**A3. Rewrite `resolveAssetSource`** — replace the whole function body from the
`SUBJECTIVE_PATTERN` check onward with:

```js
export const resolveAssetSource = async ({ client, sourceDescription, signal, now = new Date() }) => {
  const source = clean(sourceDescription);

  // Subjective sources hand off — never plan a guess. (Subjective beats entity.)
  if (SUBJECTIVE_PATTERN.test(source)) {
    return {
      status: 'handoff',
      reason: `Source "${source}" is subjective and cannot be resolved from metadata alone.`,
    };
  }

  const entity = parseEntitySource(source);
  const recencyLimit = parseRecencyLimit(source);
  const dateRange = parseDateRange(source, now);
  const mediaType = parseMediaType(source);

  // Clean-source gate: an unconsumed residual (an unresolvable qualifier) hands off
  // rather than over-resolve by the recognized part alone. Entity tokens are now
  // consumable, so an entity source with no junk residual passes.
  if (!isCleanSource(source)) {
    return {
      status: 'handoff',
      reason: `Source "${source}" includes terms this workflow cannot resolve from metadata alone.`,
    };
  }

  const dateFilters = dateRange
    ? { takenAfter: dateRange.takenAfter.toISOString(), takenBefore: dateRange.takenBefore.toISOString() }
    : {};

  let filters;
  if (entity) {
    // NAME-LOOKUP entities resolve to id-based filters via resolveAssetSearchFilters
    // (structured args, never a free-text query). DIRECT metadata (place/rating/
    // favorite/visibility) maps straight in. Everything merges into ONE filters object.
    const nameRequest = buildResolverNameRequest(entity);
    let resolvedFilters = {};
    if (Object.keys(nameRequest).length > 0) {
      const resolution = await client.call('resolveAssetSearchFilters', nameRequest, { signal });
      resolvedFilters = resolution?.resolvedFilters ?? {};
      if (Object.keys(resolvedFilters).length === 0) {
        resolvedFilters = mergeResultSearchFilters(resolution?.results);
      }
    }
    filters = {
      ...dateFilters,
      ...(mediaType ? { type: mediaType } : {}),
      ...(entity.directFilters ?? {}),
      ...resolvedFilters,
    };
    // Never an unbounded global plan: an entity that yields no usable filter AND no
    // recency bound hands off rather than search everything.
    if (Object.keys(filters).length === 0 && recencyLimit === undefined) {
      return { status: 'handoff', reason: `Source "${source}" could not be resolved to a bounded search.` };
    }
  } else {
    // Recency / date / type-only source (unchanged). Type is a modifier, not a bound,
    // so a clean source with no count and no date hands off.
    if (recencyLimit === undefined && dateRange === undefined) {
      return { status: 'handoff', reason: `Source "${source}" needs a count or date range this workflow can bound.` };
    }
    filters = { ...dateFilters, ...(mediaType ? { type: mediaType } : {}) };
  }

  const hasFilters = Object.keys(filters).length > 0;
  const handleResult = await client.call(
    'searchAssets',
    {
      mode: 'metadata',
      order: 'desc',
      limit: recencyLimit ?? MAX_RECENCY_LIMIT,
      ...(hasFilters ? { filters } : {}),
      detail: 'handle',
    },
    { signal },
  );

  const selectionHandle = handleResult?.selectionHandle;
  const selectionHandleId = clean(selectionHandle?.id);
  const assetCount = typeof selectionHandle?.assetCount === 'number' ? selectionHandle.assetCount : undefined;

  if (!selectionHandleId || assetCount === 0) {
    return { status: 'empty' };
  }
  return { status: 'resolved', selectionHandleId, assetCount };
};
```

(The Slice-1 temporary `if (parseEntitySource(source)) return handoff;` short-circuit is
GONE — replaced by the entity branch above.)

### B. `contract-fixtures.mjs` — upgrade `resolveAssetSearchFilters`

**B1.** Add the request-shape constants + validator (near `KNOWN_SEARCH_FILTER_KEYS`):

```js
const KNOWN_RESOLVE_FILTER_KEYS = new Set([
  'people',
  'tags',
  'albums',
  'spaces',
  'cameraMakes',
  'cameraModels',
  'lensModels',
  'scope',
  'toolCallId',
]);
const RESOLVE_NAME_LIST_KEYS = new Set([
  'people',
  'tags',
  'albums',
  'spaces',
  'cameraMakes',
  'cameraModels',
  'lensModels',
]);

// Mirror the real strictObject request: reject unknown keys (incl. `query`) and the
// resolverNameList caps (≤20 names/kind, ≤120 chars, non-empty strings).
const validateResolveRequest = (args) => {
  if (!args || typeof args !== 'object') fail('resolveAssetSearchFilters requires an object');
  for (const key of Object.keys(args)) {
    if (!KNOWN_RESOLVE_FILTER_KEYS.has(key)) fail(`resolveAssetSearchFilters: unrecognized key "${key}"`);
  }
  for (const key of RESOLVE_NAME_LIST_KEYS) {
    if (args[key] === undefined) continue;
    if (!Array.isArray(args[key]) || args[key].length === 0)
      fail(`resolveAssetSearchFilters: ${key} must be a non-empty array`);
    if (args[key].length > 20) fail(`resolveAssetSearchFilters: ${key} exceeds 20 names`);
    for (const name of args[key]) {
      if (typeof name !== 'string' || name.trim().length === 0)
        fail(`resolveAssetSearchFilters: ${key} names must be non-empty strings`);
      if (name.length > 120) fail(`resolveAssetSearchFilters: ${key} name exceeds 120 chars`);
    }
  }
};
```

**B2.** Add `resolvedFilters` and `resolveResults` to the config destructure (lines
~160-165), defaulting `undefined`:

```js
const {
  albums = [{ id: 'alb-1', albumName: 'Family' }],
  spaces = [{ id: 'spc-1', name: 'Family', members: [] }],
  users = [{ userId: 'usr-1', name: 'Alex', email: 'alex@example.com' }],
  handleAssetCount = 20,
  resolvedFilters,
  resolveResults,
} = config;
```

**B3.** Replace the `resolveAssetSearchFilters` handler (currently lines 183-186):

```js
    resolveAssetSearchFilters: (args) => {
      validateResolveRequest(args);
      // Config-gated rich return for entity-resolution tests; default stays the legacy
      // `{ resolvedFilters: {} }` so existing assertions and non-entity callers are unchanged.
      if (resolvedFilters !== undefined || resolveResults !== undefined) {
        return { resolvedFilters: resolvedFilters ?? {}, results: resolveResults ?? [] };
      }
      return { resolvedFilters: {} };
    },
```

(`KNOWN_SEARCH_FILTER_KEYS` and `validateSearchAssets` are unchanged — the merged
entity filters already validate. Rating-range + visibility-enum tightening is Slice 5.)

## TDD steps

### Task 1: resolver tests (red)

In `asset-source-resolver.test.mjs`:

- [ ] In the existing `'hands off an unbounded or qualified source (clean-source gate)'`
      test, REMOVE the three entity cases now resolved by this slice
      (`'Berlin photos from last weekend'`, `'newest 20 Berlin photos'`,
      `'photos of Alex from last week'`). Keep `'newest photos'` and `'my photos'`.
      Add a one-line comment that the entity cases moved to the new entity-resolution
      describe block (intentional Phase-0 behavior change).
- [ ] Add `describe('resolveAssetSource — named-entity sources')` with:
  - `'photos of Alex'` + `makeContractClient({ resolvedFilters: { personIds: ['per-1'] } })`
    → status `'resolved'`; a `resolveAssetSearchFilters` call with args deepEqual
    `{ people: ['Alex'] }` AND `args.query === undefined`; the `searchAssets` call args
    deepEqual `{ mode:'metadata', order:'desc', limit:1000, filters:{ personIds:['per-1'] }, detail:'handle' }`.
  - `'photos tagged Travel'` + `{ resolvedFilters:{ tagIds:['tag-1'] } }` → resolver args
    `{ tags:['Travel'] }`; searchAssets filters `{ tagIds:['tag-1'] }`.
  - `'photos in the Italy album'` + `{ resolvedFilters:{ albumIds:['alb-1'] } }` → resolver
    args `{ albums:['Italy'] }`; searchAssets filters `{ albumIds:['alb-1'] }`.
  - `'my Sony photos'` + `{ resolvedFilters:{ make:'Sony' } }` → resolver args
    `{ cameraMakes:['Sony'] }`; searchAssets filters `{ make:'Sony' }`.
  - `'photos of Alex from 2024'` + `{ resolvedFilters:{ personIds:['per-1'] } }` → resolver
    args `{ people:['Alex'] }`; searchAssets `filters` deepEqual
    `{ takenAfter:'2024-01-01T00:00:00.000Z', takenBefore:'2024-12-31T23:59:59.999Z', personIds:['per-1'] }`.
  - guard: `'photos of Alex'` with DEFAULT client (no `resolvedFilters` config) → status
    `'handoff'` (empty resolvedFilters + no recency/date bound ⇒ cannot build a bounded
    search); assert NO `searchAssets` call.
- [ ] Add `describe('resolveAssetSource — direct-metadata sources')` with:
  - `'my 5-star photos'` → status `'resolved'`; `resolveAssetSearchFilters` NOT called;
    `searchAssets.filters` deepEqual `{ rating:5 }`.
  - `'my Berlin photos from last weekend'` (now=NOW) → resolved; resolver NOT called;
    `searchAssets.filters` deepEqual `{ city:'Berlin', takenAfter:'2026-05-09T00:00:00.000Z', takenBefore:'2026-05-10T23:59:59.999Z' }`.
  - `'my favorites from last weekend'` (now=NOW) → resolved; resolver NOT called;
    `searchAssets.filters` deepEqual `{ isFavorite:true, takenAfter:'2026-05-09T00:00:00.000Z', takenBefore:'2026-05-10T23:59:59.999Z' }`.
  - `'newest 20 Berlin photos'` + `now=NOW` → resolved; resolver NOT called;
    `searchAssets` args `limit === 20` and `filters` deepEqual `{ city:'Berlin' }`.
- [ ] (Helper) In each entity test, find calls via
      `client.calls.find((c) => c.name === 'resolveAssetSearchFilters')` /
      `=== 'searchAssets'`, and assert `resolveAssetSearchFilters` ABSENCE for direct
      sources with `client.calls.some((c) => c.name === 'resolveAssetSearchFilters') === false`.
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → RED (entity branch not yet
      implemented: name sources currently hand off via the Slice-1 short-circuit).

### Task 2: implement (green)

- [ ] Apply edits A1–A3 (resolver) and B1–B3 (fixture).
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → all green. The existing
      `contract-fixtures.test.mjs` line ~11
      (`resolveAssetSearchFilters({ people:['Alex'] })` deepEquals `{ resolvedFilters:{} }`,
      default client) STAYS green (config-gated return). All prior resolver tests stay
      green except the three intentionally-moved entity handoff cases.

## Edge cases (covered by the tests above)

- Resolver request carries EXACTLY the present entity kinds (people-only → no empty
  `tags`/`albums`; `resolverNameList.min(1)` would reject an empty array).
- `query` is NEVER sent to `resolveAssetSearchFilters` or `searchAssets` (the fixture
  throws if it were).
- Date is a `searchAssets` filter, never a `resolveAssetSearchFilters` scope (one code
  path) — asserted via the merged `filters` in `'photos of Alex from 2024'`.
- Merge precedence: parser-direct (`city`/`rating`/`isFavorite`) + resolver
  (`personIds`/`tagIds`/`albumIds`/`make`) union into ONE filters object; disjoint keys
  so nothing is dropped.
- Empty-resolution guard: name source with empty resolvedFilters + no recency/date →
  handoff (never an unbounded global search), NOT a broadened plan.
- Favorites is a direct filter now, not subjective (`SUBJECTIVE_PATTERN` no longer
  matches `favorites`).
- The fixture rejects an unknown resolver key and over-cap name lists/lengths (mirrors
  the real strictObject + `resolverNameList`), so a wrong-shape resolver call throws in
  unit tests.

## Acceptance

- `resolveAssetSource` resolves name-lookup + direct-metadata sources into a metadata
  `searchAssets` handle via the real `resolveAssetSearchFilters` contract (structured
  args, never `query`); subjective + truly-unbounded sources still hand off.
- The contract fixture validates the resolver request shape and returns a configurable
  `{ resolvedFilters, results }` while keeping the legacy default green.
- `mise exec -- pnpm --dir agent-runner test` green; no workflow modules touched (the
  five callers consume the resolver unchanged — `needs_input` wiring is Slice 3).

## Commit

- One commit: `feat(agent): resolve named-entity + direct-metadata sources via the real search-filter contract (phase 2 slice 2)`.
