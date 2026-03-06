import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MapMarkerResponseDto } from 'src/dtos/map.dto';
import { SharedSpaceRole } from 'src/enum';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { factory, newDate, newUuid } from 'test/small.factory';
import { newTestService, ServiceMocks } from 'test/utils';

/** Helper to build a joined member result (member + user fields from the repo join). */
const makeMemberResult = (overrides: Record<string, unknown> = {}) => ({
  ...factory.sharedSpaceMember(),
  name: 'Test User',
  email: 'test@immich.cloud',
  profileImagePath: '',
  profileChangedAt: newDate(),
  avatarColor: null,
  showInTimeline: true,
  ...overrides,
});

describe(SharedSpaceService.name, () => {
  let sut: SharedSpaceService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(SharedSpaceService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('create', () => {
    it('should create space and add creator as owner', async () => {
      const auth = factory.auth();
      const space = factory.sharedSpace({ createdById: auth.user.id });

      mocks.sharedSpace.create.mockResolvedValue(space);
      mocks.sharedSpace.addMember.mockResolvedValue(
        factory.sharedSpaceMember({
          spaceId: space.id,
          userId: auth.user.id,
          role: SharedSpaceRole.Owner,
        }),
      );

      const result = await sut.create(auth, { name: 'Test Space' });

      expect(result.id).toBe(space.id);
      expect(result.name).toBe('Test Space');
      expect(result.createdById).toBe(auth.user.id);

      expect(mocks.sharedSpace.create).toHaveBeenCalledWith({
        name: 'Test Space',
        description: null,
        createdById: auth.user.id,
      });

      expect(mocks.sharedSpace.addMember).toHaveBeenCalledWith({
        spaceId: space.id,
        userId: auth.user.id,
        role: SharedSpaceRole.Owner,
      });
    });

    it('should pass description when provided', async () => {
      const auth = factory.auth();
      const space = factory.sharedSpace({ createdById: auth.user.id, description: 'A cool space' });

      mocks.sharedSpace.create.mockResolvedValue(space);
      mocks.sharedSpace.addMember.mockResolvedValue(
        factory.sharedSpaceMember({
          spaceId: space.id,
          userId: auth.user.id,
          role: SharedSpaceRole.Owner,
        }),
      );

      const result = await sut.create(auth, { name: 'Test Space', description: 'A cool space' });

      expect(result.description).toBe('A cool space');
      expect(mocks.sharedSpace.create).toHaveBeenCalledWith({
        name: 'Test Space',
        description: 'A cool space',
        createdById: auth.user.id,
      });
    });
  });

  describe('getAll', () => {
    it('should return all spaces for user', async () => {
      const auth = factory.auth();
      const space1 = factory.sharedSpace({ name: 'Space 1' });
      const space2 = factory.sharedSpace({ name: 'Space 2' });

      mocks.sharedSpace.getAllByUserId.mockResolvedValue([space1, space2]);

      const result = await sut.getAll(auth);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Space 1');
      expect(result[1].name).toBe('Space 2');
      expect(mocks.sharedSpace.getAllByUserId).toHaveBeenCalledWith(auth.user.id);
    });
  });

  describe('get', () => {
    it('should return space with counts when user is member', async () => {
      const auth = factory.auth();
      const space = factory.sharedSpace();
      const member = makeMemberResult({
        spaceId: space.id,
        userId: auth.user.id,
        role: SharedSpaceRole.Viewer,
      });

      mocks.sharedSpace.getMember.mockResolvedValue(member);
      mocks.sharedSpace.getById.mockResolvedValue(space);
      mocks.sharedSpace.getMembers.mockResolvedValue([member, makeMemberResult()]);
      mocks.sharedSpace.getAssetCount.mockResolvedValue(5);

      const result = await sut.get(auth, space.id);

      expect(result.id).toBe(space.id);
      expect(result.memberCount).toBe(2);
      expect(result.assetCount).toBe(5);
    });

    it('should throw when user is not member', async () => {
      const auth = factory.auth();

      mocks.sharedSpace.getMember.mockResolvedValue(void 0);

      await expect(sut.get(auth, newUuid())).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('update', () => {
    it('should update when user is owner', async () => {
      const auth = factory.auth();
      const space = factory.sharedSpace();
      const member = makeMemberResult({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Owner });
      const updatedSpace = { ...space, name: 'Updated Name' };

      mocks.sharedSpace.getMember.mockResolvedValue(member);
      mocks.sharedSpace.update.mockResolvedValue(updatedSpace);

      const result = await sut.update(auth, space.id, { name: 'Updated Name' });

      expect(result.name).toBe('Updated Name');
      expect(mocks.sharedSpace.update).toHaveBeenCalledWith(space.id, {
        name: 'Updated Name',
        description: undefined,
      });
    });

    it('should throw when user is editor', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const member = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Editor });

      mocks.sharedSpace.getMember.mockResolvedValue(member);

      await expect(sut.update(auth, spaceId, { name: 'New Name' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should throw when user is viewer', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const member = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Viewer });

      mocks.sharedSpace.getMember.mockResolvedValue(member);

      await expect(sut.update(auth, spaceId, { name: 'New Name' })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('should remove when user is owner', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const member = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Owner });

      mocks.sharedSpace.getMember.mockResolvedValue(member);
      mocks.sharedSpace.remove.mockResolvedValue(void 0);

      await sut.remove(auth, spaceId);

      expect(mocks.sharedSpace.remove).toHaveBeenCalledWith(spaceId);
    });

    it('should throw when non-owner tries to delete', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const member = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Editor });

      mocks.sharedSpace.getMember.mockResolvedValue(member);

      await expect(sut.remove(auth, spaceId)).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.sharedSpace.remove).not.toHaveBeenCalled();
    });
  });

  describe('getMembers', () => {
    it('should return members when user is a member', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const member1 = makeMemberResult({
        spaceId,
        userId: auth.user.id,
        role: SharedSpaceRole.Owner,
        name: 'Owner User',
      });
      const member2 = makeMemberResult({ spaceId, role: SharedSpaceRole.Viewer, name: 'Viewer User' });

      mocks.sharedSpace.getMember.mockResolvedValue(member1);
      mocks.sharedSpace.getMembers.mockResolvedValue([member1, member2]);

      const result = await sut.getMembers(auth, spaceId);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Owner User');
      expect(result[1].name).toBe('Viewer User');
    });
  });

  describe('addMember', () => {
    it('should add member with default viewer role', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const newUserId = newUuid();
      const ownerMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Owner });
      const newMember = makeMemberResult({
        spaceId,
        userId: newUserId,
        role: SharedSpaceRole.Viewer,
        name: 'New User',
      });

      mocks.sharedSpace.getMember
        .mockResolvedValueOnce(ownerMember) // requireRole check
        .mockResolvedValueOnce(void 0) // duplicate check
        .mockResolvedValueOnce(newMember); // fetch after add
      mocks.sharedSpace.addMember.mockResolvedValue(
        factory.sharedSpaceMember({
          spaceId,
          userId: newUserId,
          role: SharedSpaceRole.Viewer,
        }),
      );

      const result = await sut.addMember(auth, spaceId, { userId: newUserId });

      expect(result.userId).toBe(newUserId);
      expect(result.name).toBe('New User');
      expect(mocks.sharedSpace.addMember).toHaveBeenCalledWith({
        spaceId,
        userId: newUserId,
        role: SharedSpaceRole.Viewer,
      });
    });

    it('should throw if user is already a member', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const existingUserId = newUuid();
      const ownerMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Owner });
      const existingMember = makeMemberResult({ spaceId, userId: existingUserId });

      mocks.sharedSpace.getMember
        .mockResolvedValueOnce(ownerMember) // requireRole check
        .mockResolvedValueOnce(existingMember); // duplicate check

      await expect(sut.addMember(auth, spaceId, { userId: existingUserId })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.sharedSpace.addMember).not.toHaveBeenCalled();
    });

    it('should throw if non-owner tries to add', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const editorMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Editor });

      mocks.sharedSpace.getMember.mockResolvedValue(editorMember);

      await expect(sut.addMember(auth, spaceId, { userId: newUuid() })).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.sharedSpace.addMember).not.toHaveBeenCalled();
    });
  });

  describe('updateMember', () => {
    it('should change role', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const targetUserId = newUuid();
      const ownerMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Owner });
      const updatedMember = makeMemberResult({ spaceId, userId: targetUserId, role: SharedSpaceRole.Editor });

      mocks.sharedSpace.getMember
        .mockResolvedValueOnce(ownerMember) // requireRole check
        .mockResolvedValueOnce(updatedMember); // fetch after update
      mocks.sharedSpace.updateMember.mockResolvedValue(
        factory.sharedSpaceMember({
          spaceId,
          userId: targetUserId,
          role: SharedSpaceRole.Editor,
        }),
      );

      const result = await sut.updateMember(auth, spaceId, targetUserId, { role: SharedSpaceRole.Editor });

      expect(result.role).toBe(SharedSpaceRole.Editor);
      expect(mocks.sharedSpace.updateMember).toHaveBeenCalledWith(spaceId, targetUserId, {
        role: SharedSpaceRole.Editor,
      });
    });

    it('should throw when changing own role', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const ownerMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Owner });

      mocks.sharedSpace.getMember.mockResolvedValue(ownerMember);

      await expect(
        sut.updateMember(auth, spaceId, auth.user.id, { role: SharedSpaceRole.Editor }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.sharedSpace.updateMember).not.toHaveBeenCalled();
    });

    it('should throw if non-owner tries to change role', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const editorMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Editor });

      mocks.sharedSpace.getMember.mockResolvedValue(editorMember);

      await expect(sut.updateMember(auth, spaceId, newUuid(), { role: SharedSpaceRole.Editor })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mocks.sharedSpace.updateMember).not.toHaveBeenCalled();
    });

    it('should allow any member to toggle their own showInTimeline', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const viewerMember = makeMemberResult({
        spaceId,
        userId: auth.user.id,
        role: SharedSpaceRole.Viewer,
        showInTimeline: true,
      });
      const updatedMember = makeMemberResult({
        spaceId,
        userId: auth.user.id,
        role: SharedSpaceRole.Viewer,
        showInTimeline: false,
      });

      mocks.sharedSpace.getMember
        .mockResolvedValueOnce(viewerMember) // requireMembership check
        .mockResolvedValueOnce(updatedMember); // fetch after update
      mocks.sharedSpace.updateMember.mockResolvedValue(
        factory.sharedSpaceMember({
          spaceId,
          userId: auth.user.id,
          showInTimeline: false,
        }),
      );

      const result = await sut.updateMemberTimeline(auth, spaceId, { showInTimeline: false });

      expect(result.showInTimeline).toBe(false);
      expect(mocks.sharedSpace.updateMember).toHaveBeenCalledWith(spaceId, auth.user.id, {
        showInTimeline: false,
      });
    });

    it('should throw when non-member tries to toggle timeline', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();

      mocks.sharedSpace.getMember.mockResolvedValue(void 0);

      await expect(sut.updateMemberTimeline(auth, spaceId, { showInTimeline: false })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('removeMember', () => {
    it('should allow owner to remove others', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const targetUserId = newUuid();
      const ownerMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Owner });

      mocks.sharedSpace.getMember.mockResolvedValue(ownerMember);
      mocks.sharedSpace.removeMember.mockResolvedValue(void 0);

      await sut.removeMember(auth, spaceId, targetUserId);

      expect(mocks.sharedSpace.removeMember).toHaveBeenCalledWith(spaceId, targetUserId);
    });

    it('should allow non-owner to leave (self-remove)', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const viewerMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Viewer });

      mocks.sharedSpace.getMember.mockResolvedValue(viewerMember);
      mocks.sharedSpace.removeMember.mockResolvedValue(void 0);

      await sut.removeMember(auth, spaceId, auth.user.id);

      expect(mocks.sharedSpace.removeMember).toHaveBeenCalledWith(spaceId, auth.user.id);
    });

    it('should throw if owner tries to leave', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const ownerMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Owner });

      mocks.sharedSpace.getMember.mockResolvedValue(ownerMember);

      await expect(sut.removeMember(auth, spaceId, auth.user.id)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.sharedSpace.removeMember).not.toHaveBeenCalled();
    });

    it('should throw if non-owner tries to remove others', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const viewerMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Viewer });

      mocks.sharedSpace.getMember.mockResolvedValue(viewerMember);

      await expect(sut.removeMember(auth, spaceId, newUuid())).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.sharedSpace.removeMember).not.toHaveBeenCalled();
    });
  });

  describe('addAssets', () => {
    it('should add assets when editor', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const assetId1 = newUuid();
      const assetId2 = newUuid();
      const editorMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Editor });

      mocks.sharedSpace.getMember.mockResolvedValue(editorMember);
      mocks.sharedSpace.addAssets.mockResolvedValue([]);

      await sut.addAssets(auth, spaceId, { assetIds: [assetId1, assetId2] });

      expect(mocks.sharedSpace.addAssets).toHaveBeenCalledWith([
        { spaceId, assetId: assetId1, addedById: auth.user.id },
        { spaceId, assetId: assetId2, addedById: auth.user.id },
      ]);
    });

    it('should throw when viewer tries to add', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const viewerMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Viewer });

      mocks.sharedSpace.getMember.mockResolvedValue(viewerMember);

      await expect(sut.addAssets(auth, spaceId, { assetIds: [newUuid()] })).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.sharedSpace.addAssets).not.toHaveBeenCalled();
    });
  });

  describe('removeAssets', () => {
    it('should remove assets when editor', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const assetId1 = newUuid();
      const assetId2 = newUuid();
      const editorMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Editor });

      mocks.sharedSpace.getMember.mockResolvedValue(editorMember);
      mocks.sharedSpace.removeAssets.mockResolvedValue(void 0);

      await sut.removeAssets(auth, spaceId, { assetIds: [assetId1, assetId2] });

      expect(mocks.sharedSpace.removeAssets).toHaveBeenCalledWith(spaceId, [assetId1, assetId2]);
    });

    it('should throw when viewer tries to remove', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const viewerMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Viewer });

      mocks.sharedSpace.getMember.mockResolvedValue(viewerMember);

      await expect(sut.removeAssets(auth, spaceId, { assetIds: [newUuid()] })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mocks.sharedSpace.removeAssets).not.toHaveBeenCalled();
    });
  });

  describe('getMapMarkers', () => {
    it('should require shared space read access', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();

      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set());

      await expect(sut.getMapMarkers(auth, spaceId)).rejects.toThrow();
      expect(mocks.sharedSpace.getMapMarkers).not.toHaveBeenCalled();
    });

    it('should return map markers for space assets', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const assetId1 = newUuid();
      const assetId2 = newUuid();

      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
      mocks.sharedSpace.getMapMarkers.mockResolvedValue([
        { id: assetId1, latitude: 40.7128, longitude: -74.006, city: 'New York', state: 'New York', country: 'USA' },
        {
          id: assetId2,
          latitude: 34.0522,
          longitude: -118.2437,
          city: 'Los Angeles',
          state: 'California',
          country: 'USA',
        },
      ]);

      const result = await sut.getMapMarkers(auth, spaceId);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual<MapMarkerResponseDto>({
        id: assetId1,
        lat: 40.7128,
        lon: -74.006,
        city: 'New York',
        state: 'New York',
        country: 'USA',
      });
      expect(result[1]).toEqual<MapMarkerResponseDto>({
        id: assetId2,
        lat: 34.0522,
        lon: -118.2437,
        city: 'Los Angeles',
        state: 'California',
        country: 'USA',
      });
      expect(mocks.access.sharedSpace.checkMemberAccess).toHaveBeenCalledWith(auth.user.id, new Set([spaceId]));
    });

    it('should return empty array when space has no geotagged assets', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();

      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
      mocks.sharedSpace.getMapMarkers.mockResolvedValue([]);

      const result = await sut.getMapMarkers(auth, spaceId);

      expect(result).toEqual([]);
      expect(mocks.sharedSpace.getMapMarkers).toHaveBeenCalledWith(spaceId);
    });

    it('should map marker fields correctly with null city/state/country', async () => {
      const auth = factory.auth();
      const spaceId = newUuid();
      const assetId = newUuid();

      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
      mocks.sharedSpace.getMapMarkers.mockResolvedValue([
        { id: assetId, latitude: 51.5074, longitude: -0.1278, city: null, state: null, country: null },
      ]);

      const result = await sut.getMapMarkers(auth, spaceId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual<MapMarkerResponseDto>({
        id: assetId,
        lat: 51.5074,
        lon: -0.1278,
        city: null,
        state: null,
        country: null,
      });
    });
  });
});
