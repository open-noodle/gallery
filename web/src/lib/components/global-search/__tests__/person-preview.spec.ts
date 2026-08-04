import { searchAssets } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import PersonPreview from '../previews/person-preview.svelte';

vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return { ...actual, searchAssets: vi.fn() };
});

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

describe('person-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the person name and count', () => {
    render(PersonPreview, {
      props: {
        person: { id: 'p1', name: 'Alice', numberOfAssets: 42 } as never,
      },
    });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('cmdk_preview_photo_count')).toBeInTheDocument();
  });

  it('defers searchAssets by 300ms after mount', async () => {
    render(PersonPreview, { props: { person: { id: 'p1', name: 'Alice' } as never } });
    await vi.advanceTimersByTimeAsync(200);
    expect(searchAssets).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(searchAssets).toHaveBeenCalledOnce();
    expect(searchAssets).toHaveBeenCalledWith(
      { metadataSearchDto: { personIds: ['p1'], size: 4, withSharedSpaces: true } },
      expect.anything(),
    );
  });

  it('renders the people thumbnail endpoint url', () => {
    const { container } = render(PersonPreview, {
      props: { person: { id: 'p1', name: 'Alice' } as never },
    });
    const img = container.querySelector(':scope [data-cmdk-preview-person] > img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toMatch(/\/api\/people\/p1\/thumbnail/);
  });

  it('uses scoped filter tokens and shared thumbnails for space-primary people', async () => {
    const { container } = render(PersonPreview, {
      props: {
        person: {
          id: 'space-person-1',
          name: 'Alice',
          filterId: 'space-person:space-person-1',
          primaryProfile: { type: 'space-person', id: 'space-person-1', spaceId: 'space-1' },
        } as never,
      },
    });
    const img = container.querySelector(':scope [data-cmdk-preview-person] > img');
    expect(img?.getAttribute('src')).toMatch(/\/api\/shared-spaces\/space-1\/people\/space-person-1\/thumbnail/);

    await vi.advanceTimersByTimeAsync(350);
    expect(searchAssets).toHaveBeenCalledWith(
      {
        metadataSearchDto: {
          personIds: ['space-person:space-person-1'],
          size: 4,
          withSharedSpaces: true,
        },
      },
      expect.anything(),
    );
  });

  it('swaps to placeholder when the thumbnail image fails to load', async () => {
    const { container } = render(PersonPreview, {
      props: { person: { id: 'p1', name: 'Alice' } as never },
    });
    const img = container.querySelector(':scope [data-cmdk-preview-person] > img');
    expect(img).not.toBeNull();
    await fireEvent.error(img!);
    expect(container.querySelector(':scope [data-cmdk-preview-person] > img')).toBeNull();
    expect(container.querySelector(':scope [data-cmdk-preview-person] > div[aria-hidden="true"]')).not.toBeNull();
  });

  it('offers a button to the person management page', () => {
    render(PersonPreview, { props: { person: { id: 'p1', name: 'Alice' } as never } });

    // This spec does not init svelte-i18n, so $t() returns the raw key.
    expect(screen.getByText('cmdk_open_person_page')).toBeInTheDocument();
  });

  it('navigates to the person page for a personal person', async () => {
    render(PersonPreview, {
      props: { person: { id: 'p1', name: 'Alice', primaryProfile: { id: 'p1', type: 'user-person' } } as never },
    });

    await fireEvent.click(screen.getByText('cmdk_open_person_page'));

    expect(goto).toHaveBeenCalledWith('/people/p1');
  });

  it('navigates to the profile id for a space person', async () => {
    render(PersonPreview, {
      props: {
        person: {
          id: 'sp1',
          name: 'Bob',
          primaryProfile: { id: 'profile-1', type: 'space-person', spaceId: 'space-1' },
        } as never,
      },
    });

    await fireEvent.click(screen.getByText('cmdk_open_person_page'));

    expect(goto).toHaveBeenCalledWith('/people/profile-1');
  });
});
