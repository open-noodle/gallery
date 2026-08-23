import { getSharedSpaceAlbums } from '@immich/sdk';
import { fireEvent, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { init, register, waitLocale } from 'svelte-i18n';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import SchemaSpaceAlbumPickerWrapper from '$lib/components/SchemaSpaceAlbumPicker.test-wrapper.svelte';
import { renderWithTooltips } from '$tests/helpers';

// Module mocks, matching the pattern used across this suite. An unmocked @immich/sdk would
// attempt a real fetch under happy-dom.
vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  getSharedSpaceAlbums: vi.fn(),
}));

const album = (id: string, albumName: string) => ({ id, albumName }) as never;
const boundValue = () => screen.getByTestId('wrapper-album-name');
const field = () => screen.getByRole('combobox');
const optionLabels = () => screen.getAllByRole('option').map((option) => option.textContent?.trim());

// The global test setup uses `fallbackLocale: 'dev'`, which renders literal translation keys.
// This suite asserts the real "choose a space first" hint, so load actual English strings here,
// matching the convention established by SchemaSpacePicker.spec.ts and its siblings.
beforeAll(async () => {
  register('en-US', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
  await waitLocale('en-US');
});

/** Combobox only renders its listbox once focused. */
const openDropdown = async () => {
  await fireEvent.focus(field());
  return screen.getByRole('listbox');
};

describe('SchemaSpaceAlbumPicker', () => {
  beforeEach(() => {
    // Combobox measures viewport geometry on render; happy-dom provides neither global.
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', {
      height: 900,
      width: 1400,
      scale: 1,
      offsetLeft: 0,
      offsetTop: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    // This suite does not clear mocks between tests, so reset explicitly.
    vi.mocked(getSharedSpaceAlbums)
      .mockReset()
      .mockResolvedValue([album('album-1', 'Holidays 2026'), album('album-2', 'Birthdays')]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Combobox's clear button is an @immich/ui IconButton, which needs a Tooltip.Provider.
  const renderPicker = (props: { spaceId?: string; nextSpaceId?: string; initial?: string } = {}) =>
    renderWithTooltips(SchemaSpaceAlbumPickerWrapper, {
      spaceId: props.spaceId,
      nextSpaceId: props.nextSpaceId,
      initial: props.initial ?? '',
    });

  it('disables the field and explains why when no space is chosen yet', async () => {
    // A1 — typing a name before picking a space is the trap the free-text field allowed.
    renderPicker({ spaceId: undefined });

    expect(await screen.findByText('Choose a space first')).toBeInTheDocument();
    expect(field()).toBeDisabled();
    expect(getSharedSpaceAlbums).not.toHaveBeenCalled();
  });

  it("offers the chosen space's linked albums", async () => {
    // A2
    renderPicker({ spaceId: 'space-1' });

    await vi.waitFor(() => expect(getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 'space-1' }));
    await openDropdown();
    expect(optionLabels()).toEqual(['Holidays 2026', 'Birthdays']);
  });

  it('stores the name, not the id, when an existing album is picked', async () => {
    // A3 — the server resolves by name, so an id here would never match.
    renderPicker({ spaceId: 'space-1' });
    await vi.waitFor(() => expect(getSharedSpaceAlbums).toHaveBeenCalled());
    await openDropdown();

    await userEvent.click(screen.getByRole('option', { name: 'Holidays 2026' }));

    expect(boundValue()).toHaveTextContent('Holidays 2026');
  });

  it('stores a name that does not exist yet, so the step can create it', async () => {
    // A4 — resolve-or-create is the whole point; the picker must not restrict to the list.
    renderPicker({ spaceId: 'space-1' });
    await vi.waitFor(() => expect(getSharedSpaceAlbums).toHaveBeenCalled());
    await openDropdown();

    await userEvent.type(field(), 'Ski trip');
    await userEvent.click(screen.getByRole('option', { name: 'Ski trip' }));

    expect(boundValue()).toHaveTextContent('Ski trip');
  });

  it('commits a typed name without it being selected from the list', async () => {
    // A8 — the interaction that actually happens: type a new album name, then click Save. Nothing
    // ever selects the created option, and Combobox's blur handler discards unselected text, so a
    // commit that waits for selection silently saves "".
    renderPicker({ spaceId: 'space-1' });
    await vi.waitFor(() => expect(getSharedSpaceAlbums).toHaveBeenCalled());
    await openDropdown();

    await userEvent.type(field(), 'Ski trip');

    expect(boundValue()).toHaveTextContent('Ski trip');
  });

  it('shows the saved name when a step is reopened', async () => {
    // A9 — the step editor is reopened far more often than it is created.
    renderPicker({ spaceId: 'space-1', initial: 'Ski trip' });

    expect(await screen.findByDisplayValue('Ski trip')).toBeInTheDocument();
  });

  it('reloads the album list when the space changes but keeps the chosen name', async () => {
    // A5 — a name stays valid in any space, so re-scoping the list must not clear the value.
    renderPicker({ spaceId: 'space-1', nextSpaceId: 'space-2', initial: 'Ski trip' });
    await vi.waitFor(() => expect(getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 'space-1' }));

    vi.mocked(getSharedSpaceAlbums).mockResolvedValue([album('album-3', 'Reunion')]);
    await userEvent.click(screen.getByRole('button', { name: 'switch space' }));

    await vi.waitFor(() => expect(getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 'space-2' }));
    await openDropdown();
    expect(optionLabels()).toEqual(['Reunion']);
    expect(boundValue()).toHaveTextContent('Ski trip');
  });

  it('offers one option for albums whose names differ only by case', async () => {
    // A6 — the server matches case-insensitively and takes the oldest, so two rows here would
    // be two ways to pick the same album.
    vi.mocked(getSharedSpaceAlbums).mockResolvedValue([album('album-1', 'Holidays'), album('album-2', 'holidays')]);
    renderPicker({ spaceId: 'space-1' });
    await vi.waitFor(() => expect(getSharedSpaceAlbums).toHaveBeenCalled());

    await openDropdown();

    expect(optionLabels()).toEqual(['Holidays']);
  });

  it('still accepts a typed name when the album list cannot be loaded', async () => {
    // A7 — same rule as SchemaSpacePicker: a failed lookup must never take the step editor
    // down, because this is the field the user needs in order to fix the workflow.
    vi.mocked(getSharedSpaceAlbums).mockRejectedValue(new Error('nope'));
    renderPicker({ spaceId: 'space-1' });
    await vi.waitFor(() => expect(getSharedSpaceAlbums).toHaveBeenCalled());

    await openDropdown();
    await userEvent.type(field(), 'Ski trip');
    await userEvent.click(screen.getByRole('option', { name: 'Ski trip' }));

    expect(boundValue()).toHaveTextContent('Ski trip');
  });
});
