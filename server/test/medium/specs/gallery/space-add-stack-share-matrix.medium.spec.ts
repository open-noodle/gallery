import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { AlbumUserRole, AssetVisibility, JobName, SharedSpaceActivityType, SharedSpaceRole } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumUserRepository } from 'src/repositories/album-user.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { SharedSpaceService } from 'src/services/shared-space.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory, newUuid } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

// Independent oracle: specs/2026-11-21-partner-stack-space-add-design.md.
// S = selected assets and sibling, P = selected assets only, D = denied with no writes.
const ROLES = [SharedSpaceRole.Owner, SharedSpaceRole.Editor, SharedSpaceRole.Viewer, 'outsider', 'admin'] as const;
const RELATIONS = ['owned', 'partner', 'stranger'] as const;
const STATES = ['timeline', 'archive', 'hidden', 'locked', 'trashed'] as const;
const MODES = ['automatic', 'explicit'] as const;
type Role = (typeof ROLES)[number];
type Relation = (typeof RELATIONS)[number];
type State = (typeof STATES)[number];
type Mode = (typeof MODES)[number];
const CAN_ADD: Record<Role, boolean> = { owner: true, editor: true, viewer: false, outsider: false, admin: false };
const TRUTH: Record<Relation, Record<Mode, string>> = {
  owned: { automatic: 'SSPPP', explicit: 'SSSD' },
  partner: { automatic: 'SPPPP', explicit: 'SDSD' },
  stranger: { automatic: 'DDDDD', explicit: 'DDDD' },
};
const CELLS = MODES.flatMap((mode) =>
  STATES.filter((state) => mode === 'automatic' || state !== 'trashed').map((state) => ({ mode, state })),
);

let db: Kysely<DB>;
const grid = new Map<string, string>();
beforeAll(async () => {
  db = await getKyselyDB();
});
afterAll(async () => {
  await db?.destroy();
});

const buildWorld = async (role: Role, relation: Relation, state: State) => {
  const { sut, ctx } = newMediumService(SharedSpaceService, {
    database: db,
    real: [
      AccessRepository,
      AlbumRepository,
      AlbumUserRepository,
      AssetRepository,
      PartnerRepository,
      SharedSpaceRepository,
      StackRepository,
      UserRepository,
    ],
    mock: [JobRepository, LoggingRepository],
  });
  const jobs = ctx.getMock(JobRepository);
  jobs.queueAll.mockResolvedValue();
  const { user: host } = await ctx.newUser();
  const { user: actor } = await ctx.newUser({ isAdmin: role === 'admin' });
  let assetOwner = actor;
  if (relation !== 'owned') {
    ({ user: assetOwner } = await ctx.newUser());
  }
  const { space } = await ctx.newSharedSpace({ createdById: host.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: host.id, role: SharedSpaceRole.Owner });
  if (role !== 'outsider' && role !== 'admin') {
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: actor.id, role });
  }
  if (relation === 'partner') {
    await ctx.newPartner({ sharedById: assetOwner.id, sharedWithId: actor.id, inTimeline: false });
  }
  const { asset: selected } = await ctx.newAsset({ ownerId: assetOwner.id, visibility: AssetVisibility.Timeline });
  const { asset: sibling } = await ctx.newAsset({
    ownerId: assetOwner.id,
    visibility:
      state === 'archive'
        ? AssetVisibility.Archive
        : state === 'hidden'
          ? AssetVisibility.Hidden
          : state === 'locked'
            ? AssetVisibility.Locked
            : AssetVisibility.Timeline,
    deletedAt: state === 'trashed' ? new Date() : null,
  });
  await ctx.newStack({ ownerId: assetOwner.id }, [selected.id, sibling.id]);
  // The valid second selection proves an invalid first selection cannot leave a partial batch.
  const { asset: otherSelected } = await ctx.newAsset({ ownerId: actor.id });
  const { asset: existing } = await ctx.newAsset({ ownerId: host.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: existing.id, addedById: host.id });
  const auth = factory.auth({ user: { id: actor.id, email: actor.email, isAdmin: actor.isAdmin } });
  const selectedIds = [selected.id, otherSelected.id];
  const readState = async () => ({
    space: await db.selectFrom('shared_space').selectAll().where('id', '=', space.id).execute(),
    assets: await db
      .selectFrom('asset')
      .selectAll()
      .where('id', 'in', [...selectedIds, sibling.id, existing.id])
      .orderBy('id')
      .execute(),
    members: await db
      .selectFrom('shared_space_asset')
      .selectAll()
      .where('spaceId', '=', space.id)
      .orderBy('assetId')
      .execute(),
    activity: await db.selectFrom('shared_space_activity').selectAll().where('spaceId', '=', space.id).execute(),
  });
  return {
    sut,
    ctx,
    jobs,
    actor,
    assetOwner,
    space,
    selected,
    sibling,
    otherSelected,
    existing,
    auth,
    selectedIds,
    readState,
  };
};

describe('Space add role × ownership × sibling visibility × explicit/automatic selection', () => {
  describe.each(ROLES)('role: %s', (role) => {
    describe.each(RELATIONS)('ownership: %s', (relation) => {
      it.each(CELLS)('$mode sibling: $state', async ({ mode, state }) => {
        const w = await buildWorld(role, relation, state);
        const selectedIds = mode === 'explicit' ? [...w.selectedIds, w.sibling.id] : w.selectedIds;
        const expected = CAN_ADD[role] ? TRUTH[relation][mode][STATES.indexOf(state)] : 'D';
        const before = await w.readState();
        const attempt = w.sut.addAssets(w.auth, w.space.id, { assetIds: selectedIds });
        if (expected === 'D') {
          await expect(attempt).rejects.toBeInstanceOf(CAN_ADD[role] ? BadRequestException : ForbiddenException);
          expect(await w.readState()).toEqual(before);
          expect(w.jobs.queueAll).not.toHaveBeenCalled();
          grid.set(`${role}/${relation}/${mode}/${state}`, 'D');
          return;
        }
        await expect(attempt).resolves.toBeUndefined();
        const after = await w.readState();
        const expectedIds = expected === 'S' ? [...w.selectedIds, w.sibling.id] : w.selectedIds;
        expect(after.members.map(({ assetId }) => assetId).toSorted()).toEqual(
          [...expectedIds, w.existing.id].toSorted(),
        );
        expect(
          after.members
            .filter(({ assetId }) => assetId !== w.existing.id)
            .every(({ addedById }) => addedById === w.actor.id),
        ).toBe(true);
        expect(after.assets).toEqual(before.assets);
        expect(after.activity).toEqual([
          expect.objectContaining({
            userId: w.actor.id,
            type: SharedSpaceActivityType.AssetAdd,
            data: { count: expectedIds.length, assetIds: selectedIds },
          }),
        ]);
        expect(w.jobs.queueAll).toHaveBeenCalledExactlyOnceWith(
          expectedIds.map((assetId) => ({
            name: JobName.SharedSpaceFaceMatch,
            data: { spaceId: w.space.id, assetId },
          })),
        );
        grid.set(
          `${role}/${relation}/${mode}/${state}`,
          after.members.some(({ assetId }) => assetId === w.sibling.id) ? 'S' : 'P',
        );
      });
    });
  });

  it('snapshots every observed outcome (automatic: timeline/archive/hidden/locked/trashed; explicit: first four)', () => {
    expect(grid.size).toBe(135);
    const rows = ROLES.flatMap((role) =>
      RELATIONS.map((relation) => {
        const outcomes = MODES.map((mode) =>
          CELLS.filter((cell) => cell.mode === mode)
            .map(({ state }) => grid.get(`${role}/${relation}/${mode}/${state}`))
            .join(''),
        );
        return `${role}/${relation}: ${outcomes.join(' / ')}`;
      }),
    );
    expect(rows.join('\n')).toMatchInlineSnapshot(`
      "owner/owned: SSPPP / SSSD
      owner/partner: SPPPP / SDSD
      owner/stranger: DDDDD / DDDD
      editor/owned: SSPPP / SSSD
      editor/partner: SPPPP / SDSD
      editor/stranger: DDDDD / DDDD
      viewer/owned: DDDDD / DDDD
      viewer/partner: DDDDD / DDDD
      viewer/stranger: DDDDD / DDDD
      outsider/owned: DDDDD / DDDD
      outsider/partner: DDDDD / DDDD
      outsider/stranger: DDDDD / DDDD
      admin/owned: DDDDD / DDDD
      admin/partner: DDDDD / DDDD
      admin/stranger: DDDDD / DDDD"
    `);
  });
});

describe('Space add share-access boundaries', () => {
  it.each([false, true])('partner timeline preference %s does not gate sharing', async (inTimeline) => {
    const w = await buildWorld(SharedSpaceRole.Editor, 'partner', 'archive');
    await db.updateTable('partner').set({ inTimeline }).where('sharedById', '=', w.assetOwner.id).execute();
    await w.sut.addAssets(w.auth, w.space.id, { assetIds: w.selectedIds });
    const after = await w.readState();
    expect(after.members.map(({ assetId }) => assetId).toSorted()).toEqual(
      [...w.selectedIds, w.existing.id].toSorted(),
    );
  });

  it.each([
    'album reader',
    'space reader',
    'reverse partner',
    'revoked partner',
    'deleted partner',
    'missing asset',
  ] as const)('rejects a mixed batch for a %s without any write', async (boundary) => {
    const isPartner = boundary === 'revoked partner' || boundary === 'deleted partner';
    const w = await buildWorld(SharedSpaceRole.Editor, isPartner ? 'partner' : 'stranger', 'timeline');
    switch (boundary) {
      case 'missing asset': {
        break;
      }
      case 'album reader': {
        const { result: album } = await w.ctx.newAlbum({ ownerId: w.assetOwner.id });
        await w.ctx.newAlbumAsset({ albumId: album.id, assetId: w.selected.id });
        await w.ctx.newAlbumUser({ albumId: album.id, userId: w.actor.id, role: AlbumUserRole.Viewer });
        break;
      }
      case 'space reader': {
        await w.ctx.newSharedSpaceAsset({ spaceId: w.space.id, assetId: w.selected.id, addedById: w.assetOwner.id });
        break;
      }
      case 'reverse partner': {
        await w.ctx.newPartner({ sharedById: w.actor.id, sharedWithId: w.assetOwner.id });
        break;
      }
      case 'revoked partner': {
        await db.deleteFrom('partner').where('sharedById', '=', w.assetOwner.id).execute();
        break;
      }
      case 'deleted partner': {
        await db.updateTable('user').set({ deletedAt: new Date() }).where('id', '=', w.assetOwner.id).execute();
        break;
      }
    }
    const assetIds = [w.otherSelected.id, boundary === 'missing asset' ? newUuid() : w.selected.id];
    const before = await w.readState();
    await expect(w.sut.addAssets(w.auth, w.space.id, { assetIds })).rejects.toBeInstanceOf(BadRequestException);
    expect(await w.readState()).toEqual(before);
    expect(w.jobs.queueAll).not.toHaveBeenCalled();
  });

  it('does not queue face work when recognition is disabled and stays idempotent with repeated ids', async () => {
    const w = await buildWorld(SharedSpaceRole.Editor, 'partner', 'archive');
    await db.updateTable('shared_space').set({ faceRecognitionEnabled: false }).where('id', '=', w.space.id).execute();
    for (let attempt = 0; attempt < 2; attempt++) {
      await w.sut.addAssets(w.auth, w.space.id, { assetIds: [w.selected.id, ...w.selectedIds] });
    }
    const after = await w.readState();
    expect(after.members.map(({ assetId }) => assetId).toSorted()).toEqual(
      [...w.selectedIds, w.existing.id].toSorted(),
    );
    expect(after.activity.map(({ data }) => Number(data.count)).toSorted((a, b) => a - b)).toEqual([0, 2]);
    expect(w.jobs.queueAll).not.toHaveBeenCalled();
  });
});
