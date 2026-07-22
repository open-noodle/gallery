import { screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithTooltips } from '$tests/helpers';
import MaintenanceBackupsList from './MaintenanceBackupsList.svelte';

vi.mock('$lib/services/database-backups.service', () => ({
  getDatabaseBackupActions: () => ({
    Download: { type: 'command', title: 'Download', onAction: vi.fn() },
    Delete: { type: 'command', title: 'Delete', onAction: vi.fn() },
  }),
  handleRestoreDatabaseBackup: vi.fn(),
  handleUploadDatabaseBackup: vi.fn(),
}));

const mockAuthManager = vi.hoisted(() => ({ isReadOnlyDemo: false }));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    get isReadOnlyDemo() {
      return mockAuthManager.isReadOnlyDemo;
    },
  },
}));

const backups = [
  {
    filename: 'immich-db-backup-20260324T110000-v1.2.3-snapshot.sql.gz',
    filesize: 1024,
    timezone: 'UTC',
  },
];

describe('MaintenanceBackupsList', () => {
  afterEach(() => {
    mockAuthManager.isReadOnlyDemo = false;
  });

  it('renders the upload card for real admins', () => {
    renderWithTooltips(MaintenanceBackupsList, { backups, expectedVersion: '1.2.3' });

    expect(screen.getByText('admin.maintenance_upload_backup')).toBeInTheDocument();
  });

  // Uploading a backup is a POST the demo interceptor rejects, so the affordance would only ever
  // produce a 403 for demo preview users.
  it('hides the upload card for demo preview users', () => {
    mockAuthManager.isReadOnlyDemo = true;

    renderWithTooltips(MaintenanceBackupsList, { backups, expectedVersion: '1.2.3' });

    expect(screen.queryByText('admin.maintenance_upload_backup')).not.toBeInTheDocument();
  });

  it('still lists the backups for demo preview users', () => {
    mockAuthManager.isReadOnlyDemo = true;

    renderWithTooltips(MaintenanceBackupsList, { backups, expectedVersion: '1.2.3' });

    expect(screen.getByText(backups[0].filename)).toBeInTheDocument();
  });
});
