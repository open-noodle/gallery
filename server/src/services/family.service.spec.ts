import { ForbiddenException } from '@nestjs/common';
import { FamilyAccessLevel, SharedSpaceRole } from 'src/enum';
import { FamilyService } from 'src/services/family.service';
import { authStub } from 'test/fixtures/auth.stub';
import { newTestService, ServiceMocks } from 'test/utils';
import { beforeEach, describe, expect, it } from 'vitest';

const makeFamilyConfig = (enabled: boolean, defaultAccess: 'none' | 'view' | 'contribute' = 'none') => ({
  familyTree: { enabled, defaultAccess },
});

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
});
