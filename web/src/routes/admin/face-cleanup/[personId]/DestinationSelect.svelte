<script lang="ts">
  import { t } from 'svelte-i18n';
  import { selectableDestinations, type SuspectedOwner } from './destination';

  // Where the two whole-cluster actions send faces. Both used to hardcode suspectedOwners[0], which silently
  // overrode the routing of every face the scan attributed to a secondary owner.
  type Props = {
    owners: SuspectedOwner[];
    value: string | null;
    // The label for `value` when it is NOT one of `owners` — reachable through "Choose someone else…", which
    // searches the whole library and can land on a person the scan never suggested. Without an <option> of its
    // own, a bound `value` that matches nothing in the list renders the control BLANK (the browser sets
    // selectedIndex -1) — the one control whose job is to say where the cluster is going would show nothing.
    valueLabel: string;
    onSelect: (ownerPersonId: string) => void;
    onChooseOther: () => void;
    // Without a scanPerson to scope the picker's ownerId to, "Choose someone else…" has nowhere to send the
    // admin — the caller passes this so the button stops looking clickable in that state. The <select> itself
    // is unaffected: its own options come from `owners`, not from scanPerson.
    disabled?: boolean;
  };
  const { owners, value, valueLabel, onSelect, onChooseOther, disabled = false }: Props = $props();

  // Deleted destinations are omitted, not disabled: the card above already explains why one is unusable, and
  // an option that guarantees a face-repair:destination-missing failure is only a chance to misclick.
  const options = $derived(selectableDestinations(owners));
  const isUnlisted = $derived(value !== null && options.every((o) => o.ownerPersonId !== value));

  const handleChange = (event: Event) => {
    onSelect((event.currentTarget as HTMLSelectElement).value);
  };
</script>

<div class="flex items-center gap-2 text-sm">
  <label class="flex items-center gap-2">
    <span class="text-gray-500 dark:text-gray-400">{$t('admin.face_cleanup_review_dest_send_to')}</span>
    <select
      value={value ?? ''}
      onchange={handleChange}
      class="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800"
      data-testid="destination-select"
    >
      {#if value === null}
        <option value="" disabled>{$t('admin.face_cleanup_review_dest_send_to')}</option>
      {/if}
      {#if isUnlisted}
        <option value={value ?? ''}>{valueLabel}</option>
      {/if}
      {#each options as owner (owner.ownerPersonId)}
        <option value={owner.ownerPersonId}>
          {$t('admin.face_cleanup_review_dest_option', {
            values: { name: owner.ownerName ?? $t('admin.face_cleanup_review_unnamed'), count: owner.ownerFaceCount },
          })}
        </option>
      {/each}
    </select>
  </label>
  <!-- A plain sibling button, NOT an <option> inside the select: an <option>'s value gets committed to the
       <select> the moment it is activated, before any handler runs, so putting "Choose someone else…" there
       meant a dismissed picker left the control reading that placeholder forever — re-selecting the SAME
       option fires no further `change` event in a real browser, so the select could never be used again. A
       sibling button never touches the select's value at all, so there is nothing to revert. -->
  <button
    type="button"
    onclick={onChooseOther}
    {disabled}
    class="text-sm font-semibold text-primary hover:underline disabled:opacity-40"
    data-testid="destination-choose-other"
  >
    {$t('admin.face_cleanup_review_dest_choose_other')}
  </button>
</div>
