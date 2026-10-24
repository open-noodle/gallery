<script lang="ts" generics="T extends Record<string, unknown>">
  // Test-only: upstream's TestWrapper plus the query client the app's root layout provides.
  // Components that call createQuery() without an explicit client (upstream's NavigationBar,
  // for one) need it on context since the move to query modules (immich-32498 and follow-ups).
  import { queryClient } from '$lib/queries/client';
  import { TooltipProvider } from '@immich/ui';
  import { QueryClientProvider } from '@tanstack/svelte-query';
  import type { Component } from 'svelte';

  type Props = {
    component: Component<T>;
    componentProps: T;
  };

  const { component: Test, componentProps }: Props = $props();
</script>

<QueryClientProvider client={queryClient}>
  <TooltipProvider>
    <Test {...componentProps} />
  </TooltipProvider>
</QueryClientProvider>
