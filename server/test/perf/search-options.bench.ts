/**
`POST /search/options` on a 500,000-asset library, against what the mobile app triggers today on every filter change
(`GET /search/suggestions/filters`). Opt-in: see test/perf/README.md. Results and conclusions:
specs/research/2026-10-23-search-options-500k-benchmark.md.

Everything is timed at the service level, so each number covers the same scope resolution and SQL the endpoint runs
(no HTTP). The library is seeded set-based (`generate_series`) into a dedicated container and ANALYZEd.
*/
import { CompiledQuery, Kysely, sql } from 'kysely';
import { writeFileSync } from 'node:fs';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { SearchSuggestionType } from 'src/dtos/search.dto.js';
import { AssetVisibility, ChecksumAlgorithm, SharedSpaceRole } from 'src/enum.js';
import {
  FilterSuggestionsRequestDto,
  SearchOptionsDimension,
  SearchOptionsRequestDto,
} from 'src/gallery/dtos/search.dto.js';
import { FaceSearchRepository } from 'src/gallery/repositories/face-search.repository.js';
import { FilterSuggestionRepository } from 'src/gallery/repositories/filter-suggestion.repository.js';
import { SmartFacetRepository } from 'src/gallery/repositories/smart-facet.repository.js';
import { GallerySearchService } from 'src/gallery/services/gallery-search.service.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { DB } from 'src/schema/index.js';
import { SearchService } from 'src/services/search.service.js';
import { TimelineService } from 'src/services/timeline.service.js';
import { getKyselyConfig } from 'src/utils/database.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';

const IMAGE =
  'ghcr.io/immich-app/postgres:14-vectorchord0.4.3@sha256:dbf18b3ffea4a81434c65b71e20d27203baf903a0275f4341e4c16dfd901fd67';
const SCALE = Number(process.env.BENCH_SCALE ?? 1);
const RUNS = Number(process.env.BENCH_RUNS ?? 12);
const WARMUPS = 2;
const n = (count: number) => Math.max(1, Math.round(count * SCALE));

const SIZE = {
  assets: n(500_000),
  partnerAssets: n(50_000),
  spaceAssets: n(100_000),
  people: n(2000),
  faces: n(1_200_000),
  spacePeople: n(100),
  spaceFaces: n(150_000),
  tags: n(300),
  tagAssets: n(400_000),
  albums: n(200),
  albumAssets: n(150_000),
  embeddings: n(50_000),
};

// stdout directly: vitest buffers console output of a long test until it ends
const log = (message: string) => process.stdout.write(`[bench ${new Date().toISOString()}] ${message}\n`);

let container: StartedTestContainer;
let db: Kysely<DB>;

/**
`BENCH_DB_URL` reuses a database (seeded on first use, kept afterwards), so the 500k seed is paid once while
iterating; otherwise a throwaway container is started and stopped.
*/
const startDatabase = async () => {
  if (process.env.BENCH_DB_URL) {
    db = new Kysely<DB>(getKyselyConfig({ connectionType: 'url', url: process.env.BENCH_DB_URL }));
    await new DatabaseRepository(db, LoggingRepository.create(), new ConfigRepository()).runMigrations();
    return;
  }
  container = await new GenericContainer(IMAGE)
    .withExposedPorts(5432)
    .withEnvironment({ POSTGRES_PASSWORD: 'postgres', POSTGRES_USER: 'postgres', POSTGRES_DB: 'immich' })
    .withCommand([
      'postgres',
      '-c',
      'shared_preload_libraries=vchord.so',
      '-c',
      'max_wal_size=4GB',
      '-c',
      'shared_buffers=512MB',
      '-c',
      'fsync=off',
      '-c',
      'full_page_writes=off',
      '-c',
      'synchronous_commit=off',
      '-c',
      'config_file=/var/lib/postgresql/data/postgresql.conf',
    ])
    .withWaitStrategy(Wait.forAll([Wait.forLogMessage('database system is ready to accept connections', 2)]))
    .start();
  const url = `postgres://postgres:postgres@localhost:${container.getMappedPort(5432)}/immich`;
  db = new Kysely<DB>(getKyselyConfig({ connectionType: 'url', url }));
  await new DatabaseRepository(db, LoggingRepository.create(), new ConfigRepository()).runMigrations();
};

const setup = () =>
  newMediumService(GallerySearchService, {
    database: db,
    real: [
      AccessRepository,
      AlbumRepository,
      AssetRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      FaceSearchRepository,
      FilterSuggestionRepository,
      PartnerRepository,
      PersonRepository,
      SearchRepository,
      SharedSpaceRepository,
      SmartFacetRepository,
      TagRepository,
    ],
    mock: [LoggingRepository, MachineLearningRepository, SystemMetadataRepository],
  });

type World = { me: string; partner: string; spaceOwner: string; spaceId: string };

const run = (statement: string, step: string) => {
  const started = performance.now();
  return sql
    .raw(statement)
    .execute(db)
    .then(() => log(`${step}: ${((performance.now() - started) / 1000).toFixed(1)}s`));
};

/** Asset rows plus their EXIF, for `kind` assets owned by `owner` (an SQL expression), numbered 1..count in bench_asset. */
const seedAssets = async (kind: string, owner: string, count: number) => {
  await run(
    `INSERT INTO bench_asset (kind, idx, id) SELECT '${kind}', g, gen_random_uuid() FROM generate_series(1, ${count}) g`,
    `${kind}: ids`,
  );
  await run(
    `INSERT INTO asset (id, "ownerId", "originalFileName", checksum, "checksumAlgorithm", type, "originalPath",
       "isFavorite", "fileCreatedAt", "fileModifiedAt", "localDateTime", visibility, "isEdited")
     SELECT id, ${owner}, 'IMG_' || idx || '.jpg', decode(md5(id::text), 'hex'), '${ChecksumAlgorithm.sha1File}',
       CASE WHEN random() < 0.10 THEN 'VIDEO' ELSE 'IMAGE' END, '/library/' || id || '.jpg', false, taken, taken, taken,
       CASE WHEN random() < 0.05 THEN 'archive' ELSE 'timeline' END::asset_visibility_enum, false
     FROM (SELECT id, idx, timestamptz '2014-01-01' + random() * interval '12 years' AS taken
           FROM bench_asset WHERE kind = '${kind}') a`,
    `${kind}: ${count} assets`,
  );
  // ~40 countries and ~400 cities, Zipf-like; 4 makes / 12 models; ~15% rated.
  await run(
    `INSERT INTO asset_exif ("assetId", country, city, make, model, rating, "timeZone")
     SELECT id, 'Country ' || c, 'City ' || c || '-' || ci, (ARRAY['Apple', 'Canon', 'Sony', 'Fujifilm'])[mk + 1],
       (ARRAY['Apple', 'Canon', 'Sony', 'Fujifilm'])[mk + 1] || ' M' || md, rating, 'UTC'
     FROM (SELECT id, floor(40 * power(random(), 3))::int AS c, floor(10 * power(random(), 2))::int AS ci,
             floor(4 * power(random(), 1.5))::int AS mk, floor(3 * random())::int AS md,
             CASE WHEN random() < 0.15 THEN 1 + floor(5 * random())::int END AS rating
           FROM bench_asset WHERE kind = '${kind}') e`,
    `${kind}: exif`,
  );
};

const seed = async (): Promise<World> => {
  const seeded = await sql<World>`
    SELECT me, partner, "spaceOwner", "spaceId" FROM bench_world WHERE scale = ${SCALE}
  `
    .execute(db)
    .catch(() => {});
  if (seeded?.rows[0]) {
    log('reusing the seeded library');
    return seeded.rows[0];
  }

  const { ctx } = setup();
  const { user: me } = await ctx.newUser();
  const { user: partner } = await ctx.newUser();
  const { user: spaceOwner } = await ctx.newUser();
  await ctx.newPartner({ sharedById: partner.id, sharedWithId: me.id, inTimeline: true });
  const { space } = await ctx.newSharedSpace({ createdById: spaceOwner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: spaceOwner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: me.id, role: SharedSpaceRole.Viewer });

  await run(`SELECT setseed(0.42)`, 'seed');
  await run(`CREATE TABLE bench_asset (kind text, idx int, id uuid, PRIMARY KEY (kind, idx))`, 'bench_asset');
  await seedAssets('me', `'${me.id}'`, SIZE.assets);
  await seedAssets('partner', `'${partner.id}'`, SIZE.partnerAssets);
  await seedAssets('space', `'${spaceOwner.id}'`, SIZE.spaceAssets);
  await run(
    `INSERT INTO shared_space_asset ("spaceId", "assetId", "addedById")
     SELECT '${space.id}', id, '${spaceOwner.id}' FROM bench_asset WHERE kind = 'space'`,
    'space assets',
  );

  // People: identity-linked like production's backfill; faces Zipf-skewed (a few people in tens of thousands of photos).
  await run(`CREATE TABLE bench_person (idx int PRIMARY KEY, group_id uuid, identity_id uuid)`, 'bench_person');
  await run(
    `WITH g AS (
       INSERT INTO person_group ("clusterGroupId")
       SELECT u."clusterGroupId" FROM "user" u, generate_series(1, ${SIZE.people}) WHERE u.id = '${me.id}'
       RETURNING id
     )
     INSERT INTO bench_person (idx, group_id, identity_id) SELECT row_number() OVER (), id, gen_random_uuid() FROM g`,
    'person groups',
  );
  await run(
    `INSERT INTO person ("ownerId", "personGroupId", name, "thumbnailPath")
     SELECT '${me.id}', group_id, 'Person ' || idx, '/thumbs/' || idx || '.jpg' FROM bench_person`,
    'people',
  );
  await run(`INSERT INTO face_identity (id, type) SELECT identity_id, 'person' FROM bench_person`, 'identities');
  await run(
    `INSERT INTO person_identity ("personGroupId", "ownerId", "identityId")
     SELECT group_id, '${me.id}', identity_id FROM bench_person`,
    'person identities',
  );
  await run(
    `INSERT INTO asset_face ("assetId", "personGroupId", "sourceType", "boundingBoxX1", "boundingBoxY1",
       "boundingBoxX2", "boundingBoxY2", "imageWidth", "imageHeight")
     SELECT a.id, p.group_id, 'machine-learning', 0, 0, 1, 1, 10, 10
     FROM (SELECT 1 + floor(${SIZE.assets} * random())::int AS ai, 1 + floor(${SIZE.people} * power(random(), 2.5))::int AS pi
           FROM generate_series(1, ${SIZE.faces})) r
     JOIN bench_asset a ON a.kind = 'me' AND a.idx = r.ai
     JOIN bench_person p ON p.idx = r.pi`,
    `${SIZE.faces} faces`,
  );
  await run(
    `INSERT INTO face_identity_face ("assetFaceId", "identityId", source)
     SELECT f.id, p.identity_id, 'owner-person' FROM asset_face f JOIN bench_person p ON p.group_id = f."personGroupId"`,
    'face identities',
  );

  // Space people on the space's assets.
  await run(
    `CREATE TABLE bench_space_person AS
     SELECT g AS idx, gen_random_uuid() AS id FROM generate_series(1, ${SIZE.spacePeople}) g`,
    'bench_space_person',
  );
  await run(
    `INSERT INTO shared_space_person (id, "spaceId", name, "isHidden")
     SELECT id, '${space.id}', 'Space person ' || idx, false FROM bench_space_person`,
    'space people',
  );
  await run(
    `CREATE TABLE bench_space_face AS
     SELECT gen_random_uuid() AS face_id, a.id AS asset_id, sp.id AS person_id
     FROM (SELECT 1 + floor(${SIZE.spaceAssets} * random())::int AS ai,
             1 + floor(${SIZE.spacePeople} * power(random(), 2.5))::int AS pi
           FROM generate_series(1, ${SIZE.spaceFaces})) r
     JOIN bench_asset a ON a.kind = 'space' AND a.idx = r.ai
     JOIN bench_space_person sp ON sp.idx = r.pi`,
    'bench_space_face',
  );
  await run(
    `INSERT INTO asset_face (id, "assetId", "personGroupId", "sourceType", "boundingBoxX1", "boundingBoxY1",
       "boundingBoxX2", "boundingBoxY2", "imageWidth", "imageHeight")
     SELECT face_id, asset_id, NULL, 'machine-learning', 0, 0, 1, 1, 10, 10 FROM bench_space_face`,
    `${SIZE.spaceFaces} space faces`,
  );
  await run(
    `INSERT INTO shared_space_person_face ("personId", "assetFaceId") SELECT person_id, face_id FROM bench_space_face`,
    'space person faces',
  );

  // Tags (flat), albums, favourites, OCR.
  await run(
    `CREATE TABLE bench_tag AS SELECT g AS idx, gen_random_uuid() AS id FROM generate_series(1, ${SIZE.tags}) g`,
    'bench_tag',
  );
  await run(`INSERT INTO tag (id, "userId", value) SELECT id, '${me.id}', 'tag-' || idx FROM bench_tag`, 'tags');
  await run(`INSERT INTO tag_closure (id_ancestor, id_descendant) SELECT id, id FROM bench_tag`, 'tag closure');
  await run(
    `INSERT INTO tag_asset ("assetId", "tagId")
     SELECT a.id, t.id
     FROM (SELECT 1 + floor(${SIZE.assets} * random())::int AS ai, 1 + floor(${SIZE.tags} * power(random(), 2))::int AS ti
           FROM generate_series(1, ${SIZE.tagAssets})) r
     JOIN bench_asset a ON a.kind = 'me' AND a.idx = r.ai
     JOIN bench_tag t ON t.idx = r.ti
     ON CONFLICT DO NOTHING`,
    'tag assets',
  );
  await run(
    `CREATE TABLE bench_album AS SELECT g AS idx, gen_random_uuid() AS id FROM generate_series(1, ${SIZE.albums}) g`,
    'bench_album',
  );
  await run(`INSERT INTO album (id, "albumName") SELECT id, 'Album ' || idx FROM bench_album`, 'albums');
  await run(
    `INSERT INTO album_user ("albumId", "userId", role) SELECT id, '${me.id}', 'owner' FROM bench_album`,
    'album owners',
  );
  await run(
    `INSERT INTO album_asset ("albumId", "assetId")
     SELECT al.id, a.id
     FROM (SELECT 1 + floor(${SIZE.assets} * random())::int AS ai, 1 + floor(${SIZE.albums} * power(random(), 2))::int AS li
           FROM generate_series(1, ${SIZE.albumAssets})) r
     JOIN bench_asset a ON a.kind = 'me' AND a.idx = r.ai
     JOIN bench_album al ON al.idx = r.li
     ON CONFLICT DO NOTHING`,
    'album assets',
  );
  await run(
    `INSERT INTO asset_favorite ("userId", "assetId")
     SELECT '${me.id}', id FROM bench_asset WHERE kind = 'me' AND random() < 0.07`,
    'favourites',
  );
  await run(
    `INSERT INTO ocr_search ("assetId", text)
     SELECT id, (ARRAY['menu', 'receipt', 'street', 'invoice', 'ticket', 'station'])[1 + floor(6 * random())::int]
       || ' ' || (ARRAY['today', 'lunch', 'north', 'total', 'gate', 'exit'])[1 + floor(6 * random())::int]
     FROM bench_asset WHERE kind = 'me' AND random() < 0.02`,
    'ocr',
  );

  // 50k embeddings in 20 clusters, so a reference photo has real neighbours.
  await run(
    `CREATE TABLE bench_center AS
     SELECT k, array(SELECT random() - 0.5 FROM generate_series(1, 512)) AS v FROM generate_series(1, 20) k`,
    'clusters',
  );
  await run(
    `INSERT INTO smart_search ("assetId", embedding)
     SELECT a.id, (SELECT array_agg(c.v[d] + 0.3 * (random() - 0.5) ORDER BY d) FROM generate_series(1, 512) d)::real[]::vector
     FROM bench_asset a JOIN bench_center c ON c.k = 1 + (a.idx % 20)
     WHERE a.kind = 'me' AND a.idx <= ${SIZE.embeddings}`,
    `${SIZE.embeddings} embeddings`,
  );
  await run('ANALYZE', 'analyze');

  await sql`
    CREATE TABLE bench_world AS SELECT ${SCALE}::float8 AS scale, ${me.id}::uuid AS me, ${partner.id}::uuid AS partner,
      ${spaceOwner.id}::uuid AS "spaceOwner", ${space.id}::uuid AS "spaceId"
  `.execute(db);
  return { me: me.id, partner: partner.id, spaceOwner: spaceOwner.id, spaceId: space.id };
};

/**
Photos reach a viewer from many spaces: 8 more spaces of skewed sizes (~345k assets), 2–5 contributing members each,
shown in the owner's timeline for 5 and hidden for 3; ~15% of the owner's own assets also linked into 1–2 spaces and
~10% of each space's assets also in a second space (dedup must hold); 50–300 space people per space, Zipf-skewed,
identity-linked like production's backfill. Seeded once on top of the base library (`bench_space` marks it).
*/
type BenchSpace = { idx: number; id: string; size: number; shown: boolean; topPerson: string };

const spaceShapes = [
  { size: 150_000, shown: true, contributors: 5, people: 300 },
  { size: 80_000, shown: false, contributors: 4, people: 250 },
  { size: 50_000, shown: true, contributors: 3, people: 200 },
  { size: 30_000, shown: true, contributors: 3, people: 150 },
  { size: 20_000, shown: false, contributors: 2, people: 120 },
  { size: 10_000, shown: true, contributors: 2, people: 100 },
  { size: 5000, shown: false, contributors: 2, people: 80 },
  { size: 500, shown: true, contributors: 2, people: 50 },
];

const seedSpaces = async (world: World): Promise<BenchSpace[]> => {
  const existing = await sql<BenchSpace>`
    SELECT idx, id, size, shown, "topPerson" FROM bench_space WHERE scale = ${SCALE} ORDER BY idx
  `
    .execute(db)
    .catch(() => {});
  if (existing?.rows.length) {
    log('reusing the seeded spaces');
    return existing.rows;
  }

  const { ctx } = setup();
  await run(
    `CREATE TABLE bench_space (scale float8, idx int, id uuid, size int, shown boolean, "topPerson" uuid)`,
    'bench_space',
  );
  for (const [index, shape] of spaceShapes.entries()) {
    const idx = index + 1;
    const size = n(shape.size);
    const contributors = [];
    for (let c = 0; c < shape.contributors; c++) {
      const { user } = await ctx.newUser();
      contributors.push(user.id);
    }
    const { space } = await ctx.newSharedSpace({ createdById: contributors[0] });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: contributors[0], role: SharedSpaceRole.Owner });
    for (const contributor of contributors.slice(1)) {
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: contributor, role: SharedSpaceRole.Editor });
    }
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: world.me,
      role: SharedSpaceRole.Viewer,
      showInTimeline: shape.shown,
    });

    const owners = `(ARRAY[${contributors.map((id) => `'${id}'`).join(', ')}]::uuid[])[1 + idx % ${contributors.length}]`;
    await seedAssets(`s${idx}`, owners, size);
    await run(
      `INSERT INTO shared_space_asset ("spaceId", "assetId", "addedById")
       SELECT '${space.id}', id, '${contributors[0]}' FROM bench_asset WHERE kind = 's${idx}'`,
      `s${idx}: space assets`,
    );

    // space people with identities, faces on the space's assets
    const people = n(shape.people);
    await run(
      `CREATE TABLE bench_sp_${idx} AS
       SELECT g AS idx, gen_random_uuid() AS id, gen_random_uuid() AS identity_id FROM generate_series(1, ${people}) g`,
      `s${idx}: people ids`,
    );
    await run(
      `INSERT INTO face_identity (id, type) SELECT identity_id, 'person' FROM bench_sp_${idx}`,
      `s${idx}: identities`,
    );
    await run(
      `INSERT INTO shared_space_person (id, "spaceId", name, "isHidden", "identityId")
       SELECT id, '${space.id}', 'Space ${idx} person ' || idx, false, identity_id FROM bench_sp_${idx}`,
      `s${idx}: people`,
    );
    await run(
      `CREATE TABLE bench_sf_${idx} AS
       SELECT gen_random_uuid() AS face_id, a.id AS asset_id, p.id AS person_id, p.identity_id
       FROM (SELECT 1 + floor(${size} * random())::int AS ai, 1 + floor(${people} * power(random(), 2.5))::int AS pi
             FROM generate_series(1, ${Math.round(size * 1.2)})) r
       JOIN bench_asset a ON a.kind = 's${idx}' AND a.idx = r.ai
       JOIN bench_sp_${idx} p ON p.idx = r.pi`,
      `s${idx}: face plan`,
    );
    await run(
      `INSERT INTO asset_face (id, "assetId", "personGroupId", "sourceType", "boundingBoxX1", "boundingBoxY1",
         "boundingBoxX2", "boundingBoxY2", "imageWidth", "imageHeight")
       SELECT face_id, asset_id, NULL, 'machine-learning', 0, 0, 1, 1, 10, 10 FROM bench_sf_${idx}`,
      `s${idx}: faces`,
    );
    await run(
      `INSERT INTO shared_space_person_face ("personId", "assetFaceId") SELECT person_id, face_id FROM bench_sf_${idx}`,
      `s${idx}: person faces`,
    );
    await run(
      `INSERT INTO face_identity_face ("assetFaceId", "identityId", source)
       SELECT face_id, identity_id, 'ml' FROM bench_sf_${idx}`,
      `s${idx}: face identities`,
    );
    const top = await sql<{ id: string }>`SELECT id FROM ${sql.table(`bench_sp_${idx}`)} WHERE idx = 1`.execute(db);
    await sql`
      INSERT INTO bench_space VALUES (${SCALE}, ${idx}, ${space.id}, ${size}, ${shape.shown}, ${top.rows[0].id})
    `.execute(db);
  }

  // Overlap: ~15% of the owner's assets also in 1–2 spaces, ~10% of each space's assets also in another space.
  await run(
    `INSERT INTO shared_space_asset ("spaceId", "assetId", "addedById")
     SELECT s.id, a.id, '${world.me}'
     FROM (SELECT id, 1 + floor(8 * random())::int AS target, random() < 0.3 AS second FROM bench_asset
           WHERE kind = 'me' AND random() < 0.15) a
     JOIN bench_space s ON s.idx = a.target OR (a.second AND s.idx = 1 + (a.target % 8))
     ON CONFLICT DO NOTHING`,
    'overlap: own assets in spaces',
  );
  await run(
    `INSERT INTO shared_space_asset ("spaceId", "assetId", "addedById")
     SELECT s.id, a.id, NULL
     FROM bench_asset a
     JOIN bench_space s ON s.idx = 1 + (substring(a.kind FROM 2)::int % 8)
     WHERE a.kind ~ '^s[0-9]+$' AND random() < 0.10
     ON CONFLICT DO NOTHING`,
    'overlap: space assets in a second space',
  );
  await run('ANALYZE', 'analyze');

  const rows = await sql<BenchSpace>`
    SELECT idx, id, size, shown, "topPerson" FROM bench_space WHERE scale = ${SCALE} ORDER BY idx
  `.execute(db);
  return rows.rows;
};

const measure = async (fn: () => Promise<unknown>) => {
  for (let i = 0; i < WARMUPS; i++) {
    await fn();
  }
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    await fn();
    samples.push(performance.now() - started);
  }
  const sorted = samples.toSorted((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return { median: Math.round(at(0.5)), p95: Math.round(at(0.95)) };
};

type Timing = { median: number; p95: number } | null;
type State = {
  name: string;
  /** Scope only, no filter: the cached state. */
  unfiltered?: boolean;
  old?: FilterSuggestionsRequestDto;
  options: SearchOptionsRequestDto;
  /** The results call: resolves to its count when it has one. */
  results: () => Promise<number | void>;
};

/**
Runs `fn` against a database handle that records every statement with its duration, then EXPLAINs (ANALYZE,
BUFFERS) each one with its parameters: the slowest statements of a case, plan included.
*/
const explainStatements = async (fn: (traced: Kysely<DB>) => Promise<unknown>) => {
  const statements: Array<{ sql: string; parameters: readonly unknown[]; ms: number }> = [];
  const url =
    process.env.BENCH_DB_URL ?? `postgres://postgres:postgres@localhost:${container.getMappedPort(5432)}/immich`;
  const traced = new Kysely<DB>({
    ...getKyselyConfig({ connectionType: 'url', url }),
    log: (event) => {
      if (event.level === 'query') {
        statements.push({ sql: event.query.sql, parameters: event.query.parameters, ms: event.queryDurationMillis });
      }
    },
  });
  await fn(traced);
  const report: string[] = [];
  for (const statement of statements.toSorted((a, b) => b.ms - a.ms)) {
    const plan = await traced
      .executeQuery<{ 'QUERY PLAN': string }>(
        CompiledQuery.raw(`EXPLAIN (ANALYZE, BUFFERS) ${statement.sql}`, [...statement.parameters]),
      )
      .catch((error: Error) => ({ rows: [{ 'QUERY PLAN': `(not explainable: ${error.message})` }] }));
    report.push(
      `=== ${statement.ms.toFixed(0)} ms (as run concurrently) ===\n${statement.sql}\n\n${plan.rows.map((row) => row['QUERY PLAN']).join('\n')}\n`,
    );
  }
  await traced.destroy();
  return report.join('\n');
};

describe('search options on a 500k-asset library', () => {
  let world: World;
  let spaces: BenchSpace[];

  beforeAll(async () => {
    log(`scale ${SCALE}: ${JSON.stringify(SIZE)}`);
    await startDatabase();
    world = await seed();
    spaces = await seedSpaces(world);
  });

  afterAll(async () => {
    await db?.destroy();
    await container?.stop();
  });

  it('times OLD (filter suggestions) against NEW (search options) per filter state', async () => {
    const { sut, ctx } = setup();
    // default system config: smart search on, no distance cutoff (the shipped default)
    ctx.getMock(SystemMetadataRepository).get.mockResolvedValue({});
    const search = ctx.getService(SearchService);
    const timeline = ctx.getService(TimelineService);
    const auth = factory.auth({ user: { id: world.me } });
    const setupService = () => ctx.getService(GallerySearchService);

    const top = await sql<{ groupId: string; country: string; tag1: string; tag2: string; ref: string }>`
      SELECT (SELECT group_id FROM bench_person WHERE idx = 1) AS "groupId",
             'Country 0' AS country,
             (SELECT id FROM bench_tag WHERE idx = 1) AS tag1,
             (SELECT id FROM bench_tag WHERE idx = 2) AS tag2,
             (SELECT id FROM bench_asset WHERE kind = 'me' AND idx = 1) AS ref
    `.execute(db);
    const { groupId, country, tag1, tag2, ref } = top.rows[0];
    const person = `person:${groupId}`;
    const year = {
      takenAfter: new Date('2020-01-01T00:00:00.000Z'),
      takenBefore: new Date('2021-01-01T00:00:00.000Z'),
    };
    const photos = { withSharedSpaces: true, withPartners: true, visibility: AssetVisibility.Timeline };
    /** The results call's count: what the options total must equal. */
    const buckets = (dto: Record<string, unknown>) => () =>
      timeline.getTimeBuckets(auth, dto).then((rows) => rows.reduce((sum, { count }) => sum + count, 0));
    const largest = spaces.find(({ idx }) => idx === 1)!;
    const smallest = spaces.find(({ idx }) => idx === spaceShapes.length)!;
    const photoBuckets = { withSharedSpaces: true, withPartners: true, visibility: AssetVisibility.Timeline };

    const states: State[] = [
      {
        name: '1. no filters (Photos)',
        unfiltered: true,
        old: { withSharedSpaces: true },
        options: photos,
        results: buckets(photoBuckets),
      },
      {
        name: '2. one top person',
        old: { withSharedSpaces: true, personIds: [person] },
        options: { ...photos, personIds: [person] },
        results: buckets({ ...photoBuckets, personIds: [person] }),
      },
      {
        name: '3. top person + one country',
        old: { withSharedSpaces: true, personIds: [person], country },
        options: { ...photos, personIds: [person], country },
        results: buckets({ ...photoBuckets, personIds: [person], country }),
      },
      {
        name: '4. two tags',
        old: { withSharedSpaces: true, tagIds: [tag1, tag2] },
        options: { ...photos, tagIds: [tag1, tag2] },
        results: buckets({ ...photoBuckets, tagIds: [tag1, tag2] }),
      },
      {
        name: '5. rating ≥4 + favorites',
        old: { withSharedSpaces: true, rating: 4, isFavorite: true },
        options: { ...photos, rating: 4, isFavorite: true },
        results: buckets({ ...photoBuckets, rating: 4, isFavorite: true }),
      },
      {
        name: '6. one year',
        old: { withSharedSpaces: true, ...year },
        options: { ...photos, ...year },
        results: buckets({
          ...photoBuckets,
          takenAfter: year.takenAfter.toISOString(),
          takenBefore: year.takenBefore.toISOString(),
        }),
      },
      {
        name: '7. space scope',
        unfiltered: true,
        old: { spaceId: world.spaceId },
        options: { spaceId: world.spaceId },
        results: buckets({ spaceId: world.spaceId }),
      },
      {
        name: '8. archive scope',
        unfiltered: true,
        options: { visibility: AssetVisibility.Archive, ownerId: world.me },
        results: buckets({ visibility: AssetVisibility.Archive }),
      },
      {
        name: '9. OCR text',
        options: { ...photos, ocr: 'menu' },
        results: buckets({ ...photoBuckets, ocr: 'menu' }),
      },
      {
        name: '10. query: reference photo + one person',
        old: { withSharedSpaces: true, personIds: [person] },
        options: {
          withSharedSpaces: true,
          visibility: AssetVisibility.Timeline,
          queryAssetId: ref,
          personIds: [person],
        },
        // smart search pages its results (no total), so this one is timed, not compared
        results: () =>
          search
            .searchSmart(auth, {
              withSharedSpaces: true,
              visibility: AssetVisibility.Timeline,
              queryAssetId: ref,
              personIds: [person],
              size: 100,
            })
            .then(() => {}),
      },
      {
        name: '11. Photos + one space person (token)',
        old: { withSharedSpaces: true, personIds: [`space-person:${largest.topPerson}`] },
        options: { ...photos, personIds: [`space-person:${largest.topPerson}`] },
        results: buckets({ ...photoBuckets, personIds: [`space-person:${largest.topPerson}`] }),
      },
      {
        name: '12. largest space, no filters',
        unfiltered: true,
        old: { spaceId: largest.id },
        options: { spaceId: largest.id },
        results: buckets({ spaceId: largest.id }),
      },
      {
        name: '13. largest space + one space person',
        old: { spaceId: largest.id, personIds: [largest.topPerson] },
        options: { spaceId: largest.id, spacePersonIds: [largest.topPerson] },
        results: buckets({ spaceId: largest.id, spacePersonIds: [largest.topPerson] }),
      },
      {
        name: '14. smallest space, no filters',
        unfiltered: true,
        old: { spaceId: smallest.id },
        options: { spaceId: smallest.id },
        results: buckets({ spaceId: smallest.id }),
      },
    ];

    const lists = ['total', 'time', 'people', 'tags', 'places', 'cameras', 'ratings', 'mediaTypes'] as const;
    type Row = {
      state: string;
      unfiltered: boolean;
      total: number;
      old: Timing;
      results: Timing;
      availability: Timing;
      dimensions: Record<(typeof lists)[number], Timing>;
      /** Availability and every list, each its own request, fired together: what a client opening search does. */
      parallel: Timing;
      /** Unfiltered only: the same requests once cached (watermark check included). */
      warm: Timing;
      warmParallel: Timing;
    };
    const ask = (
      service: GallerySearchService,
      options: SearchOptionsRequestDto,
      dimensions: SearchOptionsDimension[],
    ) => service.getSearchOptions(auth, { ...options, dimensions });
    // A service per call has an empty cache: the cold path, watermark lookup included.
    const cold = () => setupService();
    const all: SearchOptionsDimension[] = ['availability', ...lists];

    // `BENCH_EXPLAIN=<state number>:<dimension>` only explains that one request (cold) and skips the timings.
    const explainOne = (stateName: string, dimension: SearchOptionsDimension) =>
      explainStatements(async (traced) => {
        const { sut: tracedSut, ctx: tracedCtx } = newMediumService(GallerySearchService, {
          database: traced,
          real: [
            AccessRepository,
            AlbumRepository,
            AssetRepository,
            ConfigRepository,
            DatabaseRepository,
            FaceIdentityRepository,
            FaceSearchRepository,
            FilterSuggestionRepository,
            PartnerRepository,
            PersonRepository,
            SearchRepository,
            SharedSpaceRepository,
            SmartFacetRepository,
            TagRepository,
          ],
          mock: [LoggingRepository, MachineLearningRepository, SystemMetadataRepository],
        });
        tracedCtx.getMock(SystemMetadataRepository).get.mockResolvedValue({});
        const state = states.find(({ name }) => name === stateName)!;
        if ((dimension as string) === 'old') {
          await tracedCtx.getService(SearchService).getFilterSuggestions(auth, state.old!);
          return;
        }
        await ask(tracedSut, state.options, [dimension]);
      });
    // `BENCH_TIME=<state number>:<dimension>[,...]` only times those requests (cold), for quick iteration.
    if (process.env.BENCH_TIME) {
      for (const item of process.env.BENCH_TIME.split(',')) {
        const [number, dimension, mode] = item.split(':', 3);
        const state = states.find(({ name }) => name.startsWith(`${number}.`))!;
        const timing = await measure(() =>
          ask(state.unfiltered || mode === 'cold' ? cold() : sut, state.options, [dimension as SearchOptionsDimension]),
        );
        log(`time ${state.name} ${dimension} ${mode ?? ''} ${JSON.stringify(timing)}`);
      }
      return;
    }
    if (process.env.BENCH_EXPLAIN) {
      const [number, dimension] = process.env.BENCH_EXPLAIN.split(':', 2);
      const state = states.find(({ name }) => name.startsWith(`${number}.`))!;
      writeFileSync(
        process.env.BENCH_EXPLAIN_OUT ?? 'search-options-explain.log',
        await explainOne(state.name, dimension as SearchOptionsDimension),
      );
      return;
    }

    const rows: Row[] = [];
    for (const state of states) {
      const unfiltered = state.unfiltered ?? false;
      const fresh = () => (unfiltered ? cold() : sut);
      const { total } = await ask(sut, state.options, ['total']);
      // counts == results: shown/hidden spaces, overlap and dedup included
      const resultCount = await state.results();
      if (resultCount !== undefined) {
        expect({ state: state.name, total }).toEqual({ state: state.name, total: resultCount });
      }
      const dimensions = {} as Row['dimensions'];
      for (const dimension of lists) {
        dimensions[dimension] = await measure(() => ask(fresh(), state.options, [dimension]));
      }
      const row: Row = {
        state: state.name,
        unfiltered,
        total: total!,
        old: state.old ? await measure(() => search.getFilterSuggestions(auth, state.old!)) : null,
        results: await measure(state.results),
        availability: await measure(() => ask(fresh(), state.options, ['availability'])),
        dimensions,
        parallel: await measure(() => {
          const service = fresh();
          return Promise.all(all.map((dimension) => ask(service, state.options, [dimension])));
        }),
        warm: null,
        warmParallel: null,
      };
      if (unfiltered) {
        const service = cold();
        await Promise.all(all.map((dimension) => ask(service, state.options, [dimension])));
        row.warm = await measure(() => ask(service, state.options, ['people']));
        row.warmParallel = await measure(() =>
          Promise.all(all.map((dimension) => ask(service, state.options, [dimension]))),
        );
      }
      log(JSON.stringify(row));
      rows.push(row);
    }

    // What else mobile fires today: one country tap's city list, and smart facets for comparison in query mode.
    const extras = {
      cityList: await measure(() =>
        search.getSearchSuggestions(auth, { type: SearchSuggestionType.CITY, country, withSharedSpaces: true }),
      ),
      smartFacets: await measure(() =>
        search.searchSmartFacets(auth, { queryAssetId: ref, personIds: [person], withSharedSpaces: true }),
      ),
      watermark: await measure(() => ctx.get(SmartFacetRepository).getSearchOptionsWatermark()),
    };
    log(`extras ${JSON.stringify(extras)}`);

    // EXPLAIN (ANALYZE, BUFFERS) of the slowest single list of a filtered state.
    const [slowestState, slowestDimension] = rows
      .filter((row) => !row.unfiltered)
      .flatMap((row) => lists.map((dimension) => [row, dimension] as const))
      .toSorted(([a, x], [b, y]) => (b.dimensions[y]?.p95 ?? 0) - (a.dimensions[x]?.p95 ?? 0))[0];
    const state = states.find(({ name }) => name === slowestState.state)!;
    const explain = await explainOne(state.name, slowestDimension);

    const version = await sql<{ version: string }>`SELECT version()`.execute(db);
    const result = {
      scale: SCALE,
      runs: RUNS,
      size: SIZE,
      postgres: version.rows[0].version,
      rows,
      extras,
      explained: `${slowestState.state} / ${slowestDimension}`,
    };
    if (process.env.BENCH_OUT) {
      writeFileSync(process.env.BENCH_OUT, JSON.stringify(result, null, 2));
    }
    if (process.env.BENCH_EXPLAIN_OUT) {
      writeFileSync(process.env.BENCH_EXPLAIN_OUT, explain);
    }
    expect(rows).toHaveLength(states.length);
  });
});
