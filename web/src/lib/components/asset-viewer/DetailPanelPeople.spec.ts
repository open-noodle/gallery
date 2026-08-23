import { AssetTypeEnum, type AssetResponseDto, type PersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { cropFacesFromAsset } from '$lib/stores/preferences.store';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import DetailPanelPeople from './DetailPanelPeople.svelte';

const { authManagerMock, faceManagerMock, zoomImageToBase64Mock } = vi.hoisted(() => ({
  authManagerMock: {
    authenticated: true,
    user: { id: 'viewer-1' },
    isSharedLink: false,
    params: {},
    preferences: { tags: { enabled: true } },
  },
  faceManagerMock: {
    data: [] as unknown[],
    facesByPersonId: new Map<string, unknown[]>(),
    people: [] as PersonResponseDto[],
  },
  zoomImageToBase64Mock: vi.fn(),
}));

vi.mock('$lib/stores/face.svelte', () => ({ faceManager: faceManagerMock }));

vi.mock('$lib/utils/people-utils', () => ({ zoomImageToBase64: zoomImageToBase64Mock }));

vi.mock('$app/navigation', () => ({ goto: vi.fn().mockResolvedValue(undefined) }));

vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: authManagerMock }));

vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({
  assetViewerManager: {
    clearHighlightedFaces: vi.fn(),
    highlightedFaces: [],
    imgRef: undefined,
    isShowingHiddenPeople: false,
    openEditFacesPanel: vi.fn(),
    setHighlightedFaces: vi.fn(),
    toggleFaceEditMode: vi.fn(),
    toggleHiddenPeople: vi.fn(),
  },
}));

const person = (name: string): PersonResponseDto =>
  ({
    id: `person-${name}`,
    name,
    birthDate: null,
    thumbnailPath: '',
    isHidden: false,
    isFavorite: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as unknown as PersonResponseDto;

// `assetFactory` randomises `type` (see web/src/test-data/factories/asset-factory.ts), and
// `zoomImageToBase64` takes a different code path for Image vs Video. An unpinned type is a
// latent flake, so every asset built here pins it.
const asset = (overrides: Partial<AssetResponseDto> = {}) =>
  assetFactory.build({ id: 'asset-1', ownerId: 'owner-1', type: AssetTypeEnum.Image, ...overrides });

const renderPanel = (props: {
  isOwner: boolean;
  spaceId?: string;
  people?: PersonResponseDto[];
  sharedLink?: boolean;
  assetType?: AssetTypeEnum;
}) => {
  authManagerMock.isSharedLink = props.sharedLink ?? false;
  return renderWithTooltips(DetailPanelPeople, {
    asset: asset({
      ...(props.people && { people: props.people }),
      ...(props.assetType && { type: props.assetType }),
    }),
    isOwner: props.isOwner,
    previousRoute: '/photos',
    spaceId: props.spaceId,
  });
};

// renderWithTooltips casts away the TestWrapper indirection, so rerender must be fed the
// wrapper's own prop shape — passing the component's props directly silently does nothing.
const rerenderPanel = async (
  result: { rerender: (props: never) => Promise<void> },
  props: { isOwner: boolean; spaceId?: string; assetId: string },
) => {
  await result.rerender({
    component: DetailPanelPeople,
    componentProps: {
      asset: asset({ id: props.assetId }),
      isOwner: props.isOwner,
      previousRoute: '/photos',
      spaceId: props.spaceId,
    },
  } as never);
};

// A person as the server sends it inside a shared space: the id stays the GLOBAL person id
// (AssetService.applySpacePeople only *adds* spacePersonId), which is why faceManager's
// facesByPersonId lookup still matches for space members.
const spacePerson = (name: string, spacePersonId: string): PersonResponseDto =>
  ({ ...person(name), spacePersonId }) as unknown as PersonResponseDto;

const givePersonAFace = (personId: string, faceId = 'face-1') => {
  faceManagerMock.facesByPersonId = new Map<string, unknown[]>([[personId, [{ id: faceId }]]]);
  faceManagerMock.data = [{ id: faceId }];
};

const CROP_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

// The {#await} block renders its PENDING branch first, which shows the same fallback URL the
// failure case shows. Without flushing to the :then branch, a test meaning to assert the
// resolved state silently asserts the pending state and can never fail.
const settleCrop = async () => {
  await waitFor(() => expect(zoomImageToBase64Mock).toHaveBeenCalled());
  await tick();
  await tick();
};

// NOTE on what these tests do and do NOT prove.
//
// These exercise the component's gate and avatar resolution given a people list. They mock
// `faceManager`, so they prove client logic only — never the server contract.
//
// History: before #818 the server redacted identity from non-owners on both sources, so the
// People section was empty for a shared-album recipient no matter what the client did. That is
// fixed — `mapFaces` (server/src/dtos/person.dto.ts) now maps `person` for anyone with
// Permission.AssetRead, and `AssetService.get` filters only hidden people for a non-owner with
// no space. The server side is pinned by real-database tests:
// server/test/medium/specs/services/person.service.spec.ts and .../asset.service.spec.ts.
//
// Avatar-URL reachability is NOT symmetric across viewers, and that asymmetry is load-bearing
// for the crop-vs-profile-face setting: /people/{id}/thumbnail is guarded by
// Permission.PersonRead, which server/src/utils/access.ts resolves as owner ∪ shared-space
// member. A viewer who is neither (album share, partner share) has no representative face to
// fall back to, which is why they stay on the asset crop unconditionally.
describe('DetailPanelPeople', () => {
  beforeEach(() => {
    // Real localStorage-backed store: a flip in one test leaks into every later test (and into
    // preferences.store.spec.ts) unless it is reset here.
    cropFacesFromAsset.set(true);
    faceManagerMock.people = [];
    faceManagerMock.data = [];
    faceManagerMock.facesByPersonId = new Map();
    // vite.config.ts sets no clearMocks/restoreMocks, so this shared hoisted mock keeps its call
    // history across tests in this file. settleCrop() waits on that history, so it must be cleared
    // or every crop assertion after the first one asserts the pending branch by mistake.
    zoomImageToBase64Mock.mockReset();
    zoomImageToBase64Mock.mockResolvedValue(undefined);
  });

  it('renders people for a non-owner when the client is given any (gate no longer requires ownership)', () => {
    faceManagerMock.people = [person('Alice')];

    renderPanel({ isOwner: false });

    expect(screen.getByTestId('detail-panel-people')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders nothing for a non-owner when handed an empty people list', () => {
    // Pre-#818 this was the production shape for a shared-album recipient. It no longer is; the
    // test is kept because the empty-list gate itself still matters.
    faceManagerMock.people = [];
    faceManagerMock.data = [{ id: 'face-1' }];

    renderPanel({ isOwner: false });

    expect(screen.queryByTestId('detail-panel-people')).not.toBeInTheDocument();
  });

  it('never requests the owner-only person thumbnail for a non-owner', () => {
    faceManagerMock.people = [person('Alice')];

    const { container } = renderPanel({ isOwner: false });

    // /people/{id}/thumbnail is owner-gated AND is cropped from the person's feature photo — a
    // DIFFERENT asset the viewer may have no right to see. Requesting it would 404 at best and
    // leak a crop of an unshared photo at worst.
    expect(container.querySelector('img')?.getAttribute('src')).not.toContain('/people/');
  });

  it('requests the person thumbnail for the owner', () => {
    faceManagerMock.people = [person('Alice')];

    const { container } = renderPanel({ isOwner: true });

    expect(container.querySelector('img')?.getAttribute('src')).toContain('/people/');
  });

  it('does not link a non-owner to the owner-only person page', () => {
    faceManagerMock.people = [person('Alice')];

    renderPanel({ isOwner: false });

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('links the owner to the person page', () => {
    faceManagerMock.people = [person('Alice')];

    renderPanel({ isOwner: true });

    expect(screen.getByRole('link')).toBeInTheDocument();
  });

  it('hides the section on a shared link even when people are present', () => {
    faceManagerMock.people = [person('Alice')];

    renderPanel({ isOwner: false, sharedLink: true });

    expect(screen.queryByTestId('detail-panel-people')).not.toBeInTheDocument();
  });

  it('hides the section on a shared link even for the owner', () => {
    faceManagerMock.people = [person('Alice')];

    renderPanel({ isOwner: true, sharedLink: true });

    expect(screen.queryByTestId('detail-panel-people')).not.toBeInTheDocument();
  });

  it('offers no face editing controls to a non-owner', () => {
    faceManagerMock.people = [person('Alice')];
    faceManagerMock.data = [{ id: 'face-1' }];

    renderPanel({ isOwner: false });

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('offers face editing controls to the owner', () => {
    faceManagerMock.people = [person('Alice')];
    faceManagerMock.data = [{ id: 'face-1' }];

    renderPanel({ isOwner: true });

    expect(screen.queryAllByRole('button').length).toBeGreaterThan(0);
  });

  it('still renders the section for an owner whose asset has no people', () => {
    renderPanel({ isOwner: true });

    expect(screen.getByTestId('detail-panel-people')).toBeInTheDocument();
  });

  it('hides the section from a non-owner when there are no people', () => {
    renderPanel({ isOwner: false });

    expect(screen.queryByTestId('detail-panel-people')).not.toBeInTheDocument();
  });

  it('shows space-linked people to a space member from the asset payload', () => {
    faceManagerMock.people = [person('Should Not Appear')];

    renderPanel({ isOwner: false, spaceId: 'space-1', people: [person('Bob')] });

    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Should Not Appear')).not.toBeInTheDocument();
  });

  describe('avatar source (pins current behaviour)', () => {
    it('shows the face cropped from this asset when the crop resolves', async () => {
      faceManagerMock.people = [person('Alice')];
      givePersonAFace('person-Alice');
      zoomImageToBase64Mock.mockResolvedValue(CROP_DATA_URL);

      const { container } = renderPanel({ isOwner: true });
      await settleCrop();

      expect(container.querySelector('img')?.getAttribute('src')).toBe(CROP_DATA_URL);
    });

    it('falls back to the person thumbnail when the crop resolves to null', async () => {
      faceManagerMock.people = [person('Alice')];
      givePersonAFace('person-Alice');
      zoomImageToBase64Mock.mockResolvedValue(null);

      const { container } = renderPanel({ isOwner: true });
      await settleCrop();

      expect(zoomImageToBase64Mock).toHaveBeenCalledTimes(1);
      expect(container.querySelector('img')?.getAttribute('src')).toContain('/people/');
    });

    it('uses the person thumbnail and never crops when the person has no face in this asset', async () => {
      faceManagerMock.people = [person('Alice')];
      faceManagerMock.facesByPersonId = new Map();

      const { container } = renderPanel({ isOwner: true });
      await tick();

      expect(zoomImageToBase64Mock).not.toHaveBeenCalled();
      expect(container.querySelector('img')?.getAttribute('src')).toContain('/people/');
    });

    it('falls back to the space person thumbnail for a space member', async () => {
      const bob = spacePerson('Bob', 'space-person-1');
      givePersonAFace('person-Bob');
      zoomImageToBase64Mock.mockResolvedValue(null);

      const { container } = renderPanel({ isOwner: false, spaceId: 'space-1', people: [bob] });
      await settleCrop();

      expect(container.querySelector('img')?.getAttribute('src')).toContain(
        '/shared-spaces/space-1/people/space-person-1/thumbnail',
      );
    });

    it('falls back to the asset thumbnail for a viewer with no space context', async () => {
      faceManagerMock.people = [person('Alice')];
      givePersonAFace('person-Alice');
      zoomImageToBase64Mock.mockResolvedValue(null);

      const { container } = renderPanel({ isOwner: false });
      await settleCrop();

      const src = container.querySelector('img')?.getAttribute('src');
      // /people/{id}/thumbnail is unreachable for this viewer — see the spec's RBAC note.
      expect(src).not.toContain('/people/');
      expect(src).not.toContain('/shared-spaces/');
      expect(src).toContain('/assets/asset-1/');
    });

    it('uses the owner person thumbnail for the owner even inside a space', async () => {
      // The owner reads faceManager.people, and mapPerson never emits spacePersonId — so the space
      // arm cannot fire for the owner even with a spaceId prop present.
      faceManagerMock.people = [person('Alice')];
      faceManagerMock.facesByPersonId = new Map();

      const { container } = renderPanel({ isOwner: true, spaceId: 'space-1' });
      await tick();

      const src = container.querySelector('img')?.getAttribute('src');
      expect(src).toContain('/people/');
      expect(src).not.toContain('/shared-spaces/');
    });

    it('never synthesises a space thumbnail URL when the space person id is missing', async () => {
      // The server filters these out, but the client must degrade rather than request
      // /shared-spaces/space-1/people/undefined/thumbnail.
      const bob = person('Bob');
      faceManagerMock.facesByPersonId = new Map();

      const { container } = renderPanel({ isOwner: false, spaceId: 'space-1', people: [bob] });
      await tick();

      const src = container.querySelector('img')?.getAttribute('src');
      expect(src).not.toContain('/shared-spaces/');
      expect(src).not.toContain('undefined');
      expect(src).toContain('/assets/asset-1/');
    });

    it('renders an avatar for a person with no name', async () => {
      // Untagged faces are the common case and render alt="" — which strips the img role, so this
      // must be asserted structurally, never through getByRole('img') or getByText.
      faceManagerMock.people = [person('')];
      faceManagerMock.facesByPersonId = new Map();

      const { container } = renderPanel({ isOwner: true });
      await tick();

      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img?.getAttribute('src')).toContain('/people/');
    });
  });

  describe('avatar source setting', () => {
    it('shows the profile face and never computes a crop when the setting is off', async () => {
      faceManagerMock.people = [person('Alice')];
      givePersonAFace('person-Alice');
      zoomImageToBase64Mock.mockResolvedValue(CROP_DATA_URL);
      cropFacesFromAsset.set(false);

      const { container } = renderPanel({ isOwner: true });
      await tick();

      // Not merely "not displayed" — not attempted. The crop decodes the full-size image and runs
      // a canvas draw per person, so skipping it is the performance half of this feature.
      expect(zoomImageToBase64Mock).not.toHaveBeenCalled();
      expect(container.querySelector('img')?.getAttribute('src')).toContain('/people/');
    });

    it('still crops when the setting is on', async () => {
      faceManagerMock.people = [person('Alice')];
      givePersonAFace('person-Alice');
      zoomImageToBase64Mock.mockResolvedValue(CROP_DATA_URL);
      cropFacesFromAsset.set(true);

      const { container } = renderPanel({ isOwner: true });
      await settleCrop();

      expect(container.querySelector('img')?.getAttribute('src')).toBe(CROP_DATA_URL);
    });

    it('shows the space profile face to a space member when the setting is off', async () => {
      const bob = spacePerson('Bob', 'space-person-1');
      givePersonAFace('person-Bob');
      cropFacesFromAsset.set(false);

      const { container } = renderPanel({ isOwner: false, spaceId: 'space-1', people: [bob] });
      await tick();

      expect(zoomImageToBase64Mock).not.toHaveBeenCalled();
      expect(container.querySelector('img')?.getAttribute('src')).toContain(
        '/shared-spaces/space-1/people/space-person-1/thumbnail',
      );
    });

    it('KEEPS cropping for a viewer with no reachable profile face even when the setting is off', async () => {
      // The regression guard. Turning the setting off must not give an album/partner viewer the
      // whole photo as every person's avatar — they have no profile face to switch to.
      faceManagerMock.people = [person('Alice')];
      givePersonAFace('person-Alice');
      zoomImageToBase64Mock.mockResolvedValue(CROP_DATA_URL);
      cropFacesFromAsset.set(false);

      const { container } = renderPanel({ isOwner: false });
      await settleCrop();

      expect(zoomImageToBase64Mock).toHaveBeenCalledTimes(1);
      expect(container.querySelector('img')?.getAttribute('src')).toBe(CROP_DATA_URL);
    });

    it('uses the owner profile face for the owner inside a space when the setting is off', async () => {
      faceManagerMock.people = [person('Alice')];
      givePersonAFace('person-Alice');
      cropFacesFromAsset.set(false);

      const { container } = renderPanel({ isOwner: true, spaceId: 'space-1' });
      await tick();

      // The "not called" assertion is what makes this a driver rather than a passenger: without
      // it the URL assertion passes even before the fix, because the pending crop branch already
      // renders this same fallback.
      expect(zoomImageToBase64Mock).not.toHaveBeenCalled();
      const src = container.querySelector('img')?.getAttribute('src');
      expect(src).toContain('/people/');
      expect(src).not.toContain('/shared-spaces/');
    });

    it('does not fetch video media for a crop nobody will see when the setting is off', async () => {
      faceManagerMock.people = [person('Alice')];
      givePersonAFace('person-Alice');
      cropFacesFromAsset.set(false);

      renderPanel({ isOwner: true, assetType: AssetTypeEnum.Video });
      await tick();

      expect(zoomImageToBase64Mock).not.toHaveBeenCalled();
    });

    it('updates the rendered avatar when the setting is flipped on a live panel', async () => {
      faceManagerMock.people = [person('Alice')];
      givePersonAFace('person-Alice');
      zoomImageToBase64Mock.mockResolvedValue(CROP_DATA_URL);

      const { container } = renderPanel({ isOwner: true });
      await settleCrop();
      expect(container.querySelector('img')?.getAttribute('src')).toBe(CROP_DATA_URL);

      cropFacesFromAsset.set(false);
      await tick();

      // Same container, no re-render call: the change must propagate through reactivity alone.
      expect(container.querySelector('img')?.getAttribute('src')).toContain('/people/');
    });

    it('keeps hidden-people filtering, links and age rendering intact when the setting is off', async () => {
      const alice = person('Alice');
      const hidden = { ...person('Hidden'), isHidden: true } as PersonResponseDto;
      faceManagerMock.people = [alice, hidden];
      faceManagerMock.facesByPersonId = new Map();
      cropFacesFromAsset.set(false);

      renderPanel({ isOwner: true });
      await tick();

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
      expect(screen.getByRole('link')).toBeInTheDocument();
    });

    it('resolves the fallback against the new asset after navigating to the next photo', async () => {
      // The {#await} lives inside an {#each} keyed on person.id, so a person present on both photos
      // keeps their DOM node across the switch. The avatar inputs must still be recomputed.
      faceManagerMock.people = [person('Alice')];
      givePersonAFace('person-Alice');
      zoomImageToBase64Mock.mockResolvedValue(null);

      const result = renderPanel({ isOwner: false });
      const { container } = result;
      await settleCrop();
      expect(container.querySelector('img')?.getAttribute('src')).toContain('/assets/asset-1/');

      await rerenderPanel(result as never, { isOwner: false, assetId: 'asset-2' });
      await tick();

      expect(container.querySelector('img')?.getAttribute('src')).toContain('/assets/asset-2/');
    });
  });

  describe('in-panel avatar source toggle', () => {
    // The test harness's svelte-i18n instance (src/test-data/setup.ts) has no dictionaries
    // registered, so $t() resolves to the raw key rather than translated English text — the same
    // convention already used throughout this suite (e.g. `name: 'use_inherited_thumbnail'` in
    // RepresentativeFacePickerModal.spec.ts, `name: 'link'` / `'save'` elsewhere).
    const toggle = () => screen.queryByRole('button', { name: /show_profile_faces|show_faces_from_photo/ });

    it('offers the owner a toggle that flips the store and relabels itself', async () => {
      faceManagerMock.people = [person('Alice')];
      givePersonAFace('person-Alice');

      renderPanel({ isOwner: true });
      await tick();

      const button = screen.getByRole('button', { name: 'show_profile_faces' });
      await userEvent.click(button);

      expect(get(cropFacesFromAsset)).toBe(false);
      expect(screen.getByRole('button', { name: 'show_faces_from_photo' })).toBeInTheDocument();
    });

    it('offers the toggle to a space member who is not the owner', async () => {
      const bob = spacePerson('Bob', 'space-person-1');
      givePersonAFace('person-Bob');

      renderPanel({ isOwner: false, spaceId: 'space-1', people: [bob] });
      await tick();

      // Proves the button sits OUTSIDE the {#if isOwner} gate.
      expect(toggle()).toBeInTheDocument();
    });

    it('hides the toggle from a viewer with no reachable profile face', async () => {
      faceManagerMock.people = [person('Alice')];
      givePersonAFace('person-Alice');

      renderPanel({ isOwner: false });
      await tick();

      // Nothing to switch to — a control that cannot change anything must not be offered.
      expect(toggle()).not.toBeInTheDocument();
    });

    it('hides the toggle when the asset has no people, keeping the add-face affordance', async () => {
      faceManagerMock.people = [];
      faceManagerMock.data = [];
      faceManagerMock.facesByPersonId = new Map();

      renderPanel({ isOwner: true });
      await tick();

      expect(toggle()).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'tag_people' })).toBeInTheDocument();
    });
  });
});
