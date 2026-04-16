import { searchAssets } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TagPreview from '../previews/tag-preview.svelte';

vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...actual,
    searchAssets: vi.fn(),
  };
});

describe('tag-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defers the fetch 300 ms after mount', async () => {
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    render(TagPreview, { props: { tag: { id: 't1', name: 'beach', color: null } as never } });
    await vi.advanceTimersByTimeAsync(200);
    expect(searchAssets).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(searchAssets).toHaveBeenCalledOnce();
  });

  it('renders "No photos tagged yet" on empty response', async () => {
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    render(TagPreview, { props: { tag: { id: 't1', name: 'beach', color: null } as never } });
    await vi.advanceTimersByTimeAsync(400);
    await Promise.resolve();
    expect(screen.getByText(/cmdk_no_tagged_photos|no photos tagged/i)).toBeInTheDocument();
  });

  it('renders the tag name in the header', () => {
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    render(TagPreview, { props: { tag: { id: 't1', name: 'mountain', color: null } as never } });
    expect(screen.getByText('mountain')).toBeInTheDocument();
  });
});
