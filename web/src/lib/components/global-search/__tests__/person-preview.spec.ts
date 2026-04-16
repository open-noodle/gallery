import { searchAssets } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PersonPreview from '../previews/person-preview.svelte';

vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return { ...actual, searchAssets: vi.fn() };
});

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
        person: { id: 'p1', name: 'Alice', faceAssetId: 'face1', numberOfAssets: 42 } as never,
      },
    });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText(/42 photos/)).toBeInTheDocument();
  });

  it('defers searchAssets by 300ms after mount', async () => {
    render(PersonPreview, { props: { person: { id: 'p1', name: 'Alice', faceAssetId: 'f' } as never } });
    await vi.advanceTimersByTimeAsync(200);
    expect(searchAssets).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(searchAssets).toHaveBeenCalledOnce();
  });

  it('falls back to placeholder when faceAssetId is missing', () => {
    const { container } = render(PersonPreview, {
      props: { person: { id: 'p1', name: 'NoFace' } as never },
    });
    expect(container.querySelector('img')).toBeNull();
  });
});
