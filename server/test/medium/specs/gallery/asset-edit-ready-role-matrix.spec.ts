import { Kysely } from 'kysely';
import { AssetVisibility, JobName, JobStatus, QueueName, SharedSpaceRole } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { WebsocketRepository } from 'src/repositories/websocket.repository.js';
import { DB } from 'src/schema/index.js';
import { JobService } from 'src/services/job.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

// Hand-authored oracle: specs/2026-11-20-space-editor-edit-ready-design.md.
// Completion requires present read access, not the write role held when the job was queued.
const actors = [SharedSpaceRole.Owner, SharedSpaceRole.Editor, SharedSpaceRole.Viewer, 'outsider', 'admin'] as const;
const states = ['timeline', 'archive', 'hidden', 'locked', 'trashed', 'detached', 'revoked', 'deleted-user'] as const;
const expected = {
  owner: '11000000',
  editor: '11000000',
  viewer: '11000000',
  outsider: '00000000',
  admin: '00000000',
};

describe('Edit-ready delivery role × visibility × timeline preference × completion job', () => {
  let db: Kysely<DB>;
  beforeAll(async () => {
    db = await getKyselyDB();
  });
  afterAll(async () => {
    await db?.destroy();
  });

  it('rechecks real access without writing, and projects the recipient favorite and trimmed duration', async () => {
    const { sut, ctx } = newMediumService(JobService, {
      database: db,
      real: [AccessRepository, AssetRepository, AssetEditRepository, UserRepository],
      mock: [EventRepository, JobRepository, WebsocketRepository, LoggingRepository],
    });
    ctx.getMock(JobRepository).run.mockResolvedValue(JobStatus.Success);
    ctx.getMock(EventRepository).emit.mockResolvedValue(undefined);
    const ws = ctx.getMock(WebsocketRepository);
    ws.clientSend.mockReturnValue(undefined);
    ws.clientSendByClient.mockReturnValue(undefined);
    const grid: string[] = [];

    for (const role of actors) {
      for (const showInTimeline of [false, true]) {
        const { user: host } = await ctx.newUser();
        const { user: actor } = await ctx.newUser({ isAdmin: role === 'admin' });
        const { space } = await ctx.newSharedSpace({ createdById: host.id });
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: host.id, role: SharedSpaceRole.Owner });
        const isMember = role !== 'outsider' && role !== 'admin';
        if (isMember) {
          await ctx.newSharedSpaceMember({ spaceId: space.id, userId: actor.id, role, showInTimeline });
        }
        const { asset } = await ctx.newAsset({ ownerId: host.id, duration: 100_000 });
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: host.id });
        await db
          .insertInto('asset_video_trim')
          .values({ assetId: asset.id, startTime: 10, endTime: 50, duration: 40_000 })
          .execute();
        // Opposite favorite bits in each preference row; these facts must never cross recipients.
        await db
          .insertInto('asset_favorite')
          .values({ userId: showInTimeline ? actor.id : host.id, assetId: asset.id })
          .execute();

        for (const name of [JobName.AssetEditThumbnailGeneration, JobName.AssetVideoTrimGenerate] as const) {
          let outcomes = '';
          for (const state of states) {
            await db
              .updateTable('asset')
              .set({
                visibility:
                  state === 'archive'
                    ? AssetVisibility.Archive
                    : state === 'hidden'
                      ? AssetVisibility.Hidden
                      : state === 'locked'
                        ? AssetVisibility.Locked
                        : AssetVisibility.Timeline,
                deletedAt: state === 'trashed' ? new Date() : null,
              })
              .where('id', '=', asset.id)
              .execute();
            if (state === 'detached') {
              await db.deleteFrom('shared_space_asset').where('assetId', '=', asset.id).execute();
            }
            if (state === 'revoked' && isMember) {
              await db
                .deleteFrom('shared_space_member')
                .where('spaceId', '=', space.id)
                .where('userId', '=', actor.id)
                .execute();
            }
            if (state === 'deleted-user') {
              await db.updateTable('user').set({ deletedAt: new Date() }).where('id', '=', actor.id).execute();
            }
            const readState = async () => ({
              asset: await db.selectFrom('asset').selectAll().where('id', '=', asset.id).execute(),
              edits: await db.selectFrom('asset_edit').selectAll().where('assetId', '=', asset.id).execute(),
              favorites: await db
                .selectFrom('asset_favorite')
                .selectAll()
                .where('assetId', '=', asset.id)
                .orderBy('userId')
                .execute(),
              trim: await db.selectFrom('asset_video_trim').selectAll().where('assetId', '=', asset.id).execute(),
            });
            const before = await readState();
            ws.clientSend.mockClear();
            ws.clientSendByClient.mockClear();
            ctx.getMock(EventRepository).emit.mockClear();
            await sut.onJobRun(QueueName.Editor, { name, data: { id: asset.id, initiatorId: actor.id } });
            expect(ctx.getMock(EventRepository).emit).not.toHaveBeenCalledWith('JobError', expect.anything());
            expect(ws.clientSend).toHaveBeenCalledExactlyOnceWith('AssetEditReadyV2', host.id, expect.anything());
            const forwarded = ws.clientSendByClient.mock.calls;
            outcomes += forwarded.length > 0 ? '1' : '0';
            if (forwarded.length > 0) {
              expect(forwarded).toEqual([
                [
                  'AssetEditReadyV2',
                  actor.id,
                  [
                    expect.objectContaining({
                      asset: expect.objectContaining({ id: asset.id, isFavorite: showInTimeline, duration: 40_000 }),
                    }),
                  ],
                ],
              ]);
            }
            expect(await readState()).toEqual(before);
            if (state === 'detached') {
              await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: host.id });
            }
            if (state === 'revoked' && isMember) {
              await ctx.newSharedSpaceMember({ spaceId: space.id, userId: actor.id, role, showInTimeline });
            }
            if (state === 'deleted-user') {
              await db.updateTable('user').set({ deletedAt: null }).where('id', '=', actor.id).execute();
            }
          }
          expect(outcomes, `${role}/${showInTimeline}/${name}`).toBe(expected[role]);
          grid.push(
            `${role}/${showInTimeline}/${name === JobName.AssetVideoTrimGenerate ? 'trim' : 'thumbnail'}:${outcomes}`,
          );
        }
      }
    }
    expect(grid.join('\n')).toMatchInlineSnapshot(`
      "owner/false/thumbnail:11000000
      owner/false/trim:11000000
      owner/true/thumbnail:11000000
      owner/true/trim:11000000
      editor/false/thumbnail:11000000
      editor/false/trim:11000000
      editor/true/thumbnail:11000000
      editor/true/trim:11000000
      viewer/false/thumbnail:11000000
      viewer/false/trim:11000000
      viewer/true/thumbnail:11000000
      viewer/true/trim:11000000
      outsider/false/thumbnail:00000000
      outsider/false/trim:00000000
      outsider/true/thumbnail:00000000
      outsider/true/trim:00000000
      admin/false/thumbnail:00000000
      admin/false/trim:00000000
      admin/true/thumbnail:00000000
      admin/true/trim:00000000"
    `);
  }, 60_000);
});
