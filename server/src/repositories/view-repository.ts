import { ExpressionBuilder, Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetVisibility } from 'src/enum';
import { DB } from 'src/schema';
import { asUuid, withExif } from 'src/utils/database';

export class ViewRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  async getUniqueOriginalPaths(userId: string) {
    const results = await this.db
      .selectFrom('asset')
      .select((eb) => eb.fn<string>('substring', ['asset.originalPath', eb.val('^(.*/)[^/]*$')]).as('directoryPath'))
      .distinct()
      .where((eb) => this.ownedOrSpaceAccessible(eb, userId))
      .where('visibility', '=', AssetVisibility.Timeline)
      .where('deletedAt', 'is', null)
      .where('fileCreatedAt', 'is not', null)
      .where('fileModifiedAt', 'is not', null)
      .where('localDateTime', 'is not', null)
      .orderBy('directoryPath', 'asc')
      .execute();

    return results.map((row) => row.directoryPath.replaceAll(/\/$/g, ''));
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  async getAssetsByOriginalPath(userId: string, partialPath: string) {
    const normalizedPath = partialPath.replaceAll(/\/$/g, '');

    return this.db
      .selectFrom('asset')
      .selectAll('asset')
      .$call(withExif)
      .where((eb) => this.ownedOrSpaceAccessible(eb, userId))
      .where('visibility', '=', AssetVisibility.Timeline)
      .where('deletedAt', 'is', null)
      .where('fileCreatedAt', 'is not', null)
      .where('fileModifiedAt', 'is not', null)
      .where('localDateTime', 'is not', null)
      .where('originalPath', 'like', `%${normalizedPath}/%`)
      .where('originalPath', 'not like', `%${normalizedPath}/%/%`)
      .orderBy(
        (eb) => eb.fn('regexp_replace', ['asset.originalPath', eb.val('.*/(.+)'), eb.val(String.raw`\1`)]),
        'asc',
      )
      .execute();
  }

  // The folder explorer shows folders for assets a user can actually see: their own,
  // plus any reachable through a shared space they are a member of — either added to
  // the space directly or via a library linked to the space. Mirrors the access rules
  // in AccessRepository.checkSpaceAccess so non-admin space members are not stuck with
  // an empty tree (issue #637).
  private ownedOrSpaceAccessible(eb: ExpressionBuilder<DB, 'asset'>, userId: string) {
    return eb.or([
      eb('asset.ownerId', '=', asUuid(userId)),
      eb.exists(
        eb
          .selectFrom('shared_space_asset')
          .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_asset.spaceId')
          .whereRef('shared_space_asset.assetId', '=', 'asset.id')
          .where('shared_space_member.userId', '=', asUuid(userId)),
      ),
      eb.exists(
        eb
          .selectFrom('shared_space_library')
          .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_library.spaceId')
          .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
          .where('shared_space_member.userId', '=', asUuid(userId)),
      ),
    ]);
  }
}
