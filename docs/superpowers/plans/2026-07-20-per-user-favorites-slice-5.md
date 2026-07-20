# Per-user favorites — Slice 5: Web heart un-gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user-visible #763 fix — a space viewer (or any authenticated reader) sees and can use the Favorite heart on photos they don't own, on the single-asset viewer, the multi-select bar, and the cmdk command; writes go to the canonical `PUT /assets/favorites`.

**Architecture:** The server already accepts viewer favorites (slice 2) and returns per-user state everywhere (slices 1/4). The web still gates the heart on `isOwner` / `isAllUserOwned` and writes via the deprecated `updateAsset(s)` alias (which 400s for non-owners). This slice removes those gates — replacing them with an explicit shared-link guard — switches all three favorite write paths to the generated `updateAssetFavorites` SDK call (204, no body → callers update local state themselves), and un-gates the three page-level `{#if isAllUserOwned}` wrappers around `<FavoriteAction>`.

**Tech Stack:** SvelteKit + Svelte 5 runes, `@immich/sdk` (source `packages/sdk/src/fetch-client.ts` — `updateAssetFavorites({ assetFavoriteUpdateDto: { ids, isFavorite } })` already committed by slice 2), Vitest + happy-dom, Playwright (e2e web project).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-per-user-favorites-design.md` slice 5 (§9). **#763 is closable at the end of this slice.**
- **Only favorite gates change.** Every other `isOwner` / `isAllUserOwned` gate (delete, archive, edit, stack, visibility, ChangeDate/Description/Location, download) stays exactly as is.
- **Shared-link sessions must never see or trigger the favorite action** — the new gates must explicitly exclude `sharedLink` sessions, and the `f` shortcut is `ActionItem.$if`-driven so the same gate covers it.
- Writes: all three favorite write paths (`asset.service.ts` single-asset handlers, `FavoriteAction.svelte` bulk, `selection-command-handlers.ts` cmdk) switch to `updateAssetFavorites`. The deprecated alias remains in use ONLY by `google-takeout-uploader.ts` (upload-time own-asset flag — out of scope) — nothing else may keep calling `updateAsset(s)` with `isFavorite`.
- `updateAssetFavorites` resolves with no body (204): callers keep their existing local-state updates (`asset.isFavorite = x`, `eventManager.emit('AssetUpdate', …)` with a locally-flipped copy).
- Web gate from `web/`: unit via `pnpm exec vitest run <paths>`, `pnpm check:typescript`, `pnpm lint` (0 errors; ~613 warnings are the tolerated baseline), `pnpm exec prettier --check` on modified files. `check:svelte` is a local no-op — CI covers it.
- Playwright: run against the e2e stack (`--project=web`); config `e2e/vitest.config.ts` is for API tests — Playwright uses `pnpm exec playwright test --project=web <file>` from `e2e/`. Rebuild the stack (docker compose up -d --build --wait from `e2e/`, full `down -v` first if the server crashes with "inconsistent media location") — the web image must contain this slice's web changes.
- `docs/plans/*.md` edits must be prettier-formatted (CI Docs Build is strict).
- Commits: `feat(web): … (#763)` / `test(e2e): … (#763)` / `docs: … (#763)`; never add Co-Authored-By trailers.

## File Map

| File                                                                                                         | Change                                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `web/src/lib/services/asset.service.ts:170-184,428-450`                                                      | Favorite/Unfavorite `$if` → `!!authUser && !sharedLink` + per-user state; handlers → `updateAssetFavorites` |
| `web/src/lib/services/asset.service.spec.ts`                                                                 | New tests for gates + handlers                                                                              |
| `web/src/lib/components/timeline/actions/FavoriteAction.svelte`                                              | `ownedAssets` → `assets`; `updateAssets` → `updateAssetFavorites`                                           |
| `web/src/lib/managers/selection-command-handlers.ts:38-43,80-105`                                            | `canFavoriteSelected` drops `isAllUserOwned`; `handleFavoriteSelected` full selection + canonical endpoint  |
| `web/src/lib/managers/selection-command-handlers.spec.ts`                                                    | Invert/extend favorite command tests                                                                        |
| `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte:653`                                               | Remove `{#if isAllUserOwned}` around `<FavoriteAction>` only                                                |
| `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte:883`                   | Same                                                                                                        |
| `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte:720` | Same                                                                                                        |
| `e2e/src/specs/web/space-viewer-favorite.e2e-spec.ts`                                                        | New Playwright: viewer hearts a non-owned space photo, persists across reload                               |
| `docs/plans/shared-spaces-permission-matrix.md:70,178`                                                       | Favorite row → Yes/Yes/Yes/No; known-gap 4 drops favorite                                                   |

**Out of scope, stated:** `google-takeout-uploader.ts` (upload-time flag on own assets); `MemoryViewer.svelte` / `MapTimelinePanel.svelte` / other pages using `<FavoriteAction>` ungated — they inherit the fixed component with no page edit. The space **people** page heart is un-gated by the same component+page-gate change as the space timeline; Playwright covers the space timeline surface only, because space-people fixtures require the ML pipeline the e2e stack doesn't run (`reference_e2e_web_playwright_2283_empty_body`: e2e stack has NO ML) — the people-page variant is structurally identical (same `FavoriteAction`, same manager, gate removed in this slice).

---

### Task 1: Single-asset viewer — un-gate Favorite/Unfavorite, canonical endpoint

**Files:**

- Modify: `web/src/lib/services/asset.service.ts:170-184` (gates), `:428-450` (handlers), imports
- Modify: `web/src/lib/services/asset.service.spec.ts` (new describe)

**Interfaces:**

- Consumes: `updateAssetFavorites({ assetFavoriteUpdateDto: { ids: string[], isFavorite: boolean } })` from `@immich/sdk` (resolves with no useful body). Existing locals in `getAssetActions`: `authUser`, `sharedLink`, `isOwner` (line ~115 — keep; other actions use it).
- Produces: Favorite/Unfavorite `ActionItem`s gated on `!!authUser && !sharedLink` + the caller's `asset.isFavorite`; `handleFavorite`/`handleUnfavorite` that emit an `AssetUpdate` event with a locally-flipped asset copy.

- [ ] **Step 1: Write the failing tests.** Read `asset.service.spec.ts` first and mirror its existing setup/mock idiom exactly (it currently has no favorite-gate coverage). Mock `@immich/sdk`'s `updateAssetFavorites`. Test cases (adapt arrange/act to the file's established pattern for calling `getAssetActions` and inspecting `ActionItem.$if`):

```ts
describe('favorite actions — per-user, un-gated from ownership (#763 slice 5)', () => {
  it('shows Favorite to an authenticated NON-OWNER when not yet favorited by them', () => {
    // authUser.id !== asset.ownerId, no sharedLink, asset.isFavorite === false
    // → Favorite.$if() === true, Unfavorite.$if() === false
  });

  it('shows Unfavorite to a non-owner who HAS favorited (viewer state, not owner state)', () => {
    // asset.isFavorite === true (already the caller-resolved value from the server)
    // → Unfavorite.$if() === true, Favorite.$if() === false
  });

  it('owner behavior unchanged (regression)', () => {
    // owner + isFavorite false → Favorite shown; owner + true → Unfavorite shown
  });

  it('shared-link session: neither action available (and thus the f shortcut is inert)', () => {
    // sharedLink set → Favorite.$if() === false && Unfavorite.$if() === false,
    // for both isFavorite true and false
  });

  it('handleFavorite calls the canonical endpoint and emits a flipped AssetUpdate', async () => {
    // invoke Favorite.onAction(); assert updateAssetFavorites called with
    // { assetFavoriteUpdateDto: { ids: [asset.id], isFavorite: true } },
    // assert eventManager emit 'AssetUpdate' with objectContaining({ id: asset.id, isFavorite: true }),
    // and updateAsset (deprecated) NOT called.
  });

  it('handleUnfavorite mirrors with isFavorite: false', async () => {});

  it('on endpoint error, no AssetUpdate is emitted (state untouched)', async () => {
    // updateAssetFavorites rejects → handleError path; no 'AssetUpdate' emission
  });
});
```

Fill each body with real code following the file's conventions — no stub bodies may remain.

- [ ] **Step 2: Run red.** `cd web && pnpm exec vitest run src/lib/services/asset.service.spec.ts` — new tests FAIL (gate consults `isOwner`; handlers call `updateAsset`).

- [ ] **Step 3: Implement.** In `asset.service.ts`:

Gates (lines ~170-184) — note `isOwner` stays defined for the other actions:

```ts
const Favorite: ActionItem = {
  title: $t('to_favorite'),
  icon: mdiHeartOutline,
  // #763: favoriting is per-user — any authenticated reader may favorite. Shared-link
  // sessions are explicitly excluded: auth.user there is the LINK OWNER, and an anonymous
  // visitor must never write favorites in the owner's name (spec §5.1).
  $if: () => !!authUser && !sharedLink && !asset.isFavorite,
  onAction: () => handleFavorite(asset),
};

const Unfavorite: ActionItem = {
  title: $t('unfavorite'),
  icon: mdiHeartMinusOutline,
  $if: () => !!authUser && !sharedLink && asset.isFavorite,
  onAction: () => handleUnfavorite(asset),
};
```

(Keep the existing `icon` values from the current file if they differ — only the `$if` lines change semantically.)

Handlers (~:428-450):

```ts
const handleFavorite = async (asset: AssetResponseDto) => {
  const $t = await getFormatter();

  try {
    await updateAssetFavorites({ assetFavoriteUpdateDto: { ids: [asset.id], isFavorite: true } });
    toastManager.primary($t('added_to_favorites'));
    eventManager.emit('AssetUpdate', { ...asset, isFavorite: true });
  } catch (error) {
    handleError(error, $t('errors.unable_to_add_remove_favorites', { values: { favorite: asset.isFavorite } }));
  }
};

const handleUnfavorite = async (asset: AssetResponseDto) => {
  const $t = await getFormatter();

  try {
    await updateAssetFavorites({ assetFavoriteUpdateDto: { ids: [asset.id], isFavorite: false } });
    toastManager.primary($t('removed_from_favorites'));
    eventManager.emit('AssetUpdate', { ...asset, isFavorite: false });
  } catch (error) {
    handleError(error, $t('errors.unable_to_add_remove_favorites', { values: { favorite: asset.isFavorite } }));
  }
};
```

Add `updateAssetFavorites` to the `@immich/sdk` import; remove `updateAsset` from it ONLY if nothing else in the file still uses it (grep the file first).

- [ ] **Step 4: Run green.** Same command; whole file passes.

- [ ] **Step 5: Commit.**

```bash
git add web/src/lib/services/asset.service.ts web/src/lib/services/asset.service.spec.ts
git commit -m "feat(web): un-gate the asset-viewer favorite action from ownership (#763)"
```

---

### Task 2: Multi-select bar + cmdk — full selection, canonical endpoint, page gates

**Files:**

- Modify: `web/src/lib/components/timeline/actions/FavoriteAction.svelte`
- Modify: `web/src/lib/managers/selection-command-handlers.ts` (`canFavoriteSelected` ~:38, `handleFavoriteSelected` ~:80)
- Modify: `web/src/lib/managers/selection-command-handlers.spec.ts`
- Modify: the three page gates — `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte:653`, `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte:883`, `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte:720`

**Interfaces:**

- Consumes: `SelectionCommandContext` (`command-context-manager.svelte.ts:44-60`) — has both `assets` and `ownedAssets`; `assetMultiSelectManager.assets` / `.isAllFavorite` (derived over the FULL selection already).
- Produces: favorite command/bar available whenever a selection exists (no ownership condition), mutating the full selection.

- [ ] **Step 1: Write the failing tests.** In `selection-command-handlers.spec.ts` (mirror its existing mock/context-builder idiom; mock `updateAssetFavorites`):
- `canFavoriteSelected` returns true for a mixed-ownership selection (owned + non-owned) with `onFavorite` set and not all favorited — red today (requires `isAllUserOwned`).
- `handleFavoriteSelected` with a mixed selection: calls `updateAssetFavorites` with the ids of ALL selected not-yet-favorited assets (owned and non-owned), flips `isFavorite` on those assets, calls `selection.onFavorite(ids, true)`, clears selection — red today (filters `ownedAssets`, calls `updateAssets`).
- Direction/mutation coherence (web analogue of spec E32): with a selection where a NON-owned asset is the only unfavorited one, the handler must mutate exactly that asset — under the old `ownedAssets` filter the id list would be empty.
- Regression: with no selection, handler no-ops; `canArchiveSelected` still requires `isAllUserOwned` (untouched sibling).

- [ ] **Step 2: Run red.** `cd web && pnpm exec vitest run src/lib/managers/selection-command-handlers.spec.ts`

- [ ] **Step 3: Implement.**

`selection-command-handlers.ts`:

```ts
export const canFavoriteSelected = (ctx: CommandContext) => {
  const selection = getSelection(ctx);
  return selection !== null && selection.onFavorite !== undefined && !selection.isAllFavorite;
};
```

```ts
export async function handleFavoriteSelected(ctx?: CommandContext) {
  const selection = getSelection(ctx);
  if (!selection || !selection.onFavorite) {
    return;
  }

  // #763: favorites are per-user — the whole selection is favoritable, not just owned assets.
  const assets = selection.assets.filter((asset) => !asset.isFavorite);
  const ids = assets.map((asset) => asset.id);
  if (ids.length === 0) {
    return;
  }

  const $t = get(t);
  try {
    await updateAssetFavorites({ assetFavoriteUpdateDto: { ids, isFavorite: true } });
    for (const asset of assets) {
      asset.isFavorite = true;
    }
    selection.onFavorite(ids, true);
    toastManager.primary($t('added_to_favorites_count', { values: { count: ids.length } }));
    selection.clearSelection();
  } catch (error) {
    handleError(error, $t('errors.unable_to_add_remove_favorites', { values: { favorite: true } }));
  }
}
```

(Update the `@immich/sdk` import: add `updateAssetFavorites`; drop `updateAssets` only if no other handler in the file uses it — archive/visibility handlers do, so it stays.)

`FavoriteAction.svelte` — two lines change:

```ts
const assets = assetMultiSelectManager.assets.filter((asset) => asset.isFavorite !== isFavorite);

const ids = assets.map(({ id }) => id);

if (ids.length > 0) {
  await updateAssetFavorites({ assetFavoriteUpdateDto: { ids, isFavorite } });
}
```

(swap the `updateAssets` import for `updateAssetFavorites`).

Page gates — in each of the three files, unwrap ONLY the `<FavoriteAction …/>` from its `{#if assetMultiSelectManager.isAllUserOwned}` block, preserving the props verbatim and leaving every other action inside its ownership gate. Where FavoriteAction is the block's sole child, delete the `{#if}`/`{/if}` pair; where it shares the block, move FavoriteAction out above it.

- [ ] **Step 4: Run green + typecheck.**

```bash
cd web && pnpm exec vitest run src/lib/managers/selection-command-handlers.spec.ts src/lib/services/asset.service.spec.ts
pnpm check:typescript
```

- [ ] **Step 5: Commit.**

```bash
git add web/src/lib/components/timeline/actions/FavoriteAction.svelte web/src/lib/managers/selection-command-handlers.ts web/src/lib/managers/selection-command-handlers.spec.ts "web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte" "web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte" "web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte"
git commit -m "feat(web): favorite the whole selection — multi-select bar, cmdk, space pages (#763)"
```

---

### Task 3: Playwright — the literal #763 scenario

**Files:**

- Create: `e2e/src/specs/web/space-viewer-favorite.e2e-spec.ts`

**Interfaces:**

- Consumes: fixture idiom from `e2e/src/specs/web/spaces-albums-timeline.e2e-spec.ts` (per-test space+asset via API utils, `createUserDto`, `utils.createSpace/addSpaceMember/createAsset/addSpaceAssets`, login helpers, `gotoAndWaitForTimeline`-style navigation waits). `PUT /assets/favorites` for state verification via API.
- Produces: browser-level proof of #763.

- [ ] **Step 1: Write the test.** One spec file, self-contained fixtures per the sibling file's conventions:
- **Scenario A (the issue):** owner creates space + uploads asset into it; viewer (role Viewer) logs in in a browser context, opens the space, opens the photo in the asset viewer, opens the action menu → Favorite is present; activates it; toast appears; reload the page; the action menu now shows Unfavorite (persisted per-user state). Verify via API that the OWNER's `getAssetInfo` still reports `isFavorite: false` (no cross-user write).
- **Scenario B (multi-select):** viewer selects the non-owned photo from the space timeline (hover-select), the selection bar shows the heart (previously hidden), clicking it favorites and shows the count toast.
- Selector discipline: use test-ids/aria labels the way the sibling spec does; the space role badge renders lowercase with CSS capitalize — use `{ ignoreCase: true }` on any role-text assertion (`feedback_space_role_badge_lowercase_ignorecase`).

- [ ] **Step 2: Rebuild the e2e WEB image and run.** From `e2e/`: `docker compose up -d --build --wait` (full `down -v` first if the server container crashes — known issue). Then:

```bash
cd e2e && pnpm exec playwright test --project=web src/specs/web/space-viewer-favorite.e2e-spec.ts
```

Red-first note: Scenario A/B genuinely fail against the PRE-slice-5 web bundle; since the stack was just rebuilt WITH the slice-5 web changes, the honest red is impractical here — instead verify the test fails when pointed at the right thing by asserting the strict positives (menu items, persisted state, owner unaffected). If the run flakes, fix the root cause — never retry-loop (`feedback_no_flake_allowance`). Beware `reuseExistingServer`/stale-web-layer traps (`reference_local_web_e2e_runs`, `reference_e2e_stack_shared_across_sessions`): if the UI looks pre-slice-5 (heart missing for viewer), the web image is stale — rebuild, don't debug the test.

- [ ] **Step 3: Commit.**

```bash
git add e2e/src/specs/web/space-viewer-favorite.e2e-spec.ts
git commit -m "test(e2e): space viewer favorites a non-owned photo via the web UI (#763)"
```

---

### Task 4: Permission matrix docs + slice gate + push

- [ ] **Step 1: Docs.** `docs/plans/shared-spaces-permission-matrix.md`:
- Line ~70: `| **Favorite/unfavorite** | Yes     | No     | No     | No         |` → `| **Favorite/unfavorite** | Yes     | Yes    | Yes    | No         |`
- Line ~178 (known-gap 4): remove "favorite" from the gated-actions list so it reads archive, edit/crop/rotate, rating (adjust the sentence, keep the rest of the gap accurate).
- `pnpm exec prettier --write docs/plans/shared-spaces-permission-matrix.md` (from repo root; table realignment is fine).

- [ ] **Step 2: Full web gate.**

```bash
cd web && pnpm exec vitest run src/lib/services/asset.service.spec.ts src/lib/managers/selection-command-handlers.spec.ts src/lib/managers/command-items.spec.ts
pnpm check:typescript && pnpm lint
pnpm exec prettier --check <all files modified this slice>
```

Also run the full web unit suite once (`pnpm exec vitest run`) — the gate for a slice that touched a shared component.

- [ ] **Step 3: Commit docs + push.**

```bash
git add docs/plans/shared-spaces-permission-matrix.md
git commit -m "docs: space members can favorite — permission matrix update (#763)"
git push
```
