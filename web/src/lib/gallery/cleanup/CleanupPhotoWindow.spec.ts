import { AssetTypeEnum, type CleanupAssetDto } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import CleanupExpandButton from '$lib/gallery/cleanup/CleanupExpandButton.svelte';
import CleanupPhotoWindow from '$lib/gallery/cleanup/CleanupPhotoWindow.svelte';

const getAssetMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/managers/AssetCacheManager.svelte', () => ({ assetCacheManager: { getAsset: getAssetMock } }));

const asset = (id: string): CleanupAssetDto => ({
  id,
  city: null,
  duration: null,
  fileSize: 1000,
  height: 100,
  width: 100,
  inAlbum: false,
  isFavorite: false,
  kept: false,
  localDateTime: '2024-09-23T10:00:00.000Z',
  originalFileName: `${id}.jpg`,
  thumbhash: null,
  type: AssetTypeEnum.Image,
});

const shownId = () => screen.getByTestId('cleanup-photo-window-photo').dataset.assetId;

const removeFrom = (list: CleanupAssetDto[]) =>
  vi.fn((id: string) => {
    list.splice(
      list.findIndex((item) => item.id === id),
      1,
    );
    return Promise.resolve(true);
  });

const setup = (overrides: Record<string, unknown> = {}) => {
  const list = [asset('a'), asset('b'), asset('c')];
  const props = {
    items: () => list,
    startId: 'b',
    onKeep: removeFrom(list),
    onTrash: vi.fn(() => Promise.resolve(false)),
    advanceOnAction: true,
    openViewer: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(CleanupPhotoWindow, props);
  return { props, list };
};

describe('CleanupPhotoWindow', () => {
  beforeEach(() => {
    getAssetMock.mockResolvedValue(undefined);
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the photo, the queue's signal and the photo details", async () => {
    setup({ signal: () => ({ label: 'cleanup_reason_blurry' }) });

    expect(shownId()).toBe('b');
    expect(screen.getByTestId('cleanup-photo-window-photo')).toHaveAttribute('src', expect.stringContaining('/b/'));
    expect(screen.getByTestId('cleanup-photo-window-signal')).toHaveTextContent('cleanup_reason_blurry');
    await waitFor(() => expect(getAssetMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' })));
  });

  it("shows a burst frame's sharpness rank", () => {
    setup({ signal: () => ({ sharpness: { value: 80, rank: 1, of: 8 } }) });

    expect(screen.getByTestId('cleanup-photo-window-signal')).toHaveTextContent('cleanup_sharpest_of');
  });

  it('steps through the photos with the arrow keys', async () => {
    setup();

    await fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(shownId()).toBe('c');
    await fireEvent.keyDown(document, { key: 'ArrowLeft' });
    await fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(shownId()).toBe('a');
  });

  it('moves on to the next photo after Keep', async () => {
    const { props } = setup();

    await fireEvent.keyDown(document, { key: 'k' });

    expect(props.onKeep).toHaveBeenCalledWith('b');
    await waitFor(() => expect(shownId()).toBe('c'));
  });

  it('advances into the next page after the last loaded photo', async () => {
    const list = [asset('a')];
    const loadMore = vi.fn(() => {
      list.push(asset('d'));
      return Promise.resolve(true);
    });
    setup({ items: () => list, startId: 'a', loadMore, onKeep: removeFrom(list) });

    await fireEvent.keyDown(document, { key: 'k' });

    await waitFor(() => expect(shownId()).toBe('d'));
    expect(loadMore).toHaveBeenCalledOnce();
  });

  it('closes past the last photo when there are no more pages', async () => {
    const list = [asset('a')];
    const { props } = setup({
      items: () => list,
      startId: 'a',
      loadMore: vi.fn(() => Promise.resolve(false)),
      onKeep: removeFrom(list),
    });

    await fireEvent.keyDown(document, { key: 'k' });

    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it("trash goes through the queue's own path", async () => {
    const { props } = setup();

    await fireEvent.keyDown(document, { key: 'Delete' });

    expect(props.onTrash).toHaveBeenCalledWith('b');
  });

  it('stays on the frame when the action does not take the photo out of the list', async () => {
    const { props } = setup({ advanceOnAction: false, onKeep: vi.fn(() => Promise.resolve(false)) });

    await fireEvent.keyDown(document, { key: 'k' });

    expect(props.onKeep).toHaveBeenCalledWith('b');
    expect(shownId()).toBe('b');
  });

  it('opens the photo in a new tab with O', async () => {
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null);
    setup();

    await fireEvent.keyDown(document, { key: 'o' });

    expect(open).toHaveBeenCalledWith('/photos/b', '_blank', 'noopener');
  });

  it('toggles the selection with Space when the queue has one', async () => {
    const selection = { has: vi.fn(() => false), toggle: vi.fn() };
    setup({ selection });

    await fireEvent.keyDown(document, { key: ' ' });

    expect(selection.toggle).toHaveBeenCalledWith('b');
  });

  it('opens the full viewer from the link', async () => {
    const { props } = setup();

    await fireEvent.click(screen.getByTestId('cleanup-photo-window-viewer'));

    expect(props.openViewer).toHaveBeenCalledWith('b');
  });
});

describe('CleanupExpandButton', () => {
  it('reports the tile it belongs to and stops the click from reaching the tile', () => {
    const onExpand = vi.fn();
    render(CleanupExpandButton, { id: 'a', onExpand });
    const click = new MouseEvent('click', { bubbles: true });

    screen.getByTestId('cleanup-expand-a').dispatchEvent(click);

    expect(onExpand).toHaveBeenCalledWith('a', expect.any(DOMRect));
    // Svelte delegates clicks to the root; a stopped event never reaches the tile's own handler.
    expect(click.cancelBubble).toBe(true);
  });
});
