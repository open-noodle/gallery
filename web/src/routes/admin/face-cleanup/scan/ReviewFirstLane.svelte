<script lang="ts">
  import UserAvatar from '$lib/components/shared-components/UserAvatar.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { Route } from '$lib/route';
  import { getAdminFaceThumbnailUrl } from '$lib/utils/people-utils';
  import { getPeopleThumbnailPath, type UserAdminResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiAlertCircle, mdiArrowRight, mdiChevronRight, mdiClose, mdiMagnify } from '@mdi/js';
  import { t, type Translations } from 'svelte-i18n';
  import type { FaceCleanupPerson } from './scan-triage.svelte';

  // The review-first lane. Each cluster is a whole-row <a> to the per-cluster review page (which commits
  // inline) — the whole row is the affordance, no button to aim for. The dismiss control is an absolute
  // sibling ON TOP of the anchor (a <button> can't be nested inside an <a>), revealed on row hover, so a
  // cluster can be dropped without opening it. Row internals port from the deleted FaceCleanupTable.
  type Props = { people: FaceCleanupPerson[]; users: UserAdminResponseDto[]; onDismiss: (personId: string) => void };
  const { people, users, onDismiss }: Props = $props();

  const isReadOnlyDemo = $derived(authManager.isReadOnlyDemo);

  const usersById = $derived(new Map(users.map((u) => [u.id, u])));
  let query = $state('');

  const thumbUrl = (personId: string, thumbnailFaceId: string | null) =>
    thumbnailFaceId ? getAdminFaceThumbnailUrl(thumbnailFaceId) : `/api${getPeopleThumbnailPath(personId)}`;

  const reasonKeys: Record<string, string> = {
    'over-cap': 'admin.face_cleanup_reason_over_cap',
    named: 'admin.face_cleanup_reason_named',
    'large-cluster': 'admin.face_cleanup_reason_large_cluster',
    'multiple-owners': 'admin.face_cleanup_reason_multiple_owners',
    'bad-target': 'admin.face_cleanup_reason_bad_target',
  };

  // Column layout shared by the header row and every cluster row — width + responsive visibility live in one
  // place so the header cannot drift out of alignment with the rows it labels. The reasons column is
  // fixed-width on purpose: content truncates inside it instead of pushing the % / destination columns around.
  const COL_FLAGGED = 'hidden w-28 flex-none sm:block';
  const COL_DEST = 'hidden w-36 flex-none md:flex';
  const COL_REASONS = 'hidden w-28 flex-none lg:flex';
  const COL_HEADING = 'text-[11px] font-semibold tracking-wide text-gray-400 uppercase';

  const matches = (p: FaceCleanupPerson) => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return true;
    }
    const name = (p.personName ?? '').toLowerCase();
    const owner = p.suspectedOwners.map((o) => (o.ownerName ?? '').toLowerCase()).join(' ');
    return name.includes(q) || owner.includes(q);
  };
  const visible = $derived(people.filter((p) => matches(p)));

  const handleDismiss = (p: FaceCleanupPerson) => {
    if (confirm($t('admin.face_cleanup_dismiss_confirm', { values: { name: p.personName ?? p.personId } }))) {
      onDismiss(p.personId);
    }
  };
</script>

{#if people.length > 0}
  <section
    class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
    data-testid="review-lane"
  >
    <div class="flex flex-wrap items-center gap-4 p-5">
      <div
        class="flex size-11 flex-none items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-100 ring-inset dark:bg-amber-900/25 dark:text-amber-400 dark:ring-amber-900/40"
      >
        <Icon icon={mdiAlertCircle} size="22" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2.5">
          <h2 class="text-base font-semibold text-gray-900 dark:text-white">
            {$t('admin.face_cleanup_review_lane_title')}
          </h2>
          <span class="text-sm font-bold text-gray-500 tabular-nums">
            {$t('admin.face_cleanup_confident_count', { values: { count: people.length } })}
          </span>
        </div>
        <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{$t('admin.face_cleanup_review_lane_sub')}</p>
      </div>
      <div
        class="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900/40"
      >
        <Icon icon={mdiMagnify} size="16" class="flex-none text-gray-300" />
        <input
          bind:value={query}
          placeholder={$t('admin.face_cleanup_people_search_placeholder')}
          class="w-40 bg-transparent text-sm focus:outline-none"
          data-testid="review-search"
        />
      </div>
    </div>

    <div class="border-t border-gray-200 dark:border-gray-700">
      <div
        class="hidden items-center gap-4 border-b border-gray-200 bg-gray-50/60 py-2 pr-12 pl-5 sm:flex dark:border-gray-700 dark:bg-gray-900/30"
        data-testid="review-header"
      >
        <div class="w-10 flex-none" aria-hidden="true"></div>
        <div class="min-w-0 flex-1 {COL_HEADING}">{$t('admin.face_cleanup_col_cluster')}</div>
        <div class="{COL_FLAGGED} {COL_HEADING}">{$t('admin.face_cleanup_col_flagged')}</div>
        <div class="{COL_DEST} {COL_HEADING}">{$t('admin.face_cleanup_col_destination')}</div>
        <div class="{COL_REASONS} {COL_HEADING}">{$t('admin.face_cleanup_col_reasons')}</div>
      </div>
      {#each visible as person (person.personId)}
        {@const dest = person.suspectedOwners[0]}
        {@const owner = usersById.get(person.ownerId)}
        {@const bad = person.reviewReasons.includes('bad-target')}
        {@const pct = Math.round(person.flaggedFraction * 100)}
        <div
          class="group relative border-b border-gray-200 transition-colors last:border-b-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/50"
        >
          <!-- The whole row navigates; pr-12 reserves the right slot shared by the chevron (default) and the
               dismiss button (on hover), so a <button> is never nested inside the <a>. -->
          <a
            href={Route.viewFaceCleanupPerson({ id: person.personId })}
            class="flex items-center gap-4 py-3 pr-12 pl-5"
            data-testid={`review-row-${person.personId}`}
          >
            <img
              src={thumbUrl(person.personId, person.thumbnailFaceId)}
              alt=""
              loading="lazy"
              class="size-10 flex-none rounded-xl bg-gray-100 object-cover dark:bg-gray-700"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span
                  class={person.personName
                    ? 'truncate text-sm font-semibold'
                    : 'truncate text-sm font-medium text-gray-400 italic'}
                >
                  {person.personName ?? $t('admin.face_cleanup_unnamed')}
                </span>
                {#if owner}
                  <span class="inline-flex items-center gap-1 text-xs text-gray-400">
                    <UserAvatar user={owner} size="sm" />
                    {owner.name}
                  </span>
                {/if}
              </div>
              <div class="mt-0.5 font-mono text-xs text-gray-400">
                {person.personId.slice(0, 8)} · {person.faceCount}
                {$t('admin.face_cleanup_faces')}
              </div>
            </div>

            <div class={COL_FLAGGED}>
              <div class="flex items-baseline justify-between">
                <span class="text-sm font-bold tabular-nums">{pct}%</span>
                <span class="text-xs text-gray-400 tabular-nums">{person.flagged}/{person.faceCount}</span>
              </div>
              <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                <div
                  class={['h-full rounded-full', bad ? 'bg-red-500' : 'bg-amber-400'].join(' ')}
                  style={`width:${pct}%`}
                ></div>
              </div>
            </div>

            <div
              class="{COL_DEST} items-center gap-2"
              title={dest
                ? // Same key + formatting DestinationCards uses for this exact number (the routing share, not
                  // the destination's own size beneath it) — a bare "faces" noun here read as ambiguous between
                  // the two, and the raw (un-formatted) count disagreed with ownerFaceCount's .toLocaleString()
                  // right below it.
                  `${$t('admin.face_cleanup_review_dest_routes', { values: { count: dest.count } })} → ${dest.ownerName ?? $t('admin.face_cleanup_unnamed')}`
                : undefined}
              data-testid={`review-destination-${person.personId}`}
            >
              {#if dest}
                <Icon icon={mdiArrowRight} size="16" class="flex-none text-gray-300" />
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold">{dest.ownerName ?? $t('admin.face_cleanup_unnamed')}</div>
                  <!-- The destination's OWN size. This used to print `dest.count` — the flagged faces routing
                       here — directly under the destination's name, which read as "this cluster has 1 face". -->
                  <div class={bad ? 'text-xs text-red-500' : 'text-xs text-green-600'}>
                    {bad
                      ? $t('admin.face_cleanup_bad_target')
                      : `${dest.ownerFaceCount.toLocaleString()} ${$t('admin.face_cleanup_faces')}`}
                  </div>
                </div>
              {:else}
                <span class="text-xs text-gray-400">{$t('admin.face_cleanup_unattributable')}</span>
              {/if}
            </div>

            <!-- Fixed-width reasons column: one primary pill (bad-target wins) truncating inside it plus a "+N",
                 with EVERY reason spelled out in the title tooltip. The width is constant — including the
                 no-reason placeholder — so this column can never push % / destination out of line across rows. -->
            {#if person.reviewReasons.length > 0}
              {@const primaryReason = bad ? 'bad-target' : person.reviewReasons[0]}
              {@const reasonLabels = person.reviewReasons.map((r) =>
                Object.hasOwn(reasonKeys, r) ? $t(reasonKeys[r] as Translations) : r,
              )}
              <div
                class="{COL_REASONS} items-center gap-1.5"
                title={reasonLabels.join(' · ')}
                data-testid={`review-reasons-${person.personId}`}
              >
                <span
                  class={[
                    'min-w-0 truncate rounded-md px-1.5 py-0.5 text-[10px]',
                    primaryReason === 'bad-target'
                      ? 'bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
                  ].join(' ')}
                >
                  {Object.hasOwn(reasonKeys, primaryReason)
                    ? $t(reasonKeys[primaryReason] as Translations)
                    : primaryReason}
                </span>
                {#if person.reviewReasons.length > 1}
                  <span class="flex-none text-[10px] font-medium text-gray-400">+{person.reviewReasons.length - 1}</span
                  >
                {/if}
              </div>
            {:else}
              <div class={COL_REASONS} aria-hidden="true" data-testid={`review-reasons-${person.personId}`}></div>
            {/if}
          </a>

          <!-- Right slot: chevron by default, dismiss on row hover — both absolute over the same spot, so the
               row never widens for them. -->
          <span
            class="pointer-events-none absolute top-1/2 right-4 z-0 -translate-y-1/2 text-gray-300 transition-opacity group-hover:opacity-0"
            aria-hidden="true"
          >
            <Icon icon={mdiChevronRight} size="18" />
          </span>
          {#if !isReadOnlyDemo}
            <button
              type="button"
              class="pointer-events-none absolute top-1/2 right-3 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-600 focus:pointer-events-auto focus:opacity-100 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              aria-label={$t('admin.face_cleanup_dismiss')}
              title={$t('admin.face_cleanup_dismiss')}
              onclick={() => handleDismiss(person)}
              data-testid={`review-dismiss-${person.personId}`}
            >
              <Icon icon={mdiClose} size="16" />
            </button>
          {/if}
        </div>
      {/each}
      {#if visible.length === 0}
        <div class="px-6 py-8 text-center text-sm text-gray-400">{$t('admin.face_cleanup_no_results')}</div>
      {/if}
    </div>
  </section>
{/if}
