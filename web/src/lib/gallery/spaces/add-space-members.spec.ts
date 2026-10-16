import { addMember, type SharedSpaceMemberResponseDto, type UserResponseDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { showAddSpaceMembersModal } from '$lib/gallery/spaces/add-space-members';
import AddUsersModal from '$lib/modals/AddUsersModal.svelte';
import { handleError } from '$lib/utils/handle-error';

vi.mock('@immich/ui', async (orig) => ({
  ...(await orig<typeof import('@immich/ui')>()),
  modalManager: { show: vi.fn() },
}));
vi.mock('@immich/sdk', async (orig) => ({ ...(await orig<typeof import('@immich/sdk')>()), addMember: vi.fn() }));
vi.mock('$lib/utils/handle-error', () => ({ handleError: vi.fn() }));

type ModalProps = { excludedUserIds: string[]; onAddUsers: (users: UserResponseDto[]) => Promise<boolean> };

const user = (id: string) => ({ id, name: `name-${id}` }) as UserResponseDto;
const member = (userId: string) => ({ userId }) as SharedSpaceMemberResponseDto;

describe('showAddSpaceMembersModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens upstream AddUsersModal without the existing members', async () => {
    vi.mocked(modalManager.show).mockResolvedValue(undefined as never);

    await expect(showAddSpaceMembersModal('s1', ['u1'])).resolves.toEqual([]);

    expect(modalManager.show).toHaveBeenCalledWith(
      AddUsersModal,
      expect.objectContaining({ excludedUserIds: ['u1'], emptyMessage: 'spaces_no_users_to_add' }),
    );
    expect(addMember).not.toHaveBeenCalled();
  });

  it('adds every picked user, reports a refused one and resolves to the members added', async () => {
    vi.mocked(addMember).mockImplementation(({ sharedSpaceMemberCreateDto: { userId } }) =>
      userId === 'u3' ? Promise.reject(new Error('refused')) : Promise.resolve(member(userId)),
    );
    vi.mocked(modalManager.show).mockImplementation(async (...args: unknown[]) => {
      await expect((args[1] as ModalProps).onAddUsers([user('u2'), user('u3'), user('u4')])).resolves.toBe(true);
      return undefined as never;
    });

    await expect(showAddSpaceMembersModal('s1', [])).resolves.toEqual([member('u2'), member('u4')]);

    expect(addMember).toHaveBeenCalledWith({ id: 's1', sharedSpaceMemberCreateDto: { userId: 'u3' } });
    expect(handleError).toHaveBeenCalledOnce();
  });
});
