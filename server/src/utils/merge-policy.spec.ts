import { ConflictException, ForbiddenException } from '@nestjs/common';
import { IdentityMergePropagationPlan } from 'src/services/identity-merge-propagation.service';
import {
  assertDestructiveCollapseAllowed,
  createCrossOwnerMergeAuthorizer,
  CROSS_OWNER_MERGE_ERROR_CODE,
} from 'src/utils/merge-policy';

const makePlan = (overrides: Partial<IdentityMergePropagationPlan> = {}): IdentityMergePropagationPlan => ({
  actorUserId: 'actor',
  origin: { type: 'person', targetProfileId: 'target', sourceProfileIds: ['source'], ownerId: 'actor' },
  targetIdentityId: 'identity-t',
  sourceIdentityIds: ['identity-s'],
  personalProfileMerges: [],
  spaceProfileMerges: [],
  profileIdentityUpdates: [],
  affectedOwnerIds: [],
  repointedOwnerIds: [],
  collapsedOwnerIds: [],
  unrepairableSpaceCollapseIds: [],
  affectedSpaceIds: [],
  followUpJobs: [],
  activityEvents: [],
  ...overrides,
});

const capture = (fn: () => void): unknown => {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
};

describe('merge-policy', () => {
  describe('no destructive collapse', () => {
    it('allows a plan with no collapse without reading the config', async () => {
      const getServerConfig = vi.fn(() => Promise.resolve({ mergePeopleAcrossOwners: false }));
      const authorize = createCrossOwnerMergeAuthorizer(getServerConfig, {});

      await expect(authorize(makePlan())).resolves.toBeUndefined();
      // A re-point-only / same-owner plan is free; the toggle is never consulted.
      expect(getServerConfig).not.toHaveBeenCalled();
    });

    it('does not fire for a repairable-space collapse (empty unrepairable set)', async () => {
      const authorize = createCrossOwnerMergeAuthorizer(() => Promise.resolve({ mergePeopleAcrossOwners: false }), {});

      await expect(authorize(makePlan({ unrepairableSpaceCollapseIds: [] }))).resolves.toBeUndefined();
    });
  });

  describe('collapse of another owner’s people', () => {
    it('blocks when the toggle is off', () => {
      expect(() =>
        assertDestructiveCollapseAllowed(makePlan({ collapsedOwnerIds: ['owner-b'] }), { enabled: false }),
      ).toThrow(ForbiddenException);
    });

    it('requires confirmation when the toggle is on but the merge is not confirmed', () => {
      const error = capture(() =>
        assertDestructiveCollapseAllowed(makePlan({ collapsedOwnerIds: ['owner-b', 'owner-c'] }), {
          enabled: true,
          confirmCrossOwner: false,
        }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: CROSS_OWNER_MERGE_ERROR_CODE.confirmationRequired,
        impactedOwnerCount: 2,
        impactedSpaceCount: 0,
      });
    });

    it('permits the collapse once the toggle is on and the merge is confirmed', () => {
      expect(() =>
        assertDestructiveCollapseAllowed(makePlan({ collapsedOwnerIds: ['owner-b'] }), {
          enabled: true,
          confirmCrossOwner: true,
        }),
      ).not.toThrow();
    });

    it('still blocks when the toggle is off even if the client self-asserts confirmCrossOwner', async () => {
      const getServerConfig = vi.fn(() => Promise.resolve({ mergePeopleAcrossOwners: false }));
      const authorize = createCrossOwnerMergeAuthorizer(getServerConfig, { confirmCrossOwner: true });

      await expect(authorize(makePlan({ collapsedOwnerIds: ['owner-b'] }))).rejects.toBeInstanceOf(ForbiddenException);
      expect(getServerConfig).toHaveBeenCalled();
    });
  });

  // #733 review P1: collapsing people in a space the actor cannot edit used to be a toggle-independent hard block
  // (its own `blocked_space` code). It is now governed by the SAME admin toggle as an other-owner collapse.
  describe('collapse in a space the actor cannot edit', () => {
    it('blocks when the toggle is off, pointing the user at the admin toggle', () => {
      const error = capture(() =>
        assertDestructiveCollapseAllowed(makePlan({ unrepairableSpaceCollapseIds: ['space-1'] }), { enabled: false }),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: CROSS_OWNER_MERGE_ERROR_CODE.blocked,
      });
    });

    it('requires confirmation when the toggle is on but the merge is not confirmed', () => {
      const error = capture(() =>
        assertDestructiveCollapseAllowed(makePlan({ unrepairableSpaceCollapseIds: ['space-1', 'space-2'] }), {
          enabled: true,
          confirmCrossOwner: false,
        }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: CROSS_OWNER_MERGE_ERROR_CODE.confirmationRequired,
        impactedOwnerCount: 0,
        impactedSpaceCount: 2,
      });
    });

    it('permits the collapse once the toggle is on and the merge is confirmed', () => {
      expect(() =>
        assertDestructiveCollapseAllowed(makePlan({ unrepairableSpaceCollapseIds: ['space-1'] }), {
          enabled: true,
          confirmCrossOwner: true,
        }),
      ).not.toThrow();
    });
  });

  describe('a merge that collapses both another owner’s people and an un-editable space', () => {
    it('reports both impacted counts in the confirmation conflict', () => {
      const error = capture(() =>
        assertDestructiveCollapseAllowed(
          makePlan({ collapsedOwnerIds: ['owner-b'], unrepairableSpaceCollapseIds: ['space-1', 'space-2'] }),
          { enabled: true, confirmCrossOwner: false },
        ),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: CROSS_OWNER_MERGE_ERROR_CODE.confirmationRequired,
        impactedOwnerCount: 1,
        impactedSpaceCount: 2,
      });
    });
  });
});
