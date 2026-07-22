import { IntegrityReport } from '@immich/sdk';
import { screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithTooltips } from '$tests/helpers';
import MaintenancePage from './+page.svelte';

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

vi.mock('$lib/services/maintenance.service', () => ({
  getMaintenanceAdminActions: () => ({
    StartMaintenance: { type: 'command', title: 'Start maintenance', onAction: vi.fn() },
  }),
}));

vi.mock('$lib/services/job.service', () => ({
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
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    mockAuthManager.isReadOnlyDemo = false;
  });

  describe('real admins', () => {
    it('exposes the start-maintenance action and the integrity job triggers', () => {
      renderPage();

      expect(screen.getByRole('button', { name: 'Start maintenance' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'admin.maintenance_integrity_check_all' })).toBeInTheDocument();
    });

    it('does not show the read-only demo notice', () => {
      renderPage();

      expect(screen.queryByText('Read-only demo')).not.toBeInTheDocument();
    });
  });

  describe('demo preview users', () => {
    // Everything hidden here is a POST the demo interceptor rejects. The page itself stays
    // reachable because GET /admin/integrity/summary and GET /admin/database-backups are on the
    // demo preview allowlist.
    it('hides the start-maintenance action', () => {
      mockAuthManager.isReadOnlyDemo = true;

      renderPage();

      expect(screen.queryByRole('button', { name: 'Start maintenance' })).not.toBeInTheDocument();
    });

    it('hides the integrity job triggers', () => {
      mockAuthManager.isReadOnlyDemo = true;

      renderPage();

      expect(screen.queryByRole('button', { name: 'admin.maintenance_integrity_check_all' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'admin.maintenance_integrity_check' })).not.toBeInTheDocument();
    });

    it('shows the read-only demo notice', () => {
      mockAuthManager.isReadOnlyDemo = true;

      renderPage();

      expect(screen.getByText('Read-only demo')).toBeInTheDocument();
    });

    it('still renders the integrity counts and the drill-down links', () => {
      mockAuthManager.isReadOnlyDemo = true;

      renderPage();

      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getAllByRole('link', { name: 'view' })).toHaveLength(3);
    });
  });
});
