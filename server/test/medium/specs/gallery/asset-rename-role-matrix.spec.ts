/**
Authorization matrix of the in-app file rename: ACTOR x ASSET KIND x OPERATION, over the real service, a real database and
a real folder (specs/2026-11-10-external-library-move-rename-design.md, decision 7; AGENTS.md rule 7).

The truth table below is the spec's rule written out by hand, not computed from the production code: only the owner of
a file renames it. Nobody else may, whatever their role in a space the file is in, whether they are a server admin, or a
partner who can read it. A denied call must leave the row and the file exactly as they were, so every cell also checks
the database and the disk. A call by the owner on an upload-managed asset may only change the name Gallery shows.

Mutation-checked once: with the access check and the owner check removed from AssetRenameService.loadOwned, the
non-owner cells fail (they rename the file).
*/
import { Kysely } from 'kysely';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ChecksumAlgorithm, SharedSpaceRole } from 'src/enum.js';
import { FileOperationRepository } from 'src/gallery/repositories/file-operation.repository.js';
import { AssetRenameService } from 'src/gallery/services/asset-rename.service.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LibraryRepository } from 'src/repositories/library.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;
let root: string;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
  root = await mkdtemp(path.join(tmpdir(), 'gallery-rename-matrix-'));
  return () => rm(root, { recursive: true, force: true });
});

const ACTORS = [
  'owner',
  'space owner',
  'space editor',
  'space viewer',
  'partner',
  'non-member',
  'server admin, not a member',
] as const;
type Actor = (typeof ACTORS)[number];

const KINDS = ['external', 'upload-managed'] as const;
type Kind = (typeof KINDS)[number];

const OPERATIONS = ['check', 'rename name', 'rename on disk'] as const;
type Operation = (typeof OPERATIONS)[number];

type Outcome = 'done' | 'denied' | 'refused';

// The rule, by hand. `refused` is the owner asking for a disk rename of a file Gallery does not keep on disk.
const TRUTH: Record<Actor, Record<Kind, Record<Operation, Outcome>>> = {
  owner: {
    external: { check: 'done', 'rename name': 'done', 'rename on disk': 'done' },
    'upload-managed': { check: 'done', 'rename name': 'done', 'rename on disk': 'refused' },
  },
  ...Object.fromEntries(
    ACTORS.filter((actor) => actor !== 'owner').map((actor) => [
      actor,
      {
        external: { check: 'denied', 'rename name': 'denied', 'rename on disk': 'denied' },
        'upload-managed': { check: 'denied', 'rename name': 'denied', 'rename on disk': 'denied' },
      },
    ]),
  ),
} as Record<Actor, Record<Kind, Record<Operation, Outcome>>>;

const setup = () => {
  const { sut, ctx } = newMediumService(AssetRenameService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      CryptoRepository,
      FileOperationRepository,
      LibraryRepository,
      PartnerRepository,
      SharedSpaceRepository,
      StorageRepository,
      UserRepository,
    ],
    mock: [EventRepository, JobRepository, LoggingRepository],
  });
  ctx.getMock(JobRepository).queueAll.mockResolvedValue(void 0);
  return { sut, ctx };
};

const hash = (file: string) => new CryptoRepository().hashSha1(`path:${file}`);

/** One owner, one asset of the kind, in a space where every role is held, and every actor. */
const world = async (kind: Kind) => {
  const { sut, ctx } = setup();
  const { user: owner } = await ctx.newUser();
  const [spaceOwner, spaceEditor, spaceViewer, partner, nonMember, admin] = await Promise.all([
    ctx.newUser(),
    ctx.newUser(),
    ctx.newUser(),
    ctx.newUser(),
    ctx.newUser(),
    ctx.newUser({ isAdmin: true }),
  ]);
  const people = {
    'space owner': spaceOwner.user,
    'space editor': spaceEditor.user,
    'space viewer': spaceViewer.user,
    partner: partner.user,
    'non-member': nonMember.user,
    'server admin, not a member': admin.user,
  };

  const folder = await mkdtemp(path.join(root, 'folder-'));
  const { id: libraryId } = await defaultDatabase
    .insertInto('library')
    .values({ name: 'External', ownerId: owner.id, importPaths: [folder], exclusionPatterns: [] })
    .returning('id')
    .executeTakeFirstOrThrow();

  const originalPath = path.join(folder, 'IMG_0007.jpg');
  await writeFile(originalPath, 'content');
  const external = kind === 'external';
  const { asset } = await ctx.newAsset({
    ownerId: owner.id,
    originalPath,
    originalFileName: 'IMG_0007.jpg',
    ...(external && {
      libraryId,
      isExternal: true,
      checksum: hash(originalPath),
      checksumAlgorithm: ChecksumAlgorithm.sha1Path,
    }),
  });

  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });
  for (const [actor, role] of [
    ['space owner', SharedSpaceRole.Owner],
    ['space editor', SharedSpaceRole.Editor],
    ['space viewer', SharedSpaceRole.Viewer],
  ] as const) {
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: people[actor].id, role });
  }
  await ctx.newPartner({ sharedById: owner.id, sharedWithId: people.partner.id });

  const users = { owner, ...people };
  return { sut, asset, folder, originalPath, users };
};

const state = async (asset: { id: string }, folder: string) => {
  const names = await readdir(folder);
  const row = await defaultDatabase
    .selectFrom('asset')
    .select(['originalPath', 'originalFileName', 'checksum'])
    .where('id', '=', asset.id)
    .executeTakeFirstOrThrow();
  return { row, files: names.toSorted() };
};

const run = async (
  sut: AssetRenameService,
  auth: ReturnType<typeof factory.auth>,
  id: string,
  operation: Operation,
): Promise<Outcome> => {
  try {
    if (operation === 'check') {
      await sut.check(auth, id, { fileName: 'Beach' });
    } else {
      await sut.rename(auth, id, { fileName: 'Beach', renameOnDisk: operation === 'rename on disk' });
    }
    return 'done';
  } catch (error) {
    const message = (error as Error).message;
    // access denied is the standard "Not found or no asset.update access"; the other is the disk rename of a file
    // Gallery does not keep on disk
    if (message.includes('no asset.update access')) {
      return 'denied';
    }
    if (message.includes('external library')) {
      return 'refused';
    }
    throw error;
  }
};

describe('file rename authorization matrix', () => {
  const grid: Record<string, Outcome> = {};

  for (const kind of KINDS) {
    for (const actor of ACTORS) {
      for (const operation of OPERATIONS) {
        it(`${actor} / ${kind} / ${operation}`, async () => {
          const { sut, asset, folder, users } = await world(kind);
          const before = await state(asset, folder);
          const user = users[actor];
          const auth = factory.auth({ user: { id: user.id, email: user.email, isAdmin: user.isAdmin } });

          const outcome = await run(sut, auth, asset.id, operation);
          grid[`${actor} / ${kind} / ${operation}`] = outcome;

          expect(outcome).toBe(TRUTH[actor][kind][operation]);

          const after = await state(asset, folder);
          if (outcome === 'denied' || outcome === 'refused' || operation === 'check') {
            // no partial write: neither the row nor the folder changed
            expect(after).toEqual(before);
          } else if (operation === 'rename name') {
            expect(after.row).toMatchObject({ originalFileName: 'Beach.jpg', originalPath: before.row.originalPath });
            expect(after.files).toEqual(before.files);
          } else {
            expect(after.row.originalPath).toBe(path.join(folder, 'Beach.jpg'));
            expect(after.files).toEqual(['Beach.jpg']);
          }
        });
      }
    }
  }

  // Runs after every cell above: a cell that is added, dropped or changed shows up in review as a snapshot diff.
  it('records the outcome of every cell', () => {
    expect(Object.keys(grid)).toHaveLength(ACTORS.length * KINDS.length * OPERATIONS.length);
    expect(grid).toMatchSnapshot();
  });
});
