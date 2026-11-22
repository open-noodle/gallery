import type { AdminConfigDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import SystemConfigButtonRow from './SystemConfigButtonRow.svelte';

const mocks = vi.hoisted(() => ({
  systemConfig: { storageUsage: { includeDerivatives: true } },
  defaultSystemConfig: { storageUsage: { includeDerivatives: false } },
  saveConfig: vi.fn(),
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

const renderRow = (disabled: boolean) =>
  render(SystemConfigButtonRow, {
    disabled,
    keys: ['storageUsage'],
    configToEdit: structuredClone(mocks.systemConfig) as AdminConfigDto,
  });

describe('SystemConfigButtonRow (Gallery)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Gallery issue #1245: with IMMICH_CONFIG_FILE set, Save and Reset are disabled but
  // "Reset to default" stayed clickable, flipping the form to values that could never be saved.
  it('disables reset to default when the settings are read-only (config file)', async () => {
    await renderRow(true);

    await expect.element(page.getByRole('button', { name: 'reset_to_default', exact: true })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'save', exact: true })).toBeDisabled();
  });

  it('keeps reset to default enabled when the settings are editable', async () => {
    await renderRow(false);

    await expect.element(page.getByRole('button', { name: 'reset_to_default', exact: true })).toBeEnabled();
  });
});
