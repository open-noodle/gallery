import assetViewerSource from '#lib/components/asset-viewer/AssetViewer.svelte?raw';
import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import AssetVersions from '#lib/gallery/versions/AssetVersions.svelte';
import { DETAIL_PANEL } from '#lib/gallery/versions/asset-versions.ts';
import { factory } from '#test/unit/factories.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import {
  AssetTypeEnum,
  AssetVersionKind,
  type AssetResponseDto,
  type AssetVersionResponseDto,
  type AssetVersionsResponseDto,
} from '@immich/sdk';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

const mocks = vi.hoisted(() => ({
  show: vi.fn(),
  toastPrimary: vi.fn(),
  handleError: vi.fn(),
  auth: {
    authenticated: true,
    isSharedLink: false,
    params: {} as Record<string, string>,
    user: { id: 'owner-1' },
  },
  features: { assetVersions: true as boolean | undefined },
}));

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    modalManager: { ...original.modalManager, show: mocks.show },
    toastManager: { ...original.toastManager, primary: mocks.toastPrimary },
  };
});

vi.mock('#lib/managers/auth-manager.svelte.ts', () => ({ authManager: mocks.auth }));
vi.mock('#lib/managers/feature-flags-manager.svelte.ts', () => ({
  featureFlagsManager: {
    get valueOrUndefined() {
      return mocks.features;
    },
  },
}));
vi.mock('#lib/utils/handle-error.ts', () => ({ handleError: mocks.handleError }));

const photo = (overrides: Partial<AssetResponseDto> = {}) =>
  factory.asset({
    id: 'photo-1',
    ownerId: 'owner-1',
    type: AssetTypeEnum.Image,
    // the camera's clock is four hours behind UTC
    fileCreatedAt: '2026-10-01T10:00:00.000Z',
    localDateTime: '2026-10-01T06:00:00.000Z',
    exifInfo: { timeZone: 'UTC-4' },
    ...overrides,
  });

const version = (overrides: Partial<AssetVersionResponseDto> = {}): AssetVersionResponseDto => ({
  id: 'raw-1',
  kind: AssetVersionKind.Raw,
  source: 'camera',
  rule: 'raw:name',
  originalFileName: 'DSC_0001.NEF',
  originalMimeType: 'image/x-nikon-nef',
  fileSizeInByte: 25_000_000,
  width: 6048,
  height: 4024,
  thumbhash: null,
  fileCreatedAt: '2026-10-01T10:00:00.000Z',
  fileModifiedAt: '2026-10-01T10:00:01.000Z',
  shown: false,
  isOffline: false,
  ...overrides,
});

const list = (versions: AssetVersionResponseDto[], assetId = 'photo-1'): AssetVersionsResponseDto => ({
  assetId,
  versions,
});

const threeVersions = () => [
  version({
    id: 'edit-1',
    kind: AssetVersionKind.Edit,
    shown: true,
    source: 'lightroom',
    rule: 'edit:name',
    originalFileName: 'DSC_0001-edit.jpg',
    originalMimeType: 'image/jpeg',
    // exported four days after the shot
    fileModifiedAt: '2026-10-05T12:00:00.000Z',
    isOffline: true,
  }),
  // the photo's own file is a row too, under the photo's id
  version({
    id: 'photo-1',
    kind: AssetVersionKind.Original,
    rule: 'photo',
    originalFileName: 'DSC_0001.JPG',
    originalMimeType: 'image/jpeg',
  }),
  version(),
];

const renderPanel = (asset = photo()) => renderWithTooltips(AssetVersions, { asset });

const within = (element: Element) => page.elementLocator(element);
/** An element's text, with runs of white space as one space. */
const textOf = (element: Element) => (element.textContent ?? '').replaceAll(/\s+/g, ' ').trim();
const panel = () => page.getByTestId('detail-panel-versions');
/** The cards, once the list has arrived. */
const loadedCards = async () => {
  await expect.element(page.getByTestId('asset-version-card').first()).toBeInTheDocument();
  return page.getByTestId('asset-version-card').elements() as HTMLElement[];
};

// The browser really asks for the versions' pictures, and the test server has none. That answer is kept from the
// cards, so a picture stays "not loaded yet"; a test that wants a picture to fail sends the event itself. (Whether
// the pictures do load is for a medium test: media never loads in a unit test.)
const keepLoadFailuresAway = (event: Event) => {
  const picture = event.target;
  if (event.isTrusted && picture instanceof HTMLImageElement && picture.closest('[data-testid="asset-version-card"]')) {
    event.stopPropagation();
  }
};

beforeEach(() => {
  document.addEventListener('error', keepLoadFailuresAway, { capture: true });
  vi.clearAllMocks();
  mocks.auth.authenticated = true;
  mocks.auth.isSharedLink = false;
  mocks.auth.params = {};
  mocks.auth.user = { id: 'owner-1' };
  mocks.features.assetVersions = true;
});

afterEach(() => {
  document.removeEventListener('error', keepLoadFailuresAway, { capture: true });
});

describe('AssetVersions', () => {
  it('renders nothing when the server has no versions endpoint', async () => {
    mocks.features.assetVersions = undefined;
    sdkMock.getAssetVersions.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    await renderPanel();

    await vi.waitFor(() => expect(sdkMock.getAssetVersions).toHaveBeenCalledTimes(1));
    await tick();
    expect(panel().query()).toBeNull();
    expect(page.getByTestId('detail-panel-versions-error').query()).toBeNull();
    expect(mocks.handleError).not.toHaveBeenCalled();
  });

  it('renders nothing when the photo has no versions', async () => {
    sdkMock.getAssetVersions.mockResolvedValue(list([]));
    await renderPanel();

    await vi.waitFor(() => expect(sdkMock.getAssetVersions).toHaveBeenCalledTimes(1));
    await tick();
    expect(panel().query()).toBeNull();
  });

  it('does not ask for versions of a video', async () => {
    await renderPanel(photo({ type: AssetTypeEnum.Video }));
    await tick();
    expect(sdkMock.getAssetVersions).not.toHaveBeenCalled();
    expect(panel().query()).toBeNull();
  });

  it('passes the shared link key and hides download when the link disallows it', async () => {
    mocks.auth.isSharedLink = true;
    mocks.auth.authenticated = false;
    mocks.auth.params = { key: 'link-key' };
    sdkMock.getAssetVersions.mockResolvedValue(list([version()]));
    await renderPanel();

    const [card] = await loadedCards();
    expect(sdkMock.getAssetVersions).toHaveBeenCalledWith(
      { id: 'photo-1', key: 'link-key' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(within(card).getByRole('img').element()).toHaveAttribute('src', expect.stringContaining('key=link-key'));
    expect(
      within(card)
        .getByRole('button', { name: /^download/ })
        .query(),
    ).toBeNull();
  });

  it("shows each version with its kind, its time on the camera's clock, its details and a download", async () => {
    sdkMock.getAssetVersions.mockResolvedValue(list(threeVersions()));
    await renderPanel();

    const cards = await loadedCards();
    expect(cards).toHaveLength(3);
    expect(textOf(panel().element())).toContain('asset_versions');

    const [edit, original, raw] = cards;
    expect(textOf(edit)).toContain('asset_versions_kind_edit');
    // what made an edit is not named: the label says Edit and no more
    expect(textOf(edit)).not.toMatch(/lightroom/i);
    expect(textOf(edit)).toContain('JPG');
    expect(within(edit).getByTestId('asset-version-offline').element()).toBeInTheDocument();

    expect(textOf(original)).toContain('asset_versions_kind_original');
    expect(textOf(original)).toContain('DSC_0001.JPG');
    expect(within(original).getByRole('img').element()).toHaveAttribute(
      'src',
      expect.stringContaining('/assets/photo-1/versions/photo-1/thumbnail?size=thumbnail'),
    );
    // the one the photo's picture comes from carries a tag of its own beside the thumbnail, and only that one
    const shown = within(edit).getByTestId('asset-version-shown').element();
    expect(textOf(shown)).toMatch(/^asset_versions_shown$/);
    expect(within(edit).getByTestId('asset-version-details').element()).toContainElement(shown);
    expect(within(original).getByTestId('asset-version-shown').query()).toBeNull();
    expect(within(raw).getByTestId('asset-version-shown').query()).toBeNull();
    // the label is the kind alone, and shares one line with the time, for the shown file as for the others
    expect(textOf(within(edit).getByTestId('asset-version-kind').element())).toMatch(/^asset_versions_kind_edit$/);
    expect(textOf(within(original).getByTestId('asset-version-kind').element())).toMatch(
      /^asset_versions_kind_original$/,
    );
    for (const card of cards) {
      const label = within(card).getByTestId('asset-version-kind').element();
      expect(within(card).getByTestId('asset-version-date').element().parentElement).toBe(label.parentElement);
    }
    // 10:00 UTC is 06:00 on the camera's clock, as the info panel shows the photo
    expect(textOf(within(raw).getByTestId('asset-version-date').element())).toMatch(/\b0?6:00\b/);
    expect(textOf(within(raw).getByTestId('asset-version-date').element())).toMatch(/2026/);
    expect(textOf(within(original).getByTestId('asset-version-date').element())).toMatch(/\b0?6:00\b/);
    // with the camera's time zone, in its short form
    expect(textOf(within(raw).getByTestId('asset-version-date').element())).toMatch(/GMT-4$/);
    expect(textOf(within(original).getByTestId('asset-version-date').element())).toMatch(/GMT-4$/);
    // an edit shows when it was made, not when the photo was taken
    expect(textOf(within(edit).getByTestId('asset-version-date').element())).toMatch(/\b5\b/);
    expect(textOf(within(edit).getByTestId('asset-version-date').element())).not.toMatch(/\b0?6:00\b/);
    // in the viewer's own time zone, whichever that is
    expect(textOf(within(edit).getByTestId('asset-version-date').element())).toMatch(/GMT([+-]\d{1,2}(:\d\d)?)?$/);

    // the name has a line to itself; the type and size, then the dimensions, sit beside the thumbnail
    const details = within(raw).getByTestId('asset-version-details').element();
    expect([...details.children].map((line) => line.textContent)).toEqual([
      expect.stringMatching(/^NEF · /),
      '6048 × 4024',
    ]);
    expect(details.parentElement).toBe(
      within(raw)
        .getByRole('button', { name: /^preview/ })
        .element().parentElement,
    );
    expect(textOf(details)).not.toContain('DSC_0001.NEF');

    expect(textOf(raw)).toContain('asset_versions_kind_raw');
    expect(textOf(raw)).toContain('DSC_0001.NEF');
    expect(textOf(raw)).toContain('NEF');
    expect(textOf(raw)).toContain('6048 × 4024');
    expect(within(raw).getByTestId('asset-version-offline').query()).toBeNull();
    expect(within(raw).getByRole('img').element()).toHaveAttribute(
      'src',
      expect.stringContaining('/assets/photo-1/versions/raw-1/thumbnail?size=thumbnail'),
    );

    // the server cannot send an offline file: it says so where the download would be
    expect(
      within(edit)
        .getByRole('button', { name: /^download/ })
        .query(),
    ).toBeNull();
    for (const card of [original, raw]) {
      expect(
        within(card)
          .getByRole('button', { name: /^download/ })
          .element(),
      ).toBeInTheDocument();
    }
  });

  it("writes no time zone for the camera's files when the photo records none, as the info panel does", async () => {
    sdkMock.getAssetVersions.mockResolvedValue(list(threeVersions()));
    await renderPanel(photo({ exifInfo: { timeZone: null } }));

    const [edit, original, raw] = await loadedCards();
    expect(textOf(within(original).getByTestId('asset-version-date').element())).not.toMatch(/GMT/);
    expect(textOf(within(raw).getByTestId('asset-version-date').element())).not.toMatch(/GMT/);
    // the viewer's own zone is always known
    expect(textOf(within(edit).getByTestId('asset-version-date').element())).toMatch(/GMT/);
  });

  it('shows the thumbhash, or an icon, in place of a thumbnail that cannot be loaded', async () => {
    sdkMock.getAssetVersions.mockResolvedValue(
      list([version({ id: 'with-hash', thumbhash: '1QcSHQRnh493V4dIh4eXh1h4kJUI' }), version({ id: 'without' })]),
    );
    await renderPanel();
    const [withHash, without] = await loadedCards();
    expect(withHash.querySelector('img')).not.toBeNull();

    for (const card of [withHash, without]) {
      card.querySelector('img')!.dispatchEvent(new Event('error'));
    }
    await tick();

    // the picture is gone, and the click on its place still works
    for (const card of [withHash, without]) {
      expect(card.querySelector('img')).toBeNull();
      expect(
        within(card)
          .getByRole('button', { name: /^preview/ })
          .element(),
      ).toBeInTheDocument();
    }
    expect(withHash.querySelector('canvas')).not.toBeNull();
    expect(without.querySelector('canvas')).toBeNull();
    expect(without.querySelector('svg')).not.toBeNull();
  });

  it('offers nothing that changes versions, to the owner or anyone else', async () => {
    sdkMock.getAssetVersions.mockResolvedValue(list(threeVersions()));
    await renderPanel();

    const cards = await loadedCards();
    const [offlineEdit, ...others] = cards;
    // a preview (the thumbnail) and a download, the download only for a file the server can send: Gallery
    // arranges versions itself
    expect(within(offlineEdit).getByRole('button').elements()).toHaveLength(1);
    for (const card of others) {
      expect(within(card).getByRole('button').elements()).toHaveLength(2);
    }
    expect(page.getByRole('button', { name: /separate|add/i }).query()).toBeNull();
    expect(page.getByTestId('asset-versions-file-input').query()).toBeNull();
  });

  describe('the larger picture on hover', () => {
    it('finds the info panel by the mark Immich’s viewer gives it', () => {
      // the card looks the panel up in the page; a renamed mark would put the picture over the panel
      const marker = DETAIL_PANEL.replaceAll(/^\[|\]$/g, '');
      expect(assetViewerSource).toContain(marker);
    });

    // A 1920 × 1080 window with the info panel (360 px) at its right edge, and the thumbnail inside the panel.
    const previewButton = (card: HTMLElement) => {
      const button = within(card)
        .getByRole('button', { name: /^preview/ })
        .element() as HTMLElement;
      button.getBoundingClientRect = () => ({ top: 500, height: 80, left: 1584, right: 1664 }) as DOMRect;
      const panel = { getBoundingClientRect: () => ({ left: 1560, right: 1920 }) as DOMRect } as Element;
      button.closest = ((selector: string) => (selector === DETAIL_PANEL ? panel : null)) as typeof button.closest;
      return button;
    };

    // the test server has no pictures: say what the loaded thumbnail's shape is
    const loadThumbnail = (card: HTMLElement) =>
      Object.defineProperties(within(card).getByRole('img').element(), {
        naturalWidth: { value: 300 },
        naturalHeight: { value: 200 },
      });

    // the events themselves, not a real mouse: a real one would be somewhere on the page, and move
    const send = async (target: Element, event: Event) => {
      target.dispatchEvent(event);
      await tick();
    };
    const hover = (button: HTMLElement, pointerType: 'mouse' | 'touch') =>
      send(button, new PointerEvent('pointerenter', { pointerType }));

    const popup = () => page.getByTestId('asset-version-popup').query() as HTMLElement | null;

    const rawCard = async () => {
      sdkMock.getAssetVersions.mockResolvedValue(list(threeVersions()));
      await renderPanel();
      const cards = await loadedCards();
      return cards[2];
    };

    beforeEach(() => {
      vi.stubGlobal('innerWidth', 1920);
      vi.stubGlobal('innerHeight', 1080);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('shows it beside the panel while the mouse is on a thumbnail, and takes it away when the mouse leaves', async () => {
      const card = await rawCard();
      const button = previewButton(card);
      loadThumbnail(card);

      await hover(button, 'mouse');

      const picture = popup()!;
      expect(picture).toHaveAttribute(
        'src',
        expect.stringContaining('/assets/photo-1/versions/raw-1/thumbnail?size=preview'),
      );
      // left of the panel's edge (1560), not of the thumbnail's, and level with the thumbnail
      expect(picture.style.left).toBe('848px');
      expect(picture.style.width).toBe('700px');
      expect(picture.style.top).toBe('307px');
      expect(picture.style.height).toBe('467px');
      // one picture, for the hovered version only
      expect(page.getByTestId('asset-version-popup').elements()).toHaveLength(1);

      await send(button, new PointerEvent('pointerleave'));
      expect(popup()).toBeNull();
    });

    it('shows none for a touch, or before the thumbnail has loaded', async () => {
      const card = await rawCard();
      const button = previewButton(card);

      await hover(button, 'mouse');
      expect(popup()).toBeNull();

      loadThumbnail(card);
      await hover(button, 'touch');
      expect(popup()).toBeNull();
    });

    it('shows none when there is no room beside the panel', async () => {
      // the panel fills a 500 px window but for 140 px
      vi.stubGlobal('innerWidth', 500);
      const card = await rawCard();
      const button = previewButton(card);
      button.closest = (() => ({ getBoundingClientRect: () => ({ left: 140, right: 500 }) })) as never;
      loadThumbnail(card);

      await hover(button, 'mouse');
      expect(popup()).toBeNull();
    });

    it('closes it when the thumbnail is clicked, which opens the large picture', async () => {
      const card = await rawCard();
      const button = previewButton(card);
      loadThumbnail(card);
      await hover(button, 'mouse');
      expect(popup()).not.toBeNull();

      await send(button, new MouseEvent('click', { bubbles: true }));

      expect(popup()).toBeNull();
      expect(mocks.show).toHaveBeenCalledTimes(1);
      expect(mocks.show.mock.calls[0][1]).toMatchObject({
        title: 'DSC_0001.NEF',
        src: expect.stringContaining('/assets/photo-1/versions/raw-1/thumbnail?size=preview'),
      });
    });

    it('closes it when the picture cannot be loaded, and does not try again', async () => {
      const card = await rawCard();
      const button = previewButton(card);
      loadThumbnail(card);
      await hover(button, 'mouse');

      await send(popup()!, new Event('error'));
      expect(popup()).toBeNull();

      await hover(button, 'mouse');
      expect(popup()).toBeNull();
      // the thumbnail and the click are untouched
      expect(within(card).getByRole('img').element()).toBeInTheDocument();
    });
  });

  it('ignores a response for a photo the user already left', async () => {
    let resolveFirst: (value: AssetVersionsResponseDto) => void = () => {};
    sdkMock.getAssetVersions
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(list([], 'photo-2'));
    const { rerender } = await renderPanel();

    // renderWithTooltips renders a wrapper: the new props go through it to AssetVersions
    await rerender({ component: AssetVersions, componentProps: { asset: photo({ id: 'photo-2' }) } } as never);
    await vi.waitFor(() => expect(sdkMock.getAssetVersions).toHaveBeenCalledTimes(2));
    const [, firstOptions] = sdkMock.getAssetVersions.mock.calls[0] as [unknown, { signal: AbortSignal }];
    expect(firstOptions.signal.aborted).toBe(true);

    resolveFirst(list([version()]));
    await tick();
    expect(panel().query()).toBeNull();
  });
});
