import {
  getFaceRepairClusterFaces,
  getFaceRepairPersonMetadata,
  type FaceRepairClusterFacesResponseDto,
  type FaceRepairPersonMetadataResponseDto,
} from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readOnlyDemoAuthMock } from '@test-data/mocks/read-only-demo-auth.mock.svelte';
import Page from './+page.svelte';

// Read-only demo behaviour for the MANUAL review page (/admin/face-cleanup/people/[personId]). Mirrors the
// harness in ../../[personId]/person-page.demo.spec.ts and ../../scan/scan-page.demo.spec.ts (an
// auth-manager.svelte mock exposing isReadOnlyDemo via a getter, plus the AdminPageLayout stub — the one
// stub that renders the `footer` snippet this page's dock lives in). Three things are covered:
//
//   1. The mount's cluster-faces leg is a POST. Its 403 used to reject the whole `Promise.all`, taking the
//      metadata GET down with it, so the demo saw nothing but an error banner whose Retry 403s again. It is
//      skipped under isReadOnlyDemo, so the page renders what the metadata alone supports.
//   2. Both mutating CTAs (Move entire cluster, Apply) are hidden — never merely disabled.
//   3. The read-only notice explains the vanished CTAs.
//
// WHY THE CTA TESTS FLIP THE FLAG AFTER MOUNT: because of (1), a demo visitor loads zero faces, so the grid
// and the dock that HOST those two buttons never render at all — asserting their absence straight after a
// demo-mode mount would pass with the gates deleted. The flag is therefore flipped once the grid is on
// screen, which isolates each assertion to the gate itself. That is why the mock is the rune-backed
// readOnlyDemoAuthMock rather than the plain hoisted object the sibling specs use: a plain object registers
// no signal and the flip would be invisible to `$derived`.
//
// Every assertion keys off data-testid: $t() renders raw keys in this repo's web specs, never English prose.

vi.mock('$lib/managers/auth-manager.svelte', async () => {
  const { readOnlyDemoAuthMock: mock } = await import('@test-data/mocks/read-only-demo-auth.mock.svelte');
  return {
    authManager: {
      get isReadOnlyDemo() {
        return mock.isReadOnlyDemo;
      },
    },
  };
});

vi.mock('$lib/components/layouts/AdminPageLayout.svelte', async () => {
  const { default: stub } = await import('@test-data/mocks/admin-page-layout.stub.svelte');
  return { default: stub };
});

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getFaceRepairPersonMetadata: vi.fn(),
    getFaceRepairClusterFaces: vi.fn(),
    resolveFaces: vi.fn(),
    getPeopleThumbnailPath: (id: string) => `/people/${id}/thumbnail`,
  };
});

// Stub Icon to a no-op to avoid undefined-path errors in happy-dom, same as the sibling face-cleanup specs.
vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  const noop = await import('@test-data/mocks/noop-component.svelte');
  return {
    ...mod,
    Icon: noop.default,
  };
});

vi.mock('$lib/utils/people-utils', () => ({
  getAdminFaceThumbnailUrl: (assetFaceId: string) => `/api/admin/face-repair/faces/${assetFaceId}/thumbnail`,
}));

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

const PERSON_ID = 'person-1';
const OWNER_ID = 'owner-1';

const makeMetadata = (): FaceRepairPersonMetadataResponseDto => ({
  id: PERSON_ID,
  name: 'Jula',
  ownerId: OWNER_ID,
  faceCount: 2,
  thumbnailFaceId: null,
});

const makeFacesResponse = (): FaceRepairClusterFacesResponseDto => ({
  faces: [{ assetFaceId: 'face-1' }, { assetFaceId: 'face-2' }],
  total: 2,
  hasMore: false,
});

const makePageData = () => ({ personId: PERSON_ID, meta: { title: 'Review person' } });

// The header renders in every branch (populated grid, zero-faces, load error), so waiting on it proves the
// page finished mounting without presupposing which branch it landed in.
const renderManualPage = async () => {
  const result = render(Page, { props: { data: makePageData() } });
  await waitFor(() => expect(screen.getByTestId('manual-review-header')).toBeInTheDocument());
  return result;
};

// Mounts as a real admin so the faces actually load, waits for the grid, THEN switches the viewer to the
// read-only demo user. See the flag-flip note at the top of this file.
const renderThenSwitchToDemo = async () => {
  await renderManualPage();
  await waitFor(() => expect(screen.getByTestId('manual-review-grid')).toBeInTheDocument());
  readOnlyDemoAuthMock.isReadOnlyDemo = true;
};

describe('face-cleanup manual review page — read-only demo', () => {
  beforeEach(() => {
    readOnlyDemoAuthMock.reset(); // clearMocks resets spies only — this holder needs its own reset
    vi.mocked(getFaceRepairPersonMetadata).mockResolvedValue(makeMetadata());
    vi.mocked(getFaceRepairClusterFaces).mockResolvedValue(makeFacesResponse());
  });

  it('loads the cluster faces for a real admin', async () => {
    await renderManualPage();

    await waitFor(() => expect(screen.getByTestId('manual-review-grid')).toBeInTheDocument());
    expect(getFaceRepairClusterFaces).toHaveBeenCalled();
    expect(screen.queryByTestId('manual-review-load-error')).toBeNull();
  });

  it('skips the blocked cluster-faces POST in read-only demo mode, with no error banner', async () => {
    readOnlyDemoAuthMock.isReadOnlyDemo = true;
    // Rejecting is what the demo user's 403 actually does. Were the call still made, the whole Promise.all
    // would reject and the load-error banner asserted against below would appear — so this is a test about
    // the call NOT being made, not about a call that happened to succeed.
    vi.mocked(getFaceRepairClusterFaces).mockRejectedValue(new Error('403'));
    await renderManualPage();

    expect(getFaceRepairClusterFaces).not.toHaveBeenCalled();
    expect(screen.queryByTestId('manual-review-load-error')).toBeNull();
    expect(screen.queryByTestId('manual-review-load-error-retry')).toBeNull();
    // The metadata leg survived: the person's name and owner still render, i.e. the page is a working
    // read-only exhibit rather than a red banner.
    expect(screen.getByTestId('manual-review-heading')).toHaveTextContent('Jula');
    expect(screen.getByTestId('manual-review-owner')).toHaveTextContent(OWNER_ID);
  });

  it('shows Move entire cluster to a real admin', async () => {
    await renderManualPage();

    await waitFor(() => expect(screen.getByTestId('manual-review-move-entire-btn')).toBeInTheDocument());
  });

  it('hides Move entire cluster in read-only demo mode', async () => {
    await renderThenSwitchToDemo();

    await waitFor(() => expect(screen.queryByTestId('manual-review-move-entire-btn')).toBeNull());
    // The grid that HOSTS the button is still on screen, so its absence is the gate and not a vanished page.
    expect(screen.getByTestId('manual-review-grid')).toBeInTheDocument();
  });

  it('shows Apply to a real admin', async () => {
    await renderManualPage();

    await waitFor(() => expect(screen.getByTestId('manual-review-apply-btn')).toBeInTheDocument());
  });

  it('hides Apply in read-only demo mode', async () => {
    await renderThenSwitchToDemo();

    await waitFor(() => expect(screen.queryByTestId('manual-review-apply-btn')).toBeNull());
    // `manual-review-tally` is rendered by the SAME footer snippet as Apply, unconditionally in both
    // branches — its presence proves the dock is still mounted, so a dropped footer cannot make the
    // assertion above pass vacuously.
    expect(screen.getByTestId('manual-review-tally')).toBeInTheDocument();
  });

  it('renders the read-only notice in demo mode', async () => {
    readOnlyDemoAuthMock.isReadOnlyDemo = true;
    await renderManualPage();

    expect(screen.queryByTestId('read-only-demo-notice')).not.toBeNull();
  });

  it('omits the read-only notice for a real admin', async () => {
    await renderManualPage();

    expect(screen.queryByTestId('read-only-demo-notice')).toBeNull();
  });
});
