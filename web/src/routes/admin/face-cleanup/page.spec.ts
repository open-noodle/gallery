import { Route } from '#lib/route.ts';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';

// The chooser at /admin/face-cleanup: two equal-weight cards (guided scan vs. manual review), covering
// the two presentations (first visit / returning) and all five scan states from §6.2 of
// specs/2026-07-23-manual-face-review-mode-design.md. Assertions key off stable
// testids (chooser-card-guided / chooser-card-manual / chooser-guided-cta / chooser-manual-cta) so they
// don't depend on copy.

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
      run({ url: new URL('http://localhost/admin/face-cleanup') });
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

// ---- helpers ----

const makeTotals = (over: Partial<{ flaggedFaces: number; affectedPersons: number }> = {}) => ({
  eligibleFaces: 1000,
  flaggedFaces: 200,
  toRepair: 50,
  reviewOnlyFaces: 150,
  reviewOnlyPersons: 10,
  affectedPersons: 12,
  reviewOnlyByReason: { overCap: 5, badTarget: 3, unAttributable: 2 },
  ...over,
});

const makeScan = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'scan-1',
  status: 'completed' as const,
  progress: { scanned: 1000, total: 1000 },
  totals: makeTotals(),
  persons: [],
  error: null,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  ...over,
});

const makeUser = (id: string) => ({
  id,
  name: `User ${id}`,
  email: `${id}@example.com`,
  profileImagePath: '',
  avatarColor: 'primary',
  profileChangedAt: new Date().toISOString(),
});

const makePageData = (over: { scan?: unknown; users?: unknown[] } = {}) => ({
  users: over.users ?? [],
  scan: over.scan ?? null,
  meta: { title: 'Face cleanup' },
});

describe('+page.svelte (face cleanup chooser)', () => {
  // L1–L3, L7. The intro used to render only on a first visit, so every return visit — which is every visit
  // after the first scan — showed two cards and no explanation at all. It is now unconditional.
  describe('the explainer', () => {
    const SCAN_STATES = [
      ['no scan yet', null],
      ['pending', makeScan({ status: 'pending' })],
      ['running', makeScan({ status: 'running' })],
      ['failed', makeScan({ status: 'failed' })],
      ['completed', makeScan()],
    ] as const;

    it.each(SCAN_STATES)('explains what the page is for — %s', async (_label, scan) => {
      await render(Page, { props: { data: makePageData({ scan }) } });

      expect(page.getByText('admin.face_cleanup_intro_lead', { exact: true }).element()).toBeInTheDocument();
    });

    // L4
    it('covers the scan, the per-face actions, and the scan-free manual route', async () => {
      await render(Page, { props: { data: makePageData({ scan: makeScan() }) } });

      for (const key of [
        'admin.face_cleanup_intro_scan_title',
        'admin.face_cleanup_intro_scan_body',
        'admin.face_cleanup_intro_actions_title',
        'admin.face_cleanup_intro_actions_body',
        'admin.face_cleanup_intro_manual_title',
        'admin.face_cleanup_intro_manual_body',
      ]) {
        expect(page.getByText(key, { exact: true }).element()).toBeInTheDocument();
      }
    });

    // L5 — read before the choice it informs.
    it('is read before the two cards', async () => {
      await render(Page, { props: { data: makePageData({ scan: makeScan() }) } });

      const intro = page.getByTestId('face-cleanup-intro').element();
      const guided = page.getByTestId('chooser-card-guided').element();

      expect(intro.compareDocumentPosition(guided) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // L7 — the replaced string is gone, not merely hidden.
    it.each(SCAN_STATES)('no longer renders the retired first-visit copy — %s', async (_label, scan) => {
      await render(Page, { props: { data: makePageData({ scan }) } });

      expect(
        page.getByText('admin.face_cleanup_mode_first_visit_intro', { exact: true }).query(),
      ).not.toBeInTheDocument();
    });
  });

  // ---- 1. first visit (no scan has ever run) ----
  describe('first visit (scan = null)', () => {
    it('guided card shows "needs a scan first" and a Run first scan action to the scan dashboard', async () => {
      await render(Page, { props: { data: makePageData({ scan: null }) } });

      const guided = page.getByTestId('chooser-card-guided').element();
      expect(guided).toMatchTextContent('admin.face_cleanup_mode_needs_scan');

      const cta = page.getByTestId('chooser-guided-cta').element();
      expect(cta).toMatchTextContent('admin.face_cleanup_mode_run_first_scan');
      expect(cta).toHaveAttribute('href', Route.faceCleanupScan());
    });

    it('manual card shows "no scan needed", is enabled, and links to the people browser', async () => {
      await render(Page, { props: { data: makePageData({ scan: null }) } });

      const manual = page.getByTestId('chooser-card-manual').element();
      expect(manual).toMatchTextContent('admin.face_cleanup_mode_manual_no_scan_needed');
      expect(manual).not.toHaveAttribute('aria-disabled', 'true');

      const cta = page.getByTestId('chooser-manual-cta').element();
      expect(cta).toMatchTextContent('admin.face_cleanup_mode_browse_people');
      expect(cta).toHaveAttribute('href', Route.faceCleanupPeople());
      expect(cta).not.toHaveAttribute('aria-disabled', 'true');
      expect(cta).not.toBeDisabled();
    });
  });

  // ---- 2. returning, completed, flagged > 0 ----
  describe('returning, completed, flagged > 0', () => {
    it('guided card shows the flagged and affected-people counts, with a Continue action', async () => {
      await render(Page, {
        props: {
          data: makePageData({
            scan: makeScan({ totals: makeTotals({ flaggedFaces: 42, affectedPersons: 7 }) }),
          }),
        },
      });

      const guided = page.getByTestId('chooser-card-guided').element();
      expect(guided).toMatchTextContent('42');
      expect(guided).toMatchTextContent('admin.face_cleanup_stat_flagged_sub');

      const cta = page.getByTestId('chooser-guided-cta').element();
      expect(cta).toMatchTextContent('admin.face_cleanup_mode_continue');
      expect(cta).toHaveAttribute('href', Route.faceCleanupScan());
    });

    it('manual card shows the user count', async () => {
      await render(Page, {
        props: {
          data: makePageData({ scan: makeScan(), users: [makeUser('u1'), makeUser('u2'), makeUser('u3')] }),
        },
      });

      const manual = page.getByTestId('chooser-card-manual').element();
      expect(manual).toMatchTextContent('admin.face_cleanup_mode_manual_user_count');
    });
  });

  // ---- 3. running: the load-bearing assertion of this slice ----
  describe('scan running', () => {
    const runningScan = () =>
      makeScan({ status: 'running', progress: { scanned: 400, total: 1000 }, totals: null, finishedAt: null });

    it('guided card shows progress and a View progress action', async () => {
      await render(Page, { props: { data: makePageData({ scan: runningScan() }) } });

      const guided = page.getByTestId('chooser-card-guided').element();
      expect(guided).toMatchTextContent('admin.face_cleanup_scan_running');
      expect(guided).toMatchTextContent('400');

      const cta = page.getByTestId('chooser-guided-cta').element();
      expect(cta).toMatchTextContent('admin.face_cleanup_mode_view_progress');
      expect(cta).toHaveAttribute('href', Route.faceCleanupScan());
    });

    it('manual card is disabled — not a working link — and explains the scan conflict', async () => {
      await render(Page, { props: { data: makePageData({ scan: runningScan() }) } });

      const manual = page.getByTestId('chooser-card-manual').element();
      expect(manual).toMatchTextContent('admin.face_cleanup_mode_manual_blocked_scanning');
      expect(manual).toHaveAttribute('aria-disabled', 'true');

      const cta = page.getByTestId('chooser-manual-cta').element();
      expect(cta).not.toHaveAttribute('href');
      expect(cta).toHaveAttribute('aria-disabled', 'true');
      expect(cta).toBeDisabled();
    });

    it('pending status is also treated as running for the manual-card block', async () => {
      await render(Page, {
        props: {
          data: makePageData({ scan: makeScan({ status: 'pending', progress: null, totals: null, finishedAt: null }) }),
        },
      });

      const cta = page.getByTestId('chooser-manual-cta').element();
      expect(cta).not.toHaveAttribute('href');
      expect(cta).toBeDisabled();
    });
  });

  // ---- 4. completed, 0 flagged ----
  it('completed + 0 flagged: guided card shows the green "nothing flagged" state and a Re-scan action', async () => {
    await render(Page, {
      props: {
        data: makePageData({
          scan: makeScan({ totals: makeTotals({ flaggedFaces: 0, affectedPersons: 0 }) }),
        }),
      },
    });

    const guided = page.getByTestId('chooser-card-guided').element();
    expect(guided).toMatchTextContent('admin.face_cleanup_mode_nothing_flagged');

    const cta = page.getByTestId('chooser-guided-cta').element();
    expect(cta).toMatchTextContent('admin.face_cleanup_rescan');
    expect(cta).toHaveAttribute('href', Route.faceCleanupScan());

    // Not blocked: only a RUNNING scan disables manual review.
    expect(page.getByTestId('chooser-manual-cta').element()).toHaveAttribute('href', Route.faceCleanupPeople());
  });

  // ---- 5. failed ----
  it('failed scan: guided card shows the red error line and a View details action', async () => {
    await render(Page, {
      props: {
        data: makePageData({
          scan: makeScan({ status: 'failed', totals: null, progress: null, error: 'boom' }),
        }),
      },
    });

    const guided = page.getByTestId('chooser-card-guided').element();
    expect(guided).toMatchTextContent('admin.face_cleanup_scan_failed');

    const cta = page.getByTestId('chooser-guided-cta').element();
    expect(cta).toMatchTextContent('admin.face_cleanup_mode_view_details');
    expect(cta).toHaveAttribute('href', Route.faceCleanupScan());

    // A failed scan is not a RUNNING scan: manual review must stay reachable.
    expect(page.getByTestId('chooser-manual-cta').element()).toHaveAttribute('href', Route.faceCleanupPeople());
  });

  // ---- 6. equal weight, no recommendation ----
  it('renders both cards as equal-weight columns in one grid, with no "recommended" marker on either', async () => {
    await render(Page, { props: { data: makePageData({ scan: makeScan() }) } });

    const guided = page.getByTestId('chooser-card-guided').element();
    const manual = page.getByTestId('chooser-card-manual').element();

    expect(guided.parentElement).not.toBeNull();
    expect(guided.parentElement).toBe(manual.parentElement);
    expect(guided.parentElement).toHaveClass('lg:grid-cols-2');

    expect(page.getByText(/recommended/i).query()).not.toBeInTheDocument();
    expect(page.getByTestId(/recommended/i).query()).not.toBeInTheDocument();
  });

  // ---- 7. destinations ----
  it('guided card always links to the scan dashboard and manual card to the people browser', async () => {
    await render(Page, { props: { data: makePageData({ scan: makeScan() }) } });

    expect(page.getByTestId('chooser-guided-cta').element()).toHaveAttribute('href', Route.faceCleanupScan());
    expect(page.getByTestId('chooser-manual-cta').element()).toHaveAttribute('href', Route.faceCleanupPeople());
  });

  // ---- 8. breadcrumbs ----
  it('renders a single breadcrumb that does not link to itself', async () => {
    await render(Page, { props: { data: makePageData() } });

    const trail = page.getByTestId('breadcrumbs');

    // Present, and NOT a link. Written this way rather than as `getByRole('link')` matching nothing, which
    // would also pass if the crumb had vanished entirely — the failure this is meant to catch.
    expect(trail.getByText('admin.face_cleanup', { exact: true }).element()).toBeInTheDocument();
    expect(trail.getByRole('link').elements()).toHaveLength(0);
  });
});
