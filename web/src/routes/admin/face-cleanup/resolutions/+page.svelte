<script lang="ts">
  import AdminPageLayout from '$lib/components/layouts/AdminPageLayout.svelte';
  import { Route } from '$lib/route';
  import { getAdminFaceThumbnailUrl } from '$lib/utils/people-utils';
  import { getFaceRepairResolutions, getPeopleThumbnailPath, removeFaceRepairResolutions } from '@immich/sdk';
  import { Button, toastManager } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { handleError } from '$lib/utils/handle-error';
  import { faceCleanupBreadcrumbs } from '../breadcrumbs';

  // A single negative-verdict row: "this face is NOT that person", from either engine. Human PLACEMENTS are
  // deliberately not listed here (the server omits them) — they are unbounded and are undone in context on
  // the per-person review page instead.
  type VerdictSource = 'cleanup' | 'suggestion';
  type ResolutionItem = {
    id: string;
    assetFaceId: string;
    status: string;
    source: VerdictSource | string;
    personId: string | null;
    personName: string | null;
    personThumbnailFaceId: string | null;
    spacePersonId: string | null;
    spacePersonName: string | null;
    // Slice 11 (F23): the space-person twin of personThumbnailFaceId, projected from
    // shared_space_person.representativeFaceId — see face-person-verdict.repository.ts listNegativeVerdicts.
    spacePersonThumbnailFaceId: string | null;
    spaceName: string | null;
    actorId: string | null;
    actorName: string | null;
    createdAt: string;
  };

  const SOURCE_COLOR: Record<string, string> = {
    cleanup: '#7c3aed', // admin console — violet
    suggestion: '#16a34a', // user review — green
  };

  type SourceFilter = 'all' | VerdictSource;

  const PAGE_SIZE = 50;

  let resolutions = $state<ResolutionItem[]>([]);
  let total = $state(0);
  let page = $state(1);
  let loading = $state(true);
  let loadingMore = $state(false);
  let loadError = $state(false);
  let sourceFilter = $state<SourceFilter>('all');

  const hasMore = $derived(resolutions.length < total);

  const filtered = $derived(
    sourceFilter === 'all' ? resolutions : resolutions.filter((r) => r.source === sourceFilter),
  );

  // A negative-verdict face has no person↔face join by construction (that's what "not this person" means) —
  // the old person-scoped route's `getRepresentativeFaceForUpdate` join returns nothing for these rows,
  // 404-ing the row's thumbnail structurally. Face-keyed, admin-gated, no join required. The space-person
  // twin (F23) uses the exact same face-keyed route — there is no equivalent space-scoped thumbnail route
  // available to an admin who may not be a member of the space the verdict was recorded in.
  const faceThumbnailUrl = (faceId: string) => getAdminFaceThumbnailUrl(faceId);
  const personThumbUrl = (personId: string, thumbnailFaceId: string | null) =>
    thumbnailFaceId ? getAdminFaceThumbnailUrl(thumbnailFaceId) : `/api${getPeopleThumbnailPath(personId)}`;
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString();

  // "The target still exists but was never named" and "the target row is gone" are different states and get
  // different labels. Branch on the ID, never on the name: `person.name` / `shared_space_person.name` are NOT
  // NULL DEFAULT '' (see person.table.ts / shared-space-person.table.ts), so an unnamed-but-live target
  // arrives as an EMPTY STRING, not null — while `personId`/`spacePersonId` are ON DELETE SET NULL, so a
  // surviving id is itself proof the row is still there. Testing the name first inverted both cases: a live
  // unnamed cluster read as "deleted", and a genuinely deleted target read as "unnamed". Kysely types these
  // left-joined columns `string | null`, which is what makes the null-first shape look plausible; the data
  // cannot produce it.
  const targetName = (item: ResolutionItem) => {
    if (item.personId) {
      return item.personName || $t('admin.face_cleanup_unnamed');
    }
    if (item.spacePersonId) {
      return item.spacePersonName || $t('admin.face_cleanup_unnamed');
    }
    return $t('admin.face_cleanup_resolutions_target_deleted');
  };

  // Slice 11 (F23): the server paginates listNegativeVerdicts (page/size, capped at 200 — see
  // face-person-verdict.repository.ts and face-repair.dto.ts FaceRepairResolutionsQuerySchema), with a stable
  // `createdAt desc, id desc` order so a later page cannot repeat or skip a row a caller already has.
  // `total` is the server's count of ALL matching rows, not of the page — `hasMore` compares against it.
  const load = async (isFirstPage: boolean) => {
    if (isFirstPage) {
      loading = true;
      loadError = false;
    } else {
      loadingMore = true;
    }
    const requestedPage = isFirstPage ? 1 : page + 1;
    try {
      const dto = await getFaceRepairResolutions({ page: requestedPage, size: PAGE_SIZE });
      resolutions = isFirstPage ? dto.resolutions : [...resolutions, ...dto.resolutions];
      total = dto.total;
      page = requestedPage;
    } catch (error) {
      // D17: a failed load is not the same as a genuinely empty resolutions list — render a distinct error
      // state (below) with a Retry, rather than the reassuring "no decisions recorded yet" empty card. A
      // failed load-more, unlike a failed first load, is not fatal to the page — the rows already shown stay
      // exactly as they were; only the first page's failure gets the full error state.
      if (isFirstPage) {
        loadError = true;
        handleError(error, $t('admin.face_cleanup_resolutions_load_error'));
      } else {
        handleError(error, $t('admin.face_cleanup_resolutions_load_error'));
      }
    } finally {
      if (isFirstPage) {
        loading = false;
      } else {
        loadingMore = false;
      }
    }
  };

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) {
      return;
    }
    void load(false);
  };

  onMount(() => load(true));

  const handleUndo = async (item: ResolutionItem) => {
    try {
      await removeFaceRepairResolutions({
        faceRepairResolutionsRemoveRequestDto: { verdictIds: [item.id] },
      });
      toastManager.success($t('admin.face_cleanup_resolutions_undo_success'));
      await load(true);
    } catch {
      toastManager.danger($t('admin.face_cleanup_undo_error'));
    }
  };

  // $derived, not a plain array evaluated once at init: a plain array captures whatever $t(...) returned at
  // component construction and never re-evaluates, so the chips stayed in the mount-time language forever
  // after a locale switch.
  const filters = $derived<{ value: SourceFilter; label: string }[]>([
    { value: 'all', label: $t('admin.face_cleanup_resolutions_filter_all') },
    { value: 'cleanup', label: $t('admin.face_cleanup_resolutions_filter_cleanup') },
    { value: 'suggestion', label: $t('admin.face_cleanup_resolutions_filter_suggestion') },
  ]);
</script>

<AdminPageLayout breadcrumbs={faceCleanupBreadcrumbs($t, { title: $t('admin.face_cleanup_resolutions_title') })}>
  <div class="mx-auto max-w-screen-xl p-6">
    <!-- Header -->
    <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold tracking-tight">{$t('admin.face_cleanup_resolutions_title')}</h1>
        <!-- The list's scope, stated on the page rather than only in the comment above. An admin who cleans up
             a person by MOVING or CONFIRMING faces records no negative verdict at all (the only writer of a
             cleanup-sourced one is the "keep here" bucket), so without this line an empty list reads as lost
             work. Sits outside the loading/empty/error branches below because the empty states are exactly
             when the explanation is needed. -->
        <p class="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400" data-testid="resolutions-subtitle">
          {$t('admin.face_cleanup_resolutions_subtitle')}
        </p>
      </div>

      <!-- Source filter -->
      <div class="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800" data-testid="source-filter">
        {#each filters as filter (filter.value)}
          <button
            type="button"
            class="rounded-lg px-3 py-1 text-sm font-medium transition-colors"
            class:bg-white={sourceFilter === filter.value}
            class:shadow-sm={sourceFilter === filter.value}
            class:dark:bg-gray-700={sourceFilter === filter.value}
            class:text-gray-500={sourceFilter !== filter.value}
            data-testid="source-filter-option"
            data-value={filter.value}
            aria-pressed={sourceFilter === filter.value}
            onclick={() => (sourceFilter = filter.value)}
          >
            {filter.label}
          </button>
        {/each}
      </div>
    </div>

    {#if loading}
      <div class="flex items-center justify-center py-20 text-gray-400">
        <span>{$t('loading')}</span>
      </div>
    {:else if loadError}
      <div
        class="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400"
        data-testid="load-error-banner"
      >
        <span class="flex-1">{$t('admin.face_cleanup_resolutions_load_error')}</span>
        <Button color="secondary" size="small" onclick={() => load(true)} data-testid="load-error-retry">
          {$t('retry')}
        </Button>
      </div>
    {:else if resolutions.length === 0}
      <!-- Genuinely nothing has ever been recorded — never confused with the filter having excluded
           everything below, which is a different (and much less alarming) state for an admin to be told. -->
      <div class="rounded-2xl border border-dashed border-gray-200 py-20 text-center dark:border-gray-700">
        <div class="text-lg font-medium text-gray-500">{$t('admin.face_cleanup_resolutions_empty')}</div>
        <div class="mt-4">
          <Button color="secondary" href={Route.faceCleanup()}>{$t('admin.face_cleanup')}</Button>
        </div>
      </div>
    {:else if filtered.length === 0}
      <!-- The filter hid everything. Say WHICH source is empty and how much is being hidden, so this reads as
           "your history is intact, you're just looking through a chip" rather than as lost work — that
           mistaken reading is what sent an admin hunting for cleanup decisions that were never recorded.
           The precise wording is gated on `!hasMore`: `filtered` derives from `resolutions`, which holds only
           the pages fetched so far, so "no cleanup decisions yet" is a claim about the WHOLE list that only
           the fully-loaded case can support — with pages outstanding a match may simply not be fetched yet,
           and the neutral wording (plus a Load more, which otherwise lives in the rows branch and would be
           unreachable here) is the honest answer. -->
      <div class="rounded-2xl border border-dashed border-gray-200 py-20 text-center dark:border-gray-700">
        <div class="text-lg font-medium text-gray-500">
          {#if hasMore}
            {$t('admin.face_cleanup_resolutions_empty_filtered')}
          {:else if sourceFilter === 'cleanup'}
            {$t('admin.face_cleanup_resolutions_empty_filtered_cleanup')}
          {:else}
            {$t('admin.face_cleanup_resolutions_empty_filtered_suggestion')}
          {/if}
        </div>
        <div class="mt-1 text-sm text-gray-400" data-testid="empty-filtered-hidden">
          {$t('admin.face_cleanup_resolutions_empty_filtered_hidden', { values: { count: resolutions.length } })}
        </div>
        <div class="mt-4 flex justify-center gap-2">
          <Button
            color="secondary"
            size="small"
            data-testid="empty-filtered-show-all"
            onclick={() => (sourceFilter = 'all')}
          >
            {$t('admin.face_cleanup_resolutions_empty_filtered_show_all')}
          </Button>
          {#if hasMore}
            <Button
              color="secondary"
              size="small"
              disabled={loadingMore}
              onclick={handleLoadMore}
              data-testid="resolutions-load-more"
            >
              {loadingMore
                ? $t('loading')
                : $t('admin.face_cleanup_resolutions_load_more', { values: { count: total - resolutions.length } })}
            </Button>
          {/if}
        </div>
      </div>
    {:else}
      <div class="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700" data-testid="verdicts-list">
        {#each filtered as item (item.id)}
          <div
            class="flex items-center gap-4 border-b border-gray-200 px-4 py-3 last:border-b-0 dark:border-gray-700"
            data-testid="resolution-row"
            data-source={item.source}
          >
            <!-- Source marker -->
            <span
              class="size-2.5 flex-none rounded-xs"
              style="background: {SOURCE_COLOR[item.source] ?? '#9ca3af'}"
              title={item.source}
            ></span>

            <!-- Face thumbnail: always available (face-keyed, no person↔face join required) -->
            <img
              src={faceThumbnailUrl(item.assetFaceId)}
              alt=""
              class="size-10 flex-none rounded-xl bg-gray-100 object-cover dark:bg-gray-700"
            />

            <!-- Info -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 text-sm">
                <span class="font-semibold">
                  {$t('admin.face_cleanup_resolutions_not_person', { values: { name: targetName(item) } })}
                </span>
                {#if item.spaceName}
                  <span class="text-xs text-gray-400">
                    {$t('admin.face_cleanup_resolutions_in_space', { values: { name: item.spaceName } })}
                  </span>
                {/if}
              </div>
              <div class="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
                <span data-testid="source-label">
                  {item.source === 'cleanup'
                    ? $t('admin.face_cleanup_resolutions_source_cleanup')
                    : $t('admin.face_cleanup_resolutions_source_suggestion')}
                </span>
                {#if item.actorName}
                  <span>· {$t('admin.face_cleanup_resolutions_by_actor', { values: { name: item.actorName } })}</span>
                {/if}
                <span>· {formatDate(item.createdAt)}</span>
              </div>
            </div>

            <!-- Target person thumbnail. A space-person target (F23) renders one too, via the same face-keyed
                 admin route a personal target uses — there is no equivalent space-scoped thumbnail route
                 available to an admin who may not be a member of the space the verdict was recorded in, and
                 (unlike a personal target) there is no fallback when representativeFaceId is null. -->
            {#if item.personId}
              <img
                src={personThumbUrl(item.personId, item.personThumbnailFaceId)}
                alt=""
                class="size-8 flex-none rounded-full bg-gray-100 object-cover dark:bg-gray-700"
                data-testid="target-thumbnail"
              />
            {:else if item.spacePersonId && item.spacePersonThumbnailFaceId}
              <img
                src={faceThumbnailUrl(item.spacePersonThumbnailFaceId)}
                alt=""
                class="size-8 flex-none rounded-full bg-gray-100 object-cover dark:bg-gray-700"
                data-testid="target-thumbnail"
              />
            {/if}

            <!-- Undo button -->
            <Button color="secondary" size="small" data-testid="undo-button" onclick={() => handleUndo(item)}>
              {$t('admin.face_cleanup_resolutions_undo')}
            </Button>
          </div>
        {/each}
      </div>

      {#if hasMore}
        <div class="mt-4 flex justify-center">
          <Button
            color="secondary"
            size="small"
            disabled={loadingMore}
            onclick={handleLoadMore}
            data-testid="resolutions-load-more"
          >
            {loadingMore
              ? $t('loading')
              : $t('admin.face_cleanup_resolutions_load_more', { values: { count: total - resolutions.length } })}
          </Button>
        </div>
      {/if}
    {/if}
  </div>
</AdminPageLayout>
