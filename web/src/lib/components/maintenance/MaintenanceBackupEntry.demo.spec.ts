import { renderWithTooltips } from '#test/unit/helpers.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import MaintenanceBackupEntry from './MaintenanceBackupEntry.svelte';

vi.mock('#lib/services/database-backups.service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/services/database-backups.service.ts')>()),
  getDatabaseBackupActions: () => ({
    Download: { type: 'command', title: 'Download', onAction: vi.fn() },
    Delete: { type: 'command', title: 'Delete', onAction: vi.fn() },
  }),
  handleRestoreDatabaseBackup: vi.fn(),
}));

const mockAuthManager = vi.hoisted(() => ({ isReadOnlyDemo: false }));

vi.mock('#lib/managers/auth-manager.svelte.ts', () => ({
  authManager: {
    get isReadOnlyDemo() {
      return mockAuthManager.isReadOnlyDemo;
    },
  },
}));

const backupProps = {
  expectedVersion: '1.2.3',
  filename: 'immich-db-backup-20260324T110000-v1.2.3-snapshot.sql.gz',
  filesize: 1024,
  timezone: 'Asia/Tokyo',
};

describe('MaintenanceBackupEntry read-only demo', () => {
  afterEach(() => {
    mockAuthManager.isReadOnlyDemo = false;
  });

  it('renders restore and the download/delete menu for real admins', async () => {
    await renderWithTooltips(MaintenanceBackupEntry, backupProps);

    await expect.element(page.getByRole('button', { name: 'restore' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'open' })).toBeInTheDocument();
  });

  // The demo user only gets GET /admin/database-backups. Restore is a POST the demo interceptor
  // blocks, and download/delete hit routes outside the demo preview allowlist, so all three would
  // fail with a 403 toast if they stayed clickable.
  it('hides restore and the download/delete menu for demo preview users', async () => {
    mockAuthManager.isReadOnlyDemo = true;

    await renderWithTooltips(MaintenanceBackupEntry, backupProps);

    await expect.element(page.getByText(backupProps.filename)).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'restore' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'open' })).not.toBeInTheDocument();
  });

  it('still renders the backup metadata for demo preview users', async () => {
    mockAuthManager.isReadOnlyDemo = true;

    await renderWithTooltips(MaintenanceBackupEntry, backupProps);

    await expect.element(page.getByText(backupProps.filename)).toBeInTheDocument();
  });
});
