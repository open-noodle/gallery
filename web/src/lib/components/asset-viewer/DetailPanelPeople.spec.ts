import type { PersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { screen } from '@testing-library/svelte';
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

const asset = () => assetFactory.build({ id: 'asset-1', ownerId: 'owner-1' });

const renderPanel = (props: {
  isOwner: boolean;
  spaceId?: string;
  people?: PersonResponseDto[];
  sharedLink?: boolean;
}) => {
  authManagerMock.isSharedLink = props.sharedLink ?? false;
  return renderWithTooltips(DetailPanelPeople, {
    asset: props.people ? assetFactory.build({ id: 'asset-1', ownerId: 'owner-1', people: props.people }) : asset(),
    isOwner: props.isOwner,
    previousRoute: '/photos',
    spaceId: props.spaceId,
  });
};

// NOTE on what these tests do and do NOT prove (#796).
//
// These exercise the component's GATE given a people list. They deliberately mock
// `faceManager.people`, so a passing "non-owner sees people" test does NOT mean the info panel's
// People section works for a shared-album recipient in production — it does not.
//
// The server redacts the identity before the client ever sees it, on BOTH sources:
//   • GET /faces  — mapFaces() nulls `person` unless `person.ownerId === auth.user.id`, and
//                   faceManager.people is built from `face.person`, so it is empty for a viewer.
//   • getAssetInfo — AssetService.get hard-sets `people = []` for a non-owner with no space.
// Both are pinned by real-database tests: server/test/medium/specs/services/person.service.spec.ts
// ("getFacesById (non-owner read access)") and .../asset.service.spec.ts ("get (shared-album
// recipient)").
//
// Lifting the client gate here is the necessary half of the fix, not the sufficient one. Making
// People actually appear for a viewer requires a server-side RBAC change (exposing person identity
// to non-owners with read access, with hidden-person filtering and a person-thumbnail endpoint a
// non-owner may call) — a privacy decision, not a display fix.
describe('DetailPanelPeople', () => {
  beforeEach(() => {
    faceManagerMock.people = [];
    faceManagerMock.data = [];
    faceManagerMock.facesByPersonId = new Map();
    zoomImageToBase64Mock.mockResolvedValue(undefined);
  });

  it('renders people for a non-owner when the client is given any (gate no longer requires ownership)', () => {
    faceManagerMock.people = [person('Alice')];

    renderPanel({ isOwner: false });

    expect(screen.getByTestId('detail-panel-people')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders nothing for a non-owner given the empty list the server actually serves today', () => {
    // The production shape for a shared-album recipient: GET /faces comes back with person: null
    // on every face, so faceManager.people is empty. This is the #796 symptom, and it is why the
    // gate change above is not on its own a fix.
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
});
