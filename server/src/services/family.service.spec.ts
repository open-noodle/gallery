import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FamilyAccessLevel, SharedSpaceRole } from 'src/enum';
import { FamilyService } from 'src/services/family.service';
import { authStub } from 'test/fixtures/auth.stub';
import { newTestService, ServiceMocks } from 'test/utils';
import { beforeEach, describe, expect, it } from 'vitest';

const makeFamilyConfig = (enabled: boolean, defaultAccess: 'none' | 'view' | 'contribute' = 'none') => ({
  familyTree: { enabled, defaultAccess },
});

const PARTNER_A = '00000000-0000-4000-a000-000000000101';
const PARTNER_B = '00000000-0000-4000-a000-000000000102';
const PARTNER_C = '00000000-0000-4000-a000-000000000103';
const CHILD_A = '00000000-0000-4000-a000-000000000201';
const CHILD_B = '00000000-0000-4000-a000-000000000202';
const PET_A = '00000000-0000-4000-a000-000000000301';
const UNION_ID = '00000000-0000-4000-a000-000000000401';
const UNION_ID_2 = '00000000-0000-4000-a000-000000000402';

// Grants contribute access unconditionally, so each test using it exercises only the
// validation rule it names rather than re-proving write authority (already covered above).
const giveContributeAccess = (sut: FamilyService, mocks: ServiceMocks) => {
  sut['getConfig'] = () => Promise.resolve(makeFamilyConfig(true, 'none') as any);
  mocks.family.getAccess.mockResolvedValue({ level: 'contribute' } as any);
};

const giveViewOnlyAccess = (sut: FamilyService, mocks: ServiceMocks) => {
  sut['getConfig'] = () => Promise.resolve(makeFamilyConfig(true, 'none') as any);
  mocks.family.getAccess.mockResolvedValue({ level: 'view' } as any);
};

describe(FamilyService.name, () => {
  let sut: FamilyService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(FamilyService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('effective family access', () => {
    // GIVEN an instance where the admin disabled the feature entirely
    // WHEN a user with an explicit contribute grant is resolved
    // THEN the flag wins — a stale grant must never outlive the switch (E18).
    it('returns none when the feature is disabled, even for an explicitly granted user', async () => {
      sut['getConfig'] = () => Promise.resolve(makeFamilyConfig(false, 'none') as any);
      mocks.family.getAccess.mockResolvedValue({ level: 'contribute' } as any);

      await expect(sut.resolveFamilyAccess(authStub.user1)).resolves.toBe(FamilyAccessLevel.None);
    });

    // E19
    it('falls back to the instance default when the user has no grant', async () => {
      sut['getConfig'] = () => Promise.resolve(makeFamilyConfig(true, 'view') as any);
      mocks.family.getAccess.mockResolvedValue(undefined);

      await expect(sut.resolveFamilyAccess(authStub.user1)).resolves.toBe(FamilyAccessLevel.View);
    });

    // E20
    it('honours an explicit none grant on an instance whose default is contribute', async () => {
      sut['getConfig'] = () => Promise.resolve(makeFamilyConfig(true, 'contribute') as any);
      mocks.family.getAccess.mockResolvedValue({ level: 'none' } as any);

      await expect(sut.resolveFamilyAccess(authStub.user1)).resolves.toBe(FamilyAccessLevel.None);
    });

    // E22
    it('gives an admin no access without a grant of their own', async () => {
      sut['getConfig'] = () => Promise.resolve(makeFamilyConfig(true, 'none') as any);
      mocks.family.getAccess.mockResolvedValue(undefined);

      await expect(sut.resolveFamilyAccess(authStub.admin)).resolves.toBe(FamilyAccessLevel.None);
      expect(mocks.family.getAccess).toHaveBeenCalledWith(authStub.admin.user.id);
    });

    // Positive control for the three negatives above. Without this, they all pass
    // against an implementation that returns 'none' unconditionally.
    it('returns contribute for a user granted contribute on an enabled instance', async () => {
      sut['getConfig'] = () => Promise.resolve(makeFamilyConfig(true, 'none') as any);
      mocks.family.getAccess.mockResolvedValue({ level: 'contribute' } as any);

      await expect(sut.resolveFamilyAccess(authStub.user1)).resolves.toBe(FamilyAccessLevel.Contribute);
    });

    // E26 — no caching. Resolve once, change what the repository returns, resolve again.
    it('reflects a revoked grant on the very next request', async () => {
      sut['getConfig'] = () => Promise.resolve(makeFamilyConfig(true, 'none') as any);
      mocks.family.getAccess.mockResolvedValueOnce({ level: 'contribute' } as any);

      await expect(sut.resolveFamilyAccess(authStub.user1)).resolves.toBe(FamilyAccessLevel.Contribute);

      mocks.family.getAccess.mockResolvedValueOnce(undefined);

      await expect(sut.resolveFamilyAccess(authStub.user1)).resolves.toBe(FamilyAccessLevel.None);
    });
  });

  describe('read authority', () => {
    // D2's capability gate for the Slice 5 read path: 'none' is refused, 'view' and
    // 'contribute' both qualify — reading is the lower bar than writing.
    it('refuses a read from a user with no family access', async () => {
      sut['getConfig'] = () => Promise.resolve(makeFamilyConfig(true, 'none') as any);
      mocks.family.getAccess.mockResolvedValue(undefined);

      await expect(sut.requireFamilyRead(authStub.user1)).rejects.toBeInstanceOf(ForbiddenException);
    });

    // Positive control for the refusal above — same access resolution, one grant apart.
    it('accepts a read from a view-only user', async () => {
      giveViewOnlyAccess(sut, mocks);

      await expect(sut.requireFamilyRead(authStub.user1)).resolves.toBeUndefined();
    });

    it('accepts a read from a contribute user', async () => {
      giveContributeAccess(sut, mocks);

      await expect(sut.requireFamilyRead(authStub.user1)).resolves.toBeUndefined();
    });
  });

  describe('write authority', () => {
    // E21
    it('refuses a write from a view-only user', async () => {
      sut['getConfig'] = () => Promise.resolve(makeFamilyConfig(true, 'none') as any);
      mocks.family.getAccess.mockResolvedValue({ level: 'view' } as any);

      await expect(sut.requireFamilyWrite(authStub.user1)).rejects.toBeInstanceOf(ForbiddenException);
    });

    // The load-bearing pair. Together these prove authority comes from the grant and
    // NOT from a space role — the central claim of D2. Neither proves it alone.
    it('refuses a write from a user with no family access, even one who is an editor of the space the people are in', async () => {
      sut['getConfig'] = () => Promise.resolve(makeFamilyConfig(true, 'none') as any);
      mocks.family.getAccess.mockResolvedValue(undefined);
      // The user IS an editor of a space the family's people live in — if requireFamilyWrite
      // ever consulted space membership, this would grant the write. It must not be consulted.
      mocks.sharedSpace.getMember.mockResolvedValue({
        userId: authStub.user1.user.id,
        role: SharedSpaceRole.Editor,
      } as any);

      await expect(sut.requireFamilyWrite(authStub.user1)).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.sharedSpace.getMember).not.toHaveBeenCalled();
    });

    it('accepts a write from a contribute user who belongs to no shared space at all', async () => {
      sut['getConfig'] = () => Promise.resolve(makeFamilyConfig(true, 'none') as any);
      mocks.family.getAccess.mockResolvedValue({ level: 'contribute' } as any);
      // No shared-space membership anywhere — the grant alone must be sufficient.
      mocks.sharedSpace.getMember.mockResolvedValue(undefined);

      await expect(sut.requireFamilyWrite(authStub.user1)).resolves.toBeUndefined();
      expect(mocks.sharedSpace.getMember).not.toHaveBeenCalled();
    });
  });

  describe('union write path', () => {
    beforeEach(() => {
      mocks.family.getIdentityType.mockImplementation((id: string) => Promise.resolve(id === PET_A ? 'pet' : 'person'));
      mocks.family.isAncestor.mockResolvedValue(false);
      mocks.family.getPartnerIds.mockResolvedValue([]);
      mocks.family.getChildIds.mockResolvedValue([]);
    });

    // E1
    it('creates a union with no partners so two children can be siblings', async () => {
      giveContributeAccess(sut, mocks);
      mocks.family.createUnion.mockResolvedValue({ id: UNION_ID } as any);

      await expect(sut.createUnion(authStub.user1, { childIds: [CHILD_A, CHILD_B] })).resolves.toEqual({
        id: UNION_ID,
      });

      expect(mocks.family.createUnion).toHaveBeenCalledWith(
        expect.objectContaining({ partnerIds: [], childIds: [CHILD_A, CHILD_B] }),
      );
    });

    // E2
    it('creates a union with a single known parent', async () => {
      giveContributeAccess(sut, mocks);
      mocks.family.createUnion.mockResolvedValue({ id: UNION_ID } as any);

      await expect(sut.createUnion(authStub.user1, { partnerIds: [PARTNER_A] })).resolves.toEqual({
        id: UNION_ID,
      });

      expect(mocks.family.createUnion).toHaveBeenCalledWith(
        expect.objectContaining({ partnerIds: [PARTNER_A], childIds: [] }),
      );
    });

    // E3
    it('lets one person be a partner in several unions', async () => {
      giveContributeAccess(sut, mocks);
      mocks.family.createUnion
        .mockResolvedValueOnce({ id: UNION_ID } as any)
        .mockResolvedValueOnce({ id: UNION_ID_2 } as any);

      await expect(sut.createUnion(authStub.user1, { partnerIds: [PARTNER_A, PARTNER_B] })).resolves.toEqual({
        id: UNION_ID,
      });
      await expect(sut.createUnion(authStub.user1, { partnerIds: [PARTNER_A, PARTNER_C] })).resolves.toEqual({
        id: UNION_ID_2,
      });

      expect(mocks.family.createUnion).toHaveBeenCalledTimes(2);
    });

    // E6
    it('lets a child belong to two unions', async () => {
      giveContributeAccess(sut, mocks);
      mocks.family.getUnion.mockImplementation((unionId: string) => Promise.resolve({ id: unionId } as any));

      await sut.addParticipant(authStub.user1, UNION_ID, { identityId: CHILD_A, role: 'child' });
      await sut.addParticipant(authStub.user1, UNION_ID_2, { identityId: CHILD_A, role: 'child' });

      expect(mocks.family.addChild).toHaveBeenCalledWith(UNION_ID, CHILD_A);
      expect(mocks.family.addChild).toHaveBeenCalledWith(UNION_ID_2, CHILD_A);
    });

    // E9
    it('refuses to make someone their own partner', async () => {
      giveContributeAccess(sut, mocks);

      await expect(sut.createUnion(authStub.user1, { partnerIds: [PARTNER_A, PARTNER_A] })).rejects.toThrow(
        BadRequestException,
      );

      expect(mocks.family.createUnion).not.toHaveBeenCalled();
    });

    // E10
    it('refuses a person who is both partner and child of one union', async () => {
      giveContributeAccess(sut, mocks);

      await expect(sut.createUnion(authStub.user1, { partnerIds: [PARTNER_A], childIds: [PARTNER_A] })).rejects.toThrow(
        'A person cannot be both a partner and a child of the same union',
      );

      expect(mocks.family.createUnion).not.toHaveBeenCalled();
    });

    // E11
    it('refuses a third partner', async () => {
      giveContributeAccess(sut, mocks);

      await expect(sut.createUnion(authStub.user1, { partnerIds: [PARTNER_A, PARTNER_B, PARTNER_C] })).rejects.toThrow(
        'A union may have at most two partners',
      );

      expect(mocks.family.createUnion).not.toHaveBeenCalled();
    });

    // E11 via addParticipant — a union that already has two partners refuses a third.
    it('refuses a third partner added to an already-full union', async () => {
      giveContributeAccess(sut, mocks);
      mocks.family.getUnion.mockResolvedValue({ id: UNION_ID } as any);
      mocks.family.getPartnerIds.mockResolvedValue([PARTNER_A, PARTNER_B]);

      await expect(
        sut.addParticipant(authStub.user1, UNION_ID, { identityId: PARTNER_C, role: 'partner' }),
      ).rejects.toThrow('A union may have at most two partners');

      expect(mocks.family.addPartner).not.toHaveBeenCalled();
    });

    // E12
    it('refuses a pet identity as a participant', async () => {
      giveContributeAccess(sut, mocks);

      await expect(sut.createUnion(authStub.user1, { partnerIds: [PET_A] })).rejects.toThrow(
        'Pets cannot participate in family relationships',
      );

      expect(mocks.family.createUnion).not.toHaveBeenCalled();
    });

    // E15
    it('refuses an end date earlier than the start date', async () => {
      giveContributeAccess(sut, mocks);

      await expect(sut.createUnion(authStub.user1, { startDate: '2020-06-01', endDate: '2019-01-01' })).rejects.toThrow(
        'endDate cannot be earlier than startDate',
      );

      expect(mocks.family.createUnion).not.toHaveBeenCalled();
    });

    // E16
    it('accepts a divorced union with no end date', async () => {
      giveContributeAccess(sut, mocks);
      mocks.family.createUnion.mockResolvedValue({ id: UNION_ID } as any);

      await expect(
        sut.createUnion(authStub.user1, {
          partnerIds: [PARTNER_A, PARTNER_B],
          status: 'divorced',
          startDate: '2020-01-01',
          endDate: null,
        }),
      ).resolves.toEqual({ id: UNION_ID });

      expect(mocks.family.createUnion).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'divorced', startDate: '2020-01-01', endDate: null }),
      );
    });

    // E24
    it('lets a contributor edit a union another user created', async () => {
      giveContributeAccess(sut, mocks);
      mocks.family.getUnion.mockResolvedValue({
        id: UNION_ID,
        createdById: authStub.user2.user.id,
        startDate: null,
        endDate: null,
      } as any);

      await expect(sut.updateUnion(authStub.user1, UNION_ID, { status: 'divorced' })).resolves.toBeUndefined();

      expect(mocks.family.updateUnion).toHaveBeenCalledWith(UNION_ID, { status: 'divorced' });
    });

    // E25
    it('lets a contributor delete a union another user created', async () => {
      giveContributeAccess(sut, mocks);
      mocks.family.getUnion.mockResolvedValue({
        id: UNION_ID,
        createdById: authStub.user2.user.id,
        startDate: null,
        endDate: null,
      } as any);

      await expect(sut.deleteUnion(authStub.user1, UNION_ID)).resolves.toBeUndefined();

      expect(mocks.family.deleteUnion).toHaveBeenCalledWith(UNION_ID);
    });

    // E21 write half — every write method must refuse a view-only caller before touching
    // the repository's write methods.
    it('refuses every write from a view-only caller', async () => {
      giveViewOnlyAccess(sut, mocks);

      await expect(sut.createUnion(authStub.user1, { partnerIds: [PARTNER_A] })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(sut.updateUnion(authStub.user1, UNION_ID, { status: 'divorced' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(sut.deleteUnion(authStub.user1, UNION_ID)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        sut.addParticipant(authStub.user1, UNION_ID, { identityId: PARTNER_A, role: 'partner' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(sut.removeParticipant(authStub.user1, UNION_ID, PARTNER_A)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      expect(mocks.family.createUnion).not.toHaveBeenCalled();
      expect(mocks.family.updateUnion).not.toHaveBeenCalled();
      expect(mocks.family.deleteUnion).not.toHaveBeenCalled();
      expect(mocks.family.addPartner).not.toHaveBeenCalled();
      expect(mocks.family.removeParticipant).not.toHaveBeenCalled();
      expect(mocks.family.getUnion).not.toHaveBeenCalled();
    });

    it('refuses to update or delete a union that does not exist', async () => {
      giveContributeAccess(sut, mocks);
      mocks.family.getUnion.mockResolvedValue(undefined);

      await expect(sut.updateUnion(authStub.user1, UNION_ID, { status: 'divorced' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(sut.deleteUnion(authStub.user1, UNION_ID)).rejects.toBeInstanceOf(NotFoundException);

      expect(mocks.family.updateUnion).not.toHaveBeenCalled();
      expect(mocks.family.deleteUnion).not.toHaveBeenCalled();
    });
  });

  describe('setMyRoot', () => {
    beforeEach(() => {
      mocks.family.getIdentityType.mockImplementation((id: string) => Promise.resolve(id === PET_A ? 'pet' : 'person'));
    });

    // D4: nominating yourself needs only `view`, never `contribute`.
    it('lets a view-only caller set their own root', async () => {
      giveViewOnlyAccess(sut, mocks);

      await expect(sut.setMyRoot(authStub.user1, PARTNER_A)).resolves.toBeUndefined();

      expect(mocks.user.upsertMetadata).toHaveBeenCalledWith(authStub.user1.user.id, {
        key: 'family-root',
        value: { identityId: PARTNER_A },
      });
    });

    it('lets a caller clear their root with null', async () => {
      giveViewOnlyAccess(sut, mocks);

      await expect(sut.setMyRoot(authStub.user1, null)).resolves.toBeUndefined();

      expect(mocks.family.getIdentityType).not.toHaveBeenCalled();
      expect(mocks.user.upsertMetadata).toHaveBeenCalledWith(authStub.user1.user.id, {
        key: 'family-root',
        value: { identityId: null },
      });
    });

    it('refuses a caller with no family access at all', async () => {
      mocks.family.getAccess.mockResolvedValue(undefined);
      sut['getConfig'] = () => Promise.resolve({ familyTree: { enabled: true, defaultAccess: 'none' } } as any);

      await expect(sut.setMyRoot(authStub.user1, PARTNER_A)).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.user.upsertMetadata).not.toHaveBeenCalled();
    });

    it('refuses a pet identity as a root', async () => {
      giveViewOnlyAccess(sut, mocks);

      await expect(sut.setMyRoot(authStub.user1, PET_A)).rejects.toThrow(
        'Pets cannot participate in family relationships',
      );
      expect(mocks.user.upsertMetadata).not.toHaveBeenCalled();
    });

    it('refuses an identity that does not exist', async () => {
      giveViewOnlyAccess(sut, mocks);
      mocks.family.getIdentityType.mockResolvedValue(undefined);

      await expect(sut.setMyRoot(authStub.user1, PARTNER_A)).rejects.toBeInstanceOf(NotFoundException);
      expect(mocks.user.upsertMetadata).not.toHaveBeenCalled();
    });
  });

  describe('updateGender', () => {
    beforeEach(() => {
      mocks.family.getIdentityType.mockImplementation((id: string) => Promise.resolve(id === PET_A ? 'pet' : 'person'));
    });

    // D4: gender is shared data, so it requires `contribute`, unlike the viewer's own root.
    it('refuses a view-only caller', async () => {
      giveViewOnlyAccess(sut, mocks);

      await expect(sut.updateGender(authStub.user1, PARTNER_A, 'female')).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.family.setGender).not.toHaveBeenCalled();
    });

    it('lets a contributor set a gender', async () => {
      giveContributeAccess(sut, mocks);

      await expect(sut.updateGender(authStub.user1, PARTNER_A, 'male')).resolves.toBeUndefined();

      expect(mocks.family.setGender).toHaveBeenCalledWith(PARTNER_A, 'male');
    });

    it('lets a contributor clear a gender with null', async () => {
      giveContributeAccess(sut, mocks);

      await expect(sut.updateGender(authStub.user1, PARTNER_A, null)).resolves.toBeUndefined();

      expect(mocks.family.setGender).toHaveBeenCalledWith(PARTNER_A, null);
    });

    it('refuses a pet identity', async () => {
      giveContributeAccess(sut, mocks);

      await expect(sut.updateGender(authStub.user1, PET_A, 'male')).rejects.toThrow(
        'Pets cannot participate in family relationships',
      );
      expect(mocks.family.setGender).not.toHaveBeenCalled();
    });
  });

  // Slice 7: grant administration is deliberately independent of the caller's own family
  // access level — these two methods never call `resolveFamilyAccess`/`requireFamilyRead`/
  // `requireFamilyWrite` at all. Authority is the controller's `admin: true` gate alone.
  describe('access grant administration', () => {
    it("lists every explicit grant without consulting the caller's own family access", async () => {
      mocks.family.getAllAccess.mockResolvedValue([
        { userId: 'user-a', level: 'contribute', grantedById: 'admin_id', grantedAt: new Date('2026-01-01T00:00:00Z') },
      ] as any);

      await expect(sut.getAllAccessGrants()).resolves.toEqual([
        {
          userId: 'user-a',
          level: 'contribute',
          grantedById: 'admin_id',
          grantedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      expect(mocks.family.getAccess).not.toHaveBeenCalled();
    });

    it('sets a grant, recording the caller as grantedBy', async () => {
      mocks.family.setAccess.mockResolvedValue({
        userId: 'user-a',
        level: 'view',
        grantedById: authStub.admin.user.id,
        grantedAt: new Date('2026-02-01T00:00:00Z'),
      } as any);

      await expect(sut.setAccessGrant(authStub.admin, 'user-a', FamilyAccessLevel.View)).resolves.toEqual({
        userId: 'user-a',
        level: 'view',
        grantedById: authStub.admin.user.id,
        grantedAt: '2026-02-01T00:00:00.000Z',
      });

      expect(mocks.family.setAccess).toHaveBeenCalledWith('user-a', FamilyAccessLevel.View, authStub.admin.user.id);
      expect(mocks.family.getAccess).not.toHaveBeenCalled();
    });
  });
});
