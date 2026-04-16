import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import PersonRow from '../rows/person-row.svelte';

describe('person-row', () => {
  it('renders the person name and asset count', () => {
    render(PersonRow, {
      props: {
        item: { id: 'p1', name: 'Alice', faceAssetId: 'face1', numberOfAssets: 42 } as never,
      },
    });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText(/42 photos/)).toBeInTheDocument();
  });

  it('falls back to "Unnamed person" label when name is empty', () => {
    render(PersonRow, {
      props: { item: { id: 'p1', name: '', faceAssetId: 'face1' } as never },
    });
    expect(screen.getByText(/cmdk_unnamed_person|Unnamed/)).toBeInTheDocument();
  });

  it('renders a placeholder div when faceAssetId is missing', () => {
    const { container } = render(PersonRow, {
      props: { item: { id: 'p1', name: 'NoFace' } as never },
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('does NOT set role="option"', () => {
    const { container } = render(PersonRow, {
      props: { item: { id: 'p1', name: 'X', faceAssetId: 'f' } as never },
    });
    expect(container.querySelector('[role="option"]')).toBeNull();
  });
});
