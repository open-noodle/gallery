import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import ClassificationSettings from '$lib/components/user-settings-page/classification-settings.svelte';
import { Action2, type ClassificationCategoryResponseDto } from '@immich/sdk';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { tick } from 'svelte';

vi.mock('$lib/utils/handle-error', () => ({
  handleError: vi.fn(),
}));

import { handleError } from '$lib/utils/handle-error';

const makeCategory = (
  overrides: Partial<ClassificationCategoryResponseDto> = {},
): ClassificationCategoryResponseDto => ({
  id: 'cat-1',
  name: 'Screenshots',
  prompts: ['a screenshot of a phone', 'a screenshot of a computer'],
  similarity: 0.28,
  action: Action2.Tag,
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function renderComponent() {
  return render(
    TestWrapper as Component<{ component: typeof ClassificationSettings; componentProps: Record<string, never> }>,
    {
      component: ClassificationSettings,
      componentProps: {},
    },
  );
}

const flushAsync = async () => {
  await tick();
  await tick();
  await tick();
  await tick();
};

describe('ClassificationSettings (read-only)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getCategories.mockResolvedValue([]);
  });

  it('displays admin info text', async () => {
    renderComponent();
    await flushAsync();
    expect(screen.getByText('classification_managed_by_admin')).toBeInTheDocument();
  });

  it('displays category name and metadata when categories loaded', async () => {
    sdkMock.getCategories.mockResolvedValue([makeCategory()]);
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Screenshots')).toBeInTheDocument();
    });

    expect(screen.getByText('Tag only')).toBeInTheDocument();
    expect(screen.getByText(/Normal/)).toBeInTheDocument();
  });

  it('shows disabled state for disabled categories', async () => {
    sdkMock.getCategories.mockResolvedValue([makeCategory({ enabled: false })]);
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Screenshots')).toBeInTheDocument();
    });

    expect(screen.getByText('(Disabled)')).toBeInTheDocument();
  });

  it('shows empty state when no categories', async () => {
    renderComponent();
    await flushAsync();
    expect(screen.getByText('no_classification_categories')).toBeInTheDocument();
  });

  it('does not render Add Category or Scan buttons', async () => {
    renderComponent();
    await flushAsync();
    expect(screen.queryByText('Add Category')).not.toBeInTheDocument();
    expect(screen.queryByText('Scan Library')).not.toBeInTheDocument();
    expect(screen.queryByText('Scan All Libraries')).not.toBeInTheDocument();
  });

  it('error notification shown when SDK call fails', async () => {
    const error = new Error('Network error');
    sdkMock.getCategories.mockRejectedValue(error);
    renderComponent();

    await waitFor(() => {
      expect(handleError).toHaveBeenCalledWith(error, 'Unable to load classification categories');
    });
  });
});
