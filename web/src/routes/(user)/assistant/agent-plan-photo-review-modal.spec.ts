import { fireEvent, render, screen, within } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { readable } from 'svelte/store';
import type { OperationReviewItem } from './agent-operation-plan-ui';
import AgentPlanPhotoReviewModal from './agent-plan-photo-review-modal.svelte';

vi.mock('$lib/utils', () => ({
  getAssetMediaUrl: ({ id, size }: { id: string; size: string }) => `/api/assets/${id}/thumbnail?size=${size}`,
}));

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_operation_item_deselect_all_filtered: 'Deselect all filtered',
    assistant_operation_item_empty_filter: 'No matching photos',
    assistant_operation_item_exclude_videos: 'Exclude videos',
    assistant_operation_item_exclude_visible: 'Exclude visible',
    assistant_operation_item_filter_label: 'Filter photos',
    assistant_operation_item_filter_placeholder: 'Filter photos',
    assistant_operation_item_include_only_videos: 'Include only videos',
    assistant_operation_item_include_visible: 'Include visible',
    assistant_operation_item_media_all: 'All',
    assistant_operation_item_media_photos: 'Photos',
    assistant_operation_item_media_videos: 'Videos',
    assistant_operation_item_quick_duplicates: 'Duplicates',
    assistant_operation_item_quick_screenshots: 'Screenshots',
    assistant_operation_item_reset: 'Reset selection',
    assistant_operation_item_review_label: 'Review photos for {summary}',
    assistant_operation_item_select_all_filtered: 'Select all filtered',
    assistant_operation_item_selected_count: '{selected} of {total} selected',
    assistant_operation_item_excluded_count: '{count} excluded',
    assistant_operation_item_thumbnail_unavailable: 'Preview unavailable',
    assistant_operation_item_toolbar_label: 'Photo review controls',
    assistant_operation_item_toggle: 'Include photo {index}',
    assistant_operation_item_virtual_summary: 'Showing {visible} of {total} photos',
    assistant_operation_photo_review_close: 'Close',
    assistant_operation_photo_review_dismiss_backdrop: 'Dismiss photo review backdrop',
    assistant_operation_photo_review_done: 'Done reviewing',
    assistant_operation_photo_review_keep_original: 'Keep original selection',
    assistant_operation_photo_review_selection: 'Selection',
    assistant_operation_photo_review_title: 'Review photos for {summary}',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key)
        .replace('{count}', String(options?.values?.count ?? ''))
        .replace('{index}', String(options?.values?.index ?? ''))
        .replace('{selected}', String(options?.values?.selected ?? ''))
        .replace('{summary}', String(options?.values?.summary ?? ''))
        .replace('{total}', String(options?.values?.total ?? ''))
        .replace('{visible}', String(options?.values?.visible ?? '')),
    ),
  };
});

const item = (): OperationReviewItem =>
  ({
    id: 'operation-1',
    operation: { assetIds: ['asset-1', 'asset-2'] },
    review: {
      summary: 'Add 2 photos',
      selection: {
        itemKind: 'asset',
        totalCount: 2,
        selectedCount: 1,
        mode: 'allExcept',
        itemIds: ['asset-2'],
        supportsItemSelection: true,
      },
    },
    excludedAssetCount: 1,
  }) as OperationReviewItem;

const defaultProps = (
  props: Partial<ComponentProps<typeof AgentPlanPhotoReviewModal>> = {},
): ComponentProps<typeof AgentPlanPhotoReviewModal> => ({
  item: item(),
  canChangeSelection: true,
  onClose: vi.fn(),
  onToggleItem: vi.fn(),
  onBulkSetItems: vi.fn(),
  onSetOnlyItems: vi.fn(),
  onResetSelection: vi.fn(),
  ...props,
});

describe('AgentPlanPhotoReviewModal', () => {
  it('renders a named dialog with the reusable review grid without a duplicate side selection summary', () => {
    render(AgentPlanPhotoReviewModal, { props: defaultProps() });

    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByTestId('agent-plan-item-review-grid')).toBeInTheDocument();
    expect(within(dialog).queryByRole('complementary', { name: 'Selection' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('1 of 2 selected')).toBeInTheDocument();
    expect(within(dialog).getByText('1 excluded')).toBeInTheDocument();
  });

  it('uses an expanded review surface for large photo selections', () => {
    render(AgentPlanPhotoReviewModal, { props: defaultProps() });

    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });

    expect(dialog).toHaveClass('max-w-[96rem]');
    expect(dialog).toHaveClass('h-[min(92vh,58rem)]');
  });

  it('focuses the close button on open, closes from Done reviewing and Escape, and restores focus', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open review';
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();

    const { unmount, rerender } = render(AgentPlanPhotoReviewModal, { props: defaultProps({ onClose }) });

    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
    const closeButton = within(dialog).getByRole('button', { name: 'Close' });
    expect(closeButton).toHaveFocus();

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Done reviewing' }));
    expect(onClose).toHaveBeenCalledOnce();

    await rerender(defaultProps({ onClose }));
    await fireEvent.keyDown(screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' }), {
      key: 'Escape',
    });
    expect(onClose).toHaveBeenCalledTimes(2);

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('wraps focus from the last focusable control to the first with Tab', async () => {
    render(AgentPlanPhotoReviewModal, { props: defaultProps() });

    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
    const closeButton = within(dialog).getByRole('button', { name: 'Close' });
    const doneButton = within(dialog).getByRole('button', { name: 'Done reviewing' });

    doneButton.focus();
    await fireEvent.keyDown(dialog, { key: 'Tab' });

    expect(closeButton).toHaveFocus();
  });

  it('wraps focus from the first focusable control to the last with Shift+Tab', async () => {
    render(AgentPlanPhotoReviewModal, { props: defaultProps() });

    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
    const closeButton = within(dialog).getByRole('button', { name: 'Close' });
    const doneButton = within(dialog).getByRole('button', { name: 'Done reviewing' });

    closeButton.focus();
    await fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

    expect(doneButton).toHaveFocus();
  });

  it('keeps Escape closing the modal while focus is contained', async () => {
    const onClose = vi.fn();
    render(AgentPlanPhotoReviewModal, { props: defaultProps({ onClose }) });

    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
    within(dialog).getByRole('button', { name: 'Close' }).focus();

    await fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
