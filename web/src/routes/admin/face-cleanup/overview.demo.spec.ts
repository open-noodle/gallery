import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

// Read-only demo notice on the face-repair overview (chooser) page. Neither door on this page is a mutating
// control (both CTAs are `href` navigation), so there is nothing to gate — only the explanatory notice.
// Mirrors the harness in ../maintenance/maintenance-page.spec.ts (also used by
// ./scan/scan-page.demo.spec.ts and ./resolutions/resolutions-page.demo.spec.ts): a hoisted mockAuthManager,
// the auth-manager.svelte mock exposing isReadOnlyDemo via a getter, and the AdminPageLayout stub.

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

// Stub Icon to a no-op to avoid undefined-path errors in happy-dom, same as the sibling face-cleanup specs.
vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  const noop = await import('@test-data/mocks/noop-component.svelte');
  return {
    ...mod,
    Icon: noop.default,
  };
});

// The overview's data comes straight from the page's `load` as props — no client-side fetch, so there is no
// loading branch to wait out; the guided card is present as soon as the component mounts.
const makePageData = () => ({ users: [], scan: null, meta: { title: 'Face cleanup' } });

const renderOverview = async () => {
  const result = render(Page, { props: { data: makePageData() } });
  await screen.findByTestId('chooser-card-guided');
  return result;
};

describe('face-cleanup overview page — read-only demo', () => {
  beforeEach(() => {
    mockAuthManager.isReadOnlyDemo = false; // clearMocks resets spies only — this plain object needs its own reset
  });

  it('renders the read-only notice on the overview in demo mode', async () => {
    mockAuthManager.isReadOnlyDemo = true;
    await renderOverview();

    expect(screen.queryByTestId('read-only-demo-notice')).not.toBeNull();
  });

  it('omits the notice for a real admin', async () => {
    await renderOverview();

    expect(screen.queryByTestId('read-only-demo-notice')).toBeNull();
  });
});
