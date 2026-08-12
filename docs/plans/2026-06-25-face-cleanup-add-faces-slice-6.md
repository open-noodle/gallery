# Face Cleanup — Add Faces — Slice 6 (web component: Rest-of-cluster section) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the **Rest of this cluster** section to the review screen — paginated load (Load more), **Select
all**, **Move entire cluster** (confirm dialog), per-tile manual toggling that folds into the Stays/Moves strip +
sticky Move button, disabled manual actions when there is no primary owner (E17), and route the apply through
the Slice 5 `applyPayload()`.

**Architecture:** Extend `[personId]/+page.svelte`. New `$state` for the paginated Rest set + a confirm flag;
load page 0 on mount (excluding the flagged ids), Load more fetches further pages via the Slice 2 SDK fn
`getFaceRepairClusterFaces`. The view-model (Slice 5) holds manual selection + `applyPayload`; the component
wires Rest tiles to `vm.toggleManual`, Select all to `vm.selectAllLoaded`, Move entire cluster to
`vm.setEntireCluster(true)` + the confirm, and sets `vm.setClusterTotal(restTotal + flagged)` so an
entire-cluster move counts ALL eligible faces (flagged + rest) — this is why Move-entire-cluster still works when
the Rest is empty (E1). New UI strings land in en/de/fr.

**Tech Stack:** Svelte 5 runes, `@immich/sdk` (`getFaceRepairClusterFaces`, `applyFaceRepair`), Vitest +
@testing-library/svelte (SDK + i18n mocked; `t` returns the key).

**Spec:** [`2026-06-25-face-cleanup-add-faces-design.md`](2026-06-25-face-cleanup-add-faces-design.md) — Slice 6;
Architecture §Web (Screen); edge cases E1, E16, E17.

## Global Constraints

- New i18n keys MUST exist in `i18n/en.json` (source of truth; the fork also maintains `de.json` + `fr.json`).
  Other locales fall back to en. Keys are alphabetically sorted — add them and let `prettier` sort.
- SDK signature (verified): `getFaceRepairClusterFaces({ personId, faceRepairClusterFacesRequestDto:
{ excludeFaceIds, page, size } }) → { faces: { assetFaceId }[]; total; hasMore }`.
- The entire-cluster count = `restTotal + flaggedFaces.length` (Rest excludes the flagged ids; entire-cluster
  moves both). `vm.setClusterTotal(restTotal + flaggedFaces.length)` and the confirm body use this number; the
  Rest section header shows `restTotal` (M).
- E17: when `ownerPersonId` (primary owner) is null, **Select all** and **Move entire cluster** are disabled. The
  legacy flagged Move stays enabled (it routes flagged faces to their per-face suspects, needs no destination).
- Apply goes through `vm.applyPayload({ personId, destinationPersonId: ownerPersonId })` — do not rebuild the
  body inline.
- The cluster faces are loaded only when `flaggedFaces.length > 0` (the review screen is shown). 409 handling +
  the existing flagged grid behaviour are unchanged.
- Web: `make check-web` clean; Prettier (incl. i18n via `i18n/.prettierrc`). Full lint deferred to Slice 7.

---

## File Structure

- Modify: `i18n/en.json`, `i18n/de.json`, `i18n/fr.json` — new Rest-section UI strings.
- Modify: `web/src/routes/admin/face-cleanup/[personId]/+page.svelte` — Rest section + wiring + applyPayload.
- Modify: `web/src/routes/admin/face-cleanup/[personId]/page.spec.ts` — component tests.

---

## Task 1: i18n keys for the Rest section

**Files:** `i18n/en.json`, `i18n/de.json`, `i18n/fr.json`

- [ ] **Step 1: Add the keys**

Add these keys inside the same object that already holds the `face_cleanup_review_*` keys (the `"admin"` group),
in each of the three files. Exact `en.json` values:

```json
"face_cleanup_review_rest_title": "Rest of this cluster ({count})",
"face_cleanup_review_rest_hint": "Faces the scan didn't flag — add any that belong to {owner}.",
"face_cleanup_review_rest_empty": "The scan flagged every face in this cluster — there's nothing else to add.",
"face_cleanup_review_select_all": "Select all loaded",
"face_cleanup_review_move_entire": "Move entire cluster",
"face_cleanup_review_move_entire_confirm_title": "Move the entire cluster?",
"face_cleanup_review_move_entire_confirm_body": "This moves all {count} faces to {owner} and removes the empty cluster.",
"face_cleanup_review_move_entire_confirm_cta": "Move all {count}"
```

`de.json` values:

```json
"face_cleanup_review_rest_title": "Rest dieses Clusters ({count})",
"face_cleanup_review_rest_hint": "Gesichter, die der Scan nicht markiert hat – füge jene hinzu, die zu {owner} gehören.",
"face_cleanup_review_rest_empty": "Der Scan hat jedes Gesicht in diesem Cluster markiert – es gibt nichts weiter hinzuzufügen.",
"face_cleanup_review_select_all": "Alle geladenen auswählen",
"face_cleanup_review_move_entire": "Gesamtes Cluster verschieben",
"face_cleanup_review_move_entire_confirm_title": "Gesamtes Cluster verschieben?",
"face_cleanup_review_move_entire_confirm_body": "Dadurch werden alle {count} Gesichter zu {owner} verschoben und das leere Cluster entfernt.",
"face_cleanup_review_move_entire_confirm_cta": "Alle {count} verschieben"
```

`fr.json` values:

```json
"face_cleanup_review_rest_title": "Reste de ce groupe ({count})",
"face_cleanup_review_rest_hint": "Visages non signalés par l'analyse — ajoutez ceux qui appartiennent à {owner}.",
"face_cleanup_review_rest_empty": "L'analyse a signalé tous les visages de ce groupe — il n'y a rien d'autre à ajouter.",
"face_cleanup_review_select_all": "Tout sélectionner",
"face_cleanup_review_move_entire": "Déplacer tout le groupe",
"face_cleanup_review_move_entire_confirm_title": "Déplacer tout le groupe ?",
"face_cleanup_review_move_entire_confirm_body": "Cela déplace les {count} visages vers {owner} et supprime le groupe vide.",
"face_cleanup_review_move_entire_confirm_cta": "Tout déplacer ({count})"
```

- [ ] **Step 2: Format (sorts keys) + sanity check**

Run: `cd .. && npx prettier --write i18n/en.json i18n/de.json i18n/fr.json`
Run: `node -e "for (const f of ['en','de','fr']) JSON.parse(require('fs').readFileSync('i18n/'+f+'.json','utf8'))"` (valid JSON, exit 0).
Run: `for f in en de fr; do grep -c face_cleanup_review_move_entire_confirm_cta i18n/$f.json; done` → each prints `1`.

- [ ] **Step 3: Commit**

```bash
git add i18n/en.json i18n/de.json i18n/fr.json
git commit -m "i18n(web): face-cleanup rest-of-cluster + move-entire strings (en/de/fr)"
```

---

## Task 2: Rest-of-cluster section + wiring + component tests (TDD)

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/[personId]/+page.svelte`
- Test: `web/src/routes/admin/face-cleanup/[personId]/page.spec.ts`

**Interfaces:**

- Consumes: `getFaceRepairClusterFaces` (SDK), the Slice 5 view-model methods (`toggleManual`,
  `isManualSelected`, `selectAllLoaded`, `setEntireCluster`, `setClusterTotal`, `applyPayload`), and the
  existing `primaryOwner`/`ownerPersonId`/`ownerName` derived values.

- [ ] **Step 1: Write the failing component tests**

In `page.spec.ts`: add `getFaceRepairClusterFaces` to the `@immich/sdk` mock object (alongside the others):

```ts
    getFaceRepairClusterFaces: vi.fn(),
```

Add it to the existing import-from-`@immich/sdk` statement (with `type FaceRepairClusterFacesResponseDto`):

```ts
import {
  applyFaceRepair,
  getFaceRepairClusterFaces,
  getFaceRepairPersonFaces,
  getLatestScan,
  type FaceRepairClusterFacesResponseDto,
  type FaceRepairPersonFacesDto,
} from '@immich/sdk';
```

Add a default mock in `beforeEach` (so existing tests' on-mount Rest load is a harmless empty load) and Rest
helpers near the other `make*` helpers:

```ts
// in beforeEach, after the applyFaceRepair default:
vi.mocked(getFaceRepairClusterFaces).mockResolvedValue({
  faces: [],
  total: 0,
  hasMore: false,
} as unknown as FaceRepairClusterFacesResponseDto);
```

```ts
// near makeFlaggedFaces:
const makeRestFaces = (count: number) => Array.from({ length: count }, (_, i) => ({ assetFaceId: `rest-${i + 1}` }));
const restResponse = (faces: { assetFaceId: string }[], total: number, hasMore: boolean) =>
  ({ faces, total, hasMore }) as unknown as FaceRepairClusterFacesResponseDto;
```

Append these tests inside the `describe('+page.svelte (face-cleanup review)', …)` block:

```ts
it('renders the Rest section with loaded faces and a Load more when there are more', async () => {
  vi.mocked(getFaceRepairClusterFaces).mockResolvedValue(restResponse(makeRestFaces(2), 5, true));
  render(Page, { props: { data: makePageData() } });

  await waitFor(() => expect(screen.getByTestId('rest-section')).toBeInTheDocument());
  await waitFor(() => expect(screen.getAllByTestId('rest-tile')).toHaveLength(2));
  expect(screen.getByTestId('rest-load-more')).toBeInTheDocument();
});

it('shows the empty Rest state when the cluster has only flagged faces (E1)', async () => {
  vi.mocked(getFaceRepairClusterFaces).mockResolvedValue(restResponse([], 0, false));
  render(Page, { props: { data: makePageData() } });

  await waitFor(() => expect(screen.getByTestId('rest-empty')).toBeInTheDocument());
  expect(screen.queryAllByTestId('rest-tile')).toHaveLength(0);
});

it('selecting a Rest tile counts toward the move (re-enables Move after all flagged are excluded)', async () => {
  vi.mocked(getFaceRepairPersonFaces).mockResolvedValue({
    personId: PERSON_ID,
    flaggedFaces: makeFlaggedFaces(1),
  } as unknown as FaceRepairPersonFacesDto);
  vi.mocked(getFaceRepairClusterFaces).mockResolvedValue(restResponse(makeRestFaces(1), 1, false));
  render(Page, { props: { data: makePageData() } });

  await waitFor(() => expect(screen.getAllByTestId('rest-tile')).toHaveLength(1));

  // Exclude the only flagged face → Move disabled (0 moving).
  await fireEvent.click(screen.getAllByTestId('face-tile')[0]);
  await waitFor(() => expect(screen.getByTestId('move-btn')).toBeDisabled());

  // Select a Rest face → Move enabled again (1 manual moving).
  await fireEvent.click(screen.getAllByTestId('rest-tile')[0]);
  await waitFor(() => expect(screen.getByTestId('move-btn')).not.toBeDisabled());
});

it('Select all marks every loaded Rest face selected', async () => {
  vi.mocked(getFaceRepairClusterFaces).mockResolvedValue(restResponse(makeRestFaces(3), 3, false));
  render(Page, { props: { data: makePageData() } });

  await waitFor(() => expect(screen.getAllByTestId('rest-tile')).toHaveLength(3));
  await fireEvent.click(screen.getByTestId('select-all-btn'));

  await waitFor(() => {
    for (const tile of screen.getAllByTestId('rest-tile')) {
      expect(tile).toHaveAttribute('data-selected', 'true');
    }
  });
});

it('Move entire cluster opens a confirm and issues an entireCluster apply (even with an empty Rest, E1)', async () => {
  vi.mocked(getFaceRepairClusterFaces).mockResolvedValue(restResponse([], 0, false));
  render(Page, { props: { data: makePageData() } });

  await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeInTheDocument());
  await fireEvent.click(screen.getByTestId('move-entire-btn'));
  await waitFor(() => expect(screen.getByTestId('entire-confirm')).toBeInTheDocument());
  await fireEvent.click(screen.getByTestId('entire-confirm-cta'));

  await waitFor(() => {
    expect(applyFaceRepair).toHaveBeenCalledWith({
      faceRepairApplyRequestDto: {
        approvedPersonIds: [],
        excludeFaceIds: [],
        manualMove: { personId: PERSON_ID, destinationPersonId: OWNER_PERSON_ID, entireCluster: true },
      },
    });
  });
});

it('disables Select all and Move entire cluster when there is no primary owner (E17)', async () => {
  vi.mocked(getLatestScan).mockResolvedValue(
    makeCompletedScan([makeScanPerson({})]) as unknown as object, // overwritten below
  );
  vi.mocked(getLatestScan).mockResolvedValue(
    makeCompletedScan([{ ...makeScanPerson(), suspectedOwners: [] }]) as unknown as object,
  );
  vi.mocked(getFaceRepairClusterFaces).mockResolvedValue(restResponse(makeRestFaces(2), 2, false));
  render(Page, { props: { data: makePageData() } });

  await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeDisabled());
  expect(screen.getByTestId('select-all-btn')).toBeDisabled();
});
```

> The existing tests stay valid: the SDK `applyFaceRepair` legacy assertion (`{ approvedPersonIds: [PERSON_ID],
excludeFaceIds: ['face-1'] }`) matches `applyPayload`'s legacy output exactly (no `manualMove` key when nothing
> manual is selected), and the empty-Rest default keeps `face-tile` counts unchanged.

- [ ] **Step 2: Run to verify red**

Run: `cd web && npx vitest --run "src/routes/admin/face-cleanup/[personId]/page.spec.ts"` (or `npx vitest --run face-cleanup`)
Expected: FAIL — the new `rest-section` / `rest-tile` / `select-all-btn` / `move-entire-btn` / `entire-confirm`
testids do not exist yet. The pre-existing tests still pass.

- [ ] **Step 3: Implement — script changes in `+page.svelte`**

a) Add `getFaceRepairClusterFaces` to the `@immich/sdk` import (keep the others):

```ts
import {
  applyFaceRepair,
  declineFaceRepair,
  getFaceRepairClusterFaces,
  getFaceRepairPersonFaces,
  getLatestScan,
  getPeopleThumbnailPath,
  removeFaceRepairDeclines,
} from '@immich/sdk';
```

b) After `let applyError = $state<string | null>(null);` add the Rest state + derived cluster total:

```ts
// Rest-of-cluster (server-paginated) state.
const REST_PAGE_SIZE = 48;
let restFaces = $state<{ assetFaceId: string }[]>([]);
let restTotal = $state(0);
let restPage = $state(0);
let restHasMore = $state(false);
let restLoading = $state(false);
let showEntireConfirm = $state(false);

// An entire-cluster move covers ALL eligible faces: the Rest (which excludes the flagged ids) plus the
// still-flagged faces. This is why "Move entire cluster" works even when the Rest is empty.
const clusterTotal = $derived(restTotal + flaggedFaces.length);
```

c) Add the Rest loader + handlers (place after `handleLoadMore`):

```ts
const loadRestPage = async () => {
  if (restLoading) {
    return;
  }
  restLoading = true;
  try {
    const result = await getFaceRepairClusterFaces({
      personId,
      faceRepairClusterFacesRequestDto: {
        excludeFaceIds: flaggedFaces.map((f) => f.assetFaceId),
        page: restPage,
        size: REST_PAGE_SIZE,
      },
    });
    restFaces = [...restFaces, ...result.faces];
    restTotal = result.total;
    restHasMore = result.hasMore;
    restPage += 1;
    vm.setClusterTotal(restTotal + flaggedFaces.length);
  } catch {
    // graceful — leave the Rest section empty
  } finally {
    restLoading = false;
  }
};

const handleSelectAllRest = () => {
  vm.selectAllLoaded(restFaces.map((f) => f.assetFaceId));
};

const handleMoveEntireCluster = () => {
  if (!ownerPersonId) {
    return;
  }
  showEntireConfirm = true;
};

const confirmMoveEntireCluster = async () => {
  showEntireConfirm = false;
  vm.setEntireCluster(true);
  await handleMove();
};
```

d) In `onMount`, after `flaggedFaces = faces?.flaggedFaces ?? [];` and the `scanPerson` assignment (still inside
the `try`), kick off the Rest load when there are flagged faces:

```ts
if (flaggedFaces.length > 0) {
  void loadRestPage();
}
```

e) Replace the body of `handleMove`'s `applyFaceRepair` call so it uses `applyPayload` (replace the inline
`faceRepairApplyRequestDto: { approvedPersonIds: [personId], excludeFaceIds: [...] }` object):

```ts
await applyFaceRepair({
  faceRepairApplyRequestDto: vm.applyPayload({ personId, destinationPersonId: ownerPersonId }),
});
```

- [ ] **Step 4: Implement — template changes in `+page.svelte`**

a) Insert the Rest section between the faces-grid closing `</div>` and the `{:else}`-closing `{/if}`. Find this
exact text (the flagged grid's load-more `{/if}`, the grid `</div>`, then the `{:else}` `{/if}`):

```svelte
        {/if}
      </div>
    {/if}
  </div>
```

and replace it with (the Rest section inserted before the `{/if}`):

```svelte
        {/if}
      </div>

      <!-- Rest of this cluster (paginated) -->
      <div
        class="mt-5 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700"
        data-testid="rest-section"
      >
        <div class="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 class="text-sm font-semibold">
            {$t('admin.face_cleanup_review_rest_title', { values: { count: restTotal.toLocaleString() } })}
            <span class="ml-2 font-normal text-gray-400">
              {$t('admin.face_cleanup_review_rest_hint', { values: { owner: ownerName } })}
            </span>
          </h3>
          <div class="flex-1"></div>
          <button
            type="button"
            onclick={handleSelectAllRest}
            disabled={!ownerPersonId || restFaces.length === 0}
            class="text-sm font-semibold text-primary hover:underline disabled:opacity-40"
            data-testid="select-all-btn"
          >
            {$t('admin.face_cleanup_review_select_all')}
          </button>
          <Button
            color="secondary"
            size="small"
            disabled={!ownerPersonId}
            onclick={handleMoveEntireCluster}
            data-testid="move-entire-btn"
          >
            {$t('admin.face_cleanup_review_move_entire')}
          </Button>
        </div>

        {#if restTotal === 0 && !restLoading}
          <div class="py-12 text-center text-sm text-gray-400" data-testid="rest-empty">
            {$t('admin.face_cleanup_review_rest_empty')}
          </div>
        {:else}
          <div class="grid grid-cols-4 gap-3 bg-gray-50 p-4 dark:bg-gray-800/50 sm:grid-cols-6 lg:grid-cols-8">
            {#each restFaces as face (face.assetFaceId)}
              {@const selected = vm.isManualSelected(face.assetFaceId)}
              <div class="relative aspect-square">
                <button
                  type="button"
                  class={[
                    'absolute inset-0 overflow-hidden rounded-xl border-2 transition-all',
                    selected ? 'border-primary' : 'border-transparent opacity-70 hover:opacity-100',
                  ].join(' ')}
                  onclick={() => vm.toggleManual(face.assetFaceId)}
                  data-testid="rest-tile"
                  data-faceid={face.assetFaceId}
                  data-selected={selected}
                >
                  <img src={faceThumbnailUrl(face.assetFaceId)} alt="" class="size-full object-cover" loading="lazy" />
                  {#if selected}
                    <div
                      class="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-md border-2 border-white bg-primary shadow-sm"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </div>
                    <div
                      class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3 text-[10px] font-semibold text-white"
                    >
                      {$t('admin.face_cleanup_review_tile_dest', { values: { name: ownerName } })}
                    </div>
                  {/if}
                </button>
              </div>
            {/each}
          </div>
          {#if restHasMore}
            <div class="border-t border-gray-200 px-4 py-3 text-center dark:border-gray-700">
              <button
                type="button"
                onclick={loadRestPage}
                class="text-sm font-semibold text-primary hover:underline"
                data-testid="rest-load-more"
              >
                {$t('admin.face_cleanup_review_load_more', { values: { count: restTotal - restFaces.length } })}
              </button>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
```

b) Add the confirm dialog just before the closing `</AdminPageLayout>` (after the sticky action-bar `{/if}`):

```svelte
  {#if showEntireConfirm}
    <div class="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" data-testid="entire-confirm">
      <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-800">
        <h3 class="text-lg font-semibold">{$t('admin.face_cleanup_review_move_entire_confirm_title')}</h3>
        <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
          {$t('admin.face_cleanup_review_move_entire_confirm_body', {
            values: { count: clusterTotal.toLocaleString(), owner: ownerName },
          })}
        </p>
        <div class="mt-5 flex justify-end gap-3">
          <Button color="secondary" onclick={() => (showEntireConfirm = false)} data-testid="entire-confirm-cancel">
            {$t('admin.face_cleanup_review_cancel')}
          </Button>
          <Button color="primary" onclick={confirmMoveEntireCluster} data-testid="entire-confirm-cta">
            {$t('admin.face_cleanup_review_move_entire_confirm_cta', {
              values: { count: clusterTotal.toLocaleString() },
            })}
          </Button>
        </div>
      </div>
    </div>
  {/if}
</AdminPageLayout>
```

- [ ] **Step 5: Run to verify green**

Run: `cd web && npx vitest --run "src/routes/admin/face-cleanup/[personId]/page.spec.ts"`
Expected: PASS — the new Rest tests **and** all pre-existing review-page tests.

- [ ] **Step 6: Type-check + format**

Run: `cd .. && make check-web` (svelte-check + tsc; "0 errors"). If svelte-check reports `0 FILES`, run
`cd web && npx svelte-kit sync` first.
Run: `cd .. && npx prettier --check "web/src/routes/admin/face-cleanup/[personId]/+page.svelte" "web/src/routes/admin/face-cleanup/[personId]/page.spec.ts"` (write + re-run if needed).

- [ ] **Step 7: Commit**

```bash
git add "web/src/routes/admin/face-cleanup/[personId]/+page.svelte" "web/src/routes/admin/face-cleanup/[personId]/page.spec.ts"
git commit -m "feat(web): rest-of-cluster section (add faces / move entire cluster) on the review screen"
```

---

## Self-Review

- **Spec coverage (Slice 6):** Rest section page-0 load + Load more ✓; Select all (`selectAllLoaded`) ✓; Move
  entire cluster + confirm → `entireCluster` apply ✓; per-tile manual toggle folding into Stays/Moves + sticky
  Move ✓; `applyFaceRepair` via `applyPayload` ✓. Edges: E1 (empty Rest state + entire-cluster still moves the
  flagged faces via `clusterTotal = restTotal + flagged`) ✓; E16 (existing 409 banner test preserved) ✓; E17
  (Select all + Move entire cluster disabled when no primary owner) ✓.
- **Placeholders:** none — exact script + template edits + full tests + commands.
- **Type/contract consistency:** the entire-cluster apply body matches the Slice 2 DTO + Slice 5 `applyPayload`
  exactly (`{ approvedPersonIds: [], excludeFaceIds: [], manualMove: { personId, destinationPersonId,
entireCluster: true } }`). The legacy flagged Move body is unchanged, so the pre-existing payload test passes.
  i18n keys referenced by the component all added in Task 1.
- **Non-breaking:** `createReviewModel(flaggedFaces)` unchanged; `vm` is `$derived` on the once-set
  `flaggedFaces`, so manual state set after load persists. The Rest load is gated on `flaggedFaces.length > 0`,
  so the "no flagged faces" path and the loading path are untouched.
- **Carry-forward to Slice 7:** final full-suite gate (server unit + medium, web unit, check-web, check-server,
  lint, open-api drift) + the admin doc.
