<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/user-page-layout.svelte';
  import EmptyPlaceholder from '$lib/components/shared-components/empty-placeholder.svelte';
  import SpaceCreateModal from '$lib/modals/SpaceCreateModal.svelte';
  import { Route } from '$lib/route';
  import { type SharedSpaceResponseDto } from '@immich/sdk';
  import { Button, modalManager } from '@immich/ui';
  import { mdiPlus } from '@mdi/js';
  import { goto } from '$app/navigation';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let spaces: SharedSpaceResponseDto[] = $state(data.spaces);

  const handleCreate = async () => {
    const space = await modalManager.show(SpaceCreateModal, {});
    if (space) {
      await goto(Route.viewSpace({ id: space.id }));
    }
  };
</script>

<UserPageLayout title={data.meta.title}>
  {#snippet buttons()}
    <Button shape="round" size="small" leadingIcon={mdiPlus} onclick={handleCreate}>
      {$t('spaces_create')}
    </Button>
  {/snippet}

  {#if spaces.length === 0}
    <EmptyPlaceholder text={$t('spaces_empty')} onClick={handleCreate} class="mt-10 mx-auto" />
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
      {#each spaces as space (space.id)}
        <a
          href={Route.viewSpace({ id: space.id })}
          class="rounded-2xl border border-gray-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 p-5 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
        >
          <h3 class="text-lg font-medium text-immich-fg dark:text-immich-dark-fg">{space.name}</h3>
          {#if space.description}
            <p class="text-sm text-immich-fg/75 dark:text-immich-dark-fg/75 mt-1">{space.description}</p>
          {/if}
          <div class="flex gap-4 mt-3 text-sm text-immich-fg/60 dark:text-immich-dark-fg/60">
            {#if space.memberCount != null}
              <span>{space.memberCount} {$t('members')}</span>
            {/if}
            {#if space.assetCount != null}
              <span>{space.assetCount} {$t('photos')}</span>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</UserPageLayout>
