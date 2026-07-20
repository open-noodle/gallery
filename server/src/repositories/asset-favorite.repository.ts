import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { Chunked, DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';

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

    await this.db
      .insertInto('asset_favorite')
      .values(assetIds.map((assetId) => ({ userId, assetId })))
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  // (E9) Unfavoriting a never-favorited asset must be a no-op, not an error.
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @Chunked({ paramIndex: 1 })
  async removeAll(userId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    await this.db.deleteFrom('asset_favorite').where('userId', '=', userId).where('assetId', 'in', assetIds).execute();
  }
}
