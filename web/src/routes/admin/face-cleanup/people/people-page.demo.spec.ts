import { getFaceRepairOwnerPeople } from '@immich/sdk';
import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { manualReviewOwnerId } from '$lib/stores/face-cleanup-manual-review.store';
import Page from './+page.svelte';

// Read-only demo notice on the manual people browser. Its controls (owner select, search, person tiles) are
// all `href` navigation or client-side filtering, not mutations, so there is nothing to gate — only the
// explanatory notice. Mirrors the harness in ../../maintenance/maintenance-page.spec.ts (also used by
// ../scan/scan-page.demo.spec.ts and ../resolutions/resolutions-page.demo.spec.ts): a hoisted
// mockAuthManager, the auth-manager.svelte mock exposing isReadOnlyDemo via a getter, and the
// AdminPageLayout stub. This page's resolveInitialOwnerId also reads `authManager.user.id`, so the mock
// exposes a `user` getter too.

const mockAuthManager = vi.hoisted(() => ({ isReadOnlyDemo: false }));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    get isReadOnlyDemo() {
      return mockAuthManager.isReadOnlyDemo;
    },
    get user() {
      return { id: 'current-admin-not-in-owner-list' };
    },
  },
}));

vi.mock('$lib/components/layouts/AdminPageLayout.svelte', async () => {
  const { default: stub } = await import('@test-data/mocks/admin-page-layout.stub.svelte');
  return { default: stub };
});

// Only getFaceRepairOwnerPeople needs a real return value here — this suite never exercises search or
// pagination.
vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getFaceRepairOwnerPeople: vi.fn(),
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

const makeUser = (id: string, name: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  profileImagePath: '',
  avatarColor: 'primary',
  profileChangedAt: new Date().toISOString(),
});

const makePageData = () => ({ users: [makeUser('u1', 'Solo Admin')], meta: { title: 'Manual review' } });

const renderPeoplePage = async () => {
  const result = render(Page, { props: { data: makePageData() } });
  // Settles on the owner-empty state (zero people for the resolved owner) — a genuinely finished render,
  // not a page stuck on the loading branch.
  await waitFor(() => expect(screen.getByTestId('people-empty-owner')).toBeInTheDocument());
  return result;
};

describe('face-cleanup people page — read-only demo', () => {
  beforeEach(() => {
    mockAuthManager.isReadOnlyDemo = false; // clearMocks resets spies only — this plain object needs its own reset
    manualReviewOwnerId.reset();
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue({ people: [], total: 0, hasMore: false });
  });

  it('renders the read-only notice in demo mode', async () => {
    mockAuthManager.isReadOnlyDemo = true;
    await renderPeoplePage();

    expect(screen.queryByTestId('read-only-demo-notice')).not.toBeNull();
  });

  it('omits the notice for a real admin', async () => {
    await renderPeoplePage();

    expect(screen.queryByTestId('read-only-demo-notice')).toBeNull();
  });
});
