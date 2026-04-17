# cmdk Prefix Scoping (v1.2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add prefix-scoping (`@` people, `#` tags, `/` albums+spaces, `>` navigation) to the Ctrl+K palette so users can narrow search to a single entity type.

**Architecture:** A pure `parseScope` function reads the raw query; `GlobalSearchManager` exposes `scope` / `payload` $derived fields; `runBatch` dispatches only the in-scope entity providers; each provider's `run()` takes a bare-prefix suggestions branch when `payload === ''`; UI hides non-scope sections + TopResult + ML banner under scope; `?` keybind + footer icon open `ShortcutsModal`.

**Tech Stack:** SvelteKit 5 with runes, TypeScript, vitest + @testing-library/svelte, Playwright, bits-ui Command, @immich/ui.

**Design doc:** [`docs/plans/2026-04-17-cmdk-prefix-scoping-design.md`](./2026-04-17-cmdk-prefix-scoping-design.md) — refer for rationale, edge-case tables, and risk decisions. This plan is the executable breakdown.

**Pre-impl verification (already done while writing this plan):**

- `PersonResponseDto` has `updatedAt?: string` and `name: string`. No `numberOfAssets` / `faceCount`. **Sort key decision:** `updatedAt` desc (when present), `name` alpha tie-break, `id` stable final tie-break.
- `getAllPeople` returns `PeopleResponseDto = { people: PersonResponseDto[]; total; hidden; hasNextPage }`. Field access: `response.people`.
- **`AlbumNameDto` has NO `updatedAt`** — only `id`, `albumName`, `albumThumbnailAssetId`, `assetCount`, `shared`, optional `startDate`, optional `endDate`. **Design doc mismatch:** it says bare `/` albums sort "by `updatedAt` desc" but the field does not exist on the lightweight `getAlbumNames` DTO. **Sort key decision:** use `endDate ?? ''` desc (most-recent-photo-in-album as activity proxy). Missing `endDate` sinks to the bottom. Retro-correct the design doc in the same PR.
- `TagResponseDto` HAS `updatedAt: string` (required). Tags bare sort works as designed.
- `SharedSpaceResponseDto` has `createdAt: string` (required) and `lastActivityAt?: string | null`. Spaces sort as designed.
- `GlobalSearchPreview` (`web/src/lib/components/global-search/global-search-preview.svelte`) has no `nav` branch and no catch-all `{:else}`. Task 12b adds the branch.
- `bits-ui` is pinned at `^2.15.7` in `web/package.json:43`. Task 12c confirms `Command.Input`'s `?` handling.
- **Test factory:** the existing `global-search-manager.svelte.spec.ts` constructs the manager directly via `new GlobalSearchManager()` inside `beforeEach`. There is no `newTestManager()` helper. **Every new test in Tasks 3–11 instantiates via `new GlobalSearchManager()` directly and mocks SDK callers via the existing `vi.mock('@immich/sdk', …)` block at the top of the spec.**

---

## Task execution rules

**REQUIRED SKILLS** at every step:

- `superpowers:test-driven-development` — write the failing test first, verify it fails, implement minimal code, verify it passes, commit.
- `superpowers:verification-before-completion` — do not claim a task complete until the verification command output confirms success.

**Always run from the worktree:** `cd /home/pierre/dev/gallery/.worktrees/cmdk-prefix-scoping` (it's your `$PWD` when this plan is executed).

**Test commands (copy verbatim):**

- Single web unit spec: `pnpm --filter=immich-web test -- --run <path>`
- All web unit tests: `pnpm --filter=immich-web test -- --run`
- Type check web: `pnpm --filter=immich-web check`
- Format check: `npx --no-install prettier --check <path>`

**Commit after each Task.** Commit messages use Conventional Commits; do NOT add a `Co-Authored-By` trailer (per the global CLAUDE.md).

---

## Task 0: Wire the worktree for development

**Files:** none modified.

**Step 1: Install dependencies.**

```bash
pnpm install --frozen-lockfile
```

Expected: installs in ~30s; no errors.

**Step 2: Verify baseline web tests pass.**

Run the cmdk-adjacent test surface (broader than a single spec, narrower than the full suite — catches drift without blowing the clock):

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/ src/lib/components/global-search/ 2>&1 | tail -10
```

Expected: all tests pass. If failures, stop and surface to the user — baseline must be green before starting.

**Step 3: Verify type check.**

```bash
pnpm --filter=immich-web check 2>&1 | tail -5
```

Expected: 0 errors, 0 warnings.

**No commit — nothing changed.**

---

## Task 1: Parser — `parseScope` pure function

**Files:**

- Create: `web/src/lib/managers/cmdk-prefix.ts`
- Create: `web/src/lib/managers/cmdk-prefix.spec.ts`

**Step 1: Write the failing tests (all of them).**

```ts
// web/src/lib/managers/cmdk-prefix.spec.ts
import { describe, expect, it } from 'vitest';
import { parseScope, type ParsedQuery } from './cmdk-prefix';

describe('parseScope', () => {
  const cases: Array<{ input: string; expected: ParsedQuery; why: string }> = [
    { input: '', expected: { scope: 'all', payload: '' }, why: 'empty' },
    { input: '  ', expected: { scope: 'all', payload: '' }, why: 'whitespace-only' },
    { input: 'alice', expected: { scope: 'all', payload: 'alice' }, why: 'no prefix' },
    { input: '@alice', expected: { scope: 'people', payload: 'alice' }, why: '@ canonical' },
    { input: '@ alice', expected: { scope: 'people', payload: 'alice' }, why: 'payload trim' },
    { input: '@', expected: { scope: 'people', payload: '' }, why: 'bare @' },
    { input: '#', expected: { scope: 'tags', payload: '' }, why: 'bare #' },
    { input: '/', expected: { scope: 'collections', payload: '' }, why: 'bare /' },
    { input: '>', expected: { scope: 'nav', payload: '' }, why: 'bare >' },
    { input: '@@alice', expected: { scope: 'people', payload: '@alice' }, why: 'only first char consumed' },
    { input: 'abc@def', expected: { scope: 'all', payload: 'abc@def' }, why: 'prefix must be at [0]' },
    { input: '$abc', expected: { scope: 'all', payload: '$abc' }, why: 'unsupported char kept' },
    { input: '＠alice', expected: { scope: 'all', payload: '＠alice' }, why: 'fullwidth at does not match' },
    { input: '＃xmas', expected: { scope: 'all', payload: '＃xmas' }, why: 'fullwidth hash does not match' },
    { input: '／trip', expected: { scope: 'all', payload: '／trip' }, why: 'fullwidth slash does not match' },
    { input: '＞theme', expected: { scope: 'all', payload: '＞theme' }, why: 'fullwidth greater-than does not match' },
    { input: '/2024/trips', expected: { scope: 'collections', payload: '2024/trips' }, why: 'first / consumed' },
    { input: '\t@alice', expected: { scope: 'people', payload: 'alice' }, why: 'tab stripped' },
    { input: '@   ', expected: { scope: 'people', payload: '' }, why: 'prefix + trailing whitespace = bare' },
    { input: `@${'a'.repeat(255)}`, expected: { scope: 'people', payload: 'a'.repeat(255) }, why: 'max length' },
  ];

  for (const { input, expected, why } of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)} (${why})`, () => {
      expect(parseScope(input)).toEqual(expected);
    });
  }
});
```

**Step 2: Run to verify failure.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/cmdk-prefix.spec.ts 2>&1 | tail -10
```

Expected: all 20 tests fail with "Cannot find module './cmdk-prefix'" or similar.

**Step 3: Implement `cmdk-prefix.ts`.**

```ts
// web/src/lib/managers/cmdk-prefix.ts
export type Scope = 'all' | 'people' | 'tags' | 'collections' | 'nav';
export type ParsedQuery = { scope: Scope; payload: string };

const PREFIX_MAP: Record<string, Scope> = {
  '@': 'people',
  '#': 'tags',
  '/': 'collections',
  '>': 'nav',
};

export function parseScope(rawText: string): ParsedQuery {
  const text = rawText.trim();
  if (text.length === 0) {
    return { scope: 'all', payload: '' };
  }
  const scope = PREFIX_MAP[text[0]];
  if (!scope) {
    return { scope: 'all', payload: text };
  }
  return { scope, payload: text.slice(1).trim() };
}
```

**Step 4: Run to verify pass.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/cmdk-prefix.spec.ts 2>&1 | tail -5
```

Expected: all 20 tests pass.

**Step 5: Commit.**

```bash
git add web/src/lib/managers/cmdk-prefix.ts web/src/lib/managers/cmdk-prefix.spec.ts
git commit -m "feat(web): cmdk prefix parser

Pure parseScope(rawText) returning { scope, payload }. Four prefixes:
@ people, # tags, / collections, > nav. First char at position 0 only;
payload trimmed both sides. Table-driven tests pin 16 cases including
unicode look-alikes, multi-prefix, max length."
```

---

## Task 2: `personSuggestionsComparator` pure function

**Files:**

- Modify: `web/src/lib/managers/cmdk-prefix.ts`
- Modify: `web/src/lib/managers/cmdk-prefix.spec.ts`

**Step 1: Append the failing tests.**

```ts
// Append to cmdk-prefix.spec.ts
import { personSuggestionsComparator } from './cmdk-prefix';
import type { PersonResponseDto } from '@immich/sdk';

const p = (o: Partial<PersonResponseDto>): PersonResponseDto =>
  ({
    id: '0',
    name: '',
    birthDate: null,
    isHidden: false,
    thumbnailPath: '',
    type: 'person',
    ...o,
  }) as PersonResponseDto;

describe('personSuggestionsComparator', () => {
  it('sorts by updatedAt desc when present on both', () => {
    const a = p({ id: 'a', name: 'Alice', updatedAt: '2026-04-01T00:00:00Z' });
    const b = p({ id: 'b', name: 'Bob', updatedAt: '2026-04-15T00:00:00Z' });
    expect([a, b].sort(personSuggestionsComparator)).toEqual([b, a]);
  });

  it('missing updatedAt treated as oldest', () => {
    const a = p({ id: 'a', name: 'Alice', updatedAt: '2026-04-10T00:00:00Z' });
    const b = p({ id: 'b', name: 'Bob' }); // no updatedAt
    expect([a, b].sort(personSuggestionsComparator)).toEqual([a, b]);
  });

  it('updatedAt tie → alpha by name', () => {
    const a = p({ id: 'a', name: 'Zack', updatedAt: '2026-04-10T00:00:00Z' });
    const b = p({ id: 'b', name: 'Alice', updatedAt: '2026-04-10T00:00:00Z' });
    expect([a, b].sort(personSuggestionsComparator)).toEqual([b, a]);
  });

  it('same name tie → stable by id', () => {
    const a = p({ id: 'b', name: 'Alice', updatedAt: '2026-04-10T00:00:00Z' });
    const b = p({ id: 'a', name: 'Alice', updatedAt: '2026-04-10T00:00:00Z' });
    expect([a, b].sort(personSuggestionsComparator)).toEqual([b, a]);
  });

  it('handles both missing updatedAt → alpha by name then id', () => {
    const a = p({ id: 'a', name: 'Bob' });
    const b = p({ id: 'b', name: 'Alice' });
    expect([a, b].sort(personSuggestionsComparator)).toEqual([b, a]);
  });
});
```

**Step 2: Run to verify failure.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/cmdk-prefix.spec.ts 2>&1 | tail -10
```

Expected: 5 new tests fail with "personSuggestionsComparator is not a function" or similar.

**Step 3: Implement.**

Append to `cmdk-prefix.ts`:

```ts
import type { PersonResponseDto } from '@immich/sdk';

/**
 * Sort comparator for the bare-`@` suggestions list.
 * Keys (in priority order): updatedAt desc, name alpha, id alpha.
 * `updatedAt` is optional on PersonResponseDto; missing values sink to the bottom.
 */
export function personSuggestionsComparator(a: PersonResponseDto, b: PersonResponseDto): number {
  const au = a.updatedAt ?? '';
  const bu = b.updatedAt ?? '';
  if (au !== bu) {
    return bu.localeCompare(au); // desc
  }
  if (a.name !== b.name) {
    return a.name.localeCompare(b.name);
  }
  return a.id.localeCompare(b.id);
}
```

**Step 4: Run to verify pass.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/cmdk-prefix.spec.ts 2>&1 | tail -5
```

Expected: all 21 tests pass (16 parser + 5 comparator).

**Step 5: Commit.**

```bash
git add web/src/lib/managers/cmdk-prefix.ts web/src/lib/managers/cmdk-prefix.spec.ts
git commit -m "feat(web): personSuggestionsComparator for bare-@ sort

Sort PersonResponseDto by updatedAt desc, then name alpha, then id.
Missing updatedAt sinks to the bottom. Stable id tie-break prevents
flakiness on same-name fixtures."
```

---

## Task 3: Manager deriveds — `parsedQuery` / `scope` / `payload`

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Step 1: Write the failing test.**

Append to `global-search-manager.svelte.spec.ts` at the end of the outer describe block (or in a new block):

```ts
describe('prefix scoping — deriveds', () => {
  it('setQuery(@alice) derives scope=people, payload=alice', () => {
    const m = new GlobalSearchManager();
    m.setQuery('@alice');
    expect(m.scope).toBe('people');
    expect(m.payload).toBe('alice');
  });

  it('setQuery(alice) derives scope=all, payload=alice', () => {
    const m = new GlobalSearchManager();
    m.setQuery('alice');
    expect(m.scope).toBe('all');
    expect(m.payload).toBe('alice');
  });

  it('scope stable across keystrokes within same prefix', () => {
    const m = new GlobalSearchManager();
    m.setQuery('@');
    m.setQuery('@a');
    m.setQuery('@al');
    expect(m.scope).toBe('people');
    expect(m.payload).toBe('al');
  });

  it('setQuery(@alice) then setQuery("") returns scope to all', () => {
    const m = new GlobalSearchManager();
    m.setQuery('@alice');
    expect(m.scope).toBe('people');
    m.setQuery('');
    expect(m.scope).toBe('all');
    expect(m.payload).toBe('');
  });
});
```

**Step 2: Run to verify failure.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/global-search-manager.svelte.spec.ts 2>&1 | tail -10
```

Expected: 4 new tests fail with "manager.scope is not a function" / `undefined`.

**Step 3: Add deriveds to the manager.**

In `web/src/lib/managers/global-search-manager.svelte.ts`, near the top imports:

```ts
import { parseScope, type ParsedQuery, type Scope } from './cmdk-prefix';
```

Inside `GlobalSearchManager` class, after the existing `mode = $state<SearchMode>(...)` declaration (around line 154):

```ts
parsedQuery = $derived<ParsedQuery>(parseScope(this.query));
scope = $derived<Scope>(this.parsedQuery.scope);
payload = $derived<string>(this.parsedQuery.payload);
```

**Step 4: Run to verify pass.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/global-search-manager.svelte.spec.ts 2>&1 | tail -5
```

Expected: the 4 new tests pass; all prior tests still pass.

**Step 5: Type check.**

```bash
pnpm --filter=immich-web check 2>&1 | tail -5
```

Expected: 0 errors.

**Step 6: Commit.**

```bash
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): manager parsedQuery/scope/payload deriveds

Three $derived fields backing prefix scoping. Raw query still held
verbatim in this.query; downstream dispatch reads this.scope and
this.payload."
```

---

## Task 4: Scope-aware `runBatch` + minQueryLength bypass

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Step 1: Write failing tests.**

Append to `global-search-manager.svelte.spec.ts`:

```ts
describe('prefix scoping — runBatch gating', () => {
  it('scope people: only people provider invoked, other entity sections idle', async () => {
    const m = new GlobalSearchManager();
    // Pre-populate unrelated sections to 'ok' to prove they get force-reset.
    m.sections.photos = { status: 'ok', items: [{ id: 'p1' } as never], total: 1 };
    m.sections.albums = { status: 'ok', items: [{ id: 'a1' } as never], total: 1 };

    m.setQuery('@alice');
    await vi.advanceTimersByTimeAsync(150);

    expect(m.sections.photos.status).toBe('idle');
    expect(m.sections.albums.status).toBe('idle');
    expect(m.sections.places.status).toBe('idle');
    expect(m.sections.tags.status).toBe('idle');
    expect(m.sections.spaces.status).toBe('idle');
  });

  it('scope collections: only albums + spaces providers invoked; others idle', async () => {
    const m = new GlobalSearchManager();
    m.sections.photos = { status: 'ok', items: [{ id: 'p1' } as never], total: 1 };
    m.sections.people = { status: 'ok', items: [{ id: 'a1' } as never], total: 1 };
    m.sections.tags = { status: 'ok', items: [{ id: 't1' } as never], total: 1 };

    m.setQuery('/trip');
    await vi.advanceTimersByTimeAsync(150);

    expect(m.sections.photos.status).toBe('idle');
    expect(m.sections.people.status).toBe('idle');
    expect(m.sections.places.status).toBe('idle');
    expect(m.sections.tags.status).toBe('idle');
    // albums + spaces will be ok/empty depending on cache mocks
  });

  it('scope nav: ENTITY_KEYS_BY_SCOPE.nav === [] — no entity providers invoked', async () => {
    const m = new GlobalSearchManager();
    const searchSmartSpy = vi.mocked(searchSmart);
    const searchPersonSpy = vi.mocked(searchPerson);
    const searchPlacesSpy = vi.mocked(searchPlaces);
    const getAllTagsSpy = vi.mocked(getAllTags);
    const getAlbumNamesSpy = vi.mocked(getAlbumNames);
    const getAllSpacesSpy = vi.mocked(getAllSpaces);
    [searchSmartSpy, searchPersonSpy, searchPlacesSpy, getAllTagsSpy, getAlbumNamesSpy, getAllSpacesSpy].forEach((s) =>
      s.mockClear(),
    );

    m.setQuery('>theme');
    await vi.advanceTimersByTimeAsync(150);

    expect(searchSmartSpy).not.toHaveBeenCalled();
    expect(searchPersonSpy).not.toHaveBeenCalled();
    expect(searchPlacesSpy).not.toHaveBeenCalled();
    // Navigation section populated via synchronous runNavigationProvider, not runBatch.
    expect(m.sections.navigation.status).toBe('ok');
  });

  it('scope people with bare @ bypasses minQueryLength', async () => {
    const m = new GlobalSearchManager();
    const searchPersonSpy = vi.mocked(searchPerson);
    searchPersonSpy.mockClear();

    m.setQuery('@'); // payload.length = 0, below people.minQueryLength = 2
    await vi.advanceTimersByTimeAsync(150);

    // people.minQueryLength=2 would normally set section to idle; bypass
    // dispatches to the provider's bare branch instead (which does NOT call searchPerson).
    expect(m.sections.people.status).not.toBe('idle');
    expect(searchPersonSpy).not.toHaveBeenCalled();
  });

  it('scope people with single-char payload relaxes minQueryLength to 1', async () => {
    const m = new GlobalSearchManager();
    const searchPersonSpy = vi.mocked(searchPerson);
    searchPersonSpy.mockClear();

    m.setQuery('@a');
    await vi.advanceTimersByTimeAsync(150);

    expect(searchPersonSpy).toHaveBeenCalledWith({ name: 'a', withHidden: false }, expect.anything());
  });
});
```

**Step 2: Run to verify failure.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/global-search-manager.svelte.spec.ts 2>&1 | tail -10
```

Expected: the 5 new tests fail — without scope gating, runBatch dispatches all providers and photos/albums stay `ok`.

**Step 3: Add `ENTITY_KEYS_BY_SCOPE` and update `runBatch`.**

In `global-search-manager.svelte.ts`, add near top of file (below other constants, around line 85):

```ts
const ENTITY_KEYS_BY_SCOPE: Record<Scope, readonly Array<keyof Sections>> = {
  all: ['photos', 'people', 'places', 'tags', 'albums', 'spaces'],
  people: ['people'],
  tags: ['tags'],
  collections: ['albums', 'spaces'],
  nav: [],
};
```

Locate `runBatch` (line 1281). Replace the `for` loop over the hard-coded tuple (currently `['photos', 'people', 'places', 'tags', 'albums', 'spaces']`) with iteration over `ENTITY_KEYS_BY_SCOPE[this.scope]`. Add minQueryLength bypass:

```ts
protected runBatch(text: string, mode: SearchMode) {
  this.debounceTimer = null;
  this._batchInFlightStartedAt = performance.now();
  const batch = new AbortController();
  const photosLocal = new AbortController();
  this.batchController = batch;
  this.photosController = photosLocal;
  this.inFlightCounter = 0;

  // Force non-scope sections to idle synchronously before dispatching.
  const inScope = new Set(ENTITY_KEYS_BY_SCOPE[this.scope]);
  for (const key of ['photos', 'people', 'places', 'tags', 'albums', 'spaces'] as const) {
    if (!inScope.has(key)) {
      this.sections[key] = idle;
    }
  }

  const scope = this.scope;
  const payload = this.payload;

  for (const key of ENTITY_KEYS_BY_SCOPE[scope]) {
    const provider = this.providers[key];
    // minQueryLength gate:
    //   - scope 'all': payload.length >= provider.minQueryLength (existing rule).
    //   - scope !== 'all' with payload: relax to >= 1.
    //   - scope !== 'all' with bare prefix (payload === ''): BYPASS.
    const isBare = scope !== 'all' && payload === '';
    const minRequired = scope === 'all' ? provider.minQueryLength : 1;
    if (!isBare && payload.length < minRequired) {
      this.sections[key] = idle;
      continue;
    }
    this.inFlightCounter++;
    const controllers = key === 'photos' ? [batch.signal, photosLocal.signal] : [batch.signal];
    const signal = AbortSignal.any([...controllers, AbortSignal.timeout(5000)]);

    const onSettle = () => {
      if (batch !== this.batchController) return;
      this.inFlightCounter--;
      if (this.inFlightCounter === 0) this.batchInFlight = false;
    };

    Promise.resolve()
      .then(() => provider.run(payload, mode, signal))
      .then((result) => {
        if (batch !== this.batchController) return;
        this.sections[key] = result as ProviderStatus<EntityItem>;
        if (key === 'photos') this.onPhotosSettled();
        this.reconcileCursor();
        onSettle();
      })
      .catch((error: unknown) => {
        if (batch !== this.batchController) return;
        if (error instanceof Error && error.name === 'AbortError') {
          if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
            this.sections[key] = { status: 'timeout' };
            if (key === 'photos') this.onPhotosSettled();
          }
          onSettle();
          return;
        }
        const message = error instanceof Error ? error.message : 'unknown error';
        this.sections[key] = { status: 'error', message };
        if (key === 'photos') this.onPhotosSettled();
        onSettle();
      });
  }

  if (this.inFlightCounter === 0) this.batchInFlight = false;
}
```

**Step 4: Run to verify pass.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/global-search-manager.svelte.spec.ts 2>&1 | tail -5
```

Expected: all tests pass, including the 3 new ones.

**Step 5: Commit.**

```bash
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): scope-aware runBatch with minQueryLength bypass

Add ENTITY_KEYS_BY_SCOPE map. runBatch iterates only the in-scope keys
and force-resets the rest to idle synchronously. Bare prefix (payload
empty under a prefix) bypasses minQueryLength so suggestions fire.
Non-bare scoped payload relaxes minQueryLength to 1."
```

---

## Task 5: Provider bare-prefix branch — tags / albums / spaces

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

Tags, albums, and spaces all reuse existing in-memory caches for their suggestions; they don't need new SDK calls. Combine into one task.

**Step 1: Write failing tests.**

```ts
describe('prefix scoping — bare suggestions (tags/albums/spaces)', () => {
  it('# bare returns tagsCache sorted by updatedAt desc, top 5', async () => {
    const m = new GlobalSearchManager();
    m['tagsCache'] = [
      { id: 't1', name: 'old', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 't2', name: 'new', updatedAt: '2026-04-15T00:00:00Z' },
      { id: 't3', name: 'mid', updatedAt: '2026-02-15T00:00:00Z' },
    ] as never;

    m.setQuery('#');
    await vi.advanceTimersByTimeAsync(150);

    expect(m.sections.tags.status).toBe('ok');
    const items = (m.sections.tags as { items: { id: string }[] }).items;
    expect(items.map((i) => i.id)).toEqual(['t2', 't3', 't1']);
  });

  it('# bare with empty tagsCache returns empty', async () => {
    const m = new GlobalSearchManager();
    m['tagsCache'] = [];
    m.setQuery('#');
    await vi.advanceTimersByTimeAsync(150);
    expect(m.sections.tags.status).toBe('empty');
  });

  it('# bare under tagsDisabled returns error: tag_cache_too_large', async () => {
    const m = new GlobalSearchManager();
    m['tagsDisabled'] = true;
    m['tagsCache'] = null;
    m.setQuery('#');
    await vi.advanceTimersByTimeAsync(150);
    expect(m.sections.tags.status).toBe('error');
    expect((m.sections.tags as { message: string }).message).toBe('tag_cache_too_large');
  });

  it('/ bare writes albums sorted endDate desc, spaces sorted lastActivityAt??createdAt desc', async () => {
    const m = new GlobalSearchManager();
    // AlbumNameDto: sort by endDate ?? '' desc (most recent photo in album as activity proxy).
    m.albumsCache = [
      { id: 'a1', albumName: 'Old', endDate: '2026-01-01T00:00:00Z' },
      { id: 'a2', albumName: 'New', endDate: '2026-04-15T00:00:00Z' },
      { id: 'a3', albumName: 'Empty' /* endDate missing — sinks */ },
    ] as never;
    m.spacesCache = [
      { id: 's1', name: 'Quiet', createdAt: '2026-01-01T00:00:00Z', lastActivityAt: null },
      { id: 's2', name: 'Active', createdAt: '2026-02-01T00:00:00Z', lastActivityAt: '2026-04-10T00:00:00Z' },
    ] as never;

    m.setQuery('/');
    await vi.advanceTimersByTimeAsync(150);

    expect((m.sections.albums as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(['a2', 'a1', 'a3']);
    expect((m.sections.spaces as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(['s2', 's1']);
  });

  it('/ bare with BOTH zero albums AND zero spaces: both sections empty', async () => {
    const m = new GlobalSearchManager();
    m.albumsCache = [];
    m.spacesCache = [];

    m.setQuery('/');
    await vi.advanceTimersByTimeAsync(150);

    expect(m.sections.albums.status).toBe('empty');
    expect(m.sections.spaces.status).toBe('empty');
  });

  it('/ bare mixed empty: albums ok, spaces empty', async () => {
    const m = new GlobalSearchManager();
    m.albumsCache = [{ id: 'a1', albumName: 'Only', endDate: '2026-04-15T00:00:00Z' }] as never;
    m.spacesCache = [];

    m.setQuery('/');
    await vi.advanceTimersByTimeAsync(150);

    expect(m.sections.albums.status).toBe('ok');
    expect(m.sections.spaces.status).toBe('empty');
  });

  it('/ bare mixed empty (symmetric): albums empty, spaces ok', async () => {
    const m = new GlobalSearchManager();
    m.albumsCache = [];
    m.spacesCache = [{ id: 's1', name: 'Only', createdAt: '2026-04-15T00:00:00Z' }] as never;

    m.setQuery('/');
    await vi.advanceTimersByTimeAsync(150);

    expect(m.sections.albums.status).toBe('empty');
    expect(m.sections.spaces.status).toBe('ok');
  });
});
```

**Step 2: Run to verify failure.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/global-search-manager.svelte.spec.ts 2>&1 | tail -10
```

Expected: 7 new tests fail — providers don't have bare-prefix paths yet.

**Step 3: Update the three providers to add bare-prefix branches.**

Locate `buildProviders` (line 1509). Update:

```ts
// Tags provider: add bare branch in runTagsProvider.
// Locate runTagsProvider (line 1480). After tagsCache load:
private async runTagsProvider(query: string, signal: AbortSignal): Promise<ProviderStatus<TagResponseDto>> {
  if (this.tagsDisabled) return { status: 'error', message: 'tag_cache_too_large' };
  if (this.tagsCache === null) {
    try {
      const all = await getAllTags({ signal });
      if (all.length > 20_000) {
        this.tagsDisabled = true;
        console.warn('[cmdk] tag cache > 20k, disabling tag provider for session');
        return { status: 'error', message: 'tag_cache_too_large' };
      }
      if (all.length > 5000) console.warn(`[cmdk] tag cache is large (${all.length} entries)`);
      this.tagsCache = all;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      return { status: 'error', message: error instanceof Error ? error.message : 'getAllTags failed' };
    }
  }

  if (query === '') {
    // Bare #: top 5 by updatedAt desc.
    const sorted = [...this.tagsCache].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    const matches = sorted.slice(0, 5);
    return matches.length === 0 ? { status: 'empty' } : { status: 'ok', items: matches, total: matches.length };
  }

  const q = query.toLowerCase();
  const matches = this.tagsCache.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 5);
  return matches.length === 0 ? { status: 'empty' } : { status: 'ok', items: matches, total: matches.length };
}
```

For albums, update `runAlbums` (line 1392). **Sort key:** `AlbumNameDto` has NO `updatedAt`; use `endDate ?? ''` desc as the activity proxy:

```ts
async runAlbums(rawQuery: string): Promise<void> {
  const query = rawQuery.trim().toLowerCase();
  // Bare-prefix path dispatches here with rawQuery === ''. The existing
  // `if (query.length < 2)` early-return must be removed (Step 3.5 below).
  await this.ensureAlbumsCache();
  if (this.albumsCache === undefined) return;

  if (query === '') {
    // Bare /: top 5 by endDate (?? '') desc. AlbumNameDto has no updatedAt; endDate
    // is "most recent photo in album" which is a better activity proxy anyway.
    const sorted = [...this.albumsCache].sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? ''));
    const top = sorted.slice(0, ALBUMS_TOP_N);
    this.sections.albums = top.length === 0
      ? { status: 'empty' }
      : { status: 'ok', items: top as unknown as EntityItem[], total: sorted.length };
    return;
  }

  // ... existing filter+score logic unchanged
  type Scored = { album: AlbumNameDto; score: number };
  const matches: Scored[] = [];
  for (const album of this.albumsCache) {
    const name = album.albumName.toLowerCase();
    if (name.includes(query)) matches.push({ album, score: name.startsWith(query) ? 2 : 1 });
  }
  matches.sort((a, b) => b.score - a.score || a.album.albumName.localeCompare(b.album.albumName));
  if (matches.length === 0) {
    this.sections.albums = { status: 'empty' };
    return;
  }
  this.sections.albums = {
    status: 'ok',
    items: matches.slice(0, ALBUMS_TOP_N).map((m) => m.album) as unknown as EntityItem[],
    total: matches.length,
  };
}
```

Symmetrically for `runSpaces` (line 1445):

```ts
async runSpaces(rawQuery: string): Promise<void> {
  const query = rawQuery.trim().toLowerCase();
  await this.ensureSpacesCache();
  if (this.spacesCache === undefined) return;

  if (query === '') {
    // Bare /: top 5 by (lastActivityAt ?? createdAt) desc.
    const recency = (s: SharedSpaceResponseDto): string => s.lastActivityAt ?? s.createdAt;
    const sorted = [...this.spacesCache].sort((a, b) => recency(b).localeCompare(recency(a)));
    const top = sorted.slice(0, SPACES_TOP_N);
    this.sections.spaces = top.length === 0
      ? { status: 'empty' }
      : { status: 'ok', items: top as unknown as EntityItem[], total: sorted.length };
    return;
  }

  // ... existing filter+score logic unchanged
  type Scored = { space: SharedSpaceResponseDto; score: number };
  const matches: Scored[] = [];
  for (const space of this.spacesCache) {
    const name = space.name.toLowerCase();
    if (name.includes(query)) matches.push({ space, score: name.startsWith(query) ? 2 : 1 });
  }
  matches.sort((a, b) => b.score - a.score || a.space.name.localeCompare(b.space.name));
  if (matches.length === 0) {
    this.sections.spaces = { status: 'empty' };
    return;
  }
  this.sections.spaces = {
    status: 'ok',
    items: matches.slice(0, SPACES_TOP_N).map((m) => m.space) as unknown as EntityItem[],
    total: matches.length,
  };
}
```

**Step 3.5 (CRITICAL — do not skip): Remove the `query.length < 2` early-returns in `runAlbums` and `runSpaces`.**

The existing `runAlbums` and `runSpaces` have an early-return at the top:

```ts
async runAlbums(rawQuery: string): Promise<void> {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 2) {            // ← REMOVE
    this.sections.albums = { status: 'idle' };  // ← REMOVE
    return;                           // ← REMOVE
  }
  await this.ensureAlbumsCache();
  // ...
}
```

Under the new `runBatch`, bare prefix dispatches with `query === ''` (length 0), and the bare-branch inside the method handles it. If you leave the early-return, the bare branch is unreachable and `/` suggestions render nothing — a silent bug the type system cannot catch.

**Remove both early-returns.** The minQueryLength gate is now enforced upstream in `runBatch`.

Verify by running the bare `/` test from Step 1 — it must transition from fail → pass only after this removal.

**Step 4: Run to verify pass.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/global-search-manager.svelte.spec.ts 2>&1 | tail -5
```

Expected: 7 new tests pass, all prior ones still pass.

**Step 5: Commit.**

```bash
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): bare-prefix suggestions for tags, albums, spaces

Each provider branches on query === '' to return top-N sorted by
recency. Tags: updatedAt desc. Albums: endDate desc (AlbumNameDto has
no updatedAt — endDate is 'most recent photo in album' as activity
proxy). Spaces: (lastActivityAt ?? createdAt) desc. Reuses existing
in-memory caches — no new SDK calls.

Also removes the query.length < 2 early-returns in runAlbums and
runSpaces; the minQueryLength gate now lives in runBatch upstream."
```

---

## Task 6: People suggestions — `ensurePeopleSuggestionsCache` + stale-rejection guard

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Step 1: Write failing tests.**

```ts
describe('prefix scoping — bare @ suggestions', () => {
  it('bare @ calls getAllPeople once; subsequent bare @ reads cache', async () => {
    const m = new GlobalSearchManager();
    const getAllPeopleSpy = vi.mocked(getAllPeople);
    getAllPeopleSpy.mockResolvedValue({ people: [mockPerson('p1', 'Alice')], total: 1, hidden: 0, hasNextPage: false });

    m.setQuery('@');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runAllTimersAsync();
    m.setQuery('@a');
    await vi.advanceTimersByTimeAsync(150);
    m.setQuery('@');
    await vi.advanceTimersByTimeAsync(150);

    expect(getAllPeopleSpy).toHaveBeenCalledTimes(1);
  });

  it('concurrent bare @ joins same peoplePromise (getAllPeople fires once)', async () => {
    const m = new GlobalSearchManager();
    const getAllPeopleSpy = vi.mocked(getAllPeople);
    let resolve: (v: unknown) => void;
    getAllPeopleSpy.mockImplementation(() => new Promise((r) => (resolve = r as (v: unknown) => void)));

    m.setQuery('@');
    await vi.advanceTimersByTimeAsync(150);
    m.setQuery('@a'); // would fire searchPerson
    m.setQuery('@'); // back to bare — should NOT start a second getAllPeople
    await vi.advanceTimersByTimeAsync(150);

    resolve!({ people: [mockPerson('p1', 'Alice')], total: 1, hidden: 0, hasNextPage: false });
    await vi.runAllTimersAsync();

    expect(getAllPeopleSpy).toHaveBeenCalledTimes(1);
  });

  it('stale bare-@ rejection after @alice resolves does NOT stomp ok results', async () => {
    const m = new GlobalSearchManager();
    const getAllPeopleSpy = vi.mocked(getAllPeople);
    let rejectFn: (e: Error) => void;
    getAllPeopleSpy.mockImplementation(() => new Promise((_, r) => (rejectFn = r as (e: Error) => void)));
    vi.mocked(searchPerson).mockResolvedValue([mockPerson('p1', 'Alice')] as never);

    m.setQuery('@'); // bare, starts getAllPeople fetch
    await vi.advanceTimersByTimeAsync(150);
    m.setQuery('@alice'); // now non-bare; searchPerson resolves
    await vi.advanceTimersByTimeAsync(150);
    await vi.runAllTimersAsync();

    expect(m.sections.people.status).toBe('ok');

    rejectFn!(new Error('network'));
    // Flush microtasks so the catch branch runs.
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(m.sections.people.status).toBe('ok'); // not stomped to error
  });

  it('bare @ network error while still at bare @ writes error to section', async () => {
    const m = new GlobalSearchManager();
    vi.mocked(getAllPeople).mockRejectedValue(new Error('network down'));

    m.setQuery('@');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(m.sections.people.status).toBe('error');
    expect((m.sections.people as { message: string }).message).toBe('network down');
  });

  it('bare @ with zero named people returns empty', async () => {
    const m = new GlobalSearchManager();
    vi.mocked(getAllPeople).mockResolvedValue({ people: [], total: 0, hidden: 0, hasNextPage: false });
    m.setQuery('@');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runAllTimersAsync();
    expect(m.sections.people.status).toBe('empty');
  });

  it('getAllPeople 5-second timeout transitions section to timeout', async () => {
    const m = new GlobalSearchManager();
    // getAllPeople binds to closeSignal (not per-keystroke AbortSignal.timeout(5000)),
    // so this test simulates a fetch that never resolves within the 5s window; the
    // provider-level AbortSignal.timeout inside runBatch fires at 5s and the
    // surrounding people.run catch branch writes 'timeout'.
    vi.mocked(getAllPeople).mockImplementation(
      ({}, opts) =>
        new Promise((_, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            const err = new DOMException('timeout', 'TimeoutError');
            reject(err);
          });
        }),
    );

    m.setQuery('@');
    await vi.advanceTimersByTimeAsync(150); // debounce fires
    await vi.advanceTimersByTimeAsync(5000); // AbortSignal.timeout fires
    await vi.runAllTimersAsync();

    expect(m.sections.people.status).toBe('timeout');
  });

  it('close + reopen resets peopleSuggestionsCache and peoplePromise', async () => {
    const m = new GlobalSearchManager();
    const getAllPeopleSpy = vi.mocked(getAllPeople);
    getAllPeopleSpy.mockResolvedValue({ people: [mockPerson('p1', 'Alice')], total: 1, hidden: 0, hasNextPage: false });

    m.open();
    m.setQuery('@');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runAllTimersAsync();
    m.close();
    m.open();
    m.setQuery('@');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runAllTimersAsync();

    expect(getAllPeopleSpy).toHaveBeenCalledTimes(2);
  });
});
```

Helper (define once in the spec if not already present):

```ts
const mockPerson = (id: string, name: string, updatedAt?: string): PersonResponseDto => ({
  id,
  name,
  birthDate: null,
  isHidden: false,
  thumbnailPath: '',
  type: 'person',
  updatedAt,
});
```

**Step 2: Run to verify failure.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/global-search-manager.svelte.spec.ts 2>&1 | tail -10
```

Expected: 7 new tests fail — `ensurePeopleSuggestionsCache` doesn't exist yet.

**Step 3: Add imports and state fields.**

In `global-search-manager.svelte.ts`, extend the `@immich/sdk` import:

```ts
import {
  getAlbumInfo,
  getAlbumNames,
  getAllPeople,
  getAllSpaces,
  getAllTags,
  getMlHealth,
  getSpace,
  searchAssets,
  searchPerson,
  searchPlaces,
  searchSmart,
  type AlbumNameDto,
  type MetadataSearchDto,
  type PersonResponseDto,
  type SharedSpaceResponseDto,
  type TagResponseDto,
} from '@immich/sdk';
import { parseScope, personSuggestionsComparator, type ParsedQuery, type Scope } from './cmdk-prefix';
```

Add state fields alongside `albumsCache` / `spacesCache` (around line 238):

```ts
peopleSuggestionsCache: PersonResponseDto[] | undefined = $state(undefined);
private peoplePromise: Promise<void> | undefined;
```

Extend `open()` (line 347) to reset the people fields alongside the album/space ones:

```ts
open() {
  this.isOpen = true;
  if (this.closeController.signal.aborted) this.closeController = new AbortController();
  this.albumsPromise = undefined;
  this.spacesPromise = undefined;
  // People suggestions follow the same reset-on-open pattern.
  this.peopleSuggestionsCache = undefined;
  this.peoplePromise = undefined;
  if (!this.mlProbed) {
    this.mlProbed = true;
    void this.probeMlHealth();
  }
}
```

Add `ensurePeopleSuggestionsCache` + `fetchPeopleSuggestions` (near `ensureAlbumsCache`, around line 383):

```ts
async ensurePeopleSuggestionsCache(): Promise<void> {
  if (this.peopleSuggestionsCache !== undefined) return;
  if (this.peoplePromise === undefined) {
    this.peoplePromise = this.fetchPeopleSuggestions();
  }
  return this.peoplePromise;
}

private async fetchPeopleSuggestions(): Promise<void> {
  // 5-second per-request timeout on top of closeSignal. Bare-@ runs through
  // ensurePeopleSuggestionsCache, which is independent of the per-keystroke
  // batchController.signal — without this timeout, a stuck fetch would leave
  // the section in 'loading' forever until the palette closes.
  const signal = AbortSignal.any([this.closeSignal, AbortSignal.timeout(5000)]);
  try {
    const response = await getAllPeople({ size: 10 }, { signal });
    this.peopleSuggestionsCache = [...response.people].sort(personSuggestionsComparator);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      // Distinguish timeout from close-driven abort.
      const isTimeout = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';
      if (isTimeout && this.scope === 'people' && this.payload === '') {
        this.sections.people = { status: 'timeout' };
      }
      return;
    }
    // Stale-rejection guard: only surface an error if the manager is still in the
    // bare-@ state this fetch was kicked off for. Otherwise the user has typed on
    // and we must not stomp fresh `searchPerson` results.
    if (this.scope === 'people' && this.payload === '') {
      this.sections.people = { status: 'error', message: error instanceof Error ? error.message : 'unknown error' };
    }
    throw error;
  }
}
```

**Step 4: Wire the people provider's `run()` to use the cache.**

Locate the `people` provider in `buildProviders` (line 1547). Replace with:

```ts
const people: Provider = {
  key: 'people',
  topN: 5,
  minQueryLength: 2,
  run: async (query, _mode, signal) => {
    if (query === '') {
      // Bare @: suggestions path.
      try {
        await this.ensurePeopleSuggestionsCache();
      } catch {
        // ensurePeopleSuggestionsCache already transitioned the section (guarded)
        // or silently dropped an AbortError. Return the current section state.
        return this.sections.people;
      }
      if (this.peopleSuggestionsCache === undefined) return this.sections.people;
      const items = this.peopleSuggestionsCache.slice(0, 10);
      return items.length === 0 ? { status: 'empty' } : { status: 'ok', items, total: items.length };
    }
    try {
      const results = await searchPerson({ name: query, withHidden: false }, { signal });
      return results.length === 0
        ? { status: 'empty' }
        : { status: 'ok', items: results.slice(0, 5), total: results.length };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      return { status: 'error', message: error instanceof Error ? error.message : 'unknown error' };
    }
  },
};
```

**Step 5: Run to verify pass.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/global-search-manager.svelte.spec.ts 2>&1 | tail -5
```

Expected: the 7 new tests pass; prior tests still pass.

**Step 6: Commit.**

```bash
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): bare-@ suggestions via ensurePeopleSuggestionsCache

Add peopleSuggestionsCache + peoplePromise (reset on open, matching
albums/spaces). Promise-join prevents double-fetch on rapid retypes.
Stale-rejection guard (scope === 'people' && payload === '') prevents
a late-arriving bare-@ rejection from stomping fresh searchPerson
results. personSuggestionsComparator applied client-side."
```

---

## Task 7: Scope-aware `runNavigationProvider`

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Step 1: Write failing tests.**

```ts
describe('prefix scoping — runNavigationProvider', () => {
  it('scope nav bare: count equals the filtered catalog length (no slice)', async () => {
    mockUser.current = { id: 'admin', isAdmin: true };
    const m = new GlobalSearchManager();
    m.setQuery('>');
    await vi.advanceTimersByTimeAsync(150);

    // Filtered catalog: iterate NAVIGATION_ITEMS with the same admin + flag gate.
    const flags = mockFlags.valueOrUndefined;
    const expected = NAVIGATION_ITEMS.filter(
      (i) => (!i.adminOnly || true) && (!i.featureFlag || flags?.[i.featureFlag]),
    ).length;

    expect(m.sections.navigation.status).toBe('ok');
    const items = (m.sections.navigation as { items: { id: string }[] }).items;
    expect(items.length).toBe(expected); // strict equality — no slice
  });

  it('scope nav bare: items sorted alphabetically by translated label', async () => {
    mockUser.current = { id: 'admin', isAdmin: true };
    const m = new GlobalSearchManager();
    m.setQuery('>');
    await vi.advanceTimersByTimeAsync(150);
    const items = (m.sections.navigation as { items: { id: string; labelKey: string }[] }).items;
    const translate = (k: string) => k; // replace with real svelte-i18n get(t) or stub; simplified here
    const labels = items.map((i) => translate(i.labelKey));
    const sorted = [...labels].sort((a, b) => a.localeCompare(b));
    expect(labels).toEqual(sorted);
  });

  it('scope nav with payload: fuzzy search payload over filtered items', async () => {
    mockUser.current = { id: 'admin', isAdmin: true };
    const m = new GlobalSearchManager();
    m.setQuery('>theme');
    await vi.advanceTimersByTimeAsync(150);
    expect(m.sections.navigation.status).toBe('ok');
    const items = (m.sections.navigation as { items: { id: string }[] }).items;
    expect(items.some((i) => i.id === 'nav:theme')).toBe(true);
  });

  it('scope people (any payload): navigation section is empty', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('@alice');
    await vi.advanceTimersByTimeAsync(150);
    expect(m.sections.navigation.status).toBe('empty');
  });

  it('scope all with payload: existing fuzzy behavior preserved', async () => {
    mockUser.current = { id: 'admin', isAdmin: true };
    const m = new GlobalSearchManager();
    m.setQuery('classification');
    await vi.advanceTimersByTimeAsync(150);
    expect(m.sections.navigation.status).toBe('ok');
  });

  it('scope nav for non-admin with restrictive flags: returns empty (not ok:[])', async () => {
    mockUser.current = { id: 'user', isAdmin: false };
    const originalFlags = mockFlags.valueOrUndefined;
    // Simulate a flag state where no user page is allowed.
    mockFlags.valueOrUndefined = {};
    const m = new GlobalSearchManager();
    m.setQuery('>');
    await vi.advanceTimersByTimeAsync(150);
    expect(m.sections.navigation.status).toBe('empty');
    // Teardown
    mockFlags.valueOrUndefined = originalFlags;
  });
});
```

**Step 2: Run to verify failure.**

Expected: tests fail — `runNavigationProvider('>alice', 'all')` not called; signature mismatch.

**Step 3: Change `runNavigationProvider` signature + call-site.**

Replace `runNavigationProvider` (line 312):

```ts
private runNavigationProvider(payload: string, scope: Scope): ProviderStatus<NavigationItem> {
  // Non-nav entity scopes hide the navigation section entirely.
  if (scope !== 'all' && scope !== 'nav') {
    return { status: 'empty' };
  }

  // Scope 'all' with empty payload matches today's behavior (no nav results on idle).
  if (scope === 'all' && payload === '') {
    return { status: 'empty' };
  }

  const u = get(user);
  const isAdmin = u?.isAdmin ?? false;
  const flags = featureFlagsManager.valueOrUndefined;
  const searchStrings = this.getNavigationSearchStrings();

  // Admin + flag filter applied in both branches below.
  const eligible: NavigationItem[] = [];
  for (const item of NAVIGATION_ITEMS) {
    if (item.adminOnly && !isAdmin) continue;
    if (item.featureFlag && !flags?.[item.featureFlag]) continue;
    eligible.push(item);
  }

  // Scope 'nav' with bare payload → return all eligible items alphabetical by translated label.
  if (scope === 'nav' && payload === '') {
    const translate = get(t);
    const sorted = [...eligible].sort((a, b) =>
      translate(a.labelKey as Translations).localeCompare(translate(b.labelKey as Translations)),
    );
    return sorted.length === 0 ? { status: 'empty' } : { status: 'ok', items: sorted, total: sorted.length };
  }

  // Non-empty payload (under 'all' or 'nav'): fuzzy score against payload.
  const scored: Array<{ item: NavigationItem; score: number }> = [];
  for (const item of eligible) {
    const corpus = searchStrings.get(item.id);
    if (!corpus) continue;
    const score = computeCommandScore(corpus, payload);
    if (score <= 0) continue;
    scored.push({ item, score });
  }
  if (scored.length === 0) return { status: 'empty' };
  scored.sort((a, b) => b.score - a.score);
  const items = scored.map((s) => s.item);
  return { status: 'ok', items, total: items.length };
}
```

Update the call-site in `setQuery` (line 1266):

```ts
this.sections.navigation = this.runNavigationProvider(this.payload, this.scope);
```

**Step 4: Run to verify pass + type check.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/global-search-manager.svelte.spec.ts 2>&1 | tail -5
pnpm --filter=immich-web check 2>&1 | tail -5
```

Expected: tests pass, 0 type errors.

**Step 5: Commit.**

```bash
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): scope-aware runNavigationProvider

Signature changes to (payload, scope). Scope all: existing fuzzy
search. Scope nav bare: all admin+flag-filtered items alphabetical by
translated label. Scope nav with payload: fuzzy search payload.
Scope people/tags/collections: empty (section does not render)."
```

---

## Task 8: SWR force-idle in `setQuery` + navigation sync

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

The scope-aware idle reset is already done inside `runBatch` (Task 4) — but `setQuery` also has its own SWR loop that runs _before_ the 150ms debounce. That loop needs the same scope-awareness to prevent flashing stale sections during the debounce window.

**Step 1: Write failing tests.**

```ts
describe('prefix scoping — setQuery SWR scope behavior', () => {
  it('scope transition from all to people force-idles non-people sections BEFORE debounce fires', () => {
    const m = new GlobalSearchManager();
    m.sections.photos = { status: 'ok', items: [{ id: 'p1' }] as never, total: 1 };
    m.sections.albums = { status: 'ok', items: [{ id: 'a1' }] as never, total: 1 };

    m.setQuery('@alice');
    // Do NOT advance timers — assert state IMMEDIATELY (pre-debounce).
    expect(m.sections.photos.status).toBe('idle');
    expect(m.sections.albums.status).toBe('idle');
    expect(m.sections.people.status).toBe('loading');
  });

  it('scope away (people → all) clears SWR-stale state on non-photo sections', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('@alice');
    await vi.advanceTimersByTimeAsync(150);
    m.setQuery('alice');
    // All entity sections should be loading (they were idle under @, now scope all dispatches)
    expect(m.sections.photos.status).toBe('loading');
  });

  it('within-scope payload change preserves ok sections (existing SWR)', async () => {
    const m = new GlobalSearchManager();
    vi.mocked(searchPerson).mockResolvedValue([mockPerson('p1', 'Alice')] as never);
    m.setQuery('@al');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runAllTimersAsync();
    expect(m.sections.people.status).toBe('ok');

    // Adding a char — scope and provider stay the same. people section should NOT
    // flip to loading; ok is SWR-preserved.
    m.setQuery('@ali');
    expect(m.sections.people.status).toBe('ok');
  });

  it('scope transition aborts the prior batchController', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('alice');
    await vi.advanceTimersByTimeAsync(150);
    const priorBatch = m['batchController'];
    expect(priorBatch).not.toBeNull();
    expect(priorBatch?.signal.aborted).toBe(false);

    m.setQuery('@alice');
    expect(priorBatch?.signal.aborted).toBe(true);
    expect(m['batchController']).not.toBe(priorBatch); // fresh controller
  });

  it('rapid scope thrash (@ → # → /) aborts cleanly and inFlightCounter stays consistent', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('@alice');
    m.setQuery('#xmas');
    m.setQuery('/trip');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runAllTimersAsync();

    // After all transitions settle, batchInFlight must drop to false (no stranded counter).
    expect(m.batchInFlight).toBe(false);
    // Only the final scope's sections should be non-idle (collections).
    expect(m.sections.photos.status).toBe('idle');
    expect(m.sections.people.status).toBe('idle');
    expect(m.sections.tags.status).toBe('idle');
  });

  it('/ while albumsCache promise is in-flight: callers join the same promise', async () => {
    const m = new GlobalSearchManager();
    const getAlbumNamesSpy = vi.mocked(getAlbumNames);
    let resolve: (v: unknown) => void;
    getAlbumNamesSpy.mockImplementation(() => new Promise((r) => (resolve = r as (v: unknown) => void)));

    m.setQuery('/tr');
    await vi.advanceTimersByTimeAsync(150);
    m.setQuery('/tri');
    await vi.advanceTimersByTimeAsync(150);
    // Both dispatches await the same albumsPromise.
    resolve!([{ id: 'a1', albumName: 'Trip' }] as never);
    await vi.runAllTimersAsync();

    expect(getAlbumNamesSpy).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run to verify failure.**

Expected: the "force-idles before debounce", "rapid thrash", and "aborts prior batchController" tests fail — `setQuery`'s SWR loop doesn't yet know about scope. The other two may pass against existing behavior; keep them regardless (regression pins).

**Step 3: Update `setQuery`'s SWR loop.**

Replace the SWR loop in `setQuery` (around line 1256-1261):

```ts
// Previously:
//   for (const key of ['photos','people','places','tags','albums','spaces'] as const) {
//     if (this.sections[key].status !== 'ok') this.sections[key] = { status: 'loading' };
//   }
//
// Now: force non-scope to idle first, then SWR-preserve scope-matching sections.

const inScope = new Set(ENTITY_KEYS_BY_SCOPE[this.scope]);
for (const key of ['photos', 'people', 'places', 'tags', 'albums', 'spaces'] as const) {
  if (!inScope.has(key)) {
    this.sections[key] = idle;
    continue;
  }
  if (this.sections[key].status !== 'ok') {
    this.sections[key] = { status: 'loading' };
  }
}
```

**Step 4: Verify pass + type check.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/global-search-manager.svelte.spec.ts 2>&1 | tail -5
pnpm --filter=immich-web check 2>&1 | tail -5
```

Expected: all tests pass, 0 type errors.

**Step 5: Reference — final `setQuery` layout after Tasks 3, 4, 7, 8.**

For clarity, here's the final ordering inside `setQuery(text: string)`:

```ts
setQuery(text: string) {
  if (this.query === text) return;
  this.query = text;                             // triggers parsedQuery / scope / payload re-derive
  this.clearDebounce();
  this.batchController?.abort();
  this.batchController = null;
  this.photosController?.abort();
  this.photosController = null;

  if (text.trim() === '') {
    // Empty-text short-circuit (unchanged). All sections → idle.
    this.sections = { photos: idle, people: idle, places: idle, tags: idle, albums: idle, spaces: idle, navigation: idle };
    this.batchInFlight = false;
    this.inFlightCounter = 0;
    this._batchInFlightStartedAt = 0;
    return;
  }

  // Task 8: scope-aware SWR loop — non-scope sections force-idle, scope-matching follow SWR.
  const inScope = new Set(ENTITY_KEYS_BY_SCOPE[this.scope]);
  for (const key of ['photos', 'people', 'places', 'tags', 'albums', 'spaces'] as const) {
    if (!inScope.has(key)) {
      this.sections[key] = idle;
      continue;
    }
    if (this.sections[key].status !== 'ok') {
      this.sections[key] = { status: 'loading' };
    }
  }

  // Task 7: navigation runs synchronously with new (payload, scope) signature.
  this.sections.navigation = this.runNavigationProvider(this.payload, this.scope);

  // reconcile cursor against the fresh section/scope state (Task 9 uses scope-aware order).
  this.reconcileCursor();

  // Kick off the debounced entity fan-out.
  this.batchInFlight = true;
  this._batchInFlightStartedAt = Number.POSITIVE_INFINITY;
  this.debounceTimer = setTimeout(() => this.runBatch(text, this.mode), 150);
}
```

This snippet is reference only — tasks above do the actual edits piecewise. Before Task 9 ships, run the full manager spec and confirm the above layout matches the reality.

**Step 6: Commit.**

```bash
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): scope-aware SWR in setQuery

Non-scope sections reset to idle synchronously; scope-matching sections
keep the existing ok-preserving SWR rule. Prevents the 150ms debounce
window from flashing stale photo results under an @ scope. Rapid scope
thrash aborts cleanly (batchController abort + counter reset)."
```

---

## Task 9: `reconcileCursor` scope-aware order + cursor preservation

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Step 1: Write failing tests.**

```ts
describe('prefix scoping — reconcileCursor', () => {
  it('all reconcile order is [photos, albums, spaces, people, places, tags, navigation]', () => {
    const m = new GlobalSearchManager();
    // All sections empty except albums with one item.
    m.sections.albums = { status: 'ok', items: [{ id: 'a1' }] as never, total: 1 };
    m.setActiveItem(null);
    m.reconcileCursor();
    expect(m.activeItemId).toBe('album:a1');
  });

  it('scope transition preserves cursor when target stays in scope', () => {
    const m = new GlobalSearchManager();
    m.sections.people = { status: 'ok', items: [{ id: 'alice-id' } as never], total: 1 };
    m.setActiveItem('person:alice-id');

    m.setQuery('@');
    // Do not advance — prove cursor is still on Alice through the synchronous scope transition.
    expect(m.activeItemId).toBe('person:alice-id');
  });

  it('scope transition reconciles when target exits scope', () => {
    const m = new GlobalSearchManager();
    m.sections.photos = { status: 'ok', items: [{ id: 'p1' } as never], total: 1 };
    m.sections.people = { status: 'ok', items: [{ id: 'alice-id' } as never], total: 1 };
    m.setActiveItem('photo:p1');

    m.setQuery('@alice');
    // Photo cursor exits scope; reconcile picks first person.
    expect(m.activeItemId).toBe('person:alice-id');
  });

  it('/trip lands cursor on first album (albums before spaces)', async () => {
    const m = new GlobalSearchManager();
    m.albumsCache = [{ id: 'a1', albumName: 'Trip 2024', endDate: '2026-04-15T00:00:00Z' }] as never;
    m.spacesCache = [{ id: 's1', name: 'Trip club', createdAt: '2026-04-15T00:00:00Z' }] as never;
    m.setQuery('/trip');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runAllTimersAsync();
    expect(m.activeItemId).toBe('album:a1');
  });
});
```

**Step 2: Run to verify failure.**

Expected: the "all reconcile order" test fails — existing order is missing albums/spaces.

**Step 3: Add `RECONCILE_ORDER_BY_SCOPE` and update `reconcileCursor`.**

Add constant near `ENTITY_KEYS_BY_SCOPE`:

```ts
const RECONCILE_ORDER_BY_SCOPE: Record<Scope, ReadonlyArray<keyof Sections>> = {
  all: ['photos', 'albums', 'spaces', 'people', 'places', 'tags', 'navigation'],
  people: ['people'],
  tags: ['tags'],
  collections: ['albums', 'spaces'],
  nav: ['navigation'],
};
```

Replace `reconcileCursor` (line 776):

```ts
reconcileCursor() {
  if (this.getActiveItem() !== null) return;
  const order = RECONCILE_ORDER_BY_SCOPE[this.scope];
  const kindOf: Record<keyof Sections, string> = {
    photos: 'photo', people: 'person', places: 'place', tags: 'tag',
    albums: 'album', spaces: 'space', navigation: 'nav',
  };
  for (const key of order) {
    const s = this.sections[key];
    if (s.status === 'ok' && s.items.length > 0) {
      const first = s.items[0] as { id?: string; latitude?: number; longitude?: number };
      if (first.id !== undefined) {
        this.activeItemId = key === 'navigation' ? first.id : `${kindOf[key]}:${first.id}`;
        return;
      }
      if (key === 'places' && first.latitude !== undefined && first.longitude !== undefined) {
        this.activeItemId = `place:${first.latitude.toFixed(4)}:${first.longitude.toFixed(4)}`;
        return;
      }
    }
  }
  this.activeItemId = null;
}
```

**Step 4: Run to verify pass.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/global-search-manager.svelte.spec.ts 2>&1 | tail -5
```

Expected: all 4 new tests pass. A previous test that asserted the old order (if any) may break — inspect and update that test to the new order (treat as regression fix, not a spec break).

**Step 5: Commit.**

```bash
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): scope-aware reconcileCursor with albums/spaces

Add RECONCILE_ORDER_BY_SCOPE. All-scope order now matches render order
(photos, albums, spaces, people, places, tags, navigation) — tangentially
fixes a pre-existing miss where albums/spaces weren't in the order.
Per-scope orders scope down the search to matching sections."
```

---

## Task 10: `setMode` scope short-circuit

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Step 1: Write failing tests.**

```ts
describe('prefix scoping — setMode under scope', () => {
  it('setMode under scope persists mode but does NOT dispatch request', async () => {
    const m = new GlobalSearchManager();
    const searchSmartSpy = vi.mocked(searchSmart);
    const searchAssetsSpy = vi.mocked(searchAssets);
    searchSmartSpy.mockClear();
    searchAssetsSpy.mockClear();

    m.setQuery('@alice');
    await vi.advanceTimersByTimeAsync(150);
    searchSmartSpy.mockClear(); // ignore any prior dispatches
    const priorPhotosController = m['photosController'];

    m.setMode('metadata');
    await vi.advanceTimersByTimeAsync(150);

    expect(m.mode).toBe('metadata');
    expect(localStorage.getItem('searchQueryType')).toBe('metadata');
    expect(searchSmartSpy).not.toHaveBeenCalled();
    expect(searchAssetsSpy).not.toHaveBeenCalled();
    // photosController must NOT have been recreated under scope — same reference.
    expect(m['photosController']).toBe(priorPhotosController);
  });

  it('setMode under scope all still dispatches photos re-run', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('alice');
    await vi.advanceTimersByTimeAsync(150);
    const searchAssetsSpy = vi.mocked(searchAssets);
    searchAssetsSpy.mockClear();

    m.setMode('metadata');
    await vi.advanceTimersByTimeAsync(150);

    expect(searchAssetsSpy).toHaveBeenCalled();
  });
});
```

**Step 2: Run to verify failure.**

Expected: first test fails — setMode re-runs photos even under scope.

**Step 3: Add scope short-circuit to `setMode`.**

In `setMode` (line 1035), right after the localStorage write and before the debounce/SWR logic:

```ts
setMode(newMode: SearchMode) {
  if (newMode === this.mode) return;
  this.mode = newMode;
  if (browser) {
    try { localStorage.setItem('searchQueryType', newMode); } catch { /* ignore */ }
  }

  // Scope short-circuit: photos isn't dispatched under any prefix, so a mode
  // change under scope has no runtime effect. Mode still persists for next
  // unscoped search.
  if (this.scope !== 'all') return;

  // ... existing debounce / SWR / photos re-run logic unchanged
}
```

**Step 4: Verify pass.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/global-search-manager.svelte.spec.ts 2>&1 | tail -5
```

Expected: both new tests pass.

**Step 5: Commit.**

```bash
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): setMode scope short-circuit

Mode changes under any prefix persist to localStorage but skip the
photos re-run — photos isn't dispatched under scope. Next unscoped
search picks up the persisted mode."
```

---

## Task 11: `announcementText` scope emission

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`
- Modify: `i18n/en.json`

**Step 1: Add the 4 announce i18n keys.**

In `i18n/en.json`, add:

```json
"cmdk_announce_scoped_people": "Scoped to people.",
"cmdk_announce_scoped_tags": "Scoped to tags.",
"cmdk_announce_scoped_collections": "Scoped to albums & spaces.",
"cmdk_announce_scoped_nav": "Scoped to pages.",
```

Run the sort formatter:

```bash
pnpm --filter=immich-i18n format:fix
```

**Step 2: Write failing test.**

```ts
describe('prefix scoping — announcementText', () => {
  it('scope people announcement prefixed with "Scoped to people."', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('@alice');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runAllTimersAsync();
    expect(m.announcementText).toMatch(/Scoped to people/i);
  });

  it('scope tags announcement prefixed with "Scoped to tags."', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('#xmas');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runAllTimersAsync();
    expect(m.announcementText).toMatch(/Scoped to tags/i);
  });

  it('scope collections announcement prefixed with "Scoped to albums & spaces."', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('/trip');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runAllTimersAsync();
    expect(m.announcementText).toMatch(/Scoped to albums & spaces/i);
  });

  it('scope nav announcement prefixed with "Scoped to pages."', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('>theme');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runAllTimersAsync();
    expect(m.announcementText).toMatch(/Scoped to pages/i);
  });

  it('scope all announcement has no "Scoped to" prefix', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('alice');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runAllTimersAsync();
    expect(m.announcementText).not.toMatch(/Scoped to/i);
  });
});

describe('prefix scoping — defensive recent replay of scoped query', () => {
  it('activateRecent({kind:query, text:"@alice"}) re-derives scope=people, payload=alice', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.activateRecent({ kind: 'query', id: 'query:@alice:smart', text: '@alice', mode: 'smart', lastUsed: Date.now() });
    expect(m.scope).toBe('people');
    expect(m.payload).toBe('alice');
  });
});
```

**Step 3: Run to verify failure.**

Expected: the 4 "Scoped to …" tests fail — announcementText has no scope prefix yet. The "no Scoped to prefix under scope=all" test may pass (pre-existing behavior) — keep it as a regression pin. The defensive recent-replay test may pass immediately if `activateRecent` already calls `setQuery(entry.text)` and the parser re-derives; keep as regression pin.

**Step 4: Update `announcementText`.**

Replace the derived (line 1192):

```ts
announcementText = $derived.by(() => {
  const s = this.sections;
  const allSettled =
    s.photos.status !== 'loading' &&
    s.people.status !== 'loading' &&
    s.places.status !== 'loading' &&
    s.tags.status !== 'loading' &&
    s.navigation.status !== 'loading';
  if (!allSettled) return '';

  const scopeCue = this.scope === 'all' ? '' : get(t)(`cmdk_announce_scoped_${this.scope}` as Translations);

  const parts: string[] = [];
  const count = (st: ProviderStatus) => (st.status === 'ok' ? st.total : 0);
  if (count(s.photos) > 0) parts.push(`${count(s.photos)} photos`);
  if (count(s.people) > 0) parts.push(`${count(s.people)} people`);
  if (count(s.places) > 0) parts.push(`${count(s.places)} places`);
  if (count(s.tags) > 0) parts.push(`${count(s.tags)} tags`);
  if (count(s.navigation) > 0) parts.push(`${count(s.navigation)} pages`);
  const counts = parts.join(', ');
  return scopeCue && counts ? `${scopeCue} ${counts}` : scopeCue || counts;
});
```

**Step 5: Verify pass.**

```bash
pnpm --filter=immich-web test -- --run src/lib/managers/global-search-manager.svelte.spec.ts 2>&1 | tail -5
```

Expected: all 6 new tests pass.

**Step 6: Commit.**

```bash
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts i18n/en.json
git commit -m "feat(web): announcementText emits scope cue under prefix

Screen readers announce 'Scoped to people. N results' on scope change.
Four new i18n keys: cmdk_announce_scoped_{people,tags,collections,nav}.
English for collections: 'Scoped to albums & spaces.' to match
ShortcutsModal copy.

Also pins a defensive test for activateRecent replaying a scoped query
entry — setQuery(entry.text) re-derives scope via the parser."
```

---

## Task 12: UI — scope-aware rendering + `?` keybind + nav preview branch

Split into three sub-tasks to reduce executor error on the template refactor.

---

### Task 12a: Wrap existing non-empty branch in `{#if manager.scope === 'all'}`

**Goal:** preserve all existing markup verbatim, just conditional-gate it. No behavior change for unscoped users.

**Files:**

- Modify: `web/src/lib/components/global-search/global-search.svelte`
- Modify: `web/src/lib/components/global-search/__tests__/global-search.spec.ts`

**Step 1: Write failing tests.**

Append to `global-search.spec.ts`:

```ts
describe('prefix scoping — UI scope gating', () => {
  it('scope all still renders existing full section stack (regression pin)', async () => {
    const manager = new GlobalSearchManager();
    manager.query = 'alice';
    // Populate a few sections to ok.
    manager.sections.photos = { status: 'ok', items: [{ id: 'p1' } as never], total: 1 };
    manager.sections.people = { status: 'ok', items: [{ id: 'person1', name: 'Alice' } as never], total: 1 };
    const { getByText } = render(GlobalSearch, { props: { manager } });
    expect(getByText(/photos/i)).toBeInTheDocument();
    expect(getByText(/people/i)).toBeInTheDocument();
  });
});
```

**Step 2: Run red.**

```bash
pnpm --filter=immich-web test -- --run src/lib/components/global-search/__tests__/global-search.spec.ts 2>&1 | tail -5
```

Expected: if the existing spec already exercises this, the test passes immediately (regression pin). If it fails, note which sections are missing and adjust the assertion to match current rendering.

**Step 3: Wrap existing sections.**

Locate the `{:else}` branch in `global-search.svelte` (around line 394 — the non-empty query rendering). WITHOUT changing the inner markup, wrap every section from `{#if manager.topNavigationMatch}...TopResult...{/if}` through the final `<GlobalSearchNavigationSections ... />` in a single `{#if manager.scope === 'all'}...{/if}` block. Leave trailing whitespace and indentation unchanged to minimize diff noise.

**Step 4: Run green.**

Same command; assert the wrapped regression still passes.

**Step 5: Commit.**

```bash
git add web/src/lib/components/global-search/global-search.svelte \
        web/src/lib/components/global-search/__tests__/global-search.spec.ts
git commit -m "refactor(web): wrap non-empty palette branch in scope === 'all' gate

No behavior change; just nests the existing full section stack inside
{#if manager.scope === 'all'}. Prepares the template for scoped-branch
additions in Task 12b."
```

---

### Task 12b: Add scoped-branch render + scope-hide ML banner + dim mode pills + preview nav branch

**Files:**

- Modify: `web/src/lib/components/global-search/global-search.svelte`
- Modify: `web/src/lib/components/global-search/global-search-preview.svelte`
- Modify: `web/src/lib/components/global-search/global-search-footer.svelte`
- Modify: `web/src/lib/components/global-search/__tests__/global-search.spec.ts`

**Step 1: Write failing component tests.** Each test spins up `new GlobalSearchManager()` and sets `manager.query` to drive scope derivation. Use the existing render helper from `global-search.spec.ts`.

```ts
describe('prefix scoping — scoped rendering', () => {
  function makeWithScope(query: string): GlobalSearchManager {
    const m = new GlobalSearchManager();
    m.query = query; // drives parsedQuery / scope / payload deriveds
    return m;
  }

  it('scope people: only People section renders; others hidden', () => {
    const manager = makeWithScope('@alice');
    manager.sections.people = { status: 'ok', items: [{ id: 'p1', name: 'Alice' } as never], total: 1 };
    manager.sections.photos = { status: 'ok', items: [{ id: 'x1' } as never], total: 1 };
    const { queryByText } = render(GlobalSearch, { props: { manager } });
    expect(queryByText(/people/i)).toBeInTheDocument();
    expect(queryByText(/photos/i)).toBeNull();
    expect(queryByText(/albums/i)).toBeNull();
    expect(queryByText(/spaces/i)).toBeNull();
    expect(queryByText(/places/i)).toBeNull();
    expect(queryByText(/tags/i)).toBeNull();
  });

  it('scope tags: only Tags section renders', () => {
    const manager = makeWithScope('#xmas');
    manager.sections.tags = { status: 'ok', items: [{ id: 't1', name: 'xmas' } as never], total: 1 };
    const { queryByText } = render(GlobalSearch, { props: { manager } });
    expect(queryByText(/tags/i)).toBeInTheDocument();
    expect(queryByText(/people/i)).toBeNull();
  });

  it('scope collections: Albums + Spaces render; nothing else', () => {
    const manager = makeWithScope('/trip');
    manager.sections.albums = { status: 'ok', items: [{ id: 'a1', albumName: 'Trip' } as never], total: 1 };
    manager.sections.spaces = { status: 'ok', items: [{ id: 's1', name: 'Trip club' } as never], total: 1 };
    const { queryByText } = render(GlobalSearch, { props: { manager } });
    expect(queryByText(/albums/i)).toBeInTheDocument();
    expect(queryByText(/spaces/i)).toBeInTheDocument();
    expect(queryByText(/people/i)).toBeNull();
    expect(queryByText(/photos/i)).toBeNull();
  });

  it('scope nav: NavigationSections render; nothing else', () => {
    const manager = makeWithScope('>theme');
    manager.sections.navigation = { status: 'ok', items: [{ id: 'nav:theme' } as never], total: 1 };
    const { container, queryByText } = render(GlobalSearch, { props: { manager } });
    // NavigationSections don't carry a single heading — assert the nav item renders.
    expect(container.querySelector('[data-cmdk-nav-section]')).not.toBeNull();
    expect(queryByText(/photos/i)).toBeNull();
  });

  it('placeholder text is exactly "Search…"', () => {
    const manager = new GlobalSearchManager();
    const { getByPlaceholderText } = render(GlobalSearch, { props: { manager } });
    // Exact equality, not toContain — guards against the hint-bloat regression.
    expect(getByPlaceholderText('Search…')).toBeInTheDocument();
  });

  it('scope all with mlHealthy=false shows ML banner', () => {
    const manager = new GlobalSearchManager();
    manager.query = 'alice';
    manager.mlHealthy = false;
    const { getByText } = render(GlobalSearch, { props: { manager } });
    expect(getByText(/smart search is unavailable/i)).toBeInTheDocument();
  });

  it('scope people with mlHealthy=false hides ML banner', () => {
    const manager = makeWithScope('@alice');
    manager.mlHealthy = false;
    const { queryByText } = render(GlobalSearch, { props: { manager } });
    expect(queryByText(/smart search is unavailable/i)).toBeNull();
  });

  it('scope people hides TopNavigationMatch promotion', () => {
    const manager = makeWithScope('@classification');
    // Seed a fake topNavigationMatch; under scope=people the promotion must NOT render.
    const { queryByText } = render(GlobalSearch, { props: { manager } });
    expect(queryByText(/auto-classification/i)).toBeNull();
  });

  it('mode pills under scope: opacity-50, no aria-disabled, still focusable', () => {
    const manager = makeWithScope('@alice');
    const { container } = render(GlobalSearch, { props: { manager } });
    const radioGroup = container.querySelector('[role="radiogroup"]');
    expect(radioGroup?.className).toMatch(/opacity-50/);
    expect(container.querySelectorAll('[aria-disabled]').length).toBe(0);
    const radios = container.querySelectorAll('input[type="radio"][name="cmdk-mode"]');
    expect(radios.length).toBeGreaterThan(0);
    // Radio inputs default to tabindex=0; confirm none are tabindex=-1.
    radios.forEach((r) => expect((r as HTMLInputElement).tabIndex).not.toBe(-1));
  });

  it('mode pills under scope click does not dispatch searchSmart/searchAssets', async () => {
    const manager = makeWithScope('@alice');
    const searchSmartSpy = vi.mocked(searchSmart);
    const searchAssetsSpy = vi.mocked(searchAssets);
    searchSmartSpy.mockClear();
    searchAssetsSpy.mockClear();
    const { container } = render(GlobalSearch, { props: { manager } });
    const metadataRadio = container.querySelector('input[value="metadata"]') as HTMLInputElement;
    metadataRadio.click();
    await vi.advanceTimersByTimeAsync(200);
    expect(searchSmartSpy).not.toHaveBeenCalled();
    expect(searchAssetsSpy).not.toHaveBeenCalled();
    expect(manager.mode).toBe('metadata');
  });

  it('? keydown (no modifiers) opens ShortcutsModal', () => {
    const showSpy = vi.spyOn(modalManager, 'show');
    const manager = new GlobalSearchManager();
    const { container } = render(GlobalSearch, { props: { manager } });
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    input.focus();
    const ev = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(showSpy).toHaveBeenCalledWith(ShortcutsModal, {});
    expect(ev.defaultPrevented).toBe(true);
  });

  it('Ctrl+? does NOT open modal', () => {
    const showSpy = vi.spyOn(modalManager, 'show');
    const manager = new GlobalSearchManager();
    const { container } = render(GlobalSearch, { props: { manager } });
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', ctrlKey: true, bubbles: true }));
    expect(showSpy).not.toHaveBeenCalled();
  });

  it('Alt+? does NOT open modal', () => {
    const showSpy = vi.spyOn(modalManager, 'show');
    const manager = new GlobalSearchManager();
    const { container } = render(GlobalSearch, { props: { manager } });
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', altKey: true, bubbles: true }));
    expect(showSpy).not.toHaveBeenCalled();
  });

  it('preview pane under @alice with Alice highlighted renders PersonPreview', () => {
    const manager = makeWithScope('@alice');
    manager.sections.people = { status: 'ok', items: [{ id: 'p1', name: 'Alice' } as never], total: 1 };
    manager.setActiveItem('person:p1');
    const { container } = render(GlobalSearch, { props: { manager } });
    expect(container.querySelector('[data-cmdk-preview-person]')).not.toBeNull();
  });

  it('preview pane under #xmas with tag highlighted renders TagPreview', () => {
    const manager = makeWithScope('#xmas');
    manager.sections.tags = { status: 'ok', items: [{ id: 't1', name: 'xmas' } as never], total: 1 };
    manager.setActiveItem('tag:t1');
    const { container } = render(GlobalSearch, { props: { manager } });
    expect(container.querySelector('[data-cmdk-preview-tag]')).not.toBeNull();
  });

  it('preview pane under /trip with album highlighted renders AlbumPreview', () => {
    const manager = makeWithScope('/trip');
    manager.sections.albums = { status: 'ok', items: [{ id: 'a1', albumName: 'Trip' } as never], total: 1 };
    manager.setActiveItem('album:a1');
    const { container } = render(GlobalSearch, { props: { manager } });
    expect(container.querySelector('[data-cmdk-preview-album]')).not.toBeNull();
  });

  it('preview pane under /trip with space highlighted renders SpacePreview', () => {
    const manager = makeWithScope('/trip');
    manager.sections.spaces = { status: 'ok', items: [{ id: 's1', name: 'Trip club' } as never], total: 1 };
    manager.setActiveItem('space:s1');
    const { container } = render(GlobalSearch, { props: { manager } });
    expect(container.querySelector('[data-cmdk-preview-space]')).not.toBeNull();
  });

  it('preview pane under >theme with nav highlighted renders empty-state fallback', () => {
    const manager = makeWithScope('>theme');
    manager.sections.navigation = {
      status: 'ok',
      items: [{ id: 'nav:theme', labelKey: 'cmdk_action_toggle_theme' } as never],
      total: 1,
    };
    manager.setActiveItem('nav:theme');
    const { getByText } = render(GlobalSearch, { props: { manager } });
    // Preview falls through to the empty-state "nothing to preview" text.
    expect(getByText(/nothing to preview|select a result/i)).toBeInTheDocument();
  });

  it('> bare scroll: 36 nav items render in DOM', () => {
    const manager = makeWithScope('>');
    const items = Array.from({ length: 36 }, (_, i) => ({
      id: `nav:item${i}`,
      labelKey: `label_${i}`,
    }));
    manager.sections.navigation = { status: 'ok', items: items as never, total: 36 };
    const { container } = render(GlobalSearch, { props: { manager } });
    const rows = container.querySelectorAll('[data-command-item]');
    expect(rows.length).toBe(36);
    // Command.List carries overflow-y-auto; assert the container exists and has scroll style.
    const list = container.querySelector('[data-cmdk-list], .command-list');
    expect(list).not.toBeNull();
  });
});
```

Preview-pane test `data-cmdk-preview-person|tag|album|space` assumes the preview child components carry those data attributes. If they don't, add them in this task (one-line change per preview child) to make the DOM queryable.

**Step 2: Run red.**

```bash
pnpm --filter=immich-web test -- --run src/lib/components/global-search/__tests__/global-search.spec.ts 2>&1 | tail -15
```

Expected: 18 new tests fail.

**Step 3: Add the scoped branches, the `nav` preview branch, the ML banner gate, and the mode-pill dim + `?` keybind.**

In `global-search.svelte`, inside the `{:else}` (non-empty query) branch, after the `{#if manager.scope === 'all'}...{/if}` wrapper added in Task 12a, append:

```svelte
{:else if manager.scope === 'people'}
  <GlobalSearchSection
    heading={$t('cmdk_people_heading')}
    status={manager.sections.people}
    idPrefix="person"
    onActivate={(item) => manager.activate('person', item)}
  >
    {#snippet renderRow(item)}
      <PersonRow item={item as never} />
    {/snippet}
  </GlobalSearchSection>
{:else if manager.scope === 'tags'}
  <GlobalSearchSection
    heading={$t('cmdk_tags_heading')}
    status={manager.sections.tags}
    idPrefix="tag"
    onActivate={(item) => manager.activate('tag', item)}
  >
    {#snippet renderRow(item)}
      <TagRow item={item as never} />
    {/snippet}
  </GlobalSearchSection>
{:else if manager.scope === 'collections'}
  <GlobalSearchSection
    heading={$t('cmdk_section_albums')}
    status={manager.sections.albums}
    idPrefix="album"
    onActivate={(item) => void manager.activateAlbum((item as { id: string }).id)}
  >
    {#snippet renderRow(item)}
      <AlbumRow
        item={item as never}
        isPending={manager.pendingActivation === `album:${(item as { id: string }).id}`}
      />
    {/snippet}
  </GlobalSearchSection>
  <GlobalSearchSection
    heading={$t('cmdk_section_spaces')}
    status={manager.sections.spaces}
    idPrefix="space"
    onActivate={(item) => void manager.activateSpace((item as { id: string }).id)}
  >
    {#snippet renderRow(item)}
      <SpaceRow
        item={item as never}
        isPending={manager.pendingActivation === `space:${(item as { id: string }).id}`}
      />
    {/snippet}
  </GlobalSearchSection>
{:else if manager.scope === 'nav'}
  <GlobalSearchNavigationSections
    status={dedupedNavigationStatus}
    onActivate={(item) => manager.activate('nav', item)}
  />
```

Gate the ML banner on `manager.scope === 'all'`:

```svelte
{#if manager.scope === 'all' && manager.mode === 'smart' && !manager.mlHealthy && inputValue.trim() !== ''}
  <!-- existing banner markup -->
{/if}
```

Add `?` keybind near the top of `onKeyDown`:

```ts
import { modalManager } from '@immich/ui';
import ShortcutsModal from '$lib/modals/ShortcutsModal.svelte';

function onKeyDown(e: KeyboardEvent) {
  if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    modalManager.show(ShortcutsModal, {});
    e.preventDefault();
    return;
  }
  // ... existing branches (Escape, Ctrl+K, Ctrl+/, Delete/Backspace, Home/End)
}
```

In `global-search-preview.svelte`, add the `nav` branch after the `space` branch (before the closing `{/if}`):

```svelte
{:else if activeItem.kind === 'nav'}
  <div class="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 px-8 text-center">
    <Logo variant="icon" size="giant" class="opacity-10" />
    <span class="text-sm text-gray-500 opacity-50 dark:text-gray-400">
      {$t('cmdk_nothing_to_preview')}
    </span>
  </div>
```

In `global-search-footer.svelte`, add `opacity-50` to the mode-pills container when `manager.scope !== 'all'`:

```svelte
<script lang="ts">
  // existing imports
  const isScoped = $derived(manager.scope !== 'all');
</script>

<div class="flex items-center justify-between border-t ... px-4 py-2">
  <div
    role="radiogroup"
    aria-label={$t('cmdk_search_mode')}
    class="relative flex gap-0 rounded-md bg-subtle/40 p-0.5 font-mono text-[11px] font-medium uppercase {isScoped ? 'opacity-50' : ''}"
  >
    <!-- existing pills -->
  </div>
  <!-- scope chip + ? icon added in Task 13 -->
</div>
```

Also add `data-cmdk-preview-{kind}` attributes to each preview child (one line per file) so the preview tests can DOM-query them cleanly:

```svelte
<!-- person-preview.svelte -->
<div data-cmdk-preview-person class="...">
```

(Symmetric for tag, album, space, photo.)

**Step 4: Run tests + type check.**

```bash
pnpm --filter=immich-web test -- --run src/lib/components/global-search/__tests__/global-search.spec.ts 2>&1 | tail -10
pnpm --filter=immich-web check 2>&1 | tail -5
```

Expected: all 18 new tests pass, 0 type errors.

**Step 5: Commit.**

```bash
git add web/src/lib/components/global-search/global-search.svelte \
        web/src/lib/components/global-search/global-search-preview.svelte \
        web/src/lib/components/global-search/global-search-footer.svelte \
        web/src/lib/components/global-search/previews/*.svelte \
        web/src/lib/components/global-search/__tests__/global-search.spec.ts
git commit -m "feat(web): scope-aware palette rendering + ? keybind + nav preview

Scope-gated sections: @ → People, # → Tags, / → Albums+Spaces, > → Nav.
ML banner hidden under non-all scope. Mode pills dim to opacity-50.
? keypress (no Ctrl/Alt/Meta) opens ShortcutsModal; modifier variants
fall through. GlobalSearchPreview grows a nav branch that renders the
empty-state placeholder. Preview child components now carry
data-cmdk-preview-{kind} attributes for DOM-query tests."
```

---

### Task 12c: Verify bits-ui `Command.Input` doesn't intercept `?`

**Files:** none — verification task.

**Step 1: Inspect bits-ui's installed keydown handling.**

```bash
grep -A 20 "keydown\|Shift\+/" node_modules/bits-ui/dist/bits/command/components/*.svelte.js 2>&1 | head -50
```

Expected: no `'?'` or `'Shift+/'` handler. Combobox inputs typically allow printable chars through. If bits-ui DOES consume `?`, fix by:

- Binding the `?` handler at capture phase on the parent of `Command.Input` (e.g., add `on:keydown|capture={onKeyDown}` on the modal root), OR
- Calling `e.stopImmediatePropagation()` in our handler before `e.preventDefault()` so bits-ui doesn't see it.

**Step 2: Validate via the regression test from Task 12b** — "? keydown (no modifiers) opens ShortcutsModal" must pass in CI. If it fails, apply one of the two fixes above.

No commit if bits-ui is clean; the tests already pin the behavior.

---

## Task 13: Footer scope chip + `?` icon

**Files:**

- Modify: `web/src/lib/components/global-search/global-search-footer.svelte`
- Modify: `web/src/lib/components/global-search/__tests__/global-search-footer.spec.ts`
- Modify: `i18n/en.json`

**Step 1: Add i18n keys.**

```json
"cmdk_scope_hint_footer": "@ # / > scope",
"cmdk_show_shortcuts": "Keyboard shortcuts"
```

Run sort:

```bash
pnpm --filter=immich-i18n format:fix
```

**Step 2: Write failing component tests.**

Append to `global-search-footer.spec.ts`:

```ts
import { modalManager } from '@immich/ui';

describe('prefix scoping — footer chrome', () => {
  it('renders both kbd groups (Ctrl+/ cycle and @ # / > scope)', () => {
    const { getByText } = render(GlobalSearchFooter, { props: { manager } });
    expect(getByText('Ctrl+/')).toBeInTheDocument();
    expect(getByText('@ # / >')).toBeInTheDocument();
  });

  it('? icon button hidden below sm breakpoint (carries sm:block class)', () => {
    const { container } = render(GlobalSearchFooter, { props: { manager } });
    const btn = container.querySelector('[data-cmdk-shortcuts-trigger]');
    expect(btn?.className).toMatch(/sm:block|hidden sm:flex|sm:inline-flex/);
  });

  it('clicking ? calls modalManager.show(ShortcutsModal, {})', async () => {
    const showSpy = vi.spyOn(modalManager, 'show');
    const { container } = render(GlobalSearchFooter, { props: { manager } });
    const btn = container.querySelector('[data-cmdk-shortcuts-trigger]') as HTMLButtonElement;
    btn.click();
    expect(showSpy).toHaveBeenCalledWith(ShortcutsModal, {});
  });
});
```

**Step 3: Run to verify failure.**

Expected: tests fail — footer has no chip yet.

**Step 4: Implement footer chip + `?` icon.**

In `global-search-footer.svelte`, replace the right-side hint:

```svelte
<script lang="ts">
  import { modalManager } from '@immich/ui';
  import ShortcutsModal from '$lib/modals/ShortcutsModal.svelte';
  import { Icon } from '@immich/ui';
  import { mdiHelpCircleOutline } from '@mdi/js';
  // ... existing imports
</script>

<!-- ... existing mode-pills block -->

<div class="flex items-center gap-4 font-mono text-[11px] text-gray-500 dark:text-gray-400">
  <span class="flex items-center gap-1.5">
    <kbd class="rounded-sm border border-gray-200 bg-subtle/60 px-1.5 py-0.5 dark:border-gray-700">Ctrl+/</kbd>
    <span>{$t('cmdk_cycle_mode_hint')}</span>
  </span>
  <span class="flex items-center gap-1.5">
    <kbd class="rounded-sm border border-gray-200 bg-subtle/60 px-1.5 py-0.5 dark:border-gray-700">{$t('cmdk_scope_hint_footer')}</kbd>
    <span>scope</span>
  </span>
  <button
    data-cmdk-shortcuts-trigger
    type="button"
    aria-label={$t('cmdk_show_shortcuts')}
    title={$t('cmdk_show_shortcuts')}
    onclick={() => modalManager.show(ShortcutsModal, {})}
    class="hidden h-5 w-5 items-center justify-center rounded-full text-gray-500 hover:bg-white/5 hover:text-gray-300 sm:flex"
  >
    <Icon icon={mdiHelpCircleOutline} size="1em" aria-hidden />
  </button>
</div>
```

**Step 5: Verify pass.**

```bash
pnpm --filter=immich-web test -- --run src/lib/components/global-search/__tests__/global-search-footer.spec.ts 2>&1 | tail -5
```

**Step 6: Commit.**

```bash
git add web/src/lib/components/global-search/global-search-footer.svelte \
        web/src/lib/components/global-search/__tests__/global-search-footer.spec.ts \
        i18n/en.json
git commit -m "feat(web): footer scope chip + ? shortcuts button

Two kbd groups (Ctrl+/ cycle, @ # / > scope), no bullet separator, same
font-mono text-[11px] typography. ? icon on the right (hidden below sm)
opens ShortcutsModal."
```

---

## Task 14: ShortcutsModal — "Scope prefixes" section

**Files:**

- Modify: `web/src/lib/modals/ShortcutsModal.svelte`
- Modify: `i18n/en.json`

**Step 1: Add i18n keys.**

```json
"cmdk_shortcut_scope_heading": "Scope prefixes",
"cmdk_shortcut_scope_people": "Search people",
"cmdk_shortcut_scope_tags": "Search tags",
"cmdk_shortcut_scope_collections": "Search albums & spaces",
"cmdk_shortcut_scope_nav": "Jump to pages"
```

Sort:

```bash
pnpm --filter=immich-i18n format:fix
```

**Step 2: Read the existing ShortcutsModal layout to match grid pattern.**

```bash
head -110 web/src/lib/modals/ShortcutsModal.svelte
```

Look for the `grid grid-cols-[30%_70%]` rows that currently render `Ctrl+K` → "Open command palette" style shortcuts.

**Step 3: Add the Scope prefixes section.**

Insert after the existing shortcuts columns (just before the closing `</div>` of the `md:grid-cols-2`):

```svelte
<div class="p-4">
  <h3 class="text-sm font-semibold">{$t('cmdk_shortcut_scope_heading')}</h3>
  <div class="text-sm">
    <div class="grid grid-cols-[30%_70%] items-center gap-4 pt-4 text-sm">
      <div class="flex justify-self-end">
        <span class="me-1 flex items-center justify-center justify-self-end rounded-lg bg-immich-primary/25 p-2">
          @
        </span>
      </div>
      <p class="mb-1 mt-1 flex">{$t('cmdk_shortcut_scope_people')}</p>

      <div class="flex justify-self-end">
        <span class="me-1 flex items-center justify-center justify-self-end rounded-lg bg-immich-primary/25 p-2">
          #
        </span>
      </div>
      <p class="mb-1 mt-1 flex">{$t('cmdk_shortcut_scope_tags')}</p>

      <div class="flex justify-self-end">
        <span class="me-1 flex items-center justify-center justify-self-end rounded-lg bg-immich-primary/25 p-2">
          /
        </span>
      </div>
      <p class="mb-1 mt-1 flex">{$t('cmdk_shortcut_scope_collections')}</p>

      <div class="flex justify-self-end">
        <span class="me-1 flex items-center justify-center justify-self-end rounded-lg bg-immich-primary/25 p-2">
          &gt;
        </span>
      </div>
      <p class="mb-1 mt-1 flex">{$t('cmdk_shortcut_scope_nav')}</p>
    </div>
  </div>
</div>
```

Exact markup may vary depending on the existing column structure — match the existing rows' styling and indentation.

**Step 4: Visual verify.**

Start the dev server:

```bash
make dev
```

Open the UI, trigger ShortcutsModal (e.g. from `/user-settings` page or via the footer `?` button added in Task 13). Confirm the "Scope prefixes" section renders with 4 rows matching the existing shortcut-row style.

**Step 5: Commit.**

```bash
git add web/src/lib/modals/ShortcutsModal.svelte i18n/en.json
git commit -m "feat(web): ShortcutsModal Scope prefixes section

Four rows (@, #, /, >) using the existing rounded-lg bg-immich-primary/25
kbd-box style so they render as peer rows to the existing Ctrl+K etc."
```

---

## Task 15: i18n sort consolidation

**Files:**

- Modify: `i18n/en.json` (if any unsorted additions remain)

**Step 1: Confirm all new keys are sorted.**

```bash
pnpm --filter=immich-i18n format:fix
git diff i18n/en.json | head
```

Expected: no diff (all earlier tasks already ran format:fix). If there's a diff, commit the sort.

**Step 2: Commit if needed.**

```bash
git add i18n/en.json
git commit -m "chore(i18n): sort cmdk v1.2 keys"
```

Skip if no diff.

---

## Task 16: E2E tests

**Files:**

- Modify: `e2e/src/specs/web/global-search.e2e-spec.ts`
- Modify: `e2e/src/utils.ts` (add test fixture helper if needed)

**Step 0 (pre-flight): verify required fixture helpers exist.**

```bash
grep -n "seedPerson\|seedTaggedPhotos\|setupUserWithAlbumsAndSpaces\|seedAlbums\|seedSpaces" e2e/src/utils.ts | head
```

Expected: `setupUserWithAlbumsAndSpaces`, `seedAlbums`, `seedSpaces` are present (added in v1.1). If `seedPerson` or `seedTaggedPhotos` are missing, add them as a one-commit prep sub-task before the first E2E test below. Keep helpers minimal — just enough to exercise the scope flows (name a person, upload a tagged photo).

**Step 1: Write one E2E test at a time.** Follow the full TDD loop per test: write, run red, implement (if any backend/UI bug surfaces), run green, commit.

**Per-test template:**

```ts
test('cmdk v1.2 — scope @ navigates to person', async ({ page, context }) => {
  const admin = await setupUserWithAlbumsAndSpaces({ context });
  // Seed a named person "Alice" for admin.
  await seedPerson(admin, { name: 'Alice', photosCount: 5 });
  await page.goto('/photos');

  await page.keyboard.press('Control+K');
  await page.getByPlaceholder('Search…').fill('@al');

  // Only People section visible.
  await expect(page.getByRole('heading', { name: /people/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /photos/i })).not.toBeVisible();

  await page.getByRole('option', { name: /alice/i }).click();
  await expect(page).toHaveURL(/\/people\/[a-z0-9-]+/);
});
```

Tests to add (one commit per test):

1. `scope @ navigates to person`
2. `scope / activates album`
3. `scope > toggles theme`
4. `bare # renders top tag suggestions`
5. `bare @ renders top-10 people (one getAllPeople request)`
6. `backspace-out reverts to unscoped then to empty palette`
7. `scope swap @al → #sun leaves no stale sections`
8. `cursor preservation: alice → @alice keeps cursor on Alice`
9. `? keypress opens ShortcutsModal`
10. `? override: modal opens over typed-in-input text`
11. `> bare for admin renders all items and scrolls`
12. `@ retry after failure: first fails, close/reopen + retype @ succeeds`
13. `stale album under / scope: 404 toast + recent purge`

**Step 2: Run E2E against dev stack.**

```bash
make e2e-web-dev
```

Expected: all new tests green after implementation.

**Step 3: Commit (once per test, to keep commits bisectable).**

```bash
git add e2e/src/specs/web/global-search.e2e-spec.ts
git commit -m "test(e2e): cmdk v1.2 scope @ navigates to person"
# repeat per test
```

---

## Task 17: Manual visual QA

**Not a code task.** Check the following by starting `make dev` and interacting with the palette in a browser.

**Step 1: Viewports + themes.**

1024 px / 720 px / 480 px in light + dark mode:

- Footer chip renders without overflow at all breakpoints.
- `?` icon hides below `sm` (< 640 px); the keybind still works if a hardware keyboard is present.
- Scope transition (type `@` then backspace then `#`) is snappy — no flash of stale sections.
- Dimmed mode pills under scope are visibly muted but not confused for "disabled" grey.
- Scroll behavior under `>` scope (many nav items): `Command.List` scrolls; palette height stays within the `sm:max-h-[80vh]` cap.

**Step 2: Screen reader quick-check (macOS VoiceOver or NVDA).**

- Typing `@` → TTS announces "Scoped to people" shortly after results settle.
- Navigating to a People row → row label announced via `aria-activedescendant`.
- Pressing `?` → modal opens; focus returns to input on close.

**Step 3: If any QA issue found, open a follow-up task; do NOT land the feature with known visual bugs.**

**No commit from this task.**

---

## Done

After all tasks pass:

- Type check: `pnpm --filter=immich-web check` → 0 errors.
- Full web unit suite: `pnpm --filter=immich-web test -- --run` → green.
- Full E2E web suite: `make e2e-web-dev` → green.
- Lint (CI-enforced): `pnpm --filter=immich-web lint --max-warnings 0`.
- Format check across docs touched: `npx prettier --check docs/plans/2026-04-17-cmdk-prefix-scoping-design.md`.

Open the PR with the design doc linked. Use `@superpowers:finishing-a-development-branch` to decide on merge vs follow-up PRs.
