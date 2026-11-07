import { fireDragEvent } from '#lib/components/spaces/dom-events.test-helpers.ts';
import { getActiveDragPayload, readDragPayload, setActiveDragPayload } from '#lib/utils/space-album-folder-dnd.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { init, register, waitLocale } from 'svelte-i18n';
import { page, userEvent } from 'vitest/browser';
import SpaceAlbumCard from './space-album-card.svelte';

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  const { default: MockContextMenuButton } = await import('#lib/gallery/__mocks__/action-context-menu.stub.svelte');
  return { ...original, ContextMenuButton: MockContextMenuButton };
});

describe('SpaceAlbumCard', () => {
  beforeAll(async () => {
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    // getActiveDragPayload is bare module state — reset so a payload set by one test can't leak
    // into a later one.
    setActiveDragPayload(null);
  });

  const album = {
    id: 'a-1',
    albumName: 'Trip',
    assetCount: 12,
    albumThumbnailAssetId: null,
    showInTimeline: true,
    hiddenFromMyTimeline: false,
    addedById: null,
    linkedAt: '2026-01-01T00:00:00Z',
    albumUsers: [],
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    shared: false,
    hasSharedLink: false,
    isActivityEnabled: false,
  };

  it('links to the in-space album route', async () => {
    await renderWithTooltips(SpaceAlbumCard, { spaceId: 's-1', album, canManage: false });
    expect(page.getByTestId('space-album-card-link').element()).toHaveAttribute('href', '/spaces/s-1/albums/a-1');
  });

  it('renders album name and count', async () => {
    await renderWithTooltips(SpaceAlbumCard, { spaceId: 's-1', album, canManage: false });
    expect(page.getByText('Trip', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByText(/12 items/i).element()).toBeInTheDocument();
  });

  it('editor and viewer both see the card menu (the "my timeline" item is not editor-gated)', async () => {
    await renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album,
      canManage: true,
      onUnlink: vi.fn(),
      onToggleTimeline: vi.fn(),
      onToggleMyTimeline: vi.fn(),
    });
    expect(page.getByTestId('space-album-card-menu').element()).toBeInTheDocument();

    await renderWithTooltips(SpaceAlbumCard, { spaceId: 's-1', album, canManage: false, onToggleMyTimeline: vi.fn() });
    expect(page.getByTestId('space-album-card-menu').elements()).toHaveLength(2);
  });

  it("shows hidden-from-the-space's-photos sublabel when showInTimeline is false", async () => {
    await renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album: { ...album, showInTimeline: false },
      canManage: false,
    });
    expect(page.getByText(/Hidden from the space's photos/).element()).toBeInTheDocument();
  });

  it('shows hidden-from-your-timeline sublabel when the caller has hidden it from their own timeline', async () => {
    await renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album: { ...album, hiddenFromMyTimeline: true },
      canManage: false,
    });
    expect(page.getByText(/Hidden from your timeline/).element()).toBeInTheDocument();
  });

  // #1041 regression guard: the space-level switch and the album-level "my timeline" switch used
  // to share the literal string "Hide from timeline". They must render DIFFERENT strings now.
  it('the "my timeline" menu item text differs from the space-level switch\'s old shared label', async () => {
    await renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album,
      canManage: false,
      onToggleMyTimeline: vi.fn(),
    });
    expect(page.getByText('Hide this album from my timeline', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByText('Hide from timeline', { exact: true }).query()).not.toBeInTheDocument();
  });

  it('when canManage=true, the my-timeline item, the space-photos toggle, and unlink are all present', async () => {
    await renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album,
      canManage: true,
      onUnlink: vi.fn(),
      onToggleTimeline: vi.fn(),
      onToggleMyTimeline: vi.fn(),
    });
    expect(page.getByText('Hide this album from my timeline', { exact: true }).element()).toBeInTheDocument();
    // album.showInTimeline=true → the editor-only toggle reads "Hide this album from the space's photos"
    expect(page.getByText("Hide this album from the space's photos", { exact: true }).element()).toBeInTheDocument();
    expect(page.getByText('Unlink album', { exact: true }).element()).toBeInTheDocument();
  });

  it('when canManage=false, only the my-timeline item is present — the editor-only items are hidden', async () => {
    await renderWithTooltips(SpaceAlbumCard, { spaceId: 's-1', album, canManage: false, onToggleMyTimeline: vi.fn() });
    expect(page.getByText('Hide this album from my timeline', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByText("Hide this album from the space's photos", { exact: true }).query()).not.toBeInTheDocument();
    expect(page.getByText("Show this album in the space's photos", { exact: true }).query()).not.toBeInTheDocument();
    expect(page.getByText('Unlink album', { exact: true }).query()).not.toBeInTheDocument();
  });

  it('renders the album cover image when a thumbnail exists', async () => {
    await renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album: { ...album, id: 'a-1', albumThumbnailAssetId: 'thumb-1', albumName: 'Trip' },
      canManage: false,
    });
    expect(page.getByAltText('Trip', { exact: true }).element()).toBeInTheDocument();
  });

  it('offers "Move to folder..." alongside unlink and toggle when canManage=true', async () => {
    await renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album,
      canManage: true,
      onUnlink: vi.fn(),
      onToggleTimeline: vi.fn(),
      onMove: vi.fn(),
    });
    expect(page.getByText('Move to folder...', { exact: true }).element()).toBeInTheDocument();
  });

  it('clicking "Move to folder..." calls onMove with the album', async () => {
    const onMove = vi.fn();
    await renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album,
      canManage: true,
      onUnlink: vi.fn(),
      onToggleTimeline: vi.fn(),
      onMove,
    });

    await userEvent.click(page.getByText('Move to folder...', { exact: true }));

    expect(onMove).toHaveBeenCalledWith(album);
  });

  it('viewer sees no "Move to folder..." option either', async () => {
    await renderWithTooltips(SpaceAlbumCard, { spaceId: 's-1', album, canManage: false });
    expect(page.getByText('Move to folder...', { exact: true }).query()).not.toBeInTheDocument();
  });

  // W-11's album-card equivalent: viewers get no drag affordance.
  it('is draggable for an editor and not for a viewer', async () => {
    const { container: editorContainer } = await renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album,
      canManage: true,
    });
    expect(editorContainer.querySelector('[data-testid="space-album-card"]')).toHaveAttribute('draggable', 'true');

    const { container: viewerContainer } = await renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album,
      canManage: false,
    });
    expect(viewerContainer.querySelector('[data-testid="space-album-card"]')).toHaveAttribute('draggable', 'false');
  });

  it('dragstart writes the album payload onto the DataTransfer and the active-drag slot', async () => {
    const { container } = await renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album: { ...album, id: 'a-9' },
      canManage: true,
    });
    const card = container.querySelector('[data-testid="space-album-card"]')!;
    const store = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? '',
      types: [...store.keys()],
    } as unknown as DataTransfer;

    expect(getActiveDragPayload()).toBeNull();

    await fireDragEvent(card, 'dragstart', { dataTransfer });

    expect(readDragPayload(dataTransfer)).toEqual({ kind: 'album', id: 'a-9' });
    expect(getActiveDragPayload()).toEqual({ kind: 'album', id: 'a-9' });

    await fireDragEvent(card, 'dragend');

    expect(getActiveDragPayload()).toBeNull();
  });

  // draggable="false" on the outer div does not stop the inner <a>/cover image from being
  // natively draggable in a real browser (dragstart bubbles up regardless), so the handler
  // itself has to gate on canManage rather than relying solely on the draggable attribute.
  it('dragstart writes nothing when canManage is false, even if a dragstart is fired', async () => {
    const { container } = await renderWithTooltips(SpaceAlbumCard, {
      spaceId: 's-1',
      album: { ...album, id: 'a-9' },
      canManage: false,
    });
    const card = container.querySelector('[data-testid="space-album-card"]')!;
    const dataTransfer = {
      setData: vi.fn(),
      getData: () => '',
      types: [] as string[],
    } as unknown as DataTransfer;

    await fireDragEvent(card, 'dragstart', { dataTransfer });

    expect(dataTransfer.setData).not.toHaveBeenCalled();
    expect(getActiveDragPayload()).toBeNull();
  });
});
