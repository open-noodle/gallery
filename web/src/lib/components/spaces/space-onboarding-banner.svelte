<script lang="ts">
  import type { SharedSpaceResponseDto } from '@immich/sdk';
  import {
    mdiAccountPlusOutline,
    mdiCheck,
    mdiChevronDown,
    mdiChevronUp,
    mdiImageFilterHdrOutline,
    mdiImagePlusOutline,
  } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    space: SharedSpaceResponseDto;
    gradientClass?: string;
    onAddPhotos: () => void;
    onInviteMembers: () => void;
    onSetCover: () => void;
  }

  let { space, gradientClass = '', onAddPhotos, onInviteMembers, onSetCover }: Props = $props();

  let collapsed = $state(false);

  const hasPhotos = $derived((space.assetCount ?? 0) > 0);
  const hasMembers = $derived((space.memberCount ?? 0) > 1);
  const hasCover = $derived(space.thumbnailAssetId !== null && space.thumbnailAssetId !== undefined);

  const completedCount = $derived((hasPhotos ? 1 : 0) + (hasMembers ? 1 : 0) + (hasCover ? 1 : 0));
  const allComplete = $derived(completedCount === 3);
  const progressPercent = $derived(Math.round((completedCount / 3) * 100));

  const steps = $derived([
    {
      id: 'add-photos',
      icon: mdiImagePlusOutline,
      label: $t('spaces_onboarding_add_photos'),
      description: $t('spaces_onboarding_add_photos_description'),
      complete: hasPhotos,
      action: onAddPhotos,
    },
    {
      id: 'invite-members',
      icon: mdiAccountPlusOutline,
      label: $t('spaces_onboarding_invite_members'),
      description: $t('spaces_onboarding_invite_members_description'),
      complete: hasMembers,
      action: onInviteMembers,
    },
    {
      id: 'set-cover',
      icon: mdiImageFilterHdrOutline,
      label: $t('spaces_onboarding_set_cover'),
      description: $t('spaces_onboarding_set_cover_description'),
      complete: hasCover,
      action: onSetCover,
    },
  ]);
</script>

{#if !allComplete}
  <div
    class="mx-4 mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-immich-dark-gray"
    data-testid="onboarding-banner"
    data-collapsed={collapsed}
  >
    <!-- Progress bar -->
    <div class="h-1 w-full bg-gray-100 dark:bg-gray-800">
      <div
        class="h-full bg-gradient-to-r transition-all duration-500 ease-out {gradientClass}"
        style="width: {progressPercent}%"
        data-testid="progress-bar-fill"
      ></div>
    </div>

    <!-- Header (always visible) -->
    <div class="flex items-center justify-between px-4 py-2.5">
      <p class="text-sm font-medium text-gray-600 dark:text-gray-300" data-testid="progress-text">
        {$t('spaces_setup_steps_done', { values: { completed: completedCount, total: 3 } })}
      </p>
      <button
        class="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        onclick={() => (collapsed = !collapsed)}
        data-testid="banner-collapse-toggle"
        aria-label={collapsed ? 'Expand' : 'Collapse'}
      >
        <Icon icon={collapsed ? mdiChevronDown : mdiChevronUp} size="20" />
      </button>
    </div>

    <!-- Steps (collapsible) -->
    {#if !collapsed}
      <div class="grid gap-1 px-4 pb-4 sm:grid-cols-3">
        {#each steps as step (step.id)}
          <div
            class="flex items-start gap-3 rounded-lg p-3 {step.complete
              ? 'bg-gray-50 dark:bg-gray-800/30'
              : 'bg-white dark:bg-transparent'}"
          >
            <!-- Step icon circle -->
            <div
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full {step.complete
                ? 'bg-gradient-to-br text-white ' + gradientClass
                : 'border-2 border-gray-300 text-gray-400 dark:border-gray-600 dark:text-gray-500'}"
            >
              {#if step.complete}
                <span data-testid="step-{step.id}-check">
                  <Icon icon={mdiCheck} size="16" />
                </span>
              {:else}
                <Icon icon={step.icon} size="16" />
              {/if}
            </div>

            <!-- Step content -->
            <div class="min-w-0 flex-1">
              <p
                class="text-sm font-medium {step.complete
                  ? 'text-gray-400 dark:text-gray-500'
                  : 'text-gray-800 dark:text-gray-100'}"
              >
                {step.label}
              </p>
              <p class="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                {step.description}
              </p>
              {#if !step.complete && step.action}
                <button
                  class="mt-2 text-xs font-medium text-immich-primary hover:text-immich-primary/80 dark:text-immich-dark-primary dark:hover:text-immich-dark-primary/80"
                  onclick={step.action}
                  data-testid="step-{step.id}-action"
                >
                  {step.label}
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
