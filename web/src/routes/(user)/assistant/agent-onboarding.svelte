<script lang="ts">
  import { AgentApprovalMode, AgentPermissionPreset, deleteAgentProviderCredential } from '@immich/sdk';
  import { Button } from '@immich/ui';
  import { t, type Translations } from 'svelte-i18n';
  import AgentOnboardingAccess from './agent-onboarding-access.svelte';
  import AgentOnboardingApproval from './agent-onboarding-approval.svelte';
  import AgentOnboardingConnect from './agent-onboarding-connect.svelte';
  import {
    ONBOARDING_DEFAULT_APPROVAL,
    ONBOARDING_DEFAULT_PRESET,
    type OnboardingProviderId,
  } from './agent-onboarding-model';

  interface OnboardingResult {
    credentialId: string;
    model: string;
    permissionPreset: AgentPermissionPreset;
    approvalMode: AgentApprovalMode;
    initialPrompt?: string;
  }

  interface Props {
    onComplete: (result: OnboardingResult) => void;
  }
  let { onComplete }: Props = $props();

  // Step machine: 0=welcome 1=connect 2=access 3=approval 4=ready
  let step = $state(0);

  // State threaded from connect step
  let connectedCredentialId = $state('');
  let connectedModel = $state('');
  let connectedProvider = $state<OnboardingProviderId>('local');

  // Access + approval defaults
  let preset = $state<AgentPermissionPreset>(ONBOARDING_DEFAULT_PRESET);
  let approval = $state<AgentApprovalMode>(ONBOARDING_DEFAULT_APPROVAL);

  const continueEnabled = $derived(step !== 1 || connectedCredentialId !== '');

  const handleConnected = (credentialId: string, model: string, provider: OnboardingProviderId) => {
    if (credentialId && connectedCredentialId && credentialId !== connectedCredentialId) {
      void deleteAgentProviderCredential({ id: connectedCredentialId }).catch(() => {});
    }
    connectedCredentialId = credentialId;
    connectedModel = model;
    connectedProvider = provider;
  };

  const goNext = () => {
    if (continueEnabled) {
      step = Math.min(step + 1, 4);
    }
  };

  const goBack = () => {
    step = Math.max(step - 1, 0);
  };

  const finish = (initialPrompt?: string) => {
    onComplete({
      credentialId: connectedCredentialId,
      model: connectedModel,
      permissionPreset: preset,
      approvalMode: approval,
      ...(initialPrompt ? { initialPrompt } : {}),
    });
  };

  // Readable preset label for the ready summary
  const PRESET_LABEL_KEYS: Record<AgentPermissionPreset, Translations> = {
    [AgentPermissionPreset.Careful]: 'assistant_permission_preset_careful',
    [AgentPermissionPreset.VisualOrganizer]: 'assistant_permission_preset_visual_organizer',
    [AgentPermissionPreset.LocalPowerUser]: 'assistant_permission_preset_local_power_user',
    [AgentPermissionPreset.Custom]: 'assistant_permission_preset_visual_organizer',
  };
  const presetLabelKey = $derived(PRESET_LABEL_KEYS[preset]);
</script>

<div class="mx-auto w-full max-w-3xl">
  <!-- Card shell -->
  <div
    class="relative rounded-[28px] border border-gray-200 bg-white px-8 pb-7 pt-7 shadow-xl dark:border-gray-700 dark:bg-immich-dark-gray"
  >
    <!-- Top line: brand spark + step segments -->
    <div class="mb-7 flex min-h-[26px] items-center justify-between gap-4">
      <!-- Brand mark -->
      <div class="inline-flex items-center gap-2 text-sm font-bold tracking-tight">
        <span
          class="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-primary text-white shadow-[0_4px_12px_-4px_rgba(66,80,175,0.4)]"
        >
          <svg
            class="h-[13px] w-[13px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
            <path d="M19 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
          </svg>
        </span>
        <span class="text-gray-800 dark:text-gray-100">{$t('assistant_onboarding_brand_name')}</span>
      </div>

      <!-- Segmented stepper (steps 1–4) -->
      {#if step >= 1 && step <= 4}
        <div class="flex max-w-[220px] flex-1 gap-1.5">
          {#each [1, 2, 3, 4] as seg (seg)}
            <div
              class="relative h-[5px] flex-1 overflow-hidden rounded-full
                {seg <= step ? 'bg-primary' : 'bg-gray-200 dark:bg-gray-700'}"
            ></div>
          {/each}
        </div>
        <span class="text-[12.5px] font-semibold tabular-nums text-gray-400 dark:text-gray-500">
          {$t('assistant_onboarding_step_count', { values: { step, total: 4 } })}
        </span>
      {/if}
    </div>

    <!-- WELCOME (step 0) -->
    {#if step === 0}
      <div class="flex flex-col gap-5">
        <!-- floating hero mark -->
        <div
          class="flex h-[60px] w-[60px] items-center justify-center rounded-[18px] bg-primary text-white shadow-[0_16px_34px_-14px_rgba(66,80,175,0.5)]"
          style="animation: onboarding-float 5s ease-in-out infinite;"
        >
          <svg
            class="h-[30px] w-[30px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="4" width="18" height="14" rx="2.5" />
            <path d="m3 14 4-4 3.5 3.5" />
            <path d="m14 13 2.5-2.5L21 14" />
            <circle cx="9" cy="9" r="1.4" />
          </svg>
        </div>

        <h1 class="text-[30px] font-extrabold leading-[1.08] tracking-[-0.025em] text-gray-900 dark:text-white">
          {$t('assistant_onboarding_welcome_title')}
        </h1>
        <p class="max-w-[46ch] text-[15.5px] leading-relaxed text-gray-500 dark:text-neutral-400">
          {$t('assistant_onboarding_welcome_subtitle')}
        </p>

        <!-- 3 promise rows -->
        <div class="flex flex-col gap-3">
          <div class="flex items-start gap-3">
            <span class="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-primary/10 text-primary">
              <svg
                class="h-[17px] w-[17px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </span>
            <div>
              <div class="text-[14.5px] font-semibold text-gray-900 dark:text-white">
                {$t('assistant_onboarding_promise_privacy_title')}
              </div>
              <div class="mt-0.5 text-[13px] leading-snug text-gray-500 dark:text-neutral-400">
                {$t('assistant_onboarding_promise_privacy_desc')}
              </div>
            </div>
          </div>
          <div class="flex items-start gap-3">
            <span class="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-primary/10 text-primary">
              <svg
                class="h-[17px] w-[17px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </span>
            <div>
              <div class="text-[14.5px] font-semibold text-gray-900 dark:text-white">
                {$t('assistant_onboarding_promise_approval_title')}
              </div>
              <div class="mt-0.5 text-[13px] leading-snug text-gray-500 dark:text-neutral-400">
                {$t('assistant_onboarding_promise_approval_desc')}
              </div>
            </div>
          </div>
          <div class="flex items-start gap-3">
            <span class="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-primary/10 text-primary">
              <svg
                class="h-[17px] w-[17px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M14.7 6.3a4 4 0 0 1 0 5.6l-1.4 1.4a4 4 0 0 1-5.6-5.6l.7-.7" />
                <path d="M9.3 17.7a4 4 0 0 1 0-5.6l1.4-1.4a4 4 0 0 1 5.6 5.6l-.7.7" />
              </svg>
            </span>
            <div>
              <div class="text-[14.5px] font-semibold text-gray-900 dark:text-white">
                {$t('assistant_onboarding_promise_model_title')}
              </div>
              <div class="mt-0.5 text-[13px] leading-snug text-gray-500 dark:text-neutral-400">
                {$t('assistant_onboarding_promise_model_desc')}
              </div>
            </div>
          </div>
        </div>

        <!-- Footer nav -->
        <div class="mt-1 flex items-center justify-between gap-3 border-t border-gray-200 pt-5 dark:border-gray-700">
          <span
            class="inline-flex max-w-[30ch] items-center gap-1.5 text-[12.5px] font-medium leading-snug text-gray-400 dark:text-gray-500"
          >
            <svg
              class="h-3.5 w-3.5 flex-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="4" y="11" width="16" height="9" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            {$t('assistant_onboarding_footer_settings')}
          </span>
          <div class="inline-flex items-center gap-2">
            <Button shape="round" onclick={() => (step = 1)}>
              {$t('assistant_onboarding_get_started')}
              <svg
                class="h-[17px] w-[17px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Button>
          </div>
        </div>
      </div>

      <!-- CONNECT (step 1) -->
    {:else if step === 1}
      <div class="flex flex-col gap-4">
        <div>
          <p class="mb-3 text-[12px] font-bold uppercase tracking-[0.09em] text-primary">
            {$t('assistant_onboarding_connect_eyebrow')}
          </p>
          <h2 class="text-[30px] font-extrabold leading-[1.08] tracking-[-0.025em] text-gray-900 dark:text-white">
            {$t('assistant_onboarding_connect_title')}
          </h2>
          <p class="mt-2.5 max-w-[46ch] text-[15.5px] leading-relaxed text-gray-500 dark:text-neutral-400">
            {$t('assistant_onboarding_connect_subtitle')}
          </p>
        </div>
        <AgentOnboardingConnect onConnected={handleConnected} />
      </div>
      <div class="mt-6 flex items-center justify-between gap-3 border-t border-gray-200 pt-5 dark:border-gray-700">
        <span
          class="inline-flex max-w-[30ch] items-center gap-1.5 text-[12.5px] font-medium leading-snug text-gray-400 dark:text-gray-500"
        >
          <svg
            class="h-3.5 w-3.5 flex-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="4" y="11" width="16" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          {$t('assistant_onboarding_footer_key_encrypted')}
        </span>
        <div class="inline-flex items-center gap-2">
          <Button shape="round" color="secondary" onclick={goBack}>{$t('assistant_onboarding_back')}</Button>
          <Button shape="round" disabled={!continueEnabled} onclick={goNext}>
            {$t('assistant_onboarding_continue')}
            <svg
              class="h-[17px] w-[17px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Button>
        </div>
      </div>

      <!-- ACCESS (step 2) -->
    {:else if step === 2}
      <AgentOnboardingAccess provider={connectedProvider} {preset} onChange={(p) => (preset = p)} />
      <div class="mt-6 flex items-center justify-between gap-3 border-t border-gray-200 pt-5 dark:border-gray-700">
        <span
          class="inline-flex max-w-[30ch] items-center gap-1.5 text-[12.5px] font-medium leading-snug text-gray-400 dark:text-gray-500"
        >
          <svg
            class="h-3.5 w-3.5 flex-none"
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
          {$t('assistant_onboarding_footer_model_only')}
        </span>
        <div class="inline-flex items-center gap-2">
          <Button shape="round" color="secondary" onclick={goBack}>{$t('assistant_onboarding_back')}</Button>
          <Button shape="round" onclick={goNext}>
            {$t('assistant_onboarding_continue')}
            <svg
              class="h-[17px] w-[17px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Button>
        </div>
      </div>

      <!-- APPROVAL (step 3) -->
    {:else if step === 3}
      <AgentOnboardingApproval {approval} onChange={(a) => (approval = a)} />
      <div class="mt-6 flex items-center justify-between gap-3 border-t border-gray-200 pt-5 dark:border-gray-700">
        <span
          class="inline-flex max-w-[30ch] items-center gap-1.5 text-[12.5px] font-medium leading-snug text-gray-400 dark:text-gray-500"
        >
          <svg
            class="h-3.5 w-3.5 flex-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          {$t('assistant_onboarding_footer_no_approval')}
        </span>
        <div class="inline-flex items-center gap-2">
          <Button shape="round" color="secondary" onclick={goBack}>{$t('assistant_onboarding_back')}</Button>
          <Button shape="round" onclick={goNext}>
            {$t('assistant_onboarding_continue')}
            <svg
              class="h-[17px] w-[17px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Button>
        </div>
      </div>

      <!-- READY (step 4) -->
    {:else if step === 4}
      <div class="flex flex-col gap-4">
        <!-- confetti checkmark, pops in -->
        <div
          class="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400"
          style="animation: onboarding-pop 0.5s cubic-bezier(0.22,1,0.36,1) both;"
        >
          <svg
            class="h-7 w-7"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>

        <h2 class="text-[30px] font-extrabold leading-[1.08] tracking-[-0.025em] text-gray-900 dark:text-white">
          {$t('assistant_onboarding_ready_title')}
        </h2>
        <p class="text-[15.5px] text-gray-500 dark:text-neutral-400">{$t('assistant_onboarding_ready_subtitle')}</p>

        <!-- summary rows -->
        <div class="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700">
          <!-- Model row -->
          <div class="flex items-center gap-3 bg-white px-4 py-3.5 dark:bg-immich-dark-gray">
            <span
              class="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              <svg
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
              </svg>
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-gray-400 dark:text-gray-500">
                {$t('assistant_onboarding_model')}
              </div>
              <div class="mt-0.5 truncate text-[14.5px] font-semibold text-gray-900 dark:text-white">
                {connectedModel}
              </div>
            </div>
            <button
              class="rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-primary transition-colors hover:bg-primary/10"
              aria-label={$t('assistant_onboarding_edit')}
              onclick={() => (step = 1)}
              type="button">{$t('assistant_onboarding_edit')}</button
            >
          </div>

          <!-- Access row -->
          <div
            class="flex items-center gap-3 border-t border-gray-200 bg-white px-4 py-3.5 dark:border-gray-700 dark:bg-immich-dark-gray"
          >
            <span
              class="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              <svg
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-gray-400 dark:text-gray-500">
                {$t('assistant_onboarding_ready_row_access')}
              </div>
              <div class="mt-0.5 text-[14.5px] font-semibold text-gray-900 dark:text-white">
                {$t(presetLabelKey)}
              </div>
            </div>
            <button
              class="rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-primary transition-colors hover:bg-primary/10"
              aria-label={$t('assistant_onboarding_edit')}
              onclick={() => (step = 2)}
              type="button">{$t('assistant_onboarding_edit')}</button
            >
          </div>

          <!-- Approvals row -->
          <div
            class="flex items-center gap-3 border-t border-gray-200 bg-white px-4 py-3.5 dark:border-gray-700 dark:bg-immich-dark-gray"
          >
            <span
              class="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              <svg
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-gray-400 dark:text-gray-500">
                {$t('assistant_onboarding_ready_row_approvals')}
              </div>
              <div class="mt-0.5 text-[14.5px] font-semibold text-gray-900 dark:text-white">
                {approval === AgentApprovalMode.PlanOnly
                  ? $t('assistant_onboarding_approval_plan')
                  : $t('assistant_onboarding_approval_strict')}
              </div>
            </div>
            <button
              class="rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-primary transition-colors hover:bg-primary/10"
              aria-label={$t('assistant_onboarding_edit')}
              onclick={() => (step = 3)}
              type="button">{$t('assistant_onboarding_edit')}</button
            >
          </div>
        </div>

        <!-- example prompts -->
        <div>
          <p class="mb-2 text-[12.5px] font-semibold text-gray-500 dark:text-neutral-400">
            {$t('assistant_onboarding_try_asking')}
          </p>
          <div class="flex flex-col gap-2">
            <button
              class="flex w-full items-center gap-2.5 rounded-[11px] border border-gray-200 bg-white px-3 py-2.5 text-left text-[13.5px] text-gray-900 transition-all hover:translate-x-0.5 hover:border-primary hover:bg-primary/5 dark:border-gray-700 dark:bg-immich-dark-gray dark:text-white"
              type="button"
              onclick={() => finish($t('assistant_onboarding_prompt_album'))}
            >
              <svg
                class="h-[15px] w-[15px] flex-none text-primary"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M3 7h18M3 12h18M3 17h12" />
              </svg>
              {$t('assistant_onboarding_prompt_album')}
            </button>
            <button
              class="flex w-full items-center gap-2.5 rounded-[11px] border border-gray-200 bg-white px-3 py-2.5 text-left text-[13.5px] text-gray-900 transition-all hover:translate-x-0.5 hover:border-primary hover:bg-primary/5 dark:border-gray-700 dark:bg-immich-dark-gray dark:text-white"
              type="button"
              onclick={() => finish($t('assistant_onboarding_prompt_blurry'))}
            >
              <svg
                class="h-[15px] w-[15px] flex-none text-primary"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m21 21-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
              </svg>
              {$t('assistant_onboarding_prompt_blurry')}
            </button>
            <button
              class="flex w-full items-center gap-2.5 rounded-[11px] border border-gray-200 bg-white px-3 py-2.5 text-left text-[13.5px] text-gray-900 transition-all hover:translate-x-0.5 hover:border-primary hover:bg-primary/5 dark:border-gray-700 dark:bg-immich-dark-gray dark:text-white"
              type="button"
              onclick={() => finish($t('assistant_onboarding_prompt_passport'))}
            >
              <svg
                class="h-[15px] w-[15px] flex-none text-primary"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="4" y="11" width="16" height="9" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              {$t('assistant_onboarding_prompt_passport')}
            </button>
          </div>
        </div>
      </div>

      <div class="mt-6 flex items-center justify-between gap-3 border-t border-gray-200 pt-5 dark:border-gray-700">
        <span
          class="inline-flex max-w-[30ch] items-center gap-1.5 text-[12.5px] font-medium leading-snug text-gray-400 dark:text-gray-500"
        >
          <svg
            class="h-3.5 w-3.5 flex-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5z" />
          </svg>
          {$t('assistant_onboarding_footer_change_later')}
        </span>
        <div class="inline-flex items-center gap-2">
          <Button shape="round" color="secondary" onclick={goBack}>{$t('assistant_onboarding_back')}</Button>
          <Button shape="round" onclick={() => finish()}>
            {$t('assistant_onboarding_open')}
            <svg
              class="h-[17px] w-[17px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  @keyframes onboarding-float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-5px);
    }
  }
  @keyframes onboarding-pop {
    0% {
      transform: scale(0.4);
      opacity: 0;
    }
    60% {
      transform: scale(1.08);
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    * {
      animation-duration: 0.01ms !important;
    }
  }
</style>
