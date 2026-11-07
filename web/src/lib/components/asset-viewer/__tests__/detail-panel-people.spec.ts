import { reactivePageMock as mockPage } from '#lib/gallery/__mocks__/reactive-page.mock.svelte.ts';
import { buildContextualFilterUrl } from '#lib/utils/filter-target.ts';
import { consumeTypedSearchNames } from '#lib/utils/typed-search/typed-search-name-cache.ts';
import { factory } from '#test/unit/factories.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import type { AssetFaceResponseDto, AssetResponseDto, PersonResponseDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import DetailPanelPeople from '../DetailPanelPeople.svelte';

// Task 5 of Slice 7 (asset-viewer-contextual-filters).
//
// R8 — THE PERSON PATCH IS TARGET-DEPENDENT, and getting it wrong is a 400, not a miss:
//  - a Space (and the space map) sends FilterState.personIds as `spacePersonIds`, validated
//    server-side as z.array(z.uuidv4()) — a BARE uuid. `space-person:<uuid>` there is a zod reject
//    → 400 → the whole Space timeline errors out.
//  - /photos, an album and the global map send `personIds`, the only field that accepts the SCOPED
//    token — and the scoped token is the only id a viewer of a shared-space asset can resolve there
//    (the owner's person uuid is invisible to them → empty result → P1 violated).
// These tests therefore assert the ID SHAPE PER SURFACE, not "always scoped".

const { gotoMock, faceManagerMock, zoomImageToBase64Mock } = vi.hoisted(() => ({
  gotoMock: vi.fn().mockResolvedValue(undefined),
  faceManagerMock: {
    data: [] as AssetFaceResponseDto[],
    people: [] as PersonResponseDto[],
    facesByPersonId: new Map<string, AssetFaceResponseDto[]>(),
  },
  zoomImageToBase64Mock: vi.fn(),
}));

vi.mock('$app/navigation', async () => ({ ...(await import('#test/unit/mocks/app-navigation.ts')), goto: gotoMock }));

vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('#lib/gallery/__mocks__/reactive-page.mock.svelte.ts');
  return { page: reactivePageMock };
});

vi.mock('#lib/stores/face.svelte.js', () => ({ faceManager: faceManagerMock }));

vi.mock('#lib/utils/people-utils.js', () => ({ zoomImageToBase64: zoomImageToBase64Mock }));

const authManagerMock = vi.hoisted(() => ({
  authenticated: true,
  user: { id: 'owner-1' },
  isSharedLink: false,
  params: {},
  preferences: {},
}));

vi.mock('#lib/managers/auth-manager.svelte.js', () => ({ authManager: authManagerMock }));

const assetViewerManagerMock = vi.hoisted(() => ({
  clearHighlightedFaces: vi.fn(),
  highlightedFaces: [] as unknown[],
  imgRef: undefined,
  isShowingHiddenPeople: false,
  openEditFacesPanel: vi.fn(),
  setHighlightedFaces: vi.fn(),
  toggleFaceEditMode: vi.fn(),
  toggleHiddenPeople: vi.fn(),
}));

vi.mock('#lib/managers/asset-viewer-manager.svelte.js', () => ({ assetViewerManager: assetViewerManagerMock }));

const PERSON_UUID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SPACE_PERSON_UUID = 'bbbbbbbb-0000-4000-8000-000000000002';
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

const spacePerson = (overrides: Record<string, unknown> = {}) =>
  ({
    id: PERSON_UUID,
    spacePersonId: SPACE_PERSON_UUID,
    name: 'Alice',
    birthDate: null,
    isHidden: false,
    thumbnailPath: '/thumb',
    updatedAt: '2026-01-01T00:00:00.000Z',
    faces: [],
    ...overrides,
  }) as unknown as NonNullable<AssetResponseDto['people']>[number];

const buildAsset = (people: AssetResponseDto['people'] = []): AssetResponseDto =>
  factory.asset({ id: 'asset-1', ownerId: 'owner-1', people });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  gotoMock.mockResolvedValue(undefined);
  zoomImageToBase64Mock.mockResolvedValue(undefined);
  faceManagerMock.data = [];
  faceManagerMock.people = [];
  faceManagerMock.facesByPersonId = new Map();
  authManagerMock.isSharedLink = false;
  mockPage.reset('https://gallery.test/photos/asset-1');
});

// The chip is a real link: in the browser a click would navigate the test frame away. Cancel the
// default action (the component's own click handler still runs) so only the banking is observed.
const clickWithoutNavigating = (link: HTMLElement | SVGElement) => {
  link.addEventListener('click', (event) => event.preventDefault(), { once: true });
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};

describe('DetailPanelPeople filter grammar (R8)', () => {
  it('in a SPACE: the chip filters by the BARE spacePersonId (a scoped token would 400)', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1');

    await renderWithTooltips(DetailPanelPeople, {
      asset: buildAsset([spacePerson()]),
      isOwner: false,
      previousRoute: '/photos',
      spaceId: 'space-1',
      canFilter: true,
    });

    await expect.element(page.getByLabelText('filter_by_person: Alice')).toBeInTheDocument();

    const chip = page.getByLabelText('filter_by_person: Alice').element();
    const href = chip.getAttribute('href') ?? '';

    expect(href).toBe(buildContextualFilterUrl(mockPage.url, { personIds: [SPACE_PERSON_UUID] }));
    expect(href.startsWith('/spaces/space-1')).toBe(true);

    const people = new URLSearchParams(href.split('?', 2)[1]).get('people') ?? '';
    expect(people).toMatch(UUID); // bare uuid — spacePersonIds is z.array(z.uuidv4())
    expect(people).not.toContain('space-person:');
    expect(href).not.toContain('asset-1'); // one navigation closes the viewer
  });

  it('on the SPACE MAP: the chip likewise filters by the bare spacePersonId', async () => {
    mockPage.reset('https://gallery.test/map/photos/asset-1?spaceId=space-1');

    await renderWithTooltips(DetailPanelPeople, {
      asset: buildAsset([spacePerson()]),
      isOwner: false,
      previousRoute: '/photos',
      spaceId: 'space-1',
      canFilter: true,
    });

    await expect.element(page.getByLabelText('filter_by_person: Alice')).toBeInTheDocument();

    const chip = page.getByLabelText('filter_by_person: Alice').element();
    const href = chip.getAttribute('href') ?? '';
    const people = new URLSearchParams(href.split('?', 2)[1]).get('people') ?? '';

    expect(people).toBe(SPACE_PERSON_UUID);
    expect(people).not.toContain('space-person:');
  });

  it('on /photos: a shared-space person filters by the SCOPED token (P1 — the owner uuid is invisible there)', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1');

    await renderWithTooltips(DetailPanelPeople, {
      asset: buildAsset([spacePerson()]),
      isOwner: false,
      previousRoute: '/photos',
      spaceId: 'space-1',
      canFilter: true,
    });

    await expect.element(page.getByLabelText('filter_by_person: Alice')).toBeInTheDocument();

    const chip = page.getByLabelText('filter_by_person: Alice').element();
    const href = chip.getAttribute('href') ?? '';
    const people = new URLSearchParams(href.split('?', 2)[1]).get('people') ?? '';

    expect(people).toBe(`space-person:${SPACE_PERSON_UUID}`);
    expect(href.startsWith('/photos')).toBe(true);
  });

  it('on /photos: an OWN person filters by the scoped `person:<uuid>` token', async () => {
    faceManagerMock.people = [
      { id: PERSON_UUID, name: 'Bob', birthDate: null, isHidden: false, thumbnailPath: '/t' } as PersonResponseDto,
    ];

    await renderWithTooltips(DetailPanelPeople, {
      asset: buildAsset(),
      isOwner: true,
      previousRoute: '/photos',
      canFilter: true,
    });

    await expect.element(page.getByLabelText('filter_by_person: Bob')).toBeInTheDocument();

    const chip = page.getByLabelText('filter_by_person: Bob').element();
    const href = chip.getAttribute('href') ?? '';
    const people = new URLSearchParams(href.split('?', 2)[1]).get('people') ?? '';

    // Scoped, not bare: this is the id `getPhotosPersonFilterId` derives for the same person, and
    // therefore the key the chip's `personNames` map and the panel's people options are stored under.
    expect(people).toBe(`person:${PERSON_UUID}`);
    expect(people.slice('person:'.length)).toMatch(UUID);
  });

  // R8/R9 — no bare space-person uuid means there is nothing honest to filter a Space by: the
  // owner's person uuid is not a space_person row, so the filter would return nothing.
  it('R8: renders NO filter affordance for a Space person with no spacePersonId', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1');

    await renderWithTooltips(DetailPanelPeople, {
      asset: buildAsset([spacePerson({ spacePersonId: undefined })]),
      isOwner: false,
      previousRoute: '/photos',
      spaceId: 'space-1',
      canFilter: true,
    });

    await expect.element(page.getByText('Alice')).toBeInTheDocument();
    await expect.element(page.getByLabelText(/^filter_by_person/)).not.toBeInTheDocument();
    // …and there is no person page to fall back to either: #796 renders a non-owner's person as
    // plain text rather than a link into the owner-gated `/people/{id}`, which would 404. The row
    // still shows the person — it just carries no navigation.
    await expect.element(page.getByRole('link')).not.toBeInTheDocument();
  });
});

// The token the chip navigates with is only half the story: the destination has to be able to NAME
// it. The `personNames` map the chip and the panel read is fed by the filter-suggestions response,
// which lands a few hundred ms after the navigation — and never carries this exact token when the
// viewer also owns a person for the same identity (the suggestion then ranks the user-person first
// and emits `person:<own uuid>`). Both cases render a raw token where a name belongs, which is what
// was reported. So the click banks the name against its destination, the same session-scoped cache
// typed search uses; every filter surface already drains it on navigation.
describe('DetailPanelPeople name hand-off', () => {
  it('banks the person name against the destination URL when the chip is clicked', async () => {
    faceManagerMock.people = [
      { id: PERSON_UUID, name: 'Bob', birthDate: null, isHidden: false, thumbnailPath: '/t' } as PersonResponseDto,
    ];

    await renderWithTooltips(DetailPanelPeople, {
      asset: buildAsset(),
      isOwner: true,
      previousRoute: '/photos',
      canFilter: true,
    });

    await expect.element(page.getByLabelText('filter_by_person: Bob')).toBeInTheDocument();

    const chip = page.getByLabelText('filter_by_person: Bob').element();
    const href = chip.getAttribute('href') ?? '';
    clickWithoutNavigating(chip);

    const names = consumeTypedSearchNames(href);
    expect(names.personNames.get(`person:${PERSON_UUID}`)).toBe('Bob');
  });

  it('banks the SPACE person name under the bare id the Space filters by', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1');

    await renderWithTooltips(DetailPanelPeople, {
      asset: buildAsset([spacePerson()]),
      isOwner: false,
      previousRoute: '/photos',
      spaceId: 'space-1',
      canFilter: true,
    });

    await expect.element(page.getByLabelText('filter_by_person: Alice')).toBeInTheDocument();

    const chip = page.getByLabelText('filter_by_person: Alice').element();
    const href = chip.getAttribute('href') ?? '';
    clickWithoutNavigating(chip);

    const names = consumeTypedSearchNames(href);
    expect(names.personNames.get(SPACE_PERSON_UUID)).toBe('Alice');
  });

  // The map keeps its viewport in the URL hash, but every consumer keys the cache on
  // `pathname + search` — banking it under the hashed URL would silently never be read.
  it('keys the hand-off on pathname + search, ignoring the map hash', async () => {
    mockPage.reset('https://gallery.test/map/photos/asset-1#12/50.08/14.43');
    faceManagerMock.people = [
      { id: PERSON_UUID, name: 'Bob', birthDate: null, isHidden: false, thumbnailPath: '/t' } as PersonResponseDto,
    ];

    await renderWithTooltips(DetailPanelPeople, {
      asset: buildAsset(),
      isOwner: true,
      previousRoute: '/photos',
      canFilter: true,
    });

    await expect.element(page.getByLabelText('filter_by_person: Bob')).toBeInTheDocument();

    const chip = page.getByLabelText('filter_by_person: Bob').element();
    const href = chip.getAttribute('href') ?? '';
    expect(href).toContain('#12/50.08/14.43');
    clickWithoutNavigating(chip);

    const names = consumeTypedSearchNames(href.split('#', 1)[0]);
    expect(names.personNames.get(`person:${PERSON_UUID}`)).toBe('Bob');
  });

  it('does not bank anything when there is no filter affordance', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1');

    await renderWithTooltips(DetailPanelPeople, {
      asset: buildAsset([spacePerson({ spacePersonId: undefined })]),
      isOwner: false,
      previousRoute: '/photos',
      spaceId: 'space-1',
      canFilter: true,
    });

    await expect.element(page.getByText('Alice')).toBeInTheDocument();
    expect(sessionStorage.length).toBe(0);
  });
});

describe('DetailPanelPeople structure (R6)', () => {
  it('preserves the four face-highlight handlers on the chip', async () => {
    faceManagerMock.people = [
      { id: PERSON_UUID, name: 'Bob', birthDate: null, isHidden: false, thumbnailPath: '/t' } as PersonResponseDto,
    ];

    await renderWithTooltips(DetailPanelPeople, {
      asset: buildAsset(),
      isOwner: true,
      previousRoute: '/photos',
      canFilter: true,
    });

    await expect.element(page.getByLabelText('filter_by_person: Bob')).toBeInTheDocument();

    const chip = page.getByLabelText('filter_by_person: Bob').element();

    chip.dispatchEvent(new PointerEvent('pointerenter'));
    expect(assetViewerManagerMock.setHighlightedFaces).toHaveBeenCalled();

    chip.dispatchEvent(new PointerEvent('pointerleave'));
    expect(assetViewerManagerMock.clearHighlightedFaces).toHaveBeenCalled();

    chip.dispatchEvent(new FocusEvent('focus'));
    expect(assetViewerManagerMock.setHighlightedFaces).toHaveBeenCalledTimes(2);

    chip.dispatchEvent(new FocusEvent('blur'));
    expect(assetViewerManagerMock.clearHighlightedFaces).toHaveBeenCalledTimes(2);
  });

  // A link cannot nest inside a link. The ↗ person-page link must be a SIBLING overlay control.
  it('renders the ↗ person-page link as a SIBLING of the filter link, never nested inside it', async () => {
    faceManagerMock.people = [
      { id: PERSON_UUID, name: 'Bob', birthDate: null, isHidden: false, thumbnailPath: '/t' } as PersonResponseDto,
    ];

    await renderWithTooltips(DetailPanelPeople, {
      asset: buildAsset(),
      isOwner: true,
      previousRoute: '/photos',
      canFilter: true,
    });

    await expect.element(page.getByLabelText('filter_by_person: Bob')).toBeInTheDocument();

    const chip = page.getByLabelText('filter_by_person: Bob').element();
    const personPage = page.getByLabelText('view_person: Bob').element();

    expect(chip.querySelector('a')).toBeNull();
    expect(chip.contains(personPage)).toBe(false);
    expect(personPage.getAttribute('href')).toContain(`/people/${PERSON_UUID}`);
  });

  it('links the ↗ to the SPACE person page inside a Space', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1');

    await renderWithTooltips(DetailPanelPeople, {
      asset: buildAsset([spacePerson()]),
      isOwner: false,
      previousRoute: '/photos',
      spaceId: 'space-1',
      canFilter: true,
    });

    await expect.element(page.getByLabelText('view_person: Alice')).toBeInTheDocument();

    const personPage = page.getByLabelText('view_person: Alice').element();
    expect(personPage.getAttribute('href')).toContain(`/spaces/space-1/people/${SPACE_PERSON_UUID}`);
  });
});

describe('DetailPanelPeople gating (E2)', () => {
  it('E2: with canFilter false the chip stays the person-page link and no filter link renders', async () => {
    faceManagerMock.people = [
      { id: PERSON_UUID, name: 'Bob', birthDate: null, isHidden: false, thumbnailPath: '/t' } as PersonResponseDto,
    ];

    await renderWithTooltips(DetailPanelPeople, {
      asset: buildAsset(),
      isOwner: true,
      previousRoute: '/photos',
      canFilter: false,
    });

    await expect.element(page.getByText('Bob')).toBeInTheDocument();
    await expect.element(page.getByLabelText(/^filter_by_person/)).not.toBeInTheDocument();
    await expect.element(page.getByLabelText(/^view_person/)).not.toBeInTheDocument();
    expect(page.getByRole('link').element().getAttribute('href')).toContain(`/people/${PERSON_UUID}`);
  });
});
