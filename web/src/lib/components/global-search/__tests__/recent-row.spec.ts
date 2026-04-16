import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import RecentRow from '../rows/recent-row.svelte';

describe('recent-row', () => {
  it('renders query kind with text', () => {
    render(RecentRow, {
      props: { entry: { kind: 'query', id: 'q:beach', text: 'beach', mode: 'smart', lastUsed: 1 } },
    });
    expect(screen.getByText('beach')).toBeInTheDocument();
  });

  it('dispatches to PhotoRow for photo kind', () => {
    render(RecentRow, {
      props: { entry: { kind: 'photo', id: 'photo:a1', assetId: 'a1', label: 'sunset.jpg', lastUsed: 1 } },
    });
    expect(screen.getByText('sunset.jpg')).toBeInTheDocument();
  });

  it('dispatches to PersonRow for person kind', () => {
    render(RecentRow, {
      props: { entry: { kind: 'person', id: 'person:p1', personId: 'p1', label: 'Alice', lastUsed: 1 } },
    });
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('dispatches to PlaceRow for place kind', () => {
    render(RecentRow, {
      props: {
        entry: {
          kind: 'place',
          id: 'place:48.8566:2.3522',
          latitude: 48.8566,
          longitude: 2.3522,
          label: 'Paris',
          lastUsed: 1,
        },
      },
    });
    expect(screen.getByText('Paris')).toBeInTheDocument();
  });

  it('dispatches to TagRow for tag kind', () => {
    render(RecentRow, {
      props: { entry: { kind: 'tag', id: 'tag:t1', tagId: 't1', label: 'beach', lastUsed: 1 } },
    });
    expect(screen.getByText('beach')).toBeInTheDocument();
  });
});
