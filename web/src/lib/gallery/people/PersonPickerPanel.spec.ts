import { renderWithTooltips } from '#test/unit/helpers.ts';
import { expect } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import PersonPickerPanel from './PersonPickerPanel.svelte';

const renderPanel = (props: { onClose?: () => void; onQueryChange?: (query: string) => void } = {}) =>
  renderWithTooltips(PersonPickerPanel, {
    candidates: [],
    emptyLabel: 'no_people_found',
    onSelect: vi.fn(),
    onClose: props.onClose ?? vi.fn(),
    onQueryChange: props.onQueryChange,
  });

describe('PersonPickerPanel', () => {
  it('focuses the search field when it opens, so typing goes to the search', async () => {
    const onQueryChange = vi.fn();
    await renderPanel({ onQueryChange });

    const search = page.getByRole('textbox');
    await expect.element(search).toHaveFocus();

    await userEvent.keyboard('Bob');

    await expect.element(search).toHaveValue('Bob');
    expect(onQueryChange).toHaveBeenLastCalledWith('Bob');
  });

  // Both callers close the picker with a document-level Escape shortcut, and that shortcut skips
  // keys typed into a text field. With the field focused on open, Escape would otherwise do nothing
  // until the user clicked somewhere else first, so the field closes the picker itself.
  describe('Escape in the search field', () => {
    it('closes the picker, even with text typed', async () => {
      const onClose = vi.fn();
      await renderPanel({ onClose });
      await expect.element(page.getByRole('textbox')).toHaveFocus();

      await userEvent.keyboard('Bo{Escape}');

      expect(onClose).toHaveBeenCalledOnce();
    });

    // Marking the event handled is what keeps the callers' own document-level Escape (which would
    // close the whole side panel, not just the picker) from acting on the same key press.
    it('marks the key press handled', async () => {
      await renderPanel();
      const search = page.getByRole('textbox').element();
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

      search.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    // Escape during IME composition (Chinese, Japanese, Korean input) cancels the half-typed
    // candidate; it must not also throw the picker away.
    it('does nothing while an input method is composing', async () => {
      const onClose = vi.fn();
      await renderPanel({ onClose });
      const search = page.getByRole('textbox').element();
      const event = new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true });

      search.dispatchEvent(event);

      expect(onClose).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('leaves other keys alone', async () => {
      const onClose = vi.fn();
      await renderPanel({ onClose });
      await expect.element(page.getByRole('textbox')).toHaveFocus();

      await userEvent.keyboard('{Enter}{Tab}');

      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
