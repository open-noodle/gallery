<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import TagFilterRow from './tag-filter-row.svelte';

  interface Props {
    id: string;
    name: string;
    checked: boolean;
    dimmed?: boolean;
    onToggle: (id: string) => void;
  }

  let props: Props = $props();
</script>

<!--
  Deliberately bits-ui's own Tooltip.Provider with DEFAULT options — not @immich/ui's TooltipProvider,
  which hard-codes disableCloseOnTriggerClick app-wide. Under bits-ui's defaults the trigger's own
  onclick genuinely calls handleClose, so a test rendered under this wrapper can actually distinguish
  "handleClick composes triggerProps.onclick" from "handleClick drops it and replaces it" — a
  regression no test under the real app's provider can catch, because that handler is a no-op there
  regardless of what this component does.
-->
<Tooltip.Provider>
  <TagFilterRow {...props} />
</Tooltip.Provider>
