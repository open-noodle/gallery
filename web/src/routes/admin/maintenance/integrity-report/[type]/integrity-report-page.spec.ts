import { IntegrityReport } from '@immich/sdk';
import { screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithTooltips } from '$tests/helpers';
import IntegrityReportPage from './+page.svelte';

const mockAuthManager = vi.hoisted(() => ({ isReadOnlyDemo: false }));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    get isReadOnlyDemo() {
      return mockAuthManager.isReadOnlyDemo;
    },
  },
}));

vi.mock('$lib/components/layouts/AdminPageLayout.svelte', async () => {
  const stub = await import('@test-data/mocks/admin-page-layout.stub.svelte');
  return { default: stub.default };
});

vi.mock('$lib/services/integrity.service', () => ({
  getIntegrityReportActions: () => ({
    Download: { type: 'command', title: 'Download report', onAction: vi.fn() },
    Delete: { type: 'command', title: 'Delete report', onAction: vi.fn() },
  }),
  getIntegrityReportItemActions: () => ({
    Download: { type: 'command', title: 'Download', onAction: vi.fn() },
    Delete: { type: 'command', title: 'Delete', onAction: vi.fn() },
  }),
}));

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getIntegrityReport: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
    getQueuesLegacy: vi.fn().mockResolvedValue({
      integrityCheck: { queueStatus: { isActive: false } },
    }),
  };
});

const data = {
  type: IntegrityReport.UntrackedFile,
  integrityReport: {
    items: [{ id: 'item-id', path: 'upload/library/admin/2026/untracked.jpg' }],
    nextCursor: undefined,
  },
  meta: { title: 'Untracked files' },
};

const renderPage = () => renderWithTooltips(IntegrityReportPage, { data } as never);

describe('admin integrity report page', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    mockAuthManager.isReadOnlyDemo = false;
  });

  it('exposes the report download and delete actions for real admins', () => {
    renderPage();

    expect(screen.getByRole('button', { name: 'Download report' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete report' })).toBeInTheDocument();
  });

  // The CSV export lives at /admin/integrity/report/:type/csv, which is deliberately outside the
  // demo preview allowlist, and delete is a DELETE the demo interceptor rejects.
  it('hides the report download and delete actions for demo preview users', () => {
    mockAuthManager.isReadOnlyDemo = true;

    renderPage();

    expect(screen.queryByRole('button', { name: 'Download report' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete report' })).not.toBeInTheDocument();
  });

  it('still lists the flagged files for demo preview users', () => {
    mockAuthManager.isReadOnlyDemo = true;

    renderPage();

    expect(screen.getByText('upload/library/admin/2026/untracked.jpg')).toBeInTheDocument();
  });
});
