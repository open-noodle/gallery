import { getFaceRepairClusterFaces, getFaceRepairPersonFaces, getLatestScan } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';

// Read-only demo gate for the per-person review page's Apply action — the last mutating control on the
// Face Repair flow (Scan/lanes and Resolutions/Undo were gated in earlier tasks). Mirrors the harness in
// ../scan/scan-page.demo.spec.ts and ../resolutions/resolutions-page.demo.spec.ts (itself mirroring
// ../../maintenance/maintenance-page.spec.ts): a hoisted mockAuthManager, the auth-manager.svelte mock
// exposing isReadOnlyDemo via a getter, and the AdminPageLayout stub.
//
// This page renders its action bar (tally + Apply) through AdminPageLayout's `footer` snippet, not the page
// body — the shared admin-page-layout.stub.svelte is required because it is the one stub that renders
// `footer`. A stub that only renders `children` would drop the whole dock silently and both "shows"/"hides"
// assertions below would pass vacuously. Every test here waits on `tally` (rendered by the SAME footer,
// unconditionally in both branches) before asserting on `apply-btn`, so a vanished footer fails loudly
// instead of masquerading as a successful gate.
//
// This repo's web specs render $t() as raw keys (no i18n dictionary registered here), so assertions key off
// data-testid, never English prose.

const mockAuthManager = vi.hoisted(() => ({ isReadOnlyDemo: false }));

vi.mock('#lib/managers/auth-manager.svelte.ts', () => ({
  authManager: {
    get isReadOnlyDemo() {
      return mockAuthManager.isReadOnlyDemo;
    },
  },
}));

vi.mock('#lib/components/layouts/AdminPageLayout.svelte', async () => {
  const { default: stub } = await import('#lib/gallery/__mocks__/admin-page-layout.stub.svelte');
  return { default: stub };
});

// Mock @immich/sdk before any imports that use it. resolveFaces is never invoked by these tests — Apply is
// either clicked by nobody or gated away entirely.
vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getLatestScan: vi.fn(),
    getFaceRepairPersonFaces: vi.fn(),
    getFaceRepairClusterFaces: vi.fn(),
    getPeopleThumbnailPath: (id: string) => `/people/${id}/thumbnail`,
  };
});

// Stub Icon to a no-op to avoid undefined-path errors in happy-dom, same as page.spec.ts.
vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  const noop = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return {
    ...mod,
    Icon: noop.default,
  };
});

vi.mock('#lib/utils/people-utils.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/utils/people-utils.ts')>()),
  getAdminFaceThumbnailUrl: (assetFaceId: string) => `/api/admin/face-repair/faces/${assetFaceId}/thumbnail`,
  getSpacePersonFaceThumbnailUrl: vi.fn(),
}));

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
  onNavigate: vi.fn(),
}));

vi.mock('$app/stores', () => ({
  page: {
    subscribe: vi.fn((run) => {
      run({ url: new URL('http://localhost/admin/face-cleanup/person-1') });
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

const PERSON_ID = 'person-1';
const OWNER_A_ID = 'owner-a';

const makeScanPerson = () => ({
  personId: PERSON_ID,
  ownerId: 'owner-user-1',
  personName: 'Jula',
  faceCount: 10,
  thumbnailFaceId: null,
  eligible: 10,
  flagged: 1,
  flaggedFraction: 0.1,
  suspectedOwners: [
    {
      ownerPersonId: OWNER_A_ID,
      ownerName: 'Armin',
      thumbnailFaceId: 'thumb-a',
      count: 1,
      ownerFaceCount: 1204,
      ownerMissing: false,
    },
  ],
  recommendation: 'confident' as const,
  reviewReasons: [] as string[],
});

const makeCompletedScan = () => ({
  id: 'scan-1',
  status: 'completed' as const,
  progress: { scanned: 100, total: 100 },
  totals: null,
  persons: [makeScanPerson()],
  error: null,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
});

const makePageData = () => ({ personId: PERSON_ID, meta: { title: 'Review person' } });

const renderPersonPage = async () => {
  const result = await render(Page, { props: { data: makePageData() } });
  // `tally` is rendered by the same footer snippet as Apply, unconditionally in BOTH branches — waiting on it
  // proves the footer (and therefore the dock) actually mounted before we assert on apply-btn's presence or
  // absence. Without this, a stub that drops `footer` entirely would make both assertions pass vacuously.
  await expect.element(page.getByTestId('tally')).toBeInTheDocument();
  return result;
};

describe('face-cleanup person page — read-only demo', () => {
  beforeEach(() => {
    mockAuthManager.isReadOnlyDemo = false; // clearMocks resets spies only — this plain object needs its own reset
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan() as unknown as object);
    vi.mocked(getFaceRepairPersonFaces).mockResolvedValue({
      personId: PERSON_ID,
      flaggedFaces: [{ assetFaceId: 'face-1', suspectedOwnerId: OWNER_A_ID }],
    } as unknown as Awaited<ReturnType<typeof getFaceRepairPersonFaces>>);
    vi.mocked(getFaceRepairClusterFaces).mockResolvedValue({
      faces: [],
      total: 0,
      hasMore: false,
    } as unknown as Awaited<ReturnType<typeof getFaceRepairClusterFaces>>);
  });

  it('shows Apply to a real admin', async () => {
    await renderPersonPage();

    await expect.element(page.getByTestId('apply-btn')).toBeInTheDocument();
  });

  it('hides Apply in read-only demo mode', async () => {
    mockAuthManager.isReadOnlyDemo = true;
    await renderPersonPage();

    await expect.element(page.getByTestId('apply-btn')).not.toBeInTheDocument();
  });

  it('shows Move entire cluster to a real admin', async () => {
    await renderPersonPage();

    await expect.element(page.getByTestId('move-entire-btn')).toBeInTheDocument();
  });

  it('hides Move entire cluster in read-only demo mode', async () => {
    mockAuthManager.isReadOnlyDemo = true;
    await renderPersonPage();

    // `rest-section` hosts the button and renders in BOTH branches, so a page that never got that far
    // fails here rather than passing on an absence it was always going to have.
    await expect.element(page.getByTestId('rest-section')).toBeInTheDocument();
    await expect.element(page.getByTestId('move-entire-btn')).not.toBeInTheDocument();
  });

  // The rest-of-cluster load is a POST the demo user is refused. Firing it would flip restLoadError and
  // paint a red banner over a page whose whole purpose here is to be a working read-only exhibit.
  it('loads the rest of the cluster for a real admin', async () => {
    await renderPersonPage();

    await vi.waitFor(() => expect(getFaceRepairClusterFaces).toHaveBeenCalled());
    await expect.element(page.getByTestId('rest-load-error')).not.toBeInTheDocument();
  });

  it('skips the blocked cluster-faces POST in read-only demo mode, with no error banner', async () => {
    mockAuthManager.isReadOnlyDemo = true;
    // Would set restLoadError if the call were ever made — proving the assertion below is about the call
    // NOT happening, not about a call that happened to succeed.
    vi.mocked(getFaceRepairClusterFaces).mockRejectedValue(new Error('403'));
    await renderPersonPage();

    // The flagged grid still rendered, i.e. the page is genuinely usable rather than blank.
    await expect.element(page.getByTestId('flagged-grid')).toBeInTheDocument();
    expect(getFaceRepairClusterFaces).not.toHaveBeenCalled();
    await expect.element(page.getByTestId('rest-load-error')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('rest-load-error-retry')).not.toBeInTheDocument();
  });

  it('renders the read-only notice in demo mode', async () => {
    mockAuthManager.isReadOnlyDemo = true;
    await renderPersonPage();

    await expect.element(page.getByTestId('read-only-demo-notice')).toBeInTheDocument();
  });

  it('omits the read-only notice for a real admin', async () => {
    await renderPersonPage();

    await expect.element(page.getByTestId('read-only-demo-notice')).not.toBeInTheDocument();
  });
});
