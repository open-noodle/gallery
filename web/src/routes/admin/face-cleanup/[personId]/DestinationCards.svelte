<script lang="ts">
  import { Route } from '$lib/route';
  import { getAdminFaceThumbnailUrl } from '$lib/utils/people-utils';
  import { Icon } from '@immich/ui';
  import { mdiAccount, mdiOpenInNew } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { sortDestinations, type SuspectedOwner } from './destination';

  // Where the flagged faces would go, as objects rather than a bare name. A suggestion pointing at
  // "Unnamed cluster" with no thumbnail, no size and no way to look at it is unactionable — that is the
  // report this component exists to answer.
  type Props = { owners: SuspectedOwner[] };
  const { owners }: Props = $props();

  const VISIBLE = 3;
  let expanded = $state(false);

  const ordered = $derived(sortDestinations(owners));
  const shown = $derived(expanded ? ordered : ordered.slice(0, VISIBLE));
  const hidden = $derived(ordered.length - shown.length);
</script>

{#if ordered.length === 0}
  <!-- The scan attributed these faces to nobody. Naming a destination here (the old code fell through to
       "Unnamed cluster") describes a person that does not exist. -->
  <p class="text-sm text-gray-500 dark:text-gray-400" data-testid="destination-none">
    {$t('admin.face_cleanup_review_dest_none')}
  </p>
{:else}
  <div class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
    {$t('admin.face_cleanup_review_dest_heading', { values: { count: ordered.length } })}
  </div>
  <ul class="mt-2 flex flex-col gap-2">
    {#each shown as owner (owner.ownerPersonId)}
      <li
        class={[
          'flex items-center gap-3 rounded-xl border px-3 py-2',
          owner.ownerMissing
            ? 'border-red-200 bg-red-50/50 dark:border-red-900/30 dark:bg-red-900/10'
            : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
        ].join(' ')}
        data-testid="destination-card"
      >
        {#if owner.thumbnailFaceId}
          <img
            src={getAdminFaceThumbnailUrl(owner.thumbnailFaceId)}
            alt=""
            loading="lazy"
            class="size-10 flex-none rounded-lg bg-gray-100 object-cover dark:bg-gray-700"
          />
        {:else}
          <!-- No representative face. The person-scoped thumbnail route 403s for a cluster the admin does not
               own, so falling back to it would render a broken image on exactly the unnamed clusters this
               feature exists for. -->
          <div
            class="flex size-10 flex-none items-center justify-center rounded-lg bg-gray-100 text-gray-400 dark:bg-gray-700"
            data-testid="destination-placeholder"
          >
            <Icon icon={mdiAccount} size="20" />
          </div>
        {/if}

        <div class="min-w-0 flex-1">
          <div class={owner.ownerName ? 'truncate text-sm font-semibold' : 'truncate text-sm text-gray-400 italic'}>
            {owner.ownerName ?? $t('admin.face_cleanup_review_unnamed')}
          </div>
          {#if owner.ownerMissing}
            <div class="text-xs text-red-600 dark:text-red-400" data-testid="destination-gone">
              {$t('admin.face_cleanup_review_dest_gone')}
            </div>
          {:else}
            <div class="font-mono text-xs text-gray-400">
              {owner.ownerPersonId.slice(0, 8)} ·
              <span class="font-sans">
                {$t('admin.face_cleanup_review_dest_size', { values: { count: owner.ownerFaceCount } })}
              </span>
            </div>
          {/if}
          <div class="text-xs text-gray-500 dark:text-gray-400">
            {$t('admin.face_cleanup_review_dest_routes', { values: { count: owner.count } })}
          </div>
        </div>

        {#if !owner.ownerMissing}
          <!-- New tab, always: every staged decision on the review page lives in memory and a same-tab
               navigation destroys the whole review. -->
          <a
            href={Route.viewFaceCleanupManualPerson({ id: owner.ownerPersonId })}
            target="_blank"
            rel="noopener noreferrer"
            title={$t('admin.face_cleanup_review_dest_open')}
            aria-label={$t('admin.face_cleanup_review_dest_open')}
            class="flex-none rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
            data-testid="destination-open"
          >
            <Icon icon={mdiOpenInNew} size="16" />
          </a>
        {/if}
      </li>
    {/each}
  </ul>
  {#if hidden > 0}
    <button
      type="button"
      onclick={() => (expanded = true)}
      class="mt-2 text-xs font-semibold text-primary hover:underline"
      data-testid="destination-more"
    >
      {$t('admin.face_cleanup_review_dest_more', { values: { count: hidden } })}
    </button>
  {/if}
{/if}
