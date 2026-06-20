// new-space-list-item.spec.ts
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import NewSpaceListItem from './new-space-list-item.svelte';

describe('NewSpaceListItem', () => {
  it('is disabled with an empty name', () => {
    render(NewSpaceListItem, { searchQuery: '', selected: false, onNewSpace: vi.fn() });
    expect((screen.getByTestId('new-space-row') as HTMLButtonElement).disabled).toBe(true);
  });

  it('is disabled when the name exceeds 100 chars', () => {
    render(NewSpaceListItem, { searchQuery: 'x'.repeat(101), selected: false, onNewSpace: vi.fn() });
    expect((screen.getByTestId('new-space-row') as HTMLButtonElement).disabled).toBe(true);
  });

  it('is enabled and calls onNewSpace with the trimmed name', async () => {
    const onNewSpace = vi.fn();
    render(NewSpaceListItem, { searchQuery: '  Family  ', selected: false, onNewSpace });
    const button = screen.getByTestId('new-space-row') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await fireEvent.click(button);
    expect(onNewSpace).toHaveBeenCalledWith('Family');
  });

  it('explains via a hover title why it is disabled', () => {
    render(NewSpaceListItem, { searchQuery: '', selected: false, onNewSpace: vi.fn() });
    expect(screen.getByTestId('new-space-row').getAttribute('title')).toBe('new_space_requires_name');
  });

  it('drops the disabled-reason title once a valid name is entered', () => {
    render(NewSpaceListItem, { searchQuery: 'Family', selected: false, onNewSpace: vi.fn() });
    expect(screen.getByTestId('new-space-row').getAttribute('title')).toBeNull();
  });
});
