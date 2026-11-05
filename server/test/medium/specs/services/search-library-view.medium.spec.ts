import { Kysely } from 'kysely';
import { LibraryView } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { DB } from 'src/schema/index.js';
import { SearchService } from 'src/services/search.service.js';
import { seedLibraryView } from 'test/medium/fixtures/library-view.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const seed = async () => {
  const { sut, ctx } = newMediumService(SearchService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      PartnerRepository,
      SearchRepository,
      SharedSpaceRepository,
    ],
    mock: [LoggingRepository],
  });
  const world = await seedLibraryView(ctx);
  const auth = factory.auth({ user: world.me });
  const search = async (libraryView?: LibraryView) => {
    const { assets } = await sut.searchMetadata(auth, { withSharedSpaces: true, libraryView, size: 100 });
    return world.name(assets.items.map(({ id }) => id));
  };
  return { ...world, sut, auth, search };
};

// The Photos filters and search follow the library view: the app filters through search, and the web replays it
// for "add all to collection".
describe('search library view', () => {
  it('finds both without a library view', async () => {
    const { search } = await seed();

    // Search keeps partner photos and my photos in a hidden space; both views leave them out.
    expect(await search()).toEqual([
      'mine',
      'mineInAlbum',
      'mineInHiddenSpace',
      'mineInLibrary',
      'mineInSpace',
      'partner',
      'peerInSpace',
    ]);
  });

  it('personal: only my photos that are in no space', async () => {
    const { search } = await seed();

    expect(await search(LibraryView.Personal)).toEqual(['mine']);
  });

  it('spaces: only the photos that reach me through a space on my timeline, mine included', async () => {
    const { search } = await seed();

    expect(await search(LibraryView.Spaces)).toEqual(['mineInAlbum', 'mineInLibrary', 'mineInSpace', 'peerInSpace']);
  });

  it('counts each view in the statistics', async () => {
    const { sut, auth } = await seed();
    const total = async (libraryView: LibraryView) => {
      const { total } = await sut.searchStatistics(auth, { withSharedSpaces: true, libraryView });
      return total;
    };

    expect(await total(LibraryView.Personal)).toBe(1);
    expect(await total(LibraryView.Spaces)).toBe(4);
  });

  it('is refused on the structured search, which has no flat scope fields', async () => {
    const { sut, auth } = await seed();

    await expect(sut.searchMetadata(auth, { filter: {}, libraryView: LibraryView.Personal, size: 10 })).rejects.toThrow(
      'libraryView need the flat search fields',
    );
  });
});
