import '#lib/gallery/__mocks__/sdk.mock.ts';
import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import { factory } from '#test/unit/factories.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { modalManager } from '@immich/ui';
import { init, register, waitLocale } from 'svelte-i18n';
import { page, userEvent } from 'vitest/browser';

// The browser links every static import before any module body runs, so a static import of the
// component would load the real @immich/sdk before sdk.mock.ts registers its vi.mock. Loading it
// after that registration gives it the mocked module.
const { default: AlbumSharedSpaceLinks } = await import('#lib/components/album-page/AlbumSharedSpaceLinks.svelte');

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    modalManager: { show: vi.fn(), showDialog: vi.fn() },
  };
});

describe('AlbumSharedSpaceLinks', () => {
  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('#i18n/en.json'));
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(true);
  });

  it('renders one row per space link with the space name', async () => {
    await renderWithTooltips(AlbumSharedSpaceLinks, {
      album: factory.album({
        id: 'album-1',
        sharedSpaceLinks: [
          { spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true },
          { spaceId: 'space-2', spaceName: 'Zoo', linkedById: 'e2', showInTimeline: false },
        ],
      }),
    });

    expect(page.getByText('Trip', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByText('Zoo', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByTestId('album-space-link-unlink').elements()).toHaveLength(2);
  });

  // link.showInTimeline is the shared, editor-controlled flag (the space's own Photos tab), so the
  // indicator must be the space-photos badge — never space_albums_hidden_from_timeline, which is
  // now reserved for the caller's own per-member "my timeline" preference (#1041 §2).
  it('shows the "hidden from the space\'s photos" indicator only for links with showInTimeline=false', async () => {
    await renderWithTooltips(AlbumSharedSpaceLinks, {
      album: factory.album({
        id: 'album-1',
        sharedSpaceLinks: [
          { spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true },
          { spaceId: 'space-2', spaceName: 'Zoo', linkedById: 'e2', showInTimeline: false },
        ],
      }),
    });

    expect(page.getByText("Hidden from the space's photos", { exact: false }).elements()).toHaveLength(1);
  });

  it('calls unlinkAlbum with the space id + album id after confirming', async () => {
    await renderWithTooltips(AlbumSharedSpaceLinks, {
      album: factory.album({
        id: 'album-1',
        sharedSpaceLinks: [{ spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true }],
      }),
    });

    await userEvent.click(page.getByTestId('album-space-link-unlink'));

    expect(modalManager.showDialog).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(sdkMock.unlinkAlbum).toHaveBeenCalledWith({ id: 'space-1', albumId: 'album-1' });
    });
    expect(page.getByText('Trip', { exact: true }).query()).not.toBeInTheDocument();
  });

  it('does NOT call unlinkAlbum when the confirmation is declined', async () => {
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(false);
    await renderWithTooltips(AlbumSharedSpaceLinks, {
      album: factory.album({
        id: 'album-1',
        sharedSpaceLinks: [{ spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true }],
      }),
    });

    await userEvent.click(page.getByTestId('album-space-link-unlink'));

    expect(sdkMock.unlinkAlbum).not.toHaveBeenCalled();
    expect(page.getByText('Trip', { exact: true }).element()).toBeInTheDocument();
  });

  it('renders nothing when there are no links', async () => {
    const { container } = await renderWithTooltips(AlbumSharedSpaceLinks, {
      album: factory.album({ id: 'album-1', sharedSpaceLinks: undefined }),
    });

    expect(container.querySelector('[data-testid="album-space-links"]')).toBeNull();
  });

  it("does NOT render the previous album's links after navigating to a different album (L9)", async () => {
    const { rerender } = await renderWithTooltips(AlbumSharedSpaceLinks, {
      album: factory.album({
        id: 'album-1',
        sharedSpaceLinks: [{ spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true }],
      }),
    });

    expect(page.getByText('Trip', { exact: true }).element()).toBeInTheDocument();

    // Simulate SvelteKit reusing this component instance across album navigation: only the `album`
    // prop changes, no remount.
    await rerender({
      component: AlbumSharedSpaceLinks,
      componentProps: {
        album: factory.album({
          id: 'album-2',
          sharedSpaceLinks: [{ spaceId: 'space-2', spaceName: 'Zoo', linkedById: 'e2', showInTimeline: true }],
        }),
      },
    });

    expect(page.getByText('Trip', { exact: true }).query()).not.toBeInTheDocument();
    expect(page.getByText('Zoo', { exact: true }).element()).toBeInTheDocument();
  });

  it('unlinking on one album does not affect a same-spaceId link rendered after navigating to another album (L9)', async () => {
    const { rerender } = await renderWithTooltips(AlbumSharedSpaceLinks, {
      album: factory.album({
        id: 'album-1',
        sharedSpaceLinks: [{ spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true }],
      }),
    });

    await userEvent.click(page.getByTestId('album-space-link-unlink'));
    await vi.waitFor(() => {
      expect(sdkMock.unlinkAlbum).toHaveBeenCalledWith({ id: 'space-1', albumId: 'album-1' });
    });
    expect(page.getByText('Trip', { exact: true }).query()).not.toBeInTheDocument();

    // Navigate to a different album that happens to be linked to the SAME space id. The
    // optimistic removal tracked for album-1 must not leak into album-2's rendering.
    await rerender({
      component: AlbumSharedSpaceLinks,
      componentProps: {
        album: factory.album({
          id: 'album-2',
          sharedSpaceLinks: [{ spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true }],
        }),
      },
    });

    expect(page.getByText('Trip', { exact: true }).element()).toBeInTheDocument();
  });
});
