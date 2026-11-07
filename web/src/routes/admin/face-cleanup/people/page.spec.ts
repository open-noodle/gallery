import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { Route } from '#lib/route.ts';
import { manualReviewOwnerId } from '#lib/stores/face-cleanup-manual-review.store.ts';
import { factory } from '#test/unit/factories.ts';
import { getFaceRepairOwnerPeople, type FaceRepairOwnerPeopleResponseDto } from '@immich/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { getAll } from '../dom-queries.test-helpers';
import Page from './+page.svelte';

// Manual people browser at /admin/face-cleanup/people (Slice 6, §6.3 of
// specs/2026-07-23-manual-face-review-mode-design.md). Owner selector →
// paginated people grid via getFaceRepairOwnerPeople(ownerId, {query, page}). Covers plan Step 1's
// 12 cases (manual face review, slice 6).

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getFaceRepairOwnerPeople: vi.fn(),
  };
});

vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  const noop = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return {
    ...mod,
    // Stub Icon to a no-op (matches the sibling face-cleanup specs).
    Icon: noop.default,
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
      run({ url: new URL('http://localhost/admin/face-cleanup/people') });
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

vi.mock('#lib/components/layouts/AdminPageLayout.svelte', async () => {
  const { default: stub } = await import('#lib/gallery/__mocks__/admin-page-layout.stub.svelte');
  return { default: stub };
});

// Face crops must go through the admin-gated, join-free face-thumbnail route (the same helper the guided
// review page uses) — never the user-scoped /people/:id/thumbnail route, which 404s for people the admin
// does not own.
vi.mock('#lib/utils/people-utils.js', () => ({
  getAdminFaceThumbnailUrl: (assetFaceId: string) => `/api/admin/face-repair/faces/${assetFaceId}/thumbnail`,
}));

// Pagination is scroll-driven (InfiniteScrollSentinel): a controllable IntersectionObserver lets the paging
// test fire the sentinel explicitly, and getBoundingClientRect is parked below the fold in beforeEach so the
// visibility fallback never auto-loads in the other tests.
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

// ---- helpers ----

type OwnerPerson = FaceRepairOwnerPeopleResponseDto['people'][number];

const makeUser = (id: string, name: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  profileImagePath: '',
  avatarColor: 'primary',
  profileChangedAt: new Date().toISOString(),
});

const makePerson = (over: Partial<OwnerPerson> = {}): OwnerPerson => ({
  id: 'person-1',
  name: 'Alice',
  faceCount: 12,
  thumbnailFaceId: 'face-1',
  ...over,
});

const makeResponse = (
  people: OwnerPerson[],
  over: Partial<{ total: number; hasMore: boolean }> = {},
): FaceRepairOwnerPeopleResponseDto => ({
  people,
  total: over.total ?? people.length,
  hasMore: over.hasMore ?? false,
});

const makePageData = (users: ReturnType<typeof makeUser>[]) => ({
  users,
  meta: { title: 'Manual review' },
});

describe('+page.svelte (manual face-cleanup people browser)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    observerInstances.length = 0;
    vi.stubGlobal('IntersectionObserver', ControllableIntersectionObserver);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight + 1,
    } as DOMRect);
    vi.useFakeTimers();
    // An id that never coincides with a test's mocked owner ids (they use 'solo', 'u1', 'u2', 'u3'), so
    // pre-existing tests keep exercising the alphabetical-fallback path unchanged; tests for the "defaults
    // to my own account" behavior override this explicitly.
    authManager.setUser(factory.user({ id: 'current-admin-not-in-owner-list' }));
    localStorage.clear();
    manualReviewOwnerId.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authManager.reset();
  });

  // ---- 1. owner selector lists users from the load data ----
  it('owner selector lists every user from the load data', async () => {
    const users = [makeUser('u1', 'Alice Owner'), makeUser('u2', 'Bob Owner'), makeUser('u3', 'Carol Owner')];
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(makeResponse([]));

    await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);

    const select = page.getByTestId('owner-select').element();
    const options = getAll(page.elementLocator(select).getByRole('option'));
    expect(options.map((o) => o.textContent)).toEqual(['Alice Owner', 'Bob Owner', 'Carol Owner']);
  });

  // ---- 2. single-user instance auto-selects (no pointless "pick an owner" step) ----
  describe('single-user instance', () => {
    it('auto-selects the owner and immediately lists their people, without an owner selector', async () => {
      const users = [makeUser('solo', 'Solo Admin')];
      vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(makeResponse([makePerson({ id: 'p1', name: 'Alice' })]));

      await render(Page, { props: { data: makePageData(users) } });
      await vi.advanceTimersByTimeAsync(0);

      await vi.waitFor(() => {
        expect(getFaceRepairOwnerPeople).toHaveBeenCalledWith({ ownerId: 'solo', page: 0, query: undefined });
      });
      expect(page.getByTestId('owner-select').query()).not.toBeInTheDocument();
      expect(page.getByText('Alice', { exact: true }).element()).toBeInTheDocument();
    });
  });

  // ---- 3. multi-user shows the selector and lists the first/selected owner's people ----
  it('multi-user shows the selector and lists the first owner people automatically', async () => {
    const users = [makeUser('u1', 'Alice Owner'), makeUser('u2', 'Bob Owner')];
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(makeResponse([makePerson({ id: 'p1', name: 'Zed' })]));

    await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);

    expect(page.getByTestId('owner-select').element()).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(getFaceRepairOwnerPeople).toHaveBeenCalledWith({ ownerId: 'u1', page: 0, query: undefined });
    });
    expect(page.getByText('Zed', { exact: true }).element()).toBeInTheDocument();
  });

  // ---- 4. grid renders name, faceCount, and a thumbnail for each row ----
  it('renders name, faceCount, and a thumbnail crop for each row', async () => {
    const users = [makeUser('solo', 'Solo Admin')];
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(
      makeResponse([makePerson({ id: 'p1', name: 'Alice', faceCount: 42, thumbnailFaceId: 'face-42' })]),
    );

    await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      expect(page.getByText('Alice', { exact: true }).element()).toBeInTheDocument();
    });
    expect(page.getByText(/42/).element()).toBeInTheDocument();
    const img = page.getByTestId('person-tile-thumb-p1').element();
    expect(img).toHaveAttribute('src', '/api/admin/face-repair/faces/face-42/thumbnail');
  });

  // ---- 5. unnamed person renders the fallback label ----
  it('renders the fallback label for an unnamed person instead of an empty cell', async () => {
    const users = [makeUser('solo', 'Solo Admin')];
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(
      makeResponse([makePerson({ id: 'p1', name: '', faceCount: 5 })]),
    );

    await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      expect(page.getByTestId('person-tile-p1').element()).toBeInTheDocument();
    });
    expect(
      page
        .elementLocator(page.getByTestId('person-tile-p1').element())
        .getByText('admin.face_cleanup_unnamed', { exact: true })
        .element(),
    ).toBeInTheDocument();
  });

  // ---- 6. null thumbnailFaceId renders a placeholder, not a broken image ----
  it('renders a placeholder (not a broken image) when thumbnailFaceId is null', async () => {
    const users = [makeUser('solo', 'Solo Admin')];
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(
      makeResponse([makePerson({ id: 'p1', name: 'Alice', thumbnailFaceId: null })]),
    );

    await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      expect(page.getByTestId('person-tile-p1').element()).toBeInTheDocument();
    });
    expect(page.getByTestId('person-tile-placeholder-p1').element()).toBeInTheDocument();
    expect(page.getByTestId('person-tile-thumb-p1').query()).not.toBeInTheDocument();
  });

  // ---- 7. search re-fetches with query and renders the filtered rows ----
  it('search re-fetches with the query and renders the filtered rows', async () => {
    const users = [makeUser('solo', 'Solo Admin')];
    vi.mocked(getFaceRepairOwnerPeople)
      .mockResolvedValueOnce(makeResponse([makePerson({ id: 'p1', name: 'Alice' })]))
      .mockResolvedValueOnce(makeResponse([makePerson({ id: 'p2', name: 'Zoe' })]));

    await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(page.getByText('Alice', { exact: true }).element()).toBeInTheDocument());

    const input = page.getByTestId('people-search-input').element();
    await userEvent.fill(input, 'zoe');
    await vi.advanceTimersByTimeAsync(500);

    await vi.waitFor(() => {
      expect(getFaceRepairOwnerPeople).toHaveBeenLastCalledWith({ ownerId: 'solo', page: 0, query: 'zoe' });
    });
    expect(page.getByText('Zoe', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByText('Alice', { exact: true }).query()).not.toBeInTheDocument();
  });

  // ---- 8. "no results" is distinct from "this owner has no people" ----
  describe('empty states', () => {
    it('shows the owner-empty state when the owner has no people at all (no query)', async () => {
      const users = [makeUser('solo', 'Solo Admin')];
      vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(makeResponse([]));

      await render(Page, { props: { data: makePageData(users) } });
      await vi.advanceTimersByTimeAsync(0);

      await vi.waitFor(() => {
        expect(page.getByTestId('people-empty-owner').element()).toBeInTheDocument();
      });
      expect(page.getByTestId('people-no-results').query()).not.toBeInTheDocument();
    });

    it('shows the no-results state when a query returns nothing, distinct from the owner-empty state', async () => {
      const users = [makeUser('solo', 'Solo Admin')];
      vi.mocked(getFaceRepairOwnerPeople)
        .mockResolvedValueOnce(makeResponse([makePerson({ id: 'p1', name: 'Alice' })]))
        .mockResolvedValueOnce(makeResponse([]));

      await render(Page, { props: { data: makePageData(users) } });
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(page.getByText('Alice', { exact: true }).element()).toBeInTheDocument());

      const input = page.getByTestId('people-search-input').element();
      await userEvent.fill(input, 'nobody');
      await vi.advanceTimersByTimeAsync(500);

      await vi.waitFor(() => {
        expect(page.getByTestId('people-no-results').element()).toBeInTheDocument();
      });
      expect(page.getByTestId('people-empty-owner').query()).not.toBeInTheDocument();
    });
  });

  // ---- 9. pagination appends, never replaces — scroll-driven, no button ----
  it('appends the next page when the infinite-scroll sentinel scrolls into view, instead of replacing', async () => {
    const users = [makeUser('solo', 'Solo Admin')];
    vi.mocked(getFaceRepairOwnerPeople)
      .mockResolvedValueOnce(makeResponse([makePerson({ id: 'p1', name: 'Alice' })], { hasMore: true, total: 2 }))
      .mockResolvedValueOnce(makeResponse([makePerson({ id: 'p2', name: 'Bob' })], { hasMore: false, total: 2 }));

    await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(page.getByText('Alice', { exact: true }).element()).toBeInTheDocument());

    // No "Load more" button — the sentinel entering the viewport is what loads the next page.
    expect(page.getByTestId('people-load-more').query()).not.toBeInTheDocument();
    await vi.waitFor(() => expect(observerInstances.length).toBeGreaterThan(0));
    const observer = observerInstances.at(-1)!;
    observer.trigger({ target: observer.observedTarget!, isIntersecting: true });

    await vi.waitFor(() => {
      expect(getFaceRepairOwnerPeople).toHaveBeenLastCalledWith({ ownerId: 'solo', page: 1, query: undefined });
    });
    // Appended, not replaced: both rows are present.
    await expect.element(page.getByText('Bob', { exact: true })).toBeInTheDocument();
    expect(page.getByText('Alice', { exact: true }).element()).toBeInTheDocument();
  });

  // ---- F27: a failed later page must not wipe the pages already loaded, or reset Retry to page 0 ----
  // S11.14: page 3 (requestPage index 2) failing keeps pages 1-2 rendered and offers a retry for page 3 only.
  it('S11.14/F27: a failed load-more page keeps earlier pages rendered and offers an inline retry for that page only', async () => {
    const users = [makeUser('solo', 'Solo Admin')];
    vi.mocked(getFaceRepairOwnerPeople)
      .mockResolvedValueOnce(makeResponse([makePerson({ id: 'p1', name: 'Alice' })], { hasMore: true, total: 3 })) // page 0 (page 1)
      .mockResolvedValueOnce(makeResponse([makePerson({ id: 'p2', name: 'Bob' })], { hasMore: true, total: 3 })) // page 1 (page 2)
      .mockRejectedValueOnce(new Error('network blip')) // page 2 (page 3) fails
      .mockResolvedValueOnce(makeResponse([makePerson({ id: 'p3', name: 'Cara' })], { hasMore: false, total: 3 })); // retry succeeds

    await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(page.getByText('Alice', { exact: true }).element()).toBeInTheDocument());

    // Load page 2 (Bob).
    await vi.waitFor(() => expect(observerInstances.length).toBeGreaterThan(0));
    observerInstances.at(-1)!.trigger({ target: observerInstances.at(-1)!.observedTarget!, isIntersecting: true });
    await vi.waitFor(() => expect(page.getByText('Bob', { exact: true }).element()).toBeInTheDocument());

    // Load page 3 — this one fails.
    await vi.waitFor(() => expect(observerInstances.length).toBeGreaterThan(0));
    observerInstances.at(-1)!.trigger({ target: observerInstances.at(-1)!.observedTarget!, isIntersecting: true });

    await vi.waitFor(() => expect(page.getByTestId('people-load-more-error').element()).toBeInTheDocument());
    // The full-page error state must NOT take over — that would hide pages 1-2, which are still valid.
    expect(page.getByTestId('people-load-error').query()).not.toBeInTheDocument();
    expect(page.getByTestId('people-grid').element()).toBeInTheDocument();
    expect(page.getByText('Alice', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByText('Bob', { exact: true }).element()).toBeInTheDocument();

    await userEvent.click(page.getByTestId('people-load-more-error-retry').element());

    // Retry re-requests page 3 (index 2) — NOT page 0 — and appends onto the existing pages.
    await vi.waitFor(() => {
      expect(getFaceRepairOwnerPeople).toHaveBeenLastCalledWith({ ownerId: 'solo', page: 2, query: undefined });
    });
    await vi.waitFor(() => expect(page.getByText('Cara', { exact: true }).element()).toBeInTheDocument());
    expect(page.getByText('Alice', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByText('Bob', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByTestId('people-load-more-error').query()).not.toBeInTheDocument();
  });

  // S11.15 (pin): a failed FIRST page (unlike a failed later page above) still renders the full-page error
  // state — there is nothing else to show. This is the existing "load error is distinct from empty" coverage
  // (test #11 below) re-asserted here under its own name; mutated/reverted in the implementation pass to prove
  // it can fail once page-scoped error state exists.
  it('S11.15 (pin): page 1 failing still renders the full-page error state, not the inline load-more retry', async () => {
    const users = [makeUser('solo', 'Solo Admin')];
    vi.mocked(getFaceRepairOwnerPeople).mockRejectedValueOnce(new Error('network down'));

    await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => expect(page.getByTestId('people-load-error').element()).toBeInTheDocument());
    expect(page.getByTestId('people-load-more-error').query()).not.toBeInTheDocument();
    expect(page.getByTestId('people-grid').query()).not.toBeInTheDocument();
  });

  // ---- defaults to the admin's own account, not whichever owner sorts first alphabetically ----
  it("defaults to the admin's own account when it is among the owners, instead of the alphabetically-first owner", async () => {
    const users = [makeUser('u1', 'Alice Owner'), makeUser('u2', 'Bob Owner')];
    authManager.setUser(factory.user({ id: 'u2' }));
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(makeResponse([makePerson({ id: 'p1', name: 'From Bob' })]));

    await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      expect(getFaceRepairOwnerPeople).toHaveBeenCalledWith({ ownerId: 'u2', page: 0, query: undefined });
    });
    expect(page.getByTestId('owner-select').element()).toHaveValue('u2');
  });

  // ---- the owner selection survives a remount (e.g. reviewing a person and navigating back) ----
  it('remembers the previously selected owner across a remount instead of resetting to the default', async () => {
    const users = [makeUser('u1', 'Alice Owner'), makeUser('u2', 'Bob Owner')];
    vi.mocked(getFaceRepairOwnerPeople)
      .mockResolvedValueOnce(makeResponse([makePerson({ id: 'p1', name: 'From U1' })]))
      .mockResolvedValueOnce(makeResponse([makePerson({ id: 'p2', name: 'From U2' })]));

    const { unmount } = await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(page.getByText('From U1', { exact: true }).element()).toBeInTheDocument());

    await userEvent.selectOptions(page.getByTestId('owner-select').element(), 'u2');
    await vi.waitFor(() => expect(page.getByText('From U2', { exact: true }).element()).toBeInTheDocument());

    // Simulates navigating away (e.g. into a person's review page) and back: the page fully remounts,
    // since /people and /people/[personId] share no layout and thus no component state.
    await unmount();
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValueOnce(
      makeResponse([makePerson({ id: 'p2', name: 'From U2' })]),
    );
    await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      expect(getFaceRepairOwnerPeople).toHaveBeenLastCalledWith({ ownerId: 'u2', page: 0, query: undefined });
    });
    expect(page.getByTestId('owner-select').element()).toHaveValue('u2');
  });

  // ---- switching owner resets page to 0 and clears the list (no interleaving) ----
  it('switching owner resets the list instead of interleaving rows from two owners', async () => {
    const users = [makeUser('u1', 'Alice Owner'), makeUser('u2', 'Bob Owner')];
    vi.mocked(getFaceRepairOwnerPeople)
      .mockResolvedValueOnce(makeResponse([makePerson({ id: 'p1', name: 'From U1' })]))
      .mockResolvedValueOnce(makeResponse([makePerson({ id: 'p2', name: 'From U2' })]));

    await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(page.getByText('From U1', { exact: true }).element()).toBeInTheDocument());

    const select = page.getByTestId('owner-select').element();
    await userEvent.selectOptions(select, 'u2');

    await vi.waitFor(() => {
      expect(getFaceRepairOwnerPeople).toHaveBeenLastCalledWith({ ownerId: 'u2', page: 0, query: undefined });
    });
    await vi.waitFor(() => expect(page.getByText('From U2', { exact: true }).element()).toBeInTheDocument());
    // The first owner's row must be gone, not interleaved with the second owner's.
    expect(page.getByText('From U1', { exact: true }).query()).not.toBeInTheDocument();
  });

  // ---- 10. click a person navigates to /admin/face-cleanup/people/{id} ----
  it('clicking a person tile links to the manual review route for that person', async () => {
    const users = [makeUser('solo', 'Solo Admin')];
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(makeResponse([makePerson({ id: 'p1', name: 'Alice' })]));

    await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => expect(page.getByText('Alice', { exact: true }).element()).toBeInTheDocument());
    const tile = page.getByTestId('person-tile-p1').element();
    expect(tile).toHaveAttribute('href', Route.viewFaceCleanupManualPerson({ id: 'p1' }));
  });

  // ---- 11. load error is distinct from empty ----
  it('renders a load-error state with Retry, distinct from the empty state; Retry re-fetches', async () => {
    const users = [makeUser('solo', 'Solo Admin')];
    vi.mocked(getFaceRepairOwnerPeople)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(makeResponse([makePerson({ id: 'p1', name: 'Alice' })]));

    await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      expect(page.getByTestId('people-load-error').element()).toBeInTheDocument();
    });
    expect(page.getByTestId('people-empty-owner').query()).not.toBeInTheDocument();

    await userEvent.click(page.getByTestId('people-load-error-retry').element());

    await vi.waitFor(() => {
      expect(page.getByText('Alice', { exact: true }).element()).toBeInTheDocument();
    });
    expect(page.getByTestId('people-load-error').query()).not.toBeInTheDocument();
  });

  // ---- 12. hidden / non-person-type rows: grid renders exactly what the endpoint returns ----
  it('renders exactly what getFaceRepairOwnerPeople returns, with no client-side filtering', async () => {
    const users = [makeUser('solo', 'Solo Admin')];
    // Rows the endpoint could plausibly return that a naive implementation might be tempted to drop —
    // zero faceCount, empty name, an unexpected extra property. This slice adds no filtering: all must render.
    const weirdRows = [
      makePerson({ id: 'p1', name: '', faceCount: 0, thumbnailFaceId: null }),
      { ...makePerson({ id: 'p2', name: 'Ghost', faceCount: 3 }), isHidden: true } as unknown as OwnerPerson,
      makePerson({ id: 'p3', name: 'Normal', faceCount: 9 }),
    ];
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(makeResponse(weirdRows));

    await render(Page, { props: { data: makePageData(users) } });
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      expect(page.getByTestId('person-tile-p3').element()).toBeInTheDocument();
    });
    expect(page.getByTestId('person-tile-p1').element()).toBeInTheDocument();
    expect(page.getByTestId('person-tile-p2').element()).toBeInTheDocument();
    expect(page.getByTestId('person-tile-p3').element()).toBeInTheDocument();
  });

  // ---- 13. breadcrumbs ----
  it('renders a breadcrumb trail back to the face cleanup landing page', async () => {
    await render(Page, { props: { data: makePageData([makeUser('u1', 'Alice')]) } });

    const trail = page.getByTestId('breadcrumbs');

    const root = trail.getByRole('link', { name: 'admin.face_cleanup', exact: true }).element();
    expect(root).toHaveAttribute('href', Route.faceCleanup());

    expect(trail.getByText('admin.face_cleanup_mode_manual', { exact: true }).element()).toBeInTheDocument();
    expect(getAll(trail.getByRole('link'))).toHaveLength(1);
  });
});
