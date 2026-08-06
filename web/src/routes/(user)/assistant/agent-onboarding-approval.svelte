<script lang="ts">
  import { AgentApprovalMode } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props {
    approval: AgentApprovalMode;
    onChange: (a: AgentApprovalMode) => void;
  }
  let { approval, onChange }: Props = $props();

  const MODES = [
    {
      value: AgentApprovalMode.PlanOnly,
      labelKey: 'assistant_onboarding_approval_plan',
      descKey: 'assistant_onboarding_approval_plan_desc',
      recommended: true,
      flow: [
        { type: 'node-ai' as const, labelKey: 'assistant_onboarding_flow_drafts_plan' },
        { type: 'arrow' as const },
        { type: 'node-you' as const, labelKey: 'assistant_onboarding_flow_you' },
        { type: 'arrow' as const },
        { type: 'node-go' as const, labelKey: 'assistant_onboarding_flow_runs' },
      ],
    },
    {
      value: AgentApprovalMode.Strict,
      labelKey: 'assistant_onboarding_approval_strict',
      descKey: 'assistant_onboarding_approval_strict_desc',
      recommended: false,
      flow: [
        { type: 'node-ai' as const, labelKey: 'assistant_onboarding_flow_step' },
        { type: 'arrow-loop' as const },
        { type: 'node-you' as const, labelKey: 'assistant_onboarding_flow_you' },
        { type: 'arrow-loop' as const },
        { type: 'node-ai' as const, labelKey: 'assistant_onboarding_flow_step_loop' },
      ],
    },
  ] as const;
</script>

<div class="flex flex-col gap-5">
  <!-- Eyebrow + title + subtitle -->
  <div>
    <p class="mb-3 text-[12px] font-bold uppercase tracking-[0.09em] text-primary">
      {$t('assistant_onboarding_approval_eyebrow')}
    </p>
    <h2 class="text-[30px] font-extrabold leading-[1.08] tracking-[-0.025em] text-gray-900 dark:text-white">
      {$t('assistant_onboarding_approval_title')}
    </h2>
    <p class="mt-2.5 max-w-[46ch] text-[15.5px] leading-relaxed text-gray-500 dark:text-neutral-400">
      {$t('assistant_onboarding_approval_subtitle')}
    </p>
  </div>

  <!-- 2-column approval card grid -->
  <div role="group" aria-label={$t('assistant_onboarding_approval_group_label')} class="grid grid-cols-2 gap-2.5">
    {#each MODES as mode (mode.value)}
      {@const isSelected = approval === mode.value}
      <button
        type="button"
        aria-pressed={isSelected ? 'true' : 'false'}
        aria-label={$t(mode.labelKey)}
        onclick={() => onChange(mode.value)}
        class="flex cursor-pointer flex-col gap-3 rounded-2xl border-[1.5px] p-4 text-left transition-all
          {isSelected
          ? 'border-primary bg-primary/5 shadow-[0_0_0_3px_rgba(66,80,175,0.28)]'
          : 'border-gray-300 bg-white hover:-translate-y-0.5 dark:border-gray-700 dark:bg-immich-dark-gray'}"
      >
        <!-- title row + recommended badge -->
        <div class="flex items-center justify-between gap-2">
          <span class="text-[14.5px] font-bold tracking-[-0.01em] text-gray-900 dark:text-white"
            >{$t(mode.labelKey)}</span
          >
          {#if mode.recommended}
            <span
              class="rounded-full bg-primary/10 px-[7px] py-[3px] text-[10.5px] font-bold uppercase tracking-[0.04em] text-primary"
            >
              {$t('assistant_onboarding_recommended')}
            </span>
          {/if}
        </div>

        <!-- description -->
        <p class="text-[12.5px] leading-[1.45] text-gray-500 dark:text-neutral-400">{$t(mode.descKey)}</p>

        <!-- mini flow diagram -->
        <div
          class="flex items-center gap-1.5 rounded-[11px] p-2.5
            {isSelected ? 'bg-white/70 dark:bg-black/20' : 'bg-gray-50 dark:bg-gray-800'}"
        >
          {#each mode.flow as node, i (i)}
            {#if node.type === 'arrow'}
              <!-- forward arrow -->
              <svg
                class="h-[13px] w-[13px] flex-none text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            {:else if node.type === 'arrow-loop'}
              <!-- horizontal line (loop / repeating) -->
              <svg
                class="h-[13px] w-[13px] flex-none text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M6 12h12" />
              </svg>
            {:else}
              <!-- node pill -->
              <span
                class="whitespace-nowrap rounded-[7px] border px-2 py-[5px] text-[10.5px] font-bold
                  {node.type === 'node-you'
                  ? 'border-primary/40 bg-white text-primary dark:bg-gray-800'
                  : node.type === 'node-go'
                    ? 'border-green-400/40 bg-white text-green-600 dark:bg-gray-800 dark:text-green-400'
                    : 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'}"
              >
                {$t(node.labelKey)}
              </span>
            {/if}
          {/each}
        </div>
      </button>
    {/each}
  </div>

  <!-- hint -->
  <p class="text-[12px] leading-snug text-gray-400 dark:text-gray-600">
    {$t('assistant_onboarding_approval_hint')}
  </p>
</div>
