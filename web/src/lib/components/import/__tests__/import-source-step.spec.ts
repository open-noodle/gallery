import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import ImportSourceStep from '../import-source-step.svelte';

describe('ImportSourceStep', () => {
  const onNext = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders Google Photos source card', async () => {
    const { getByTestId } = await render(ImportSourceStep, { onNext });
    await expect.element(getByTestId('source-google')).toBeInTheDocument();
  });

  it('renders Apple Photos as disabled', async () => {
    const { getByTestId } = await render(ImportSourceStep, { onNext });
    await expect.element(getByTestId('source-apple')).toHaveAttribute('aria-disabled', 'true');
  });

  it('has Google Photos selected by default', async () => {
    const { getByTestId } = await render(ImportSourceStep, { onNext });
    await expect.element(getByTestId('source-google')).toHaveClass('border-primary');
  });

  it('calls onNext when Next clicked', async () => {
    const { getByText } = await render(ImportSourceStep, { onNext });

    await userEvent.click(getByText('next'));
    expect(onNext).toHaveBeenCalledOnce();
  });
});
