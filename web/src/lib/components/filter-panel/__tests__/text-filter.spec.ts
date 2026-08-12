import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TextFilter from '$lib/components/filter-panel/text-filter.svelte';
import { TEXT_FILTER_PARAM_MAX_LENGTH } from '$lib/utils/filter-url';

describe('TextFilter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders three labelled inputs reflecting the current values', () => {
    render(TextFilter, {
      props: { description: 'beach', originalFileName: 'IMG_001', ocr: 'invoice', onChange: vi.fn() },
    });

    expect((screen.getByTestId('text-filter-description') as HTMLInputElement).value).toBe('beach');
    expect((screen.getByTestId('text-filter-filename') as HTMLInputElement).value).toBe('IMG_001');
    expect((screen.getByTestId('text-filter-ocr') as HTMLInputElement).value).toBe('invoice');
  });

  it('emits the trimmed description only after the debounce elapses', async () => {
    const onChange = vi.fn();
    render(TextFilter, { props: { onChange, debounceMs: 250 } });

    await fireEvent.input(screen.getByTestId('text-filter-description'), { target: { value: '  beach  ' } });
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(onChange).toHaveBeenCalledWith({ description: 'beach', originalFileName: undefined, ocr: undefined });
  });

  it('emits undefined for a cleared input', async () => {
    const onChange = vi.fn();
    render(TextFilter, { props: { description: 'beach', onChange, debounceMs: 250 } });

    await fireEvent.input(screen.getByTestId('text-filter-description'), { target: { value: '' } });
    vi.advanceTimersByTime(250);

    expect(onChange).toHaveBeenLastCalledWith({
      description: undefined,
      originalFileName: undefined,
      ocr: undefined,
    });
  });

  it('resets the input when the field is cleared externally (chip removal / clearFilters)', async () => {
    const { rerender } = render(TextFilter, { props: { description: 'beach', onChange: vi.fn() } });
    expect((screen.getByTestId('text-filter-description') as HTMLInputElement).value).toBe('beach');

    await rerender({ description: undefined, onChange: vi.fn() });

    expect((screen.getByTestId('text-filter-description') as HTMLInputElement).value).toBe('');
  });

  // E13: the URL codec clamps all three free-text filters to 200 characters, so the inputs must not
  // invite a longer value — a pasted 10KB description/filename/OCR string would be silently
  // truncated on the way into the URL (and reverse proxies commonly cap headers at ~8KB).
  it('bounds all three inputs to the URL codec length', () => {
    render(TextFilter, { props: { onChange: vi.fn() } });

    for (const testId of ['text-filter-description', 'text-filter-filename', 'text-filter-ocr']) {
      expect(screen.getByTestId(testId)).toHaveAttribute('maxlength', String(TEXT_FILTER_PARAM_MAX_LENGTH));
    }
  });

  it('keeps the three inputs independent', async () => {
    const onChange = vi.fn();
    render(TextFilter, { props: { onChange, debounceMs: 250 } });

    await fireEvent.input(screen.getByTestId('text-filter-ocr'), { target: { value: 'invoice' } });
    vi.advanceTimersByTime(250);

    expect(onChange).toHaveBeenLastCalledWith({
      description: undefined,
      originalFileName: undefined,
      ocr: 'invoice',
    });
  });
});
