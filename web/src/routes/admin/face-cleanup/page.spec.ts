import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { Route } from '$lib/route';
import Page from './+page.svelte';

// The chooser at /admin/face-cleanup: two equal-weight cards (guided scan vs. manual review), covering
// the two presentations (first visit / returning) and all five scan states from §6.2 of
// specs/2026-07-23-manual-face-review-mode-design.md. Assertions key off stable
// testids (chooser-card-guided / chooser-card-manual / chooser-guided-cta / chooser-manual-cta) so they
// don't depend on copy.

vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  const noop = await import('@test-data/mocks/noop-component.svelte');
  return {
    ...mod,
    // Stub Icon to a no-op to avoid undefined-path errors in happy-dom (matches the sibling face-cleanup specs).
    Icon: noop.default,
  };
});

// Mock svelte-i18n: return the key as the translation (matches the sibling face-cleanup specs).
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

vi.mock('$lib/components/layouts/AdminPageLayout.svelte', async () => {
  const { default: stub } = await import('@test-data/mocks/admin-page-layout.stub.svelte');
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

    it.each(SCAN_STATES)('explains what the page is for — %s', (_label, scan) => {
      render(Page, { props: { data: makePageData({ scan }) } });

      expect(screen.getByText('admin.face_cleanup_intro_lead')).toBeInTheDocument();
    });

    // L4
    it('covers the scan, the per-face actions, and the scan-free manual route', () => {
      render(Page, { props: { data: makePageData({ scan: makeScan() }) } });

      for (const key of [
        'admin.face_cleanup_intro_scan_title',
        'admin.face_cleanup_intro_scan_body',
        'admin.face_cleanup_intro_actions_title',
        'admin.face_cleanup_intro_actions_body',
        'admin.face_cleanup_intro_manual_title',
        'admin.face_cleanup_intro_manual_body',
      ]) {
        expect(screen.getByText(key)).toBeInTheDocument();
      }
    });

    // L5 — read before the choice it informs.
    it('is read before the two cards', () => {
      render(Page, { props: { data: makePageData({ scan: makeScan() }) } });

      const intro = screen.getByTestId('face-cleanup-intro');
      const guided = screen.getByTestId('chooser-card-guided');

      expect(intro.compareDocumentPosition(guided) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // L7 — the replaced string is gone, not merely hidden.
    it.each(SCAN_STATES)('no longer renders the retired first-visit copy — %s', (_label, scan) => {
      render(Page, { props: { data: makePageData({ scan }) } });

      expect(screen.queryByText('admin.face_cleanup_mode_first_visit_intro')).not.toBeInTheDocument();
    });
  });

  // ---- 1. first visit (no scan has ever run) ----
  describe('first visit (scan = null)', () => {
    it('guided card shows "needs a scan first" and a Run first scan action to the scan dashboard', () => {
      render(Page, { props: { data: makePageData({ scan: null }) } });

      const guided = screen.getByTestId('chooser-card-guided');
      expect(guided).toHaveTextContent('admin.face_cleanup_mode_needs_scan');

      const cta = screen.getByTestId('chooser-guided-cta');
      expect(cta).toHaveTextContent('admin.face_cleanup_mode_run_first_scan');
      expect(cta).toHaveAttribute('href', Route.faceCleanupScan());
    });

    it('manual card shows "no scan needed", is enabled, and links to the people browser', () => {
      render(Page, { props: { data: makePageData({ scan: null }) } });

      const manual = screen.getByTestId('chooser-card-manual');
      expect(manual).toHaveTextContent('admin.face_cleanup_mode_manual_no_scan_needed');
      expect(manual).not.toHaveAttribute('aria-disabled', 'true');

      const cta = screen.getByTestId('chooser-manual-cta');
      expect(cta).toHaveTextContent('admin.face_cleanup_mode_browse_people');
      expect(cta).toHaveAttribute('href', Route.faceCleanupPeople());
      expect(cta).not.toHaveAttribute('aria-disabled', 'true');
      expect(cta).not.toBeDisabled();
    });
  });

  // ---- 2. returning, completed, flagged > 0 ----
  describe('returning, completed, flagged > 0', () => {
    it('guided card shows the flagged and affected-people counts, with a Continue action', () => {
      render(Page, {
        props: {
          data: makePageData({
            scan: makeScan({ totals: makeTotals({ flaggedFaces: 42, affectedPersons: 7 }) }),
          }),
        },
      });

      const guided = screen.getByTestId('chooser-card-guided');
      expect(guided).toHaveTextContent('42');
      expect(guided).toHaveTextContent('admin.face_cleanup_stat_flagged_sub');

      const cta = screen.getByTestId('chooser-guided-cta');
      expect(cta).toHaveTextContent('admin.face_cleanup_mode_continue');
      expect(cta).toHaveAttribute('href', Route.faceCleanupScan());
    });

    it('manual card shows the user count', () => {
      render(Page, {
        props: {
          data: makePageData({ scan: makeScan(), users: [makeUser('u1'), makeUser('u2'), makeUser('u3')] }),
        },
      });

      const manual = screen.getByTestId('chooser-card-manual');
      expect(manual).toHaveTextContent('admin.face_cleanup_mode_manual_user_count');
    });
  });

  // ---- 3. running: the load-bearing assertion of this slice ----
  describe('scan running', () => {
    const runningScan = () =>
      makeScan({ status: 'running', progress: { scanned: 400, total: 1000 }, totals: null, finishedAt: null });

    it('guided card shows progress and a View progress action', () => {
      render(Page, { props: { data: makePageData({ scan: runningScan() }) } });

      const guided = screen.getByTestId('chooser-card-guided');
      expect(guided).toHaveTextContent('admin.face_cleanup_scan_running');
      expect(guided).toHaveTextContent('400');

      const cta = screen.getByTestId('chooser-guided-cta');
      expect(cta).toHaveTextContent('admin.face_cleanup_mode_view_progress');
      expect(cta).toHaveAttribute('href', Route.faceCleanupScan());
    });

    it('manual card is disabled — not a working link — and explains the scan conflict', () => {
      render(Page, { props: { data: makePageData({ scan: runningScan() }) } });

      const manual = screen.getByTestId('chooser-card-manual');
      expect(manual).toHaveTextContent('admin.face_cleanup_mode_manual_blocked_scanning');
      expect(manual).toHaveAttribute('aria-disabled', 'true');

      const cta = screen.getByTestId('chooser-manual-cta');
      expect(cta).not.toHaveAttribute('href');
      expect(cta).toHaveAttribute('aria-disabled', 'true');
      expect(cta).toBeDisabled();
    });

    it('pending status is also treated as running for the manual-card block', () => {
      render(Page, {
        props: {
          data: makePageData({ scan: makeScan({ status: 'pending', progress: null, totals: null, finishedAt: null }) }),
        },
      });

      const cta = screen.getByTestId('chooser-manual-cta');
      expect(cta).not.toHaveAttribute('href');
      expect(cta).toBeDisabled();
    });
  });

  // ---- 4. completed, 0 flagged ----
  it('completed + 0 flagged: guided card shows the green "nothing flagged" state and a Re-scan action', () => {
    render(Page, {
      props: {
        data: makePageData({
          scan: makeScan({ totals: makeTotals({ flaggedFaces: 0, affectedPersons: 0 }) }),
        }),
      },
    });

    const guided = screen.getByTestId('chooser-card-guided');
    expect(guided).toHaveTextContent('admin.face_cleanup_mode_nothing_flagged');

    const cta = screen.getByTestId('chooser-guided-cta');
    expect(cta).toHaveTextContent('admin.face_cleanup_rescan');
    expect(cta).toHaveAttribute('href', Route.faceCleanupScan());

    // Not blocked: only a RUNNING scan disables manual review.
    expect(screen.getByTestId('chooser-manual-cta')).toHaveAttribute('href', Route.faceCleanupPeople());
  });

  // ---- 5. failed ----
  it('failed scan: guided card shows the red error line and a View details action', () => {
    render(Page, {
      props: {
        data: makePageData({
          scan: makeScan({ status: 'failed', totals: null, progress: null, error: 'boom' }),
        }),
      },
    });

    const guided = screen.getByTestId('chooser-card-guided');
    expect(guided).toHaveTextContent('admin.face_cleanup_scan_failed');

    const cta = screen.getByTestId('chooser-guided-cta');
    expect(cta).toHaveTextContent('admin.face_cleanup_mode_view_details');
    expect(cta).toHaveAttribute('href', Route.faceCleanupScan());

    // A failed scan is not a RUNNING scan: manual review must stay reachable.
    expect(screen.getByTestId('chooser-manual-cta')).toHaveAttribute('href', Route.faceCleanupPeople());
  });

  // ---- 6. equal weight, no recommendation ----
  it('renders both cards as equal-weight columns in one grid, with no "recommended" marker on either', () => {
    render(Page, { props: { data: makePageData({ scan: makeScan() }) } });

    const guided = screen.getByTestId('chooser-card-guided');
    const manual = screen.getByTestId('chooser-card-manual');

    expect(guided.parentElement).not.toBeNull();
    expect(guided.parentElement).toBe(manual.parentElement);
    expect(guided.parentElement).toHaveClass('lg:grid-cols-2');

    expect(screen.queryByText(/recommended/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/recommended/i)).not.toBeInTheDocument();
  });

  // ---- 7. destinations ----
  it('guided card always links to the scan dashboard and manual card to the people browser', () => {
    render(Page, { props: { data: makePageData({ scan: makeScan() }) } });

    expect(screen.getByTestId('chooser-guided-cta')).toHaveAttribute('href', Route.faceCleanupScan());
    expect(screen.getByTestId('chooser-manual-cta')).toHaveAttribute('href', Route.faceCleanupPeople());
  });

  // ---- 8. breadcrumbs ----
  it('renders a single breadcrumb that does not link to itself', () => {
    render(Page, { props: { data: makePageData() } });

    const trail = within(screen.getByTestId('breadcrumbs'));

    // Present, and NOT a link. Written this way rather than as `queryByRole('link')` returning null, which
    // would also pass if the crumb had vanished entirely — the failure this is meant to catch.
    expect(trail.getByText('admin.face_cleanup')).toBeInTheDocument();
    expect(trail.queryAllByRole('link')).toHaveLength(0);
  });
});
