<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import type { AgentOperationEditableField, OperationReviewItem } from './agent-operation-plan-ui';

  interface Props {
    item: OperationReviewItem;
    canChangeSelection: boolean;
    fieldErrors?: Record<string, string>;
    onSetFieldOverride: (operationId: string, fieldKey: string, value: string | undefined) => void;
    onResetFieldOverride: (operationId: string, fieldKey: string) => void;
  }

  let { item, canChangeSelection, fieldErrors, onSetFieldOverride, onResetFieldOverride }: Props = $props();
  let failedAssetIds = $state(new Set<string>());

  const errors = $derived(fieldErrors ?? item.fieldErrors);

  const isChanged = (field: AgentOperationEditableField) => field.value !== field.originalValue;

  const setFieldOverride = (fieldKey: string, value: string | undefined) => {
    if (!canChangeSelection) {
      return;
    }

    onSetFieldOverride(item.id, fieldKey, value);
  };

  const resetFieldOverride = (fieldKey: string) => {
    if (!canChangeSelection) {
      return;
    }

    onResetFieldOverride(item.id, fieldKey);
  };

  const markFailed = (assetId: string) => {
    if (failedAssetIds.has(assetId)) {
      return;
    }

    failedAssetIds = new Set([...failedAssetIds, assetId]);
  };
</script>

{#if item.editableFields.length > 0}
  <section class="mt-3 grid gap-3" aria-label="Editable fields">
    {#each item.editableFields as field (field.key)}
      <div class="grid gap-1.5">
        {#if field.input === 'text'}
          <label class="text-xs font-medium text-gray-600 dark:text-gray-300" for={`${item.id}-${field.key}`}>
            {field.label}
          </label>
          <input
            id={`${item.id}-${field.key}`}
            class="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            type="text"
            value={field.value}
            maxlength={field.maxLength}
            required={field.required}
            disabled={!canChangeSelection}
            aria-invalid={errors[field.key] ? 'true' : undefined}
            aria-describedby={errors[field.key] ? `${item.id}-${field.key}-error` : undefined}
            oninput={(event) => setFieldOverride(field.key, event.currentTarget.value)}
          />
        {:else if field.input === 'textarea'}
          <label class="text-xs font-medium text-gray-600 dark:text-gray-300" for={`${item.id}-${field.key}`}>
            {field.label}
          </label>
          <textarea
            id={`${item.id}-${field.key}`}
            class="min-h-20 w-full resize-y rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            value={field.value}
            maxlength={field.maxLength}
            required={field.required}
            disabled={!canChangeSelection}
            aria-invalid={errors[field.key] ? 'true' : undefined}
            aria-describedby={errors[field.key] ? `${item.id}-${field.key}-error` : undefined}
            oninput={(event) => setFieldOverride(field.key, event.currentTarget.value)}
          ></textarea>
        {:else if field.input === 'coverAsset'}
          <div class="text-xs font-medium text-gray-600 dark:text-gray-300">{field.label}</div>
          <div class="flex flex-wrap gap-2">
            {#each field.assetIds as assetId, index (assetId)}
              <button
                type="button"
                class="relative size-16 overflow-hidden rounded-md border bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-800"
                class:border-immich-primary={field.value === assetId}
                class:border-gray-200={field.value !== assetId}
                class:dark:border-immich-dark-primary={field.value === assetId}
                class:dark:border-gray-700={field.value !== assetId}
                aria-label={$t('assistant_operation_field_cover_option', { values: { index: index + 1 } })}
                aria-pressed={field.value === assetId}
                disabled={!canChangeSelection}
                onclick={() => setFieldOverride(field.key, assetId)}
              >
                <img
                  class="size-full object-cover"
                  src={getAssetMediaUrl({ id: assetId, size: AssetMediaSize.Thumbnail })}
                  alt={$t('assistant_operation_field_cover_thumbnail_alt', { values: { index: index + 1 } })}
                  loading="lazy"
                  draggable="false"
                  onerror={() => markFailed(assetId)}
                />
                {#if failedAssetIds.has(assetId)}
                  <span
                    class="absolute inset-0 flex items-center justify-center bg-gray-200 px-1 text-center text-[10px] leading-tight text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  >
                    {$t('assistant_operation_field_thumbnail_unavailable')}
                  </span>
                {/if}
              </button>
            {/each}
          </div>
        {:else if field.input === 'select'}
          <label class="text-xs font-medium text-gray-600 dark:text-gray-300" for={`${item.id}-${field.key}`}>
            {field.label}
          </label>
          <select
            id={`${item.id}-${field.key}`}
            class="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            value={field.value}
            disabled={!canChangeSelection}
            aria-invalid={errors[field.key] ? 'true' : undefined}
            aria-describedby={errors[field.key] ? `${item.id}-${field.key}-error` : undefined}
            onchange={(event) => setFieldOverride(field.key, event.currentTarget.value)}
          >
            {#each field.options as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        {/if}

        {#if errors[field.key]}
          <p id={`${item.id}-${field.key}-error`} class="text-xs text-red-700 dark:text-red-300">{errors[field.key]}</p>
        {/if}

        {#if isChanged(field)}
          <button
            type="button"
            class="w-fit rounded-md px-2 py-1 text-xs font-medium text-immich-primary hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-immich-dark-primary dark:hover:bg-gray-800"
            disabled={!canChangeSelection}
            onclick={() => resetFieldOverride(field.key)}
          >
            {$t('assistant_operation_field_reset', { values: { field: field.label } })}
          </button>
        {/if}
      </div>
    {/each}
  </section>
{/if}
