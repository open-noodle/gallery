import {
  AssetMediaResponseDto,
  AssetResponseDto,
  AssetVisibility,
  deleteAssets,
  LoginResponseDto,
  SharedLinkType,
  SharedSpaceResponseDto,
  updateAsset,
  updateConfig,
} from '@immich/sdk';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Socket } from 'socket.io-client';
import { app, asBearerAuth, TEN_TIMES, testAssetDir, utils } from 'src/utils';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const today = DateTime.now();

// Shared helper used by multiple withSharedSpaces and pagination describe blocks.
// Flips the runtime machineLearning config so the e2e stack (which starts with
// IMMICH_MACHINE_LEARNING_ENABLED=false) lets searchSmart through.
const enableSmartSearch = async (adminToken: string) => {
  const config = await utils.getSystemConfig(adminToken);
  config.machineLearning.enabled = true;
  config.machineLearning.clip.enabled = true;
  await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(adminToken) });
};

describe('/search', () => {
  let admin: LoginResponseDto;
  let websocket: Socket;

  let assetFalcon: AssetMediaResponseDto;
  let assetDenali: AssetMediaResponseDto;
  let assetCyclamen: AssetMediaResponseDto;
  let assetNotocactus: AssetMediaResponseDto;
  let assetSilver: AssetMediaResponseDto;
  let assetDensity: AssetMediaResponseDto;
  // let assetPhiladelphia: AssetMediaResponseDto;
  // let assetOrychophragmus: AssetMediaResponseDto;
  // let assetRidge: AssetMediaResponseDto;
  // let assetPolemonium: AssetMediaResponseDto;
  // let assetWood: AssetMediaResponseDto;
  // let assetGlarus: AssetMediaResponseDto;
  let assetHeic: AssetMediaResponseDto;
  let assetRocks: AssetMediaResponseDto;
  let assetOneJpg6: AssetMediaResponseDto;
  let assetOneHeic6: AssetMediaResponseDto;
  let assetOneJpg5: AssetMediaResponseDto;
  let assetSprings: AssetMediaResponseDto;
  let assetLast: AssetMediaResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    websocket = await utils.connectWebsocket(admin.accessToken);

    const files = [
      { filename: '/albums/nature/prairie_falcon.jpg' },
      { filename: '/formats/webp/denali.webp' },
      { filename: '/albums/nature/cyclamen_persicum.jpg', dto: { isFavorite: true } },
      { filename: '/albums/nature/notocactus_minimus.jpg' },
      { filename: '/albums/nature/silver_fir.jpg' },
      { filename: '/formats/heic/IMG_2682.heic' },
      { filename: '/formats/jpg/el_torcal_rocks.jpg' },
      { filename: '/formats/motionphoto/samsung-one-ui-6.jpg' },
      { filename: '/formats/motionphoto/samsung-one-ui-6.heic' },
      { filename: '/formats/motionphoto/samsung-one-ui-5.jpg' },

      { filename: '/metadata/gps-position/thompson-springs.jpg', dto: { visibility: AssetVisibility.Archive } },

      // used for search suggestions
      { filename: '/formats/png/density_plot.png' },
      { filename: '/formats/raw/Nikon/D80/glarus.nef' },
      { filename: '/formats/raw/Nikon/D700/philadelphia.nef' },
      { filename: '/albums/nature/orychophragmus_violaceus.jpg' },
      { filename: '/albums/nature/tanners_ridge.jpg' },
      { filename: '/albums/nature/polemonium_reptans.jpg' },

      // last asset
      { filename: '/albums/nature/wood_anemones.jpg' },
    ];
    const assets: AssetMediaResponseDto[] = [];
    for (const { filename, dto } of files) {
      const bytes = await readFile(join(testAssetDir, filename));
      assets.push(
        await utils.createAsset(admin.accessToken, {
          assetData: { bytes, filename },
          ...dto,
        }),
      );
    }

    for (const asset of assets) {
      await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });
    }

    // note: the coordinates here are not the actual coordinates of the images and are random for most of them
    const coordinates = [
      { latitude: 48.85341, longitude: 2.3488 }, // paris
      { latitude: 35.6895, longitude: 139.69171 }, // tokyo
      { latitude: 52.52437, longitude: 13.41053 }, // berlin
      { latitude: 1.3146631, longitude: 103.8454093 }, // singapore
      { latitude: 41.01384, longitude: 28.94966 }, // istanbul
      { latitude: 5.55602, longitude: -0.1969 }, // accra
      { latitude: 37.5442706, longitude: -4.7277528 }, // andalusia
      { latitude: 23.13302, longitude: -82.38304 }, // havana
      { latitude: 41.69411, longitude: 44.83368 }, // tbilisi
      { latitude: 31.22222, longitude: 121.45806 }, // shanghai
      { latitude: 38.9711, longitude: -109.7137 }, // thompson springs
      { latitude: 40.71427, longitude: -74.00597 }, // new york
      { latitude: 47.04057, longitude: 9.06804 }, // glarus
      { latitude: 32.77152, longitude: -89.11673 }, // philadelphia
      { latitude: 31.63416, longitude: -7.99994 }, // marrakesh
      { latitude: 38.5237354, longitude: -78.4886194 }, // tanners ridge
      { latitude: 59.93863, longitude: 30.31413 }, // st. petersburg
      { latitude: 0, longitude: 0 }, // null island
    ];

    const updates = coordinates.map((dto, i) =>
      updateAsset({ id: assets[i].id, updateAssetDto: dto }, { headers: asBearerAuth(admin.accessToken) }),
    );

    await Promise.all(updates);
    for (const i of coordinates.keys()) {
      await utils.waitForWebsocketEvent({ event: 'assetUpdate', id: assets[i].id });
    }

    [
      assetFalcon,
      assetDenali,
      assetCyclamen,
      assetNotocactus,
      assetSilver,
      assetHeic,
      assetRocks,
      assetOneJpg6,
      assetOneHeic6,
      assetOneJpg5,
      assetSprings,
      assetDensity,
      // assetGlarus,
      // assetPhiladelphia,
      // assetOrychophragmus,
      // assetRidge,
      // assetPolemonium,
      // assetWood,
    ] = assets;

    assetLast = assets.at(-1) as AssetMediaResponseDto;

    await deleteAssets({ assetBulkDeleteDto: { ids: [assetSilver.id] } }, { headers: asBearerAuth(admin.accessToken) });
  }, 30_000);

  afterAll(async () => {
    utils.disconnectWebsocket(websocket);
  });

  describe('POST /search/metadata', () => {
    const searchTests = [
      {
        should: 'should get my assets',
        deferred: () => ({ dto: { size: 1 }, assets: [assetLast] }),
      },
      {
        should: 'should sort my assets in reverse',
        deferred: () => ({ dto: { order: 'asc', size: 2 }, assets: [assetCyclamen, assetNotocactus] }),
      },
      {
        should: 'should support pagination',
        deferred: () => ({ dto: { order: 'asc', size: 1, page: 2 }, assets: [assetNotocactus] }),
      },
      {
        should: 'should search by checksum (base64)',
        deferred: () => ({ dto: { checksum: '9IXBDMjj9OrQb+1YMHprZJgZ/UQ=' }, assets: [assetCyclamen] }),
      },
      {
        should: 'should search by checksum (hex)',
        deferred: () => ({ dto: { checksum: 'f485c10cc8e3f4ead06fed58307a6b649819fd44' }, assets: [assetCyclamen] }),
      },
      { should: 'should search by id', deferred: () => ({ dto: { id: assetCyclamen.id }, assets: [assetCyclamen] }) },
      {
        should: 'should search by isFavorite (true)',
        deferred: () => ({ dto: { isFavorite: true }, assets: [assetCyclamen] }),
      },
      {
        should: 'should search by isFavorite (false)',
        deferred: () => ({ dto: { size: 1, isFavorite: false }, assets: [assetLast] }),
      },
      {
        should: 'should search by visibility (AssetVisibility.Archive)',
        deferred: () => ({ dto: { visibility: AssetVisibility.Archive }, assets: [assetSprings] }),
      },
      {
        should: 'should search by visibility (AssetVisibility.Timeline)',
        deferred: () => ({ dto: { size: 1, visibility: AssetVisibility.Timeline }, assets: [assetLast] }),
      },
      {
        should: 'should search by type (image)',
        deferred: () => ({ dto: { size: 1, type: 'IMAGE' }, assets: [assetLast] }),
      },
      {
        should: 'should search by type (video)',
        deferred: () => ({
          dto: { type: 'VIDEO', visibility: AssetVisibility.Hidden },
          assets: [
            // the three live motion photos
            { id: expect.any(String) },
            { id: expect.any(String) },
            { id: expect.any(String) },
          ],
        }),
      },
      {
        should: 'should search by trashedBefore',
        deferred: () => ({ dto: { trashedBefore: today.plus({ hour: 1 }).toJSDate() }, assets: [assetSilver] }),
      },
      {
        should: 'should search by trashedBefore (no results)',
        deferred: () => ({ dto: { trashedBefore: today.minus({ days: 1 }).toJSDate() }, assets: [] }),
      },
      {
        should: 'should search by trashedAfter',
        deferred: () => ({ dto: { trashedAfter: today.minus({ hour: 1 }).toJSDate() }, assets: [assetSilver] }),
      },
      {
        should: 'should search by trashedAfter (no results)',
        deferred: () => ({ dto: { trashedAfter: today.plus({ hour: 1 }).toJSDate() }, assets: [] }),
      },
      {
        should: 'should search by takenBefore',
        deferred: () => ({ dto: { size: 1, takenBefore: today.plus({ hour: 1 }).toJSDate() }, assets: [assetLast] }),
      },
      {
        should: 'should search by takenBefore (no results)',
        deferred: () => ({ dto: { takenBefore: DateTime.fromObject({ year: 1234 }).toJSDate() }, assets: [] }),
      },
      {
        should: 'should search by takenAfter',
        deferred: () => ({
          dto: { size: 1, takenAfter: DateTime.fromObject({ year: 1234 }).toJSDate() },
          assets: [assetLast],
        }),
      },
      {
        should: 'should search by takenAfter (no results)',
        deferred: () => ({ dto: { takenAfter: today.plus({ hour: 1 }).toJSDate() }, assets: [] }),
      },
      {
        should: 'should search by originalFilename',
        deferred: () => ({
          dto: { originalFileName: 'rocks' },
          assets: [assetRocks],
        }),
      },
      {
        should: 'should search by originalFilename with spaces',
        deferred: () => ({
          dto: { originalFileName: 'samsung-one', type: 'IMAGE' },
          assets: [assetOneJpg5, assetOneJpg6, assetOneHeic6],
        }),
      },
      {
        should: 'should search by city',
        deferred: () => ({
          dto: {
            city: 'Accra',
            includeNull: true,
          },
          assets: [assetHeic],
        }),
      },
      {
        should: 'should search city (null)',
        deferred: () => ({
          dto: {
            city: null,
            visibility: AssetVisibility.Timeline,
            includeNull: true,
          },
          assets: [assetLast],
        }),
      },
      {
        should: 'should search by state',
        deferred: () => ({
          dto: {
            state: 'New York',
            includeNull: true,
          },
          assets: [assetDensity],
        }),
      },
      {
        should: 'should search state (null)',
        deferred: () => ({
          dto: {
            state: null,
            visibility: AssetVisibility.Timeline,
            includeNull: true,
          },
          assets: [assetLast, assetNotocactus],
        }),
      },
      {
        should: 'should search by country',
        deferred: () => ({
          dto: {
            country: 'France',
            includeNull: true,
          },
          assets: [assetFalcon],
        }),
      },
      {
        should: 'should search country (null)',
        deferred: () => ({
          dto: {
            country: null,
            visibility: AssetVisibility.Timeline,
            includeNull: true,
          },
          assets: [assetLast],
        }),
      },
      {
        should: 'should search by make',
        deferred: () => ({
          dto: {
            make: 'Canon',
            includeNull: true,
          },
          assets: [assetFalcon, assetDenali],
        }),
      },
      {
        should: 'should search by model',
        deferred: () => ({
          dto: {
            model: 'Canon EOS 7D',
            includeNull: true,
          },
          assets: [assetDenali],
        }),
      },
      {
        should: 'should allow searching the upload library (libraryId: null)',
        deferred: () => ({
          dto: { libraryId: null, size: 1 },
          assets: [assetLast],
        }),
      },
    ];

    for (const { should, deferred } of searchTests) {
      it(should, async () => {
        const { assets, dto } = deferred();
        const { status, body } = await request(app)
          .post('/search/metadata')
          .send(dto)
          .set('Authorization', `Bearer ${admin.accessToken}`);
        expect(status).toBe(200);
        expect(body.assets).toBeDefined();
        expect(Array.isArray(body.assets.items)).toBe(true);
        for (const [i, asset] of assets.entries()) {
          expect(body.assets.items[i]).toEqual(expect.objectContaining({ id: asset.id }));
        }
        expect(body.assets.items).toHaveLength(assets.length);
      });
    }

    it('should reject shared link access without an album filter', async () => {
      const album = await utils.createAlbum(admin.accessToken, { albumName: 'foo' });
      const sharedLink = await utils.createSharedLink(admin.accessToken, {
        type: SharedLinkType.Album,
        albumId: album.id,
      });
      const { status, body } = await request(app).post(`/search/metadata?key=${sharedLink.key}`).send({});
      expect(status).toBe(400);
      expect(body).toEqual({ message: 'Shared link access is only allowed in combination with an albumIds filter' });
    });

    it('should allow shared link access for albums', async () => {
      const asset = await utils.createAsset(admin.accessToken);
      const album = await utils.createAlbum(admin.accessToken, { albumName: 'foo', assetIds: [asset.id] });
      const sharedLink = await utils.createSharedLink(admin.accessToken, {
        type: SharedLinkType.Album,
        albumId: album.id,
      });

      const { status, body } = await request(app)
        .post(`/search/metadata?key=${sharedLink.key}`)
        .send({ albumIds: [album.id] });
      expect(status).toBe(200);
      expect(body.assets.items).toEqual([expect.objectContaining({ id: asset.id })]);
    });
  });

  describe('POST /search/random', () => {
    beforeAll(async () => {
      await Promise.all([
        utils.createAsset(admin.accessToken),
        utils.createAsset(admin.accessToken),
        utils.createAsset(admin.accessToken),
        utils.createAsset(admin.accessToken),
        utils.createAsset(admin.accessToken),
        utils.createAsset(admin.accessToken),
      ]);

      await utils.waitForQueueFinish(admin.accessToken, 'thumbnailGeneration');
    });

    it.each(TEN_TIMES)('should return 1 random assets', async () => {
      const { status, body } = await request(app)
        .post('/search/random')
        .send({ size: 1 })
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);

      const assets: AssetResponseDto[] = body;
      expect(assets.length).toBe(1);
      expect(assets[0].ownerId).toBe(admin.userId);
    });

    it.each(TEN_TIMES)('should return 2 random assets', async () => {
      const { status, body } = await request(app)
        .post('/search/random')
        .send({ size: 2 })
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);

      const assets: AssetResponseDto[] = body;
      expect(assets.length).toBe(2);
      expect(assets[0].ownerId).toBe(admin.userId);
      expect(assets[1].ownerId).toBe(admin.userId);
    });
  });

  describe('GET /search/explore', () => {
    it('should get explore data', async () => {
      const { status, body } = await request(app)
        .get('/search/explore')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body).toEqual(expect.arrayContaining([{ fieldName: 'exifInfo.city', items: [] }]));
      expect(body).toEqual(
        expect.arrayContaining([
          {
            fieldName: 'createdAt',
            items: expect.arrayContaining([
              expect.objectContaining({ data: expect.objectContaining({ id: assetLast.id }) }),
            ]),
          },
        ]),
      );
    });
  });

  describe('GET /search/places', () => {
    it('should get relevant places', async () => {
      const name = 'Paris';

      const { status, body } = await request(app)
        .get(`/search/places?name=${name}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      if (Array.isArray(body)) {
        expect(body.length).toBeGreaterThan(10);
        expect(body[0].name).toEqual(expect.stringContaining(name));
        expect(body[0].admin2name).toEqual(name);
      }
    });
  });

  describe('GET /search/cities', () => {
    it('should get all cities', async () => {
      const { status, body } = await request(app)
        .get('/search/cities')
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      if (Array.isArray(body)) {
        expect(body.length).toBeGreaterThan(10);
        const assetsWithCity = body.filter((asset) => !!asset.exifInfo?.city);
        expect(assetsWithCity.length).toEqual(body.length);
        const cities = new Set(assetsWithCity.map((asset) => asset.exifInfo.city));
        expect(cities.size).toEqual(body.length);
      }
    });
  });

  describe('GET /search/suggestions', () => {
    it('should get suggestions for country (including null)', async () => {
      const { status, body } = await request(app)
        .get('/search/suggestions?type=country&includeNull=true')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(body).toEqual([
        'Cuba',
        'France',
        'Georgia',
        'Germany',
        'Ghana',
        'Japan',
        'Morocco',
        "People's Republic of China",
        'Russian Federation',
        'Singapore',
        'Spain',
        'Switzerland',
        'United States of America',
        null,
      ]);
      expect(status).toBe(200);
    });

    it('should get suggestions for country', async () => {
      const { status, body } = await request(app)
        .get('/search/suggestions?type=country')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(body).toEqual([
        'Cuba',
        'France',
        'Georgia',
        'Germany',
        'Ghana',
        'Japan',
        'Morocco',
        "People's Republic of China",
        'Russian Federation',
        'Singapore',
        'Spain',
        'Switzerland',
        'United States of America',
      ]);
      expect(status).toBe(200);
    });

    it('should get suggestions for state (including null)', async () => {
      const { status, body } = await request(app)
        .get('/search/suggestions?type=state&includeNull=true')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(body).toEqual([
        'Andalusia',
        'Glarus',
        'Greater Accra',
        'Havana',
        'Île-de-France',
        'Marrakesh-Safi',
        'Mississippi',
        'New York',
        'Shanghai',
        'State of Berlin',
        'St.-Petersburg',
        'Tbilisi',
        'Tokyo',
        'Virginia',
        null,
      ]);
      expect(status).toBe(200);
    });

    it('should get suggestions for state', async () => {
      const { status, body } = await request(app)
        .get('/search/suggestions?type=state')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(body).toEqual([
        'Andalusia',
        'Glarus',
        'Greater Accra',
        'Havana',
        'Île-de-France',
        'Marrakesh-Safi',
        'Mississippi',
        'New York',
        'Shanghai',
        'State of Berlin',
        'St.-Petersburg',
        'Tbilisi',
        'Tokyo',
        'Virginia',
      ]);
      expect(status).toBe(200);
    });

    it('should get suggestions for city (including null)', async () => {
      const { status, body } = await request(app)
        .get('/search/suggestions?type=city&includeNull=true')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(body).toEqual([
        'Accra',
        'Berlin',
        'Glarus',
        'Havana',
        'Marrakesh',
        'Montalbán de Córdoba',
        'New York City',
        'Novena',
        'Paris',
        'Philadelphia',
        'Saint Petersburg',
        'Shanghai',
        'Stanley',
        'Tbilisi',
        'Tokyo',
        null,
      ]);
      expect(status).toBe(200);
    });

    it('should get suggestions for city', async () => {
      const { status, body } = await request(app)
        .get('/search/suggestions?type=city')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(body).toEqual([
        'Accra',
        'Berlin',
        'Glarus',
        'Havana',
        'Marrakesh',
        'Montalbán de Córdoba',
        'New York City',
        'Novena',
        'Paris',
        'Philadelphia',
        'Saint Petersburg',
        'Shanghai',
        'Stanley',
        'Tbilisi',
        'Tokyo',
      ]);
      expect(status).toBe(200);
    });

    it('should get suggestions for camera make (including null)', async () => {
      const { status, body } = await request(app)
        .get('/search/suggestions?type=camera-make&includeNull=true')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(body).toEqual([
        'Apple',
        'Canon',
        'FUJIFILM',
        'NIKON CORPORATION',
        'PENTAX Corporation',
        'samsung',
        'SONY',
        null,
      ]);
      expect(status).toBe(200);
    });

    it('should get suggestions for camera make', async () => {
      const { status, body } = await request(app)
        .get('/search/suggestions?type=camera-make')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(body).toEqual([
        'Apple',
        'Canon',
        'FUJIFILM',
        'NIKON CORPORATION',
        'PENTAX Corporation',
        'samsung',
        'SONY',
      ]);
      expect(status).toBe(200);
    });

    it('should get suggestions for camera model (including null)', async () => {
      const { status, body } = await request(app)
        .get('/search/suggestions?type=camera-model&includeNull=true')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(body).toEqual([
        'Canon EOS 7D',
        'Canon EOS R5',
        'DSLR-A550',
        'FinePix S3Pro',
        'iPhone 7',
        'NIKON D700',
        'NIKON D750',
        'NIKON D80',
        'PENTAX K10D',
        'SM-F711N',
        'SM-S906U',
        'SM-T970',
        null,
      ]);
      expect(status).toBe(200);
    });

    it('should get suggestions for camera model', async () => {
      const { status, body } = await request(app)
        .get('/search/suggestions?type=camera-model')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(body).toEqual([
        'Canon EOS 7D',
        'Canon EOS R5',
        'DSLR-A550',
        'FinePix S3Pro',
        'iPhone 7',
        'NIKON D700',
        'NIKON D750',
        'NIKON D80',
        'PENTAX K10D',
        'SM-F711N',
        'SM-S906U',
        'SM-T970',
      ]);
      expect(status).toBe(200);
    });
  });

  // -- Timeline EXIF filter tests --
  // Note: EXIF data (city, country, make, model) is populated by the server's metadata
  // extraction and reverse geocoding pipeline during asset upload. The test assets used
  // in the beforeAll block above have embedded EXIF data and assigned GPS coordinates,
  // so the server has already populated their exif_info rows by the time tests run.

  describe('GET /timeline/buckets (EXIF filters)', () => {
    it('should return buckets without any filter', async () => {
      const { status, body } = await request(app)
        .get('/timeline/buckets')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
      for (const bucket of body) {
        expect(bucket).toHaveProperty('timeBucket');
        expect(bucket).toHaveProperty('count');
        expect(bucket.count).toBeGreaterThan(0);
      }
    });

    it('should filter buckets by city', async () => {
      // Paris is assigned to assetFalcon via reverse geocoding of its coordinates
      const { status, body } = await request(app)
        .get('/timeline/buckets?city=Paris')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);

      const totalFiltered = body.reduce((sum: number, b: { count: number }) => sum + b.count, 0);
      // There should be at least 1 asset in Paris
      expect(totalFiltered).toBeGreaterThanOrEqual(1);

      // Filtered count should be less than unfiltered
      const { body: allBuckets } = await request(app)
        .get('/timeline/buckets')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const totalAll = allBuckets.reduce((sum: number, b: { count: number }) => sum + b.count, 0);
      expect(totalFiltered).toBeLessThan(totalAll);
    });

    it('should filter buckets by camera make', async () => {
      // Canon is the make for assetFalcon (Canon EOS R5) and assetDenali (Canon EOS 7D)
      const { status, body } = await request(app)
        .get('/timeline/buckets?make=Canon')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);

      const totalFiltered = body.reduce((sum: number, b: { count: number }) => sum + b.count, 0);
      expect(totalFiltered).toBeGreaterThanOrEqual(2);
    });

    it('should filter buckets by camera model', async () => {
      const { status, body } = await request(app)
        .get('/timeline/buckets?model=Canon%20EOS%207D')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);

      const totalFiltered = body.reduce((sum: number, b: { count: number }) => sum + b.count, 0);
      // Only assetDenali has Canon EOS 7D
      expect(totalFiltered).toBeGreaterThanOrEqual(1);
    });

    it('should filter buckets by country', async () => {
      const { status, body } = await request(app)
        .get('/timeline/buckets?country=France')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);

      const totalFiltered = body.reduce((sum: number, b: { count: number }) => sum + b.count, 0);
      expect(totalFiltered).toBeGreaterThanOrEqual(1);
    });

    it('should return zero buckets for non-matching city filter', async () => {
      const { status, body } = await request(app)
        .get('/timeline/buckets?city=Timbuktu')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    });

    it('should return zero buckets for non-matching make filter', async () => {
      const { status, body } = await request(app)
        .get('/timeline/buckets?make=Hasselblad')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    });

    it('should combine city and make filters (AND semantics)', async () => {
      // Paris + Canon: assetFalcon is in Paris with Canon EOS R5
      const { status, body } = await request(app)
        .get('/timeline/buckets?city=Paris&make=Canon')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);

      const totalFiltered = body.reduce((sum: number, b: { count: number }) => sum + b.count, 0);
      expect(totalFiltered).toBeGreaterThanOrEqual(1);

      // AND should be ≤ each individual filter
      const { body: cityOnly } = await request(app)
        .get('/timeline/buckets?city=Paris')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const cityCount = cityOnly.reduce((sum: number, b: { count: number }) => sum + b.count, 0);
      expect(totalFiltered).toBeLessThanOrEqual(cityCount);
    });

    it('should return zero when combined filters match no assets', async () => {
      // Tokyo + Canon: assetDenali (Canon EOS 7D) is in Tokyo — this should match
      // But Accra + Canon: no Canon camera in Accra
      const { status, body } = await request(app)
        .get('/timeline/buckets?city=Accra&make=Canon')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);

      const totalFiltered = body.reduce((sum: number, b: { count: number }) => sum + b.count, 0);
      expect(totalFiltered).toBe(0);
    });

    it('should accept the rating filter parameter', async () => {
      // rating filter uses >= semantics; test assets may not have ratings set,
      // so we just verify the API accepts it and returns a valid response
      const { status, body } = await request(app)
        .get('/timeline/buckets?rating=5')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      // With no rated assets, expect empty; with rated ones, expect valid structure
      for (const bucket of body) {
        expect(bucket).toHaveProperty('timeBucket');
        expect(bucket).toHaveProperty('count');
      }
    });

    it('should accept the type filter parameter', async () => {
      const { status, body } = await request(app)
        .get('/timeline/buckets?type=IMAGE')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);

      const totalImages = body.reduce((sum: number, b: { count: number }) => sum + b.count, 0);
      expect(totalImages).toBeGreaterThan(0);
    });
  });

  describe('GET /search/suggestions (spaceId scoping)', () => {
    let space: SharedSpaceResponseDto;
    let nonOwnerUser: LoginResponseDto;

    beforeAll(async () => {
      // Create a space and add only the Paris asset (assetFalcon) to it.
      // assetFalcon is in Paris, France and was taken with a Canon EOS R5.
      space = await utils.createSpace(admin.accessToken, { name: 'Paris Photos' });
      await utils.addSpaceAssets(admin.accessToken, space.id, [assetFalcon.id]);

      nonOwnerUser = await utils.userSetup(admin.accessToken, {
        email: 'space-filter-test@immich.cloud',
        name: 'Space Filter User',
        password: 'Password123!',
      });
      await utils.addSpaceMember(admin.accessToken, space.id, { userId: nonOwnerUser.userId });
    });

    it('should return only countries from the specified space', async () => {
      const { status, body } = await request(app)
        .get(`/search/suggestions?type=country&spaceId=${space.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      // Only France should appear since only the Paris asset is in the space
      expect(body).toEqual(['France']);
    });

    it('should return only cities from the specified space', async () => {
      const { status, body } = await request(app)
        .get(`/search/suggestions?type=city&spaceId=${space.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body).toEqual(['Paris']);
    });

    it('should return only camera makes from the specified space', async () => {
      const { status, body } = await request(app)
        .get(`/search/suggestions?type=camera-make&spaceId=${space.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body).toEqual(['Canon']);
    });

    it('should return only camera models from the specified space', async () => {
      const { status, body } = await request(app)
        .get(`/search/suggestions?type=camera-model&spaceId=${space.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body).toEqual(['Canon EOS R5']);
    });

    it('should return all countries when spaceId is omitted', async () => {
      const { status, body } = await request(app)
        .get('/search/suggestions?type=country')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      // Without space scoping, all countries should be returned
      expect(body.length).toBeGreaterThan(1);
      expect(body).toContain('France');
    });

    it('should return empty for space with no matching suggestion type', async () => {
      // Create a space with only the density_plot asset (PNG, no camera make/model)
      const emptySpace = await utils.createSpace(admin.accessToken, { name: 'Density Only' });
      await utils.addSpaceAssets(admin.accessToken, emptySpace.id, [assetDensity.id]);

      const { status, body } = await request(app)
        .get(`/search/suggestions?type=camera-make&spaceId=${emptySpace.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      // density_plot.png has no camera make EXIF data
      expect(body).toEqual([]);
    });

    it('should return suggestions for non-owner space member', async () => {
      // nonOwnerUser doesn't own the Paris asset, but is a space member
      const { status, body } = await request(app)
        .get(`/search/suggestions?type=country&spaceId=${space.id}`)
        .set('Authorization', `Bearer ${nonOwnerUser.accessToken}`);
      expect(status).toBe(200);
      expect(body).toEqual(['France']);
    });

    it('should return camera suggestions for non-owner space member', async () => {
      const { status, body } = await request(app)
        .get(`/search/suggestions?type=camera-make&spaceId=${space.id}`)
        .set('Authorization', `Bearer ${nonOwnerUser.accessToken}`);
      expect(status).toBe(200);
      expect(body).toEqual(['Canon']);
    });

    it('should reject non-member requesting space suggestions', async () => {
      const outsider = await utils.userSetup(admin.accessToken, {
        email: 'space-outsider@immich.cloud',
        name: 'Outsider',
        password: 'Password123!',
      });
      const { status } = await request(app)
        .get(`/search/suggestions?type=country&spaceId=${space.id}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);
      expect(status).toBe(400);
    });
  });

  describe('GET /search/suggestions (withSharedSpaces)', () => {
    let memberUser: LoginResponseDto;
    let sharedSpace: SharedSpaceResponseDto;

    beforeAll(async () => {
      // Create a non-admin user and a space owned by admin with assetFalcon (Paris, France, Canon EOS R5)
      memberUser = await utils.userSetup(admin.accessToken, {
        email: 'with-shared-spaces@immich.cloud',
        name: 'WithSharedSpaces User',
        password: 'Password123!',
      });
      sharedSpace = await utils.createSpace(admin.accessToken, { name: 'SharedSpaces Test' });
      await utils.addSpaceAssets(admin.accessToken, sharedSpace.id, [assetFalcon.id]);
      await utils.addSpaceMember(admin.accessToken, sharedSpace.id, { userId: memberUser.userId });
    });

    it('should return space country suggestions for member with withSharedSpaces=true', async () => {
      const { status, body } = await request(app)
        .get('/search/suggestions?type=country&withSharedSpaces=true')
        .set('Authorization', `Bearer ${memberUser.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      // memberUser has no own assets but is a member of a space containing assetFalcon (France)
      expect(body).toContain('France');
    });

    it('should return space camera-make suggestions for member with withSharedSpaces=true', async () => {
      const { status, body } = await request(app)
        .get('/search/suggestions?type=camera-make&withSharedSpaces=true')
        .set('Authorization', `Bearer ${memberUser.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      // assetFalcon was taken with a Canon camera
      expect(body).toContain('Canon');
    });

    it('should reject when both spaceId and withSharedSpaces are provided', async () => {
      const { status } = await request(app)
        .get(`/search/suggestions?type=country&spaceId=${sharedSpace.id}&withSharedSpaces=true`)
        .set('Authorization', `Bearer ${memberUser.accessToken}`);
      expect(status).toBe(400);
    });

    it('should not return space content without withSharedSpaces flag', async () => {
      const { status, body } = await request(app)
        .get('/search/suggestions?type=country')
        .set('Authorization', `Bearer ${memberUser.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      // memberUser has no own assets, so no countries should be returned
      expect(body).toEqual([]);
    });
  });

  describe('POST /search/random (spaceId access)', () => {
    let space: SharedSpaceResponseDto;
    let outsider: LoginResponseDto;

    beforeAll(async () => {
      space = await utils.createSpace(admin.accessToken, { name: 'Random Search Space' });
      await utils.addSpaceAssets(admin.accessToken, space.id, [assetFalcon.id]);

      outsider = await utils.userSetup(admin.accessToken, {
        email: 'random-search-outsider@immich.cloud',
        name: 'Random Outsider',
        password: 'Password123!',
      });
    });

    it('should reject non-member', async () => {
      const { status } = await request(app)
        .post('/search/random')
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .send({ spaceId: space.id });

      expect(status).toBe(400);
    });

    it('should return results for space member', async () => {
      const { status, body } = await request(app)
        .post('/search/random')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ spaceId: space.id, size: 10 });

      expect(status).toBe(200);
      expect(body.length).toBeGreaterThan(0);
      expect(body.map((a: AssetResponseDto) => a.id)).toContain(assetFalcon.id);
    });
  });

  describe('POST /search/large-assets (spaceId access)', () => {
    let space: SharedSpaceResponseDto;
    let outsider: LoginResponseDto;

    beforeAll(async () => {
      space = await utils.createSpace(admin.accessToken, { name: 'Large Assets Search Space' });
      await utils.addSpaceAssets(admin.accessToken, space.id, [assetFalcon.id]);

      outsider = await utils.userSetup(admin.accessToken, {
        email: 'large-assets-outsider@immich.cloud',
        name: 'Large Assets Outsider',
        password: 'Password123!',
      });
    });

    it('should reject non-member', async () => {
      const { status } = await request(app)
        .post(`/search/large-assets?spaceId=${space.id}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`);

      expect(status).toBe(400);
    });

    it('should return results for space member', async () => {
      const { status, body } = await request(app)
        .post(`/search/large-assets?spaceId=${space.id}&size=10`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe('POST /search/smart with spacePersonIds', () => {
    it('should return 400 when spacePersonIds sent without spaceId', async () => {
      const { status } = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ query: 'test', spacePersonIds: [admin.userId] });

      expect(status).toBe(400);
    });

    it('should not reject spacePersonIds when spaceId is provided', async () => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Search PersonIds Test' });
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

      const { status, body } = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ query: 'test', spaceId: space.id, spacePersonIds: [admin.userId] });

      // 200 if ML enabled, 400 "Smart search is not enabled" if ML disabled
      // but never 400 "spacePersonIds requires spaceId" — that's the validation we're testing
      if (status === 400) {
        expect(body.message).toBe('Smart search is not enabled');
      } else {
        expect(status).toBe(200);
      }
    });

    it('should not reject structured filters within a space', async () => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Filter Test Space' });
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

      const { status, body } = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          query: 'test',
          spaceId: space.id,
          city: 'NonexistentCity',
          rating: 5,
        });

      if (status === 400) {
        expect(body.message).toBe('Smart search is not enabled');
      } else {
        expect(status).toBe(200);
      }
    });
  });

  describe('POST /search/smart with withSharedSpaces', () => {
    // The e2e stack runs with IMMICH_MACHINE_LEARNING_ENABLED=false, so the default
    // config has ML disabled. We toggle it on at runtime via updateConfig for these
    // tests and seed fake CLIP embeddings directly into the smart_search table so we
    // don't need a real ML server. We use `queryAssetId` (not `query`) in the request
    // so the service reads the embedding from DB instead of calling encodeText().

    let ownerUser: LoginResponseDto;
    let memberUser: LoginResponseDto;
    let outsiderUser: LoginResponseDto;
    let ownerAsset: AssetMediaResponseDto;
    let ownerAssetNotInSpace: AssetMediaResponseDto;
    let memberAsset: AssetMediaResponseDto;
    let outsiderAsset: AssetMediaResponseDto;
    let memberWebsocket: Socket;
    let ownerWebsocket: Socket;
    let outsiderWebsocket: Socket;

    // A 512-dim vector literal in pgvector text format. Zero vector is fine —
    // we just need *some* embedding so the cosine-distance order-by doesn't error.
    const zeroEmbedding = '[' + Array.from({ length: 512 }, () => '0').join(',') + ']';

    const seedEmbedding = async (assetId: string) => {
      const db = await utils.connectDatabase();
      await db.query(
        `INSERT INTO "smart_search" ("assetId", "embedding") VALUES ($1, $2)
         ON CONFLICT ("assetId") DO UPDATE SET "embedding" = EXCLUDED."embedding"`,
        [assetId, zeroEmbedding],
      );
    };

    beforeAll(async () => {
      ownerUser = await utils.userSetup(admin.accessToken, {
        email: 'smart-shared-owner@immich.cloud',
        name: 'Smart Shared Owner',
        password: 'Password123!',
      });
      memberUser = await utils.userSetup(admin.accessToken, {
        email: 'smart-shared-member@immich.cloud',
        name: 'Smart Shared Member',
        password: 'Password123!',
      });
      outsiderUser = await utils.userSetup(admin.accessToken, {
        email: 'smart-shared-outsider@immich.cloud',
        name: 'Smart Shared Outsider',
        password: 'Password123!',
      });

      ownerWebsocket = await utils.connectWebsocket(ownerUser.accessToken);
      memberWebsocket = await utils.connectWebsocket(memberUser.accessToken);
      outsiderWebsocket = await utils.connectWebsocket(outsiderUser.accessToken);

      // Upload assets while ML is still disabled (avoids background ML job churn)
      ownerAsset = await utils.createAsset(ownerUser.accessToken, {});
      ownerAssetNotInSpace = await utils.createAsset(ownerUser.accessToken, {});
      memberAsset = await utils.createAsset(memberUser.accessToken, {});
      outsiderAsset = await utils.createAsset(outsiderUser.accessToken, {});

      await utils.waitForWebsocketEvent({ event: 'assetUpload', id: ownerAsset.id });
      await utils.waitForWebsocketEvent({ event: 'assetUpload', id: ownerAssetNotInSpace.id });
      await utils.waitForWebsocketEvent({ event: 'assetUpload', id: memberAsset.id });
      await utils.waitForWebsocketEvent({ event: 'assetUpload', id: outsiderAsset.id });

      // Seed fake embeddings so searchSmart can find the assets via queryAssetId path
      await seedEmbedding(ownerAsset.id);
      await seedEmbedding(ownerAssetNotInSpace.id);
      await seedEmbedding(memberAsset.id);
      await seedEmbedding(outsiderAsset.id);

      // Enable smart search via runtime config (overrides IMMICH_MACHINE_LEARNING_ENABLED=false)
      await enableSmartSearch(admin.accessToken);
    }, 60_000);

    afterAll(async () => {
      utils.disconnectWebsocket(ownerWebsocket);
      utils.disconnectWebsocket(memberWebsocket);
      utils.disconnectWebsocket(outsiderWebsocket);
      // Reset admin config so ML is disabled again for downstream tests
      await utils.resetAdminConfig(admin.accessToken);
    });

    it('should return timeline-pinned shared space content for a member', async () => {
      // Owner creates a space with their asset, adds member, member opts in to timeline
      const space = await utils.createSpace(ownerUser.accessToken, { name: 'Timeline Smart Space' });
      await utils.addSpaceAssets(ownerUser.accessToken, space.id, [ownerAsset.id]);
      await utils.addSpaceMember(ownerUser.accessToken, space.id, { userId: memberUser.userId });

      const { status: toggleStatus } = await request(app)
        .patch(`/shared-spaces/${space.id}/members/me/timeline`)
        .set('Authorization', `Bearer ${memberUser.accessToken}`)
        .send({ showInTimeline: true });
      expect(toggleStatus).toBe(200);

      const { status, body } = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${memberUser.accessToken}`)
        .send({ queryAssetId: memberAsset.id, withSharedSpaces: true, size: 100 });

      expect(status).toBe(200);
      const ids = body.assets.items.map((a: AssetResponseDto) => a.id);
      // Member sees their own asset AND the owner's asset from the pinned space
      expect(ids).toContain(memberAsset.id);
      expect(ids).toContain(ownerAsset.id);
    });

    it('should reject with 400 when both spaceId and withSharedSpaces are set', async () => {
      const space = await utils.createSpace(ownerUser.accessToken, { name: 'Conflict Space' });

      const { status, body } = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${ownerUser.accessToken}`)
        .send({ queryAssetId: ownerAsset.id, spaceId: space.id, withSharedSpaces: true });

      expect(status).toBe(400);
      expect(body.message).toBe('Cannot use both spaceId and withSharedSpaces');
    });

    it('should fall back to owner-only results when user has no shared spaces', async () => {
      // outsiderUser is not a member of any space
      const { status, body } = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${outsiderUser.accessToken}`)
        .send({ queryAssetId: outsiderAsset.id, withSharedSpaces: true, size: 100 });

      expect(status).toBe(200);
      const ids = body.assets.items.map((a: AssetResponseDto) => a.id);
      expect(ids).toContain(outsiderAsset.id);
      // Never leaks assets from users the outsider isn't partnered/sharing with
      expect(ids).not.toContain(ownerAsset.id);
      expect(ids).not.toContain(memberAsset.id);
    });

    it('should not expose assets from private spaces the user is not a member of', async () => {
      // Owner creates a private space the outsider is NOT in
      const privateSpace = await utils.createSpace(ownerUser.accessToken, { name: 'Private Isolation Space' });
      await utils.addSpaceAssets(ownerUser.accessToken, privateSpace.id, [ownerAssetNotInSpace.id]);

      const { status, body } = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${outsiderUser.accessToken}`)
        .send({ queryAssetId: outsiderAsset.id, withSharedSpaces: true, size: 100 });

      expect(status).toBe(200);
      const ids = body.assets.items.map((a: AssetResponseDto) => a.id);
      expect(ids).toContain(outsiderAsset.id);
      expect(ids).not.toContain(ownerAssetNotInSpace.id);
      expect(ids).not.toContain(ownerAsset.id);
    });

    it('should not return space content after the user has been removed from the space', async () => {
      // Create a fresh space, add memberUser, pin to timeline, then remove them
      const kickSpace = await utils.createSpace(ownerUser.accessToken, { name: 'Kick Space' });
      await utils.addSpaceAssets(ownerUser.accessToken, kickSpace.id, [ownerAssetNotInSpace.id]);
      await utils.addSpaceMember(ownerUser.accessToken, kickSpace.id, { userId: memberUser.userId });

      await request(app)
        .patch(`/shared-spaces/${kickSpace.id}/members/me/timeline`)
        .set('Authorization', `Bearer ${memberUser.accessToken}`)
        .send({ showInTimeline: true })
        .expect(200);

      // Sanity: before removal the member can see the kicked-space asset
      const before = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${memberUser.accessToken}`)
        .send({ queryAssetId: memberAsset.id, withSharedSpaces: true, size: 100 });
      expect(before.status).toBe(200);
      const beforeIds = before.body.assets.items.map((a: AssetResponseDto) => a.id);
      expect(beforeIds).toContain(ownerAssetNotInSpace.id);

      // Owner removes member
      const { status: removeStatus } = await request(app)
        .delete(`/shared-spaces/${kickSpace.id}/members/${memberUser.userId}`)
        .set('Authorization', `Bearer ${ownerUser.accessToken}`);
      expect(removeStatus).toBe(204);

      // After removal: kicked member must no longer see content from that space
      const after = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${memberUser.accessToken}`)
        .send({ queryAssetId: memberAsset.id, withSharedSpaces: true, size: 100 });
      expect(after.status).toBe(200);
      const afterIds = after.body.assets.items.map((a: AssetResponseDto) => a.id);
      expect(afterIds).toContain(memberAsset.id);
      expect(afterIds).not.toContain(ownerAssetNotInSpace.id);
    });

    it('should not include shared-space content when withSharedSpaces is absent or false', async () => {
      // memberUser still has their pinned space from the first test — verify that
      // *without* the flag, the owner's asset does NOT leak into their results.
      const withoutFlag = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${memberUser.accessToken}`)
        .send({ queryAssetId: memberAsset.id, size: 100 });
      expect(withoutFlag.status).toBe(200);
      const withoutIds = withoutFlag.body.assets.items.map((a: AssetResponseDto) => a.id);
      expect(withoutIds).toContain(memberAsset.id);
      expect(withoutIds).not.toContain(ownerAsset.id);

      const withFalse = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${memberUser.accessToken}`)
        .send({ queryAssetId: memberAsset.id, withSharedSpaces: false, size: 100 });
      expect(withFalse.status).toBe(200);
      const withFalseIds = withFalse.body.assets.items.map((a: AssetResponseDto) => a.id);
      expect(withFalseIds).toContain(memberAsset.id);
      expect(withFalseIds).not.toContain(ownerAsset.id);
    });
  });

  describe('POST /search/smart pagination stability', () => {
    // Regression test for identical-embedding pagination overlap: when multiple
    // assets have byte-identical CLIP embeddings, the cosine-distance order-by
    // has no natural tiebreaker, so offset-based pagination can return the same
    // asset on page 1 and page 2. The fix adds asset.id as a stable tiebreaker
    // to both the relevance-only ordering and the two-phase CTE's outer
    // fileCreatedAt ordering. See commit 6a4bffc82.

    let paginationUser: LoginResponseDto;
    let paginationWebsocket: Socket;
    let paginationAssets: AssetMediaResponseDto[] = [];

    const zeroEmbedding = '[' + Array.from({ length: 512 }, () => '0').join(',') + ']';

    const seedEmbedding = async (assetId: string) => {
      const db = await utils.connectDatabase();
      await db.query(
        `INSERT INTO "smart_search" ("assetId", "embedding") VALUES ($1, $2)
         ON CONFLICT ("assetId") DO UPDATE SET "embedding" = EXCLUDED."embedding"`,
        [assetId, zeroEmbedding],
      );
    };

    const ASSET_COUNT = 12;
    const PAGE_SIZE = 5;

    beforeAll(async () => {
      paginationUser = await utils.userSetup(admin.accessToken, {
        email: 'smart-pagination@immich.cloud',
        name: 'Smart Pagination User',
        password: 'Password123!',
      });
      paginationWebsocket = await utils.connectWebsocket(paginationUser.accessToken);

      // Upload N assets — enough to fill at least two PAGE_SIZE pages.
      paginationAssets = [];
      for (let i = 0; i < ASSET_COUNT; i++) {
        const asset = await utils.createAsset(paginationUser.accessToken, {});
        paginationAssets.push(asset);
      }

      for (const asset of paginationAssets) {
        await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });
      }

      // Seed IDENTICAL zero-vector embeddings on every asset so the cosine-
      // distance order-by has no natural tiebreaker. Without the id tiebreaker
      // fix, offset-based pagination produces overlap across pages.
      for (const asset of paginationAssets) {
        await seedEmbedding(asset.id);
      }

      await enableSmartSearch(admin.accessToken);
    }, 60_000);

    afterAll(async () => {
      utils.disconnectWebsocket(paginationWebsocket);
      await utils.resetAdminConfig(admin.accessToken);
    });

    it('should not return duplicate assets across pages when multiple assets have identical embeddings', async () => {
      const queryAssetId = paginationAssets[0].id;

      const page1Response = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${paginationUser.accessToken}`)
        .send({ queryAssetId, size: PAGE_SIZE, page: 1 });
      expect(page1Response.status).toBe(200);

      const page2Response = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${paginationUser.accessToken}`)
        .send({ queryAssetId, size: PAGE_SIZE, page: 2 });
      expect(page2Response.status).toBe(200);

      const page1Ids: string[] = page1Response.body.assets.items.map((a: AssetResponseDto) => a.id);
      const page2Ids: string[] = page2Response.body.assets.items.map((a: AssetResponseDto) => a.id);

      // Regression: no asset should appear on both pages.
      const overlap = page1Ids.filter((id) => page2Ids.includes(id));
      expect(overlap).toEqual([]);

      // Each page should be fully populated (we have ASSET_COUNT >= 2 * PAGE_SIZE).
      expect(page1Ids).toHaveLength(PAGE_SIZE);
      expect(page2Ids).toHaveLength(PAGE_SIZE);

      // The union of both pages should contain 2 * PAGE_SIZE distinct assets.
      const uniqueIds = new Set<string>([...page1Ids, ...page2Ids]);
      expect(uniqueIds.size).toBe(2 * PAGE_SIZE);
    });

    it('should return a stable ordering when paging with identical embeddings', async () => {
      const queryAssetId = paginationAssets[0].id;

      const first = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${paginationUser.accessToken}`)
        .send({ queryAssetId, size: PAGE_SIZE, page: 1 });
      const second = await request(app)
        .post('/search/smart')
        .set('Authorization', `Bearer ${paginationUser.accessToken}`)
        .send({ queryAssetId, size: PAGE_SIZE, page: 1 });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const firstIds: string[] = first.body.assets.items.map((a: AssetResponseDto) => a.id);
      const secondIds: string[] = second.body.assets.items.map((a: AssetResponseDto) => a.id);
      expect(firstIds).toEqual(secondIds);
    });
  });

  describe('GET /search/suggestions (temporal scoping)', () => {
    // Upload assets with specific fileCreatedAt dates and different countries/cameras
    // so we can test that temporal params narrow suggestions correctly.
    let temporalUser: LoginResponseDto;
    let temporalSpace: SharedSpaceResponseDto;
    let temporalWebsocket: Socket;

    // Dates: asset1 = 2020-06-15, asset2 = 2022-03-10, asset3 = 2024-01-20
    const date1 = '2020-06-15T12:00:00.000Z';
    const date2 = '2022-03-10T12:00:00.000Z';
    const date3 = '2024-01-20T12:00:00.000Z';

    let asset1: AssetMediaResponseDto;
    let asset2: AssetMediaResponseDto;
    let asset3: AssetMediaResponseDto;

    beforeAll(async () => {
      temporalUser = await utils.userSetup(admin.accessToken, {
        email: 'temporal-suggest@immich.cloud',
        name: 'Temporal Suggest User',
        password: 'Password123!',
      });
      temporalWebsocket = await utils.connectWebsocket(temporalUser.accessToken);

      // Upload three assets with distinct dates — they'll use random PNG images with no EXIF,
      // so we assign GPS coords afterwards to get country/city populated by reverse geocoding.
      asset1 = await utils.createAsset(temporalUser.accessToken, {
        fileCreatedAt: date1,
        fileModifiedAt: date1,
      });
      asset2 = await utils.createAsset(temporalUser.accessToken, {
        fileCreatedAt: date2,
        fileModifiedAt: date2,
      });
      asset3 = await utils.createAsset(temporalUser.accessToken, {
        fileCreatedAt: date3,
        fileModifiedAt: date3,
      });

      for (const a of [asset1, asset2, asset3]) {
        await utils.waitForWebsocketEvent({ event: 'assetUpload', id: a.id });
      }

      // Assign different GPS coordinates so reverse geocoding gives distinct countries
      const updates = [
        { id: asset1.id, latitude: 48.8534, longitude: 2.3488 }, // Paris, France
        { id: asset2.id, latitude: 35.6895, longitude: 139.6917 }, // Tokyo, Japan
        { id: asset3.id, latitude: 52.5244, longitude: 13.4105 }, // Berlin, Germany
      ];
      await Promise.all(
        updates.map((u) =>
          updateAsset(
            { id: u.id, updateAssetDto: { latitude: u.latitude, longitude: u.longitude } },
            { headers: asBearerAuth(temporalUser.accessToken) },
          ),
        ),
      );
      for (const u of updates) {
        await utils.waitForWebsocketEvent({ event: 'assetUpdate', id: u.id });
      }

      // Create a space with all three assets for combined testing
      temporalSpace = await utils.createSpace(temporalUser.accessToken, { name: 'Temporal Test Space' });
      await utils.addSpaceAssets(temporalUser.accessToken, temporalSpace.id, [asset1.id, asset2.id, asset3.id]);
    }, 30_000);

    afterAll(() => {
      utils.disconnectWebsocket(temporalWebsocket);
    });

    it('should return only countries from assets in the date range', async () => {
      // Range covers only asset1 (2020-06-15) and asset2 (2022-03-10)
      const { status, body } = await request(app)
        .get(
          '/search/suggestions?type=country&takenAfter=2020-01-01T00:00:00.000Z&takenBefore=2023-01-01T00:00:00.000Z',
        )
        .set('Authorization', `Bearer ${temporalUser.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body).toContain('France');
      expect(body).toContain('Japan');
      expect(body).not.toContain('Germany');
    });

    it('should return only cities from assets in the date range', async () => {
      // Range covers only asset3 (2024-01-20)
      const { status, body } = await request(app)
        .get('/search/suggestions?type=city&takenAfter=2023-01-01T00:00:00.000Z&takenBefore=2025-01-01T00:00:00.000Z')
        .set('Authorization', `Bearer ${temporalUser.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body).toContain('Berlin');
      expect(body).not.toContain('Paris');
      expect(body).not.toContain('Tokyo');
    });

    it('should return empty when date range contains no assets', async () => {
      const { status, body } = await request(app)
        .get(
          '/search/suggestions?type=country&takenAfter=2000-01-01T00:00:00.000Z&takenBefore=2001-01-01T00:00:00.000Z',
        )
        .set('Authorization', `Bearer ${temporalUser.accessToken}`);
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    it('should apply strict < for takenBefore boundary', async () => {
      // takenBefore is the exact fileCreatedAt of asset1 — should NOT include it (strict <)
      const { status, body } = await request(app)
        .get(`/search/suggestions?type=country&takenAfter=2020-01-01T00:00:00.000Z&takenBefore=${date1}`)
        .set('Authorization', `Bearer ${temporalUser.accessToken}`);
      expect(status).toBe(200);
      // asset1 fileCreatedAt is exactly date1, strict < means it's excluded
      expect(body).not.toContain('France');
    });

    it('should combine spaceId with temporal params', async () => {
      // All three assets are in the space, but date range only covers asset2 (2022)
      const { status, body } = await request(app)
        .get(
          `/search/suggestions?type=country&spaceId=${temporalSpace.id}&takenAfter=2021-01-01T00:00:00.000Z&takenBefore=2023-01-01T00:00:00.000Z`,
        )
        .set('Authorization', `Bearer ${temporalUser.accessToken}`);
      expect(status).toBe(200);
      expect(body).toEqual(['Japan']);
    });

    it('should return all suggestions when no temporal params are provided (backward compat)', async () => {
      const { status, body } = await request(app)
        .get('/search/suggestions?type=country')
        .set('Authorization', `Bearer ${temporalUser.accessToken}`);
      expect(status).toBe(200);
      expect(body).toContain('France');
      expect(body).toContain('Japan');
      expect(body).toContain('Germany');
    });
  });
});
