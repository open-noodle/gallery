import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TextFilter from '$lib/components/filter-panel/text-filter.svelte';

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
