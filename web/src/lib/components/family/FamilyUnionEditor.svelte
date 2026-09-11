<script lang="ts">
  import { FamilyUnionStatus } from '@immich/sdk';
  import { t, type Translations } from 'svelte-i18n';

  // Gallery-fork: family relationships (slice 11, A7). The ONLY place a union's status and dates
  // can be set — opened from the connector pill in `FamilyCanvas.svelte`, gated on `canContribute`
  // there (a view-only viewer never sees this component at all).

  export interface FamilyUnionEditorSave {
    status: FamilyUnionStatus;
    startDate: string | null;
    endDate: string | null;
  }

  interface Props {
    status: FamilyUnionStatus;
    startDate: string | null;
    endDate: string | null;
    onSave: (payload: FamilyUnionEditorSave) => void;
    onCancel: () => void;
    /** Mockup §2's danger action. Deletes the relationship, never the people in it. */
    onDelete: () => void;
  }

  let { status, startDate, endDate, onSave, onCancel, onDelete }: Props = $props();

  let draftStatus = $state<FamilyUnionStatus>(status);
  let draftStartDate = $state(startDate ?? '');
  let draftEndDate = $state(endDate ?? '');
  let dateError = $state<string | null>(null);

  const STATUS_OPTIONS: FamilyUnionStatus[] = [
    FamilyUnionStatus.Married,
    FamilyUnionStatus.Partnered,
    FamilyUnionStatus.Separated,
    FamilyUnionStatus.Divorced,
    FamilyUnionStatus.Widowed,
  ];

  const STATUS_KEYS: Record<FamilyUnionStatus, string> = {
    [FamilyUnionStatus.Married]: 'family_canvas_union_status_married',
    [FamilyUnionStatus.Partnered]: 'family_canvas_union_status_partnered',
    [FamilyUnionStatus.Separated]: 'family_canvas_union_status_separated',
    [FamilyUnionStatus.Divorced]: 'family_canvas_union_status_divorced',
    [FamilyUnionStatus.Widowed]: 'family_canvas_union_status_widowed',
  };

  function handleSave() {
    // A7: both dates are optional — a divorce with no end date is legal, because the date is
    // often simply unknown. Only reject when BOTH are present and out of order.
    if (draftStartDate && draftEndDate && draftEndDate < draftStartDate) {
      dateError = $t('family_edit_union_date_order_error');
      return;
    }
    dateError = null;
    onSave({
      status: draftStatus,
      startDate: draftStartDate || null,
      endDate: draftEndDate || null,
    });
  }
</script>

<!-- `bg-light`, not `bg-surface`: the latter is not a utility in this theme, so this panel
     rendered fully transparent and the cards behind it showed straight through it. -->
<div
  data-testid="family-union-editor"
  class="flex flex-col gap-3 rounded-lg border border-gray-300 bg-light p-3 shadow-lg dark:border-gray-700"
>
  <div class="flex flex-col gap-1 text-xs">
    <span class="font-semibold text-gray-500 uppercase">{$t('family_edit_union_status_label')}</span>
    <!-- A native `<select>` deliberately not used here: no other component in this codebase uses
         one (everywhere else reaches for `@immich/ui`'s custom dropdown), and a plain
         `<select bind:value>` turns out to be untestable under this project's happy-dom test
         environment — its `<option>` matching relies on the `:checked` CSS pseudo-class, which
         happy-dom does not update from a scripted value change, so every simulated selection
         silently resolves back to the first option. A small, fixed vocabulary of five statuses
         reads just as well as a row of toggle buttons, and sidesteps the whole class of bug. -->
    <div data-testid="family-union-status-options" role="radiogroup" class="flex flex-wrap gap-1">
      {#each STATUS_OPTIONS as option (option)}
        <button
          type="button"
          role="radio"
          aria-checked={draftStatus === option}
          data-testid="family-union-status-option"
          data-value={option}
          class="rounded-full border px-2 py-1 text-xs"
          class:border-primary={draftStatus === option}
          class:text-primary={draftStatus === option}
          class:border-gray-300={draftStatus !== option}
          class:dark:border-gray-700={draftStatus !== option}
          onclick={() => (draftStatus = option)}
        >
          {$t(STATUS_KEYS[option] as Translations)}
        </button>
      {/each}
    </div>
  </div>

  <div class="flex gap-2">
    <label class="flex flex-1 flex-col gap-1 text-xs">
      <span class="font-semibold text-gray-500 uppercase">{$t('family_edit_union_start_date_label')}</span>
      <input
        data-testid="family-union-start-date"
        type="date"
        class="rounded-sm border border-gray-300 p-1 dark:border-gray-700"
        bind:value={draftStartDate}
      />
    </label>
    <label class="flex flex-1 flex-col gap-1 text-xs">
      <span class="font-semibold text-gray-500 uppercase">{$t('family_edit_union_end_date_label')}</span>
      <input
        data-testid="family-union-end-date"
        type="date"
        class="rounded-sm border border-gray-300 p-1 dark:border-gray-700"
        bind:value={draftEndDate}
      />
    </label>
  </div>

  {#if dateError}
    <p data-testid="family-union-editor-error" class="text-xs text-warning">{dateError}</p>
  {/if}

  <div class="flex items-center gap-2">
    <button
      type="button"
      data-testid="family-union-editor-save"
      class="rounded-full bg-primary px-3 py-1 text-xs font-medium text-white dark:text-black"
      onclick={handleSave}
    >
      {$t('family_edit_union_save')}
    </button>
    <button
      type="button"
      data-testid="family-union-editor-cancel"
      class="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium dark:border-gray-700"
      onclick={onCancel}
    >
      {$t('family_edit_union_cancel')}
    </button>

    <span class="flex-1"></span>

    <button
      type="button"
      data-testid="family-union-delete"
      class="rounded-full px-2 py-1 text-xs font-medium text-red-500"
      onclick={onDelete}
    >
      {$t('family_edit_union_delete')}
    </button>
  </div>
</div>
