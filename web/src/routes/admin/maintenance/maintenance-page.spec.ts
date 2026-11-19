import { renderWithTooltips } from '#test/unit/helpers.ts';
import { MockRouter } from '#test/unit/mocks/router.ts';
import { IntegrityReport } from '@immich/sdk';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import MaintenancePage from './+page.svelte';

const mockAuthManager = vi.hoisted(() => ({ isReadOnlyDemo: false }));

vi.mock('#lib/managers/auth-manager.svelte.ts', () => ({
  authManager: {
    get isReadOnlyDemo() {
      return mockAuthManager.isReadOnlyDemo;
    },
  },
}));

vi.mock('#lib/components/layouts/AdminPageLayout.svelte', async () => {
  const stub = await import('#lib/gallery/__mocks__/admin-page-layout.stub.svelte');
  return { default: stub.default };
});

vi.mock('#lib/services/maintenance.service.ts', () => ({
  getMaintenanceAdminActions: () => ({
    StartMaintenance: { type: 'command', title: 'Start maintenance', onAction: vi.fn() },
  }),
}));

vi.mock('#lib/services/job.service.ts', () => ({
  handleCreateJob: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getIntegrityReportSummary: vi.fn().mockResolvedValue({
      [actual.IntegrityReport.UntrackedFile]: 0,
      [actual.IntegrityReport.MissingFile]: 0,
      [actual.IntegrityReport.ChecksumMismatch]: 0,
    }),
    getQueuesLegacy: vi.fn().mockResolvedValue({
      integrityCheck: { queueStatus: { isActive: false } },
    }),
    listDatabaseBackups: vi.fn().mockResolvedValue({ backups: [] }),
  };
});

const data = {
  backups: [
    {
      filename: 'immich-db-backup-20260324T110000-v1.2.3-snapshot.sql.gz',
      filesize: 1024,
      timezone: 'UTC',
    },
  ],
  integrityReport: {
    [IntegrityReport.UntrackedFile]: 3,
    [IntegrityReport.MissingFile]: 0,
    [IntegrityReport.ChecksumMismatch]: 0,
  },
  expectedVersion: '1.2.3',
  meta: { title: 'Maintenance' },
};

const renderPage = () => renderWithTooltips(MaintenancePage, { data } as never);

describe('admin maintenance page', () => {
  // Unmounting the page closes its SettingAccordions, which call goto; keep the router up until every
  // test's cleanup has run.
  const router = new MockRouter();

  afterAll(() => router.teardown());

  beforeEach(() => {
    router.setup();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    mockAuthManager.isReadOnlyDemo = false;
  });

  describe('real admins', () => {
    it('exposes the start-maintenance action and the integrity job triggers', async () => {
      await renderPage();

      await expect.element(page.getByRole('button', { name: 'Start maintenance' })).toBeInTheDocument();
      await expect
        .element(page.getByRole('button', { name: 'admin.maintenance_integrity_check_all' }))
        .toBeInTheDocument();
    });

    it('does not show the read-only demo notice', async () => {
      await renderPage();

      await expect.element(page.getByText('Read-only demo')).not.toBeInTheDocument();
    });
  });

  describe('demo preview users', () => {
    // Everything hidden here is a POST the demo interceptor rejects. The page itself stays
    // reachable because GET /admin/integrity/summary and GET /admin/database-backups are on the
    // demo preview allowlist.
    it('hides the start-maintenance action', async () => {
      mockAuthManager.isReadOnlyDemo = true;

      await renderPage();

      await expect.element(page.getByRole('button', { name: 'Start maintenance' })).not.toBeInTheDocument();
    });

    it('hides the integrity job triggers', async () => {
      mockAuthManager.isReadOnlyDemo = true;

      await renderPage();

      await expect
        .element(page.getByRole('button', { name: 'admin.maintenance_integrity_check_all' }))
        .not.toBeInTheDocument();
      await expect
        .element(page.getByRole('button', { name: 'admin.maintenance_integrity_check' }))
        .not.toBeInTheDocument();
    });

    it('shows the read-only demo notice', async () => {
      mockAuthManager.isReadOnlyDemo = true;

      await renderPage();

      await expect.element(page.getByText('Read-only demo')).toBeInTheDocument();
    });

    it('still renders the integrity counts and the drill-down links', async () => {
      mockAuthManager.isReadOnlyDemo = true;

      await renderPage();

      await expect.element(page.getByText('3')).toBeInTheDocument();
      expect(page.getByRole('link', { name: 'view' }).elements()).toHaveLength(3);
    });
  });
});
