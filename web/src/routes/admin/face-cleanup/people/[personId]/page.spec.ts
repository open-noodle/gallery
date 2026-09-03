import {
  getFaceRepairClusterFaces,
  getFaceRepairPersonMetadata,
  getLatestScan,
  resolveFaces,
  type FaceRepairClusterFacesResponseDto,
  type FaceRepairPersonMetadataResponseDto,
} from '@immich/sdk';
import { ConfirmModal, modalManager, toastManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import FaceActionsHelpModal from '$lib/components/face-cleanup/FaceActionsHelpModal.svelte';
import FacePhotoModal from '$lib/components/face-cleanup/FacePhotoModal.svelte';
import { Route } from '$lib/route';
import Page from './+page.svelte';
import { createManualReviewModel, type ManualReviewModel } from './manual-review.svelte';

// Manual review page (Slice 8, design §6.4 of
// specs/2026-07-23-manual-face-review-mode-design.md). Route:
// /admin/face-cleanup/people/[personId]. Person name/ownerId/faceCount come from the slice 3 metadata
// endpoint (getFaceRepairPersonMetadata), fetched from the URL param — never navigation state — so a hard
// refresh or a deep link works. Faces come from getFaceRepairClusterFaces with excludeFaceIds: [] (scan-free).
// Covers plan Step 1's 12 cases (manual face review, slice 8).
//
// THE VISUAL INVERSION (§6.4): manual defaults every face to `keep`, which is signalled by ABSENCE — a keep
// tile carries no badge, no ribbon. Colour only appears once the admin has acted. Bulk-action UI that WRITES
// a mark lands in slice 9 — this slice renders the grid, selection, and paging only. To exercise "a marked
// tile renders its badge/ribbon" and "load more preserves marks" without that UI, the tests below reach the
// SAME model instance the page created (via a spy on createManualReviewModel that delegates to the real
// implementation) and mark faces directly through it — exactly the seam slice 9's bulk actions will use.

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getFaceRepairPersonMetadata: vi.fn(),
    getFaceRepairClusterFaces: vi.fn(),
    getLatestScan: vi.fn(),
    resolveFaces: vi.fn(),
    getPeopleThumbnailPath: (id: string) => `/people/${id}/thumbnail`,
  };
});

vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  const noop = await import('@test-data/mocks/noop-component.svelte');
  return {
    ...mod,
    Icon: noop.default,
    toastManager: {
      primary: vi.fn(),
      success: vi.fn(),
      danger: vi.fn(),
    },
    // The picker modal itself is covered end-to-end by PersonPicker.spec.ts; here we only need to verify
    // the "Move to…" bulk action opens it with the right props and routes back whatever it resolves with —
    // same seam the guided page's page.spec.ts uses.
    modalManager: { show: vi.fn() },
  };
});

// Mock svelte-i18n: return the key as the translation (matches the sibling face-cleanup specs). Dynamic,
// server-sourced values (person name, owner id, loaded/total counts) are therefore rendered as PLAIN text in
// the template, never solely inside a $t(...) call — otherwise this mock would swallow them and nothing here
// could assert on them (matches the people browser's own `{displayName(person.name)}` / `{people.length} /
// {total}` convention).
vi.mock('svelte-i18n', async (orig) => {
  const actual = await orig<typeof import('svelte-i18n')>();
  return {
    ...actual,
    t: {
      subscribe: (run: (fn: (key: string, opts?: unknown) => string) => void) => {
        run((key: string) => key);
        return () => {};
      },
    },
  };
});

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
  onNavigate: vi.fn(),
}));

vi.mock('$app/stores', () => ({
  page: {
    subscribe: vi.fn((run) => {
      run({ url: new URL('http://localhost/admin/face-cleanup/people/person-1') });
      return () => {};
    }),
  },
  navigating: {
    subscribe: vi.fn((run) => {
      run(null);
      return () => {};
    }),
  },
  updated: {
    subscribe: vi.fn((run) => {
      run(false);
      return () => {};
    }),
  },
}));

vi.mock('$lib/components/layouts/AdminPageLayout.svelte', async () => {
  const { default: stub } = await import('@test-data/mocks/admin-page-layout.stub.svelte');
  return { default: stub };
});

// Face crops must go through the admin-gated, join-free face-thumbnail route (the same helper the guided
// review page uses) — never the user-scoped /people/:id/thumbnail route, which 404s for people the admin
// does not own.
//
// Keeps the REAL isUsableFaceBox/clampFaceBoxToImage/getBoundingBox/getAdminFacePreviewUrl (via `...actual`)
// rather than dropping them — FacePhotoModal (imported below purely for reference-identity assertions
// against modalManager.show) statically imports those at module-eval time, so a mock object missing them
// would break on import even though this file never renders the modal itself (same trap the guided page's
// page.spec.ts documents).
vi.mock('$lib/utils/people-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/people-utils')>();
  return {
    ...actual,
    getAdminFaceThumbnailUrl: (assetFaceId: string) => `/api/admin/face-repair/faces/${assetFaceId}/thumbnail`,
  };
});

// Spy on the model factory, delegating to the REAL implementation, so tests can reach the exact instance the
// page created and drive it directly (mark faces, pre-seed a selection) without any bulk-action UI — that UI
// is slice 9's job. The model owns its list and is never re-created (§6.4/§6.5); this spy is what lets a test
// prove that invariant too.
vi.mock('./manual-review.svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./manual-review.svelte')>();
  return {
    ...actual,
    createManualReviewModel: vi.fn((personId: string) => actual.createManualReviewModel(personId)),
  };
});

// ---- helpers ----

const PERSON_ID = 'person-1';
const OWNER_ID = 'owner-1';
const PAGE_SIZE = 48;

const makeMetadata = (
  over: Partial<FaceRepairPersonMetadataResponseDto> = {},
): FaceRepairPersonMetadataResponseDto => ({
  id: PERSON_ID,
  name: 'Jula',
  ownerId: OWNER_ID,
  faceCount: 3,
  thumbnailFaceId: null,
  ...over,
});

// #1061: the source-photo context every face now carries — irrelevant to selection/state tests, so every
// fixture face shares one stub rather than each test inventing its own (matches the guided page's PHOTO_CONTEXT).
const PHOTO_CONTEXT = {
  localDateTime: '2019-07-04T10:30:00.000Z',
  imageWidth: 400,
  imageHeight: 300,
  boundingBoxX1: 100,
  boundingBoxY1: 75,
  boundingBoxX2: 200,
  boundingBoxY2: 150,
};

const face = (assetFaceId: string) => ({ assetFaceId, ...PHOTO_CONTEXT });

const makeFacesResponse = (faces: ReturnType<typeof face>[], total: number): FaceRepairClusterFacesResponseDto => ({
  faces,
  total,
  hasMore: faces.length < total,
});

const makePageData = (personId = PERSON_ID) => ({
  personId,
  meta: { title: 'Review person' },
});

// Retrieves the exact ManualReviewModel instance the page created (see the module mock above), so a test can
// stage marks/selection through the model's own API instead of through not-yet-built bulk-action buttons.
const getVm = (): ManualReviewModel => {
  const calls = vi.mocked(createManualReviewModel).mock.results;
  return calls.at(-1)!.value as ManualReviewModel;
};

// Slice 9 tests drive the REAL bulk-action buttons and Apply — never the model directly (unlike slice 8's
// getVm() seam above, which existed only because there was no UI yet to click).
const tileFor = (id: string) => document.querySelector(`[data-testid="face-tile"][data-faceid="${CSS.escape(id)}"]`)!;
const selectTile = async (index: number) => {
  const tiles = screen.getAllByTestId('face-tile');
  await fireEvent.click(tiles[index]);
};

// `modalManager.show` is a generic overloaded method (its return type depends on the component passed in), so
// `vi.mocked(modalManager.show)` can't infer a concrete signature at this call site — same cast the guided
// page's page.spec.ts uses. The union covers both modals this page opens through it: PersonPicker (an object
// or undefined) and ConfirmModal (a boolean).
const showModal = modalManager.show as unknown as ReturnType<
  typeof vi.fn<
    (...args: unknown[]) => Promise<boolean | { personId: string; name: string; lock?: boolean } | undefined>
  >
>;

// Face-grid pagination is scroll-driven (InfiniteScrollSentinel): a controllable IntersectionObserver lets the
// "load more" test fire the sentinel explicitly, and getBoundingClientRect is parked below the fold in
// beforeEach so the visibility fallback never auto-loads in the other tests.
type ObserverEntry = Pick<IntersectionObserverEntry, 'target' | 'isIntersecting'>;
const observerInstances: ControllableIntersectionObserver[] = [];
class ControllableIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly scrollMargin = '';
  readonly thresholds = [];
  readonly disconnect = vi.fn();
  readonly observe = vi.fn((target: Element) => {
    this.observedTarget = target;
  });
  readonly takeRecords = vi.fn(() => []);
  readonly unobserve = vi.fn();
  observedTarget?: Element;
  constructor(private readonly callback: IntersectionObserverCallback) {
    observerInstances.push(this);
  }
  trigger(entry: ObserverEntry) {
    this.callback([entry as IntersectionObserverEntry], this);
  }
}

describe('+page.svelte (manual face-review page)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFaceRepairPersonMetadata).mockResolvedValue(makeMetadata());
    vi.mocked(getFaceRepairClusterFaces).mockResolvedValue(makeFacesResponse([face('f1'), face('f2'), face('f3')], 3));
    vi.mocked(getLatestScan).mockResolvedValue({} as unknown as object);
    vi.mocked(resolveFaces).mockResolvedValue({
      moved: 0,
      declined: 0,
      locked: 0,
      detached: 0,
      unknown: 0,
      skipped: 0,
    });
    showModal.mockResolvedValue(undefined);
    observerInstances.length = 0;
    vi.stubGlobal('IntersectionObserver', ControllableIntersectionObserver);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight + 1,
    } as DOMRect);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ---- 1. loads all cluster faces with no scan in existence ----
  it('loads every cluster face with excludeFaceIds: [] (scan-free) and renders one tile per face', async () => {
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => {
      expect(getFaceRepairClusterFaces).toHaveBeenCalledWith({
        personId: PERSON_ID,
        faceRepairClusterFacesRequestDto: { excludeFaceIds: [], page: 0, size: PAGE_SIZE },
      });
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('face-tile')).toHaveLength(3);
    });
  });

  // ---- 2. header shows person name, owner, and showing N of M ----
  it('header shows the person name, owner id, and a loaded/total count', async () => {
    vi.mocked(getFaceRepairPersonMetadata).mockResolvedValue(makeMetadata({ name: 'Jula', ownerId: OWNER_ID }));
    vi.mocked(getFaceRepairClusterFaces).mockResolvedValue(makeFacesResponse([face('f1'), face('f2')], 5));

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => {
      expect(screen.getByTestId('manual-review-heading')).toHaveTextContent('Jula');
    });
    expect(screen.getByTestId('manual-review-owner')).toHaveTextContent(OWNER_ID);
    expect(screen.getByTestId('manual-review-showing')).toHaveTextContent('2');
    expect(screen.getByTestId('manual-review-showing')).toHaveTextContent('5');
  });

  // ---- 3. unnamed person renders the fallback heading, never an empty title ----
  it('renders the fallback heading for an unnamed person instead of an empty title', async () => {
    vi.mocked(getFaceRepairPersonMetadata).mockResolvedValue(makeMetadata({ name: '' }));

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => {
      const heading = screen.getByTestId('manual-review-heading');
      expect(heading.textContent?.trim()).not.toBe('');
      expect(heading).toHaveTextContent('admin.face_cleanup_unnamed');
    });
  });

  // ---- 4. hard refresh / deep link: metadata resolves from the URL param, not navigation state ----
  it('fetches metadata using the personId from the URL param (page data), not any navigation state', async () => {
    const deepLinkedId = 'deep-linked-person';
    vi.mocked(getFaceRepairPersonMetadata).mockResolvedValue(makeMetadata({ id: deepLinkedId, name: 'Deep Link' }));
    vi.mocked(getFaceRepairClusterFaces).mockResolvedValue(makeFacesResponse([], 0));

    render(Page, { props: { data: makePageData(deepLinkedId) } });

    await waitFor(() => {
      expect(getFaceRepairPersonMetadata).toHaveBeenCalledWith({ personId: deepLinkedId });
    });
    expect(screen.getByTestId('manual-review-heading')).toHaveTextContent('Deep Link');
  });

  // ---- 5. `keep` tiles are clean: no badge, no ribbon (§6.4's visual inversion) ----
  it('renders every untouched tile as a clean crop — no state badge, no ribbon', async () => {
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

    for (const tile of screen.getAllByTestId('face-tile')) {
      expect(tile).toHaveAttribute('data-state', 'keep');
    }
    expect(document.querySelector('[data-state-icon]')).toBeNull();
    expect(screen.queryByText('admin.face_cleanup_review_tile_lock_ribbon')).not.toBeInTheDocument();
    expect(screen.queryByText('admin.face_cleanup_review_tile_detach_ribbon')).not.toBeInTheDocument();
    expect(screen.queryByText('admin.face_cleanup_review_tile_unknown_ribbon')).not.toBeInTheDocument();
  });

  // ---- 6. marked tiles carry badge + ribbon, using the shared STATE_COLOR/STATE_ICON tokens ----
  it('renders a badge and ribbon on every non-keep tile, one per state', async () => {
    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

    const vm = getVm();
    vm.toggle('f1');
    vm.applyToSelection('lock');
    vm.toggle('f2');
    vm.applyToSelection('unknown');
    vm.toggle('f3');
    vm.applyToSelection('detach');

    const tileFor = (id: string) =>
      document.querySelector(`[data-testid="face-tile"][data-faceid="${CSS.escape(id)}"]`)!;

    await waitFor(() => {
      expect(tileFor('f1')).toHaveAttribute('data-state', 'lock');
      expect(tileFor('f2')).toHaveAttribute('data-state', 'unknown');
      expect(tileFor('f3')).toHaveAttribute('data-state', 'detach');
    });

    expect(tileFor('f1').querySelector('[data-state-icon="lock"]')).not.toBeNull();
    expect(tileFor('f2').querySelector('[data-state-icon="unknown"]')).not.toBeNull();
    expect(tileFor('f3').querySelector('[data-state-icon="detach"]')).not.toBeNull();

    expect(tileFor('f1')).toHaveTextContent('admin.face_cleanup_review_tile_lock_ribbon');
    expect(tileFor('f2')).toHaveTextContent('admin.face_cleanup_review_tile_unknown_ribbon');
    expect(tileFor('f3')).toHaveTextContent('admin.face_cleanup_review_tile_detach_ribbon');

    // detach keeps the guided grayscale/opacity crop treatment
    const image = tileFor('f3').querySelector('img');
    expect(image?.getAttribute('style')).toContain('grayscale(1)');
    expect(image?.getAttribute('style')).toContain('opacity(0.55)');
  });

  // #1061: the manual-grid twin of the guided page's source-photo access tests. T8.2 is the load-bearing one
  // — a manual tile defaults to `keep`, so the meaningful "nothing happened" assertion is `keep` +
  // `data-selected="false"`, not an unchanged arbitrary state like guided's `owner`.
  describe('source-photo access', () => {
    const renderManualPage = async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));
    };

    it('T8.1/T8.3: manual tiles carry a labelled magnifier and a date pill', async () => {
      await renderManualPage();
      const tiles = screen.getAllByTestId('face-tile');

      expect(screen.getAllByTestId('face-tile-view-photo')).toHaveLength(tiles.length);
      expect(screen.getAllByTestId('face-tile-date')).toHaveLength(tiles.length);
    });

    it('T8.2: clicking the magnifier leaves the tile at `keep` — nothing is staged', async () => {
      await renderManualPage();
      const tile = screen.getAllByTestId('face-tile')[0];
      expect(tile.dataset.state).toBe('keep'); // positive control: manual defaults to keep
      expect(tile.dataset.selected).toBe('false');

      await fireEvent.click(within(tile.parentElement!).getByTestId('face-tile-view-photo'));

      expect(tile.dataset.state).toBe('keep');
      expect(tile.dataset.selected).toBe('false');
      expect(modalManager.show).toHaveBeenCalledWith(FacePhotoModal, expect.objectContaining({ index: 0 }));
    });

    // The modal is mocked here, so rendering it proves nothing about the wiring. This calls the callbacks the
    // PAGE handed it and asserts the grid reacted — without it, a refactor could drop the selection props and
    // every test above would stay green. Manual has one grid and no destination gate, so no `canSelect`.
    it('hands the modal a working selection toggle', async () => {
      await renderManualPage();
      const tile = screen.getAllByTestId('face-tile')[0];
      const faceId = tile.dataset.faceid!;

      await fireEvent.click(within(tile.parentElement!).getByTestId('face-tile-view-photo'));
      const props = vi.mocked(modalManager.show).mock.calls.at(-1)![1] as unknown as {
        isSelected: (id: string) => boolean;
        onToggleSelect: (id: string) => void;
      };

      expect(props.isSelected(faceId)).toBe(false); // positive control: opening staged nothing
      props.onToggleSelect(faceId);
      await waitFor(() => expect(tile.dataset.selected).toBe('true'));

      props.onToggleSelect(faceId);
      await waitFor(() => expect(tile.dataset.selected).toBe('false'));
      // Staging a selection must not have marked the face — `keep` is manual's default and only a bulk
      // action moves a tile out of it.
      expect(tile.dataset.state).toBe('keep');
    });
  });

  // ---- 7. selection: click selects, shift-click selects a range, clear works ----
  describe('selection', () => {
    it('click toggles a single tile selected, and clicking again deselects it', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]);
      expect(tiles[0]).toHaveAttribute('data-selected', 'true');

      await fireEvent.click(tiles[0]);
      expect(tiles[0]).toHaveAttribute('data-selected', 'false');
    });

    it('shift-click selects every tile in the range, inclusive', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]);
      await fireEvent.click(tiles[2], { shiftKey: true });

      expect(tiles[0]).toHaveAttribute('data-selected', 'true');
      expect(tiles[1]).toHaveAttribute('data-selected', 'true');
      expect(tiles[2]).toHaveAttribute('data-selected', 'true');
    });

    it('Clear selection empties the selection', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]);
      await fireEvent.click(tiles[1]);
      expect(tiles[0]).toHaveAttribute('data-selected', 'true');

      await fireEvent.click(screen.getByTestId('manual-review-clear-selection'));

      for (const tile of screen.getAllByTestId('face-tile')) {
        expect(tile).toHaveAttribute('data-selected', 'false');
      }
    });
  });

  // ---- 8. "Select all loaded (N)" selects exactly the loaded faces; label reports LOADED, never total ----
  describe('select all loaded', () => {
    it('selects exactly the currently loaded faces', async () => {
      vi.mocked(getFaceRepairClusterFaces).mockResolvedValue(makeFacesResponse([face('f1'), face('f2')], 1204));

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(2));

      await fireEvent.click(screen.getByTestId('manual-review-select-all-loaded'));

      for (const tile of screen.getAllByTestId('face-tile')) {
        expect(tile).toHaveAttribute('data-selected', 'true');
      }
    });

    it('label reports the LOADED count, not total, when total is larger — the honesty requirement', async () => {
      vi.mocked(getFaceRepairClusterFaces).mockResolvedValue(makeFacesResponse([face('f1'), face('f2')], 1204));

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(2));

      const button = screen.getByTestId('manual-review-select-all-loaded');
      expect(button).toHaveTextContent('2');
      expect(button).not.toHaveTextContent('1204');
    });
  });

  // ---- 9. Load more APPENDS via appendFaces and PRESERVES staged marks AND selection (the most important
  //      test in this slice — the regression guard for the guided page's $derived defect) ----
  it('Load more appends the next page and preserves both staged marks and the current selection', async () => {
    vi.mocked(getFaceRepairClusterFaces)
      .mockResolvedValueOnce(makeFacesResponse([face('f1'), face('f2')], 4))
      .mockResolvedValueOnce(makeFacesResponse([face('f3'), face('f4')], 4));

    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(2));

    const vm = getVm();
    // Stage a mark on f1 (clears its own selection) and separately select f2 without marking it.
    vm.toggle('f1');
    vm.applyToSelection('lock');
    vm.toggle('f2');

    await waitFor(() => {
      const tile = document.querySelector('[data-testid="face-tile"][data-faceid="f1"]')!;
      expect(tile).toHaveAttribute('data-state', 'lock');
    });

    // No "Load more" button — the sentinel entering the viewport is what loads the next page of faces.
    await waitFor(() => expect(observerInstances.length).toBeGreaterThan(0));
    const observer = observerInstances.at(-1)!;
    observer.trigger({ target: observer.observedTarget!, isIntersecting: true });

    await waitFor(() => {
      expect(getFaceRepairClusterFaces).toHaveBeenCalledWith({
        personId: PERSON_ID,
        faceRepairClusterFacesRequestDto: { excludeFaceIds: [], page: 1, size: PAGE_SIZE },
      });
    });
    await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(4));

    const tileFor = (id: string) =>
      document.querySelector(`[data-testid="face-tile"][data-faceid="${CSS.escape(id)}"]`)!;
    // Marks survived the append.
    expect(tileFor('f1')).toHaveAttribute('data-state', 'lock');
    // Selection survived the append.
    expect(tileFor('f2')).toHaveAttribute('data-selected', 'true');
    // The newly appended faces default to keep and are unselected.
    expect(tileFor('f3')).toHaveAttribute('data-state', 'keep');
    expect(tileFor('f4')).toHaveAttribute('data-state', 'keep');
    expect(tileFor('f3')).toHaveAttribute('data-selected', 'false');
  });

  // ---- 10. zero-face person renders the dashed empty treatment ----
  it('renders the empty state when the person has zero faces', async () => {
    vi.mocked(getFaceRepairClusterFaces).mockResolvedValue(makeFacesResponse([], 0));
    vi.mocked(getFaceRepairPersonMetadata).mockResolvedValue(makeMetadata({ faceCount: 0, thumbnailFaceId: null }));

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => {
      expect(screen.getByTestId('manual-review-empty')).toBeInTheDocument();
    });
    expect(screen.queryAllByTestId('face-tile')).toHaveLength(0);
    expect(screen.queryByTestId('manual-review-load-error')).not.toBeInTheDocument();
  });

  // ---- 11. load error is DISTINCT from empty (D17 on the guided page conflated them) ----
  it('renders a load-error state with Retry, distinct from the empty state; Retry re-fetches', async () => {
    vi.mocked(getFaceRepairPersonMetadata).mockRejectedValueOnce(new Error('network down'));

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => {
      expect(screen.getByTestId('manual-review-load-error')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('manual-review-empty')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('face-tile')).toHaveLength(0);

    vi.mocked(getFaceRepairPersonMetadata).mockResolvedValueOnce(makeMetadata());
    await fireEvent.click(screen.getByTestId('manual-review-load-error-retry'));

    await waitFor(() => {
      expect(screen.getAllByTestId('face-tile')).toHaveLength(3);
      expect(screen.queryByTestId('manual-review-load-error')).not.toBeInTheDocument();
    });
  });

  // ---- 12. a person the scan DID flag shows NO flagged badging — manual ignores scan state entirely (§7) ----
  it('never reads scan state and shows no flagged affordance, even for a person the scan flagged', async () => {
    vi.mocked(getLatestScan).mockResolvedValue({
      id: 'scan-1',
      status: 'completed',
      persons: [{ personId: PERSON_ID, flagged: 3 }],
    } as unknown as object);

    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

    // Manual mode never calls the scan endpoint at all.
    expect(getLatestScan).not.toHaveBeenCalled();
    // Every tile defaults to keep — no flagged/badge affordance exists for an untouched face.
    for (const tile of screen.getAllByTestId('face-tile')) {
      expect(tile).toHaveAttribute('data-state', 'keep');
    }
    expect(document.querySelector('[data-state-icon]')).toBeNull();
    expect(screen.queryByText(/flagged/i)).not.toBeInTheDocument();
  });

  // ==== Slice 9 — footer dock: five bulk actions, the staged-work tally, and Apply (design §6.4) ====
  // Unlike slice 8, these tests drive the REAL UI — the bulk-action buttons and Apply — never the model
  // directly. The getVm() seam above only existed because there was no UI yet to click; that is the whole
  // point of this slice.
  describe('Slice 9 — bulk actions + Apply', () => {
    // ---- 3. Apply is disabled while everything is `keep` ----
    it('Apply is disabled while every face is keep, and cannot be activated', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      expect(screen.getByTestId('face-dock')).toBeInTheDocument();
      const applyBtn = screen.getByTestId('manual-review-apply-btn');
      expect(applyBtn).toBeDisabled();

      await fireEvent.click(applyBtn);
      expect(resolveFaces).not.toHaveBeenCalled();
    });

    // ---- 1. each of Lock/Unknown/Not-a-face applies to EXACTLY the current selection, others stay keep ----
    it.each([
      ['manual-review-bulk-lock', 'lock'],
      ['manual-review-bulk-unknown', 'unknown'],
      ['manual-review-bulk-detach', 'detach'],
    ] as const)('%s marks exactly the selected face %s, leaving the rest keep', async (buttonTestId, expectedState) => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await selectTile(0);
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());
      await fireEvent.click(screen.getByTestId(buttonTestId));

      await waitFor(() => {
        expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument();
        expect(tileFor('f1')).toHaveAttribute('data-state', expectedState);
      });
      expect(tileFor('f2')).toHaveAttribute('data-state', 'keep');
      expect(tileFor('f3')).toHaveAttribute('data-state', 'keep');
    });

    // ---- Move to… (PersonPicker) ----
    describe('Move to…', () => {
      it("passes the person's ownerId from the metadata endpoint, and the current selection count", async () => {
        render(Page, { props: { data: makePageData() } });
        await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

        await selectTile(0);
        await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());
        await fireEvent.click(screen.getByTestId('manual-review-bulk-move'));

        await waitFor(() => {
          expect(showModal).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ ownerId: OWNER_ID, faceCount: 1 }),
          );
        });
      });

      it('marks exactly the selection move, leaving the rest keep, with the chosen destination + lock flag landing in the request', async () => {
        showModal.mockResolvedValueOnce({ personId: 'dest-1', name: 'Dest Person', lock: true });

        render(Page, { props: { data: makePageData() } });
        await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

        await selectTile(0); // f1
        await fireEvent.click(screen.getByTestId('manual-review-bulk-move'));

        await waitFor(() => {
          expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument();
          expect(tileFor('f1')).toHaveAttribute('data-state', 'move');
        });
        expect(tileFor('f2')).toHaveAttribute('data-state', 'keep');
        expect(tileFor('f3')).toHaveAttribute('data-state', 'keep');

        await fireEvent.click(screen.getByTestId('manual-review-apply-btn'));

        await waitFor(() => {
          expect(resolveFaces).toHaveBeenCalledWith({
            faceRepairResolveRequestDto: {
              personId: PERSON_ID,
              moveToPerson: [{ destinationPersonId: 'dest-1', faceIds: ['f1'], lock: true }],
              stay: [],
              lock: [],
              detach: [],
              unknown: [],
            },
          });
        });
      });

      it('leaves the selection untouched if the picker is closed without choosing a destination', async () => {
        showModal.mockResolvedValueOnce(undefined);

        render(Page, { props: { data: makePageData() } });
        await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

        await selectTile(0);
        await fireEvent.click(screen.getByTestId('manual-review-bulk-move'));

        await waitFor(() => expect(showModal).toHaveBeenCalled());

        // Selection (still `keep`) survives an uncommitted picker — the bulk bar is still showing.
        expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument();
        expect(tileFor('f1')).toHaveAttribute('data-state', 'keep');
      });
    });

    // ---- 2. Unmark returns marked faces to `keep` AND removes them from the request ----
    it('Unmark returns marked faces to keep and removes them from the Apply request, without touching an untouched mark', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      // Lock both f1 and f2.
      await selectTile(0);
      await selectTile(1);
      await fireEvent.click(screen.getByTestId('manual-review-bulk-lock'));

      await waitFor(() => {
        expect(tileFor('f1')).toHaveAttribute('data-state', 'lock');
        expect(tileFor('f2')).toHaveAttribute('data-state', 'lock');
      });

      // Re-select only f1 and Unmark it.
      await selectTile(0);
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());
      await fireEvent.click(screen.getByTestId('manual-review-bulk-unmark'));

      await waitFor(() => {
        expect(tileFor('f1')).toHaveAttribute('data-state', 'keep');
      });
      // f2's mark is untouched by unmarking f1.
      expect(tileFor('f2')).toHaveAttribute('data-state', 'lock');

      await fireEvent.click(screen.getByTestId('manual-review-apply-btn'));

      await waitFor(() => {
        expect(resolveFaces).toHaveBeenCalledWith({
          faceRepairResolveRequestDto: {
            personId: PERSON_ID,
            moveToPerson: [],
            stay: [],
            lock: ['f2'],
            detach: [],
            unknown: [],
          },
        });
      });
    });

    // ---- 4. the tally reports staged work per bucket ----
    it('the tally reports staged work per bucket', async () => {
      vi.mocked(getFaceRepairClusterFaces).mockResolvedValue(
        makeFacesResponse([face('f1'), face('f2'), face('f3'), face('f4'), face('f5')], 5),
      );

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(5));

      // 2 -> move
      showModal.mockResolvedValueOnce({ personId: 'dest-1', name: 'Dest', lock: false });
      await selectTile(0);
      await selectTile(1);
      await fireEvent.click(screen.getByTestId('manual-review-bulk-move'));
      await waitFor(() => expect(tileFor('f1')).toHaveAttribute('data-state', 'move'));

      // 1 -> lock
      await selectTile(2);
      await fireEvent.click(screen.getByTestId('manual-review-bulk-lock'));
      await waitFor(() => expect(tileFor('f3')).toHaveAttribute('data-state', 'lock'));

      // 2 -> detach
      await selectTile(3);
      await selectTile(4);
      await fireEvent.click(screen.getByTestId('manual-review-bulk-detach'));
      await waitFor(() => expect(tileFor('f4')).toHaveAttribute('data-state', 'detach'));

      const tally = screen.getByTestId('manual-review-tally');
      expect(within(tally).getByTestId('manual-review-tally-move')).toHaveTextContent('2');
      expect(within(tally).getByTestId('manual-review-tally-lock')).toHaveTextContent('1');
      expect(within(tally).getByTestId('manual-review-tally-unknown')).toHaveTextContent('0');
      expect(within(tally).getByTestId('manual-review-tally-detach')).toHaveTextContent('2');
    });

    // ---- 6. Apply posts the exact request the model built, asserting the FULL payload shape including
    //      `stay: []` explicitly — the single most important payload assertion on this page ----
    it('Apply posts the exact request the model built, across mixed buckets, asserting `stay: []` explicitly', async () => {
      showModal.mockResolvedValueOnce({ personId: 'dest-1', name: 'Dest', lock: false });

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await selectTile(0); // f1 -> move
      await fireEvent.click(screen.getByTestId('manual-review-bulk-move'));
      await waitFor(() => expect(tileFor('f1')).toHaveAttribute('data-state', 'move'));

      await selectTile(1); // f2 -> unknown
      await fireEvent.click(screen.getByTestId('manual-review-bulk-unknown'));
      await waitFor(() => expect(tileFor('f2')).toHaveAttribute('data-state', 'unknown'));

      // f3 stays `keep` — it must not appear in ANY bucket below.

      await fireEvent.click(screen.getByTestId('manual-review-apply-btn'));

      await waitFor(() => {
        expect(resolveFaces).toHaveBeenCalledWith({
          faceRepairResolveRequestDto: {
            personId: PERSON_ID,
            moveToPerson: [{ destinationPersonId: 'dest-1', faceIds: ['f1'], lock: false }],
            stay: [],
            lock: [],
            detach: [],
            unknown: ['f2'],
          },
        });
      });
    });

    // ---- 7. detach requires the destructive confirm on Apply; declining does NOT post ----
    // S12.4: the confirmation is a real `modalManager.show(ConfirmModal, …)` dialog. Escape/backdrop dismissal
    // and focus handling are ConfirmModal's own responsibility; this page must prove it opens the dialog with
    // the right copy, a decline (`onClose(false)`, exactly what Escape/Cancel both produce) posts nothing, and
    // a confirm (`onClose(true)`) posts exactly once with the expected payload.
    describe('destructive confirm — Not a face', () => {
      const stageDetach = async () => {
        render(Page, { props: { data: makePageData() } });
        await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));
        await selectTile(0);
        await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());
        await fireEvent.click(screen.getByTestId('manual-review-bulk-detach'));
      };

      it('does NOT commit anything when Apply carries a detached face — it asks first, with the right copy', async () => {
        let settleConfirm!: (confirmed: boolean) => void;
        showModal.mockReturnValueOnce(
          new Promise((resolve) => {
            settleConfirm = resolve as (confirmed: boolean) => void;
          }) as never,
        );
        await stageDetach();

        await fireEvent.click(screen.getByTestId('manual-review-apply-btn'));

        await waitFor(() =>
          expect(showModal).toHaveBeenCalledWith(
            ConfirmModal,
            expect.objectContaining({
              title: 'admin.face_cleanup_review_detach_confirm_title',
              prompt: 'admin.face_cleanup_review_detach_confirm_body',
              confirmText: 'admin.face_cleanup_review_detach_confirm_cta',
              confirmColor: 'danger',
            }),
          ),
        );
        expect(resolveFaces).not.toHaveBeenCalled();

        settleConfirm(false);
        await waitFor(() => expect(resolveFaces).not.toHaveBeenCalled());
      });

      it('declining the confirm does NOT post, and the staged mark survives', async () => {
        showModal.mockResolvedValueOnce(false);
        await stageDetach();

        await fireEvent.click(screen.getByTestId('manual-review-apply-btn'));

        await waitFor(() => expect(showModal).toHaveBeenCalledWith(ConfirmModal, expect.anything()));
        expect(resolveFaces).not.toHaveBeenCalled();
        expect(tileFor('f1')).toHaveAttribute('data-state', 'detach');
      });

      it('confirming posts the request with the detached face', async () => {
        showModal.mockResolvedValueOnce(true);
        await stageDetach();

        await fireEvent.click(screen.getByTestId('manual-review-apply-btn'));

        await waitFor(() => {
          expect(resolveFaces).toHaveBeenCalledTimes(1);
          expect(resolveFaces).toHaveBeenCalledWith({
            faceRepairResolveRequestDto: {
              personId: PERSON_ID,
              moveToPerson: [],
              stay: [],
              lock: [],
              detach: ['f1'],
              unknown: [],
            },
          });
        });
      });

      it('does NOT ask when nothing is being discarded — a routine Apply goes straight through', async () => {
        render(Page, { props: { data: makePageData() } });
        await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

        await selectTile(0);
        await fireEvent.click(screen.getByTestId('manual-review-bulk-lock'));
        await fireEvent.click(screen.getByTestId('manual-review-apply-btn'));

        await waitFor(() => expect(resolveFaces).toHaveBeenCalled());
        expect(showModal).not.toHaveBeenCalledWith(ConfirmModal, expect.anything());
      });
    });

    // ---- 8. a 409 (a scan started mid-review) is surfaced WITHOUT discarding staged work ----
    it('surfaces a 409 without discarding staged work, and does not re-fetch the cluster', async () => {
      let rejectApply!: () => void;
      vi.mocked(resolveFaces).mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectApply = () => reject(Object.assign(new Error('conflict'), { status: 409 }));
        }),
      );

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await selectTile(0);
      await fireEvent.click(screen.getByTestId('manual-review-bulk-lock'));

      const applyBtn = screen.getByTestId('manual-review-apply-btn');
      await fireEvent.click(applyBtn);
      expect(applyBtn).toBeDisabled();

      rejectApply();

      await waitFor(() => {
        expect(screen.getByText('admin.face_cleanup_review_apply_conflict')).toBeInTheDocument();
      });

      // Staged work survives the conflict — losing it is exactly what the chooser's disabled-manual card
      // exists to prevent (design §7); the cluster was never re-fetched (that only happens on success).
      expect(tileFor('f1')).toHaveAttribute('data-state', 'lock');
      expect(getFaceRepairClusterFaces).toHaveBeenCalledTimes(1);
    });

    // ---- 9. result reporting — counts from the response are shown ----
    it('reports what the server actually did after a successful apply', async () => {
      vi.mocked(resolveFaces).mockResolvedValueOnce({
        moved: 1,
        declined: 0,
        locked: 2,
        detached: 0,
        unknown: 0,
        skipped: 0,
      });

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await selectTile(0);
      await fireEvent.click(screen.getByTestId('manual-review-bulk-lock'));
      await fireEvent.click(screen.getByTestId('manual-review-apply-btn'));

      await waitFor(() => {
        expect(toastManager.primary).toHaveBeenCalledWith(
          expect.stringContaining('admin.face_cleanup_manual_review_apply_summary'),
        );
      });
    });
  });

  // ==== Slice 10, Part A — Move entire cluster (design §6.4 "Selection cannot claim the whole cluster") ====
  // The server's entireCluster enumerates the whole cluster SERVER-SIDE — the right tool here, because
  // selection can only ever cover LOADED faces on a server-paged page. Unlike guided (where entireCluster rides
  // the scan's suspected owner), manual has no scan and therefore no suggested destination, so this control
  // REQUIRES an explicit destination picked through PersonPicker.
  describe('Slice 10 — Move entire cluster', () => {
    it("opens PersonPicker with the person's ownerId, independent of any selection", async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('manual-review-move-entire-btn'));

      await waitFor(() => {
        expect(showModal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ownerId: OWNER_ID }));
      });
    });

    it('is available with nothing selected, and remains available once a selection exists', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      // Not gated behind selection — it is not a selection action.
      expect(screen.getByTestId('manual-review-move-entire-btn')).not.toBeDisabled();

      await selectTile(0);
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());

      expect(screen.getByTestId('manual-review-move-entire-btn')).toBeInTheDocument();
      expect(screen.getByTestId('manual-review-move-entire-btn')).not.toBeDisabled();
    });

    it('posts nothing when the picker is cancelled without a destination', async () => {
      showModal.mockResolvedValueOnce(undefined);

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('manual-review-move-entire-btn'));
      await waitFor(() => expect(showModal).toHaveBeenCalled());

      // Only the PersonPicker call happened — cancelling it never opens the ConfirmModal at all.
      expect(showModal).toHaveBeenCalledTimes(1);
      expect(resolveFaces).not.toHaveBeenCalled();
    });

    // S12.5: same three assertions as the detach confirmation (S12.4) — a real ConfirmModal (chained after
    // PersonPicker here), a decline that posts nothing, a confirm that posts exactly once with the expected
    // payload.
    it('confirms before posting, carrying the distinct never-seen-faces warning copy', async () => {
      let settleConfirm!: (confirmed: boolean) => void;
      showModal.mockResolvedValueOnce({ personId: 'dest-1', name: 'Dest Person', lock: false }).mockReturnValueOnce(
        new Promise((resolve) => {
          settleConfirm = resolve as (confirmed: boolean) => void;
        }) as never,
      );

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('manual-review-move-entire-btn'));

      // The manual-specific confirm copy (never the guided page's generic entire-cluster body, which says
      // nothing about faces the admin has never reviewed).
      await waitFor(() =>
        expect(showModal).toHaveBeenCalledWith(
          ConfirmModal,
          expect.objectContaining({
            title: 'admin.face_cleanup_review_move_entire_confirm_title',
            prompt: 'admin.face_cleanup_manual_review_move_entire_confirm_body',
            confirmText: 'admin.face_cleanup_review_move_entire_confirm_cta',
          }),
        ),
      );
      expect(resolveFaces).not.toHaveBeenCalled();

      settleConfirm(false);
      await waitFor(() => expect(resolveFaces).not.toHaveBeenCalled());
    });

    it('declining the confirm posts nothing', async () => {
      showModal
        .mockResolvedValueOnce({ personId: 'dest-1', name: 'Dest Person', lock: false })
        .mockResolvedValueOnce(false);

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('manual-review-move-entire-btn'));

      await waitFor(() => expect(showModal).toHaveBeenCalledWith(ConfirmModal, expect.anything()));
      expect(resolveFaces).not.toHaveBeenCalled();
    });

    it('choosing a destination and confirming posts ONLY entireCluster — no per-face buckets at all', async () => {
      showModal
        .mockResolvedValueOnce({ personId: 'dest-1', name: 'Dest Person', lock: true })
        .mockResolvedValueOnce(true);

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('manual-review-move-entire-btn'));

      // Exact-equality: the server 400s entireCluster combined with any per-face bucket (moveToPerson/stay/
      // lock/detach/unknown), so this request must carry ONLY personId + entireCluster.
      await waitFor(() => {
        expect(resolveFaces).toHaveBeenCalledTimes(1);
        expect(resolveFaces).toHaveBeenCalledWith({
          faceRepairResolveRequestDto: {
            personId: PERSON_ID,
            entireCluster: { destinationPersonId: 'dest-1' },
          },
        });
      });
    });

    it('refreshes the page (re-fetches metadata + cluster faces) after a successful entire-cluster move', async () => {
      showModal
        .mockResolvedValueOnce({ personId: 'dest-1', name: 'Dest Person', lock: false })
        .mockResolvedValueOnce(true);

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      expect(getFaceRepairPersonMetadata).toHaveBeenCalledTimes(1);
      expect(getFaceRepairClusterFaces).toHaveBeenCalledTimes(1);

      await fireEvent.click(screen.getByTestId('manual-review-move-entire-btn'));

      await waitFor(() => expect(resolveFaces).toHaveBeenCalled());
      await waitFor(() => {
        expect(getFaceRepairPersonMetadata).toHaveBeenCalledTimes(2);
        expect(getFaceRepairClusterFaces).toHaveBeenCalledTimes(2);
      });
    });
  });

  // ==== Emptying a cluster leaves the page (bug: success toast immediately followed by a 404) ====
  // Moving/parking/detaching the last faces out of a cluster leaves nothing to review here. Worse, the server
  // DELETES an emptied cluster that was never named ("Empty-unnamed cleanup" in face-repair.service.ts), so
  // the post-apply refresh chased a person that no longer existed and stacked a "person not found" error toast
  // straight on top of the success one. Both shapes of emptied — deleted, or a named cluster left with zero
  // faces — end the same way: back on the manual review list, success toast intact.
  describe('emptied cluster returns to the manual review list', () => {
    it('leaves without an error state when the refresh 404s because the emptied cluster was deleted', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      vi.mocked(resolveFaces).mockResolvedValueOnce({
        moved: 3,
        declined: 0,
        locked: 0,
        detached: 0,
        unknown: 0,
        skipped: 0,
      });
      const notFound = () => Object.assign(new Error('Person not found'), { status: 404 });
      vi.mocked(getFaceRepairPersonMetadata).mockRejectedValueOnce(notFound());
      vi.mocked(getFaceRepairClusterFaces).mockRejectedValueOnce(notFound());

      showModal.mockResolvedValueOnce({ personId: 'dest-1', name: 'Dest Person', lock: false });
      await fireEvent.click(screen.getByTestId('manual-review-select-all-loaded'));
      await fireEvent.click(screen.getByTestId('manual-review-bulk-move'));
      await waitFor(() => expect(screen.getByTestId('manual-review-apply-btn')).toBeInTheDocument());
      await fireEvent.click(screen.getByTestId('manual-review-apply-btn'));

      await waitFor(() => expect(goto).toHaveBeenCalledWith(Route.faceCleanupPeople()));
      // The success toast still stands — the 404 is the expected shape of "the cluster is gone", not a failure.
      expect(toastManager.primary).toHaveBeenCalledWith(
        expect.stringContaining('admin.face_cleanup_manual_review_apply_summary'),
      );
      expect(toastManager.danger).not.toHaveBeenCalled();
      expect(screen.queryByTestId('manual-review-load-error')).not.toBeInTheDocument();
    });

    it('leaves when a NAMED cluster survives the emptying but comes back with zero faces', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      vi.mocked(resolveFaces).mockResolvedValueOnce({
        moved: 0,
        declined: 0,
        locked: 0,
        detached: 3,
        unknown: 0,
        skipped: 0,
      });
      vi.mocked(getFaceRepairPersonMetadata).mockResolvedValueOnce(makeMetadata({ faceCount: 0 }));
      vi.mocked(getFaceRepairClusterFaces).mockResolvedValueOnce(makeFacesResponse([], 0));
      showModal.mockResolvedValueOnce(true);

      await fireEvent.click(screen.getByTestId('manual-review-select-all-loaded'));
      await fireEvent.click(screen.getByTestId('manual-review-bulk-detach'));
      await waitFor(() => expect(screen.getByTestId('manual-review-apply-btn')).toBeInTheDocument());
      await fireEvent.click(screen.getByTestId('manual-review-apply-btn'));

      await waitFor(() => expect(goto).toHaveBeenCalledWith(Route.faceCleanupPeople()));
      expect(toastManager.danger).not.toHaveBeenCalled();
    });

    it('stays put after a PARTIAL apply, and stops rendering the faces the resolve moved away', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      vi.mocked(resolveFaces).mockResolvedValueOnce({
        moved: 1,
        declined: 0,
        locked: 0,
        detached: 0,
        unknown: 0,
        skipped: 0,
      });
      vi.mocked(getFaceRepairClusterFaces).mockResolvedValueOnce(makeFacesResponse([face('f2'), face('f3')], 2));

      showModal.mockResolvedValueOnce({ personId: 'dest-1', name: 'Dest Person', lock: false });
      await selectTile(0);
      await fireEvent.click(screen.getByTestId('manual-review-bulk-move'));
      await waitFor(() => expect(screen.getByTestId('manual-review-apply-btn')).toBeInTheDocument());
      await fireEvent.click(screen.getByTestId('manual-review-apply-btn'));

      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(2));
      // f1 now belongs to another person. appendFaces is idempotent by assetFaceId, so a refresh that merely
      // appended page 0 back into the populated model would skip every id it already held and leave f1 on
      // screen forever — the refresh has to REPLACE what the page holds, not merge into it.
      expect(tileFor('f1')).toBeNull();
      expect(goto).not.toHaveBeenCalled();
    });
  });

  // ==== Slice 10, Part B — manual actions help modal launcher ====
  // The modal's own content (naming all six actions, the Keep-writes-nothing explanation, the swatch-matches-
  // tile rule, etc.) is covered by FaceActionsHelpModal.spec.ts against REAL i18n — this only proves the page
  // wires a launcher to the RIGHT component, in the right mode.
  describe('Slice 10 — manual actions help modal launcher', () => {
    it('opens FaceActionsHelpModal in manual mode', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('manual-review-help-open'));

      expect(showModal).toHaveBeenCalledWith(FaceActionsHelpModal, expect.objectContaining({ mode: 'manual' }));
    });
  });

  describe('shared dock', () => {
    const renderAndLoad = async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));
    };

    const selectFirstTile = async () => {
      await fireEvent.click(screen.getAllByTestId('face-tile')[0]);
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());
    };

    // M1 — the gap this change closes: manual's bar had no help affordance at all.
    it('offers help from inside the bulk bar, which it never used to', async () => {
      await renderAndLoad();
      await selectFirstTile();

      expect(screen.getByTestId('face-bulk-help')).toBeInTheDocument();
    });

    // M5 — the counterpart to guided's G4.
    it('opens the help modal in manual mode, with manual’s six actions', async () => {
      await renderAndLoad();

      await fireEvent.click(screen.getByTestId('manual-review-help-open'));

      expect(showModal).toHaveBeenCalledWith(
        FaceActionsHelpModal,
        expect.objectContaining({
          mode: 'manual',
          actions: ['keep', 'other', 'lock', 'unknown', 'detach', 'unmark'],
          defaultActionId: 'keep',
        }),
      );
    });

    // M6 — the two modes provably receive different subsets.
    it('asks for neither owner nor stay, and asks for keep and unmark', async () => {
      await renderAndLoad();

      await fireEvent.click(screen.getByTestId('manual-review-help-open'));
      const props = showModal.mock.calls.at(-1)?.[1] as { actions: string[] };

      expect(props.actions).toContain('keep');
      expect(props.actions).toContain('unmark');
      expect(props.actions).not.toContain('owner');
      expect(props.actions).not.toContain('stay');
    });

    // M2
    it('opens the same modal from the grid header as from the bulk bar', async () => {
      await renderAndLoad();

      await fireEvent.click(screen.getByTestId('manual-review-help-open'));
      const fromHeader = showModal.mock.calls.at(-1);

      await selectFirstTile();
      await fireEvent.click(screen.getByTestId('face-bulk-help'));
      const fromBar = showModal.mock.calls.at(-1);

      // `.at(-1)` alone can't tell "the bar's launcher opened its own call" from "the bar's launcher is
      // dead and this is still the header's call" — pin down the call count too.
      expect(showModal).toHaveBeenCalledTimes(2);
      expect(fromBar).toEqual(fromHeader);
    });

    // M3
    it('explains an action on hover', async () => {
      await renderAndLoad();
      await selectFirstTile();

      await fireEvent.mouseEnter(screen.getByTestId('manual-review-bulk-lock'));

      expect(screen.getByTestId('face-bulk-popover')).toHaveTextContent('admin.face_cleanup_action_lock_tip');
    });

    // M4 — the harmonisation, asserted rather than assumed.
    it('labels its move button with the same key guided uses', async () => {
      await renderAndLoad();
      await selectFirstTile();

      expect(screen.getByTestId('manual-review-bulk-move')).toHaveTextContent('admin.face_cleanup_review_bulk_other');
    });

    // M7 — F2 at the page level. Icon is stubbed here, so this asserts presence, not identity.
    it('keeps a glyph on Unmark after the dock swap', async () => {
      await renderAndLoad();
      await selectFirstTile();

      expect(screen.getByTestId('manual-review-bulk-unmark').firstElementChild).not.toBeNull();
    });

    // R11 at the level where testids actually live.
    it('gives every dock action a distinct testid', async () => {
      await renderAndLoad();
      await selectFirstTile();

      for (const id of [
        'manual-review-bulk-move',
        'manual-review-bulk-lock',
        'manual-review-bulk-unknown',
        'manual-review-bulk-detach',
        'manual-review-bulk-unmark',
      ]) {
        expect(screen.getAllByTestId(id)).toHaveLength(1);
      }
    });
  });

  it('renders the full breadcrumb trail down to the person', async () => {
    vi.mocked(getFaceRepairPersonMetadata).mockResolvedValue(makeMetadata({ name: 'Aurelia' }));

    render(Page, { props: { data: makePageData() } });

    const trail = () => within(screen.getByTestId('breadcrumbs'));

    await waitFor(() => {
      expect(trail().getByText('Aurelia')).toBeInTheDocument();
    });

    expect(trail().getByRole('link', { name: 'admin.face_cleanup' })).toHaveAttribute('href', Route.faceCleanup());
    expect(trail().getByRole('link', { name: 'admin.face_cleanup_mode_manual' })).toHaveAttribute(
      'href',
      Route.faceCleanupPeople(),
    );
    // Two links and an unlinked leaf — the leaf must never be clickable.
    expect(trail().getAllByRole('link')).toHaveLength(2);
  });

  it('shows the unnamed fallback in the trail until metadata resolves', async () => {
    vi.mocked(getFaceRepairPersonMetadata).mockResolvedValue(makeMetadata({ name: 'Aurelia' }));

    render(Page, { props: { data: makePageData() } });

    // Accepted pre-existing behaviour: the leaf is the fallback before the fetch resolves, never blank.
    expect(within(screen.getByTestId('breadcrumbs')).getByText('admin.face_cleanup_unnamed')).toBeInTheDocument();

    await waitFor(() => {
      expect(within(screen.getByTestId('breadcrumbs')).getByText('Aurelia')).toBeInTheDocument();
    });
  });
});
