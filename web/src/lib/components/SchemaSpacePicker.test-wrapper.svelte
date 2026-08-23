<script lang="ts">
  import SchemaSpacePicker from './SchemaSpacePicker.svelte';

  type Props = { array?: boolean; initial?: string[] };
  let { array = false, initial = [] }: Props = $props();

  let spaceIds = $state(initial);
</script>

<!-- Expose the wrapper's own state so tests can assert upward propagation. -->
<span data-testid="wrapper-space-ids">{spaceIds.join(',')}</span>
<SchemaSpacePicker label="Spaces" {array} bind:spaceIds />
