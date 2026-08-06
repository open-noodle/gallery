<script lang="ts">
  import { AgentPermissionPreset } from '@immich/sdk';
  import { t, type Translations } from 'svelte-i18n';
  import { isCloudProvider, type OnboardingProviderId } from './agent-onboarding-model';

  interface Props {
    provider: OnboardingProviderId;
    preset: AgentPermissionPreset;
    onChange: (preset: AgentPermissionPreset) => void;
  }
  let { provider, preset, onChange }: Props = $props();

  // sees: [photoDetails, thumbnails, originals]
  const PRESETS = [
    {
      value: AgentPermissionPreset.Careful,
      labelKey: 'assistant_permission_preset_careful',
      descKey: 'assistant_permission_preset_careful_description',
      sees: [true, false, false] as const,
      chips: [
        'assistant_onboarding_chip_albums_spaces',
        'assistant_onboarding_chip_tags',
        'assistant_onboarding_chip_favorites',
      ] as Translations[],
      noChips: ['assistant_onboarding_chip_edit', 'assistant_onboarding_chip_trash', 'assistant_onboarding_chip_share'],
      tag: null as Translations | null,
      tagStyle: '',
    },
    {
      value: AgentPermissionPreset.VisualOrganizer,
      labelKey: 'assistant_permission_preset_visual_organizer',
      descKey: 'assistant_permission_preset_visual_organizer_description',
      sees: [true, true, false] as const,
      chips: [
        'assistant_onboarding_chip_everything_careful',
        'assistant_onboarding_chip_edit_archive',
        'assistant_onboarding_chip_curate_content',
        'assistant_onboarding_chip_share_people',
      ] as Translations[],
      noChips: ['assistant_onboarding_chip_original_files', 'assistant_onboarding_chip_public_links'],
      tag: 'assistant_onboarding_recommended' as Translations | null,
      tagStyle: 'text-primary bg-primary/10',
    },
    {
      value: AgentPermissionPreset.LocalPowerUser,
      labelKey: 'assistant_permission_preset_local_power_user',
      descKey: 'assistant_permission_preset_local_power_user_description',
      sees: [true, true, true] as const,
      chips: [
        'assistant_onboarding_chip_everything_above',
        'assistant_onboarding_chip_original_files',
        'assistant_onboarding_chip_public_links',
        'assistant_onboarding_chip_locked_folder',
        'assistant_onboarding_chip_delete_albums',
      ] as Translations[],
      noChips: [] as Translations[],
      tag: 'assistant_onboarding_local_models' as Translations | null,
      tagStyle: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950',
    },
  ] as const;

  const METER_LABELS = [
    'assistant_onboarding_meter_photo_details',
    'assistant_onboarding_meter_thumbnails',
    'assistant_onboarding_meter_originals',
  ] as const;

  const showCloudCaution = $derived(preset === AgentPermissionPreset.LocalPowerUser && isCloudProvider(provider));
</script>

<div class="flex flex-col gap-5">
  <!-- Eyebrow + title + subtitle -->
  <div>
    <p class="mb-3 text-[12px] font-bold uppercase tracking-[0.09em] text-primary">
      {$t('assistant_onboarding_access_eyebrow')}
    </p>
    <h2 class="text-[30px] font-extrabold leading-[1.08] tracking-[-0.025em] text-gray-900 dark:text-white">
      {$t('assistant_onboarding_access_title')}
    </h2>
    <p class="mt-2.5 max-w-[46ch] text-[15.5px] leading-relaxed text-gray-500 dark:text-neutral-400">
      {$t('assistant_onboarding_access_subtitle')}
    </p>
  </div>

  <!-- Preset cards -->
  <div role="group" aria-label={$t('assistant_onboarding_access_group_label')} class="flex flex-col gap-2.5">
    {#each PRESETS as p (p.value)}
      {@const isSelected = preset === p.value}
      <button
        type="button"
        aria-pressed={isSelected ? 'true' : 'false'}
        aria-label={$t(p.labelKey)}
        onclick={() => onChange(p.value)}
        class="w-full cursor-pointer rounded-2xl border-[1.5px] p-4 text-left transition-all
          {isSelected
          ? 'border-primary bg-primary/5 shadow-[0_0_0_3px_rgba(66,80,175,0.28)]'
          : 'border-gray-300 bg-white hover:-translate-y-px dark:border-gray-700 dark:bg-immich-dark-gray'}"
      >
        <!-- Grid: title+desc col | meter col -->
        <div class="grid grid-cols-[1fr_auto] gap-x-3.5 gap-y-1">
          <!-- title row -->
          <div class="flex items-center gap-2">
            <span class="text-[15px] font-bold tracking-[-0.01em] text-gray-900 dark:text-white">{$t(p.labelKey)}</span>
            {#if p.tag}
              <span
                class="rounded-full px-[7px] py-[3px] text-[10.5px] font-bold uppercase tracking-[0.04em] {p.tagStyle}"
              >
                {$t(p.tag)}
              </span>
            {/if}
          </div>

          <!-- meter (right column, spans 2 rows) -->
          <div class="row-span-2 flex min-w-[92px] flex-col items-end justify-center gap-1.5 self-center">
            {#each METER_LABELS as mLabel, i (mLabel)}
              <span
                class="flex items-center gap-1.5 text-[11px] font-semibold
                  {p.sees[i] ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-600'}"
              >
                <span
                  class="h-[7px] w-[7px] flex-none rounded-full
                    {p.sees[i]
                    ? isSelected
                      ? 'bg-primary shadow-[0_0_0_3px_rgba(66,80,175,0.28)]'
                      : 'bg-primary'
                    : 'bg-gray-300 dark:bg-gray-600'}"
                ></span>
                {$t(mLabel)}
              </span>
            {/each}
          </div>

          <!-- description (left column, row 2) -->
          <p class="text-[13px] leading-[1.45] text-gray-500 dark:text-neutral-400 mt-0.5">{$t(p.descKey)}</p>

          <!-- can-do chips (full width, row 3) -->
          <div class="col-span-2 mt-2.5 flex flex-wrap gap-1.5">
            {#each p.chips as chip (chip)}
              <span
                class="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11.5px] font-semibold text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-neutral-400"
              >
                {$t(chip)}
              </span>
            {/each}
            {#each p.noChips as chip (chip)}
              <span
                class="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11.5px] font-semibold text-gray-400 line-through decoration-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-600 dark:decoration-gray-600"
              >
                {$t(chip)}
              </span>
            {/each}
          </div>
        </div>
      </button>
    {/each}
  </div>

  <!-- Note box: cloud caution (amber) or info (blue/neutral) -->
  {#if showCloudCaution}
    <div
      class="flex gap-2.5 rounded-2xl border border-amber-200/60 bg-amber-50 p-3.5 text-[13px] leading-[1.45] text-amber-700 dark:border-amber-900/60 dark:bg-amber-950 dark:text-amber-300"
    >
      <svg
        class="mt-px h-[18px] w-[18px] flex-none"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <p>{$t('assistant_onboarding_access_cloud_caution')}</p>
    </div>
  {:else}
    <div
      class="flex gap-2.5 rounded-2xl border border-primary/20 bg-primary/5 p-3.5 text-[13px] leading-[1.45] text-primary/80 dark:border-primary/20 dark:bg-primary/5"
    >
      <svg
        class="mt-px h-[18px] w-[18px] flex-none"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      <p>{$t('assistant_onboarding_access_info_note')}</p>
    </div>
  {/if}
</div>
