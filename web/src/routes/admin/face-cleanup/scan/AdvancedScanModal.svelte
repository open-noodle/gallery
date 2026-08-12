<script lang="ts">
  import { getFaceRepairScanDefaults } from '@immich/sdk';
  import { FormModal } from '@immich/ui';
  import { mdiTune } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  export type AdvancedScanParams = { maxDistance: number; minFaces: number; maxFlaggedFraction: number };
  type Props = { onClose: () => void; onRun: (params: AdvancedScanParams) => void };
  const { onClose, onRun }: Props = $props();

  // Sensible fallbacks until the defaults endpoint resolves.
  let maxDistance = $state(0.5);
  let minFaces = $state(3);
  let maxFlaggedFraction = $state(0.5);

  const loadDefaults = async () => {
    // .catch() is attached synchronously so the rejection is observed before any
    // microtask checkpoint — avoids spurious unhandledRejection in test environments.
    const d = await getFaceRepairScanDefaults().catch(() => null);
    if (d) {
      maxDistance = d.maxDistance;
      minFaces = d.minFaces;
      maxFlaggedFraction = d.maxFlaggedFraction;
    }
    // if null, keep fallbacks; the server re-applies defaults for any omitted field anyway
  };

  onMount(loadDefaults);

  const onSubmit = () => {
    // Coerce to numbers — the API rejects string params (z.number()). Native numeric inputs already bind as
    // numbers; Number() is a no-op safety net.
    onRun({
      maxDistance: Number(maxDistance),
      minFaces: Number(minFaces),
      maxFlaggedFraction: Number(maxFlaggedFraction),
    });
    onClose();
  };
</script>

<FormModal
  title={$t('admin.face_cleanup_advanced_title')}
  icon={mdiTune}
  {onClose}
  {onSubmit}
  submitText={$t('admin.face_cleanup_advanced_apply')}
  size="giant"
>
  <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">{$t('admin.face_cleanup_advanced_subtitle')}</p>

  <div class="flex flex-col gap-6">
    <!-- Match sensitivity -->
    <div>
      <div class="flex items-baseline justify-between gap-3">
        <label for="adv-sensitivity" class="text-sm font-medium text-gray-900 dark:text-gray-100">
          {$t('admin.face_cleanup_advanced_sensitivity')}
        </label>
        <span class="font-mono text-sm text-gray-500 tabular-nums dark:text-gray-300">{maxDistance.toFixed(2)}</span>
      </div>
      <input
        id="adv-sensitivity"
        type="range"
        min="0.1"
        max="1"
        step="0.01"
        bind:value={maxDistance}
        class="mt-2 w-full"
        data-testid="sensitivity-range"
      />
      <p class="mt-1.5 text-xs text-gray-400">{$t('admin.face_cleanup_advanced_sensitivity_help')}</p>
    </div>

    <!-- `minFaces`. NOT a "skip people smaller than this" filter, which is what this control's label and help
         text used to claim: no per-person face-count filter exists anywhere in the scan pipeline
         (getEligibleFacePage filters on visibility/source only, and findReattributionCandidates is never passed
         minFaces). decideReattribution uses it for two things — the suspected owner must hold >= minFaces of the
         face's near neighbours, AND a face whose own person holds < minFaces is flagged without needing to lose
         the vote. So raising it flags MORE small clusters, not fewer. -->
    <div>
      <label for="adv-min-faces" class="text-sm font-medium text-gray-900 dark:text-gray-100">
        {$t('admin.face_cleanup_advanced_min_faces')}
      </label>
      <input
        id="adv-min-faces"
        type="number"
        min="1"
        step="1"
        bind:value={minFaces}
        class="mt-2 block w-24 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
        data-testid="min-faces-input"
      />
      <p class="mt-1.5 text-xs text-gray-400">{$t('admin.face_cleanup_advanced_min_faces_help')}</p>
    </div>

    <!-- Contamination cap -->
    <div>
      <div class="flex items-baseline justify-between gap-3">
        <label for="adv-cap" class="text-sm font-medium text-gray-900 dark:text-gray-100">
          {$t('admin.face_cleanup_advanced_cap')}
        </label>
        <span class="font-mono text-sm text-gray-500 tabular-nums dark:text-gray-300">
          {maxFlaggedFraction.toFixed(2)}
        </span>
      </div>
      <input
        id="adv-cap"
        type="range"
        min="0"
        max="1"
        step="0.01"
        bind:value={maxFlaggedFraction}
        class="mt-2 w-full"
        data-testid="cap-range"
      />
      <p class="mt-1.5 text-xs text-gray-400">{$t('admin.face_cleanup_advanced_cap_help')}</p>
    </div>

    <button type="button" class="self-start text-sm font-semibold text-primary hover:underline" onclick={loadDefaults}>
      {$t('admin.face_cleanup_advanced_reset')}
    </button>
  </div>
</FormModal>
