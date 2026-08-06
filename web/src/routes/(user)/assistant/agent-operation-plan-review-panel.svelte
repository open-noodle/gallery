<script lang="ts">
  import { websocketEvents, type AgentSessionClientEvent } from '$lib/stores/websocket';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AgentOperationPlanStatus,
    applyApprovedOperations,
    getCurrentOperationPlan,
    type AgentOperationPlanResponseDto,
    type AgentSessionResponseDto,
  } from '@immich/sdk';
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import AgentPlanEvidenceLedger from './agent-plan-evidence-ledger.svelte';
  import AgentPlanThumbnailStrip from './agent-plan-thumbnail-strip.svelte';
  import {
    buildGroupEnabledState,
    buildOperationReviewImpactSummary,
    buildOperationReviewModel,
    buildSelectionPayload,
    buildOperationItemSelectionState,
    createInitialOperationFieldOverrideState,
    createInitialOperationEnabledState,
    createInitialOperationItemSelectionState,
    resetOperationFieldOverride,
    resetOperationItemSelection,
    setOperationFieldOverride,
    toAgentOperationItemSelections,
    type AgentOperationSelectionPayload,
    type OperationEnabledState,
    type OperationFieldOverrideState,
    type OperationItemSelectionState,
    type OperationReviewGroup,
  } from './agent-operation-plan-ui';
  import { applyAgentPlanBulkItemSelection, setAgentPlanOnlyItemSelection } from './agent-plan-large-item-review-ui';

  interface Props {
    session: AgentSessionResponseDto;
    onSelectionChange?: (payload: AgentOperationSelectionPayload) => void;
    variant?: 'standalone' | 'dock';
    hideEmpty?: boolean;
  }

  let { session, onSelectionChange, variant = 'standalone', hideEmpty = false }: Props = $props();

  let plan = $state<AgentOperationPlanResponseDto | null>(null);
  let enabledByOperationId = $state<OperationEnabledState>({});
  let itemSelectionByOperationId = $state<OperationItemSelectionState>({});
  let fieldOverrideByOperationId = $state<OperationFieldOverrideState>({});
  let loading = $state(true);
  let errorMessage = $state<string | null>(null);
  let applying = $state(false);
  let applyMessage = $state<string | null>(null);
  let applyErrorMessage = $state<string | null>(null);
  let planExpanded = $state(true);
  let locallyApplyingPlanId = $state<string | null>(null);
  let lastAppliedPlanId = $state<string | null>(null);
  let pendingLocalApplyEvent = $state<Extract<AgentSessionClientEvent, { type: 'operation-plan-applied' }> | null>(
    null,
  );
  let cleanupWebsocketListener: (() => void) | undefined;
  let loadSequence = 0;
  let destroyed = false;

  const model = $derived(
    plan
      ? buildOperationReviewModel(plan, enabledByOperationId, itemSelectionByOperationId, fieldOverrideByOperationId)
      : null,
  );
  const selectionPayload = $derived(model ? buildSelectionPayload(model) : null);
  const selectedOperationIds = $derived(selectionPayload?.operationIds ?? []);
  const collapsedThumbnailGroup = $derived(
    (() => {
      if (!model) {
        return null;
      }

      for (const group of model.groups) {
        const selectedAssetIds = [
          ...new Set(
            group.operations
              .filter((operation) => operation.enabled && !operation.blocked)
              .flatMap((operation) => operation.selectedAssetIds),
          ),
        ];

        if (selectedAssetIds.length > 0) {
          return {
            ...group,
            assetCount: selectedAssetIds.length,
            thumbnailSummary: {
              totalCount: selectedAssetIds.length,
              representativeAssetIds: selectedAssetIds,
              hasMore: false,
            },
            representativeAssetIds: selectedAssetIds,
          };
        }
      }

      return null;
    })(),
  );
  const canChangeSelection = $derived(
    model !== null && model.plan.status === AgentOperationPlanStatus.Proposed && !applying,
  );
  const canApply = $derived(
    canChangeSelection && selectedOperationIds.length > 0 && (model?.fieldErrors.length ?? 0) === 0,
  );
  const rootClass = $derived(
    variant === 'dock'
      ? 'flex w-full flex-col gap-3 text-black dark:text-white'
      : 'mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-10 text-black dark:text-white md:px-8',
  );
  const passiveRootClass = $derived(
    variant === 'dock'
      ? 'w-full text-sm text-gray-500'
      : 'mx-auto w-full max-w-3xl px-4 pb-10 text-sm text-gray-500 md:px-8',
  );
  const passivePaddedRootClass = $derived(
    variant === 'dock' ? 'w-full text-sm' : 'mx-auto w-full max-w-3xl px-4 pb-10 text-sm md:px-8',
  );
  const cardClass = $derived(
    [
      'overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-xl shadow-black/5',
      'dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-black/40',
      variant === 'dock' ? '' : 'p-0',
    ]
      .filter(Boolean)
      .join(' '),
  );

  const buildPublishedSelectionPayload = (
    nextPlan: AgentOperationPlanResponseDto,
    nextEnabledByOperationId: OperationEnabledState,
    nextItemSelectionByOperationId: OperationItemSelectionState,
    nextFieldOverrideByOperationId: OperationFieldOverrideState,
  ) => {
    const nextPayload = buildSelectionPayload(
      buildOperationReviewModel(
        nextPlan,
        nextEnabledByOperationId,
        nextItemSelectionByOperationId,
        nextFieldOverrideByOperationId,
      ),
    );
    const fieldOverrides = Object.fromEntries(
      Object.entries(nextFieldOverrideByOperationId).filter(([, fields]) => Object.keys(fields).length > 0),
    );

    return Object.keys(fieldOverrides).length > 0 ? { ...nextPayload, fieldOverrides } : nextPayload;
  };

  const publishSelection = (
    nextPlan: AgentOperationPlanResponseDto,
    nextEnabledByOperationId: OperationEnabledState,
    nextItemSelectionByOperationId: OperationItemSelectionState,
    nextFieldOverrideByOperationId: OperationFieldOverrideState,
  ) => {
    if (destroyed) {
      return;
    }

    onSelectionChange?.(
      buildPublishedSelectionPayload(
        nextPlan,
        nextEnabledByOperationId,
        nextItemSelectionByOperationId,
        nextFieldOverrideByOperationId,
      ),
    );
  };

  const getErrorStatusCode = (error: unknown) => {
    if (!error || typeof error !== 'object') {
      return;
    }

    const data = 'data' in error ? error.data : undefined;
    if (data && typeof data === 'object' && 'statusCode' in data && typeof data.statusCode === 'number') {
      return data.statusCode;
    }

    if ('statusCode' in error && typeof error.statusCode === 'number') {
      return error.statusCode;
    }

    if ('status' in error && typeof error.status === 'number') {
      return error.status;
    }
  };

  const getErrorText = (error: unknown) => {
    if (!error || typeof error !== 'object') {
      return String(error ?? '');
    }

    const data = 'data' in error ? error.data : undefined;
    if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
      return data.message;
    }

    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }

    return String(error);
  };

  const getApplyErrorMessage = (error: unknown) => {
    const statusCode = getErrorStatusCode(error);
    const message = getErrorText(error).toLowerCase();

    if (
      statusCode === 409 &&
      (message.includes('plan') ||
        message.includes('revision') ||
        message.includes('stale') ||
        message.includes('changed') ||
        message.includes('superseded'))
    ) {
      return $t('assistant_operation_apply_stale');
    }

    if (
      statusCode === 403 ||
      statusCode === 404 ||
      message.includes('permission') ||
      message.includes('owned') ||
      message.includes('owner') ||
      message.includes('target')
    ) {
      return $t('assistant_operation_apply_forbidden');
    }

    return $t('assistant_operation_apply_error');
  };

  const isStaleApplyError = (error: unknown) => getApplyErrorMessage(error) === $t('assistant_operation_apply_stale');

  const loadPlan = async (options?: { preserveApplyErrorMessage?: boolean }) => {
    const sequence = ++loadSequence;
    loading = true;
    errorMessage = null;
    applyMessage = null;
    if (!options?.preserveApplyErrorMessage) {
      applyErrorMessage = null;
    }

    try {
      const nextPlan = await getCurrentOperationPlan({ id: session.id });
      if (destroyed || sequence !== loadSequence) {
        return;
      }

      const nextEnabledByOperationId = nextPlan ? createInitialOperationEnabledState(nextPlan) : {};
      const nextItemSelectionByOperationId = nextPlan ? createInitialOperationItemSelectionState(nextPlan) : {};
      const nextFieldOverrideByOperationId = nextPlan ? createInitialOperationFieldOverrideState(nextPlan) : {};
      plan = nextPlan;
      enabledByOperationId = nextEnabledByOperationId;
      itemSelectionByOperationId = nextItemSelectionByOperationId;
      fieldOverrideByOperationId = nextFieldOverrideByOperationId;
      planExpanded = true;

      if (nextPlan) {
        publishSelection(
          nextPlan,
          nextEnabledByOperationId,
          nextItemSelectionByOperationId,
          nextFieldOverrideByOperationId,
        );
      }
    } catch (error) {
      if (destroyed || sequence !== loadSequence) {
        return;
      }

      errorMessage = $t('assistant_operation_plan_error');
      planExpanded = true;
      handleError(error, errorMessage);
    } finally {
      if (!destroyed && sequence === loadSequence) {
        loading = false;
      }
    }
  };

  const handleSessionEvent = (event: AgentSessionClientEvent) => {
    if (
      (event.type !== 'operation-plan-ready' && event.type !== 'operation-plan-applied') ||
      event.sessionId !== session.id
    ) {
      return;
    }

    if (event.type === 'operation-plan-ready') {
      lastAppliedPlanId = null;
    }

    if (event.type === 'operation-plan-applied' && lastAppliedPlanId === event.planId) {
      return;
    }

    if (event.type === 'operation-plan-applied' && locallyApplyingPlanId === event.planId) {
      pendingLocalApplyEvent = event;
      return;
    }

    void loadPlan();
  };

  const applySelectedOperations = async () => {
    if (!model || !canApply || !selectionPayload) {
      return;
    }

    const applyingPlanId = model.plan.id;
    applying = true;
    locallyApplyingPlanId = applyingPlanId;
    errorMessage = null;
    applyMessage = null;
    applyErrorMessage = null;

    try {
      const itemSelections = toAgentOperationItemSelections(selectionPayload.itemSelections);
      const response = await applyApprovedOperations({
        id: session.id,
        planId: applyingPlanId,
        agentOperationPlanApplyRequestDto: {
          operationIds: selectionPayload.operationIds,
          ...(itemSelections ? { itemSelections } : {}),
          ...(selectionPayload.fieldOverrides ? { fieldOverrides: selectionPayload.fieldOverrides } : {}),
          planRevision: selectionPayload.planRevision,
        },
      });
      const nextEnabledByOperationId = createInitialOperationEnabledState(response.plan);
      const nextItemSelectionByOperationId = createInitialOperationItemSelectionState(response.plan);
      const nextFieldOverrideByOperationId = createInitialOperationFieldOverrideState(response.plan);
      publishSelection(
        response.plan,
        nextEnabledByOperationId,
        nextItemSelectionByOperationId,
        nextFieldOverrideByOperationId,
      );
      plan = null;
      enabledByOperationId = {};
      itemSelectionByOperationId = {};
      fieldOverrideByOperationId = {};
      lastAppliedPlanId = applyingPlanId;
      applyMessage = $t('assistant_operation_apply_success', {
        values: {
          applied: response.appliedOperationIds.length,
          failed: response.failedOperationIds.length,
        },
      });
    } catch (error) {
      if (pendingLocalApplyEvent?.planId === applyingPlanId) {
        await loadPlan();
        applyMessage = $t('assistant_operation_apply_success', {
          values: {
            applied: pendingLocalApplyEvent.appliedCount,
            failed: pendingLocalApplyEvent.failedCount,
          },
        });
      } else {
        applyErrorMessage = getApplyErrorMessage(error);
        planExpanded = true;
        handleError(error, applyErrorMessage);
        if (isStaleApplyError(error)) {
          await loadPlan({ preserveApplyErrorMessage: true });
        }
      }
    } finally {
      applying = false;
      locallyApplyingPlanId = null;
      pendingLocalApplyEvent = null;
    }
  };

  const toggleOperation = (operationId: string, checked: boolean) => {
    if (!plan || !canChangeSelection) {
      return;
    }

    const nextEnabledByOperationId = { ...enabledByOperationId, [operationId]: checked };
    enabledByOperationId = nextEnabledByOperationId;
    publishSelection(plan, nextEnabledByOperationId, itemSelectionByOperationId, fieldOverrideByOperationId);
  };

  const toggleGroup = (group: OperationReviewGroup, checked: boolean) => {
    if (!plan || !canChangeSelection) {
      return;
    }

    const nextEnabledByOperationId = buildGroupEnabledState(enabledByOperationId, group, checked);
    enabledByOperationId = nextEnabledByOperationId;
    publishSelection(plan, nextEnabledByOperationId, itemSelectionByOperationId, fieldOverrideByOperationId);
  };

  const toggleItem = (operationId: string, assetId: string, selected: boolean) => {
    if (!plan || !canChangeSelection) {
      return;
    }

    const nextItemSelectionByOperationId = buildOperationItemSelectionState(
      plan,
      itemSelectionByOperationId,
      operationId,
      assetId,
      selected,
    );
    itemSelectionByOperationId = nextItemSelectionByOperationId;
    publishSelection(plan, enabledByOperationId, nextItemSelectionByOperationId, fieldOverrideByOperationId);
  };

  const resetItemSelection = (operationId: string) => {
    if (!plan || !canChangeSelection) {
      return;
    }

    const nextItemSelectionByOperationId = resetOperationItemSelection(itemSelectionByOperationId, operationId);
    itemSelectionByOperationId = nextItemSelectionByOperationId;
    publishSelection(plan, enabledByOperationId, nextItemSelectionByOperationId, fieldOverrideByOperationId);
  };

  const bulkSetItems = (operationId: string, assetIds: string[], selected: boolean) => {
    if (!plan || !canChangeSelection) {
      return;
    }

    const operation = plan.operations.find((operation) => operation.id === operationId);
    const allAssetIds = operation?.assetIds ?? [];
    const nextItemSelectionByOperationId = applyAgentPlanBulkItemSelection({
      state: itemSelectionByOperationId,
      operationId,
      allAssetIds,
      targetAssetIds: assetIds,
      selected,
    });
    itemSelectionByOperationId = nextItemSelectionByOperationId;
    publishSelection(plan, enabledByOperationId, nextItemSelectionByOperationId, fieldOverrideByOperationId);
  };

  const setOnlyItems = (operationId: string, assetIds: string[]) => {
    if (!plan || !canChangeSelection) {
      return;
    }

    const operation = plan.operations.find((operation) => operation.id === operationId);
    const allAssetIds = operation?.assetIds ?? [];
    const nextItemSelectionByOperationId = setAgentPlanOnlyItemSelection({
      state: itemSelectionByOperationId,
      operationId,
      allAssetIds,
      targetAssetIds: assetIds,
    });
    itemSelectionByOperationId = nextItemSelectionByOperationId;
    publishSelection(plan, enabledByOperationId, nextItemSelectionByOperationId, fieldOverrideByOperationId);
  };

  const setFieldOverride = (operationId: string, fieldKey: string, value: string | undefined) => {
    if (!plan || !canChangeSelection) {
      return;
    }

    const nextFieldOverrideByOperationId =
      value === undefined
        ? resetOperationFieldOverride(fieldOverrideByOperationId, operationId, fieldKey)
        : setOperationFieldOverride(fieldOverrideByOperationId, operationId, fieldKey, value);
    fieldOverrideByOperationId = nextFieldOverrideByOperationId;
    publishSelection(plan, enabledByOperationId, itemSelectionByOperationId, nextFieldOverrideByOperationId);
  };

  const resetFieldOverride = (operationId: string, fieldKey: string) => {
    if (!plan || !canChangeSelection) {
      return;
    }

    const nextFieldOverrideByOperationId = resetOperationFieldOverride(
      fieldOverrideByOperationId,
      operationId,
      fieldKey,
    );
    fieldOverrideByOperationId = nextFieldOverrideByOperationId;
    publishSelection(plan, enabledByOperationId, itemSelectionByOperationId, nextFieldOverrideByOperationId);
  };

  onMount(() => {
    cleanupWebsocketListener = websocketEvents.on('on_agent_session_event', handleSessionEvent);
    void loadPlan();
  });

  onDestroy(() => {
    destroyed = true;
    loadSequence += 1;
    cleanupWebsocketListener?.();
  });
</script>

{#if loading && !model}
  <section class={passiveRootClass}>
    {$t('assistant_operation_plan_loading')}
  </section>
{:else if errorMessage && !model}
  <section class={passivePaddedRootClass}>
    <div
      class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      role="alert"
    >
      {errorMessage}
    </div>
  </section>
{:else if !model}
  {#if !hideEmpty}
    <section class={passivePaddedRootClass}>
      {#if applyMessage}
        <p
          class="rounded-lg border border-green-200 bg-green-50 p-3 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
          role="status"
        >
          {applyMessage}
        </p>
      {:else}
        <p class="text-gray-500">{$t('assistant_operation_plan_empty')}</p>
      {/if}
    </section>
  {/if}
{:else}
  {@const impact = buildOperationReviewImpactSummary(model)}
  <div class={rootClass} role="region" aria-labelledby="assistant-operation-plan-title">
    <article class={cardClass} data-testid="agent-operation-plan-sheet">
      <header class="flex flex-col gap-4 p-4 sm:p-5">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <h2 id="assistant-operation-plan-title" class="text-lg font-semibold">
              {$t('assistant_operation_plan_review')}
            </h2>
            <p class="mt-1 break-words text-sm text-gray-600 dark:text-gray-300">{model.plan.summary}</p>
            {#if planExpanded}
              <div class="mt-3 flex flex-wrap gap-2 text-sm text-gray-500 dark:text-gray-400">
                <span class="rounded-full bg-gray-100 px-3 py-1 dark:bg-gray-800">
                  {$t('assistant_operation_plan_destination_count', { values: { count: impact.destinationCount } })}
                </span>
                <span class="rounded-full bg-gray-100 px-3 py-1 dark:bg-gray-800">
                  {$t('assistant_operation_plan_selected_change_count', {
                    values: { count: impact.selectedOperationCount },
                  })}
                </span>
                <span class="rounded-full bg-gray-100 px-3 py-1 dark:bg-gray-800">
                  {$t('assistant_operation_plan_selected_asset_count', {
                    values: { count: impact.selectedAssetCount },
                  })}
                </span>
              </div>
            {/if}
          </div>
          <div class="flex shrink-0 flex-col gap-3 sm:items-end">
            {#if planExpanded}
              <div class="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-gray-300 sm:text-right">
                <span>{$t('assistant_operation_plan_no_destructive_changes')}</span>
                <span
                  >{$t('assistant_operation_selected_count', { values: { count: selectedOperationIds.length } })}</span
                >
              </div>
            {/if}
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-immich-primary dark:border-neutral-700 dark:bg-neutral-900 dark:text-gray-200 dark:hover:bg-neutral-800"
              aria-expanded={planExpanded}
              onclick={() => (planExpanded = !planExpanded)}
            >
              {#if planExpanded}
                {$t('assistant_operation_plan_collapse')}
              {:else}
                {$t('assistant_operation_plan_expand')}
              {/if}
            </button>
          </div>
        </div>

        {#if !planExpanded}
          <div
            class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-neutral-800 dark:bg-neutral-900"
            data-testid="agent-operation-plan-collapsed-summary"
          >
            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {$t('assistant_operation_plan_collapsed')}
            </p>
            <div class="mt-3 flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-300">
              <span class="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
                {$t('assistant_operation_plan_selected_change_count', {
                  values: { count: impact.selectedOperationCount },
                })}
              </span>
              <span class="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
                {$t('assistant_operation_plan_selected_asset_count', { values: { count: impact.selectedAssetCount } })}
              </span>
              <span class="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
                {$t('assistant_operation_plan_no_destructive_changes')}
              </span>
            </div>
            {#if collapsedThumbnailGroup}
              <AgentPlanThumbnailStrip group={collapsedThumbnailGroup} maxVisible={3} />
            {/if}
          </div>
        {/if}
      </header>

      {#if planExpanded}
        <div class={variant === 'dock' ? 'px-4 pb-4 sm:px-5 sm:pb-5' : 'px-5 pb-5'}>
          <AgentPlanEvidenceLedger
            {model}
            {selectedOperationIds}
            {canChangeSelection}
            {canApply}
            {applying}
            {errorMessage}
            {applyErrorMessage}
            {applyMessage}
            showHeader={false}
            onToggleGroup={toggleGroup}
            onToggleOperation={toggleOperation}
            onToggleItem={toggleItem}
            onBulkSetItems={bulkSetItems}
            onSetOnlyItems={setOnlyItems}
            onResetItemSelection={resetItemSelection}
            onSetFieldOverride={setFieldOverride}
            onResetFieldOverride={resetFieldOverride}
            onApply={applySelectedOperations}
          />
        </div>
      {/if}
    </article>
  </div>
{/if}
