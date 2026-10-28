<script lang="ts">
  import AdminPageLayout from '$lib/components/layouts/AdminPageLayout.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { getFaceDissolves, restoreFaceDissolve, type DissolveListResponseDto } from '@immich/sdk';
  import { Button, modalManager, toastManager } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { faceCleanupBreadcrumbs } from '../breadcrumbs';

  // Every person dissolved from the console (specs/2026-09-06-dissolve-person-design.md, Revision 2). Restoring
  // brings back the detected faces a dissolve hid, unnamed; recognition then sorts them again.
  type DissolveItem = DissolveListResponseDto['items'][number];

  const PAGE_SIZE = 50;

  let items = $state<DissolveItem[]>([]);
  let page = $state(1);
  let hasMore = $state(false);
  let loading = $state(true);
  let loadingMore = $state(false);
  let loadError = $state(false);
  let restoringId = $state<string | null>(null);

  const formatDate = (value: string) => new Date(value).toLocaleString();

  const load = async (isFirstPage: boolean) => {
    if (isFirstPage) {
      loading = true;
      loadError = false;
    } else {
      loadingMore = true;
    }
    const requestedPage = isFirstPage ? 1 : page + 1;
    try {
      const dto = await getFaceDissolves({ page: requestedPage, size: PAGE_SIZE });
      items = isFirstPage ? dto.items : [...items, ...dto.items];
      hasMore = dto.hasMore;
      page = requestedPage;
    } catch (error) {
      if (isFirstPage) {
        loadError = true;
      }
      handleError(error, $t('admin.face_cleanup_dissolved_load_error'));
    } finally {
      loading = false;
      loadingMore = false;
    }
  };

  const handleRestore = async (item: DissolveItem) => {
    const confirmed = await modalManager.showDialog({
      title: $t('admin.face_cleanup_dissolved_restore'),
      prompt: $t('admin.face_cleanup_dissolved_restore_confirm', { values: { count: item.restorableCount } }),
    });
    if (!confirmed) {
      return;
    }

    restoringId = item.id;
    try {
      const { restored } = await restoreFaceDissolve({ id: item.id });
      toastManager.success($t('admin.face_cleanup_dissolved_restore_success', { values: { count: restored } }));
      await load(true);
    } catch (error) {
      handleError(error, $t('errors.something_went_wrong'));
    } finally {
      restoringId = null;
    }
  };

  onMount(() => load(true));
</script>

<AdminPageLayout breadcrumbs={faceCleanupBreadcrumbs($t, { title: $t('admin.face_cleanup_dissolved') })}>
  <div class="mx-auto max-w-screen-xl p-6">
    <div class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight">{$t('admin.face_cleanup_dissolved')}</h1>
      <p class="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
        {$t('admin.face_cleanup_dissolved_subtitle')}
      </p>
    </div>

    {#if loading}
      <div class="flex items-center justify-center py-20 text-gray-400">
        <span>{$t('loading')}</span>
      </div>
    {:else if loadError}
      <div
        class="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400"
      >
        <span class="flex-1">{$t('admin.face_cleanup_dissolved_load_error')}</span>
        <Button color="secondary" size="small" onclick={() => load(true)}>{$t('retry')}</Button>
      </div>
    {:else if items.length === 0}
      <div class="rounded-2xl border border-dashed border-gray-200 py-20 text-center dark:border-gray-700">
        <div class="text-lg font-medium text-gray-500">{$t('admin.face_cleanup_dissolved_empty')}</div>
      </div>
    {:else}
      <ul class="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700">
        {#each items as item (item.id)}
          <li
            class="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3 last:border-b-0 dark:border-gray-700"
            data-testid="dissolve-row"
          >
            <div class="min-w-0 flex-1">
              <div class="font-medium">{item.personName || $t('admin.face_cleanup_unnamed')}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">
                {item.ownerName} · {formatDate(item.createdAt)}
              </div>
              <div class="text-sm text-gray-500 dark:text-gray-400">
                {$t('admin.face_cleanup_dissolved_summary', {
                  values: { hidden: item.hiddenCount, deleted: item.deletedCount, unassigned: item.unassignedCount },
                })}
              </div>
            </div>
            <div class="text-sm">
              {#if item.restoredAt}
                {$t('admin.face_cleanup_dissolved_restored', { values: { date: formatDate(item.restoredAt) } })}
              {:else}
                {$t('admin.face_cleanup_dissolved_restorable', { values: { count: item.restorableCount } })}
              {/if}
            </div>
            <Button
              color="secondary"
              size="small"
              disabled={!!item.restoredAt || item.restorableCount === 0 || restoringId !== null}
              onclick={() => handleRestore(item)}
            >
              {$t('admin.face_cleanup_dissolved_restore')}
            </Button>
          </li>
        {/each}
      </ul>
      {#if hasMore}
        <div class="mt-4 flex justify-center">
          <Button color="secondary" size="small" disabled={loadingMore} onclick={() => load(false)}>
            {loadingMore ? $t('loading') : $t('load_more')}
          </Button>
        </div>
      {/if}
    {/if}
  </div>
</AdminPageLayout>
