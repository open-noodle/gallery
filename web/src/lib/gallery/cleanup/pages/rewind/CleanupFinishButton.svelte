<script lang="ts">
  import { Button } from '@immich/ui';
  import { mdiCheck } from '@mdi/js';

  type Props = {
    /** "Finish October 29". */
    label: string;
    size?: 'small' | 'medium';
    disabled?: boolean;
    loading?: boolean;
    testId?: string;
    onclick: () => void;
  };

  const { label, size = 'medium', disabled = false, loading = false, testId, onclick }: Props = $props();
</script>

<!-- The one button that applies the day's marks: trashes the marked photos, saves keeps and
     favourites, and marks the date reviewed. Same look wherever it appears. -->
<Button
  {size}
  shape="round"
  color="success"
  trailingIcon={mdiCheck}
  {disabled}
  {loading}
  {onclick}
  data-testid={testId}
>
  {label}
</Button>
