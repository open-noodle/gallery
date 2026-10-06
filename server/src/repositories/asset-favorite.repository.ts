import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { Chunked, DummyValue, GenerateSql } from 'src/decorators.js';
import { DB } from 'src/schema/index.js';
import { asUuid } from 'src/utils/database.js';

// Per-user favorites overlay (#763). A favorite is a fact about (user, asset) — see
// docs/superpowers/specs/2026-07-20-per-user-favorites-design.md §3. `addAll`/`removeAll`
// are the only write surface onto `asset_favorite`; the subject is always the caller-supplied
// `userId`, never resolved here — callers (the service layer) are responsible for pinning it
// to the requesting user.
@Injectable()
export class AssetFavoriteRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  // (E8) Re-favoriting an already-favorited asset must be a no-op, not a constraint violation.
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @Chunked({ paramIndex: 1 })
  async addAll(userId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    await this.db.transaction().execute(async (tx) => {
      const changed = await tx
        .insertInto('asset_favorite')
        .values(assetIds.map((assetId) => ({ userId, assetId })))
        .onConflict((oc) => oc.doNothing())
        .returning('assetId')
        .execute();
      await this.touchOwnedAssets(tx, userId, changed);
    });
  }

  // (E9) Unfavoriting a never-favorited asset must be a no-op, not an error.
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @Chunked({ paramIndex: 1 })
  async removeAll(userId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    await this.db.transaction().execute(async (tx) => {
      const changed = await tx
        .deleteFrom('asset_favorite')
        .where('userId', '=', userId)
        .where('assetId', 'in', assetIds)
        .returning('assetId')
        .execute();
      await this.touchOwnedAssets(tx, userId, changed);
    });
  }

  // Legacy-client compatibility: an app that predates AssetFavoritesV1 only learns a favorite
  // change through the asset streams, i.e. through asset.updateId. Before #763 an owner's favorite
  // was a column write that bumped it, so bump it again — but ONLY for assets the caller owns and
  // whose favorite actually changed. That is exactly the pre-#763 re-sync footprint; a non-owner's
  // favorite never touches the asset, so it still cannot amplify into other users' re-syncs.
  private async touchOwnedAssets(tx: Kysely<DB>, userId: string, changed: { assetId: string }[]) {
    if (changed.length === 0) {
      return;
    }

    await tx
      .updateTable('asset')
      .set({ updatedAt: sql`clock_timestamp()` })
      .where('ownerId', '=', userId)
      .where(
        'id',
        'in',
        changed.map(({ assetId }) => assetId),
      )
      .execute();
  }

  // (E21) Duplicate-merge: a per-user UNION of every source asset's favorite rows onto the
  // keeper, run BEFORE the sources are deleted (their own rows CASCADE away with them — see
  // duplicate.service.ts resolveGroup). A single INSERT ... SELECT DISTINCT avoids a
  // read-then-write round trip; `onConflict do nothing` handles both re-runs and a user who
  // favorited more than one source asset (E8: exactly one keeper row, not a PK violation).
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @Chunked({ paramIndex: 1 })
  async mergeOnto(keeperId: string, sourceAssetIds: string[]): Promise<void> {
    if (sourceAssetIds.length === 0) {
      return;
    }

    await this.db
      .insertInto('asset_favorite')
      .expression((eb) =>
        eb
          .selectFrom('asset_favorite')
          // Explicit ::uuid cast (unlike copyAlbums' plain eb.val): DISTINCT forces Postgres to
          // resolve the literal's type for the dedup comparison before the INSERT's implicit
          // assignment cast would otherwise apply, and a bare text literal can't be compared
          // against/assigned into a uuid column without it ("column is of type uuid but
          // expression is of type text").
          .select(['asset_favorite.userId', asUuid(keeperId).as('assetId')])
          .distinct()
          .where('asset_favorite.assetId', 'in', sourceAssetIds),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
}
