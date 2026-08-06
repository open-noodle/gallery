import { fireEvent, render, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import type { OperationReviewItem } from './agent-operation-plan-ui';
import AgentPlanInlineFieldEditor from './agent-plan-inline-field-editor.svelte';

vi.mock('$lib/utils', () => ({
  getAssetMediaUrl: ({ id, size }: { id: string; size: string }) => `/api/assets/${id}/thumbnail?size=${size}`,
}));

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_operation_field_cover_option: 'Use photo {index} as cover',
    assistant_operation_field_cover_thumbnail_alt: 'Cover photo option {index}',
    assistant_operation_field_reset: 'Reset {field}',
    assistant_operation_field_thumbnail_unavailable: 'Preview unavailable',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key)
        .replace('{field}', String(options?.values?.field ?? ''))
        .replace('{index}', String(options?.values?.index ?? '')),
    ),
  };
});

const operationId = '00000000-0000-4000-8000-000000000101';
const assetA = '00000000-0000-4000-8000-000000000201';
const assetB = '00000000-0000-4000-8000-000000000202';

const item = (overrides: Partial<OperationReviewItem> = {}): OperationReviewItem =>
  ({
    id: operationId,
    editableFields: [
      {
        key: 'albumName',
        label: 'Album name',
        input: 'text',
        originalValue: 'Portugal',
        value: 'Portugal highlights',
        required: true,
        maxLength: 200,
      },
      {
        key: 'description',
        label: 'Description',
        input: 'textarea',
        originalValue: '',
        value: '',
        required: false,
        maxLength: 1000,
      },
    ],
    fieldErrors: {},
    ...overrides,
  }) as OperationReviewItem;

describe('AgentPlanInlineFieldEditor', () => {
  it('renders text fields, sends field overrides, and resets changed fields', async () => {
    const onSetFieldOverride = vi.fn();
    const onResetFieldOverride = vi.fn();

    render(AgentPlanInlineFieldEditor, {
      props: {
        item: item(),
        canChangeSelection: true,
        onSetFieldOverride,
        onResetFieldOverride,
      },
    });

    await fireEvent.input(screen.getByLabelText('Album name'), { target: { value: 'Madeira' } });
    await fireEvent.input(screen.getByLabelText('Description'), { target: { value: 'Cliff walks' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Reset Album name' }));

    expect(onSetFieldOverride).toHaveBeenCalledWith(operationId, 'albumName', 'Madeira');
    expect(onSetFieldOverride).toHaveBeenCalledWith(operationId, 'description', 'Cliff walks');
    expect(onResetFieldOverride).toHaveBeenCalledWith(operationId, 'albumName');
  });

  it('shows field validation messages from item errors and disables controls when selection cannot change', async () => {
    const onSetFieldOverride = vi.fn();

    render(AgentPlanInlineFieldEditor, {
      props: {
        item: item({ fieldErrors: { albumName: 'Album name is required.' } }),
        canChangeSelection: false,
        onSetFieldOverride,
        onResetFieldOverride: vi.fn(),
      },
    });

    expect(screen.getByText('Album name is required.')).toBeInTheDocument();
    expect(screen.getByLabelText('Album name')).toBeDisabled();
    expect(screen.getByLabelText('Description')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset Album name' })).toBeDisabled();

    await fireEvent.input(screen.getByLabelText('Album name'), { target: { value: 'Ignored' } });

    expect(onSetFieldOverride).not.toHaveBeenCalled();
  });

  it('renders cover choices with accessible pressed state and per-thumbnail load fallbacks', async () => {
    const onSetFieldOverride = vi.fn();

    render(AgentPlanInlineFieldEditor, {
      props: {
        item: item({
          editableFields: [
            {
              key: 'albumThumbnailAssetId',
              label: 'Cover photo',
              input: 'coverAsset',
              originalValue: assetA,
              value: assetB,
              assetIds: [assetA, assetB],
              required: true,
            },
          ],
        }),
        canChangeSelection: true,
        fieldErrors: { albumThumbnailAssetId: 'Choose a selected cover photo.' },
        onSetFieldOverride,
        onResetFieldOverride: vi.fn(),
      },
    });

    const firstCover = screen.getByRole('button', { name: 'Use photo 1 as cover' });
    const secondCover = screen.getByRole('button', { name: 'Use photo 2 as cover' });

    expect(firstCover).toHaveAttribute('aria-pressed', 'false');
    expect(secondCover).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Choose a selected cover photo.')).toBeInTheDocument();

    await fireEvent.error(screen.getByAltText('Cover photo option 1'));
    await fireEvent.click(firstCover);

    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
    expect(onSetFieldOverride).toHaveBeenCalledWith(operationId, 'albumThumbnailAssetId', assetA);
  });

  it('renders select fields and sends selected option overrides', async () => {
    const onSetFieldOverride = vi.fn();
    const onResetFieldOverride = vi.fn();

    render(AgentPlanInlineFieldEditor, {
      props: {
        item: item({
          editableFields: [
            {
              key: 'color',
              label: 'Color',
              input: 'select',
              originalValue: 'green',
              value: 'blue',
              required: false,
              options: [
                { value: 'green', label: 'Green' },
                { value: 'blue', label: 'Blue' },
              ],
            },
          ],
        }),
        canChangeSelection: true,
        onSetFieldOverride,
        onResetFieldOverride,
      },
    });

    await fireEvent.change(screen.getByLabelText('Color'), { target: { value: 'green' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Reset Color' }));

    expect(onSetFieldOverride).toHaveBeenCalledWith(operationId, 'color', 'green');
    expect(onResetFieldOverride).toHaveBeenCalledWith(operationId, 'color');
  });
});
