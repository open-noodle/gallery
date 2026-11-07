import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import ImportFilesStep from '../import-files-step.svelte';

function makeFile(name: string, size: number): File {
  return new File(['x'.repeat(size)], name, { type: 'application/zip' });
}

describe('ImportFilesStep', () => {
  const defaultProps = {
    files: [] as File[],
    totalSize: 0,
    onAddFiles: vi.fn(),
    onClearFiles: vi.fn(),
    onNext: vi.fn(),
    onBack: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows drop zone when no files selected', async () => {
    const { getByTestId } = await render(ImportFilesStep, defaultProps);
    await expect.element(getByTestId('drop-zone')).toBeInTheDocument();
  });

  it('shows file list when files selected', async () => {
    const files = [makeFile('takeout-1.zip', 1024), makeFile('takeout-2.zip', 2048)];
    const { getByText } = await render(ImportFilesStep, { ...defaultProps, files, totalSize: 3072 });

    await expect.element(getByText('takeout-1.zip')).toBeInTheDocument();
    await expect.element(getByText('takeout-2.zip')).toBeInTheDocument();
  });

  it('disables Next when no files selected', async () => {
    const { getByTestId } = await render(ImportFilesStep, defaultProps);
    await expect.element(getByTestId('next-button')).toBeDisabled();
  });

  it('enables Next when files selected', async () => {
    const files = [makeFile('takeout.zip', 1024)];
    const { getByTestId } = await render(ImportFilesStep, { ...defaultProps, files, totalSize: 1024 });

    await expect.element(getByTestId('next-button')).toBeEnabled();
  });

  it('calls onBack when Back clicked', async () => {
    const { getByText } = await render(ImportFilesStep, defaultProps);

    await userEvent.click(getByText('back'));
    expect(defaultProps.onBack).toHaveBeenCalledOnce();
  });

  it('calls onClearFiles when Clear clicked', async () => {
    const files = [makeFile('takeout.zip', 1024)];
    const { getByText } = await render(ImportFilesStep, { ...defaultProps, files, totalSize: 1024 });

    await userEvent.click(getByText('import_clear'));
    expect(defaultProps.onClearFiles).toHaveBeenCalledOnce();
  });
});
