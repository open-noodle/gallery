<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { OperationReviewItem } from './agent-operation-plan-ui';
  import AgentPlanItemReview from './agent-plan-item-review.svelte';

  interface Props {
    item: OperationReviewItem;
    canChangeSelection: boolean;
    onClose: () => void;
    onToggleItem: (operationId: string, assetId: string, selected: boolean) => void;
    onBulkSetItems: (operationId: string, assetIds: string[], selected: boolean) => void;
    onSetOnlyItems: (operationId: string, assetIds: string[]) => void;
    onResetSelection: (operationId: string) => void;
  }

  let { item, canChangeSelection, onClose, onToggleItem, onBulkSetItems, onSetOnlyItems, onResetSelection }: Props =
    $props();

  let dialog: HTMLDivElement | undefined = $state();
  let closeButton: HTMLButtonElement | undefined = $state();
  const titleId = $derived(`agent-plan-photo-review-title-${item.id}`);

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab' || !dialog) {
      return;
    }

    const focusableElements = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hasAttribute('disabled') && !element.hidden && element.tabIndex >= 0);

    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements.at(-1);

    if (!firstFocusable || !lastFocusable) {
      event.preventDefault();
      return;
    }

    if (event.shiftKey) {
      if (document.activeElement === firstFocusable || !dialog.contains(document.activeElement)) {
        event.preventDefault();
        lastFocusable.focus();
      }
      return;
    }

    if (document.activeElement === lastFocusable || !dialog.contains(document.activeElement)) {
      event.preventDefault();
      firstFocusable.focus();
    }
  };

  onMount(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton?.focus();

    return () => {
      previousFocus?.focus();
    };
  });
</script>

<div class="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-2 sm:items-center sm:p-4">
  <button
    type="button"
    class="absolute inset-0 cursor-default"
    aria-label={$t('assistant_operation_photo_review_dismiss_backdrop')}
    tabindex="-1"
    onclick={onClose}
  ></button>

  <div
    bind:this={dialog}
    class="relative flex h-[min(92vh,58rem)] max-h-full w-full max-w-[96rem] flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-950"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <header class="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
      <div class="min-w-0">
        <h2 id={titleId} class="break-words text-lg font-semibold text-gray-900 dark:text-gray-100">
          {$t('assistant_operation_photo_review_title', { values: { summary: item.review.summary } })}
        </h2>
      </div>

      <button
        bind:this={closeButton}
        type="button"
        class="rounded-full px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-immich-primary dark:text-gray-300 dark:hover:bg-gray-800"
        onclick={onClose}
      >
        {$t('assistant_operation_photo_review_close')}
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <AgentPlanItemReview
        {item}
        {canChangeSelection}
        {onToggleItem}
        {onBulkSetItems}
        {onSetOnlyItems}
        {onResetSelection}
        variant="modal"
      />
    </div>

    <footer class="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
      <button
        type="button"
        class="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
        disabled={!canChangeSelection}
        onclick={() => onResetSelection(item.id)}
      >
        {$t('assistant_operation_photo_review_keep_original')}
      </button>
      <button
        type="button"
        class="rounded-lg bg-immich-primary px-4 py-2 text-sm font-semibold text-white hover:bg-immich-primary/90 focus:outline-none focus:ring-2 focus:ring-immich-primary focus:ring-offset-2 dark:bg-immich-dark-primary dark:hover:bg-immich-dark-primary/90 dark:focus:ring-offset-gray-950"
        onclick={onClose}
      >
        {$t('assistant_operation_photo_review_done')}
      </button>
    </footer>
  </div>
</div>
