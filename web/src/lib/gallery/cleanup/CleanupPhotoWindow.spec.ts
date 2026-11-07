import CleanupExpandButton from '#lib/gallery/cleanup/CleanupExpandButton.svelte';
import CleanupPhotoWindow from '#lib/gallery/cleanup/CleanupPhotoWindow.svelte';
import { AssetTypeEnum, type CleanupAssetDto } from '@immich/sdk';
import { tick } from 'svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

const getAssetMock = vi.hoisted(() => vi.fn());
vi.mock('#lib/managers/AssetCacheManager.svelte.js', () => ({ assetCacheManager: { getAsset: getAssetMock } }));

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

const shownId = () => (page.getByTestId('cleanup-photo-window-photo').element() as HTMLElement).dataset.assetId;

/** Dispatches a keydown like a key press on `target`; resolves to false when a handler prevented it. */
const press = async (key: string, target: EventTarget = document) => {
  const notPrevented = target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await tick();
  return notPrevented;
};

const removeFrom = (list: CleanupAssetDto[]) =>
  vi.fn((id: string) => {
    list.splice(
      list.findIndex((item) => item.id === id),
      1,
    );
    return Promise.resolve(true);
  });

const setup = async (overrides: Record<string, unknown> = {}) => {
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
  await render(CleanupPhotoWindow, props);
  return { props, list };
};

describe('CleanupPhotoWindow', () => {
  beforeEach(() => {
    getAssetMock.mockResolvedValue(undefined);
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the photo, the queue's signal and the photo details", async () => {
    await setup({ signal: () => ({ label: 'cleanup_reason_blurry' }) });

    expect(shownId()).toBe('b');
    await expect
      .element(page.getByTestId('cleanup-photo-window-photo'))
      .toHaveAttribute('src', expect.stringContaining('/b/'));
    await expect.element(page.getByTestId('cleanup-photo-window-signal')).toMatchTextContent('cleanup_reason_blurry');
    await vi.waitFor(() => expect(getAssetMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' })));
  });

  it("shows a burst frame's sharpness rank", async () => {
    await setup({ signal: () => ({ sharpness: { value: 80, rank: 1, of: 8 } }) });

    await expect.element(page.getByTestId('cleanup-photo-window-signal')).toMatchTextContent('cleanup_sharpest_of');
  });

  it('steps through the photos with the arrow keys', async () => {
    await setup();

    await press('ArrowRight');
    expect(shownId()).toBe('c');
    await press('ArrowLeft');
    await press('ArrowLeft');
    expect(shownId()).toBe('a');
  });

  it('moves on to the next photo after Keep', async () => {
    const { props } = await setup();

    await press('k');

    expect(props.onKeep).toHaveBeenCalledWith('b');
    await vi.waitFor(() => expect(shownId()).toBe('c'));
  });

  it('advances into the next page after the last loaded photo', async () => {
    const list = [asset('a')];
    const loadMore = vi.fn(() => {
      list.push(asset('d'));
      return Promise.resolve(true);
    });
    await setup({ items: () => list, startId: 'a', loadMore, onKeep: removeFrom(list) });

    await press('k');

    await vi.waitFor(() => expect(shownId()).toBe('d'));
    expect(loadMore).toHaveBeenCalledOnce();
  });

  it('closes past the last photo when there are no more pages', async () => {
    const list = [asset('a')];
    const { props } = await setup({
      items: () => list,
      startId: 'a',
      loadMore: vi.fn(() => Promise.resolve(false)),
      onKeep: removeFrom(list),
    });

    await press('k');

    await vi.waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it("trash goes through the queue's own path", async () => {
    const { props } = await setup();

    await press('Delete');

    expect(props.onTrash).toHaveBeenCalledWith('b');
  });

  it('stays on the frame when the action does not take the photo out of the list', async () => {
    const { props } = await setup({ advanceOnAction: false, onKeep: vi.fn(() => Promise.resolve(false)) });

    await press('k');

    expect(props.onKeep).toHaveBeenCalledWith('b');
    expect(shownId()).toBe('b');
  });

  it('opens the photo in a new tab with O', async () => {
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null);
    await setup();

    await press('o');

    expect(open).toHaveBeenCalledWith('/photos/b', '_blank', 'noopener');
  });

  it('toggles the selection with Space when the queue has one', async () => {
    const selection = { has: vi.fn(() => false), toggle: vi.fn() };
    await setup({ selection });

    await press(' ');

    expect(selection.toggle).toHaveBeenCalledWith('b');
  });

  it('ignores its keys while an action is waiting on a confirmation', async () => {
    const selection = { has: vi.fn(() => false), toggle: vi.fn() };
    await setup({ selection, onTrash: vi.fn(() => new Promise<boolean>(() => {})) });

    await press('Delete');
    await press('ArrowRight');
    await press(' ');

    expect(shownId()).toBe('b');
    expect(selection.toggle).not.toHaveBeenCalled();
  });

  it('leaves Space to a focused button', async () => {
    const selection = { has: vi.fn(() => false), toggle: vi.fn() };
    await setup({ selection });
    const keep = page.getByRole('button', { name: 'keep' }).element() as HTMLElement;
    keep.focus();

    const space = await press(' ', keep);

    expect(selection.toggle).not.toHaveBeenCalled();
    expect(space).toBe(true);
  });

  it('does not claim Space in a queue without a selection', async () => {
    await setup();

    expect(await press(' ', document.body)).toBe(true);
  });

  it('opens the full viewer from the link', async () => {
    const { props } = await setup();

    await userEvent.click(page.getByTestId('cleanup-photo-window-viewer'));

    expect(props.openViewer).toHaveBeenCalledWith('b');
  });
});

describe('CleanupExpandButton', () => {
  it('reports the tile it belongs to and stops the click from reaching the tile', async () => {
    const onExpand = vi.fn();
    await render(CleanupExpandButton, { id: 'a', onExpand });
    const pastTheRoot = vi.fn();
    document.addEventListener('click', pastTheRoot);
    onTestFinished(() => document.removeEventListener('click', pastTheRoot));

    page
      .getByTestId('cleanup-expand-a')
      .element()
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onExpand).toHaveBeenCalledWith('a', expect.any(DOMRect));
    // Svelte delegates clicks to the root; a stopped event never reaches the tile's own handler, nor
    // anything above the root. (The browser clears cancelBubble once dispatch ends, so check where it got to.)
    expect(pastTheRoot).not.toHaveBeenCalled();
  });
});
