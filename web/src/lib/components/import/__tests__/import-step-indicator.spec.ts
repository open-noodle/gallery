import { ImportStep } from '#lib/managers/import-manager.svelte.ts';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ImportStepIndicator from '../import-step-indicator.svelte';

describe('ImportStepIndicator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders all step labels', async () => {
    const { getByText } = await render(ImportStepIndicator, { currentStep: ImportStep.Source });

    await expect.element(getByText('import_step_source')).toBeInTheDocument();
    await expect.element(getByText('import_step_files')).toBeInTheDocument();
    await expect.element(getByText('import_step_scan')).toBeInTheDocument();
    await expect.element(getByText('import_step_review')).toBeInTheDocument();
    await expect.element(getByText('import_step_import')).toBeInTheDocument();
  });

  it('marks current step as active', async () => {
    const { getByTestId } = await render(ImportStepIndicator, { currentStep: ImportStep.Scan });

    expect(getByTestId('step-2').element().querySelector('.bg-primary')).not.toBeNull();
  });

  it('marks previous steps as completed', async () => {
    const { getByTestId } = await render(ImportStepIndicator, { currentStep: ImportStep.Review });

    await expect.element(getByTestId('step-0')).toHaveAttribute('data-completed', 'true');
    await expect.element(getByTestId('step-1')).toHaveAttribute('data-completed', 'true');
    await expect.element(getByTestId('step-2')).toHaveAttribute('data-completed', 'true');
  });

  it('marks future steps as inactive', async () => {
    const { getByTestId } = await render(ImportStepIndicator, { currentStep: ImportStep.Files });

    await expect.element(getByTestId('step-2')).toHaveAttribute('data-completed', 'false');
    await expect.element(getByTestId('step-3')).toHaveAttribute('data-completed', 'false');
    await expect.element(getByTestId('step-4')).toHaveAttribute('data-completed', 'false');
  });
});
