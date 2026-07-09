# Add All Filter Results to Album/Space — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user add every asset matching the current search/filter to one or more albums/spaces from the search page, without hand-selecting them.

**Architecture:** Purely client-driven, reusing the existing ID-list add path. A header button on the search page opens a by-filter picker modal; on confirm we page the search API to collect all matching IDs, then hand them to the existing `addAssetsToCollections`. The only server change is raising the shared-space asset cap.

**Tech Stack:** SvelteKit 5 (runes) + TypeScript, `@immich/sdk`, `@immich/ui`; Vitest + `@testing-library/svelte` (happy-dom) for web; Vitest for server; Zod DTOs on the server; i18n JSON at repo-root `i18n/`.

## Global Constraints

- **TDD everywhere:** write the failing test first, watch it fail, implement minimally, watch it pass, commit. Frequent commits (one per task minimum).
- **Locales (all six):** `en, de, fr, it, nl, es`. Every new/edited i18n key MUST exist in all six `i18n/*.json` files. `en.json` is the source of truth.
- **Space asset cap = `50_000`** (was `10_000`). Albums stay **uncapped**. The constant name stays `MAX_SPACE_ASSETS_PER_REQUEST`.
- **No new server endpoints, no chunking, no background job.** Reuse `addAssetsToCollections` unchanged.
- **Minimize churn in the forked search page** (`web/src/routes/(user)/search/.../+page.svelte`): additive edits only; do not restructure its imports or existing types.
- **Component tests assert on `data-testid`/ARIA role, NOT translated text** — the test harness inits `svelte-i18n` with `fallbackLocale: 'dev'` and does not register `en`, so `$t('key')` returns the key. Album names ("Trip") and `@immich/ui` ARIA labels ("Close") are safe to match.
- **Test commands:**
  - Web (single file): `cd web && npx vitest run <path>`
  - Web (all): `cd web && npx vitest run`
  - Web types: `cd web && npm run check`
  - Server (single file): `cd server && npx vitest run --config test/vitest.config.mjs <path>`

---

### Task 1: Raise the shared-space asset cap 10k → 50k (server)

**Files:**

- Modify: `server/src/dtos/shared-space.dto.ts:130`
- Test: `server/src/dtos/shared-space.dto.spec.ts` (update existing boundary tests)

**Interfaces:**

- Produces: `MAX_SPACE_ASSETS_PER_REQUEST = 50_000` (server-side), applied by `.max()` to both `SharedSpaceAssetAddDto` and `SharedSpaceAssetRemoveDto`.

- [ ] **Step 1: Update the existing DTO spec to the new boundary (this is the failing test)**

Replace the boundary cases in `server/src/dtos/shared-space.dto.spec.ts`. Keep the helper `makeUUIDs` as-is. Final file body for the two `describe` blocks:

```ts
describe('SharedSpaceAssetAddDto', () => {
  it('should accept an empty array', () => {
    const result = SharedSpaceAssetAddDto.schema.safeParse({ assetIds: [] });
    expect(result.success).toBe(true);
  });

  it('should accept a single asset ID', () => {
    const result = SharedSpaceAssetAddDto.schema.safeParse({ assetIds: makeUUIDs(1) });
    expect(result.success).toBe(true);
  });

  it('should accept 10,001 asset IDs (above the old cap, below the new one)', () => {
    const result = SharedSpaceAssetAddDto.schema.safeParse({ assetIds: makeUUIDs(10_001) });
    expect(result.success).toBe(true);
  });

  it('should accept exactly 50,000 asset IDs', () => {
    const result = SharedSpaceAssetAddDto.schema.safeParse({ assetIds: makeUUIDs(50_000) });
    expect(result.success).toBe(true);
  });

  it('should reject 50,001 asset IDs', () => {
    const result = SharedSpaceAssetAddDto.schema.safeParse({ assetIds: makeUUIDs(50_001) });
    expect(result.success).toBe(false);
  });
});

describe('SharedSpaceAssetRemoveDto', () => {
  it('should accept exactly 50,000 asset IDs', () => {
    const result = SharedSpaceAssetRemoveDto.schema.safeParse({ assetIds: makeUUIDs(50_000) });
    expect(result.success).toBe(true);
  });

  it('should reject 50,001 asset IDs', () => {
    const result = SharedSpaceAssetRemoveDto.schema.safeParse({ assetIds: makeUUIDs(50_001) });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `cd server && npx vitest run --config test/vitest.config.mjs src/dtos/shared-space.dto.spec.ts`
Expected: FAIL — "should accept exactly 50,000" fails (current cap rejects >10k).

- [ ] **Step 3: Raise the constant**

In `server/src/dtos/shared-space.dto.ts` line 130:

```ts
export const MAX_SPACE_ASSETS_PER_REQUEST = 50_000;
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `cd server && npx vitest run --config test/vitest.config.mjs src/dtos/shared-space.dto.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/dtos/shared-space.dto.ts server/src/dtos/shared-space.dto.spec.ts
git commit -m "feat(server): raise shared-space asset cap to 50,000 per request"
```

---

### Task 2: Raise the cap in the web client + fix the collection guard spec

**Files:**

- Modify: `web/src/lib/constants.ts:77`
- Test: `web/src/lib/services/collection.service.spec.ts` (update the over-cap case; add an under-new-cap case)

**Interfaces:**

- Produces: web `MAX_SPACE_ASSETS_PER_REQUEST = 50_000`, consumed by `CollectionPickerModal` (`showSpaces` gate) and `collection.service.ts` (space-drop guard).

- [ ] **Step 1: Update `collection.service.spec.ts` to the new boundary (failing test)**

Replace the `'over-cap selection skips spaces but still adds albums'` test (lines 67-72) with these two tests:

```ts
it('selection above the old 10k cap but at/below 50k still adds spaces', async () => {
  const assetIds = Array.from({ length: 10_001 }, (_, i) => `x${i}`);
  await expect(addAssetsToCollections([spaceCol('s1')], assetIds)).resolves.toBe(true);
  expect(addAssetsToSpace).toHaveBeenCalledWith('s1', assetIds, { notify: true });
});

it('over-cap (>50k) selection skips spaces but still adds albums', async () => {
  const assetIds = Array.from({ length: 50_001 }, (_, i) => `x${i}`);
  await expect(addAssetsToCollections([albumCol('a1'), spaceCol('s1')], assetIds)).resolves.toBe(true);
  expect(addAssetsToSpace).not.toHaveBeenCalled();
  expect(addAssetsToAlbums).toHaveBeenCalledWith(['a1'], assetIds, { notify: true }); // total becomes 1 → single path
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `cd web && npx vitest run src/lib/services/collection.service.spec.ts`
Expected: FAIL — the new "10,001 still adds spaces" test fails (current cap 10k drops the space).

- [ ] **Step 3: Raise the web constant**

In `web/src/lib/constants.ts` line 77:

```ts
export const MAX_SPACE_ASSETS_PER_REQUEST = 50_000;
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `cd web && npx vitest run src/lib/services/collection.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/constants.ts web/src/lib/services/collection.service.spec.ts
git commit -m "feat(web): raise space asset cap to 50,000 and update guard spec"
```

---

### Task 3: i18n keys in all six locales (+ backfill the over-cap notice)

**Files:**

- Modify: `i18n/en.json`, `i18n/de.json`, `i18n/fr.json`, `i18n/it.json`, `i18n/nl.json`, `i18n/es.json`
- Create (test): `web/src/lib/i18n-add-all.spec.ts`

**Interfaces:**

- Produces i18n keys, consumed by later tasks:
  - `add_all_search_results` — button label (ICU plural, param `count`)
  - `preparing_assets` — in-progress label
  - `spaces_hidden_too_many_assets` — already in en/de/fr; **backfill it/nl/es**

Insert every key in **alphabetical position** within each file (the repo keeps keys sorted). `add_all_search_results` sorts right after `add_all_photos`; `preparing_assets` sorts right after `preparing`; `spaces_hidden_too_many_assets` already exists in en/de/fr at its sorted spot — add it/nl/es at the matching spot.

- [ ] **Step 1: Write the completeness test (failing test)**

Create `web/src/lib/i18n-add-all.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url)); // web/src/lib
const i18nDir = path.resolve(here, '../../../i18n'); // repo-root/i18n

const LOCALES = ['en', 'de', 'fr', 'it', 'nl', 'es'];
const REQUIRED_KEYS = ['add_all_search_results', 'preparing_assets', 'spaces_hidden_too_many_assets'];

const load = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(i18nDir, `${locale}.json`), 'utf8'));

describe('i18n coverage for add-all-to-collection', () => {
  for (const locale of LOCALES) {
    it(`${locale}.json contains all required keys`, () => {
      const messages = load(locale);
      for (const key of REQUIRED_KEYS) {
        expect(messages[key], `${key} missing in ${locale}.json`).toBeTypeOf('string');
      }
    });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/i18n-add-all.spec.ts`
Expected: FAIL — `add_all_search_results` / `preparing_assets` missing everywhere; `spaces_hidden_too_many_assets` missing in it/nl/es.

- [ ] **Step 3: Add the two new keys + backfill the notice**

Add these exact strings at their sorted positions in each file.

`en.json`:

```json
  "add_all_search_results": "Add all {count, plural, one {# result} other {# results}} to…",
  "preparing_assets": "Preparing assets…",
```

`de.json`:

```json
  "add_all_search_results": "Alle {count, plural, one {# Ergebnis} other {# Ergebnisse}} hinzufügen zu…",
  "preparing_assets": "Objekte werden vorbereitet…",
```

`fr.json`:

```json
  "add_all_search_results": "Ajouter les {count, plural, one {# résultat} other {# résultats}} à…",
  "preparing_assets": "Préparation des éléments…",
```

`it.json` (also add the notice below):

```json
  "add_all_search_results": "Aggiungi tutti i {count, plural, one {# risultato} other {# risultati}} a…",
  "preparing_assets": "Preparazione degli elementi…",
  "spaces_hidden_too_many_assets": "Spazi nascosti — troppe foto selezionate (max {count})",
```

`nl.json` (also add the notice below):

```json
  "add_all_search_results": "Alle {count, plural, one {# resultaat} other {# resultaten}} toevoegen aan…",
  "preparing_assets": "Items voorbereiden…",
  "spaces_hidden_too_many_assets": "Spaces verborgen — te veel foto's geselecteerd (max {count})",
```

`es.json` (also add the notice below):

```json
  "add_all_search_results": "Añadir los {count, plural, one {# resultado} other {# resultados}} a…",
  "preparing_assets": "Preparando elementos…",
  "spaces_hidden_too_many_assets": "Espacios ocultos — demasiadas fotos seleccionadas (máx {count})",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/i18n-add-all.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint the JSON (sort/format) and commit**

Run: `cd web && npm run lint` (fix any key-ordering complaints by moving the inserted line to its sorted spot).

```bash
git add i18n/en.json i18n/de.json i18n/fr.json i18n/it.json i18n/nl.json i18n/es.json web/src/lib/i18n-add-all.spec.ts
git commit -m "feat(i18n): add-all-to-collection strings in en/de/fr/it/nl/es"
```

---

### Task 4: `collectSearchResultAssetIds` — page the search to gather every matching ID

**Files:**

- Create: `web/src/lib/services/search.service.ts`
- Test: `web/src/lib/services/search.service.spec.ts`

**Interfaces:**

- Produces:
  - `type SearchTerms = MetadataSearchDto & Pick<SmartSearchDto, 'query' | 'queryAssetId'>`
  - `collectSearchResultAssetIds(terms: SearchTerms, options: { smartSearchEnabled: boolean; language: string }): Promise<string[]>`
- Consumes: `@immich/sdk` `searchAssets`, `searchSmart`.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/services/search.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '$lib/__mocks__/sdk.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { collectSearchResultAssetIds } from './search.service';

const page = (ids: string[], nextPage: string | null) =>
  ({
    albums: { items: [], count: 0, facets: [], nextPage: null, total: 0 },
    assets: { items: ids.map((id) => ({ id })), count: ids.length, facets: [], nextPage, total: ids.length },
  }) as never;

beforeEach(() => {
  vi.resetAllMocks();
});

describe('collectSearchResultAssetIds', () => {
  it('pages through metadata search until nextPage is null and returns all ids', async () => {
    sdkMock.searchAssets.mockResolvedValueOnce(page(['a', 'b'], '2')).mockResolvedValueOnce(page(['c'], null));

    const ids = await collectSearchResultAssetIds({ isFavorite: true }, { smartSearchEnabled: false, language: 'en' });

    expect(ids).toEqual(['a', 'b', 'c']);
    expect(sdkMock.searchAssets).toHaveBeenCalledTimes(2);
    expect(sdkMock.searchAssets).toHaveBeenNthCalledWith(1, {
      metadataSearchDto: { isFavorite: true, page: 1, size: 1000, withExif: false },
    });
    expect(sdkMock.searchAssets).toHaveBeenNthCalledWith(2, {
      metadataSearchDto: { isFavorite: true, page: 2, size: 1000, withExif: false },
    });
    expect(sdkMock.searchSmart).not.toHaveBeenCalled();
  });

  it('handles a single page', async () => {
    sdkMock.searchAssets.mockResolvedValueOnce(page(['x'], null));
    const ids = await collectSearchResultAssetIds({}, { smartSearchEnabled: false, language: 'en' });
    expect(ids).toEqual(['x']);
    expect(sdkMock.searchAssets).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array for no matches', async () => {
    sdkMock.searchAssets.mockResolvedValueOnce(page([], null));
    const ids = await collectSearchResultAssetIds({}, { smartSearchEnabled: false, language: 'en' });
    expect(ids).toEqual([]);
  });

  it('uses smart search (with language) when a query is present and smart search is enabled', async () => {
    sdkMock.searchSmart.mockResolvedValueOnce(page(['q1'], null));
    const ids = await collectSearchResultAssetIds({ query: 'dogs' }, { smartSearchEnabled: true, language: 'de' });
    expect(ids).toEqual(['q1']);
    expect(sdkMock.searchSmart).toHaveBeenCalledWith({
      smartSearchDto: { query: 'dogs', page: 1, size: 1000, withExif: false, language: 'de' },
    });
    expect(sdkMock.searchAssets).not.toHaveBeenCalled();
  });

  it('uses metadata search when a query is present but smart search is disabled', async () => {
    sdkMock.searchAssets.mockResolvedValueOnce(page(['m1'], null));
    await collectSearchResultAssetIds({ query: 'dogs' }, { smartSearchEnabled: false, language: 'en' });
    expect(sdkMock.searchAssets).toHaveBeenCalledTimes(1);
    expect(sdkMock.searchSmart).not.toHaveBeenCalled();
  });

  it('stops if a page returns no items even when a nextPage token is present (no infinite loop)', async () => {
    sdkMock.searchAssets.mockResolvedValueOnce(page([], '2'));
    const ids = await collectSearchResultAssetIds({}, { smartSearchEnabled: false, language: 'en' });
    expect(ids).toEqual([]);
    expect(sdkMock.searchAssets).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/services/search.service.spec.ts`
Expected: FAIL — cannot import `collectSearchResultAssetIds` (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/services/search.service.ts`:

```ts
import { searchAssets, searchSmart, type MetadataSearchDto, type SmartSearchDto } from '@immich/sdk';

const COLLECT_PAGE_SIZE = 1000;

export type SearchTerms = MetadataSearchDto & Pick<SmartSearchDto, 'query' | 'queryAssetId'>;

/**
 * Pages through the search API for the given filter and returns the ids of every matching asset.
 * IDs only — `withExif: false` keeps each page payload minimal.
 */
export const collectSearchResultAssetIds = async (
  terms: SearchTerms,
  options: { smartSearchEnabled: boolean; language: string },
): Promise<string[]> => {
  const ids: string[] = [];
  let page: number | undefined = 1;

  while (page) {
    // Our pagination fields go last so a filter term can never override them.
    const searchDto: SearchTerms = { ...terms, page, size: COLLECT_PAGE_SIZE, withExif: false };

    const useSmart = ('query' in searchDto || 'queryAssetId' in searchDto) && options.smartSearchEnabled;
    const { assets } = useSmart
      ? await searchSmart({ smartSearchDto: { ...searchDto, language: options.language } })
      : await searchAssets({ metadataSearchDto: searchDto });

    ids.push(...assets.items.map((asset) => asset.id));

    page = assets.items.length > 0 && assets.nextPage ? Number(assets.nextPage) : undefined;
  }

  return ids;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/services/search.service.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/services/search.service.ts web/src/lib/services/search.service.spec.ts
git commit -m "feat(web): collectSearchResultAssetIds pages search to gather all matching ids"
```

---

### Task 5: `SearchAddAllToCollectionModal` — by-filter picker that collects then adds

**Files:**

- Create: `web/src/lib/modals/SearchAddAllToCollectionModal.svelte`
- Test: `web/src/lib/modals/SearchAddAllToCollectionModal.spec.ts`

**Interfaces:**

- Consumes: `collectSearchResultAssetIds` + `SearchTerms` (Task 4); `addAssetsToCollections` (`web/src/lib/services/collection.service.ts`); `CollectionPickerModal` (existing, prop `assetCount: number`, `onClose(collections?: PickerCollection[])`).
- Produces (component props): `{ terms: SearchTerms; total: number; smartSearchEnabled: boolean; language: string; onClose: () => void }`.

- [ ] **Step 1: Write the failing component test**

Create `web/src/lib/modals/SearchAddAllToCollectionModal.spec.ts`:

```ts
import type { AlbumResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import '$lib/__mocks__/sdk.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import SearchAddAllToCollectionModal from './SearchAddAllToCollectionModal.svelte';

const { mockUser, mockAdd, mockCollect } = vi.hoisted(() => ({
  mockUser: { current: { id: 'me', isAdmin: false } },
  mockAdd: vi.fn(),
  mockCollect: vi.fn(),
}));
vi.mock('$lib/services/collection.service', () => ({ addAssetsToCollections: mockAdd }));
vi.mock('$lib/services/search.service', () => ({ collectSearchResultAssetIds: mockCollect }));
vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    get authenticated() {
      return mockUser.current !== null;
    },
    get user() {
      return mockUser.current;
    },
  },
}));

const album = (id: string, name: string): AlbumResponseDto =>
  ({
    id,
    albumName: name,
    assetCount: 1,
    albumThumbnailAssetId: null,
    shared: false,
    updatedAt: '2024-01-01T00:00:00Z',
  }) as unknown as AlbumResponseDto;

const baseProps = (overrides = {}) => ({
  terms: {},
  total: 3,
  smartSearchEnabled: false,
  language: 'en',
  ...overrides,
});

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
  vi.stubGlobal('visualViewport', getVisualViewportMock());
  Element.prototype.animate = getAnimateMock();
  vi.resetAllMocks();
  mockUser.current = { id: 'me', isAdmin: false };
  mockAdd.mockResolvedValue(true);
  mockCollect.mockResolvedValue(['1', '2', '3']);
  sdkMock.getAllAlbums.mockImplementation(({ isShared }: { isShared?: boolean }) =>
    Promise.resolve(isShared ? [] : [album('a1', 'Trip')]),
  );
  sdkMock.getAllSpaces.mockResolvedValue([]);
});

afterAll(async () => {
  await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'));
});

describe('SearchAddAllToCollectionModal', () => {
  it('collects all matching ids then dispatches to the chosen collection and closes', async () => {
    const onClose = vi.fn();
    render(SearchAddAllToCollectionModal, { ...baseProps({ terms: { isFavorite: true } }), onClose });

    const trip = await screen.findAllByRole('button', { name: /Trip/ });
    await fireEvent.click(trip[0]);

    await waitFor(() =>
      expect(mockCollect).toHaveBeenCalledWith({ isFavorite: true }, { smartSearchEnabled: false, language: 'en' }),
    );
    expect(mockAdd).toHaveBeenCalledWith([expect.objectContaining({ id: 'a1', kind: 'album' })], ['1', '2', '3']);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('shows the preparing indicator while collecting', async () => {
    let resolveCollect!: (ids: string[]) => void;
    mockCollect.mockReturnValue(new Promise<string[]>((resolve) => (resolveCollect = resolve)));
    render(SearchAddAllToCollectionModal, { ...baseProps(), onClose: vi.fn() });

    const trip = await screen.findAllByRole('button', { name: /Trip/ });
    await fireEvent.click(trip[0]);

    await screen.findByTestId('preparing-indicator');
    resolveCollect(['1']);
  });

  it('closes without collecting or adding when dismissed', async () => {
    const onClose = vi.fn();
    render(SearchAddAllToCollectionModal, { ...baseProps(), onClose });

    const close = await screen.findAllByRole('button', { name: 'Close' });
    await fireEvent.click(close[0]);

    expect(mockCollect).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stays open when the add reports failure', async () => {
    mockAdd.mockResolvedValue(false);
    const onClose = vi.fn();
    render(SearchAddAllToCollectionModal, { ...baseProps(), onClose });

    const trip = await screen.findAllByRole('button', { name: /Trip/ });
    await fireEvent.click(trip[0]);

    await waitFor(() => expect(mockAdd).toHaveBeenCalledOnce());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hides spaces and shows the over-cap notice when total exceeds the cap', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([{ id: 's1', name: 'Family' } as unknown as SharedSpaceResponseDto]);
    render(SearchAddAllToCollectionModal, { ...baseProps({ total: 50_001 }), onClose: vi.fn() });

    await screen.findByTestId('spaces-hidden-notice');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/modals/SearchAddAllToCollectionModal.spec.ts`
Expected: FAIL — component module does not exist.

- [ ] **Step 3: Write the component**

Create `web/src/lib/modals/SearchAddAllToCollectionModal.svelte`:

```svelte
<script lang="ts">
  import type { PickerCollection } from '$lib/components/shared-components/collection-selection/collection-selection-utils';
  import CollectionPickerModal from '$lib/modals/CollectionPickerModal.svelte';
  import { addAssetsToCollections } from '$lib/services/collection.service';
  import { collectSearchResultAssetIds, type SearchTerms } from '$lib/services/search.service';
  import { LoadingSpinner, Modal, ModalBody } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    terms: SearchTerms;
    total: number;
    smartSearchEnabled: boolean;
    language: string;
    onClose: () => void;
  }

  const { terms, total, smartSearchEnabled, language, onClose }: Props = $props();

  let pending = $state(false);

  const handleClose = async (collections?: PickerCollection[]) => {
    if (!collections || collections.length === 0) {
      onClose();
      return;
    }
    if (pending) {
      return; // re-entrancy guard
    }
    pending = true;
    try {
      const assetIds = await collectSearchResultAssetIds(terms, { smartSearchEnabled, language });
      const ok = await addAssetsToCollections(collections, assetIds);
      if (ok) {
        onClose();
      }
    } finally {
      pending = false;
    }
  };
</script>

{#if pending}
  <Modal title={$t('add_to_album_or_space')} onClose={() => {}} size="medium">
    <ModalBody>
      <div class="flex items-center justify-center gap-3 py-16" data-testid="preparing-indicator">
        <LoadingSpinner />
        <span>{$t('preparing_assets')}</span>
      </div>
    </ModalBody>
  </Modal>
{:else}
  <CollectionPickerModal assetCount={total} onClose={handleClose} />
{/if}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/modals/SearchAddAllToCollectionModal.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/modals/SearchAddAllToCollectionModal.svelte web/src/lib/modals/SearchAddAllToCollectionModal.spec.ts
git commit -m "feat(web): SearchAddAllToCollectionModal collects filter results then adds to collections"
```

---

### Task 6: `SearchAddAllButton` — the header entry point

**Files:**

- Create: `web/src/lib/components/search/SearchAddAllButton.svelte`
- Test: `web/src/lib/components/search/SearchAddAllButton.spec.ts`

**Interfaces:**

- Produces (component props): `{ total: number; onclick: () => void }`. Renders nothing when `total <= 0`; otherwise a labeled button with `data-testid="add-all-to-collection"`.

- [ ] **Step 1: Write the failing component test**

Create `web/src/lib/components/search/SearchAddAllButton.spec.ts`:

```ts
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import SearchAddAllButton from './SearchAddAllButton.svelte';

describe('SearchAddAllButton', () => {
  it('renders nothing when total is 0', () => {
    render(SearchAddAllButton, { total: 0, onclick: vi.fn() });
    expect(screen.queryByTestId('add-all-to-collection')).toBeNull();
  });

  it('renders the button and fires onclick when total > 0', async () => {
    const onclick = vi.fn();
    render(SearchAddAllButton, { total: 42, onclick });
    const button = screen.getByTestId('add-all-to-collection');
    await fireEvent.click(button);
    expect(onclick).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/components/search/SearchAddAllButton.spec.ts`
Expected: FAIL — component module does not exist.

- [ ] **Step 3: Write the component**

Create `web/src/lib/components/search/SearchAddAllButton.svelte`:

```svelte
<script lang="ts">
  import { Button } from '@immich/ui';
  import { mdiPlus } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    total: number;
    onclick: () => void;
  }

  const { total, onclick }: Props = $props();
</script>

{#if total > 0}
  <Button
    size="small"
    color="secondary"
    shape="round"
    leadingIcon={mdiPlus}
    {onclick}
    data-testid="add-all-to-collection"
  >
    {$t('add_all_search_results', { values: { count: total } })}
  </Button>
{/if}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/components/search/SearchAddAllButton.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/search/SearchAddAllButton.svelte web/src/lib/components/search/SearchAddAllButton.spec.ts
git commit -m "feat(web): SearchAddAllButton header entry point for add-all-to-collection"
```

---

### Task 7: Wire the search page — capture `total`, render the button, open the modal

**Files:**

- Modify: `web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte`

**Interfaces:**

- Consumes: `SearchAddAllButton` (Task 6), `SearchAddAllToCollectionModal` (Task 5), `modalManager` (`@immich/ui`).
- Note: pass the page's existing local `terms` (structurally identical to `SearchTerms`) straight through — do **not** modify the page's type imports (keeps the fork diff minimal).

This task is integration glue over already-tested units; its gate is `npm run check` (types) + the full web suite green + manual verification. All edits are additive.

- [ ] **Step 1: Add the two component imports + `modalManager`**

In the `<script>` block: add to the existing `@immich/ui` import (line ~48) the `modalManager` symbol, and add two component imports near the other component imports:

```ts
import { ActionButton, CommandPaletteDefaultProvider, Icon, IconButton, modalManager } from '@immich/ui';
```

```ts
import SearchAddAllButton from '$lib/components/search/SearchAddAllButton.svelte';
import SearchAddAllToCollectionModal from '$lib/modals/SearchAddAllToCollectionModal.svelte';
```

- [ ] **Step 2: Add the `searchResultTotal` state**

After `let searchResultAssets: AssetResponseDto[] = $state([]);` (line ~64) add:

```ts
let searchResultTotal = $state(0);
```

- [ ] **Step 3: Reset the total when the query changes**

In `onSearchQueryUpdate` (line ~163), alongside the existing resets:

```ts
async function onSearchQueryUpdate() {
  nextPage = 1;
  searchResultAssets = [];
  searchResultAlbums = [];
  searchResultTotal = 0;
  await loadNextPage(true);
}
```

- [ ] **Step 4: Capture the total from each search response**

In `loadNextPage` (line ~189), right after `searchResultAssets.push(...assets.items);`:

```ts
searchResultAlbums.push(...albums.items);
searchResultAssets.push(...assets.items);
searchResultTotal = assets.total;

nextPage = Number(assets.nextPage) || 0;
```

- [ ] **Step 5: Add the open-modal handler**

Near the other handlers (e.g. after `handleSelectAll`, line ~161):

```ts
const handleAddAllToCollection = () => {
  modalManager.show(SearchAddAllToCollectionModal, {
    terms,
    total: searchResultTotal,
    smartSearchEnabled,
    language: $lang,
  });
};
```

- [ ] **Step 6: Render the button above the results grid**

Inside the `{#if searchResultAssets.length > 0}` block (line ~371), immediately before `<GalleryViewer`:

```svelte
    {#if searchResultAssets.length > 0}
      <div class="mb-3 flex justify-end px-2">
        <SearchAddAllButton total={searchResultTotal} onclick={handleAddAllToCollection} />
      </div>
      <GalleryViewer
        assets={searchResultAssets}
        assetInteraction={assetMultiSelectManager}
        onEndReached={loadNextPage}
        showArchiveIcon={true}
        {viewport}
        onReload={onSearchQueryUpdate}
        slidingWindowOffset={searchResultsElement.offsetTop}
        enableGrouping
      />
```

- [ ] **Step 7: Typecheck**

Run: `cd web && npm run check`
Expected: no new type errors from the search route or new files.

- [ ] **Step 8: Run the full web unit suite**

Run: `cd web && npx vitest run`
Expected: all tests pass (including Tasks 2–6).

- [ ] **Step 9: Manual verification**

Start the dev stack; open a search (e.g. filter by a person or `isNotInAlbum`). Confirm:

- The `Add all N to…` button appears above the grid with the correct total (`N` = server total, not the loaded count).
- Clicking it opens the album/space picker; picking an album shows the "Preparing assets…" state, then a success toast, and the modal closes.
- A filter matching >50,000 hides spaces in the picker and shows the notice; albums still work.
- The button is absent when a search yields zero results.

- [ ] **Step 10: Commit**

```bash
git add "web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte"
git commit -m "feat(web): add-all-to-collection button on the search results page"
```

---

## Self-Review

**Spec coverage:**

- Entry point (header button, uses `total`, visible iff `total>0`, no selection) → Tasks 6 + 7. ✔
- Flow (open picker with count → confirm → page-collect ids `withExif:false` → `addAssetsToCollections`) → Tasks 4 + 5 + 7. ✔
- Cap 10k→50k in both synced spots → Tasks 1 (server) + 2 (web). ✔
- Over-cap reuse (picker hides spaces + notice) → verified in Task 5 test + backfilled locale in Task 3. ✔
- Feedback ("Preparing assets…", existing toasts, existing error handling) → Task 5. ✔
- i18n all six locales (2 new keys + notice backfill) → Task 3 (+ completeness test). ✔
- Testing section of the spec:
  - collector paging (multi/single/empty), `withExif:false`, stops at `nextPage` null → Task 4. ✔
  - button appears iff total>0 → Task 6; opens picker with `assetCount=total` (proven via over-cap notice) + confirm triggers collect+add with full id set → Task 5. ✔
  - cap: >10k & ≤50k succeeds, >50k rejected by server DTO → Tasks 1 (server DTO) + 2 (web guard). ✔
  - i18n keys present in all six → Task 3 completeness spec. ✔
- Edge cases: `total===0` (button hidden, Task 6); filter captured at open time (Task 5 passes `terms` snapshot); empty-page safety break (Task 4); over-50k spaces cannot be picked (Task 5); album body-limit backstop left to existing handler (documented, no task needed). ✔

**Placeholder scan:** No TBD/TODO; every code + test block is complete and concrete. ✔

**Type consistency:** `SearchTerms` and `collectSearchResultAssetIds(terms, { smartSearchEnabled, language })` are defined identically in Task 4 and consumed verbatim in Task 5; `MAX_SPACE_ASSETS_PER_REQUEST` named consistently server/web; modal props `{ terms, total, smartSearchEnabled, language, onClose }` match the `modalManager.show(...)` call in Task 7 (which omits `onClose`, injected by the manager). ✔
