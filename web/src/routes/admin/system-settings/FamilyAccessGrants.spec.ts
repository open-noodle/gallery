import {
  FamilyAccessLevel,
  type FamilyAccessGrantResponseDto,
  type SystemConfigDto,
  type UserAdminResponseDto,
} from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FamilyAccessGrants from './FamilyAccessGrants.svelte';

// Gallery-fork: family relationships admin grant table (D2 layer 2). See D5.1's "two kinds of
// blank" applied to access — a user with no row in `getAllAccess()` inherits the instance
// default, and that must render (and behave) differently from a user who was explicitly granted
// `none`. Both end up denied, but only the explicit grant survives a change of default (E19).
const mocks = vi.hoisted(() => ({
  systemConfig: {} as SystemConfigDto,
  searchUsersAdmin: vi.fn(),
  getAllAccess: vi.fn(),
  setAccess: vi.fn(),
  deleteUnion: vi.fn(),
  removeParticipant: vi.fn(),
}));

vi.mock(import('$lib/managers/system-config-manager.svelte'), () => ({
  systemConfigManager: {
    get value() {
      return mocks.systemConfig;
    },
  } as never,
}));

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    searchUsersAdmin: mocks.searchUsersAdmin,
    getAllAccess: mocks.getAllAccess,
    setAccess: mocks.setAccess,
    deleteUnion: mocks.deleteUnion,
    removeParticipant: mocks.removeParticipant,
  };
});

const makeConfig = (enabled = true, defaultAccess: FamilyAccessLevel = FamilyAccessLevel.None): SystemConfigDto =>
  ({ familyTree: { enabled, defaultAccess } }) as unknown as SystemConfigDto;

const makeUser = (overrides: Partial<UserAdminResponseDto> = {}): UserAdminResponseDto =>
  ({ id: 'user-1', name: 'Alex', email: 'alex@example.com', ...overrides }) as UserAdminResponseDto;

const makeGrant = (overrides: Partial<FamilyAccessGrantResponseDto> = {}): FamilyAccessGrantResponseDto => ({
  userId: 'user-1',
  level: FamilyAccessLevel.Contribute,
  grantedById: null,
  grantedAt: '2026-08-12T10:00:00.000Z',
  ...overrides,
});

const selectRowByName = async (name: string) => {
  const rows = await screen.findAllByTestId('family-admin-access-row');
  const row = rows.find((candidate) => within(candidate).queryByText(name));
  if (!row) {
    throw new Error(`No row found for ${name}`);
  }
  return row;
};

// Svelte's select binding reads `:checked`, which happy-dom does not implement — mirror browser
// behavior the same way ClassificationSettings.spec.ts does for its own <select>.
const withCheckedWorkaround = async (select: HTMLSelectElement, run: () => Promise<void>) => {
  const spy = vi.spyOn(select, 'querySelector');
  spy.mockImplementation((selector: string) => {
    if (selector === ':checked') {
      return select.selectedOptions.item(0);
    }
    return Element.prototype.querySelector.call(select, selector);
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
};

describe('FamilyAccessGrants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.systemConfig = makeConfig();
    mocks.searchUsersAdmin.mockResolvedValue([]);
    mocks.getAllAccess.mockResolvedValue([]);
    mocks.setAccess.mockResolvedValue(undefined);
  });

  it('renders nothing when the family tree feature is disabled', async () => {
    mocks.systemConfig = makeConfig(false);
    mocks.searchUsersAdmin.mockResolvedValue([makeUser()]);

    render(FamilyAccessGrants);

    await waitFor(() => {
      expect(mocks.searchUsersAdmin).not.toHaveBeenCalled();
    });
    expect(screen.queryByTestId('family-admin-access-row')).not.toBeInTheDocument();
  });

  it('renders the table when it is enabled', async () => {
    mocks.searchUsersAdmin.mockResolvedValue([makeUser()]);
    mocks.getAllAccess.mockResolvedValue([makeGrant()]);

    render(FamilyAccessGrants);

    await waitFor(() => {
      expect(screen.getAllByTestId('family-admin-access-row')).toHaveLength(1);
    });
  });

  it('grants an individual user contribute access', async () => {
    mocks.searchUsersAdmin.mockResolvedValue([makeUser({ id: 'user-2', name: 'Mia' })]);
    mocks.getAllAccess.mockResolvedValue([]);
    mocks.setAccess.mockResolvedValue(
      makeGrant({ userId: 'user-2', level: FamilyAccessLevel.Contribute, grantedById: 'admin-1' }),
    );

    render(FamilyAccessGrants);
    const row = await selectRowByName('Mia');
    const select = within(row).getByLabelText('admin.family_admin_access_select_label') as HTMLSelectElement;

    const user = userEvent.setup();
    await withCheckedWorkaround(select, () => user.selectOptions(select, FamilyAccessLevel.Contribute));

    expect(mocks.setAccess).toHaveBeenCalledWith({
      userId: 'user-2',
      familyAccessUpdateDto: { level: FamilyAccessLevel.Contribute },
    });
  });

  it('shows a user as inheriting the default when they have no explicit grant', async () => {
    mocks.systemConfig = makeConfig(true, FamilyAccessLevel.Contribute);
    mocks.searchUsersAdmin.mockResolvedValue([makeUser({ id: 'user-3', name: 'Casper' })]);
    mocks.getAllAccess.mockResolvedValue([]);

    render(FamilyAccessGrants);
    const row = await selectRowByName('Casper');

    expect(within(row).getByText('admin.family_admin_inherits_default')).toBeInTheDocument();
  });

  it('distinguishes an explicit none from inheriting a default of none', async () => {
    mocks.systemConfig = makeConfig(true, FamilyAccessLevel.None);
    mocks.searchUsersAdmin.mockResolvedValue([
      makeUser({ id: 'user-lodger', name: 'Lodger' }),
      makeUser({ id: 'user-casper', name: 'Casper' }),
    ]);
    mocks.getAllAccess.mockResolvedValue([
      makeGrant({
        userId: 'user-lodger',
        level: FamilyAccessLevel.None,
        grantedById: 'admin-1',
        grantedAt: '2026-09-03T09:00:00.000Z',
      }),
    ]);

    render(FamilyAccessGrants);
    const lodgerRow = await selectRowByName('Lodger');
    const casperRow = await selectRowByName('Casper');

    // Both resolve to the same effective access...
    expect(within(lodgerRow).getByLabelText('admin.family_admin_access_select_label')).toHaveValue(
      FamilyAccessLevel.None,
    );
    expect(within(casperRow).getByLabelText('admin.family_admin_access_select_label')).toHaveValue(
      FamilyAccessLevel.None,
    );

    // ...but only Casper (no row at all) is "inherited". Lodger holds a real override and must
    // not be shown as merely following the default (A11's distinct-state requirement).
    expect(within(lodgerRow).queryByText('admin.family_admin_inherits_default')).not.toBeInTheDocument();
    expect(within(casperRow).getByText('admin.family_admin_inherits_default')).toBeInTheDocument();
  });

  it('leaves explicit grants untouched when the instance default is changed', async () => {
    mocks.systemConfig = makeConfig(true, FamilyAccessLevel.None);
    mocks.searchUsersAdmin.mockResolvedValue([makeUser({ id: 'user-2', name: 'Mia' })]);
    mocks.getAllAccess.mockResolvedValue([makeGrant({ userId: 'user-2', level: FamilyAccessLevel.View })]);

    const { unmount } = render(FamilyAccessGrants);
    let row = await selectRowByName('Mia');
    expect(within(row).getByLabelText('admin.family_admin_access_select_label')).toHaveValue(FamilyAccessLevel.View);
    unmount();

    // The instance default changes underneath Mia's explicit grant...
    mocks.systemConfig = makeConfig(true, FamilyAccessLevel.Contribute);
    render(FamilyAccessGrants);
    row = await selectRowByName('Mia');

    // ...but her explicit grant is untouched: still `view`, not the new default.
    expect(within(row).getByLabelText('admin.family_admin_access_select_label')).toHaveValue(FamilyAccessLevel.View);
    // Changing the default never calls the grant endpoint on her behalf.
    expect(mocks.setAccess).not.toHaveBeenCalled();
  });

  it('applies the new default to a user who has no explicit grant', async () => {
    mocks.systemConfig = makeConfig(true, FamilyAccessLevel.None);
    mocks.searchUsersAdmin.mockResolvedValue([makeUser({ id: 'user-3', name: 'Casper' })]);
    mocks.getAllAccess.mockResolvedValue([]);

    const { unmount } = render(FamilyAccessGrants);
    let row = await selectRowByName('Casper');
    expect(within(row).getByLabelText('admin.family_admin_access_select_label')).toHaveValue(FamilyAccessLevel.None);
    unmount();

    mocks.systemConfig = makeConfig(true, FamilyAccessLevel.Contribute);
    render(FamilyAccessGrants);
    row = await selectRowByName('Casper');

    // Casper has no explicit row, so he follows the new default...
    expect(within(row).getByLabelText('admin.family_admin_access_select_label')).toHaveValue(
      FamilyAccessLevel.Contribute,
    );
    // ...and still nothing was ever written on his behalf.
    expect(mocks.setAccess).not.toHaveBeenCalled();
  });

  it('records who granted access and when', async () => {
    mocks.searchUsersAdmin.mockResolvedValue([
      makeUser({ id: 'admin-1', name: 'Alex' }),
      makeUser({ id: 'user-2', name: 'Mia' }),
    ]);
    mocks.getAllAccess.mockResolvedValue([
      makeGrant({
        userId: 'user-2',
        level: FamilyAccessLevel.Contribute,
        grantedById: 'admin-1',
        grantedAt: '2026-08-12T10:00:00.000Z',
      }),
    ]);

    render(FamilyAccessGrants);
    const row = await selectRowByName('Mia');

    expect(within(row).getByText('Alex · 12 Aug')).toBeInTheDocument();
  });

  it('keeps the relationships a user recorded after their access is revoked', async () => {
    mocks.searchUsersAdmin.mockResolvedValue([makeUser({ id: 'user-2', name: 'Mia' })]);
    mocks.getAllAccess.mockResolvedValue([makeGrant({ userId: 'user-2', level: FamilyAccessLevel.Contribute })]);
    mocks.setAccess.mockResolvedValue(makeGrant({ userId: 'user-2', level: FamilyAccessLevel.None }));

    render(FamilyAccessGrants);
    const row = await selectRowByName('Mia');
    const select = within(row).getByLabelText('admin.family_admin_access_select_label') as HTMLSelectElement;

    const user = userEvent.setup();
    await withCheckedWorkaround(select, () => user.selectOptions(select, FamilyAccessLevel.None));

    expect(mocks.setAccess).toHaveBeenCalledWith({
      userId: 'user-2',
      familyAccessUpdateDto: { level: FamilyAccessLevel.None },
    });
    // Revocation is a grant change, never a delete of the relationships the user recorded.
    expect(mocks.deleteUnion).not.toHaveBeenCalled();
    expect(mocks.removeParticipant).not.toHaveBeenCalled();
  });
});
