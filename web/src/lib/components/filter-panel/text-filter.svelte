<script lang="ts">
  import { TEXT_FILTER_PARAM_MAX_LENGTH } from '$lib/utils/filter-url';
  import { untrack } from 'svelte';
  import { t } from 'svelte-i18n';

  interface TextFilterValue {
    description?: string;
    originalFileName?: string;
    ocr?: string;
  }

  interface Props {
    description?: string;
    originalFileName?: string;
    ocr?: string;
    onChange: (next: TextFilterValue) => void;
    debounceMs?: number;
  }

  let { description, originalFileName, ocr, onChange, debounceMs = 250 }: Props = $props();

  // Local mirrors so typing stays responsive without waiting for the parent round-trip.
  let descriptionValue = $state(description ?? '');
  let filenameValue = $state(originalFileName ?? '');
  let ocrValue = $state(ocr ?? '');

  const normalize = (value: string): string | undefined => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  // Re-sync a mirror from its prop ONLY when the prop changes externally (e.g. clearFilters,
  // chip removal). `untrack` keeps the effect from depending on the local value, so it never
  // fights the user's in-progress typing. Resync only when they semantically differ.
  $effect(() => {
    const next = description ?? '';
    untrack(() => {
      if (normalize(descriptionValue) !== normalize(next)) {
        descriptionValue = next;
      }
    });
  });
  $effect(() => {
    const next = originalFileName ?? '';
    untrack(() => {
      if (normalize(filenameValue) !== normalize(next)) {
        filenameValue = next;
      }
    });
  });
  $effect(() => {
    const next = ocr ?? '';
    untrack(() => {
      if (normalize(ocrValue) !== normalize(next)) {
        ocrValue = next;
      }
    });
  });

  let timer: ReturnType<typeof setTimeout> | undefined;

  function scheduleEmit() {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      onChange({
        description: normalize(descriptionValue),
        originalFileName: normalize(filenameValue),
        ocr: normalize(ocrValue),
      });
    }, debounceMs);
  }
</script>

<div class="flex flex-col gap-2" data-testid="text-filter">
  <label class="flex flex-col gap-1 text-xs">
    <span class="text-gray-500 dark:text-gray-400">{$t('description')}</span>
    <input
      type="text"
      class="immich-form-input h-8 w-full rounded-lg px-2 text-sm"
      maxlength={TEXT_FILTER_PARAM_MAX_LENGTH}
      bind:value={descriptionValue}
      oninput={scheduleEmit}
      data-testid="text-filter-description"
    />
  </label>
  <label class="flex flex-col gap-1 text-xs">
    <span class="text-gray-500 dark:text-gray-400">{$t('file_name_text')}</span>
    <input
      type="text"
      class="immich-form-input h-8 w-full rounded-lg px-2 text-sm"
      maxlength={TEXT_FILTER_PARAM_MAX_LENGTH}
      bind:value={filenameValue}
      oninput={scheduleEmit}
      data-testid="text-filter-filename"
    />
  </label>
  <label class="flex flex-col gap-1 text-xs">
    <span class="text-gray-500 dark:text-gray-400">{$t('ocr')}</span>
    <input
      type="text"
      class="immich-form-input h-8 w-full rounded-lg px-2 text-sm"
      maxlength={TEXT_FILTER_PARAM_MAX_LENGTH}
      bind:value={ocrValue}
      oninput={scheduleEmit}
      data-testid="text-filter-ocr"
    />
  </label>
</div>
