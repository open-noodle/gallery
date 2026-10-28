import type { AdminConfigDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BackupSettings from './BackupSettings.svelte';

const makeConfig = (s3: { enabled: boolean }) =>
  ({
    backup: {
      database: {
        enabled: true,
        cronExpression: '0 02 * * *',
        keepLastAmount: 14,
        s3,
      },
    },
  }) as AdminConfigDto;

const mocks = vi.hoisted(() => ({
  featureFlags: { configFile: false, s3Storage: false },
  systemConfig: {} as AdminConfigDto,
  defaultSystemConfig: {} as AdminConfigDto,
  saveConfig: vi.fn(),
}));

vi.mock(import('#lib/managers/feature-flags-manager.svelte.js'), () => ({
  featureFlagsManager: {
    get value() {
      return mocks.featureFlags;
    },
  } as never,
}));

vi.mock(import('#lib/queries/client.js'), () => ({
  createPreloadedQuery: ((optionsFn: () => { queryKey: readonly unknown[] }) => ({
    get data() {
      return optionsFn().queryKey.includes('defaults') ? mocks.defaultSystemConfig : mocks.systemConfig;
    },
  })) as never,
}));

vi.mock(import('@tanstack/svelte-query'), async (importOriginal) => ({
  ...(await importOriginal()),
  createMutation: (() => ({ mutate: mocks.saveConfig, isPending: false })) as never,
}));

/**
 * `SettingInputField` renders `aria-labelledby="<label>-label"` pointing at an id that does not exist, so its
 * inputs have no accessible name and `getByLabelText` cannot find them. They are addressed by the `name`
 * attribute the component sets from the label instead.
 */
const field = (container: HTMLElement, label: string) =>
  container.querySelector<HTMLInputElement>(`input[name="${CSS.escape(label)}"]`);

describe('BackupSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureFlags.configFile = false;
    mocks.featureFlags.s3Storage = false;
    mocks.systemConfig = makeConfig({ enabled: false });
    mocks.defaultSystemConfig = makeConfig({ enabled: false });
  });

  // The gate: the feature reuses the media backend's bucket and credentials, so it cannot apply at all on a
  // disk-backed server. The group is absent rather than disabled.
  describe('when the server is not on the S3 storage backend', () => {
    it('renders no S3 options at all', () => {
      render(BackupSettings);

      expect(screen.queryByRole('switch', { name: 'admin.backup_s3_enabled' })).not.toBeInTheDocument();
      expect(screen.queryByText('admin.backup_s3_credentials_hint')).not.toBeInTheDocument();
    });

    it('still renders the upstream backup options', () => {
      const { container } = render(BackupSettings);

      expect(screen.getByRole('switch', { name: 'admin.backup_database_enable_description' })).toBeInTheDocument();
      expect(field(container, 'admin.backup_keep_last_amount')).toBeInTheDocument();
    });
  });

  describe('when the server is on the S3 storage backend', () => {
    beforeEach(() => {
      mocks.featureFlags.s3Storage = true;
    });

    it('renders the toggle and the credentials hint', () => {
      render(BackupSettings);

      expect(screen.getByRole('switch', { name: 'admin.backup_s3_enabled' })).not.toBeChecked();
      expect(screen.getByText('admin.backup_s3_credentials_hint')).toBeInTheDocument();
    });

    // Nothing about the destination is configurable: the bucket comes from the media backend and the key
    // prefix is fixed at `backups/`, so the switch is the whole feature.
    it('offers no bucket or prefix field', () => {
      const { container } = render(BackupSettings);

      expect(field(container, 'admin.backup_s3_bucket')).toBeNull();
      expect(field(container, 'admin.backup_s3_prefix')).toBeNull();
    });

    it('saves the flag with the rest of the backup section', async () => {
      const user = userEvent.setup();
      render(BackupSettings);

      await user.click(screen.getByRole('switch', { name: 'admin.backup_s3_enabled' }));
      await user.click(screen.getByRole('button', { name: 'save' }));

      expect(mocks.saveConfig).toHaveBeenCalledWith({
        backup: {
          database: {
            enabled: true,
            cronExpression: '0 02 * * *',
            keepLastAmount: 14,
            s3: { enabled: true },
          },
        },
      });
    });

    it('reflects a config that already has it on', () => {
      mocks.systemConfig = makeConfig({ enabled: true });

      render(BackupSettings);

      expect(screen.getByRole('switch', { name: 'admin.backup_s3_enabled' })).toBeChecked();
    });

    // Config-file mode makes the whole section read-only upstream; the new control must follow.
    it('keeps the toggle disabled in config-file mode', () => {
      mocks.featureFlags.configFile = true;
      mocks.systemConfig = makeConfig({ enabled: true });

      render(BackupSettings);

      expect(screen.getByRole('switch', { name: 'admin.backup_s3_enabled' })).toBeDisabled();
    });
  });
});
