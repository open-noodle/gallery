import {
  AlbumUserRole,
  AssetMediaResponseDto,
  AssetVisibility,
  SharedSpaceRole,
  type LoginResponseDto,
} from '@immich/sdk';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Socket } from 'socket.io-client';
import { authHeaders, type Actor } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { makeRandomImage } from 'src/generators';
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
//   - Visibility: Timeline for the plain and space queries; Archive | Timeline for an
//     albumId query, which matches the album grid (D4). Hidden/Locked/Trashed never show.
//
// Setup uploads two real geotagged fixture images so the EXIF-based filters
// (make, country, takenAfter/Before) have real data to match.

/** Asset ids of the markers in a `/gallery/map/markers` response body. */
const markerIds = (body: unknown) => (body as Array<{ id: string }>).map((m) => m.id);

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

  it("returns the user's geotagged assets with no filters", async () => {
    const { status, body } = await request(app).get('/gallery/map/markers').set(asBearerAuth(user.accessToken));
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const ids = (body as Array<{ id: string }>).map((m) => m.id);
    expect(ids).toContain(assetWithGps.id);
  });

  it('returns an empty array for a user with no geotagged assets', async () => {
    // A fresh user with zero uploads sees an empty marker list.
    const freshUser = await utils.userSetup(admin.accessToken, createUserDto.create('t18-empty'));
    const { status, body } = await request(app).get('/gallery/map/markers').set(asBearerAuth(freshUser.accessToken));
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
    const matching = await request(app).get('/gallery/map/markers?city=Palisade').set(asBearerAuth(user.accessToken));
    expect(matching.status).toBe(200);
    expect((matching.body as Array<{ id: string }>).map((m) => m.id)).toContain(assetWithGps.id);

    const nonMatching = await request(app)
      .get('/gallery/map/markers?city=Atlantis')
      .set(asBearerAuth(user.accessToken));
    expect((nonMatching.body as Array<{ id: string }>).map((m) => m.id)).not.toContain(assetWithGps.id);
  });

  it('isFavorite filter respects the favorite state', async () => {
    // Default state is not favorite — assert exclusion when isFavorite=true.
    const favOnly = await request(app).get('/gallery/map/markers?isFavorite=true').set(asBearerAuth(user.accessToken));
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
    const tooLow = await request(app).get('/gallery/map/markers?rating=0').set(asBearerAuth(user.accessToken));
    expect(tooLow.status).toBe(400);

    const tooHigh = await request(app).get('/gallery/map/markers?rating=6').set(asBearerAuth(user.accessToken));
    expect(tooHigh.status).toBe(400);
  });

  it('type filter rejects an invalid enum value with 400', async () => {
    // MapMediaType is IMAGE | VIDEO; anything else should fail validation.
    const { status } = await request(app).get('/gallery/map/markers?type=NOPE').set(asBearerAuth(user.accessToken));
    expect(status).toBe(400);
  });

  it('archived assets are excluded from the plain (non-album) map — visibility=Timeline', async () => {
    // shared-space.service.ts pins the plain and space queries to visibility=Timeline,
    // regardless of any client-supplied parameter. (Only the album-boundary query widens
    // to Archive | Timeline, to match the album grid — see the D4 describe below.) Toggle
    // the asset to archive via PUT /assets/:id and verify it disappears from the marker list.
    try {
      await request(app)
        .put(`/assets/${assetWithGps.id}`)
        .set(asBearerAuth(user.accessToken))
        .send({ visibility: AssetVisibility.Archive });

      const { status, body } = await request(app).get('/gallery/map/markers').set(asBearerAuth(user.accessToken));
      expect(status).toBe(200);
      expect((body as Array<{ id: string }>).map((m) => m.id)).not.toContain(assetWithGps.id);
    } finally {
      await request(app)
        .put(`/assets/${assetWithGps.id}`)
        .set(asBearerAuth(user.accessToken))
        .send({ visibility: AssetVisibility.Timeline });
    }
  });

  it("cross-user isolation — another user does not see this user's markers", async () => {
    // Without spaceId, the service scopes to auth.user.id (line 567). A second
    // user with NO geotagged assets calling the endpoint should see exactly
    // an empty list. The strong assertion (`toEqual([])`) eliminates the
    // ambiguity between "scoping works" and "endpoint is broken and returned
    // empty for unrelated reasons" — both pass `not.toContain` but only the
    // former passes `toEqual([])`.
    const otherUser = await utils.userSetup(admin.accessToken, createUserDto.create('t18-other'));
    const { status, body } = await request(app).get('/gallery/map/markers').set(asBearerAuth(otherUser.accessToken));
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  describe('spaceId scoping (T19)', () => {
    // T19 covers the spaceId code path. The service at shared-space.service.ts:561-585
    // does requireAccess(SharedSpaceRead) → 400 for non-members. When spaceId is set,
    // userIds is undefined and personIds get re-routed to spacePersonIds (line 569-570).
    //
    // Setup creates a fresh space owned by `user`, adds a second member, and adds the
    // user's geotagged asset to the space so it should appear in the space-scoped
    // marker list.

    let spaceMember: LoginResponseDto;
    let spaceNonMember: LoginResponseDto;
    let spaceId: string;

    beforeAll(async () => {
      [spaceMember, spaceNonMember] = await Promise.all([
        utils.userSetup(admin.accessToken, createUserDto.create('t19-member')),
        utils.userSetup(admin.accessToken, createUserDto.create('t19-nonmember')),
      ]);

      const space = await utils.createSpace(user.accessToken, { name: 't19 space' });
      spaceId = space.id;

      await utils.addSpaceMember(user.accessToken, spaceId, {
        userId: spaceMember.userId,
        role: SharedSpaceRole.Editor,
      });

      // Add the geotagged asset to the space so it shows up in the space-scoped query.
      await utils.addSpaceAssets(user.accessToken, spaceId, [assetWithGps.id]);
    });

    it('non-member gets 400 (requireAccess BadRequestException)', async () => {
      // shared-space.service.ts:563 — requireAccess(SharedSpaceRead). Non-members
      // get 400, NOT 403. Same taxonomy as the timeline endpoints (T03).
      const { status } = await request(app)
        .get(`/gallery/map/markers?spaceId=${spaceId}`)
        .set(asBearerAuth(spaceNonMember.accessToken));
      expect(status).toBe(400);
    });

    it('anon gets 401', async () => {
      const { status } = await request(app).get(`/gallery/map/markers?spaceId=${spaceId}`);
      expect(status).toBe(401);
    });

    it('space member sees the space asset via spaceId', async () => {
      // The PR #275-style assertion: a non-owner space member queries the gallery
      // map with the space scope and sees the asset that the owner added to the space.
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?spaceId=${spaceId}`)
        .set(asBearerAuth(spaceMember.accessToken));
      expect(status).toBe(200);
      expect((body as Array<{ id: string }>).map((m) => m.id)).toContain(assetWithGps.id);
    });

    it('space owner sees the space asset via spaceId', async () => {
      // The owner queries with spaceId. The space asset must be returned.
      //
      // NOTE: a stronger version of this test would also create a SECOND
      // owner-side geotagged asset NOT added to the space and assert it is
      // excluded — but the only available GPS fixture is thompson-springs.jpg,
      // and Immich deduplicates uploads by SHA-1 checksum, so a second upload
      // of the same file returns the EXISTING asset id (assetWithGps). To
      // make this assertion load-bearing, we'd need a second GPS fixture
      // file with a distinct checksum. The cross-user-isolation test below
      // already pins that the spaceId scoping does not leak across users via
      // the strong `toEqual([])` form, which covers the same invariant.
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?spaceId=${spaceId}`)
        .set(asBearerAuth(user.accessToken));
      expect(status).toBe(200);
      expect((body as Array<{ id: string }>).map((m) => m.id)).toContain(assetWithGps.id);
    });

    it('non-existent spaceId returns 400 (bulk-access pattern)', async () => {
      // requireAccess uses Immich's bulk-access pattern: missing or no-access IDs
      // both return BadRequestException. Same as T03 timeline.
      const { status } = await request(app)
        .get('/gallery/map/markers?spaceId=00000000-0000-4000-a000-000000000099')
        .set(asBearerAuth(user.accessToken));
      expect(status).toBe(400);
    });

    it('country filter still narrows when scoped by spaceId', async () => {
      // Filters compose with spaceId. country=Antarctica should produce empty even
      // if the space asset would otherwise be returned.
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?spaceId=${spaceId}&country=Antarctica`)
        .set(asBearerAuth(spaceMember.accessToken));
      expect(status).toBe(200);
      expect((body as Array<{ id: string }>).map((m) => m.id)).not.toContain(assetWithGps.id);
    });

    // The personIds → spacePersonIds re-routing branch (shared-space.service.ts:
    // 569-570) is intentionally NOT pinned at the e2e level. A test that passes
    // a bogus UUID would return an empty result regardless of which join the
    // repository uses, because:
    //   - spacePersonIds: bogus UUID → no shared_space_person_face match → []
    //   - personIds:      bogus UUID → no asset_face match              → []
    // Both code paths return [] for a bogus input, so the assertion is not
    // load-bearing on the re-routing.
    //
    // To genuinely pin re-routing, the test would need: (a) a real global
    // person attached to the space asset, AND (b) a real space person, with
    // the assertion being that passing the GLOBAL person id with spaceId set
    // returns []  (proving the join didn't fall back to the global table).
    // That fixture setup is more involved than T19's scope justifies. The
    // re-routing is covered by unit tests at shared-space.service.spec.ts.
  });

  describe('albumId scoping (#656 class)', () => {
    // A shared album is scoped by album ACCESS, not by asset ownership. `albumViewer` owns nothing:
    // every pin they see here belongs to `albumOwner`.
    let albumOwner: LoginResponseDto;
    let albumViewer: LoginResponseDto;
    let outsider: LoginResponseDto;
    let albumId: string;
    let spaceId: string; // the shared space spaceAssetId lives in
    let plainAssetId: string; // in the album only
    let spaceAssetId: string; // in the album AND in a shared space both users can see
    let outOfAlbumAssetId: string; // owned by albumOwner, geotagged, NOT in the album — proves narrowing

    beforeAll(async () => {
      [albumOwner, albumViewer, outsider] = await Promise.all([
        utils.userSetup(admin.accessToken, createUserDto.create('t20-album-owner')),
        utils.userSetup(admin.accessToken, createUserDto.create('t20-album-viewer')),
        utils.userSetup(admin.accessToken, createUserDto.create('t20-outsider')),
      ]);

      const ownerWebsocket = await utils.connectWebsocket(albumOwner.accessToken);
      const upload = async (input: string) => {
        const filepath = join(testAssetDir, input);
        const { id } = await utils.createAsset(albumOwner.accessToken, {
          assetData: { bytes: await readFile(filepath), filename: basename(filepath) },
        });
        await utils.waitForWebsocketEvent({ event: 'assetUpload', id });
        return id;
      };

      // Three DIFFERENT geotagged fixtures — same-checksum re-uploads return the existing asset id.
      plainAssetId = await upload('formats/heic/IMG_2682.heic');
      spaceAssetId = await upload('metadata/dates/datetimeoriginal-gps.jpg');
      // Real (non-degenerate) GPS EXIF, distinct checksum from the other two fixtures used in this
      // suite — confirmed via EXIF inspection: GPSLatitude (37, 46, 29.64) N, GPSLongitude
      // (122, 25, 9.84) W. Deliberately left out of both the album and the space below.
      outOfAlbumAssetId = await upload('metadata/dates/gps-datetime.jpg');
      utils.disconnectWebsocket(ownerWebsocket);

      // The space asset lives in a space BOTH users have in their timeline (showInTimeline defaults
      // to true — shared-space-member.table.ts:74-75). createSpace makes albumOwner an Owner-role
      // member of their own space, so both actors below can self-PATCH their own timeline pref.
      const space = await utils.createSpace(albumOwner.accessToken, { name: 't20 space' });
      spaceId = space.id;
      await utils.addSpaceMember(albumOwner.accessToken, spaceId, {
        userId: albumViewer.userId,
        role: SharedSpaceRole.Viewer,
      });
      await utils.addSpaceAssets(albumOwner.accessToken, spaceId, [spaceAssetId]);

      const album = await utils.createAlbum(albumOwner.accessToken, {
        albumName: 't20 shared album',
        assetIds: [plainAssetId, spaceAssetId],
        albumUsers: [{ userId: albumViewer.userId, role: AlbumUserRole.Viewer }],
      });
      albumId = album.id;
    });

    it('a viewer of a shared album sees the OWNER pins (#656)', async () => {
      // Before the fix this returned [] — userIds was hard-coded to [caller], and the viewer owns
      // no assets at all.
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?albumId=${albumId}`)
        .set(asBearerAuth(albumViewer.accessToken));

      expect(status).toBe(200);
      expect((body as Array<{ id: string }>).map((m) => m.id)).toContain(plainAssetId);
    });

    it('an album asset that also lives in a shared space KEEPS its pin even when the caller has toggled that space out of their own timeline (R4 regression, #656)', async () => {
      // The R4 hole: the album query used to compute timelineSpaceIds from the caller's OWN
      // showInTimeline preference and feed it into albumSharedSpaceScope as the RBAC gate. Toggling
      // showInTimeline=false for this space made that gate degenerate to "the asset must be in no
      // shared space at all", dropping spaceAssetId's pin for that caller — even though the album
      // grid kept showing it regardless. Since the fix, album ACCESS (checked above) is the whole
      // boundary for this query, so the caller's timeline preference must have ZERO effect on it.
      //
      // `withSharedSpaces=true` is what makes the PATCH below load-bearing — it is NOT decoration.
      // getFilteredMapMarkers only reads getSpaceIdsForTimeline (the showInTimeline preference this
      // test toggles) when `withSharedSpaces === true`; on a bare `?albumId=` request timelineSpaceIds
      // is undefined whatever the preference says, so the toggle has no input to change and the whole
      // scenario is inert. The shape is real: an album chip on /photos plus its map icon produces
      // exactly `?withSharedSpaces=true&albumId=…` (buildMapMarkerOptions, map-filter-options.ts).
      // It is accepted by FilteredMapMarkerSchema — the 400 guard is on spaceId+albumId, not
      // albumId+withSharedSpaces (see 'rejects spaceId together with albumId' below).
      const albumMarkers = `/gallery/map/markers?albumId=${albumId}&withSharedSpaces=true`;
      const albumMarkerIdsFor = async (actor: LoginResponseDto) => {
        const { status, body } = await request(app).get(albumMarkers).set(asBearerAuth(actor.accessToken));
        expect(status).toBe(200);
        return markerIds(body);
      };

      // Baseline with the space IN the caller's timeline (showInTimeline defaults to true): both
      // album pins are there. This is the "before" half the toggle has to leave untouched.
      for (const actor of [albumViewer, albumOwner]) {
        const ids = await albumMarkerIdsFor(actor);
        expect(ids).toContain(spaceAssetId);
        expect(ids).toContain(plainAssetId);
      }

      for (const actor of [albumViewer, albumOwner]) {
        const toggleOff = await request(app)
          .patch(`/shared-spaces/${spaceId}/members/me/timeline`)
          .set(asBearerAuth(actor.accessToken))
          .send({ showInTimeline: false });
        expect(toggleOff.status).toBe(200);
      }

      try {
        for (const actor of [albumViewer, albumOwner]) {
          const ids = await albumMarkerIdsFor(actor);
          expect(ids).toContain(spaceAssetId);
          expect(ids).toContain(plainAssetId);
        }
      } finally {
        // Restore so later tests in this describe don't inherit the off state.
        for (const actor of [albumViewer, albumOwner]) {
          await request(app)
            .patch(`/shared-spaces/${spaceId}/members/me/timeline`)
            .set(asBearerAuth(actor.accessToken))
            .send({ showInTimeline: true });
        }
      }
    });

    it('a user with no access to the album gets 400', async () => {
      const { status } = await request(app)
        .get(`/gallery/map/markers?albumId=${albumId}`)
        .set(asBearerAuth(outsider.accessToken));

      expect(status).toBe(400);
    });

    it('albumId NARROWS: an owner asset outside the album is excluded, even though it has a marker', async () => {
      // The over-inclusion direction. Dropping userIds for an album query means the whole safety of
      // the album branch rests on inAlbums() inside albumSharedSpaceScope — whose first arm admits
      // ANY asset that is in no shared space at all, for ANY caller. If a future refactor lost the
      // albumIds `$if` in searchAssetBuilder, or the service stopped forwarding albumIds, `?albumId=`
      // would silently widen to every non-space-shared geotagged asset on the instance, and every
      // other test in this describe (all `toContain`) would keep passing.
      //
      // Sanity-pin FIRST: prove outOfAlbumAssetId actually produces a marker at all for its owner
      // with no filters. Without this, the not.toContain below could pass vacuously forever (e.g. if
      // the fixture had no GPS data and never produced a marker for anyone).
      const unfiltered = await request(app).get('/gallery/map/markers').set(asBearerAuth(albumOwner.accessToken));
      expect(unfiltered.status).toBe(200);
      expect((unfiltered.body as Array<{ id: string }>).map((m) => m.id)).toContain(outOfAlbumAssetId);

      // Now the real assertion: the album VIEWER's albumId query must not surface an owner asset that
      // was never added to the album. albumViewer owns nothing, so nothing but the album filter itself
      // stands between this asset and the result.
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?albumId=${albumId}`)
        .set(asBearerAuth(albumViewer.accessToken));
      expect(status).toBe(200);
      expect((body as Array<{ id: string }>).map((m) => m.id)).not.toContain(outOfAlbumAssetId);
    });

    it('rejects spaceId together with albumId', async () => {
      const space = await utils.createSpace(albumOwner.accessToken, { name: 't20 combo space' });
      const { status } = await request(app)
        .get(`/gallery/map/markers?spaceId=${space.id}&albumId=${albumId}`)
        .set(asBearerAuth(albumOwner.accessToken));

      expect(status).toBe(400);
    });
  });

  describe('albumId visibility: the album map matches the album GRID (D4)', () => {
    // The album grid shows Archive | Timeline (withDefaultVisibility, database.ts) and hides
    // Hidden / Locked / Trashed. The album map used to hard-code visibility=Timeline, so an
    // archived geotagged album asset appeared in the grid with NO pin. D4: the map matches the
    // grid. The accepted caveat is that another member's archived asset in the album gets a pin —
    // both actors below therefore expect the same set.
    //
    // The widening must be EXACTLY one visibility state: Hidden, Locked and Trashed album assets
    // must still have no pin. That is the whole risk of the change, so each is asserted, for both
    // the album owner and a viewer of the shared album.
    let owner: LoginResponseDto;
    let viewer: LoginResponseDto;
    let visibilityAlbumId: string;
    let timelineAssetId: string;
    let archivedAssetId: string;
    let hiddenAssetId: string;
    let lockedAssetId: string;
    let trashedAssetId: string;

    beforeAll(async () => {
      [owner, viewer] = await Promise.all([
        utils.userSetup(admin.accessToken, createUserDto.create('t22-vis-owner')),
        utils.userSetup(admin.accessToken, createUserDto.create('t22-vis-viewer')),
      ]);

      // Random images (distinct checksums, no EXIF) + an explicit GPS write. latitude/longitude are
      // lockable exif properties (database.ts lockableProperties), so a user-set value is not
      // clobbered by the metadata-extraction pass that follows the upload.
      const createGeotagged = async () => {
        const { id } = await utils.createAsset(owner.accessToken);
        const { status } = await request(app)
          .put(`/assets/${id}`)
          .set(asBearerAuth(owner.accessToken))
          .send({ latitude: 48.85837, longitude: 2.29448 });
        expect(status).toBe(200);
        return id;
      };

      timelineAssetId = await createGeotagged();
      archivedAssetId = await createGeotagged();
      hiddenAssetId = await createGeotagged();
      lockedAssetId = await createGeotagged();
      trashedAssetId = await createGeotagged();

      const album = await utils.createAlbum(owner.accessToken, {
        albumName: 't22 visibility album',
        assetIds: [timelineAssetId, archivedAssetId, hiddenAssetId, lockedAssetId, trashedAssetId],
        albumUsers: [{ userId: viewer.userId, role: AlbumUserRole.Viewer }],
      });
      visibilityAlbumId = album.id;

      // Non-vacuity pin: while all five are Timeline, all five have a marker. Without this, the
      // `not.toContain` assertions below could pass forever because an asset silently lost its GPS.
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?albumId=${visibilityAlbumId}`)
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(200);
      expect(markerIds(body).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [timelineAssetId, archivedAssetId, hiddenAssetId, lockedAssetId, trashedAssetId].toSorted((a, b) =>
          a.localeCompare(b),
        ),
      );

      // Now move four of them out of Timeline. The single-asset PUT is used deliberately: the BULK
      // update strips Locked assets from every album (asset.service.ts updateAll), which would make
      // the locked case vacuous — this keeps the album_asset link and leaves the query itself as the
      // only thing standing between a locked asset and a pin.
      for (const [id, visibility] of [
        [archivedAssetId, AssetVisibility.Archive],
        [hiddenAssetId, AssetVisibility.Hidden],
        [lockedAssetId, AssetVisibility.Locked],
      ] as const) {
        const { status } = await request(app)
          .put(`/assets/${id}`)
          .set(asBearerAuth(owner.accessToken))
          .send({ visibility });
        expect(status).toBe(200);
      }

      await utils.deleteAssets(owner.accessToken, [trashedAssetId]);
    });

    it('pins an ARCHIVED album asset, for the album owner and for a viewer of the shared album', async () => {
      for (const actor of [owner, viewer]) {
        const { status, body } = await request(app)
          .get(`/gallery/map/markers?albumId=${visibilityAlbumId}`)
          .set(asBearerAuth(actor.accessToken));

        expect(status).toBe(200);
        const ids = markerIds(body);
        expect(ids).toContain(timelineAssetId);
        expect(ids).toContain(archivedAssetId);
      }
    });

    it('still gives Hidden, Locked and Trashed album assets NO pin', async () => {
      for (const actor of [owner, viewer]) {
        const { status, body } = await request(app)
          .get(`/gallery/map/markers?albumId=${visibilityAlbumId}`)
          .set(asBearerAuth(actor.accessToken));

        expect(status).toBe(200);
        const ids = markerIds(body);
        expect(ids).not.toContain(hiddenAssetId);
        expect(ids).not.toContain(lockedAssetId);
        expect(ids).not.toContain(trashedAssetId);
      }
    });

    it('leaves the non-album map on Timeline only — an archived asset gets no pin there', async () => {
      // The widening is scoped to the album-boundary query. The owner's plain map must not start
      // showing their archived assets.
      const { status, body } = await request(app).get('/gallery/map/markers').set(asBearerAuth(owner.accessToken));

      expect(status).toBe(200);
      const ids = markerIds(body);
      expect(ids).toContain(timelineAssetId);
      expect(ids).not.toContain(archivedAssetId);
      expect(ids).not.toContain(hiddenAssetId);
      expect(ids).not.toContain(lockedAssetId);
      expect(ids).not.toContain(trashedAssetId);
    });
  });

  describe('description / originalFileName filters (finding 2: wire-name pin, #767 fresh instance)', () => {
    // A prior fix added originalFileName/description/ocr to FilteredMapMarkerSchema and forwarded
    // them from the web marker-option builders (map-filter-options.ts), but nothing exercised the
    // three field names over the REAL wire: the web builders return `Record<string, unknown>`, so
    // renaming a key still typechecks, and the generated SDK silently drops an unknown query key —
    // the filter would just no-op again (the exact bug that change fixed). The only guards were two
    // client-side literal-string assertions. This test pins originalFileName and description
    // end-to-end against two DISTINCT geotagged assets, so a "narrowing" assertion is load-bearing
    // (it fails both if the filter no-ops AND if it over-matches) rather than vacuously true because
    // only one asset exists.
    //
    // OCR is intentionally NOT covered here: populating ocr_search requires an ML round trip this
    // e2e suite does not otherwise exercise. OCR forwarding is covered at the unit level
    // (shared-space.service.spec.ts: "should pass description/originalFileName/ocr to repository").
    let textFilterUser: LoginResponseDto;
    let matchingAssetId: string;
    let otherAssetId: string;

    beforeAll(async () => {
      textFilterUser = await utils.userSetup(admin.accessToken, createUserDto.create('t21-textfilter-user'));
      const ws = await utils.connectWebsocket(textFilterUser.accessToken);

      const upload = async (input: string) => {
        const filepath = join(testAssetDir, input);
        const { id } = await utils.createAsset(textFilterUser.accessToken, {
          assetData: { bytes: await readFile(filepath), filename: basename(filepath) },
        });
        await utils.waitForWebsocketEvent({ event: 'assetUpload', id });
        return id;
      };

      // Two geotagged fixtures with distinct checksums (same pair used in the albumId describe
      // above), so each gets its own asset row and its own originalFileName.
      matchingAssetId = await upload('metadata/gps-position/thompson-springs.jpg');
      otherAssetId = await upload('metadata/dates/datetimeoriginal-gps.jpg');
      utils.disconnectWebsocket(ws);

      // Descriptions can be set immediately after upload without waiting on metadataExtraction:
      // upsertExif does a real INSERT ... ON CONFLICT, and the user-set value is written with its
      // column locked in the same statement, so a later-completing extraction pass cannot clobber it.
      await request(app)
        .put(`/assets/${matchingAssetId}`)
        .set(asBearerAuth(textFilterUser.accessToken))
        .send({ description: 'A quiet mountain sunset over the valley' });
      await request(app)
        .put(`/assets/${otherAssetId}`)
        .set(asBearerAuth(textFilterUser.accessToken))
        .send({ description: 'A family gathering in the backyard' });
    });

    it('originalFileName filter narrows to the matching asset over the wire', async () => {
      const { status, body } = await request(app)
        .get('/gallery/map/markers?originalFileName=thompson-springs')
        .set(asBearerAuth(textFilterUser.accessToken));

      expect(status).toBe(200);
      const ids = (body as Array<{ id: string }>).map((m) => m.id);
      expect(ids).toContain(matchingAssetId);
      expect(ids).not.toContain(otherAssetId);
    });

    it('description filter narrows to the matching asset over the wire', async () => {
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?description=${encodeURIComponent('mountain sunset')}`)
        .set(asBearerAuth(textFilterUser.accessToken));

      expect(status).toBe(200);
      const ids = (body as Array<{ id: string }>).map((m) => m.id);
      expect(ids).toContain(matchingAssetId);
      expect(ids).not.toContain(otherAssetId);
    });
  });

  describe('lensModel / state filters (wire-name pins)', () => {
    // Same bug class as the description/originalFileName pins above, and the reason they exist: the
    // web marker builders return `Record<string, unknown>` (map-filter-options.ts), so a misspelt
    // key still typechecks, and an unknown query key is silently dropped by the zod query schema —
    // the filter just no-ops and the map keeps showing every pin while the chip claims otherwise.
    // The ONLY other coverage for lensModel/state on the map casts an object literal
    // (`{ lensModel: … } as FilteredMapMarkerDto`) straight into the service, which bypasses
    // FilteredMapMarkerSchema entirely and would keep passing after either of those mistakes.
    // (`ownerId` is already pinned over the wire by the RBAC describe below.)
    //
    // Two DISTINCT geotagged fixtures with different lens/state values, so each assertion narrows in
    // both directions (`toContain` + `not.toContain`) and cannot pass vacuously:
    //   thompson-springs.jpg  lensModel 'Canon EF 24-105mm f/4L IS II USM' (exif LensID), Colorado
    //   IMG_2682.heic         lensModel 'iPhone 7 back camera 3.99mm f/1.8',                Nebraska
    // (state comes from reverse geocoding the GPS EXIF — see map.e2e-spec.ts, which pins the same
    // two places for these two fixtures.)
    let exifFilterUser: LoginResponseDto;
    let coloradoAssetId: string;
    let nebraskaAssetId: string;

    beforeAll(async () => {
      exifFilterUser = await utils.userSetup(admin.accessToken, createUserDto.create('t25-exif-filter'));
      const ws = await utils.connectWebsocket(exifFilterUser.accessToken);

      const upload = async (input: string) => {
        const filepath = join(testAssetDir, input);
        const { id } = await utils.createAsset(exifFilterUser.accessToken, {
          assetData: { bytes: await readFile(filepath), filename: basename(filepath) },
        });
        await utils.waitForWebsocketEvent({ event: 'assetUpload', id });
        return id;
      };

      coloradoAssetId = await upload('metadata/gps-position/thompson-springs.jpg');
      nebraskaAssetId = await upload('formats/heic/IMG_2682.heic');
      utils.disconnectWebsocket(ws);
    });

    it('sanity: both fixtures produce a marker with no filters', async () => {
      // Without this, every `not.toContain` below could pass forever for the wrong reason (a fixture
      // that silently lost its GPS EXIF, or metadata extraction that never populated lens/state).
      const { status, body } = await request(app)
        .get('/gallery/map/markers')
        .set(asBearerAuth(exifFilterUser.accessToken));

      expect(status).toBe(200);
      expect(markerIds(body).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [coloradoAssetId, nebraskaAssetId].toSorted((a, b) => a.localeCompare(b)),
      );
    });

    it('lensModel narrows to the matching asset over the wire', async () => {
      const lens = encodeURIComponent('Canon EF 24-105mm f/4L IS II USM');
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?lensModel=${lens}`)
        .set(asBearerAuth(exifFilterUser.accessToken));

      expect(status).toBe(200);
      const ids = markerIds(body);
      expect(ids).toContain(coloradoAssetId);
      expect(ids).not.toContain(nebraskaAssetId);
    });

    it('state narrows to the matching asset over the wire', async () => {
      const { status, body } = await request(app)
        .get('/gallery/map/markers?state=Colorado')
        .set(asBearerAuth(exifFilterUser.accessToken));

      expect(status).toBe(200);
      const ids = markerIds(body);
      expect(ids).toContain(coloradoAssetId);
      expect(ids).not.toContain(nebraskaAssetId);
    });

    it('state narrows the other way too (the filter is not a one-sided no-op)', async () => {
      const { status, body } = await request(app)
        .get('/gallery/map/markers?state=Nebraska')
        .set(asBearerAuth(exifFilterUser.accessToken));

      expect(status).toBe(200);
      const ids = markerIds(body);
      expect(ids).toContain(nebraskaAssetId);
      expect(ids).not.toContain(coloradoAssetId);
    });
  });

  describe('text filters treat ILIKE wildcards literally', () => {
    // The map's text filters go through searchAssetBuilder's ILIKE, which used to interpolate the
    // raw user value: `_` acted as a single-char wildcard and `%` matched everything — while the
    // timeline (time-bucket) path escaped both. `_` is in nearly every camera filename prefix
    // (IMG_, DSC_, PXL_), so the map showed more pins than the timeline had assets.
    let wildcardUser: LoginResponseDto;
    let underscoreAssetId: string;
    let dashAssetId: string;
    let percentAssetId: string;

    beforeAll(async () => {
      wildcardUser = await utils.userSetup(admin.accessToken, createUserDto.create('t23-wildcard-user'));

      // Random images so each filename gets its own asset row, geotagged so each can produce a pin.
      const createNamed = async (filename: string) => {
        const { id } = await utils.createAsset(wildcardUser.accessToken, {
          assetData: { bytes: makeRandomImage(), filename },
        });
        const { status } = await request(app)
          .put(`/assets/${id}`)
          .set(asBearerAuth(wildcardUser.accessToken))
          .send({ latitude: 48.85837, longitude: 2.29448 });
        expect(status).toBe(200);
        return id;
      };

      underscoreAssetId = await createNamed('IMG_0001.png');
      dashAssetId = await createNamed('IMG-0001.png');
      percentAssetId = await createNamed('battery-100%.png');
    });

    it('does not treat `_` in an originalFileName filter as a single-char wildcard', async () => {
      const { status, body } = await request(app)
        .get('/gallery/map/markers?originalFileName=IMG_0001')
        .set(asBearerAuth(wildcardUser.accessToken));

      expect(status).toBe(200);
      const ids = markerIds(body);
      expect(ids).toContain(underscoreAssetId);
      expect(ids).not.toContain(dashAssetId);
    });

    it('treats `%` in a filter value as a literal instead of matching everything', async () => {
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?originalFileName=${encodeURIComponent('%')}`)
        .set(asBearerAuth(wildcardUser.accessToken));

      expect(status).toBe(200);
      const ids = markerIds(body);
      expect(ids).toContain(percentAssetId);
      expect(ids).not.toContain(underscoreAssetId);
      expect(ids).not.toContain(dashAssetId);
    });
  });

  describe('ownerId (contributor) filter — RBAC', () => {
    // `ownerId` NARROWS within the caller's current scope; it must never WIDEN it. Both directions
    // are pinned here, because both are one-line mutations away in searchAssetBuilder
    // (server/src/utils/database.ts), the single builder behind this endpoint AND all four search
    // endpoints:
    //
    //   - Drop the AND (`.$if(false, …)`) ⇒ ?ownerId=<stranger> returns the caller's whole visible
    //     scope instead of []. The "returns []" tests below catch it.
    //   - Merge ownerId into the `userIds` SCOPING predicate (anyUuid([...userIds, ownerId])) ⇒ the
    //     stranger's OWN assets come back: a genuine cross-owner leak. `strangerAssetId` exists, is
    //     geotagged, and is sanity-pinned to produce a marker for its owner, precisely so the
    //     not.toContain assertions below are load-bearing rather than vacuously true.
    //
    // Space shape mirrors the two-owner medium fixture (test/medium/fixtures/two-owner-space.ts):
    // anna and ben BOTH contribute, and `spaceViewer` owns nothing — so "only anna's pins" cannot
    // be satisfied by the caller's own ownership scope, only by the filter under test.
    let anna: LoginResponseDto;
    let ben: LoginResponseDto;
    let spaceViewer: LoginResponseDto;
    let stranger: LoginResponseDto;
    let ownerSpaceId: string;
    let annaAssetId: string;
    let benAssetId: string;
    let strangerAssetId: string;

    beforeAll(async () => {
      [anna, ben, spaceViewer, stranger] = await Promise.all([
        utils.userSetup(admin.accessToken, createUserDto.create('t22-anna')),
        utils.userSetup(admin.accessToken, createUserDto.create('t22-ben')),
        utils.userSetup(admin.accessToken, createUserDto.create('t22-viewer')),
        utils.userSetup(admin.accessToken, createUserDto.create('t22-stranger')),
      ]);

      // Three DISTINCT geotagged fixtures. Uploads dedupe on (owner, checksum), so distinct owners
      // could reuse one file — but distinct files keep each asset id unambiguous in the assertions.
      const upload = async (actor: LoginResponseDto, input: string) => {
        const ws = await utils.connectWebsocket(actor.accessToken);
        const filepath = join(testAssetDir, input);
        const { id } = await utils.createAsset(actor.accessToken, {
          assetData: { bytes: await readFile(filepath), filename: basename(filepath) },
        });
        await utils.waitForWebsocketEvent({ event: 'assetUpload', id });
        utils.disconnectWebsocket(ws);
        return id;
      };

      annaAssetId = await upload(anna, 'metadata/gps-position/thompson-springs.jpg');
      benAssetId = await upload(ben, 'metadata/dates/datetimeoriginal-gps.jpg');
      strangerAssetId = await upload(stranger, 'metadata/dates/gps-datetime.jpg');

      const space = await utils.createSpace(anna.accessToken, { name: 't22 two-owner space' });
      ownerSpaceId = space.id;
      await utils.addSpaceMember(anna.accessToken, ownerSpaceId, {
        userId: ben.userId,
        role: SharedSpaceRole.Editor,
      });
      await utils.addSpaceMember(anna.accessToken, ownerSpaceId, {
        userId: spaceViewer.userId,
        role: SharedSpaceRole.Viewer,
      });

      // Each contributor adds their OWN asset — the space genuinely has two owners in it.
      await utils.addSpaceAssets(anna.accessToken, ownerSpaceId, [annaAssetId]);
      await utils.addSpaceAssets(ben.accessToken, ownerSpaceId, [benAssetId]);
    });

    it('sanity: the stranger asset DOES produce a marker for its own owner', async () => {
      // Without this, every `not.toContain(strangerAssetId)` below could pass forever for the wrong
      // reason (e.g. the fixture silently lost its GPS EXIF and never produces a marker at all).
      const { status, body } = await request(app).get('/gallery/map/markers').set(asBearerAuth(stranger.accessToken));
      expect(status).toBe(200);
      expect(markerIds(body)).toContain(strangerAssetId);
    });

    it('baseline: a space viewer who owns nothing sees BOTH contributors pins', async () => {
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?spaceId=${ownerSpaceId}`)
        .set(asBearerAuth(spaceViewer.accessToken));

      expect(status).toBe(200);
      expect(markerIds(body)).toEqual(expect.arrayContaining([annaAssetId, benAssetId]));
    });

    it('ownerId narrows a space query to one contributor', async () => {
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?spaceId=${ownerSpaceId}&ownerId=${anna.userId}`)
        .set(asBearerAuth(spaceViewer.accessToken));

      expect(status).toBe(200);
      const ids = markerIds(body);
      expect(ids).toContain(annaAssetId);
      expect(ids).not.toContain(benAssetId);
    });

    it('ownerId of a NON-MEMBER inside a space returns [] (narrows, never widens)', async () => {
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?spaceId=${ownerSpaceId}&ownerId=${stranger.userId}`)
        .set(asBearerAuth(spaceViewer.accessToken));

      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    it('ownerId of a stranger on the PERSONAL map returns [] (the leak direction)', async () => {
      // Anna's unfiltered map is non-empty — so [] below is the filter doing its job, not an
      // unrelatedly broken query.
      const unfiltered = await request(app).get('/gallery/map/markers').set(asBearerAuth(anna.accessToken));
      expect(unfiltered.status).toBe(200);
      expect(markerIds(unfiltered.body)).toContain(annaAssetId);

      // No space, no album ⇒ userIds is the scoping predicate ([anna]). If ownerId were merged into
      // it, the stranger's pin would come back here. It must not.
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?ownerId=${stranger.userId}`)
        .set(asBearerAuth(anna.accessToken));

      expect(status).toBe(200);
      expect(body).toEqual([]);
      expect(markerIds(body)).not.toContain(strangerAssetId);
    });

    it('ownerId of a stranger under withSharedSpaces returns [] (the second leak vector)', async () => {
      // withSharedSpaces swaps the personal userIds AND for a different OR-group, so this vector
      // needs its own pin — a merge into THAT group would survive every test above.
      const unfiltered = await request(app)
        .get('/gallery/map/markers?withSharedSpaces=true')
        .set(asBearerAuth(spaceViewer.accessToken));
      expect(unfiltered.status).toBe(200);
      expect(markerIds(unfiltered.body)).toEqual(expect.arrayContaining([annaAssetId, benAssetId]));
      expect(markerIds(unfiltered.body)).not.toContain(strangerAssetId);

      const { status, body } = await request(app)
        .get(`/gallery/map/markers?withSharedSpaces=true&ownerId=${stranger.userId}`)
        .set(asBearerAuth(spaceViewer.accessToken));

      expect(status).toBe(200);
      expect(body).toEqual([]);
      expect(markerIds(body)).not.toContain(strangerAssetId);
    });

    it('ownerId under withSharedSpaces narrows to that member, not to everything', async () => {
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?withSharedSpaces=true&ownerId=${anna.userId}`)
        .set(asBearerAuth(spaceViewer.accessToken));

      expect(status).toBe(200);
      const ids = markerIds(body);
      expect(ids).toContain(annaAssetId);
      expect(ids).not.toContain(benAssetId);
    });
  });

  // D1: multiple people (and multiple tags) must AND, exactly like every timeline path
  // (searchAssetBuilder's hasAllPeople/hasTags branch, database.ts:721,724). The map was the ONLY
  // caller in the server that set personMatchAny/tagMatchAny, so filtering /photos by Alice AND Bob
  // and then clicking the map icon — which carries those very chips as ?people=alice,bob — showed
  // every asset with EITHER: identical chips, roughly double the pins, and a cluster panel (which
  // ANDs) contradicting its own pin count.
  describe('multiple people / tags AND, they do not OR (D1)', () => {
    let andUser: LoginResponseDto;
    let assetWithBoth: string;
    let assetWithAliceOnly: string;
    let alice: { id: string };
    let bob: { id: string };
    let tagBeach: { id: string };
    let tagSunset: { id: string };

    beforeAll(async () => {
      andUser = await utils.userSetup(admin.accessToken, createUserDto.create('t23-and'));
      const ws = await utils.connectWebsocket(andUser.accessToken);

      const upload = async (input: string) => {
        const filepath = join(testAssetDir, input);
        const { id } = await utils.createAsset(andUser.accessToken, {
          assetData: { bytes: await readFile(filepath), filename: basename(filepath) },
        });
        await utils.waitForWebsocketEvent({ event: 'assetUpload', id });
        return id;
      };

      // Two DISTINCT geotagged fixtures: uploads dedupe on (owner, checksum), so the same file
      // twice would collapse into one asset and the AND assertion would be vacuous.
      assetWithBoth = await upload('metadata/gps-position/thompson-springs.jpg');
      assetWithAliceOnly = await upload('metadata/dates/datetimeoriginal-gps.jpg');
      utils.disconnectWebsocket(ws);

      alice = await utils.createPerson(andUser.accessToken, { name: 't23 Alice' });
      bob = await utils.createPerson(andUser.accessToken, { name: 't23 Bob' });

      await utils.createFace({ assetId: assetWithBoth, personGroupId: alice.id });
      await utils.createFace({ assetId: assetWithBoth, personGroupId: bob.id });
      await utils.createFace({ assetId: assetWithAliceOnly, personGroupId: alice.id });

      const tags = await utils.upsertTags(andUser.accessToken, ['t23-beach', 't23-sunset']);
      tagBeach = tags.find((tag) => tag.value === 't23-beach')!;
      tagSunset = tags.find((tag) => tag.value === 't23-sunset')!;
      await utils.tagAssets(andUser.accessToken, tagBeach.id, [assetWithBoth, assetWithAliceOnly]);
      await utils.tagAssets(andUser.accessToken, tagSunset.id, [assetWithBoth]);
    });

    it('sanity: each asset is a marker, and a single person matches both of them', async () => {
      // Without this, the AND assertions below could pass for the wrong reason (a fixture that
      // silently lost its GPS EXIF, or a face row that never landed, produces no marker at all).
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?personIds=${alice.id}`)
        .set(asBearerAuth(andUser.accessToken));

      expect(status).toBe(200);
      expect(markerIds(body).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [assetWithBoth, assetWithAliceOnly].toSorted((a, b) => a.localeCompare(b)),
      );
    });

    it('two people return ONLY the asset that has BOTH (not the union)', async () => {
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?personIds=${alice.id}&personIds=${bob.id}`)
        .set(asBearerAuth(andUser.accessToken));

      expect(status).toBe(200);
      expect(markerIds(body)).toEqual([assetWithBoth]);
    });

    it('two tags return ONLY the asset that has BOTH (not the union)', async () => {
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?tagIds=${tagBeach.id}&tagIds=${tagSunset.id}`)
        .set(asBearerAuth(andUser.accessToken));

      expect(status).toBe(200);
      expect(markerIds(body)).toEqual([assetWithBoth]);
    });

    it('sanity: a single tag still matches every asset carrying it', async () => {
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?tagIds=${tagBeach.id}`)
        .set(asBearerAuth(andUser.accessToken));

      expect(status).toBe(200);
      expect(markerIds(body).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [assetWithBoth, assetWithAliceOnly].toSorted((a, b) => a.localeCompare(b)),
      );
    });
  });

  // Regression (Task 11): `?withSharedSpaces=true&isFavorite=true&personIds=space-person:<id>`
  // returned a silently EMPTY map to a legitimate space member. needsTimelineSpaceIds excluded
  // isFavorite === true, so timelineSpaceIds was undefined — and its SECOND consumer, the scoped
  // person-token resolver (face-identity.repository.ts spaceMatchesScope), requires
  // timelineSpaceIds.size > 0 under withSharedSpaces, so the token read as inaccessible ->
  // forceEmptyResult -> zero pins. Same bug as 00a7fd6bac, on the other arm of the condition.
  // /photos makes the person chip and the favourite chip one-click co-reachable, and its map icon
  // carries both.
  describe('favorites + a shared-space person token (silent-empty map regression)', () => {
    let favUser: LoginResponseDto;
    let favSpaceId: string;
    let favAssetId: string;
    let unfavAssetId: string;
    let spacePersonId: string;

    beforeAll(async () => {
      favUser = await utils.userSetup(admin.accessToken, createUserDto.create('t24-fav'));
      const ws = await utils.connectWebsocket(favUser.accessToken);

      const upload = async (input: string) => {
        const filepath = join(testAssetDir, input);
        const { id } = await utils.createAsset(favUser.accessToken, {
          assetData: { bytes: await readFile(filepath), filename: basename(filepath) },
        });
        await utils.waitForWebsocketEvent({ event: 'assetUpload', id });
        return id;
      };

      favAssetId = await upload('metadata/gps-position/thompson-springs.jpg');
      unfavAssetId = await upload('metadata/dates/gps-datetime.jpg');
      utils.disconnectWebsocket(ws);

      const space = await utils.createSpace(favUser.accessToken, { name: 't24 space' });
      favSpaceId = space.id;
      await utils.addSpaceAssets(favUser.accessToken, favSpaceId, [favAssetId, unfavAssetId]);

      const created = await utils.createSpacePerson(favSpaceId, 't24 Ada', favUser.userId, favAssetId);
      spacePersonId = created.spacePersonId;

      await request(app).put(`/assets/${favAssetId}`).set(asBearerAuth(favUser.accessToken)).send({ isFavorite: true });
    });

    it('sanity: the space person token alone resolves and returns its asset', async () => {
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?withSharedSpaces=true&personIds=space-person:${spacePersonId}`)
        .set(asBearerAuth(favUser.accessToken));

      expect(status).toBe(200);
      expect(markerIds(body)).toEqual([favAssetId]);
    });

    it('sanity: the favorite filter narrows on its own (the unfavorited space asset drops out)', async () => {
      // Pins the other half of the combination, so the test below cannot pass for the wrong reason:
      // both assets are in the space and both are markers, but only one is favorited.
      const all = await request(app)
        .get('/gallery/map/markers?withSharedSpaces=true')
        .set(asBearerAuth(favUser.accessToken));
      expect(markerIds(all.body).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [favAssetId, unfavAssetId].toSorted((a, b) => a.localeCompare(b)),
      );

      const { status, body } = await request(app)
        .get('/gallery/map/markers?withSharedSpaces=true&isFavorite=true')
        .set(asBearerAuth(favUser.accessToken));

      expect(status).toBe(200);
      expect(markerIds(body)).toEqual([favAssetId]);
    });

    it('favorites + a space person token returns the favorited asset, not an empty map', async () => {
      const { status, body } = await request(app)
        .get(`/gallery/map/markers?withSharedSpaces=true&isFavorite=true&personIds=space-person:${spacePersonId}`)
        .set(asBearerAuth(favUser.accessToken));

      expect(status).toBe(200);
      expect(markerIds(body)).toEqual([favAssetId]);
    });
  });
});
