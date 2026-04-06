import { AssetMediaResponseDto, AssetVisibility, type LoginResponseDto } from '@immich/sdk';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Socket } from 'socket.io-client';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, testAssetDir, utils } from 'src/utils';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Coverage for the fork-only `/gallery/map/markers` controller (gallery-map.controller.ts).
// This is the filtered map endpoint distinct from `/map/markers` — it accepts a rich
// query (people, tags, EXIF, dates, favorite, country/city) and is used by the web map
// view's filter panel. T18 covers the access matrix and the basic (non-space) filters;
// T19 will cover spaceId scoping.
//
// Service shape (shared-space.service.ts:561-585):
//   - When `spaceId` is set: requireAccess(SharedSpaceRead) → 400 for non-member.
//     personIds get re-routed as spacePersonIds (same DTO field, different semantics).
//   - Without spaceId: scoped to auth.user.id.
//   - Always filters visibility=Timeline (no archived).
//
// Setup uploads two real geotagged fixture images so the EXIF-based filters
// (make, country, takenAfter/Before) have real data to match.

describe('/gallery/map/markers', () => {
  let admin: LoginResponseDto;
  let user: LoginResponseDto;
  let websocket: Socket;
  let assetWithGps: AssetMediaResponseDto;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    user = await utils.userSetup(admin.accessToken, createUserDto.create('t18-user'));
    websocket = await utils.connectWebsocket(user.accessToken);

    // Upload a real geotagged fixture so the EXIF-based filters have data.
    // thompson-springs.jpg is the same fixture used by /map e2e — it has GPS in
    // Colorado, USA, plus camera EXIF metadata.
    const filepath = join(testAssetDir, 'metadata/gps-position/thompson-springs.jpg');
    assetWithGps = await utils.createAsset(user.accessToken, {
      assetData: { bytes: await readFile(filepath), filename: basename(filepath) },
    });
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: assetWithGps.id });
  });

  afterAll(() => {
    utils.disconnectWebsocket(websocket);
  });

  it('requires authentication', async () => {
    const { status } = await request(app).get('/gallery/map/markers').set(authHeaders(anonActor));
    expect(status).toBe(401);
  });

  it('returns the user\'s geotagged assets with no filters', async () => {
    const { status, body } = await request(app)
      .get('/gallery/map/markers')
      .set(asBearerAuth(user.accessToken));
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const ids = (body as Array<{ id: string }>).map((m) => m.id);
    expect(ids).toContain(assetWithGps.id);
  });

  it('returns an empty array for a user with no geotagged assets', async () => {
    // A fresh user with zero uploads sees an empty marker list.
    const freshUser = await utils.userSetup(admin.accessToken, createUserDto.create('t18-empty'));
    const { status, body } = await request(app)
      .get('/gallery/map/markers')
      .set(asBearerAuth(freshUser.accessToken));
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it('country filter narrows the result to matching assets', async () => {
    // The thompson-springs fixture has country = 'United States of America'.
    const matching = await request(app)
      .get('/gallery/map/markers?country=United%20States%20of%20America')
      .set(asBearerAuth(user.accessToken));
    expect(matching.status).toBe(200);
    expect((matching.body as Array<{ id: string }>).map((m) => m.id)).toContain(assetWithGps.id);

    const nonMatching = await request(app)
      .get('/gallery/map/markers?country=Antarctica')
      .set(asBearerAuth(user.accessToken));
    expect(nonMatching.status).toBe(200);
    expect((nonMatching.body as Array<{ id: string }>).map((m) => m.id)).not.toContain(assetWithGps.id);
  });

  it('city filter narrows the result to matching assets', async () => {
    // The thompson-springs fixture has city = 'Palisade'. Probe both an exact and a
    // non-matching city to confirm the filter actually fires.
    const matching = await request(app)
      .get('/gallery/map/markers?city=Palisade')
      .set(asBearerAuth(user.accessToken));
    expect(matching.status).toBe(200);
    expect((matching.body as Array<{ id: string }>).map((m) => m.id)).toContain(assetWithGps.id);

    const nonMatching = await request(app)
      .get('/gallery/map/markers?city=Atlantis')
      .set(asBearerAuth(user.accessToken));
    expect((nonMatching.body as Array<{ id: string }>).map((m) => m.id)).not.toContain(assetWithGps.id);
  });

  it('isFavorite filter respects the favorite state', async () => {
    // Default state is not favorite — assert exclusion when isFavorite=true.
    const favOnly = await request(app)
      .get('/gallery/map/markers?isFavorite=true')
      .set(asBearerAuth(user.accessToken));
    expect(favOnly.status).toBe(200);
    expect((favOnly.body as Array<{ id: string }>).map((m) => m.id)).not.toContain(assetWithGps.id);
  });

  it('takenAfter filter excludes assets taken before the cutoff', async () => {
    // The fixture's exif timestamp is well in the past. A cutoff of next year should
    // exclude it.
    const futureCutoff = '2099-01-01T00:00:00.000Z';
    const { status, body } = await request(app)
      .get(`/gallery/map/markers?takenAfter=${encodeURIComponent(futureCutoff)}`)
      .set(asBearerAuth(user.accessToken));
    expect(status).toBe(200);
    expect((body as Array<{ id: string }>).map((m) => m.id)).not.toContain(assetWithGps.id);
  });

  it('takenBefore filter excludes assets taken after the cutoff', async () => {
    // Cutoff in 1900 should exclude any modern fixture.
    const ancientCutoff = '1900-01-01T00:00:00.000Z';
    const { status, body } = await request(app)
      .get(`/gallery/map/markers?takenBefore=${encodeURIComponent(ancientCutoff)}`)
      .set(asBearerAuth(user.accessToken));
    expect(status).toBe(200);
    expect((body as Array<{ id: string }>).map((m) => m.id)).not.toContain(assetWithGps.id);
  });

  it('rating filter rejects values outside 1-5 with 400', async () => {
    // FilteredMapMarkerDto.rating has @Min(1) @Max(5) — 0 should fail validation.
    const tooLow = await request(app)
      .get('/gallery/map/markers?rating=0')
      .set(asBearerAuth(user.accessToken));
    expect(tooLow.status).toBe(400);

    const tooHigh = await request(app)
      .get('/gallery/map/markers?rating=6')
      .set(asBearerAuth(user.accessToken));
    expect(tooHigh.status).toBe(400);
  });

  it('type filter rejects an invalid enum value with 400', async () => {
    // MapMediaType is IMAGE | VIDEO; anything else should fail validation.
    const { status } = await request(app)
      .get('/gallery/map/markers?type=NOPE')
      .set(asBearerAuth(user.accessToken));
    expect(status).toBe(400);
  });

  it('archived assets are excluded — service hardcodes visibility=Timeline', async () => {
    // shared-space.service.ts:581 sets `visibility: AssetVisibility.Timeline` on the
    // repository call regardless of any client-supplied parameter. Toggle the asset
    // to archive via PUT /assets/:id and verify it disappears from the marker list.
    try {
      await request(app)
        .put(`/assets/${assetWithGps.id}`)
        .set(asBearerAuth(user.accessToken))
        .send({ visibility: AssetVisibility.Archive });

      const { status, body } = await request(app)
        .get('/gallery/map/markers')
        .set(asBearerAuth(user.accessToken));
      expect(status).toBe(200);
      expect((body as Array<{ id: string }>).map((m) => m.id)).not.toContain(assetWithGps.id);
    } finally {
      await request(app)
        .put(`/assets/${assetWithGps.id}`)
        .set(asBearerAuth(user.accessToken))
        .send({ visibility: AssetVisibility.Timeline });
    }
  });

  it('cross-user isolation — another user does not see this user\'s markers', async () => {
    // Without spaceId, the service scopes to auth.user.id (line 567). A second user
    // calling the endpoint sees only their own assets, not user's.
    const otherUser = await utils.userSetup(admin.accessToken, createUserDto.create('t18-other'));
    const { status, body } = await request(app)
      .get('/gallery/map/markers')
      .set(asBearerAuth(otherUser.accessToken));
    expect(status).toBe(200);
    expect((body as Array<{ id: string }>).map((m) => m.id)).not.toContain(assetWithGps.id);
  });
});
