import { DefaultAccess, type AdminConfigDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import FamilySettings from './FamilySettings.svelte';

// Gallery-fork: family relationships admin settings — the instance-wide toggle and default
// access level (D2 layer 1). The per-user grant table (D2 layer 2) is a separate component,
// `FamilyAccessGrants.svelte`, rendered beneath these controls and covered by its own spec.
// It talks to the family admin endpoints directly, so those are stubbed here to keep this file
// focused on the config-only controls.
vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getAllAccess: vi.fn().mockResolvedValue([]),
    searchUsersAdmin: vi.fn().mockResolvedValue([]),
    setAccess: vi.fn(),
  };
});

const makeConfig = (enabled = false, defaultAccess: DefaultAccess = DefaultAccess.None): AdminConfigDto =>
  ({
    familyTree: { enabled, defaultAccess },
  }) as unknown as AdminConfigDto;

const mocks = vi.hoisted(() => ({
  featureFlags: { configFile: false },
  systemConfig: {} as AdminConfigDto,
  defaultSystemConfig: {} as AdminConfigDto,
  saveConfig: vi.fn(),
}));

vi.mock(import('#lib/managers/feature-flags-manager.svelte.ts'), () => ({
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

describe('FamilySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureFlags.configFile = false;
    mocks.systemConfig = makeConfig();
    mocks.defaultSystemConfig = makeConfig();
  });

  it('turns the family tree feature on and off', async () => {
    const user = userEvent.setup();
    await render(FamilySettings);

    const toggle = page.getByRole('switch', { name: 'admin.family_admin_enable_title' }).element();
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    await user.click(page.getByRole('button', { name: 'save' }).element());

    expect(mocks.saveConfig).toHaveBeenCalledWith({
      familyTree: { enabled: true, defaultAccess: DefaultAccess.None },
    });
  });

  it('sets the instance-wide default access level', async () => {
    mocks.systemConfig = makeConfig(true, DefaultAccess.None);
    mocks.defaultSystemConfig = makeConfig(true, DefaultAccess.None);

    const user = userEvent.setup();
    await render(FamilySettings);

    const select = page.getByLabelText('admin.family_admin_default_access_label').element() as HTMLSelectElement;
    // Svelte's select binding reads `:checked`; mirror browser behavior since happy-dom does not.
    const querySelectedOption = vi.spyOn(select, 'querySelector');
    querySelectedOption.mockImplementation((selector: string) => {
      if (selector === ':checked') {
        return select.selectedOptions.item(0);
      }
      return Element.prototype.querySelector.call(select, selector);
    });

    try {
      await user.selectOptions(select, DefaultAccess.Contribute);
      await user.click(page.getByRole('button', { name: 'save' }).element());
    } finally {
      querySelectedOption.mockRestore();
    }

    expect(mocks.saveConfig).toHaveBeenCalledWith({
      familyTree: { enabled: true, defaultAccess: DefaultAccess.Contribute },
    });
  });

  it('offers exactly none, view and contribute as default access levels', async () => {
    mocks.systemConfig = makeConfig(true, DefaultAccess.View);

    await render(FamilySettings);

    const select = page.getByLabelText('admin.family_admin_default_access_label').element() as HTMLSelectElement;
    const values = [...select.options].map((option) => option.value);

    expect(values).toEqual([DefaultAccess.None, DefaultAccess.View, DefaultAccess.Contribute]);
  });
});
