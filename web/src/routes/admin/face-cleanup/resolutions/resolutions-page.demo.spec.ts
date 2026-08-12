import { getFaceRepairResolutions } from '@immich/sdk';
import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

// Read-only demo gate for the resolutions page's Undo button. Mirrors the harness in
// ../scan/scan-page.demo.spec.ts (itself mirroring ../../maintenance/maintenance-page.spec.ts): a hoisted
// mockAuthManager, the auth-manager.svelte mock exposing isReadOnlyDemo via a getter, and the
// AdminPageLayout stub. This repo's web specs render $t() as raw keys (no i18n dictionary registered here),
// so assertions key off data-testid, never English prose.

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

// Only getFaceRepairResolutions needs a real return value here — removeFaceRepairResolutions is never
// invoked by these tests (Undo is either clicked by nobody or gated away entirely).
vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getFaceRepairResolutions: vi.fn(),
    getPeopleThumbnailPath: (id: string) => `/people/${id}/thumbnail`,
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
      run({ url: new URL('http://localhost/admin/face-cleanup/resolutions') });
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

// One row is the whole point: with zero rows there is no Undo button and both "shows"/"hides" assertions
// would pass vacuously, which is exactly the defect a reviewer would look for here.
const ROW = {
  id: 'verdict-1',
  assetFaceId: 'face-1',
  status: 'rejected',
  source: 'cleanup',
  personId: 'person-1',
  personName: 'Berta',
  personThumbnailFaceId: null,
  spacePersonId: null,
  spacePersonName: null,
  spaceName: null,
  actorId: 'admin-1',
  actorName: 'Admin',
  createdAt: '2026-07-01T00:00:00.000Z',
};

const renderResolutionsPage = async () => {
  const result = render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });
  await waitFor(() => expect(screen.getAllByTestId('resolution-row')).toHaveLength(1));
  return result;
};

describe('face-cleanup resolutions page — read-only demo', () => {
  beforeEach(() => {
    mockAuthManager.isReadOnlyDemo = false; // clearMocks resets spies only — this plain object needs its own reset
    vi.mocked(getFaceRepairResolutions).mockResolvedValue({
      total: 1,
      resolutions: [ROW],
    } as unknown as Awaited<ReturnType<typeof getFaceRepairResolutions>>);
  });

  it('shows Undo to a real admin', async () => {
    await renderResolutionsPage();

    expect(screen.queryByTestId('undo-button')).not.toBeNull();
  });

  it('hides Undo in read-only demo mode', async () => {
    mockAuthManager.isReadOnlyDemo = true;
    await renderResolutionsPage();

    expect(screen.queryByTestId('undo-button')).toBeNull();
  });

  it('does not render the read-only demo notice for a real admin', async () => {
    await renderResolutionsPage();

    expect(screen.queryByTestId('read-only-demo-notice')).not.toBeInTheDocument();
  });

  it('renders the read-only demo notice in read-only demo mode', async () => {
    mockAuthManager.isReadOnlyDemo = true;
    await renderResolutionsPage();

    expect(screen.getByTestId('read-only-demo-notice')).toBeInTheDocument();
  });
});
