import { renderWithTooltips } from '#test/unit/helpers.ts';
import { expect } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import PersonPickerPanel from './PersonPickerPanel.svelte';

describe('PersonPickerPanel', () => {
  it('focuses the search field when it opens, so typing goes to the search', async () => {
    const onQueryChange = vi.fn();
    await renderWithTooltips(PersonPickerPanel, {
      candidates: [],
      emptyLabel: 'no_people_found',
      onSelect: vi.fn(),
      onClose: vi.fn(),
      onQueryChange,
    });

    const search = page.getByRole('textbox');
    await expect.element(search).toHaveFocus();

    await userEvent.keyboard('Bob');

    await expect.element(search).toHaveValue('Bob');
    expect(onQueryChange).toHaveBeenLastCalledWith('Bob');
  });
});
