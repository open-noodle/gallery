// new-space-list-item.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NewSpaceListItem from './new-space-list-item.svelte';

describe('NewSpaceListItem', () => {
  it('is disabled with an empty name', async () => {
    const screen = await render(NewSpaceListItem, { searchQuery: '', selected: false, onNewSpace: vi.fn() });
    await expect.element(screen.getByTestId('new-space-row')).toBeDisabled();
  });

  it('is disabled when the name exceeds 100 chars', async () => {
    const screen = await render(NewSpaceListItem, {
      searchQuery: 'x'.repeat(101),
      selected: false,
      onNewSpace: vi.fn(),
    });
    await expect.element(screen.getByTestId('new-space-row')).toBeDisabled();
  });

  it('is enabled and calls onNewSpace with the trimmed name', async () => {
    const onNewSpace = vi.fn();
    const screen = await render(NewSpaceListItem, { searchQuery: '  Family  ', selected: false, onNewSpace });
    const button = screen.getByTestId('new-space-row');
    await expect.element(button).toBeEnabled();
    await button.click();
    expect(onNewSpace).toHaveBeenCalledWith('Family');
  });

  it('explains via a hover title why it is disabled', async () => {
    const screen = await render(NewSpaceListItem, { searchQuery: '', selected: false, onNewSpace: vi.fn() });
    expect(screen.getByTestId('new-space-row').element().getAttribute('title')).toBe('new_space_requires_name');
  });

  it('drops the disabled-reason title once a valid name is entered', async () => {
    const screen = await render(NewSpaceListItem, { searchQuery: 'Family', selected: false, onNewSpace: vi.fn() });
    expect(screen.getByTestId('new-space-row').element().getAttribute('title')).toBeNull();
  });
});
