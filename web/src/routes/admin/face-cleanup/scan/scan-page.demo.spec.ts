import { getLatestScan } from '@immich/sdk';
import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

// Read-only demo gate for the scan page's mutating actions (Advanced scan tuning, Re-scan/Run first scan).
// Mirrors the harness in ../../maintenance/maintenance-page.spec.ts: a hoisted mockAuthManager, the
// auth-manager.svelte mock exposing isReadOnlyDemo via a getter, and the AdminPageLayout stub.

const mockAuthManager = vi.hoisted(() => ({ isReadOnlyDemo: false }));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    get isReadOnlyDemo() {
      return mockAuthManager.isReadOnlyDemo;
    },
  },
}));

vi.mock('$lib/components/layouts/AdminPageLayout.svelte', async () => {
  const { default: stub } = await import('@test-data/mocks/admin-page-layout.stub.svelte');
  return { default: stub };
});

// Mock @immich/sdk before any imports that use it — only getLatestScan needs a real return value here;
// the other exports (triggerScan, resolveFaces, etc.) are never invoked by these tests.
vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getLatestScan: vi.fn(),
  };
});

// Stub Icon to a no-op to avoid undefined-path errors in happy-dom, same as page.spec.ts.
vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  const noop = await import('@test-data/mocks/noop-component.svelte');
  return {
    ...mod,
    Icon: noop.default,
  };
});

// Mock $app/navigation and $app/stores to avoid SvelteKit runtime in tests.
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
  onNavigate: vi.fn(),
}));

vi.mock('$app/stores', () => ({
  page: {
    subscribe: vi.fn((run) => {
      run({ url: new URL('http://localhost/admin/face-cleanup/scan') });
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

const makeFinishedScan = () => ({
  id: 'scan-1',
  status: 'completed' as const,
  progress: { scanned: 1000, total: 1000 },
  totals: {
    eligibleFaces: 1000,
    flaggedFaces: 0,
    toRepair: 0,
    reviewOnlyFaces: 0,
    reviewOnlyPersons: 0,
    affectedPersons: 0,
    reviewOnlyByReason: { overCap: 0, badTarget: 0, unAttributable: 0 },
  },
  persons: [],
  error: null,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
});

const makeFailedScan = () => ({
  ...makeFinishedScan(),
  status: 'failed' as const,
  totals: null,
  error: 'boom',
});

const makePageData = () => ({ users: [], meta: { title: 'Guided cleanup' } });

const renderScanPage = async () => {
  const result = render(Page, { props: { data: makePageData() } });
  // Header (and its Advanced/Rescan buttons) only render once the finished scan has loaded.
  await waitFor(() => expect(screen.getByText('admin.face_cleanup_rescan')).toBeInTheDocument());
  return result;
};

describe('face-cleanup scan page — read-only demo', () => {
  beforeEach(() => {
    mockAuthManager.isReadOnlyDemo = false; // clearMocks resets spies only — this plain object needs its own reset
    vi.mocked(getLatestScan).mockResolvedValue(makeFinishedScan() as unknown as object);
  });

  it('shows Rescan and Advanced to a real admin', async () => {
    await renderScanPage();

    expect(screen.getByText('admin.face_cleanup_rescan')).toBeInTheDocument();
    expect(screen.getByText('admin.face_cleanup_advanced')).toBeInTheDocument();
  });

  it('hides Rescan and Advanced in read-only demo mode', async () => {
    mockAuthManager.isReadOnlyDemo = true;
    render(Page, { props: { data: makePageData() } });

    // The header itself (title) still renders — only the mutating actions are gated — so wait on that
    // instead of the now-absent Rescan button. Scoped to the h1 (not `getByText`): the breadcrumb trail
    // also renders a crumb with the exact same "admin.face_cleanup" text.
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'admin.face_cleanup' })).toBeInTheDocument(),
    );

    expect(screen.queryByText('admin.face_cleanup_rescan')).not.toBeInTheDocument();
    expect(screen.queryByText('admin.face_cleanup_advanced')).not.toBeInTheDocument();
  });

  // The empty ("never scanned") state's own primary CTA. Latent on the live demo, which has a completed
  // seeded scan — but it goes live the moment one does not, so it is gated and covered like the rest. The
  // fixture returns null from getLatestScan to reach that branch at all; asserting its absence against the
  // completed-scan fixture used above could never fail.
  it('shows the first-scan CTA to a real admin when nothing has been scanned', async () => {
    vi.mocked(getLatestScan).mockResolvedValue(null as unknown as object);
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(screen.getByTestId('first-scan-cta')).toBeInTheDocument());
  });

  it('hides the first-scan CTA in read-only demo mode', async () => {
    vi.mocked(getLatestScan).mockResolvedValue(null as unknown as object);
    mockAuthManager.isReadOnlyDemo = true;
    render(Page, { props: { data: makePageData() } });

    // Wait on the empty state that HOSTS the CTA, so a page that never reached that branch fails loudly
    // rather than passing on an absence it was always going to have.
    await waitFor(() => expect(screen.getByText('admin.face_cleanup_empty_no_scan')).toBeInTheDocument());
    expect(screen.queryByTestId('first-scan-cta')).not.toBeInTheDocument();
  });

  it('shows the retry-scan button to a real admin when the last scan failed', async () => {
    vi.mocked(getLatestScan).mockResolvedValue(makeFailedScan() as unknown as object);
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(screen.getByTestId('retry-scan-btn')).toBeInTheDocument());
  });

  it('hides the retry-scan button in read-only demo mode', async () => {
    vi.mocked(getLatestScan).mockResolvedValue(makeFailedScan() as unknown as object);
    mockAuthManager.isReadOnlyDemo = true;
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(screen.getByText('admin.face_cleanup_scan_failed')).toBeInTheDocument());
    expect(screen.queryByTestId('retry-scan-btn')).not.toBeInTheDocument();
  });

  it('omits the read-only notice for a real admin', async () => {
    await renderScanPage();
    expect(screen.queryByTestId('read-only-demo-notice')).not.toBeInTheDocument();
  });

  it('renders the read-only notice when in read-only demo mode', async () => {
    mockAuthManager.isReadOnlyDemo = true;
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(screen.getByTestId('read-only-demo-notice')).toBeInTheDocument());
  });
});
