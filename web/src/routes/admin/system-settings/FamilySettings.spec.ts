import { DefaultAccess, type SystemConfigDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSystemConfigSave } from '$lib/services/system-config.service';
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

const makeConfig = (enabled = false, defaultAccess: DefaultAccess = DefaultAccess.None): SystemConfigDto =>
  ({
    familyTree: { enabled, defaultAccess },
  }) as unknown as SystemConfigDto;

const mocks = vi.hoisted(() => ({
  featureFlags: { configFile: false },
  systemConfig: {} as SystemConfigDto,
  defaultSystemConfig: {} as SystemConfigDto,
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
      return mocks.systemConfig as SystemConfigDto;
    },
    get defaultValue() {
      return mocks.defaultSystemConfig as SystemConfigDto;
    },
    cloneValue: mocks.cloneValue,
    cloneDefaultValue: mocks.cloneDefaultValue,
  } as never,
}));

vi.mock(import('$lib/services/system-config.service'), () => ({
  handleSystemConfigSave: vi.fn(),
}));

describe('FamilySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureFlags.configFile = false;
    mocks.systemConfig = makeConfig();
    mocks.defaultSystemConfig = makeConfig();
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));
    mocks.cloneDefaultValue.mockImplementation(() => structuredClone(mocks.defaultSystemConfig));
  });

  it('turns the family tree feature on and off', async () => {
    const user = userEvent.setup();
    render(FamilySettings);

    const toggle = screen.getByRole('switch', { name: 'admin.family_admin_enable_title' });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'save' }));

    expect(handleSystemConfigSave).toHaveBeenCalledWith({
      familyTree: { enabled: true, defaultAccess: DefaultAccess.None },
    });
  });

  it('sets the instance-wide default access level', async () => {
    mocks.systemConfig = makeConfig(true, DefaultAccess.None);
    mocks.defaultSystemConfig = makeConfig(true, DefaultAccess.None);
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));

    const user = userEvent.setup();
    render(FamilySettings);

    const select = screen.getByLabelText('admin.family_admin_default_access_label') as HTMLSelectElement;
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
      await user.click(screen.getByRole('button', { name: 'save' }));
    } finally {
      querySelectedOption.mockRestore();
    }

    expect(handleSystemConfigSave).toHaveBeenCalledWith({
      familyTree: { enabled: true, defaultAccess: DefaultAccess.Contribute },
    });
  });

  it('offers exactly none, view and contribute as default access levels', () => {
    mocks.systemConfig = makeConfig(true, DefaultAccess.View);
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));

    render(FamilySettings);

    const select = screen.getByLabelText('admin.family_admin_default_access_label') as HTMLSelectElement;
    const values = [...select.options].map((option) => option.value);

    expect(values).toEqual([DefaultAccess.None, DefaultAccess.View, DefaultAccess.Contribute]);
  });
});
