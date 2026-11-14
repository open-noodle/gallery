import type { AdminConfigDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
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
  saveConfig: vi.fn(),
}));

vi.mock(import('#lib/managers/feature-flags-manager.svelte.js'), () => ({
  featureFlagsManager: {
    get value() {
      return mocks.featureFlags;
    },
  } as never,
}));

vi.mock(import('#lib/queries/client.js'), async (importOriginal) => ({
  ...(await importOriginal()),
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
`SettingInputField` renders `aria-labelledby="<label>-label"` pointing at an id that does not exist, so its
inputs have no accessible name and `getByLabelText` cannot find them. They are addressed by the `name`
attribute the component sets from the label instead.
*/
const field = (container: HTMLElement, label: string) =>
  container.querySelector<HTMLInputElement>(`input[name="${CSS.escape(label)}"]`);

describe('BackupSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureFlags.configFile = false;
    mocks.systemConfig = makeConfig();
    mocks.defaultSystemConfig = makeConfig();
  });

  it('shows the destination selector regardless of the media backend', async () => {
    await render(BackupSettings);

    expect(page.getByRole('combobox', { name: 'admin.backup_destination', exact: true }).element()).toHaveValue('local');
  });

  it('shows the cloud configuration hint only for cloud destinations', async () => {
    await render(BackupSettings);

    expect(page.getByText('admin.backup_destination_cloud_hint', { exact: true }).query()).not.toBeInTheDocument();
    await userEvent.selectOptions(
      page.getByRole('combobox', { name: 'admin.backup_destination', exact: true }),
      'cloud',
    );
    expect(page.getByText('admin.backup_destination_cloud_hint', { exact: true }).element()).toBeInTheDocument();
  });

  it('still renders the upstream backup options', async () => {
    const { container } = await render(BackupSettings);

    expect(
      page.getByRole('switch', { name: 'admin.backup_database_enable_description', exact: true }).element(),
    ).toBeInTheDocument();
    expect(field(container, 'admin.backup_keep_last_amount')).toBeInTheDocument();
  });

  it('saves the selected destination with the rest of the backup section', async () => {
    await render(BackupSettings);

    await userEvent.selectOptions(
      page.getByRole('combobox', { name: 'admin.backup_destination', exact: true }),
      'cloud',
    );
    await userEvent.click(page.getByRole('button', { name: 'save', exact: true }));

    expect(mocks.saveConfig).toHaveBeenCalledWith({
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
    mocks.systemConfig = makeConfig('cloud', true);
    await render(BackupSettings);

    await userEvent.selectOptions(
      page.getByRole('combobox', { name: 'admin.backup_destination', exact: true }),
      'both',
    );
    await userEvent.click(page.getByRole('button', { name: 'save', exact: true }));

    expect(mocks.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        backup: {
          database: expect.objectContaining({ destination: 'both', s3: { enabled: false } }),
        },
      }),
    );
  });

  it('can switch a legacy cloud destination to the independent cloud target directly', async () => {
    mocks.systemConfig = makeConfig('cloud', true);
    await render(BackupSettings);

    expect(page.getByText('admin.backup_destination_legacy_hint', { exact: true }).element()).toBeInTheDocument();
    await userEvent.click(
      page.getByRole('button', { name: 'admin.backup_destination_use_independent', exact: true }),
    );
    await userEvent.click(page.getByRole('button', { name: 'save', exact: true }));

    expect(mocks.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        backup: {
          database: expect.objectContaining({ destination: 'cloud', s3: { enabled: false } }),
        },
      }),
    );
  });

  it('keeps the selector disabled in config-file mode', async () => {
    mocks.featureFlags.configFile = true;

    await render(BackupSettings);

    expect(page.getByRole('combobox', { name: 'admin.backup_destination', exact: true }).element()).toBeDisabled();
  });

  it('fails closed when the server does not return the destination field', async () => {
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

    await render(BackupSettings);

    expect(page.getByRole('combobox', { name: 'admin.backup_destination', exact: true }).element()).toBeDisabled();
    expect(page.getByText('admin.backup_destination_cloud_hint', { exact: true }).query()).not.toBeInTheDocument();
  });
});
