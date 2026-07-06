<!--
  Minimal stand-in for @immich/ui's <Select>. The real component wraps bits-ui's
  portal-based listbox, whose option highlighting/selection cannot be driven in
  jsdom (the existing SpaceMembersModal.spec asserts the trigger but never opens
  the dropdown for this reason). This stub reproduces the *observable* contract
  the page relies on:
    - a trigger <button aria-haspopup="listbox"> whose accessible name is the
      selected option's label (matching the real Select, e.g. "role_editor"), so
      Select-vs-RoleBadge rendering can be asserted the same way as the real one;
    - one click target per option exposing onChange(value) so role-change and
      remove flows can be driven without bits-ui.
-->
<script lang="ts" generics="T extends string">
  import type { SelectOption } from '@immich/ui';

  interface Props {
    value?: T;
    options: SelectOption<T>[];
    onChange?: (value: T) => void;
  }

  let { value, options, onChange }: Props = $props();

  const selectedLabel = $derived(options.find((o) => o.value === value)?.label ?? value ?? '');
</script>

<div data-testid="role-select">
  <button type="button" aria-haspopup="listbox" aria-expanded="false">{selectedLabel}</button>
  {#each options as option (option.value)}
    <button type="button" data-testid="role-option-{option.value}" onclick={() => onChange?.(option.value)}>
      {option.label}
    </button>
  {/each}
</div>
