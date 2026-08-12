import {
  addAssetsToAlbum,
  AlbumUserRole,
  getAssetInfo,
  getFilteredMapMarkers,
  SharedSpaceRole,
  updateAsset,
  updateAssets,
  type LoginResponseDto,
} from '@immich/sdk';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { asBearerAuth, testAssetDir, utils } from 'src/utils';

/**
 * The two camera fixtures every scenario below is built on. They are picked so that no assertion can
 * pass vacuously:
 *
 * - `prairie_falcon.jpg` — a full Canon EXIF block (make `Canon`, model `Canon EOS R5`) and **no GPS**.
 * - `IMG_2682.heic`      — Apple / iPhone 7 EXIF **and** GPS.
 *
 * Two DISTINCT makes means a camera filter has something to exclude, and a map filtered by one make
 * has a second marker it must drop. A single-fixture test would pass even if the filter did nothing.
 */
const CANON_FIXTURE = 'albums/nature/prairie_falcon.jpg';
const APPLE_FIXTURE = 'formats/heic/IMG_2682.heic';

/**
 * A second real, GPS-tagged Canon photo — Palisade, Colorado, USA, lens `Canon EF 24-105mm f/4L IS
 * II USM`, taken in 2022. Used by the value-affordance suites below alongside `APPLE_FIXTURE`
 * (Ralston, Nebraska, USA, iPhone 7, 2019). Every filterable dimension EXCEPT country differs
 * between the two, so each location/date/filename/lens filter has a genuine non-matching asset to
 * exclude. City/state/lens/date are read back from the SERVER in the suites, never hard-coded.
 */
const THOMPSON_FIXTURE = 'metadata/gps-position/thompson-springs.jpg';

const upload = (accessToken: string, path: string) =>
  utils.createAsset(accessToken, {
    assetData: { bytes: readFileSync(`${testAssetDir}/${path}`), filename: basename(path) },
  });

/**
 * `prairie_falcon.jpg` carries no GPS EXIF, so it has to be put on the map explicitly. The bulk
 * update reverse-geocodes the point server-side, which is what fills in city/state/country — and the
 * asset viewer's location row (and therefore its 🗺️ pin) only renders once `country` is set.
 *
 * Must run AFTER metadata extraction has drained, or the extraction job overwrites it back to null.
 */
const setAssetGeo = (accessToken: string, id: string, latitude: number, longitude: number) =>
  updateAssets({ assetBulkUpdateDto: { ids: [id], latitude, longitude } }, { headers: asBearerAuth(accessToken) });

/** The camera as the DetailPanel labels it — read back from the SERVER, not hard-coded. */
const readCamera = async (accessToken: string, id: string) => {
  const info = await getAssetInfo({ id }, { headers: asBearerAuth(accessToken) });
  const make = info.exifInfo?.make ?? '';
  const model = info.exifInfo?.model ?? '';
  expect(make, 'the fixture must carry camera EXIF, or every camera assertion here is vacuous').not.toBe('');
  return { make, model, label: [make, model].filter(Boolean).join(' ') };
};

/**
 * `commit`, not the default `load`: the asset viewer downloads the FULL-SIZE original, and waiting
 * for the page's load event therefore waits for that image. Nothing here needs the pixels — the
 * detail panel is driven by the asset's JSON — and the two waits below are the real barrier.
 */
const openDetailPanel = async (page: Page, path: string) => {
  await page.goto(path, { waitUntil: 'commit' });
  await page.waitForSelector('#immich-asset-viewer');
  await page.getByRole('button', { name: 'Info' }).click();
  await expect(page.locator('#detail-panel')).toBeVisible();
};

/**
 * The map's markers, straight from the API — deliberately NOT through `page.request`, which shares
 * the browser context's cookie jar and turned this pure data-setup call into a flake.
 */
const markerIds = async (accessToken: string, params: Parameters<typeof getFilteredMapMarkers>[0]) => {
  const markers = await getFilteredMapMarkers(params, { headers: asBearerAuth(accessToken) });
  return markers.map((marker) => marker.id);
};

/**
 * `/map` mounts MapLibre, which pulls its style and tiles from an EXTERNAL host. Waiting for the
 * page's `load` event (waitForURL's default) therefore waits on a third party and times out under
 * load. Nothing asserted here needs a rendered tile: the URL, the marker query and the chip bar all
 * come from the app itself, so commit is the right barrier.
 */
const waitForMapUrl = (page: Page) => page.waitForURL((url) => url.pathname === '/map', { waitUntil: 'commit' });

/**
 * Slice 7's headline scenario, end to end (spec §5.4/§6, plan R8, P1).
 *
 * Inside a Space, clicking a metadata value in the asset viewer filters THAT SPACE — the viewer
 * closes, the URL carries the filter, and a removable chip appears. The 🔍 icon is the escape hatch:
 * the same filter, but across the whole library.
 *
 * The person case is the one that cannot be caught by inspecting the URL alone (R8): a Space sends
 * `FilterState.personIds` as **`spacePersonIds`**, which the server validates as `z.array(z.uuidv4())`
 * — a BARE uuid. A `space-person:<uuid>` token there is a zod reject → **400** → the whole Space
 * timeline errors out. So this file drives a real Space, with a real space person, against the real
 * server, and asserts the timeline request comes back 200 with the asset still in it.
 *
 * The viewer is a SPACE MEMBER, not the owner: a member is the only viewer for whom the asset's
 * people are resolved to the space's people (`asset.people[].spacePersonId`), which is exactly the
 * shape the person patch depends on.
 */
test.describe('Asset viewer contextual filters', () => {
  let admin: LoginResponseDto;
  let member: LoginResponseDto;
  let spaceId: string;
  let assetId: string;
  let spacePersonId: string;
  let make: string;
  let model: string;
  let cameraLabel: string;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    await utils.connectDatabase();

    admin = await utils.adminSetup();
    member = await utils.userSetup(admin.accessToken, {
      email: 'space-member@test.com',
      name: 'Space Member',
      password: 'password',
    });

    const space = await utils.createSpace(admin.accessToken, { name: 'Iceland' });
    spaceId = space.id;
    await utils.addSpaceMember(admin.accessToken, spaceId, {
      userId: member.userId,
      role: SharedSpaceRole.Editor,
    });

    // A real photo with real camera EXIF (prairie_falcon.jpg carries a full Canon block), plus a
    // second, EXIF-less asset so the camera/person filters actually NARROW the space (2 → 1) rather
    // than trivially matching everything in it.
    const asset = await utils.createAsset(admin.accessToken, {
      assetData: {
        bytes: readFileSync(`${testAssetDir}/albums/nature/prairie_falcon.jpg`),
        filename: 'prairie_falcon.jpg',
      },
    });
    assetId = asset.id;
    const other = await utils.createAsset(admin.accessToken);
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
    await utils.addSpaceAssets(admin.accessToken, spaceId, [assetId, other.id]);

    const info = await getAssetInfo({ id: assetId }, { headers: asBearerAuth(admin.accessToken) });
    make = info.exifInfo?.make ?? '';
    model = info.exifInfo?.model ?? '';
    expect(make, 'the fixture must have camera EXIF for this suite to mean anything').not.toBe('');
    cameraLabel = [make, model].filter(Boolean).join(' ');

    const person = await utils.createSpacePerson(spaceId, 'Alice', admin.userId, assetId);
    spacePersonId = person.spacePersonId;
  });

  const openDetailPanelInSpace = async (page: Page) => {
    await page.goto(`/spaces/${spaceId}/photos/${assetId}`);
    await page.waitForSelector('#immich-asset-viewer');
    await page.getByRole('button', { name: 'Info' }).click();
    await expect(page.locator('#detail-panel')).toBeVisible();
  };

  test('clicking the camera filters the Space, closes the viewer, and leaves a removable chip', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, member.accessToken);
    await openDetailPanelInSpace(page);

    const buckets = page.waitForResponse((response) => response.url().includes('/timeline/buckets'));
    await page.getByLabel(`Filter by this camera: ${cameraLabel}`).click();
    const bucketResponse = await buckets;
    expect(bucketResponse.status()).toBe(200);

    // One goto() both applies the filter and closes the asset viewer.
    await page.waitForURL((url) => url.pathname === `/spaces/${spaceId}`);
    const url = new URL(page.url());
    expect(url.searchParams.get('make')).toBe(make);
    expect(url.searchParams.get('model')).toBe(model);
    expect(page.url()).not.toContain(assetId);
    await expect(page.locator('#immich-asset-viewer')).toHaveCount(0);

    // P1, end to end: the photo the camera was clicked on is still in the filtered Space.
    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');

    const chip = page.locator('[data-testid="active-chip"]').filter({ hasText: cameraLabel });
    await expect(chip).toBeVisible();

    await chip.locator('[data-testid="chip-close"]').click();
    await page.waitForURL((url) => !url.searchParams.has('make'));
    await expect(chip).toHaveCount(0);
  });

  // E5 — the escape hatch: the same filter, but across the whole library, carrying no Space with it.
  test('the search-everywhere icon escapes to /photos instead of filtering the Space', async ({ context, page }) => {
    await utils.setAuthCookies(context, member.accessToken);
    await openDetailPanelInSpace(page);

    await page.getByLabel(`Search everywhere: ${cameraLabel}`).click();

    await page.waitForURL((url) => url.pathname === '/photos');
    const url = new URL(page.url());
    expect(url.searchParams.get('make')).toBe(make);
    expect(page.url()).not.toContain('/spaces');
    expect(page.url()).not.toContain(assetId);
  });

  /**
   * R8 — the one that would 400. Following the spec's original "always send the scoped token" rule
   * here sends `people=space-person:<uuid>` to a Space, which the space timeline forwards as
   * `spacePersonIds` → zod rejects → 400 → the whole timeline errors out. The shipped rule is
   * target-dependent: a Space gets the BARE space-person uuid.
   */
  test('a person inside a Space filters by the bare space-person id, and the timeline does not error', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, member.accessToken);

    const timelineFailures: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/timeline/') && response.status() >= 400) {
        timelineFailures.push(`${response.status()} ${response.url()}`);
      }
    });

    await openDetailPanelInSpace(page);
    await page.getByLabel('Filter by this person: Alice').click();

    await page.waitForURL((url) => url.pathname === `/spaces/${spaceId}`);
    const people = new URL(page.url()).searchParams.get('people');

    expect(people).toBe(spacePersonId);
    expect(people).not.toContain('space-person:');
    await expect(page.locator('#immich-asset-viewer')).toHaveCount(0);

    // The timeline answered (no 400), and P1 holds: the asset the person was clicked on is in it.
    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');
    await expect(page.locator('[data-testid="active-filters-bar"]')).toBeVisible();
    expect(timelineFailures, 'the Space timeline must not error').toEqual([]);
  });
});

/**
 * S1 — the same grammar on the two surfaces the Space suite above does not cover: an ALBUM and
 * `/photos`. The filter has to land on the surface you are standing on, not on the library by
 * default, and the escape hatch has to disappear where it would be a no-op.
 *
 * E5: on `/photos` there is no 🔍. `/photos` IS everywhere — a "search everywhere" button next to a
 * filter that already searches everywhere would navigate to the page it is already on.
 */
test.describe('Asset viewer contextual filters on an album and /photos', () => {
  let admin: LoginResponseDto;
  let albumId: string;
  let canonId: string;
  let plainId: string;
  let camera: { make: string; model: string; label: string };

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    const canon = await upload(admin.accessToken, CANON_FIXTURE);
    canonId = canon.id;
    // A second asset with NO camera EXIF at all, so the camera filter has something to exclude on
    // both surfaces (2 → 1) instead of trivially matching everything.
    const plain = await utils.createAsset(admin.accessToken);
    plainId = plain.id;
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
    // Drain the previews too — but NOT via waitForQueueFinish('thumbnailGeneration'): that queue reads
    // "empty" in the window BEFORE the thumbnail job is enqueued (upload → metadataExtraction →
    // storage-template → only THEN thumbnailGeneration), so the wait can return before any thumbnail
    // exists and a grid tile / viewer then stalls on a still-queued preview. Poll the real
    // post-condition instead, exactly like shared-space.e2e-spec.ts's recentAssetIds thumbhash poll.
    for (const id of [canonId, plainId]) {
      await utils.poll(
        () => utils.getAssetInfo(admin.accessToken, id),
        (asset) => asset.thumbhash !== null,
      );
    }

    const album = await utils.createAlbum(admin.accessToken, {
      albumName: 'Nature',
      assetIds: [canonId, plainId],
    });
    albumId = album.id;
    camera = await readCamera(admin.accessToken, canonId);
  });

  test('clicking the camera filters the ALBUM, closes the viewer, and leaves a removable chip', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, admin.accessToken);

    // Unfiltered, the album shows BOTH assets. Without this, the exclusion below could pass because
    // the grid never rendered the second asset at all.
    await page.goto(`/albums/${albumId}`);
    await expect(page.locator(`[data-asset-id="${canonId}"]`)).toBeVisible();
    await expect(page.locator(`[data-asset-id="${plainId}"]`)).toBeVisible();

    await openDetailPanel(page, `/albums/${albumId}/photos/${canonId}`);
    await page.getByLabel(`Filter by this camera: ${camera.label}`).click();

    // One goto() both applies the filter and closes the asset viewer — and it stays on the ALBUM.
    await page.waitForURL((url) => url.pathname === `/albums/${albumId}`);
    const url = new URL(page.url());
    expect(url.searchParams.get('make')).toBe(camera.make);
    expect(url.searchParams.get('model')).toBe(camera.model);
    expect(page.url()).not.toContain(canonId);
    await expect(page.locator('#immich-asset-viewer')).toHaveCount(0);

    // The album grid actually narrowed.
    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');
    await expect(page.locator(`[data-asset-id="${canonId}"]`)).toBeVisible();
    await expect(page.locator(`[data-asset-id="${plainId}"]`)).toHaveCount(0);

    const chip = page.locator('[data-testid="active-chip"]').filter({ hasText: camera.label });
    await expect(chip).toBeVisible();

    await chip.locator('[data-testid="chip-close"]').click();
    await page.waitForURL((url) => !url.searchParams.has('make'));
    await expect(chip).toHaveCount(0);
    await expect(page.locator(`[data-asset-id="${plainId}"]`)).toBeVisible();
  });

  test('clicking the camera on /photos filters the library, and offers NO search-everywhere icon (E5)', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await openDetailPanel(page, `/photos/${canonId}`);

    // E5 — the value is still a filter affordance here, but the escape hatch is gone.
    await expect(page.getByLabel(`Filter by this camera: ${camera.label}`)).toBeVisible();
    await expect(page.getByLabel(`Search everywhere: ${camera.label}`)).toHaveCount(0);

    await page.getByLabel(`Filter by this camera: ${camera.label}`).click();

    await page.waitForURL((url) => url.pathname === '/photos');
    const url = new URL(page.url());
    expect(url.searchParams.get('make')).toBe(camera.make);
    expect(url.searchParams.get('model')).toBe(camera.model);
    expect(page.url()).not.toContain(canonId);
    await expect(page.locator('#immich-asset-viewer')).toHaveCount(0);

    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');
    await expect(page.locator(`[data-asset-id="${canonId}"]`)).toBeVisible();
    await expect(page.locator(`[data-asset-id="${plainId}"]`)).toHaveCount(0);

    const chip = page.locator('[data-testid="active-chip"]').filter({ hasText: camera.label });
    await expect(chip).toBeVisible();
  });
});

/**
 * S2 (E10) and S3 (#767) — the map, the one affordance that changes surface.
 *
 * S3 is the ORIGINAL bug report and the reason slices 3–5 exist: a Space filtered to a camera used to
 * hand the map nothing but its `spaceId`, so the map cheerfully showed every pin in the space while
 * the chip claimed a filter was active. Asserting the URL alone would NOT catch that — the fix lives
 * in what the map then DOES with the filter — so the space here holds two geotagged assets with
 * DIFFERENT makes and the test asserts the non-matching marker is gone.
 */
test.describe('Asset viewer contextual filters — the map handoff', () => {
  let admin: LoginResponseDto;
  let spaceId: string;
  let canonId: string;
  let appleId: string;
  let camera: { make: string; model: string; label: string };

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    const canon = await upload(admin.accessToken, CANON_FIXTURE);
    canonId = canon.id;
    const apple = await upload(admin.accessToken, APPLE_FIXTURE);
    appleId = apple.id;
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
    // Drain the previews too — but NOT via waitForQueueFinish('thumbnailGeneration'): that queue reads
    // "empty" in the window BEFORE the thumbnail job is enqueued (upload → metadataExtraction →
    // storage-template → only THEN thumbnailGeneration), so the wait can return before any thumbnail
    // exists and a grid tile / viewer then stalls on a still-queued preview. Poll the real
    // post-condition instead, exactly like shared-space.e2e-spec.ts's recentAssetIds thumbhash poll.
    for (const id of [canonId, appleId]) {
      await utils.poll(
        () => utils.getAssetInfo(admin.accessToken, id),
        (asset) => asset.thumbhash !== null,
      );
    }

    // The Apple fixture is geotagged in EXIF; the Canon one is not, so give it a point of its own.
    // Both are on the map — with different cameras.
    await setAssetGeo(admin.accessToken, canonId, 48.8566, 2.3522);

    const space = await utils.createSpace(admin.accessToken, { name: 'Roadtrip' });
    spaceId = space.id;
    await utils.addSpaceAssets(admin.accessToken, spaceId, [canonId, appleId]);

    camera = await readCamera(admin.accessToken, canonId);
  });

  // E10 — the pin is a change of surface, so it must carry the Space with it or it silently widens
  // "this space" to "the whole library".
  test('the location pin opens the map carrying the Space (E10)', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await openDetailPanel(page, `/spaces/${spaceId}/photos/${canonId}`);

    // The row only renders once reverse geocoding has filled in a country — assert it did, or the
    // pin below would be missing for the wrong reason.
    await expect(page.locator('[data-testid="detail-panel-location"]')).toBeVisible();
    await page.getByLabel('View in map').click();

    await waitForMapUrl(page);
    expect(new URL(page.url()).searchParams.get('spaceId')).toBe(spaceId);
  });

  test('#767: a Space filtered to a camera carries that filter to the map, and the map NARROWS', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, admin.accessToken);

    // Sanity — unfiltered, the Space's map has BOTH markers. Without it, every exclusion below could
    // pass because a fixture silently lost its GPS.
    const unfiltered = await markerIds(admin.accessToken, { spaceId });
    expect(unfiltered.toSorted((a, b) => a.localeCompare(b))).toEqual(
      [canonId, appleId].toSorted((a, b) => a.localeCompare(b)),
    );

    // #767's exact repro, step 1: filter the Space to the Canon, from the asset viewer.
    await openDetailPanel(page, `/spaces/${spaceId}/photos/${canonId}`);
    await page.getByLabel(`Filter by this camera: ${camera.label}`).click();
    await page.waitForURL(
      (url) => url.pathname === `/spaces/${spaceId}` && url.searchParams.get('make') === camera.make,
    );
    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');

    // Step 2: click the Space's Map tab (space-tabs.svelte). Scoped by test id, not by accessible
    // name: the sidebar has a `/map` link that reads the same, and only the Space's carries a
    // spaceId.
    const markers = page.waitForResponse(
      (response) =>
        response.url().includes('/gallery/map/markers') &&
        response.url().includes(`make=${encodeURIComponent(camera.make)}`) &&
        response.status() === 200,
    );
    const mapTab = page.getByTestId('space-tab-map');
    await expect(mapTab).toHaveAttribute('href', new RegExp(`spaceId=${spaceId}`));
    await mapTab.click();

    await waitForMapUrl(page);
    const url = new URL(page.url());
    expect(url.searchParams.get('spaceId')).toBe(spaceId);
    expect(url.searchParams.get('make')).toBe(camera.make);
    expect(url.searchParams.get('model')).toBe(camera.model);

    // The URL is the easy half. This is the half that was broken: the map's own marker query.
    const markerResponse = await markers;
    const ids = ((await markerResponse.json()) as Array<{ id: string }>).map((marker) => marker.id);
    expect(ids).toContain(canonId);
    expect(ids, 'the map must drop the marker of the asset shot on the other camera').not.toContain(appleId);
    expect(ids, 'the map narrowed 2 markers → 1').toHaveLength(1);

    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');
    await expect(page.locator('[data-testid="active-chip"]').filter({ hasText: camera.label })).toBeVisible();
  });
});

/**
 * S4 (E17) — the RBAC scenario the spec says must not be dropped for time: the end-to-end proof of
 * §4.4, that a NON-OWNER can filter by metadata of an asset they do not own and get that owner's
 * assets back.
 *
 * Every layer beneath this is already covered (the DTOs, the repository's RBAC projection, the
 * timeline service); this is the one that proves they compose in a browser. B owns NOTHING: every
 * asset in the space is A's, so a filter that quietly fell back to "my own assets" would return an
 * empty timeline, and one that ignored the filter would return both of A's assets. The negative
 * control (a second asset of A's, different camera) is what separates those two failures from a pass.
 */
test.describe('Asset viewer contextual filters — a Space VIEWER filters another member’s asset (E17)', () => {
  let admin: LoginResponseDto;
  let viewer: LoginResponseDto;
  let spaceId: string;
  let canonId: string;
  let appleId: string;
  let camera: { make: string; model: string; label: string };
  let city: string;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // B — a Viewer of the space who owns nothing in it.
    viewer = await utils.userSetup(admin.accessToken, {
      email: 'space-viewer@test.com',
      name: 'Space Viewer',
      password: 'password',
    });

    // A's two assets: same owner, DIFFERENT cameras.
    const canon = await upload(admin.accessToken, CANON_FIXTURE);
    canonId = canon.id;
    const apple = await upload(admin.accessToken, APPLE_FIXTURE);
    appleId = apple.id;
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
    // Drain the previews too — but NOT via waitForQueueFinish('thumbnailGeneration'): that queue reads
    // "empty" in the window BEFORE the thumbnail job is enqueued (upload → metadataExtraction →
    // storage-template → only THEN thumbnailGeneration), so the wait can return before any thumbnail
    // exists and a grid tile / viewer then stalls on a still-queued preview. Poll the real
    // post-condition instead, exactly like shared-space.e2e-spec.ts's recentAssetIds thumbhash poll.
    for (const id of [canonId, appleId]) {
      await utils.poll(
        () => utils.getAssetInfo(admin.accessToken, id),
        (asset) => asset.thumbhash !== null,
      );
    }

    // A location on A's asset, so the row renders for B — and so the missing pencil below is a real
    // absence rather than a row that was never drawn.
    await setAssetGeo(admin.accessToken, canonId, 48.8566, 2.3522);

    const space = await utils.createSpace(admin.accessToken, { name: 'Two Owners' });
    spaceId = space.id;
    await utils.addSpaceMember(admin.accessToken, spaceId, {
      userId: viewer.userId,
      role: SharedSpaceRole.Viewer,
    });
    await utils.addSpaceAssets(admin.accessToken, spaceId, [canonId, appleId]);

    camera = await readCamera(admin.accessToken, canonId);
    // Read the reverse-geocoded city back rather than hard-coding it: the label under test is
    // whatever the server geocoded, and a wrong guess here would fail for the wrong reason.
    const info = await getAssetInfo({ id: canonId }, { headers: asBearerAuth(admin.accessToken) });
    city = info.exifInfo?.city ?? '';
    expect(city, 'reverse geocoding must have produced a city, or the location row never renders').not.toBe('');
  });

  test('a Viewer filters the Space by a camera they do not own, and gets the owner’s matching asset', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, viewer.accessToken);

    // Unfiltered, B sees BOTH of A's assets. This is the control for the exclusion further down.
    await page.goto(`/spaces/${spaceId}`);
    await expect(page.locator(`[data-asset-id="${canonId}"]`)).toBeVisible();
    await expect(page.locator(`[data-asset-id="${appleId}"]`)).toBeVisible();

    await openDetailPanel(page, `/spaces/${spaceId}/photos/${canonId}`);
    await page.getByLabel(`Filter by this camera: ${camera.label}`).click();

    await page.waitForURL((url) => url.pathname === `/spaces/${spaceId}`);
    const url = new URL(page.url());
    expect(url.searchParams.get('make')).toBe(camera.make);
    expect(url.searchParams.get('model')).toBe(camera.model);
    await expect(page.locator('#immich-asset-viewer')).toHaveCount(0);

    // §4.4, end to end: the timeline is filtered, and the asset B does not own is still in it.
    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');
    await expect(page.locator(`[data-asset-id="${canonId}"]`)).toBeVisible();
    await expect(
      page.locator(`[data-asset-id="${appleId}"]`),
      'the other camera’s asset must be excluded, or "filtered" is unproven',
    ).toHaveCount(0);
  });

  test('the values stay clickable for a Viewer, but editing them stays owner-gated', async ({ context, page }) => {
    await utils.setAuthCookies(context, viewer.accessToken);
    await openDetailPanel(page, `/spaces/${spaceId}/photos/${canonId}`);

    // The rows are there, and their values are filter affordances for a non-owner…
    await expect(page.locator('[data-testid="detail-panel-location"]')).toBeVisible();
    await expect(page.getByLabel(`Filter by this location: ${city}`)).toBeVisible();
    await expect(page.getByLabel(/^Filter by this date/)).toBeVisible();

    // …while the owner-only affordances on those same rows are absent.
    await expect(page.getByLabel('Edit location')).toHaveCount(0);
    await expect(page.locator('[data-testid="detail-panel-edit-date-button"]')).toHaveCount(0);
  });
});

/**
 * The value affordances the camera/person suites above do not touch — location (city + the
 * sibling-staleness path), date, filename, lens, tag — plus the two rows that are edited in place
 * rather than filtered (rating, description). One `/photos` surface, two real fixtures that differ on
 * every dimension but country, so each filter has a genuine non-matching asset to exclude. Every
 * value under test is read back from the SERVER (never hard-coded) and pinned as distinct, so no
 * assertion can pass vacuously.
 */
test.describe('Asset viewer contextual filters — value affordances on /photos', () => {
  let admin: LoginResponseDto;
  let thompsonId: string;
  let imgId: string;
  let thompsonCity: string;
  let imgState: string;
  let thompsonLens: string;
  let tagValue: string;
  let tagId: string;
  const RATING = 4;
  const DESCRIPTION = 'A quiet mountain sunset';
  const THOMPSON_BASENAME = 'thompson-springs';

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    const thompson = await upload(admin.accessToken, THOMPSON_FIXTURE);
    thompsonId = thompson.id;
    const apple = await upload(admin.accessToken, APPLE_FIXTURE);
    imgId = apple.id;
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
    for (const id of [thompsonId, imgId]) {
      await utils.poll(
        () => utils.getAssetInfo(admin.accessToken, id),
        (asset) => asset.thumbhash !== null,
      );
    }

    // Rating + description live on the Canon asset. Setting them re-runs metadata extraction
    // (updateAsset enqueues a sidecar write), so drain those queues before reading anything back —
    // otherwise the just-set rating is not yet in exifInfo when the panel renders.
    await updateAsset(
      { id: thompsonId, updateAssetDto: { rating: RATING, description: DESCRIPTION } },
      { headers: asBearerAuth(admin.accessToken) },
    );
    await utils.waitForQueueFinish(admin.accessToken, 'sidecar');
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');

    const tags = await utils.upsertTags(admin.accessToken, ['ctx-viewer-tag']);
    tagId = tags[0].id;
    tagValue = tags[0].value;
    await utils.tagAssets(admin.accessToken, tagId, [thompsonId]);

    // The rating and tag rows are preference-gated, and BOTH default OFF (preferences.ts) — enable
    // them for admin or those two rows never render.
    await utils.updateMyPreferences(admin.accessToken, {
      ratings: { enabled: true },
      tags: { enabled: true },
    });

    const thompsonInfo = await getAssetInfo({ id: thompsonId }, { headers: asBearerAuth(admin.accessToken) });
    const imgInfo = await getAssetInfo({ id: imgId }, { headers: asBearerAuth(admin.accessToken) });

    thompsonCity = (thompsonInfo.exifInfo?.city ?? '').trim();
    imgState = (imgInfo.exifInfo?.state ?? '').trim();
    thompsonLens = (thompsonInfo.exifInfo?.lensModel ?? '').trim();

    // Non-vacuity pins: each row only renders when its value is present, and each negative control
    // below only means something when the two assets genuinely differ on that dimension.
    expect(thompsonCity, 'reverse geocoding must have produced a city for the Canon asset').not.toBe('');
    expect(imgState, 'reverse geocoding must have produced a state for the Apple asset').not.toBe('');
    expect(thompsonCity, 'the two assets must sit in different cities').not.toBe((imgInfo.exifInfo?.city ?? '').trim());
    expect((thompsonInfo.exifInfo?.state ?? '').trim(), 'the two assets must sit in different states').not.toBe(
      imgState,
    );
    expect(thompsonLens, 'the Canon asset must carry a lens model').not.toBe('');
    expect(thompsonLens, 'the two assets must have different lenses').not.toBe(
      (imgInfo.exifInfo?.lensModel ?? '').trim(),
    );
    expect(thompsonInfo.exifInfo?.rating).toBe(RATING);
    expect(thompsonInfo.exifInfo?.description).toBe(DESCRIPTION);
    // Different capture years, so the day filter's negative control cannot pass vacuously.
    expect((thompsonInfo.localDateTime ?? '').slice(0, 4)).not.toBe((imgInfo.localDateTime ?? '').slice(0, 4));
  });

  test('clicking a location (city) filters /photos and excludes an asset in a different city', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, admin.accessToken);

    // Unfiltered, /photos shows BOTH assets — the control for the exclusion below.
    await page.goto('/photos');
    await expect(page.locator(`[data-asset-id="${thompsonId}"]`)).toBeVisible();
    await expect(page.locator(`[data-asset-id="${imgId}"]`)).toBeVisible();

    await openDetailPanel(page, `/photos/${thompsonId}`);
    await page.getByLabel(`Filter by this location: ${thompsonCity}`, { exact: true }).click();

    await page.waitForURL((url) => url.pathname === '/photos' && url.searchParams.get('city') === thompsonCity);
    await expect(page.locator('#immich-asset-viewer')).toHaveCount(0);

    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');
    await expect(page.locator(`[data-asset-id="${thompsonId}"]`)).toBeVisible();
    await expect(
      page.locator(`[data-asset-id="${imgId}"]`),
      'the asset in the other city must be excluded, or the location filter is unproven',
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="active-chip"]').filter({ hasText: thompsonCity })).toBeVisible();
  });

  // NOTE: the location sibling-staleness behaviour (clicking a second location value REPLACES the
  // stale sibling instead of ANDing it) is proven deterministically by three unit tests in
  // web/src/lib/components/asset-viewer/__tests__/detail-panel-location.spec.ts. It has no honest e2e
  // form: to observe the clearing you must open the OTHER asset while the first location filter is
  // active, but any location value that CONFLICTS with the stale one (the only case that distinguishes
  // "cleared" from "ANDed") necessarily filters that asset OUT of the timeline — so the viewer opens
  // over a filtered-out asset and never stabilises. The unit tests carry this guarantee.

  // Each affordance below is its OWN single-open test. A test that opens the viewer, filters (which
  // closes it), then re-opens to filter again lands the panel over a just-filtered timeline and its
  // affordance buttons churn (found in the DOM but never "stable") until the 60s click timeout. One
  // open + one click per test keeps them stable — the pattern every passing test here uses.
  test('the date row filters /photos to the clicked day and excludes the other asset', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);

    await openDetailPanel(page, `/photos/${thompsonId}`);
    await page.getByLabel(/^Filter by this date/).click();
    await page.waitForURL((url) => url.pathname === '/photos' && !!url.searchParams.get('from'));

    const dateUrl = new URL(page.url());
    expect(dateUrl.searchParams.get('from')).toBeTruthy();
    expect(dateUrl.searchParams.get('to'), 'a single clicked day is an inclusive [day, day] range').toBe(
      dateUrl.searchParams.get('from'),
    );
    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');
    await expect(page.locator(`[data-asset-id="${thompsonId}"]`)).toBeVisible();
    await expect(page.locator(`[data-asset-id="${imgId}"]`)).toHaveCount(0);
  });

  test('the filename row filters /photos to the basename and excludes the other asset', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);

    await openDetailPanel(page, `/photos/${thompsonId}`);
    await page.getByLabel(`Filter by this filename: ${THOMPSON_BASENAME}`, { exact: true }).click();
    await page.waitForURL(
      (url) => url.pathname === '/photos' && url.searchParams.get('filename') === THOMPSON_BASENAME,
    );

    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');
    await expect(page.locator(`[data-asset-id="${thompsonId}"]`)).toBeVisible();
    await expect(page.locator(`[data-asset-id="${imgId}"]`)).toHaveCount(0);
  });

  test('the lens row filters /photos to the lens model and excludes the other asset', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);

    await openDetailPanel(page, `/photos/${thompsonId}`);
    await page.getByLabel(`Filter by this lens: ${thompsonLens}`, { exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/photos' && url.searchParams.get('lens') === thompsonLens);

    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');
    await expect(page.locator(`[data-asset-id="${thompsonId}"]`)).toBeVisible();
    await expect(page.locator(`[data-asset-id="${imgId}"]`)).toHaveCount(0);
  });

  test('clicking a tag filters /photos and excludes an untagged asset', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await openDetailPanel(page, `/photos/${thompsonId}`);

    await page.getByLabel(`Filter by this tag: ${tagValue}`).click();
    await page.waitForURL((url) => url.pathname === '/photos' && url.searchParams.get('tags') === tagId);
    await expect(page.locator('#immich-asset-viewer')).toHaveCount(0);

    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');
    await expect(page.locator(`[data-asset-id="${thompsonId}"]`)).toBeVisible();
    await expect(
      page.locator(`[data-asset-id="${imgId}"]`),
      'the untagged asset must be excluded, or the tag filter is unproven',
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="active-chip"]').filter({ hasText: tagValue })).toBeVisible();
  });

  test('the rating and description rows are edited in place, their value is not a filter affordance', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await openDetailPanel(page, `/photos/${thompsonId}`);

    // Each row exposes a DEDICATED filter icon — that is the only way to filter by rating/description.
    await expect(page.getByLabel(`Filter by this rating: ${RATING}`)).toBeVisible();
    await expect(page.getByLabel(`Filter by this description: ${DESCRIPTION}`)).toBeVisible();

    // The description VALUE is an editable textarea: clicking it places the caret, it must NOT filter.
    await page.getByTestId('autogrow-textarea').click();
    await expect(page.locator('#immich-asset-viewer')).toBeVisible();
    expect(page.url()).toContain(thompsonId);
    expect(new URL(page.url()).searchParams.has('description')).toBe(false);

    // The rating VALUE is the star widget: clicking a star edits the rating, it must NOT filter.
    await page.getByTestId('star').first().click();
    await expect(page.locator('#immich-asset-viewer')).toBeVisible();
    expect(page.url()).toContain(thompsonId);
    expect(new URL(page.url()).searchParams.has('rating')).toBe(false);
  });

  // TASK C.1 — the whole feature is URL-backed; a reload must rebuild both the chip and the narrowed
  // grid from the URL alone.
  test('a click-applied filter survives a full page reload (URL-backed)', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await openDetailPanel(page, `/photos/${thompsonId}`);

    await page.getByLabel(`Filter by this lens: ${thompsonLens}`, { exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/photos' && url.searchParams.get('lens') === thompsonLens);
    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');
    await expect(page.locator(`[data-asset-id="${thompsonId}"]`)).toBeVisible();
    await expect(page.locator(`[data-asset-id="${imgId}"]`)).toHaveCount(0);
    await expect(page.locator('[data-testid="active-chip"]').filter({ hasText: thompsonLens })).toBeVisible();

    await page.reload();

    expect(new URL(page.url()).searchParams.get('lens')).toBe(thompsonLens);
    await expect(page.locator('[data-testid="active-chip"]').filter({ hasText: thompsonLens })).toBeVisible();
    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');
    await expect(page.locator(`[data-asset-id="${thompsonId}"]`)).toBeVisible();
    await expect(
      page.locator(`[data-asset-id="${imgId}"]`),
      'the reloaded, URL-hydrated grid must stay narrowed',
    ).toHaveCount(0);
  });
});

/**
 * The owner ("shared by") affordance. It renders ONLY on a shared album (DetailPanel gates it on
 * `currentAlbum.albumUsers.length > 0`), so this drives a genuinely TWO-OWNER album: admin owns one
 * asset, a co-editor owns the other. The owner filter is the only thing that can separate them, so a
 * filter that silently no-oped would leave both assets and this test would fail.
 */
test.describe('Asset viewer contextual filters — the shared-by owner affordance on a shared album', () => {
  let admin: LoginResponseDto;
  let contributor: LoginResponseDto;
  let albumId: string;
  let adminAssetId: string;
  let contributorAssetId: string;
  const CONTRIBUTOR_NAME = 'Contributing Owner';

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    contributor = await utils.userSetup(admin.accessToken, {
      email: 'album-contributor@test.com',
      name: CONTRIBUTOR_NAME,
      password: 'password',
    });

    const adminAsset = await upload(admin.accessToken, CANON_FIXTURE);
    adminAssetId = adminAsset.id;
    const contributorAsset = await upload(contributor.accessToken, APPLE_FIXTURE);
    contributorAssetId = contributorAsset.id;
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
    for (const [token, id] of [
      [admin.accessToken, adminAssetId],
      [contributor.accessToken, contributorAssetId],
    ] as const) {
      await utils.poll(
        () => utils.getAssetInfo(token, id),
        (asset) => asset.thumbhash !== null,
      );
    }

    // Admin owns the album and one asset, with the contributor as an EDITOR (this is what makes the
    // album "shared" and renders the shared-by row). The contributor then adds their OWN asset, so
    // the album genuinely holds two owners.
    const album = await utils.createAlbum(admin.accessToken, {
      albumName: 'Two Owners Album',
      assetIds: [adminAssetId],
      albumUsers: [{ userId: contributor.userId, role: AlbumUserRole.Editor }],
    });
    albumId = album.id;
    await addAssetsToAlbum(
      { id: albumId, bulkIdsDto: { ids: [contributorAssetId] } },
      { headers: asBearerAuth(contributor.accessToken) },
    );
  });

  test('clicking shared-by filters the album to that owner and excludes the other contributor', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, admin.accessToken);

    // Unfiltered, the album shows BOTH owners' assets — the control for the exclusion below.
    await page.goto(`/albums/${albumId}`);
    await expect(page.locator(`[data-asset-id="${adminAssetId}"]`)).toBeVisible();
    await expect(page.locator(`[data-asset-id="${contributorAssetId}"]`)).toBeVisible();

    // Open the CONTRIBUTOR's asset; for the admin its "shared by <contributor>" value is a filter.
    await openDetailPanel(page, `/albums/${albumId}/photos/${contributorAssetId}`);
    await page.getByLabel(`Filter by this owner: ${CONTRIBUTOR_NAME}`).click();

    await page.waitForURL(
      (url) => url.pathname === `/albums/${albumId}` && url.searchParams.get('owner') === contributor.userId,
    );
    await expect(page.locator('#immich-asset-viewer')).toHaveCount(0);

    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');
    await expect(page.locator(`[data-asset-id="${contributorAssetId}"]`)).toBeVisible();
    await expect(
      page.locator(`[data-asset-id="${adminAssetId}"]`),
      'the other owner asset must be excluded, or the owner filter is unproven',
    ).toHaveCount(0);
    // The chip resolves the owner id to a name (resolveFilterNames → getUser).
    await expect(page.locator('[data-testid="active-chip"]').filter({ hasText: CONTRIBUTOR_NAME })).toBeVisible();
  });
});

// NOTE: two-chip AND-composition (applying filter B while A is active keeps only assets matching
// BOTH) has no stable browser e2e form here. It needs a SECOND filter interaction, which means
// re-opening the viewer over an already-filtered timeline — the panel's affordance buttons then
// churn (found in the DOM but never "stable") until the click times out, whether the re-open is a
// deep-link or a grid-thumbnail click. The AND semantics are proven where they can be pinned
// deterministically: at the unit level by filter-target.spec.ts ("merges the patch into the current
// filters, preserving the others", D2, E25) and over the wire by gallery-map.e2e-spec.ts (two tags /
// two people / spaceId+ownerId each narrow to the intersection). The single-affordance tests above
// already prove chips render and filters apply on the real /photos surface.
