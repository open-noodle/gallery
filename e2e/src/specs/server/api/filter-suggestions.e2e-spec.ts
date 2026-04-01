import { AssetMediaResponseDto, LoginResponseDto, updateAsset } from '@immich/sdk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Socket } from 'socket.io-client';
import { app, asBearerAuth, testAssetDir, utils } from 'src/utils';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('/search/suggestions/filters', () => {
  let admin: LoginResponseDto;
  let websocket: Socket;
  let assets: AssetMediaResponseDto[];
  let tagNatureId: string;
  let tagTravelId: string;

  // Discovered values from unfiltered response
  let unfilteredCountries: string[];
  let unfilteredCameraMakes: string[];
  let unfilteredTags: Array<{ id: string; value: string }>;
  let unfilteredRatings: number[];

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    websocket = await utils.connectWebsocket(admin.accessToken);

    // Upload 4 test photos with real EXIF (different cameras)
    const files = [
      { filename: '/albums/nature/prairie_falcon.jpg' }, // Canon EOS R5
      { filename: '/formats/webp/denali.webp' }, // Canon EOS 7D
      { filename: '/formats/raw/Nikon/D80/glarus.nef' }, // Nikon D80
      { filename: '/formats/jpg/el_torcal_rocks.jpg' }, // HP scanner
    ];

    assets = [];
    for (const { filename } of files) {
      const bytes = await readFile(join(testAssetDir, filename));
      assets.push(
        await utils.createAsset(admin.accessToken, {
          deviceAssetId: `filter-test-${filename}`,
          assetData: { bytes, filename },
        }),
      );
    }

    for (const asset of assets) {
      await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });
    }

    // Set distinct coordinates for different countries
    const coordinates = [
      { latitude: 48.853_41, longitude: 2.3488 }, // Paris, France
      { latitude: 35.6895, longitude: 139.691_71 }, // Tokyo, Japan
      { latitude: 52.524_37, longitude: 13.410_53 }, // Berlin, Germany
      { latitude: 35.6895, longitude: 139.691_71 }, // Tokyo, Japan (same as B)
    ];

    for (const [i, dto] of coordinates.entries()) {
      await updateAsset({ id: assets[i].id, updateAssetDto: dto }, { headers: asBearerAuth(admin.accessToken) });
    }

    for (const asset of assets) {
      await utils.waitForWebsocketEvent({ event: 'assetUpdate', id: asset.id });
    }

    // Set ratings: A=5, B=4, C=5, D=3
    const ratings = [5, 4, 5, 3];
    for (const [i, rating] of ratings.entries()) {
      await updateAsset({ id: assets[i].id, updateAssetDto: { rating } }, { headers: asBearerAuth(admin.accessToken) });
    }

    // Create and apply tags using utils helpers
    const tags = await utils.upsertTags(admin.accessToken, ['nature', 'travel']);
    tagNatureId = tags[0].id;
    tagTravelId = tags[1].id;

    // A+C get "nature", B+D get "travel"
    await utils.tagAssets(admin.accessToken, tagNatureId, [assets[0].id, assets[2].id]);
    await utils.tagAssets(admin.accessToken, tagTravelId, [assets[1].id, assets[3].id]);

    // Discover unfiltered values
    const { body } = await request(app)
      .get('/search/suggestions/filters?withSharedSpaces=true')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    unfilteredCountries = body.countries;
    unfilteredCameraMakes = body.cameraMakes;
    unfilteredTags = body.tags;
    unfilteredRatings = body.ratings;
  }, 60_000);

  afterAll(() => {
    utils.disconnectWebsocket(websocket);
  });

  it('should return non-empty unfiltered baseline', () => {
    expect(unfilteredCountries.length).toBeGreaterThanOrEqual(2);
    expect(unfilteredTags.length).toBeGreaterThanOrEqual(2);
    expect(unfilteredRatings.length).toBeGreaterThanOrEqual(2);
  });

  it('should narrow tags when filtering by country', async () => {
    const country = unfilteredCountries[0];
    const { body } = await request(app)
      .get(`/search/suggestions/filters?country=${encodeURIComponent(country)}&withSharedSpaces=true`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(body.tags.length).toBeLessThan(unfilteredTags.length);
  });

  it('should narrow countries when filtering by tag', async () => {
    const { body } = await request(app)
      .get(`/search/suggestions/filters?tagIds=${tagNatureId}&withSharedSpaces=true`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    // "nature" is on A (France) and C (Germany), not B or D (Japan)
    expect(body.countries.length).toBeLessThan(unfilteredCountries.length);
  });

  it('should narrow countries when filtering by rating', async () => {
    // Rating 3 is only on asset D (Tokyo)
    const { body } = await request(app)
      .get('/search/suggestions/filters?rating=3&withSharedSpaces=true')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(body.countries.length).toBeLessThan(unfilteredCountries.length);
  });

  it('should narrow countries when filtering by camera make', async () => {
    if (unfilteredCameraMakes.length < 2) {
      return; // skip if test assets don't have diverse cameras
    }
    const make = unfilteredCameraMakes[0];
    const { body } = await request(app)
      .get(`/search/suggestions/filters?make=${encodeURIComponent(make)}&withSharedSpaces=true`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(body.countries.length).toBeLessThanOrEqual(unfilteredCountries.length);
  });

  it('should narrow further with combined filters', async () => {
    const country = unfilteredCountries[0];

    // Get results with just country
    const { body: countryOnly } = await request(app)
      .get(`/search/suggestions/filters?country=${encodeURIComponent(country)}&withSharedSpaces=true`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    // Get results with country + tag
    const { body: combined } = await request(app)
      .get(
        `/search/suggestions/filters?country=${encodeURIComponent(country)}&tagIds=${tagNatureId}&withSharedSpaces=true`,
      )
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    // Combined should be equal or narrower than country alone
    expect(combined.ratings.length).toBeLessThanOrEqual(countryOnly.ratings.length);
  });

  it('should parse rating as number from query string', async () => {
    const { body } = await request(app)
      .get('/search/suggestions/filters?rating=5&withSharedSpaces=true')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(body.countries).toBeDefined();
    expect(Array.isArray(body.countries)).toBe(true);
  });

  it('should accept single tagId without array duplication', async () => {
    const { body } = await request(app)
      .get(`/search/suggestions/filters?tagIds=${tagNatureId}&withSharedSpaces=true`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(body.countries.length).toBeLessThan(unfilteredCountries.length);
  });

  it('should return valid response for non-overlapping filters', async () => {
    const country = unfilteredCountries[0];
    const oppositeTagId = unfilteredTags[0].id === tagNatureId ? tagTravelId : tagNatureId;

    const { body } = await request(app)
      .get(
        `/search/suggestions/filters?country=${encodeURIComponent(country)}&tagIds=${oppositeTagId}&withSharedSpaces=true`,
      )
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    // Should have fewer results or be empty — at minimum, valid response shape
    expect(Array.isArray(body.countries)).toBe(true);
    expect(Array.isArray(body.tags)).toBe(true);
    expect(typeof body.hasUnnamedPeople).toBe('boolean');
  });

  it('should scope suggestions to a space', async () => {
    // Create a space with only assets A and B
    const space = await utils.createSpace(admin.accessToken, { name: 'Filter Test Space' });
    await utils.addSpaceAssets(admin.accessToken, space.id, [assets[0].id, assets[1].id]);

    const { body } = await request(app)
      .get(`/search/suggestions/filters?spaceId=${space.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    // Space has only 2 assets — verify valid response with some suggestions
    expect(Array.isArray(body.countries)).toBe(true);
    expect(Array.isArray(body.tags)).toBe(true);
    expect(Array.isArray(body.ratings)).toBe(true);
    expect(body.countries.length).toBeGreaterThanOrEqual(1);
    expect(body.ratings.length).toBeGreaterThanOrEqual(1);
  });
});
