import TextFilter from '#lib/components/filter-panel/text-filter.svelte';
import { TEXT_FILTER_PARAM_MAX_LENGTH } from '#lib/utils/filter-url.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const typeInto = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('TextFilter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders three labelled inputs reflecting the current values', async () => {
    const screen = await render(TextFilter, {
      description: 'beach',
      originalFileName: 'IMG_001',
      ocr: 'invoice',
      onChange: vi.fn(),
    });

    await expect.element(screen.getByTestId('text-filter-description')).toHaveValue('beach');
    await expect.element(screen.getByTestId('text-filter-filename')).toHaveValue('IMG_001');
    await expect.element(screen.getByTestId('text-filter-ocr')).toHaveValue('invoice');
  });

  it('emits the trimmed description only after the debounce elapses', async () => {
    const onChange = vi.fn();
    const screen = await render(TextFilter, { onChange, debounceMs: 250 });

    typeInto(screen.getByTestId('text-filter-description').element() as HTMLInputElement, '  beach  ');
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(onChange).toHaveBeenCalledWith({ description: 'beach', originalFileName: undefined, ocr: undefined });
  });

  it('emits undefined for a cleared input', async () => {
    const onChange = vi.fn();
    const screen = await render(TextFilter, { description: 'beach', onChange, debounceMs: 250 });

    typeInto(screen.getByTestId('text-filter-description').element() as HTMLInputElement, '');
    vi.advanceTimersByTime(250);

    expect(onChange).toHaveBeenLastCalledWith({
      description: undefined,
      originalFileName: undefined,
      ocr: undefined,
    });
  });

  it('resets the input when the field is cleared externally (chip removal / clearFilters)', async () => {
    const screen = await render(TextFilter, { description: 'beach', onChange: vi.fn() });
    expect((screen.getByTestId('text-filter-description').element() as HTMLInputElement).value).toBe('beach');

    await screen.rerender({ description: undefined, onChange: vi.fn() });

    expect((screen.getByTestId('text-filter-description').element() as HTMLInputElement).value).toBe('');
  });

  // E13: the URL codec clamps all three free-text filters to 200 characters, so the inputs must not
  // invite a longer value — a pasted 10KB description/filename/OCR string would be silently
  // truncated on the way into the URL (and reverse proxies commonly cap headers at ~8KB).
  it('bounds all three inputs to the URL codec length', async () => {
    const screen = await render(TextFilter, { onChange: vi.fn() });

    for (const testId of ['text-filter-description', 'text-filter-filename', 'text-filter-ocr']) {
      expect(screen.getByTestId(testId).element().getAttribute('maxlength')).toBe(String(TEXT_FILTER_PARAM_MAX_LENGTH));
    }
  });

  it('keeps the three inputs independent', async () => {
    const onChange = vi.fn();
    const screen = await render(TextFilter, { onChange, debounceMs: 250 });

    typeInto(screen.getByTestId('text-filter-ocr').element() as HTMLInputElement, 'invoice');
    vi.advanceTimersByTime(250);

    expect(onChange).toHaveBeenLastCalledWith({
      description: undefined,
      originalFileName: undefined,
      ocr: 'invoice',
    });
  });
});
