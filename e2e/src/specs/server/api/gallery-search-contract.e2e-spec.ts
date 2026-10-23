/**
 * Mobile search ↔ server contract (specs/2026-10-23-mobile-search-redesign-design.md, "Testing approach").
 *
 * Seeds one library, then:
 * 1. asserts that `POST /search/options` totals equal the real results calls (`/search/metadata`, `/search/smart`,
 *    `/timeline/buckets`) over the scope matrix;
 * 2. records or verifies the search contract fixtures in `mobile/test/fixtures/search_contract/` (see the README
 *    there). Verify mode (the default) replays every fixture's request against this server and fails on any
 *    difference; `SEARCH_CONTRACT_RECORD=1` rewrites the fixtures from `fixtureCases` below instead.
 *
 * The stack runs with machine learning disabled, so a text `query` can never be encoded here. Query mode by reference
 * photo (`queryAssetId`) still works: those cases switch smart search on in the system config, read embeddings seeded
 * straight into `smart_search`, and switch it back off.
 */
import { LoginResponseDto, SharedSpaceRole, getConfig, updateConfig } from '@immich/sdk';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { addPartner } from 'src/actors.js';
import { createUserDto } from 'src/fixtures.js';
import { app, asBearerAuth, utils } from 'src/utils.js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FIXTURE_DIR = fileURLToPath(new URL('../../../../../mobile/test/fixtures/search_contract/', import.meta.url));
const RECORD = process.env.SEARCH_CONTRACT_RECORD === '1';
const GALLERY_APP_HEADER = { 'x-gallery-app': 'search-contract' };

type Actor = 'me' | 'partner' | 'member';
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Query = Record<string, string | string[]>;

type ContractRequest = {
  method: 'GET' | 'POST';
  path: string;
  query?: Query;
  body?: Json;
  headers: Record<string, string>;
};

/**
 * How a fallback fixture shows a server this one is not (see the README):
 * - `older-gallery`: a Gallery server from before `POST /search/options`: `/server/features` without `searchOptions`;
 * - `stock-immich`: a stock Immich server at the base version: `/server/features` with upstream's keys only.
 */
type ResponseView = 'older-gallery' | 'stock-immich';

type Fixture = {
  description: string;
  actor: Actor;
  /** `smart-search`: smart search is switched on (and embeddings are seeded) while this request runs. */
  setup?: 'smart-search';
  responseView?: ResponseView;
  request: ContractRequest;
  response: { status: number; body: Json };
  /** Legend: the stable fake UUID each fixture uses in place of a real id, and what it names. */
  ids: Record<string, string>;
};

type FixtureCase = Omit<Fixture, 'response' | 'ids' | 'request'> & {
  name: string;
  request: Omit<ContractRequest, 'headers'>;
  /** Sent as a stock client sees the server: without `x-gallery-app`, so `/server/version` is the Immich base. */
  stockClient?: boolean;
};

// ---------------------------------------------------------------------------------------------------------------
// The seeded library
// ---------------------------------------------------------------------------------------------------------------

type AssetSeed = {
  owner: Actor;
  takenAt: string;
  city?: string;
  country?: string;
  make?: string;
  model?: string;
  rating?: number;
  description?: string;
  ocr?: string;
  type?: 'IMAGE' | 'VIDEO';
  visibility?: 'timeline' | 'archive';
};

// Every asset has its own taken time, so every ordered response has one order.
const assetSeeds: Record<string, AssetSeed> = {
  'kyoto-1': {
    owner: 'me',
    takenAt: '2024-06-03T10:00:00.000Z',
    city: 'Kyoto',
    country: 'Japan',
    make: 'Fujifilm',
    model: 'X-T5',
    rating: 5,
  },
  'kyoto-2': {
    owner: 'me',
    takenAt: '2024-06-02T10:00:00.000Z',
    city: 'Kyoto',
    country: 'Japan',
    make: 'Fujifilm',
    model: 'X-T5',
    rating: 3,
  },
  'kyoto-3': {
    owner: 'me',
    takenAt: '2024-06-01T10:00:00.000Z',
    city: 'Kyoto',
    country: 'Japan',
    make: 'Apple',
    model: 'iPhone 15',
  },
  'lisbon-1': {
    owner: 'me',
    takenAt: '2023-09-10T10:00:00.000Z',
    city: 'Lisbon',
    country: 'Portugal',
    make: 'Apple',
    model: 'iPhone 15',
    rating: 4,
    // The Filters sheet end-to-end test ends on in-photo text: the one favourite left by then must have some.
    ocr: 'cafe receipt',
  },
  'berlin-video': {
    owner: 'me',
    takenAt: '2024-02-14T10:00:00.000Z',
    city: 'Berlin',
    country: 'Germany',
    type: 'VIDEO',
  },
  'menu-1': {
    owner: 'me',
    takenAt: '2024-01-20T10:00:00.000Z',
    city: 'Lisbon',
    country: 'Portugal',
    description: 'dinner with friends',
    ocr: 'lunch menu today',
  },
  'archived-1': {
    owner: 'me',
    takenAt: '2022-12-01T10:00:00.000Z',
    city: 'Osaka',
    country: 'Japan',
    visibility: 'archive',
  },
  'archived-2': {
    owner: 'me',
    takenAt: '2022-12-02T10:00:00.000Z',
    city: 'Osaka',
    country: 'Japan',
    visibility: 'archive',
  },
  'partner-paris-1': {
    owner: 'partner',
    takenAt: '2024-05-01T10:00:00.000Z',
    city: 'Paris',
    country: 'France',
    make: 'Canon',
    model: 'EOS R5',
  },
  'partner-paris-2': {
    owner: 'partner',
    takenAt: '2024-05-02T10:00:00.000Z',
    city: 'Paris',
    country: 'France',
    make: 'Canon',
    model: 'EOS R5',
    rating: 5,
  },
  'partner-archived': {
    owner: 'partner',
    takenAt: '2024-05-03T10:00:00.000Z',
    city: 'Nice',
    country: 'France',
    visibility: 'archive',
  },
  'space-kyoto-1': {
    owner: 'member',
    takenAt: '2024-06-04T10:00:00.000Z',
    city: 'Kyoto',
    country: 'Japan',
    make: 'Sony',
    model: 'A7 IV',
  },
  'space-kyoto-2': {
    owner: 'member',
    takenAt: '2024-06-05T10:00:00.000Z',
    city: 'Kyoto',
    country: 'Japan',
    make: 'Sony',
    model: 'A7 IV',
  },
  'space-porto': { owner: 'member', takenAt: '2023-08-01T10:00:00.000Z', city: 'Porto', country: 'Portugal' },
  'space-album-1': { owner: 'member', takenAt: '2023-07-01T10:00:00.000Z', city: 'Madrid', country: 'Spain' },
  'space-album-2': { owner: 'member', takenAt: '2023-07-02T10:00:00.000Z', city: 'Madrid', country: 'Spain' },
};

const world = {
  logins: {} as Record<Actor, LoginResponseDto>,
  /** real id → label, for every entity the fixtures may name */
  labels: new Map<string, string>(),
  ids: {} as Record<string, string>,
};

const id = (label: string) => {
  const value = world.ids[label];
  if (!value) {
    throw new Error(`No seeded id for ${label}`);
  }
  return value;
};

const name = (label: string, value: string) => {
  world.labels.set(value, label);
  world.ids[label] = value;
  return value;
};

const pngFor = (label: string) => {
  const [r, g, b] = createHash('sha1').update(label).digest();
  const image = new PNG({ width: 1, height: 1 });
  image.data.set([r, g, b, 255]);
  return PNG.sync.write(image);
};

/** A 512-d embedding along axis `index`, tilted by `tilt` towards the last axis so near neighbours rank in one order. */
const vector = (index: number, tilt = 0) =>
  `[${Array.from({ length: 512 }, (_, i) => (i === index ? '1' : i === 511 ? String(tilt) : '0')).join(',')}]`;

const seed = async () => {
  await utils.resetDatabase();
  const db = await utils.connectDatabase();
  const me = await utils.adminSetup();
  const [partner, member] = await Promise.all([
    utils.userSetup(me.accessToken, createUserDto.create('contract-partner')),
    utils.userSetup(me.accessToken, createUserDto.create('contract-member')),
  ]);
  world.logins = { me, partner, member };
  name('user:me', me.userId);
  name('user:partner', partner.userId);
  name('user:member', member.userId);

  await addPartner(
    { token: partner.accessToken, userId: partner.userId },
    { token: me.accessToken, userId: me.userId },
  );

  for (const [label, seedValue] of Object.entries(assetSeeds)) {
    const asset = await utils.createAsset(world.logins[seedValue.owner].accessToken, {
      assetData: { bytes: pngFor(label), filename: `${label}.png` },
      fileCreatedAt: seedValue.takenAt,
      fileModifiedAt: seedValue.takenAt,
    });
    name(`asset:${label}`, asset.id);
  }
  await utils.waitForQueueFinish(me.accessToken, 'metadataExtraction');
  await utils.waitForQueueFinish(me.accessToken, 'thumbnailGeneration');

  // Tags go straight into tag_asset: tagging through the API writes a sidecar and re-runs metadata extraction, which
  // rewrites asset_exif and the asset's tags from the file and races everything seeded below.
  const [beach, food] = await utils.upsertTags(me.accessToken, ['beach', 'food']);
  name('tag:beach', beach.id);
  name('tag:food', food.id);
  for (const [tagId, labels] of [
    [beach.id, ['kyoto-1', 'kyoto-2']],
    [food.id, ['kyoto-1', 'menu-1']],
  ] as const) {
    for (const label of labels) {
      await db.query('INSERT INTO "tag_asset" ("tagId", "assetId") VALUES ($1, $2)', [tagId, id(`asset:${label}`)]);
    }
  }

  // Metadata straight into the database: the uploads are 1px PNGs with no EXIF, and no sidecar write may race it.
  for (const [label, seedValue] of Object.entries(assetSeeds)) {
    await db.query(
      // createdAt too: Recently added groups by upload date, which would otherwise be the day of the run.
      `UPDATE "asset" SET "fileCreatedAt" = $2, "localDateTime" = $2, "createdAt" = $2, "type" = $3, "visibility" = $4
       WHERE "id" = $1`,
      [id(`asset:${label}`), seedValue.takenAt, seedValue.type ?? 'IMAGE', seedValue.visibility ?? 'timeline'],
    );
    await db.query(
      `INSERT INTO "asset_exif" ("assetId", "city", "country", "make", "model", "rating", "description", "timeZone")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'UTC')
       ON CONFLICT ("assetId") DO UPDATE SET "city" = EXCLUDED."city", "country" = EXCLUDED."country",
         "make" = EXCLUDED."make", "model" = EXCLUDED."model", "rating" = EXCLUDED."rating",
         "description" = EXCLUDED."description", "timeZone" = 'UTC', "state" = NULL`,
      [
        id(`asset:${label}`),
        seedValue.city ?? null,
        seedValue.country ?? null,
        seedValue.make ?? null,
        seedValue.model ?? null,
        seedValue.rating ?? null,
        seedValue.description ?? '',
      ],
    );
    if (seedValue.ocr) {
      await db.query(`INSERT INTO "ocr_search" ("assetId", "text") VALUES ($1, $2)`, [
        id(`asset:${label}`),
        seedValue.ocr,
      ]);
    }
  }

  // A space with two people, and an album of the member's linked into it.
  const { id: spaceId } = await utils.createSpace(member.accessToken, { name: 'Family' });
  name('space:family', spaceId);
  await utils.addSpaceMember(member.accessToken, spaceId, { userId: me.userId, role: SharedSpaceRole.Viewer });
  await utils.addSpaceAssets(
    member.accessToken,
    spaceId,
    ['space-kyoto-1', 'space-kyoto-2', 'space-porto'].map((label) => id(`asset:${label}`)),
  );
  const spaceAlbum = await utils.createAlbum(member.accessToken, {
    albumName: 'Space trip',
    assetIds: [id('asset:space-album-1'), id('asset:space-album-2')],
  });
  name('album:space-trip', spaceAlbum.id);
  await utils.linkSpaceAlbum(member.accessToken, spaceId, spaceAlbum.id);
  await utils.waitForQueueFinish(me.accessToken, 'facialRecognition');

  const pia = await utils.createSpacePerson(spaceId, 'Pia', member.userId, id('asset:space-kyoto-1'));
  name('space-person:pia', pia.spacePersonId);
  const extraFace = await db.query(
    `INSERT INTO "asset_face" ("assetId", "personGroupId", "sourceType") VALUES ($1, $2, 'manual') RETURNING id`,
    [id('asset:space-kyoto-2'), pia.globalPersonId],
  );
  await db.query(`INSERT INTO "shared_space_person_face" ("personId", "assetFaceId") VALUES ($1, $2)`, [
    pia.spacePersonId,
    extraFace.rows[0].id,
  ]);
  const quinn = await utils.createSpacePerson(spaceId, 'Quinn', member.userId, id('asset:space-porto'));
  name('space-person:quinn', quinn.spacePersonId);

  // My album, my people (identity-linked like production's backfill), a pet, tags and favourites.
  const trip = await utils.createAlbum(me.accessToken, {
    albumName: 'Trip',
    assetIds: ['kyoto-1', 'archived-1', 'berlin-video'].map((label) => id(`asset:${label}`)),
  });
  name('album:trip', trip.id);

  const anna = await utils.createPerson(me.accessToken, { name: 'Anna' });
  name('person:anna', anna.id);
  const ben = await utils.createPerson(me.accessToken, { name: 'Ben' });
  name('person:ben', ben.id);
  for (const label of ['kyoto-1', 'kyoto-2', 'lisbon-1']) {
    await utils.createFace({ assetId: id(`asset:${label}`), personGroupId: anna.id, sourceType: 'manual' });
  }
  await utils.createFace({ assetId: id('asset:kyoto-1'), personGroupId: ben.id, sourceType: 'manual' });
  const rex = await utils.createPet(me.userId, 'dog', 'Rex');
  name('person:rex', rex);
  await utils.createFace({ assetId: id('asset:lisbon-1'), personGroupId: rex, sourceType: 'manual' });

  await request(app)
    .put('/assets/favorites')
    .set(asBearerAuth(me.accessToken))
    .send({ ids: [id('asset:lisbon-1'), id('asset:space-kyoto-1')], isFavorite: true })
    .expect(204);

  // Smart-search embeddings: three Kyoto photos and a space photo close to kyoto-1, each at its own distance so the
  // ranking has one order; Lisbon far from it.
  for (const [rank, label] of ['kyoto-1', 'kyoto-2', 'kyoto-3', 'space-kyoto-1'].entries()) {
    await db.query(`INSERT INTO "smart_search" ("assetId", "embedding") VALUES ($1, $2::vector)`, [
      id(`asset:${label}`),
      vector(0, rank * 0.1),
    ]);
  }
  await db.query(`INSERT INTO "smart_search" ("assetId", "embedding") VALUES ($1, $2::vector)`, [
    id('asset:lisbon-1'),
    vector(1),
  ]);
};

/** Smart search needs ML switched on in the config; `queryAssetId` then reads the seeded embedding, no ML call. */
const withSmartSearch = async <T>(run: () => Promise<T>): Promise<T> => {
  const headers = asBearerAuth(world.logins.me.accessToken);
  const config = await getConfig({ headers });
  await updateConfig(
    {
      adminConfigDto: {
        ...config,
        machineLearning: {
          ...config.machineLearning,
          enabled: true,
          clip: { ...config.machineLearning.clip, enabled: true, maxDistance: 0.5 },
        },
      },
    },
    { headers },
  );
  try {
    return await run();
  } finally {
    await updateConfig({ adminConfigDto: config }, { headers });
  }
};

// ---------------------------------------------------------------------------------------------------------------
// Normalisation: real ids become stable fake UUIDs named in the legend; volatile values become fixed ones
// ---------------------------------------------------------------------------------------------------------------

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const FIXED_TIME = '2000-01-01T00:00:00.000Z';
/** Set by the server when the row is written, so they differ on every run. */
const VOLATILE_TIMESTAMPS = new Set(['createdAt', 'updatedAt', 'profileChangedAt']);
/** Derived from the upload bytes, the thumbnail pipeline or a random file id (the upload path's shard folders). */
const VOLATILE_STRINGS = new Set(['checksum', 'originalPath', 'thumbhash']);

const stableUuid = (label: string) => {
  const hex = createHash('sha1').update(`search-contract:${label}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** Code-unit order, the same on every machine (no locale). */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const sortKeys = (value: Json): Json => {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted(byCodeUnit)
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
};

class Normalizer {
  private unknown = new Map<string, string>();
  readonly legend: Record<string, string> = {};

  private label(realId: string) {
    const known = world.labels.get(realId.toLowerCase());
    if (known) {
      return known;
    }
    let label = this.unknown.get(realId);
    if (!label) {
      label = `unknown-${this.unknown.size + 1}`;
      this.unknown.set(realId, label);
    }
    return label;
  }

  string(value: string) {
    return value.replaceAll(UUID, (match) => {
      const label = this.label(match);
      const stable = stableUuid(label);
      this.legend[stable] = label;
      return stable;
    });
  }

  json(value: Json, key?: string): Json {
    if (typeof value === 'string') {
      if (key && VOLATILE_TIMESTAMPS.has(key)) {
        return FIXED_TIME;
      }
      if (key && VOLATILE_STRINGS.has(key)) {
        return key;
      }
      return this.string(value);
    }
    if (Array.isArray(value)) {
      // The key carries over, so a column array of /timeline/bucket (`createdAt`, `thumbhash`) is fixed per item.
      return value.map((item) => this.json(item, key));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([entryKey, item]) => [entryKey, this.json(item, entryKey)]));
    }
    return value;
  }
}

/** Fixture → real ids: every stable UUID of a seeded entity maps back to that entity's id on this run. */
const denormalize = <T extends Json>(value: T): T => {
  const real = new Map(Object.entries(world.ids).map(([label, realId]) => [stableUuid(label), realId]));
  const walk = (item: Json): Json => {
    if (typeof item === 'string') {
      return item.replaceAll(UUID, (match) => {
        const mapped = real.get(match);
        if (!mapped) {
          throw new Error(`Fixture request names ${match}, which is not a seeded entity`);
        }
        return mapped;
      });
    }
    if (Array.isArray(item)) {
      return item.map((entry) => walk(entry));
    }
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, walk(entry)]));
    }
    return item;
  };
  return walk(value) as T;
};

const send = async (actor: Actor, contract: ContractRequest) => {
  const path = contract.path.replace(/^\/api/, '');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(contract.query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, item);
    }
  }
  const url = params.size > 0 ? `${path}?${params}` : path;
  const base = contract.method === 'GET' ? request(app).get(url) : request(app).post(url);
  const pending = base.set(asBearerAuth(world.logins[actor].accessToken)).set(contract.headers);
  const { status, body } = contract.body === undefined ? await pending : await pending.send(contract.body as object);
  // `stale` depends on timing, not on the data: it marks a cached unfiltered answer whose watermark moved since, which
  // happens here when Postgres's write counters for the seed reach its statistics view mid-run. The data is the same
  // (nothing is written after the seed); the unit tests cover the flag.
  if (path === '/search/options' && body && typeof body === 'object') {
    delete (body as { stale?: boolean }).stale;
  }
  // The version moves with every release (Gallery) and rebase (the Immich base a stock client sees); only the major
  // decides anything in a client (Gallery 5+ against stock Immich below 5), so minor and patch are fixed.
  if (path === '/server/version' && body && typeof body === 'object') {
    Object.assign(body, { minor: 0, patch: 0 });
  }
  return { status, body: body as Json };
};

/** `/server/features` of stock Immich at the base version: upstream's ServerFeaturesDto keys only. */
const UPSTREAM_FEATURE_KEYS = new Set([
  'configFile',
  'duplicateDetection',
  'email',
  'facialRecognition',
  'importFaces',
  'map',
  'oauth',
  'oauthAutoLaunch',
  'ocr',
  'passwordLogin',
  'realtimeTranscoding',
  'reverseGeocoding',
  'search',
  'sidecar',
  'smartSearch',
  'trash',
]);

const applyView = (view: ResponseView | undefined, path: string, body: Json): Json => {
  if (!view || path !== '/api/server/features' || !body || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }
  if (view === 'older-gallery') {
    return Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'searchOptions'));
  }
  return Object.fromEntries(Object.entries(body).filter(([key]) => UPSTREAM_FEATURE_KEYS.has(key)));
};

const run = async (fixture: Pick<Fixture, 'actor' | 'setup' | 'request' | 'responseView'>) => {
  const call = () => send(fixture.actor, fixture.request);
  const response = await (fixture.setup === 'smart-search' ? withSmartSearch(call) : call());
  return { ...response, body: applyView(fixture.responseView, fixture.request.path, response.body) };
};

const toFixture = (
  description: string,
  actor: Actor,
  setup: Fixture['setup'],
  realRequest: ContractRequest,
  response: { status: number; body: Json },
  responseView?: ResponseView,
): Fixture => {
  const normalizer = new Normalizer();
  const normalizedRequest = normalizer.json(realRequest as unknown as Json) as unknown as ContractRequest;
  const normalizedBody = normalizer.json(response.body);
  return sortKeys({
    description,
    actor,
    ...(setup && { setup }),
    ...(responseView && { responseView }),
    request: normalizedRequest as unknown as Json,
    response: { status: response.status, body: normalizedBody },
    ids: normalizer.legend,
  }) as unknown as Fixture;
};

// ---------------------------------------------------------------------------------------------------------------
// The recorded cases
// ---------------------------------------------------------------------------------------------------------------

/** Photos in browse mode: what mobile sends to /timeline/buckets (and so to /search/options). */
const photos = { withSharedSpaces: true, withPartners: true, visibility: 'timeline' };
/** Photos in query mode: what mobile sends to /search/smart, which always searches timeline partners. */
const smartPhotos = { withSharedSpaces: true, visibility: 'timeline' };
const timelinePhotos = { visibility: 'timeline', withPartners: 'true', withSharedSpaces: 'true' };

/** Every dimension at once: one fixture holds the complete answer for a scope and filter combination. */
const allDimensions = ['availability', 'total', 'time', 'people', 'tags', 'places', 'cameras', 'ratings', 'mediaTypes'];

const options = (name: string, description: string, body: () => Json, extra: Partial<FixtureCase> = {}) =>
  ({
    name,
    description,
    actor: 'me',
    get request() {
      return {
        method: 'POST',
        path: '/api/search/options',
        body: { dimensions: allDimensions, ...(body() as object) },
      };
    },
    ...extra,
  }) as FixtureCase;

/** How a client opening search calls it: availability first, then one request per list, in parallel. */
const perDimension = (name: string, description: string, body: () => Record<string, Json>) =>
  allDimensions.map((dimension) =>
    options(`${name}-${dimension}`, `${description}: ${dimension} only`, () => ({
      ...body(),
      dimensions: [dimension],
    })),
  );

/**
 * One screen's search as the mobile app runs it (mobile/test/gallery/search/search_core_contract_test.dart): options
 * when search opens (availability, then one request per list), the same after two filters, then the results of the
 * filtered state: `/timeline/buckets` and its first bucket in browse mode, the first `/search/smart` page in query mode.
 * Each body is exactly what the app sends for that scope (mobile/lib/gallery/search/search_scope.dart).
 */
type ScopeFlow = {
  name: string;
  description: string;
  setup?: 'smart-search';
  /** The unfiltered options body; omitted when another fixture set already records it. */
  unfiltered?: () => Record<string, Json>;
  filtered: () => Record<string, Json>;
  /** Browse: the filtered /timeline/buckets query and the bucket the app opens first. */
  timeline?: { query: () => Query; firstBucket: string };
  /** Query mode: the filtered /search/smart body. */
  smart?: () => Record<string, Json>;
};

const scopeFlowCases = (flow: ScopeFlow): FixtureCase[] => {
  const withSetup = (cases: FixtureCase[]) =>
    cases.map((item) => ({ ...item, ...(flow.setup && { setup: flow.setup }) }));
  const { timeline, smart } = flow;
  return [
    ...(flow.unfiltered ? withSetup(perDimension(`scope-${flow.name}`, flow.description, flow.unfiltered)) : []),
    ...withSetup(perDimension(`scope-${flow.name}-filtered`, `${flow.description}, two filters`, flow.filtered)),
    ...(timeline
      ? [
          {
            name: `scope-${flow.name}-filtered-timeline-buckets`,
            description: `${flow.description}, two filters: browse results`,
            actor: 'me' as const,
            get request(): FixtureCase['request'] {
              return { method: 'GET', path: '/api/timeline/buckets', query: timeline.query() };
            },
          },
          {
            name: `scope-${flow.name}-filtered-timeline-bucket`,
            description: `${flow.description}, two filters: the first month of the browse results`,
            actor: 'me' as const,
            get request(): FixtureCase['request'] {
              return {
                method: 'GET',
                path: '/api/timeline/bucket',
                query: { ...timeline.query(), timeBucket: timeline.firstBucket },
              };
            },
          },
        ]
      : []),
    ...(smart
      ? withSetup([
          {
            name: `scope-${flow.name}-filtered-smart`,
            description: `${flow.description}, two filters: the first page of query results`,
            actor: 'me',
            get request(): FixtureCase['request'] {
              return { method: 'POST', path: '/api/search/smart', body: { ...smart(), page: 1, size: 100 } };
            },
          },
        ])
      : []),
  ];
};

const asQuery = (body: Record<string, Json>): Query =>
  Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, Array.isArray(value) ? value.map(String) : String(value)]),
  );

// Request bodies of the scope flows below (called once the seed has named every id).
const photosKyoto = { ...photos, country: 'Japan', city: 'Kyoto', rating: 3 };
const spaceFiltered = () => ({
  spaceId: id('space:family'),
  spacePersonIds: [id('space-person:pia')],
  country: 'Japan',
  city: 'Kyoto',
});
const personFiltered = () => ({ personIds: [id('person:anna'), id('person:ben')], country: 'Japan' });
const spacePersonFiltered = () => ({
  spaceId: id('space:family'),
  spacePersonIds: [id('space-person:pia')],
  make: 'Sony',
  model: 'A7 IV',
  type: 'IMAGE',
});
const placeFiltered = () => ({
  ...photos,
  city: 'Lisbon',
  personIds: [`person:${id('person:anna')}`],
  make: 'Apple',
});
const favoritesFiltered = () => ({ isFavorite: true, personIds: [id('person:anna')], country: 'Portugal' });
const archive = () => ({ visibility: 'archive', ownerId: id('user:me') });
const archiveFiltered = () => ({ ...archive(), country: 'Japan', city: 'Osaka', type: 'IMAGE' });
const videosFiltered = {
  ...photos,
  type: 'VIDEO',
  country: 'Germany',
  takenAfter: '2024-01-01T00:00:00.000Z',
  takenBefore: '2025-01-01T00:00:00.000Z',
};
const recentlyAddedFiltered = () => ({ ownerId: id('user:me'), tagIds: [id('tag:beach')], rating: 5 });
const recentlyTaken = () => ({ visibility: 'timeline', ownerId: id('user:me') });
const recentlyTakenFiltered = () => ({ ...recentlyTaken(), ocr: 'menu', originalFileName: 'menu' });
const similar = () => ({ ...smartPhotos, queryAssetId: id('asset:kyoto-1'), type: 'IMAGE' });
const similarFiltered = () => ({ ...similar(), country: 'Japan', city: 'Kyoto', make: 'Fujifilm' });

/** The scope table, each with two filters a user could pick there. */
const scopeFlows = (): ScopeFlow[] => [
  // Photos unfiltered is the dimension-photos-* set.
  {
    name: 'photos',
    description: 'Photos, Kyoto rated at least 3',
    filtered: () => photosKyoto,
    timeline: { query: () => asQuery(photosKyoto), firstBucket: '2024-06-01' },
  },
  {
    name: 'album',
    description: 'Album screen, Japan photos',
    unfiltered: () => ({ albumIds: [id('album:trip')] }),
    filtered: () => ({ albumIds: [id('album:trip')], country: 'Japan', type: 'IMAGE' }),
    timeline: {
      query: () => ({ albumId: id('album:trip'), country: 'Japan', type: 'IMAGE' }),
      firstBucket: '2024-06-01',
    },
  },
  {
    name: 'space-album',
    description: 'Space album screen, Madrid photos',
    unfiltered: () => ({ albumIds: [id('album:space-trip')] }),
    filtered: () => ({ albumIds: [id('album:space-trip')], country: 'Spain', city: 'Madrid', type: 'IMAGE' }),
    timeline: {
      query: () => ({ albumId: id('album:space-trip'), country: 'Spain', city: 'Madrid', type: 'IMAGE' }),
      firstBucket: '2023-07-01',
    },
  },
  {
    name: 'space',
    description: 'Space screen, Pia in Kyoto',
    unfiltered: () => ({ spaceId: id('space:family') }),
    filtered: spaceFiltered,
    timeline: { query: () => asQuery(spaceFiltered()), firstBucket: '2024-06-01' },
  },
  {
    name: 'personal-person',
    description: 'Personal person screen (Anna), with Ben, in Japan',
    unfiltered: () => ({ personIds: [id('person:anna')] }),
    filtered: personFiltered,
    timeline: { query: () => asQuery(personFiltered()), firstBucket: '2024-06-01' },
  },
  {
    name: 'space-person',
    description: 'Space person screen (Pia), Sony photos',
    unfiltered: () => ({ spaceId: id('space:family'), spacePersonIds: [id('space-person:pia')] }),
    filtered: spacePersonFiltered,
    timeline: { query: () => asQuery(spacePersonFiltered()), firstBucket: '2024-06-01' },
  },
  {
    name: 'place',
    description: 'Place screen (Lisbon), Anna with an Apple camera',
    unfiltered: () => ({ ...photos, city: 'Lisbon' }),
    filtered: placeFiltered,
    timeline: { query: () => asQuery(placeFiltered()), firstBucket: '2023-09-01' },
  },
  {
    name: 'favorites',
    description: 'Favorites screen, Anna in Portugal',
    unfiltered: () => ({ isFavorite: true }),
    filtered: favoritesFiltered,
    timeline: { query: () => asQuery(favoritesFiltered()), firstBucket: '2023-09-01' },
  },
  {
    name: 'archive',
    description: 'Archive screen, Osaka photos',
    unfiltered: archive,
    filtered: archiveFiltered,
    timeline: { query: () => asQuery(archiveFiltered()), firstBucket: '2022-12-01' },
  },
  {
    name: 'videos',
    description: 'Videos screen, Germany in 2024',
    unfiltered: () => ({ ...photos, type: 'VIDEO' }),
    filtered: () => videosFiltered,
    timeline: { query: () => asQuery(videosFiltered), firstBucket: '2024-02-01' },
  },
  {
    name: 'recently-added',
    description: 'Recently added screen, beach rated 5',
    unfiltered: () => ({ ownerId: id('user:me') }),
    filtered: recentlyAddedFiltered,
    timeline: {
      query: () => ({ ...asQuery(recentlyAddedFiltered()), orderBy: 'createdAt' }),
      firstBucket: '2024-06-01',
    },
  },
  {
    name: 'recently-taken',
    description: 'Recently taken screen, OCR and file name "menu"',
    unfiltered: recentlyTaken,
    filtered: recentlyTakenFiltered,
    timeline: { query: () => asQuery(recentlyTakenFiltered()), firstBucket: '2024-01-01' },
  },
  {
    name: 'similar',
    description: 'Similar photos (query mode), Kyoto with a Fujifilm',
    setup: 'smart-search',
    unfiltered: similar,
    filtered: similarFiltered,
    smart: similarFiltered,
  },
];

/**
 * The compatibility fallbacks: an older Gallery server (no `searchOptions`) and a stock Immich server, as the new app
 * meets them. The app asks `/server/version` and `/server/features` first.
 */
const fallbackCases = (): FixtureCase[] => {
  const olderFilters = (name: string, description: string, query: Query): FixtureCase => ({
    name,
    description,
    actor: 'me',
    request: { method: 'GET', path: '/api/search/suggestions/filters', query },
  });
  const olderCities = (name: string, country: string, query: Query): FixtureCase => ({
    name: `${name}-${country.toLowerCase()}`,
    description: `Older Gallery server: the cities of ${country}, fetched after the countries`,
    actor: 'me',
    request: { method: 'GET', path: '/api/search/suggestions', query: { ...query, type: 'city', country } },
  });
  const stockMetadata = { visibility: 'timeline', type: 'IMAGE', isFavorite: true };
  return [
    {
      name: 'older-server-version',
      description: 'Older Gallery server: its version as the Gallery app sees it',
      actor: 'me',
      request: { method: 'GET', path: '/api/server/version' },
    },
    {
      name: 'older-server-features',
      description: 'Older Gallery server: features without searchOptions',
      actor: 'me',
      responseView: 'older-gallery',
      request: { method: 'GET', path: '/api/server/features' },
    },
    olderFilters('older-filters-photos', 'Older Gallery server: Photos options, no counts', {
      withSharedSpaces: 'true',
    }),
    ...['Japan', 'Portugal', 'France', 'Spain', 'Germany'].map((country) =>
      olderCities('older-cities-photos', country, { withSharedSpaces: 'true' }),
    ),
    olderFilters('older-filters-photos-kyoto', 'Older Gallery server: Photos options, Kyoto rated at least 3', {
      withSharedSpaces: 'true',
      country: 'Japan',
      city: 'Kyoto',
      rating: '3',
    }),
    // The countries that answer lists (the suggestion endpoint does not ignore the place filter for countries).
    ...['France', 'Japan', 'Portugal'].map((country) =>
      olderCities('older-cities-photos-kyoto', country, { withSharedSpaces: 'true', rating: '3' }),
    ),
    {
      name: 'stock-server-version',
      description: 'Stock Immich server: the base version a stock client sees (no x-gallery-app)',
      actor: 'me',
      stockClient: true,
      request: { method: 'GET', path: '/api/server/version' },
    },
    {
      name: 'stock-server-features',
      description: "Stock Immich server: upstream's feature keys only",
      actor: 'me',
      stockClient: true,
      responseView: 'stock-immich',
      request: { method: 'GET', path: '/api/server/features' },
    },
    {
      name: 'stock-search-metadata-photos',
      description: 'Stock Immich server: browse results through metadata search, upstream fields only',
      actor: 'me',
      stockClient: true,
      request: {
        method: 'POST',
        path: '/api/search/metadata',
        body: { ...stockMetadata, order: 'desc', page: 1, size: 100 },
      },
    },
    {
      name: 'stock-search-statistics-photos',
      description: 'Stock Immich server: the exact total of that metadata search',
      actor: 'me',
      stockClient: true,
      request: { method: 'POST', path: '/api/search/statistics', body: stockMetadata },
    },
  ];
};

/**
 * Photos search mode as mobile/test/gallery/search/photos_search_mode_e2e_test.dart walks it: `@a` picks Anna, When
 * picks 2024, Places picks Kyoto. Each step is one options round (availability, then one request per list), the browse
 * results, and every month the grid opens.
 */
const photosModeSteps = () => {
  const anna = { ...photos, personIds: [`person:${id('person:anna')}`] };
  const year = { ...anna, takenAfter: '2024-01-01T00:00:00.000Z', takenBefore: '2025-01-01T00:00:00.000Z' };
  const kyoto = { ...year, country: 'Japan', city: 'Kyoto' };
  return [
    {
      name: 'mode-photos-anna',
      description: 'Photos search mode, Anna',
      body: anna,
      months: ['2024-06-01', '2023-09-01'],
    },
    {
      name: 'mode-photos-anna-2024',
      description: 'Photos search mode, Anna in 2024',
      body: year,
      months: ['2024-06-01'],
    },
    {
      name: 'mode-photos-anna-2024-kyoto',
      description: 'Photos search mode, Anna in Kyoto in 2024',
      body: kyoto,
      months: ['2024-06-01'],
    },
  ];
};

/**
 * The Filters sheet as mobile/test/gallery/search/filters_sheet_e2e_test.dart walks it on Photos: Favorites only, then
 * rating 3, then the camera model, then in-photo text. Same shape as `photosModeSteps`.
 */
const filtersSheetSteps = () => {
  const favorites = { ...photos, isFavorite: true };
  const rating = { ...favorites, rating: 3 };
  const camera = { ...rating, make: 'Apple', model: 'iPhone 15' };
  const text = { ...camera, ocr: 'receipt' };
  return [
    {
      name: 'mode-filters-favorites',
      description: 'Photos Filters sheet, favorites only',
      body: favorites,
      months: ['2024-06-01', '2023-09-01'],
    },
    {
      name: 'mode-filters-favorites-rating',
      description: 'Photos Filters sheet, favorites rated at least 3',
      body: rating,
      months: ['2023-09-01'],
    },
    {
      name: 'mode-filters-favorites-rating-camera',
      description: 'Photos Filters sheet, favorites rated at least 3 from an iPhone 15',
      body: camera,
      months: ['2023-09-01'],
    },
    {
      name: 'mode-filters-favorites-rating-camera-text',
      description: 'Photos Filters sheet, favorites rated at least 3 from an iPhone 15 with "receipt" in the photo',
      body: text,
      months: ['2023-09-01'],
    },
  ];
};

const photosModeCases = (): FixtureCase[] =>
  [...photosModeSteps(), ...filtersSheetSteps()].flatMap(({ name, description, body, months }) => [
    ...perDimension(name, description, () => body),
    {
      name: `${name}-timeline-buckets`,
      description: `${description}: browse results`,
      actor: 'me' as const,
      request: { method: 'GET' as const, path: '/api/timeline/buckets', query: asQuery(body) },
    },
    ...months.map((month) => ({
      name: `${name}-timeline-bucket-${month}`,
      description: `${description}: the month ${month} of the browse results`,
      actor: 'me' as const,
      request: { method: 'GET' as const, path: '/api/timeline/bucket', query: { ...asQuery(body), timeBucket: month } },
    })),
  ]);

const fixtureCases = (): FixtureCase[] => [
  ...scopeFlows().flatMap((flow) => scopeFlowCases(flow)),
  ...photosModeCases(),
  ...fallbackCases(),
  ...perDimension('dimension-photos', 'Photos, unfiltered', () => photos),
  ...perDimension('dimension-photos-kyoto', 'Photos with a city', () => ({ ...photos, city: 'Kyoto' })),
  options('options-photos', 'Photos: own + timeline partners + timeline spaces, timeline visibility', () => photos),
  options('options-photos-kyoto', 'Photos with a city: places ignore it, every other option narrows to it', () => ({
    ...photos,
    city: 'Kyoto',
  })),
  options('options-photos-person', 'Photos with a person token: people co-occurring with Anna', () => ({
    ...photos,
    personIds: [`person:${id('person:anna')}`],
  })),
  options('options-photos-tags', 'Photos with two tags: ANY in browse, each tag counts without the tag filter', () => ({
    ...photos,
    tagIds: [id('tag:beach'), id('tag:food')],
  })),
  options('options-photos-tag', 'Photos with one tag', () => ({
    ...photos,
    tagIds: [id('tag:beach')],
  })),
  options('options-photos-untagged', 'Photos, untagged only (tagIds: null)', () => ({ ...photos, tagIds: null })),
  options('options-photos-camera', 'Photos with a camera model: makes and models ignore it', () => ({
    ...photos,
    make: 'Apple',
    model: 'iPhone 15',
  })),
  options('options-photos-rating', 'Photos, rated at least 4', () => ({ ...photos, rating: 4 })),
  options('options-photos-date', 'Photos in June 2024: months ignore the date range', () => ({
    ...photos,
    takenAfter: '2024-06-01T00:00:00.000Z',
    takenBefore: '2024-07-01T00:00:00.000Z',
  })),
  options('options-videos', 'Videos screen: type VIDEO within the Photos scope', () => ({ ...photos, type: 'VIDEO' })),
  options('options-text', 'Text filters together: OCR, description and file name', () => ({
    ...photos,
    ocr: 'menu',
    description: 'dinner',
    originalFileName: 'menu',
  })),
  options('options-album', 'Album screen: albumIds only', () => ({ albumIds: [id('album:trip')] })),
  options('options-space-album', 'Space album screen: the linked album only, never spaceId', () => ({
    albumIds: [id('album:space-trip')],
  })),
  options('options-space', 'Space screen: people are space people (bare ids)', () => ({ spaceId: id('space:family') })),
  options('options-space-person', 'Space person screen: spaceId + spacePersonIds', () => ({
    spaceId: id('space:family'),
    spacePersonIds: [id('space-person:pia')],
  })),
  options('options-personal-person', 'Personal person screen: a bare person id, owner only', () => ({
    personIds: [id('person:anna')],
  })),
  options('options-place', 'Place screen: city within the Photos scope', () => ({ ...photos, city: 'Lisbon' })),
  options('options-favorites', 'Favorites screen: my own favourites, timeline + archive', () => ({ isFavorite: true })),
  options('options-favorites-with-spaces', 'My favourites from every member space, timeline visibility', () => ({
    ...photos,
    isFavorite: true,
  })),
  options('options-archive', 'Archive screen: my archived photos only', () => ({
    visibility: 'archive',
    ownerId: id('user:me'),
  })),
  options('options-owner-only', 'Recently taken: my own photos, timeline visibility', () => ({
    visibility: 'timeline',
    ownerId: id('user:me'),
  })),
  options('options-recently-added', 'Recently added: my own photos, timeline + archive (visibility unset)', () => ({
    ownerId: id('user:me'),
  })),
  options(
    'options-similar',
    'Similar photos: query mode by reference photo (smart search switched on for this request)',
    () => ({ ...smartPhotos, queryAssetId: id('asset:kyoto-1'), type: 'IMAGE' }),
    { setup: 'smart-search' },
  ),
  options(
    'options-similar-tags',
    'Similar photos with two tags: ALL in query mode, as /search/smart',
    () => ({ ...smartPhotos, queryAssetId: id('asset:kyoto-1'), tagIds: [id('tag:beach'), id('tag:food')] }),
    { setup: 'smart-search' },
  ),
  options('options-query-ml-disabled', 'A text query on a server with smart search off: the real 400', () => ({
    ...smartPhotos,
    query: 'beach',
  })),
  options('options-reject-album-with-shared', 'Rejected: albumIds + withSharedSpaces', () => ({
    albumIds: [id('album:trip')],
    withSharedSpaces: true,
  })),
  options('options-reject-space-with-shared', 'Rejected: spaceId + withSharedSpaces', () => ({
    spaceId: id('space:family'),
    withSharedSpaces: true,
  })),
  options(
    'options-reject-shared-without-visibility',
    'Rejected as on /timeline/buckets: withSharedSpaces, no visibility',
    () => ({
      withSharedSpaces: true,
    }),
  ),
  options('options-reject-partners-archive', 'Rejected as on /timeline/buckets: withPartners with archive', () => ({
    withPartners: true,
    visibility: 'archive',
  })),
  options('options-reject-space-people-without-space', 'Rejected: spacePersonIds without spaceId', () => ({
    ...photos,
    spacePersonIds: [id('space-person:pia')],
  })),
  {
    name: 'timeline-buckets-photos',
    description: 'Photos timeline buckets: own + partners + timeline spaces',
    actor: 'me',
    request: {
      method: 'GET',
      path: '/api/timeline/buckets',
      query: { visibility: 'timeline', withPartners: 'true', withSharedSpaces: 'true' },
    },
  },
  {
    name: 'timeline-buckets-photos-kyoto',
    description: 'Photos timeline buckets with a city',
    actor: 'me',
    request: {
      method: 'GET',
      path: '/api/timeline/buckets',
      query: { city: 'Kyoto', visibility: 'timeline', withPartners: 'true', withSharedSpaces: 'true' },
    },
  },
  {
    name: 'timeline-buckets-album',
    description: 'Album timeline buckets',
    actor: 'me',
    get request() {
      return { method: 'GET', path: '/api/timeline/buckets', query: { albumId: id('album:trip') } } as const;
    },
  },
  {
    name: 'timeline-buckets-space',
    description: 'Space timeline buckets',
    actor: 'me',
    get request() {
      return { method: 'GET', path: '/api/timeline/buckets', query: { spaceId: id('space:family') } } as const;
    },
  },
  {
    name: 'timeline-buckets-reject-archive-with-shared',
    description: 'Rejected: withSharedSpaces without a timeline visibility',
    actor: 'me',
    request: { method: 'GET', path: '/api/timeline/buckets', query: { withSharedSpaces: 'true' } },
  },
  {
    name: 'timeline-buckets-photos-tags',
    description: 'Photos timeline buckets with two tags (ANY)',
    actor: 'me',
    get request(): FixtureCase['request'] {
      return {
        method: 'GET',
        path: '/api/timeline/buckets',
        query: { ...timelinePhotos, tagIds: [id('tag:beach'), id('tag:food')] },
      };
    },
  },
  {
    name: 'timeline-buckets-photos-rating',
    description: 'Photos timeline buckets rated at least 4',
    actor: 'me',
    request: { method: 'GET', path: '/api/timeline/buckets', query: { ...timelinePhotos, rating: '4' } },
  },
  {
    name: 'smart-similar',
    description: 'Similar photos results (smart search switched on for this request)',
    actor: 'me',
    setup: 'smart-search',
    get request() {
      return {
        method: 'POST',
        path: '/api/search/smart',
        body: { ...smartPhotos, queryAssetId: id('asset:kyoto-1'), type: 'IMAGE', size: 100 },
      } as const;
    },
  },
  {
    name: 'smart-query-ml-disabled',
    description: 'A text query on a server with smart search off: the real 400',
    actor: 'me',
    request: { method: 'POST', path: '/api/search/smart', body: { ...smartPhotos, query: 'beach', size: 100 } },
  },
  {
    name: 'server-version',
    description: 'Server version, as the Gallery app sees it',
    actor: 'me',
    request: { method: 'GET', path: '/api/server/version' },
  },
  {
    name: 'server-features',
    description: 'Server features, including searchOptions',
    actor: 'me',
    request: { method: 'GET', path: '/api/server/features' },
  },
];

const fixturePath = (name: string) => join(FIXTURE_DIR, `${name}.json`);

const readFixtures = () =>
  readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith('.json'))
    .toSorted(byCodeUnit)
    .map((file) => ({
      name: file.replace(/\.json$/, ''),
      fixture: JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as Fixture,
    }));

const optionsTotal = async (body: Json) => {
  const { status, body: response } = await request(app)
    .post('/search/options')
    .set(asBearerAuth(world.logins.me.accessToken))
    .send({ ...(body as object), dimensions: ['total'] });
  expect(status).toBe(200);
  return (response as { total: number }).total;
};
/** The /timeline/buckets query a browse-mode options request stands for: albumIds[0] as albumId, values as strings. */
const timelineQuery = (options: Record<string, Json>): Query => {
  const query: Query = {};
  for (const [key, value] of Object.entries(options)) {
    if (key === 'albumIds') {
      query.albumId = (value as string[])[0];
    } else if (Array.isArray(value)) {
      query[key] = value.map(String);
    } else {
      query[key] = String(value);
    }
  }
  return query;
};
const timelineCount = async (query: Query) => {
  const { status, body } = await request(app)
    .get('/timeline/buckets')
    .query(query)
    .set(asBearerAuth(world.logins.me.accessToken));
  expect(status).toBe(200);
  return (body as Array<{ count: number }>).reduce((sum, { count }) => sum + count, 0);
};

// Browse mode: the same request on /timeline/buckets (albumIds[0] as albumId), expected counts spelled out.
const browseScopes = (): Array<{ name: string; options: Record<string, Json>; expected: number }> => [
  // kyoto ×3, lisbon, berlin video, menu, partner paris ×2, space kyoto ×2, porto, space album ×2
  { name: 'photos', options: photos, expected: 13 },
  { name: 'album', options: { albumIds: [id('album:trip')] }, expected: 3 },
  { name: 'space album', options: { albumIds: [id('album:space-trip')] }, expected: 2 },
  { name: 'space', options: { spaceId: id('space:family') }, expected: 5 },
  { name: 'personal person', options: { personIds: [id('person:anna')] }, expected: 3 },
  {
    name: 'space person',
    options: { spaceId: id('space:family'), spacePersonIds: [id('space-person:pia')] },
    expected: 2,
  },
  { name: 'place', options: { ...photos, city: 'Kyoto' }, expected: 5 },
  { name: 'favorites', options: { isFavorite: true }, expected: 1 },
  { name: 'favorites with spaces', options: { ...photos, isFavorite: true }, expected: 2 },
  { name: 'archive', options: { visibility: 'archive', ownerId: id('user:me') }, expected: 2 },
  { name: 'videos', options: { ...photos, type: 'VIDEO' }, expected: 1 },
  { name: 'owner only', options: { visibility: 'timeline', ownerId: id('user:me') }, expected: 6 },
  { name: 'recently added', options: { ownerId: id('user:me') }, expected: 8 },
  { name: 'text', options: { ...photos, ocr: 'menu', description: 'dinner' }, expected: 1 },
  // ANY: kyoto-1 (both), kyoto-2 (beach), menu-1 (food)
  { name: 'tags (ANY)', options: { ...photos, tagIds: [id('tag:beach'), id('tag:food')] }, expected: 3 },
  // a minimum: kyoto-1 (5), kyoto-2 (3), lisbon-1 (4), partner-paris-2 (5)
  { name: 'rating >= 3', options: { ...photos, rating: 3 }, expected: 4 },
  {
    name: 'people (AND)',
    options: { ...photos, personIds: [`person:${id('person:anna')}`, `person:${id('person:ben')}`] },
    expected: 1,
  },
];

const smartCount = async (body: Record<string, Json>) => {
  const { body: smart } = await request(app)
    .post('/search/smart')
    .set(asBearerAuth(world.logins.me.accessToken))
    .send({ ...body, size: 1000 })
    .expect(200);
  return (smart as { assets: { items: Array<{ id: string }> } }).assets.items.map((item) => item.id);
};

// ---------------------------------------------------------------------------------------------------------------

describe('mobile search contract', () => {
  beforeAll(async () => {
    await seed();
  }, 180_000);

  afterAll(async () => {
    await utils.resetAdminConfig(world.logins.me.accessToken);
  });

  describe('counts match results', () => {
    it('browse: agrees with /timeline/buckets on every scope', async () => {
      for (const scope of browseScopes()) {
        const total = await optionsTotal(scope.options);
        const timeline = await timelineCount(timelineQuery(scope.options));
        expect({ scope: scope.name, total, timeline }).toEqual({
          scope: scope.name,
          total: scope.expected,
          timeline: scope.expected,
        });
      }
    });

    it('query mode: agrees with /search/smart (by reference photo)', async () => {
      await withSmartSearch(async () => {
        const body = { ...smartPhotos, queryAssetId: id('asset:kyoto-1') };
        const similar = await smartCount(body);
        expect(similar.toSorted(byCodeUnit)).toEqual(
          ['kyoto-1', 'kyoto-2', 'kyoto-3', 'space-kyoto-1'].map((label) => id(`asset:${label}`)).toSorted(byCodeUnit),
        );
        expect(await optionsTotal(body)).toBe(4);

        const cases: Array<Record<string, Json>> = [
          { city: 'Kyoto', make: 'Fujifilm' },
          // ALL: only kyoto-1 has both
          { tagIds: [id('tag:beach'), id('tag:food')] },
          // a minimum: kyoto-1 (5), kyoto-2 (3)
          { rating: 3 },
        ];
        for (const filters of cases) {
          const results = await smartCount({ ...body, ...filters });
          expect({ filters, total: await optionsTotal({ ...body, ...filters }) }).toEqual({
            filters,
            total: results.length,
          });
        }
        const both = await smartCount({ ...body, tagIds: [id('tag:beach'), id('tag:food')] });
        expect(both).toEqual([id('asset:kyoto-1')]);
      });
    });
  });

  describe('contract fixtures', () => {
    it(RECORD ? 'records every case' : 'every recorded case has a fixture', async () => {
      const cases = fixtureCases();
      expect(new Set(cases.map(({ name }) => name)).size).toBe(cases.length);
      if (!RECORD) {
        const recorded = new Set(readFixtures().map(({ name }) => name));
        expect(cases.map(({ name }) => name).filter((name) => !recorded.has(name))).toEqual([]);
        return;
      }

      mkdirSync(FIXTURE_DIR, { recursive: true });
      for (const { name, description, actor, setup, responseView, stockClient, request: base } of cases) {
        const realRequest: ContractRequest = { ...base, headers: stockClient ? {} : GALLERY_APP_HEADER };
        const response = await run({ actor, setup, request: realRequest, responseView });
        const fixture = toFixture(description, actor, setup, realRequest, response, responseView);
        writeFileSync(fixturePath(name), `${JSON.stringify(fixture, null, 2)}\n`);
      }
    });

    it.skipIf(RECORD)('every fixture matches the server', async () => {
      for (const { name, fixture } of readFixtures()) {
        const realRequest = denormalize(fixture.request as unknown as Json) as unknown as ContractRequest;
        const response = await run({
          actor: fixture.actor,
          setup: fixture.setup,
          request: realRequest,
          responseView: fixture.responseView,
        });
        const actual = toFixture(
          fixture.description,
          fixture.actor,
          fixture.setup,
          realRequest,
          response,
          fixture.responseView,
        );
        expect({ fixture: name, ...actual }).toEqual({ fixture: name, ...fixture });
      }
    });
  });
});
