/**
Spatial Scene per-photo actions: ACTOR × SETTING × OPERATION matrix.

The access oracle reaches `checkAccess` only, while these actions also grant a space Owner or Editor of the photo
through `requireAssetEditAccess` (the grant Refresh faces and the other viewer job actions use), and refuse while
Spatial Scene is off. This file is the RBAC guarantee for both gates
(specs/2026-10-29-spatial-scene-design.md, "Per-photo actions").

Every combination is enumerated:
  actors     the photo's owner (also the space's creator, so the space grant applies to the photo); one actor per
             SharedSpaceRole who does not own the photo; a partner of the owner; an Editor of a shared album holding
             the photo; a shared link of the owner's holding the photo; a non-member user; a non-member server admin
  setting    machineLearning.spatialScene.enabled {false, true}, written to the real system-config row
  operations refreshDepthMap, setOffer(true), setOffer(false), setOffer(null)

The expected outcome comes from `expectedOutcome`, which restates the design's truth table and imports nothing from
the production gate. Per case: the outcome matches; an allowed call leaves the expected choice and queued jobs; a
refused one leaves the choice as it was and queues nothing. The whole grid is snapshotted, so any change to who may
do what is a reviewed snapshot diff (`-u`).

Mutation check: replacing requireAssetEditAccess with a no-op, or removing the enabled check, must fail this spec.
*/
import { BadRequestException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { AlbumUserRole, SharedLinkType, SharedSpaceRole, SystemMetadataKey } from 'src/enum.js';
import { SpatialSceneRepository } from 'src/gallery/repositories/spatial-scene.repository.js';
import { SpatialSceneService } from 'src/gallery/services/spatial-scene.service.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumUserRepository } from 'src/repositories/album-user.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { clearConfigCache } from 'src/utils/config.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// ---------------------------------------------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------------------------------------------

/** Every SharedSpaceRole maps to an actor who holds it without owning the photo; a new role fails the lookup. */
const ACTOR_FOR_ROLE: Record<SharedSpaceRole, Actor> = {
  [SharedSpaceRole.Owner]: 'space-owner',
  [SharedSpaceRole.Editor]: 'space-editor',
  [SharedSpaceRole.Viewer]: 'space-viewer',
};
const EXTRA_ACTORS = [
  'asset-owner',
  'partner',
  'album-editor',
  'shared-link',
  'non-member',
  'non-member-admin',
] as const;
type Actor = 'space-owner' | 'space-editor' | 'space-viewer' | (typeof EXTRA_ACTORS)[number];
const ACTORS: Actor[] = [...EXTRA_ACTORS, ...Object.values(SharedSpaceRole).map((role) => ACTOR_FOR_ROLE[role])];

const SETTINGS = [false, true];

type Op = { kind: 'refresh' } | { kind: 'offer'; offered: boolean | null };
const OPS: Op[] = [
  { kind: 'refresh' },
  { kind: 'offer', offered: true },
  { kind: 'offer', offered: false },
  { kind: 'offer', offered: null },
];
const opLabel = (op: Op) => (op.kind === 'refresh' ? 'refreshDepthMap' : `setOffer(${op.offered})`);

// ---------------------------------------------------------------------------------------------------------------
// Truth table: the design's rules, restated independently of the production code
// ---------------------------------------------------------------------------------------------------------------

type Outcome = 'ok' | 'no-access' | 'disabled';

/** The photo's owner, and an Owner or Editor of a space holding it; nobody else, and never a shared link. */
const MAY_EDIT: ReadonlySet<Actor> = new Set<Actor>(['asset-owner', 'space-owner', 'space-editor']);

/** Access is checked before the setting, so a refused actor learns nothing about it. */
const expectedOutcome = (actor: Actor, enabled: boolean): Outcome => {
  if (!MAY_EDIT.has(actor)) {
    return 'no-access';
  }
  return enabled ? 'ok' : 'disabled';
};

/** The choice the photo starts each case with: a row to remove for setOffer(null), none otherwise. */
const seedOf = (op: Op): boolean | null => (op.kind === 'offer' && op.offered === null ? true : null);

/** After an allowed call: the stored choice, and how many depth jobs were queued (the photo has no depth map). */
const expectedAfter = (op: Op): { offered: boolean | null; queued: number } => {
  if (op.kind === 'refresh') {
    return { offered: seedOf(op), queued: 1 };
  }
  return { offered: op.offered, queued: op.offered ? 1 : 0 };
};

// ---------------------------------------------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------------------------------------------

const setup = async () => {
  const { sut, ctx } = newMediumService(SpatialSceneService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AlbumUserRepository,
      AssetRepository,
      ConfigRepository,
      PartnerRepository,
      SharedLinkRepository,
      SharedSpaceRepository,
      SpatialSceneRepository,
      SystemMetadataRepository,
      UserRepository,
    ],
    mock: [EventRepository, JobRepository, LoggingRepository, StorageRepository],
  });
  const jobs = ctx.getMock(JobRepository);
  jobs.queue.mockResolvedValue();
  jobs.queueAll.mockResolvedValue();

  const { user: owner } = await ctx.newUser();
  const { user: spaceOwner } = await ctx.newUser();
  const { user: spaceEditor } = await ctx.newUser();
  const { user: spaceViewer } = await ctx.newUser();
  const { user: partner } = await ctx.newUser();
  const { user: albumEditor } = await ctx.newUser();
  const { user: nonMember } = await ctx.newUser();
  const { user: admin } = await ctx.newUser({ isAdmin: true });

  // No exif row: the job's lookup left-joins it, and a photo without a projection type is not a panorama.
  const { asset } = await ctx.newAsset({ ownerId: owner.id });

  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: spaceOwner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: spaceEditor.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: spaceViewer.id, role: SharedSpaceRole.Viewer });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

  await ctx.newPartner({ sharedById: owner.id, sharedWithId: partner.id });

  const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'shared' }, [asset.id]);
  await ctx.newAlbumUser({ albumId: album.id, userId: albumEditor.id, role: AlbumUserRole.Editor });

  const { sharedLink } = await ctx.newSharedLink({
    userId: owner.id,
    type: SharedLinkType.Individual,
    assetIds: [asset.id],
  });

  const user = (u: { id: string; email: string; isAdmin: boolean }) =>
    factory.auth({ user: { id: u.id, email: u.email, isAdmin: u.isAdmin } });
  const auths: Record<Actor, ReturnType<typeof factory.auth>> = {
    'asset-owner': user(owner),
    'space-owner': user(spaceOwner),
    'space-editor': user(spaceEditor),
    'space-viewer': user(spaceViewer),
    partner: user(partner),
    'album-editor': user(albumEditor),
    'shared-link': factory.auth({ user: { id: owner.id }, sharedLink: { id: sharedLink.id } }),
    'non-member': user(nonMember),
    'non-member-admin': user(admin),
  };

  return { sut, ctx, jobs, asset, auths };
};

const setEnabled = async (repository: SystemMetadataRepository, enabled: boolean) => {
  await repository.set(SystemMetadataKey.SystemConfig, {
    machineLearning: { enabled: true, spatialScene: { enabled } },
  } as any);
  clearConfigCache();
};

const choiceOf = async (db: Kysely<DB>, assetId: string): Promise<boolean | null> => {
  const row = await db
    .selectFrom('asset_spatial_scene_offer')
    .select('offered')
    .where('assetId', '=', assetId)
    .executeTakeFirst();
  return row?.offered ?? null;
};

const classify = (error: unknown): Outcome | string => {
  if (!(error instanceof BadRequestException)) {
    return `unexpected:${String(error)}`;
  }
  if (error.message.startsWith('Not found or no')) {
    return 'no-access';
  }
  if (error.message === 'Spatial Scene is disabled') {
    return 'disabled';
  }
  return `unexpected:${error.message}`;
};

// ---------------------------------------------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------------------------------------------

describe('Spatial Scene per-photo actions: actor × setting × operation', () => {
  it('maps every SharedSpaceRole to an actor', () => {
    for (const role of Object.values(SharedSpaceRole)) {
      expect(ACTOR_FOR_ROLE[role]).toBeDefined();
    }
  });

  it('allows exactly the truth table, and a refused call writes and queues nothing', async () => {
    const { sut, ctx, jobs, asset, auths } = await setup();
    const db = ctx.database;
    const spatialScene = ctx.get(SpatialSceneRepository);
    const metadata = ctx.get(SystemMetadataRepository);

    const grid: Record<string, string> = {};
    const mismatches: string[] = [];

    for (const enabled of SETTINGS) {
      await setEnabled(metadata, enabled);
      for (const actor of ACTORS) {
        for (const op of OPS) {
          const key = `${actor}|enabled=${enabled}|${opLabel(op)}`;
          const fail = (why: string) => {
            mismatches.push(`${key}: ${why}`);
          };

          await spatialScene.setOffer(asset.id, seedOf(op));
          jobs.queue.mockClear();
          jobs.queueAll.mockClear();

          let actual: Outcome | string = 'ok';
          try {
            await (op.kind === 'refresh'
              ? sut.refreshDepthMap(auths[actor], asset.id)
              : sut.setOffer(auths[actor], asset.id, { offered: op.offered }));
          } catch (error) {
            actual = classify(error);
          }

          const expected = expectedOutcome(actor, enabled);
          if (actual !== expected) {
            fail(`outcome ${actual}, expected ${expected}`);
          }

          const choice = await choiceOf(db, asset.id);
          const queued = jobs.queue.mock.calls.length + jobs.queueAll.mock.calls.length;
          const after = actual === 'ok' ? expectedAfter(op) : { offered: seedOf(op), queued: 0 };
          if (choice !== after.offered) {
            fail(`choice ${choice}, expected ${after.offered}`);
          }
          if (queued !== after.queued) {
            fail(`${queued} jobs queued, expected ${after.queued}`);
          }

          grid[key] = actual;
        }
      }
    }

    expect(mismatches).toEqual([]);
    expect(Object.keys(grid)).toHaveLength(ACTORS.length * SETTINGS.length * OPS.length);

    const counts: Record<string, number> = {};
    for (const value of Object.values(grid)) {
      counts[value] = (counts[value] ?? 0) + 1;
    }
    const sorted = Object.fromEntries(Object.entries(grid).toSorted(([a], [b]) => a.localeCompare(b)));
    expect({ counts, grid: sorted }).toMatchSnapshot();
  });
});
