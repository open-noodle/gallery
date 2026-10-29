/**
 * Mobile Library Cleanup ↔ server contract (specs/2026-10-29-mobile-library-cleanup-design.md, "Testing approach").
 *
 * Seeds one library, then records or verifies the fixtures in `mobile/test/fixtures/cleanup_contract/` (see the README
 * there). Verify mode (the default) replays every fixture's request against this server, in file order, and fails on
 * any difference; `CLEANUP_CONTRACT_RECORD=1` rewrites the fixtures from `fixtureCases` below instead.
 *
 * Unlike the search contract, these requests change the server: a commit trashes photos, a restore brings them back,
 * a finished day turns reviewed. The fixtures are therefore one script, in the order the mobile test (and so the app)
 * sends them, numbered so that file order is script order. Two fixtures may hold the same request with different
 * responses (the state moved in between); the mobile stand-in serves them in order.
 */
import { LoginResponseDto } from '@immich/sdk';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { app, asBearerAuth, utils } from 'src/utils.js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FIXTURE_DIR = fileURLToPath(new URL('../../../../../mobile/test/fixtures/cleanup_contract/', import.meta.url));
const RECORD = process.env.CLEANUP_CONTRACT_RECORD === '1';
const GALLERY_APP_HEADER = { 'x-gallery-app': 'cleanup-contract' };

/** The zone the mobile test reports as the device's. Calendar requests carry it. */
const TZ = 'Europe/Lisbon';
/** Mobile pages queues this many at a time in the test (the app asks for 100). */
const PAGE = 4;
const REWIND_DAY = 815;

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
 * How a fixture shows a server this one is not (see the README):
 * - `no-cleanup`: a Gallery server from before Library Cleanup: the route does not exist, so Nest answers 404.
 */
type ResponseView = 'no-cleanup';

type Fixture = {
  description: string;
  responseView?: ResponseView;
  request: ContractRequest;
  response: { status: number; body: Json };
  /** Legend: the stable fake UUID each fixture uses in place of a real id, and what it names. */
  ids: Record<string, string>;
};

type FixtureCase = Omit<Fixture, 'response' | 'ids' | 'request'> & {
  name: string;
  request: Omit<ContractRequest, 'headers'>;
};

// ---------------------------------------------------------------------------------------------------------------
// The seeded library
// ---------------------------------------------------------------------------------------------------------------

type AssetSeed = {
  takenAt: string;
  city?: string;
  quality?: { sharpness: number; brightness?: number; clippedDark?: number };
};

const blurryTaken = (n: number) => `2023-05-${String(20 - n).padStart(2, '0')}T10:00:00.000Z`;

const assetSeeds: Record<string, AssetSeed> = {
  // 15 August, two years: the rewind.
  p1: { takenAt: '2022-08-15T09:00:00.000Z', city: 'Lisbon' },
  p2: { takenAt: '2022-08-15T15:00:00.000Z', city: 'Lisbon' },
  q1: { takenAt: '2020-08-15T08:00:00.000Z', city: 'Porto' },
  q2: { takenAt: '2020-08-15T11:00:00.000Z', city: 'Porto' },
  q3: { takenAt: '2020-08-15T16:00:00.000Z' },
  // 24 December, reviewed before the script starts.
  x1: { takenAt: '2021-12-24T12:00:00.000Z', city: 'Madrid' },
};
for (let n = 1; n <= 11; n++) {
  assetSeeds[`blurry-${String(n).padStart(2, '0')}`] = { takenAt: blurryTaken(n), quality: { sharpness: 5 } };
}
for (const n of [1, 2]) {
  // Sharp, but dark: only the dark reason picks them up.
  assetSeeds[`dark-${n}`] = {
    takenAt: `2023-04-1${n}T10:00:00.000Z`,
    quality: { sharpness: 300, brightness: 10, clippedDark: 0.9 },
  };
}

const world = {
  login: undefined as unknown as LoginResponseDto,
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
  const [r, g, b] = createHash('sha1').update(`cleanup:${label}`).digest();
  const image = new PNG({ width: 1, height: 1 });
  image.data.set([r, g, b, 255]);
  return PNG.sync.write(image);
};

const seed = async () => {
  await utils.resetDatabase();
  const db = await utils.connectDatabase();
  const me = await utils.adminSetup();
  world.login = me;
  name('user:me', me.userId);

  for (const [label, seedValue] of Object.entries(assetSeeds)) {
    const asset = await utils.createAsset(me.accessToken, {
      assetData: { bytes: pngFor(label), filename: `${label}.png` },
      fileCreatedAt: seedValue.takenAt,
      fileModifiedAt: seedValue.takenAt,
    });
    name(`asset:${label}`, asset.id);
  }
  await utils.waitForQueueFinish(me.accessToken, 'metadataExtraction');
  await utils.waitForQueueFinish(me.accessToken, 'thumbnailGeneration');
  // The quality job analyses every upload; the script wants exactly the seeded facts, so let it finish, then replace.
  await utils.waitForQueueFinish(me.accessToken, 'qualityAnalysis');
  await db.query('DELETE FROM "asset_quality"');

  // Metadata straight into the database: the uploads are 1px PNGs with no EXIF, and no job may race it.
  let index = 0;
  for (const [label, seedValue] of Object.entries(assetSeeds)) {
    index++;
    await db.query(`UPDATE "asset" SET "fileCreatedAt" = $2, "localDateTime" = $2, "createdAt" = $2 WHERE "id" = $1`, [
      id(`asset:${label}`),
      seedValue.takenAt,
    ]);
    await db.query(
      `INSERT INTO "asset_exif" ("assetId", "city", "fileSizeInByte", "timeZone")
       VALUES ($1, $2, $3, 'UTC')
       ON CONFLICT ("assetId") DO UPDATE SET "city" = EXCLUDED."city", "fileSizeInByte" = EXCLUDED."fileSizeInByte",
         "timeZone" = 'UTC', "state" = NULL`,
      [id(`asset:${label}`), seedValue.city ?? null, 1000 + index],
    );
    if (seedValue.quality) {
      const { sharpness, brightness = 120, clippedDark = 0 } = seedValue.quality;
      await db.query(
        `INSERT INTO "asset_quality" ("assetId", "ownerId", "sharpness", "brightness", "clippedDark", "clippedBright", "version")
         VALUES ($1, $2, $3, $4, $5, 0, 1)
         ON CONFLICT ("assetId") DO UPDATE SET "sharpness" = EXCLUDED."sharpness", "brightness" = EXCLUDED."brightness",
           "clippedDark" = EXCLUDED."clippedDark", "clippedBright" = 0, "version" = 1`,
        [id(`asset:${label}`), me.userId, sharpness, brightness, clippedDark],
      );
    }
  }

  // q1 is also in a shared space, so trashing it needs the user's confirmation.
  const space = await utils.createSpace(me.accessToken, { name: 'Family' });
  name('space:family', space.id);
  await utils.addSpaceAssets(me.accessToken, space.id, [id('asset:q1')]);

  // One day already reviewed, so the calendar has a reviewed day.
  const reviewed = await request(app)
    .post('/cleanup/commit')
    .set(asBearerAuth(me.accessToken))
    .send({ queue: 'rewind', keepIds: [id('asset:x1')], completeMonthDay: 1224 });
  expect(reviewed.status).toBe(200);
};

// ---------------------------------------------------------------------------------------------------------------
// Normalisation: real ids become stable fake UUIDs named in the legend; volatile values become fixed ones
// ---------------------------------------------------------------------------------------------------------------

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const FIXED_TIME = '2000-01-01T00:00:00.000Z';
/** Set by the server when the row is written, so they differ on every run. */
const VOLATILE_TIMESTAMPS = new Set(['createdAt', 'updatedAt', 'reviewedAt']);
/** Derived from the upload bytes or the thumbnail pipeline. */
const VOLATILE_STRINGS = new Set(['thumbhash']);
/** Opaque to the app, but base64url JSON that holds a real asset id: the id is replaced inside it. */
const CURSOR_KEYS = new Set(['cursor', 'nextCursor']);

const stableUuid = (label: string) => {
  const hex = createHash('sha1').update(`cleanup-contract:${label}`).digest('hex');
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

const mapCursor = (cursor: string, map: (text: string) => string) =>
  Buffer.from(map(Buffer.from(cursor, 'base64url').toString('utf8'))).toString('base64url');

class Normalizer {
  readonly legend: Record<string, string> = {};

  private label(realId: string) {
    const known = world.labels.get(realId.toLowerCase());
    if (!known) {
      throw new Error(`${realId} is not a seeded entity; name it in the seed so the fixture can refer to it`);
    }
    return known;
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
      if (key && CURSOR_KEYS.has(key)) {
        return mapCursor(value, (text) => this.string(text));
      }
      return this.string(value);
    }
    if (Array.isArray(value)) {
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
  const text = (item: string) =>
    item.replaceAll(UUID, (match) => {
      const mapped = real.get(match);
      if (!mapped) {
        throw new Error(`Fixture request names ${match}, which is not a seeded entity`);
      }
      return mapped;
    });
  const walk = (item: Json, key?: string): Json => {
    if (typeof item === 'string') {
      return key && CURSOR_KEYS.has(key) ? mapCursor(item, text) : text(item);
    }
    if (Array.isArray(item)) {
      return item.map((entry) => walk(entry, key));
    }
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).map(([entryKey, entry]) => [entryKey, walk(entry, entryKey)]));
    }
    return item;
  };
  return walk(value) as T;
};

const send = async (contract: ContractRequest, view?: ResponseView) => {
  // A server without Library Cleanup has no such route: ask this server for one it does not have.
  const path = (
    view === 'no-cleanup' ? contract.path.replace('/cleanup/', '/cleanup-unavailable/') : contract.path
  ).replace(/^\/api/, '');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(contract.query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, item);
    }
  }
  const url = params.size > 0 ? `${path}?${params}` : path;
  const base = contract.method === 'GET' ? request(app).get(url) : request(app).post(url);
  const pending = base.set(asBearerAuth(world.login.accessToken)).set(contract.headers);
  const { status, body } = contract.body === undefined ? await pending : await pending.send(contract.body as object);
  if (view === 'no-cleanup' && body && typeof body === 'object') {
    // The route name is in Nest's message; show the one the app asked for.
    const message = (body as { message?: string }).message;
    if (message) {
      (body as { message: string }).message = message.replace('/cleanup-unavailable/', '/cleanup/');
    }
  }
  return { status, body: body as Json };
};

const toFixture = (
  description: string,
  realRequest: ContractRequest,
  response: { status: number; body: Json },
  responseView?: ResponseView,
): Fixture => {
  const normalizer = new Normalizer();
  const normalizedRequest = normalizer.json(realRequest as unknown as Json) as unknown as ContractRequest;
  const normalizedBody = normalizer.json(response.body);
  return sortKeys({
    description,
    ...(responseView && { responseView }),
    request: normalizedRequest as unknown as Json,
    response: { status: response.status, body: normalizedBody },
    ids: normalizer.legend,
  }) as unknown as Fixture;
};

// ---------------------------------------------------------------------------------------------------------------
// The script: what the app sends, in order (mobile/test/gallery/cleanup/cleanup_core_contract_test.dart)
// ---------------------------------------------------------------------------------------------------------------

const asset = (label: string) => id(`asset:${label}`);
const blurry = (n: number) => `blurry-${String(n).padStart(2, '0')}`;

const calendar = { method: 'GET', path: '/api/cleanup/calendar', query: { tz: TZ } } as const;
const rewindYears = { method: 'GET', path: `/api/cleanup/rewind/${REWIND_DAY}` } as const;
const rewindYear = (year: number) => ({ method: 'GET', path: `/api/cleanup/rewind/${REWIND_DAY}/${year}` }) as const;
const inSpaces = (ids: string[]) =>
  ({ method: 'POST', path: '/api/cleanup/in-spaces', body: { assetIds: ids.map((label) => asset(label)) } }) as const;
const restore = (ids: string[]) =>
  ({ method: 'POST', path: '/api/trash/restore/assets', body: { ids: ids.map((label) => asset(label)) } }) as const;
const blurryFilters = { strictness: 'balanced', reason: 'all', hideFaces: 'true' };
const blurryPage = (cursor?: string): Omit<ContractRequest, 'headers'> => ({
  method: 'GET',
  path: '/api/cleanup/queues/blurry',
  query: { limit: String(PAGE), ...blurryFilters, ...(cursor && { cursor }) },
});

const fixtureCases = (): FixtureCase[] => [
  {
    name: '010-calendar',
    description: 'The support probe: the calendar for the device zone, with a reviewed day',
    request: calendar,
  },
  {
    name: '011-calendar-no-cleanup',
    description: 'The same probe on a Gallery server without Library Cleanup: 404',
    responseView: 'no-cleanup',
    request: calendar,
  },
  // The overview's secondary loads, on the library as seeded: every quick-win count without filters, Blurry's cover
  // (the only queue the seed fills), and the trash total.
  ...(['space_hogs', 'bursts', 'screenshots', 'duplicates', 'blurry'] as const).map((queue, index): FixtureCase => ({
    name: `${String(12 + index).padStart(3, '0')}-overview-count-${queue.replace('_', '-')}`,
    description: `The overview's ${queue} count, without filters (as the web hub asks)`,
    request: { method: 'GET', path: `/api/cleanup/queues/${queue}/count` },
  })),
  {
    name: '017-overview-cover-blurry',
    description: "The Blurry card's cover: the first photo of the queue, without filters",
    request: { method: 'GET', path: '/api/cleanup/queues/blurry', query: { limit: '1' } },
  },
  {
    name: '018-overview-trash',
    description: 'The trash total under the quick wins',
    request: { method: 'GET', path: '/api/cleanup/trash' },
  },
  {
    name: '019a-overview-rewind-1224-years',
    description: 'The today card on 24 December, a day reviewed before the script starts: its years',
    request: { method: 'GET', path: '/api/cleanup/rewind/1224' },
  },
  {
    name: '019b-overview-rewind-1224-2021',
    description: "The today card on 24 December: the busiest year's photos, for the collage and the city",
    request: { method: 'GET', path: '/api/cleanup/rewind/1224/2021' },
  },
  {
    name: '020-rewind-815-years',
    description: 'Rewind of 15 August: the years that have photos, newest first',
    request: rewindYears,
  },
  { name: '021-rewind-815-2022', description: 'Rewind 15 August 2022', request: rewindYear(2022) },
  { name: '022-rewind-815-2020', description: 'Rewind 15 August 2020', request: rewindYear(2020) },
  {
    name: '030-in-spaces-q2',
    description: 'Before trashing q2: none of the ids is in a shared space',
    request: inSpaces(['q2']),
  },
  {
    name: '031-commit-apply-and-stop',
    description: 'Apply and stop: trash, favourite and keep ids, and no completeMonthDay',
    request: {
      method: 'POST',
      path: '/api/cleanup/commit',
      body: { queue: 'rewind', trashIds: [asset('q2')], favoriteIds: [asset('p2')], keepIds: [asset('p1')] },
    },
  },
  {
    name: '032-restore-q2',
    description: 'Undo of the trash: restores exactly the trashed ids',
    request: restore(['q2']),
  },
  {
    name: '040-rewind-815-years-resumed',
    description: 'The rewind reopened: same years',
    request: rewindYears,
  },
  {
    name: '041-rewind-815-2022-resumed',
    description: 'Reopened: both 2022 photos are kept now',
    request: rewindYear(2022),
  },
  {
    name: '042-rewind-815-2020-resumed',
    description: 'Reopened: the restored photo is back, none of the 2020 photos is kept',
    request: rewindYear(2020),
  },
  {
    name: '050-in-spaces-q1',
    description: 'Before trashing q1: it is in a shared space',
    request: inSpaces(['q1']),
  },
  {
    name: '051-in-spaces-q1-again',
    description: 'The user confirmed; asked again before the commit',
    request: inSpaces(['q1']),
  },
  {
    name: '052-commit-finish-day',
    description: 'Keep the rest and finish day: completeMonthDay on the one and only request',
    request: {
      method: 'POST',
      path: '/api/cleanup/commit',
      body: {
        queue: 'rewind',
        trashIds: [asset('q1')],
        favoriteIds: [],
        keepIds: [asset('q2'), asset('q3')],
        completeMonthDay: REWIND_DAY,
      },
    },
  },
  {
    name: '053-calendar-after-finish',
    description: 'The calendar after the day was finished: 15 August is reviewed',
    request: calendar,
  },
  { name: '060-blurry-page-1', description: 'Blurry, first page, default filters', request: blurryPage() },
  {
    name: '061-blurry-page-2',
    description: 'Blurry, second page (the cursor of the first)',
    request: blurryPage('@1'),
  },
  { name: '062-blurry-page-3', description: 'Blurry, third page', request: blurryPage('@2') },
  { name: '063-blurry-page-4', description: 'Blurry, last page: the next cursor is null', request: blurryPage('@3') },
  {
    name: '070-in-spaces-blurry',
    description: 'Before trashing two blurry photos',
    request: inSpaces([blurry(1), blurry(2)]),
  },
  {
    name: '071-commit-blurry',
    description: 'Apply on the Blurry queue: queue blurry, no completeMonthDay',
    request: {
      method: 'POST',
      path: '/api/cleanup/commit',
      body: {
        queue: 'blurry',
        trashIds: [asset(blurry(1)), asset(blurry(2))],
        favoriteIds: [asset(blurry(3))],
        keepIds: [asset(blurry(4))],
      },
    },
  },
  {
    name: '072-restore-blurry',
    description: 'Undo of the Blurry trash',
    request: restore([blurry(1), blurry(2)]),
  },
  {
    name: '073-blurry-dark-strict',
    description: 'Blurry with other filters: strict, dark only, faces shown',
    request: {
      method: 'GET',
      path: '/api/cleanup/queues/blurry',
      query: { limit: String(PAGE), strictness: 'strict', reason: 'dark', hideFaces: 'false' },
    },
  },
];

/** Cursors are chained through the script: `@n` stands for the next-page cursor of the n-th Blurry page. */
const cursors = new Map<string, string>();
const resolveCursor = (contract: Omit<ContractRequest, 'headers'>): Omit<ContractRequest, 'headers'> => {
  const cursor = contract.query?.cursor;
  if (typeof cursor === 'string' && cursor.startsWith('@')) {
    const real = cursors.get(cursor);
    if (!real) {
      throw new Error(`No cursor recorded for ${cursor}`);
    }
    return { ...contract, query: { ...contract.query, cursor: real } };
  }
  return contract;
};

const fixturePath = (fileName: string) => join(FIXTURE_DIR, `${fileName}.json`);

const readFixtures = () =>
  readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith('.json'))
    .toSorted(byCodeUnit)
    .map((file) => ({
      name: file.replace(/\.json$/, ''),
      fixture: JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as Fixture,
    }));

describe('mobile cleanup contract', () => {
  beforeAll(async () => {
    await seed();
  }, 180_000);

  afterAll(async () => {
    await utils.resetAdminConfig(world.login.accessToken);
  });

  it('seeds the library the script assumes', async () => {
    const { status, body } = await request(app)
      .get('/cleanup/calendar')
      .query({ tz: TZ })
      .set(asBearerAuth(world.login.accessToken));
    expect(status).toBe(200);
    const countOn = (monthDay: number) => body.days.find((day: { monthDay: number }) => day.monthDay === monthDay);
    expect(countOn(REWIND_DAY).assetCount).toBe(5);
    expect(countOn(1224).reviewedAt).not.toBeNull();
  });

  describe('contract fixtures', () => {
    it(RECORD ? 'records the script' : 'every scripted case has a fixture', async () => {
      const cases = fixtureCases();
      expect(new Set(cases.map(({ name: caseName }) => caseName)).size).toBe(cases.length);
      expect(cases.map(({ name: caseName }) => caseName)).toEqual(
        cases.map(({ name: caseName }) => caseName).toSorted(byCodeUnit),
      );
      if (!RECORD) {
        const recorded = new Set(readFixtures().map(({ name: fileName }) => fileName));
        expect(cases.map(({ name: caseName }) => caseName).filter((caseName) => !recorded.has(caseName))).toEqual([]);
        return;
      }

      mkdirSync(FIXTURE_DIR, { recursive: true });
      const stale = readdirSync(FIXTURE_DIR).filter(
        (entry) => entry.endsWith('.json') && cases.every(({ name: caseName }) => `${caseName}.json` !== entry),
      );
      if (stale.length > 0) {
        throw new Error(`${stale.join(', ')} not in the script; delete them`);
      }
      let page = 0;
      for (const { name: caseName, description, responseView, request: base } of cases) {
        const realRequest: ContractRequest = { ...resolveCursor(base), headers: GALLERY_APP_HEADER };
        const response = await send(realRequest, responseView);
        if (base.path === '/api/cleanup/queues/blurry' && base.query?.reason === 'all') {
          page++;
          const next = (response.body as { nextCursor: string | null }).nextCursor;
          if (next) {
            cursors.set(`@${page}`, next);
          }
        }
        writeFileSync(
          fixturePath(caseName),
          `${JSON.stringify(toFixture(description, realRequest, response, responseView), null, 2)}\n`,
        );
      }
    });

    it.skipIf(RECORD)('every fixture matches the server, replayed in order', async () => {
      const fixtures = readFixtures();
      expect(fixtures.length).toBeGreaterThan(0);
      for (const { name: fileName, fixture } of fixtures) {
        const realRequest = denormalize(fixture.request as unknown as Json) as unknown as ContractRequest;
        const response = await send(realRequest, fixture.responseView);
        const actual = toFixture(fixture.description, realRequest, response, fixture.responseView);
        expect({ fixture: fileName, ...actual }).toEqual({ fixture: fileName, ...fixture });
      }
    });
  });
});
