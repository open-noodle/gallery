import { Injectable } from '@nestjs/common';
import { Kysely, NotNull, sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetFileType, AssetType, AssetVisibility, MemoryType } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { favoriteExistsFor } from 'src/utils/favorite.js';

export interface MemoryAsset {
  id: string;
  localDateTime: Date;
}

export interface MemoryPersonDayCount {
  personId: string;
  day: Date;
  count: number;
}

export interface MemoryLocationCluster {
  country: string | null;
  city: string | null;
  assetCount: number;
  dayCount: number;
  firstDate: Date;
  lastDate: Date;
}

export interface MemoryPeriodAsset {
  id: string;
  localDateTime: Date;
  year: number;
  country: string | null;
  city: string | null;
  isFavorite: boolean;
  type: AssetType;
  duration: number | null;
}

export interface MemoryPeriodFace {
  assetId: string;
  localDateTime: Date;
  year: number;
  personId: string;
  personName: string;
}

export interface MemoryPeriodOptions {
  /** calendar months (1–12) to include */
  months: number[];
  /** optional day-of-month filter (for on-this-day style rules) */
  day?: number;
  /** when true, only favorited assets are returned */
  favoritesOnly?: boolean;
  /** when set, only assets of this type are returned */
  type?: AssetType;
  /** exclude assets taken after this instant (defensive guard against future-dated assets) */
  takenBefore: Date;
}

@Injectable()
export class MemoryRuleAssetRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, DummyValue.DATE] })
  getMemoryAssetsForPerson(ownerId: string, personId: string, takenBefore: Date): Promise<MemoryAsset[]> {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.localDateTime'])
      .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
      .innerJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
      .where('asset.ownerId', '=', ownerId)
      .where('asset_face.personGroupId', '=', personId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '<=', takenBefore)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .distinctOn(['asset.id'])
      .orderBy('asset.id')
      .orderBy('asset.localDateTime', 'desc')
      .limit(60)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { takenAfter: DummyValue.DATE, takenBefore: DummyValue.DATE }] })
  getMemoryLocationClusters(
    ownerId: string,
    { takenAfter, takenBefore }: { takenAfter: Date; takenBefore: Date },
  ): Promise<MemoryLocationCluster[]> {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset_exif.country as country',
        'asset_exif.city as city',
        sql<number>`count(*)::int`.as('assetCount'),
        sql<number>`count(distinct (asset."localDateTime" at time zone 'UTC')::date)::int`.as('dayCount'),
        sql<Date>`min(asset."localDateTime")`.as('firstDate'),
        sql<Date>`max(asset."localDateTime")`.as('lastDate'),
      ])
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '>=', takenAfter)
      .where('asset.localDateTime', '<=', takenBefore)
      .where('asset_exif.country', 'is not', null)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .groupBy(['asset_exif.country', 'asset_exif.city'])
      .orderBy('assetCount', 'desc')
      .execute();
  }

  @GenerateSql({
    params: [
      DummyValue.UUID,
      {
        country: DummyValue.STRING,
        city: DummyValue.STRING,
        takenAfter: DummyValue.DATE,
        takenBefore: DummyValue.DATE,
      },
    ],
  })
  getMemoryAssetsForLocation(
    ownerId: string,
    {
      country,
      city,
      takenAfter,
      takenBefore,
    }: { country: string; city: string | null; takenAfter: Date; takenBefore: Date },
  ): Promise<MemoryAsset[]> {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.localDateTime'])
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '>=', takenAfter)
      .where('asset.localDateTime', '<=', takenBefore)
      .where('asset_exif.country', '=', country)
      .$if(city !== null, (qb) => qb.where('asset_exif.city', '=', city))
      .$if(city === null, (qb) => qb.where('asset_exif.city', 'is', null))
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .orderBy('asset.localDateTime', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { months: [7], takenBefore: DummyValue.DATE }] })
  getMemoryAssetsForPeriod(
    ownerId: string,
    { months, day, favoritesOnly, type, takenBefore }: MemoryPeriodOptions,
  ): Promise<MemoryPeriodAsset[]> {
    // #763: favorites are a per-user overlay row, not a column on the asset. Memory generation is
    // owner-scoped (`asset.ownerId = ownerId` below), so the owner's own overlay row is exactly what
    // the dropped `asset.isFavorite` column used to carry here — both for the projection and for the
    // `favoritesOnly` filter. `$narrowType` pins the EXISTS result to `boolean`: Kysely types it
    // `SqlBool` (`boolean | number`), which does not satisfy `MemoryPeriodAsset.isFavorite`, but the
    // pg driver only ever returns a boolean for it.
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.localDateTime',
        'asset.type',
        'asset.duration',
        'asset_exif.country as country',
        'asset_exif.city as city',
      ])
      .select((eb) => favoriteExistsFor(eb, ownerId).as('isFavorite'))
      .$narrowType<{ isFavorite: boolean }>()
      .select(sql<number>`extract(year from (asset."localDateTime" at time zone 'UTC'))::int`.as('year'))
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '<=', takenBefore)
      .where(sql<number>`extract(month from (asset."localDateTime" at time zone 'UTC'))::int`, 'in', months)
      .$if(day !== undefined, (qb) =>
        qb.where(sql<number>`extract(day from (asset."localDateTime" at time zone 'UTC'))::int`, '=', day!),
      )
      .$if(favoritesOnly === true, (qb) => qb.where((eb) => favoriteExistsFor(eb, ownerId)))
      .$if(type !== undefined, (qb) => qb.where('asset.type', '=', type!))
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .orderBy('asset.localDateTime', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { months: [6], takenBefore: DummyValue.DATE }] })
  getMemoryFacesForPeriod(
    ownerId: string,
    { months, takenBefore }: { months: number[]; takenBefore: Date },
  ): Promise<MemoryPeriodFace[]> {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
      .innerJoin('person', 'person.personGroupId', 'asset_face.personGroupId')
      .select([
        'asset.id as assetId',
        'asset.localDateTime',
        'person.personGroupId as personId',
        'person.name as personName',
      ])
      .select(sql<number>`extract(year from (asset."localDateTime" at time zone 'UTC'))::int`.as('year'))
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '<=', takenBefore)
      .where(sql<number>`extract(month from (asset."localDateTime" at time zone 'UTC'))::int`, 'in', months)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('person.ownerId', '=', ownerId)
      .where('person.name', '!=', '')
      .where('person.isHidden', '=', false)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .orderBy('asset.localDateTime', 'asc')
      .execute();
  }

  /**
   * One row per (person, calendar day) among `personIds`, with the distinct asset count that day.
   * Predicates mirror `getMemoryFacesForPeriod` — Timeline visibility, not deleted, previewable —
   * so a person's density is never skewed by archived or preview-less assets.
   */
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID], { takenBefore: DummyValue.DATE }] })
  getMemoryPersonDailyCounts(
    ownerId: string,
    personIds: string[],
    { takenBefore }: { takenBefore: Date },
  ): Promise<MemoryPersonDayCount[]> {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
      .select('asset_face.personGroupId as personId')
      .select(sql<Date>`date_trunc('day', asset."localDateTime" at time zone 'UTC')`.as('day'))
      .select((eb) =>
        eb.fn
          .count(eb.fn('distinct', ['asset.id']))
          .$castTo<number>()
          .as('count'),
      )
      .$narrowType<{ personId: NotNull }>()
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '<=', takenBefore)
      .where('asset_face.personGroupId', 'in', personIds)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .groupBy(['asset_face.personGroupId', 'day'])
      .orderBy('asset_face.personGroupId')
      .orderBy('day', 'asc')
      .execute();
  }

  /**
   * Assets of one person inside an inclusive `[from, to]` day window (`to` is a calendar day, so
   * the upper bound is exclusive of the following day). Bounded by a ≤14-day window — no `LIMIT`.
   * Do not copy `getMemoryAssetsForPerson`'s `ORDER BY asset.id … LIMIT 60` — that returns the 60
   * lowest UUIDs, an arbitrary sample, not the most recent assets.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, { from: DummyValue.DATE, to: DummyValue.DATE }] })
  getMemoryAssetsForPersonWindow(
    ownerId: string,
    personId: string,
    { from, to }: { from: Date; to: Date },
  ): Promise<MemoryAsset[]> {
    // `to` is the chapter's last day at UTC midnight, so the upper bound must be exclusive of the
    // following day — otherwise assets later on the final day (after `to`'s midnight) are dropped.
    const toExclusive = new Date(to.getTime() + 24 * 60 * 60 * 1000);

    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.localDateTime'])
      .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
      .where('asset.ownerId', '=', ownerId)
      .where('asset_face.personGroupId', '=', personId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '>=', from)
      .where('asset.localDateTime', '<', toExclusive)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .distinctOn(['asset.id'])
      .orderBy('asset.id')
      .orderBy('asset.localDateTime', 'asc')
      .execute();
  }

  /**
   * Memories of one owner whose visible window overlaps `window`, with the asset ids they
   * actually render. The asset filters MUST stay identical to `MemoryRepository.search` — floors are measured
   * over what the card shows, and an asset carrying a hidden person's face is not shown.
   */
  @GenerateSql({ params: [DummyValue.UUID, { from: DummyValue.DATE, to: DummyValue.DATE }] })
  getForOverlapReconcile(ownerId: string, window: { from: Date; to: Date }) {
    return this.db
      .selectFrom('memory')
      .select(['memory.id', 'memory.type', 'memory.data', 'memory.isSaved', 'memory.showAt', 'memory.hideAt'])
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('asset')
            .select(['asset.id'])
            .innerJoin('memory_asset', 'asset.id', 'memory_asset.assetId')
            .whereRef('memory_asset.memoriesId', '=', 'memory.id')
            .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
            .where('asset.deletedAt', 'is', null)
            .where((eb) =>
              eb.not(
                eb.exists(
                  eb
                    .selectFrom('asset_face')
                    .innerJoin('person', (join) =>
                      join
                        .onRef('person.personGroupId', '=', 'asset_face.personGroupId')
                        .onRef('person.ownerId', '=', 'asset.ownerId'),
                    )
                    .select((eb) => eb.val(1).as('one'))
                    .whereRef('asset_face.assetId', '=', 'asset.id')
                    .where('person.isHidden', '=', true),
                ),
              ),
            )
            .orderBy('asset.localDateTime', 'asc'),
        ).as('assets'),
      )
      .where('memory.ownerId', '=', ownerId)
      .where('memory.deletedAt', 'is', null)
      .where((eb) => eb.or([eb('memory.showAt', 'is', null), eb('memory.showAt', '<=', window.to)]))
      .where((eb) => eb.or([eb('memory.hideAt', 'is', null), eb('memory.hideAt', '>=', window.from)]))
      .orderBy('memory.id')
      .execute();
  }

  /**
   * Earliest day any memory becomes visible, across all owners — the start of the one-off
   * overlap backfill. `coalesce` mirrors `MemoryRepository.cleanup`, so a memory with no `showAt` still counts.
   */
  @GenerateSql()
  async getOldestMemoryDate(): Promise<Date | null> {
    const row = await this.db
      .selectFrom('memory')
      .select(sql<Date | null>`min(coalesce("showAt", "createdAt"))`.as('oldest'))
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    return row?.oldest ?? null;
  }

  /**
   * Remove the plain `on_this_day` memory a rule memory has just superseded. Scoped to one
   * owner, one trigger day and one year, and never touches a saved memory.
   *
   * Written as an unconditional DELETE ... WHERE rather than a read-then-delete: when the
   * owner has `on_this_day` disabled, or retention already removed the row, there is simply
   * nothing to match. That keeps correctness independent of whether the on-this-day loop has
   * run for the day — it only decides whether this has any effect. (In practice it always
   * has: the on-this-day loop writes up to 3 days ahead and runs first inside the same lock,
   * so the row exists before any rule for that day is evaluated.)
   */
  @GenerateSql({ params: [{ ownerId: DummyValue.UUID, year: DummyValue.NUMBER, showAt: DummyValue.DATE }] })
  async deleteOnThisDay({ ownerId, year, showAt }: { ownerId: string; year: number; showAt: Date }) {
    await this.db
      .deleteFrom('memory')
      .where('ownerId', '=', ownerId)
      .where('type', '=', MemoryType.OnThisDay)
      .where('isSaved', '=', false)
      .where('showAt', '=', showAt)
      .where(sql<string>`memory.data->>'year'`, '=', String(year))
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING, DummyValue.STRING] })
  async hasRuleMemory(ownerId: string, ruleId: string, dedupeKey: string) {
    const result = await this.db
      .selectFrom('memory')
      .select('id')
      .where('ownerId', '=', ownerId)
      .where('type', '=', MemoryType.Rule)
      .where(sql<string>`memory.data->>'ruleId'`, '=', ruleId)
      .where(sql<string>`memory.data->>'dedupeKey'`, '=', dedupeKey)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    return !!result;
  }
}
