import { UserAvatarColor } from 'src/enum';
import { UserGroupService } from 'src/services/user-group.service';
import { factory, newDate, newUuid } from 'test/small.factory';
import { newTestService, ServiceMocks } from 'test/utils';

const makeGroup = (overrides: Record<string, unknown> = {}) => ({
  id: newUuid(),
  name: 'Family A',
  color: null as string | null,
  origin: 'manual',
  createdById: newUuid(),
  createdAt: newDate(),
  updatedAt: newDate(),
  ...overrides,
});

const makeMember = (overrides: Record<string, unknown> = {}) => ({
  groupId: newUuid(),
  userId: newUuid(),
  addedAt: newDate(),
  name: 'Test User',
  email: 'test@example.com',
  profileImagePath: '',
  profileChangedAt: newDate(),
  avatarColor: null,
  ...overrides,
});

describe(UserGroupService.name, () => {
  let sut: UserGroupService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(UserGroupService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('create', () => {
    it('should create a group with name and default null color', async () => {
      const auth = factory.auth();
      const group = makeGroup({ createdById: auth.user.id });
      mocks.userGroup.create.mockResolvedValue(group);
      mocks.userGroup.getMembers.mockResolvedValue([]);

      const result = await sut.create(auth, { name: 'Family A' });

      expect(result.id).toBe(group.id);
      expect(result.name).toBe('Family A');
      expect(result.members).toEqual([]);
      expect(mocks.userGroup.create).toHaveBeenCalledWith({
        name: 'Family A',
        color: null,
        createdById: auth.user.id,
      });
    });

    it('should pass color when provided', async () => {
      const auth = factory.auth();
      const group = makeGroup({ createdById: auth.user.id, color: 'blue' });
      mocks.userGroup.create.mockResolvedValue(group);
      mocks.userGroup.getMembers.mockResolvedValue([]);

      await sut.create(auth, { name: 'Family A', color: UserAvatarColor.Blue });

      expect(mocks.userGroup.create).toHaveBeenCalledWith({
        name: 'Family A',
        color: 'blue',
        createdById: auth.user.id,
      });
    });
  });
});
