<script lang="ts">
  import { Route } from '$lib/route';
  import { Breadcrumbs, Heading, Text } from '@immich/ui';
  import { mdiSlashForward } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    title: string;
    subtitle?: Snippet;
    actions?: Snippet;
  };

  let { title, subtitle, actions }: Props = $props();
</script>

<header class="mb-4 flex flex-wrap items-center gap-3">
  <div class="min-w-0">
    <Breadcrumbs
      items={[
        { title: $t('utilities'), href: Route.utilities() },
        { title: $t('cleanup'), href: Route.cleanupUtility() },
        { title },
      ]}
      separator={mdiSlashForward}
    />
    <Heading size="medium" tag="h2" class="mt-1">{title}</Heading>
    <Text size="small" color="muted" class="mt-1 min-h-5 tabular-nums" data-testid="cleanup-queue-subtitle">
      {@render subtitle?.()}
    </Text>
  </div>
  {#if actions}
    <div class="ms-auto flex flex-wrap items-center gap-2">{@render actions()}</div>
  {/if}
</header>
