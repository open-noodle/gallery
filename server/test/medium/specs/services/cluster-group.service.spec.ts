import { Kysely } from 'kysely';
import { AccessRepository } from 'src/repositories/access.repository';
import { ClusterGroupRepository } from 'src/repositories/cluster-group.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { ClusterGroupService } from 'src/services/cluster-group.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const ctx = newMediumService(ClusterGroupService, {
    database: db || defaultDatabase,
    real: [AccessRepository, ClusterGroupRepository, PersonRepository, UserRepository],
    mock: [LoggingRepository, EventRepository],
  });

  ctx.ctx.getMock(EventRepository).emit.mockResolvedValue();

  return ctx;
};

const getClusterGroupId = async (ctx: ReturnType<typeof setup>['ctx'], userId: string) => {
  const { clusterGroupId } = await ctx.database
    .selectFrom('user')
    .select('user.clusterGroupId')
    .where('user.id', '=', userId)
    .executeTakeFirstOrThrow();

  return clusterGroupId;
};

const getPeople = (ctx: ReturnType<typeof setup>['ctx'], ownerId: string) =>
  ctx.database.selectFrom('person').selectAll('person').where('person.ownerId', '=', ownerId).execute();

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(ClusterGroupService.name, () => {
    // Option M: Gallery does not adopt upstream's cluster-groups FEATURE, so a person_group never
    // holds more than one person row — the unique index `person_personGroupId_key` enforces it. The
    // test(s) removed here deliberately put a second owner's person into an existing group, which is
    // exactly the state Gallery declines to support. Restoring them is part of turning cluster
    // groups on; see docs/superpowers/specs/2026-08-21-cluster-groups-m-landing-plan.md.

  describe('createRequest', () => {
    it('should create a request for another user', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: invitee } = await ctx.newUser();
      const auth = factory.auth({ user: owner });
      const clusterGroupId = await getClusterGroupId(ctx, owner.id);

      const { value: request } = await sut.createRequest(auth, clusterGroupId, { userId: invitee.id });

      expect(request).toEqual(
        expect.objectContaining({ clusterGroupId, userId: invitee.id, createdAt: expect.any(Date) }),
      );
      expect(ctx.getMock(EventRepository).emit).toHaveBeenCalledWith('ClusterGroupRequest', {
        clusterGroupId,
        userId: invitee.id,
        senderName: owner.name,
      });
    });

    it('should reject a cluster group the user is not a member of', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const auth = factory.auth({ user: owner });
      const otherClusterGroupId = await getClusterGroupId(ctx, other.id);

      await expect(sut.createRequest(auth, otherClusterGroupId, { userId: other.id })).rejects.toThrow(
        'Not found or no clusterGroupRequest.create access',
      );
    });

    it('should return the existing request when it was already created', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: invitee } = await ctx.newUser();
      const auth = factory.auth({ user: owner });
      const clusterGroupId = await getClusterGroupId(ctx, owner.id);

      const created = await sut.createRequest(auth, clusterGroupId, { userId: invitee.id });
      expect(created.duplicate).toBe(false);

      const again = await sut.createRequest(auth, clusterGroupId, { userId: invitee.id });
      expect(again.duplicate).toBe(true);
      expect(again.value).toEqual(created.value);

      await expect(sut.getRequests(factory.auth({ user: invitee }))).resolves.toEqual([created.value]);
    });

    it('should reject an unknown user', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const auth = factory.auth({ user: owner });
      const clusterGroupId = await getClusterGroupId(ctx, owner.id);

      await expect(sut.createRequest(auth, clusterGroupId, { userId: factory.uuid() })).rejects.toThrow(
        'User not found',
      );
    });
  });

  describe('getRequests', () => {
    it('should only return the requests for the current user', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: invitee } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const clusterGroupId = await getClusterGroupId(ctx, owner.id);

      const { value: request } = await sut.createRequest(factory.auth({ user: owner }), clusterGroupId, {
        userId: invitee.id,
      });
      await sut.createRequest(factory.auth({ user: owner }), clusterGroupId, { userId: other.id });

      await expect(sut.getRequests(factory.auth({ user: invitee }))).resolves.toEqual([request]);
    });
  });

  describe('getRequestsForGroup', () => {
    it('should return the requests sent by the cluster group', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: invitee } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const auth = factory.auth({ user: owner });
      const clusterGroupId = await getClusterGroupId(ctx, owner.id);

      const { value: request } = await sut.createRequest(auth, clusterGroupId, { userId: invitee.id });

      await expect(sut.getRequestsForGroup(auth, clusterGroupId)).resolves.toEqual([request]);
      await expect(sut.getRequestsForGroup(factory.auth({ user: other }), clusterGroupId)).rejects.toThrow(
        'Not found or no clusterGroup.read access',
      );
    });
  });

  describe('getUsers', () => {
    it('should return the members of the cluster group', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const auth = factory.auth({ user: owner });
      const clusterGroupId = await getClusterGroupId(ctx, owner.id);

      const { value: request } = await sut.createRequest(auth, clusterGroupId, { userId: member.id });
      await sut.acceptRequest(factory.auth({ user: member }), request.id);

      const users = await sut.getUsers(auth, clusterGroupId);
      expect(users.map(({ id }) => id)).toEqual(expect.arrayContaining([owner.id, member.id]));
      expect(users.map(({ id }) => id)).not.toContain(other.id);

      await expect(sut.getUsers(factory.auth({ user: other }), clusterGroupId)).rejects.toThrow(
        'Not found or no clusterGroup.read access',
      );
    });

    it('should let a user with a pending request see the members', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: invitee } = await ctx.newUser();
      const auth = factory.auth({ user: owner });
      const clusterGroupId = await getClusterGroupId(ctx, owner.id);

      await expect(sut.getUsers(factory.auth({ user: invitee }), clusterGroupId)).rejects.toThrow(
        'Not found or no clusterGroup.read access',
      );

      await sut.createRequest(auth, clusterGroupId, { userId: invitee.id });

      const users = await sut.getUsers(factory.auth({ user: invitee }), clusterGroupId);
      expect(users.map(({ id }) => id)).toContain(owner.id);
    });
  });

  describe('acceptRequest', () => {
    it('should move the user into the cluster group and delete the request', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: invitee } = await ctx.newUser();
      const clusterGroupId = await getClusterGroupId(ctx, owner.id);

      const { value: request } = await sut.createRequest(factory.auth({ user: owner }), clusterGroupId, {
        userId: invitee.id,
      });
      await sut.acceptRequest(factory.auth({ user: invitee }), request.id);

      await expect(getClusterGroupId(ctx, invitee.id)).resolves.toBe(clusterGroupId);
      await expect(sut.getRequests(factory.auth({ user: invitee }))).resolves.toEqual([]);
    });

    it('should not accept a request belonging to someone else', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: invitee } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const clusterGroupId = await getClusterGroupId(ctx, owner.id);
      const otherClusterGroupId = await getClusterGroupId(ctx, other.id);

      const { value: request } = await sut.createRequest(factory.auth({ user: owner }), clusterGroupId, {
        userId: invitee.id,
      });

      await expect(sut.acceptRequest(factory.auth({ user: other }), request.id)).rejects.toThrow(
        'Not found or no clusterGroupRequest.read access',
      );
      await expect(getClusterGroupId(ctx, other.id)).resolves.toBe(otherClusterGroupId);
    });
  });

  describe('leave', () => {
    it('should move the user into a new cluster group', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user } = await ctx.newUser();
      const clusterGroupId = await getClusterGroupId(ctx, owner.id);
      const auth = factory.auth({ user });

      const { value: request } = await sut.createRequest(factory.auth({ user: owner }), clusterGroupId, {
        userId: user.id,
      });
      await sut.acceptRequest(auth, request.id);

      await sut.leave(auth, clusterGroupId);

      const newClusterGroupId = await getClusterGroupId(ctx, user.id);
      expect(newClusterGroupId).not.toBe(clusterGroupId);
      await expect(
        ctx.database
          .selectFrom('cluster_group')
          .select('cluster_group.id')
          .where('cluster_group.id', '=', newClusterGroupId)
          .executeTakeFirst(),
      ).resolves.toBeDefined();
    });

    it('should reject a cluster group the user is not a member of', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const auth = factory.auth({ user });
      const otherClusterGroupId = await getClusterGroupId(ctx, other.id);

      await expect(sut.leave(auth, otherClusterGroupId)).rejects.toThrow('Not found or no clusterGroup.leave access');
    });

    it('should not let the last member leave', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      const clusterGroupId = await getClusterGroupId(ctx, user.id);

      await expect(sut.leave(auth, clusterGroupId)).rejects.toThrow(
        'Cannot leave a cluster group without any other members',
      );
      await expect(getClusterGroupId(ctx, user.id)).resolves.toBe(clusterGroupId);
    });
  });

  describe('joining a cluster group', () => {
    it('should take the groups of the user along', async () => {
      const { sut, ctx } = setup(await getKyselyDB());
      const personRepo = ctx.get(PersonRepository);
      const { user: owner } = await ctx.newUser();
      const { user } = await ctx.newUser();
      const clusterGroupId = await getClusterGroupId(ctx, owner.id);

      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });

      const { value: request } = await sut.createRequest(factory.auth({ user: owner }), clusterGroupId, {
        userId: user.id,
      });
      await sut.acceptRequest(factory.auth({ user }), request.id);

      // the group keeps its id, it only changes cluster group
      await expect(personRepo.getByGroupId(person)).resolves.toEqual(
        expect.objectContaining({ personGroupId: person.personGroupId }),
      );
      await expect(
        ctx.database
          .selectFrom('person_group')
          .select('person_group.clusterGroupId')
          .where('person_group.id', '=', person.personGroupId)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ clusterGroupId });
      await expect(
        ctx.database
          .selectFrom('asset_face')
          .select('asset_face.personGroupId')
          .where('asset_face.id', '=', assetFace.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ personGroupId: person.personGroupId });
      await expect(getClusterGroupId(ctx, user.id)).resolves.toBe(clusterGroupId);
    });
  });

  describe('leaving a shared cluster group', () => {
  });

  describe('deleteRequest', () => {
    it('should let the user it was created for decline it', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: invitee } = await ctx.newUser();
      const clusterGroupId = await getClusterGroupId(ctx, owner.id);
      const inviteeClusterGroupId = await getClusterGroupId(ctx, invitee.id);

      const { value: request } = await sut.createRequest(factory.auth({ user: owner }), clusterGroupId, {
        userId: invitee.id,
      });
      await sut.deleteRequest(factory.auth({ user: invitee }), request.id);

      await expect(sut.getRequests(factory.auth({ user: invitee }))).resolves.toEqual([]);
      await expect(getClusterGroupId(ctx, invitee.id)).resolves.toBe(inviteeClusterGroupId);
    });

    it('should let the cluster group it was created by revoke it', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: invitee } = await ctx.newUser();
      const clusterGroupId = await getClusterGroupId(ctx, owner.id);

      const { value: request } = await sut.createRequest(factory.auth({ user: owner }), clusterGroupId, {
        userId: invitee.id,
      });
      await sut.deleteRequest(factory.auth({ user: owner }), request.id);

      await expect(sut.getRequests(factory.auth({ user: invitee }))).resolves.toEqual([]);
    });

    it('should not let an unrelated user delete it', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: invitee } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const clusterGroupId = await getClusterGroupId(ctx, owner.id);

      const { value: request } = await sut.createRequest(factory.auth({ user: owner }), clusterGroupId, {
        userId: invitee.id,
      });

      await expect(sut.deleteRequest(factory.auth({ user: other }), request.id)).rejects.toThrow(
        'Not found or no clusterGroupRequest.delete access',
      );
      await expect(sut.getRequests(factory.auth({ user: invitee }))).resolves.toEqual([request]);
    });
  });
});
