<script lang="ts">
  import { getAdminFaceThumbnailUrl } from '$lib/utils/people-utils';
  import { Icon } from '@immich/ui';
  import { mdiArrowRight, mdiCheckCircle, mdiChevronDown, mdiClose } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { Route } from '$lib/route';
  import type { ScanTriageModel } from './scan-triage.svelte';

  type Props = { model: ScanTriageModel; applying: boolean; onApprove: () => void };
  const { model, applying, onApprove }: Props = $props();

  let expanded = $state(false);
  const excludedCount = $derived(model.confident.length - model.approvedCount);
</script>

{#if model.confident.length > 0}
  <section
    class="relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
    data-testid="confident-lane"
  >
    <div class="flex flex-wrap items-center gap-4 p-5">
      <div
        class="flex size-11 flex-none items-center justify-center rounded-2xl bg-green-50 text-green-600 ring-1 ring-green-100 ring-inset dark:bg-green-900/25 dark:text-green-400 dark:ring-green-900/40"
      >
        <Icon icon={mdiCheckCircle} size="22" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2.5">
          <h2 class="text-base font-semibold text-gray-900 dark:text-white">
            {$t('admin.face_cleanup_confident_title')}
          </h2>
          <span class="text-sm font-bold text-gray-500 tabular-nums">
            {$t('admin.face_cleanup_confident_count', { values: { count: model.confident.length } })}
          </span>
        </div>
        <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{$t('admin.face_cleanup_confident_sub')}</p>
      </div>
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          onclick={() => (expanded = !expanded)}
          data-testid="confident-toggle"
        >
          {expanded ? $t('admin.face_cleanup_confident_hide') : $t('admin.face_cleanup_confident_review')}
          <Icon
            icon={mdiChevronDown}
            size="16"
            class={expanded ? 'rotate-180 transition-transform' : 'transition-transform'}
          />
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-full bg-green-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-40"
          disabled={applying || model.approvedCount === 0}
          onclick={onApprove}
          data-testid="confident-approve"
        >
          <!-- approvedCount is a plain-text node, not inside $t(): the sibling face-cleanup specs mock
               svelte-i18n as a key-passthrough that drops {values}, so an assertable count must render as
               its own text node. The label stays a static key. -->
          {excludedCount === 0
            ? $t('admin.face_cleanup_confident_approve_all')
            : $t('admin.face_cleanup_confident_approve')}
          {model.approvedCount}
          <Icon icon={mdiArrowRight} size="17" />
        </button>
      </div>
    </div>

    {#if expanded}
      <div
        class="border-t border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40"
        data-testid="confident-spotcheck"
      >
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {#each model.confident as person (person.personId)}
            {@const excluded = model.isExcluded(person.personId)}
            {@const dest = person.suspectedOwners[0]}
            <!-- Whole-chip link to the same per-cluster review page the review lane uses, so an admin can see
                 exactly what the auto-fix will do to a cluster before approving it. The exclude button cannot nest
                 inside the anchor, so it overlays the anchor's reserved right padding as an absolute sibling (same
                 pattern as ReviewFirstLane's dismiss). Excluded chips stay clickable — dimmed, not dead. -->
            <div
              class={[
                'relative rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
                excluded ? 'opacity-40' : '',
              ].join(' ')}
            >
              <a
                href={Route.viewFaceCleanupPerson({ id: person.personId })}
                class="flex items-center gap-2.5 rounded-xl p-2.5 pr-10 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                data-testid={`confident-open-${person.personId}`}
              >
                <img
                  src={getAdminFaceThumbnailUrl(person.thumbnailFaceId ?? '')}
                  alt=""
                  loading="lazy"
                  class="size-8 flex-none rounded-lg bg-gray-100 object-cover dark:bg-gray-700"
                />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-xs font-semibold text-gray-900 dark:text-white">
                    {person.personName ?? $t('admin.face_cleanup_unnamed')} · {person.faceCount}
                  </div>
                  <div class="truncate text-[11px] text-gray-400">
                    {Math.round(person.flaggedFraction * 100)}% → {dest?.ownerName ?? $t('admin.face_cleanup_unnamed')}
                  </div>
                </div>
              </a>
              <button
                type="button"
                class="absolute top-1/2 right-2.5 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-md bg-gray-100 text-gray-400 hover:text-gray-600 dark:bg-gray-700 dark:hover:text-gray-200"
                aria-pressed={excluded}
                aria-label={$t('admin.face_cleanup_confident_exclude')}
                title={$t('admin.face_cleanup_confident_exclude')}
                onclick={() => model.toggleExcluded(person.personId)}
                data-testid={`confident-exclude-${person.personId}`}
              >
                <Icon icon={mdiClose} size="14" />
              </button>
            </div>
          {/each}
        </div>
        <div class="mt-3 text-xs text-gray-500 dark:text-gray-400" data-testid="confident-spotcheck-summary">
          {$t('admin.face_cleanup_confident_summary', {
            values: { approved: model.approvedCount, total: model.confident.length, excluded: excludedCount },
          })}
        </div>
      </div>
    {/if}
  </section>
{/if}
