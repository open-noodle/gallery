<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import PurchaseContent from '$lib/components/shared-components/purchasing/PurchaseContent.svelte';
  import { Container, Stack } from '@immich/ui';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
</script>

<UserPageLayout title={data.meta.title}>
  <Container size="medium" center>
    <Stack gap={4} class="mt-4">
      <PurchaseContent />
    </Stack>
  </Container>
</UserPageLayout>
