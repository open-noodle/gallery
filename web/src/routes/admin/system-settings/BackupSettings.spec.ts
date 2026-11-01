import type { AdminConfigDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSystemConfigSave } from '$lib/services/system-config.service';
import BackupSettings from './BackupSettings.svelte';

const makeConfig = (destination: 'local' | 'cloud' | 'both' = 'local', legacyS3 = false) =>
  ({
    backup: {
      database: {
        enabled: true,
        cronExpression: '0 02 * * *',
        keepLastAmount: 14,
        destination,
        s3: { enabled: legacyS3 },
      },
    },
  }) as AdminConfigDto;

const mocks = vi.hoisted(() => ({
  featureFlags: { configFile: false },
  systemConfig: {} as AdminConfigDto,
  defaultSystemConfig: {} as AdminConfigDto,
  cloneValue: vi.fn(),
  cloneDefaultValue: vi.fn(),
}));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: {
    get value() {
      return mocks.featureFlags;
    },
  } as never,
}));

vi.mock(import('$lib/managers/system-config-manager.svelte'), () => ({
  systemConfigManager: {
    get value() {
      return mocks.systemConfig;
    },
    get defaultValue() {
      return mocks.defaultSystemConfig;
    },
    cloneValue: mocks.cloneValue,
    cloneDefaultValue: mocks.cloneDefaultValue,
  } as never,
}));

vi.mock(import('$lib/services/system-config.service'), () => ({
  handleSystemConfigSave: vi.fn(),
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
    mocks.systemConfig = makeConfig();
    mocks.defaultSystemConfig = makeConfig();
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));
    mocks.cloneDefaultValue.mockImplementation(() => structuredClone(mocks.defaultSystemConfig));
  });

  it('shows the destination selector regardless of the media backend', () => {
    render(BackupSettings);

    expect(screen.getByRole('combobox', { name: 'admin.backup_destination' })).toHaveValue('local');
  });

  it('shows the cloud configuration hint only for cloud destinations', async () => {
    const user = userEvent.setup();
    render(BackupSettings);

    expect(screen.queryByText('admin.backup_destination_cloud_hint')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'admin.backup_destination' }), 'cloud');
    expect(screen.getByText('admin.backup_destination_cloud_hint')).toBeInTheDocument();
  });

  it('still renders the upstream backup options', () => {
    const { container } = render(BackupSettings);

    expect(screen.getByRole('switch', { name: 'admin.backup_database_enable_description' })).toBeInTheDocument();
    expect(field(container, 'admin.backup_keep_last_amount')).toBeInTheDocument();
  });

  it('saves the selected destination with the rest of the backup section', async () => {
    const user = userEvent.setup();
    render(BackupSettings);

    await user.selectOptions(screen.getByRole('combobox', { name: 'admin.backup_destination' }), 'cloud');
    await user.click(screen.getByRole('button', { name: 'save' }));

    expect(handleSystemConfigSave).toHaveBeenCalledWith({
      backup: {
        database: {
          enabled: true,
          cronExpression: '0 02 * * *',
          keepLastAmount: 14,
          destination: 'cloud',
          s3: { enabled: false },
        },
      },
    });
  });

  it('clears the deprecated S3 flag when selecting a new destination', async () => {
    const user = userEvent.setup();
    mocks.systemConfig = makeConfig('cloud', true);
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));
    render(BackupSettings);

    await user.selectOptions(screen.getByRole('combobox', { name: 'admin.backup_destination' }), 'both');
    await user.click(screen.getByRole('button', { name: 'save' }));

    expect(handleSystemConfigSave).toHaveBeenCalledWith(
      expect.objectContaining({
        backup: {
          database: expect.objectContaining({ destination: 'both', s3: { enabled: false } }),
        },
      }),
    );
  });

  it('can switch a legacy cloud destination to the independent cloud target directly', async () => {
    const user = userEvent.setup();
    mocks.systemConfig = makeConfig('cloud', true);
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));
    render(BackupSettings);

    expect(screen.getByText('admin.backup_destination_legacy_hint')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'admin.backup_destination_use_independent' }));
    await user.click(screen.getByRole('button', { name: 'save' }));

    expect(handleSystemConfigSave).toHaveBeenCalledWith(
      expect.objectContaining({
        backup: {
          database: expect.objectContaining({ destination: 'cloud', s3: { enabled: false } }),
        },
      }),
    );
  });

  it('keeps the selector disabled in config-file mode', () => {
    mocks.featureFlags.configFile = true;

    render(BackupSettings);

    expect(screen.getByRole('combobox', { name: 'admin.backup_destination' })).toBeDisabled();
  });

  it('fails closed when the server does not return the destination field', () => {
    mocks.systemConfig = {
      backup: {
        database: {
          enabled: true,
          cronExpression: '0 02 * * *',
          keepLastAmount: 14,
          s3: { enabled: false },
        },
      },
    } as AdminConfigDto;
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));

    render(BackupSettings);

    expect(screen.getByRole('combobox', { name: 'admin.backup_destination' })).toBeDisabled();
    expect(screen.queryByText('admin.backup_destination_cloud_hint')).not.toBeInTheDocument();
  });
});
