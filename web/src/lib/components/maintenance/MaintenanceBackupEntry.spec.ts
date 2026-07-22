import { screen } from '@testing-library/svelte';
import { DateTime } from 'luxon';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locale } from '$lib/stores/preferences.store';
import { renderWithTooltips } from '$tests/helpers';
import MaintenanceBackupEntry from './MaintenanceBackupEntry.svelte';

vi.mock('$lib/services/database-backups.service', () => ({
  getDatabaseBackupActions: () => ({
    Download: { type: 'command', title: 'Download', onAction: vi.fn() },
    Delete: { type: 'command', title: 'Delete', onAction: vi.fn() },
  }),
  handleRestoreDatabaseBackup: vi.fn(),
}));

const mockAuthManager = vi.hoisted(() => ({ isReadOnlyDemo: false }));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
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

describe('MaintenanceBackupEntry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T12:00:00Z'));
    locale.set('en');
  });

  afterEach(() => {
    vi.useRealTimers();
    mockAuthManager.isReadOnlyDemo = false;
  });

  it('renders relative backup time using the user timezone instead of UTC', () => {
    const backupTimestamp = '20260324T110000';

    const expectedRelativeTime = DateTime.fromFormat(backupTimestamp, "yyyyMMdd'T'HHmmss", {
      zone: 'Asia/Tokyo',
    })
      .toLocal()
      .toRelative({ locale: 'en' });

    const utcRelativeTime = DateTime.fromFormat(backupTimestamp, "yyyyMMdd'T'HHmmss", {
      zone: 'UTC',
    })
      .toLocal()
      .toRelative({ locale: 'en' });

    expect(expectedRelativeTime).toBeTruthy();
    expect(expectedRelativeTime).not.toEqual(utcRelativeTime);

    renderWithTooltips(MaintenanceBackupEntry, {
      expectedVersion: '1.2.3',
      filename: 'immich-db-backup-20260324T110000-v1.2.3-snapshot.sql.gz',
      filesize: 1024,
      timezone: 'Asia/Tokyo',
    });

    expect(screen.getByText(expectedRelativeTime!)).toBeInTheDocument();
  });

  describe('read-only demo', () => {
    it('renders restore and the download/delete menu for real admins', () => {
      renderWithTooltips(MaintenanceBackupEntry, backupProps);

      expect(screen.getByRole('button', { name: 'restore' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'open' })).toBeInTheDocument();
    });

    // The demo user only gets GET /admin/database-backups. Restore is a POST the demo interceptor
    // blocks, and download/delete hit routes outside the demo preview allowlist, so all three would
    // fail with a 403 toast if they stayed clickable.
    it('hides restore and the download/delete menu for demo preview users', () => {
      mockAuthManager.isReadOnlyDemo = true;

      renderWithTooltips(MaintenanceBackupEntry, backupProps);

      expect(screen.queryByRole('button', { name: 'restore' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'open' })).not.toBeInTheDocument();
    });

    it('still renders the backup metadata for demo preview users', () => {
      mockAuthManager.isReadOnlyDemo = true;

      renderWithTooltips(MaintenanceBackupEntry, backupProps);

      expect(screen.getByText(backupProps.filename)).toBeInTheDocument();
    });
  });
});
