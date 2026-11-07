import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import PersonRow from '../rows/person-row.svelte';

describe('person-row', () => {
  it('renders the person name and asset count', async () => {
    await render(PersonRow, {
      props: {
        item: { id: 'p1', name: 'Alice', numberOfAssets: 42 } as never,
      },
    });
    await expect.element(page.getByText('Alice')).toBeInTheDocument();
    await expect.element(page.getByText('cmdk_preview_photo_count')).toBeInTheDocument();
  });

  it('falls back to "Unnamed person" label when name is empty', async () => {
    await render(PersonRow, {
      props: { item: { id: 'p1', name: '' } as never },
    });
    await expect.element(page.getByText(/cmdk_unnamed_person|Unnamed/)).toBeInTheDocument();
  });

  it('renders the people thumbnail endpoint url', async () => {
    const { container } = await render(PersonRow, {
      props: { item: { id: 'p1', name: 'Alice' } as never },
    });
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toMatch(/\/api\/people\/p1\/thumbnail/);
  });

  it('renders the shared-space person thumbnail for space-primary rows', async () => {
    const { container } = await render(PersonRow, {
      props: {
        item: {
          id: 'space-person-1',
          name: 'Alice',
          primaryProfile: { type: 'space-person', id: 'space-person-1', spaceId: 'space-1' },
        } as never,
      },
    });
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toMatch(/\/api\/shared-spaces\/space-1\/people\/space-person-1\/thumbnail/);
  });

  it('swaps to placeholder div when the thumbnail image fails to load', async () => {
    const { container } = await render(PersonRow, {
      props: { item: { id: 'p1', name: 'Alice' } as never },
    });
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    img!.dispatchEvent(new Event('error'));
    await vi.waitFor(() => {
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    });
  });

  it('does NOT set role="option"', async () => {
    const { container } = await render(PersonRow, {
      props: { item: { id: 'p1', name: 'X' } as never },
    });
    expect(container.querySelector('[role="option"]')).toBeNull();
  });
});
